---
phase: 253-binancecursor-a-stopped-binance-fills-read-below-a-cursor-th
plan: 02
subsystem: analytics-service
tags: [binance, sync-cursor, fills-reread-bound, run_sync_trades_job, stateful-fakes, proof-01]
requires:
  - "253-01: public.set_strategy_fills_reread_bound and public.strategy_fills_reread_bounds"
provides:
  - "services.trade_resume.load_strategy_fills_reread_bound (fail open)"
  - "run_sync_trades_job: bound read into the fills seed, earliest complete-through instant, extended binance_stop_below_cursor predicate, fenced bound write before the cursor RPC"
  - "tests._binance_fills.bound_after_set and RereadBounds (stateful fake, mirror of rules R0 to R7)"
affects: [253-03, 253-04]
tech-stack:
  added: []
  patterns: ["third seed term beside the column and the stored fills", "one computation feeds both the flag and the bound write", "stateful fake whose brain is a pure mirror cross-checked by a hand-typed case table"]
key-files:
  created: []
  modified:
    - analytics-service/services/trade_resume.py
    - analytics-service/services/job_worker.py
    - analytics-service/tests/_binance_fills.py
    - analytics-service/tests/test_okxtrades_cursor.py
    - analytics-service/tests/test_binancefills_cursor.py
key-decisions:
  - "A2 resolved as pinned: a failed bound read adds no bound term (never a full-reach walk); the run's covers_from is the real walk start, so the RPC keeps the stored bound (case C6)."
  - "_binance_read becomes true only after _reach_anchor_ms is taken, and the epilogue block is gated on both, so mypy narrows without an assert and no OKX, MT5 or switch-off run enters it."
  - "The old predicate block was deleted and its comment replaced; the new predicate lives inside the same Binance-gated epilogue block as the computation and the bound write, so one _unread_from_ms feeds both."
status: complete
actuals:
  tokens: 11600
  tasks: 3
  commits: 3
plan_head_before: 71c69181a1425a61ed98c9b60970ebfa6a7d2e2e
plan_head_after: 3e7b9c8ce28bfdc5d6e1bedf739937a1b6f2ae36
commits: 3
---

# Phase 253 Plan 02: worker half of the per-strategy fills re-read bound Summary

`run_sync_trades_job` now seeds a Binance fills read from this strategy's own re-read bound and writes that bound through the claim-token fenced RPC before the cursor RPC, so a stopped, failed or raised span below a shared column is read again whatever a sibling strategy does to the column.

## Commits

| Task | Commit | Subject |
|---|---|---|
| 1 (tracer) | 4d47e82a2 | feat(253-02): Binance fills seed reads the strategy's re-read bound and writes it through the fenced RPC |
| 2 | db0fa3c46 | feat(253-02): binance_stop_below_cursor names a stop-plus-partial, a partial-only and a raised read, minus the overlap hour |
| 3 | 3e7b9c8ce | test(253-02): D-02 interleave, D-03 ceilings, the stall, A2, D-04 and the mirror against the SQL case table |

`commits: 3` is MEASURED from the on-disk ledger (`git rev-list --count 71c69181a..HEAD` before this SUMMARY's own commit). `actuals.tokens` is chars/4 over the added lines of `analytics-service` in those commits (46237 chars).

## What shipped

- `load_strategy_fills_reread_bound(supabase, strategy_id, api_key_id) -> (unread_from | None, error | None)` in `services/trade_resume.py`: reads `strategy_fills_reread_bounds` through `rows(...)`, returns the instant only when the row's key equals the key being synced, fails open (logger.exception, `(None, error)`, never raises).
- `run_sync_trades_job` (scoped hunks only, see the diff stat below):
  - new inert locals `_binance_read`, `_reach_anchor_ms`, `_reread_bound_ms`, `_unread_from_ms`, `_covers_from_iso` and a nested `_iso_of_ms` (epoch plus timedelta, never a float division);
  - Phase-2 block: for a Binance key `_reach_anchor_ms` is taken BEFORE the read; after the existing seed if/else the bound is read and, when earlier than a non-None seed, lowers `fills_since_ms` (and `fills_anchor_iso` on a NULL column). A None seed stays None;
  - epilogue, replacing the old `binance_stop_below_cursor` block: earliest complete-through `_unread_from_ms` (stop bound, and walk start minus 1 ms for a partial symbol, a failed or raised read, or a stop without a usable bound), `_covers_from_iso` (`-infinity` when the walk began at the reach), the D-06 predicate (`_unread_from_ms + 1 < column - OVERLAP_WINDOW_MS`, Binance-gated, one WARNING naming the strategy, the column and the instant and `strategy_fills_reread_bounds`), then the bound write between the predicate and `phase2_success`. Failed write on an incomplete read: logger.error, `binance_stop_below_cursor`, `_p_last_fetched = None`. FALSE: WARNING `worker_orphan_write_blocked: set_strategy_fills_reread_bound dropped ...`. Failed clear: WARNING only.
- Test side: `RereadBounds` and `bound_after_set` in `tests/_binance_fills.py`; `bounds` keyword on `_make_supabase`, `exchange` and `strategy_id` keywords on `_run_job` (defaults unchanged); an autouse pinned clock in `test_binancefills_cursor.py` (`NOW_253_MS` 1784116800000, `REACH_253_MS` 1776772800000, hand-typed).

## Verification

| Check | Result |
|---|---|
| `python3 -m pytest tests/test_binancefills_cursor.py tests/test_okxtrades_cursor.py tests/test_binancefills_e2e.py -q -p no:cacheprovider` (from analytics-service/) | `81 passed in 11.10s` |
| every test file naming `run_sync_trades_job` (14 `.py` files, one pytest process) | `558 passed, 10 skipped, 16 warnings in 29.89s`. The 10 skips, listed with `-rs`: `test_job_worker.py:4572` (1), `test_sync_trades_preserves_fills.py:115` and `:194` (1 each), `test_sync_trades_enqueue_failure_bridge_live.py:98` (7), all `LANE_DB_URL unset` / `local-stack lane not configured (local dev)`. These are live-DB arms that need the local Supabase stack (no Docker here by the load limit), so they did NOT run in this plan; CI's lane jobs are their first run against this change |
| `python3 -m mypy --strict --follow-imports=silent --config-file=pyproject.toml services/job_worker.py services/trade_resume.py` | `Success: no issues found in 2 source files` |
| CI's own mypy command, read from `.github/workflows/ci.yml` (step `Type gate - mypy strict over the running-service surface`): `mypy --strict --follow-imports=silent --config-file=pyproject.toml services/ routers/ models/ main.py main_worker.py main_worker_healthz.py sentry_init.py` | `Success: no issues found in 144 source files`. The three touched test files are outside CI's mypy surface, so they were not type-checked |
| RPC contract and case table blocks of 253-01-PLAN.md vs 253-02-PLAN.md (the plan's awk/diff line) | empty diff, `diff=0` |
| `git diff --quiet origin/main -- supabase/schema/functions/advance_sync_cursor.sql` | exit 0 |
| `grep -c "def load_strategy_fills_reread_bound(" services/trade_resume.py` | 1 |
| `grep -v '^\s*#' services/job_worker.py \| grep -c '"set_strategy_fills_reread_bound"'` | 1 |
| `grep -c "will not lower the column" services/job_worker.py` | 0 |
| `grep -c "def test_d02_three_step_interleave"` / `"def test_the_mirror_matches_the_sql_case_table"` | 1 / 1 |

The SQL-side cross-check: the mirror's eleven hand-typed cases C0 to C10 were compared by eye against the SQL gate's arm headers (`-- C0:` to `-- C10:` in `supabase/tests/test_strategy_fills_reread_bound.sql`); instants, keys and expected rows agree. No reconciliation was needed.

## Binance API docs consulted

- Spot `GET /api/v3/myTrades`: fetched `binance-spot-api-docs/rest-api.md` (raw GitHub, `rest-api.md` lines 4743 to 4780 of the fetched copy): `startTime`/`endTime`/`fromId`/`limit` (default 500, max 1000), "The time between `startTime` and `endTime` can't be longer than 24 hours", `fromId` returns trades >= that id, otherwise the most recent, and the list of supported parameter combinations.
- USD-M futures `GET /fapi/v1/userTrades`: the developers.binance.com page returned an empty body to `curl` (JS-rendered), so it was NOT re-read in this plan. The rules the fake relies on (7-day window, 3-month reach, limit 500/1000) are the ones recorded in `tests/_binance_fills.py`'s docstring from Phase 250's consult. This plan changes none of them: it only lowers the `since_ms` handed to `fetch_raw_trades`, and the windowing, paging and ordering all live in the untouched `fetch_raw_trades`. FAIL-LOUD note: futures docs were not independently re-verified here. A retry with a browser user agent returned HTTP 202 and an empty body again.

## PROOF-01 (verbatim)

Script: `$SCRATCH/253/plan02/proof.sh` (neuters from `$SCRATCH/253/plan02/neuter.py`); output saved to `$SCRATCH/253/plan02/proof-output.txt`. Every neuter starts from the post-fix byte backup `job_worker.py.post`, and each is restored by `cp` and verified by `cmp`, then the same arms are rerun GREEN. `git checkout`, `restore` and `stash` were never used. P0 uses the byte copy `job_worker.py.pre` taken before task 1. (`$SCRATCH` is the session scratchpad `.../scratchpad/253`.)

```
post backup cmp=0
===== P0 pre-fix job_worker.py (byte copy taken before task 1) =====
pre-fix in place cmp exit=0
FAILED tests/test_binancefills_cursor.py::TestBinanceFillsCursorGate::test_sc1_a_stop_below_a_column_set_by_another_strategy_is_reread_by_the_next_run
FAILED tests/test_binancefills_cursor.py::TestRereadBoundAcrossRuns::test_d02_three_step_interleave_b_rereads_from_its_bound_after_a_advances_the_column
2 failed, 48 deselected in 5.96s
restore cmp exit=0
GREEN rerun:
2 passed, 48 deselected in 5.23s
===== P1 =====
neutered P1 occurrences=1
2370c2370
<                     fills_since_ms = _reread_bound_ms
---
>                     pass
_ TestRereadBoundAcrossRuns.test_sc1_a_failed_symbol_on_a_column_ahead_is_reread_from_the_reach _
    async def test_sc1_a_failed_symbol_on_a_column_ahead_is_reread_from_the_reach(self) -> None:
        # SC-1 failed-symbol variant: no seed, column ahead, ETHUSDT failed, BTCUSDT healthy. Run
FAILED tests/test_binancefills_cursor.py::TestBinanceFillsCursorGate::test_sc1_a_stop_below_a_column_set_by_another_strategy_is_reread_by_the_next_run
FAILED tests/test_binancefills_cursor.py::TestRereadBoundAcrossRuns::test_d02_three_step_interleave_b_rereads_from_its_bound_after_a_advances_the_column
FAILED tests/test_binancefills_cursor.py::TestRereadBoundAcrossRuns::test_sc1_a_failed_symbol_on_a_column_ahead_is_reread_from_the_reach
3 failed, 47 deselected in 5.25s
restore cmp exit=0
GREEN rerun:
3 passed, 47 deselected in 5.23s
===== P2 =====
neutered P2 occurrences=1
2778,2779c2778
<             exchange_dq_flags.get("binance_partial_symbols")
<             or phase2_failed
---
>             phase2_failed
        # 2026-06-20) while BTCUSDT failed. The failed symbol is complete through nothing the
FAILED tests/test_binancefills_cursor.py::TestBinanceFillsCursorGate::test_stop_plus_partial_is_flagged_by_name_and_bounds_the_walk_start
1 failed, 49 deselected in 5.24s
restore cmp exit=0
GREEN rerun:
1 passed, 49 deselected in 5.18s
===== P3 =====
neutered P3 occurrences=1
2779d2778
<             or phase2_failed
WARNING  quantalyze.analytics.job_worker:job_worker.py:2428 Raw fill ingestion failed for strategy strat-232-cursor (Phase 1 succeeded): venue refused the fills read
FAILED tests/test_binancefills_cursor.py::TestBinanceFillsCursorGate::test_a_raised_binance_read_on_a_column_ahead_is_flagged_and_bounded
1 failed, 49 deselected in 5.33s
restore cmp exit=0
GREEN rerun:
1 passed, 49 deselected in 5.19s
===== P4 =====
neutered P4 occurrences=1
2310c2310
<             if ctx.key_row.get("exchange") == "binance":
---
>             if True:
        # phase2_fill_ingestion_failed and nothing named binance_*.
        assert flags["phase2_fill_ingestion_failed"] is True
WARNING  quantalyze.analytics.job_worker:job_worker.py:2428 Raw fill ingestion failed for strategy strat-232-cursor (Phase 1 succeeded): venue refused the fills read
FAILED tests/test_binancefills_cursor.py::TestBinanceFillsCursorGate::test_a_raised_okx_read_never_sets_a_binance_flag
1 failed, 49 deselected in 5.26s
restore cmp exit=0
GREEN rerun:
1 passed, 49 deselected in 5.18s
===== P5 =====
neutered P5 occurrences=1
2858d2857
<                 _p_last_fetched = None
_ TestBinanceFillsCursorGate.test_a_failed_bound_write_on_an_incomplete_read_is_loud_and_holds_the_stamp _
    async def test_a_failed_bound_write_on_an_incomplete_read_is_loud_and_holds_the_stamp(
ERROR    quantalyze.analytics.job_worker:job_worker.py:2852 sync_trades: could not record the Binance re-read bound for strategy strat-232-cursor (RuntimeError); the unread span may not be re-read (binance_stop_below_cursor)
FAILED tests/test_binancefills_cursor.py::TestBinanceFillsCursorGate::test_a_failed_bound_write_on_an_incomplete_read_is_loud_and_holds_the_stamp
1 failed, 49 deselected in 5.24s
restore cmp exit=0
GREEN rerun:
1 passed, 49 deselected in 5.24s
===== P6 =====
neutered P6 occurrences=1
2789c2789
<             if fills_since_ms is None or _walk_start_ms <= _reach_anchor_ms
---
>             if True
_ TestRereadBoundAcrossRuns.test_a_failed_bound_read_adds_no_term_and_the_rpc_keeps_the_stored_bound _
    async def test_a_failed_bound_read_adds_no_term_and_the_rpc_keeps_the_stored_bound(
ERROR    quantalyze.analytics:trade_resume.py:175 fills-reread-bound read failed for strategy strat-232-cursor — failing OPEN to no bound term for this fills read
FAILED tests/test_binancefills_cursor.py::TestRereadBoundAcrossRuns::test_a_failed_bound_read_adds_no_term_and_the_rpc_keeps_the_stored_bound
1 failed, 49 deselected in 5.26s
restore cmp exit=0
GREEN rerun:
1 passed, 49 deselected in 5.21s
===== P7 =====
neutered P7 occurrences=1
2806c2806
<             and _unread_from_ms + 1 < _fills_cursor_ms - _exchange.OVERLAP_WINDOW_MS
---
>             and _unread_from_ms + 1 < _fills_cursor_ms
FAILED tests/test_binancefills_cursor.py::TestBinanceFillsCursorGate::test_the_overlap_hour_below_the_newest_stored_fill_is_not_flagged[inside-the-overlap-hour]
FAILED tests/test_binancefills_cursor.py::TestBinanceFillsCursorGate::test_the_overlap_hour_below_the_newest_stored_fill_is_not_flagged[edge-minus-1ms]
2 failed, 1 passed, 47 deselected in 5.30s
restore cmp exit=0
GREEN rerun:
3 passed, 47 deselected in 5.23s
===== final: full file on restored code =====
50 passed in 5.28s
final cmp exit=0
```

Reading of the proof: P0 (the pre-fix file) and P1 (the seed assignment) turn the SC-1 stop arm and the D-02 arm RED (P1 also the failed-symbol SC-1 variant). P2 and P3 drop one term each of the throughs condition (stop-plus-partial and raised read go RED). P4 removes the Binance gate (the OKX raised-read negative goes RED). P5 removes the stamp hold (the RPC-raises arm goes RED). P6 and P7 are two extra neuters beyond the plan's P0 to P5, on the A2 covers_from rule and on the overlap subtraction of the predicate (the edge arms go RED, and the below-the-edge control stays GREEN as it must). Every neuter was applied exactly once, restored by `cp` from the byte backup, and `cmp` exited 0 each time.

The neuter list P0 to P7 was added to the module docstring of `tests/test_binancefills_cursor.py` (the NEUTER block).

### RED census: the whole test file against the pre-fix `job_worker.py`

After PROOF-01, the pre-fix byte copy was put in place (`cmp` exit 0), the whole of `tests/test_binancefills_cursor.py` was run, and the post-fix copy was restored (`cmp` exit 0; GREEN rerun `50 passed in 6.24s`). Result `17 failed, 33 passed in 6.63s`:

```
FAILED TestBinanceFillsCursorGate::test_sc1_a_stop_below_a_column_set_by_another_strategy_is_reread_by_the_next_run
FAILED TestBinanceFillsCursorGate::test_a_stop_below_a_column_set_by_another_strategy_is_flagged_and_warned
FAILED TestBinanceFillsCursorGate::test_stop_plus_partial_is_flagged_by_name_and_bounds_the_walk_start
FAILED TestBinanceFillsCursorGate::test_a_partial_only_read_from_the_reach_is_flagged_and_bounded
FAILED TestBinanceFillsCursorGate::test_a_raised_binance_read_on_a_column_ahead_is_flagged_and_bounded
FAILED TestBinanceFillsCursorGate::test_the_overlap_hour_below_the_newest_stored_fill_is_not_flagged[inside-the-overlap-hour]
FAILED TestBinanceFillsCursorGate::test_the_overlap_hour_below_the_newest_stored_fill_is_not_flagged[edge-minus-1ms]
FAILED TestBinanceFillsCursorGate::test_a_failed_bound_write_on_an_incomplete_read_is_loud_and_holds_the_stamp
FAILED TestBinanceFillsCursorGate::test_an_orphan_bound_write_is_logged_and_the_cursor_rpc_still_runs
FAILED TestRereadBoundAcrossRuns::test_d02_three_step_interleave_b_rereads_from_its_bound_after_a_advances_the_column
FAILED TestRereadBoundAcrossRuns::test_sc1_a_failed_symbol_on_a_column_ahead_is_reread_from_the_reach
FAILED TestRereadBoundAcrossRuns::test_a_failed_bound_read_adds_no_term_and_the_rpc_keeps_the_stored_bound
FAILED TestRereadBoundAcrossRuns::test_a_covered_repeated_stop_moves_the_bound_forward_and_the_next_run_seeds_there
FAILED TestRereadBoundAcrossRuns::test_d03_the_bound_sent_is_never_later_than_a_complete_through_instant[stop]
FAILED TestRereadBoundAcrossRuns::test_d03_the_bound_sent_is_never_later_than_a_complete_through_instant[stop-plus-partial]
FAILED TestRereadBoundAcrossRuns::test_d03_the_bound_sent_is_never_later_than_a_complete_through_instant[raised]
FAILED TestRereadBoundAcrossRuns::test_d04_a_stop_run_calls_advance_sync_cursor_with_the_same_params_on_every_venue
```

The 33 that stay GREEN on the pre-fix code, and why that is right: the 11 `test_the_mirror_matches_the_sql_case_table` cases (a pure function in the test helpers, no worker code involved), the two OKX negatives (`test_an_okx_run_makes_no_bound_read_and_no_bound_write`, `test_a_raised_okx_read_never_sets_a_binance_flag`: the pre-fix worker never did either, and the second is shown to bite by P4), `test_a_stop_at_or_above_the_column_is_not_flagged` and the third overlap-hour id `below-the-overlap-edge` (the pre-fix predicate also flagged those), and the Phase 250 arms that run unchanged.

### TDD sequence, disclosed

The tasks carry `tdd="true"`; RED and GREEN for each task share ONE commit, and history was not rewritten. The RED runs were seen before the production edit and are recorded here instead: task 1, `1 failed, 1 passed, 20 deselected` (`assert 0 == 1` on `len(bounds.calls)`, the SC-1 arm RED; the OKX arm GREEN as it must be); task 2, `5 failed, 26 passed` on the then-current code (the flagged-and-warned rewrite, stop-plus-partial, the raised Binance read, and two overlap-hour ids). Several task 2 and task 3 arms were GREEN on their first run because task 1 already carried the production paths they pin (partial-only bound, orphan, failed write, stall, D-03, the Binance half of D-04); the census above shows each of them RED on the pre-fix code, and P2 to P7 show the production terms they guard bite.

## `git diff --stat` of job_worker.py (scope check)

`git diff --stat 71c69181a -- analytics-service/services/job_worker.py`: `analytics-service/services/job_worker.py | 161 +++++++++++++++++++++++++++----` (`1 file changed, 143 insertions(+), 18 deletions(-)`). Hunk headers (`git diff -U0`), all inside the plan's write_scope:

```
@@ -143,0 +144 @@            import line from services.trade_resume
@@ -2181,0 +2183,15 @@       new locals and _iso_of_ms beside fills_since_ms
@@ -2293,0 +2310,7 @@        _binance_read and _reach_anchor_ms (Phase-2 seed block)
@@ -2329,0 +2353,22 @@       the bound term of the seed (Phase-2 seed block)
@@ -2717,14 +2762,45 @@     the old predicate block replaced by the computation, predicate and bound write
@@ -2734,3 +2810,4 @@        (same replaced block)
@@ -2739 +2816 @@          (same replaced block)
@@ -2741,0 +2819,48 @@       the bound write (same replaced block)
```

NOT touched, by construction and by the hunk list: the `_advance_cursor` closure and its call, the stamp gate (`advance_fetched_cursor`, `_p_last_fetched`, except the one hold assignment inside the bound-write except), the flag-merge block from `needs_flag_write` to `_stamp_phase2_flags`, the follow-on enqueue tail, `_RAW_TRADE_INGESTION_ENABLED` and its comment, and `run_derive_broker_dailies_job`. `USE_RAW_TRADE_INGESTION` and `_RAW_TRADE_INGESTION_ENABLED` were not flipped.

## Deviations from Plan

**1. [Interpretation] D-03's "at or before the walk start" read as "at or before every complete-through ceiling that applies"**
- The behaviour line says the sent `p_unread_from` is "at or before every stopped symbol's bound and at or before the walk start". Taken literally that is false for a plain stop whose bound (2026-06-02T09:00Z) is later than the walk start (2026-06-01T08:00Z), and the plan's own must_have says the bound is "never later than the earliest complete-through instant (the stop bound, or walk start minus 1 ms for a failed symbol or a raised read)". The arm `test_d03_the_bound_sent_is_never_later_than_a_complete_through_instant` pins THAT reading: for each of stop, stop-plus-partial and raised it asserts the sent bound is at or before the minimum of the ceilings that apply (stop bound; walk start minus 1 ms), and that a written column stamp never passes the stop bound.
- Files: tests/test_binancefills_cursor.py. Commit: 3e7b9c8ce.

**2. [Scope note] Two extra neuters, P6 and P7**
- Added beyond the plan's P0 to P5 because the A2 covers_from rule and the overlap subtraction are each load-bearing for a locked decision (A2, D-06) and had an arm that could be shown to bite. Both recorded above.

**3. [Structure note] Predicate placed inside the Binance-gated epilogue block**
- The plan describes "the predicate block is replaced; a NEW bound-write block sits between that predicate block and `phase2_success`". In the shipped code the computation, predicate and write share one `if _binance_read and _reach_anchor_ms is not None:` block (in that order), so the predicate and the write read the same `_unread_from_ms` (CONTEXT Claude's Discretion) and mypy narrows `_reach_anchor_ms` without an assert. Order and write_scope are as pinned. Task 1 deliberately kept the old predicate intact and computed `_unread_from_ms` after it; task 2 then folded the predicate in, as the plan's task split requires.

No Rule 1, 2 or 3 production deviations: the production code matched "Worker decisions pinned here" on the first green run.

## Known Stubs

None.

## Threat Flags

None. The only new surface is the one RPC call and one table read the plan's threat model names: T-253-06 (claim token threaded, FALSE logged `worker_orphan_write_blocked`: arm `test_an_orphan_bound_write_is_logged_and_the_cursor_rpc_still_runs`), T-253-07 (ERROR plus flag plus held stamp: arm `test_a_failed_bound_write_on_an_incomplete_read_is_loud_and_holds_the_stamp`, P5), T-253-08 (logs name the strategy id, column ISO, instant and exception class only), T-253-09 (A2: no full-reach fallback, arm `test_a_failed_bound_read_adds_no_term_and_the_rpc_keeps_the_stored_bound`, P6).

## Open items for later plans

- Plan 03 owns the census and snapshot moves for the new SQL gate file and function; plan 04 owns the flag-lifetime work (`needs_flag_write` to `_stamp_phase2_flags`, `run_derive_broker_dailies_job`) and the `_RAW_TRADE_INGESTION_ENABLED` comment, which still describes the old open gap and the old predicate wording. This plan did not edit them.
- **Open item, recorded not fixed (a pinned behaviour):** the failed-bound-write except sets `_p_last_fetched = None`, which also discards the NULL-column bootstrap anchor (`fills_anchor_iso`) the stamp gate may have set just above. On a NULL column a lost bound write therefore leaves the column NULL AND the bound unwritten; the next seed is the daily high-water, which Phase 1 may have moved. The plan pins `= None` and `test_a_failed_bound_write_on_an_incomplete_read_is_loud_and_holds_the_stamp` covers only a set column. Candidate fix for a later plan: hold to `fills_anchor_iso` instead of `None` (the existing P5 arm would still accept it).
- The whole path is dormant while `USE_RAW_TRADE_INGESTION` stays off for Binance (SC-4).
- Steps skipped per the orchestrator override: `state.advance-plan`, `state.update-progress`, `state.record-metric`, `state.add-decision`, `state.record-session`, `roadmap.update-plan-progress` and `requirements.mark-complete` (SC-1, SC-2, SC-5 are NOT marked complete by this plan), and no final STATE/ROADMAP/REQUIREMENTS commit. The decisions D-05, D-06, D-07 and D-13 were checked against `253-CONTEXT.md` wording after the work: the RPC owns the LEAST and clear rules (plan 01), the predicate and the raised-read join are as D-06 and D-07 state, and the write scope was kept by symbol (D-13).
- No Docker, no TEST or PROD database was touched.

## Self-Check: PASSED

- FOUND: analytics-service/services/trade_resume.py (def load_strategy_fills_reread_bound)
- FOUND: analytics-service/services/job_worker.py (set_strategy_fills_reread_bound call)
- FOUND: analytics-service/tests/_binance_fills.py (def bound_after_set, class RereadBounds)
- FOUND commits: 4d47e82a2, db0fa3c46, 3e7b9c8ce
- STATE.md and ROADMAP.md untouched (orchestrator override).
