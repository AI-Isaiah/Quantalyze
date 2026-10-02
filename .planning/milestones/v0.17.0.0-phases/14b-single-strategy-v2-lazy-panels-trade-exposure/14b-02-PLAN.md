---
phase: 14b
plan: 02
type: execute
wave: 2
depends_on: [14b-01]
files_modified:
  - src/components/strategy-v2/ReturnsDistributionPanel.tsx
  - src/components/strategy-v2/ReturnsDistributionPanel.test.tsx
  - src/components/charts/ReturnHistogram.tsx
  - src/components/charts/YearlyReturns.tsx
  - src/components/charts/ReturnQuantiles.tsx
  - src/components/charts/MonthlyHeatmap.tsx
  - src/components/charts/DailyHeatmap.tsx
autonomous: true
requirements: [KPI-06, KPI-23b]
requirements_addressed: [KPI-06, KPI-23b]
tags: [strategy-v2, panel-4, returns-distribution, design-01-audit, partial-data]
must_haves:
  truths:
    - "Panel 4 mounts <ReturnsDistributionPanel /> with 5 stacked sub-charts (Monthly heatmap / Daily heatmap / Return histogram / Return quantiles / Yearly returns)"
    - "Panel 4 lazy-fetches via useLazyPanelMetrics({ fetchOnIntersect: true, strategyId, panelId: 'panel4' })"
    - "Partial-data banner renders when history_days < 30"
    - "Sub-section banners for DailyHeatmap (<30d) and YearlyReturns (<365d) render inside otherwise-full panel"
    - "ReturnHistogram positive bars use #16A34A (replacing #059669)"
    - "ReturnHistogram + YearlyReturns axis ticks use CHART_TICK_STYLE (no inline {fontSize, fill} objects)"
    - "ReturnQuantiles box stroke + median use #1B6B5A (replacing #0D9488); whiskers stay #94A3B8"
    - "MonthlyHeatmap cells use #16A34A / #DC2626 explicit hex (no bg-emerald-* / bg-red-* tailwind)"
    - "DailyHeatmap is wrapped with React.memo to prevent re-renders on Panel 4 status transitions (Grok W-01)"
    - "ReturnsDistributionPanel passes a useMemo-stabilized data prop reference to DailyHeatmap (Grok W-01)"
  artifacts:
    - path: "src/components/strategy-v2/ReturnsDistributionPanel.tsx"
      provides: "Wrapper component for Panel 4 — lazy fetch + 5 sub-charts + partial-data routing"
      exports: ["ReturnsDistributionPanel"]
    - path: "src/components/strategy-v2/ReturnsDistributionPanel.test.tsx"
      provides: "Vitest coverage of mount/ready/error/partial-data branches + DailyHeatmap re-render budget"
    - path: "src/components/charts/ReturnHistogram.tsx"
      provides: "Updated identity: #16A34A bars + CHART_TICK_STYLE axes + benchmark-overlay prop verified"
    - path: "src/components/charts/YearlyReturns.tsx"
      provides: "Updated identity: #16A34A bars + CHART_TICK_STYLE axes"
    - path: "src/components/charts/ReturnQuantiles.tsx"
      provides: "Updated identity: #1B6B5A box + median (whiskers stay #94A3B8 — strokes, not text)"
    - path: "src/components/charts/MonthlyHeatmap.tsx"
      provides: "Updated identity: explicit #16A34A / #DC2626 opacity scale (no Tailwind palette)"
    - path: "src/components/charts/DailyHeatmap.tsx"
      provides: "Wrapped with React.memo — prop-reference-stable consumers do NOT trigger Canvas re-paint on Panel 4 status transitions"
  key_links:
    - from: "src/components/strategy-v2/ReturnsDistributionPanel.tsx"
      to: "src/hooks/useLazyPanelMetrics.ts"
      via: "useLazyPanelMetrics({ fetchOnIntersect: true, strategyId, panelId: 'panel4' })"
      pattern: "useLazyPanelMetrics<.*>\\(\"panel4\""
    - from: "src/components/strategy-v2/ReturnsDistributionPanel.tsx"
      to: "src/components/charts/DailyHeatmap.tsx"
      via: "import + render with useMemo-stabilized data prop"
      pattern: "from \"@/components/charts/DailyHeatmap\""
---

<objective>
Ship Panel 4 — Returns Distribution. Wraps the 5 sub-charts (MonthlyHeatmap reused / DailyHeatmap NEW from 14b-01 / ReturnHistogram reused / ReturnQuantiles reused / YearlyReturns reused) inside the 14a panel chrome, lazy-fetches the heavy series payload via the 14b-01 hook extension, and applies the DESIGN-01 identity audit to the four pre-existing chart components (which currently use #0D9488, #059669, and `bg-emerald-*` / `bg-red-*` Tailwind palette). Per-panel partial-data banner triggers below 30-day history; sub-section banners trigger on DailyHeatmap (<30d) and YearlyReturns (<365d) thresholds.

Purpose: KPI-06 + KPI-23b panel 4 partial-data + DESIGN-01 chart-color audit close-out.
Output: One new wrapper component + one test file + four chart-component identity edits + DailyHeatmap React.memo wrap (Grok W-01). NOT yet mounted in StrategyV2Shell — that wiring lands in 14b-06.

**Revision (2026-04-29 Grok review):** W-01 — DailyHeatmap re-render explosion mitigation: wrap with React.memo + stabilize data prop reference via useMemo in the consumer.
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
@src/components/charts/chart-tokens.ts
@src/components/charts/MonthlyHeatmap.tsx
@src/components/charts/ReturnHistogram.tsx
@src/components/charts/ReturnQuantiles.tsx
@src/components/charts/YearlyReturns.tsx
@src/components/strategy-v2/PartialDataBanner.tsx
@src/components/strategy-v2/LazyPanelPlaceholder.tsx
@src/components/strategy-v2/DrawdownPanel.tsx

<interfaces>
<!-- Contracts the executor uses directly. -->

From 14b-01 (Wave 1 — assumed shipped):

```typescript
// src/hooks/useLazyPanelMetrics.ts
useLazyPanelMetrics<T>(panelId: "panel4"|"panel5"|"panel6"|"panel7", opts: {
  rootMargin?: string;
  fetchOnIntersect?: boolean;
  strategyId?: string;
}): { ref: (n: HTMLElement | null) => void; data: T | null; status: "idle"|"loading"|"error"|"ready" };

// src/components/charts/DailyHeatmap.tsx
export function DailyHeatmap({ data }: { data: { date: string; value: number }[] }): JSX.Element;
```

In 14b-02, `DailyHeatmap` is exported via `React.memo` (see Task 1.E below — Grok W-01 mitigation). The export shape stays identical from the consumer's perspective.

From src/components/strategy-v2/PartialDataBanner.tsx (Phase 14a — reused):

```typescript
export function PartialDataBanner({ heading, body }: { heading: string; body: string }): JSX.Element;
```

Panel 4 lazy-fetched payload shape (from migration 087 returns_dist mapping per src/lib/queries.ts:436):

```typescript
// returns_dist → [daily_returns_grid]
// Other Panel-4 inputs (monthly_returns_grid, returns_series, return_quantiles)
// come from getStrategyDetailV2's eager analytics blob via metrics_json.
type Panel4LazyPayload = {
  daily_returns_grid?: { date: string; value: number }[];
};
```

From src/lib/types.ts (StrategyAnalytics — eager source for monthly_returns / return_quantiles):

```typescript
monthly_returns: Record<string, Record<string, number>> | null;
return_quantiles: Record<string, number[]> | null;
returns_series: { date: string; value: number }[] | null;
```

From DESIGN.md / chart-tokens.ts:

```typescript
export const CHART_ACCENT = "#1B6B5A";       // Strategy series — new ReturnQuantiles box/median color
export const CHART_TEXT_MUTED = "#94A3B8";  // ReturnQuantiles whiskers (strokes — A11Y-01 forbidden-as-text rule does NOT apply to strokes)
export const CHART_AXIS_TICK = "#64748B";   // Already used; leave alone
export const CHART_TICK_STYLE = { fontFamily: CHART_FONT_MONO, fontSize: 12, fontVariantNumeric: "tabular-nums", fill: CHART_AXIS_TICK };
```

CSS-var equivalents (from src/app/globals.css):
- `--color-positive: #16A34A` (DESIGN.md positive)
- `--color-negative: #DC2626` (DESIGN.md negative)

Per UI-SPEC §4.3 partial-data thresholds for Panel 4:
- Panel-level: history_days < 30 → "Awaiting more data" + body "This strategy needs at least 30 days of trading history to populate Returns distribution."
- Sub-section DailyHeatmap (history_days < 30 — same threshold, but optional sub-banner since panel-level already triggered).
- Sub-section YearlyReturns (history_days < 365 → optional sub-banner "Yearly returns activates after 1 year of trading history.").
</interfaces>
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: Identity audit on 4 existing chart components (DESIGN-01) + React.memo wrap on DailyHeatmap (Grok W-01)</name>
  <files>src/components/charts/ReturnHistogram.tsx, src/components/charts/YearlyReturns.tsx, src/components/charts/ReturnQuantiles.tsx, src/components/charts/MonthlyHeatmap.tsx, src/components/charts/DailyHeatmap.tsx</files>
  <read_first>
    - src/components/charts/ReturnHistogram.tsx (lines 38-49: inline tick objects to replace; line 56: `#059669` → `#16A34A`; verify benchmark-overlay prop — current signature has only `returns` and `bins`; benchmarkReturns prop needed for UI-SPEC §3.1 — see action)
    - src/components/charts/YearlyReturns.tsx (lines 23-34: inline tick objects; line 40: `#059669` → `#16A34A`; line 29 has `'JetBrains Mono', monospace` literal — replace with CHART_TICK_STYLE which uses CHART_FONT_MONO)
    - src/components/charts/ReturnQuantiles.tsx (lines 61, 64, 68: `#0D9488` → `#1B6B5A`; lines 52-54: `#94A3B8` whisker stroke STAYS — strokes, not text fill, A11Y-01 doesn't apply; line 37: `'JetBrains Mono', monospace` → CHART_FONT_MONO; line 70: `#64748B` text → keep but use CHART_AXIS_TICK token)
    - src/components/charts/MonthlyHeatmap.tsx (lines 9-19: cellColor returns Tailwind classes — REPLACE with explicit hex via inline style; lines 27, 29, 36: `text-xs font-medium` is FORBIDDEN — change to `text-xs font-normal` per 14a §2 type contract; line 44: `font-metric` class — verify in globals.css before removing)
    - src/components/charts/DailyHeatmap.tsx (post 14b-01 — currently exports a plain function component; needs React.memo wrap per Grok W-01)
    - .planning/phases/14b-single-strategy-v2-lazy-panels-trade-exposure/14B-UI-SPEC.md §5 (color token table — exact mapping table for every change)
    - tests/a11y/chart-contrast.test.ts (verify glob pattern; this test will catch any remaining `fill="#94A3B8"` on text/legend nodes)
    - tests/visual/strategy-v2-type-scale.test.ts (verify glob pattern; this test will catch any remaining `font-medium`)
  </read_first>
  <behavior>
    - Test 1 (ReturnHistogram positive bars): Render with `returns: [{date:'2024-01-01',value:100},{date:'2024-01-02',value:103}]`. Locate the rendered `<rect>` for the positive bin; its `fill` is `#16A34A`. NEVER `#059669`.
    - Test 2 (ReturnHistogram axis tick style): Locate `<XAxis>` and `<YAxis>` props. Both spread `CHART_TICK_STYLE`; neither has an inline `{ fontSize: 10|11, fill: "#64748B" }` object literal.
    - Test 3 (ReturnHistogram benchmark overlay): When called with `benchmarkReturns={[{date:'2024-01-01',value:100},{date:'2024-01-02',value:101}]}`, a SECOND set of bars renders with `fillOpacity={0.4}` and `fill={CHART_TEXT_MUTED}` (#94A3B8). Without the prop, only one set renders (existing behavior preserved).
    - Test 4 (YearlyReturns positive bars): Similar — positive bars `fill="#16A34A"` not `#059669`.
    - Test 5 (YearlyReturns axis tick style): `CHART_TICK_STYLE` spread on both axes.
    - Test 6 (ReturnQuantiles box + median): Box stroke + fill + median line all use `#1B6B5A`. Whiskers KEEP `#94A3B8`.
    - Test 7 (ReturnQuantiles axis text): Y-axis tick text uses `CHART_FONT_MONO` literal not the inline `'JetBrains Mono', monospace` string.
    - Test 8 (MonthlyHeatmap cells): For value 0.07, rendered cell has `style={{ backgroundColor: '#16A34A', opacity: 0.7 }}` (not `bg-emerald-400`). For value -0.07, `backgroundColor: '#DC2626', opacity: 0.7`. NO `bg-emerald-*` or `bg-red-*` Tailwind class anywhere.
    - Test 9 (MonthlyHeatmap forbidden-class scan): Run `tests/visual/strategy-v2-type-scale.test.ts` extension via direct grep — file emits 0 instances of `font-medium`.
    - **Test 10 (DailyHeatmap React.memo wrap — Grok W-01):** The default export `DailyHeatmap` is wrapped with `React.memo`. Render twice with the same `data` reference (same array identity); the inner Canvas useEffect runs only ONCE. Spy via `vi.spyOn` on the mocked `getContext('2d').fillRect` — across two parent re-renders with identical data prop reference, total fillRect calls equal `data.length` (one paint), not `2 * data.length`.
    - **Test 11 (DailyHeatmap re-renders on data identity change):** With a NEW data array reference (different identity, even with identical content), React.memo's default shallow compare sees `data !== prevData` → component re-renders → fillRect fires `data.length` times again. This is correct behavior (data identity is the contract for re-paint).
  </behavior>
  <action>
    Apply identity edits — these are line-level replacements; no re-architecting:

    **A. src/components/charts/ReturnHistogram.tsx:**

    1. Update interface to add benchmark-overlay prop:
       ```typescript
       interface ReturnHistogramProps {
         returns: { date: string; value: number }[];
         benchmarkReturns?: { date: string; value: number }[];
         bins?: number;
       }
       ```

    2. Add import at top:
       ```typescript
       import {
         CHART_ACCENT,
         CHART_BORDER,
         CHART_TEXT_MUTED,
         CHART_TICK_STYLE,
       } from "./chart-tokens";
       ```

    3. Replace `<XAxis tick={{ fontSize: 10, fill: "#64748B" }} ...>` with `<XAxis tick={CHART_TICK_STYLE} ...>` (line 38-44 area).

    4. Replace `<YAxis tick={{ fontSize: 11, fill: "#64748B" }} ...>` with `<YAxis tick={CHART_TICK_STYLE} ...>` (line 45-49 area).

    5. Replace `<Cell key={i} fill={entry.value >= 0 ? "#059669" : "#DC2626"} />` with:
       ```tsx
       <Cell key={i} fill={entry.value >= 0 ? "#16A34A" : "#DC2626"} />
       ```

    6. After the existing `<Bar>` block, add benchmark overlay block when `benchmarkReturns` is provided:
       ```tsx
       {benchmarkReturns && benchmarkReturns.length >= 10 && (
         <Bar dataKey="benchmarkCount" radius={[2, 2, 0, 0]}>
           {histogram.map((_, i) => (
             <Cell key={`bm-${i}`} fill={CHART_TEXT_MUTED} fillOpacity={0.4} />
           ))}
         </Bar>
       )}
       ```
       Compute `benchmarkCount` per-bin alongside the existing `count` (re-use the same min/max/binWidth scaling so bins align). Add to the histogram array shape.

    7. Replace `<Tooltip contentStyle={{ fontSize: 12, borderColor: "#E2E8F0" }} ... />` with use of `CHART_BORDER` token.

    **B. src/components/charts/YearlyReturns.tsx:**

    1. Add imports:
       ```typescript
       import { CHART_BORDER, CHART_TICK_STYLE } from "./chart-tokens";
       ```

    2. Replace `<XAxis tick={{ fontSize: 12, fill: "#64748B" }} ...>` with `<XAxis tick={CHART_TICK_STYLE} ...>`.

    3. Replace `<YAxis tick={{ fontSize: 11, fill: "#64748B", fontFamily: "'JetBrains Mono', monospace" }} ...>` with `<YAxis tick={CHART_TICK_STYLE} ...>`.

    4. Replace axisLine stroke literal `"#E2E8F0"` with `CHART_BORDER`.

    5. Replace `<Cell key={i} fill={entry.value >= 0 ? "#059669" : "#DC2626"} />` with `fill={entry.value >= 0 ? "#16A34A" : "#DC2626"}`.

    6. Replace tooltip `borderColor: "#E2E8F0"` with `borderColor: CHART_BORDER`.

    **C. src/components/charts/ReturnQuantiles.tsx:**

    1. Add imports:
       ```typescript
       import {
         CHART_ACCENT,
         CHART_AXIS_TICK,
         CHART_FONT_MONO,
         CHART_TEXT_MUTED,
       } from "./chart-tokens";
       ```

    2. Replace literal `#0D9488` (3 occurrences at lines 61, 64, 68) with `CHART_ACCENT` literal interpolation:
       ```tsx
       fill={CHART_ACCENT}
       stroke={CHART_ACCENT}
       /* median line: */ stroke={CHART_ACCENT}
       ```

    3. Whisker strokes (lines 52-54) — KEEP `"#94A3B8"` but pin via `CHART_TEXT_MUTED` token:
       ```tsx
       stroke={CHART_TEXT_MUTED}
       ```
       Per UI-SPEC §5: whiskers are strokes (not text fill) so A11Y-01 forbidden-as-text rule does NOT apply.

    4. Y-axis label text (line 37) — replace `fontFamily="'JetBrains Mono', monospace"` with `fontFamily={CHART_FONT_MONO}`. Replace `fill="#64748B"` with `fill={CHART_AXIS_TICK}`.

    5. X-axis period labels (line 70) — replace `fill="#64748B"` with `fill={CHART_AXIS_TICK}`.

    **D. src/components/charts/MonthlyHeatmap.tsx:**

    1. Replace the entire `cellColor` function (lines 9-19) with a function that returns explicit hex + opacity (no Tailwind classes):
       ```typescript
       interface CellStyle { backgroundColor: string; opacity: number; color: string; }
       function cellStyle(value: number): CellStyle {
         if (value > 0.10)  return { backgroundColor: "#16A34A", opacity: 1.0,  color: "#FFFFFF" };
         if (value > 0.05)  return { backgroundColor: "#16A34A", opacity: 0.7,  color: "#FFFFFF" };
         if (value > 0.02)  return { backgroundColor: "#16A34A", opacity: 0.4,  color: "#0F3D2D" };
         if (value > 0)     return { backgroundColor: "#16A34A", opacity: 0.15, color: "#0F3D2D" };
         if (value === 0)   return { backgroundColor: "#FFFFFF", opacity: 1.0,  color: "#94A3B8" };
         if (value > -0.02) return { backgroundColor: "#DC2626", opacity: 0.15, color: "#7F1D1D" };
         if (value > -0.05) return { backgroundColor: "#DC2626", opacity: 0.4,  color: "#7F1D1D" };
         if (value > -0.10) return { backgroundColor: "#DC2626", opacity: 0.7,  color: "#FFFFFF" };
         return { backgroundColor: "#DC2626", opacity: 1.0, color: "#FFFFFF" };
       }
       ```

    2. Update the cell render block to inline-style instead of Tailwind class:
       ```tsx
       {(() => {
         const v = data[year]?.[m];
         if (v == null) return (
           <div key={`${year}-${m}`} className="bg-surface px-1 py-2 text-center text-xs font-normal text-text-muted">
             {""}
           </div>
         );
         const s = cellStyle(v);
         return (
           <div
             key={`${year}-${m}`}
             className="px-1 py-2 text-center text-xs font-normal"
             style={{ backgroundColor: s.backgroundColor, opacity: s.opacity, color: s.color }}
             title={`${(v * 100).toFixed(1)}%`}
           >
             {`${(v * 100).toFixed(1)}%`}
           </div>
         );
       })()}
       ```

    3. Replace `font-medium` (3 occurrences at lines 27, 29, 36) with `font-normal` per type contract.

    4. Replace `font-metric` (line 44) with `font-normal tabular-nums`. Verify `font-metric` is a project Tailwind class first via `grep "font-metric" src/app/globals.css tailwind.config.*` — if it's defined as `font-mono tabular-nums` keep it; otherwise replace.

    5. Verify no `bg-emerald-*` / `bg-red-*` strings remain in the file.

    **E. src/components/charts/DailyHeatmap.tsx — wrap with React.memo (Grok W-01):**

    Modify the existing exports (post 14b-01 Task 2) so that the public `DailyHeatmap` symbol is the memoized version:

    1. At the top of the file, add `memo` to the React imports:
       ```typescript
       import { memo, useEffect, useRef } from "react";
       ```

    2. Rename the inner component to `DailyHeatmapInner` (keep its full implementation as-is from 14b-01 Task 2):
       ```typescript
       function DailyHeatmapInner({ data }: DailyHeatmapProps) {
         // ... existing 14b-01 implementation (SVG vs Canvas branch)
       }
       ```

    3. Re-export the memoized version as the default named export:
       ```typescript
       export const DailyHeatmap = memo(DailyHeatmapInner);
       ```

    4. The export name `DailyHeatmap` and its prop interface stay byte-identical — consumers (Plan 14b-02 Task 2 ReturnsDistributionPanel) import it the same way.

    5. **Do NOT customize `arePropsEqual`** — React's default shallow-compare on the `data` prop is sufficient. The consumer's responsibility (next task) is to pass a stable `data` reference via `useMemo`.

    **F. Co-located vitest test files (extend or create) for the 4 chart components + DailyHeatmap memo:**

    Add minimal coverage at `src/components/charts/ReturnHistogram.test.tsx`, `YearlyReturns.test.tsx`, `ReturnQuantiles.test.tsx`, `MonthlyHeatmap.test.tsx` covering test cases 1-9 above. If a test file exists, extend it; if not, create. Extend `src/components/charts/DailyHeatmap.test.tsx` (created in 14b-01 Task 2) with tests 10 + 11 above for the memo wrap.
  </action>
  <verify>
    <automated>npm test -- src/components/charts --run</automated>
  </verify>
  <done>
    - `npm test -- src/components/charts --run` passes with new color/identity assertions and DailyHeatmap memo behavior.
    - `grep -c "#0D9488" src/components/charts/ReturnQuantiles.tsx` returns 0.
    - `grep -c "#059669" src/components/charts/` (recursive) returns 0.
    - `grep -cE "bg-(emerald|red)-[0-9]" src/components/charts/MonthlyHeatmap.tsx` returns 0.
    - `grep -cE "tick=\\{\\{.*fontSize" src/components/charts/{ReturnHistogram,YearlyReturns}.tsx` returns 0 (no inline tick objects).
    - `grep -c "font-medium" src/components/charts/MonthlyHeatmap.tsx` returns 0.
    - `grep -c "memo(DailyHeatmapInner)" src/components/charts/DailyHeatmap.tsx` returns 1 (Grok W-01 — React.memo wrap).
    - `grep -c "export const DailyHeatmap = memo" src/components/charts/DailyHeatmap.tsx` returns 1.
    - `npm test -- tests/a11y/chart-contrast.test.ts --run` passes (no fill="#94A3B8" / "#718096" on text nodes regressions).
    - `npm test -- tests/visual/strategy-v2-type-scale.test.ts --run` passes.
    - `npm run build` exits 0.
  </done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: Ship ReturnsDistributionPanel wrapper + tests + useMemo-stabilized DailyHeatmap data prop (Grok W-01)</name>
  <files>src/components/strategy-v2/ReturnsDistributionPanel.tsx, src/components/strategy-v2/ReturnsDistributionPanel.test.tsx</files>
  <read_first>
    - .planning/phases/14b-single-strategy-v2-lazy-panels-trade-exposure/14B-UI-SPEC.md §3.1 (full Panel 4 spec — H3 sub-headings, layout, props for each sub-component)
    - .planning/phases/14b-single-strategy-v2-lazy-panels-trade-exposure/14B-UI-SPEC.md §4.3 (Panel 4 partial-data thresholds: panel-level <30d, sub-DailyHeatmap <30d, sub-YearlyReturns <365d)
    - src/components/strategy-v2/DrawdownPanel.tsx (Phase 14a precedent — H2 + sub-headings + partial-data routing pattern)
    - src/components/strategy-v2/HeadlineMetricsPanel.tsx (Phase 14a precedent — multi-sub-section panel layout)
    - src/components/strategy-v2/PartialDataBanner.tsx (reused as-is)
    - src/components/strategy-v2/LazyPanelPlaceholder.tsx (chrome pattern — `<section data-panel>` shape, mt-8 / min-h-[240px] / p-6 / rounded-lg / bg-surface / border-border / shadow-card)
    - src/components/charts/MonthlyHeatmap.tsx (post-task-1 — verifies new shape)
    - src/components/charts/DailyHeatmap.tsx (post-task-1 — now memoized; consumer MUST stabilize data prop reference per Grok W-01)
    - src/components/charts/{ReturnHistogram,ReturnQuantiles,YearlyReturns}.tsx (post-task-1)
  </read_first>
  <behavior>
    - Test 1 (chrome): Renders `<section data-panel="returns-distribution" data-panel-status="..." aria-label="Returns distribution">` with 14a panel chrome classes (`mt-8 min-h-[240px] rounded-lg border border-border bg-surface p-6 shadow-card`).
    - Test 2 (panel-level partial data): With `history_days={20}`, body renders `<PartialDataBanner heading="Awaiting more data" body="This strategy needs at least 30 days of trading history to populate Returns distribution." />` and NONE of the 5 sub-charts render. data-panel-status attribute reflects current lazy state (placeholder/loading/ready/error).
    - Test 3 (placeholder before intersection): With `history_days={365}` and observer not yet fired, renders `data-panel-status="placeholder"` + H2 heading only, no sub-charts mounted.
    - Test 4 (loading state): When status='loading', renders H2 + centered "Loading…" copy (Unicode U+2026, NOT three periods) inside `aria-live="polite"`. No sub-charts rendered yet.
    - Test 5 (ready full): When status='ready', `history_days={365}`, eager analytics has `monthly_returns` + `return_quantiles` + `returns_series` and lazy payload has `daily_returns_grid`, all 5 sub-charts render in order: H3 "Monthly heatmap" → MonthlyHeatmap; H3 "Daily heatmap" → DailyHeatmap; H3 "Return histogram" → ReturnHistogram; H3 "Return quantiles" → ReturnQuantiles; H3 "Yearly returns" → YearlyReturns.
    - Test 6 (sub-section banner — DailyHeatmap, history_days >= 30 but daily_returns_grid empty): Renders MonthlyHeatmap full + DailyHeatmap region replaced with text "Daily heatmap activates after 30 days of trading history." + the rest full. (This guards against backend payload arriving empty.)
    - Test 7 (sub-section banner — YearlyReturns at history_days < 365): With history_days=180, renders Monthly + Daily + Histogram + Quantiles full; YearlyReturns region replaced with "Yearly returns activates after 1 year of trading history."
    - Test 8 (error state): When status='error', renders `<PartialDataBanner heading="Couldn't load this section" body="Refresh the page to retry. The other panels still work." />`.
    - Test 9 (H3 sub-headings): All 5 H3s render with classes `text-xs font-normal uppercase tracking-wider text-text-secondary`. Forbidden classes (`font-medium`, `text-sm`, `text-xl`) absent.
    - Test 10 (no inline `{` tick objects): `<ReturnsDistributionPanel>` source emits zero `tick={{` literal-object spreads.
    - **Test 11 (Grok W-01 — useMemo on DailyHeatmap data):** The `data` prop passed to `<DailyHeatmap data={...} />` is wrapped with `useMemo` whose dependency is `data?.daily_returns_grid` from the hook payload — NOT a fresh array literal each render. Verified by source grep: `grep -c "useMemo.*daily_returns_grid" src/components/strategy-v2/ReturnsDistributionPanel.tsx` ≥ 1.
    - **Test 12 (Grok W-01 — re-render budget):** Mock the hook to drive status transitions idle → loading → ready → ready (second ready emits, same data reference). Render the panel and observe DailyHeatmap's child fillRect spy. Across the 4 status transitions, DailyHeatmap's Canvas paints exactly ONCE (on the first 'ready') because (a) it's wrapped in React.memo (Task 1.E) and (b) the data prop reference is stabilized via useMemo (this task).
  </behavior>
  <action>
    Create `src/components/strategy-v2/ReturnsDistributionPanel.tsx`:

    ```typescript
    "use client";

    import { useMemo } from "react";
    import { useLazyPanelMetrics } from "@/hooks/useLazyPanelMetrics";
    import { PartialDataBanner } from "./PartialDataBanner";
    import { MonthlyHeatmap } from "@/components/charts/MonthlyHeatmap";
    import { DailyHeatmap } from "@/components/charts/DailyHeatmap";
    import { ReturnHistogram } from "@/components/charts/ReturnHistogram";
    import { ReturnQuantiles } from "@/components/charts/ReturnQuantiles";
    import { YearlyReturns } from "@/components/charts/YearlyReturns";

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

    export function ReturnsDistributionPanel(props: ReturnsDistributionPanelProps) {
      const { ref, data, status } = useLazyPanelMetrics<Panel4LazyPayload>("panel4", {
        fetchOnIntersect: true,
        strategyId: props.strategyId,
      });

      // Grok W-01 mitigation: stabilize the data-prop reference passed to the
      // memoized DailyHeatmap. Without this, parent re-renders during status
      // transitions (idle → loading → ready) create fresh array references on
      // each render — which would defeat React.memo's shallow compare and
      // re-trigger the Canvas paint useEffect. Stabilizing here keeps the
      // 5y / 1825-cell paint budget under <300ms (UI-SPEC §3.5 perf budget).
      const dailyReturnsData = useMemo(
        () => data?.daily_returns_grid ?? [],
        [data?.daily_returns_grid],
      );

      const panelLevelGated = props.history_days < 30;

      return (
        <section
          ref={ref}
          data-panel="returns-distribution"
          data-panel-status={status === "idle" ? "placeholder" : status}
          aria-label="Returns distribution"
          className="mt-8 min-h-[240px] rounded-lg border border-border bg-surface p-6 shadow-card"
        >
          <h2 className="text-base font-semibold text-text-primary">Returns distribution</h2>

          {/* Panel-level partial-data banner short-circuits sub-section render */}
          {panelLevelGated ? (
            <div className="mt-4">
              <PartialDataBanner
                heading="Awaiting more data"
                body="This strategy needs at least 30 days of trading history to populate Returns distribution."
              />
            </div>
          ) : status === "idle" || status === "loading" ? (
            <div
              aria-live="polite"
              className="mt-4 flex items-center justify-center text-xs font-normal text-text-muted"
              style={{ minHeight: 180 }}
            >
              {"Loading…"}
            </div>
          ) : status === "error" ? (
            <div className="mt-4">
              <PartialDataBanner
                heading="Couldn't load this section"
                body="Refresh the page to retry. The other panels still work."
              />
            </div>
          ) : (
            // status === 'ready'
            <div className="mt-4 space-y-6">
              <SubSection title="Monthly heatmap">
                {props.monthly_returns ? (
                  <MonthlyHeatmap data={props.monthly_returns} />
                ) : (
                  <SubBanner body="Monthly heatmap unavailable for this strategy." />
                )}
              </SubSection>

              <SubSection title="Daily heatmap">
                {dailyReturnsData.length > 0 ? (
                  <DailyHeatmap data={dailyReturnsData} />
                ) : (
                  <SubBanner body="Daily heatmap activates after 30 days of trading history." />
                )}
              </SubSection>

              <SubSection title="Return histogram">
                {props.returns_series && props.returns_series.length >= 10 ? (
                  <ReturnHistogram
                    returns={props.returns_series}
                    benchmarkReturns={props.benchmark_returns ?? undefined}
                  />
                ) : (
                  <SubBanner body="Return histogram unavailable for this strategy." />
                )}
              </SubSection>

              <SubSection title="Return quantiles">
                {props.return_quantiles && Object.keys(props.return_quantiles).length > 0 ? (
                  <ReturnQuantiles data={props.return_quantiles} />
                ) : (
                  <SubBanner body="Return quantiles unavailable for this strategy." />
                )}
              </SubSection>

              <SubSection title="Yearly returns">
                {props.history_days >= 365 && props.monthly_returns ? (
                  <YearlyReturns monthlyReturns={props.monthly_returns} />
                ) : (
                  <SubBanner body="Yearly returns activates after 1 year of trading history." />
                )}
              </SubSection>
            </div>
          )}
        </section>
      );
    }

    function SubSection({ title, children }: { title: string; children: React.ReactNode }) {
      return (
        <div>
          <h3 className="mb-4 text-xs font-normal uppercase tracking-wider text-text-secondary">
            {title}
          </h3>
          {children}
        </div>
      );
    }

    function SubBanner({ body }: { body: string }) {
      return (
        <p className="text-xs font-normal text-text-muted">
          {body}
        </p>
      );
    }
    ```

    Concrete values to keep stable (grep contract for downstream tests):
    - `data-panel="returns-distribution"` (kebab-case)
    - H2 copy: `Returns distribution` (sentence-case)
    - Panel-level banner copy: `This strategy needs at least 30 days of trading history to populate Returns distribution.` (verbatim)
    - DailyHeatmap sub-banner: `Daily heatmap activates after 30 days of trading history.` (verbatim)
    - YearlyReturns sub-banner: `Yearly returns activates after 1 year of trading history.` (verbatim)
    - Loading copy: `Loading…` (Unicode ellipsis)
    - Error heading: `Couldn't load this section` (curly apostrophe — copy verbatim)
    - Error body: `Refresh the page to retry. The other panels still work.`
    - **useMemo-stabilized data prop on DailyHeatmap (Grok W-01)** — `dailyReturnsData` is the variable name; depend on `data?.daily_returns_grid`.

    Create `src/components/strategy-v2/ReturnsDistributionPanel.test.tsx` with all 12 behaviours. Use `vi.mock("@/hooks/useLazyPanelMetrics")` to drive `status` / `data` directly per test (renders the hook return value as a controlled prop) — this is the same pattern used in HeadlineMetricsPanel.test.tsx (Phase 14a precedent).
  </action>
  <verify>
    <automated>npm test -- src/components/strategy-v2/ReturnsDistributionPanel.test.tsx --run</automated>
  </verify>
  <done>
    - `npm test -- src/components/strategy-v2/ReturnsDistributionPanel.test.tsx --run` passes 12/12.
    - `grep -c "data-panel=\"returns-distribution\"" src/components/strategy-v2/ReturnsDistributionPanel.tsx` returns 1.
    - `grep -c "useLazyPanelMetrics<Panel4LazyPayload>(\"panel4\"" src/components/strategy-v2/ReturnsDistributionPanel.tsx` returns 1.
    - `grep -c "fetchOnIntersect: true" src/components/strategy-v2/ReturnsDistributionPanel.tsx` returns 1.
    - `grep -cE "(font-medium|text-sm|text-xl|text-2xl)" src/components/strategy-v2/ReturnsDistributionPanel.tsx` returns 0.
    - `grep -c "Loading\\\\u2026" src/components/strategy-v2/ReturnsDistributionPanel.tsx` returns 1 (or `Loading…` if the build prefers the literal — pick one and grep verifies).
    - `grep -c "useMemo" src/components/strategy-v2/ReturnsDistributionPanel.tsx` ≥ 1 (Grok W-01 — stable data ref).
    - `grep -c "daily_returns_grid" src/components/strategy-v2/ReturnsDistributionPanel.tsx` ≥ 2 (interface + useMemo dep).
    - `npx tsc --noEmit` exits 0.
    - `npm run build` exits 0.
  </done>
</task>

</tasks>

<verification>
- `npm test -- src/components --run` all green (existing 14a + new 14b-02 tests).
- `npm test -- tests/a11y/chart-contrast.test.ts tests/visual/strategy-v2-type-scale.test.ts --run` green.
- `grep -rn "#0D9488\\|#059669" src/components/charts/` returns 0 hits.
- `grep -rnE "bg-(emerald|red)-[0-9]" src/components/charts/` returns 0 hits.
- `grep -c "memo(DailyHeatmapInner)" src/components/charts/DailyHeatmap.tsx` returns 1 (W-01 wrap).
- ReturnsDistributionPanel NOT yet imported by StrategyV2Shell (that's 14b-06).
</verification>

<success_criteria>
- KPI-06 panel body shipped (MonthlyHeatmap reused, DailyHeatmap mounted, 3 layout-only existing components reused).
- KPI-23b Panel 4 partial-data banner triggers below 30-day history; sub-section banners trigger on DailyHeatmap and YearlyReturns thresholds.
- DESIGN-01 audit closed for the 4 pre-existing chart components (#0D9488 → #1B6B5A; #059669 → #16A34A; bg-emerald/red palette → explicit hex; inline tick objects → CHART_TICK_STYLE).
- Grok W-01 mitigation: DailyHeatmap is memoized + consumer stabilizes the data prop ref via useMemo. Panel 4 status transitions do NOT re-paint the Canvas.
</success_criteria>

<output>
After completion, create `.planning/phases/14b-single-strategy-v2-lazy-panels-trade-exposure/14b-02-SUMMARY.md` documenting the four chart-component edits, the ReturnsDistributionPanel contract, the React.memo + useMemo pairing for Grok W-01, and any deviations.
</output>
