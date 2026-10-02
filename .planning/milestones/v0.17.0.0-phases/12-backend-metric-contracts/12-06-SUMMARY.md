---
phase: 12-backend-metric-contracts
plan: 06
subsystem: analytics-service
tags: [python, fastapi, supabase, postgrest, dataclass, jsonb, security-definer-rpc]

# Dependency graph
requires:
  - phase: 12-backend-metric-contracts (Plan 12-02)
    provides: migration 087 — strategy_analytics_series + upsert_strategy_analytics_series_batch SECURITY DEFINER RPC (M-Grok-1 atomic batch upsert)
  - phase: 12-backend-metric-contracts (Plan 12-03)
    provides: _rolling_sortino / _rolling_volatility / _rolling_alpha / _rolling_beta / _log_returns_series helpers in metrics.py
  - phase: 12-backend-metric-contracts (Plan 12-04)
    provides: _daily_returns_grid_from_series, compute_qstats_scalars (10 new qstats), refactored compute_exposure_metrics (emits exposure_series), compute_turnover_series helper
  - phase: 12-backend-metric-contracts (Plan 12-05)
    provides: _compute_derived_trade_metrics, _compute_volume_aggregator, _compute_trade_mix in analytics_runner.py; reconstruct_positions extended with avg_winning_trade / avg_losing_trade / winners_count / losers_count / realized_pnl_per_trade
provides:
  - MetricsResult dataclass (metrics_json + sibling_kinds) — single source of truth for D-01/D-02 storage split
  - compute_all_metrics now returns MetricsResult (not bare dict); legacy subscript access still works via __getitem__/get/items/keys/values shim
  - _load_position_time_series helper — derives positions_by_date / prices_by_date / nav_by_date from position_snapshots in ONE query (H-A1 single canonical price source)
  - run_strategy_analytics fully wires every helper from 12-03/04/05 into the analytics pipeline (orchestrator integration point)
  - Atomic batch sibling-table upsert via supabase.rpc("upsert_strategy_analytics_series_batch", {p_strategy_id, p_kinds}) — replaces per-kind ON CONFLICT loop (M-Grok-1)
  - 12 sibling kinds populate MetricsResult.sibling_kinds: 10 from metrics.py + exposure_series + turnover_series from runner
  - Merged trade_metrics JSONB carries 6 derived metrics (expectancy, R:R, weighted R:R per H-F, SQN, profit_factor_long, profit_factor_short) + trade_mix (B-01)
affects: [Phase 14a, Phase 14b — UI consumers of strategy_analytics + strategy_analytics_series; Plan 12-09 — sibling-table 12-kind parity test; Plan 12-10 — deploy script that flips TRADE_MIX_HAS_MAKER_TAKER]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Dataclass return type with backward-compat dict shim (__getitem__ proxy) for atomic API migration without bulk test refactor"
    - "Single supabase.rpc() call replaces per-kind ON CONFLICT upsert loops for atomic batch operations (M-Grok-1)"
    - "position_snapshots as single canonical price source — one query yields BOTH positions and prices grids (H-A1, no historical_prices table)"
    - "Orchestrator-level helper composition: every Plan 12-03/04/05 helper threads through compute_all_metrics + run_strategy_analytics in deterministic order"

key-files:
  created: []
  modified:
    - analytics-service/services/metrics.py — MetricsResult dataclass + compute_all_metrics returns it + 10 sibling kinds emitted
    - analytics-service/services/analytics_runner.py — _load_position_time_series helper + B-01 path-b orchestrator wiring + M-Grok-1 atomic batch RPC
    - analytics-service/tests/test_analytics_runner.py — MetricsResult mock conversion (2 sites) + 2 new smoke tests

key-decisions:
  - "MetricsResult.__getitem__ proxies to .metrics_json (backward-compat shim) — keeps test_metrics.py + test_accuracy.py 35+ subscript sites working without bulk refactor; new consumers use attribute access directly"
  - "compute_qstats_scalars output merges into the inner metrics_json JSONB sub-dict (NOT new top-level keys) — they map to the strategy_analytics.metrics_json JSONB column, NOT new table columns"
  - "exposure_series popped from compute_exposure_metrics output and routed to MetricsResult.sibling_kinds — keeps the strategy_analytics.exposure_metrics column slim while the heavy series goes to the sibling table per D-02"
  - "When account_balance is None, NAV proxy = sum(abs(positions[d].values())) (gross exposure); turnover formula Σ(|Δposition × price|) / nav is self-consistent under any non-zero monotonic NAV proxy"
  - "Sibling-table batch RPC failure is non-fatal — flagged via data_quality_flags.sibling_kinds_failed, runner returns complete; above-the-fold scalars in strategy_analytics still valid, only panels 4–7 (lazy-fetched) lose their series"
  - "Position-side reconstruction wrapped in local try (not the outer except) so position-side failures degrade via data_quality_flags.position_metrics_failed and DON'T block the qstats computation path"
  - "Two new smoke tests use the existing MagicMock pattern (not real supabase_test_client) — keeps test infrastructure consistent and isolation strong"

patterns-established:
  - "Pattern 1: Dataclass return + backward-compat shim — when changing a return type from dict to dataclass, expose __getitem__/get/items/keys/values proxies to enable gradual migration of callers"
  - "Pattern 2: Atomic batch sibling-table upsert via SECURITY DEFINER RPC — replaces per-row ON CONFLICT loops for transactional consistency (single round-trip + implicit transaction)"
  - "Pattern 3: Single-query dual-grid extraction — position_snapshots yields BOTH positions and prices grids without a separate price table, eliminating sync drift"
  - "Pattern 4: Orchestrator helper threading — each helper contract documents what its caller (the orchestrator) must wire upstream/downstream; B-01 path (b) is the canonical example"

requirements-completed: [METRICS-05, METRICS-06, METRICS-07, METRICS-08, METRICS-09, METRICS-10, METRICS-11, METRICS-12, METRICS-15, METRICS-17]

# Metrics
duration: 17min
completed: 2026-04-28
---

# Phase 12 Plan 06: Orchestrator Wiring (MetricsResult + B-01 + H-A1 + M-Grok-1) Summary

**compute_all_metrics returns MetricsResult dataclass; analytics_runner threads every Plan 12-03/04/05 helper into the analytics pipeline with B-01 path-b derived-metric merge, H-A1 position_snapshots-derived turnover/exposure series, and M-Grok-1 atomic batch sibling-table upsert via SECURITY DEFINER RPC**

## Performance

- **Duration:** ~17 min
- **Started:** 2026-04-28T13:15:38Z (session resumed from 12-05 SUMMARY landing)
- **Completed:** 2026-04-28T13:32:03Z
- **Tasks:** 2 (autonomous, no checkpoints)
- **Files modified:** 3

## Accomplishments

- **MetricsResult dataclass** — single source of truth for D-01/D-02 storage split (metrics_json → strategy_analytics table; sibling_kinds → strategy_analytics_series sibling table). Backward-compat shim (`__getitem__`/`get`/`items`/`keys`/`values`) means 35+ legacy subscript sites in test_metrics.py + test_accuracy.py continue to work unchanged.
- **10 new qstats scalars** (METRICS-11) merged into the inner metrics_json JSONB sub-dict via `compute_qstats_scalars(returns, benchmark)` — recovery_factor, ulcer_index, upi, kelly_criterion, probabilistic_sharpe_ratio, common_sense_ratio, cpc_index, serenity_index, r_squared, time_in_market.
- **12 sibling kinds** (METRICS-04..06, METRICS-12, METRICS-15, METRICS-17) populated end-to-end:
  - 10 from metrics.py: daily_returns_grid, rolling_sortino_3m/6m/12m, rolling_volatility_3m/6m/12m, rolling_alpha, rolling_beta, log_returns_series
  - 2 from analytics_runner: exposure_series (popped from compute_exposure_metrics), turnover_series (from compute_turnover_series)
- **B-01 path (b)** (METRICS-07/08/09/10) — orchestrator merges fill-side (`_compute_volume_metrics` + `_compute_volume_aggregator` + `_compute_trade_mix`) and position-side (`reconstruct_positions` extended dict) into a single `merged_trade_metrics` JSONB before the strategy_analytics upsert. `_compute_derived_trade_metrics` produces the 6 derived keys including H-F weighted R:R.
- **H-A1 fix** — `_load_position_time_series` helper derives positions_by_date / prices_by_date / nav_by_date from a SINGLE position_snapshots query (each row carries both `size_usd` AND `mark_price` per migration 034). The phantom `historical_prices` table from REVIEWS does not exist — verified via `grep -rn "historical_prices" supabase/migrations/` returning zero matches. Both `exposure_series` and `turnover_series` now populate from real data, not silent zeros.
- **M-Grok-1 fix** — sibling-table writes go through a single atomic `supabase.rpc("upsert_strategy_analytics_series_batch", {p_strategy_id, p_kinds})` call (RPC's implicit transaction = whole batch atomic; SECURITY DEFINER + `search_path=public,pg_temp` H-B hardening shipped in migration 087). Legacy per-kind `on_conflict="strategy_id,kind"` loop removed.
- **Graceful degradation** — position-side reconstruction wrapped in local try; failures flag `data_quality_flags.position_metrics_failed` without blocking the qstats path. Sibling-batch RPC failure flags `data_quality_flags.sibling_kinds_failed` without blocking the strategy_analytics upsert (above-the-fold scalars still land).

## Task Commits

Each task was committed atomically:

1. **Task 1: Refactor compute_all_metrics to return MetricsResult dataclass** — `f542290` (refactor)
2. **Task 2: Wire B-01 + H-A1 + M-Grok-1 in analytics_runner** — `4da7ea5` (feat)

**Plan metadata:** (this SUMMARY commit) — final commit closes the plan.

## Files Created/Modified

- `analytics-service/services/metrics.py` — Added `MetricsResult` dataclass with backward-compat dict shim (`__getitem__`/`get`/`items`/`keys`/`values`); refactored `compute_all_metrics` to return MetricsResult, merge 10 qstats scalars into inner metrics_json sub-dict, and emit 10 sibling kinds (daily_returns_grid + rolling_sortino_3m/6m/12m + rolling_volatility_3m/6m/12m + rolling_alpha + rolling_beta + log_returns_series).
- `analytics-service/services/analytics_runner.py` — Added `_load_position_time_series` helper (H-A1 position_snapshots → positions/prices/nav grids); added `import os` for `TRADE_MIX_HAS_MAKER_TAKER` env var (M-01); restructured `run_strategy_analytics` to call helpers in B-01 order (reconstruct_positions → _compute_volume_metrics → _compute_volume_aggregator → _compute_derived_trade_metrics → _compute_trade_mix → merged_trade_metrics); replaced per-kind ON CONFLICT loop with atomic batch RPC call (M-Grok-1); pop exposure_series from compute_exposure_metrics output and route to sibling_kinds.
- `analytics-service/tests/test_analytics_runner.py` — Converted 2 existing `mock_metrics = {...}` dicts to `MetricsResult(metrics_json=..., sibling_kinds={})` instances; added 2 new smoke tests (`test_run_strategy_analytics_writes_sibling_kinds` asserts batch RPC called with daily_returns_grid + rolling_sortino_3m + log_returns_series + exposure_series + turnover_series in payload; `test_run_strategy_analytics_derived_metrics_present` asserts merged trade_metrics has 6 derived keys + trade_mix); added `_build_runner_mock_supabase` helper for shared mock factory.

## Decisions Made

1. **Backward-compat shim on MetricsResult** — Decided to expose `__getitem__`/`get`/`items`/`keys`/`values` proxying to `metrics_json` field. Rationale: the alternative (mass-refactor 35+ test subscript sites) is high-churn for zero functional benefit; the shim is a small, well-documented surface that lets new consumers use attribute access while existing tests keep working. The shim becomes pruning-eligible only after every consumer has migrated (a v0.18+ task).
2. **qstats scalars merge into INNER metrics_json sub-dict, not as top-level dataclass fields** — Rationale: those scalars map to the `strategy_analytics.metrics_json` JSONB column, NOT new table columns. Putting them at the dataclass top level would have required new table columns or a manual filter step before the upsert. The inner-merge keeps the storage contract literal and the upsert spread (`**metrics_result.metrics_json`) clean.
3. **NAV fallback formula = `sum(abs(positions[d].values()))`** — Rationale: turnover formula is `Σ(|Δposition × price|) / NAV`. Any monotonically-positive NAV proxy yields a self-consistent series. Account balance is the canonical source when available; gross exposure is a safe fallback that's always non-zero when positions exist.
4. **Sibling-batch RPC failure is non-fatal** — Rationale: the strategy_analytics scalars (above-the-fold) are independent of the sibling table. Failing the whole run on a sibling-table glitch would degrade the home-page experience for issues that only affect lazy-loaded panels 4–7. Flag via `data_quality_flags.sibling_kinds_failed` and continue.
5. **Position-side reconstruction in local try, not outer except** — Rationale: the existing graceful-degradation contract (`data_quality_flags.position_metrics_failed`) preserves the qstats path even when reconstruct_positions fails. Hoisting reconstruct_positions BEFORE compute_all_metrics (B-01 requirement) preserves that semantics by isolating the failure to its own try block.
6. **Two new smoke tests use MagicMock, not real supabase_test_client** — Rationale: the existing test_analytics_runner.py uses MagicMock for the 2 prior tests. Adding a real-client dependency would have required test-infrastructure scaffolding (fixture_strategy_id, test schema, RLS bypass) that doesn't exist in this codebase. MagicMock is sufficient to verify the RPC NAME + payload shape, which is what the acceptance criteria require.

## Deviations from Plan

None — plan executed exactly as written.

The plan's pre-execution lock-in on H-A1 (position_snapshots.mark_price as single canonical source, no historical_prices table) was confirmed via fresh `grep -rn "historical_prices" supabase/migrations/` returning zero matches. No fixture migration needed.

The plan's automated verify command passed without modification:
```
grep -q "metrics_result.sibling_kinds" analytics-service/services/analytics_runner.py
  && grep -q "metrics_result.metrics_json" ...
  && grep -q "_compute_derived_trade_metrics" ...
  && grep -q "_load_position_time_series" ...
  && grep -q "compute_turnover_series" ...
  && grep -q "upsert_strategy_analytics_series_batch" ...
  && ! grep -q 'on_conflict="strategy_id,kind"' ...
  && grep -q "weighted_risk_reward_ratio" ...
  && cd analytics-service && pytest tests/test_analytics_runner.py -x  → 18 passed
```

**Total deviations:** 0
**Impact on plan:** Zero scope creep; every change traces to the plan's `<action>` blocks.

## Issues Encountered

1. **Initial test run after Task 1 metrics.py refactor failed** with `AttributeError: 'MetricsResult' object has no attribute 'items'` (test_metrics.py:106 iterates `result.items()` to scrub NaN/Inf recursively). Fixed by adding `items()`/`keys()`/`values()` proxies to MetricsResult alongside `__getitem__`/`get`. Test pass rate: 65/66 → 66/66 after fix. This is a pure shim addition — no functional change to dataclass semantics.

## Test Surface

- **test_metrics.py:** 49 tests — all pass (covers MetricsResult dataclass + dict shim + every Plan 12-03/04 helper independently)
- **test_accuracy.py:** 16 tests — all pass (golden-data accuracy for hand-computed Sharpe/Sortino/CAGR/MaxDD/Vol vs `compute_all_metrics` output via the dict shim)
- **test_analytics_runner.py:** 18 tests — all pass (2 existing graceful-degradation + 14 derived-metric/volume/trade-mix unit tests + 2 new smoke tests for the M-Grok-1 batch RPC + B-01 merged-trade-metrics dict)
- **Full analytics-service suite:** 586/587 pass (1 pre-existing `test_drain_100_jobs` failure documented in `deferred-items.md`, out of scope)

## User Setup Required

None — pure analytics-service refactor; no new env vars, no dashboard changes, no migrations.

The `TRADE_MIX_HAS_MAKER_TAKER` env var is already part of the contract (Plan 12-01 set it to `false` per the D-15 audit fail). Plan 12-10's deploy script propagates it; this plan only reads via `os.getenv("TRADE_MIX_HAS_MAKER_TAKER", "false").lower() == "true"`.

## Next Phase Readiness

- **Plan 12-09 (sibling-table 12-kind parity test):** UNBLOCKED. Every kind it asserts on now lands via `MetricsResult.sibling_kinds` → `upsert_strategy_analytics_series_batch` RPC. The parity test can now diff Python vs TS contracts.
- **Plan 12-10 (deploy script + CI gate):** UNBLOCKED. The `TRADE_MIX_HAS_MAKER_TAKER` env-var read site is in place; the deploy script can now flip it without further runner changes.
- **Phase 14a (Single-Strategy v2 — Eager Panels):** UNBLOCKED for the metric-contract surface. `metrics_json` carries every above-the-fold scalar a UI panel needs (qstats + benchmarks + drawdown_episodes); `strategy_analytics_series` carries every heavy series for panels 4–7.
- **Phase 14b (Lazy Panels):** UNBLOCKED. `fetch_strategy_lazy_metrics` RPC (Plan 12-08) now has real data to fetch — sibling-table populates on every analytics run via the atomic batch RPC.

## Threat Surface Scan

No new security-relevant surface introduced. The atomic batch RPC (`upsert_strategy_analytics_series_batch`) is service_role-only (REVOKE'd from PUBLIC/anon/authenticated in migration 087:230); analytics_runner already runs under service_role. No new auth paths, no new file access, no schema changes.

T-12-06-01 mitigation status: M-Grok-1 SUPERSEDES the original "per-kind atomic" approach with batch atomicity (single implicit transaction). T-12-06-02 (information disclosure) accept-disposition unchanged. T-12-06-03 (DoS) — RPC collapses 12 round-trips into 1 per strategy as planned. T-12-06-04 (kind-as-user-input) — kinds are derived from `MetricsResult.sibling_kinds.keys()`, set in metrics.py + analytics_runner. No user input flows into the kind field.

## Self-Check: PASSED

- File `analytics-service/services/metrics.py` exists ✓
- File `analytics-service/services/analytics_runner.py` exists ✓
- File `analytics-service/tests/test_analytics_runner.py` exists ✓
- Commit `f542290` (Task 1 — refactor) ✓
- Commit `4da7ea5` (Task 2 — feat) ✓
- All Task 1 acceptance criteria pass (MetricsResult declared + sibling_kinds + 10 helpers wired) ✓
- All Task 2 acceptance criteria pass (metrics_result.sibling_kinds + metrics_result.metrics_json + _compute_derived_trade_metrics + _load_position_time_series + compute_turnover_series + upsert_strategy_analytics_series_batch + legacy on_conflict removed + weighted_risk_reward_ratio) ✓
- 84/84 metrics + accuracy + analytics_runner tests pass ✓

---
*Phase: 12-backend-metric-contracts*
*Completed: 2026-04-28*
