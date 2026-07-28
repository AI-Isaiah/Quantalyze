---
phase: 46-surface-by-surface-reflow
plan: 01
subsystem: ui
tags: [responsive, tailwind, wcag-reflow, react, vitest, accessibility, tables]

# Dependency graph
requires:
  - phase: 44-foundation-primitives-and-verification-gates
    provides: "ResponsiveTable Server Component (overflow-x-auto + role=region + tabIndex + sr-only-hint contract)"
provides:
  - "3 HoldingsTable inner tables (StrategyRows / Legacy / Design) wrapped in ResponsiveTable — scroll at 320px, page does not overflow"
  - "OpenPositionsTable wrapped in ResponsiveTable (tfoot total rides inside)"
  - "Fail-loud all-columns render guard for the two highest-stakes holdings modes (legacy 7-col, design 9-col)"
affects: [46-02, 46-03, 46-04, 47-hand-rolled-svg-charts]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Wrap-only ResponsiveTable retrofit: import + wrap the <table> branch of the cond ? <p/> : <table/> ternary, zero restyle"
    - "All-columns render guard anchored on CODE constants (not inverted UI-SPEC mode labels), with aria-hidden sort-glyph normalization so the order assertion pins labels not sort state"

key-files:
  created:
    - "src/app/(dashboard)/allocations/components/HoldingsTable.all-columns.test.tsx"
  modified:
    - "src/app/(dashboard)/allocations/components/HoldingsTable.tsx"
    - "src/app/(dashboard)/allocations/components/OpenPositionsTable.tsx"

key-decisions:
  - "Anchored the guard on TOTAL_COLUMNS=7 (LegacyHoldingsTable) + DESIGN_TOTAL_COLUMNS=9 (DesignHoldingsTable) + the verbatim <th> set — NOT the UI-SPEC's inverted NEW/DESIGN mode names (46-RESEARCH §inversion)"
  - "Normalized the aria-hidden sort-direction glyph (↑↓▲▼) out of the ordered-label assertion so the active default sort (Allocation↓) doesn't make the order pin brittle; column-presence drops are still caught (a removed <th> removes its label entirely)"
  - "Notes (legacy 7th col) and Status (design 1st col) icon headers asserted by aria-label, not text (they carry no text label)"
  - "Built the design-mode fixture directly as DesignHoldingRow[] (flat interface) rather than via the adapter — minimal, no banner/sub-row rows so the only columnheaders come from <thead>"

patterns-established:
  - "ResponsiveTable wrap retrofit (the entire Table Reshape job): one import, wrap the <table> branch only, restyle nothing, no duplicate sr-only node"
  - "Falsifiable structural guard: delete a material <th> → guard goes RED → restore → GREEN (Rule 12), proven once by the implementer"

requirements-completed: [TABLE-01]

# Metrics
duration: ~16min
completed: 2026-06-27
---

# Phase 46 Plan 01: Holdings-family ResponsiveTable wrap + all-columns guard Summary

**Wrapped the 3 HoldingsTable inner tables + OpenPositionsTable in the existing `ResponsiveTable` (CSS-first horizontal scroll + ARIA region, zero restyle) and added a falsifiable all-columns render guard pinning legacy-7 and design-9 holdings columns against a future `hidden`/`truncate` column-drop.**

## Performance

- **Duration:** ~16 min
- **Started:** 2026-06-27T17:00:33Z
- **Completed:** 2026-06-27T17:16:55Z
- **Tasks:** 2
- **Files modified:** 3 (2 modified, 1 created)

## Accomplishments
- 3 holdings inner tables (StrategyRows / Legacy / Design) + OpenPositionsTable now each render inside a `ResponsiveTable` scroll region at 320px; the page no longer overflows when the dense financial columns exceed the viewport.
- New fail-loud `HoldingsTable.all-columns.test.tsx` guard pins the EXACT `<th>` count + ordered material-label set for the two highest-stakes modes (legacy `TOTAL_COLUMNS=7`, design `DESIGN_TOTAL_COLUMNS=9`) and bans `hidden`/`md:table-cell`/`truncate` on any material header.
- Falsifiability proven (Rule 12): deleted the legacy "Quantity" `<th>` and the design "Sharpe" `SortableHeader` → 4 guard assertions went RED → restored → all green.
- Zero restyle: every className, `data-table="strategies"` / `data-strategy-row` / `data-row-id` data-attr, and `style={{ minHeight: 44 }}` row height preserved verbatim; all 42 pre-existing HoldingsTable tests stayed green.

## Task Commits

Each task was committed atomically:

1. **Task 1: Wrap 3 HoldingsTable inner tables + OpenPositionsTable in ResponsiveTable** - `a0b0390c` (feat)
2. **Task 2: Fail-loud all-columns guard (legacy 7 + design 9)** - `de631910` (test)

**Plan metadata:** (this commit) (docs: complete plan)

_Note: this is a guard over EXISTING table structure — the implementation (columns) already shipped, so Task 2's guard passed on first run (after the sort-glyph normalization fix); the RED/restore step was the deliberate falsifiability proof, not a TDD build cycle._

## Files Created/Modified
- `src/app/(dashboard)/allocations/components/HoldingsTable.tsx` - Added `ResponsiveTable` import; wrapped the `<table>` branch of StrategyRowsTable (line 260), LegacyHoldingsTable (399), DesignHoldingsTable (620). `ResponsiveTable` token count 7 (1 import + 3 open + 3 close).
- `src/app/(dashboard)/allocations/components/OpenPositionsTable.tsx` - Added `ResponsiveTable` import; wrapped the `<table>` (line 127), `<tfoot>` total rides inside. Token count 3 (1 import + 1 open + 1 close).
- `src/app/(dashboard)/allocations/components/HoldingsTable.all-columns.test.tsx` - New fail-loud render guard: 6 tests (count + ordered named-set + no-hidden-class, per mode). Mirrors the `next/navigation` + `next/link` mocks from `HoldingsTable.strategy-rows.test.tsx`.

## Decisions Made
- **Trust the code, not the spec.** The UI-SPEC's "NEW (7-col)" vs "DESIGN/legacy (9-col)" mode labels are inverted relative to the code. The guard anchors on `LegacyHoldingsTable`→`TOTAL_COLUMNS=7` and `DesignHoldingsTable`→`DESIGN_TOTAL_COLUMNS=9` plus the verbatim `<th>` label sets, per 46-RESEARCH §inversion.
- **Sort-glyph normalization (in-test only).** The active default-sort column (Allocation, `dir:"desc"`) appends an `aria-hidden` `↓` to its text content. The ordered-label assertion strips `[↑↓▲▼]` so the pin tracks the material label set, not transient sort state. Column-presence drops still go RED because removing a `<th>` removes its label entirely.
- **Icon headers by aria-label.** The legacy 7th (Notes) and design 1st (Status) columns carry no text — asserted via `getByRole("columnheader", { name: "Notes" | "Status" })`.

## Deviations from Plan

None - plan executed exactly as written.

The only mid-task adjustment was an in-test refinement (sort-glyph normalization in the new guard file itself), not a deviation from the plan's instructions — the plan explicitly required the guard to anchor on the material label set and remain falsifiable, which this satisfies. No source-file behavior, className, data-attr, or column changed.

## Issues Encountered
- First run of the design-mode ordered-label assertion failed because the default-sorted "Allocation" header rendered as `"Allocation↓"` (the `aria-hidden` sort glyph). Resolved by normalizing `[↑↓▲▼]` out of the label comparison in the test — a robustness fix in the guard, not a code change. Re-ran: 6/6 green.

## User Setup Required

None - no external service configuration required. Pure presentation retrofit; no env vars, no migration, no new dependency (`ResponsiveTable` is the existing phase-44 in-repo Server Component).

## Next Phase Readiness
- The holdings half of TABLE-01 SC#2 (highest-stakes all-columns guard) is complete and falsifiable. The remaining highest-stakes tables (`ScenarioCompareTable`, `CorrelationMatrix`) and their guards land in subsequent Wave-1 plans (46-02+), as do the wizard de-block (WIZARD-01) and the all-route reflow sweep (REFLOW-01/02/03).
- `npx tsc --noEmit` clean; full HoldingsTable suite 48/48 green (42 prior + 6 new guard).
- No blockers.

## Self-Check: PASSED

- FOUND: `src/app/(dashboard)/allocations/components/HoldingsTable.all-columns.test.tsx`
- FOUND: `.planning/phases/46-surface-by-surface-reflow/46-01-SUMMARY.md`
- FOUND commit: `a0b0390c` (Task 1)
- FOUND commit: `de631910` (Task 2)

---
*Phase: 46-surface-by-surface-reflow*
*Completed: 2026-06-27*
