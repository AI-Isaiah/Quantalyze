---
phase: 104-unified-queued-path-persists-process-key-long
plan: 01
subsystem: analytics
tags: [python, basis-series, cash-settlement, dailies-canonical, strategy-analytics-series, deribit]

# Dependency graph
requires:
  - phase: 103
    provides: "services/basis_series.py shared dailies-canonical derive route (derive_basis_series / persist_basis_series) + the MTM persist seam in run_derive_broker_dailies_job"
provides:
  - "KIND_CASH_SETTLEMENT + 'cash_settlement' entry in _KIND_BY_BASIS (persist surface for the cash daily SERIES)"
  - "Optional additive benchmark-identity carry (conventions.benchmark) in derive_basis_series"
  - "Additive DARK cash_settlement series persist at the single-key broker-derive seam (SERIES-ONLY, zero readers this phase)"
affects: [105-cash-scalar-cache-of-series, 106-dark-path-route-collapse]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "New persist kind = map entry + module constant (no DDL; kind is unconstrained TEXT)"
    - "Benchmark IDENTITY STRING travels in conventions echo, decoupled from any returns fetch"
    - "Second consumer of the shared derive/persist helper at the same seam (MTM + cash)"

key-files:
  created: []
  modified:
    - analytics-service/services/basis_series.py
    - analytics-service/services/job_worker.py
    - analytics-service/tests/test_basis_series.py
    - analytics-service/tests/test_derive_broker_dailies_dualmode.py
    - analytics-service/tests/test_mtm_single_key.py

key-decisions:
  - "SERIES-ONLY: persist only the cash daily series (rows/gap_spans/conventions); NO cash SCALAR persist, NO cash_settlement key in metrics_json_by_basis (that is Phase 105, SC-4 boundary)."
  - "Cash derive called with benchmark_rets=None + unconditional benchmark_symbol='BTC' — no benchmark FETCH on the cash path; only the identity string travels in conventions."
  - "denominator_config initialized at the branch-outer scope (like mtm_returns) so the now-unconditional post-branch cash persist never hits an unbound local on the ccxt path."
  - "No DDL / no migration: reuse the hardened upsert_strategy_analytics_series_batch RPC (confirmed it has no CASE/whitelist/IN gate on kind)."

patterns-established:
  - "Additive optional keyword-only param (benchmark_symbol=None) keeps conventions byte-identical for opt-out callers (SC-4-safe)."
  - "Heal arm (result=None DELETE) mirrors the MTM Pitfall-5 discipline for the new kind."

requirements-completed: [BB-01]

# Metrics
duration: ~40min
completed: 2026-07-14
---

# Phase 104 Plan 01: additive dark cash-series persist seam Summary

**The single-key broker derive now persists the cash daily-return SERIES as the new `strategy_analytics_series` kind `cash_settlement` (additive/dark, zero readers), plus a benchmark-identity carry in the conventions echo — so Phase 105's scalar route can reproduce α/β/corr from the persisted rows.**

## Performance

- **Duration:** ~40 min
- **Tasks:** 2/2
- **Production files modified:** 2 (basis_series.py, job_worker.py)
- **Test files modified:** 3
- **Production LOC:** ~119 net insertions across the two files (logic ~30 LOC; remainder is the load-bearing block comments the plan mandated)

## Accomplishments
- Cash joined the dailies-canonical persist route: `KIND_CASH_SETTLEMENT` + `_KIND_BY_BASIS["cash_settlement"]`, with round-trip and heal proven at the helper level (no DDL — `strategy_analytics_series.kind` is unconstrained TEXT; RPC confirmed to have no kind gate).
- Added the additive keyword-only `benchmark_symbol` to `derive_basis_series`: when set, echoes `conventions.benchmark` (an identity STRING, not a returns fetch); default None leaves the three-key conventions byte-unchanged (SC-4-safe). Both Phase-104 call sites (cash AND MTM) now pass `benchmark_symbol="BTC"` for uniform identity carry.
- Wired the additive DARK cash-series persist at the broker-derive seam directly beside the Phase-103 MTM block: cash derive with `benchmark_rets=None`, unconditional `"BTC"` identity, and a `result=None` heal arm on derive reject.
- `_PAYLOAD_SCHEMA_VERSION` unchanged; MTM persist, `csv_daily_returns`, and the `strategy_analytics` prestamp (incl. `metrics_json_by_basis`) are byte-unchanged (SC-3/SC-4 by construction).

## Task Commits

1. **Task 1: cash joins _KIND_BY_BASIS + benchmark-identity conventions echo** — `cfbd36c2` (feat, TDD)
2. **Task 2: additive dark cash-series persist at the broker-derive seam** — `d75ee787` (feat, TDD)

_Plan docs live under `.planning/` (gitignored/local) — no metadata commit._

## Files Created/Modified
- `analytics-service/services/basis_series.py` — `KIND_CASH_SETTLEMENT` + map entry; additive `benchmark_symbol` kwarg → optional `conventions.benchmark`; module/docstring Phase-104 addenda.
- `analytics-service/services/job_worker.py` — outer-scope `denominator_config = None` init + `TYPE_CHECKING` import; MTM persist call site now passes `benchmark_symbol="BTC"`; the additive cash-series derive+persist block (heal arm) between the MTM persist and the CSV enqueue.
- `analytics-service/tests/test_basis_series.py` — cash kind mapping, round-trip persist, heal, benchmark-echo present/omittable; updated the unknown-basis test to an unmapped string.
- `analytics-service/tests/test_derive_broker_dailies_dualmode.py` — 5 seam behaviors (persist fires / identity independent of MTM fetch / heal on reject / key-mode absent / byte-unchanged neighbors).
- `analytics-service/tests/test_mtm_single_key.py` — 4 wiring assertions updated (see Deviations).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] `denominator_config` unbound on the ccxt path**
- **Found during:** Task 2
- **Issue:** `denominator_config` is assigned only inside the Deribit arm (`job_worker.py:2149`). The existing MTM block reads it only inside `if mtm_returns is not None:` (never reached on ccxt), so it worked. The new cash block resolves cash conventions from `denominator_config` UNCONDITIONALLY in strategy-mode, which would raise `UnboundLocalError` on a ccxt derive.
- **Fix:** Initialized `denominator_config: "ReturnsDenominatorConfig | None" = None` at the branch-outer scope (the same pattern/rationale as `mtm_returns`/`mtm_attempted`, which are read unconditionally post-branch), with a `TYPE_CHECKING` import for the annotation. Root-cause-correct: the variable is now a post-branch-read local like the others. mypy --strict clean.
- **Files modified:** `analytics-service/services/job_worker.py`
- **Commit:** `d75ee787`

**2. [Rule 3 - Blocking] 4 single-consumer wiring assertions in test_mtm_single_key.py**
- **Found during:** Task 2 (NOT in the plan's declared `files_modified`)
- **Issue:** The additive cash seam introduces a SECOND consumer of the shared `derive_basis_series`/`persist_basis_series` helpers at the same seam. Four tests pinned SINGLE-consumer call counts (`assert_called_once()`, `call_args`, `seen_periods == [365]`) and necessarily observe two calls now — they cannot stay green without modification (the plan's "WITHOUT modification" claim did not account for these `assert_called_once` wiring tests).
- **Fix:** Updated the four assertions MINIMALLY to disambiguate the MTM call (first) from the new cash call (second), preserving exactly what each guards: MTM routes through the shared derive; MTM persists the SAME result; degrade/not-attempted heals the MTM row; crypto √365 clock. Affected tests: `test_single_key_routes_through_shared_derive_and_persists`, `test_single_key_derive_helper_valueerror_degrades_and_heals`, `test_single_key_not_attempted_heals_series_row`, `test_mtm_periods_uses_crypto_clock_from_real_select`.
- **Files modified:** `analytics-service/tests/test_mtm_single_key.py`
- **Commit:** `d75ee787`

**3. [Rule 1 - Test robustness] `check_freq=False` on the cash round-trip assert**
- **Found during:** Task 1
- **Issue:** The persisted rows carry no index frequency (a list of ISO dates), so a rebuilt Series has `freq=None` while the source fixture retains its `date_range` `<Day>` freq → `assert_series_equal(check_exact=True)` failed on the freq attribute only.
- **Fix:** Added `check_freq=False`; the round-trip guarantee is byte-exact values + dates, not the pandas freq attribute.
- **Files modified:** `analytics-service/tests/test_basis_series.py`
- **Commit:** `cfbd36c2`

## Acceptance-Criteria Results
- **NO-DDL CONFIRM (confirm-not-discover):** `upsert_strategy_analytics_series_batch.sql` body is `INSERT ... SELECT ... FROM jsonb_each(p_kinds) ON CONFLICT ...` — NO `CASE`/whitelist/`IN(...)` gate on `kind`. Premise holds; no migration written. **PASS.**
- **Series-only boundary:** the single-key prestamp `metrics_json_by_basis` is unchanged (`{"mark_to_market": ...}` or `None`); NO `cash_settlement` key added on the broker-derive path (the `metrics_json_by_basis.cash_settlement` occurrences in job_worker.py are all in the pre-existing composite `run_stitch_composite_job`, lines 3338+). **PASS.**
- `python -m pytest tests/test_basis_series.py tests/test_derive_broker_dailies_dualmode.py tests/test_mtm_single_key.py -q` → **62 passed.**
- `grep -c '"cash_settlement"'` (non-comment) basis_series.py = 3 (≥1); `grep -c 'basis="cash_settlement"'` (non-comment) job_worker.py = 1.
- `_PAYLOAD_SCHEMA_VERSION` = 1 (unchanged).
- Production diff confined to `basis_series.py` + `job_worker.py`; no `analytics_runner.py` / `metrics.py` / migration changes.
- `mypy services/job_worker.py services/basis_series.py` → Success, no issues.
- Broader regression: `test_job_worker.py` (derive/broker, 32 passed), `test_stitch_composite_job.py` + `test_csv_analytics_runner.py` + `test_zavara_acceptance.py` + `test_composite_headline_parity.py` + `test_allocated_capital.py` (173 passed).

## Known Stubs
None — the cash series is a DARK additive write by design (zero readers this phase, per the locked SERIES-ONLY boundary). Phase 105/106 collapse the scalar route onto it. This is an intentional, plan-documented dark write, not a stub.

## Self-Check: PASSED
- `analytics-service/services/basis_series.py` — FOUND
- `analytics-service/services/job_worker.py` — FOUND
- Commit `cfbd36c2` — FOUND
- Commit `d75ee787` — FOUND
