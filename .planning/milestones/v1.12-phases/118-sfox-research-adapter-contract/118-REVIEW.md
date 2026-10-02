---
phase: 118-sfox-research-adapter-contract
reviewed: 2026-07-18T00:00:00Z
depth: deep
files_reviewed: 3
files_reviewed_list:
  - analytics-service/services/sfox_client.py
  - analytics-service/tests/test_sfox_client.py
  - analytics-service/tests/test_sfox_client_live.py
findings:
  critical: 0
  warning: 3
  info: 3
  total: 6
status: fixed
redteam_round2: fixed
redteam_round2_findings: F1,F2,F3,F4,F5,F7
---

# Phase 118: Code Review Report

> **Round 2 (fresh red team, 2026-07-18) — F1–F5 + F7 all fixed on `gsd/v1.12-sfox-verified-integration`:**
> - **F1** (MEDIUM, worker-wedge): use-after-close now raises at the TOP of `_request`, before `_rate_gate` — no 10s gate sleep before failing (commit 51c5cbe8).
> - **F2** (MEDIUM, worker-wedge): explicit `aiohttp.ClientTimeout(total=30)` on the owned session, replacing aiohttp's implicit 300s (commit c223d8c1).
> - **F3** (LOW-MED): rate gate wrapped in a per-instance `asyncio.Lock` — concurrent same-endpoint calls serialize ≥ interval apart, preventing a 429/ban (commit a11fecb4).
> - **F4** (LOW): non-JSON-2xx now raises `status=0`, so `status==0` uniformly means shape/contract violation for the phase-119 classifier (commit 215ae63b).
> - **F5** (LOW): `aiohttp.ClientError`/`asyncio.TimeoutError` mapped to typed `SfoxApiError(status=0, scrubbed)` (mirrors exchange.py's NetworkError arm) (commit 3dda5f00).
> - **F7** (bonus): `allow_redirects=False` on the JSON request — no silent Bearer re-send on a 3xx (commit 7cd4500f).
> F6 (short-key `.replace`) skipped: unreachable, the ctor rejects falsy keys.
> sFOX unit suite: **38 passed**.


**Reviewed:** 2026-07-18
**Depth:** deep (cross-file: sfox_client.py ↔ services/redact.py ↔ services/exchange.py aclose reference)
**Files Reviewed:** 3
**Status:** issues_found

## Summary

Phase 118 adds a read-only, non-ccxt aiohttp adapter for sFOX (`SfoxClient`) plus
offline contract tests and a founder-gated live smoke. The core wiring is sound
and the tests are genuinely adversarial (they assert the real bytes on the wire —
URL, `Authorization` header, `params`, and `proxy=` kwarg — not a self-referential
oracle, satisfying the P115 lesson). The single `_request` chokepoint threads the
explicit `proxy=` into every path, `trust_env=False` is set, non-2xx / non-JSON /
degenerate shapes all fail loud, and the rate-gate sleep is bounded (≤10s, so it
cannot wedge the worker on a single request). The live smoke has no mock and no
fallback, so it cannot fabricate a green.

Three real defects remain, none a hard crash but each with a concrete failure
scenario:

1. **Use-after-close reopens a session that can never be closed** — a guaranteed
   "Unclosed client session" leak (the exact Sentry class the aclose bound exists
   to prevent).
2. **The secret-scrub is pattern-based and does not redact the literal `api_key`
   value** — a bare/unrecognized echo of the key in an upstream error body leaks
   into `SfoxApiError`, and the scrub's fast-path returns punctuation-free bodies
   verbatim. The one scrub test uses an `api_key=<key>` body that the pattern
   happens to catch, masking the gap.
3. **`_request` accepts an arbitrary HTTP method** — the "read-only by
   construction / cannot be coerced into a write via a generic request path"
   claim in the docstring is not actually enforced at the chokepoint.

None of these block the *contract* (the sandbox smoke can still prove auth), but
#1 and #2 are money/security-adjacent and should be fixed before phases 119/120
wire real credentials and a crawl through this adapter.

## Warnings

### WR-01: Read after `aclose()` reopens a session that the next `aclose()` refuses to close (guaranteed leak)

**File:** `analytics-service/services/sfox_client.py:114-119, 265-280`
**Issue:** `_ensure_session` gates only on `self._session is None`, never on
`self._closed`. `aclose()` returns early when `self._closed` is already `True`.
So the sequence `aclose()` → any read → `aclose()` leaks a live session:

- `aclose()` sets `_closed=True`, closes the session, sets `_session=None`.
- A subsequent `get_balances()` → `_request` → `_ensure_session` sees
  `_session is None` and creates a **brand-new** `ClientSession`.
- The second `aclose()` hits `if self._closed: return` on line 273 and returns
  **without closing the new session** → "Unclosed client session" — precisely the
  Sentry failure class SFOX_CLOSE_TIMEOUT_S / the aclose bound exists to avoid.

`test_aclose_is_idempotent` only covers `ensure→close→close` and never a
read-after-close, so this is uncaught.
**Fix:** Make the closed state terminal — refuse to reopen:
```python
async def _ensure_session(self) -> aiohttp.ClientSession:
    if self._closed:
        raise RuntimeError("SfoxClient used after aclose()")
    if self._session is None:
        self._session = aiohttp.ClientSession(trust_env=False)
    return self._session
```
Add a regression test: `await client.aclose(); with pytest.raises(RuntimeError): await client.get_balances()`.

### WR-02: Secret-scrub is pattern-based only — it never redacts the literal `api_key`, so a bare echo leaks into `SfoxApiError`

**File:** `analytics-service/services/sfox_client.py:170` (and `services/redact.py:218-219` fast-path)
**Issue:** On a non-2xx the body is passed through `scrub_freeform_string(raw)`,
which redacts *recognized shapes* (`key=value` where the key is denylisted, JWTs,
`bearer <token>`). It does **not** know `self._api_key`'s value. Two concrete leak
paths survive:

- **Bare echo:** an upstream body like `{"error":"invalid credential secretkey123456"}`
  contains the raw key with no denylisted-key prefix and no JWT shape → scrub is a
  no-op → the key lands in `str(SfoxApiError)` and thence any log/Sentry surface.
- **Fast-path passthrough:** `redact.py:218-219` returns the body *verbatim* when it
  contains no `:`, `=`, or `.`. A body that is exactly the key (sFOX keys are
  typically punctuation-free alphanumerics) is returned unscrubbed.

`test_error_message_scrubs_api_key` uses `"upstream rejected api_key=<key> ..."`,
which the `api_key=` alternate catches — giving false confidence that *any* echo is
scrubbed. Given the review's explicit secret-leakage mandate, the mitigation should
not depend on the upstream echoing the key in a pattern the denylist happens to know.
**Fix:** Redact the known secret by value at the chokepoint, before/around the
freeform scrub (belt-and-suspenders):
```python
if status < 200 or status >= 300:
    safe = raw.replace(self._api_key, "[REDACTED]")
    raise SfoxApiError(status, scrub_freeform_string(safe))
```
Add a regression test with a **bare** key echo body (`resp = _stub_response(403, API_KEY)`)
asserting `API_KEY not in str(exc)` — it fails against the current code.

### WR-03: `_request` accepts an arbitrary HTTP method — read-only is not enforced at the chokepoint

**File:** `analytics-service/services/sfox_client.py:139-156`
**Issue:** The module docstring (lines 15-20) and `test_read_only_surface_no_write_methods`
assert "read-only by construction … NO order/withdraw/transfer method exists," and
line 142's docstring claims the class "cannot be coerced into a write via a generic
request path." But `_request(self, method, path, params)` forwards `method`
unchanged to `session.request(method, ...)`. A single internal call —
`await self._request("POST", "/v1/orders", {...})` — issues a live write. The
read-only guarantee is enforced only by the *absence* of public write methods
(convention), not by the one place that actually talks to the network. Since phase
119 will add call sites against this same chokepoint, the safest construction is to
make writes structurally impossible here.
**Fix:** Hardcode the verb at the chokepoint and drop the `method` parameter:
```python
async def _request(self, path: str, params: dict[str, Any] | None = None) -> Any:
    ...
    resp = await session.request("GET", url, headers=headers, params=query, proxy=self._proxy)
```
Update the four callers to drop the `"GET"` argument. Add a test asserting the
mocked request's `args[0] == "GET"` for every read method (currently only
transactions/balances/trades/history URLs are pinned, not the verb on all paths).

## Info

### IN-01: Rate gate has no mutual exclusion — concurrent calls violate the 1 req/10 s limit

**File:** `analytics-service/services/sfox_client.py:121-137`
**Issue:** `_rate_gate` reads `last`, computes `wait`, `await`s the sleep, then
records `now`. There is no lock, so two coroutines awaiting the same endpoint read
the same `last`, sleep in parallel, and fire near-simultaneously — the "strict
1 req/10 s" gate is bypassed. The docstring's "no call site can bypass it" is only
true under strictly serial use. Today the worker is sequential and the adapter is
"serial by construction," so this is latent, but the claim is undefended and phase
120's crawl orchestration is the exact place a fan-out could sneak in.
**Fix:** Either document the serial precondition as enforced by the caller, or guard
the gate + request with an `asyncio.Lock` (per-path or per-client) so the interval
holds under accidental concurrency.

### IN-02: No lower-bound validation on `limit` / `page_size`

**File:** `analytics-service/services/sfox_client.py:204-207, 221, 231-236`
**Issue:** `get_transactions` validates `limit > 1000` but not `limit <= 0`;
`get_trades` does not validate `page_size` at all. A negative or zero paging value
is sent to sFOX, wasting a rate-limited round-trip on a request the API will reject
(or, worse, silently interpret). Interval is fully validated, so this is an
asymmetry, not a systemic gap.
**Fix:** Add `if limit < 1: raise ValueError(...)` (and the analogous `page_size`
guard) alongside the existing upper-bound checks so bad paging fails before the
gated request.

### IN-03: Live smoke's `isinstance(..., list)` assertion is tautological

**File:** `analytics-service/tests/test_sfox_client_live.py:84-87, 110-114`
**Issue:** `get_balances()` / `get_balance_history()` already raise unless the
payload is a list (`sfox_client.py:182-184, 258-263`), so by the time the test
reaches `assert isinstance(balances, list)` the assertion can never fail. The
*real* SC-3 gate is "the call did not raise" (auth 200 + parseable payload), which
the assertion doesn't articulate. This is fine functionally — a 401 still fails via
the propagated `SfoxApiError` — but the assertion adds no signal beyond reaching
the line.
**Fix (optional):** Assert the meaningful invariant, e.g. that every element is a
`dict` (`assert all(isinstance(b, dict) for b in balances)`), which fails if sFOX's
real shape drifts from the contract — turning the smoke into a genuine shape probe.

---

_Reviewed: 2026-07-18_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: deep_
