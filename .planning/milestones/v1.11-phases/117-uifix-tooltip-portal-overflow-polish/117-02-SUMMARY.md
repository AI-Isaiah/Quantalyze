---
phase: 117-uifix-tooltip-portal-overflow-polish
plan: 02
subsystem: ui
tags: [accessibility, focus-visible, tailwind, overflow, wcag, ring-inset]

# Dependency graph
requires:
  - phase: 117-uifix (plan 01)
    provides: precedent for RED-first className regression tests on the factsheet/allocations UI surfaces
provides:
  - Clip-proof inset focus-visible ring at all six enumerated overflow sites (factsheet section-nav, allocations tab strip, shared ResponsiveTable scroll region, both heatmap regions, correlation-matrix region, flagged-holdings expand button)
  - Central ResponsiveTable fix covering MetricsColumn worst-drawdowns + StressWindowsPanel + every other consumer
  - RED-first rendered-className regression suite pinning inset-ring presence / positive-offset-outline absence per fixed site
  - Documented ExposureByClass audit (no focusable child → no change, Rule 2)
affects: [117-uifix (remaining UIFIX-03 plan), any keyboard user tabbing through the enumerated overflow containers]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent — clip-proof inset ring for focusable controls inside overflow-x-auto / overflow-hidden ancestors (WCAG 2.4.7 + 1.4.11)"
    - "positive-offset CSS outline is NOT clip-proof (paints outside the border box → clipped by ancestor overflow); reserve it for non-overflow contexts only"

key-files:
  created:
    - src/app/factsheet/[id]/v2/focus-ring-clipproof.test.tsx
  modified:
    - src/app/factsheet/[id]/v2/FactsheetView.tsx
    - src/app/factsheet/[id]/v2/HeatmapPanels.tsx
    - src/app/factsheet/[id]/v2/DistributionPanels.tsx
    - src/components/ResponsiveTable.tsx
    - src/app/(dashboard)/allocations/AllocationsTabs.tsx
    - src/app/(dashboard)/allocations/ScenarioFlaggedHoldingsList.tsx
    - src/components/ResponsiveTable.test.tsx
    - src/app/(dashboard)/allocations/AllocationsTabs.test.tsx
    - src/app/(dashboard)/allocations/ScenarioFlaggedHoldingsList.test.tsx

key-decisions:
  - "Full-opacity ring-accent, NOT the MandateSegmentedRadio precedent's ring-accent/20 — a 20%-opacity accent fails the WCAG 1.4.11 ≥3:1 non-text-contrast floor the UI-SPEC binds this fix to (Rule 7 — surface the conflict, pick the tested-for-contrast option)"
  - "Fixed the shared ResponsiveTable region centrally (one edit) rather than each consumer, so MetricsColumn worst-drawdowns + StressWindowsPanel + all other consumers inherit the ring with zero per-site churn"
  - "ExposureByClass (site 7) audited and left byte-unchanged — the overflow-x-auto drilldown div has zero focusable children (no button/a/href/tabIndex/input/onClick/role), so WCAG 2.4.7 does not apply; adding ring classes would be dead CSS (Rule 2)"

patterns-established:
  - "The clip-proof idiom is now the standard for any focus-visible control living inside a scroll/overflow container; the plain positive-offset outline stays valid only OUTSIDE overflow contexts"

requirements-completed: [UIFIX-02]

# Metrics
duration: 12min
completed: 2026-07-18
---

# Phase 117 Plan 02: UIFIX-02 Clip-Proof Focus Rings Summary

**Replaced the positive-offset / default outline focus indicators at six overflow sites with the in-repo clip-proof `focus-visible:ring-2 ring-inset ring-accent` idiom (full-opacity accent for WCAG 1.4.11 contrast), so keyboard-focus indicators render fully instead of being clipped at the scroll-container edge (WCAG 2.4.7) — with the shared ResponsiveTable region fixed centrally and ExposureByClass honestly audited as focusable-child-free.**

## Performance

- Duration: ~12 min across 3 tasks (2 commits: RED tests, then component fixes; Task 3 was a verification-only sweep with nothing to commit).

## What Was Built

**Task 1 (`260d756e`, test — RED):** Rendered-DOM className regression assertions, each failing by assertion (className mismatch) on the unfixed tree, never by crash:
- NEW `focus-ring-clipproof.test.tsx` (3 describes): factsheet section-nav (via the kpistrip FactsheetBody harness idiom, copied not edited — leaves `FactsheetView.kpistrip.test.tsx` free for plan 117-03), HeatmapPanels monthly + daily-calendar regions, DistributionPanels correlation-matrix region.
- Extended `ResponsiveTable.test.tsx`, `AllocationsTabs.test.tsx`, `ScenarioFlaggedHoldingsList.test.tsx`.
- Positive assertions pin the three ring tokens; negative assertions pin the trap (`outline-offset-1` absent from nav anchors, `focus-visible:outline` absent from tab buttons, `ring-accent/20` absent everywhere). Test names/comments cite WCAG 2.4.7 + the outside-vs-inside paint mechanics (Rule 9). 7 new assertions RED; all pre-existing tests in the three extended files stayed green.

**Task 2 (`bb97d09d`, fix — GREEN):** Surgical className-only edits at the six fix sites:
1. FactsheetView section-nav anchors (`:1037`): positive-offset outline → inset ring.
2. AllocationsTabs `TAB_BUTTON_ACTIVE`/`INACTIVE`: `focus-visible:outline*` → inset ring in both consts; updated the now-stale "byte-identical" comment to record the Phase-117 focus-idiom change honestly.
3. ResponsiveTable region: appended the ring tokens to the shared class list — central fix for all consumers.
4. HeatmapPanels both regions + DistributionPanels correlation region: appended ring tokens.
5. ScenarioFlaggedHoldingsList expand/collapse button: added the previously-absent focus indicator.
6. ExposureByClass: audited, no change (see Deviations).

**Task 3 (verification-only):** Cross-suite regression sweep — factsheet v2 directory + AllocationsTabs + MandateTabPanel + ScenarioFlaggedHoldingsList + ResponsiveTable = **33 files / 299 tests green**; `npm run lint` exit 0 with only the pre-existing `EquityChart.tsx` `react-hooks` warning. No collateral regressions → nothing to fix or commit.

## Verification

- Task 1: 7 new assertions RED by className mismatch; 52 pre-existing green.
- Task 2: all Task-1 assertions GREEN; both reflow suites (MetricsColumn worst-drawdowns, StressWindowsPanel) green — the region contract (`overflow-x-auto` + role + tabIndex) unchanged; `npx tsc --noEmit` exit 0.
- Task 3: 299/299 green; lint 0 errors (1 pre-existing warning).
- Scope checks: the 7 other `focus-visible:outline*` sites in FactsheetView.tsx are byte-untouched (grep count 7 unchanged); no `ring-accent/20` in any Phase-117 component diff hunk; `git diff` touched only className strings + one stale comment.

## Deviations from Plan

### Audit outcome (planned fix-or-record)

**1. [Rule 2 — audit-only] ExposureByClass.tsx (site 7) left byte-unchanged**
- **Found during:** Task 2 audit.
- **Finding:** the `overflow-x-auto` (+ conditional `overflow-y-auto`) drilldown container at `:142` has ZERO focusable children — a whole-file grep for `<button` / `<a` / `href=` / `tabIndex` / `<input` / `<select` / `<textarea` / `onClick` / `role="region"` / `role="button"` returned nothing (195-line file). The container itself is not focusable (no `tabIndex`, no `role`).
- **Decision:** made NO change and recorded the finding. WCAG 2.4.7 applies to focusable UI; the container paints no focus ring to clip, so adding ring classes would be dead CSS (Rule 2). No matching RED assertion added (intentional per plan).

No other deviations — the six fix sites were repointed exactly as written.

## Known Stubs

None. All changes are additive className edits wired to live rendered DOM; no placeholder/empty-data paths introduced.

## Self-Check: PASSED

- Created file exists: `src/app/factsheet/[id]/v2/focus-ring-clipproof.test.tsx` — FOUND.
- Commits exist: `260d756e` (test) FOUND, `bb97d09d` (fix) FOUND.
