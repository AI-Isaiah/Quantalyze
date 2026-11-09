---
phase: 196-onestrategypage-a-strategy-has-one-page-the-factsheet-and-it
plan: 06
subsystem: ui
tags: [factsheet, navigation, back-link, strategy-table, strategy-grid, wizard]
status: complete

requires: ["196-02", "196-03"]
provides:
  - "StrategyTable origin prop (default from basePath and categorySlug); rows link through buildFactsheetHref"
  - "StrategyGrid origin prop; cards link to the factsheet, never to the retired /discovery/<cat>/<id> route"
  - "/strategies, /my-strategies and both wizard factsheet links carry their own origin"
affects: [196-07, 196-08]

actuals:
  tokens: 14000
  tasks: 3
  commits: 3   # task commits only, measured over plan_head_before..plan_head_after; the SUMMARY commit follows
plan_head_before: aab9f6a1abc16d008aea11e447054698e1767686
plan_head_after: 757f60be089de2f107f8482f50f70ae627aac08c

key-files:
  created: []
  modified:
    - src/components/strategy/StrategyTable.tsx
    - src/components/strategy/StrategyGrid.tsx
    - src/components/strategy/StrategyTable.default-mounts.test.tsx
    - src/components/strategy/__fixtures__/strategy-table-default-mounts.json
    - src/app/(dashboard)/strategies/page.tsx
    - src/app/(dashboard)/my-strategies/MyStrategiesSection.tsx
    - src/app/(dashboard)/strategies/new/wizard/steps/SyncPreviewStep.tsx
    - src/app/(dashboard)/strategies/new/wizard/steps/CsvSubmitStep.tsx
    - e2e/discovery-watchlist.spec.ts
    - e2e/layout-narrow.spec.ts

key-decisions:
  - "StrategyGrid lost its categorySlug and basePath props (nothing else in it read them); it takes the table's resolved origin instead. Table default: basePath /browse is browse, anything else discovery, cat = categorySlug (buildFactsheetHref drops a slug that is not a discovery category)."
  - "The default-mounts fixture was edited by hand (3 / 3 / 5 hrefs), anchored on href=/factsheet/<id>; the test has no write path and the fixture was not regenerated. The owner mount in the test now passes origin my-strategies, as its real mount does."

requirements-completed: [ROUTE-04, LEAN-02]
---

# Phase 196 Plan 06: Discovery-side links carry their origin Summary

Every strategy link on the shared table and grid, on /strategies and /my-strategies, and in the wizard now reaches `/factsheet/<id>` in one hop with a `from` (and `cat`) written by the one builder from plan 03, so `parseOrigin` on the factsheet reads what the table wrote.

## Tasks

| Task | Name | Commit |
|------|------|--------|
| 1 | Tracer: table row and grid card link with from=discovery&cat, round-trips to "Back to Discovery" | 068308296 |
| 2 | Owner-side mounts and the wizard carry their own origin | bf0cc31ed |
| 3 | e2e selectors match by prefix; origin asserted on the link | 757f60be0 |

Tracer gate (auto mode not asserted; interactive end-of-phase with automated-only verify): `<verify>` re-run after task 1 green (`npx vitest run src/components/strategy`, the only failures being the 3 pre-existing clock-dependent ones below).

## Link sites edited

- `StrategyTable.tsx`: row name link (was `/factsheet/${s.id}`) and the `StrategyGrid` call (now `origin={linkOrigin}`).
- `StrategyGrid.tsx`: card link (was `${basePath}/${categorySlug}/${s.id}`, the retired detail route).
- `strategies/page.tsx`: `origin={{ key: "strategies" }}`. `MyStrategiesSection.tsx`: `origin={{ key: "my-strategies" }}`.
- `SyncPreviewStep.tsx` (`ViewFullFactsheetLink`) and `CsvSubmitStep.tsx` (echo notice link): `/factsheet/<id>/v2` became `buildFactsheetHref(<id>, { key: "my-strategies" })`.
- `/browse/[slug]` and `/discovery/[slug]` page files NOT edited (plan 08 owns browse); their origin comes from the default (basePath and categorySlug).

## Test expectations changed (href only, unless noted)

- `StrategyTable.default-mounts.test.tsx`: owner mount now passes `origin`; new describe "factsheet links carry their origin (196 plan 06)" with 5 arms (discovery default + round trip to `{label:"Back to Discovery", href:"/discovery/crypto-sma"}`, browse, explicit origin wins, grid card hrefs, table in grid view hands its origin to cards). Fixture `__fixtures__/strategy-table-default-mounts.json`: 3 discovery (`?from=discovery`), 3 browse (`?from=browse`), 5 owner (`?from=my-strategies`) hrefs; header comment records the surgical edit.
- `StrategyTable.test.tsx:1517` (name-cell literal), `StrategyTable.pending-chip.test.tsx:433`, `StrategyTable.visibility.test.tsx:386` (that mount now passes `origin={{ key: "strategies" }}`), `StrategyTable.stale-analytics.test.tsx:588` (prefix selector).
- `categorySlug` removed from every `<StrategyGrid>` call in tests: `StrategyGrid.test.tsx` (13), `StrategyGrid.figure-gate.test.tsx`, `SyncBadge.staler-of-two.test.tsx`, `SyncBadge.trade-fetch.test.tsx` (2), `StrategyTable.stale-analytics.test.tsx` (1).
- `strategies/page.table.test.tsx:391`, `wizard/steps/CsvSubmitStep.test.tsx:679`, `wizard/steps/SyncPreviewStep.own04-link.test.tsx` (two constants and one title).
- e2e: `discovery-watchlist.spec.ts` lines 184, 234, 261 now `a[href^="/factsheet/<id>?"]`; new origin assertion at lines 193-197 (exact `?from=discovery&cat=crypto-sma`). `layout-narrow.spec.ts` lines 468, 508, 590, 619 prefix selectors; origin assertion at line 593 (exact `?from=my-strategies`). Playwright `--list` for both: 68 tests, no error. The e2e specs themselves need CI (not run here).

## Verification

- `npx vitest run src/components/strategy`: 1419 passed, 3 failed. The 3 failures (`StrategyTable.stale-analytics.test.tsx`, "phase 190 seam" arms) are PRE-EXISTING and clock-dependent: reproduced identically on a throwaway checkout of base `aab9f6a1a` before any edit (fixture dates are 11 days old at the real clock, so rows read "Not ranked"). Not caused by this plan; not fixed (out of scope).
- `npx vitest run "src/app/(dashboard)/strategies" "src/app/(dashboard)/my-strategies" src/__tests__/phase-149-my-strategies-parity.test.ts`: 50 files, 967 passed.
- `npx tsc --noEmit`: clean. `npx eslint` on the edited source and e2e files: clean.
- Acceptance greps: `${basePath}/${categorySlug}/` in StrategyGrid.tsx 0 (HEAD 1); `buildFactsheetHref(` in both table and grid; `/v2` href templates in the two wizard steps 0 each; `key: "strategies"` 1 and `key: "my-strategies"` 1 in their mounts; `a[href="/factsheet/` 0 in both e2e files.
- Full-suite vitest was started once at the end; see the report for its reading.

## RED evidence (neuter from cp backup, RED naming the arm, restore, cmp, GREEN)

1. Grid link neutered to `/discovery/x/<id>` (StrategyGrid.tsx backed up with cp): `StrategyTable.default-mounts.test.tsx` RED, 2 failed: "the grid card links to the factsheet with the table's origin, never to a retired detail route" and "the table in grid view hands its own origin to the cards". Restored with cp, `cmp` identical, 8/8 GREEN.
2. `/strategies` mount origin neutered to `admin` (page.tsx backed up): `page.table.test.tsx` RED, 1 failed: "links every status's name to /factsheet/<id>...". Restored, `cmp` identical, 11/11 GREEN.

## Deviations from Plan

None in design. Two notes:
- The plan lists the grid's `basePath`/`categorySlug` removal as conditional; nothing else read them, so they were removed, which required dropping the now-unknown `categorySlug` from every test `<StrategyGrid>` call (listed above).
- The owner-mount golden in the default-mounts test now passes `origin` (matching the real mount) rather than leaving the default, so the fixture reads `from=my-strategies` and not a misleading `from=discovery`.

## Known Stubs

None.

## Threat Flags

None. T-196-15 mitigated: every href is built by `buildFactsheetHref`, which re-applies the closed sets and encodes the id; the table's `categorySlug as FactsheetCategorySlug` cast is re-validated inside the builder.

## Not measured

No PROD database access. e2e specs (not runnable here) are listed above for CI.
