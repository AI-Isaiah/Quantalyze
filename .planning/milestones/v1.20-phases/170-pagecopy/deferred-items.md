# Phase 170 deferred items

Out-of-scope discoveries logged by executors. Each names its owner; none is fixed here.

## From plan 170-11 (2026-09-30)

### 1. `assertNoReflow` prints `offender=<unknown>` for every document-level overflow on a dashboard page

- **File:** `e2e/helpers/reflow.ts`, `assertNoReflow` (plan 170-01's file, not in 170-11's `files_modified`).
- **Measured:** CI run `36755290085`, job `110024318330` (e2e-seeded), head `20895bcc25ebf1a2e8c31375f262c2eb12fc4bc7`. Every `LAYOUT-NARROW-OFFENDER` line reads `main=0 doc=<N> offender=<unknown>`.
- **Mechanism (read from the helper, not measured in a browser):** when `main` does not overflow, the scroller is `doc`, and the containment climb walks `parentElement` up to the scroller. `#main-content` is `overflow-y-auto`, so its computed `overflow-x` is `auto`, and its right edge is inside the viewport. Every DOM descendant of `#main-content` is therefore classed "contained", and the walker can never name one. The overflowing box is a descendant whose containing block sits outside `main` (an absolutely positioned box with no positioned ancestor inside `main`), so it escapes `main`'s scrollable overflow and lands on the document.
- **Fix shape:** when `doc` is the scroller, stop the climb from passing through `#main-content`, or test containing-block ancestry (`offsetParent` chain) rather than DOM ancestry.
- **Owner:** orchestrator, then 170-01's helper. It blocks a named attribution of any doc-level overflow.

### 2. Unattributed document overflow on the composed scenario, every viewport

- **Rows:** `composed scenario — N-FOOT` V390 / V640 / V960 and `constituent rows — N-SCN` V390 / V640 all fail at their first `assertNoReflow`, so 170-04's footer assertions after it were not reached in that run.
- **Readings:** V390 doc 468 to 487; V640 doc 209 to 223; V960 doc 180 to 184; `main=0` on every line.
- **Hypothesis, not measured:** the right edges land near 858 px (V390, V640) and 1144 px (V960 with the 260 px sidebar). The same run records `N-SCN V960 scrollWidth=853`, the natural width of the "Strategies and weights" list. The `sr-only` weight and leverage `<label>`s in `ScenarioComposer.tsx`'s constituent rows are `position: absolute` with no positioned ancestor inside the `ResponsiveTable` scroller, so their static position at the row's right end would escape both the scroller and `main`. A likely fix is `relative` on the `ResponsiveTable` scroller, which makes it the containing block. Confirm with a fixed walker before acting.
- **Owner:** 170-04 (N-SCN constituent rows / `ResponsiveTable`), routed by the orchestrator. Not factsheet-owned: `main=0` rules out normal-flow factsheet markup (`KpiStrip`, `SectionNav`).
