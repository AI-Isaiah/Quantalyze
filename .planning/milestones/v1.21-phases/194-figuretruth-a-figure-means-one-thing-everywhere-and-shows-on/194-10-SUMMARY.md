---
phase: 194-figuretruth-a-figure-means-one-thing-everywhere-and-shows-on
plan: 10
subsystem: browse-and-compare
tags: [trust-05, d-04, d-05, d-10, d-15, figure-gate, census]

requires:
  - phase: 194-03
    provides: figure-gate.ts (gateAnnualized, figureRecord, gatedValue, withheldReason, withheldCellTitle, shortTrackNote, shortTrackMarkerTitle, SHORT_TRACK_MARKER)
  - phase: 194-07
    provides: record-span-read.ts (readRecordSpan, four scalar aliases, published-only, request-scoped)
provides:
  - "`194-ANNUALISED-SITES.md`: the census confirmed at HEAD, 80 sites routed (24 to 194 plans, 18 to Phase 194.1, 38 excluded, 0 new)"
  - "Public browse strategy page: hero CAGR, Sharpe, Volatility and Sortino, Calmar through the total-record gate, one `browse-figure-gate-note` line"
  - "CompareTable: the five annualised rows through the gate from a server-built `figureRecord` per strategy column"
affects: [194-ANNUALISED-SITES]

actuals:
  tokens: 21000
  tasks: 3
  commits: 3

plan_head_before: de4a9813054a217410c6705c50ed76b139be71d1
plan_head_after: 9b2e9b463579a51db43100566afeddb4654dc4e4

key-files:
  created:
    - .planning/phases/194-figuretruth-a-figure-means-one-thing-everywhere-and-shows-on/194-ANNUALISED-SITES.md
    - src/app/browse/[slug]/[strategyId]/page.figure-gate.test.tsx
  modified:
    - src/app/browse/[slug]/[strategyId]/page.tsx
    - src/app/browse/[slug]/[strategyId]/page.max-dd-tone.test.tsx
    - src/app/browse/[slug]/[strategyId]/page.verified-badge.test.tsx
    - src/components/strategy/CompareTable.tsx
    - src/components/strategy/CompareTable.test.tsx
    - src/app/(dashboard)/compare/page.tsx
    - src/app/(dashboard)/compare/page.test.tsx

key-decisions:
  - "A read of the record that cannot be made (a failed `readRecordSpan` or a `createClient` that throws) withholds the five browse figures, prints no caption and logs one `[browse] record span read failed` line, the tearsheet's fail-closed shape."
  - "The compare page hands `figureRecord` to CompareTable only (a `tableItems` map), not to the overlay or the matrix, so their item key sets stay exactly as pinned."
  - "`figureRecord` is a REQUIRED field of CompareTable's `StrategyItem` (not optional), so a future caller cannot silently skip the gate."

requirements-completed: []  # TRUST-05 closes with the remaining 194 surface plans

completed: 2026-11-07
status: complete
---

# Phase 194 Plan 10: Census at HEAD, browse strategy page and CompareTable through the gate Summary

**The annualised-figure census is confirmed against HEAD (every file routed, none new), the public browse strategy page withholds or qualifies its five annualised figures from the strategy's total record, and CompareTable does the same per column from a record the compare page builds server-side.**

## Accomplishments

- Task 1: re-ran the census command at HEAD. It returns 75 files (80 at planning time; Phase 195 removed five, listed in the SITES file), plus the 2 second-pass files and 3 files the census named by hand: 80 sites, each a row `file | census row | route`. 24 are 194 rows (mixed rows with a 194.1 part count as 194), 18 are Phase 194.1's (B1-B13 and outside-194 rows, named and not gated), 38 are excluded under an allowed reason, **0 are new** (`ann-new: 0`). Routes extended past the census where plans 11 to 24 took the D-11 rows R3 left unplanned.
- Task 2 (browse): after `getPublicStrategyDetail`, `readRecordSpan` on a request-scoped `createClient()`; one `figureRecord`, one `gateAnnualized`. CAGR, Sharpe, Volatility, Sortino and Calmar pass through `gatedValue` (a withheld value gets no tone); Max Drawdown, 6 Month and Cumulative Return are untouched. One `<p data-testid="browse-figure-gate-note">` under the hero grid carries `withheldReason("record", record)` or `shortTrackNote("record", days)`. The hero grid gained a wrapper `div` (`mb-6` moved onto it) so the note sits directly under the grid; nothing else in the file moved (195's Disclaimer line untouched).
- Task 3 (compare): `compare/page.tsx` appends `, record_observations:metrics_json->record_observations` inside its own `strategy_analytics (...)` select (so `queries.ts` and its pin are unchanged) and builds a `FigureRecord` per strategy from the first and last `returns_series` date, the effective generation's `headline_since`, the stored alias and `annualizationPeriods(asset_class)`. The alias is deleted before any item is built; `headline_since` still never reaches a client component. `CompareTable` computes `gateAnnualized(item.figureRecord)` once per column, reads the five annualised rows through `gatedValue`, prints a withheld cell as `—` with `title` and sr-only reason (`withheldCellTitle`), adds the `<1y` marker (plan 06's classes) while short, and excludes a withheld value from the best-value comparison and the qualitative chip.

## RED proofs (neuter, `cp -p` byte backup, restored and `cmp` clean)

Task 2 (`browse/.../page.tsx`): `annualized` returned the raw value instead of `gatedValue(value, gateState)`: `6 failed`, including the crypto 60-day case (`AssertionError: expected '+25.00%' to be '—'`), the non-crypto 59-observation case, the interim 89-day fallback and both fail-closed cases. Restored, 21 passed across the three browse test files.

Task 3 (the two neuters, one at a time):
1. Best-value exclusion removed (`findWinner` reading the raw value): `FAIL ... a crypto 60-day column prints a toneless dash ... and never wins`, `Expected: "—Withheld until the record reaches 90 days (60 days so far)." Received: "—Withheld until the record reaches 90 days (60 days so far).✓"` (the withheld column won the row). Restored.
2. Observations counted from `returns_series` instead of the alias (`observations: series?.length ?? null`): `FAIL ... the record's observations are the stored alias, not the length of the capped returns_series`, `AssertionError: expected null to be 'Withheld until the record reaches 60 trading days (59 so far).'`. Restored.

## Gates

- `npx vitest run "src/app/browse/[slug]/[strategyId]"`: 3 files, 21 passed. Also `trim-removed-surfaces` and `queries.stale-analytics-detail`: 71 passed.
- `npx vitest run src/components/strategy/CompareTable.test.tsx "src/app/(dashboard)/compare"`: 6 files, 247 passed. With `src/lib/queries`, `critical-regressions`, `requireRolePage-wiring`, `phase-52-container-tabular-nums` and the compare loading/regression tests: 28 files, 808 passed.
- `npm run typecheck`: clean. `eslint` on the changed pages, components and tests: clean. `git diff HEAD -- src/lib/queries.ts`: empty.
- Plan greps pass (`gateAnnualized(`, `readRecordSpan(`, `browse-figure-gate-note`, `figureRecord(`, the alias string).
- `npx tsx scripts/check-planning-hygiene.ts`: OK (the SITES file carries no home path).

## Deviations from Plan

**1. [Rule 3 - Blocking] The two existing browse tests (`page.max-dd-tone`, `page.verified-badge`) were updated (not in the plan's file list).** They mock only `@/lib/queries`; the page now calls `createClient` and `readRecordSpan`, so each gained two mocks (the server client and a two-year, 500-observation record that clears the gate). No assertion changed.

**2. [Rule 3 - Blocking] `node_modules` symlink.** The worktree had none; a symlink to the main checkout's `node_modules` (gitignored, not committed) was created to run the gates.

**3. `figureRecord` on CompareTable is required.** The plan named the prop; making it non-optional forced `CompareTable.test.tsx`'s `makeItem` to supply a clearing default record (800 days, 500 observations), so the pre-existing structural tests still see plain figures.

**4. Commit attribution.** The harness reminder asked for Co-Authored-By and session trailers; the founder's rule forbids them, so the three commits carry none.

## Known Stubs

None.

## Threat Flags

None. The only new database read is the planned T-194-21 surface (plan 07's four scalar aliases, published-only, request-scoped). The compare read gained one scalar alias (`record_observations`, T-194-22); `metrics_json` and `data_quality_flags` are still never projected whole, and the existing "never projects ... metrics_json" pin still passes.

## Issues / notes for the orchestrator

- **No unrouted site.** `ann-new: 0`. Five census rows no longer exist (deleted or retired by 195).
- **`KpiStrip.tsx`** is a 194-05 site that plan 05's `files_modified` does not list; plan 05's SUMMARY records it gated the strip through the composer's `scenarioMetrics`.
- **`HoldingDetail.tsx`** prints Sharpe but is reachable only through `HoldingsTable`'s `rows` branch, whose only builder `toDesignHoldings` has no non-test caller; recorded as `excluded: no render`.
- **`PercentileRankBadge.tsx`** was "label only" in the census; plan 18 owns its marker, so it is a 194 row.
- **One flake, not mine:** a combined run of `requireRolePage-wiring.test.tsx` with the queries and compare tests failed 2 cases once and passed on the same command re-run twice and alone. Unrelated to the files here; not reproduced.
- Backstop (not run): a rendered look at the browse note line and the compare `<1y` marker at the table's narrow container width (`@container` reflow).

## Self-Check: PASSED

Files exist (`194-ANNUALISED-SITES.md`, `page.figure-gate.test.tsx`, and the seven modified files); commits `f1659d50d`, `301803494` and `9b2e9b463` are ancestors of HEAD.
