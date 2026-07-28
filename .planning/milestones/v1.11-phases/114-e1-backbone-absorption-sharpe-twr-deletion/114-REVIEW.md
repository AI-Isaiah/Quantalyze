---
phase: 114-e1-backbone-absorption-sharpe-twr-deletion
reviewed: 2026-07-17T16:45:06Z
depth: deep
files_reviewed: 9
files_reviewed_list:
  - analytics-service/routers/portfolio.py
  - analytics-service/services/metrics.py
  - analytics-service/services/portfolio_metrics.py
  - analytics-service/tests/test_e1_sharpe_twr_parity.py
  - analytics-service/tests/test_e1_delete_gate.py
  - analytics-service/tests/test_nav_twr.py
  - analytics-service/tests/test_portfolio_metrics.py
  - analytics-service/tests/test_portfolio_router_audit_2026_05_07.py
  - analytics-service/tests/test_coverage_extras.py
findings:
  critical: 1
  warning: 1
  info: 0
  total: 2
status: issues_found
---

# Phase 114: Code Review Report

**Reviewed:** 2026-07-17T16:45:06Z
**Depth:** deep (cross-file: metrics ⇄ portfolio router ⇄ nav_twr ⇄ transforms; quantstats runtime probe)
**Files Reviewed:** 9
**Status:** issues_found

## Summary

Phase 114 deletes the legacy forward-TWR scalar (`portfolio_metrics.compute_twr`)
and the Sharpe/vol helper (`routers.portfolio._compute_sharpe_and_vol`) and
re-routes six call sites onto two new backbone-module helpers
(`total_return_from_equity`, `sharpe_vol_status_from_backbone`). The delete-gate
(`test_e1_delete_gate.py`) is genuinely tamper-evident — Part A `hasattr` checks
survive skip-list tampering, neuter guards (`scanned >= 100`, must-visit survivor
modules) are present, and the exemption uses `<=` correctly. The
`equity_reconstruction.compute_twr` METHOD exemption is sound: it is a bound
`self` method with **zero** `portfolio_metrics` imports — a genuinely different
symbol. The TWR endpoint helper (`total_return_from_equity`) is byte-identical to
`compute_twr(eq, [])` across every edge case I traced (single obs, `begin_val==0`,
interior/trailing NaN via cumprod → both collapse to `None`). Test migrations
preserve intent — exact numeric parity is pinned in the permanent parity file and
every reachable status code is still asserted; no assertion was weakened to pass.

**One material defect blocks ship.** `sharpe_vol_status_from_backbone` is **not**
byte-identical to the deleted `_compute_sharpe_and_vol` on an **interior-NaN**
returns series (some real days, some NaN, finite std). The legacy helper used
`pandas.std()`/`.mean()` (skipna → NaN days dropped); the new helper routes
through `compute_all_metrics` → `qs.stats.volatility/sharpe` → quantstats
`_prepare_returns`, which `fillna(0)`s the NaN days, changing both vol and Sharpe.
The `pd.isna(returns.std())` guard only catches the *all*-NaN case, not the
partial-NaN case — and that case is **reachable** at the `verify_strategy` call
site, because `trades_to_daily_returns` → `reconstruct_nav_and_twr` emits interior
NaN days on a chain break (dust/negative/flow-dominated NAV guard). This is a
silent wrong-number regression on a money path, contradicting the phase's own
"byte-identical" mandate.

## Critical Issues

### CR-01: `sharpe_vol_status_from_backbone` silently changes Sharpe/vol on interior-NaN returns (reachable via `verify_strategy`)

**File:** `analytics-service/services/metrics.py:1331-1341` (helper); reached from `analytics-service/routers/portfolio.py:2281` (`verify_strategy`)

**Issue:**
The deleted `_compute_sharpe_and_vol` computed `vol = returns.std()*√252` and
`mean = returns.mean()*252` with pandas' default **skipna** semantics — interior
NaN days were dropped, so vol/Sharpe were computed over the valid days only.

The replacement calls `compute_all_metrics(returns, ...)`, which on the default
calendar basis reads `qs.stats.volatility(returns, periods=252)` and
`qs.stats.sharpe(returns, periods=252)` (metrics.py:706-707). quantstats 0.0.81
`_prepare_returns` runs `data.fillna(0)` before computing std/mean, so interior
NaN days become **0.0-return days** that enter the statistics. The two pre-backbone
guards do not prevent this: `len(returns) <= 1` and `pd.isna(returns.std())` only
fire for empty/all-NaN input — a partial-NaN series has a finite `std()` and falls
straight through to the pipeline.

Empirically confirmed (quantstats 0.0.81, a 10-day series with 2 interior NaN):

```
legacy (skipna)   vol=0.08595  sharpe=7.9406
backbone (fillna0) vol=0.07794  sharpe=7.0056   ← ~9% vol / ~12% Sharpe divergence
pd.isna(std)? False  ← guard does NOT catch it
```

Reachability (money path): `verify_strategy` builds
`returns = trades_to_daily_returns(trades, ...)`
(routers/portfolio.py:2263) →
`trades_to_daily_returns_with_status` → `reconstruct_nav_and_twr`
(services/transforms.py:115, 77). That function's chain-link **leaves a NaN on any
guarded day** — "an INTERIOR break (a guard-NaN flanked by valid returns)"
(services/nav_twr.py:843; NaN seeded at nav_twr.py:404). So any strategy that hit a
dust / negative / flow-dominated NAV guard on an interior day now shows a **silently
different Sharpe** in the verification response than it did pre-114. The helper's
docstring claim "changes nothing on the normal path … faithfully reproduces the
legacy nan_vol OUTPUT" is false for this reachable case, and no test exercises it
(all fixtures are clean, all-zeros, single-obs, or *all*-NaN — see WR-01).

(The portfolio-level call at portfolio.py:958 is safe: `portfolio_returns_series`
is built with `.fillna(0)` at portfolio.py:799, so it is NaN-free. Only the
`verify_strategy` call site is affected.)

**Fix:** After the two existing guards, feed the NaN-dropped series to the pipeline
so the statistic matches the legacy skipna basis. The `len<=1` and `pd.isna(std)`
guards on the *full* series already guarantee `dropna()` leaves ≥2 finite values,
so `compute_all_metrics` cannot hit its `len<2` raise:

```python
def sharpe_vol_status_from_backbone(returns, periods_per_year=DEFAULT_PERIODS_PER_YEAR):
    if len(returns) <= 1:
        return None, None, "insufficient_history"
    if pd.isna(returns.std()):            # all-NaN or single non-NaN -> nan_vol
        return None, None, "nan_vol"
    # Legacy used pandas skipna: drop interior NaN so the backbone's
    # qs.stats _prepare_returns fillna(0) cannot dilute vol/mean. dropna()
    # is safe here — the guards above ensure >= 2 finite observations.
    clean = returns.dropna()
    m = compute_all_metrics(clean, periods_per_year=periods_per_year)
    vol = m["volatility"]
    sharpe = m["sharpe"]
    if vol is None:
        return None, None, "nan_vol"
    if vol == 0.0:
        return 0.0, None, "zero_volatility"
    return vol, sharpe, "ok"
```

Then correct the docstring's "byte-identical / changes nothing on the normal path"
language to state the skipna reproduction explicitly, and add the partial-NaN
regression test in WR-01 (must fail against the current `fillna(0)`-diluted code).

## Warnings

### WR-01: Parity gate and migrated audit suite have zero interior-NaN coverage — the exact divergent case is untested

**File:** `analytics-service/tests/test_e1_sharpe_twr_parity.py:88-131` (fixtures a-f); `analytics-service/tests/test_portfolio_router_audit_2026_05_07.py:313-323`

**Issue:**
Every Sharpe/vol fixture is clean (a, d), all-zeros (b), single-obs (c), or
**all**-NaN (f). The migrated audit suite adds only an *all*-NaN case and its own
docstring concedes it — "This is the reachable status the legacy suite never
covered." The one input shape where the new helper diverges from the deleted legacy
(interior NaN with finite std) is exercised nowhere, which is precisely why CR-01
passed the "golden-gated" phase undetected. A parity gate that cannot fail on the
one reachable divergence is not gating that divergence.

**Fix:** Add a partial-NaN fixture and assert the helper equals a `dropna()`-based
skipna oracle (this test must be RED against today's code and GREEN after the CR-01
fix):

```python
def _fixture_partial_nan():
    idx = pd.date_range("2024-01-01", periods=10, freq="D")
    r = pd.Series(np.random.default_rng(7).normal(0.001, 0.01, 10), index=idx, dtype="float64")
    r.iloc[3] = np.nan; r.iloc[7] = np.nan   # interior break days (nav_twr guard shape)
    return r

def test_sharpe_vol_interior_nan_matches_skipna_oracle():
    r = _fixture_partial_nan()
    clean = r.dropna()
    exp_vol = clean.std() * math.sqrt(PPY)
    exp_sharpe = (clean.mean() * PPY) / exp_vol
    vol, sharpe, status = sharpe_vol_status_from_backbone(r, periods_per_year=PPY)
    assert status == "ok"
    _assert_rel(vol, exp_vol); _assert_rel(sharpe, exp_sharpe)
```

---

_Reviewed: 2026-07-17T16:45:06Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: deep_
