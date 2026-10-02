---
phase: 103-mtm-daily-series-charts-follow
verified: 2026-07-12T19:55:40Z
status: human_needed
score: 7/7 must-haves verified
overrides_applied: 0
re_verification:
  previous_status: null
  note: "Initial verification. No prior 103-VERIFICATION.md existed."
human_verification:
  - test: "Open a single-key options factsheet AND a composite factsheet (post re-derive backfill) in the browser; toggle cash → mark-to-market."
    expected: "EVERY chart (equity, cumVsBench, volMatched, dailyReturns, rolling vol/sharpe/sortino/beta, worstDDs, underwater) plus the dailies-derivable panels (heatmaps, quantiles, streaks, calmarByYear, bootstrapCI, styleDrift, stressWindows strat cols) redraw on the MTM axis; correlations/correlationMatrix + the KpiStrip headline scalars stay put; the caption reads 'Charts show the mark-to-market series.'; zoom resets on toggle."
    why_human: "Visual rendering + the toggle interaction cannot be confirmed by grep/unit tests; the keystone test proves the wiring but not the on-screen result."
  - test: "On a COMPOSITE factsheet under mark_to_market, read the right-rail eyebrow 'BASIS · CASH SETTLEMENT' against the now-mixed rail (Calmar/Bootstrap/Worst-10/StyleDrift/quantile rows follow MTM; strategyMetrics scalar tables stay cash)."
    expected: "A design decision: reword the eyebrow to scope it to the headline scalar metrics, or drop it. Single-key options (the milestone focus) shows NO eyebrow and is unaffected."
    why_human: "DESIGN.md-governed copy; the executor deliberately left the string verbatim and flagged it for a design call rather than ship an unsanctioned copy change (103-04 SUMMARY 'Flagged for red team / ship-time')."
  - test: "POST-DEPLOY: run the mtm_daily_returns re-derive backfill, then corroborate the live Zavara MTM equity curve."
    expected: "Zavara + existing options strategies gain an mtm_daily_returns row; the live MTM curve corroborates. Until backfill, factsheets fall back to cash charts + the honest caption (proven by the FALLBACK keystone test)."
    why_human: "Explicitly deferred to a post-deploy ship-time gate per 103-CONTEXT <deferred> and 103-VALIDATION; requires the backfill + live data, out of in-phase scope."
---

# Phase 103: MTM daily series → charts follow the toggle — Verification Report

**Phase Goal:** the basis toggle swaps the daily SERIES feeding the ONE common downstream (`buildFactsheetPayload` / `deriveSeriesBundle`), so ALL charts AND the dailies-derivable statistics panels follow for single-key AND composite; external-data panels stay cash; full per-basis coverage mask (honest); scalars stay a derived cache with an anti-divergence guard; NO new valuation math; cash byte-identical (SC-4); built as the durable shared route (composite bespoke `_metrics_result_for(clipped_mtm)` retired).
**Verified:** 2026-07-12T19:55:40Z (base `89b5c3fc` → HEAD `673df687`)
**Status:** human_needed (all 7 truths code-VERIFIED; 3 human items are visual/design/post-deploy, none block goal achievement)
**Re-verification:** No — initial verification.

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Under MTM the charts AND dailies-derivable panels read the MTM series via `useBasisSeriesView`; external panels (correlations/correlationMatrix) + strategyMetrics stay cash | ✓ VERIFIED | `TimeSeriesChart.tsx:68,112` resolves strat tracks via `resolveSeries(config, view, …)` → `chart-configs.ts:264` `payload[cfg.stratField]` (payload = view). All dailies panels read `view.*`: HeatmapPanels (dailyHeatmap/monthlyReturns), DistributionPanels (quantiles), AnalyticalPanels (bootstrapCI/calmarByYear/streaks), StressWindowsPanel (stressWindows), BatchDPanels (styleDrift), MetricsColumn (quantiles/strategyWorst10/dates). Bundle excludes correlations/correlationMatrix/strategyMetrics (`build-payload.ts:400-476`), so the `{...payload,...bundle}` spread (`basis-context.tsx:127-136`) passes them through as cash. |
| 2 | SC-4: cash daily series + charts + panels byte-identical; bespoke composite `_metrics_result_for(clipped_mtm)` retired; MTM scalar shift is MTM-only | ✓ VERIFIED | `grep _metrics_result_for(clipped_mtm)` → 0; composite MTM now `stitch_clipped_series(clipped_mtm)` + `derive_basis_series` (`job_worker.py:4311-4318`); cash still `_metrics_result_for(clipped_cash)` (`:4206`). `csv_daily_returns` diff = 1 comment line only (0 code). Backend goldens untouched + green (test_golden_parity + minigolden 16 passed). Frontend SC-4 whole-payload snapshot + `JSON.stringify(cashOnly)===withoutBundle` additive-only tests pass. |
| 3 | Anti-divergence guard: persisted MTM scalars re-derive from persisted MTM dailies (round-trip through ONE helper) | ✓ VERIFIED | `derive_basis_series` (`basis_series.py:126-164`) computes scalars FROM `_drop_nonfinite(returns)` re-densified via `gap_fill_daily_returns` — scalar+series from ONE result object. `test_basis_series_roundtrip`/`test_cash_shaped_roundtrip` assert `_roundtrip_recompute(r)==r.metrics_json`. Wiring test `test_single_key_routes_through_shared_derive_and_persists` asserts `persist_spy.result IS the derive result` (never a separately-computed object). 11/11 pass. |
| 4 | Honest coverage: mask from persisted gap_spans; single-key interior marks ONLY where a DQ guard fired; basis-aware caption; series-absent → cash fallback + honest caption | ✓ VERIFIED | gap_spans derived in Python from the sparse series (`basis_series.py:146-150`) → persisted → `readMtmSeries` parse (`composite-read-path.ts:53-61`) → `deriveSegmentMarkers({gap_spans})` (`build-payload.ts:411`) → `view.missingSegments` → `TimeSeriesChart.tsx:255` gap seams. No client synthesis of interior marks. OQ1 probe confirms single-key interior sparsity appears ONLY when a DQ-01 guard fires (else span-level). Three-state caption `FactsheetView.tsx:494-502`; absent-bundle → honest cash fallback (keystone FALLBACK test). |
| 5 | Backbone-aligned durable: shared `derive_basis_series` is source/basis-agnostic; no bespoke composite compute/persist/mask remains for MTM | ✓ VERIFIED | `basis_series.py` module contract is basis-agnostic: `_KIND_BY_BASIS` map ready for cash, `sibling_kinds` passthrough for the Phases 104-106 adoption, conventions passed by caller. BOTH derive sites (`job_worker.py:2989`, `:4312`) call the ONE helper. Bespoke `_metrics_result_for(clipped_mtm)` = 0 occurrences. Composite persist heals via same `persist_basis_series`. |
| 6 | Ship-time honesty: no in-phase test claims live Zavara MTM attestation; re-derive backfill is a recorded post-deploy gate | ✓ VERIFIED | Zavara refs in tests are the simple/arithmetic *convention* override, not MTM-curve attestation. `FactsheetBody.basis.test.tsx:455` tests the pre-backfill CASH fallback. Post-deploy backfill + live corroboration recorded in 103-CONTEXT `<deferred>`, 103-VALIDATION, and 103-04 SUMMARY 'Flagged for ship-time'. |
| 7 | Wave-0 tests exist + falsifiable (round-trip guard, SC-4, per-basis keystone) — assert real behavior | ✓ VERIFIED | Round-trip: `test_basis_series.py` (11 pass). SC-4: `build-payload.test.ts` snapshot + additive-only. Keystone: `FactsheetBody.basis.test.tsx:405` sentinel-based, falsifiable BOTH ways (MTM sentinels '5d — no data'/'1999'/'P5 -9.0%' present only under MTM; SENTINEL_BTC correlation stays cash under both). Executor documented a real neuter-confirmation. Wiring tests spy the call site + prove degrade-on-patch. |

**Score:** 7/7 truths verified

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `analytics-service/services/basis_series.py` | Shared dailies-canonical derive: series → scalars + sparse rows + gap spans; persist/heal | ✓ VERIFIED | 216 lines; composes existing primitives (`_drop_nonfinite`, `gap_fill_daily_returns`, `compute_all_metrics`, `_consecutive_spans`); no new math. |
| `analytics-service/services/job_worker.py` | Both MTM derive sites call the shared helper | ✓ VERIFIED | Single-key `:2989` + composite `:4312` both `from services.basis_series import …` and call derive+persist. |
| `src/lib/factsheet/build-payload.ts` | `deriveSeriesBundle` factoring + `seriesByBasis` emission | ✓ VERIFIED | `deriveSeriesBundle` (`:181`) shared by cash+MTM; `seriesByBasis.mark_to_market` additive (`:400-415`); undefined when no MTM series. |
| `src/lib/factsheet/composite-read-path.ts` | `readMtmSeries` shared reader threaded both arms | ✓ VERIFIED | `readMtmSeries` (`:73`) service-role select on `strategy_analytics_series` kind `mtm_daily_returns`; threaded composite (`:239`) + single-key via `singleKeyBasisOpts` (`:321`), both surfaces (`factsheet .../page.tsx:137`, `discovery .../page.tsx:128`). |
| `src/app/factsheet/[id]/v2/basis-context.tsx` | `useBasisSeriesView` — identity under cash/absent; merged under MTM | ✓ VERIFIED | `:120-137` `{...payload,...bundle}` under MTM+bundle; original ref otherwise; reads context defensively (cash fallback, no crash). |
| `src/app/factsheet/[id]/v2/FactsheetBody.basis.test.tsx` | Falsifiable per-basis keystone | ✓ VERIFIED | Sentinel keystone `:405`; 13-test suite passes. |

### Key Link Verification

| From | To | Via | Status |
|------|-----|-----|--------|
| job_worker single-key seam | basis_series | `derive_basis_series` + `persist_basis_series` | ✓ WIRED (wiring test asserts call-site invocation + same-result persist) |
| job_worker composite seam | basis_series | `stitch_clipped_series` → `derive_basis_series` (bespoke path deleted) | ✓ WIRED |
| composite-read-path | strategy_analytics_series | service-role select eq(kind,'mtm_daily_returns') | ✓ WIRED |
| build-payload | deriveSegmentMarkers | persisted gap_spans → bundle.missingSegments | ✓ WIRED |
| TimeSeriesChart | useBasisSeriesView | view-merge replaces series/dates/comparators/mask/worst10 reads | ✓ WIRED |
| FactsheetView | resetXRange | effect on basis change, frozen context API (factsheet-context.tsx untouched) | ✓ WIRED |

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|---------------|--------|--------------------|--------|
| seriesByBasis.mark_to_market bundle | `opts.mtmSeries` | Python-derived persisted `mtm_daily_returns` row (real DB select in readMtmSeries) → deriveSeriesBundle | Yes (own axis + own panels recomputed; test asserts bundle ≠ cash top-level) | ✓ FLOWING |
| chart strat tracks under MTM | `view[stratField]` | `{...payload,...bundle}` merge | Yes (keystone sentinel proves MTM values render) | ✓ FLOWING |
| MTM missingSegments | `view.missingSegments` | persisted gap_spans → deriveSegmentMarkers | Yes (Python single implementation) | ✓ FLOWING |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Round-trip + persist/heal guard | `pytest tests/test_basis_series.py` | 11 passed | ✓ PASS |
| Single-key + composite wiring + SC-4 backend | `pytest tests/test_mtm_single_key.py tests/test_stitch_composite_job.py` | 99 passed (with test_basis_series) | ✓ PASS |
| Cash goldens (SC-4 backend) | `pytest tests/test_golden_parity.py tests/test_metrics_minigolden.py` | 16 passed | ✓ PASS |
| Frontend bundle/SC-4/keystone/context | `vitest run build-payload + composite-read-path + FactsheetBody.basis + basis-context` | 77 passed (4 files) | ✓ PASS |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|-------------|-------------|--------|----------|
| MTM-04 | 103-01/02/03/04 | Toggle swaps dailies; all charts + dailies-derivable panels follow; external panels stay cash; single-key + composite; per-basis coverage mask; scalars = derived cache + guard; no new valuation math; SC-4 | ✓ SATISFIED | All 7 truths verified above. |

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| analytics-service/services/job_worker.py | ~4300-4306 | Duplicated comment block ("Phase 103 (MTM-04): stitch → the ONE shared derive_basis_series…" appears twice) | ℹ️ Info | Cosmetic only; no functional effect. Worth a one-line cleanup. |
| (none) | — | No TBD/FIXME/XXX in any phase-103 modified file | — | Clean. |

### Human Verification Required

See frontmatter `human_verification`. Summary:
1. **In-browser toggle** — visually confirm all charts + dailies panels redraw on the MTM axis while external panels/headline scalars stay cash (code-wired + keystone-tested, but visual result needs eyes).
2. **Composite rail eyebrow** — DESIGN decision on the now-mixed 'BASIS · CASH SETTLEMENT' eyebrow (composite-only; single-key unaffected). Executor deliberately left copy verbatim.
3. **Post-deploy Zavara backfill + corroboration** — explicitly deferred ship-time gate; until backfill, factsheets honestly fall back to cash charts.

### Gaps Summary

No blocking gaps. All 7 observable truths are code-VERIFIED with green automated tests (backend 126 relevant tests + frontend 77 tests run in this verification, all passing). SC-4 cash byte-identity holds on both arms (goldens untouched + green; `csv_daily_returns` code diff = 0; frontend additive-only snapshot). The bespoke composite `_metrics_result_for(clipped_mtm)` is retired (grep = 0). The anti-divergence round-trip guard is true by construction and pinned. Coverage honesty holds — marks flow only from Python-derived gap_spans, matching the OQ1 probe (single-key interior marks only where a DQ guard fired). Status is `human_needed` solely because of the three visual/design/post-deploy items above, none of which block goal achievement.

**GOAL MET** (code axis). Human items are visual confirmation, a flagged composite-only design decision, and the explicitly-deferred post-deploy Zavara corroboration.

---
_Verified: 2026-07-12T19:55:40Z_
_Verifier: Claude (gsd-verifier)_
