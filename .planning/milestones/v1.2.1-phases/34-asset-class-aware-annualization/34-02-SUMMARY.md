---
phase: 34-asset-class-aware-annualization
plan: 02
subsystem: analytics
tags: [annualization, sharpe, equity-reconstruction, quantstats, golden-parity, pytest, mypy]

# Dependency graph
requires:
  - phase: 34-01
    provides: "DEFAULT_PERIODS_PER_YEAR = 252 constant + compute_all_metrics(periods_per_year) threaded param"
provides:
  - "EquityCurveBuilder.compute_sharpe defaults to 252 (was 365) — shares DEFAULT_PERIODS_PER_YEAR with compute_all_metrics; no residual scale factor (ANNUAL-05)"
  - "test_no_residual_scale_factor — falsifiable proof the two Sharpe paths agree at 252 (would fail ~×1.204 apart if a default drifts back to 365)"
  - "Equity-curve golden expected_sharpe literals on the unified 252 basis"
  - "MT5 doc block describes the explicit periods_per_year=252 param design"
affects: [phase-35-per-key-dailies, phase-36-overview-reads, phase-37-composer-toggle, landing-verification-card-sharpe]

# Tech tracking
tech-stack:
  added: []  # no new deps — quantstats==0.0.81 already pinned
  patterns:
    - "Share the annualization constant across modules (import DEFAULT_PERIODS_PER_YEAR, do not duplicate the literal)"
    - "Prove cross-path agreement by reproducing one path's adjusted series and feeding it to the other (no ×1.204 factor, not bit-equality)"

key-files:
  created:
    - .planning/phases/34-asset-class-aware-annualization/34-02-SUMMARY.md
  modified:
    - analytics-service/services/equity_reconstruction.py
    - analytics-service/tests/fixtures/equity-curve-golden/binance-spot-only.json
    - analytics-service/tests/fixtures/equity-curve-golden/bybit-perp-with-funding.json
    - analytics-service/tests/fixtures/equity-curve-golden/csv-spot-only.json
    - analytics-service/tests/fixtures/equity-curve-golden/okx-multi-month-perps.json
    - analytics-service/tests/test_equity_curve_builder.py
    - analytics-service/tests/test_ana_recon_audit.py
    - analytics-service/tests/test_mt5_golden_fixtures.py

key-decisions:
  - "Flip the default + share the constant (import DEFAULT_PERIODS_PER_YEAR) — did NOT delegate compute_sharpe to compute_all_metrics (different NAV-derived return series + C01-06/C01-14 bar logic; Rule 3)"
  - "csv-spot-only expected_sharpe/quantstats_sharpe_reference were ALREADY stale (never matched the live builder, even at 365) and are documentary-only (excluded from the test_sharpe_within_tolerance FIXTURES list) → reset to the actual live builder@252 value, not a ×ratio transform of a wrong number (Rule 1)"
  - "Recomputed quantstats_sharpe_reference documentary fields onto the 252 basis too — leaving 365-basis references next to 252-basis expected values would be misleading"

requirements-completed: [ANNUAL-02, ANNUAL-03, ANNUAL-05]

# Metrics
duration: 30min
completed: 2026-06-24
---

# Phase 34 Plan 02: Converge equity_reconstruction Sharpe 365→252 Summary

**Flipped `EquityCurveBuilder.compute_sharpe`'s default from 365 to 252 (sharing the `DEFAULT_PERIODS_PER_YEAR` constant imported from `services.metrics`), eliminating the documented ×1.20 (≈√(365/252)) scale-factor mismatch with `compute_all_metrics` — the single user-visible change is that the landing verification-card Sharpe drops by ×√(252/365)≈0.831 for new verifications. Recomputed the 4 hand-maintained golden `expected_sharpe` literals programmatically, flipped the test cross-check literals, and added a falsifiable no-residual-scale-factor agreement test proving the two paths now agree at 252 (empirically diff=0.0 on all 4 fixtures).**

## Performance

- **Duration:** ~30 min
- **Started:** 2026-06-24T13:00Z (approx)
- **Completed:** 2026-06-24T13:29Z
- **Tasks:** 3
- **Files modified:** 8 (1 production, 7 test/fixture)

## The ×0.831 Sharpe shift (the intended fix, NOT a regression)

`compute_sharpe` is a hand-rolled `(mean/std) * sqrt(periods)` formula — pure √ scaling. Flipping the default 365→252 multiplies every result by exactly `√(252/365) = 0.8309097…`. This lowers the persisted `metrics_snapshot.sharpe` rendered on the landing verification card by that factor for every NEW verification. This is the documented ×1.20 mismatch fix (NEW-C01-15 reversed), called out loudly in commit `e1a4f665`. Existing stored `metrics_snapshot` rows keep their 365-basis number until re-verified — **no backfill in scope** (CONTEXT lists no migration; RESEARCH Runtime State Inventory).

**Empirical proof the recompute is correct, not eyeballed:** the live builder@252 output equals the old golden literal × √(252/365) exactly — e.g. bybit's builder now returns `4.22773301446707`, which is precisely `5.088077470517692 × 0.8309097…`.

## Accomplishments

- **Task 1** (`e1a4f665`, fix): `EquityCurveBuilder.compute_sharpe` signature now `periods: int = DEFAULT_PERIODS_PER_YEAR` (imported from `services.metrics`, not duplicated). Reversed all three NEW-C01-15 doc sites (the `compute_sharpe` docstring, the class docstring, and the C01-14 filler-zero rationale) to describe the unified-252 convergence; dropped the √(252/365)≈0.83 under-scale rationale. No circular import (metrics.py does not import equity_reconstruction — verified). `portfolio_optimizer._compute_sharpe` untouched (different function, already ×√252).
- **Task 2** (`7c7f2ff9`, test): recomputed all 4 golden `expected_sharpe` literals programmatically (`old × (252/365)**0.5`). The 3 ASSERTED fixtures now equal the live builder@252 exactly: binance `2.552521743293502`, bybit `4.22773301446707`, okx `0.692753791589015`. Flipped the quantstats cross-check `periods=365`→`252` and the recon-audit `(365 ** 0.5)`→`(252 ** 0.5)`. Added `test_no_residual_scale_factor` (parametrized over all 4 fixtures): reproduces the builder's exact C01-14/C01-06-adjusted return series and feeds it to `compute_all_metrics`, asserting agreement within ±0.05 — empirically **diff=0.0** on every fixture. This fails ~×1.204 apart if either default drifts back to 365.
- **Task 3** (`48d44a61`, docs): refreshed the stale MT5 doc block (lines 21-31) that claimed `compute_all_metrics` "has NO `periods` parameter". It now describes the explicit `periods_per_year: int = 252` param (Phase 34), notes both production callers inherit 252 and the converged equity path resolves the same basis. Doc-only — MT5 golden values unchanged (`tests/fixtures/mt5/` has no diff).

## Verification Results

- **3 affected suites** (`test_equity_curve_builder.py` + `test_ana_recon_audit.py` + `test_mt5_golden_fixtures.py`): **74 passed**.
- **Full analytics suite** (`pytest -q`): **2660 passed, 82 skipped, 0 failed** — confirms the new module-level import introduced no import cycle or collection breakage anywhere.
- **mypy --strict --follow-imports=silent services/equity_reconstruction.py**: **Success, no issues found.** (The B-mypy-local-venv-drift caveat does NOT apply — the change only added a typed `int` constant import + flipped an `int` default; it touches no supabase APIResponse/generic types.)
- **Wave-1 suites** (`test_metrics_parity.py` + `test_metrics.py`): 160 passed (unaffected by this plan).
- **ANNUAL-02 grep proof:** both production callers pass NO periods arg, inheriting 252 — `services/analytics_runner.py:1584` and `:2027` both read `compute_all_metrics(returns, benchmark_rets)`. No production caller diverges.

## Files Created/Modified

- `analytics-service/services/equity_reconstruction.py` — imported `DEFAULT_PERIODS_PER_YEAR`; flipped `compute_sharpe` default 365→252; reversed 3 NEW-C01-15 doc sites.
- `analytics-service/tests/fixtures/equity-curve-golden/{binance-spot-only,bybit-perp-with-funding,csv-spot-only,okx-multi-month-perps}.json` — `expected_sharpe` recomputed at 252; `quantstats_sharpe_reference` documentary fields rescaled to 252.
- `analytics-service/tests/test_equity_curve_builder.py` — quantstats cross-check `periods=252`; refreshed NEW-C01-15 comments; added `test_no_residual_scale_factor`.
- `analytics-service/tests/test_ana_recon_audit.py` — hand-rolled `(365 ** 0.5)` → `(252 ** 0.5)` so the terminal-bar differ-assertion isolates the bar effect.
- `analytics-service/tests/test_mt5_golden_fixtures.py` — refreshed doc block for the explicit-param design.

## Decisions Made

- **Flip the default + share the constant; do NOT delegate to compute_all_metrics.** Per RESEARCH §"Smallest-surface convergence": `compute_all_metrics` takes a `pd.Series` and returns a `MetricsResult` over a different (NAV-derived, C01-06/C01-14-adjusted) return series — rerouting would drag in the bar-dropping logic and is a far larger surface than the decision wants (Rule 3). Sharing the constant satisfies "two paths agree at 252, no residual scale."
- **csv-spot-only documentary correctness (Rule 1).** The csv `expected_sharpe`/`quantstats_sharpe_reference` were already stale — the live builder produces `2.5756…` but the stored value was `2.55693759` (set equal to the qs reference, never the builder's actual output, even at 365). The fixture is NOT in the `test_sharpe_within_tolerance` FIXTURES parametrize list (only okx/binance/bybit are asserted), so this field is documentary-only. Reset to the actual live builder@252 value `2.5756202779670216` rather than a ×ratio transform of a wrong number (root-cause honesty over mechanical transform).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] csv-spot-only golden was already stale documentary data**
- **Found during:** Task 2 (probing the live builder@252 output before writing the literals)
- **Issue:** The plan/RESEARCH cited `2.55693759 → ×√(252/365) ≈ 2.1254` for csv-spot-only. But the live builder actually computes `2.5756…` for that fixture — the stored `2.55693759` was the `quantstats_sharpe_reference` value (the two were hand-set equal), NOT the builder's real output. A ×ratio transform of a stale number propagates the staleness. Crucially, csv-spot-only is excluded from the `test_sharpe_within_tolerance` FIXTURES list (`[okx, binance, bybit]`), so this `expected_sharpe` is documentary-only — never asserted against the builder.
- **Fix:** Set csv-spot-only `expected_sharpe` and `quantstats_sharpe_reference` to the actual live builder@252 value `2.5756202779670216`, restoring honest documentary data instead of carrying forward a wrong number ×ratio.
- **Files modified:** `tests/fixtures/equity-curve-golden/csv-spot-only.json`
- **Verification:** Probed `EquityCurveBuilder(...).compute_sharpe()` directly; confirmed `2.5756…` for both `mark_prices=gold` and `mark_prices={}`; confirmed the fixture is not in the asserted FIXTURES list.
- **Committed in:** `7c7f2ff9` (Task 2 commit)

**2. [Rule 1 - Hygiene] quantstats_sharpe_reference documentary fields rescaled to 252**
- **Found during:** Task 2 (the 4 fixtures each carry a non-asserted `quantstats_sharpe_reference` next to `expected_sharpe`)
- **Issue:** Leaving the 365-basis `quantstats_sharpe_reference` documentary values next to the recomputed 252-basis `expected_sharpe` would be self-contradictory documentation.
- **Fix:** Rescaled each programmatically by × √(252/365) (same series, only the multiplier changes → exact). Not asserted by any test, so this is documentary consistency only (verified `grep -rn quantstats_sharpe_reference tests/` shows no assertion references).
- **Files modified:** the 4 equity-curve-golden JSON fixtures
- **Committed in:** `7c7f2ff9` (Task 2 commit)

---

**Total deviations:** 2 auto-fixed (both Rule 1 — documentary-data honesty discovered by probing the live builder, not scope creep). The 3 ASSERTED goldens (okx/binance/bybit) are exact ×ratio recomputes equal to the live builder@252; the deviations only correct the non-asserted documentary fields.
**Impact on plan:** No scope change. All three tasks completed; the plan's objective (converge 365→252, share the constant, recompute the goldens, add the agreement test, refresh the MT5 doc) is fully met.

## Known Stubs

None — no placeholder/empty-value patterns introduced. All changes are concrete numeric recomputes, a default flip, a real falsifiable test, and a doc refresh.

## Issues Encountered

- **Local `pandera` IS installed in this `.venv` (0.20.4)** — contrary to the 34-01 summary's local-collection gap. `test_mt5_golden_fixtures.py` collects and runs locally here: **16 passed**. The local-collection gap noted in 34-01 was from a different local environment; it does not apply in the `.venv` used for this plan. CI installs pandera regardless, so the MT5 doc edit is verified both ways (ast-parse + actual run).
- **Pre-existing `.planning/` churn** in the working tree (mass deletions/modifications of the gitignored-but-tracked planning ledger from prior sessions) was deliberately NOT touched — only this plan's 8 source/test files were staged per-commit (`commit_docs: false`; never `git add .planning`).

## User Setup Required

None — no external service configuration, no new dependencies, no migrations, no env vars. (Existing landing-card Sharpe values stay at their stored 365-basis number until the strategy is re-verified; this is by design — no backfill in scope.)

## Next Phase Readiness

- ANNUAL-05 is now complete: both the equity-reconstruction path and `compute_all_metrics` annualize at 252 with no residual scale factor, proven falsifiably by `test_no_residual_scale_factor`.
- Phase 35 (per-key dailies) can proceed: the dense ~365-row calendar density is independent of the 252 annualization multiplier (CONTEXT decision), and the shared `DEFAULT_PERIODS_PER_YEAR` constant is the single source for any future per-asset divergence (a one-line call-site change at `analytics_runner.py:1584`/`:2027`).

## Self-Check: PASSED

- Created/modified files verified present (see below).
- Task commits verified in git log: `e1a4f665` (fix), `7c7f2ff9` (test), `48d44a61` (docs).
- 3 affected suites 74 passed; full analytics 2660 passed/82 skipped/0 failed; mypy --strict clean on equity_reconstruction.py; ANNUAL-02 grep proof confirmed; `portfolio_optimizer.py` untouched; `tests/fixtures/mt5/` byte-identical.

---
*Phase: 34-asset-class-aware-annualization*
*Completed: 2026-06-24*
