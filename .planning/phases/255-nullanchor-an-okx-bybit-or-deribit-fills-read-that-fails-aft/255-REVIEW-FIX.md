---
phase: 255-nullanchor-an-okx-bybit-or-deribit-fills-read-that-fails-aft
fixed_at: 2026-11-27T12:00:00Z
review_path: .planning/phases/255-nullanchor-an-okx-bybit-or-deribit-fills-read-that-fails-aft/255-REVIEW.md
iteration: 1
findings_in_scope: 3
fixed: 3
skipped: 0
status: all_fixed
---

# Phase 255: Code Review Fix Report

**Fixed at:** 2026-11-27
**Source review:** 255-REVIEW.md (WR-01, WR-02, IN-05 promoted to MEDIUM as SFH-M1)
**Iteration:** 1
**Verification ran in:** the isolated worktree `quantalyze-wt-255` (branch `gsd/phase-255-nullanchor`), not the main checkout. pytest was run from `analytics-service/`.

**Summary:**
- Findings in scope: 3 (SFH-M1 = IN-05, WR-01, WR-02)
- Fixed: 3
- Skipped: 0
- LOW and INFO findings (IN-01 to IN-04, IN-06 to IN-08) were not touched, by rule.

Gates after the three commits (verbatim):
- mypy strict, CI command: `Success: no issues found in 146 source files` (local binary 2.0.0, CI pins 2.4.0, so CI is binding).
- The quick suite plus the other suites that drive `run_sync_trades_job` or the venue readers (`test_nullanchor_bound.py`, `test_binancefills_cursor.py`, `test_okxtrades_cursor.py`, `test_exchange.py`, `test_job_worker.py`, `test_sync_trades_resume_seed.py`, `test_sync_trades_store_truth.py`, `test_ana_recon_audit.py`): `598 passed, 1 skipped, 14 warnings in 82.71s (0:01:22)`.
- Baseline before any edit, the four-file quick suite: `384 passed`.

## Fixed Issues

### SFH-M1 (= IN-05): an OKX stuck-cursor stop on a full page cleared the bound

**Severity:** MEDIUM, data-integrity. **Status:** fixed: requires human verification (logic change in a venue reader).
**Files modified:** `analytics-service/services/exchange.py`, `analytics-service/tests/test_nullanchor_bound.py`
**Commit:** `e7aaa4280`
**Applied fix:** in `_fetch_raw_trades_okx_inst_type`, the two stuck arms on a full page (`if not new_cursor:` and `if prev_cursor and new_cursor == prev_cursor:`) now set `natural_break = False` (a comment says why). The reader then returns `hit_page_cap` True, the existing `_fetch_raw_trades_okx` cap path records `sync_truncated_okx`, and the worker's off-Binance `_earliest_through()` keeps the bound and `_fills_incomplete` holds the cursor. No new flag, no new abstraction.

**Tests** (new class `TestOkxStuckCursorKeepsTheBound` in `tests/test_nullanchor_bound.py`):
- `test_a_stuck_full_page_records_sync_truncated_okx[missing]` and `[repeated]`: the real `_fetch_raw_trades_okx` over a fake `private_get_trade_fills_history` (a full page ending on an empty tradeId, or a second full page ending on page 1's cursor) records `sync_truncated_okx`.
- `test_the_workers_epilogue_keeps_the_bound_and_holds_the_cursor[missing]` and `[repeated]`: the REAL reader's fills and drained DQ flags feed the real `run_sync_trades_job` through `_run_job`; the bound row is kept (`bounds.rows != {}`) and `advance_sync_cursor` carries `p_last_fetched_ts` None.

**RED/GREEN proof (verbatim).** Byte backup of the fixed file outside the repo, neuter = both `natural_break = False` set back to `True`, restore with `cp`, `cmp`:

```
--- neuter diff vs fixed
3208c3208
<                 natural_break = False
---
>                 natural_break = True
3215c3215
<                 natural_break = False
---
>                 natural_break = True
FAILED tests/test_nullanchor_bound.py::TestOkxStuckCursorKeepsTheBound::test_a_stuck_full_page_records_sync_truncated_okx[missing]
FAILED tests/test_nullanchor_bound.py::TestOkxStuckCursorKeepsTheBound::test_a_stuck_full_page_records_sync_truncated_okx[repeated]
FAILED tests/test_nullanchor_bound.py::TestOkxStuckCursorKeepsTheBound::test_the_workers_epilogue_keeps_the_bound_and_holds_the_cursor[missing]
FAILED tests/test_nullanchor_bound.py::TestOkxStuckCursorKeepsTheBound::test_the_workers_epilogue_keeps_the_bound_and_holds_the_cursor[repeated]
4 failed, 71 deselected in 53.97s
restore cmp exit=0
4 passed, 71 deselected in 57.20s
```

**Known limit.** `_fetch_raw_trades_okx` records `sync_truncated_okx_pages` as 100 per capped instType and logs "pagination hit page cap"; for a stuck stop that is a round number, not the real page count. Cosmetic, left as is (minimal fix).

### WR-01: a Bybit fills read longer than the 900 s handler limit was cancelled before the epilogue

**Severity:** MEDIUM, user-facing. **Status:** fixed: requires human verification (a new refusal path).
**Files modified:** `analytics-service/services/exchange.py`, `analytics-service/tests/test_nullanchor_bound.py`
**Commit:** `7927e48a2`
**Applied fix:**
- `BybitTradeWindowIncomplete` gets a new closed reason `"deadline"` (Literal, `_TEXTS` entry with static text "Bybit trade read refused: the read budget passed before the walk finished", docstring).
- `_fetch_raw_trades_bybit` takes `read_deadline_s: float | None = None` (opt-in; None means no deadline, so `services/ingestion/bybit.py` and `BybitAdapter.fetch_raw` are unchanged). It computes `deadline = _monotonic() + read_deadline_s` at entry and, before EVERY request in `_fetch_page`, raises `BybitTradeWindowIncomplete("deadline")` once `_monotonic() >= deadline`.
- `fetch_raw_trades` now passes the `read_deadline_s` it already received (840 s from `run_sync_trades_job`) to the Bybit branch; its docstring no longer says the other venues ignore it (OKX and Deribit still do).
- The run therefore reaches the epilogue: the Phase 2 `except Exception` arm sets `phase2_failed`, the provisional bound is kept, `phase2_fill_ingestion_failed` is stamped, `advance_sync_cursor` runs with the fills cursor held, and the job completes.

**Tests** (new class `TestBybitReadDeadline` in `tests/test_nullanchor_bound.py`; a fake clock via the existing `ex._monotonic` seam, each fake request costs 400 s, the budget is 840 s, so the read makes exactly 3 requests then refuses):
- `test_a_read_past_the_deadline_refuses_by_name`: the real `fetch_raw_trades` over 30 days (five windows) raises `BybitTradeWindowIncomplete` with `reason == "deadline"` after 3 requests.
- `test_the_worker_keeps_the_bound_and_stamps_phase2_failed`: that real refusal feeds the real `run_sync_trades_job`; `phase2_fill_ingestion_failed` is True, `phase2_error` names the read budget, `bounds.rows != {}`, `p_last_fetched_ts` is None, and `fetch_raw` was called with `read_deadline_s == BINANCE_SYNC_FILLS_READ_DEADLINE_S`.
- `test_no_deadline_reads_the_whole_span`: a pin that the reader's deadline is opt-in (GREEN before and after, by design).

**RED/GREEN proof (verbatim).** Neuter = the Bybit branch of `fetch_raw_trades` stops passing `read_deadline_s` (the pre-fix behaviour):

```
--- neuter diff vs fixed
2591,2593c2591
<             fills = await _fetch_raw_trades_bybit(
<                 exchange, effective_since, read_deadline_s=read_deadline_s
<             )
---
>             fills = await _fetch_raw_trades_bybit(exchange, effective_since)
FAILED tests/test_nullanchor_bound.py::TestBybitReadDeadline::test_a_read_past_the_deadline_refuses_by_name
FAILED tests/test_nullanchor_bound.py::TestBybitReadDeadline::test_the_worker_keeps_the_bound_and_stamps_phase2_failed
2 failed, 1 passed, 75 deselected in 27.84s
restore cmp exit=0
3 passed, 75 deselected in 28.00s
```

**Residual, stated plainly (the phase agent books it).** This fix makes the failure VISIBLE and the run COMPLETE; it does not make progress. The span still re-reads from the same seed every run: the provisional bound pins the seed, a deadline refusal writes `walk_start - 1` back as the bound, and the next run's walk is the same span plus the elapsed time, so a Bybit key whose span cannot be read inside 840 s hits the deadline on every run. What changed is that each run now stamps `phase2_fill_ingestion_failed` and holds the cursor instead of being cancelled silently (whether the derive follow-on is enqueued on a Phase 2 failure was not re-measured here). No partial read-through mechanism was built, by instruction. The Binance way (stop at a completed window, record a read-through instant) remains the root fix if the founder wants progress.

Two side effects to know:
- `run_reconcile_strategy_job` calls `fetch_raw_trades` with its default `read_deadline_s` (240 s, the Binance default), so a Bybit reconcile read past 240 s now refuses with the `"deadline"` reason instead of being cancelled by that handler's 300 s timeout. Both fail the reconcile; the failure is now named.
- `classify_exception` does not list `"deadline"`, so it falls to `unknown` (retried), which fits a latency refusal. Not pinned by a test.

### WR-02: after a failed OKX first sync, run 2 sent a `begin` beyond fills-history's documented 3-month reach

**Severity:** MEDIUM, user-facing if assumption A1 is false. **Status:** fixed: requires human verification.
**Files modified:** `analytics-service/services/exchange.py`, `analytics-service/tests/test_nullanchor_bound.py`, `analytics-service/tests/test_exchange.py`
**Commit:** `bf1ed172f`

**Venue docs (founder rule).** OKX API v5, `GET /api/v5/trade/fills-history`, section "GET / Transaction details (last 3 months)", fetched and read 2026-11-27 from `https://www.okx.com/docs-v5/en/#order-book-trading-trade-get-transaction-details-last-3-months` (the RESEARCH note that the page was unreachable is superseded; it was readable from the raw HTML). The section states only: "This endpoint can retrieve data from the last 3 months." `begin` is documented as "Filter with a begin timestamp ts. Unix timestamp format in milliseconds"; `after` as "Pagination of data to return records earlier than the requested billId". Nothing says an older `begin` is accepted, ignored or rejected, so assumption A1 stays undocumented and the clamp applies. (Bybit was not consulted for this finding: the fix is OKX-only. For WR-01 the fix uses no Bybit venue semantics, only the existing walk.)

**Applied fix:** new constant `OKX_FILLS_BEGIN_FLOOR_DAYS: int = 89` beside `OKX_FILLS_REACH_DAYS`, with a comment citing the doc section. `_fetch_raw_trades_okx` clamps the sent `begin` once, before the instType loop: `since_ms = max(since_ms, _now_ms() - OKX_FILLS_BEGIN_FLOOR_DAYS * 86_400_000)` when `since_ms is not None`. 89 days is inside the shortest three calendar months (28 + 31 + 30), so the sent `begin` is inside the documented reach on every date. The 93-day anchor and the worker are unchanged. No `since_ms` still sends no `begin` (the first-sync path, as before).

**Worker invariants checked, no `job_worker.py` change needed.** The worker's `_walk_start_ms` is `seed - OVERLAP_WINDOW_MS` (or the 93-day anchor) and `_covers_from_iso` is `-infinity` when `_walk_start_ms <= _reach_anchor_ms`; both are computed from the seed, not from what the reader sends, and `fetch_raw_trades` is doubled in the matrix, so `test_first_sync_run2_walks_from_the_reach_anchor[okx-first-*]` still pins the same value and needed no new expectation. The provisional bound stays at or before the walk's start.

**Tests:**
- New class `TestOkxBeginStaysInsideTheDocumentedReach` in `tests/test_nullanchor_bound.py`: `test_a_retry_seeded_from_a_93_day_bound_sends_the_clamped_begin` (the real `fetch_raw_trades` seeded with the OKX reach anchor sends one distinct `begin`, the 89-day floor, on every page request), plus pins that a `begin` inside the reach is unchanged (`test_a_begin_inside_the_reach_is_sent_as_it_is`), that no seed sends no `begin` (`test_no_seed_sends_no_begin`) and that the hand-typed floor equals its ISO (`test_the_hand_typed_floor_matches_its_iso`).
- Two older intent arms in `tests/test_exchange.py` used 2023 timestamps (older than 89 days) and asserted the unclamped `begin`: `TestFetchRawTrades::test_fetch_raw_trades_overlap_window` and `TestG12BOkxCursorAndBegin::test_okx_begin_sent_on_every_page`. They now seed 30 days back (`int(time.time() * 1000) - 30 * 86_400_000`) with a dated 2026-11-27 note; their assertions are byte-for-byte unchanged (exact `begin == since - 3_600_000` on every page), so nothing was weakened. `import time` was added to the module.

**RED/GREEN proof (verbatim).** Neuter = the clamp becomes `since_ms = max(since_ms, 0)`:

```
--- neuter diff vs fixed
3264c3264
<         since_ms = max(since_ms, _now_ms() - OKX_FILLS_BEGIN_FLOOR_DAYS * 86_400_000)
---
>         since_ms = max(since_ms, 0)
FAILED tests/test_nullanchor_bound.py::TestOkxBeginStaysInsideTheDocumentedReach::test_a_retry_seeded_from_a_93_day_bound_sends_the_clamped_begin
1 failed, 5 passed, 297 deselected in 52.20s
restore cmp exit=0
6 passed, 297 deselected in 49.06s
```

(The two re-based `test_exchange.py` arms stay GREEN under the neuter, as they should: they pin the overlap and begin-on-every-page intent, not the clamp. Before the re-base they were the two failures the clamp caused: `2 failed, 389 passed`.)

**Residual limit.** The clamp is a floor of the seed, so when a seed is older than 89 days the read starts at 89 days. If OKX in fact serves up to 92 days (a longer three-calendar-month window), up to 3 days of fills at the far edge are not requested on such a retry. The venue's exact rule is undocumented, so this is the price of never sending an out-of-reach `begin`; a wider floor would reintroduce the unknown.

## Skipped Issues

None.

## Observations for the phase agent (not fixed, outside the three findings)

- The OKX docs name the `after` parameter as paging "earlier than the requested billId", while `_fetch_raw_trades_okx_inst_type` sends `after=<tradeId>` (the last row's `tradeId`). Not verified against the venue here and not touched; it is the same pagination seam the SFH-M1 stuck-cursor stop depends on, so it may be worth one read-only probe.
- Bybit WR-01 residual (same seed re-read every run) is stated above and needs booking, as instructed.

## Round 2

**Fixed at:** 2026-11-27
**Source review:** 255-REVIEW-R2.md (R2-CR-01, R2-WR-01, R2-WR-02 part b)
**Iteration:** 2
**Verification ran in:** the isolated worktree `quantalyze-wt-255` (branch `gsd/phase-255-nullanchor`), not the main checkout. pytest was run from `analytics-service/`.

**Summary:** 3 findings in scope, 3 fixed, 0 skipped. R2-WR-02 part (a), booking the no-progress re-read, is the phase agent's job and was not touched (TODOS.md is out of bounds for this round).

Gates after the three commits (verbatim):
- mypy strict, CI command: `Success: no issues found in 146 source files` (local binary 2.0.0, CI pins 2.4.0, so CI is binding).
- `tests/test_nullanchor_bound.py tests/test_binancefills_cursor.py tests/test_okxtrades_cursor.py tests/test_exchange.py tests/test_job_worker.py tests/test_sync_trades_resume_seed.py tests/test_sync_trades_store_truth.py tests/test_ana_recon_audit.py tests/test_binancefills_e2e.py tests/test_binancefills_walk.py`: `653 passed, 1 skipped, 14 warnings in 91.56s (0:01:31)`.

### R2-CR-01: the OKX fills pager's `after` cursor is a billId

**Severity:** HIGH, data-integrity, pre-existing (audit H-0665). **Status:** fixed: requires human verification (a venue-semantics change in a reader).
**Files modified:** `analytics-service/services/exchange.py`, `analytics-service/tests/test_exchange.py`, `analytics-service/tests/test_nullanchor_bound.py`
**Commit:** `0896c039d`

**Venue docs (founder rule), CONFIRMED.** The official OKX v5 page `https://www.okx.com/docs-v5/en/` was fetched and read on 2026-11-27 (raw HTML, text-extracted). Both `GET /api/v5/trade/fills` ("Transaction details (last 3 days)") and `GET /api/v5/trade/fills-history` ("Transaction details (last 3 months)", anchor `#order-book-trading-trade-get-transaction-details-last-3-months`) carry, verbatim: `after | String | No | Pagination of data to return records earlier than the requested billId` and `before | String | No | Pagination of data to return records newer than the requested billId`. The response table lists `tradeId` ("Last trade ID") and `billId` ("Bill ID") as separate fields, so a fills row carries both. `begin`/`end` filter on `ts`, `limit` max 100. ccxt 4.5.64 `okx.fetch_my_trades` (the same endpoint) carries the request template `'after': billId, 'before': billId` and its sample row shows `billId: "317321390265368576"` (18 digits) beside `tradeId: "107601752"` (9 digits). Two independent sources agree; nothing in either says a tradeId is accepted as `after`.

**Applied fix:** in `_fetch_raw_trades_okx_inst_type`, `new_cursor = data[-1].get("billId", "")` (was `tradeId`). The cursor is the last (oldest) row's `billId`; the round-1 stuck-cursor arms (empty cursor, repeated cursor on a full page) now operate on that billId unchanged, and `exchange_fill_id` stays the `tradeId` (the stored dedup key does not move). A row with no `billId` on a full page reads as a stuck cursor and is recorded `sync_truncated_okx`, which fails safe (it re-reads, never skips); there is deliberately NO fallback to `tradeId`, since that would silently re-open the defect.

**Tests:**
- New `TestOkxPagerCursorIsABillId` in `tests/test_nullanchor_bound.py`: a fake `fills-history` serving 250 SWAP fills newest first with distinct 18-digit billIds and 9-digit tradeIds, honouring `after` ONLY as "billId < after" (so a tradeId cursor gets an empty page 2, which reads as a natural end). The real `_fetch_raw_trades_okx` must return all 250, record no `sync_truncated_okx`, and keep `exchange_fill_id` equal to the tradeId set.
- The SFH-M1 fixtures (`_okx_full_page`) now vary the `billId` (the cursor) and keep every tradeId distinct, so the repeated-cursor arm tests what it names. Under the old code they passed only by accident (rows had no billId).
- Existing `tests/test_exchange.py` fixtures re-based to carry `billId` and assert `after == "bill-99"`, `"bill-199"`, `"bill-299"` (`test_okx_pagination_uses_after_cursor`, `test_okx_pagination_walks_after_cursor_across_multiple_pages`), an empty-`billId` tail for the full-page stuck test, and a `billId` on the two page-cap fixtures (`test_okx_page_cap_records_dq_flag`, `test_inst_type_cap_hit_aggregates_dq_flags`). Their intent and counts are unchanged; the old assertions pinned `trade-99` etc., which contradicted the class docstring that already said `after=<billId>`.

**RED/GREEN proof (verbatim).** Byte backup of the fixed file outside the repo, neuter = the cursor back to `tradeId`, restore with `cp`, `cmp`:

```
--- neuter diff vs fixed
3212c3212
<             new_cursor = data[-1].get("billId", "")
---
>             new_cursor = data[-1].get("tradeId", "")
FAILED tests/test_nullanchor_bound.py::TestOkxPagerCursorIsABillId::test_every_page_is_read_and_exchange_fill_id_stays_the_trade_id
1 failed, 4 passed in 28.44s
restore cmp exit=0
5 passed in 22.76s
```

(The four SFH-M1 tests stay GREEN under this neuter by construction: their fake serves a full page forever, so the page cap, not the cursor, still records the truncation. They pin the stuck arms, which are unchanged.)

**Not done, by scope:** no PROD probe (no DB access this round). The phase agent's PROD evidence (OKX SWAP fills per strategy of 200, 106 and exactly 100) is consistent with one-page truncation under the old cursor; after this fix a first sync on those strategies should read past 100. Existing PROD strategies whose cursor already advanced past the unread older fills will not re-read them by themselves; that backfill is a founder/phase-agent decision.

### R2-WR-01: the OKX begin floor lost up to three days of served history

**Severity:** MEDIUM, data-integrity (introduced by round-1 `bf1ed172f`). **Status:** fixed: requires human verification.
**Files modified:** `analytics-service/services/exchange.py`, `analytics-service/tests/test_nullanchor_bound.py`
**Commit:** `8033fdd0e`

**Venue docs.** Same OKX page as above: `fills-history` "This endpoint can retrieve data from the last 3 months"; `begin`: "Filter with a begin timestamp ts"; nothing on an out-of-reach `begin`, so the clamp stays and the venue's exact edge stays unmeasured. ccxt's own `okx` `fetchMyTrades` option is `daysBack: 90` (a client-side convention, not a venue statement).

**Applied fix:** `OKX_FILLS_BEGIN_FLOOR_DAYS = 89` is replaced by `_okx_fills_begin_floor_ms(now_ms)`: now minus three calendar months (day clamped to the shorter month, time of day and milliseconds kept) plus one day, so the loss is at most about one day while the sent `begin` stays inside "the last 3 months". `_fetch_raw_trades_okx` clamps once before the instType loop and, when the clamp raises the start, calls `_record_dq_flag("okx_fills_reach_clamped", True)`. The name does not start with `sync_truncated_`, so `_fills_incomplete` never holds the cursor on it and the bound is cleared as before (the flag lands in `data_quality_flags` through the worker's existing shallow merge). `import calendar` was added.

**Tests** (in `TestOkxBeginStaysInsideTheDocumentedReach`): `test_the_floor_is_three_calendar_months_plus_one_day` (5 dates: the pinned 2026-07-15 with ms kept, 2026-05-31 to 2026-03-01 (Feb 28 plus one day), leap 2028-05-31 to 2028-03-01, 2026-03-31 to 2026-01-01 across a year wrap, 2026-11-27 to 2026-08-28), `test_the_flag_is_set_only_when_the_clamp_raises_the_start` (old seed True; in-reach seed and no seed absent), `test_the_flag_names_the_clamp_but_never_holds_the_cursor` (the REAL reader's clamped flags feed the real `run_sync_trades_job`: the cursor advance carries a non-None `p_last_fetched_ts` and the bound row is cleared). The re-based `_OKX_BEGIN_FLOOR_MS` is now 1776340800000 (2026-04-16T12:00:00Z) under the pinned clock.

**RED/GREEN proof (verbatim).** Two neuters from one byte backup. A: a flat 89-day floor and no flag. B: the flag renamed to a holding `sync_truncated_` name.

```
=== neuter A: flat 89-day floor, no flag
3278c3278
<         begin_floor_ms = _okx_fills_begin_floor_ms(_now_ms())
---
>         begin_floor_ms = _now_ms() - 89 * 86_400_000
3280d3279
<             _record_dq_flag("okx_fills_reach_clamped", True)
FAILED tests/test_nullanchor_bound.py::TestOkxBeginStaysInsideTheDocumentedReach::test_the_flag_is_set_only_when_the_clamp_raises_the_start
FAILED tests/test_nullanchor_bound.py::TestOkxBeginStaysInsideTheDocumentedReach::test_the_flag_names_the_clamp_but_never_holds_the_cursor
FAILED tests/test_nullanchor_bound.py::TestOkxBeginStaysInsideTheDocumentedReach::test_a_retry_seeded_from_a_93_day_bound_sends_the_clamped_begin
3 failed, 8 passed in 15.49s
restore cmp exit=0
=== neuter B (holding name), after reordering the not-holding test so the hold assertion runs first
FAILED tests/test_nullanchor_bound.py::TestOkxBeginStaysInsideTheDocumentedReach::test_the_flag_is_set_only_when_the_clamp_raises_the_start
FAILED tests/test_nullanchor_bound.py::TestOkxBeginStaysInsideTheDocumentedReach::test_the_flag_names_the_clamp_but_never_holds_the_cursor
2 failed, 9 passed in 51.49s
restore cmp exit=0
11 passed in 38.78s
```

(The calendar-date test calls the helper directly, so it is pinned by the helper's arithmetic, not by neuter A.)

**Residual limits.** (1) Whether OKX serves history older than the floor, or answers an old `begin` with an error or an empty list, is still unmeasured; the R2 reviewer's probe-gated advice (compare `begin = now - 94 d`, `now - 89 d` and no `begin` on an account with fills in that band) still applies and could move the floor. (2) `okx_fills_reach_clamped` is not in the worker's Binance-only clear list, so a stamped flag stays on the strategy's `data_quality_flags` until something overwrites it; Binance's own flag is cleared by `clear_absent_binance_sync_flags`. Adding an OKX clear was not done (minimal fix); the phase agent should decide whether a sticky advisory flag is acceptable. (3) The epilogue's `_covers_from_iso` is still computed from the seed, not the `begin` actually sent; the flag is the visibility the reviewer asked for, and a clamped read of up to about one day at the far edge is the accepted bound.

### R2-WR-02 (b): the Bybit fills read gets the handler budget remaining

**Severity:** MEDIUM, user-facing (liveness). **Status:** fixed: requires human verification.
**Files modified:** `analytics-service/services/job_worker.py`, `analytics-service/tests/test_nullanchor_bound.py`
**Commit:** `73d12296f`

**Venue docs.** No Bybit venue semantics are used: the fix changes only the number the worker passes as `read_deadline_s`, never what the Bybit read requests.

**Applied fix:** `run_sync_trades_job` stamps `_handler_start = _monotonic()` at its entry (before `_exchange_preflight`, so the clock matches the `wait_for` that wraps the handler) through a new module seam `_monotonic = time.monotonic` (`import time` added). On the fills read, when `ctx.key_row["exchange"] == "bybit"`, `read_deadline_s = max(1.0, BINANCE_SYNC_FILLS_READ_DEADLINE_S - (_monotonic() - _handler_start))`; every other venue keeps the fixed 840 s. The 1 s floor lets the first request run so the refusal stays the named `"deadline"` reason instead of an instant error.

**Scoped to Bybit, not Binance, deliberately.** Binance shares the parameter, but its 840 s is a founder ruling with its own pinned tests (`tests/test_binancefills_walk.py` asserts `== 840.0` and `< TIMEOUT_PER_KIND["sync_trades"]`; `tests/test_binancefills_e2e.py` pins `SYNC_READ_BUDGET_S`), and its comment already budgets the 60 s remainder for pre-read work. Changing it would be a Binance semantics change beyond the finding. The Binance pins pass unchanged (653 passed above includes both files).

**Tests** (in `TestBybitReadDeadline`): `test_the_bybit_read_gets_the_handler_budget_remaining[bybit-740.0]` and `[binance-840.0]` (a fake handler clock reads 0 s at the handler's start and 100 s once Phase 1 has run; the real `run_sync_trades_job` through `_run_job` must pass Bybit `840 - 100 = 740` and Binance the fixed 840). The older worker test's assertion `read_deadline_s == 840` became `0 < deadline <= 840` (the real clock now makes it a few ms under 840).

**RED/GREEN proof (verbatim).** Neuter = the Bybit branch never taken (the fixed deadline, the pre-fix behaviour):

```
--- neuter diff vs fixed
2690c2690
<                 if ctx.key_row.get("exchange") == "bybit":
---
>                 if False:
FAILED tests/test_nullanchor_bound.py::TestBybitReadDeadline::test_the_bybit_read_gets_the_handler_budget_remaining[bybit-740.0]
1 failed, 4 passed in 58.26s
restore cmp exit=0
5 passed in 43.58s
```

(A first neuter attempt used a `sed` that also matched an unrelated `elif ctx.key_row.get("exchange") == "bybit":` at line 2433 and produced a collateral second failure; it was restored by `cp` and `cmp` exit 0 before the targeted one above was recorded.)

**Residual.** The remaining budget still excludes the post-read persist, the DQ stamp and the cursor RPC, which the 60 s margin was sized for; this fix removes the unmeasured Phase-1 term from that margin for Bybit, it does not bound the persist. Part (a) (the no-progress re-read and the R4 creep of the bound by 1 h per refusal) remains unbooked until the phase agent books it.


---

_Fixed: 2026-11-27_
_Fixer: Claude (gsd-code-fixer)_
_Iteration: 1_
