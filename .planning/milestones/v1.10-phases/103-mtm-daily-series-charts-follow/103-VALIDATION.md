# Phase 103 — Validation Architecture

**Source:** extracted from `103-RESEARCH.md §Validation Architecture` + the four PLANs' `<test>`/`<automated>` blocks; confirmed by the opus plan-check (all Wave-0 gates falsifiable). Nyquist dimension 8 artifact.

## Wave-0 gaps (load-bearing)
| Gate | Plan/Task | Falsifiability (neuter → RED) |
|---|---|---|
| **OQ1 sparsity probe** | 103-01 T1 | Source probe (runs BEFORE mask code) — determines whether single-key MTM is interior-sparse or whole-or-degrade; gates mask CLAIMS/fixtures, not code shape. Composite interior gaps exist by construction (inter-member window holes). |
| **Anti-divergence guard** | 103-01 T2/T3 + 103-02 wiring | Persisted MTM scalars re-derive from the persisted MTM dailies via `gap_fill(_drop_nonfinite(...))`; scalar + series come from the SAME result object (no site computes scalars before persisting). Pins the `periods_per_year`/transform + `conventions` echo — catches the Phase-101 √252 class. Neuter the transform / compute-before-persist → RED. |
| **SC-4 cash byte-identity** | 103-02 T3 (backend), 103-03 T2 (frontend) | Nine analytics cash goldens unmodified + `git diff … grep -c "^-.*csv_daily_returns" == 0`; frontend inline snapshot (`JSON.stringify` order-sensitive) captured pre-refactor, asserted byte-identical after `deriveSeriesBundle` factoring. Cash moves → RED. |
| **Per-basis chart + dailies-panel test (keystone)** | 103-04 T3 | Under `basis==="mark_to_market"` the charts AND every dailies-derivable panel (calmarByYear/quantiles/streaks/bootstrapCI/styleDrift/stressWindows) read the MTM series; correlations/correlationMatrix stay CASH. Neuter the view-merge → charts+panels stay cash under MTM → RED; an external panel that wrongly followed → RED the other way. |
| **Frozen-spine guard** | 103-04 | `src/__tests__/phase-52-frozen-spine-guards.test.ts` — the 8 frozen paths git-diff-zero; TimeSeriesChart is the Phase-90 carve-out (editable). Touch a frozen file → RED. |

## Requirement → coverage
MTM-04 (toggle swaps dailies; all charts + all dailies-derivable panels follow; external-data panels stay cash; single-key + composite; full per-basis coverage mask; scalars = derived cache + guard; no new valuation math; SC-4) → 103-01 (helper+guard+probe), 103-02 (backend seams, cash sweep), 103-03 (payload bundle incl. dailies-derivable panels, SC-4 snapshot over the expanded set), 103-04 (charts + panels follow, external stays cash, mask render, keystone).

## Out of in-phase scope
- Cash routed through the shared helper → Phases 104-106 (backbone adopts the helper).
- LIVE Zavara MTM-curve corroboration → post-deploy ship-time gate (re-derive backfill first).
- Statistics panels basis: SETTLED (coordinator 2026-07-12) — DAILIES-DERIVABLE panels (streaks, calmarByYear, quantiles, bootstrapCI, styleDrift, stressWindows strat columns) FOLLOW MTM via the shared bundle; EXTERNAL-DATA panels (correlations, correlationMatrix) stay cash (no MTM equivalent). Classification with file:line lives in 103-03 <panel_classification>; stressWindows is the flagged MIXED panel (strat follows, BTC-bench column basis-invariant).
