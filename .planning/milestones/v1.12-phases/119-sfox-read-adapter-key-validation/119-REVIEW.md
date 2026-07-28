---
phase: 119-sfox-read-adapter-key-validation
reviewed: 2026-07-18T00:00:00Z
depth: deep
files_reviewed: 8
files_reviewed_list:
  - analytics-service/routers/exchange.py
  - analytics-service/routers/debug_key_flow.py
  - analytics-service/services/exchange.py
  - analytics-service/services/sfox_read.py
  - analytics-service/tests/test_sfox_read.py
  - src/app/api/keys/validate-and-encrypt/route.ts
  - src/app/api/strategies/create-with-key/route.ts
  - src/app/api/strategies/composite/add-key/route.ts
findings:
  critical: 0
  warning: 1
  info: 2
  total: 3
status: fixed
---

# Phase 119: Code Review Report

**Reviewed:** 2026-07-18
**Depth:** deep (cross-file: TS routes → analytics-client → analytics validate/read → SfoxClient contract)
**Files Reviewed:** 8 (migration + phase-118 SfoxClient excluded per scope)
**Status:** issues_found (no blockers)

## Summary

The core security carve-out is sound. The `api_secret` relaxation is keyed on
sfox ONLY in all three routes — no ccxt exchange (binance/okx/bybit/deribit) can
reach the relaxed presence/length path with an empty or short secret, and the
empty secret is funnelled through the same `validateKey`/`encryptKey` →
`trimCredential` chokepoint (`analytics-client.ts:168`, `"".trim() === ""`), not
a parallel path. The Python validate branch correctly intercepts sfox BEFORE the
ccxt `create_exchange` path, maps 401/403 to the shared `AUTH_FAILED_DETAIL`
string (→ `KEY_AUTH_FAILED` with zero TS edits), fails CLOSED (500, never
`valid:true`) on any non-auth failure, and always closes the `SfoxClient` session
via `finally`. `sfox_read.read_sfox_account` is honest: read-only asserted at the
ingestion boundary via `isinstance`, fail-loud on every leg (no partial dict), no
crawl/reconstruction leaked from phase 120, and no token/secret in any log or
exception. Tests use hand-authored fixtures as independent oracles (P115 clean).

Three non-blocking findings below: one WARNING (a case-handling divergence
between the three sibling routes that can 400 a legitimate sfox connect on the
allocator route while the wizard routes accept it), and two INFO advisories.

## Warnings

### WR-01: `validate-and-encrypt` uses case-SENSITIVE sfox match while the two sibling routes normalize case — a mixed-case sfox connect is rejected on one route and accepted on the others

**File:** `src/app/api/keys/validate-and-encrypt/route.ts:31`
(vs `src/app/api/strategies/create-with-key/route.ts:70` and
`src/app/api/strategies/composite/add-key/route.ts:91`)

**Issue:**
The allocator route keys the carve-out on an exact, case-sensitive match:

```ts
const isSfox = exchange === "sfox";
```

and then passes the RAW `exchange` value downstream to
`validateKey(exchange, …)` (line 134), which forwards it verbatim to the Python
`/validate-key` endpoint whose intercept is also exact: `if req.exchange == "sfox"`.

The two wizard routes instead use a case-insensitive match AND send a normalized
value:

```ts
const isSfox = exchange.toLowerCase() === "sfox";   // create-with-key:70 / add-key:91
…
const exchangeNormalized = exchange.toLowerCase();  // sent to validateKey/encryptKey
```

Concrete failure scenario: a caller submitting `"sFOX"` or `"SFOX"` (the
`EXCHANGE_DISPLAY` casing, or any client that does not pre-lowercase) to
`/api/keys/validate-and-encrypt`:
- `isSfox` is `false` → the presence guard `(!isSfox && !api_secret)` fires →
  `400 "Missing required fields"` even though sfox legitimately carries no secret;
- if a secret happens to be present, the raw `"sFOX"` reaches Python, misses the
  exact `== "sfox"` intercept, falls into `create_exchange("sFOX", …)` → `ValueError`
  → `400`. Either way the allocator sfox connect fails.

The exact-same input succeeds on `create-with-key` / `composite/add-key` because
they lowercase both the match and the downstream value. This is a fragile,
divergent contract across three routes that all implement the identical carve-out
(CLAUDE.md Rule 7/11: surface conflicting patterns, don't blend them). The happy
path only works today because the client happens to send lowercase `"sfox"`;
nothing in this route enforces or normalizes that.

**Fix:** align the allocator route to the sibling convention — match
case-insensitively and normalize the value sent downstream:

```ts
const isSfox = typeof exchange === "string" && exchange.toLowerCase() === "sfox";
const exchangeNormalized =
  typeof exchange === "string" ? exchange.toLowerCase() : exchange;
// …
return await legacyValidateAndEncryptHandler({
  exchange: exchangeNormalized, api_key, api_secret: api_secret_normalized, passphrase,
});
```

(The Python `== "sfox"` intercept is fine once it always receives a lowercased
value, matching what the wizard routes already send.)

## Info

### IN-01: `_validate_sfox_key` constructs `SfoxClient` OUTSIDE the try/finally — an empty/whitespace-trimmed token raises `ValueError` as an unhandled 500 instead of the documented fail-closed mapping

**File:** `analytics-service/routers/exchange.py:49`

**Issue:**
`SfoxClient.__init__` raises `ValueError("SfoxClient requires a non-empty
api_key")` on an empty key (`sfox_client.py:108`). In `_validate_sfox_key` the
client is built on line 49, BEFORE the `try:` on line 50, so that `ValueError`
escapes the function's fail-closed `except SfoxApiError` mapping and surfaces as
an uncaught FastAPI 500. A user entering an 8-space token (`api_key.length < 8`
passes on the TS side; `trimCredential` then trims it to `""` at
`analytics-client.ts:175`) hits exactly this: the wizard renders it as an opaque
`UNKNOWN`/500 rather than a clean `KEY_AUTH_FAILED`. It still fails closed (no
`valid:true`, no key stored) and the `ValueError` message contains no
credential, so there is no security or data-integrity impact — only degraded UX
and avoidable Sentry noise, and the docstring's "anything else → fail CLOSED with
a generic 500" claim silently does not cover this construction path.

**Fix:** either construct inside the `try` (so the existing generic-500 arm
catches it) or guard up front and map to the auth string:

```python
if not api_key:
    raise HTTPException(status_code=400, detail=AUTH_FAILED_DETAIL)
client = SfoxClient(api_key=api_key, base_url=SFOX_PROD_BASE_URL)
```

### IN-02: sfox `read_only=True` is adapter-structural, not key-scope-verified — a withdraw/trade-capable sfox token is accepted and stored, unlike ccxt keys which are probe-rejected

**File:** `analytics-service/routers/exchange.py:52`

**Issue:**
For ccxt exchanges, `validate_key_permissions` probes the key and REJECTS one
that can trade/withdraw, protecting the user from storing an over-scoped
credential. The sfox branch returns `{"valid": True, "read_only": True}` on any
token that can merely READ balances; sFOX exposes no per-key scope endpoint, so a
token that ALSO has trade/withdraw scope is accepted and encrypted-at-rest all
the same. The `read_only=True` here is an honest claim that *the adapter* is
GET-only (structurally enforced — `SfoxClient._request` hardcodes `"GET"`,
`sfox_client.py:201`), NOT that the *key's scope* was observed read-only. This is
the correct, documented A1 decision (no invented scope triple), and the platform
never exercises write scope. Flagged only so the residual risk is explicit and
owned: the platform holds a credential that may carry broader-than-read
permissions, undetectably, for sfox alone. No code change is implied unless sFOX
later ships a scope endpoint (then probe it, like ccxt).

**Fix:** none required — accept and track. Optionally surface a one-line
user-facing note at the sfox connect step ("create a read-only sFOX token") so
the user, not the platform, minimizes the stored scope.

---

## Round 2 — Red-Team Composition-Seam Findings (2026-07-18)

A fresh-context red team on the composed state surfaced seven composition-seam
findings. Status below.

### FIXED

- **F1 (MEDIUM — recurring Sentry spam):** the ccxt-only sync cron threw on every
  connected sfox key every 15-min tick. `routers/cron.py::_sync_single_key` now
  guards `if exchange_name not in EXCHANGE_CLASSES` BEFORE `create_exchange`,
  logs at INFO, and returns a benign `status="deferred"` (counted separately from
  `error` in the cron summary); the key stays active. Commit `58926ce5`.
  Regression: `tests/test_cron_router.py::TestDeferredNonCcxtSkip`.
- **F4 (honesty — recreates the 110.1 ccxt fix for sfox):** `_validate_sfox_key`
  non-401/403 failures no longer blame the user's credentials with a 500. 429 →
  shared `RATE_LIMITED_DETAIL` (→ KEY_RATE_LIMIT); 5xx / status==0 → shared
  `NETWORK_ERROR_DETAIL`; only 401/403 stays `AUTH_FAILED_DETAIL`. The two
  transient strings were hoisted into `services/exchange.py` as the single source
  of truth both the ccxt arms and the sfox branch emit (like `AUTH_FAILED_DETAIL`),
  so the TS classifier maps them identically. Commit `38a4dbba`. NOTE: the ccxt
  NetworkError copy classifies to UNKNOWN (not KEY_NETWORK_TIMEOUT) in the current
  `classifyKeyValidationError` — sfox now mirrors ccxt EXACTLY; making it
  KEY_NETWORK_TIMEOUT would require a `network`/`connectivity` keyword in the TS
  classifier and is out of this Python-only scope (flagged, not silently changed).
- **F5 (unhandled 500, same class as IN-01):** a token with an embedded control
  char (`\n`/`\r` survive trimCredential) made aiohttp raise a bare `ValueError`
  at request time that escaped as a 500. `_validate_sfox_key` now catches
  `ValueError` and fails CLOSED with `AUTH_FAILED_DETAIL` (400 → KEY_AUTH_FAILED),
  never logging the token. Commit `208eeb1a`. Regression:
  `test_sfox_control_char_token_fails_closed_not_500_and_never_logs_token`.

### DEFERRED to phase 120 (documented as phase-120 dependencies; NOT touched)

- **F2, F3, F6, F7** — deferred to phase 120 (sfox ingestion / crawl
  orchestration) per coordinator direction; not addressed in this phase.

---

_Reviewed: 2026-07-18_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: deep_
_Round 2 fixes: Claude (gsd-code-fixer) — F1/F4/F5 fixed, F2/F3/F6/F7 deferred-to-120_
