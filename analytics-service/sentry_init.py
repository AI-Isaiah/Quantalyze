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

# Phase 18 / FIX-04 — canonical PII scrub module. The walker below is now a
# thin shim around services.redact.scrub_pii (which mirrors src/lib/admin/
# pii-scrub.ts byte-for-byte at the API layer, including the 6 broker-quirk
# header keys promoted in Adversarial revision Grok B1). Local _PII_KEYS
# remains the surface enumeration ground truth for THIS module — it carries
# additional defense-in-depth keys (e.g. x-bapi-timestamp, x-mbx-time-unit)
# that have NOT yet been promoted to the canonical denylist.
from services.redact import (
    scrub_pii as _redact_scrub_pii,
    scrub_freeform_string as _redact_scrub_freeform_string,
    DENYLIST_EXACT as _CANONICAL_DENYLIST,
)


# ---------------------------------------------------------------------------
# Mirror of src/lib/admin/pii-scrub.ts L16-25 DENYLIST_EXACT (8 keys) PLUS the
# broker-specific signing-header surface (Bybit v5 + OKX extras + Binance extras
# per FIX 7). All matched case-insensitively.
# ---------------------------------------------------------------------------
_PII_KEYS: frozenset[str] = frozenset({
    # --- Plan 3 / pii-scrub.ts L16-25 (8 exact keys) ---
    "apikey",
    "apisecret",
    # --- Phase 16 / OBSERV-04 — snake_case wire forms posted by
    # ConnectKeyStep / SubmitStep wizard endpoints. FastAPIIntegration
    # auto-captures POST body into event.request.data; without these
    # entries on the denylist the raw broker creds land at Sentry.
    "api_key",
    "api_secret",
    "secret",
    "signature",
    "passphrase",
    "authorization",
    "x-mbx-apikey",
    "ok-access-sign",
    # --- Phase 16 / OBSERV-07 — INTERNAL_API_TOKEN forwarded on the
    # Next.js → FastAPI seam; redact in case it surfaces in HTTP
    # breadcrumbs or response-context dicts.
    "x-internal-token",
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


# Phase 18 / FIX-04 — Adversarial revision Grok B1: 6 broker-quirk keys
# (x-bapi-apikey, x-bapi-sign, x-bapi-signature, ok-access-passphrase,
# ok-access-key, ok-access-timestamp) were PROMOTED into the canonical
# denylist in `services.redact.DENYLIST_EXACT`. The local `_PII_KEYS` retains
# additional Bybit/Binance defense-in-depth keys (x-bapi-timestamp,
# x-bapi-recv-window, x-bapi-sign-type, x-bapi-api-key, x-mbx-time-unit)
# that have NOT yet been promoted. The two-stage walker below covers both:
# (a) canonical scrub via `services.redact.scrub_pii`, then
# (b) broker-quirk sweep over the local extras.
#
# Phase 18 / M9 — `_CANONICAL_DENYLIST` is imported directly from
# `services.redact.DENYLIST_EXACT` (above) so the mirror cannot drift.
# Promoting a key in `redact.py` shrinks `_BROKER_QUIRK_KEYS` automatically.

# Forward-compat slot — keys still in _PII_KEYS but NOT yet in the canonical
# denylist. After Grok B1 promotion this is non-empty for the Bybit
# x-bapi-timestamp / x-bapi-recv-window / x-bapi-sign-type / x-bapi-api-key
# (hyphenated form) and Binance x-mbx-time-unit headers.
_BROKER_QUIRK_KEYS: frozenset[str] = _PII_KEYS - _CANONICAL_DENYLIST


def _broker_quirk_sweep(value: Any) -> Any:
    """Walk the canonical-scrubbed structure once more for keys that are in
    `_PII_KEYS` but NOT in the canonical denylist (forward-compat slot)."""
    if isinstance(value, Mapping):
        out: dict[str, Any] = {}
        for k, v in value.items():
            if isinstance(k, str) and k.lower() in _BROKER_QUIRK_KEYS:
                out[k] = _REDACTED
            else:
                out[k] = _broker_quirk_sweep(v)
        return out
    if isinstance(value, list):
        return [_broker_quirk_sweep(v) for v in value]
    return value


def _scrub(value: Any) -> Any:
    """Two-stage scrub:
      (a) canonical scrub via services.redact.scrub_pii (covers all 17 TS-mirrored
          keys including broker-quirk x-bapi-* / ok-access-* per Grok B1, plus
          sb-ec- prefix and JWT-shape detection),
      (b) broker-quirk sweep for the local extras still in `_PII_KEYS` but not
          yet in the canonical denylist.

    JWT_SUBSTRING substring detection inside un-anchored strings is intentionally
    NOT applied here — the Sentry surface assumes structured headers/cookies/data
    where keys are dict keys, not embedded `key=value` substrings.

    Phase 18 / WR-05 — note on (b): once stage (a) has redacted a key
    that is ALSO in `_PII_KEYS`, stage (b) walks the redacted value
    (already a `[REDACTED]` string) and is a structural no-op for that
    branch. Stage (b) is only load-bearing for the 5 keys still in
    `_BROKER_QUIRK_KEYS` (i.e. `_PII_KEYS - _CANONICAL_DENYLIST`):
    `x-bapi-api-key` (hyphenated form), `x-bapi-timestamp`,
    `x-bapi-recv-window`, `x-bapi-sign-type`, `x-mbx-time-unit`. These
    haven't been promoted to the canonical denylist yet, so stage (b)
    catches them as a forward-compat slot. Performance is negligible —
    deepest observed Sentry event dict is 7 levels per Grok W3 — and
    promoting any of these keys to the canonical denylist will simply
    shift their handling from (b) to (a) with no behavior change.
    """
    canonical = _redact_scrub_pii(value)
    return _broker_quirk_sweep(canonical)


def _redact_before_send(event: dict[str, Any], hint: dict[str, Any] | None) -> dict[str, Any]:
    """Sentry before_send hook. NEVER raises — Pitfall 6: a crash here drops the event silently.

    Phase 16 / OBSERV-04 scrub surfaces (must cover every place FastApiIntegration +
    StarletteIntegration auto-capture user data):
      - event['request']['headers' | 'cookies' | 'query_string' | 'data' | 'json']
      - event['breadcrumbs'][*]['data'] (esp. http-category capturing fetch headers/body)
      - event['exception']['values'][*]['stacktrace']['frames'][*]['vars'] (local
        variables in the failing frame — wizard creds may live here as Pydantic
        model fields or local 'creds' dicts).

    Phase 19 / H-6 — defense-in-depth: stamp event["environment"] from the same
    fallback chain as init_sentry(). The init-time argument is authoritative for
    the SDK; the per-event stamp guards against captures that take place before
    init_sentry() ran (e.g. import-time exception in a fixture) or against future
    refactors that call sentry_sdk.init() without environment=... .
    """
    try:
        # H-6 defensive environment stamp — does not override an already-set
        # value (e.g. test code seeding event["environment"] explicitly).
        if not event.get("environment"):
            event["environment"] = _resolve_environment()
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
            # POST/PUT body — FastApiIntegration captures parsed JSON into 'data'
            # (and sometimes 'json' depending on integration version). Walk both.
            if "data" in req:
                req["data"] = _scrub(req["data"]) if isinstance(req["data"], (dict, list)) else _scrub_value(req["data"])
            if "json" in req:
                req["json"] = _scrub(req["json"]) if isinstance(req["json"], (dict, list)) else _scrub_value(req["json"])
        if isinstance(event.get("extra"), dict):
            event["extra"] = _scrub(event["extra"])
        if isinstance(event.get("contexts"), dict):
            event["contexts"] = _scrub(event["contexts"])
        # Breadcrumbs — every category may carry data. http breadcrumbs from
        # outbound fetch() include headers + body; user breadcrumbs include
        # form values. Scrub all of them.
        #
        # PR-2 background-reviewer C2 + security SEC-PR2-03 (2026-05-28):
        # also scrub `crumb["message"]` (set by Sentry's LoggingIntegration
        # to the rendered logger message — can carry unredacted ccxt URLs
        # when the stdlib factory failed-open) AND `crumb["data"]` when it
        # arrives as a STRING (some SDK versions stash exc_info text there).
        if isinstance(event.get("breadcrumbs"), dict):
            crumbs = event["breadcrumbs"].get("values")
            if isinstance(crumbs, list):
                for crumb in crumbs:
                    if not isinstance(crumb, dict):
                        continue
                    if isinstance(crumb.get("data"), dict):
                        crumb["data"] = _scrub(crumb["data"])
                    elif isinstance(crumb.get("data"), str):
                        try:
                            crumb["data"] = _redact_scrub_freeform_string(crumb["data"])
                        except Exception:  # pragma: no cover — defensive
                            pass
                    if isinstance(crumb.get("message"), str):
                        try:
                            crumb["message"] = _redact_scrub_freeform_string(crumb["message"])
                        except Exception:  # pragma: no cover — defensive
                            pass
        # Exception locals — Sentry default with_locals=True attaches frame
        # vars on every captured exception. Wizard endpoints define `creds`,
        # `api_key`, `api_secret` in the failing scope; without this walker
        # they ride the exception report verbatim.
        if isinstance(event.get("exception"), dict):
            values = event["exception"].get("values")
            if isinstance(values, list):
                for exc in values:
                    if not isinstance(exc, dict):
                        continue
                    # NEW-C13-10 / Security H conf=8 (2026-05-28 specialist):
                    # LoggingIntegration sets exception.values[i].value to
                    # str(exc) verbatim — pre-fix the walker only scrubbed
                    # stacktrace frame vars, leaking HMAC-bearing ccxt
                    # messages. Scrub the `value` string before egress.
                    val = exc.get("value")
                    if isinstance(val, str):
                        try:
                            exc["value"] = _redact_scrub_freeform_string(val)
                        except Exception:  # pragma: no cover — defensive
                            pass
                    stacktrace = exc.get("stacktrace")
                    if not isinstance(stacktrace, dict):
                        continue
                    frames = stacktrace.get("frames")
                    if not isinstance(frames, list):
                        continue
                    for frame in frames:
                        if isinstance(frame, dict) and isinstance(frame.get("vars"), dict):
                            frame["vars"] = _scrub(frame["vars"])
        return event
    except Exception:  # pragma: no cover — defensive; Test 10 exercises the wrap
        return event


def _resolve_environment() -> str:
    """Phase 19 / H-6 — resolve the Sentry `environment` tag from a fallback
    chain that mirrors the TS init in src/instrumentation.ts.

    Order:
      1. VERCEL_ENV — set by Vercel on every Next.js → analytics-service hop
         when the FastAPI service is collocated or proxied through Vercel.
      2. RAILWAY_ENVIRONMENT_NAME — set by Railway when analytics-service
         runs as a separate Railway worker.
      3. "development" — local dev fallback. Intentionally NOT "production"
         to avoid Pitfall 8: tagging local errors as "production" would let
         dev cassette runs trip the /api/cron/flag-monitor auto-rollback.

    Phase 19 / BACKBONE-05 — the flag-monitor cron filters Sentry events on
    `environment:production`. If this resolves to anything other than the
    real prod string, the cron's denominator-vs-error ratio is wrong.
    """
    return (
        os.getenv("VERCEL_ENV")
        or os.getenv("RAILWAY_ENVIRONMENT_NAME")
        or "development"
    )


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
        environment=_resolve_environment(),
    )
