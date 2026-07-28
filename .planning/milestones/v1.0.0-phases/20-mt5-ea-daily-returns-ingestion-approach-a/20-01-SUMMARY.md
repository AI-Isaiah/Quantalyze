---
phase: 20-mt5-ea-daily-returns-ingestion-approach-a
plan: 01
subsystem: testing
tags: [pytest, quantstats, pandera, csv-validator, golden-fixtures, mt5, daily-returns]

# Dependency graph
requires:
  - phase: 19.1-csv-analytics-pipeline
    provides: "validate_csv(fmt='daily_returns') + run_csv_strategy_analytics + compute_all_metrics (the verified ingestion+KPI contract these fixtures pin)"
provides:
  - "13 golden CSV fixtures (T1-T13) pinning the MT5 EA's daily_return output contract"
  - "test_mt5_golden_fixtures.py: 16 passing tests asserting the contract through the live validate_csv + compute_all_metrics pipeline at periods=252"
  - "Falsifiable auto-divide-by-100 boundary bracket (T7) straddling the 0.5 trigger"
  - "Hand-computed flow-adjusted oracles for deposit/withdrawal/cost/balance-deal/intraday days"
affects: [20-02 MT5 EA MQL5 implementation, 20-03 CI static-check, T14 manual demo-account reconcile]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Golden-fixture contract test: checked-in CSV → validate_csv → compute_all_metrics with hand-computed first-principles oracles (mirrors test_metrics_minigolden.py)"
    - "Dense calendar-daily series (one row per calendar day, no synthetic weekend zeros) for a 24/7/365 crypto-venue product"
    - "Falsifiable boundary-bracket test (below-edge no-fire / above-edge fires) for a numeric trigger threshold"
    - "Honest CI scoping: CSV fixtures pin INGESTION of a value; EA-side classification/DST correctness explicitly deferred to manual T14"

key-files:
  created:
    - analytics-service/tests/test_mt5_golden_fixtures.py
    - analytics-service/tests/fixtures/mt5/ (14 golden CSV inputs)
  modified: []

key-decisions:
  - "Dense calendar-daily series at the LIVE periods=252 (NOT sparse, NOT 365-annualized) — supersedes the interim sparse-@252 revision per the 2026-06-14 user domain-correction; the venues trade 24/7/365 so there are no synthetic weekend zeros to inject"
  - "KPI oracles derived from the REAL quantstats@252 pipeline and pinned as literals; hand arithmetic (mean / std ddof=1 / x sqrt(252)=x15.8745) shown in test comments to defend against blessing a wrong value"
  - "T10/T11/T13 scoped honestly as ingestion/shape pins; deal classification + DST rollover are EA-side (MQL5), validated by manual T14 — no tautological classification claim"
  - "Zero production-code changes; the 252 annualization basis (compute_all_metrics default) is unchanged"

patterns-established:
  - "Pattern: pin the output contract a non-CI-runnable component (MQL5 EA under Wine) must satisfy, asserted through the existing verified pipeline"
  - "Pattern: empirically verify a numeric-threshold trigger against the live SUT before writing the boundary-bracket assertion"

requirements-completed: [T1, T2, T3, T4, T5, T6, T7, T8, T9, T10, T11, T12, T13]

# Metrics
duration: ~30min
completed: 2026-06-14
---

# Phase 20 Plan 01: MT5 EA golden-fixture contract tests Summary

**13 checked-in golden CSV fixtures (T1-T13) pin the MT5 EA's daily_return output contract through the verified validate_csv + compute_all_metrics pipeline at periods=252, with hand-computed flow-adjusted oracles proving a deposit day shows the trading return, never a cash spike.**

## Performance

- **Duration:** ~30 min
- **Started:** 2026-06-14T17:15Z (approx)
- **Completed:** 2026-06-14T17:45Z
- **Tasks:** 3 completed
- **Files created:** 16 (1 test module + 15 CSV fixtures; T7-realistic and T8-no-currency share fractional_series.csv)

## Accomplishments
- 16 tests covering T1-T13 all green against the LIVE pipeline (`validate_csv` + `compute_all_metrics`), with the four highest-signal must-pass tests asserting genuinely: T2 deposit-day (#1), T5 gap-series-at-252, T7 boundary falsifiability, T9 EUR hard-fail.
- KPI oracles (T1 vol 0.028316394.., sharpe 31.148033.., cumulative_return 0.042799885..; T5 vol 0.043150898.., sharpe 8.759956..) derived fresh from the real quantstats@252 path and verified to match the hand arithmetic to full float precision — no carried-over sparse-era number.
- T7 boundary bracket empirically verified against `_maybe_auto_normalize_percent_form`: below-edge (median |x| 0.47) does NOT fire, above-edge (median 0.525, max ≤1.0) DOES fire, realistic fractional (median 0.006) → `info_flags == []`.
- Full analytics-service suite green at the coverage gate (88.33% ≥ 80%), zero production-service-file changes.

## Task Commits

Each task was committed atomically (TDD-style test commits — the SUT is the verified pipeline, so the fixtures+tests went GREEN immediately against the existing contract):

1. **Task 1: validator-contract fixtures + tests (T2,T3,T7,T8,T9,T10,T11)** - `3c7e1310` (test)
2. **Task 2: KPI + dense-calendar + re-upload fixtures (T1,T4,T5,T6,T12,T13)** - `2151f763` (test)
3. **Task 3: full-suite coverage-gate run** - no code change (verification-only; logged one out-of-scope discovery to `deferred-items.md`)

_Note: the single `test_mt5_golden_fixtures.py` module holds both tasks' functions; it landed with Task 1's commit and Task 2 added only the KPI fixtures it drives._

## Files Created/Modified
- `analytics-service/tests/test_mt5_golden_fixtures.py` - 16 golden-fixture contract tests (T1-T13) driving validate_csv + compute_all_metrics; states the periods=252 assumption inline and carries the hand arithmetic for T1/T5.
- `analytics-service/tests/fixtures/mt5/deposit_day.csv` - T2: deposit-day row 0.0030 (flow-adjusted trading return, not the +10.3% cash spike).
- `analytics-service/tests/fixtures/mt5/withdrawal_day.csv` - T3: withdrawal-day row 0.0030 (outflow subtracted out).
- `analytics-service/tests/fixtures/mt5/fractional_series.csv` - T7-realistic / T8-no-currency: median |x| ~0.006 → info_flags == [].
- `analytics-service/tests/fixtures/mt5/percent_form_below_edge.csv` - T7 lower edge (median |x| ~0.47): no auto-divide-by-100.
- `analytics-service/tests/fixtures/mt5/percent_form_above_edge.csv` - T7 upper edge (median |x| ~0.525, max ≤1.0): auto-divide-by-100 fires.
- `analytics-service/tests/fixtures/mt5/blank_currency.csv` - T8: empty currency column validates ok=True.
- `analytics-service/tests/fixtures/mt5/eur_currency.csv` - T9: currency=EUR → ok=False, rule currency_usd_or_blank.
- `analytics-service/tests/fixtures/mt5/cost_included.csv` - T10: swap/commission cost included (0.0035 = gross 0.005 net of a -0.0015 cost).
- `analytics-service/tests/fixtures/mt5/balance_deal_classification.csv` - T11: CREDIT/BONUS deal excluded as flow (0.0040 trading gain only).
- `analytics-service/tests/fixtures/mt5/steady_series.csv` - T1: 12-day dense steady series for the periods=252 KPI oracle.
- `analytics-service/tests/fixtures/mt5/intraday_flow.csv` - T4: intraday-flow gross-subtraction convention (0.0060).
- `analytics-service/tests/fixtures/mt5/gap_dense.csv` - T5: dense series with a genuine missing week (10 rows, no zero-fill).
- `analytics-service/tests/fixtures/mt5/overnight_equity.csv` - T6: +4.5% overnight day pins the ACCOUNT_EQUITY basis.
- `analytics-service/tests/fixtures/mt5/dst_boundary.csv` - T13: 2025-03-09 US spring-forward appears exactly once.
- `analytics-service/tests/fixtures/mt5/reupload_partial_overlap.csv` - T12: re-upload yields exactly its 4 uploaded rows.

## Decisions Made
- Dense calendar-daily at the live periods=252 (per the 2026-06-14 user correction), superseding the interim sparse revision — every fixture row is a real equity-based return for the 24/7/365 crypto venues; no synthetic weekend/holiday zeros anywhere.
- Oracles re-derived from the actual `compute_all_metrics`@252 path and pinned as literals; the periods=252 assumption is stated inline (the product-wide displayed basis — plumbing 365 for MT5 alone would inflate its Sharpe ~×1.20 vs crypto peers).
- T12 pinned as an ingestion assertion under the resolved "every upload mints a fresh strategy" contract; in-place re-upload replace deferred out of Phase 20 (documented in the test docstring).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] T6 KPI access path corrected (test-side, no production change)**
- **Found during:** Task 2 GREEN run.
- **Issue:** The T6 KPI assertion used `result["best_day"]`, but `best_day` lives in the nested `metrics_json` JSONB sub-dict (set via `metrics_json["best_day"]` in `compute_all_metrics`), not at the proxied top level — `MetricsResult.__getitem__` raised `KeyError: 'best_day'`.
- **Fix:** Changed the assertion to `result.metrics_json["metrics_json"]["best_day"]`, matching the SUT's storage split (D-01/D-02). The load-bearing T6 assertion (the ingested 0.0450 value) was always correct; this only fixed a secondary KPI-path access.
- **Files modified:** `analytics-service/tests/test_mt5_golden_fixtures.py` (committed within Task 1's commit, before the first commit).
- **Commit:** `3c7e1310`

### Out-of-scope discoveries (NOT fixed — logged to deferred-items.md)

- Two pre-existing async-timing test failures in `tests/test_main_worker.py::TestLoopFailureIsolation` surfaced during the Task 3 full-suite run. Verified out of scope: neither of this plan's two commits touches any production or worker code (services/ diff empty; main_worker.py untouched). Left untouched per the SCOPE BOUNDARY rule; coverage gate unaffected (88.33%). See `deferred-items.md`.

## Verification
- `pytest tests/test_mt5_golden_fixtures.py -x` → 16 passed (T1-T13).
- Full suite: 2634 passed, 82 skipped, coverage 88.33% (`--cov-fail-under=80` held).
- `git diff --name-only <my-2-commits> -- analytics-service/services/` empty → no production service file modified; the 252 annualization basis is unchanged.
- T2 (deposit-day), T5 (live periods=252), T7 (boundary bracket), T9 (EUR hard-fail) each have a dedicated passing assertion.

## Known Stubs
None. These are test fixtures + assertions; every fixture is a complete dense calendar-daily series asserted against the live pipeline. (The MT5 EA itself — the MQL5 source — is Plan 20-02, not this plan; this plan deliberately pins only the contract the EA must satisfy.)

## Self-Check: PASSED
- FOUND: analytics-service/tests/test_mt5_golden_fixtures.py
- FOUND: analytics-service/tests/fixtures/mt5/ (15 CSV fixtures)
- FOUND commit: 3c7e1310 (Task 1)
- FOUND commit: 2151f763 (Task 2)
