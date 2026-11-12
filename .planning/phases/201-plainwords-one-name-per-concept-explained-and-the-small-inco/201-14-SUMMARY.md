---
phase: 201-plainwords-one-name-per-concept-explained-and-the-small-inco
plan: 14
subsystem: ui-copy
tags: [plainwords, copy-census, term, dates, navigation]
requires:
  - phase: 201-25
    provides: copy census ledger plan-14
  - phase: 201-26
    provides: required viewer and nav names
provides:
  - mobile nav item that opens the Scenario tab reads Scenario
  - mandate headings open their definition
  - widgets print dates through formatDay / formatDayTime
  - equity chart series and legend read Allocation
  - outcomes panel heading reads Replacement outcomes (no Term)
  - ledger plan-14 with pending {}
affects: [201-23, 201-24, 201-28, 201-29, 201-30, 201-31, 201-33, 201-34]
tech-stack:
  added: []
  patterns: [Term Form A on heading words, formatDay/formatDayTime in widgets, MONTH_ABBR for axis ticks]
key-files:
  created: []
  modified:
    - src/components/layout/Sidebar.tsx
    - src/components/layout/Sidebar.test.tsx
    - src/components/layout/MobileNav.test.tsx
    - src/app/(dashboard)/allocations/components/BridgeWidget.tsx
    - src/app/(dashboard)/allocations/components/BridgeWidget.test.tsx
    - src/app/(dashboard)/allocations/components/BridgeWidget.variants.test.tsx
    - src/app/(dashboard)/allocations/components/BridgeDrawer.tsx
    - src/app/(dashboard)/allocations/components/BridgeDrawer.test.tsx
    - src/app/(dashboard)/allocations/components/MandateQuickSetCard.tsx
    - src/app/(dashboard)/allocations/components/MandateQuickSetCard.test.tsx
    - src/app/(dashboard)/allocations/components/HoldingDetail.tsx
    - src/app/(dashboard)/allocations/components/HoldingDetail.test.tsx
    - src/app/(dashboard)/allocations/components/CustomRangePicker.tsx
    - src/app/(dashboard)/allocations/components/CustomRangePicker.test.tsx
    - src/app/(dashboard)/allocations/MandateTabPanel.tsx
    - src/app/(dashboard)/allocations/MandateTabPanel.test.tsx
    - src/app/(dashboard)/allocations/widgets/performance/EquityChart.tsx
    - src/app/(dashboard)/allocations/widgets/performance/EquityChart.test.tsx
    - src/app/(dashboard)/allocations/widgets/performance/EquityChartWidget.header.test.tsx
    - src/app/(dashboard)/allocations/widgets/outcomes/OutcomesWidget.tsx
    - src/app/(dashboard)/allocations/widgets/outcomes/outcomes.test.tsx
    - src/app/(dashboard)/allocations/widgets/intelligence/RegimeDetector.tsx
    - src/app/(dashboard)/allocations/widgets/intelligence/intelligence.test.tsx
    - src/app/(dashboard)/allocations/widgets/attribution/AlphaBetaDecomposition.tsx
    - src/app/(dashboard)/allocations/widgets/risk/TailRisk.tsx
    - src/app/(dashboard)/allocations/widgets/risk/VarExpectedShortfall.tsx
    - src/app/(dashboard)/allocations/widgets/risk/risk.test.tsx
    - src/lib/display-labels.ts
    - src/lib/display-labels.test.ts
    - scripts/copy-census/ledgers/plan-14.ts
decisions:
  - "F-04 (2026-11-11): the outcomes heading takes Replacement outcomes with no Term; the transitional bridge Term wrappers from 6a7ccc457 stay for plans 201-28..201-33 to remove."
  - "CorrelationMatrix.tsx 'Correlation matrix' is a permanent ledger exception (screen-reader scroll-region name, not a label position); pinnedExceptionCount is 1."
metrics:
  tasks: 3
  completed: 2026-11-11
status: complete
actuals:
  tokens: 9000
  tasks: 3
  commits: 3
plan_head_before: 8724de1ab708bff9ef2d452ffeb07ac6c4a2d03b
plan_head_after: 541bc8bc8290c32f2ab604921506f891b4ccfca2
---

# Phase 201 Plan 14: PLAINWORDS nav, mandate surfaces and widgets Summary

The mobile nav item that opens the Scenario tab now reads Scenario, mandate headings open their definition, the allocation widgets print one date format through the helper and call the holdings series Allocation, and the outcomes panel heading reads Replacement outcomes; ledger plan-14 ends with `pending: {}`.

## Tasks

| Task | Commit | Notes |
| --- | --- | --- |
| 1 (tracer) mobile nav item reads Scenario (D-07) | 2faea2528 | committed by the interrupted executor |
| 2 mandate surfaces, dates and copy | 6a7ccc457 | committed by the interrupted executor, before F-04 |
| 3 widgets' dates, Allocation series, remaining terms, ledger empty | 541bc8bc8 | finished in this resume |

## Resume handling

The interrupted executor left the Task 3 work uncommitted. The diff was inspected and kept: EquityChart dates and the Allocation series, RegimeDetector and OutcomesWidget dates, the VaR, CVaR, P5 and Beta Terms, the AlphaBetaDecomposition noun (`book's` to `allocation's` in the tick comment and the beta-contribution sentence), and the ledger. Not yet done and finished here, per the revised plan: the outcomes heading. The uncommitted tree still wrapped the retired word in a `bridge` Term there. That wrapper was replaced with `Replacement outcomes` (no Term), and the test arm that asserted the Term became an assertion that the heading reads `Replacement outcomes`, contains no `Bridge` and no `[data-term]`. The `'Feedback loop' badge` header case in `outcomes.test.tsx` now expects `Replacement outcomes`. The empty-state case ("Your Bridge outcomes will appear here...") and the sub-line stay for plan 201-30. No new `bridge` Term wrapper was added and no other Bridge string was reworded.

## Verification (real output)

- Task 3 scoped vitest (widgets, Bridge*, MandateQuickSetCard, HoldingDetail, CustomRangePicker, MandateTabPanel, layout, display-labels, copy-census, figure-gate-census): 65 files passed, 828 tests passed, 0 failed.
- Task 1 verify scope (`src/components/layout/`, copy-census) is a subset of the run above and is green; layout + outcomes + EquityChart re-run after restore: 10 files, 227 tests passed.
- `npx tsx scripts/copy-census/run.ts --ledger plan-14`: exit 0, no remaining hits.
- `npx eslint` on every touched source file: exit 0, clean.
- `npm run typecheck` (`tsc --noEmit`): no errors.
- Acceptance: `grep -a -c 'label: "Bridge"' Sidebar.tsx` = 0; the BridgeWidget + CustomRangePicker `toLocaleDateString(` code-line count = 0; `Replacement outcomes` count 3 in OutcomesWidget.tsx and 5 in outcomes.test.tsx; ledger has `pending: {}`.
- e2e: `grep -a -rn` for a locator on the old mobile nav name in `e2e` and `tests` found none, so no e2e file changed.

gc-201-14-neuter: gate=MobileNav.test.tsx result=red restored=identical (Sidebar.tsx label put back to "Bridge": 4 MobileNav arms RED, naming the Scenario label; cp -p restore, cmp exit 0, GREEN)
gc-201-14-neuter: gate=outcomes.test.tsx result=red restored=identical (heading put back to "Bridge outcomes": the `Replacement outcomes` heading arm and the header badge arm RED; cp -p restore, cmp exit 0, GREEN)
gc-201-14-neuter: gate=EquityChart.test.tsx result=red restored=identical (hover tooltip put back to a locale date: "U-15: the hover tooltip prints the helper day" RED; cp -p restore, cmp exit 0, GREEN)
gc-201-14-gates: vitest=green eslint=clean tsc=clean

RED lines (from the neuter runs): `7 failed | 95 passed (102)` across MobileNav.test.tsx (4), outcomes.test.tsx (2) and EquityChart.test.tsx (1).

## Deviations from Plan

### Auto-fixed Issues

None beyond the resume items above.

### Plan-anchor check

`node scripts/verify-plan-anchors.mjs <plan>` exits 1 on one anchor: `<!-- verify-symbol: BridgeWidget.tsx toLocaleDateString -->` (line 80). The symbol is absent because Task 2 (6a7ccc457) removed the locale date call, which is the plan's own deliverable. This is a stale precondition anchor, not a defect in the tree. Task 1's anchors (`Sidebar.tsx tab=scenario`) and the other four resolve (6 claims checked). Plan 201-24 or the planner may want to drop that anchor.

## cross-plan-pins

None found: no `HoldingsTabPanel.*`, `Scenario*`, `AllocationDashboardV2.*` or `AllocationsTabs.*` test pinned a changed literal in the scoped runs.

## reported-not-edited

None. No phase-200 file (ApiKeyManager.tsx, ConfirmKeyChangeDialog.tsx, api-key-flow.spec.ts, sync-analytics-flow.spec.ts) needed a copy change from this plan.

## Left for later plans (by design)

- `pairedFloorReason("BTC", ..., "book", ...)` noun in AlphaBetaDecomposition: plan 201-23 (the `allocation` member arrives with plan 201-10).
- Transitional `bridge` Term wrappers (BridgeWidget, BridgeDrawer, BridgeOutcomeBanner, MandateTabPanel) and every other Bridge string: plans 201-28 to 201-31, key removed by 201-33.
- OutcomesWidget sub-line and empty-state sentence: plan 201-30.
- Mobile nav `scenario` tooltip (Form B, U-27): plan 201-34.

## Known Stubs

None.

## Threat Flags

None. T-201-19 mitigated: the helper reads UTC fields, and the EquityChart pins a near-midnight instant (`2026-10-09T23:59:00.000Z` reads `Oct 9, 2026, 23:59 UTC`).

## Self-Check: PASSED

- 2faea2528, 6a7ccc457, 541bc8bc8 all ancestors of HEAD; `git rev-list --count 8724de1ab..HEAD` = 3.
- Every file in key-files exists in the worktree (verified through the diff stat against the base).
