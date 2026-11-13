---
phase: 194-figuretruth-a-figure-means-one-thing-everywhere-and-shows-on
plan: 11
subsystem: holdings, strategies-row-adapter, queries-producers
tags: [trust-05, d-04, d-05, d-15, holdings, figure-gate]

requires:
  - phase: 194-03
    provides: figure-gate.ts (figureRecord, gateAnnualized, gatedValue, withheldCellTitle, shortTrackMarkerTitle, SHORT_TRACK_MARKER)
  - phase: 194-06
    provides: the record_observations alias idiom and the withheld / <1y cell markup in StrategyTable
provides:
  - "`figure_span_days`, `figure_observations`, `figure_crypto` on `OwnCapitalStrategy` and on the dashboard payload's `strategy`, computed server-side by one helper (`figureRecordScalars`) in `queries.ts`"
  - "`StrategyRow.sharpe` (gated), `sharpeState`, `sharpeSpanDays`, `sharpeRecord` from `toStrategyRows`, both halves"
  - "Holdings `StrategyRowsTable` Sharpe cell: withheld dash with reason, `<1y` marker"
affects: [194-12]

actuals:
  tokens: 14000
  tasks: 2
  commits: 2

plan_head_before: de4a9813054a217410c6705c50ed76b139be71d1
plan_head_after: cfddea561dbddd048c7cb0bf544f9f5fad105c3d

tech-stack:
  added: []
  patterns: ["one server helper builds the record scalars for both producers, through the same `figureRecord` constructor every surface uses", "the adapter gates on scalars it is handed; no series, flags or metrics blob crosses the RSC boundary"]

key-files:
  created:
    - src/lib/queries.own-capital-span.test.ts
    - src/app/(dashboard)/allocations/components/HoldingsTable.figure-gate.test.tsx
  modified:
    - src/lib/queries.ts
    - src/lib/queries.my-allocation.test.ts
    - src/app/(dashboard)/allocations/lib/strategies-row-adapter.ts
    - src/app/(dashboard)/allocations/lib/strategies-row-adapter.test.ts
    - src/app/(dashboard)/allocations/components/HoldingsTable.tsx
    - src/app/(dashboard)/allocations/components/HoldingsTable.strategy-rows.test.tsx
    - src/app/(dashboard)/allocations/components/HoldingsTable.degraded-strategies-read.test.tsx
    - src/__tests__/format-percent-contract.test.ts

key-decisions:
  - "One helper, `figureRecordScalars`, serves both producers, so the two halves of the Holdings table cannot disagree about one strategy's record. It builds the record with `figureRecord` and reads the span off the placeholder-free RESOLVED series before any native-to-USD conversion, so a BTC price outage cannot shorten a record."
  - "`asset_class` and the `record_observations` alias are read and then DROPPED from the own-capital payload (and the alias from the dashboard payload's analytics), so the payload carries exactly the declared fields and the three scalars are the only record data that cross."
  - "On the dashboard payload the three fields are optional (legacy hand-built fixtures compile, as with `series_state`); on `OwnCapitalStrategy` they are required. The adapter reads an absent scalar as an unknown record: state `null`, stored Sharpe shown, no marker."
  - "`compareStrategyRows` already sorts a null last in both directions, and a withheld Sharpe is null by the time it is compared, so the sort needed no change (the plan's conditional `compareWithMissingLast` routing was not needed); a test pins it."

requirements-completed: [TRUST-05]

duration: 1 session (2 task commits)
completed: 2026-11-07
status: complete
---

# Phase 194 Plan 11: Holdings Sharpe on the D-15 total-record gate Summary

**The Sharpe column on the live Holdings table (`StrategyRowsTable`) is now withheld, marked `<1y`, or shown plain from the strategy's TOTAL record, measured on the server in both producers and judged by the same `gateAnnualized` as every other page.**

## Accomplishments

- Tracer (task 1): `figureRecordScalars` in `queries.ts` builds `figure_span_days`, `figure_observations`, `figure_crypto` from the resolved series' first and last date plus `data_quality_flags.headline_since`, the new `record_observations:metrics_json->record_observations` embed alias, and `annualizationPeriods(asset_class)`. `getOwnCapitalStrategies` gained `asset_class` and the alias in its select; `getMyAllocationDashboard` gained the alias (it already selected `asset_class`). Both strip the alias and the flags, so each payload gains exactly three scalars per strategy. `toStrategyRows` builds one `FigureRecord` per row and emits `sharpe: gatedValue(stored, state)`, `sharpeState`, `sharpeSpanDays`, `sharpeRecord` for half 1 (positioned) and half 2 (marked-only) through one local helper.
- Task 2: `StrategyRowsTable` renders the Sharpe cell from `strategySharpeCell(row)`: withheld is a toneless `—` with `title` and sr-only `withheldCellTitle(row.sharpeRecord)`; short is the stored figure plus `<1y` (`ml-1 inline-block min-w-[3ch] text-right align-baseline text-micro font-mono tabular-nums text-text-muted`) with `title` and sr-only `shortTrackMarkerTitle(span)`; full and null render as before. All copy comes from `figure-gate.ts`. The dead `holdings-adapter.ts` is untouched (`git diff` empty, D-05: no plausibility bound anywhere).

## RED proofs (neuter from a `cp -p` byte backup, restored and `cmp` clean after each)

1. `figure-gate.ts` `gatedValue` made to ignore `withheld` (`if (state === "withheld" && false) return null;`): `4 failed`, e.g. `crypto 60 days: withheld, identically on both halves`, `AssertionError: expected 1.8 to be null // Object.is equality` (the 60 and 89-day crypto cases, non-crypto 59 observations, and the 89-day fallback). Restored; `git diff` of the file empty.
2. Adapter record built with `crypto: false`: the plan's own vector (crypto, 89 days, no stored count) cannot detect this, because a non-crypto row without a count falls back to the same 90-day bound (the same finding as plan 06). The record-equality assertion went RED on 6 cases (`expected { spanDays: 60, …(2) } to deeply equal { spanDays: 60, …(2) }`), and a new case that bites on the VERDICT was added: crypto, 89 days, 89 observations (the count would clear a non-crypto row's 60). Under the neuter: `AssertionError: expected 1.8 to be null // Object.is equality`. Restored, `cmp` clean.
3. `queries.ts` `periodsPerYear` forced to 252: `3 failed` (`expected false to be true` for `figure_crypto` in both producers). Restored, `cmp` clean.
4. `HoldingsTable.tsx` withheld branch disabled: `2 failed`, `AssertionError: the reason must be the cell's title: expected null not to be null`. Restored, `cmp` clean.

## Gates

- `npx vitest run src/lib/queries.own-capital-span.test.ts "src/app/(dashboard)/allocations/lib/strategies-row-adapter.test.ts"`: 56 passed. `HoldingsTable.figure-gate.test.tsx` plus `src/app/(dashboard)/allocations/components` and `HoldingsTabPanel`: 61 files, 1346 passed. `queries.my-allocation.test.ts` and `queries.test.ts`: 403 passed (the latter pins the list constant's blob references; unaffected).
- `npm run typecheck`: clean. `npx eslint` on every touched source file: 0 findings.
- Task 1 grep gate: `figure_span_days` 5, `figure_observations` 7, `figure_crypto` 6 occurrences in `queries.ts` (each at least 4); `record_observations:metrics_json->record_observations` 4 (list constant docblock and constant, plus one per producer; each at least 2); `gateAnnualized(` present in the adapter.
- Broad run, `src/__tests__ "src/app/(dashboard)/allocations" src/lib`: 622 files passed, 4 failed, none caused by this plan (see Deferred Issues).

## Deviations from Plan

**1. [Rule 2 - Missing critical] Dashboard producer cases live in `queries.my-allocation.test.ts`.** The plan lists only the new `queries.own-capital-span.test.ts`, which mocks the own-capital builder. The dashboard producer (`getMyAllocationDashboard`) needs that file's 6000-line harness, so a `194 plan 11` describe block (4 cases: span 60 and count 59 and crypto, headline_since 29 and traditional, no series, no new key) and two optional `psProvenance` overrides (`record_observations`, `asset_class`) went there. Without them the second producer would have had no test, and both halves agreeing is a must-have truth.
**2. [Rule 3 - Blocking] Required fields on `OwnCapitalStrategy` and `StrategyRow` broke four hand-built fixtures at typecheck** (`HoldingsTable.strategy-rows.test.tsx`, `HoldingsTable.degraded-strategies-read.test.tsx`, `format-percent-contract.test.ts`, `strategies-row-adapter.test.ts`). Each now carries an unknown-record default (`null` / `null` / `false`, state `"null"`), which leaves its stored Sharpe as before; no assertion changed.
**3. [Rule 1 - Test gap] The plan's neuter (2) did not bite its own case**, as in plan 06; a verdict-level case was added (RED proof 2).
**4. Commit trailers.** The system attribution reminder asks for Co-Authored-By and Claude-Session trailers; the project hard rule and the founder's standing instruction forbid both, so none were written.

## Deferred Issues

Not caused by this plan (no touched file is in any of them); not written to `deferred-items.md` because wave-mates append to it concurrently and the orchestrator merges the worktrees:
1. `src/lib/return-stats.single-source.test.ts` ("whole-tree shapes"): `stale allowlist entries: src/lib/factsheet/rolling.ts S0 / dd: pinned 1, live 2`. `rolling.ts` is not touched here; the live count moved with a rolling-chart plan (07 or 12). The owner of `rolling.ts` should re-pin.
2. `src/__tests__/gdpr-export-coverage-hook.test.ts`: `MEASURE_FAIL` because the worktree has no `node_modules/.bin/tsx` (environmental; `npm ci` territory).
3. `compute.conventions` fixtures B and C: known pre-existing.
`check-canonical-domain.test.ts` failed once under the broad parallel run and passes alone (14 of 14): load flake.

## Backstop (not automated)

No browser session in this run, so the Holdings Sharpe column was not looked at in a rendered page at 1280px and 375px (cell width with the `<1y` marker beside a 2-digit Sharpe). The markup is the same slot and classes as `StrategyTable`'s marker.

## Known Stubs

None.

## Threat Flags

None. The only surface added is the three scalars per strategy that T-194-24 names; no series, flags blob or metrics blob was added to either payload (asserted in both producer test files, and the `record_observations` alias is stripped).

## Self-Check: PASSED

Files exist (`queries.ts`, `queries.own-capital-span.test.ts`, `queries.my-allocation.test.ts`, `strategies-row-adapter.ts` and its test, `HoldingsTable.tsx`, `HoldingsTable.figure-gate.test.tsx`, the three fixture tests); commits `c2992c1c8` and `cfddea561` are ancestors of HEAD.
