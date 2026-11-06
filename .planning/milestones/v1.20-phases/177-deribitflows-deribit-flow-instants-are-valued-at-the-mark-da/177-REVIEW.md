---
phase: 177-deribitflows-deribit-flow-instants-are-valued-at-the-mark-da
round: 3
reviewed: 2026-10-28T14:42:39Z
depth: standard
diff_base: 1fca0f0aa
reviewed_head: 6c758349a589682dcd3fb730aa0e1958dec2850e
files_reviewed: 4
files_reviewed_list:
  - analytics-service/services/deribit_ingest.py
  - analytics-service/services/job_worker.py
  - analytics-service/tests/test_deribit_ingest.py
  - analytics-service/tests/test_nav_marks_compose_roundtrip.py
findings:
  critical: 0
  warning: 0
  info: 14
  total: 14
status: issues_found
---

# Phase 177: Code Review Report (round 3)

**Reviewed:** 2026-10-28T14:42:39Z
**Depth:** standard. Scope is the fix diff `1fca0f0aa..6c758349a` (`5b8dea8ff` WR-01, `6c758349a` SF-N2), plus the callee each fix touches (`resolve_moved_flow_prices`, `db_execute`, ccxt `deribit.sign` / `handle_errors`).
**Files Reviewed:** 4
**Status:** issues_found. There are no MEDIUM+ findings; only LOW/INFO items remain.

## Summary

**Both round-2 MEDIUMs are resolved. The fix diff introduces no CRITICAL, HIGH or MEDIUM defect.** The four new items (IN-12 to IN-15) are all LOW or INFO.

Evidence gathered this round:
- **Tests.** I ran 8 test files at HEAD with the main checkout's `.venv` (Python 3.12.13): `test_deribit_ingest`, `test_nav_marks_compose_roundtrip`, `test_flow_price_store`, `test_nav_marks_composite`, `test_nav_marks_composite_allocated`, `test_nav_marks_derive_apply`, `test_stitch_composite_job` and `test_nav_marks_flow_instants`. Result: **424 passed**. Round 2 had 422, and this diff adds 2 tests.
- **Types.** `mypy services/deribit_ingest.py services/job_worker.py services/deribit_flow_prices.py` reports "Success: no issues found in 3 source files".
- **Revert-proof, measured.** I mutated a scratch copy of `analytics-service/`; the worktree was not touched.
  - Mutation A deletes the new `logger.warning`. `test_minute_prices_exhausted_transient_logs_the_original_error` then goes **RED**.
  - Mutation B restores the round-2 `await (wait_for(...) if _read_venue else _resolving)`. `test_deribit_moved_flow_index_hung_store_read_below_the_floor_is_bounded` then goes **RED**: the 5 s guard fires instead of the test hanging.
  - Both tests are GREEN on the real source.

Answers to the caller's three specific questions:

1. **Does the new WARNING leak a key id or an amount? No.** The line carries `instrument` (`BTC_USDC-PERPETUAL`, a public name), `type(exc).__name__`, and `scrub_freeform_string(str(exc))`. The reader calls only `public_get_get_tradingview_chart_data`. In ccxt 4.5.85, `deribit.sign` (`ccxt/deribit.py:3800-3825`) adds the `Authorization: deri-hmac-sha256 id=<apiKey>…` header only for `api == 'private'`. A public request carries no credential, in its header or its URL. The texts ccxt can put into `str(exc)` are:
   - the response body (`handle_errors`: `self.id + ' ' + body`), or
   - for a transport fault, `method + url`, where the URL holds only `instrument_name`, `start_timestamp`, `end_timestamp` and `resolution`.

   No `api_key_id` and no flow amount can reach the line. One residual is that a transport-fault message exposes `end_timestamp`, which is the latest moved-flow minute plus 60 s. That is timing metadata, not an amount, and no key is named beside it (see IN-12).

2. **Can the 10 s `wait_for` around the store read cancel a store WRITE mid-flight, or leave a half-written state? No.**
   - The floor bound applies only when `read_venue=False`. On that path `resolve_moved_flow_prices` (`deribit_flow_prices.py:155-190`) runs exactly one store call, the read at `:158-160`. The group loop is `groups.items() if read_venue else ()`, so `write_flow_prices` (`:186-189`) is unreachable. There is no write for the bound to cancel.
   - On the `read_venue=True` path the bound is `_prefetch_bound`, which is unchanged from round 2. A cancellation there could land between per-group writes. SF-03 already made that safe: each group is written and re-selected before the next is read. `db_execute` is `loop.run_in_executor(_DB_EXECUTOR, fn)` (`services/db.py:137-166`), so cancelling the await abandons the future, never the HTTP call. A write already sent completes or fails atomically per PostgREST request.
   - The timeout itself is mapped. `asyncio.TimeoutError` is in the capture tuple (`job_worker.py:5975-5992`) and becomes `_moved_flow_price_failure = "timeout"`. The mark write that follows is untouched.
   - The bound is never negative or zero: it is either `_prefetch_bound`, which is at least the 10.0 s floor, or the floor itself.
   - The one cost is that the bound is charged against the post-crawl reserve (IN-13, LOW).

3. **Does the new `store_db_execute` keyword change other tests' behaviour? No.** It defaults to `None`, and `store_db_execute or AsyncMock(side_effect=lambda fn: fn())` (`test_nav_marks_compose_roundtrip.py:1214`) is then byte-identical to the round-2 patch. Every other caller of `derive_deribit_key` and `derive_moved_btc_without_a_stored_mark` omits it. The suite count moved 422 → 424, exactly the two new tests, with no other test changing state. The hung-store test also uses `monkeypatch.setattr` / `monkeypatch.setitem`, which restore `_MOVED_FLOW_PRICE_MIN_SECONDS` and `TIMEOUT_PER_KIND` after the test.

Severity mapping: CRITICAL/HIGH would go under Critical, and there are none. MEDIUM would go under Warnings, and there are none. LOW/INFO go under Info. Each finding is tagged user-facing, data-integrity or internal.

## Round-2 resolution

| ID | Round-2 severity | Verdict | Evidence |
|---|---|---|---|
| WR-01 (transient path drops the cause) | MEDIUM, internal | **RESOLVED** | `deribit_ingest.py:1012-1019` logs `instrument`, the exception class and the scrubbed text at WARNING, once, at budget exhaustion. The log runs after the rate-limit re-raise (so a 429/10028 still reaches `_stamp_429` unwrapped) and before `raise DeribitTransientReadError(...) from None`. All three kinds of exception in the bucket are now named: network faults, unmapped venue codes such as `13020`→`ExchangeError`, and non-ccxt bugs. The fix sits in the shared reader, so the key-mode prefetch and the composite member read are both covered. Test: `test_minute_prices_exhausted_transient_logs_the_original_error` (`test_deribit_ingest.py:2731-2744`), RED under Mutation A. The optional half of the round-2 fix (log a non-ccxt exception at ERROR so a code bug reaches Sentry) was not taken; it is carried as IN-14, LOW. |
| SF-N2 (store read unbounded below the floor) | MEDIUM, data-integrity | **RESOLVED** | `job_worker.py:5964-5973` now always wraps the call in `asyncio.wait_for`, with `timeout=_prefetch_bound if _read_venue else _MOVED_FLOW_PRICE_MIN_SECONDS`, which is 10.0 s (`:1059`). A hung store read is cut off at the floor, captured as `timeout` (`:5975-5992`), and the day's mark is still written (D-05). Test: `test_deribit_moved_flow_index_hung_store_read_below_the_floor_is_bounded` (`test_nav_marks_compose_roundtrip.py:1641-1669`). It patches the floor to 0.05 s and sets the budget equal to the reserve, so the venue is not read, and the store read awaits an `Event` that never fires. It asserts `reason=timeout`, zero chart calls, and the mark kept with nothing else written. It is RED under Mutation B. The test's `async` store stub is the right shape: a sync blocking stub could not be cancelled, which the harness docstring (`:1143-1144`) records. |

## Round-1 resolution (carried from round 2, re-confirmed at this HEAD)

| ID | Round-1 severity | Verdict | Evidence |
|---|---|---|---|
| WR-01 | MEDIUM, internal | **RESOLVED** (round 2) | The rate-limit re-raise (`deribit_ingest.py:1006-1011`) and the capture tuple (`job_worker.py:5975-5992`) are unchanged by this diff, except that the capture site moved +6 lines. |
| WR-02 | MEDIUM, user-facing | **RESOLVED** (round 2) | Still holds. Below the floor the store is read and the venue is not, and SF-N2 now also bounds that read. `test_deribit_moved_flow_index_below_the_floor_completes_from_the_store` is green at HEAD. |
| WR-03 | MEDIUM, user-facing | **RESOLVED** (round 2) | Its follow-on defect (round-2 WR-01) is resolved this round. |
| SF-03 | MEDIUM, data-integrity / availability | **RESOLVED** (round 2) | Untouched by this diff, and it is what makes a cancellation on the `read_venue=True` path safe (see answer 2). |
| SF-04 | MEDIUM, user-facing | **RESOLVED** (round 2) | Untouched by this diff. |

## Info

### IN-01 to IN-06 (carried from round 1, unchanged)

Their round-1 text still applies word for word. None changed in this diff.
- **IN-01** (LOW, data-integrity): `read_key_marks` in the prefetch sits outside the capture `try` (`job_worker.py:5917-5919`).
- **IN-02** (LOW, user-facing): resolved by measurement; no code change.
- **IN-03** (LOW, user-facing): a currency with no USDC perpetual refuses on every derive.
- **IN-04** (LOW, internal): the composite price read is still bounded by the fixed `_BROKER_CRAWL_TIMEOUT_S`. It is now at `job_worker.py:10553-10558`; it was `:10546-10552` before the +6 shift.
- **IN-05** (INFO, internal): `_deribit_moved_flow_gate` returns `str | DispatchResult | None` (`job_worker.py:632-677`).
- **IN-06** (INFO, internal): `moved_flow_counts` infers "priced at instant" from `amount_prior_day is not None`.

### IN-07: The DDoSProtection tests inject a hand-built exception; nothing pins the real ccxt mapping of code 10028 (LOW, internal) (carried from round 2, unchanged)

**File:** `analytics-service/tests/test_deribit_ingest.py:2703`, `tests/test_nav_marks_compose_roundtrip.py:1713`, `tests/test_nav_marks_composite.py:932`
**Issue:** All three DDoSProtection tests construct `ccxt.DDoSProtection(...)` directly, so a ccxt upgrade that remaps `10028` would go unnoticed. The mapping was measured in round 2 (`10028 -> DDoSProtection`, ccxt 4.5.85).
**Fix:** Add one test that drives `deribit.handle_errors(429, …, {"error": {"code": 10028}}, …)` and asserts that the raised class is in the reader's re-raise tuple.

### IN-08: Stale docstrings after the WR-03 reclassification (INFO, internal) (carried from round 2, unchanged)

**File:** `analytics-service/tests/test_nav_marks_compose_roundtrip.py:1617-1618` and `:1981`; `_ScriptedChart` (`:1108`); `analytics-service/services/deribit_flow_prices.py:143`
**Issue:** The test docstrings still say an over-run `AssertionError` becomes a structural no-data answer. It is now a transient read. `_ScriptedChart` promises a loud failure that the reader absorbs, though the new WR-01 WARNING now at least names the `AssertionError` in the log. The `resolve_moved_flow_prices` docstring names only `RateLimitExceeded` and omits `DDoSProtection`.
**Fix:** Correct the three docstrings. For a truly loud over-run, have `_ScriptedChart` raise a `BaseException` subclass.

### IN-09: The below-floor warning claims a timeout even when the store covers every price and the derive completes DONE (INFO, internal) (carried from round 2, unchanged)

**File:** `analytics-service/services/job_worker.py:5945-5951`
**Issue:** The line "moved-flow price read not started (reason=timeout …)" is logged before the store read runs. Since SF-N2 that store read does start, under the floor's bound. So on a derive that succeeds from the store, the line is wrong twice: no timeout occurred, and a read did start.
**Fix:** Word the line "venue read skipped (budget below floor)", or log it only when a wanted key is left missing.

### IN-10: A derive that always leaves less than the floor never reads a NEW moved-flow price (LOW, user-facing, residual of WR-02) (carried from round 2, unchanged)

**File:** `analytics-service/services/job_worker.py:5933-5944`
**Issue:** A moved flow whose price is not yet stored is read only by a derive that has at least `_MOVED_FLOW_PRICE_MIN_SECONDS` left after the crawl and the reserve. A key whose crawl reliably uses more than about 800 s retries `timeout` on every derive.
**Fix:** Accept it and book it, or let a low-cost job fill the store for such keys.

### IN-11: The ccxt member arm still says it mirrors the Deribit arm "EXACTLY", which is no longer true (INFO, internal) (carried from round 2, unchanged)

**File:** `analytics-service/services/job_worker.py:11198-11200` (ccxt arm) vs `:11315` (Deribit arm). Round 2 cited `:11192` / `:11309`; both moved +6.
**Issue:** The Deribit member arm stamps `DDoSProtection` too, and the ccxt member arm catches only `RateLimitExceeded`. The comment states something false.
**Fix:** Correct the comment, or book widening the ccxt arm as a separate item.

### IN-12: On a transport fault, the new WARNING's scrubbed `str(exc)` carries the request URL, which includes the moved flow's minute (INFO, internal) — new, from `5b8dea8ff`

**File:** `analytics-service/services/deribit_ingest.py:1012-1019`
**Issue:** For a `NetworkError` or `RequestTimeout`, ccxt's message holds `GET https://…/public/get_tradingview_chart_data?instrument_name=…&start_timestamp=…&end_timestamp=…`. `end_timestamp` is the latest moved-flow instant of the group plus 60 s, so the log reveals when a deposit or withdrawal happened, to the minute. It does not reveal the amount, the key, or a credential: the public request is unsigned (`ccxt/deribit.py:3802-3804`). The structural branch already logged scrubbed ccxt text before this phase, and the line names no key. Recorded for completeness only; no action is required.
**Fix:** None needed. To drop it anyway, log `type(exc).__name__` plus the first line of the body for `ccxt.ExchangeError`, and the class name alone for `ccxt.NetworkError`.

### IN-13: Below the floor, the store read's 10 s bound is charged to the post-crawl reserve, which was not sized for it (LOW, data-integrity) — new, from `6c758349a`

**File:** `analytics-service/services/job_worker.py:5964-5973`; reserve at `:466-468`; floor at `:1059`
**Issue:** The fix runs the store read whenever `_prefetch_bound < 10`, which includes the case where `_prefetch_remaining` is already negative (the crawl has eaten into the 90 s reserve). The reserve's own comment (`:466-467`) sizes it for "combine + derive_basis_series + persist (+ the preflight)" and does not include this read. The worst case is narrow: the store read hangs for the full 10 s, and the crawl left between 80 s and 90 s of the outer budget's reserve unspent. In that case the read can consume the last 10 s the mark write had, and the outer `wait_for` fires before the mark is written. Before WR-02 this path read nothing.

This is LOW, not MEDIUM, for two reasons:
- A store read that hangs for 10 s means PostgREST is degraded, so the mark write, which also goes through PostgREST, is unlikely to land in that window either.
- The normal store read is sub-second.

**Fix (optional):** Clamp the bound to what the outer budget can spare, for example `timeout=min(_MOVED_FLOW_PRICE_MIN_SECONDS, max(1.0, _prefetch_remaining + _DERIVE_POST_CRAWL_RESERVE_S / 2))`. Alternatively, accept the edge and record it in the reserve comment.

### IN-14: A non-ccxt exception (a bug in our own code) in the transient bucket is still only a WARNING, which the default Sentry `LoggingIntegration` keeps as a breadcrumb, not an event (LOW, internal) — residual of round-2 WR-01

**File:** `analytics-service/services/deribit_ingest.py:997-1019`
**Issue:** Round-2 WR-01's core fix (name the cause) is done. Its optional half was not taken. A `TypeError` or `AttributeError` in our own code is retried, wrapped as `DeribitTransientReadError`, and logged at WARNING only. The derive stays transient on every run, and no Sentry event fires: per the house comment at `routers/cron.py:3211`, only `logger.error` is a Sentry event. The cause is now readable in the logs, so this no longer fails silent. It fails quietly.
**Fix:** In the exhaustion branch, log at `logger.error` when `not isinstance(exc, ccxt.BaseError)`, and keep WARNING for ccxt classes.

### IN-15: The floor constant's comment still says the read "is not started" below the floor (INFO, internal) — new, from `6c758349a`

**File:** `analytics-service/services/job_worker.py:1053-1058`
**Issue:** It says "Below this floor the read is not started: it could not finish one attempt." Since WR-02 and SF-N2, the store read does start below the floor, and the floor is also its time bound. Only the venue read is skipped. The constant now has two roles, and the comment documents one of them.
**Fix:** Reword: "Below this floor the VENUE read is not started; the store read still runs and this floor is its bound (SF-N2)."

_Count note: IN-02 is resolved by measurement and is not counted. Counted: 10 carried (IN-01, IN-03 to IN-11) + 4 new (IN-12 to IN-15) = `info: 14`._

---

_Reviewed: 2026-10-28T14:42:39Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
