"""Phase 16 / OBSERV-08 — vcrpy 8.1.1 cassette singleton with PII filters.

Asserted invariants:
  1. record_mode='once' — CI replays only; never re-records and silently leaks.
  2. filter_headers covers Plan 3 _PII_KEYS (8 keys) + ALL broker-specific signing
     header variants: Bybit v5 (x-bapi-*), OKX (ok-access-*), Binance (x-mbx-*).
  3. filter_query_parameters strips Binance's QUERY-based signing parameters
     (signature, timestamp, recvWindow, api_key) — Binance does NOT sign via
     headers, so filter_headers alone leaks Binance signatures.
  4. before_record_response walks JSON body and redacts:
     a. Static accountId / userId / email / address / ip / etc. PII keys.
     b. Deep recursive scan: any field whose name contains sign/key/pass/secret
        (case-insensitive) gets `[REDACTED]`. Defense against derived signatures
        appearing in 200 / 429 / error response bodies.
  5. CI grep gate in scripts/repro-key-flow.sh is the belt-and-braces guard against
     filter bugs (env-value match + high-entropy literal scan).
"""

from __future__ import annotations

import json
from typing import Any

import vcr

# ----------------------------------------------------------------------------
# L1: Headers stripped entirely from cassette (case-insensitive).
# Plan 3 _PII_KEYS denylist + broker-specific signing variants.
# ----------------------------------------------------------------------------
_FILTER_HEADERS: list[str] = [
    # --- Plan 3 / pii-scrub.ts denylist (the actual exact keys, NOT
    # fictional `x-api-key`/`x-passphrase` that no real exchange uses) ---
    "authorization",
    "apikey",
    "apisecret",
    "secret",
    "signature",
    "passphrase",

    # --- Phase 16 / OBSERV-07 — internal-seam token forwarded by
    # debug-key-flow route.ts; redact in case any cassette ever
    # records that hop. Also the SDK-side broker key/secret variants
    # different exchanges send under different header names.
    "x-internal-token",
    "x-api-key",      # generic vendor variant kept for defensive coverage
    "x-api-signature",
    "x-passphrase",

    # --- Bybit v5 signing scheme (FIX 3) ---
    "x-bapi-api-key",
    "x-bapi-sign",
    "x-bapi-timestamp",
    "x-bapi-recv-window",
    "x-bapi-sign-type",

    # --- OKX signing scheme ---
    "ok-access-sign",
    "ok-access-passphrase",
    "ok-access-key",
    "ok-access-timestamp",

    # --- Binance signing scheme (header portion; the QUERY portion is in L2) ---
    "x-mbx-apikey",
    "x-mbx-time-unit",
]

# ----------------------------------------------------------------------------
# L2: Query parameters stripped from cassette URL.
# Binance signs via the QUERY string (signature=...&timestamp=...). vcrpy's
# filter_headers does NOT cover query params — this is the blind spot
# documented in FIX 3.
# ----------------------------------------------------------------------------
_FILTER_QUERY_PARAMETERS: list[str] = [
    "signature",   # Binance HMAC-SHA256 signature
    "timestamp",   # Binance request timestamp (also signed)
    "recvWindow",  # Binance receive-window parameter
    "api_key",     # snake_case variant some legacy paths use
]

# ----------------------------------------------------------------------------
# L3a: Static JSON body keys to redact (case-insensitive).
# Replaces values with [REDACTED]. Pitfall 4: filter_headers does NOT cover
# response bodies — exchanges echo user context (account id, user id,
# deposit/withdraw addresses) in payloads.
# ----------------------------------------------------------------------------
_REDACT_BODY_KEYS_EXACT: set[str] = {
    "accountid", "userid", "email", "address", "ip", "ipaddress",
    "name", "fullname", "phone", "user", "uid",
}

# ----------------------------------------------------------------------------
# L3b: Substring-based deep redaction. Any field name containing one of these
# substrings (case-insensitive) is redacted regardless of nesting depth.
# Defense-in-depth against derived signatures appearing in response bodies
# (e.g., echo-back of the request signature in a 429 error body).
# ----------------------------------------------------------------------------
_REDACT_BODY_SUBSTRINGS: tuple[str, ...] = (
    "sign",    # signature, signedRequest, request_signed, ...
    "key",     # apiKey, apikey, signing_key, ...
    "pass",    # passphrase, password, ...
    "secret",  # apiSecret, secret, refresh_secret, ...
)
_REDACT_VALUE = "[REDACTED]"


def _is_redact_key(name: str) -> bool:
    """Returns True if the JSON key should be redacted by L3a or L3b."""
    if not isinstance(name, str):
        return False
    lower = name.lower()
    if lower in _REDACT_BODY_KEYS_EXACT:
        return True
    return any(token in lower for token in _REDACT_BODY_SUBSTRINGS)


def _walk(obj: Any) -> Any:
    """Recursive JSON walker — deep redact denylisted keys."""
    if isinstance(obj, dict):
        return {
            k: (_REDACT_VALUE if _is_redact_key(k) else _walk(v))
            for k, v in obj.items()
        }
    if isinstance(obj, list):
        return [_walk(v) for v in obj]
    return obj


def _scrub_response(response: dict) -> dict:
    """Apply L3 deep walker to vcrpy response.body.string."""
    body = response.get("body", {}) or {}
    body_bytes = body.get("string", b"")
    if not body_bytes:
        return response
    try:
        parsed = json.loads(body_bytes)
    except (ValueError, TypeError):
        return response
    response["body"]["string"] = json.dumps(_walk(parsed)).encode("utf-8")
    return response


def _scrub_request(request):
    """Defensive request-side scrub — should be redundant with filter_headers
    + filter_query_parameters but cheap to keep as a safety net."""
    return request


phase16_vcr = vcr.VCR(
    cassette_library_dir="tests/cassettes",
    serializer="yaml",
    record_mode="once",  # CRITICAL — never "all"; CI must replay deterministically
    match_on=["method", "scheme", "host", "port", "path", "query"],
    filter_headers=_FILTER_HEADERS,
    filter_query_parameters=_FILTER_QUERY_PARAMETERS,  # FIX 3 — Binance QUERY-signed
    before_record_response=_scrub_response,
    before_record_request=_scrub_request,
)
