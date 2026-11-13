---
phase: 197-screen-discovery-reads-plainly-and-a-shortlist-can-be-compared
plan: 01
subsystem: ui
tags: [discovery, strategy-table, figure-gate, clar-01, headers, track-column]
requires:
  - phase: 194
    provides: "figure-gate covered-day record (rowRecord, ONE_YEAR_DAYS, compareWithMissingLast)"
provides:
  - "DISCOVERY_COLUMNS: one label map read by the table header and the grid footer"
  - "recordStartDay, trackMonths, TRACK_MIN_MONTH_DAYS in figure-gate"
  - "Sortable Track column; two-line metric headers with definition tooltips; unsigned volatility"
affects: [197-03, 197-05, 201]
tech-stack:
  added: []
  patterns: ["Column labels live in one plain-data module so table and grid cannot disagree"]
key-files:
  created:
    - src/components/strategy/discovery-columns.ts
    - src/components/strategy/StrategyTable.headers.test.tsx
  modified:
    - src/lib/figure-gate.ts
    - src/lib/figure-gate.test.ts
    - src/components/strategy/StrategyTable.tsx
    - src/components/strategy/StrategyGrid.tsx
    - src/components/strategy/StrategyGrid.test.tsx
    - DESIGN.md
    - src/components/strategy/StrategyTable.test.tsx
    - src/components/strategy/StrategyTable.visibility.test.tsx
    - src/components/strategy/StrategyTable.manager-rows.test.tsx
    - src/components/strategy/StrategyTable.phone-columns.test.tsx
    - src/components/strategy/StrategyTable.pending-chip.test.tsx
    - src/components/strategy/StrategyTable.stale-analytics.test.tsx
    - src/components/strategy/StrategyTable.default-mounts.test.tsx
    - src/components/strategy/__fixtures__/strategy-table-default-mounts.json
    - src/__tests__/figure-parity-pages.test.tsx
    - src/__tests__/phase-52-container-tabular-nums.test.tsx
    - src/__tests__/figure-gate-census.test.ts
    - "src/app/(dashboard)/strategies/page.table.test.tsx"
    - e2e/layout-narrow.spec.ts
key-decisions:
  - "Column map in its own module (StrategyTable imports StrategyGrid, so the grid cannot import the map from the table)"
  - "Track divides by ONE_YEAR_DAYS (365) and clamps 30+ covered days to at least 1, so Track and the 194 <1y marker agree on one row"
  - "th gets the same aria-label as its sort button (name-from-content concatenates the two header lines without separators)"
  - "figure-parity compares Volatility by value (table unsigned, tearsheet still signed until Phase 201)"
requirements-completed: [CLAR-01]
duration: ~1h 10m
completed: 2026-11-08
status: complete
actuals:
  tokens: 95000
  tasks: 4
  commits: 6
commits: 6
plan_head_before: 342d4055541e235899913eada4227bcec60dd1af
plan_head_after: fb0f640acde3ddd12f967ea2e40e46c80a26a6bb
---

# Phase 197 Plan 01: Discovery headers, Track column, unsigned volatility Summary

Every discovery metric header now names its period and annualisation with a definition tooltip, volatility prints without a sign, and a sortable Track column shows whole months of record from the same covered-day span the 194 gate reads.

## What was built

- **Task 1 (tracer), `90bf1dc0f`:** `recordStartDay` (called by `figureSpan`, so the Track title's first date and the span cannot disagree), `trackMonths`, `TRACK_MIN_MONTH_DAYS`; `discovery-columns.ts`; the Track header (sort button + Tooltip) and cell in `StrategyTable`; `track` in `TableSortKey` only (never `SortKey`, never `PERCENTILE_BY_SORT_KEY`); unknown span sorts last in both directions.
- **Task 2, `83be2d70a`:** the full UI-SPEC map; two-line headers (label line, qualifier line with `whitespace-nowrap` units and an `aria-hidden` separator); sparkline headers read "Return curve" and "Underwater"; `formatPercent(volatilityShown, 2, { signed: false })`; grid footer labels built from the map and stacked at `max-[375px]`; one dated DESIGN.md sentence.
- **Task 3, `6bc5fa06d`:** six component test files moved to the new accessible names; Track shifts td indexes by one; volatility expectations unsigned.
- **Task 4, `fb0f640ac`:** cross-surface guards, byte-pin fixture, census allow-list, e2e locators.

## TDD evidence (plan type execute, tdd="true" tasks)

- RED, Task 1: `figure-gate.test.ts` failed with `trackMonths is not a function` (7 tests); `StrategyTable.headers.test.tsx` failed on `no header "Track, months of record"` (11 tests). Target tests executed and failed on the planned assertion, not a syntax or load fault.
- RED, Task 2: the unsigned-volatility test and the sparkline-header test failed on the Task 1 output (signed `+33.77%`, header "Return"). The seven sortable-header cases were green on arrival because the Task 1 header path was already generic; their RED evidence is the Task 1 map, whose entries still read "Return %", "6 Month".
- Each gate was shown able to fail (neuter, RED, restore from byte backup): divisor 365.25 (3 tests RED), clamp `max(0,...)` (1 RED), sort key `observations` (2 RED), `headlineSince: null` in the title (1 RED), signed volatility (1 RED), footer `ann.` token removed (2 RED). All restored; final suite green.

## Verification

- `npx vitest run src/components/strategy` plus the listed cross-surface guards and the census: 87 files, 1510 tests, all pass.
- `npx tsc --noEmit`: clean. `npm run lint`: 0 errors (2 pre-existing warnings in files this plan does not touch).
- Acceptance greps: `trackMonths`/`recordStartDay` exports 1 each; `"Return %"` in `e2e/layout-narrow.spec.ts` 0 (baseline 6); `"+33.77%"` 0; `"+18.55%"` 0; no `writeFileSync|toMatchSnapshot` in the default-mounts test; no diff to `StrategyFilters.tsx` or `src/app/factsheet`.

## Byte-pin fixture (audited hunks)

Rendered the three mounts into the session scratchpad, diffed per mount at tag granularity, classified every hunk: header cells / Track cells / unsigned volatility, zero outside. Counts (header / Track / volatility): discovery 17 (11/3/3), browse 17 (11/3/3), myStrategiesOwner 21 (11/6/4). The test gained no write path; a dated docblock paragraph records the classes and counts. Fixture rows still carry no series dates, so every pinned Track cell is the em dash.

## Deviations from Plan

**1. [Rule 1 - Bug] Placeholder rows lacked a Track cell.**
- **Found during:** Task 3 census (placeholder td count was one short of the th count).
- **Fix:** an em-dash Track `<td>` in the owner placeholder row. **Commit:** `4483b3886`.

**2. [Rule 1 - Bug] `th` accessible name ran the two header lines together.**
- **Found during:** Task 3 (`getByRole("columnheader", { name })` could not match; computed name was "Returnfull record not ann.").
- **Fix:** `aria-label` on the sortable `<th>` from the map, equal to the button name, plus a test pinning agreement. This also changes what a screen reader announces for a figure cell: the full period-and-annualisation name. **Commit:** `5f3416883`.

**3. [Rule 3 - Blocking] Census flagged `discovery-columns.ts`.** It names "annualized"/"CAGR" in strings and imports no gate module. Added `"label only"` to `EXCLUDED` in `figure-gate-census.test.ts` (the file's own prescribed route). Included in `fb0f640ac`.

**4. Tooltip text uses `SIX_MONTH_WINDOW_DAYS`** instead of a literal 182 (same text as the UI-SPEC), so the map restates no window constant.

Task 3 listed `StrategyGrid.figure-gate.test.tsx`; it needed no edit and passes unchanged.

## Not verified / left

- The backstop visual check (375px and 1280px: qualifiers break only at the separator, no header over three lines, pinned Strategy header aligned) was NOT run; it needs a browser. The `e2e/layout-narrow.spec.ts` locator updates were typechecked but the spec itself was not executed (seeded e2e lane).
- Other e2e specs were not searched beyond `layout-narrow.spec.ts` for old header labels.
- Observation, not fixed (as planned): the tearsheet and CompareTable still print volatility with a `+`; Phase 201 owns it.

## Known Stubs

None.

## Threat Flags

None. No new endpoint, auth path or schema.

## Self-Check: PASSED
