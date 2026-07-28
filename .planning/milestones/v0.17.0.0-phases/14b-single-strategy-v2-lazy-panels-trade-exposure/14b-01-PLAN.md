---
phase: 14b
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - src/hooks/useLazyPanelMetrics.ts
  - src/hooks/useLazyPanelMetrics.test.ts
  - src/components/charts/DailyHeatmap.tsx
  - src/components/charts/DailyHeatmap.test.tsx
autonomous: true
requirements: [KPI-07]
requirements_addressed: [KPI-07]
tags: [strategy-v2, lazy-fetch, daily-heatmap, foundation, intersection-observer, canvas, svg]
must_haves:
  truths:
    - "useLazyPanelMetrics fetches real lazy-metrics on first intersection when fetchOnIntersect=true"
    - "DailyHeatmap renders SVG branch when data.length <= 365 cells"
    - "DailyHeatmap renders Canvas branch when data.length > 365 cells (5y fixture)"
    - "DailyHeatmap Canvas branch carries an offscreen <table> mirror for screen readers"
    - "DailyHeatmap 9-step diverging color scale anchored at 0 honours #16A34A / #DC2626 (NOT #059669, NOT bg-emerald-* tailwind)"
    - "useLazyPanelMetrics emits data-panel-status lifecycle: idle/placeholder -> loading -> ready -> error"
    - "Observer cleanup runs on unmount (Grok I-01: prevent observer leak across rapid navigation)"
    - "Canvas geometry fits within 730×canvas.height for 5y fixture (Grok B-02: 2px-wide cells, year-row layout)"
  artifacts:
    - path: "src/hooks/useLazyPanelMetrics.ts"
      provides: "Extended hook — fetchOnIntersect=true wires fetchStrategyLazyMetrics with status transitions and error capture"
      contains: "fetchStrategyLazyMetrics"
    - path: "src/components/charts/DailyHeatmap.tsx"
      provides: "Dual SVG/Canvas DailyHeatmap component with 365-cell threshold"
      exports: ["DailyHeatmap", "SVG_THRESHOLD_CELLS"]
    - path: "src/hooks/useLazyPanelMetrics.test.ts"
      provides: "Vitest coverage of fetch path + error path + idle->ready transition + cleanup-on-unmount"
    - path: "src/components/charts/DailyHeatmap.test.tsx"
      provides: "Vitest coverage of SVG branch / Canvas branch / 9-step color scale / aria mirror / Canvas geometry no-overflow"
  key_links:
    - from: "src/hooks/useLazyPanelMetrics.ts"
      to: "src/lib/queries.ts:fetchStrategyLazyMetrics"
      via: "import + invocation inside IntersectionObserver callback"
      pattern: "fetchStrategyLazyMetrics\\("
    - from: "src/components/charts/DailyHeatmap.tsx"
      to: "src/components/charts/chart-tokens.ts"
      via: "import CHART_BORDER, CHART_AXIS_TICK, CHART_FONT_MONO"
      pattern: "from \"\\./chart-tokens\""
---

<objective>
Wave-1 foundation for all of Phase 14b: (a) extend `useLazyPanelMetrics` to actually call `fetchStrategyLazyMetrics` on first intersection when `fetchOnIntersect=true`, with full status lifecycle (idle → loading → ready/error) plus typed `data: T | null` exposure; (b) ship the `DailyHeatmap` component with an SVG renderer for ≤365 cells and a Canvas renderer for >365 cells (Pitfall 4 mitigation, KPI-07). Wave-2 panel-body plans (14b-02..05) all depend on this plan; without (a) the panels never receive data, without (b) Panel 4 cannot ship the daily-heatmap sub-section.

Purpose: D-XX KPI-07 + lazy-fetch foundation. Establishes the contract every Wave-2 plan reads.
Output: Two production files (hook extension + DailyHeatmap component) + two co-located test files. No StrategyV2Shell change yet — that lands in 14b-06.

**Revision (2026-04-29 Grok review):** Canvas geometry fixed for B-02 (5y fixture overflow), observer cleanup explicitly preserved for I-01.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/PROJECT.md
@.planning/STATE.md
@.planning/phases/14b-single-strategy-v2-lazy-panels-trade-exposure/14B-CONTEXT.md
@.planning/phases/14b-single-strategy-v2-lazy-panels-trade-exposure/14B-UI-SPEC.md
@.planning/phases/14a-single-strategy-v2-eager-panels-identity/14A-UI-SPEC.md
@DESIGN.md
@AGENTS.md
@src/hooks/useLazyPanelMetrics.ts
@src/lib/queries.ts
@src/lib/types.ts
@src/components/charts/chart-tokens.ts
@src/components/charts/MonthlyHeatmap.tsx
@src/test-setup.ts

<interfaces>
<!-- Critical contracts. Executor uses these directly — no codebase exploration. -->

From src/lib/queries.ts (Phase 12 — DO NOT MODIFY):

```typescript
export type LazyMetricsPanelId =
  | "overview" | "equity" | "drawdown"
  | "returns_dist" | "rolling" | "trades" | "exposure";

export async function fetchStrategyLazyMetrics(
  strategyId: string,
  panelId: LazyMetricsPanelId,
): Promise<LazyMetricsPayload>;
```

From src/lib/types.ts (Phase 12 — DO NOT MODIFY):

```typescript
export type StrategyAnalyticsSeriesKind =
  | "daily_returns_grid"
  | "rolling_sortino_3m" | "rolling_sortino_6m" | "rolling_sortino_12m"
  | "rolling_volatility_3m" | "rolling_volatility_6m" | "rolling_volatility_12m"
  | "rolling_alpha" | "rolling_beta"
  | "exposure_series" | "turnover_series" | "log_returns_series";

export type LazyMetricsPayload =
  | Record<StrategyAnalyticsSeriesKind, unknown>
  | Record<string, never>;
```

From src/hooks/useLazyPanelMetrics.ts (Phase 14a — TO BE EXTENDED):

```typescript
export type LazyStatus = "idle" | "loading" | "error" | "ready";
export type LazyPanelId = "panel4" | "panel5" | "panel6" | "panel7";

export interface UseLazyPanelMetricsOptions {
  rootMargin?: string;
  fetchOnIntersect?: boolean;
}

export function useLazyPanelMetrics<T = unknown>(
  panelId: LazyPanelId,
  opts: UseLazyPanelMetricsOptions = {},
): { ref: (node: HTMLElement | null) => void; data: T | null; status: LazyStatus };
```

The Phase-14b extension MUST add a `strategyId: string` option to `UseLazyPanelMetricsOptions` (required when `fetchOnIntersect=true`) WITHOUT breaking the existing 14a callers (LazyPanelPlaceholder.tsx invokes with `useLazyPanelMetrics(panelId)` — no opts). Default `fetchOnIntersect=false` preserves Phase 14a placeholder semantics.

Panel-id mapping (LazyPanelId → LazyMetricsPanelId), per migration 087 SQL CASE:

```typescript
const PANEL_TO_ID: Record<LazyPanelId, LazyMetricsPanelId> = {
  panel4: "returns_dist",
  panel5: "rolling",
  panel6: "trades",
  panel7: "exposure",
};
```

Note (clarification per Grok B-03 review): The `"equity"` LazyMetricsPanelId is intentionally NOT in PANEL_TO_ID. Migration 087 maps `'equity' → ARRAY['log_returns_series']` and Phase 14b uses this kind via a DIRECT call to `fetchStrategyLazyMetrics(strategyId, 'equity')` from inside `HeadlineMetricsPanel` (Plan 14b-06 Task 3, option (b)) — NOT via the IntersectionObserver hook. Panel 2 is eager-mounted, so no observer is needed. PANEL_TO_ID stays panel4..panel7 only.

From src/components/charts/chart-tokens.ts (DO NOT MODIFY):

```typescript
export const CHART_BORDER = "#E2E8F0";
export const CHART_AXIS_TICK = "#64748B";
export const CHART_TEXT_MUTED = "#94A3B8";
export const CHART_FONT_MONO = "var(--font-mono), monospace";
```

DailyHeatmap data shape (per UI-SPEC §3.5):

```typescript
interface DailyHeatmapDataPoint { date: string; value: number; }
interface DailyHeatmapProps { data: DailyHeatmapDataPoint[]; }
```

From src/test-setup.ts (Phase 14a-05 — already wired):

- Global `IntersectionObserver` stub is registered for Vitest. Test code can rely on `new IntersectionObserver(...)` not throwing.
</interfaces>
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: Extend useLazyPanelMetrics with real-fetch path + observer cleanup (B-02 / I-01)</name>
  <files>src/hooks/useLazyPanelMetrics.ts, src/hooks/useLazyPanelMetrics.test.ts</files>
  <read_first>
    - src/hooks/useLazyPanelMetrics.ts (current implementation — 87 LOC; see inline comment block at lines 73-78 marking the exact extension point; lines 46-51 already have a useEffect cleanup that disconnects observerRef on unmount — preserve this verbatim, do NOT remove)
    - src/lib/queries.ts:441-495 (fetchStrategyLazyMetrics signature + LazyMetricsPanelId union)
    - src/test-setup.ts (verify IntersectionObserver stub already global)
    - .planning/phases/14b-single-strategy-v2-lazy-panels-trade-exposure/14B-UI-SPEC.md §4.1 (hook contract table, status transitions)
    - src/components/strategy-v2/LazyPanelPlaceholder.tsx (existing 14a caller — `useLazyPanelMetrics(panelId)` no-opts form MUST keep working)
  </read_first>
  <behavior>
    - Test 1 (idle → ready, no fetch): When `fetchOnIntersect` defaults to false (no opts passed), first intersection emits `status='ready'` immediately and `data` stays `null`. Mirrors 14a behaviour exactly.
    - Test 2 (fetch path success): When `fetchOnIntersect: true` and `strategyId: 'abc'` and `panelId: 'panel4'`, the hook calls `fetchStrategyLazyMetrics('abc', 'returns_dist')` (panel-id mapping per PANEL_TO_ID). Status transitions idle → loading → ready. `data` becomes the resolved payload.
    - Test 3 (fetch path error): When `fetchStrategyLazyMetrics` rejects, status transitions idle → loading → error. `data` stays `null`. Console.error is invoked once with `{ panelId, strategyId, message }` shape.
    - Test 4 (panel-id mapping): All 4 LazyPanelId values map to their migration-087 LazyMetricsPanelId: panel4→returns_dist, panel5→rolling, panel6→trades, panel7→exposure.
    - Test 5 (memoization): Component re-render does NOT re-fetch. Fetch fires exactly once per intersection across multiple parent renders (use `vi.fn()` mock and assert `mock.calls.length === 1`).
    - Test 6 (unobserve): On first intersection the observer disconnects/unobserves the target so a second scroll-into-view does not retrigger fetch.
    - Test 7 (missing strategyId): When `fetchOnIntersect: true` is set without `strategyId`, hook logs a warning via console.error and stays in `idle` (defensive guard — TypeScript should also forbid this combination via overloads, but the runtime guard is the contract).
    - Test 8 (cleanup on unmount — I-01): Unmount BEFORE the observer fires. Assert: `observerRef.current?.disconnect()` was called via the existing useEffect cleanup at lines 46-51. The unmount itself emits no console.error and the observer reference is nulled. Spy via `vi.spyOn(IntersectionObserver.prototype, 'disconnect')` on the global stub OR by recording the stub's own internal disconnect-call counter.
    - Test 9 (cleanup also runs after fetch resolves): Mount, intersect, await fetch, then unmount. The cleanup still runs without throwing even though the observer was already unobserved on intersection.
  </behavior>
  <action>
    Extend `src/hooks/useLazyPanelMetrics.ts`:

    1. Add to `UseLazyPanelMetricsOptions`:
       - `strategyId?: string;` (required when `fetchOnIntersect=true`; runtime-guarded)

    2. Add module-level constant after the existing `LazyPanelId` type:
       ```typescript
       const PANEL_TO_ID: Record<LazyPanelId, "returns_dist" | "rolling" | "trades" | "exposure"> = {
         panel4: "returns_dist",
         panel5: "rolling",
         panel6: "trades",
         panel7: "exposure",
       };
       ```
       Import `LazyMetricsPanelId` from `@/lib/queries` and constrain the value type accordingly. Do NOT widen — the executor MUST get a TS error if a new panel is added without updating the map.

    3. Convert `data` from `useState<T | null>(null)` (currently no setter) to a real state pair `const [data, setData] = useState<T | null>(null);`.

    4. **PRESERVE the existing `useEffect(() => { return () => { observerRef.current?.disconnect(); observerRef.current = null; }; }, [])` cleanup at lines 46-51 verbatim (Grok I-01: explicit observer cleanup on unmount). Do NOT remove or move this hook. The Phase-14b changes happen INSIDE the IntersectionObserver callback only.**

    5. Inside the IntersectionObserver callback, replace the existing comment block at lines 70-78 with:
       ```typescript
       observerRef.current?.unobserve(entry.target);
       if (!opts.fetchOnIntersect) {
         setStatus("ready");
         return;
       }
       if (!opts.strategyId) {
         console.error("useLazyPanelMetrics: fetchOnIntersect=true requires strategyId", { panelId });
         return; // stays in 'idle'
       }
       setStatus("loading");
       fetchStrategyLazyMetrics(opts.strategyId, PANEL_TO_ID[panelId])
         .then((payload) => {
           setData(payload as T);
           setStatus("ready");
         })
         .catch((err: unknown) => {
           const message = err instanceof Error ? err.message : String(err);
           console.error("useLazyPanelMetrics fetch failed", { panelId, strategyId: opts.strategyId, message });
           setStatus("error");
         });
       ```

    6. Import `fetchStrategyLazyMetrics` from `@/lib/queries` at the top of the file.

    7. Update the JSDoc block at lines 19-31 to document the Phase-14b extension. Remove the "In 14a, this hook ONLY tracks intersection lifecycle" sentence and replace with a Phase-14b-current description: "When `fetchOnIntersect=true` and `strategyId` is provided, the hook fetches the panel's heavy series payload via `fetchStrategyLazyMetrics(strategyId, mappedPanelId)` on first intersection and exposes the result via `data`. Observer cleanup runs on unmount via the existing useEffect."

    8. Remove the `void panelId;` no-op at line 40 — `panelId` is now used by `PANEL_TO_ID[panelId]`.

    9. Create `src/hooks/useLazyPanelMetrics.test.ts` with the 9 behaviours above. Use `vi.mock("@/lib/queries", ...)` to inject a controllable `fetchStrategyLazyMetrics` spy. Use `@testing-library/react` `renderHook` + `act` for state-transition assertions. Trigger intersection by capturing the observer instance via the global stub at `src/test-setup.ts` and calling its callback with synthetic `IntersectionObserverEntry`-shaped objects (the stub stores `cb`/`elements` in arrays — pattern documented at `src/test-setup.ts:IntersectionObserverStub`).

    10. Do NOT modify `src/components/strategy-v2/LazyPanelPlaceholder.tsx` — its `useLazyPanelMetrics(panelId)` no-opts call must continue working and emitting `status='ready'` immediately on intersection.

    11. Concrete value: console.error message format MUST be exactly `"useLazyPanelMetrics fetch failed"` (literal string) so future grep-based logging assertions remain stable.
  </action>
  <verify>
    <automated>npm test -- src/hooks/useLazyPanelMetrics.test.ts --run</automated>
  </verify>
  <done>
    - `npm test -- src/hooks/useLazyPanelMetrics.test.ts --run` passes 9/9.
    - `grep -c "PANEL_TO_ID" src/hooks/useLazyPanelMetrics.ts` returns ≥ 2 (definition + lookup).
    - `grep -c "fetchStrategyLazyMetrics" src/hooks/useLazyPanelMetrics.ts` returns ≥ 2 (import + call).
    - `grep -c "void panelId" src/hooks/useLazyPanelMetrics.ts` returns 0 (no-op removed).
    - `grep -c "observerRef.current?.disconnect()" src/hooks/useLazyPanelMetrics.ts` returns ≥ 1 (cleanup preserved — I-01).
    - `npx tsc --noEmit` exits 0.
    - `npm test -- src/components/strategy-v2 --run` (existing 14a tests) passes — LazyPanelPlaceholder is unaffected.
  </done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: Ship DailyHeatmap dual SVG/Canvas component (B-02 geometry fix)</name>
  <files>src/components/charts/DailyHeatmap.tsx, src/components/charts/DailyHeatmap.test.tsx</files>
  <read_first>
    - .planning/phases/14b-single-strategy-v2-lazy-panels-trade-exposure/14B-UI-SPEC.md §3.5 (full DailyHeatmap spec — threshold rule, SVG renderer, Canvas renderer, color scale)
    - src/components/charts/MonthlyHeatmap.tsx (sibling pattern — but DailyHeatmap MUST NOT reuse `bg-emerald-*` Tailwind palette; use explicit hex)
    - src/components/charts/chart-tokens.ts (CHART_BORDER, CHART_AXIS_TICK, CHART_FONT_MONO)
    - src/test-setup.ts (IntersectionObserver stub — also document that JSDOM has no real Canvas; tests must mock or read drawn calls via `getContext('2d')` spy)
  </read_first>
  <behavior>
    - Test 1: When `data.length === 30` (≤365), renders `<svg>` (not `<canvas>`). Asserted via `container.querySelector("svg")` truthy and `container.querySelector("canvas")` null.
    - Test 2: When `data.length === 1825` (5y, > 365), renders `<canvas>` (not `<svg>` chart). Offscreen `<table aria-hidden="false">` mirror present with 1825 `<td>` cells.
    - Test 3: SVG branch — first cell with `value > 0.10` has `fill="#16A34A"` (saturated positive). NEVER `#059669`. NEVER any `bg-emerald-*` Tailwind class.
    - Test 4: SVG branch — first cell with `value < -0.10` has `fill="#DC2626"` (saturated negative).
    - Test 5: SVG branch — cell with `value === 0` has `fill="#FFFFFF"` (or `bg-surface-subtle` token) and a non-empty `<title>` for screen-reader narration ("YYYY-MM-DD: 0.00%").
    - Test 6: SVG branch — every cell carries a `stroke="#E2E8F0"` (CHART_BORDER) gridline.
    - Test 7: Canvas branch — `getContext('2d').fillRect` is invoked exactly `data.length` times (1825 for 5y).
    - Test 8: Canvas branch — accessibility table mirror emits `role="presentation"` on the `<canvas>` element and `<table>` rows correspond to years × month-of-year.
    - Test 9: Canvas branch performance — first render emits `performance.mark('panel-4-mount-start')` BEFORE paint and `performance.mark('panel-4-mount-end')` AFTER paint (asserted via `performance.getEntriesByName('panel-4-mount-start')` non-empty after first commit).
    - Test 10: Color scale 9-step — for values [0.15, 0.07, 0.03, 0.01, 0, -0.01, -0.03, -0.07, -0.15] the rendered fills are exactly `#16A34A`, `#16A34A` opacity 0.7, `#16A34A` opacity 0.4, `#16A34A` opacity 0.15, `#FFFFFF`, `#DC2626` opacity 0.15, `#DC2626` opacity 0.4, `#DC2626` opacity 0.7, `#DC2626` (matches UI-SPEC §3.5 color scale).
    - Test 11: SVG branch axis labels — Y-axis labels (year) render in `font-family: var(--font-mono), monospace` 12px `fill="#94A3B8"` (text-text-muted equivalent); X-axis labels (month) render in DM Sans 12px (no monospace). Use `CHART_FONT_MONO` for the Y-axis only.
    - Test 12: Empty data array (`data: []`) renders an empty container without crashing — no SVG, no Canvas, no table.
    - **Test 13 (Canvas geometry no-overflow — Grok B-02)**: With a 5y fixture (`data.length === 1825`, dates spanning 2020-01-01..2024-12-31), assert that **every cell's `(x + cellWidth)` is ≤ canvas.width** (730px). Verification: spy on `ctx.fillRect(x, y, w, h)` calls; collect all `(x, w)` tuples; assert `Math.max(...xValues.map((x, i) => x + ws[i])) <= 730`. With the 2px-wide cells specified in step 5 below, `max_x = 364 * 2 + 2 = 730` exactly fits.
    - **Test 14 (Canvas geometry — row layout per year — Grok B-02)**: For a 5y fixture, assert exactly 5 unique Y-row positions are used (one per year). Verification: collect all `y` values from fillRect spy; `new Set(yValues).size === 5`.
  </behavior>
  <action>
    Create `src/components/charts/DailyHeatmap.tsx`:

    1. File header:
       ```typescript
       "use client";
       import { useEffect, useRef } from "react";
       import {
         CHART_BORDER,
         CHART_AXIS_TICK,
         CHART_TEXT_MUTED,
         CHART_FONT_MONO,
       } from "./chart-tokens";

       export const SVG_THRESHOLD_CELLS = 365;

       export interface DailyHeatmapDataPoint {
         date: string; // ISO YYYY-MM-DD
         value: number; // daily return as decimal, e.g. 0.0123 = 1.23%
       }

       interface DailyHeatmapProps {
         data: DailyHeatmapDataPoint[];
       }
       ```

    2. Top-level `DailyHeatmap` component:
       ```typescript
       export function DailyHeatmap({ data }: DailyHeatmapProps) {
         if (data.length === 0) return <div data-empty="true" />;
         if (data.length <= SVG_THRESHOLD_CELLS) return <SvgRenderer data={data} />;
         return <CanvasRenderer data={data} />;
       }
       ```

    3. Color-scale helper (NOT exported — internal):
       ```typescript
       function cellFill(v: number): { fill: string; opacity: number } {
         // 9-step diverging scale anchored at 0 — UI-SPEC §3.5
         if (v >= 0.10) return { fill: "#16A34A", opacity: 1 };
         if (v >= 0.05) return { fill: "#16A34A", opacity: 0.7 };
         if (v >= 0.02) return { fill: "#16A34A", opacity: 0.4 };
         if (v > 0)    return { fill: "#16A34A", opacity: 0.15 };
         if (v === 0)  return { fill: "#FFFFFF", opacity: 1 };
         if (v > -0.02) return { fill: "#DC2626", opacity: 0.15 };
         if (v > -0.05) return { fill: "#DC2626", opacity: 0.4 };
         if (v > -0.10) return { fill: "#DC2626", opacity: 0.7 };
         return { fill: "#DC2626", opacity: 1 };
       }
       ```

    4. `SvgRenderer`:
       - Group `data` by year (Map<string, DailyHeatmapDataPoint[]>) for the row layout.
       - Cell width: 24px. Cell height: 16px.
       - Per cell: `<rect x={..} y={..} width={24} height={16} fill={fill} fillOpacity={opacity} stroke="#E2E8F0" strokeWidth={1} />`.
       - `<title>` child of each cell: `${date}: ${(value*100).toFixed(2)}%` (NOT `toFixed(1)`).
       - Y-axis row labels: `<text fontFamily={CHART_FONT_MONO} fontSize={12} fill={CHART_TEXT_MUTED}>{year}</text>`.
       - X-axis month labels: `<text fontSize={12} fill={CHART_TEXT_MUTED}>{monthName}</text>` (NO `fontFamily` — DM Sans default).
       - Outer `<svg role="img" aria-label="Daily returns heatmap">` so axe-core sees an accessible name.
       - `min-height: 280px` on the wrapper div per UI-SPEC §3.5 layout-footprint.

    5. **`CanvasRenderer` (Grok B-02 geometry fix — row=year, col=day-of-year, cellW=2px):**
       - `useRef<HTMLCanvasElement>(null)`.
       - **Cell dimensions:** `const CELL_W = 2; const CELL_H = 80;` — 2px wide × 80px tall (one cell per day-of-year, one row per year).
       - **Canvas dimensions:** `width={730}` (= `365 * 2`, fits 365 days at 2px = 730px exactly), `height={400}` (= `5 * 80`, fits 5 years at 80px-per-row).
       - **Coordinate mapping:** for each `data[i]`:
         - Parse `year` from `data[i].date.slice(0, 4)`. Compute `yearIndex` = ordered position of that year among `Array.from(new Set(data.map(d => d.date.slice(0,4)))).sort()`.
         - Compute `dayOfYear`: 0-based index of the date within its year. Use `(d.date.slice(5,7), d.date.slice(8,10))` to derive day-of-year via a small lookup `MONTH_OFFSETS = [0,31,59,90,120,151,181,212,243,273,304,334]` plus leap-year adjustment (`+1` for `>= Mar 1` when year is a leap year). Day-of-year is clamped to [0, 364] (Dec-31 leap-year falls back to 364 to match the 365-cell column count and avoid x=730 overflow).
         - `x = dayOfYear * CELL_W;` — **maximum x = 364 * 2 + 2 = 730** (fits canvas.width exactly per Grok B-02 acceptance criterion).
         - `y = yearIndex * CELL_H;` — 5 unique row positions for a 5y fixture.
       - On mount (`useEffect(() => { ... }, [data])`):
         - `performance.mark("panel-4-mount-start")` first.
         - `const ctx = canvasRef.current?.getContext("2d");` — bail if null.
         - For each `data[i]`: set `ctx.fillStyle = ${fill};`, set `ctx.globalAlpha = opacity;`, call `ctx.fillRect(x, y, CELL_W, CELL_H)` with the (x, y) computed above.
         - `performance.mark("panel-4-mount-end")` last.
         - `performance.measure("panel-4-paint", "panel-4-mount-start", "panel-4-mount-end")`.
       - Render JSX:
         ```tsx
         <div className="relative" style={{ minHeight: 360 }}>
           <canvas
             ref={canvasRef}
             width={730} height={400}
             role="presentation"
             aria-hidden="true"
             className="w-full"
           />
           <table aria-label="Daily returns table" className="sr-only">
             <tbody>
               {rowsByYear.map((yr) => (
                 <tr key={yr.year}>
                   <th scope="row">{yr.year}</th>
                   {yr.days.map((d) => (
                     <td key={d.date}>{`${d.date}: ${(d.value * 100).toFixed(2)}%`}</td>
                   ))}
                 </tr>
               ))}
             </tbody>
           </table>
         </div>
         ```
       - Use `sr-only` Tailwind utility (already in tree per AllocationDashboardV2 use) so the table is offscreen but discoverable by screen readers; toggle `aria-hidden="false"` on the table itself per UI-SPEC §3.5 ("offscreen <table> mirror with `aria-hidden="false"`").

    6. Concrete value — month name array:
       ```typescript
       const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
       ```

    7. `min-height` exact values: 280px for SVG branch wrapper, 360px for Canvas branch wrapper (UI-SPEC §3.5 layout footprint).

    8. Create `src/components/charts/DailyHeatmap.test.tsx` covering all 14 behaviours. Mock Canvas 2D context via:
       ```typescript
       const fillRectCalls: { x: number; y: number; w: number; h: number }[] = [];
       const fillRectSpy = vi.fn((x, y, w, h) => { fillRectCalls.push({ x, y, w, h }); });
       HTMLCanvasElement.prototype.getContext = vi.fn(() => ({
         fillRect: fillRectSpy,
         fillStyle: "",
         globalAlpha: 1,
       })) as never;
       ```
       Use `fillRectCalls` to assert geometry no-overflow (test 13) and 5 unique y-rows (test 14). For performance assertions, spy on `performance.mark` via `vi.spyOn(performance, 'mark')`.

    9. NO `bg-emerald-*` / `bg-red-*` Tailwind classes anywhere in DailyHeatmap.tsx (see DESIGN-01 audit; MonthlyHeatmap will be remediated in 14b-02).

    10. NO inline tick objects — all axis text uses `CHART_FONT_MONO` and `CHART_TEXT_MUTED` from `chart-tokens.ts`.
  </action>
  <verify>
    <automated>npm test -- src/components/charts/DailyHeatmap.test.tsx --run</automated>
  </verify>
  <done>
    - `npm test -- src/components/charts/DailyHeatmap.test.tsx --run` passes 14/14.
    - `grep -c "SVG_THRESHOLD_CELLS = 365" src/components/charts/DailyHeatmap.tsx` returns 1.
    - `grep -c "#16A34A" src/components/charts/DailyHeatmap.tsx` returns ≥ 4 (4 positive opacity tiers).
    - `grep -c "#DC2626" src/components/charts/DailyHeatmap.tsx` returns ≥ 4 (4 negative opacity tiers).
    - `grep -c "#059669" src/components/charts/DailyHeatmap.tsx` returns 0 (forbidden hex).
    - `grep -cE "bg-(emerald|red)-[0-9]" src/components/charts/DailyHeatmap.tsx` returns 0 (forbidden tailwind classes).
    - `grep -c "panel-4-mount-start" src/components/charts/DailyHeatmap.tsx` returns 1.
    - `grep -c "panel-4-mount-end" src/components/charts/DailyHeatmap.tsx` returns 1.
    - `grep -c "role=\"presentation\"" src/components/charts/DailyHeatmap.tsx` returns 1.
    - `grep -c "CELL_W = 2" src/components/charts/DailyHeatmap.tsx` returns 1 (Grok B-02 geometry).
    - `grep -c "width={730}" src/components/charts/DailyHeatmap.tsx` returns 1.
    - `npx tsc --noEmit` exits 0.
    - `npm run build` exits 0.
  </done>
</task>

</tasks>

<verification>
- `npm test -- src/hooks/useLazyPanelMetrics.test.ts src/components/charts/DailyHeatmap.test.tsx --run` all green.
- `npm test -- src/components/strategy-v2 --run` (Phase 14a tests) still green — no regression on LazyPanelPlaceholder.
- `npm run build` exits 0.
- `grep -rn "fetchStrategyLazyMetrics" src/hooks/` returns ≥ 1 (consumer wired).
- DailyHeatmap is NOT yet mounted anywhere in `src/components/strategy-v2/` (that lands in 14b-02 + 14b-06). No StrategyV2Shell change.
</verification>

<success_criteria>
- Real-fetch lazy hook exists; both 14a-style placeholder (LazyPanelPlaceholder.tsx) and 14b-style real-fetch (Wave-2 panel bodies) call sites resolve via the same hook.
- DailyHeatmap component shipped with hard 365-cell SVG/Canvas threshold, year-row Canvas geometry that fits 730×400 (Grok B-02 fix), and a11y table mirror.
- Observer cleanup explicitly preserved on unmount (Grok I-01).
- Foundation ready — Wave-2 plans (14b-02..05) can build their panel bodies without re-implementing lazy lifecycle or daily heatmap.
</success_criteria>

<output>
After completion, create `.planning/phases/14b-single-strategy-v2-lazy-panels-trade-exposure/14b-01-SUMMARY.md` documenting the hook extension shape, the panel-id mapping table, the Canvas geometry decision (year-row × day-of-year × 2px cells), and any deviations from this plan.
</output>
