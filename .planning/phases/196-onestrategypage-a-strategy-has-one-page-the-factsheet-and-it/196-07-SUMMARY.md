---
phase: 196-onestrategypage-a-strategy-has-one-page-the-factsheet-and-it
plan: 07
subsystem: ui
tags: [factsheet, navigation, back-link, corpus-guard, redirects]
status: complete

requires: ["196-02", "196-03", "196-06", "196-15", "196-17", "196-18", "196-20"]
provides:
  - "Outcomes widget, admin csv-status, admin tabs, recommendations and the landing results component link to the factsheet through buildFactsheetHref"
  - "src/__tests__/one-strategy-page-links.test.ts: rules A (retired routes), B (one builder + stale-checked allow-list), C (redirect origins)"
affects: [196-13]

actuals:
  tokens: 9000
  tasks: 2
  commits: 2   # task commits only, measured over plan_head_before..plan_head_after; the SUMMARY commit follows
plan_head_before: 056a4e5ea1283034cbd11a552fc18938044af49f
plan_head_after: eb020a1cc3c76c4f00b0f64c5db2864cfc96ea56

key-files:
  created:
    - src/__tests__/one-strategy-page-links.test.ts
  modified:
    - src/app/(dashboard)/allocations/widgets/outcomes/OutcomesWidget.tsx
    - src/app/(dashboard)/allocations/widgets/outcomes/outcomes.test.tsx
    - src/app/(dashboard)/admin/csv-status/page.tsx
    - src/app/(dashboard)/admin/csv-status/page.test.ts
    - src/components/landing/VerificationResults.tsx
    - src/app/(dashboard)/recommendations/page.tsx
    - src/components/admin/AdminTabs.tsx
    - src/components/admin/AdminTabs.test.tsx

key-decisions:
  - "Rule A and B scan comment-stripped source (stripCommentsPreserveLines) so prose naming a route never trips them and a real link cannot hide in a comment"
  - "The two allow-list entries (origin.ts, tearsheet page) are asserted by exact set AND by a stale check, so plan 13 must edit both the entry and the exact-set assertion when it routes the tearsheet link through the builder"

requirements-completed: [ROUTE-04, LEAN-02]
---

# Phase 196 Plan 07: remaining strategy links reach the factsheet, and a guard keeps them there

Every in-app strategy link now goes through `buildFactsheetHref` with its origin, and `one-strategy-page-links.test.ts` fails CI if a retired-route href, a raw factsheet template, or an unreadable redirect origin comes back (D-01, D-03).

## Edited sites

| Site | Before | After |
|------|--------|-------|
| `OutcomesWidget.tsx` original strategy link | `/strategy/${id}` | `buildFactsheetHref(id, { key: "allocations" })` |
| `OutcomesWidget.tsx` replacement strategy link | `/strategy/${id}` | same |
| `admin/csv-status/page.tsx` View factsheet | `/strategy/${id}` | `buildFactsheetHref(id, { key: "admin" })` (a stale prose comment naming the old route reworded) |
| `landing/VerificationResults.tsx` | `/strategy/${id}` | `buildFactsheetHref(id)` (landing context, no origin) |
| `recommendations/page.tsx` `viewHref` | `/factsheet/${id}` | `buildFactsheetHref(id, { key: "recommendations" })` |
| `admin/AdminTabs.tsx` View factsheet | `/factsheet/${id}` | `buildFactsheetHref(id, { key: "admin" })` |

`VerificationResults` has no live mount: its only importer is `VerificationSection`, which nothing mounts outside tests (re-checked at HEAD). It is repointed, not deleted; plan 14's knip sweep decides.

## Changed expectations

- `outcomes.test.tsx`: the original/replacement links assert `/factsheet/s-orig?from=allocations` and `/factsheet/s-repl?from=allocations` (were `/strategy/s-*`); test title and comment rewritten.
- `csv-status/page.test.ts`: the source-shape pin is `href={buildFactsheetHref(strat.id, { key: "admin" })}`; prose updated.
- `AdminTabs.test.tsx`: NEW arm, the Strategy Review tab's factsheet link is `/factsheet/st-2?from=admin`. No existing test pinned the recommendations or admin-tabs hrefs; recommendations has no new arm (the page is an async server component, its link is covered by guard rule B).

## The guard

`src/__tests__/one-strategy-page-links.test.ts` (12 tests: 7 self-tests, 5 corpus):

- Rule A: retired strategy route (template, `"/strategy/" +`, static `href=`), a two-segment `/discovery|browse/${}/${}` template, a factsheet `/v2` template or href, the grid's `${basePath}/${...}` template.
- Rule B: a template opening with the raw factsheet route (or a quoted prefix followed by `+`) is reported outside `ALLOWED_RAW_FACTSHEET_HREFS`.
- Rule C: imports `next.config`, runs `redirects()`, substitutes `:slug` with `crypto-sma` and other params with a dummy id for each factsheet destination carrying `from=`, then requires `parseOrigin` non-null and `backTargetFor` to equal the category list. A vacuity floor of 2 checked rules.
- Population: derived from disk, floor over 500 files, excludes `*.test.*`, `__tests__`, `test-fixtures`.

Allow-list, exactly two entries, each stale-checked:

1. `src/lib/factsheet/origin.ts` - the builder itself.
2. `src/app/factsheet/[id]/tearsheet/page.tsx` - rebuilt by plan 13. ⚠️ Plan 13 must route that link through `buildFactsheetHref`, delete the entry, AND update the exact-set assertion (`the allow-list is exactly the builder and the tearsheet page`) in the same commit, or this guard goes red.

## RED evidence (neuter from a cp backup, RED naming the arm, restore, `cmp` 0, GREEN)

| Rule | Neuter | RED | Restore |
|------|--------|-----|---------|
| A | `OutcomesWidget.tsx` original link put back to `/strategy/${...}` | `rule A ... OutcomesWidget.tsx:613 [A retired strategy route (template)]` | `cmp` exit 0, 4/4 GREEN |
| B | `recommendations/page.tsx` `viewHref` put back to the raw template | `rule B ... recommendations/page.tsx:581 [B raw factsheet href]` | `cmp` exit 0, 12/12 GREEN |
| C | `next.config.ts` browse redirect `from=browse` changed to `from=brows` | `rule C ... parseOrigin reads no origin from "from=brows&cat=crypto-sma"` | `cmp` exit 0, 12/12 GREEN |
| B stale | tearsheet page raw template swapped for a call | `ALLOWED_RAW_FACTSHEET_HREFS entries no longer hold a raw factsheet template` | `cmp` exit 0, 12/12 GREEN |

## Verification

- `npx vitest run src/__tests__/one-strategy-page-links.test.ts "src/app/(dashboard)/recommendations" src/components/admin "src/app/(dashboard)/admin" "src/app/(dashboard)/allocations/widgets/outcomes"`: 33 files, 303 tests passed.
- `npx tsc --noEmit`: clean. `npm run lint`: 0 errors (two pre-existing unused-var warnings in `MetricsColumn.tsx` and `composite-read-path.ts`, not touched here).
- Task 1 was committed with rule A only and Task 2 added B and C, so each commit is green on its own.

## Deviations from Plan

**1. [Rule 2 - missing coverage] AdminTabs href arm added.** The plan listed AdminTabs tests only as a verify path; none asserted the href, so a regression to a raw link there would have been caught only by rule B. One arm added.

Otherwise none. Re-resolved at HEAD after Phases 197/198: the link census matches the plan (the four allocation sites are already on the builder through plan 20; the only raw `/factsheet/${` templates left are `origin.ts` and the tearsheet page).

## Known Stubs

None.

## Threat Flags

None. T-196-16 mitigated (single builder, encoded id, stale-checked allow-list); T-196-17 accepted as planned (`ShareableLink` builds from `window.location.origin`, out of rule B's pattern by construction).

## Not measured

No PROD access and no server was started; the live 308 status and destination-query interpolation remain the first-hop canary in `e2e/route-redirects.spec.ts`.

## Self-Check: PASSED

- `src/__tests__/one-strategy-page-links.test.ts` exists; commits `1025153c8` and `eb020a1cc` are on the branch.
