---
phase: 99-exposure-allocation-widgets
plan: 03
subsystem: allocations-dashboard / portfolio-intelligence widgets
tags: [recharts, stacked-area, gap-rendering, PI-03, allocation, STRATEGY_PALETTE]
requires:
  - "@/lib/portfolio-exposure (getAllocationSeries — type-only: AllocationPoint, AsofGap)"
  - "src/app/(dashboard)/allocations/widgets/lib/chart-gaps.tsx (SHARED gap contract from 99-02 — consumed byte-untouched)"
  - "@/components/charts/chart-tokens (CHART_BORDER, CHART_TICK_STYLE, CHART_TOOLTIP_STYLE)"
  - "@/components/charts/TouchTooltip"
  - "@/components/ui/Card, @/lib/utils (STRATEGY_PALETTE, formatCurrency)"
provides:
  - "src/app/(dashboard)/allocations/widgets/allocation/AllocationOverTime.tsx — PI-03 0–100% stacked-area allocation-over-time widget"
  - "buildAllocationChartData — pure pivot builder (venues mean-desc, absent-venue-0, all-null gap sentinel, F-2 domain)"
affects:
  - "99-04 mounts AllocationOverTime in HoldingsTabPanel (lg:col-span-2 full width)"
tech-stack:
  added: []
  patterns:
    - "recharts stacked AreaChart — one <Area stackId=\"alloc\"> per venue, largest rendered first = bottom of stack"
    - "wide pivot {asofMs, [venue]: weight}; absent venue = true 0, all-null sentinel row per gap breaks the stack (connectNulls={false})"
    - "STRATEGY_PALETTE hues assigned to VENUES (sanctioned categorical use — never red/green on direction)"
    - "SHARED chart-gaps consumed byte-untouched (git diff --exit-code gate) — zero PI-02/PI-03 gap divergence"
key-files:
  created:
    - "src/app/(dashboard)/allocations/widgets/allocation/AllocationOverTime.tsx"
    - "src/app/(dashboard)/allocations/widgets/allocation/AllocationOverTime.test.tsx"
  modified: []
decisions:
  - "Venue mean weight = sum(weights)/pointCount; all venues share the denominator so sorting by summed weight == sorting by mean (largest first = bottom), with a localeCompare tiebreak for determinism"
  - "Y domain pinned [0,1] with a pct formatter — a plain 0–100% stack, NOT a streamgraph (no stackOffset prop anywhere)"
  - "Absent-venue-0 baseline written BEFORE the present-venue weights so every row carries every venue key; gap sentinels overwrite all keys with null"
metrics:
  duration: ~15m
  tasks: 2
  files: 2
  completed: 2026-07-12
---

# Phase 99 Plan 03: Allocation Over Time (PI-03) Summary

One-liner: The PI-03 `AllocationOverTime` widget — a recharts 0–100% stacked AreaChart binding `getAllocationSeries` with one `<Area stackId="alloc">` per venue in `STRATEGY_PALETTE` order (largest at the bottom), white hairline seams, absent-venue-is-true-0, and F-2 boundary/interior zero-gross gaps rendered as marked hatched bands via the SHARED `chart-gaps` contract (consumed byte-untouched).

## What shipped

**Task 1 — `AllocationOverTime.tsx` (PI-03) + tests.**
`"use client"` component `AllocationOverTime({ points, gaps })` with a type-only import of `AllocationPoint`/`AsofGap` — no supabase client, no `createAdminClient`, no `allocator_holdings` re-query.

Pure helper `buildAllocationChartData(points, gaps)` returns `{ venues, rows, usdByAsofMs, bands, domain }`:
- `venues`: distinct venues sorted by mean weight desc (largest rendered first = BOTTOM of the stack, the stable reading base), localeCompare tiebreak.
- `rows`: one wide row per observed asof `{ asofMs, [venue]: weight }` — a venue absent at an asof reads `0` (its TRUE weight that day, D-P3, not invented data). Plus exactly one all-null sentinel row per gap at `band.midMs`, so with `connectNulls={false}` recharts visibly breaks the stack over the gap. Sorted by `asofMs`, so a leading zero-gross gap's sentinel sits before the first stacked point.
- `usdByAsofMs`: `asofMs → { venue: valueUsd }` for the tooltip's gross-USD line.
- `bands`/`domain` via the SHARED `toGapBands`/`gapXDomain` — the domain spans the padded gap edges (`[min(firstPoint, firstBand.x1), max(lastPoint, lastBand.x2)]`) so a boundary gap band renders instead of clipping (F-2).

Render: `<Card padding="sm">`, header (title `Allocation over time` + last-point as-of stamp), legend chips (one per venue in stack order, `STRATEGY_PALETTE[i]` swatch), then a `height={260}` `<AreaChart accessibilityLayer={false}>` with the spliced `renderGapAreas(bands, patternId)`, one `<Area type="monotone" stackId="alloc" fillOpacity={0.85} stroke="#FFFFFF" strokeWidth={1} connectNulls={false}>` per venue, a numeric UTC calendar X axis (identical to PI-02), a `[0,1]` Y axis with a `${(v*100).toFixed(0)}%` formatter, and a `TouchTooltip` whose rows sort weight-desc and read `"42.3% ($1.24M)"`. Wrapper `role="img" aria-label="Per-venue allocation weights over time"`. Empty state renders the verbatim two-line copy with no SVG. NOT a streamgraph — plain 0–100% stack (no `stackOffset` anywhere).

**Task 2 — repo-wide chart contracts + type gate.**
No widget change was needed: the new `AreaChart` already carries `accessibilityLayer={false}` and routes its tooltip through `TouchTooltip`, so both whole-codebase source-grep guards (`tests/visual/chart-accessibility-layer.test.ts`, `tests/visual/recharts-touchtooltip-usage.test.ts`) pass on first run. The Plan-02 `chart-gaps` + `NetExposureChart` suites stay green, proving the shared lib was not disturbed.

## Verification evidence

- **RED → GREEN:** the 9-test suite failed to import (`AllocationOverTime` did not exist) at the RED commit `1806b094`, then all 9 passed after the implementation (`7b63bc9c`).
- **Acceptance greps:** `connectNulls={false}` ✔ (JSX + doc), `stackId="alloc"` ✔, `stackOffset` = 0 ✔, `STRATEGY_PALETTE` ✔, `catch` = 0 ✔, `createAdminClient|allocator_holdings|@/lib/supabase` = 0 ✔, type-only `AllocationPoint` import ✔, component 214 lines (≥ 90) ✔.
- **Repo-wide + Plan-02 suites:** `chart-accessibility-layer` + `recharts-touchtooltip-usage` + `chart-gaps` + `NetExposureChart` = 23/23 green.
- **chart-gaps unchanged gate:** `git diff --exit-code -- src/app/(dashboard)/allocations/widgets/lib/chart-gaps.tsx` → **PASS (byte-unchanged)**. `git status --short` shows only the two Plan-03 files. This is the plan-checker-confirmed anti-divergence gate.
- **`npx tsc --noEmit`** clean; **`npx eslint`** clean on both touched files.

## Deviations from Plan

None — plan executed exactly as written. Task 2 was pure verification and required no widget edit (the implementation already satisfied both repo-wide contracts), so it produced no separate commit.

## Self-Check: PASSED
- FOUND: src/app/(dashboard)/allocations/widgets/allocation/AllocationOverTime.tsx
- FOUND: src/app/(dashboard)/allocations/widgets/allocation/AllocationOverTime.test.tsx
- FOUND commit 1806b094 (test — RED)
- FOUND commit 7b63bc9c (feat — GREEN)
