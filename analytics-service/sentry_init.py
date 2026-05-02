"""Phase 16 / OBSERV-04 + OBSERV-05 — sentry-sdk[fastapi] init + PII redactor.

Asserted invariants:
  1. init_sentry() is a no-op when SENTRY_DSN env is unset (existing fail-open pattern).
  2. before_send is wrapped in try/except — a redaction bug NEVER drops Sentry events
     silently (Pitfall 6).
  3. _PII_KEYS mirrors src/lib/admin/pii-scrub.ts FULL surface (FIX 7):
       a. 8 exact keys at L16-25 (apikey, apisecret, secret, signature, passphrase,
          authorization, x-mbx-apikey, ok-access-sign)
       b. _PII_KEY_PREFIXES mirrors L27 (sb-ec-) — Supabase encryption-context cookies
       c. _JWT_SHAPE regex mirrors L31 — replaces JWT-shaped string values with
          `[JWT-REDACTED]` regardless of the key name
       d. PLUS broker-specific signing headers (Bybit v5 / OKX / Binance) — same
          surface as Plan 8 FIX 3 vcrpy filter, defense-in-depth across both Sentry
          and cassettes
  4. FastApiIntegration + StarletteIntegration both registered for ASGI auto-capture.

  Phase 18 reminder: the eventual `redact.py` mirror in Phase 18 must include ALL of
  these surfaces (8 exact keys + DENYLIST_PREFIX sb-ec- + JWT_SHAPE regex + broker
  signing headers). A fixture corpus shared across TS pii-scrub.ts + Python
  sentry_init.py + Python redact.py would prevent future drift (T-16-03-06).
"""

from __future__ import annotations

import os
import re
from typing import Any, Mapping

import sentry_sdk
from sentry_sdk.integrations.fastapi import FastApiIntegration
from sentry_sdk.integrations.starlette import StarletteIntegration


# ---------------------------------------------------------------------------
# Mirror of src/lib/admin/pii-scrub.ts L16-25 DENYLIST_EXACT (8 keys) PLUS the
# broker-specific signing-header surface (Bybit v5 + OKX extras + Binance extras
# per FIX 7). All matched case-insensitively.
# ---------------------------------------------------------------------------
_PII_KEYS: frozenset[str] = frozenset({
    # --- Plan 3 / pii-scrub.ts L16-25 (8 exact keys) ---
    "apikey",
    "apisecret",
    "secret",
    "signature",
    "passphrase",
    "authorization",
    "x-mbx-apikey",
    "ok-access-sign",
    # --- Bybit v5 signing scheme (FIX 7) ---
    "x-bapi-api-key",
    "x-bapi-sign",
    "x-bapi-timestamp",
    "x-bapi-recv-window",
    "x-bapi-sign-type",
    # --- OKX signing scheme (extras beyond ok-access-sign) ---
    "ok-access-passphrase",
    "ok-access-key",
    "ok-access-timestamp",
    # --- Binance signing scheme (extras beyond x-mbx-apikey) ---
    "x-mbx-time-unit",
})

# Mirror of src/lib/admin/pii-scrub.ts L27 DENYLIST_PREFIX. Case-insensitive.
_PII_KEY_PREFIXES: tuple[str, ...] = ("sb-ec-",)

# Mirror of src/lib/admin/pii-scrub.ts L31 JWT_SHAPE.
# Detects bearer-shaped strings: three base64url segments separated by dots.
_JWT_SHAPE: re.Pattern[str] = re.compile(
    r"^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$"
)

_REDACTED = "[REDACTED]"
_REDACTED_JWT = "[JWT-REDACTED]"


def _is_denylisted_key(name: Any) -> bool:
    """Returns True if the key name matches the exact denylist OR any prefix."""
    if not isinstance(name, str):
        return False
    lower = name.lower()
    if lower in _PII_KEYS:
        return True
    return any(lower.startswith(p) for p in _PII_KEY_PREFIXES)


def _scrub_value(value: Any) -> Any:
    """JWT detector — string values matching JWT shape get replaced regardless of key name."""
    if isinstance(value, str) and _JWT_SHAPE.match(value):
        return _REDACTED_JWT
    return value


def _scrub(value: Any) -> Any:
    """Recursive denylist walker. Replaces matching keys with [REDACTED] (case-insensitive)
    AND scrubs JWT-shaped string values regardless of key name."""
    if isinstance(value, Mapping):
        out: dict[str, Any] = {}
        for k, v in value.items():
            if _is_denylisted_key(k):
                out[k] = _REDACTED
            else:
                out[k] = _scrub(v)
        return out
    if isinstance(value, list):
        return [_scrub(v) for v in value]
    return _scrub_value(value)


def _redact_before_send(event: dict[str, Any], hint: dict[str, Any] | None) -> dict[str, Any]:
    """Sentry before_send hook. NEVER raises — Pitfall 6: a crash here drops the event silently."""
    try:
        if isinstance(event.get("request"), dict):
            req = event["request"]
            if isinstance(req.get("headers"), dict):
                req["headers"] = _scrub(req["headers"])
            if isinstance(req.get("cookies"), dict):
                req["cookies"] = _scrub(req["cookies"])
            if isinstance(req.get("query_string"), str):
                # query_string is a single concatenated string; we can't structurally
                # parse without loss, so just JWT-scan it.
                req["query_string"] = _scrub_value(req["query_string"])
        if isinstance(event.get("extra"), dict):
            event["extra"] = _scrub(event["extra"])
        if isinstance(event.get("contexts"), dict):
            event["contexts"] = _scrub(event["contexts"])
        return event
    except Exception:  # pragma: no cover — defensive; Test 10 exercises the wrap
        return event


def init_sentry() -> None:
    """Initialize sentry-sdk with FastAPI/Starlette integrations + PII redactor.

    No-op when SENTRY_DSN unset. Idempotent in practice — sentry_sdk.init can be
    called multiple times but Plan 3 calls this exactly once at process startup.
    """
    dsn = os.getenv("SENTRY_DSN")
    if not dsn:
        return
    sentry_sdk.init(
        dsn=dsn,
        traces_sample_rate=0.1,
        send_default_pii=False,
        integrations=[StarletteIntegration(), FastApiIntegration()],
        before_send=_redact_before_send,
        environment=os.getenv("RAILWAY_ENVIRONMENT_NAME", "development"),
    )
