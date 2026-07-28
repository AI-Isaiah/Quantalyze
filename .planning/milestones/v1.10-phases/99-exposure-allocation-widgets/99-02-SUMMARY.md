---
phase: 99-exposure-allocation-widgets
plan: 02
subsystem: allocations-dashboard / portfolio-intelligence widgets
tags: [recharts, charts, gap-rendering, PI-02, exposure, design-adaptation]
requires:
  - "@/lib/portfolio-exposure (getNetExposureSeries — type-only: NetExposurePoint, AsofGap)"
  - "@/components/charts/chart-tokens (CHART_ACCENT, CHART_TICK_STYLE, CHART_TOOLTIP_STYLE, CHART_REFERENCE_DASH, CHART_BORDER, CHART_TEXT_MUTED)"
  - "@/components/charts/TouchTooltip"
  - "@/components/ui/Card, @/lib/utils formatCurrency"
provides:
  - "src/app/(dashboard)/allocations/widgets/lib/chart-gaps.tsx — SHARED gap-band contract (PI-02 + PI-03 single source)"
  - "src/app/(dashboard)/allocations/widgets/positions/NetExposureChart.tsx — PI-02 ComposedChart (gross Area + net Line + gap bands)"
affects:
  - "99-03 (AllocationOverTime) consumes chart-gaps byte-untouched"
  - "99-04 mounts NetExposureChart in HoldingsTabPanel"
tech-stack:
  added: []
  patterns:
    - "recharts ReferenceArea with a custom ReactElement shape + zIndex={0} (default-layer, no portal) for in-SVG gap bands"
    - "null-sentinel row (net & gross null) + connectNulls={false} to break BOTH series across a gap"
    - "numeric epoch-ms x-axis (UTC) — calendar-linear, gap-aware domain"
key-files:
  created:
    - "src/app/(dashboard)/allocations/widgets/lib/chart-gaps.tsx"
    - "src/app/(dashboard)/allocations/widgets/lib/chart-gaps.test.tsx"
    - "src/app/(dashboard)/allocations/widgets/positions/NetExposureChart.tsx"
    - "src/app/(dashboard)/allocations/widgets/positions/NetExposureChart.test.tsx"
  modified: []
decisions:
  - "ReferenceArea shape needs a cartesian series present for recharts to build the axis scale under jsdom; zIndex={0} keeps the band in the default (non-portal) layer so it renders in-tree and is queryable"
  - "useId() colons stripped for a valid SVG url(#…) pattern fragment id"
metrics:
  duration: ~10m
  tasks: 2
  files: 4
  completed: 2026-07-12
---

# Phase 99 Plan 02: Net Exposure Chart + Shared Gap-Render Library Summary

One-liner: A shared `chart-gaps` library (null-sentinel line breaks + proportional hatched `ReferenceArea` bands byte-matching the factsheet `<pattern>` + `"{days}d — no data"` labels ≥5d + F-2 gap-aware x-domain) plus the PI-02 `NetExposureChart` — a recharts ComposedChart binding `getNetExposureSeries` with BOTH a gross Area and a net Line, compact-USD axes, dashed zero refline, and honest-zero-point vs marked-gap distinction.

## What shipped

**Task 1 — `chart-gaps.tsx` (the shared source for PI-02 AND PI-03).**
Exports `HALF_DAY_MS`, `asofToUtcMs`, `GapBand`, `toGapBands`, `gapXDomain`, `renderGapAreas`, `makeDateTickFormatter`. UTC-pure (`split("-") + Date.UTC`, mirroring the private `utcMs` in portfolio-exposure; the only `new Date()` in code is the numeric `new Date(ms)` in `toIsoDate`). `renderGapAreas` returns a `<defs>` holding the factsheet hatch `<pattern>` (userSpaceOnUse 6×6 rotate(45), stroke `var(--color-text-muted)` opacity 0.15 width 3 — byte-identical to `TimeSeriesChart.tsx:299-310`) plus one `<ReferenceArea>` per band using a custom `GapBandShape` that carries an always-present SVG `<title>` (`No data {start} → {end} ({days} days)`) and the `{days}d — no data` label only at days ≥ 5. `gapXDomain` includes padded gap edges beyond the first/last point (F-2 boundary support proven at the lib level). Interface is deliberately general (any series) so 99-03 consumes it byte-untouched.

**Task 2 — `NetExposureChart.tsx` (PI-02).**
`"use client"` component `NetExposureChart({ points, gaps })` with a type-only import of `NetExposurePoint`/`AsofGap` — no supabase client, no `createAdminClient`, no `allocator_holdings` re-query. Pure helper `buildNetChartData` maps points to numeric-x rows, injects exactly one all-null sentinel per gap at `band.midMs`, sorts by `asofMs`, and derives the domain via `gapXDomain`. Renders a gross `<Area>` AND a net `<Line>` (both `connectNulls={false}`), a dashed zero `<ReferenceLine>`, compact-USD Y axis (`formatCurrency`), a UTC calendar-linear X axis, `TouchTooltip`, and `accessibilityLayer={false}`. Empty state renders the verbatim two-line copy with no SVG. Wrapper `role="img" aria-label="Net and gross exposure over time in US dollars"`.

## Flagged for design-review

**Proportional hatched gap-band — geometric adaptation of the factsheet seam convention.**

The public factsheet (`src/app/factsheet/[id]/v2/TimeSeriesChart.tsx:285-289`) renders a gap as a **zero-width hatched seam** because its x-axis is **index-based** — gap days are absent from the axis, so a gap has no temporal width there. These widgets use a **calendar-linear numeric x-axis** (epoch-ms) where a gap has **true temporal width**, so the honest equivalent of the seam is a **proportional hatched band** spanning the gap's real duration. The texture, color, opacity, and label copy are **byte-identical** to the factsheet seam — only the geometry adapts to the axis model, the convention's language does not. An index-based axis was rejected: it would compress a 90-day outage to the same width as a 1-day hole, understating missing coverage (the opposite of "honest").

This is the ONE documented deviation from the factsheet gap convention. It is surfaced here (and in a verbatim header comment atop `chart-gaps.tsx`, grep `design-review`) and must not be hidden. **Requesting design-review sign-off on the proportional-band geometry.**

## Deviations from Plan

None affecting behavior or scope. Two test-harness adaptations (not product deviations), both root-caused:

1. **[Rule 3 — blocking] recharts `ReferenceArea` shape did not render under jsdom.** Root cause: recharts 3.9.2 returns `null` from `ReferenceAreaImpl` when the axis scale is null, and the scale is only built when a cartesian series (`Area`/`Line`) is present — plus the default `zIndex: 100` portals the band out of the queried subtree. Fixes: the isolated `chart-gaps` test host includes a `<Line>` series; `renderGapAreas` sets `zIndex={0}` on each `ReferenceArea` (default layer, no portal — matches "rendered in the default layer without portals" from the recharts zIndex contract). The real `NetExposureChart` already has Area+Line, so this is only a test-host requirement. Verified by debug harness (`refArea` 0→1 once a series is present).
2. **NetExposureChart test `ResponsiveContainer` mock** injects concrete `width/height` via `cloneElement` (rather than a plain wrapper div) so the chart builds a real axis scale and the gap band renders for the assertion.

## Verification evidence

- RED→GREEN, `chart-gaps.test.tsx`: RED (module missing) → 12 passed.
- RED→GREEN, `NetExposureChart.test.tsx`: RED (module missing) → 7 passed.
- Combined with repo-wide contracts: `chart-gaps` + `NetExposureChart` + `chart-accessibility-layer` + `recharts-touchtooltip-usage` → **4 files, 23 tests passed**.
- `npx tsc --noEmit`: clean for both touched source and test files.
- `npx eslint` on all four touched files: clean (no-raw-font-px respected — in-SVG `fontSize` is a numeric prop, not a Tailwind class).
- Acceptance greps: `connectNulls={false}` = 2 (Area AND Line); `<Area` = 1; `<Line` = 1; `catch` = 0; `createAdminClient|allocator_holdings|@/lib/supabase` = 0; type-only portfolio-exposure import present; `CHART_POSITIVE|CHART_NEGATIVE|#DC2626|#15803D` = 0 (no red/green on direction); `design-review` present in `chart-gaps.tsx`.

## Commits

- `4056f8c8` feat(99-02): chart-gaps shared gap-render lib (PI-02+PI-03 single source)
- `006f9fe3` feat(99-02): NetExposureChart — ComposedChart gross Area + net Line + gaps

## Self-Check: PASSED

- FOUND: src/app/(dashboard)/allocations/widgets/lib/chart-gaps.tsx
- FOUND: src/app/(dashboard)/allocations/widgets/lib/chart-gaps.test.tsx
- FOUND: src/app/(dashboard)/allocations/widgets/positions/NetExposureChart.tsx
- FOUND: src/app/(dashboard)/allocations/widgets/positions/NetExposureChart.test.tsx
- FOUND commit: 4056f8c8
- FOUND commit: 006f9fe3
