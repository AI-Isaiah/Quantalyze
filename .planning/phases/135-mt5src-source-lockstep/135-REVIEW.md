---
phase: 135-mt5src-source-lockstep
reviewed: 2026-07-23T18:04:00Z
depth: standard
files_reviewed: 6
files_reviewed_list:
  - analytics-service/routers/exchange.py
  - analytics-service/services/ingestion/mt5.py
  - analytics-service/services/mt5_validation.py
  - src/lib/wizardErrors.ts
  - src/app/api/keys/validate-and-encrypt/route.ts
  - supabase/migrations/20260723172032_mt5_exchange_boundary_checks.sql
findings:
  critical: 0
  warning: 3
  info: 1
  total: 4
status: issues_found
fix_status: WR-01 fixed (7c5ffd4c); WR-02 fixed (db4c9426); WR-03 deferred-to-139; IN-01 skipped
---

# Phase 135: Code Review Report

**Reviewed:** 2026-07-23T18:04:00Z
**Depth:** standard
**Files Reviewed:** 6
**Status:** issues_found

## Summary

Phase 135 makes `'mt5'` a first-class key source, shipped dark behind `MT5_ENABLED`.
I reviewed the FastAPI validate/encrypt router branch, the `Mt5Adapter`, the
`mt5_validation` seam, the TS wizard-error classifier, the Next.js
validate-and-encrypt route, and the boundary-CHECK migration. I also read the
out-of-scope-but-load-bearing `services/closed_sets.py` and `services/mt5_client.py`
to verify the substring contract and secret hygiene.

The core security properties hold and are genuinely well-built:

- **Secret hygiene verified.** No path in `_validate_mt5_key` logs or returns
  login/investor-password/broker-server. The `int(raw_login)` `ValueError` is
  swallowed into a curated `AUTH_FAILED_DETAIL`; `Mt5ClientError` is scrubbed +
  value-redacted at construction (`mt5_client.login`), and the router logs only
  the scrubbed `e.code`, never `str(e)`. All HTTP details are curated constants.
- **Read-only integrity holds.** `order_send` is never wrapped; only `order_check`
  (a read-only margin probe) is called. A trade-capable (master) login is rejected
  with a distinct 400 and never reaches `/encrypt-key` (validateKey throws → the TS
  legacy handler skips `encryptKey`), so a rejected key is never persisted.
- **Three failure paths are byte-aligned.** `MT5_MASTER_PASSWORD_DETAIL`
  ("…master password detected… can place trades…") and `MT5_WRONG_SERVER_DETAIL`
  ("Broker server not found…") route to `KEY_MT5_MASTER_PASSWORD` / `KEY_MT5_WRONG_SERVER`
  via the substring matcher, ordered after `KEY_AUTH_FAILED`. I re-ran the collision
  check against every branch token: neither string contains `signature`,
  `authentication failed`, `invalid_credentials`, `ip`+`allow`, `rate`, `429`,
  `timeout`, `could not verify`, `permission scope`, `probe`, `trading`, or `withdraw`
  ("can place trades" does not contain the substring `trading`). No shadowing.
- **Migration is a faithful widen.** All four CHECKs get a superset (adds `'mt5'`,
  drops nothing listed), the nullable `IS NULL OR` form is preserved on
  `compute_jobs`, self-verify DO blocks fail loud, and forward-only is acceptable.
- **fail-loud holds.** `Mt5Adapter.compute_metrics` and `fetch_raw` both raise
  `NotImplementedError` — no silent empty snapshot (BYB-02 class avoided).
- **Go-dark gates fire.** Both `mt5_enabled_server()` (router) and
  `isMt5EnabledServer()` (TS route) reject before any client construction / probe.

The findings below are divergences and a deferred-risk tracker, not correctness
failures in the dark-launched path. No BLOCKERs.

## Warnings

### WR-01: The "one seam" MT5 validate is re-implemented twice with divergent guards and ordering — FIXED (commit 7c5ffd4c)

**Status:** FIXED. Hoisted the pre-probe validation into `parse_mt5_credentials()`/
`Mt5ValidationError` in `services/mt5_validation.py`; both `_validate_mt5_key`
(router) and `Mt5Adapter.validate` now defer to it, using the router's canonical
server->login->password ordering. Regression: `tests/test_mt5_validate_parity.py`
(doubly-blank + blank-password classify identically on both paths; failed pre-fix).


**File:** `analytics-service/services/ingestion/mt5.py:96-152` and `analytics-service/routers/exchange.py:141-277`
**Issue:** `mt5_validation.py` bills itself as "the ONE seam holding every
investor-vs-master rule + login-error classification," but the pre-probe request
validation is hand-implemented independently in the router (`_validate_mt5_key`)
and the adapter (`Mt5Adapter.validate`), and the two disagree:

1. **Missing blank-password guard in the adapter.** The router rejects a blank
   investor password up front (`exchange.py:203-205`, `if not investor_pw.strip()`).
   The adapter has no such guard — it reads `investor_pw = str(...or "")` and proceeds
   straight to `client.login(login, "", server)`, burning a live RPyC probe on a
   request the router would have rejected offline. Both ultimately fail closed
   (the empty-password login returns falsy → `Mt5ClientError` → `auth`), but the
   adapter takes a network round-trip to get there.
2. **Divergent check ordering → different error classification for the same input.**
   Router order is server → login → password; adapter order is login → server.
   A request that is blank in BOTH login and server classifies as
   `MT5_WRONG_SERVER` via the router but `AUTH_FAILED` via the adapter. Same bad
   input, two different "distinguishable failure paths" — the exact drift the
   single-seam module exists to prevent.

The TS route requires all three slots non-blank before calling, so real users are
shielded today; this bites any direct/worker caller of the adapter path.
**Fix:** Hoist the pre-probe request validation (server-required, login numeric,
password non-blank, and the fixed ordering) into a single helper in
`services/mt5_validation.py` and call it from BOTH `_validate_mt5_key` and
`Mt5Adapter.validate`, so the guard set and ordering cannot drift. Example seam:
```python
# mt5_validation.py
def parse_mt5_credentials(api_key, api_secret, passphrase) -> tuple[int, str, str]:
    """Fail-closed offline parse. Raises Mt5ValidationError(kind) for
    auth/wrong_server so both call sites classify identically."""
    ...
```

### WR-02: Adapter validate lacks the outer `wait_for` ceiling the router has (WEDGE-01 defense-in-depth gap) — FIXED (commit db4c9426)

**Status:** FIXED. Wrapped the adapter probe in `asyncio.wait_for(..., timeout=
_MT5_PROBE_TIMEOUT_S)` reusing `mt5_client.MT5_REQUEST_TIMEOUT_S` (no new magic
number); a timeout takes the adapter's transient disposition (propagate untouched,
close() still runs). Regression:
`test_validate_probe_hang_bounded_by_wait_for_ceiling` (failed pre-fix — no ceiling).


**File:** `analytics-service/services/ingestion/mt5.py:142-143`
**Issue:** The router bounds the off-loop probe with an explicit last-resort ceiling —
`await asyncio.wait_for(asyncio.to_thread(_probe), timeout=_MT5_PROBE_TIMEOUT_S)` plus
a `TimeoutError` → `NETWORK_ERROR_DETAIL` arm (`exchange.py:235-244`). The adapter runs
`info, probe = await asyncio.to_thread(_probe)` with NO `wait_for`. `to_thread` does
keep the event loop free, so healthz is not wedged, and the inner rpyc
`sync_request_timeout` (30s) normally bounds the round-trip — but if a hang occurs
outside a round-trip (e.g. netref materialization) the awaiting coroutine has no ceiling,
so the sequential worker job can stall unbounded. Given how obsessively the rest of the
codebase guards against the v1.11 WEDGE-01 class, the two paths should not diverge here.
This is latent (the adapter path is not wired into a live flow until Phase 138/139) but
should be closed before go-live.
**Fix:** Wrap the adapter probe with the same ceiling the router uses:
```python
info, probe = await asyncio.wait_for(
    asyncio.to_thread(_probe), timeout=MT5_REQUEST_TIMEOUT_S + 5.0
)
```
and handle `asyncio.TimeoutError` as a transient (propagate/`_wrong_server`-free), so the
worker never awaits a hung thread without a ceiling.

### WR-03: Master-password rejection rests on an unverified `[ASSUMED]` retcode; a false negative persists a trade-capable credential — DEFERRED to Phase 139 go-live gate

**Status:** DEFERRED (not touched). The 10009 retcode is `[ASSUMED]` pending the
Phase-134 human_needed live spike (MT5SPIKE-01 leg 2); this is correctly a hard
Phase-139 go-live gate, not a dark-ship blocker. `is_trade_capable`/retcode logic
left unchanged.


**File:** `analytics-service/services/mt5_validation.py:32,72-88`
**Issue:** For MT5 the read-only property is NOT purely structural at the credential
level — investor vs master is a runtime distinction, and the ONLY thing preventing a
trade-capable credential from being stored is `is_trade_capable()` returning `True`.
That function is fail-OPEN (defaults to "investor/read-only") and one of its two signals,
`retcode == _TRADE_RETCODE_DONE` (`10009`), is explicitly `[ASSUMED]` pending
MT5SPIKE-01 leg 2. If the live investor-vs-master retcode/`trade_allowed` signal differs
from the assumption, a master login can slip through as read-only and its master password
gets encrypted and stored — the worst-case outcome for the whole `api_verified` trust story.
The dual-signal design (`trade_allowed` OR retcode) and the dark launch (`MT5_ENABLED` off)
mitigate this today, and it is a documented, accepted deferral — this finding exists to pin
it as a hard go-live gate, not to block the dark ship.
**Fix:** Before flipping `MT5_ENABLED=true` (Phase 139), confirm against a live terminal
that (a) a real investor login yields `trade_allowed=false` AND a non-`10009` `order_check`
retcode, and (b) a real master login trips at least one signal. Encode both as regression
fixtures. Consider making the master-detection fail-CLOSED (reject on an *unrecognized*
`order_check` retcode rather than only on `10009`) so an unexpected signal errs toward
rejecting, not storing, the credential.

## Info

### IN-01: Migration refreshes the vocabulary COMMENT on only one of the four widened columns — SKIPPED (cosmetic)

**Status:** SKIPPED. Cosmetic migration COMMENT drift, no behavioral effect; not
fixed this pass.


**File:** `supabase/migrations/20260723172032_mt5_exchange_boundary_checks.sql:202-204`
**Issue:** Only `strategy_verifications.source` gets a refreshed `COMMENT ON COLUMN`
mentioning `'mt5'`. The other three widened columns (`api_keys.exchange`,
`compute_jobs.exchange`, `strategies.source`) keep pre-mt5 vocabulary comments, so their
docs now understate the admitted set. Cosmetic only — no behavioral effect.
**Fix:** Add matching `COMMENT ON COLUMN … IS '…mt5…'` refreshes for the other three
widened columns (or accept the drift explicitly if the precedent migrations also comment
only the one column).

---

_Reviewed: 2026-07-23T18:04:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
