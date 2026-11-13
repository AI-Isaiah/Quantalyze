---
phase: 201-plainwords-one-name-per-concept-explained-and-the-small-inco
plan: 08
subsystem: factsheet-metrics-rail
tags: [d-10, d-11, d-01, d-03, d-19, d-20, clar-03, clar-06, copy-census]
requires: [201-25, 201-26]
provides:
  - section numerals derived from render order in both MetricsColumn arms
  - term props on every registered rail row label (Main, Rolling, Extended, Benchmark)
  - isoToMonthDay, monthRowLabel and the worst-drawdown dates on formatDay / formatMonth
  - ledger plan-08 empty
affects: [201-24]
tech-stack:
  added: []
  patterns:
    - "NumberedSections: one helper assigns numerals by index among the sections that rendered"
key-files:
  created:
    - src/app/factsheet/[id]/v2/MetricsColumn.numerals.test.tsx
  modified:
    - src/app/factsheet/[id]/v2/MetricsColumn.tsx
    - src/app/factsheet/[id]/v2/MetricsColumn.terms.test.tsx
    - src/app/factsheet/[id]/v2/MetricsColumn.window.test.tsx
    - src/app/factsheet/[id]/v2/MetricsColumn.worst-drawdowns-reflow.test.tsx
    - src/app/factsheet/[id]/v2/MetricsColumn.comparator-through.test.tsx
    - src/app/factsheet/[id]/v2/MetricsColumn.no-loss-residues.test.tsx
    - scripts/copy-census/ledgers/plan-08.ts
decisions:
  - "isoToMonthDay stays exported as a one-line alias of formatDay, so DistributionPanels, ComparatorPicker and other plans' tests print the same format with no edit."
  - "A row label longer than its term (Kurtosis (excess), P5 (daily)) keeps its full text as the Term children; the alias covers it."
metrics:
  tasks: 3
  completed: 2026-11-11
status: complete
actuals:
  tokens: 26000
  tasks: 3
  commits: 3
plan_head_before: 8724de1ab708bff9ef2d452ffeb07ac6c4a2d03b
plan_head_after: 45faca39bf3f62e489064621e536d85b5b47f2a3
---

# Phase 201 Plan 08: The Detailed metrics rail numbers its sections in order, explains its terms and prints one date format Summary

The factsheet rail's section numerals are now the section's position among the sections that rendered (I..N, no skip, no repeat) in both the `all` and `detailed` arms; every registered row label renders through `Term` with its registry definition; every rail date prints through `formatDay` or `formatMonth`; ledger plan-08 ends at `pending: {}`.

## What was built

- **Task 1 (tracer, `0c896c444`).** `Row`, `RollingRow` take an optional `term?: TermKey`; Omega in Extended metrics opens `termDefinition("omega")` on focus and is plain inside `PlainTerms`.
- **Task 2 (`cc8c6d0ee`).** `benchmarkSection` returns a name and children (or null); `NumberedSections` assigns roman numerals by index. HEAD read I, II, III, V, IV and skipped a numeral without Style or comparator. `MetricsColumn.numerals.test.tsx` pins the sequence across both arms and the Style/comparator matrix, with section names byte-identical.
- **Task 3 (`45faca39b`).** `term` on every Main, Rolling, Extended and Benchmark row (and the Max Drawdown panel title). `isoToMonthDay` delegates to `formatDay` (local month array deleted), `monthRowLabel` uses `formatMonth`, the `ymd` helper is retired and the worst-drawdown date cells print `Mon D, YYYY` in `whitespace-nowrap` cells. Colocated tests updated for the new date strings.

## Verification

- Task 3 verify run: 26 files, 359 tests passed (`MetricsColumn` family, `FactsheetBody.census`, `usd-view-withholdings`, `copy-census`, `figure-gate-census`, `scripts/factsheet-census/count`, `phase-52-frozen-spine-guards`).
- `npx tsx scripts/copy-census/run.ts --ledger plan-08` prints no hits, exit 0.
- `npx tsc --noEmit -p .` exit 0.
- `npx eslint` on MetricsColumn.tsx: 0 errors, 1 warning (`nativeUnitReason` unused at line 14; present on `feat/201-plainwords` unchanged, out of scope).
- Acceptance greps: `label="IV"` / `label="V"` count 0 in MetricsColumn.tsx; `term?: TermKey` present; ledger `pending: {}`.

gc-201-08-neuter: gate=MetricsColumn.numerals.test.tsx result=red restored=identical (hard-coded Terms "V" and Benchmark "IV": 8 arms red across both rail arms)
gc-201-08-neuter: gate=MetricsColumn.terms.test.tsx+copy-census.test.ts result=red restored=identical (removed `term` from the Ulcer Index row: census rule B names `MetricsColumn.tsx:1503 Ulcer Index`, terms test finds no ulcer_index trigger)
gc-201-08-gates: vitest=green eslint=clean tsc=clean (eslint: one pre-existing warning, no errors)

cross-plan-pins: none found; the family run and the named guards are green.

## Deviations from Plan

The plan listed `MetricsColumn.final-month.test.tsx` as a file to update. It needed no edit: `monthRowLabel` through `formatMonth` prints the same `Last month (Oct 2026)` text, and the test passes unchanged. `MetricsColumn.comparator-through.test.tsx` and `MetricsColumn.no-loss-residues.test.tsx` (colocated, so owned here) were edited for the new date format. The session that built Tasks 1 and 2 died before recording the Task 2 neuter, so it was re-run in this resume against the final code.

## Known Stubs

None.

## Self-Check: PASSED

- Commits `0c896c444`, `cc8c6d0ee`, `45faca39b` are ancestors of HEAD; `MetricsColumn.numerals.test.tsx` and this SUMMARY exist; the working tree carries no uncommitted plan files.
