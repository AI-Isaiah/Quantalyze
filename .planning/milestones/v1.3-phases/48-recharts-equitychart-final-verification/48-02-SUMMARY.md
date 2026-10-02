---
phase: 48-recharts-equitychart-final-verification
plan: 02
subsystem: ui
tags: [recharts, charts, touch, mobile, tooltip, breakpoint, a11y, coverage]

# Dependency graph
requires:
  - phase: 48-01
    provides: "TouchTooltip breakpoint-gated <Tooltip trigger> shim (src/components/charts/TouchTooltip.tsx) + its test"
  - phase: 47
    provides: "useTapPin / useBreakpoint primitives + the CHART-01a/CHART-01b split convention"
provides:
  - "All 18 tooltip-bearing Recharts charts render their tooltip via TouchTooltip (mobile→tap-to-pin, desktop→hover byte-identical)"
  - "Desktop byte-identity asserted for the LineChart (RollingMetrics) and PieChart/Cell (CompositionDonut) families"
  - "OutcomesWidget sparkline left parity-only (no invented tap-reveal); EquityChart left for plan 03"
affects: [48-03, 48-04, 48-05, EquityChart, HUMAN-UAT]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "One-token <Tooltip>→<TouchTooltip> swap + drop Tooltip from recharts import; chart-root accessibilityLayer={false} kept literal (Pitfall 5)"
    - "Desktop-byte-identity test = surface the injected `trigger` on the recharts Tooltip mock + assert default-desktop render resolves to trigger=\"hover\" (not \"click\")"

key-files:
  created:
    - .planning/phases/48-recharts-equitychart-final-verification/deferred-items.md
  modified:
    - src/components/charts/RollingMetrics.tsx
    - src/components/charts/CorrelationWithBenchmark.tsx
    - src/components/charts/DrawdownChart.tsx
    - src/components/charts/NetGrossExposureChart.tsx
    - src/components/charts/ReturnHistogram.tsx
    - src/components/charts/RollingAlphaBetaChart.tsx
    - src/components/charts/RollingSortinoChart.tsx
    - src/components/charts/RollingVolatilityChart.tsx
    - src/components/charts/TurnoverChart.tsx
    - src/components/charts/YearlyReturns.tsx
    - src/components/portfolio/AttributionBar.tsx
    - src/components/portfolio/CompositionDonut.tsx
    - src/components/portfolio/RiskAttribution.tsx
    - src/components/strategy/CompareEquityOverlay.tsx
    - "src/app/(dashboard)/allocations/widgets/attribution/AlphaBetaDecomposition.tsx"
    - "src/app/(dashboard)/allocations/widgets/performance/DrawdownChart.tsx"
    - "src/app/(dashboard)/allocations/widgets/risk/RiskDecomposition.tsx"
    - "src/app/(dashboard)/allocations/widgets/risk/TailRisk.tsx"
    - src/components/charts/RollingMetrics.test.tsx
    - src/components/portfolio/CompositionDonut.test.tsx

key-decisions:
  - "Relative ./TouchTooltip import for the src/components/charts/* siblings (matches their existing import style); @/components/charts/TouchTooltip alias for portfolio/, strategy/, and app/.../widgets/* files."
  - "CompositionDonut.test.tsx gained a recharts passthrough mock (table + SyncBadge render outside the chart, so the B14 specs are unaffected) to make the injected trigger observable in jsdom."
  - "useBreakpoint left UN-mocked in both extended test files — the real SSR-safe hook resolves to \"desktop\" on the all-false jsdom snapshot, which IS the desktop-byte-identity condition under test."

patterns-established:
  - "Recharts touch parity = drop-in shim swap; zero new gesture machinery, zero chart-root edits, all formatter/contentStyle props spread verbatim."
  - "Desktop-arm coverage lives in ONE representative test per family (Line + Pie), not per-chart; the trigger-ternary branch coverage is already owned by TouchTooltip.test.tsx (plan 01)."

requirements-completed: [CHART-01b]

# Metrics
duration: 11min
completed: 2026-06-28
---

# Phase 48 Plan 02: Recharts Touch Parity (TouchTooltip swap) Summary

**All 18 tooltip-bearing Recharts charts now render their tooltip through the breakpoint-gated TouchTooltip shim (mobile tap-to-pin via `trigger="click"`, desktop byte-identical via the default `trigger="hover"`); OutcomesWidget and EquityChart deliberately untouched.**

## Performance

- **Duration:** 11 min
- **Started:** 2026-06-28T09:38:29Z
- **Completed:** 2026-06-28T09:50:00Z
- **Tasks:** 3
- **Files modified:** 20 (18 charts + 2 tests); 1 doc created (deferred-items.md)

## Accomplishments
- Swapped `<Tooltip>` → `<TouchTooltip>` across all 18 in-scope Recharts charts (14 in `src/components/*`, 4 in `app/(dashboard)/allocations/widgets/*`), dropping the now-unused `Tooltip` from each recharts import and spreading every existing `formatter`/`contentStyle` prop verbatim.
- Kept every chart-root tag's literal `accessibilityLayer={false}` — the whole-codebase grep guard (`tests/visual/chart-accessibility-layer.test.ts`) stays green; no props spread onto any chart root.
- Confirmed `OutcomesWidget` (tooltip-less sparkline) and `EquityChart` (plan-03-owned) are byte-for-byte untouched across the entire plan.
- Added one desktop-byte-identity assertion to the LineChart family (RollingMetrics) and one to the PieChart/Cell family (CompositionDonut), each proving the default-desktop render resolves to `trigger="hover"` (Assumption A1).
- Coverage ratchet held with all four thresholds clear (exit 0).

## Task Commits

Each task was committed atomically:

1. **Task 1: Swap the 14 src/components Recharts charts** - `263d98cc` (feat)
2. **Task 2: Swap the 4 allocations widget Recharts charts + verify OutcomesWidget parity-only** - `18a09084` (feat)
3. **Task 3: Extend per-chart desktop-byte-identity coverage + run full coverage ratchet** - `838cb3a5` (test)

## Files Created/Modified

**14 charts (Task 1):** `RollingMetrics`, `CorrelationWithBenchmark`, `DrawdownChart`, `NetGrossExposureChart`, `ReturnHistogram`, `RollingAlphaBetaChart`, `RollingSortinoChart`, `RollingVolatilityChart`, `TurnoverChart`, `YearlyReturns` (all `src/components/charts/*`), plus `portfolio/AttributionBar`, `portfolio/CompositionDonut`, `portfolio/RiskAttribution`, `strategy/CompareEquityOverlay` — each: `<Tooltip>` → `<TouchTooltip>` + import line, `Tooltip` dropped from recharts import.

**4 widget charts (Task 2):** `attribution/AlphaBetaDecomposition` (BarChart), `performance/DrawdownChart` (AreaChart), `risk/RiskDecomposition` (BarChart+Cell), `risk/TailRisk` (BarChart) — same swap shape.

**2 tests (Task 3):**
- `src/components/charts/RollingMetrics.test.tsx` — recharts `Tooltip` mock now surfaces `data-trigger`; new `describe("...desktop byte-identity...")` asserts `trigger="hover"` on the default desktop viewport.
- `src/components/portfolio/CompositionDonut.test.tsx` — added a recharts passthrough mock (B14 table/SyncBadge specs unaffected) + same desktop `trigger="hover"` assertion for the Pie/Cell family.

**Doc:** `deferred-items.md` (out-of-scope discovery log; see Issues Encountered).

## Coverage (recorded actuals — Task 3 acceptance)

`npm run test:coverage` exited **0**. All four thresholds held (no threshold lowered, no snapshot blanket-updated):

| Metric     | Actual | Threshold |
|------------|--------|-----------|
| Lines      | 84.98% | 82        |
| Statements | 82.82% | 80        |
| Functions  | 78.70% | 74        |
| Branches   | 75.45% | 72        |

The `trigger` ternary's branch coverage is owned by `TouchTooltip.test.tsx` (plan 01); the swap added no new uncovered branches in the 18 charts.

## Decisions Made
- **Import style per location:** relative `./TouchTooltip` for the `src/components/charts/*` siblings (matches their existing `./chart-tokens` style); `@/components/charts/TouchTooltip` alias for `portfolio/`, `strategy/`, and `app/.../widgets/*` files.
- **CompositionDonut test mock:** added a recharts passthrough mock so the injected `trigger` is observable in jsdom (the real Tooltip never mounts at zero geometry). The constituent table + SyncBadges render outside `ResponsiveContainer`, so the existing B14 freshness specs are unaffected.
- **`useBreakpoint` left un-mocked in both extended tests:** the real SSR-safe hook resolves to `"desktop"` on the all-false jsdom media-query snapshot — that IS the desktop-byte-identity condition, so the test exercises the real shim path rather than a mocked one.

## Deviations from Plan

None — plan executed exactly as written. All three tasks completed as specified; OutcomesWidget and EquityChart untouched as required; no architectural changes; no auto-fixes needed within the 20 modified files (all tsc-clean, all tests green).

## Issues Encountered

**Pre-existing TS error in a Wave-0 file (logged, not fixed — out of scope).**
A final `npx tsc --noEmit` sweep surfaced one error: `src/components/charts/TouchTooltip.test.tsx(90,9): TS2322` — the test's `formatter={(v: number) => ...}` is narrower than Recharts' `Formatter<ValueType, NameType>` (whose `value` is `ValueType | undefined`). This file was introduced in plan 48-01 (`f3dc7858`) and is byte-identical between the last 48-01 commit (`7dc038a0`) and the end of 48-02 — this plan never touched it. All 20 files THIS plan modified are tsc-clean. Vitest transpiles via esbuild (type-stripping), so all 95 chart tests pass regardless. Logged to `48-recharts-equitychart-final-verification/deferred-items.md` with a one-line suggested fix (widen the test formatter signature) for a 48-01 follow-up or 48-03. Confirm whether a CI `tsc` job gates branch protection before landing the phase (CLAUDE.md names `frontend-coverage` as the blocking gate, which is green).

## User Setup Required
None — no external service configuration required.

## Next Phase Readiness
- Recharts touch parity (CHART-01b, Recharts half) complete: 18 charts swapped, desktop byte-identity proven, accessibilityLayer grep + frozen-spine guards green.
- **Plan 48-03** owns `EquityChart` (hand-rolled SVG touch tuning via `useTapPin`) — left untouched here as required.
- One carry-forward: the 48-01 `TouchTooltip.test.tsx` TS2322 (see Issues / deferred-items.md) should be cleared before any `tsc`-gated land.

## Self-Check: PASSED
- Files: FOUND src/components/charts/RollingMetrics.tsx, src/components/portfolio/CompositionDonut.tsx, RollingMetrics.test.tsx, CompositionDonut.test.tsx
- Commits: FOUND 263d98cc, 18a09084, 838cb3a5

---
*Phase: 48-recharts-equitychart-final-verification*
*Completed: 2026-06-28*
