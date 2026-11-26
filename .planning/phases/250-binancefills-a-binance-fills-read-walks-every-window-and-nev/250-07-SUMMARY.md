---
phase: 250-binancefills-a-binance-fills-read-walks-every-window-and-nev
plan: 07
subsystem: analytics-service/services/exchange.py (Binance fills read deadline and per-caller read budget)
tags: [binance, ccxt, read-deadline, semaphore-ordering, quiet-prefix, PROOF-01, SC-1, SC-3, SC-5]
status: complete
requires: ["250-06"]
provides:
  - "BINANCE_FILLS_READ_DEADLINE_S (240.0) and BINANCE_SYNC_FILLS_READ_DEADLINE_S (840.0); keyword-only read_deadline_s on fetch_raw_trades and _fetch_raw_trades_binance"
  - "a deadline stop checked inside the semaphore before every request (overlap pages included), named in binance_deadline_symbols, bound folded into the one binance_read_through_ms"
  - "the sync job reads with 840 s, the nightly reconcile and BinanceAdapter.fetch_raw with the 240 s default"
  - "BinanceFillsVenue(suspend_per_request=...) additive switch; the repeated-deadline ordering arm through the real sync job"
affects: [analytics-service/services/exchange.py, analytics-service/services/job_worker.py, analytics-service/tests]
key-files:
  modified:
    - analytics-service/services/exchange.py
    - analytics-service/services/job_worker.py
    - analytics-service/tests/_binance_fills.py
    - analytics-service/tests/test_binancefills_walk.py
    - analytics-service/tests/test_binancefills_e2e.py
key-decisions:
  - "The deadline is a stop kind of the existing result loop (collected beside cap and untimed into the same stop_bounds list), so 250-06's single min(stop_bounds) recording covers it and is not duplicated"
  - "Case (d) of the bound rule (a deadline inside the exempt overlap pages) is a parametrized case of the one bound-rule test, not a separate test, so N13 turns all four cases RED"
requirements-completed: [SC-1, SC-3, SC-5]
plan_head_before: 2f9d48e7dbcea5f1bfdfa72a04174ea284d74ce9
plan_head_after: 09c63a98ec7bc88b1c29004bf62182532b50023f
commits: 2
actuals:
  tokens: 9500
  tasks: 2
  commits: 2
---

# Phase 250 Plan 07: A Binance fills read has a deadline; the sync job reads for 840 s Summary

A Binance fills read now stops every symbol by name when its deadline passes, at a bound the cursor gate stamps at, and never sends a request after the deadline (the exempt overlap pages included). The sync job reads with 840 s of its 900 s handler timeout, the nightly reconcile and any caller that passes nothing with 240 s. Repeated deadline-stopped runs through the real sync job advance the stamp every run until the walk reaches now (measured: 4 deadline-stopped runs, then a run that reaches now), and a neutered ordering turns that arm RED.

## Task commits

| Task | Commit | What |
|---|---|---|
| 1 (tracer) | cfcc25be1 | the two constants, the `read_deadline_s` keyword on both functions, the deadline check and `deadline` stop kind, the `binance_deadline_symbols` recording and WARNING, the two `job_worker.py` hunks, `suspend_per_request`, the ordering arm; N24 |
| 2 | 09c63a98e | the bound rule per stop state (4 cases), the budget threaded through `fetch_raw_trades`, the per-caller arms, the pinned constants; N13, N26, N27, N28 |

## Tracer RED line on the 250-06 code (verbatim)

The ordering arm written first, run on the 250-06 code (venue switch present, no deadline in `services/exchange.py`): run 1 reaches now with no deadline flag, so the arm's "at least 3 deadline-stopped runs" assertion fails.

```
E       AssertionError: only 0 deadline-stopped runs before reaching now
E       assert 0 >= 3
FAILED tests/test_binancefills_e2e.py::TestBinanceFillsThroughTheSyncJob::test_repeated_deadline_stops_advance_the_frontier_every_run
1 failed, 7 deselected in 49.70s
```

GREEN after the implementation. A scratch run of the arm printed the measured per-run record (run, requests, frontier `binance_read_through_ms`, stamp, symbols stopped; the scratch copy was deleted, nothing committed):

```
RUN 1 12 1793185199998 2026-10-26T19:00:00+00:00 8
RUN 2 12 1793642399998 2026-11-01T19:00:00+00:00 8
RUN 3 12 1794160799998 2026-11-07T19:00:00+00:00 8
RUN 4 12 1794679199998 2026-11-13T19:00:00+00:00 4
```

Run 5 reached now with no deadline flag and stamped the newest venue fill (2026-11-19T19:00:00Z). Eight symbols (more than the five slots), every run exactly 12 requests, every symbol asked in every run, the frontier and the stamp strictly increasing.

## PROOF-01 records (verbatim)

Backups outside the worktree in the session scratchpad: `exchange.250-07.t1` (Task 1) and `exchange.250-07.t2` / `job_worker.250-07.t2` (Task 2). Each neuter was an asserted single-occurrence replace; each restore was `cp` from the backup and `cmp <backup> <file>` (silent = identical) before the GREEN re-run. After the last restore `git status` showed only the two test files (committed next) and both source files `cmp`-identical to their backups. The machine was under load (load average about 50), so the elapsed times are inflated. Pytest prints a long `where [...]` repr after each assertion; those repr lines are elided below as `E        +  where ...` (they only echo the venue's `calls` list or the mock's call object).

### N24: the semaphore held across a symbol's whole walk instead of per request (page-level `async with sem:` replaced by `if True:`, each symbol task wrapped in `async with sem:`)

```
E           AssertionError: run 1: symbols that never sent a request: ['BTCUSDC', 'BTCUSDT', 'ETHUSDT']
E           assert {'BCHUSDT', '...T', 'XRPUSDT'} == {'BCHUSDT', '...LTCUSDT', ...}
E             Extra items in the right set:
E             'ETHUSDT'
E             'BTCUSDT'
E             'BTCUSDC'
FAILED tests/test_binancefills_e2e.py::TestBinanceFillsThroughTheSyncJob::test_repeated_deadline_stops_advance_the_frontier_every_run
1 failed, 7 deselected in 54.57s
cmp silent
1 passed, 7 deselected in 40.49s
```

(Three of the eight symbols, those beyond the five slots, never start in the first deadline-stopped run.)

### N13: the deadline check deleted (`if _monotonic() >= deadline:` -> `if False:`)

```
E       AssertionError: a request was sent after the deadline
E       assert 3 == 1
E        +  where 3 = len([...])
E       AssertionError: a request was sent after the deadline
E       assert 2 == 1
E        +  where 2 = len([...])
E       AssertionError: a request was sent after the deadline
E       assert 4 == 1
E        +  where 4 = len([...])
E       AssertionError: a request was sent after the deadline
E       assert 7 == 1
E        +  where 7 = len([...])
FAILED tests/test_binancefills_walk.py::TestBinanceFillsStops::test_a_deadline_stops_every_symbol_with_a_read_through_bound[a-mid-window-with-rows]
FAILED tests/test_binancefills_walk.py::TestBinanceFillsStops::test_a_deadline_stops_every_symbol_with_a_read_through_bound[b-at-a-window-start]
FAILED tests/test_binancefills_walk.py::TestBinanceFillsStops::test_a_deadline_stops_every_symbol_with_a_read_through_bound[c-one-started-one-never-started]
FAILED tests/test_binancefills_walk.py::TestBinanceFillsStops::test_a_deadline_stops_every_symbol_with_a_read_through_bound[d-inside-the-exempt-overlap-pages]
4 failed, 28 deselected in 26.24s
cmp silent
4 passed, 28 deselected in 50.31s
```

(All four cases go RED, case (d) included: with no check the exempt overlap page no longer stops the walk.)

### N27: `fetch_raw_trades` calls `_fetch_raw_trades_binance` without the keyword (`read_deadline_s=read_deadline_s,` deleted)

```
E       AssertionError: the long budget sent 2 requests
E       assert 2 == 7
FAILED tests/test_binancefills_walk.py::TestBinanceFillsStops::test_the_read_budget_reaches_the_walk_through_fetch_raw_trades
1 failed, 31 deselected in 100.74s (0:01:40)
cmp silent
1 passed, 31 deselected in 69.11s (0:01:09)
```

### N26: the keyword dropped from `run_sync_trades_job`'s `fetch_raw_trades(` call

```
E       AssertionError: assert None == 840.0
E        +  where None = <built-in method get of dict object at 0x11c4bfb40>('read_deadline_s')
E        +    where ... = {'since_ms': 1792584000000}.get
E        +  and   840.0 = ex.BINANCE_SYNC_FILLS_READ_DEADLINE_S
FAILED tests/test_binancefills_e2e.py::TestBinanceFillsReadBudgetPerCaller::test_the_sync_job_passes_the_long_read_budget
1 failed, 9 deselected in 83.21s (0:01:23)
cmp silent
1 passed, 9 deselected in 125.17s (0:02:05)
```

### N28: `run_reconcile_strategy_job`'s `fetch_raw_trades(` call given `read_deadline_s=BINANCE_SYNC_FILLS_READ_DEADLINE_S`

```
E       AssertionError: assert 840.0 == 240.0
E        +  where 840.0 = <built-in method get of dict object at 0x11dbc2cc0>('read_deadline_s', 240.0)
E        +    where ... = {'since_ms': 1795554008897, 'read_deadline_s': 840.0}.get
E        +    and   240.0 = ex.BINANCE_FILLS_READ_DEADLINE_S
FAILED tests/test_binancefills_e2e.py::TestBinanceFillsReadBudgetPerCaller::test_the_reconcile_job_keeps_the_default_read_budget
1 failed, 9 deselected in 74.13s (0:01:14)
cmp silent
1 passed, 9 deselected in 44.40s
```

## Write-scope fence

`git diff -U0 --output=<scratch file> 2f9d48e7d -- analytics-service/services/job_worker.py` (base: the commit that added `250-06-SUMMARY.md`) exits 0 and prints exactly two hunk headers (no merge from main in between):

```
@@ -118,0 +119 @@ from services.exchange import (
@@ -2283 +2284,2 @@ async def run_sync_trades_job(job: dict[str, Any]) -> DispatchResult:
```

The first adds the import name `BINANCE_SYNC_FILLS_READ_DEADLINE_S`; the second adds `read_deadline_s=BINANCE_SYNC_FILLS_READ_DEADLINE_S,` to the Phase 2 `fetch_raw_trades(` call. Phase 222's hunks, the gate block, `run_reconcile_strategy_job` and the Phase 1 / Phase 2 ordering are untouched. `git diff --quiet 2f9d48e7d -- analytics-service/tests/test_okxtrades_cursor.py analytics-service/tests/test_job_worker_reconcile_audit.py` exits 0 (imported from, never edited). `services/ingestion/binance.py` is untouched.

## Verification

- Task 2 command (`pytest tests/test_binancefills_walk.py tests/test_binancefills_e2e.py tests/test_binancefills_harness.py tests/test_binancefills_cursor.py tests/test_exchange.py tests/test_okxtrades_cursor.py tests/test_ana_recon_audit.py tests/test_job_worker.py tests/test_job_worker_reconcile_audit.py tests/test_sync_trades_resume_seed.py -q -p no:cacheprovider`): `473 passed, 1 skipped` (the skip is the one noted in 250-05).
- CI mypy strict (`mypy --strict --follow-imports=silent --config-file=pyproject.toml services/ routers/ models/ main.py main_worker.py main_worker_healthz.py sentry_init.py`): `Success: no issues found in 143 source files`.
- Task 1 acceptance greps: `^BINANCE_FILLS_READ_DEADLINE_S: float` 1, `^BINANCE_SYNC_FILLS_READ_DEADLINE_S: float` 1, `_monotonic()` in `_fetch_raw_trades_binance` 2, `binance_deadline_symbols` there 2, `_record_dq_flag("binance_read_through_ms"` there exactly 1, `read_deadline_s=read_deadline_s` in `fetch_raw_trades` 1, `read_deadline_s=BINANCE_SYNC_FILLS_READ_DEADLINE_S` in `run_sync_trades_job` 1, the name in the import block 1.
- `node scripts/verify-plan-anchors.mjs <this plan>` exited 0 before Task 1 (14 claims).
- Ordering arm runtime: about 40 to 55 s under the machine load (5 runs through the real job and real ccxt).

## For the ship CHANGELOG

- **Known limit, the quiet-prefix deadline case (founder ruling 2026-11-25 UTC; the one named exception to ROADMAP SC-1):** when a sync read is stopped by its deadline and its covered prefix holds no stored fill after the cursor C, the Phase 232 stored-fill stamp leaves the cursor at C and the next run re-reads the same prefix. LOUD (`binance_deadline_symbols` and a WARNING on every such run), BOUNDED by the reach clamp (a fill is read and stamped at most about the reach minus the covered span days after it). A deadline stop inside the 1 h overlap re-read is the same case, not a new exception. Region at the 840 s sync budget, DERIVED and not measured (the 229 ms per weight-5 request throttle was measured without network latency; the venue's out-of-reach behaviour is unmeasured; PROD held 0 Binance keys on 2026-11-25): about 3,668 requests per run; up to about 280 symbols a cold 85-day walk reaches now in one run; at 300 symbols one run covers about 84 days, at 400 about 63, at 500 about 49, at 1,000 about 28. The switch that turns on raw trade import for Binance names it.
- **Known limit, the sync handler tail (DERIVED):** the 900 s handler timeout covers the whole of `run_sync_trades_job`, the 840 s clock only the read's requests. The other 60 s holds the pre-read work, the requests already past the check (at most five, each bounded by ccxt's 10 s default timeout) and the post-read persist (one probe and one upsert per 100 fills, then the daily persist, the DQ stamp, the cursor RPC and the follow-on enqueue). That holds a sparse read, not a fill-heavy read that also runs to its deadline; then `wait_for` cancels before the cursor RPC (upserted fills kept, loud as a job timeout, cursor not stamped, the next run starts from the same cursor). UNMEASURED term: the DB round-trip time from the worker.
- **Read budget:** a Binance sync read gets 840 s of the sync job's 900 s (`BINANCE_SYNC_FILLS_READ_DEADLINE_S`), the nightly reconcile keeps 240 s, and a caller that passes no budget, `BinanceAdapter.fetch_raw` included, reads with the 240 s default (`BINANCE_FILLS_READ_DEADLINE_S`). A stopped symbol keeps what it read and is named in `binance_deadline_symbols`; repeated deadline-stopped runs advance the stamp every run when each covered prefix holds a stored fill (measured through the real sync job, with an ordering neuter).

## Deviations from Plan

**1. [Own-test change] `_run_live`'s `_real_read` forwards `**read_kwargs` to `fetch_raw_trades`.** Required by the plan's own design (the arm reads "through the REAL sync job, which reads with the sync budget"): once the job passes `read_deadline_s`, the old fixed-signature stand-in would raise `TypeError`, and the budget would not reach the walk. No other existing arm changed.

**2. [Test shape] Case (d) is the fourth parametrized case of `test_a_deadline_stops_every_symbol_with_a_read_through_bound`**, not a separate test (the plan lists it as a case of that arm and N13 as turning "case (d) included" RED).

**3. [Test shape] The ordering arm sits in `TestBinanceFillsThroughTheSyncJob` as planned; the per-caller arms are the new class `TestBinanceFillsReadBudgetPerCaller`.** The two e2e helper imports (`_build_mock_ctx`, `_StubReport`) come from `tests/test_job_worker_reconcile_audit.py` and `_run_job` from `tests/test_okxtrades_cursor.py`; neither file is edited.

**4. [Addition inside the plan's test files] `test_the_read_deadlines_are_pinned` also pins the signature default (240.0, keyword-only) of both functions**, which is what makes "the reconcile reads with 240 s" true for a caller that passes nothing. Each deadline case also asserts exactly one deadline WARNING.

No Rule 1-4 deviations in production code. No `STATE.md` or `ROADMAP.md` change (orchestrator-owned).

## Known Stubs

None.

## Threat Flags

None beyond the plan's register. T-250-10 (deadline before every request, per-caller budgets; N13, N26, N27, N28), T-250-17 (symbol order; N24) are mitigated and pinned. T-250-18 (quiet-prefix deadline case) and T-250-19 (sync handler tail) are accepted, recorded above and in the constant's comment.

## Notes for later plans

- 250-08: collect the three "For the ship CHANGELOG" bullets above into the phase's unified hand-over. The switch that turns on raw trade import for Binance (250-02's SC-4 comment) already names the quiet-prefix exception; the CHANGELOG must too.
- `BinanceAdapter.fetch_raw` (`services/ingestion/binance.py`) passes no keyword and so reads with the 240 s default; it is untouched.
- The ordering arm is slow under load (about 40 to 55 s); it runs the real job five times on a real ccxt instance. It is the only arm that builds the venue with `suspend_per_request=True`.

## Self-Check: PASSED

- FOUND: analytics-service/services/exchange.py, analytics-service/services/job_worker.py, analytics-service/tests/_binance_fills.py, analytics-service/tests/test_binancefills_walk.py, analytics-service/tests/test_binancefills_e2e.py
- FOUND commits: cfcc25be1, 09c63a98e (both ancestors of HEAD); `git rev-list --count 2f9d48e7d..HEAD` = 2 before this SUMMARY
- `git diff --quiet 2f9d48e7d -- analytics-service/tests/test_okxtrades_cursor.py analytics-service/tests/test_job_worker_reconcile_audit.py` exits 0
