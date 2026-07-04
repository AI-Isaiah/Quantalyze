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

# Phase 18 / A1 (Claude adversarial 2026-05-07) — built dynamically from
# `DENYLIST_EXACT` + `DENYLIST_PREFIX` so Pass 1/4 of `scrub_freeform_string`
# can never drift from the object-walker denylist. The original hand-typed
# regex was missing 7 canonical denylist keys (`x-bapi-apikey`,
# `x-bapi-sign`, `x-bapi-signature`, `ok-access-passphrase`,
# `ok-access-key`, `ok-access-timestamp`, `x-internal-token`) plus the
# `sb-ec-` prefix — every one of which the TS `pii-scrub.ts` regex covers.
# Mirrors the TS implementation so a freeform line like
# "x-bapi-apikey: SECRET" is redacted on both runtimes.
# CR-1 (2026-07-04): the bare `secret` / `token` alternates (the former from
# DENYLIST_EXACT, the latter here) only match at a `\b` word boundary. A
# compound key like `client_secret` / `access_token` / `db_password` has a
# word-char `[a-z0-9]_` prefix immediately before the suffix, which SUPPRESSES
# the `\b` — so `client_secret=VALUE` slipped through unredacted while
# `signature=VALUE` (no prefix) was caught. Fix the CLASS by allowing an
# optional vendor/scope prefix `(?:[a-z0-9]+[-_])?` on the credential-bearing
# suffixes. Strictly a superset of the old alternates (prefix is optional), so
# no benign line that was previously redacted stops being redacted. `key` is
# only generalized behind the `api` anchor to avoid over-redacting benign
# `key: value` log lines.
_FREEFORM_KEY_ALTERNATES: tuple[str, ...] = (
    r"(?:[a-z0-9]+[-_])?api[-_]?key",
    r"(?:[a-z0-9]+[-_])?secret",
    r"api[-_]?secret",  # concatenated apisecret/apiSecret: the optional prefix above REQUIRES a separator
    r"(?:[a-z0-9]+[-_])?password",
    r"(?:[a-z0-9]+[-_])?token",
    "credential",
    "cookie",
    "session",
    "bearer",
)


def _build_sensitive_key_value() -> re.Pattern[str]:
    parts: list[str] = []
    for key in DENYLIST_EXACT:
        parts.append(re.escape(key))
    for prefix in DENYLIST_PREFIX:
        parts.append(re.escape(prefix) + r"[A-Za-z0-9_-]*")
    parts.extend(_FREEFORM_KEY_ALTERNATES)
    pattern = (
        r"\b((?:" + "|".join(parts) + r"))"
        r"\s*[:=]+\s*['\"]?([^\s'\"]+)['\"]?"
    )
    return re.compile(pattern, re.IGNORECASE)


SENSITIVE_KEY_VALUE: re.Pattern[str] = _build_sensitive_key_value()

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
    """Four-pass redaction for freeform strings (mirrors TS scrubFreeformString).

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

    # NEW-C13-10 fast-path (perf-spec M conf=9, 2026-05-28): credentials carry
    # `:`, `=`, or `.` in their key=value / JWT / URL-param shapes; prose lines
    # ("Worker starting") hit none. Hot because the stdlib LogRecord factory
    # bridge in logging_config.py routes EVERY record (incl. level-filtered
    # DEBUG) through here — fast-path skips 4 regex passes at ~100 records/sec.
    if ":" not in s and "=" not in s and "." not in s:
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
