---
phase: 99-exposure-allocation-widgets
plan: 01
subsystem: ui
tags: [react, tailwind, exposure, portfolio-intelligence, rtl, vitest]

# Dependency graph
requires:
  - phase: 98-portfolio-exposure-read-layer
    provides: getLatestExposureSnapshot + ExposureSnapshot/ExposureSlice frozen data contract (D-P1/D-P2)
provides:
  - PI-01 ExposureByClass client widget (segmented composition bar + KPI strip + drilldown table + honest-empty)
affects: [99-04 HoldingsTabPanel mount, gsd-ui-checker, design-review]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Pure-CSS composition bar (flex + width%) instead of a chart lib for a 2-value class dimension"
    - "Type-only import of a server read module to keep the Supabase client out of the client bundle (T-99-01)"
    - "DESIGN.md no-red/green-on-direction: sign carried in the number + muted caption, never semantic color"

key-files:
  created:
    - "src/app/(dashboard)/allocations/widgets/positions/ExposureByClass.tsx"
    - "src/app/(dashboard)/allocations/widgets/positions/ExposureByClass.test.tsx"
  modified: []

key-decisions:
  - "Bound the widget to the frozen Phase-98 read EXACTLY: no re-query of allocator_holdings, no reshape — consumes a plain ExposureSnapshot | null prop"
  - "Did NOT 'fix' the upstream flat->LONG signed() behavior (advisory #1); bound the read contract as-is (flat ≈ 0 notional)"
  - "Derivative segment color #0F172A kept as a LOCAL const, NOT added to chart-tokens.ts (frozen design-lint-exempt glob)"

patterns-established:
  - "widgets/positions/ExposureByClass: client widget consuming server-derived JSON props, mounted by direct import (not the WIDGET_COMPONENTS barrel)"

requirements-completed: [PI-01]

# Metrics
duration: ~12min
completed: 2026-07-12
---

# Phase 99 Plan 01: ExposureByClass Summary

**PI-01 ExposureByClass ships as a self-contained pure-CSS widget: a segmented gross-composition bar + GROSS/NET/LONG/SHORT KPI strip surfacing D-P2 signed math + a per-slice drilldown table, with verbatim honest-empty copy and DESIGN.md's no-red/green-on-direction lock — bound type-only to the frozen Phase-98 read.**

## Performance

- **Duration:** ~12 min
- **Tasks:** 2/2
- **Files created:** 2

## Accomplishments

- **Task 1 — KPI strip, composition bar, legend, honest-empty** (test `3d31b8ed` → feat `4ee787c1`):
  - KPI strip (`grid grid-cols-2 sm:grid-cols-4`) GROSS/NET/LONG/SHORT with D-P2 derivations: GROSS = totalGrossUsd, NET = totalNetUsd (sign in the number), LONG = Σ signed>0, SHORT = Σ |signed<0|. Muted caption "net long / net short / flat". No color on direction.
  - Segmented CSS composition bar (`h-3 bg-track`), one segment per PRESENT class, width = class gross share; spot = CHART_ACCENT `#1B6B5A`, derivative = local `#0F172A` navy, 1px white seam. `role="img"` + 1-decimal aria-label.
  - Legend ALWAYS lists both classes; a single-class book renders one full-width segment and the absent class reads `Derivatives · —` (muted) — no misleading full circle.
  - Honest-empty (`snapshot === null`): the AttributionBar empty-card idiom with the two verbatim copy lines and no Card/KPI strip.
- **Task 2 — per-slice drilldown table** (test `b5bbe07d` → feat `ad74b584`):
  - Real `<table>`, CompositionDonut idiom, columns Venue/Symbol/Type/Side/Gross/Net, slices sorted by valueUsd desc.
  - Type = Spot/Deriv + class swatch (identity by label+swatch, not color; WCAG 1.4.1); Side lowercase muted; Net = signedValueUsd via formatCurrency (short row `-$100K`, no color); `max-h-64 overflow-y-auto` only past 12 slices.

## Test Evidence (TDD RED → GREEN)

- Task 1: RED = module-not-found before implementation; GREEN = 8/8 pass.
- Task 2: RED = 3 failing table specs (8 passed | 3 failed); GREEN = 11/11 pass.
- `npx vitest run "src/app/(dashboard)/allocations/widgets/positions/ExposureByClass.test.tsx" --no-file-parallelism` → **11 passed**.
- `npx tsc --noEmit` → **exit 0** (clean).
- `npx eslint <widget> <test>` → **exit 0** (clean).

## Acceptance Grep Gates (all pass)

| Gate | Expected | Actual |
|------|----------|--------|
| `grep -c recharts` | 0 | 0 |
| value-import of `@/lib/portfolio-exposure` | 0 | 0 (type-only) |
| `createAdminClient\|allocator_holdings\|@/lib/supabase` | 0 | 0 |
| `text-\[[0-9]+px\]` raw px | 0 | 0 |
| `text-positive\|text-negative\|#15803D\|#DC2626` | 0 | 0 |
| widget min_lines 120 | ≥120 | 195 |

## Deviations from Plan

None — plan executed exactly as written. Advisory #1 (upstream `flat`→LONG signed behavior) intentionally NOT touched: bound the frozen read contract as-is.

## Known Stubs

None. The widget is complete as a testable unit; mounting into `HoldingsTabPanel` is Plan 04's scope (per the plan objective), not a stub.

## Threat Flags

None. No new security surface — the widget consumes a secretless six-column projection prop; the data-contract import is type-only (T-99-01 mitigated), no Supabase/admin client crosses into the client bundle.

## Self-Check: PASSED

- Files verified on disk: `ExposureByClass.tsx`, `ExposureByClass.test.tsx`, `99-01-SUMMARY.md`.
- Commits verified in git log: `3d31b8ed`, `4ee787c1`, `b5bbe07d`, `ad74b584`.
