---
phase: 256-okxunitswitch
plan: 06
subsystem: analytics-service
tags: [okx, unit-switch, btc, derive, strategy-mode, nav-twr, proof-01]
status: complete

requires:
  - phase: 256-01
    provides: derive_unit_switch, split_daily_pnl_at_switch, end_of_day_holdings_from_rows, UNIT_SWITCH_REFUSALS
  - phase: 256-02
    provides: strategy_analytics.unit_segments (the column the prestamp writes; shipped in PR-1)
  - phase: 256-03
    provides: unit_switch keyword on the OKX bills read, get_and_clear_last_unit_switch_read, get_and_clear_last_okx_ccy_share
  - phase: 256-04
    provides: build_switched_series, SWITCH_ANCHOR_UNPRICED
provides:
  - "services/job_worker.py: strategy-mode OKX derive resolver (_resolve_unit_switch), switched combine branch (_book_switched_series), data_quality_flags.unit_switch and strategy_analytics.unit_segments prestamp, _unit_segments_payload, closed unit-switch detail tokens"
  - "services/analytics_runner.py: _validated_unit_switch and the present-only unit_switch carry"
  - "tests/fixtures/okx_unit_switch_derive_harness.py: run_switched_derive / SwitchedDeriveCapture (reused by plan 09)"
  - "tests/test_okx_unit_switch_derive.py and TestUnitSwitchCarry in tests/test_csv_analytics_runner.py"
affects: [256-07, 256-08, 256-09, 256-10]

plan_head_before: 9b7fbbcf02a3bc31ccfbdee9446fd1eb5c8ad425
plan_head_after: 4a34e774adcd5362a95512a3cd12d61e05e5e9aa

# actuals (#2632): chars/4 over the added lines of the realized diff (62050 chars; job_worker.py +347, harness,
# the derive test file, analytics_runner.py, test_csv_analytics_runner.py). commits is MEASURED from the
# per-plan ledger (git rev-list --count plan_head_before..plan_head_after); the SUMMARY commit that follows
# is not in that range.
actuals:
  tokens: 15500
  tasks: 3
  commits: 2

tech-stack:
  added: []
  patterns: ["opt-in resolver keyword passed only when set (two literal call branches)", "closed detail token appended to an existing named refusal", "side channels drained on the statement after the await", "explicit-null sidecar on every prestamp"]

key-files:
  created:
    - analytics-service/tests/fixtures/okx_unit_switch_derive_harness.py
    - analytics-service/tests/test_okx_unit_switch_derive.py
  modified:
    - analytics-service/services/job_worker.py
    - analytics-service/services/analytics_runner.py
    - analytics-service/tests/test_csv_analytics_runner.py

key-decisions:
  - "Rows dated after the latest completed UTC day: P&L and funding rows are left to the next derive; a deposit or withdrawal dated that day refuses transient; an account that switched today refuses transient (plan 04 hand-off 1, flagged for the founder)"
  - "Every unit-switch refusal keeps the recorded token daily_pnl_non_usd_okx and appends 'unit switch: <closed token>'; holdings_read_failed, closes_read_failed, flow_after_latest_close and switch_anchor_unpriced are transient, every other token permanent"
  - "unit_segments is an explicit NULL on EVERY strategy-mode prestamp that is not switched, any venue (T-256-19)"
  - "The resolver keyword is passed only when a resolver exists, so key mode and every other venue call fetch_all_trades byte-identically to before"

requirements-completed: [SC-1, SC-2, SC-3, SC-5, SC-7]

duration: about 3h
completed: 2026-11-27
---

# Phase 256 Plan 06: DERIVE-STRATEGY Summary

**The strategy-mode OKX derive now books an account that moved from USDT into BTC: it hands the real bills read a holdings-reading resolver, builds the whole-history USD headline (USD through the derived S, the BTC segment converted at the stored daily closes), stamps `data_quality_flags.unit_switch` and `strategy_analytics.unit_segments`, and ends DONE where origin/main ends `failed_final` with `daily_pnl_non_usd_okx`. `analytics_runner` carries the marker and pairs the benchmark as for any USD row.**

## What was built

- **Resolver and side channels (`run_derive_broker_dailies_job`, strategy-mode OKX only).**
  - `get_and_clear_last_okx_ccy_share()` is drained on the statement right after the equity read; `get_and_clear_last_unit_switch_read()` on the statement right after `get_and_clear_last_dq_flags()`.
  - `_resolve_unit_switch(census)` reads the key's `allocator_holdings` rows (`symbol, value_usd, asof, holding_type`) through `db_execute`, paged with an advance-by-what-came-back, stop-on-EMPTY-page loop (PostgREST clamps a range to `max_rows`, the `read_key_marks` rule), then `derive_unit_switch(census, end_of_day_holdings_from_rows(rows), live_share)`. A read error returns `holdings_read_failed`; a member of `_READ_PROGRAMMING_ERRORS` re-raises.
  - The realized read is two literal call branches: `unit_switch=` is passed only when a resolver exists. Key mode and every other venue therefore call `fetch_all_trades(ctx.exchange, since_ms=None, read_deadline_s=...)` exactly as before (the dualmode suite pins that kwargs dict). `grep -c "unit_switch=" job_worker.py` is 1 and plan 03's AST pin still passes.
- **Switched combine branch.** `_book_switched_series` reads the stored BTC closes once, splits the stable/coin P&L at the derived day, and calls `build_switched_series` (`usd_full_history` from `_ccxt_full_history_verdict`, `latest_close_day` = the latest completed UTC day). `returns, meta` become the headline and merged meta; the DQ-02 terminus, the unchanged marks block and the csv write run on an all-USD series.
- **Prestamp.** `_prestamp_flags["unit_switch"] = {coin, last_usd_day, first_coin_return_day}` (not a guard key, no `native_unit`, no `daily_pnl_non_usd_okx`); `_prestamp_payload["unit_segments"]` is `_unit_segments_payload(...)` (version 1, USD segment = FINAL headline after the marks through S, native coin segment from S+1 with `base_day` S, `unpriced_days`; non-finite points left out) or an explicit `None`.
- **Refusals.** `_refuse_incomplete_read(..., detail=...)` records the token `daily_pnl_non_usd_okx` unchanged (no new member of `READ_INCOMPLETE_TOKENS`, the frozenset literal has no diff hunk) and renders `derive_broker_dailies: realized read incomplete (daily_pnl_non_usd_okx; unit switch: <token>)`. A detail outside `_UNIT_SWITCH_DETAIL_TOKENS` is dropped, so no id, amount or venue text can ride it (T-256-17).
- **Runner carry.** `_validated_unit_switch` (three string keys, coin `[A-Z]{2,10}`, two real ISO days, extras dropped) feeds a present-only `data_quality_flags["unit_switch"]` outside both `_warned` loops, beside `native_unit`. It never sets `_native_unit`, so the benchmark is paired and the KPI gate runs over the whole USD series.
- **Harness.** `run_switched_derive(key_mode, holdings_rows, balance_details, closes, marks, bills, funding, deposits, total_eq, stored_analytics_row, cal)` drives the REAL derive over a fake OKX exchange (real `fetch_daily_pnl` over `OkxBillsArchive`, real `fetch_okx_total_equity_and_upl_usd` over a raw balance response with `details`), a recording supabase stub (a paged `allocator_holdings` stub) and patched closes / marks / mark-write / funding / flows reads. It captures upserts, deletes, rpcs, the `fetch_all_trades` kwargs and the resolver / holdings / closes read counts. Plan 09 reuses it with `key_mode=True`.

## OKX v5 field semantics consulted

Fetched the live OKX v5 docs page (2026-11-27, `https://www.okx.com/docs-v5/en/`): `GET /api/v5/account/balance` documents `totalEq` as "The total amount of equity in `USD`" and `details[].eqUsd` as "Equity in `USD` of currency". The derive's anchor (`totalEq`) and the live per-coin share (`eqUsd / sum(eqUsd)`, plan 03) rest on exactly those two fields; the harness's fake balance response uses the same names. The bills fields (`pnl`, `fee` in the bill's own `ccy`) were consulted by plan 03.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - plan premise wrong] Task 2's "a switched DONE derive awaits `_clear_read_incomplete`" is not applicable to strategy mode.**
- **Found during:** Task 2. `_clear_read_incomplete` is called once, at the key-mode exit, with `allocator_id` / `api_key_id`, which exist only in key mode. RESEARCH Pitfall 7 says the other thing: `read_refusal_kept_figures` lives on a FAILED job's own `compute_jobs.metadata`, so a strategy clears it by a later job ending done.
- **Fix:** no strategy-mode call was added. `test_it_writes_no_refusal_marker_so_the_kept_figures_state_ends_with_the_job` asserts DONE, no `mark_compute_job_kept_figures` rpc, no job update and no `computation_error`. The refusal side is pinned by `test_a_switch_back_refuses_permanently_and_keeps_the_figures` (the rpc is called over a row holding published figures).

**2. [Rule 1 - hazard from plan 04 hand-off 1] Rows dated after the latest completed day would refuse permanently on most nights.**
- **Found during:** reading plan 04's hand-off, confirmed by Gate D below (neutering the filter turns `test_todays_stable_pnl_is_left_out...` RED with `unit switch: coin_segment_unpriced`, permanent).
- **Fix, per input kind (each pinned by a test):**
  - stable P&L and coin P&L dated after the latest completed day are filtered out before the split (the series ends at the latest completed day, the next derive reads them in full);
  - funding rows dated after it are filtered out (an OKX funding row lands at 00:00Z, so a 05:30Z derive meets one nearly every day);
  - a deposit or withdrawal dated after it refuses TRANSIENT `flow_after_latest_close` (it is inside the live equity and has no day to book on; dropping it would shift every earlier level by its size);
  - an account whose S is after it (switched today) refuses TRANSIENT `switch_anchor_unpriced`.
- **Known limit, recorded:** the part of today's realized P&L and funding already inside the live equity stays inside the anchor for one night, because the anchor is the live equity exactly as the builder takes it. Not adjusted: the live equity also holds today's unrealized move, which cannot be separated, so a partial correction would be false precision. For the founder to confirm.

**3. [Rule 2 - closed vocabulary] Two detail tokens beyond plan 01's set, and `switch_anchor_unpriced` covers three cases.** `closes_read_failed` (a `BtcClosesReadError`) and `flow_after_latest_close`, both transient, are module constants beside `_UNIT_SWITCH_HOLDINGS_READ_FAILED`. `switch_anchor_unpriced` (transient) also names an unusable live equity (`balance_error`, `None`, non-finite or not positive) and a closes store that holds no usable close at all, so an empty store does not read as a permanent "S has no close".

**4. [Plan literal vs wall clock] Dates in the tests are computed, not 2026-11-14 / 11-15.** The derive reads the wall clock (the OKX bills reach, the latest completed day), so a fixed 2026 date ages out of the venue's reach. The harness calendar is relative to today: stable bills on days -18 and -16, BTC fee bills on S = day -14 and day -8, holdings USDT to asof day -14 then BTC about 99.7%. The tracer asserts `unit_switch == {coin: BTC, last_usd_day: cal.day(14), first_coin_return_day: cal.day(13)}` and the segment heads from the same calendar. The founder's 11-14 / 11-15 is plan 01's recorded check.

**5. [Commit shape] Tasks 1 and 2 landed in one commit** (`5d8daf39b`): the refusal plumbing, the resolver and the tracer live in the same hunks of `job_worker.py` and one test file. Task 3 is `4a34e774a`.

**6. [Trailers] No Co-Authored-By / Claude-Session trailer on either commit**, per the orchestrator rules and the founder's no-AI-attribution rule, which override the harness attribution reminder.

**7. [Environment] The worktree has no `.venv`.** pytest and mypy ran from the main checkout's Python 3.12 venv, read-only. Iteration used `--noconftest -p no:cacheprovider`; every verify command below was also run once with the repo conftest.

### Notes (not deviations)

- With no USD history at all the USD segment is stored with `returns: []` and `from_day == to_day == last_usd_day` rather than omitted, so `segments[0]` is always USD and `segments[1]` always the coin (plan 05's parser reads that shape).
- The resolver's `_READ_PROGRAMMING_ERRORS` re-raise reaches the dispatcher as `daily_pnl_fetch_error` with the exception CLASS NAME (a transient named refusal), not as a raw exception: `fetch_daily_pnl`'s outer handler swallows anything the resolver raises into that flag (plan 03 behaviour). A bug in the holdings read is therefore labelled by its class and retried, never mislabelled `holdings_read_failed`.
- Marks (plan 04 hand-off 5): the unchanged marks block re-bases the whole USD headline, so a stable residual's coin-value drift reaches the headline through the marks and not the native coin line.

## Verification

- `cd analytics-service && python3 -m pytest tests/test_okx_unit_switch_derive.py -x -q` (conftest): green (22 tests; the run with `test_csv_analytics_runner.py` below).
- `tests/test_csv_analytics_runner.py tests/test_okx_unit_switch_derive.py` (conftest, main venv 3.12): `129 passed, 1 warning in 19.55s`.
- `tests/test_okx_unit_switch_derive.py tests/test_derive_broker_dailies_dualmode.py tests/test_derive_last_success_snapshot.py tests/test_nav_marks_derive_apply.py tests/test_okx_unit_switch_fetch.py tests/test_unit_switch.py tests/test_unit_switch_series.py` (conftest): `325 passed, 82 warnings in 27.22s`. The dualmode, snapshot, marks-apply and fetch-pin suites pass UNEDITED, with `unit_segments: None` now on every strategy prestamp.
- `make typecheck` (mypy strict, CI path set, `MYPY=` pointed at the main venv's mypy), run after every code change: `Success: no issues found in 148 source files`. `mypy tests/test_okx_unit_switch_derive.py tests/fixtures/okx_unit_switch_derive_harness.py`: `Success: no issues found in 2 source files`.
- Acceptance greps: `grep -c "unit_switch=" services/job_worker.py` 1; `grep -c "unit_segments"` 4; `grep -c "unit switch: "` 3; `grep -c "unit_switch" services/analytics_runner.py` 6; no `+`/`-` line inside the `READ_INCOMPLETE_TOKENS` frozenset literal.
- **Full analytics suite** (`pytest -n auto --dist loadgroup`, conftest, main venv): `19 failed, 17769 passed, 107 skipped in 714.38s`. None of the 19 is in a file this plan touches:
  - 18 are quantstats-version failures in `tests/test_metrics.py` / `tests/test_qstats_gate.py` (`quantstats pin moved to 0.0.81; ... cite 0.0.86`: the main checkout's venv carries 0.0.81, an environment mismatch, not code).
  - 1 is `tests/test_sql_gate_scoped_updates.py::test_scanner_is_not_vacuous`: plan 02's new SQL gate file `test_strategy_analytics_unit_segments.sql` carries 4 `strategy_analytics` UPDATEs and `_EXPECTED_MATCH_COUNTS` has no entry for it. **Open item for the orchestrator at merge** (plan 02's file, not this plan's): add `'test_strategy_analytics_unit_segments.sql': 4` in the same commit.

## PROOF-01 (each gate seen RED by assertion, byte restore, GREEN)

Byte backups with `cp` to the scratchpad, one-line neuters, restore with `cp`, `cmp` silent, GREEN. No `git checkout`, `restore` or `stash`.

### Pre-fix RED (the BASE `job_worker.py` swapped in from `git show 9b7fbbcf0:...`, restored byte-exact)

```
WARNING quantalyze.analytics:exchange.py:2237 OKX daily P&L refused: bills in a currency that is not a stable coin (census={'BTC': 3}, bills=3)
WARNING quantalyze.analytics.job_worker:job_worker.py:6211 derive_broker_dailies: realized read incomplete (venue=okx, token=daily_pnl_non_usd_okx, class=None) - refusing the key, nothing written
E       AssertionError: DispatchResult(outcome=<DispatchOutcome.FAILED: 'failed'>, error_message='derive_broker_dailies: realized read incomplete (daily_pnl_non_usd_okx)', error_kind='permanent', trade_count=None)
FAILED tests/test_okx_unit_switch_derive.py::TestTracerFounderShapedStrategyDerive::test_tracer_ends_done_with_the_whole_history_usd_headline_and_the_two_unit_record
FAILED tests/test_okx_unit_switch_derive.py::TestTracerFounderShapedStrategyDerive::test_the_csv_rows_equal_the_builders_headline_for_the_same_inputs
2 failed in 5.25s
=== cmp (job_worker.fixed.py vs job_worker.py) ===
cmp exit: 0
```

(The same failure origin/main has on the 3 PROD strategy jobs: FAILED, `daily_pnl_non_usd_okx`.)

### Gate A, the switched combine branch (neutered: `if False and _unit_switch_read is not None and ...`, the combine site falls through to `combine_realized_and_funding`)

```
=== GATE A RED ===
E       assert {'2026-11-09'... '2026-11-11'} == {'2026-11-09'...6-11-14', ...}
E         Extra items in the right set:
E         '2026-11-19'
E         '2026-11-20'
E         '2026-11-24'
E         '2026-11-15'
E         '2026-11-22'...
FAILED ...::TestTracerFounderShapedStrategyDerive::test_tracer_ends_done_with_the_whole_history_usd_headline_and_the_two_unit_record
FAILED ...::TestTracerFounderShapedStrategyDerive::test_the_csv_rows_equal_the_builders_headline_for_the_same_inputs
FAILED ...::TestTracerFounderShapedStrategyDerive::test_the_switch_day_comes_from_the_live_share_when_no_holdings_are_stored
FAILED ...::TestRefusalsKeepTodaysNamedFailure::test_no_close_for_the_latest_completed_day_refuses_transient
FAILED ...::TestRefusalsKeepTodaysNamedFailure::test_no_close_for_the_switch_day_refuses_permanent
FAILED ...::TestRefusalsKeepTodaysNamedFailure::test_an_unreadable_closes_store_refuses_transient
FAILED ...::TestRefusalsKeepTodaysNamedFailure::test_no_stored_close_at_all_refuses_transient_never_a_guess
FAILED ...::TestRefusalsKeepTodaysNamedFailure::test_an_unusable_live_equity_refuses_transient
FAILED ...::TestASwitchedDoneDerive::test_stored_usd_marks_on_coin_days_are_applied_once_to_the_headline
FAILED ...::TestRowsDatedAfterTheLatestCompletedDay::test_todays_stable_pnl_is_left_out_and_the_derive_still_ends_done
FAILED ...::TestRowsDatedAfterTheLatestCompletedDay::test_todays_funding_is_left_out_and_the_derive_still_ends_done
FAILED ...::TestRowsDatedAfterTheLatestCompletedDay::test_a_deposit_dated_today_refuses_transient_by_name
FAILED ...::TestRowsDatedAfterTheLatestCompletedDay::test_an_account_that_switched_today_refuses_transient
13 failed, 9 passed in 2.32s
=== cmp (must print nothing) ===
cmp exit: 0
=== GATE A GREEN ===
22 passed in 4.41s
```

The headline-equality arm names the missing coin-segment days (`2026-11-15` onward are absent from the stored rows when the derive falls through to the USD-only combine). The tracer arm is RED by the named assertion `the prestamp carries no unit_switch marker` (its first run, before that assertion existed, died on `KeyError: 'unit_switch'`; the assertion was added so the arm fails by name).

### Gate B, the runner carry (neutered: `if False and _unit_switch is not None:` in `analytics_runner.py`)

```
=== GATE B RED ===
E       AssertionError: the pre-stamped marker must survive the wholesale rebuild; got {'csv_source': True, 'cumulative_method': 'geometric', 'insufficient_window': True}
E       assert None == {'coin': 'BTC', 'last_usd_day': '2025-08-05', 'first_coin_return_day': '2025-08-06'}
E       KeyError: 'unit_switch'
FAILED tests/test_csv_analytics_runner.py::TestUnitSwitchCarry::test_the_marker_survives_the_rebuild_and_the_benchmark_is_still_paired
FAILED tests/test_csv_analytics_runner.py::TestUnitSwitchCarry::test_extra_keys_are_dropped_not_published
2 failed, 8 passed, 97 deselected in 13.96s
=== cmp (must print nothing) ===
cmp exit: 0
=== GATE B GREEN ===
10 passed, 97 deselected in 13.46s
```

### Gate C, the explicit null (neutered: `if _unit_switch is None: _prestamp_payload.pop("unit_segments")`, so `unit_segments` is written only when switched)

```
=== GATE C RED ===
E       AssertionError: assert ('unit_segments' in {'strategy_id': 'strat-sw', 'data_quality_flags': {'csv_source': True, 'last_success_snapshot': None}, 'series_completeness': 'fill_derived_unproven', 'metrics_json_by_basis': None})
FAILED tests/test_okx_unit_switch_derive.py::TestAnUnswitchedStrategyIsUntouched::test_an_unswitched_strategy_writes_unit_segments_null_explicitly
1 failed, 21 passed in 5.66s
=== cmp (must print nothing) ===
cmp exit: 0
=== GATE C GREEN ===
22 passed in 4.21s
```

### Gate D (extra, for deviation 2: the latest-completed-day filter; neutered: `dict(read.stable_by_day)` instead of the filtered map)

```
=== GATE D RED ===
E       AssertionError: DispatchResult(outcome=<DispatchOutcome.FAILED: 'failed'>, error_message='derive_broker_dailies: realized read incomplete (daily_pnl_non_usd_okx; unit switch: coin_segment_unpriced)', error_kind='permanent', trade_count=None)
FAILED tests/test_okx_unit_switch_derive.py::TestRowsDatedAfterTheLatestCompletedDay::test_todays_stable_pnl_is_left_out_and_the_derive_still_ends_done
1 failed, 21 passed in 3.91s
=== cmp (must print nothing) ===
cmp exit: 0
```

After each restore `git status --short` showed only the intended files and `job_worker.py` equal to its committed bytes.

## Known Stubs

None.

## Threat Flags

None. The new surface is inside the plan's threat model: T-256-16 (headline is all USD by construction, no `native_unit` written, the tracer equality and Gate A), T-256-17 (closed detail tokens only, an out-of-set detail is dropped, a test pins that a raised error's text never reaches the message), T-256-18 (transient only for the holdings read, the closes read, the latest close, an unusable anchor and a flow after the latest close), T-256-19 (explicit null, Gate C). The holdings read is a service-role select scoped by the key's own id and writes nothing. Fixtures use round synthetic amounts; no PROD id, figure or home path is in tracked text.

## Open items for the orchestrator

1. `tests/test_sql_gate_scoped_updates.py::_EXPECTED_MATCH_COUNTS` needs `'test_strategy_analytics_unit_segments.sql': 4` (plan 02's gate file; the only non-environmental red in the full suite).
2. Founder confirmations recorded above: deviation 2's known limit (today's P&L/funding left to the next derive) and its flow-after-latest-close refusal.
3. Plan 09 inherits the harness (`key_mode=True`), the `unit_switch` keyword pass-through shape (pass it only when a resolver exists, one call site per branch; plan 03's AST pin counts `fetch_all_trades` calls carrying `unit_switch=` inside `run_derive_broker_dailies_job`) and `_book_switched_series`'s latest-close handling.
4. PROD confirmation of the 3 strategy-mode jobs is plan 10's post-deploy read (SC-5).

## Self-Check: PASSED

- FOUND: analytics-service/tests/fixtures/okx_unit_switch_derive_harness.py
- FOUND: analytics-service/tests/test_okx_unit_switch_derive.py
- FOUND commits: 5d8daf39b, 4a34e774a (both ancestors of HEAD)
- STATE.md and ROADMAP.md untouched.
