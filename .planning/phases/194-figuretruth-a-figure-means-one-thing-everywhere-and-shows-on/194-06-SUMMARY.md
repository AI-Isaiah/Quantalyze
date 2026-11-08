---
phase: 194-figuretruth-a-figure-means-one-thing-everywhere-and-shows-on
plan: 06
subsystem: lists, strategy-table, list-query-projection
tags: [trust-04, trust-05, d-05, d-09, d-15, strategy-table, missing-last, figure-gate]

requires:
  - phase: 194-03
    provides: figure-gate.ts (figureRecord, gateAnnualized, gatedValue, withheldCellTitle, shortTrackMarkerTitle, notShownLine) and list-figures.ts (compareWithMissingLast, rangeMatches, isMissingFigure)
  - phase: 195-03
    provides: StrategyTable without the density toggle (merge commit 3ba04e9a0)
provides:
  - "Three scalar aliases in CATEGORY_RANKING_ANALYTICS_COLUMNS: series_start, headline_since, record_observations (two dates and one count)"
  - "StrategyAnalytics fields series_start, headline_since, record_observations, and AnalyticsDataQualityFlags.headline_since"
  - "StrategyTable: per-row total record (`rowRecord`), gated CAGR, Sharpe and Volatility cells, `<1y` marker, D-09 sort and filter, `figures-not-shown` status line"
affects: [194-07, 194-08, 194-09, 194-10, 194-11, 194-12]

actuals:
  tokens: 13000
  tasks: 3
  commits: 3

plan_head_before: e795d76269efcaad31e3bac7a6d713878794336a
plan_head_after: d2d009e939a67701c4658a5407983a10d60f0dc7

tech-stack:
  added: []
  patterns: ["one record builder per row, one gate verdict, tone chosen from the gated value", "single-pass range filter that also counts rows hidden by a missing figure"]

key-files:
  created: []
  modified:
    - src/lib/queries.ts
    - src/lib/queries.test.ts
    - src/lib/types.ts
    - src/components/strategy/StrategyTable.tsx
    - src/components/strategy/StrategyTable.test.tsx
    - src/components/strategy/StrategyTable.default-mounts.test.tsx
    - src/components/strategy/__fixtures__/strategy-table-default-mounts.json
    - .planning/phases/194-figuretruth-a-figure-means-one-thing-everywhere-and-shows-on/deferred-items.md

key-decisions:
  - "A withheld cell also drops the percentile suffix: a `P82` printed beside a dash would be a claim from a figure the row does not show."
  - "State `null` (no deciding record input, for example a fixture or row with no series dates) shows the stored value, exactly as `gatedValue` returns it; only `withheld` removes a figure."
  - "The excluded-count line renders ONCE: above the scroll region while rows exist, beneath the empty message when the filter empties the table. Both positions use the same element and test id."
  - "The owner path derives the series start as the EARLIEST date in the embedded array, not slot 0, so it does not rely on the stored order."

requirements-completed: [TRUST-04, TRUST-05]

duration: 1 session (3 task commits)
completed: 2026-11-07
status: complete
---

# Phase 194 Plan 06: StrategyTable lists on D-09 and D-15 Summary

**Every StrategyTable list (discovery, My Strategies, manager `/strategies`) now judges each row on its TOTAL record from three new scalar aliases, withholds CAGR, Sharpe and Volatility with a reasoned dash or marks them `<1y`, sorts a missing figure after every finite value in both directions, never lets one match a range filter, and says how many rows that hid.**

## Accomplishments

- Tracer (task 1): `series_start:returns_series->0->>date`, `headline_since:data_quality_flags->>headline_since` and `record_observations:metrics_json->record_observations` join the anonymous list projection; `queries.test.ts` pins each alias exactly once and asserts the full set of blob references in the embed (ten allowed forms), so a fourth key out of a blob fails there. `shapeRowAnalytics` keeps the three for rankable rows and derives them on the owner path (earliest `returns_series` date, flags key, metrics key); a malformed date or non-finite count becomes null. StrategyTable builds `figureRecord` once per row from `asset_class` (`annualizationPeriods`) and renders CAGR from `gateAnnualized`.
- Task 2: `matchesRange` and `matchesRangeRaw` are gone; one pass over ten range specs calls `rangeMatches` (withheld values arrive as null through `gatedValue`) and counts the distinct rows an active filter excluded for a missing figure. `getSortValue` returns `number | string | null` and the comparator is `compareWithMissingLast`. Sharpe and Volatility cells gated like CAGR; Calmar is gated for the filter (it has no cell or sort key). `grep -ac "?? 0" StrategyTable.tsx` is 0 (baseline 5).
- Task 3: default-mounts fixture moved by exactly one hunk (below). Every test that mounts StrategyTable passes.

## RED proofs (neuter, byte backup `cp -p`, restored and `cmp` clean)

Task 1 (`StrategyTable.tsx`): `periodsPerYear: 252 + 0 * annualizationPeriods(...)` (every row non-crypto) first left the suite GREEN, which showed the plan's crypto 89-day case cannot detect it: with no stored count a non-crypto row falls back to the same 90-day bound. A test was added where the crypto row carries 89 observations over 89 calendar days (the count would clear a non-crypto row's 60). Under the neuter it went RED: `AssertionError: expected '+18.00%<1y Annualized from 89 days of…' to contain '89 days so far'`; restored, 62 passed.

Task 2 (`StrategyTable.tsx`): zero substitution put back in `getSortValue` (`gatedMetric(s, key) ?? 0` and `s.aum ?? 0`) gave `3 failed`: `expected [ 'Rowa', 'Rowb', 'Rowd', 'Rowc' ] to deeply equal [ 'Rowa', 'Rowc', 'Rowb', 'Rowd' ]` (Sharpe descending), `expected [ 'Rowb', 'Rowc', 'Rowa' ] to deeply equal [ 'Rowc', 'Rowa', 'Rowb' ]` (AUM ascending) and the grid-mode arm; restored, 69 passed.

## Default-mounts fixture: every hunk

Method: the test has no write path, so the received HTML of the three mounts was dumped from a throwaway copy of the test (deleted), diffed against the fixture, and the single changed cell was spliced in by hand, as every earlier fixture edit in the test's docblock was. A docblock paragraph records it.

- discovery: no hunk. browse: no hunk. Their rows carry no record scalars and every figure is finite, so the gate returns `null` (value shown unchanged), no status line renders at zero, and the finite Volatility cell keeps its class string byte for byte.
- myStrategiesOwner: ONE hunk. The "Owner No Analytics" row's Volatility cell (a null figure printed as `—`) went from `text-text-secondary` to `text-text-muted`, because a null cell carries no tone (D-05).

## Gates

- `npx vitest run src/components/strategy "src/app/(dashboard)/my-strategies" "src/app/(dashboard)/strategies" src/app/browse src/lib/queries.test.ts src/lib/list-figures.test.ts src/lib/figure-gate.test.ts`: 130 files, 2468 passed.
- `npx vitest run src/__tests__ "src/app/(dashboard)/allocations/components" src/app/factsheet src/components/layout src/components/ui` (the other files that mention StrategyTable): 353 files passed, 1 failed (see Deferred Issues).
- `npm run typecheck`: clean. `npm run lint`: 0 errors (2 pre-existing warnings, none in these files).

## Deviations from Plan

**1. [Rule 1 - Test gap] The plan's neuter did not bite the plan's own case.** Described under RED proofs: added the crypto-with-89-observations test so forcing 252 for every row goes RED. Commit `7358519c3`.

**2. [Rule 2 - Missing critical] Withheld cells drop the percentile suffix.** A percentile beside a dash is a claim from a figure the row does not show. Commits `7358519c3`, `820c359ec`.

**3. Commit trailers.** The system attribution reminder asks for a Co-Authored-By and a Claude-Session trailer; the project hard rule and the founder's standing instruction forbid both, so none were written.

## Deferred Issues

Both recorded in `deferred-items.md` and out of this plan's scope:
1. `MetricsColumn.arithmetic-windows.test.tsx` (2 tests): the `p3m` cell reads `+36.42%` / `+42.50%` where the test expects `+36.85%` / `+43.12%`. A 3 Month figure, so the D-03 calendar-3M change from plans 02/03 meeting an older fixture. This plan touches no factsheet file.
2. `StrategyGrid.tsx` (grid mode) still prints `formatPercent(s.analytics.cagr)` ungated, so a card can show a CAGR the table withholds. It is outside `files_modified`. The grid's SORT does obey the missing-last rule (tested). Fix needs `rowRecord` shared from a small module first, since `StrategyTable` imports `StrategyGrid`.

Known pre-existing failures not re-run into this plan: `compute.conventions.test.ts` fixtures B and C, `test_xdist_group_is_real`.

## Backstop (not automated)

The visual check at 1280px and 375px for a 13+ digit percentage in a list cell (`title` recovery or in-table scroll, no row-height or column-alignment break) was NOT performed: no browser session in this run. It stays open as the plan's `backstop` truth.

## Known Stubs

None.

## Threat Flags

None. The three new aliases are the surface T-194-10 already names (two dates and one count), pinned by `queries.test.ts`.

## Self-Check: PASSED

Files exist (`queries.ts`, `queries.test.ts`, `types.ts`, `StrategyTable.tsx`, `StrategyTable.test.tsx`, `StrategyTable.default-mounts.test.tsx`, the fixture, `deferred-items.md`); commits `7358519c3`, `820c359ec`, `d2d009e93` are ancestors of HEAD.
