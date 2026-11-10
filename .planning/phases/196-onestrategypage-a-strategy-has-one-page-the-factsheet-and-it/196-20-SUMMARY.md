---
phase: 196-onestrategypage-a-strategy-has-one-page-the-factsheet-and-it
plan: 20
subsystem: ui
tags: [factsheet, navigation, back-link, allocations]
status: complete

requires: ["196-03"]
provides:
  - "Every strategy link in My allocation's holdings table, watchlist, scenario composer and optimizer opens /factsheet/<id>?from=allocations through buildFactsheetHref"
affects: [196-07]

actuals:
  tokens: 3500
  tasks: 2
  commits: 2   # task commits only, measured over plan_head_before..plan_head_after; the SUMMARY commit follows
plan_head_before: aab9f6a1abc16d008aea11e447054698e1767686
plan_head_after: f675fe5d0bcde9c32e0ad166a540bf9f1df5299c

key-files:
  created: []
  modified:
    - src/app/(dashboard)/allocations/components/HoldingsTable.tsx
    - src/app/(dashboard)/allocations/components/HoldingsTable.strategy-rows.test.tsx
    - src/app/(dashboard)/allocations/components/WatchlistPanel.tsx
    - src/app/(dashboard)/allocations/components/WatchlistPanel.test.tsx
    - src/app/(dashboard)/allocations/components/ScenarioComposer.tsx
    - src/app/(dashboard)/allocations/components/ScenarioComposer.test.tsx
    - src/app/(dashboard)/allocations/components/ScenarioComposer.added-metrics.test.tsx
    - src/components/portfolio/PortfolioOptimizer.tsx
    - src/components/portfolio/PortfolioOptimizer.test.tsx

key-decisions:
  - "Each site passes the origin object { key: \"allocations\" } to buildFactsheetHref; no site hand-builds a query string"

requirements-completed: [ROUTE-04]
---

# Phase 196 Plan 20: My allocation links carry from=allocations Summary

Four My allocation strategy-link sites now build their href with `buildFactsheetHref(id, { key: "allocations" })`, so the factsheet's back link reads "Back to My allocation" (D-01, ROUTE-04).

## Edited sites

| Site | Change |
|------|--------|
| `HoldingsTable.tsx` (holdings row name link) | raw template replaced by the builder; import added |
| `WatchlistPanel.tsx` (watchlist name link) | same |
| `ScenarioComposer.tsx` (one hunk, the detail panel "View factsheet" link) | same |
| `PortfolioOptimizer.tsx` ("View strategy" link) | same |

Link target strategy and visible label are unchanged (the plan's prohibition). The `grep -a -F -c '`/factsheet/${'` count is 0 in all four files (HEAD 1 each).

## Changed expectations

Only href expectations that pinned the old bare path changed:

| File | Arm | Change |
|------|-----|--------|
| `HoldingsTable.strategy-rows.test.tsx` | "links each strategy name to its factsheet" | expects `?from=allocations` |
| `HoldingsTable.strategy-rows.test.tsx` | NEW "the strategy link's origin makes the factsheet back link read Back to My allocation" | round-trip: href -> `parseOrigin` -> `backTargetFor` gives label and `/allocations` |
| `WatchlistPanel.test.tsx` | "renders each favorite: name link, trust tier, favorited date" | expects `?from=allocations` |
| `ScenarioComposer.test.tsx` | "SCEN-03 factsheet link: href is exactly ..." | expects `?from=allocations`; title updated to match |
| `ScenarioComposer.added-metrics.test.tsx` | two arms (C-C settled-both-null, C-E network throw) | expect `?from=allocations` |
| `PortfolioOptimizer.test.tsx` | "keeps 'View strategy' and carries no 'Add to portfolio' link" | expects `?from=allocations` |

## RED evidence

- HoldingsTable: neutered the builder call back to the raw template from a cp backup. Two arms went RED (the href arm and the new round-trip arm, `expected null to deeply equal { label, href }`). Restored with cp, cmp clean, 28/28 GREEN.
- WatchlistPanel: same neuter; "renders each favorite: name link, trust tier, favorited date" RED; restored, cmp clean, 10/10 GREEN.

## Verification

- `npx vitest run "src/app/(dashboard)/allocations" src/components/portfolio`: 189 files, 3376 tests passed.
- `npx tsc --noEmit`: exit 0.
- `npm run lint`: 0 errors; 2 pre-existing warnings in files this plan did not touch (`MetricsColumn.tsx`, `composite-read-path.ts`). Prettier is not part of the lint gate.
- Main gained Phase 198 after the plan was written; the four files were re-read fresh and each held exactly one raw factsheet template (re-measured, not assumed).

## Deviations from Plan

**1. [Rule 3 - Blocking] Three test files outside `files_modified` updated.** `ScenarioComposer.test.tsx`, `ScenarioComposer.added-metrics.test.tsx` and `PortfolioOptimizer.test.tsx` pinned the old bare href and went RED once the source changed. Task 2 says to fix only href expectations that pinned the old value and list them; done, nothing else in those files touched. Commit f675fe5d0.

## Known Stubs

None.

## Threat Flags

None. Hrefs come only from `buildFactsheetHref` (closed origin set, `encodeURIComponent`ed id), T-196-45 mitigated.

## Not measured

Nothing here needed PROD or a running server; no browser check of the rendered back link was done (covered by the round-trip unit arm and plan 03's BackLink tests).

## Self-Check: PASSED

Commits 97d991cc0 and f675fe5d0 present on the branch; edited files exist.
