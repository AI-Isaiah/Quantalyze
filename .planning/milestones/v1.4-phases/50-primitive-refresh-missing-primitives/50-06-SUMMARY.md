---
phase: 50-primitive-refresh-missing-primitives
plan: 06
subsystem: ui
tags: [react, tailwind-v4, sticky-table, container-queries, view-transitions, a11y, discovery]

# Dependency graph
requires:
  - phase: 50-03
    provides: "Table base primitive (src/components/ui/Table.tsx) + ResponsiveTable scroll/landmark wrapper this reshape builds on"
  - phase: 50-04
    provides: "withViewTransition helper (src/lib/view-transition.ts) + table-scoped [data-strategy-table][data-density] rules in globals.css"
  - phase: 50-05
    provides: "WatchlistTabs ported onto Radix Tabs with the explicit ${idBase}-tab-* trigger ids the role=tabpanel wiring depends on"
provides:
  - "Discovery StrategyTable dense reshape: sticky header + sticky first column, @container priority-collapse to an honest per-row <details>, overflow-gated visible scroll cue, table-scoped density control via withViewTransition"
  - "ResponsiveTable additive API: className (becomes the @container context) + scrollRef (lets a caller measure the real scroll box)"
affects: [phase-52, phase-53, dense-table-reshape, strangler-migration]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Sticky header + sticky first column with a strict z-stack (corner z-30 > header/first-col-header z-20 > first-col-body z-10) and OPAQUE bg-surface backings; row hover relocated to per-cell group-hover so the sticky first column stays solid (Pitfall 5)"
    - "Tailwind v4 @container priority-collapse (@max-3xl:hidden on low-priority cells; @3xl:hidden on the Details disclosure column) — no JS breakpoint listeners, SSR-safe"
    - "Honest priority-collapse: collapsed values computed ONCE per row and rendered IDENTICALLY in the visible cell and the relocated <details> (same honest-null formatter output, never a fabricated 0/em-dash)"
    - "Table-scoped density: data-density on the table root (NOT <body>) so the public table cannot flip the allocator-dashboard global density knob"

key-files:
  created: []
  modified:
    - "src/components/strategy/StrategyTable.tsx - the four-behavior reshape (sticky/collapse/scroll-cue/density)"
    - "src/components/strategy/StrategyTable.test.tsx - +6 reshape assertions (sticky classes, honest-collapse, honest-null, density-root, tabpanel wiring)"
    - "src/components/ResponsiveTable.tsx - additive className + scrollRef props (single scroll region doubles as @container context + measurable box)"

key-decisions:
  - "ResponsiveTable became the SINGLE scroll region for StrategyTable (it owns the role=region + unique aria-label landmark) AND, via the new className prop, the @container containment context — avoids a second wrapper / double scroll / double announce"
  - "Row hover moved from <tr> hover:bg-page/50 to <tr class=group> + per-cell group-hover:bg-page/50, EXCLUDING the two sticky columns, so scrolled cells never bleed through a translucent sticky background (RESEARCH Pitfall 5)"
  - "Density toggle wrapped in withViewTransition with a closure-read guard (no setter-inside-updater side effect); data-density='tight' on the table root maps to the Plan-04 36px/12px step without the global font-size shrink"
  - "Scroll cue is aria-hidden and gated on scrollWidth>clientWidth measured via ResizeObserver on the real scroll box (jsdom/window.resize fallback); it pairs with, never duplicates, the ResponsiveTable aria-label (no double-announce)"

patterns-established:
  - "Dense-table reshape template for phases 52/53: sticky stack + @container collapse-to-honest-detail + overflow-gated cue + table-scoped density"
  - "Honest degradation as a TESTED contract: a null collapsed source surfaces the honest-null em-dash in the detail, asserted to be neither 0 nor 0.00% nor \\$0"

requirements-completed: [STATE-03, STATE-04]

# Metrics
duration: 18min
completed: 2026-06-29
---

# Phase 50 Plan 06: Discovery StrategyTable Dense Reshape (STATE-03 / STATE-04) Summary

**The Discovery `StrategyTable` now reshapes best-in-class — sticky header + sticky first column (opaque, strictly z-layered, no hover bleed), Tailwind v4 `@container` priority-collapse that relocates the REAL low-priority values into an honest per-row `<details>`, an overflow-gated visible scroll cue, and a table-scoped density control that cross-fades the row height through the native View-Transition helper — the template phases 52/53 will replicate.**

## Performance

- **Duration:** ~18 min
- **Started:** 2026-06-29T04:44Z
- **Completed:** 2026-06-29T04:52Z
- **Tasks:** 3 (Task 1 + Task 2 committed together — see Deviations)
- **Files modified:** 3

## Accomplishments
- Reshaped the public Discovery table with the four required STATE-03 behaviors plus the STATE-04 motion wiring, with zero new lint errors/warnings in the touched files and the full 7,031-test suite staying green.
- Made the honest-degradation invariant (T-50-09) a *tested* contract: a genuinely-null collapsed source renders the honest-null em-dash in the `<details>`, asserted to be neither `0`, `0.00%`, nor `$0`.
- Preserved every pre-existing behavior — sort-on-header-click, pagination, watchlist scope, sparkline color rule, EmptyWatchlist, and the Plan-05 `role="tabpanel"` / `aria-labelledby` WatchlistTabs wiring.

## Task Commits

1. **Task 1 + Task 2: Sticky header/first-col + scroll cue + priority-collapse + density** - `ee695524` (feat)
2. **Task 3: Extend StrategyTable.test.tsx (reshape contract)** - `95e8d768` (test)

## Files Created/Modified
- `src/components/strategy/StrategyTable.tsx` - sticky thead (z-20) + sticky first column (star+name, z-10/z-30 corner, opaque `bg-surface`, `border-r`); `@container` priority-collapse of Volatility / 6 Month / AUM + both sparklines (`@max-3xl:hidden`) relocated into an honest per-row `<details>`; overflow-gated aria-hidden scroll cue (ResizeObserver); table-scoped density control ("Table density" group, Comfortable/Compact) writing `data-density` on the table root and wrapped in `withViewTransition`; cell type `text-sm` → `text-body`, numeric cells keep `font-metric tabular-nums`.
- `src/components/strategy/StrategyTable.test.tsx` - +6 assertions covering sticky class presence, sticky-first-col solid-bg (Pitfall 5), honest relocated value, honest-null em-dash (no fabricated 0), density-root toggle (not `<body>`), and tabpanel wiring.
- `src/components/ResponsiveTable.tsx` - additive `className` (merged onto the scroll region → `@container` context) and `scrollRef` (ref to the real scroll `<div>` for the cue's `scrollWidth>clientWidth` measurement). Existing callers unchanged.

## Deviations from Plan

### Task structuring

**1. Task 1 and Task 2 committed together (`ee695524`)**
- **Reason:** Both tasks target the same `viewMode === "table"` JSX branch and their changes are physically interleaved — the sticky cell classes (Task 1), the `@container` collapse variants + `<details>` + density root (Task 2), and the per-cell `group-hover` (a shared Pitfall-5 mechanism) all live on the same `<th>`/`<td>` elements. Splitting them into two commits would have required an artificial intermediate state. Committed as one cohesive `feat` commit covering both behaviors; the message enumerates both tasks' deltas. No scope added beyond the two tasks.

### Auto-added (Rule 2 / Rule 3) — correctness requirements

**2. [Rule 3 - blocking] ResponsiveTable `scrollRef` + `className` props**
- **Found during:** Task 1.
- **Issue:** The plan requires the visible scroll cue to measure `scrollWidth > clientWidth` on the actual scroll container, and to build ON ResponsiveTable while keeping it the single scroll region. ResponsiveTable owned the only `overflow-x-auto` box but exposed no ref and no class hook, so the cue could not measure the real box without either a second (wrong) scroll wrapper or a forwarded ref.
- **Fix:** Added two additive, backward-compatible props (`scrollRef`, `className`) so ResponsiveTable stays the single scroll region AND becomes the `@container` context. All existing consumers (HoldingsTable, OpenPositionsTable, ScenarioCompareTable, CorrelationMatrix, ComputeJobsTable) are unaffected — verified by the full green suite.
- **Files modified:** `src/components/ResponsiveTable.tsx`
- **Commit:** `ee695524`

## Verification
- `npx vitest run src/components/strategy/StrategyTable.test.tsx` → **23 passed** (17 pre-existing + 6 new), incl. the honest-collapsed-value + honest-null assertions.
- `npx tsc --noEmit` → clean.
- `npm run lint` → **0 errors** (575 pre-existing `no-raw-font-px` warnings, none in the touched files; verified `grep StrategyTable|ResponsiveTable` returns none).
- Full suite `npx vitest run` → **584 files / 7,031 tests passed, 0 failed** (ResponsiveTable signature change broke no consumers).
- `e2e/discovery-axe.spec.ts` — **unmodified**; runs seeded in CI's MA-8 list. The reshape keeps the semantic `<table>`/`<th scope>` structure, the ResponsiveTable unique landmark, an `aria-hidden` cue, and standard `<button>`/`<details>` controls, so the axe gate stays green in CI.

## Frozen invariants respected
- No touch to `scenario.ts` / `compute.ts` / FactsheetBody — presentation-only.
- no-invented-data preserved AND tested (T-50-09): collapsed values are the real values relocated; null stays honest-null.
- `font-metric tabular-nums` alignment preserved on every numeric cell.
- ResponsiveTable unique-`aria-label` landmark contract preserved (label="Strategies"; additive props only).
- WatchlistTabs `role="tabpanel"` / `aria-labelledby` (Plan-05) wiring intact and tested.

## Self-Check: PASSED
</content>
