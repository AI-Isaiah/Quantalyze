---
phase: 170-pagecopy
plan: 09
subsystem: ui
tags: [kpi, scenario, layout, collapsible, axe]

requires:
  - phase: 170-04
    provides: ScenarioComposer constituent-list wrap, the file 170-09 also edits
provides:
  - KpiPanel variant panel, a square hairline row, with cards left as the default
  - one Blend-window panel on the scenario tab (header, window, timeline, KPI row)
  - a closed composer-blend-detail section, opened by the composer axe spec before it scans
affects: [170-12, 170-14, scenario, factsheet]

actuals:
  tokens: 6522
  tasks: 3
  commits: 6

plan_head_before: c860e3d0d0476eab9cf5543b12c0a9eaa82ba516
plan_head_after: 5ee9d01d16fdb6b5f496f32fe73218b1336595cf

tech-stack:
  added: []
  patterns:
    - "KpiPanel variant=panel is opt-in; omitted variant stays the rounded card grid"
    - "The scenario Blend window is one square border border-border bg-surface panel"
    - "Repeated blend charts live in a closed CollapsibleSection the axe spec opens"

key-files:
  created:
    - src/components/kpi/KpiPanel.test.tsx
  modified:
    - src/components/kpi/KpiPanel.tsx
    - src/app/(dashboard)/allocations/components/KpiStrip.tsx
    - src/app/(dashboard)/allocations/components/ScenarioComposer.tsx
    - src/app/(dashboard)/allocations/components/ScenarioComposer.test.tsx
    - e2e/composer-axe.spec.ts

key-decisions:
  - "KpiPanel variant defaults to cards. Only the scenario composer passes panel."
  - "Panel hairlines are right and top borders, cleared on the last column and the first row with container nth-child."
  - "The eyebrow is Scenario blend in every state. No comparison wording was added."
  - "composer-blend-detail stays closed. The composer axe spec opens it before the card checks."
  - "SC1-LAYERS stays open because plan 170-12 also declares it."

patterns-established:
  - "Blend-window rows: px-4 py-3, border-t border-border from row 2, no nested rounded box"
  - "Panel KPI cells: px-4 py-3, border-r border-t, @max-lg and @lg nth-child suppressors"

requirements-completed: []

coverage:
  - id: D1
    description: "KpiPanel without a variant keeps the rounded card grid and a separate @container host. variant=panel is a 2-column grid that steps to 4 at @lg, with no gap, no radius and no shadow. The composer passes variant=panel and renders the strip under a Scenario blend eyebrow inside one square panel."
    requirement: SC1-LAYERS
    verification:
      - kind: unit
        ref: "src/components/kpi/KpiPanel.test.tsx#omitting variant renders today's markup"
        status: pass
      - kind: unit
        ref: "src/components/kpi/KpiPanel.test.tsx#renders a 2-col hairline grid that steps to 4"
        status: pass
      - kind: unit
        ref: "src/app/(dashboard)/allocations/components/ScenarioComposer.test.tsx#the scenario KPI strip sits in one square panel under a non-comparative Scenario blend eyebrow"
        status: pass
    human_judgment: false
  - id: D2
    description: "With a coverage window, BlendHeader, the window control, the timeline and the KPI row are the four children of the Blend-window panel. Rows 2-4 have a top hairline. The window control keeps its testid, tabIndex and focus target and has no rounded box of its own. With no window the panel is the KPI row alone and that row has no leading hairline."
    requirement: SC1-LAYERS
    verification:
      - kind: unit
        ref: "src/app/(dashboard)/allocations/components/ScenarioComposer.test.tsx#C1-A1: with a coverage window the header, control and timeline are hairline rows"
        status: pass
      - kind: unit
        ref: "src/app/(dashboard)/allocations/components/ScenarioComposer.test.tsx#C1-A1: with no window bounds the blend panel is the KPI row alone"
        status: pass
      - kind: unit
        ref: "src/app/(dashboard)/allocations/components/ScenarioComposer.test.tsx#ship-review RT-5"
        status: pass
    human_judgment: false
  - id: D3
    description: "Returns distribution and Rolling metrics sit in composer-blend-detail, titled Blend distribution and rolling windows, closed by default, still in the DOM. Their headings are h3 with text-base font-semibold. The composer axe spec clicks that summary and requires the details element open before the data-panel visibility checks."
    requirement: SC1-LAYERS
    verification:
      - kind: unit
        ref: "src/app/(dashboard)/allocations/components/ScenarioComposer.test.tsx#C1-A3: the distribution and rolling cards sit in one closed section"
        status: pass
      - kind: other
        ref: "CI=1 npx playwright test --list e2e/composer-axe.spec.ts"
        status: pass
    human_judgment: true
    rationale: "The list proves the spec parses. The seeded axe analyze was not run, and the closed section was not looked at in a browser."

duration: 18min
completed: 2026-09-27
status: complete
---

# Phase 170 Plan 09: Blend-window panel Summary

**The scenario tab's blend header, window, timeline and 4-cell strip are one square panel, and the two repeat charts sit in one closed section**

## Performance

- **Duration:** 18 min
- **Started:** 2026-09-27T22:51:41Z
- **Completed:** 2026-09-27T23:09:41Z
- **Tasks:** 3
- **Files modified:** 6

## Accomplishments

- `KpiPanel` takes `variant="panel"` for a square hairline row. The default stays the rounded card grid, so PortfolioKpiPanel and the live strip are unchanged.
- On the scenario tab those four blocks are one Blend-window panel under a non-comparative "Scenario blend" eyebrow. The coverage control keeps its focus target and loses its own rounded box.
- Returns distribution and Rolling metrics are one closed section. The composer axe spec opens it before it looks at the cards.

## Task Commits

Each task was committed atomically:

1. **Task 1: scenario KPI strip as row 4 through KpiPanel variant=panel** - `9d5570669` (test), `0e75c1aef` (feat)
2. **Task 2: header, window control and timeline become rows 1-3** - `998382abf` (test), `d4fa828ad` (feat)
3. **Task 3: repeat cards collapse; the axe spec opens the section** - `3810dc173` (test), `5ee9d01d1` (feat)

## Files Created/Modified

- `src/components/kpi/KpiPanel.tsx` - optional `variant` of cards or panel
- `src/components/kpi/KpiPanel.test.tsx` - cards byte-identity and the panel shell
- `src/app/(dashboard)/allocations/components/KpiStrip.tsx` - optional variant passthrough
- `src/app/(dashboard)/allocations/components/ScenarioComposer.tsx` - Blend-window panel and composer-blend-detail
- `src/app/(dashboard)/allocations/components/ScenarioComposer.test.tsx` - eyebrow, row order, closed section
- `e2e/composer-axe.spec.ts` - opens composer-blend-detail before the card checks

## Decisions Made

- The panel variant's hairlines are `border-r` and `border-t`. `@max-lg:nth-[2n]` and `@lg:nth-[4n]` (and the matching top rules) drop the rule on the last column and the first row. Tailwind v4 compiled those candidates to `@container` nth-child rules.
- Nothing was deleted. vs-BTC, Stress & VaR, Monte Carlo, Suggested weights, Diversification and FactsheetBody were not edited.
- `SC1-LAYERS` is also declared by plan 170-12, which has no summary yet, so it is not marked complete. `REQUIREMENTS.md` has no checkbox for that id.

## RED and neuter

Task 1, at HEAD before the panel variant:

- `KpiPanel variant="panel"` failed: the grid was still `grid grid-cols-1 gap-3 @sm:grid-cols-2 @lg:grid-cols-4`.
- The composer case failed: `getByText("Scenario blend")` found nothing. The strip was still a lone `mt-6` wrapper.
- The omitted-variant cards case passed. That is the markup PortfolioKpiPanel already rendered.

Task 1 neuter: default `variant` set to `"panel"`. The omitted-variant case went RED (`expected 'grid grid-cols-2 @lg:grid-cols-4' to be` the cards grid). `PortfolioKpiPanel.test.tsx` stayed green because it pins labels, values and colours, not the shell. `src/components/portfolio/` was not edited (`git diff --quiet origin/main` exit 0). The default was put back to `"cards"`.

Task 2, after task 1 and before the move:

- With a window, the panel had 2 children, not 4.
- With no window, the panel had 2 children, not 1.

Task 2 neuter: the window row got `rounded-md border border-border bg-surface` back. The row test failed on `not to include 'rounded-md'`. The hairline class was restored. The existing RT-5 focus case passed after the restore.

Task 3, before the wrap: `composer-blend-detail` was null.

Task 3 neuter: `defaultOpen={true}`. The closed-section case failed (`expected true to be false` on `details.open`). `defaultOpen={false}` was restored.

## Deviations from Plan

None - plan executed exactly as written.

The panel carries `data-testid="scenario-blend-window"` so the row-order test can name the element. It is not user-facing copy.

## Issues Encountered

`PortfolioKpiPanel.test.tsx` does not pin the card shell, so the neuter does not turn that file red. The omitted-variant case in `KpiPanel.test.tsx` is the tripwire, and the plan forbids a diff under `src/components/portfolio/`.

The Phase 30 composer tests pin the words "Returns distribution" and "Rolling metrics", not the heading level. The new C1-A3 case pins `h3` and `text-base font-semibold`. Those older text queries still pass inside a closed `<details>` under jsdom.

## User Setup Required

None - no external service configuration required.

## Verification

- Task 1, including the tracer re-run: `npx vitest run src/components/kpi/ src/components/portfolio/PortfolioKpiPanel.test.tsx "src/app/(dashboard)/allocations/components/KpiStrip" "src/app/(dashboard)/allocations/components/ScenarioComposer.test.tsx"` — 7 files, 427 tests, exit 0.
- Task 2: `ScenarioComposer.test.tsx` — 384 tests, exit 0, including RT-5.
- Task 3: `ScenarioComposer.test.tsx` — 385 tests, exit 0.
- Plan-level: `npx vitest run src/components/kpi/ src/components/portfolio/ "src/app/(dashboard)/allocations/components/"` — 75 files, 1348 tests, exit 0.
- `npx tsc --noEmit -p .` — exit 0, no `error TS` line.
- `npx eslint` on the six edited files — exit 0.
- `CI=1 npx playwright test --list e2e/composer-axe.spec.ts` — 1 test listed, no Error.
- Acceptance: `variant="panel"` 1, `id="composer-blend-detail"` 1, `composer-collapse:blend-detail` 1, both `data-panel` attributes 1, `data-testid="scenario-coverage-window"` 1, `coverageWindowControlRef` 3 (same as origin/main).

## Not verified in a browser

No dev server and no seeded browser pass. Not confirmed: the Blend-window panel at 390 px or desktop, the closed section as one hairline row, or a green axe analyze. CI `e2e-seeded` `composer-axe.spec.ts` and `layout-narrow` were not run locally.

## Next Phase Readiness

Ready for 170-10. The scenario strip is no longer a second free-standing KPI layer. `SC1-LAYERS` stays open for plan 170-12. The viewport and seeded axe proof remain for CI and plan 170-14.

## Self-Check: PASSED

- FOUND: `src/components/kpi/KpiPanel.tsx`
- FOUND: `src/components/kpi/KpiPanel.test.tsx`
- FOUND: `src/app/(dashboard)/allocations/components/KpiStrip.tsx`
- FOUND: `src/app/(dashboard)/allocations/components/ScenarioComposer.tsx`
- FOUND: `src/app/(dashboard)/allocations/components/ScenarioComposer.test.tsx`
- FOUND: `e2e/composer-axe.spec.ts`
- FOUND: `9d5570669`
- FOUND: `0e75c1aef`
- FOUND: `998382abf`
- FOUND: `d4fa828ad`
- FOUND: `3810dc173`
- FOUND: `5ee9d01d1`

---
*Phase: 170-pagecopy*
*Completed: 2026-09-27*
