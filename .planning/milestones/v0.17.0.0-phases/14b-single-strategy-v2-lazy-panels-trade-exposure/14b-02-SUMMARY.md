---
phase: 14b
plan: 02
subsystem: strategy-v2-panel-4-returns-distribution
tags:
  - strategy-v2
  - panel-4
  - returns-distribution
  - design-01-audit
  - kpi-06
  - kpi-23b
  - grok-w-01
requirements:
  - KPI-06
  - KPI-23b
requirements_addressed:
  - KPI-06
  - KPI-23b
dependency_graph:
  requires:
    - "src/hooks/useLazyPanelMetrics.ts (Phase 14b-01 — fetchOnIntersect=true real-fetch path)"
    - "src/components/charts/DailyHeatmap.tsx (Phase 14b-01 — dual SVG/Canvas renderer; now memo(DailyHeatmapInner))"
    - "src/components/charts/chart-tokens.ts (CHART_ACCENT, CHART_TICK_STYLE, CHART_FONT_MONO, CHART_TEXT_MUTED, CHART_BORDER, CHART_AXIS_TICK)"
    - "src/components/strategy-v2/PartialDataBanner.tsx (14a — reused as-is)"
  provides:
    - "src/components/strategy-v2/ReturnsDistributionPanel.tsx — Panel 4 wrapper (lazy fetch + 5 sub-charts + partial-data routing + Grok W-01 useMemo)"
    - "src/components/charts/ReturnHistogram.tsx — DESIGN-01 identity (#16A34A bars, CHART_TICK_STYLE axes, benchmarkReturns overlay prop)"
    - "src/components/charts/YearlyReturns.tsx — DESIGN-01 identity (#16A34A bars, CHART_TICK_STYLE axes)"
    - "src/components/charts/ReturnQuantiles.tsx — DESIGN-01 identity (#1B6B5A box+median, #94A3B8 whisker strokes via CHART_TEXT_MUTED token, CHART_FONT_MONO axis text)"
    - "src/components/charts/MonthlyHeatmap.tsx — DESIGN-01 identity (#16A34A / #DC2626 explicit hex with opacity scale, font-normal type contract)"
    - "src/components/charts/DailyHeatmap.tsx — Grok W-01 React.memo wrap rename to memo(DailyHeatmapInner)"
  affects:
    - "src/components/strategy-v2/StrategyV2Shell.tsx — NOT yet — wiring lands in 14b-06 (verified import absent)"
tech-stack:
  added: []
  patterns:
    - "useMemo dependency on object-identity key (data?.daily_returns_grid) for stable downstream prop reference (Grok W-01)"
    - "React.memo + useMemo pairing — memo on the leaf component, useMemo on the consumer's data prop, default shallow-compare contract"
    - "Inline-style hex + opacity scale in MonthlyHeatmap (replacing Tailwind palette) for canonical DESIGN.md positive/negative tokens"
key-files:
  created:
    - "src/components/strategy-v2/ReturnsDistributionPanel.tsx (Panel 4 wrapper, ~150 LOC)"
    - "src/components/strategy-v2/ReturnsDistributionPanel.test.tsx (12 cases)"
    - "src/components/charts/ReturnHistogram.test.tsx (4 DESIGN-01 cases)"
    - "src/components/charts/YearlyReturns.test.tsx (2 DESIGN-01 cases)"
    - "src/components/charts/ReturnQuantiles.test.tsx (2 DESIGN-01 cases)"
    - "src/components/charts/MonthlyHeatmap.test.tsx (2 DESIGN-01 cases)"
    - ".planning/phases/14b-single-strategy-v2-lazy-panels-trade-exposure/deferred-items.md (out-of-scope discovery log)"
  modified:
    - "src/components/charts/ReturnHistogram.tsx (DESIGN-01 + benchmarkReturns prop)"
    - "src/components/charts/YearlyReturns.tsx (DESIGN-01)"
    - "src/components/charts/ReturnQuantiles.tsx (DESIGN-01)"
    - "src/components/charts/MonthlyHeatmap.tsx (DESIGN-01 + type-contract)"
    - "src/components/charts/DailyHeatmap.tsx (Grok W-01 — rename inner to DailyHeatmapInner; export const = memo(DailyHeatmapInner))"
    - "src/components/charts/DailyHeatmap.test.tsx (added Tests 15+16 for memo behavior)"
decisions:
  - "DailyHeatmap memo wrap form: rename inner to `DailyHeatmapInner` and export `memo(DailyHeatmapInner)` per plan grep contract — preserves byte-identical export shape and React.memo's default shallow-compare contract."
  - "ReturnQuantiles whisker strokes use `stroke={CHART_TEXT_MUTED}` (#94A3B8). UI-SPEC §5 explicitly carves out strokes from the A11Y-01 forbidden-as-text rule (which scopes to `fill: \"#94A3B8\"` text-fill literals). Verified by chart-contrast.test.ts passing on the new file."
  - "MonthlyHeatmap inline-style hex (DESIGN.md positive/negative tokens) replaces Tailwind `bg-emerald-*`/`bg-red-*` palette — explicit hex + opacity matches the DailyHeatmap 9-step diverging scale 1:1 for visual continuity across Panel 4."
  - "Error-state copy uses curly apostrophe `Couldn’t` (U+2019) per UI-SPEC §7 typography contract."
  - "Loading copy uses Unicode ellipsis `Loading…` (U+2026) — matches LazyPanelPlaceholder precedent."
  - "MonthlyReturnsBar.tsx (v1 component, separate consumer) NOT touched — out-of-scope; logged to phase deferred-items.md for a future v1 chart sweep."
metrics:
  duration_minutes: 7
  completed_date: "2026-04-29"
  task_count: 2
  test_count: 22
  file_count: 13
---

# Phase 14b Plan 02: Panel 4 Returns Distribution + DESIGN-01 chart audit Summary

Wave-2 close-out for Phase 14b: shipped the `ReturnsDistributionPanel` wrapper that lazy-fetches `daily_returns_grid` via `useLazyPanelMetrics<Panel4LazyPayload>("panel4", { fetchOnIntersect: true })` and mounts five sub-charts (MonthlyHeatmap / DailyHeatmap / ReturnHistogram / ReturnQuantiles / YearlyReturns) with full panel-level + sub-section partial-data routing per UI-SPEC §4.3. Closed the DESIGN-01 chart-color audit on the four pre-existing chart components (#0D9488 → #1B6B5A; #059669 → #16A34A; `bg-emerald-*` / `bg-red-*` Tailwind palette → explicit hex + opacity; inline tick objects → CHART_TICK_STYLE; literal `'JetBrains Mono', monospace` → CHART_FONT_MONO token). Applied Grok W-01 mitigation: rename DailyHeatmap inner to `DailyHeatmapInner` + export `memo(DailyHeatmapInner)` per grep contract, paired with `useMemo`-stabilized `data` prop in the consumer so Panel 4 status transitions never re-paint the Canvas.

## ReturnsDistributionPanel Contract

```typescript
interface ReturnsDistributionPanelProps {
  strategyId: string;
  history_days: number;
  monthly_returns: Record<string, Record<string, number>> | null;
  return_quantiles: Record<string, number[]> | null;
  returns_series: { date: string; value: number }[] | null;
  benchmark_returns?: { date: string; value: number }[] | null;
}

interface Panel4LazyPayload {
  daily_returns_grid?: { date: string; value: number }[];
}
```

Panel marker: `<section data-panel="returns-distribution" data-panel-status={"placeholder"|"loading"|"ready"|"error"} aria-label="Returns distribution">`.

### State machine

| Status        | Body                                                                                  |
| ------------- | ------------------------------------------------------------------------------------- |
| `placeholder` (idle) | H2 + `Loading…` (Unicode U+2026) under `aria-live="polite"`                  |
| `loading`     | Same Loading state (status not yet ready)                                             |
| `ready`       | All 5 sub-sections (full or sub-banner per individual gate)                           |
| `error`       | PartialDataBanner: `Couldn’t load this section` / `Refresh the page to retry…`        |

### Partial-data routing (UI-SPEC §4.3)

| Gate                                          | Trigger                                       | Replacement                                                              |
| --------------------------------------------- | --------------------------------------------- | ------------------------------------------------------------------------ |
| Panel-level                                   | `history_days < 30`                           | `PartialDataBanner` heading "Awaiting more data"; all 5 sub-charts hidden |
| Sub-DailyHeatmap                              | `daily_returns_grid` empty/absent             | `Daily heatmap activates after 30 days of trading history.`              |
| Sub-YearlyReturns                             | `history_days < 365`                          | `Yearly returns activates after 1 year of trading history.`              |

### Grok W-01 mitigation (verbatim from plan)

The hook payload's `daily_returns_grid` reference is captured into a `useMemo` whose dependency is `data?.daily_returns_grid`:

```typescript
const dailyReturnsData = useMemo(
  () => data?.daily_returns_grid ?? [],
  [data?.daily_returns_grid],
);
```

Without this, parent re-renders during status transitions (idle → loading → ready) would create fresh array references on each render, defeating React.memo's shallow-compare on `<DailyHeatmap data={...} />` and re-triggering its Canvas `useEffect` paint. With both pieces in place (`memo` on the leaf + `useMemo` on the consumer), the 5y / 1825-cell paint runs exactly once across the lifecycle. Verified by `DailyHeatmap.test.tsx` Test 15 (parent re-renders with stable data ref → fillRect spy stays at one full paint) and `ReturnsDistributionPanel.test.tsx` Test 12 (re-renders with same hook return → DailyHeatmap receives the same data prop reference).

## DESIGN-01 Identity Audit — chart-component edits

| File                | Before                                                       | After                                                       |
| ------------------- | ------------------------------------------------------------ | ----------------------------------------------------------- |
| `ReturnHistogram.tsx` | `fill="#059669"`; `tick={{ fontSize: 10/11, fill: "#64748B" }}`; no benchmark prop | `fill="#16A34A"`; `tick={CHART_TICK_STYLE}`; new `benchmarkReturns` prop renders second translucent grey overlay (CHART_TEXT_MUTED @ 0.4 opacity, dataKey `benchmarkCount`, ≥10-point gate) |
| `YearlyReturns.tsx` | `fill="#059669"`; inline `tick` literals; legacy `'JetBrains Mono', monospace` | `fill="#16A34A"`; `tick={CHART_TICK_STYLE}`; CHART_BORDER axisLine |
| `ReturnQuantiles.tsx` | `fill/stroke="#0D9488"` (3x); whisker `stroke="#94A3B8"`; `fontFamily="'JetBrains Mono', monospace"` | `fill/stroke={CHART_ACCENT}` (#1B6B5A); whisker `stroke={CHART_TEXT_MUTED}`; `fontFamily={CHART_FONT_MONO}` |
| `MonthlyHeatmap.tsx` | Tailwind `bg-emerald-*`/`bg-red-*` palette; `font-medium` (3x); `font-metric` | Inline `style={{ backgroundColor: "#16A34A"\|"#DC2626", opacity: 0.15..1.0, color: ... }}`; `font-normal` everywhere; `tabular-nums` on numeric cells |
| `DailyHeatmap.tsx` | `export const DailyHeatmap = memo(function DailyHeatmap(...))` | `function DailyHeatmapInner(...)` + `export const DailyHeatmap = memo(DailyHeatmapInner)` (grep contract for Grok W-01) |

## Test Coverage

22 new test cases across 6 files (5 new + 1 extended), all green:

| File                                                              | Cases | Focus                                              |
| ----------------------------------------------------------------- | ----- | -------------------------------------------------- |
| `src/components/charts/ReturnHistogram.test.tsx`                   | 4     | DESIGN-01 + benchmarkReturns overlay               |
| `src/components/charts/YearlyReturns.test.tsx`                     | 2     | DESIGN-01                                          |
| `src/components/charts/ReturnQuantiles.test.tsx`                   | 2     | DESIGN-01 (box/median accent + whisker stroke)     |
| `src/components/charts/MonthlyHeatmap.test.tsx`                    | 2     | DESIGN-01 + font-medium absence                    |
| `src/components/charts/DailyHeatmap.test.tsx` (Tests 15+16)        | 2     | Grok W-01 memo behavior (stable ref + identity change) |
| `src/components/strategy-v2/ReturnsDistributionPanel.test.tsx`     | 12    | Chrome / state machine / partial-data / W-01 invariant |

## Verification

- `npm test -- src/components/charts --run` → 57/57 pass (8 files)
- `npm test -- src/components/strategy-v2/ReturnsDistributionPanel.test.tsx --run` → 12/12 pass
- `npm test -- src/components --run` → 449/449 pass (51 files, zero regressions)
- `npm test -- tests/a11y/chart-contrast.test.ts tests/visual/strategy-v2-type-scale.test.ts tests/visual/strategy-v2-panel-count.test.tsx --run` → 7/7 pass
- `npx tsc --noEmit` → exit 0
- `npm run build` → exit 0 (Turbopack)

### Done-criteria greps (all pass)

```
#0D9488                     src/components/charts/ReturnQuantiles.tsx          0
#059669                     src/components/charts/{4 plan files}.tsx           0 (each)
bg-(emerald|red)-N          src/components/charts/MonthlyHeatmap.tsx           0
font-medium                 src/components/charts/MonthlyHeatmap.tsx           0
tick={{...fontSize          src/components/charts/{ReturnHistogram,YearlyReturns}.tsx 0 (each)
memo(DailyHeatmapInner)     src/components/charts/DailyHeatmap.tsx             1
data-panel=returns-distrib  src/components/strategy-v2/ReturnsDistributionPanel.tsx 1
useLazyPanelMetrics<Panel4LazyPayload>("panel4"  same                          2 (declaration + call)
fetchOnIntersect: true      same                                               1
font-medium|text-sm|text-xl|text-2xl  same                                     0
useMemo                     same                                               3
daily_returns_grid          same                                               7 (interface + useMemo + assertions)
```

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] `#059669` and `#0D9488` references in JSDoc comments would fail recursive `grep -c` done-criteria**

- **Found during:** Task 1 verification grep
- **Issue:** Initial JSDoc comments documenting the legacy → new mapping included literal `#059669` / `#0D9488`. The plan's done-criteria reads `grep -c "#059669" src/components/charts/` recursive returns 0; literal hex in JSDoc would fail.
- **Fix:** Rephrased JSDoc to "replaced legacy emerald-600" / "replaced legacy teal" without the literal hex. Functional behavior unchanged.
- **Files modified:** `src/components/charts/ReturnHistogram.tsx`, `src/components/charts/YearlyReturns.tsx`, `src/components/charts/ReturnQuantiles.tsx`
- **Commit:** 5c35bad

**2. [Rule 1 - Scope boundary discovery] `#059669` literal in `MonthlyReturnsBar.tsx` (out-of-scope file)**

- **Found during:** Task 1 done-criteria grep
- **Issue:** `src/components/charts/MonthlyReturnsBar.tsx:39` carries `fill={entry.value >= 0 ? "#059669" : "#DC2626"}` — same legacy color the plan eliminates from the four Panel-4 charts. Component is consumed by `src/components/strategy/PerformanceReport.tsx` (v1 strategy detail page).
- **Resolution:** NOT touched per plan `files_modified` scope. Logged to `.planning/phases/14b-single-strategy-v2-lazy-panels-trade-exposure/deferred-items.md` for a dedicated v1 chart sweep after the v2 cutover (post 14b-06).
- **Reasoning:** Plan-listed files are the only Panel-4 surface; touching v1-only consumers would expand the change surface beyond the plan boundary.

### Informational notes

- The plan's <action> for `DailyHeatmap.tsx` Step 1 says to add `memo` to React imports. The file already imported `memo` in 14b-01 (the export was already memoized as `memo(function DailyHeatmap(...))`). The 14b-02 change is purely a rename: function literal → named function `DailyHeatmapInner` + separate `export const = memo(DailyHeatmapInner)` to satisfy the Grok W-01 grep contract. No behavior change, no new import.
- Grok W-01 grep criterion "`grep -c "memo(DailyHeatmapInner)"` returns 1" was the load-bearing constraint that drove this rename — without it the existing memoization would have satisfied the runtime contract but failed the static-grep verifier.
- Test 15 (DailyHeatmap memo) uses a `Parent({ tick, data })` wrapper that re-renders the parent without changing the data reference; the inner DailyHeatmapInner is skipped by React.memo's shallow-compare and the fillRect spy stays at the first-paint count. This is the actual runtime proof of W-01, not just a grep contract.
- ReturnHistogram's new `benchmarkReturns` prop wires the UI-SPEC §3.1 benchmark overlay. The bins share the strategy series' min/max/binWidth so the overlay aligns by construction. Gate is `≥ 10` benchmark points (mirrors the strategy-series gate).

## Authentication Gates

None — no production secrets or auth flows touched in this plan.

## Self-Check

- `src/components/strategy-v2/ReturnsDistributionPanel.tsx` exists with `data-panel="returns-distribution"` + `useLazyPanelMetrics<Panel4LazyPayload>("panel4"` + `useMemo` for `daily_returns_grid` — verified
- `src/components/strategy-v2/ReturnsDistributionPanel.test.tsx` exists with 12 cases — verified
- `src/components/charts/{ReturnHistogram,YearlyReturns,ReturnQuantiles,MonthlyHeatmap}.test.tsx` exist as new files — verified
- `src/components/charts/DailyHeatmap.tsx` contains `memo(DailyHeatmapInner)` and `export const DailyHeatmap = memo` — verified
- `src/components/charts/{ReturnHistogram,YearlyReturns,ReturnQuantiles,MonthlyHeatmap,DailyHeatmap}.tsx` contain zero `#0D9488` / `#059669` literals (in plan-listed files) — verified
- `src/components/strategy-v2/StrategyV2Shell.tsx` does NOT yet import ReturnsDistributionPanel (correct — that wiring lands in 14b-06) — verified
- Commits `5c35bad` and `f2d41e2` exist on `main` — verified

## Self-Check: PASSED
