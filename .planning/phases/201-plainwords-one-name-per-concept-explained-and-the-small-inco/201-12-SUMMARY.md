---
phase: 201-plainwords-one-name-per-concept-explained-and-the-small-inco
plan: 12
subsystem: my-allocation-overview
tags: [d-01, d-02, d-03, d-04, d-06, d-07, d-18, term, my-allocation, kpi-strip, copy-census]
requires: [201-25, 201-26]
provides:
  - KPI strip labels (YTD TWR, Sharpe, Max DD 12m, Avg |rho|) render through Term; Max DD 12m opens the `last12m` context text
  - live-holdings wording ("allocation") across the overview, glance panel, note card and KPI panel
  - Mandate heading on the dashboard renders through Term k="mandate"
  - plan-12 copy census ledger emptied (`pending: {}`)
affects: [201-24]
tech-stack:
  added: []
  patterns:
    - "KpiPanel label accepts a node, so a Term can sit on the label while the caption stays a sibling (U-22)"
    - "machine keys (allocation.book.* warning ids) are kept, not renamed, so no consumer is orphaned"
key-files:
  created: []
  modified:
    - src/app/(dashboard)/allocations/components/KpiStrip.tsx
    - src/app/(dashboard)/allocations/components/KpiStrip.test.tsx
    - src/app/(dashboard)/allocations/components/KpiStrip.scenario.test.tsx
    - src/app/(dashboard)/allocations/components/KpiStrip.pair-coverage.test.tsx
    - src/app/(dashboard)/allocations/components/GlancePanel.tsx
    - src/app/(dashboard)/allocations/components/GlancePanel.test.tsx
    - src/app/(dashboard)/allocations/components/GlancePanel.scenario-parity.test.tsx
    - src/app/(dashboard)/allocations/components/DashboardNoteCard.tsx
    - src/app/(dashboard)/allocations/components/DashboardNoteCard.test.tsx
    - src/app/(dashboard)/allocations/components/StressVarSection.tsx
    - src/app/(dashboard)/allocations/components/StressVarSection.test.tsx
    - src/app/(dashboard)/allocations/components/MissingDataMessage.test.tsx
    - src/app/(dashboard)/allocations/AllocationDashboardV2.tsx
    - src/app/(dashboard)/allocations/AllocationDashboardV2.rebuilding.test.tsx
    - src/app/(dashboard)/allocations/AllocationDashboardV2.no-key-mandate.test.tsx
    - src/app/(dashboard)/allocations/OverviewRisk.history-parity.test.tsx
    - src/app/(dashboard)/allocations/lib/book-figures.ts
    - src/app/(dashboard)/allocations/lib/dust.ts
    - src/app/(dashboard)/allocations/lib/dust.test.ts
    - src/app/(dashboard)/allocations/lib/live-holdings-summary.ts
    - src/app/(dashboard)/allocations/lib/live-holdings-summary.test.ts
    - src/components/kpi/KpiPanel.tsx
    - src/components/kpi/KpiPanel.test.tsx
    - src/lib/degrade-warnings.ts
    - src/lib/degrade-warnings.test.tsx
    - src/__tests__/display-sign-census-misses.test.tsx
    - scripts/copy-census/ledgers/plan-12.ts
decisions:
  - "allocation.book.* warning ids are identifiers and stay as they are; only user-facing copy was renamed."
  - "GlancePanel scenario-parity helper reads the figure label off the label div, because labels may now be Terms."
metrics:
  tasks: 3
  completed: 2026-11-11
status: complete
actuals:
  tokens: 60000
  tasks: 3
  commits: 3
plan_head_before: 8724de1ab708bff9ef2d452ffeb07ac6c4a2d03b
plan_head_after: fd1e49b4c627866b2893c1a2eb1df4ad4dc0c6ab
---

# Phase 201 Plan 12: My allocation overview Summary

The My allocation overview now names the allocator's live holdings "allocation" everywhere, wraps the KPI strip labels and the Mandate heading in Term, and has an empty census ledger.

## What was built

- **Task 1 (tracer, 6c14d90b4):** KpiStrip cells carry an optional registry term; the Sharpe label is a Term and the caption stays outside the trigger (U-22). The region reads "Allocation KPIs".
- **Task 2 (88033c110):** "Allocation at a glance", "Allocation equity", "Allocation equity curve", delta pill "vs current allocation", title "Current allocation: {value}", aria-label "{label} delta vs current allocation: ...", fallback name "My allocation", and the note card placeholder from UI-SPEC.
- **Task 3 (fd1e49b4c):** GlancePanel cells carry a Term (twr, sharpe, max_drawdown/last12m); KpiStrip gained max_drawdown (`last12m`) and avg_abs_correlation Terms; the Mandate h2 is a Term in both overview branches; StressVarSection, book-figures, dust, live-holdings-summary and degrade-warnings copy say allocation.

## Verification (re-run on resume)

- `node scripts/verify-plan-anchors.mjs <plan>`: OK, 2 claims checked.
- Scoped vitest (the Task 3 verify command): 39 files, 814 tests passed.
- Task 1 and 2 verify files (KpiStrip, KpiStrip.scenario, display-sign-census-misses): 65 tests passed.
- `npx tsx scripts/copy-census/run.ts --ledger plan-12`: no remaining hits; ledger ends `pending: {}`, `exceptions: []`, `pinnedExceptionCount: 0`. `copy-census.test.ts` is green.
- eslint on every touched source file: clean. `npm run typecheck`: clean.
- Acceptance greps: "Portfolio KPIs" in KpiStrip.tsx 0, "Book at a glance" in GlancePanel.tsx 0, "My Portfolio" in AllocationDashboardV2.tsx 0.

gc-201-12-neuter: gate=KpiStrip.scenario.test.tsx+display-sign-census-misses.test.tsx result=red restored=identical
(Neutered by putting `delta vs current book` back into the KpiStrip aria-label: 20 tests went RED naming the aria-label and the "vs current allocation" sibling; restored from a `cp -p` backup, `cmp` exit 0, 65 tests GREEN.)

gc-201-12-gates: vitest=green eslint=clean tsc=clean

human-verify: KPI-strip underline backstop, Overview tab at 390px and 1440px: the dotted Term underline on YTD TWR, Sharpe, Max DD 12m and Avg |rho| must not collide with the delta pill or the caption under the label.

cross-plan-pins: for plan 201-24, `e2e/fixtures/narrowcharts-desktop-1280.json` and `e2e/fixtures/narrowcharts-longlabels-desktop-1280.json` still record the old fallback name; `ScenarioComposer*`, `SavedScenariosList*`, `HoldingsTabPanel.*`, `AddAllocationFlow.*` and `PortfolioImpactPanel.*` tests were not run in this plan. `src/lib/factsheet/allocator-portfolio-payload*` matches the old strings but belongs to another surface and was not touched.

## Deviations from Plan

None - plan executed as written. Four colocated test files outside the plan's files_modified list were updated because they pin changed literals (the plan's family rule covers them): `AllocationDashboardV2.no-key-mandate.test.tsx`, `KpiStrip.pair-coverage.test.tsx`, `StressVarSection.test.tsx`, `dust.test.ts`; also `GlancePanel.scenario-parity.test.tsx`. The plan's files `AllocationsTabs.tsx` and `page.tsx` needed no change.

## Known Stubs

None.

## Threat Flags

None. T-201-17 mitigated: no warning key was renamed and `degrade-warning-scan.test.ts` passes.

## Self-Check: PASSED

- Commits 6c14d90b4, 88033c110 and fd1e49b4c are on wt/201-p12 (`git rev-list --count 8724de1ab..HEAD` = 3).
- All verify commands above passed on resume; the ledger is empty; the neuter went RED and was restored byte-identical.
