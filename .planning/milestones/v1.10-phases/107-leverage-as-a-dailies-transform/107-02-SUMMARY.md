---
phase: 107-leverage-as-a-dailies-transform
plan: 02
subsystem: ui
tags: [react, factsheet, leverage, kpi-strip, metrics-column, control-bar, delete, vitest]

# Dependency graph
requires:
  - phase: 107-01
    provides: leverage-composed useBasisSeriesView (basis-merge → r→L·r re-derive) + exported deriveSeriesBundle/LeverageContext
provides:
  - KpiStrip + right rail + α/β/IR all follow L honestly via the levered view (SC-1/SC-2 user-visible)
  - the MODELED/CAVEAT/α-IR-blanking/BASE·1× disclosure apparatus DELETED (SC-3)
  - useLeveragedMetrics + useModeledLeverage deleted; leverage-context is slider-state-only (SC-5 kill)
  - leverage eligibility widened to the active RESOLVED basis (cash or MTM+bundle)
  - reworded muted what-if caption + clamp copy landed verbatim (UI-SPEC)
affects: [factsheet-view, kpi-strip, metrics-column, control-bar, leverage-context]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Consumer rewire onto the shared levered view: strip reads view.strategyMetrics when leverage actually applied, else the persisted-basis overlay (byte-identical at L=1)"
    - "Disclosure-as-honesty: once the whole page re-derives levered, the dishonesty disclosures have nothing to disclose → delete, not reword-only"

key-files:
  created: []
  modified:
    - src/app/factsheet/[id]/v2/FactsheetView.tsx
    - src/app/factsheet/[id]/v2/leverage-context.tsx
    - src/app/factsheet/[id]/v2/FactsheetView.leverage.test.tsx
    - src/app/factsheet/[id]/v2/leverage-context.test.tsx
    - src/app/factsheet/[id]/v2/FactsheetBody.basis.test.tsx

key-decisions:
  - "KpiStrip source = leverageApplied ? view.strategyMetrics : useBasisMetrics(payload).m — preserves the persisted-MTM scalar overlay at L=1/MTM-without-bundle (SK-TOGGLE-1 honesty) AND levers honestly when the view actually applied L. The plan's literal `m = view.strategyMetrics` would have regressed the persisted-MTM overlay under MTM-without-bundle."
  - "The what-if caption gate is the EXACT mirror of the plan-01 view guards (appliedL≠1 && !composite && periodsPerYear!=null && !(MTM && !bundle)) so it can never claim a what-if the view did not apply (T-107-02)."
  - "Eligibility widened to !(MTM && seriesByBasis.mark_to_market == null) — leverage levers whichever basis is displayed-and-resolved; hidden only when MTM is unresolved (no-fabrication, mirrors the view guard)."

patterns-established:
  - "The seven strip scalars + the α/β/IR joint both read the ONE leverage-composed view; the rail (MetricsColumn) already read it — so strip == rail == charts by construction at L≠1."

requirements-completed: [LEV-BB]

# Metrics
duration: 24min
completed: 2026-07-15
---

# Phase 107 Plan 02: Rewire consumers + delete the disclosure apparatus Summary

**Rewired the two leverage consumers (KpiStrip headline scalars + comparator α/β/IR) onto the plan-01 leverage-composed `useBasisSeriesView`, deleted the entire MODELED / LEVERAGE_CAVEAT / α-IR-blanking / BASE·1× disclosure apparatus plus the two derived hooks (`useLeveragedMetrics`/`useModeledLeverage`), landed the reworded muted what-if caption + clamp copy verbatim, and widened leverage eligibility to the active resolved basis — so the whole factsheet follows L honestly and the dishonesty disclosures have nothing left to disclose.**

## Performance
- **Duration:** ~24 min
- **Tasks:** 3 (all TDD-style rewrites)
- **Files modified:** 5

## Accomplishments
- **Task 1 (`11173c32`):** KpiStrip now reads the levered view when leverage is applied and the persisted-basis overlay otherwise (byte-identical at L=1); α/IR follow the view's levered joint honestly (β→L·β / α→L·α), the `modeled` suppression dropped (only the MTM-bundle-absent suppression survives); deleted `LEVERAGE_CAVEAT` + the amber `MODELED` eyebrow and replaced them with the muted `role="status"` what-if caption (UI-SPEC verbatim, `MAX_LEVERAGE` interpolated); widened `leverageEligible` to the active resolved basis; reworded the two clamp messages.
- **Task 2 (`7cb4a40d`):** deleted the `BASE · 1× TRACK` rail eyebrow + the `useModeledLeverage` read in `MetricsColumnWithBasis` (D4 no-orphan — a plain single-key non-MTM-participant returns the bare `<MetricsColumn>`, no wrapper div); `FactsheetView` import now lists only `LeverageProvider, useLeverage`.
- **Task 3 (`355b6200`):** deleted `useModeledLeverage` + `useLeveragedMetrics` (incl. the standalone `compute(...map(r => L*r)...)` — the SC-5 second-leverage-path kill; grep-gate 0) and the now-orphaned imports; `leverage-context.tsx` is slider-state-only and no longer imports `basis-context` (dissolving the transient module cycle). `LeverageProvider`/`useLeverage`/`LeverageContext` kept verbatim.

## Task Commits
1. **Task 1: KpiStrip swap + disclosure delete + reworded copy + eligibility widen** — `11173c32` (feat)
2. **Task 2: Delete the BASE·1× rail eyebrow (D4) + rewrite LEV-MTM-1** — `7cb4a40d` (feat)
3. **Task 3: Delete the two derived hooks; prune leverage-context.test.tsx** — `355b6200` (refactor)

## Files Created/Modified
- `src/app/factsheet/[id]/v2/FactsheetView.tsx` — KpiStrip metrics source swap + honest α/IR + muted what-if caption; `MetricsColumnWithBasis` base-track eyebrow deleted (D4); ControlBar eligibility widened + clamp copy reworded; disclosure comments retired.
- `src/app/factsheet/[id]/v2/leverage-context.tsx` — provider/state only (~58 lines); both derived hooks + orphaned imports deleted; header doc updated.
- `src/app/factsheet/[id]/v2/FactsheetView.leverage.test.tsx` — rewritten: follow-L (Ann.Vol exactly 2× the derived base), honest α (≈2× at display precision, never "—"), widened eligibility (MTM+bundle renders / MTM-no-bundle hides), verbatim caption + clamp pins; ~50-day fixtures inside the BTC window so the L≠1 re-derive stays fast and the joint is non-degenerate.
- `src/app/factsheet/[id]/v2/leverage-context.test.tsx` — pruned to Test 1 (throws outside provider) + Test 6 (GUARD-04 source scan).
- `src/app/factsheet/[id]/v2/FactsheetBody.basis.test.tsx` — rewrote LEV-MTM-1 (levered MTM scalars at L=2 WITH a bundle + what-if caption) + companion (unlevered persisted-MTM overlay WITHOUT a bundle) + a D4 no-orphan pin (no base-track eyebrow at any L).

## LOC vs the ~780 target (git diff --stat `11173c32^..HEAD`)
390 insertions / 598 deletions across the 5 files (net −208; ~988 lines of churn). The deleted disclosure/hook apparatus: `leverage-context.tsx` −146 net (the two derived hooks + doc blocks), `FactsheetView.tsx` −210 changed (the CAVEAT const, the amber MODELED eyebrow, the BASE·1× rail eyebrow, and the α/IR leverage-blanking), plus the two test files pruned/rewritten. Consistent with the SC-3 "~780 LOC disclosure class" target once the levered-view rewire lines are netted against the raw deletions.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Correctness] KpiStrip source preserves the persisted-MTM scalar overlay (not a bare `view.strategyMetrics`)**
- **Found during:** Task 1
- **Issue:** The plan's literal instruction (`const m = view.strategyMetrics`) would show CASH scalars under an unresolved MTM basis (MTM selected, no series bundle), because the plan-01 view returns the payload by reference in that case. That regresses the established Phase-102 behavior (`SK-TOGGLE-1`, not in the rewrite scope) which shows the persisted `metricsByBasis.mark_to_market` headline scalars under MTM — the honest, authoritative persisted cache. Showing cash under an MTM label would be a mislabel.
- **Fix:** Sourced the strip as `const m = leverageApplied ? view.strategyMetrics : useBasisMetrics(payload).m`, where `leverageApplied` is the exact mirror of the plan-01 view guards. This is byte-identical to pre-change at L=1 across ALL cases (cash, MTM+bundle, MTM-no-bundle — SC-4), levers honestly when the view applied L, and keeps the persisted-MTM overlay under MTM-without-bundle. Added `useBasisMetrics`/`useBasisOrCash` imports.
- **Consequence for the Task-2 companion:** the LEV-MTM-1 companion asserts the UNLEVERED PERSISTED-MTM overlay under MTM-without-bundle (not the plan's loosely-worded "cash fallback") — the more-honest, SK-TOGGLE-1-consistent behavior. The no-fabrication guard still forbids levering the cash-fallback series under an MTM label (no what-if caption renders).
- **Files modified:** `src/app/factsheet/[id]/v2/FactsheetView.tsx`, `FactsheetView.leverage.test.tsx`, `FactsheetBody.basis.test.tsx`
- **Verification:** `SK-TOGGLE-1` + all 22 basis-suite tests green; the widened-eligibility + honest-α tests pin the new behavior falsifiably.
- **Committed in:** `11173c32` (Task 1) + `7cb4a40d` (Task 2)

**Total deviations:** 1 auto-fixed (1 correctness). No architectural changes; no package installs; no scope creep beyond the plan's files.

## Acceptance / Verification
- `grep -c "useLeveragedMetrics|LEVERAGE_CAVEAT|MODELED"` FactsheetView.tsx == 0; `"What-if projection at"` == 1; no `basis === "cash_settlement"` in `leverageEligible`; over-max clamp interpolates `${MAX_LEVERAGE}×` (no literal `10×`).
- `grep -c "useModeledLeverage|base-track-eyebrow|BASE · 1× TRACK"` FactsheetView.tsx == 0; import lists only `LeverageProvider, useLeverage`.
- leverage-context.tsx non-comment `useLeveragedMetrics|useModeledLeverage|compute(` == 0; keep-list (`LeverageProvider`/`LeverageContext`/`useLeverage`) intact; Test 6 GUARD-04 green.
- SC-5 repo-wide: NO standalone `compute(...map(r => L*r)...)` outside `scenario.ts`.
- Wave gate `npx vitest run "src/app/factsheet/[id]/v2" src/lib/factsheet --no-file-parallelism` → **42 files / 454 tests green**. `tsc --noEmit` clean; `npm run lint` 0 errors (1 pre-existing EquityChart warning, out of scope).
- Byte-untouched: `src/lib/scenario.ts`, `src/lib/leverage.ts`, and the `build-payload.test.ts.snap` SC-4 golden all unchanged (`git diff --exit-code` passes).

## Known Stubs
None — no placeholder/empty-data stubs introduced. The strip/rail/charts re-derive real levered bundles; at L=1 and under every guard the render is the byte-identical unlevered view.

## Threat Flags
None — this plan removes DOM (the eyebrows) and rewords copy; it introduces no new endpoint, auth path, file access, or schema surface. The only untrusted input (the leverage number field) keeps its existing clamp byte-identical except the two reworded message strings (T-107-01 mitigation held); the what-if caption gate mirrors the view guards exactly (T-107-02); GUARD-04 source scan stays green (T-107-04).

## Self-Check: PASSED
- FOUND: src/app/factsheet/[id]/v2/FactsheetView.tsx
- FOUND: src/app/factsheet/[id]/v2/leverage-context.tsx
- FOUND: src/app/factsheet/[id]/v2/FactsheetView.leverage.test.tsx
- FOUND: src/app/factsheet/[id]/v2/leverage-context.test.tsx
- FOUND: src/app/factsheet/[id]/v2/FactsheetBody.basis.test.tsx
- FOUND commit: 11173c32 (Task 1)
- FOUND commit: 7cb4a40d (Task 2)
- FOUND commit: 355b6200 (Task 3)

---
*Phase: 107-leverage-as-a-dailies-transform*
*Completed: 2026-07-15*
