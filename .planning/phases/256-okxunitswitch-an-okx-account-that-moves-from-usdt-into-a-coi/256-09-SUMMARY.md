---
phase: 256-okxunitswitch
plan: 09
subsystem: analytics-service
tags: [okx, unit-switch, btc, derive, key-mode, allocator-compose, readers, proof-01]
status: complete

requires:
  - phase: 256-04
    provides: build_switched_series, SwitchedSeries
  - phase: 256-06
    provides: run_switched_derive harness, the strategy-mode resolver and combine branch, _unit_segments_payload
provides:
  - "services/job_worker.py: OKX key mode hands the bills read the unit-switch resolver; _SwitchedKeyUsd / _switched_key_usd (the switched key's whole-history USD day P&L, realized terminal, unpriced_days, segment_terminals); additive key_inputs.unit_segments"
  - "services/allocator_equity_compose.py: read_native_key_inputs honours unpriced_days / segment_terminals for a key that carries them without a native_unit"
  - "tests/test_okx_unit_switch_key_mode.py and tests/test_okx_unit_switch_readers.py"
affects: [256-10]

plan_head_before: aa6f81e3b53c9dfc271329dafd1f8ba49bb9e666
plan_head_after: 61ead1a958a2caa0a158f774a29e4593da996997

# actuals (#2632): chars/4 over the added lines of the realized diff (55732 chars: job_worker.py +175,
# compose +9, the two new test files, two small edits to existing test files). commits is MEASURED from
# the per-plan ledger; the SUMMARY commit that follows is not in that range. Task 3 is gates only.
actuals:
  tokens: 13900
  tasks: 3
  commits: 3

tech-stack:
  added: []
  patterns: ["one-call-site resolver keyword, passed only when set (both modes, OKX only)", "key states the same pair (unpriced_days, segment_terminals) a native key does, with no unit flag", "reader tests fed the real derive output, derive DONE asserted first"]

key-files:
  created:
    - analytics-service/tests/test_okx_unit_switch_key_mode.py
    - analytics-service/tests/test_okx_unit_switch_readers.py
  modified:
    - analytics-service/services/job_worker.py
    - analytics-service/services/allocator_equity_compose.py
    - analytics-service/tests/test_derive_broker_dailies_dualmode.py
    - analytics-service/tests/test_okx_unit_switch_derive.py

key-decisions:
  - "No writer basis and no writer_basis_withheld token for the switched OKX key: a ccxt key composes on the stored returns (WRITER_BASIS_VENUES is MT5 and Deribit), the roll is exact here, and a stored withheld token would BLOCK the book (the compose raises key_inputs_mismatch for any key carrying one)"
  - "The key's flows stay the original USD flows; the converter's flows (native x close) are the same dollars and are asserted equal in the tests, not stored"
  - "Hole ends and their levels are recomputed over the WHOLE key's event days (a hole after S ends at S), not taken from the converter, which sees coin days only"

requirements-completed: [SC-2, SC-3, SC-5, SC-7]

duration: about 4h
completed: 2026-11-27
---

# Phase 256 Plan 09: DERIVE-KEY Summary

**The key-mode derive of an OKX account that moved from USDT into BTC now ends DONE where origin/main ends `failed_final` with `daily_pnl_non_usd_okx`. Its `key_inputs` row carries the whole-history USD key (returns, day P&L, flows, realized terminal, `unpriced_days`, `segment_terminals`) plus an additive `unit_segments` in the plan-02 shape and no `native_unit`; the allocator compose reads it as a USD key and withholds an unpriced coin day by name. Every unchanged Python reader is pinned on the real derive output.**

## What was built

- **Key mode opens (`run_derive_broker_dailies_job`).** `_unit_switch_resolver` is `_resolve_unit_switch if venue == "okx" else None` (the `not is_key_mode` condition is gone). The call shape is unchanged: two literal `fetch_all_trades` branches, `unit_switch=` passed only when a resolver exists, so every non-OKX call stays byte-identical and plan 03's AST pin (one call site carrying `unit_switch=`) still passes. `_book_switched_series` is reused as is and, in key mode, also builds the key's USD inputs from the SAME closes read (one read, `closes_reads == 1`).
- **`_switched_key_usd` (new, beside `_convert_native_key_to_usd`).**
  - Coin segment: `_convert_native_key_to_usd(unit=coin, closes, native_returns=<coin_returns with the base day S prepended as NaN>, native_day_pnl=coin_day_pnl, native_nav_levels=coin_nav_levels, native_flow_by_day=coin_flow_by_day)`. Every coin-day USD P&L is the native P&L times that day's own close; a day with no close is left out and named.
  - USD segment: `split.usd_by_day` plus the funding rows dated through S.
  - Joined: `day_pnl` (whole history), `realized_terminal` (coin level on the last priced day x its close; when no coin day is priced, S's level `coin_base_level x close(S)`), `unpriced_days`, `priced_through`, and `segment_terminals` recomputed over the WHOLE key's event days (a hole just after S ends at S).
  - Wired at the combine site into `_day_pnl_usd`, `_realized_terminal` and `_native_usd_inputs` (the existing variables, so the marks block's `priced_through` update and the epilogue's `.update(...)` apply unchanged), with no `native_unit` key.
- **Epilogue.** `key_inputs.unit_segments = _unit_segments_payload(switch, switched, returns)` over the FINAL returns (after marks), present only for a switched key. `grep -c "unit_segments" job_worker.py`: **4 before, 5 after** (plan 06's count was 4).
- **Compose reader.** `read_native_key_inputs` returned `None` for any key without `native_unit`, so `unpriced_days` / `segment_terminals` were honoured for native keys alone. It now returns the fields for a key that carries either, without requiring a unit; the unit is validated only when present. A USD key with neither field is still `None`, and a native key reads byte-identically (`test_the_reader_is_unchanged_for_a_usd_key_and_a_native_unit_key`, and the existing native suites pass unedited). `compose_allocator_equity` itself did not change: it keys on the per-key maps, never on a unit.
- **Tests.** `test_okx_unit_switch_key_mode.py` (11 tests: tracer, strategy-equals-key headline, terminal, flows, marker clear, marks on coin days through the compose, day P&L pricing, missing close by name, compose withholds by name, reader unchanged) and `test_okx_unit_switch_readers.py` (8 tests, one per reader).

## OKX v5 field semantics

No new venue field is read. Key mode relies on the same `GET /api/v5/account/balance` `totalEq` / `details[].eqUsd` and the same bills fields (`ccy`, `pnl`, `fee`) that plans 03 and 06 consulted and recorded. I did not fetch the docs in this run, because this plan adds no new reliance on a venue field.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - plan premise] Two existing tests pinned the behaviour this plan opens, so they were edited, against the acceptance line "existing compose and dual-mode suites pass unedited".**
- `tests/test_derive_broker_dailies_dualmode.py::TestRealizedReadRefusedByName::test_the_derive_asks_for_the_read_deadline_because_it_alone_drains_the_flags` asserted the OKX key derive calls `fetch_all_trades` with exactly `{since_ms, read_deadline_s}`. An OKX key derive now also passes `unit_switch=<resolver>`, which is what the plan asks for. The test now asserts the resolver is passed for `okx` and that `bybit` and `binance` keep the exact original kwargs, so the byte-identity pin is kept where it still applies.
- `tests/test_okx_unit_switch_derive.py::TestRefusalsKeepTodaysNamedFailure::test_key_mode_still_refuses_exactly_as_before` was plan 06's own "until plan 09" pin; it became `test_key_mode_hands_the_read_the_resolver_since_plan_09`.
- Both files are outside the plan's `files_modified`; the compose suites (`test_allocator_equity_native_unpriced.py`, `test_derive_allocator_equity_job.py`, `test_nav_marks_compose_roundtrip.py`) pass unedited.

**2. [Rule 1 - plan wording] No writer basis, and no `writer_basis_withheld` token, for the switched OKX key.** The plan allowed "set the writer basis to None with an existing WRITER_BASIS_WITHHELD_TOKENS reason". Storing a token would be wrong: the compose reads any stored `writer_basis_withheld` as a BLOCKING `key_inputs_mismatch`, and the store gate only runs for `WRITER_BASIS_VENUES` (MT5, Deribit). A ccxt key composes on the stored returns, which is exact for this series: a coin day's USD return `(1+r)*c_d/c_(d-1)-1` inverts with the flow priced at its own day's close, which is the USD flow the key already stores. So the key stores neither a basis nor a token, like every other OKX key. The converter's own `writer_basis_reason` is not used.

**3. [Rule 2 - hole ends over the whole key] `segment_terminals` are recomputed in `_switched_key_usd`, not taken from the converter.** `_convert_native_key_to_usd` finds holes among coin days only; the whole key also has the USD segment, so a hole just after S ends at S (whose level is `coin_base_level x close(S)`). A hole end BEFORE S states no level (`coin_nav_levels` starts at S); the compose then reports the missing level by name and composes the key unsplit (`key_inputs_mismatch`), never a guess. Reachable only if an unpriced stretch follows a USD event strictly before S, which needs S's neighbours to be unpriced, and S itself must have a close or the series is refused. Recorded, not exercised.

**4. [Test shape] The USD day P&L is observable only through the helper.** The key payload carries day P&L only as `dropped_day_pnl` (days whose return is NaN), which is `[]` for a healthy account, so the pricing identity "coin-day P&L = native P&L x that day's own close" is pinned on `_switched_key_usd` directly, after a key derive asserted DONE. Gate A fires there.

**5. [RED method] "RED on origin/main" is shown with two instruments, stated plainly.** Literal origin/main cannot import the harness or `services.unit_switch` (plans 01 to 06 added them), so: (a) the key-mode tests were run against the plan-06 base `job_worker.py` + `allocator_equity_compose.py` swapped in from `aa6f81e3b` (10 of the 11 tests fail at the derive-DONE assertion; the 11th is the named control); (b) the six strategy-mode reader tests PASS on that base, because plan 06 already opened strategy mode, so for them the derive was neutered to refuse as origin/main does (`_unit_switch_resolver = None`): all 8 reader tests fail at `assert ... outcome == DONE` with `daily_pnl_non_usd_okx`. See "RED" below.

**6. [A3 settled] `mt5_parity*` and `flowtiming_dry_run` are gated by different things, neither a Python venue branch in `mt5_parity`.** `services/mt5_parity*` has no venue code; the accounts it reads come from the committed capture statements, each scoped `ak.exchange = 'mt5'`, so the test pins that predicate on every keyed statement. `scripts/flowtiming_dry_run.py` does take an OKX key into its non-MT5 group (it counts how gate verdicts flip); its MT5 loop and MT5 re-derivation key on `venue == "mt5"`, and the test asserts an OKX key produces no `mt5_keys` / `mt5_rows`. RESEARCH assumption A3 was therefore right for the series and slightly wrong for the dry run's counting.

**7. [Trailers] No Co-Authored-By / Claude-Session trailer on any commit**, per the orchestrator rules and the founder's no-AI-attribution rule, which override the harness attribution reminder.

**8. [Environment] The worktree has no `.venv`.** pytest and mypy ran from the main checkout's Python 3.12 venv, read-only, from the worktree's `analytics-service/` directory.

### Notes (not deviations)

- Tracer order: the implementation was written before the tests and the first run was GREEN; the RED evidence is therefore the base-swap and neuter runs below, the same honest account plan 04 gave.
- Key mode with stored USD marks dated inside the coin segment (the founder account's PROD shape) was exercised end to end (`TestKeyModeWithStoredMarks`): the marks are applied once to the same headline the strategy derive gets, the realized terminal moves to the last mark day, `priced_through` follows, and the compose composes the key with no `key_inputs_mismatch`.
- 194 D-15 total-record gate: the runner stores `metrics_json.record_observations` of the whole headline (91) and `record_clears(90, 91, crypto)` is true; over the BTC segment alone (13 rows) it is false and `insufficient_window` is set.

## Reader table (every row of RESEARCH's Python census)

| Reader | Rule | Test |
|---|---|---|
| `services/exchange.py` fetch (OKX branch) | keeps refusing with no switch; books coin bills only with a resolver | plan 03 (`test_okx_unit_switch_fetch.py`); run for real by every derive test here |
| `services/job_worker.py` derive, key + strategy | ends DONE; whole-history USD headline; key states USD inputs, no `native_unit` | `test_okx_unit_switch_derive.py` (plan 06), `test_okx_unit_switch_key_mode.py` (this plan) |
| `job_worker._marks_in_series_unit` / apply block | marks apply once to the all-USD headline (no unit) | `test_stored_usd_marks_on_coin_days_are_applied_once_to_the_headline` (plan 06); `test_marks_on_coin_days_are_applied_once_and_the_key_still_composes` (this plan, key mode) |
| `services/nav_twr.py`, `services/account_unit.py` | unchanged; one engine run per unit, never chained | plan 04 (`test_unit_switch_series.py`) |
| `services/native_to_usd.py` converters | used per coin segment only, never on the whole row | `_convert_native_key_to_usd` called on the coin segment (key-mode tests); every reader test asserts the closes loader is not awaited for the row |
| `services/analytics_runner.py` | reads the row as USD: benchmark paired, whole record counted by the KPI gate | `test_analytics_runner_pairs_the_benchmark_and_counts_the_whole_record` |
| `services/wealth_returns.py` | `keep_absent` is for native-unit rows only; the switched row reads as USD, no NaN placeholder | `test_wealth_returns_reads_the_switched_row_as_usd_without_a_placeholder` |
| `services/allocator_equity_compose.py` | key states a USD book level; an unpriced coin day is withheld by name | `test_the_compose_withholds_the_unpriced_days_by_name_and_books_the_rest_in_usd`, `test_the_reader_is_unchanged_for_a_usd_key_and_a_native_unit_key` |
| `services/strategy_matching.py` | converts only native-unit candidates; the switched row is correlated as it stands | `test_strategy_matching_correlates_the_switched_row_in_usd_without_conversion` |
| `routers/match.py` | both loaders read `native_unit` only; `unit_switch` is no unit | `test_match_router_loaders_read_the_switched_row_as_usd_without_a_unit` |
| `routers/portfolio.py` | blends the row as USD; closes never read | `test_portfolio_router_reads_switched_row_as_usd_without_conversion` |
| `routers/simulator.py` | weights the candidate as USD; closes never read | `test_simulator_router_reads_switched_row_as_usd_without_conversion` |
| `services/mt5_parity*.py` | an OKX key never enters (capture SQL is the venue gate) | `test_the_mt5_parity_capture_never_selects_an_okx_key` |
| `scripts/flowtiming_dry_run.py` | an OKX key is counted as non-MT5, never MT5-re-derived | `test_the_flowtiming_dry_run_never_treats_an_okx_key_as_mt5` |
| `services/okx_archive_job.py`, `routers/cron.py` | keep refusing a switched account by name | plan 03's refusal pins (`test_okx_unit_switch_fetch.py`) |

## Verification

- `tests/test_okx_unit_switch_key_mode.py tests/test_okx_unit_switch_derive.py tests/test_allocator_equity_native_unpriced.py tests/test_derive_allocator_equity_job.py tests/test_nav_marks_compose_roundtrip.py tests/test_derive_broker_dailies_dualmode.py tests/test_okx_unit_switch_fetch.py tests/test_derive_last_success_snapshot.py tests/test_nav_marks_derive_apply.py` (conftest, main venv): `511 passed, 85 warnings in 86.59s` (run before the two test-file additions below; the two new files pass 19 together: `19 passed`).
- `make typecheck` (mypy strict, CI path set, `MYPY=` pointed at the main venv's mypy): `Success: no issues found in 148 source files`. `mypy tests/test_okx_unit_switch_readers.py tests/test_okx_unit_switch_key_mode.py tests/test_okx_unit_switch_derive.py`: `Success: no issues found in 3 source files`.
- Acceptance greps: `grep -c "unit_segments" services/job_worker.py` 5 (plan 06: 4); `grep -c "^def test_\|^async def test_" tests/test_okx_unit_switch_readers.py` 8 (at least 7).
- **Full analytics suite** (`pytest -n auto --dist loadgroup -q`, conftest, main venv, no `-x`): `19 failed, 17788 passed, 107 skipped, 934 warnings in 276.04s (0:04:36)`. The 19 are the known, not-mine set and nothing else: 17 in `tests/test_metrics.py` and 1 in `tests/test_qstats_gate.py` (the quantstats version mismatch, main venv 0.0.81 vs the pin), and `tests/test_sql_gate_scoped_updates.py::test_scanner_is_not_vacuous` (plan 02's gate file, already fixed on PR-1). None is in a file this plan touches; both new test files passed inside this run, which also covers the helpers they import from `test_csv_analytics_runner`, `test_correlation_residue_sites`, `test_portfolio_router_logic` and `test_simulator_router`.

## RED (pre-fix and neutered instruments)

### Key-mode tests on the plan-06 base `job_worker.py` + `allocator_equity_compose.py` (swapped in from `aa6f81e3b`, restored byte-exact)

```
E       AssertionError: DispatchResult(outcome=<DispatchOutcome.FAILED: 'failed'>, error_message='derive_broker_dailies: realized read incomplete (daily_pnl_non_usd_okx)', error_kind='permanent', trade_count=None)
FAILED tests/test_okx_unit_switch_key_mode.py::TestTracerFounderShapedKeyDerive::test_tracer_key_derive_ends_done_with_usd_key_inputs_and_unit_segments
FAILED tests/test_okx_unit_switch_key_mode.py::TestTracerFounderShapedKeyDerive::test_the_key_returns_equal_the_strategy_headline_and_the_builders
FAILED tests/test_okx_unit_switch_key_mode.py::TestTracerFounderShapedKeyDerive::test_the_realized_terminal_is_the_coin_level_priced_at_the_last_days_own_close
FAILED tests/test_okx_unit_switch_key_mode.py::TestTracerFounderShapedKeyDerive::test_flows_on_coin_days_are_the_native_flow_times_that_days_own_close
FAILED tests/test_okx_unit_switch_key_mode.py::TestTracerFounderShapedKeyDerive::test_a_done_key_derive_clears_its_read_incomplete_marker_and_enqueues_the_compose
FAILED tests/test_okx_unit_switch_key_mode.py::TestKeyModeWithStoredMarks::test_marks_on_coin_days_are_applied_once_and_the_key_still_composes
FAILED tests/test_okx_unit_switch_key_mode.py::TestUsdDayPnlOfTheWholeKey::test_usd_day_pnl_for_coin_days_is_priced_at_each_days_own_close
FAILED tests/test_okx_unit_switch_key_mode.py::TestUsdDayPnlOfTheWholeKey::test_a_close_missing_on_a_coin_day_leaves_its_pnl_out_and_names_the_day
FAILED tests/test_okx_unit_switch_key_mode.py::TestAMissingCloseWithholdsTheDayByName::test_the_payload_names_the_unpriced_days_and_the_level_before_the_hole
FAILED tests/test_okx_unit_switch_key_mode.py::TestAMissingCloseWithholdsTheDayByName::test_the_compose_withholds_the_unpriced_days_by_name_and_books_the_rest_in_usd
10 failed, 1 passed in 10.53s
=== cmp (must print nothing) ===
cmp exit: 0
```

The test that passes on the base is `test_the_reader_is_unchanged_for_a_usd_key_and_a_native_unit_key`, the named control. All ten failures stop at the derive-DONE assertion on the base (`AssertionError: DispatchResult(... FAILED ... daily_pnl_non_usd_okx ...)`); none is an ImportError. (An earlier run of the first draft of this file had two helper tests die on ImportError; they now assert the derive DONE first.)

### Reader tests with the derive neutered to refuse as origin/main does (`_unit_switch_resolver = None`, restored byte-exact)

```
E       AssertionError: DispatchResult(outcome=<DispatchOutcome.FAILED: 'failed'>, error_message='derive_broker_dailies: realized read incomplete (daily_pnl_non_usd_okx)', error_kind='permanent', trade_count=None)
FAILED tests/test_okx_unit_switch_readers.py::test_analytics_runner_pairs_the_benchmark_and_counts_the_whole_record
FAILED tests/test_okx_unit_switch_readers.py::test_match_router_loaders_read_the_switched_row_as_usd_without_a_unit
FAILED tests/test_okx_unit_switch_readers.py::test_portfolio_router_reads_switched_row_as_usd_without_conversion
FAILED tests/test_okx_unit_switch_readers.py::test_simulator_router_reads_switched_row_as_usd_without_conversion
FAILED tests/test_okx_unit_switch_readers.py::test_strategy_matching_correlates_the_switched_row_in_usd_without_conversion
FAILED tests/test_okx_unit_switch_readers.py::test_the_flowtiming_dry_run_never_treats_an_okx_key_as_mt5
FAILED tests/test_okx_unit_switch_readers.py::test_the_mt5_parity_capture_never_selects_an_okx_key
FAILED tests/test_okx_unit_switch_readers.py::test_wealth_returns_reads_the_switched_row_as_usd_without_a_placeholder
8 failed in 10.23s
```

## PROOF-01 (each gate seen RED by assertion, byte restore, GREEN)

Byte backups with `cp` to the scratchpad, one-site neuter via a script that asserts exactly one occurrence, restore with `cp`, `cmp` silent, GREEN. No `git checkout`, `restore` or `stash`; the production file was clean at HEAD (`git status --short` empty) after each restore.

### Gate A, pricing (neutered: `coin_pnl = (switched.coin_day_pnl * close_by_day[s_ts]).copy()`, every coin day priced at S's close)

```
=== GATE A RED ===
E       assert -101.7 == -104.39999999999999 ± 1.0e-04
E         comparison failed
E         Obtained: -101.7
E         Expected: -104.39999999999999 ± 1.0e-04
E       AssertionError: assert Timestamp('2026-11-19 00:00:00') not in DatetimeIndex(['2026-11-09', '2026-11-11', '2026-11-13', '2026-11-14', ...
FAILED tests/test_okx_unit_switch_key_mode.py::TestUsdDayPnlOfTheWholeKey::test_usd_day_pnl_for_coin_days_is_priced_at_each_days_own_close
FAILED tests/test_okx_unit_switch_key_mode.py::TestUsdDayPnlOfTheWholeKey::test_a_close_missing_on_a_coin_day_leaves_its_pnl_out_and_names_the_day
2 failed, 9 passed in 9.68s
=== cmp (must print nothing) ===
cmp exit: 0
=== GATE A GREEN ===
11 passed in 12.53s
```

The RED names the pricing identity (`pnl[day -8] == native fee x that day's own close`: -0.0009 BTC x its close is -104.4, priced at S's close it is -101.7). It fires on the helper test because the key payload shows day P&L only as `dropped_day_pnl` (`[]` for a healthy account).

### Gate B, no unit flag (neutered: `native_unit` written into the key payload AND the strategy prestamp flags)

```
=== GATE B RED ===
E       assert 'native_unit' not in {'flows': [], 'anchor_usd': 200000.0, 'anchor_null_reason': None, 'anchor_asof': ..., ...}
E       AssertionError: {'csv_source': True, 'native_unit': 'BTC', 'unit_switch': {'coin': 'BTC', 'last_usd_day': '2026-11-13', 'first_coin_return_day': '2026-11-14'}, 'last_success_snapshot': None}
E       assert ('unit_switch' in {...} and 'native_unit' not in {...})
FAILED tests/test_okx_unit_switch_key_mode.py::TestTracerFounderShapedKeyDerive::test_tracer_key_derive_ends_done_with_usd_key_inputs_and_unit_segments
FAILED tests/test_okx_unit_switch_key_mode.py::TestKeyModeWithStoredMarks::test_marks_on_coin_days_are_applied_once_and_the_key_still_composes
FAILED tests/test_okx_unit_switch_readers.py::test_analytics_runner_pairs_the_benchmark_and_counts_the_whole_record
FAILED tests/test_okx_unit_switch_readers.py::test_wealth_returns_reads_the_switched_row_as_usd_without_a_placeholder
FAILED tests/test_okx_unit_switch_readers.py::test_strategy_matching_correlates_the_switched_row_in_usd_without_conversion
FAILED tests/test_okx_unit_switch_readers.py::test_match_router_loaders_read_the_switched_row_as_usd_without_a_unit
FAILED tests/test_okx_unit_switch_readers.py::test_portfolio_router_reads_switched_row_as_usd_without_conversion
FAILED tests/test_okx_unit_switch_readers.py::test_simulator_router_reads_switched_row_as_usd_without_conversion
FAILED tests/test_okx_unit_switch_readers.py::test_the_flowtiming_dry_run_never_treats_an_okx_key_as_mt5
9 failed, 10 passed in 11.39s
=== cmp (must print nothing) ===
cmp exit: 0
=== GATE B GREEN ===
19 passed in 11.58s
```

The key tracer fails at `'native_unit' not in payload`; the reader tests fail at the shared `_flags()` precondition (`native_unit` absent from the row), the first assertion after the derive. The conversion arm itself is exercised inside the portfolio and simulator tests: each re-runs the row with a leaked `native_unit` and asserts the closes loader IS then awaited and the result differs, which holds in GREEN.

### Gate C, unpriced days (neutered: `"unpriced_days": []` in the payload)

```
=== GATE C RED ===
E       AssertionError: assert [] == ['2026-11-22', '2026-11-23']
E       KeyError: 'unpriced_native_keys'
FAILED tests/test_okx_unit_switch_key_mode.py::TestAMissingCloseWithholdsTheDayByName::test_the_payload_names_the_unpriced_days_and_the_level_before_the_hole
FAILED tests/test_okx_unit_switch_key_mode.py::TestAMissingCloseWithholdsTheDayByName::test_the_compose_withholds_the_unpriced_days_by_name_and_books_the_rest_in_usd
2 failed, 9 passed in 9.75s
=== cmp (must print nothing) ===
cmp exit: 0
=== GATE C GREEN ===
11 passed in 11.02s
```

The compose RED is `KeyError: 'unpriced_native_keys'`: with the days dropped from the payload the book no longer names the key at all.

## Known Stubs

None.

## Threat Flags

None. The new surface is inside the plan's threat model: T-256-26 (every coin-day USD figure priced at its own day's stored close; Gate A), T-256-27 (no `native_unit` on the switched key or its strategy flags; Gate B), T-256-28 (unpriced coin days named through `unpriced_days` and `segment_terminals`; Gate C). The only reader change is `read_native_key_inputs`, which still raises on a malformed unit, a malformed day list or a non-positive level. Fixtures use round synthetic amounts; no PROD id, figure or home path is in tracked text.

## Open items for the orchestrator

1. Plan 10's PROD confirmation now covers the 4 key-mode jobs as well as the 3 strategy-mode ones (SC-5): ending DONE, `key_inputs` carrying `unit_segments` and no `native_unit`.
2. The two test files edited outside `files_modified` (see deviation 1) need to travel with this plan's merge.
3. Founder confirmation carried from plan 06 still applies to key mode: today's realized P&L and funding are left to the next derive, and a deposit dated today refuses transient.

## Self-Check: PASSED

- FOUND: analytics-service/tests/test_okx_unit_switch_key_mode.py
- FOUND: analytics-service/tests/test_okx_unit_switch_readers.py
- FOUND: analytics-service/services/job_worker.py, analytics-service/services/allocator_equity_compose.py (modified)
- FOUND commits: 18ba8b00a, 05e6fd9c0, 61ead1a95 (all ancestors of HEAD)
- STATE.md and ROADMAP.md untouched (empty diff against the base).
