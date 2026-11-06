---
phase: 188-tinybase-a-day-measured-against-a-near-empty-account-does-no
plan: 05
subsystem: analytics-service
tags: [tiny-base, derive, key-inputs, dropped-day-pnl, series-runner, d-02, d-04, sc-2, sc-5]
requires: ["188-01", "188-02", "188-03", "188-04"]
provides:
  - "services/tiny_base.py: tiny_base_day_list, realized_tiny_base_pnl"
  - "key_inputs.tiny_base_days (present-only ascending ISO days) and prestamp data_quality_flags.tiny_base_days"
  - "key_inputs.dropped_day_pnl rows for every realized-era tiny day the book does not already hold, on every venue"
  - "analytics_runner: tiny_base_days validated, subtracted from the covered days, published; DataQualityFlags declares tiny_base_days and tiny_base_guard"
affects: [key-mode-derive, strategy-prestamp, series-runner, allocator-equity-compose]
tech-stack:
  added: []
  patterns: ["call-site additions only in job_worker.py", "ISO days persisted, amounts never"]
key-files:
  created:
    - analytics-service/tests/test_tiny_base_derive_flags.py
    - analytics-service/tests/test_tiny_base_runner.py
  modified:
    - analytics-service/services/tiny_base.py
    - analytics-service/services/job_worker.py
    - analytics-service/services/analytics_runner.py
key-decisions:
  - "D-04 (founder 2026-11-03, split by era) is what was built: a marked-era tiny day is subtracted from _covered_days (flagged gap, history kept); a realized-era one is still reinstated as NaN and breaks the chain, unchanged."
  - "D-08 (plan 04) quiet tiny days get their 0.0 dropped_day_pnl row here, because dropped_day_pnl_payload leaves a NaN day absent from its P&L out."
status: complete
commits: 4
plan_head_before: 19133660e095170adff1c42d1834675f08d06d38
plan_head_after: 8249e54ef97263bba68333ad488e8bf2397dcd62
actuals:
  tokens: 60000
  tasks: 2
  commits: 4
duration: single session plus a resume after a terminal crash
completed: 2026-11-03
---

# Phase 188 Plan 05: every derive names its tiny-base days, the book keeps their P&L, and the series runner leaves a marked-era one out as a flagged gap

**Key mode stores `tiny_base_days` and the realized tiny days' P&L on every venue (never twice), strategy mode pre-stamps `tiny_base_days` and never an amount, and the series runner treats a marked-era tiny day as a flagged gap span instead of a covered day.**

## What was built

- `services/tiny_base.py`: two pure helpers in the module's voice. `tiny_base_day_list(realized_days, marks_since, marked_days=())` is the realized days strictly before `marks_since` (all when None) united with the marked days, ascending and unique; `realized_tiny_base_pnl(day_pnl, marks_since)` is the entries strictly before `marks_since` as a copy. Both refuse a non-canonical day, and the second a non-finite amount, with static text that carries no value.
- `services/job_worker.py`, `run_derive_broker_dailies_job`, additions only (0 deleted lines):
  - key mode, directly after plan 01's `_applied_marks.tiny_base_days` hunk and before `if _native_usd_inputs is not None:`. It writes `_key_inputs_payload["tiny_base_days"]` when non-empty. It then takes `realized_tiny_base_pnl(meta.get("tiny_base_day_pnl"), ...)`, drops every day `_key_inputs_payload["dropped_day_pnl"]` already holds, builds a P&L series on `returns.index`'s unit, runs `dropped_day_pnl_payload(returns, ...)`, merges, re-checks no day repeats (static-text `NavReconstructionError`) and re-sorts. A counts-only warning fires if a named day has no NaN return.
  - strategy pre-stamp, directly after the `if _applied_marks is not None:` block that writes `mark_gap_days` / `marks_trailing_since`: `_prestamp_flags["tiny_base_days"]` when non-empty. `tiny_base_guard` rides the existing `NAV_TWR_GUARD_KEYS` loop; `tiny_base_day_pnl` is never pre-stamped.
  - one counts-only log line per call site: `derive_broker_dailies: tiny-base days (days=%d realized=%d marked=%d mode=key|strategy)`.
- `services/analytics_runner.py`: `DataQualityFlags` gains `tiny_base_days: list[str]` and `tiny_base_guard: bool` at the END of the class; `_NAVMTM_DAY_LIST_KEYS` is now `("mark_gap_days", "tiny_base_days")`; `_NavmtmFlags.tiny_base_days` is its last field; the broker branch subtracts the named days from `_covered_days` right after it is built; the copy-through publishes `tiny_base_days`. `allocator_equity_compose.py` and `allocator_equity_derive.py` are untouched.

## Harness variants copied as private (the plan forbids editing a shared harness)

- `_derive_okx_key` is a private copy of `derive_key_ccxt` (it fixes the combiner meta to a constant); `_derive_okx_strategy` is a private copy of `derive_ccxt_strategy` (same reason, plus a `flows` parameter). Both take the `(returns, meta)` pair the REAL combiner produced.
- `_mt5_book_deals` and `_mt5_quiet_deals` copy the deal shape of `_mt5_deals` / plan 04's `_mt5_quiet` without `_mt5_deals`'s one-trading-deal-a-day assertion (which exists so that file builds no quiet day, and which the zero-P&L withdrawal day of `tiny_base_after_withdrawal_book` also violates).
- Imported, not copied: `_ccxt`, `_key_c_book` (plan 02), `_ccxt_quiet`, `_entries` (plan 04), `derive_mt5_key`, `compose_curve`, `levels`, the runner's `_run`, `_rows`, `_PRESTAMP`.

## TDD record

### Task 1

- RED (commit 5442ed36b), `/tmp/tinybase-05/red1.log`: 20 failed, 2 passed. The helper arms fail on `ImportError`, the OKX realized arm on `KeyError: 'tiny_base_days'`, the OKX sole-key book arm on the level assertion (`102610.03 == 102750.0`, the compose rolled back through the three days at r = 0), the MT5 and OKX quiet arms on `KeyError: '2026-02-02'`, the strategy arms on `KeyError: 'tiny_base_days'`. Every failure is an assertion on the planned behaviour; none is a fixture or collection fault.
- GREEN (commit 0b8086c44): 22 passed; the plan's ten listed modules: 370 passed, 1 skipped (pre-existing: `TEST_SUPABASE_DB_URL` unset).
- Neuter drill 1 (`/tmp/tinybase-05/job_worker.py.bak`, restored with `cp`, proved with `cmp`): the realized P&L hand-off disabled, `neuter1.log` shows 5 FAILED (OKX realized, OKX sole-key book, OKX with marks, MT5 quiet, OKX quiet). Extra drill: the "skip a day already held" filter removed, `neuter1b.log` shows 2 FAILED (the MT5 measured arm and the MT5 quiet arm, on the duplicate-day refusal).

### Task 2

- RED (commit 776c928ef), `/tmp/tinybase-05/red2.log`: 8 failed, 2 passed (marked-era gap span `[] == [{...}]`, the published list `KeyError`, five malformed-list arms that expect one warning). The "without the list" contrast arm and the "never an amount" arm pass on today's code by design.
- GREEN (commit 8249e54ef): 10 passed; `test_nav_marks_runner.py`, `test_csv_analytics_runner.py`: 86 passed together.
- Neuter drill 2 (`runner.bak`, restored with `cp`, `cmp` clean): the subtraction disabled, `neuter2.log` shows `test_a_marked_era_tiny_day_is_a_flagged_gap_and_breaks_no_chain` FAILED (1 failed, 9 passed). The first attempt was cut off by the terminal crash with a truncated log; the file was found in its neutered state, restored from the byte backup and the drill was re-run from a clean file.

## Verification

- Full CI pytest line, verbatim, from `analytics-service/`: `pytest -n auto --dist loadgroup --cov=services --cov=routers --cov=main_worker --cov-report=term-missing --cov-fail-under=80`: **13520 passed, 97 skipped** (baseline at the fork point 13488 passed, 97 skipped), coverage 94.52%, "Required test coverage of 80% reached" (`/tmp/tinybase-05/full.log`).
- CI mypy line, verbatim: `Success: no issues found in 132 source files`.
- Imported modules resolve to this checkout (`services.tiny_base.__file__` under `quantalyze-188-p05`).
- Acceptance greps: `_key_inputs_payload["tiny_base_days"]` 1, `_prestamp_flags["tiny_base_days"]` 1, `_prestamp_flags["tiny_base_day_pnl"]` 0; `tiny_base_day_pnl` in `analytics_runner.py` 0; `"tiny_base_days"` in `analytics_runner.py` 3; `^    tiny_base_days: list\[str\]$` 1 and `^    tiny_base_guard: bool$` 1; `_NAVMTM_DAY_LIST_KEYS` lists `mark_gap_days` first and `tiny_base_days` second; `job_worker.py` diff against the plan base has 0 deleted lines; no diff in `allocator_equity_compose.py` / `allocator_equity_derive.py`; `STATE.md` and `ROADMAP.md` untouched.

## Deviations from Plan

None. The plan executed as written. No existing test newly failed, so the STOP rule did not fire. Notes, not deviations:

- The OKX sole-key book arm drops the funding-day flow (2026-02-01, the series' first day, which has no return) from the key's stored flows. Otherwise the compose says `out_of_window_flow` and distrusts the curve for a reason that is not this plan's (a pre-existing OKX funding-day treatment). The compose still raises its benign `missing_return_inside_coverage` carry flag for the three tiny days, by its design for a day the writer left out; the arm pins the levels and the absence of a return row instead, which are what can fail.
- The plan's verify command names `python3 -m pytest` / `pytest` / `mypy` bare; the shared venv's binaries were used.

## Known limits (recorded, not fixed)

- `tiny_base_guard` is raised only by the realized-era core. A series whose tiny days are all marked-era carries `tiny_base_days` but no guard bool, so it stays `complete` (the list is a note, as `mark_gap_days` is). Plans 06 to 08 read the list.
- A realized tiny day named in `meta` but not NaN in `returns` is not stored (counts-only warning); no path in the repo produces that shape.

## Known Stubs

None.

## Threat Flags

None. No new endpoint, auth path, file access or schema surface; no migration; no package installed. T-188-08 (an amount in a flag or log): `tiny_base_day_pnl` is never pre-stamped or published, the strategy and runner arms assert it. T-188-09 (a malformed list moving the covered days): validated by `_read_navmtm_flags`, five malformed shapes pinned. T-188-10 (a tiny day read at r = 0): the OKX realized and MT5 quiet-day arms with the real combiner, the no-duplicate arm and both neuter drills.

## Self-Check: PASSED

Files exist: `analytics-service/services/tiny_base.py`, `job_worker.py`, `analytics_runner.py`, `analytics-service/tests/test_tiny_base_derive_flags.py`, `test_tiny_base_runner.py`. Commits 5442ed36b, 0b8086c44, 776c928ef, 8249e54ef are ancestors of HEAD (4 commits since the plan base `19133660e`).
