# Phase 103: MTM daily series → charts follow the toggle - Context

**Gathered:** 2026-07-12
**Status:** Ready for research/planning
**Mode:** Smart discuss — design/grey areas (coverage-mask, persistence-home, unification-degree) DELEGATED to Fable.

<domain>
## Phase Boundary
MTM-04: make the `cash_settlement ↔ mark_to_market` toggle swap the **daily return SERIES**, not just the seven scalars — so **ALL charts follow** (equity/drawdown/returns), for **single-key AND composite**, with a **full per-basis coverage mask**. Today Phase 101/102 persist only `metrics_json_by_basis.mark_to_market` (scalars) and the charts unconditionally read the cash daily series (`payload.strategyReturns/strategyEquity/strategyDrawdowns` ← cash `daily_returns`/`csv_daily_returns`). The MTM daily series is COMPUTED then DISCARDED (`job_worker.py:2357/:2983` single-key; `:4258` composite). Persist it; route it through the same downstream; charts + metrics both derive from it. NO new valuation math (persist the series already computed). Folded into v1.10 (user) — the milestone does NOT close until toggling MTM moves the whole factsheet.
</domain>

<decisions>
## LOCKED architectural principle (user, 2026-07-12) — [[feedback_dailies_canonical_unified_derive]]
- **Daily returns are the canonical source. ALWAYS compute dailies first, then derive everything (metrics + charts + coverage) from them.** Identically for cash AND mark_to_market, and identically across every source (CSV upload, single API key, composite stitch).
- **The toggle swaps the daily SERIES** feeding ONE common downstream route; charts + metric cards both follow. Never swap only the scalar cards (the Phase-102 shortcut).
- **Composites first derive their stitched daily returns, then take the SAME route as CSV / all API keys** — no bespoke composite metrics/charts path.
- **Scalars stay as a DERIVED cache** (mirrors cash: cash persists both the daily series AND `metrics_json`). They must always be re-derivable from the persisted dailies; add a guard/test that persisted-scalars == derived-from-persisted-dailies (kills the Phase-101 √252-vs-√365 divergence class). The stored scalar is never an independent source of truth.

## User decisions (2026-07-12)
- **Fold Phase 103 into v1.10** (finish MTM before shipping the milestone).
- **Unify single-key AND composite** (both must swap the series on toggle).
- **Full per-basis coverage mask** (MTM gaps ≠ cash gaps; render MTM-specific MARKED gaps, never zero-filled — NOT the current all-or-nothing MTM gating).

## DELEGATED to Fable (planner):
- **Persistence home** for the MTM daily series: a new `strategy_analytics_series` kind (e.g. `mtm_daily_returns`, the purpose-built heavy-series table — lower blast radius) vs a per-basis axis on `csv_daily_returns` (new column + uniqueness change on the hot cash table). Research recommends; Fable decides.
- **Per-basis coverage-mask design:** MTM is all-or-nothing-gated today; MTM-04 wants partial MTM coverage rendered with marked gaps. Decide the mask representation (an MTM-specific gap mask persisted alongside the series vs derived), reusing the existing `segmentBoundaries`/`missingSegments`/`deriveSegmentMarkers` machinery where honest.
- **Unification degree (scope fence — see <specifics>):** how far to route composite through the common CSV path within v1.10 vs align-with-the-in-flight-unified-backbone. Contained = MTM dailies flow through the same downstream as cash for both single-key + composite; full backbone merge of the composite cash path is a SEPARATE program.
</decisions>

<code_context>
## Existing (research to CONFIRM/EXTEND — the prior investigation already mapped much of this)
- Charts read `payload.strategyReturns/strategyEquity/strategyDrawdowns` via `chart-configs.ts:262-267` (`stratField`); built in `build-payload.ts:204/:303-310/:336` from the CASH daily series. No basis switch in the chart data path.
- Single-key MTM series COMPUTED at `job_worker.py:2357` (`combine_native_ledger`), reduced to scalars `:2983`, persisted scalars-only `:3090-3093`. Composite MTM series `_metrics_result_for(clipped_mtm)` `:4258`, discarded; only `stitched_cash` persisted to `csv_daily_returns` `:4285-4291` ("stays for charting only" `:4328`).
- Series tables: `strategy_analytics_series` (migration `20260428120919`, kinds `daily_returns_grid, rolling_*, exposure_series` — none per-basis); `csv_daily_returns` (single `daily_return` col, no basis axis).
- Coverage mask: `segmentBoundaries` + `missingSegments` from `data_quality_flags` via `deriveSegmentMarkers`, drawn in `TimeSeriesChart.tsx`; honest gaps = ABSENT rows, never 0.0 (`composite-read-path.ts:24`, `job_worker.py:4291`). Currently cash-only / per-strategy, NOT per-basis.
- MTM read wiring (Phase 102): `singleKeyBasisOpts` (`composite-read-path.ts`) threads only the scalar `metricsByBasis.mark_to_market`; F-4 `computation_status` gate; `mtm_gated_reason` cases gate the whole MTM basis OFF today (all-or-nothing).
- Unification precedent: [[project_apikey_dailies_unification]] (every API key via ONE CSV `compute_all_metrics` path); [[project_unified_backbone_on_composite_routing]]; [[project_unified_queued_path_scaffold]] (`process_key_long` unfinished — Phase 103 must ALIGN, not fork).
- DESIGN.md (chart gap styling, coverage-mask visual voice).
</code_context>

<specifics>
- Research MUST map the CURRENT daily-series → metrics/charts/coverage routes for the three sources (CSV, single API key, composite) × two bases (cash, MTM) and identify exactly WHERE they diverge — so the plan can route the MTM dailies through the common downstream for both single-key + composite WITHOUT forking the in-flight unified backbone. Be explicit: what is the smallest change that persists the MTM dailies (both paths) + threads a basis-keyed series set to the charts + a per-basis coverage mask, honoring dailies-as-canonical, and where does the boundary sit vs the larger backbone-unification program.
- This needs a MIGRATION (new series kind or per-basis column) → migration-reviewer + rls-policy-auditor + test-project MCP catch-up apply before PR green.
- Guard requirement: a test asserting the persisted MTM scalars are re-derivable from the persisted MTM dailies (no divergence) — the anti-Phase-101-regression.
</specifics>

<deferred>
- Full backbone merge of the composite CASH compute into the one CSV route (the in-flight `process_key` unification program) — align with it, do NOT fork; not this phase.
- Any new valuation math / smoothing (permanently dropped).
- LIVE Zavara MTM-curve corroboration remains the POST-DEPLOY ship-time gate (needs the re-derive backfill).
</deferred>
