---
phase: 46-surface-by-surface-reflow
plan: 02
subsystem: allocations/scenario + allocations/risk + admin (presentation)
tags: [responsive, table, a11y, reflow, fail-loud-guard, css-first]
requires:
  - "@/components/ResponsiveTable (the wrap primitive, built phase 44)"
provides:
  - "ScenarioCompareTable scrolls inside a ResponsiveTable region (role=region + focusable + sr-only hint)"
  - "CorrelationMatrix scrolls horizontally inside a ResponsiveTable region; N×N stays usable (page provides vertical scroll)"
  - "admin ComputeJobsTable scroll-wrapped in ResponsiveTable"
  - "fail-loud all-columns guards for ScenarioCompareTable + CorrelationMatrix"
affects:
  - "/allocations Scenario tab compare grid"
  - "/allocations Risk tab correlation matrix"
  - "/admin compute-jobs table"
tech-stack:
  added: []
  patterns:
    - "ResponsiveTable wrap (replace raw overflow-* scroll div with the primitive)"
    - "fail-loud all-columns render guard (Rule 12 falsifiable)"
key-files:
  created:
    - "src/app/(dashboard)/allocations/components/ScenarioCompareTable.all-columns.test.tsx"
    - "src/app/(dashboard)/allocations/widgets/risk/CorrelationMatrix.all-columns.test.tsx"
  modified:
    - "src/app/(dashboard)/allocations/components/ScenarioCompareTable.tsx"
    - "src/app/(dashboard)/allocations/widgets/risk/CorrelationMatrix.tsx"
    - "src/components/admin/ComputeJobsTable.tsx"
decisions:
  - "CorrelationMatrix migrates the INNER overflow-auto div only; outer data-testid=correlation-matrix flex wrapper kept; inline hex #4A5568/#64748B preserved verbatim (Rule 3 — known non-token site)"
  - "ResponsiveTable is one-axis (overflow-x); the N×N matrix's vertical scroll now comes from the page — intended per RESEARCH Pitfall 4"
  - "admin ComputeJobsTable = scroll-wrap only, NO all-columns guard (internal/lower-stakes per CONTEXT Area 4)"
  - "Guards anchor on verbatim data-testids (scenario-col-{name}, corr-cell) + the six METRICS labels — never on column ordering/styling; label ellipsis is NOT a drop"
metrics:
  duration_min: 4
  completed: 2026-06-27
  tasks: 2
  files_changed: 5
  tests_added: 2
  tests_passing: 19
requirements: [TABLE-01]
---

# Phase 46 Plan 02: Highest-stakes scenario/risk table reflow + all-columns guards Summary

Migrated the two highest-stakes already-scrolling financial tables
(`ScenarioCompareTable`, `CorrelationMatrix`) from a raw `overflow-*` div onto
the `ResponsiveTable` Server Component so they gain the `role="region"` +
focusable + sr-only-hint a11y contract, scroll-wrapped the admin
`ComputeJobsTable`, and added two fail-loud all-columns render guards that block
a future column/row drop — all CSS-first, restyling nothing, with the
CorrelationMatrix inline hex preserved byte-identical.

## What Was Built

### Task 1 — ResponsiveTable migration (commit `c2bf8cb8`)
- **ScenarioCompareTable.tsx**: imported `ResponsiveTable`; replaced the raw
  `<div className="overflow-x-auto">` (and its sibling closing `</div>`) with
  `<ResponsiveTable>…</ResponsiveTable>`. Every `data-testid`
  (`scenario-col-{name}`, `cell-{name}-{key}`, `winner-{key}`, `stamp-{name}`,
  `sharpe-leader`), the `findWinner` logic, and all six `METRICS` rows unchanged.
- **CorrelationMatrix.tsx**: imported `ResponsiveTable`; replaced ONLY the inner
  `<div className="overflow-auto">` with `<ResponsiveTable>`. The outer
  `<div className="flex flex-col gap-3" data-testid="correlation-matrix">`
  wrapper, the `truncate maxWidth:80 title={n}` labels, the `corr-cell`
  data-testid, and every inline hex (`#4A5568` ×2, `#64748B` ×3) preserved
  verbatim. The matrix's vertical scroll now comes from the page (ResponsiveTable
  is one-axis); horizontal from the region — intended per RESEARCH Pitfall 4.
- **ComputeJobsTable.tsx**: imported `ResponsiveTable`; replaced the raw
  `<div className="overflow-x-auto">` table wrapper with `<ResponsiveTable>`.
  Scroll-wrap only, no guard (internal/lower-stakes per CONTEXT Area 4).

### Task 2 — fail-loud all-columns guards (commit `e7fb8d94`, `tdd="true"`)
- **ScenarioCompareTable.all-columns.test.tsx** (new): renders 2 scenarios + the
  live book and asserts (1) the "Metric" axis `<th>` is present, (2)
  `getAllByTestId(/^scenario-col-/)` count === rendered-column count (N), every
  expected name has its own header, (3) every one of the six `METRICS` labels
  renders inside the table, and (4) every (column × metric) value cell exists
  (`cell-{name}-{key}`).
- **CorrelationMatrix.all-columns.test.tsx** (new): renders the precomputed-matrix
  path with N=3 distinct strategies and asserts header `<th>` count ===
  row-label count === N, every strategy name appears as BOTH a column header AND
  a row label (ellipsis tolerated — presence, not exact glyph), and the
  `corr-cell` count === N×N.

## Acceptance Criteria — verified

| Criterion | Result |
|-----------|--------|
| `grep -c ResponsiveTable` ≥ 2 in each of the 3 files | ✓ 3 each (import + open + close) |
| Zero raw `overflow-x-auto`/`overflow-auto` div at migrated sites | ✓ 0 across the 3 files |
| CorrelationMatrix inline hex unchanged from baseline | ✓ `#4A5568` = 2, `#64748B` = 3 (baseline match) |
| Outer `data-testid="correlation-matrix"` wrapper intact | ✓ preserved |
| ScenarioCompareTable guard: `scenario-col-*` count === N + every METRICS row | ✓ |
| CorrelationMatrix guard: header count === row-label count === N | ✓ |
| Existing component tests + new guards pass | ✓ 19/19 (5 files) |
| `npx tsc --noEmit` clean | ✓ exit 0 |

## Falsifiability Proofs (CLAUDE.md Rule 12)

Both guards were proven to fail RED on a real drop, then the subject was
restored byte-identical (`git diff HEAD` on the two source files = empty after
restore).

1. **ScenarioCompareTable** — temporarily removed the `Volatility` row from the
   `METRICS` array → guard RED at
   `within(table).getByText("Volatility")` ("Unable to find an element with the
   text: Volatility"). Restored the row → GREEN.
2. **CorrelationMatrix** — temporarily changed the body render to
   `matrix.slice(0, -1).map(...)` (drop the last row) → guard RED at
   `expect(bodyRows).toHaveLength(N)` (received 2, expected 3). Restored
   `matrix.map(...)` → GREEN.

Both source files verified byte-identical to their Task-1 committed state after
restore (`git diff --stat HEAD` empty for both).

## Deviations from Plan

None — plan executed exactly as written. No bugs, missing functionality, or
blocking issues encountered (Rules 1–3 not triggered); no architectural decision
needed (Rule 4 not triggered).

## Authentication Gates

None.

## Known Stubs

None — no hardcoded empty values, placeholder text, or unwired data sources
introduced. This was a pure presentation-layer scroll-wrapper swap + two render
tests over existing payloads.

## Notes / Constraints honored

- **DESIGN.md locked / restyle nothing**: only the scroll-wrapper element changed;
  no padding/border/row-height/color edits. CorrelationMatrix inline hex
  preserved verbatim (Rule 3 — known non-token site, not "tidied").
- **Frozen math boundary untouchable**: zero changes to `scenario.ts` /
  `compute.ts` / any engine path — pure JSX composition over existing output.
- **No packages installed** (RESEARCH audit N/A).
- **Coverage ratchet**: this plan ADDS two test files (net-positive on
  numerator) and modifies no source logic branches; full `npm run test:coverage`
  is the wave/phase gate (run at merge, not per-task per RESEARCH Sampling Rate).
- The N×N-scrolls-wide-at-320px confirmation is the e2e reflow sweep's job
  (app-wide, owned by 46-05 per RESEARCH/plan verification note), not this plan.

## Self-Check: PASSED

- FOUND: src/app/(dashboard)/allocations/components/ScenarioCompareTable.all-columns.test.tsx
- FOUND: src/app/(dashboard)/allocations/widgets/risk/CorrelationMatrix.all-columns.test.tsx
- FOUND: .planning/phases/46-surface-by-surface-reflow/46-02-SUMMARY.md
- FOUND commit c2bf8cb8 (feat — migration)
- FOUND commit e7fb8d94 (test — guards)
- FOUND commit 02d6c5e6 (docs — SUMMARY)
