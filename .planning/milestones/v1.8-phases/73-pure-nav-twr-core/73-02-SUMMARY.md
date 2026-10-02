---
phase: 73-pure-nav-twr-core
plan: 02
subsystem: analytics
tags: [twr, annualization, cagr, calmar, calendar-clock, quantstats, metrics, mutation-verified]

# Dependency graph
requires: []
provides:
  - "metrics.py CAGR annualizes on the CALENDAR clock (365 / elapsed-calendar-days from the DatetimeIndex span), frequency-proof for dense crypto AND sparse CSV/MT5"
  - "metrics.py Calmar computed directly as calendar-CAGR / |max_drawdown| (quantstats calmar helper no longer called) so both headline numbers share one basis"
  - "risk metrics (Sharpe/volatility/Sortino/rolling_*/TE-IR) remain on periods_per_year (252) — return and risk are orthogonal clocks"
  - "mutation-verified TWR-05 rescale proof (CAGR shifts by the calendar factor, Sharpe unchanged) + Calmar-from-calendar-CAGR proof"
affects: [phase-78-golden-parity]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "date-span (calendar-day) annualization for the return leg, decoupled from the periods_per_year risk clock"
    - "headline Calmar computed directly (cagr/|max_dd|) rather than via qs.stats.calmar to keep a single CAGR basis"
    - "falsifiable-both-ways annualization proof: revert to len/periods form → RED; change Sharpe → RED (file-level mutation confirmed)"

key-files:
  created: []
  modified:
    - "analytics-service/services/metrics.py"
    - "analytics-service/tests/test_metrics_parity.py"
    - "analytics-service/tests/test_metrics.py"
    - "analytics-service/tests/fixtures/golden_252d_expected.json"

key-decisions:
  - "_CALENDAR_DAYS_PER_YEAR = 365.0 (not 365.25) — matches the existing 365/252 rescale-proof constant and PROJECT.md wording"
  - "CAGR exponent written as _CALENDAR_DAYS_PER_YEAR / _elapsed_days (== 1/years_calendar), reusing the already-computed total_return as the geometric base"
  - "guard: cagr = NaN when total_return is None or fewer than 2 dated points; _elapsed_days = max((idx[-1]-idx[0]).days, 1) prevents divide-by-zero on degenerate windows"
  - "Calmar = NaN when max_dd is 0/None so a flat series never divides by zero"

patterns-established:
  - "when a headline return metric changes basis, the committed golden fixture AND every downstream consumer of that metric (treynor = cagr/beta) must be re-pinned in the same commit"

requirements-completed: [TWR-05]

# Metrics
duration: ~22min
completed: 2026-07-05
---

# Phase 73 Plan 02: metrics.py TWR-05 Annualization Split Summary

**CAGR and Calmar now annualize on the true calendar clock (365 / elapsed-calendar-days) while Sharpe/volatility/Sortino/rolling_*/TE-IR stay on 252 — a mutation-verified split that stops a 24/7 crypto record's return from being mis-annualized, with the shift value-pinned in the golden fixture and gated for production behind Phase 78.**

## Performance

- **Duration:** ~22 min
- **Tasks:** 2 (Task 1 feat, Task 2 test)
- **Files modified:** 4 (metrics.py, test_metrics_parity.py, test_metrics.py, golden_252d_expected.json)
- **Verification interpreter:** CI-matching Python 3.12 venv (local 3.14 SIGSEGVs on pandas)

## Accomplishments
- CAGR at the `compute_all_metrics` call site now annualizes on the calendar clock: `years = max((idx[-1]-idx[0]).days, 1) / 365` from the true `returns.dropna()` DatetimeIndex span; `cagr = (1 + total_return) ** (_CALENDAR_DAYS_PER_YEAR / _elapsed_days) - 1`. Frequency-proof for dense crypto (a return every calendar day) AND sparse CSV/MT5 (rows < calendar days) — both were mis-read by the old `years = len/periods` at 252. (TWR-05)
- Calmar is computed DIRECTLY as `cagr / abs(max_dd)` (NaN when `max_dd == 0/None`); the quantstats calmar helper is no longer called, so it can no longer recompute its own CAGR leg at `len/periods` and diverge from the date-span CAGR. `max_dd` was reordered above the calmar site so the shared basis is available. (TWR-05, Pitfall 2)
- Sharpe, volatility, Sortino, rolling_sharpe_*, and TE/IR are byte-unchanged on `periods_per_year` (252) — verified by the preserved sqrt-class assertions in `test_periods_param_rescales_365` and the new `test_twr05_annualization_split` Sharpe-unchanged assertion. Return and risk stay orthogonal clocks.
- `test_twr05_annualization_split` (test_metrics_parity.py): a dense 365-calendar-day fixture proves the emitted CAGR equals the calendar-clock formula, DIFFERS from `qs.stats.cagr(returns, periods=252)`, and Sharpe equals `qs.stats.sharpe(returns, periods=252)` — falsifiable both ways.
- `test_calmar_uses_calendar_cagr` (test_metrics.py): Calmar == calendar-CAGR / |max_drawdown| to rtol 1e-9 AND diverges from `qs.stats.calmar(returns, periods=252)`, proving the quantstats helper is no longer the source.
- **Mutation-verified at the file level:** reverting the CAGR exponent to the pre-split `periods_per_year / len(_cagr_index)` form turned all three sensitive tests (both new + the corrected rescale proof) RED; the change was then restored via a single-file `git checkout` and re-confirmed green.
- Full `test_metrics.py` + `test_metrics_parity.py` = 162 passed (160 baseline + 2 new); `test_regen_golden_guards.py` = 17 passed (regen path exercises the new metrics math cleanly).

## Task Commits

1. **Task 1: Split CAGR/Calmar onto the calendar clock (TWR-05)** — `fab26c01` (feat)
   - metrics.py split + `golden_252d_expected.json` cagr/calmar/treynor re-pin + `test_periods_param_rescales_365` correction.
2. **Task 2: Mutation-verified TWR-05 rescale proof + Calmar-from-calendar-CAGR test** — `7b1cb441` (test)
   - `test_twr05_annualization_split` + `test_calmar_uses_calendar_cagr` + quantstats import.

**Plan metadata:** _this commit_ (docs: complete plan)

## Files Created/Modified
- `analytics-service/services/metrics.py` — `_CALENDAR_DAYS_PER_YEAR = 365.0` module constant; date-span CAGR block (reuses `total_return`, guarded against degenerate windows); direct `cagr / abs(max_dd)` Calmar; `max_dd` moved above Calmar. Risk metrics untouched.
- `analytics-service/tests/test_metrics_parity.py` — corrected `test_periods_param_rescales_365` (CAGR/Calmar now asserted INVARIANT to periods); new `test_twr05_annualization_split`; `import quantstats as qs`.
- `analytics-service/tests/test_metrics.py` — new `test_calmar_uses_calendar_cagr`.
- `analytics-service/tests/fixtures/golden_252d_expected.json` — cagr `0.021583583443333776 → 0.022454062113715922`, calmar `0.08902841319791246 → 0.09261898169411306`, treynor `0.9434605510846533 → 0.9815108724421955` (the deliberate calendar-clock shift; `cumulative_return` left unchanged).

## Decisions Made
- **`_CALENDAR_DAYS_PER_YEAR = 365.0`** (not 365.25) — matches the in-repo `365/252` rescale constant and PROJECT.md wording; assumption A3 in 73-RESEARCH.
- **CAGR exponent as `365 / elapsed_days`** (algebraically `1 / years_calendar`), reusing the module's existing `total_return` (== `comp(returns)`) as the geometric base — no second product computed.
- **Guards:** `cagr = NaN` when `total_return is None` or `< 2` dated points; `_elapsed_days = max(..., 1)`; Calmar `NaN` when `max_dd` is `0/None`.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Value pin] Re-pinned golden_252d_expected.json cagr/calmar AND treynor for the calendar-clock shift**
- **Found during:** Task 1 (Task 2 acceptance requires the whole `test_metrics_parity.py` green).
- **Issue:** The plan's `files_modified` named only metrics.py + the two test files, but `test_metrics_parity_full` asserts against the committed golden fixture, whose cagr/calmar were computed the old (252) way. `treynor` (`= cagr/beta`) is an unforeseen downstream consumer that also tracks CAGR — it failed the parity assertion first.
- **Fix:** Surgically updated the three values (cagr, calmar, treynor) in the golden JSON to the calendar-clock outputs — computed via the actual `compute_all_metrics` pipeline (parity holds to rtol 1e-12). `cumulative_return` (which shared cagr's old literal) was deliberately left unchanged.
- **Files modified:** analytics-service/tests/fixtures/golden_252d_expected.json
- **Committed in:** `fab26c01`

**2. [Rule 3 - Plan correction] Corrected test_periods_param_rescales_365 CAGR/Calmar assertions to the new invariant contract**
- **Found during:** Task 1.
- **Issue:** The plan said this test "must stay green — the risk-metric 252 threading is preserved" and assumed it was untouched. But TWR-05 decouples CAGR/Calmar from `periods_per_year`, so its old assertions (CAGR rescales geometrically, Calmar tracks it) are false-by-design after the split — the test cannot stay green unmodified.
- **Fix:** Rewrote the CAGR/Calmar sub-assertions from "rescales geometrically with periods" to "INVARIANT to periods (calendar clock)", with a falsifiable negative control that the pre-split geometric rescale must NOT hold. The sqrt-class Sharpe/Sortino/volatility + rolling + greeks-alpha + info_ratio + beta assertions are all preserved unchanged — the risk-metric 252 threading guard is intact, and the test now doubly guards the CAGR/Calmar decoupling (mutation-confirmed RED on revert).
- **Files modified:** analytics-service/tests/test_metrics_parity.py
- **Committed in:** `fab26c01`

**3. [Rule 3 - Blocking] Reworded a comment token so the acceptance grep returns 0**
- **Found during:** Task 1 (acceptance `grep -c "qs.stats.calmar"` must return 0).
- **Issue:** A new explanatory comment contained the literal `qs.stats.calmar`, tripping the plan's own acceptance grep (same class as 73-01's grep-token deviations).
- **Fix:** Reworded to "quantstats' calmar helper is NO LONGER called" — same meaning, no literal forbidden token. Grep now returns 0.
- **Files modified:** analytics-service/services/metrics.py
- **Committed in:** `fab26c01`

**4. [Rule 3 - Blocking] Added `import quantstats as qs` to test_metrics_parity.py**
- **Found during:** Task 2 (NameError on first run).
- **Issue:** The new test references `qs.stats.cagr` / `qs.stats.sharpe` as the old-basis reference, but the file did not import quantstats.
- **Fix:** Added `import quantstats as qs` to the third-party import group.
- **Files modified:** analytics-service/tests/test_metrics_parity.py
- **Committed in:** `7b1cb441`

---

**Total deviations:** 4 auto-fixed (1 value re-pin incl. an unforeseen treynor consumer, 1 plan-assumption correction, 2 blocking token/import fixes). No scope creep and no change to the plan's intended math: CAGR/Calmar on the calendar clock, risk on 252.

## Issues Encountered
- The golden fixture is 252 points over 351 calendar days (business-day-like, NOT dense-daily), so its old CAGR (`years = 252/252 = 1.0`) exactly equalled `cumulative_return`; the calendar clock (351/365 = 0.9616 yr) produces a distinct value — which is precisely the mis-annualization TWR-05 fixes.

## Known Stubs
None.

## Threat Flags
None — pure in-process computation, no new network/auth/file/schema surface. The T-73-03 tampering mitigation (mutation-verified rescale proof, falsifiable both ways + risk metrics held on 252 + date-span basis preventing len/periods over-annualization) is implemented as specified.

## Production-Recompute Gate
No production recompute was triggered — code + tests + the golden test-fixture re-pin only. The CAGR/Calmar/treynor shift on every crypto factsheet is deliberately gated behind the Phase 78 golden-parity panel (Runtime State Inventory, 73-RESEARCH).

## User Setup Required
None.

## Next Phase Readiness
- Phase 78 (golden parity) owns the production-behavior gate for this shift: flow-less accounts must not move on the flow path, and every crypto factsheet's CAGR/Calmar will shift by the known 365/252 calendar factor. The re-pinned golden fixture + the mutation-verified split are the regression anchors.
- Sibling plan 73-03 (ACC-01 `parity_diff` classifier) remains and is independent of this plan's files.

---
*Phase: 73-pure-nav-twr-core*
*Completed: 2026-07-05*

## Self-Check: PASSED

All modified files present (metrics.py, test_metrics_parity.py, test_metrics.py, golden_252d_expected.json, 73-02-SUMMARY.md) and both task commits (fab26c01, 7b1cb441) exist in history. `test_metrics.py` + `test_metrics_parity.py` = 162 passed; file-level mutation confirmed the new proofs are falsifiable.
