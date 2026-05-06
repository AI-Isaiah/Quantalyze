"""PII scrub mirror — mirrors src/lib/admin/pii-scrub.ts byte-for-byte at the API layer.

Phase 18 / FIX-04. The TS module at src/lib/admin/pii-scrub.ts is the canonical
denylist + JWT detector + recursive walker. This module exists so the analytics-service
has a Python equivalent for Sentry before_send, structlog processor, and audit-log
metadata scrubbing.

Leaf-module invariant (Pitfall 4 in 18-RESEARCH.md): NEVER import sentry_sdk,
structlog, or any services.* sibling. Only stdlib `re` and `typing`. Future callers
import this module; this module imports nothing from inside the service tree.

Cycles: JSON does not have cycles by construction. If a caller hands a non-JSON
object graph with cycles, the max-depth guard (default 100) raises RecursionError
(Adversarial revision 2026-05-06: Grok W3) — preferred over silent stack overflow.

Adversarial revisions baked in:
  - Grok B1: 6 broker-quirk header keys (x-bapi-*, ok-access-passphrase/key/timestamp)
             promoted to the canonical denylist. Both runtimes share the surface.
  - Grok W3: scrub_pii accepts max_depth (default 100). Pathological inputs raise
             RecursionError before Python's stack overflow.
  - Grok B1 secondary: scrub_freeform_string adds Pass 4 (transitive re-walk)
             so a Pass 1 redaction that exposes another denylisted key shape on
             the same line is caught.
"""

from __future__ import annotations

import re
from typing import Any, Mapping


# ---------------------------------------------------------------------------
# Canonical denylist — mirrors src/lib/admin/pii-scrub.ts DENYLIST_EXACT
# verbatim, including the 6 Grok-B1 broker-quirk header keys.
# ---------------------------------------------------------------------------

DENYLIST_EXACT: frozenset[str] = frozenset({
    "apikey",
    "apisecret",
    "api_key",
    "api_secret",
    "secret",
    "signature",
    "passphrase",
    "authorization",
    "x-mbx-apikey",
    "ok-access-sign",
    "x-internal-token",
    # Adversarial revision 2026-05-06: Grok B1 — Bybit/OKX broker-quirk header keys.
    "x-bapi-apikey",
    "x-bapi-sign",
    "x-bapi-signature",
    "ok-access-passphrase",
    "ok-access-key",
    "ok-access-timestamp",
})

# Mirror of pii-scrub.ts L38 DENYLIST_PREFIX.
DENYLIST_PREFIX: tuple[str, ...] = ("sb-ec-",)

# Mirror of pii-scrub.ts L42 JWT_SHAPE — anchored 3-segment base64url.
JWT_SHAPE: re.Pattern[str] = re.compile(
    r"^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$"
)

# Mirror of pii-scrub.ts L49-50 JWT_SUBSTRING — embedded 3-segment, 10+ char floor.
JWT_SUBSTRING: re.Pattern[str] = re.compile(
    r"[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}"
)

# Mirror of pii-scrub.ts L57-60 SENSITIVE_KEY_VALUE.
# Note: TS uses /gi flags; Python translates to re.IGNORECASE — `re.sub` is
# already global by default (replaces all non-overlapping matches).
SENSITIVE_KEY_VALUE: re.Pattern[str] = re.compile(
    r"\b((?:api[-_]?key|api[-_]?secret|x-mbx-apikey|ok-access-sign|secret|"
    r"passphrase|password|token|credential|cookie|session|authorization|bearer))"
    r"\s*[:=]+\s*['\"]?([^\s'\"]+)['\"]?",
    re.IGNORECASE,
)

REDACTED = "[REDACTED]"
REDACTED_JWT = "[REDACTED_JWT]"


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------


def _is_denylisted_key(key: Any) -> bool:
    """True if `key` is a string matching the exact denylist OR any prefix."""
    if not isinstance(key, str):
        return False
    lower = key.lower()
    if lower in DENYLIST_EXACT:
        return True
    return any(lower.startswith(p) for p in DENYLIST_PREFIX)


def _scrub_string(value: str) -> str:
    """Whole-string JWT detector — replaces JWT-shaped strings with the redaction token."""
    return REDACTED_JWT if JWT_SHAPE.match(value) else value


# ---------------------------------------------------------------------------
# Public API — mirrors pii-scrub.ts: scrubPii, truncateAccountId, scrubFreeformString
# ---------------------------------------------------------------------------


def scrub_pii(value: Any, *, max_depth: int = 100, _depth: int = 0) -> Any:
    """Recursive JSONB walker. Plain data in -> plain data out, with denylisted
    keys redacted and whole-string JWTs replaced. Non-mutating; returns new objects.

    Adversarial revision 2026-05-06 (Grok W3): explicit max_depth guard.
    Default 100 is more than enough for realistic JSONB / Sentry event dicts
    (deepest observed in repo: 7). Raises RecursionError when exceeded — this
    is preferred over silent stack overflow on cyclic / pathological inputs.
    """
    if _depth > max_depth:
        raise RecursionError(f"scrub_pii exceeded max_depth={max_depth}")
    if value is None:
        return value
    if isinstance(value, str):
        return _scrub_string(value)
    # `bool` is a subclass of `int`, so check it FIRST so True/False don't fall
    # into the int branch (which would still pass through, but stay explicit).
    if isinstance(value, bool):
        return value
    if isinstance(value, (int, float)):
        return value
    if isinstance(value, list):
        return [
            scrub_pii(v, max_depth=max_depth, _depth=_depth + 1) for v in value
        ]
    if isinstance(value, Mapping):
        out: dict[str, Any] = {}
        for k, v in value.items():
            if isinstance(k, str) and _is_denylisted_key(k):
                out[k] = REDACTED
            else:
                out[k] = scrub_pii(v, max_depth=max_depth, _depth=_depth + 1)
        return out
    # Any other type — pass through (defensive).
    return value


def truncate_account_id(s: Any) -> Any:
    """`***<last4>` for strings of length >= 8; pass-through for shorter strings or non-strings.

    Mirrors pii-scrub.ts L117-121 truncateAccountId.
    """
    if not isinstance(s, str):
        return s
    if len(s) < 8:
        return s
    return f"***{s[-4:]}"


def scrub_freeform_string(s: Any) -> Any:
    """Three-pass redaction for freeform strings (mirrors TS scrubFreeformString).

    Pass 1: SENSITIVE_KEY_VALUE substring redaction (`key: value` / `key=value`).
    Pass 2: scrub_pii (whole-string JWT — anchored regex; no-op on non-JWT strings).
    Pass 3: JWT_SUBSTRING (embedded JWT shape mid-line).
    Pass 4: transitive re-walk of Pass 1 (Grok B1 secondary — re-runs the
            key-value sub on Pass 3 output to catch denylisted-key shapes that
            Pass 1's earlier redaction may have surfaced).

    Non-strings pass through unchanged.
    """
    if not isinstance(s, str):
        return s

    pass1 = SENSITIVE_KEY_VALUE.sub(lambda m: f"{m.group(1)}: {REDACTED}", s)
    pass2 = scrub_pii(pass1)
    pass2_str = (
        pass2 if isinstance(pass2, str)
        else str(pass2 if pass2 is not None else "")
    )
    pass3 = JWT_SUBSTRING.sub(REDACTED_JWT, pass2_str)
    # Pass 4 — transitive re-walk (Grok B1 secondary).
    pass4 = SENSITIVE_KEY_VALUE.sub(lambda m: f"{m.group(1)}: {REDACTED}", pass3)
    return pass4
