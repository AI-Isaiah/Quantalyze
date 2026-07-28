---
phase: 14a
plan: 03
type: execute
wave: 2
depends_on: [14a-01, 14a-02]
files_modified:
  - src/hooks/useLazyPanelMetrics.ts
  - src/components/strategy-v2/StrategyV2Shell.tsx
  - src/components/strategy-v2/OverviewPanel.tsx
  - src/components/strategy-v2/HeadlineMetricsPanel.tsx
  - src/components/strategy-v2/DrawdownPanel.tsx
  - src/components/strategy-v2/LazyPanelPlaceholder.tsx
  - src/components/strategy-v2/PartialDataBanner.tsx
  - src/components/strategy-v2/SegmentedControl.tsx
autonomous: true
requirements: [KPI-02, KPI-03, KPI-04, KPI-05, KPI-22, KPI-23a, DESIGN-02]
must_haves:
  truths:
    - "StrategyV2Shell renders exactly 7 <section data-panel> elements (panels 1–3 with eager bodies; panels 4–7 with placeholders)"
    - "Panels 4–7 carry data-panel-status='placeholder' attribute"
    - "Panels 1–3 carry the appropriate aria-label per UI-SPEC §4"
    - "Panel 2 segmented control: Cumulative + Underwater are click-functional; Rolling Sharpe + Log Returns have aria-disabled='true' and title='Available in Phase 14b'"
    - "Panel 2 BTC overlay default-ON (DIFF-03)"
    - "Panel 1 / Panel 2 KPI strip / Panel 3 each render the KPI-23a partial-data banner when relevant inputs are null"
    - "useLazyPanelMetrics hook is SSR-safe (typeof IntersectionObserver === 'undefined' short-circuit) and emits status='ready' on first intersect in 14a (fetchOnIntersect default false)"
    - "Panels using axis ticks spread CHART_TICK_STYLE (no inline tick={{...}} object literals)"
    - "Files under src/components/strategy-v2/ use only font-normal / font-semibold (zero font-medium / font-light / font-bold) and only text-xs / text-base / text-lg / text-[32px] (zero text-[11px] / text-[13px] / text-[14px] / text-sm / text-xl / text-2xl)"
  artifacts:
    - path: "src/hooks/useLazyPanelMetrics.ts"
      provides: "IntersectionObserver-based lifecycle hook for panels 4–7 (placeholder-only in 14a; fetch-wired in 14b)"
      exports: ["useLazyPanelMetrics", "LazyStatus", "LazyPanelId", "UseLazyPanelMetricsOptions"]
    - path: "src/components/strategy-v2/StrategyV2Shell.tsx"
      provides: "Page shell — page header (H1 + start_date + verified badge) + 7 sections + Disclaimer footer"
      contains: "data-panel="
    - path: "src/components/strategy-v2/OverviewPanel.tsx"
      provides: "Panel 1 6-cell overview row"
    - path: "src/components/strategy-v2/HeadlineMetricsPanel.tsx"
      provides: "Panel 2 6-cell KPI strip + segmented control + EquityCurve / DrawdownChart toggle"
    - path: "src/components/strategy-v2/DrawdownPanel.tsx"
      provides: "Panel 3 full-width DrawdownChart + WorstDrawdowns table"
    - path: "src/components/strategy-v2/LazyPanelPlaceholder.tsx"
      provides: "Panels 4–7 placeholder card with IntersectionObserver hook"
    - path: "src/components/strategy-v2/PartialDataBanner.tsx"
      provides: "Shared KPI-23a banner for panels 1–3"
    - path: "src/components/strategy-v2/SegmentedControl.tsx"
      provides: "Button-group with disabled-state support; v2-internal"
  key_links:
    - from: "src/components/strategy-v2/HeadlineMetricsPanel.tsx"
      to: "src/components/charts/EquityCurve.tsx + DrawdownChart.tsx"
      via: "import + sibling-mount inside segmented control"
      pattern: "from \"@/components/charts/EquityCurve\""
    - from: "src/components/strategy-v2/LazyPanelPlaceholder.tsx"
      to: "src/hooks/useLazyPanelMetrics.ts"
      via: "import"
      pattern: "from \"@/hooks/useLazyPanelMetrics\""
    - from: "src/components/strategy-v2/StrategyV2Shell.tsx"
      to: "src/lib/queries.ts:StrategyV2Detail"
      via: "type import for props shape"
      pattern: "StrategyV2Detail"
---

<objective>
Build the seven new strategy-v2 layout components and the IntersectionObserver hook that, together, render the 7-panel shell with eager bodies for panels 1–3 and IntersectionObserver-deferred placeholders for panels 4–7. Every component is small, has a single concern, and consumes the data shape produced by Plan 14A-02 (`StrategyV2Detail`) and the tokens shipped by Plan 14A-01 (`CHART_TICK_STYLE`).

Wave 2 — depends on Plan 14A-01 (chart tokens) AND Plan 14A-02 (data layer + flag reader).

Purpose: Compose existing primitives (EquityCurve, DrawdownChart, WorstDrawdowns, chart-tokens, partial-data thresholds) into the v2 page surface without forking the underlying chart components. Every panel reads pre-fetched data from props (no client-side fetches in 14a — the shell is server-rendered, panels 2-3 add `"use client"` only for interactivity).

Output: 7 new component files + 1 hook file under `src/components/strategy-v2/` and `src/hooks/`. No tests in this plan — Plan 14A-05 ships the test suite separately to keep this plan within budget.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/STATE.md
@.planning/ROADMAP.md
@.planning/phases/14a-single-strategy-v2-eager-panels-identity/14A-CONTEXT.md
@.planning/phases/14a-single-strategy-v2-eager-panels-identity/14A-UI-SPEC.md
@.planning/phases/14a-single-strategy-v2-eager-panels-identity/14A-RESEARCH.md
@.planning/phases/14a-single-strategy-v2-eager-panels-identity/14a-01-PLAN.md
@.planning/phases/14a-single-strategy-v2-eager-panels-identity/14a-02-PLAN.md
@DESIGN.md
@AGENTS.md
@src/components/charts/EquityCurve.tsx
@src/components/charts/DrawdownChart.tsx
@src/components/charts/WorstDrawdowns.tsx
@src/components/charts/chart-tokens.ts
@src/app/strategy/[id]/page.tsx
@src/app/(dashboard)/allocations/AllocationDashboardV2.tsx

<interfaces>
<!-- After Plan 14A-01: -->
```ts
// src/components/charts/chart-tokens.ts (post-Plan-14A-01)
export const CHART_TICK_STYLE = {
  fontFamily: CHART_FONT_MONO,
  fontSize: 12,
  fontVariantNumeric: "tabular-nums",
  fill: CHART_AXIS_TICK,
} as const;
```

<!-- After Plan 14A-02: -->
```ts
// src/lib/queries.ts (post-Plan-14A-02)
export interface StrategyV2Detail {
  strategy: Strategy;
  panel1: {
    supported_exchanges: string[];
    strategy_types: string[];
    subtypes: string[];
    markets: string[];
    leverage_range: string | null;
    avg_daily_turnover: number | null;
  };
  panel2Headline: {
    cumulative_return: number | null;
    cagr: number | null;
    sharpe: number | null;
    sortino: number | null;
    max_drawdown: number | null;
    volatility: number | null;
  };
  panel2Equity: {
    series: { date: string; value: number }[] | null;
    btc_overlay: { date: string; value: number }[] | null;
  };
  panel3: {
    drawdown_series: { date: string; value: number }[] | null;
    drawdown_episodes: unknown[] | null;
  };
  lazyKeys: ("panel4" | "panel5" | "panel6" | "panel7")[];
  history_days: number;
}
```

<!-- IntersectionObserver canonical pattern (verified at AllocationDashboardV2.tsx:147-188): -->
```ts
if (typeof IntersectionObserver === "undefined") return;  // SSR / test-without-stub guard
const observer = new IntersectionObserver(callback, { rootMargin: "200px" });
observer.observe(node);
// cleanup: observer.disconnect()
```

<!-- EquityCurve existing props (verified src/components/charts/EquityCurve.tsx top): expects equity series + optional benchmark series; has internal `showBenchmark` state. UI-SPEC §6 notes: "EquityCurve may also gain an optional `hideBenchmarkToggle?: boolean` prop so Panel 2 can suppress the internal checkbox in favor of its own panel-level checkbox" — executor's discretion. Recommended path: lift the BTC overlay control to panel level and add `hideBenchmarkToggle?: boolean` prop. -->

<!-- DrawdownChart props: takes drawdown_series + benchmark_series; existing client component; NO modifications needed (reuse as-is per CONTEXT.md). -->

<!-- WorstDrawdowns props: takes drawdown_episodes; existing client component with empty-state handling; NO modifications. -->
</interfaces>
</context>

<tasks>

<task type="auto" tdd="false">
  <name>Task 1: useLazyPanelMetrics hook + LazyPanelPlaceholder + PartialDataBanner + SegmentedControl</name>
  <files>src/hooks/useLazyPanelMetrics.ts, src/components/strategy-v2/LazyPanelPlaceholder.tsx, src/components/strategy-v2/PartialDataBanner.tsx, src/components/strategy-v2/SegmentedControl.tsx</files>
  <read_first>
    - src/app/(dashboard)/allocations/AllocationDashboardV2.tsx lines 130-200 (canonical IntersectionObserver pattern with SSR guard)
    - src/test-setup.ts (current global stubs — Plan 14A-05 will add IntersectionObserver next to existing ResizeObserver stub)
    - src/hooks/useMediaQuery.ts (existing hook style/conventions to mirror)
    - .planning/phases/14a-single-strategy-v2-eager-panels-identity/14A-UI-SPEC.md §4 (placeholder card structure: H2 heading + "Loading…" copy + min-h-[240px] + data-panel-status), §4 partial-data banner, §5.2 segmented control behavior, §5.3 hook signature, §7 copy
    - .planning/phases/14a-single-strategy-v2-eager-panels-identity/14A-RESEARCH.md Pattern 3 (IntersectionObserver hook signature) and Pitfall 4 (forbidden colors as text fill)
  </read_first>
  <behavior>
    - useLazyPanelMetrics hook returns `{ ref, data, status }` where ref is a ref-callback `(node: HTMLElement | null) => void`
    - On the server (`typeof IntersectionObserver === "undefined"`), the ref callback is a no-op when invoked with null; when invoked with a node it sets status='ready' immediately (test-friendly fallback per RESEARCH Pattern 3)
    - On the client, the ref callback wires `new IntersectionObserver(...)` with `rootMargin: opts.rootMargin ?? "200px"`, observes the node, and on first intersection sets status='ready' and unobserves the node (one-shot)
    - In 14a, `fetchOnIntersect` defaults `false` and the hook does NOT call `fetchStrategyLazyMetrics` — the inline comment explicitly notes this is the wiring location for 14b
    - LazyPanelPlaceholder renders a `<section data-panel data-panel-status="placeholder">` with the H2 heading prop and "Loading…" body (Unicode U+2026), `min-h-[240px]`, white card styling, `aria-label` prop pass-through, `aria-live="polite"`
    - PartialDataBanner is a server component that takes `{ heading: string, body: string }` and renders the banner per UI-SPEC §4 styling
    - SegmentedControl renders a `<div role="group" aria-label={label}>` containing buttons; supports `disabled` flag per option which renders `aria-disabled="true"` + `title="Available in Phase 14b"` + click no-op handler
  </behavior>
  <action>
1. Create `src/hooks/useLazyPanelMetrics.ts` with the following exact content (no fetch wiring in 14a — explicit comment marks the 14b wiring location):

```ts
"use client";

import { useEffect, useRef, useState } from "react";

export type LazyStatus = "idle" | "loading" | "error" | "ready";
export type LazyPanelId = "panel4" | "panel5" | "panel6" | "panel7";

export interface UseLazyPanelMetricsOptions {
  /** rootMargin for the IntersectionObserver. Defaults to "200px" (pre-mount before user reaches panel). */
  rootMargin?: string;
  /**
   * Phase 14b will set this to `true` to fire `fetchStrategyLazyMetrics`.
   * Phase 14a leaves this `false` — the hook only manages the
   * intersection lifecycle (placeholder-only).
   */
  fetchOnIntersect?: boolean;
}

/**
 * Phase 14a / KPI-22 — IntersectionObserver scaffold for panels 4–7.
 *
 * In 14a, this hook ONLY tracks intersection lifecycle and emits
 * `status='ready'` on first intersection. It does NOT invoke
 * `fetchStrategyLazyMetrics` — that consumer wiring lands in Phase 14b
 * with `fetchOnIntersect: true`.
 *
 * SSR-safe: short-circuits when `typeof IntersectionObserver === "undefined"`
 * (server, or tests without the stub at `src/test-setup.ts`).
 *
 * Pattern source: `AllocationDashboardV2.tsx:147-188` (canonical project IO pattern).
 */
export function useLazyPanelMetrics<T = unknown>(
  panelId: LazyPanelId,
  opts: UseLazyPanelMetricsOptions = {},
): { ref: (node: HTMLElement | null) => void; data: T | null; status: LazyStatus } {
  const [status, setStatus] = useState<LazyStatus>("idle");
  const [data] = useState<T | null>(null);
  const observerRef = useRef<IntersectionObserver | null>(null);

  useEffect(() => {
    return () => {
      observerRef.current?.disconnect();
      observerRef.current = null;
    };
  }, []);

  const ref = (node: HTMLElement | null) => {
    if (!node) return;
    if (typeof IntersectionObserver === "undefined") {
      // SSR or test environment without polyfill — emit ready immediately.
      setStatus("ready");
      return;
    }
    observerRef.current?.disconnect();
    observerRef.current = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          // Phase 14a: placeholder-only, no fetch.
          setStatus("ready");
          observerRef.current?.unobserve(entry.target);
          // Phase 14b wires fetch here:
          //   if (opts.fetchOnIntersect) {
          //     setStatus("loading");
          //     fetchStrategyLazyMetrics(strategyId, mapPanelToPanelId(panelId))
          //       .then(...).catch(() => setStatus("error"));
          //   }
        }
      },
      { rootMargin: opts.rootMargin ?? "200px" },
    );
    observerRef.current.observe(node);
  };

  return { ref, data, status };
}
```

2. Create `src/components/strategy-v2/LazyPanelPlaceholder.tsx`:

```tsx
"use client";

import { useLazyPanelMetrics, type LazyPanelId } from "@/hooks/useLazyPanelMetrics";

interface LazyPanelPlaceholderProps {
  panelId: LazyPanelId;
  heading: string;
  ariaLabel: string;
  dataPanelKey: string; // e.g. "returns-distribution"
}

export function LazyPanelPlaceholder({
  panelId,
  heading,
  ariaLabel,
  dataPanelKey,
}: LazyPanelPlaceholderProps) {
  const { ref } = useLazyPanelMetrics(panelId);

  return (
    <section
      ref={ref}
      data-panel={dataPanelKey}
      data-panel-status="placeholder"
      aria-label={ariaLabel}
      className="mt-8 min-h-[240px] rounded-lg border border-border bg-card p-6 shadow-[0_1px_3px_rgba(0,0,0,0.04)]"
    >
      <h2 className="text-base font-semibold text-text-primary">{heading}</h2>
      <div
        aria-live="polite"
        className="mt-4 flex items-center justify-center text-xs font-normal text-text-muted"
        style={{ minHeight: "180px" }}
      >
        Loading{"…"}
      </div>
    </section>
  );
}
```

Note: `Loading{"…"}` uses the Unicode horizontal ellipsis U+2026 per UI-SPEC §7 (NOT three periods).

3. Create `src/components/strategy-v2/PartialDataBanner.tsx` (server component — no `"use client"`):

```tsx
interface PartialDataBannerProps {
  heading: string;
  body: string;
}

export function PartialDataBanner({ heading, body }: PartialDataBannerProps) {
  return (
    <div className="mx-auto max-w-[480px] rounded-md border border-border bg-surface-subtle p-4 text-center">
      <p className="text-xs font-normal uppercase tracking-wider text-text-secondary">
        {heading}
      </p>
      <p className="mt-1 text-xs font-normal text-text-muted">{body}</p>
    </div>
  );
}
```

4. Create `src/components/strategy-v2/SegmentedControl.tsx`:

```tsx
"use client";

interface SegmentedOption {
  id: string;
  label: string;
  disabled?: boolean;
}

interface SegmentedControlProps {
  options: SegmentedOption[];
  activeId: string;
  onChange: (id: string) => void;
  ariaLabel: string;
}

export function SegmentedControl({
  options,
  activeId,
  onChange,
  ariaLabel,
}: SegmentedControlProps) {
  return (
    <div role="group" aria-label={ariaLabel} className="flex gap-2">
      {options.map((opt) => {
        const isActive = opt.id === activeId && !opt.disabled;
        if (opt.disabled) {
          return (
            <button
              key={opt.id}
              type="button"
              aria-disabled="true"
              title="Available in Phase 14b"
              onClick={(e) => e.preventDefault()}
              className="rounded-md border border-border bg-surface px-3 py-1.5 text-xs font-normal text-text-muted opacity-60 cursor-not-allowed"
            >
              {opt.label}
            </button>
          );
        }
        return (
          <button
            key={opt.id}
            type="button"
            aria-pressed={isActive}
            onClick={() => onChange(opt.id)}
            className={
              isActive
                ? "rounded-md border border-accent bg-card px-3 py-1.5 text-xs font-semibold text-accent"
                : "rounded-md border border-border bg-card px-3 py-1.5 text-xs font-normal text-text-secondary"
            }
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
```

5. Confirm `npm run typecheck` exits 0 and `npm run build` exits 0.
  </action>
  <verify>
    <automated>npx tsc --noEmit -p tsconfig.json 2>&amp;1 | grep -E "(strategy-v2|useLazyPanelMetrics)" || echo "TYPECHECK_OK"</automated>
  </verify>
  <acceptance_criteria>
    - File `src/hooks/useLazyPanelMetrics.ts` exists; `grep -n "export function useLazyPanelMetrics" src/hooks/useLazyPanelMetrics.ts` returns 1
    - File `src/components/strategy-v2/LazyPanelPlaceholder.tsx` exists
    - File `src/components/strategy-v2/PartialDataBanner.tsx` exists
    - File `src/components/strategy-v2/SegmentedControl.tsx` exists
    - `grep -n "data-panel-status=\"placeholder\"" src/components/strategy-v2/LazyPanelPlaceholder.tsx` returns 1 match
    - `grep -nE 'Loading\{"\\\\u2026"\}|Loading\\\\u2026' src/components/strategy-v2/LazyPanelPlaceholder.tsx` returns 1 match (Unicode U+2026 literal)
    - `grep -n "min-h-\\[240px\\]" src/components/strategy-v2/LazyPanelPlaceholder.tsx` returns 1 match
    - `grep -n "aria-disabled=\"true\"" src/components/strategy-v2/SegmentedControl.tsx` returns 1 match
    - `grep -n "title=\"Available in Phase 14b\"" src/components/strategy-v2/SegmentedControl.tsx` returns 1 match
    - `grep -n "typeof IntersectionObserver === \"undefined\"" src/hooks/useLazyPanelMetrics.ts` returns 1 match
    - `grep -n "rootMargin: opts.rootMargin ?? \"200px\"" src/hooks/useLazyPanelMetrics.ts` returns 1 match
    - `grep -nE "font-medium|font-light|font-bold" src/components/strategy-v2/LazyPanelPlaceholder.tsx src/components/strategy-v2/SegmentedControl.tsx src/components/strategy-v2/PartialDataBanner.tsx` returns ZERO matches
    - `grep -nE "text-\\[11px\\]|text-\\[13px\\]|text-\\[14px\\]|text-sm|text-xl|text-2xl" src/components/strategy-v2/LazyPanelPlaceholder.tsx src/components/strategy-v2/SegmentedControl.tsx src/components/strategy-v2/PartialDataBanner.tsx` returns ZERO matches
    - `npx tsc --noEmit` exits 0
  </acceptance_criteria>
  <done>Hook + 3 small components shipped; SSR-safe; UI-SPEC type-scale and weight contracts honored; tsc clean.</done>
</task>

<task type="auto" tdd="false">
  <name>Task 2: OverviewPanel + DrawdownPanel (server components — eager bodies for panels 1 and 3)</name>
  <files>src/components/strategy-v2/OverviewPanel.tsx, src/components/strategy-v2/DrawdownPanel.tsx</files>
  <read_first>
    - src/components/strategy-v2/PartialDataBanner.tsx (post-Task-1; the shared banner consumer)
    - src/components/charts/DrawdownChart.tsx (full file — confirm props shape; this is the "use client" Recharts component reused as-is for Panel 3)
    - src/components/charts/WorstDrawdowns.tsx (full file — confirm props shape; reused as-is)
    - src/lib/queries.ts (post-Plan-14A-02; confirm `StrategyV2Detail` shape used as prop)
    - src/lib/types.ts (Strategy interface — confirm field names for Panel 1)
    - .planning/phases/14a-single-strategy-v2-eager-panels-identity/14A-UI-SPEC.md §4 Panel 1 + Panel 3 layouts, §7 Panel 1 + Panel 3 copy, §4 partial-data banner thresholds (Panel 1 = 1 day; Panel 3 = 30 days for chart, Worst 5 reuses existing empty state)
  </read_first>
  <behavior>
    - OverviewPanel renders `<section data-panel="overview" aria-label="Overview">` with H2 "Overview", a 6-cell grid (DM Sans 12px label + Geist Mono 18px semibold value), and falls back to em-dash `—` for null/empty cells; if `history_days < 1` renders the partial-data banner instead of the cells
    - DrawdownPanel renders `<section data-panel="drawdown" aria-label="Drawdown analysis">` with H2 "Drawdown", H3 "Drawdown" → DrawdownChart, hairline divider, H3 "Worst 5 Drawdowns" → WorstDrawdowns; if `history_days < 30` renders partial-data banner for the chart only (Worst 5 reuses existing empty-state copy)
    - Both components are server components (no `"use client"` at top — they receive pre-fetched data as props)
    - All cells use the v2 type contract (text-xs / text-base / text-lg / text-[32px], font-normal / font-semibold only)
  </behavior>
  <action>
1. Create `src/components/strategy-v2/OverviewPanel.tsx` (server component):

```tsx
import type { StrategyV2Detail } from "@/lib/queries";
import { PartialDataBanner } from "./PartialDataBanner";

interface OverviewPanelProps {
  panel1: StrategyV2Detail["panel1"];
  history_days: number;
}

const EM_DASH = "—";

function fmtList(values: string[] | null | undefined): string {
  if (!values || values.length === 0) return EM_DASH;
  return values.join(", ");
}

function fmtNumber(value: number | null): string {
  if (value === null || value === undefined) return EM_DASH;
  return value.toLocaleString();
}

function fmtString(value: string | null): string {
  if (!value) return EM_DASH;
  return value;
}

export function OverviewPanel({ panel1, history_days }: OverviewPanelProps) {
  const showBanner = history_days < 1;

  return (
    <section
      data-panel="overview"
      aria-label="Overview"
      className="mt-8 rounded-lg border border-border bg-card p-6 shadow-[0_1px_3px_rgba(0,0,0,0.04)]"
    >
      <h2 className="text-base font-semibold text-text-primary">Overview</h2>

      {showBanner ? (
        <div className="mt-4">
          <PartialDataBanner
            heading="Awaiting more data"
            body="This strategy needs at least 1 day of trading history to populate Overview."
          />
        </div>
      ) : (
        <dl className="mt-4 grid grid-cols-6 gap-3 max-md:grid-cols-3">
          <div>
            <dt className="text-xs font-normal text-text-muted">Supported exchanges</dt>
            <dd className="mt-1 text-lg font-semibold text-text-primary tabular-nums">
              {fmtList(panel1.supported_exchanges)}
            </dd>
          </div>
          <div>
            <dt className="text-xs font-normal text-text-muted">Types</dt>
            <dd className="mt-1 text-lg font-semibold text-text-primary tabular-nums">
              {fmtList(panel1.strategy_types)}
            </dd>
          </div>
          <div>
            <dt className="text-xs font-normal text-text-muted">Subtypes</dt>
            <dd className="mt-1 text-lg font-semibold text-text-primary tabular-nums">
              {fmtList(panel1.subtypes)}
            </dd>
          </div>
          <div>
            <dt className="text-xs font-normal text-text-muted">Markets</dt>
            <dd className="mt-1 text-lg font-semibold text-text-primary tabular-nums">
              {fmtList(panel1.markets)}
            </dd>
          </div>
          <div>
            <dt className="text-xs font-normal text-text-muted">Leverage</dt>
            <dd className="mt-1 text-lg font-semibold text-text-primary tabular-nums">
              {fmtString(panel1.leverage_range)}
            </dd>
          </div>
          <div>
            <dt className="text-xs font-normal text-text-muted">Avg DTO</dt>
            <dd className="mt-1 text-lg font-semibold text-text-primary tabular-nums">
              {fmtNumber(panel1.avg_daily_turnover)}
            </dd>
          </div>
        </dl>
      )}
    </section>
  );
}
```

2. Create `src/components/strategy-v2/DrawdownPanel.tsx`. Read the existing `DrawdownChart.tsx` and `WorstDrawdowns.tsx` first to confirm their exact prop signatures, then construct the panel using their existing imports. Skeleton:

```tsx
import type { StrategyV2Detail } from "@/lib/queries";
import { DrawdownChart } from "@/components/charts/DrawdownChart";
import { WorstDrawdowns } from "@/components/charts/WorstDrawdowns";
import { PartialDataBanner } from "./PartialDataBanner";

interface DrawdownPanelProps {
  panel3: StrategyV2Detail["panel3"];
  history_days: number;
}

export function DrawdownPanel({ panel3, history_days }: DrawdownPanelProps) {
  const showChartBanner = history_days < 30;

  return (
    <section
      data-panel="drawdown"
      aria-label="Drawdown analysis"
      className="mt-8 rounded-lg border border-border bg-card p-6 shadow-[0_1px_3px_rgba(0,0,0,0.04)]"
    >
      <h2 className="text-base font-semibold text-text-primary">Drawdown</h2>

      <h3 className="mt-4 text-xs font-normal uppercase tracking-wider text-text-secondary">Drawdown</h3>
      {showChartBanner ? (
        <div className="mt-4">
          <PartialDataBanner
            heading="Awaiting more data"
            body="This strategy needs at least 30 days of trading history to detect meaningful drawdowns."
          />
        </div>
      ) : (
        <div className="mt-4">
          <DrawdownChart {/* match DrawdownChart's actual prop signature; pass panel3.drawdown_series and any benchmark series */} />
        </div>
      )}

      <hr className="my-4 border-t border-border" />

      <h3 className="text-xs font-normal uppercase tracking-wider text-text-secondary">Worst 5 Drawdowns</h3>
      <div className="mt-4">
        <WorstDrawdowns {/* match WorstDrawdowns's actual prop signature; pass panel3.drawdown_episodes */} />
      </div>
    </section>
  );
}
```

Replace the `{/* match ... */}` placeholders by reading the existing components' actual prop signatures and passing the matching fields from `panel3`. If a required prop is missing from `StrategyV2Detail.panel3`, document the deviation in the SUMMARY rather than silently dropping a feature.

3. Confirm `npm run typecheck` exits 0 and `npm run build` exits 0.
  </action>
  <verify>
    <automated>npx tsc --noEmit -p tsconfig.json 2>&amp;1 | grep -E "(OverviewPanel|DrawdownPanel)" || echo "TYPECHECK_OK"</automated>
  </verify>
  <acceptance_criteria>
    - File `src/components/strategy-v2/OverviewPanel.tsx` exists
    - File `src/components/strategy-v2/DrawdownPanel.tsx` exists
    - `grep -n 'data-panel="overview"' src/components/strategy-v2/OverviewPanel.tsx` returns 1 match
    - `grep -n 'aria-label="Overview"' src/components/strategy-v2/OverviewPanel.tsx` returns 1 match
    - `grep -n 'data-panel="drawdown"' src/components/strategy-v2/DrawdownPanel.tsx` returns 1 match
    - `grep -n 'aria-label="Drawdown analysis"' src/components/strategy-v2/DrawdownPanel.tsx` returns 1 match
    - `grep -nE "Supported exchanges|Avg DTO" src/components/strategy-v2/OverviewPanel.tsx` returns at least 2 matches (cells use UI-SPEC §7 verbatim labels)
    - `grep -nE "Awaiting more data" src/components/strategy-v2/OverviewPanel.tsx src/components/strategy-v2/DrawdownPanel.tsx` returns at least 2 matches (one per panel partial-data banner)
    - `grep -n 'from "@/components/charts/DrawdownChart"' src/components/strategy-v2/DrawdownPanel.tsx` returns 1 match
    - `grep -n 'from "@/components/charts/WorstDrawdowns"' src/components/strategy-v2/DrawdownPanel.tsx` returns 1 match
    - `grep -nE "font-medium|font-light|font-bold" src/components/strategy-v2/OverviewPanel.tsx src/components/strategy-v2/DrawdownPanel.tsx` returns ZERO matches
    - `grep -nE "text-\\[11px\\]|text-\\[13px\\]|text-\\[14px\\]|text-sm|text-xl|text-2xl" src/components/strategy-v2/OverviewPanel.tsx src/components/strategy-v2/DrawdownPanel.tsx` returns ZERO matches
    - `grep -n "use client" src/components/strategy-v2/OverviewPanel.tsx src/components/strategy-v2/DrawdownPanel.tsx` returns ZERO matches (both are server components)
    - `npx tsc --noEmit` exits 0
  </acceptance_criteria>
  <done>Two server components shipped; UI-SPEC §4 layout structure honored; partial-data banners gated on history_days; existing DrawdownChart + WorstDrawdowns reused without forking; type-scale grep contract satisfied.</done>
</task>

<task type="auto" tdd="false">
  <name>Task 3: HeadlineMetricsPanel (Panel 2 — KPI strip + segmented control + chart toggle) and StrategyV2Shell</name>
  <files>src/components/strategy-v2/HeadlineMetricsPanel.tsx, src/components/strategy-v2/StrategyV2Shell.tsx</files>
  <read_first>
    - src/components/charts/EquityCurve.tsx (full file — read AFTER Plan 14A-01's hex audit; confirm whether the BTC overlay state is internal or controllable via prop; if internal, executor must add a `hideBenchmarkToggle?: boolean` prop per UI-SPEC §6 to suppress the duplicate per-component checkbox when mounted inside Panel 2)
    - src/components/charts/DrawdownChart.tsx (props for the "Underwater" toggle inside Panel 2)
    - src/components/strategy-v2/SegmentedControl.tsx (post-Task-1 — the active/disabled button-group consumer)
    - src/components/strategy-v2/PartialDataBanner.tsx
    - src/components/strategy-v2/OverviewPanel.tsx (post-Task-2)
    - src/components/strategy-v2/DrawdownPanel.tsx (post-Task-2)
    - src/components/strategy-v2/LazyPanelPlaceholder.tsx (post-Task-1)
    - src/app/strategy/[id]/page.tsx (the v1 page — confirm header layout: H1 + verified badge + start_date pattern around line 121 per UI-SPEC §7 reference)
    - src/lib/queries.ts (StrategyV2Detail shape)
    - .planning/phases/14a-single-strategy-v2-eager-panels-identity/14A-UI-SPEC.md §4 Panel 2 layout, §5.2 segmented control behavior, §7 Panel 2 copy, §4 top-level shell structure (7 sections, max-w-[1200px], px-6 py-12, space-y-8)
  </read_first>
  <behavior>
    - HeadlineMetricsPanel is a `"use client"` component because it owns segmented control state (active button) + BTC overlay checkbox state
    - Panel 2 KPI strip: 6 cells with verbatim labels "Cum return", "CAGR", "Sharpe", "Sortino", "Max DD", "Vol"; values formatted via existing project number-format helpers (Cum return / CAGR / Max DD / Vol render as percent; Sharpe / Sortino render as 2-decimal number); positive values get `text-positive` (#16A34A), negative get `text-negative` (#DC2626); null renders em-dash
    - When `history_days < 30`, render the KPI-strip partial-data banner ("This strategy needs at least 30 days of trading history for stable Sharpe and Sortino estimates.") in place of the strip
    - When `history_days < 7`, render the equity-chart partial-data banner ("This strategy needs at least 7 days of equity history.") in place of the chart
    - SegmentedControl renders 4 options: `cumulative` (active default), `underwater`, `rolling_sharpe` (disabled), `log_returns` (disabled)
    - On `cumulative` active: mount `<EquityCurve>` with the strategy series + (when checkbox is ON) BTC overlay
    - On `underwater` active: mount `<DrawdownChart>` with the strategy drawdown series + (when checkbox is ON) BTC underwater overlay
    - BTC overlay checkbox default-ON (DIFF-03); label "BTC benchmark"; if `panel2Equity.btc_overlay` is null, hide the checkbox entirely and render the strategy series solo
    - StrategyV2Shell is a server component that takes `StrategyV2Detail` as props and renders: `<main>` → `<div max-w-[1200px] px-6 py-12>` → `<header>` (H1 = strategy.name in Instrument Serif 32px; sub = "Live since {start_date}" when present) → 7 sections in order → `<Disclaimer variant="strategy" />` footer
    - The 7 sections rendered in order: OverviewPanel → HeadlineMetricsPanel → DrawdownPanel → LazyPanelPlaceholder×4 (panel4 returns-distribution / panel5 rolling / panel6 trades / panel7 exposure)
  </behavior>
  <action>
1. Read EquityCurve.tsx (post-Plan-14A-01) to determine whether to (a) lift the BTC checkbox to Panel 2 level by adding a `hideBenchmarkToggle?: boolean` prop on `<EquityCurve>` (executor's discretion per CONTEXT.md), or (b) leave EquityCurve's internal checkbox and not render a Panel-2-level checkbox. **Recommended:** path (a) — UI-SPEC §4 explicitly notes "render exactly once above the chart (NOT inside each chart's per-component header)". Implement by:
   - Adding `hideBenchmarkToggle?: boolean` to `EquityCurveProps`
   - Inside EquityCurve, when `hideBenchmarkToggle === true`, the existing internal checkbox JSX is omitted (the underlying `showBenchmark` boolean becomes a prop instead of internal state — accept it as `controlledShowBenchmark?: boolean` or similar)
   - This is a 1-prop addition; do NOT fork the file or rewrite its chart logic

2. Create `src/components/strategy-v2/HeadlineMetricsPanel.tsx`:

```tsx
"use client";

import { useState } from "react";
import type { StrategyV2Detail } from "@/lib/queries";
import { EquityCurve } from "@/components/charts/EquityCurve";
import { DrawdownChart } from "@/components/charts/DrawdownChart";
import { SegmentedControl } from "./SegmentedControl";
import { PartialDataBanner } from "./PartialDataBanner";

interface HeadlineMetricsPanelProps {
  panel2Headline: StrategyV2Detail["panel2Headline"];
  panel2Equity: StrategyV2Detail["panel2Equity"];
  history_days: number;
}

const EM_DASH = "—";

function fmtPct(value: number | null): string {
  if (value === null || value === undefined) return EM_DASH;
  return `${(value * 100).toFixed(2)}%`;
}

function fmtRatio(value: number | null): string {
  if (value === null || value === undefined) return EM_DASH;
  return value.toFixed(2);
}

function signColor(value: number | null): string {
  if (value === null || value === undefined) return "text-text-primary";
  if (value > 0) return "text-positive";
  if (value < 0) return "text-negative";
  return "text-text-primary";
}

export function HeadlineMetricsPanel({
  panel2Headline,
  panel2Equity,
  history_days,
}: HeadlineMetricsPanelProps) {
  const [activeView, setActiveView] = useState<"cumulative" | "underwater">("cumulative");
  const [showBenchmark, setShowBenchmark] = useState<boolean>(true); // DIFF-03 default-ON

  const showKpiBanner = history_days < 30;
  const showChartBanner = history_days < 7;
  const benchmarkAvailable = panel2Equity.btc_overlay !== null;

  const segOptions = [
    { id: "cumulative", label: "Cumulative" },
    { id: "underwater", label: "Underwater" },
    { id: "rolling_sharpe", label: "Rolling Sharpe", disabled: true },
    { id: "log_returns", label: "Log returns", disabled: true },
  ];

  return (
    <section
      data-panel="headline-equity"
      aria-label="Headline metrics & equity vs BTC"
      className="mt-8 rounded-lg border border-border bg-card p-6 shadow-[0_1px_3px_rgba(0,0,0,0.04)]"
    >
      <h2 className="text-base font-semibold text-text-primary">Headline metrics</h2>

      {showKpiBanner ? (
        <div className="mt-4">
          <PartialDataBanner
            heading="Awaiting more data"
            body="This strategy needs at least 30 days of trading history for stable Sharpe and Sortino estimates."
          />
        </div>
      ) : (
        <dl className="mt-4 grid grid-cols-6 gap-3 max-md:grid-cols-3">
          <div>
            <dt className="text-xs font-normal text-text-muted">Cum return</dt>
            <dd className={`mt-1 text-lg font-semibold tabular-nums ${signColor(panel2Headline.cumulative_return)}`}>
              {fmtPct(panel2Headline.cumulative_return)}
            </dd>
          </div>
          <div>
            <dt className="text-xs font-normal text-text-muted">CAGR</dt>
            <dd className={`mt-1 text-lg font-semibold tabular-nums ${signColor(panel2Headline.cagr)}`}>
              {fmtPct(panel2Headline.cagr)}
            </dd>
          </div>
          <div>
            <dt className="text-xs font-normal text-text-muted">Sharpe</dt>
            <dd className="mt-1 text-lg font-semibold text-text-primary tabular-nums">
              {fmtRatio(panel2Headline.sharpe)}
            </dd>
          </div>
          <div>
            <dt className="text-xs font-normal text-text-muted">Sortino</dt>
            <dd className="mt-1 text-lg font-semibold text-text-primary tabular-nums">
              {fmtRatio(panel2Headline.sortino)}
            </dd>
          </div>
          <div>
            <dt className="text-xs font-normal text-text-muted">Max DD</dt>
            <dd className="mt-1 text-lg font-semibold text-negative tabular-nums">
              {fmtPct(panel2Headline.max_drawdown)}
            </dd>
          </div>
          <div>
            <dt className="text-xs font-normal text-text-muted">Vol</dt>
            <dd className="mt-1 text-lg font-semibold text-text-primary tabular-nums">
              {fmtPct(panel2Headline.volatility)}
            </dd>
          </div>
        </dl>
      )}

      <hr className="my-4 border-t border-border" />

      <h3 className="text-xs font-normal uppercase tracking-wider text-text-secondary">Equity vs BTC</h3>

      <div className="mt-4 flex items-center justify-between">
        <SegmentedControl
          options={segOptions}
          activeId={activeView}
          onChange={(id) => {
            if (id === "cumulative" || id === "underwater") setActiveView(id);
          }}
          ariaLabel="Equity chart view"
        />

        {benchmarkAvailable ? (
          <label className="flex items-center gap-2 text-xs font-normal text-text-secondary">
            <input
              type="checkbox"
              checked={showBenchmark}
              onChange={(e) => setShowBenchmark(e.target.checked)}
            />
            BTC benchmark
          </label>
        ) : null}
      </div>

      <div className="mt-4">
        {showChartBanner ? (
          <PartialDataBanner
            heading="Awaiting more data"
            body="This strategy needs at least 7 days of equity history."
          />
        ) : activeView === "cumulative" ? (
          <EquityCurve
            {/* match EquityCurve's actual prop signature post-Plan-14A-01;
                pass panel2Equity.series + (showBenchmark ? panel2Equity.btc_overlay : null);
                set hideBenchmarkToggle={true} so EquityCurve does NOT render its own checkbox */}
          />
        ) : (
          <DrawdownChart
            {/* match DrawdownChart's actual prop signature; pass drawdown series for the strategy +
                (showBenchmark ? underwater overlay : null) */}
          />
        )}
      </div>
    </section>
  );
}
```

3. Create `src/components/strategy-v2/StrategyV2Shell.tsx` (server component):

```tsx
import type { StrategyV2Detail } from "@/lib/queries";
import { OverviewPanel } from "./OverviewPanel";
import { HeadlineMetricsPanel } from "./HeadlineMetricsPanel";
import { DrawdownPanel } from "./DrawdownPanel";
import { LazyPanelPlaceholder } from "./LazyPanelPlaceholder";
import { Disclaimer } from "@/components/ui/Disclaimer";

interface StrategyV2ShellProps {
  detail: StrategyV2Detail;
}

export function StrategyV2Shell({ detail }: StrategyV2ShellProps) {
  const { strategy, panel1, panel2Headline, panel2Equity, panel3, history_days } = detail;

  return (
    <main className="min-h-screen bg-page">
      <div className="mx-auto max-w-[1200px] px-6 py-12">
        <header className="mb-8">
          <h1
            className="text-text-primary"
            style={{ fontFamily: "var(--font-serif), serif", fontSize: "32px", fontWeight: 400, lineHeight: 1.1 }}
          >
            {strategy.name}
          </h1>
          {strategy.start_date ? (
            <p className="mt-2 text-xs font-normal text-text-muted">
              Live since {strategy.start_date}
            </p>
          ) : null}
        </header>

        <OverviewPanel panel1={panel1} history_days={history_days} />

        <HeadlineMetricsPanel
          panel2Headline={panel2Headline}
          panel2Equity={panel2Equity}
          history_days={history_days}
        />

        <DrawdownPanel panel3={panel3} history_days={history_days} />

        <LazyPanelPlaceholder
          panelId="panel4"
          dataPanelKey="returns-distribution"
          ariaLabel="Returns distribution"
          heading="Returns distribution"
        />
        <LazyPanelPlaceholder
          panelId="panel5"
          dataPanelKey="rolling"
          ariaLabel="Rolling metrics"
          heading="Rolling metrics"
        />
        <LazyPanelPlaceholder
          panelId="panel6"
          dataPanelKey="trades"
          ariaLabel="Trades & positions"
          heading="Trades &amp; positions"
        />
        <LazyPanelPlaceholder
          panelId="panel7"
          dataPanelKey="exposure"
          ariaLabel="Exposure & benchmark greeks"
          heading="Exposure &amp; benchmark greeks"
        />

        <div className="mt-8">
          <Disclaimer variant="strategy" />
        </div>
      </div>
    </main>
  );
}
```

If `<Disclaimer>` does not exist at `src/components/ui/Disclaimer.tsx` or does not accept `variant="strategy"`, omit the import and render a minimal text disclaimer instead — document the deviation in SUMMARY.

4. Run `npm run typecheck` and `npm run build` to confirm no broken imports. If `EquityCurve` was modified in step 1, run the existing EquityCurve tests (if any) to confirm no regression.
  </action>
  <verify>
    <automated>npx tsc --noEmit -p tsconfig.json 2>&amp;1 | grep -E "(StrategyV2Shell|HeadlineMetricsPanel)" || echo "TYPECHECK_OK"</automated>
  </verify>
  <acceptance_criteria>
    - File `src/components/strategy-v2/HeadlineMetricsPanel.tsx` exists; first non-comment line contains `"use client"`
    - File `src/components/strategy-v2/StrategyV2Shell.tsx` exists; first non-comment line is NOT `"use client"` (server component)
    - `grep -n 'data-panel="headline-equity"' src/components/strategy-v2/HeadlineMetricsPanel.tsx` returns 1 match
    - `grep -nE "Cum return|CAGR|Sharpe|Sortino|Max DD|Vol" src/components/strategy-v2/HeadlineMetricsPanel.tsx` returns at least 6 matches (one per cell label)
    - `grep -n "BTC benchmark" src/components/strategy-v2/HeadlineMetricsPanel.tsx` returns 1 match
    - `grep -nE "Cumulative|Underwater|Rolling Sharpe|Log returns" src/components/strategy-v2/HeadlineMetricsPanel.tsx` returns at least 4 matches
    - `grep -nE "rolling_sharpe.*disabled: true|disabled: true.*rolling_sharpe" src/components/strategy-v2/HeadlineMetricsPanel.tsx` returns at least 1 match (Rolling Sharpe is the disabled option)
    - `grep -n 'aria-label="Equity chart view"' src/components/strategy-v2/HeadlineMetricsPanel.tsx` returns 1 match
    - `grep -nE "useState<.*>\\(\"cumulative\"\\)|useState\\(\"cumulative\"\\)" src/components/strategy-v2/HeadlineMetricsPanel.tsx` returns 1 match (default active = cumulative)
    - `grep -nE "useState<boolean>\\(true\\)|useState\\(true\\)" src/components/strategy-v2/HeadlineMetricsPanel.tsx` returns at least 1 match (BTC overlay default-ON)
    - `grep -nE "data-panel=\"" src/components/strategy-v2/StrategyV2Shell.tsx` returns ZERO matches (sections are mounted by child components, not directly here) OR at least 7 matches if executor inlines them; either is fine — the count check happens in 14A-05 panel-count test
    - `grep -nE "<OverviewPanel|<HeadlineMetricsPanel|<DrawdownPanel|<LazyPanelPlaceholder" src/components/strategy-v2/StrategyV2Shell.tsx` returns at least 7 matches (1 + 1 + 1 + 4 = 7 panel components)
    - `grep -nE "panelId=\"panel4\"|panelId=\"panel5\"|panelId=\"panel6\"|panelId=\"panel7\"" src/components/strategy-v2/StrategyV2Shell.tsx` returns 4 matches
    - `grep -n "max-w-\\[1200px\\]" src/components/strategy-v2/StrategyV2Shell.tsx` returns 1 match
    - `grep -nE "font-medium|font-light|font-bold" src/components/strategy-v2/HeadlineMetricsPanel.tsx src/components/strategy-v2/StrategyV2Shell.tsx` returns ZERO matches
    - `grep -nE "text-\\[11px\\]|text-\\[13px\\]|text-\\[14px\\]|text-sm|text-xl|text-2xl" src/components/strategy-v2/HeadlineMetricsPanel.tsx src/components/strategy-v2/StrategyV2Shell.tsx` returns ZERO matches
    - `npx tsc --noEmit` exits 0
    - `npm run build` exits 0
  </acceptance_criteria>
  <done>HeadlineMetricsPanel renders KPI strip + segmented control + BTC checkbox + chart toggle; StrategyV2Shell composes 7 sections in order and adds page header; build clean.</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| Server-rendered HTML → Browser | StrategyV2Shell ships pre-fetched data via prop serialization; no secrets exposed (StrategyV2Detail contains only public-strategy fields) |
| Client-state → DOM | HeadlineMetricsPanel local useState (segmented active + BTC checkbox) is not persisted; no XSS surface in the values |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-14a-03-01 | I (Information disclosure) | StrategyV2Shell prop serialization | accept | StrategyV2Detail contains only fields v1 already exposes via `getPublicStrategyDetail` (verified Plan 14A-02). No secrets in props. |
| T-14a-03-02 | D (Denial of service) | useLazyPanelMetrics fires for every section | mitigate | One-shot observer (`unobserve(entry.target)` after first intersection) prevents repeated triggers; rootMargin=200px means at most 4 IO instances per page. |
| T-14a-03-03 | T (Tampering) | SegmentedControl disabled buttons | mitigate | `aria-disabled="true"` + `onClick={(e) => e.preventDefault()}` short-circuit; not relying on browser `disabled` attribute (UI-SPEC §8). |
</threat_model>

<verification>
- `npx tsc --noEmit` exits 0
- `npm run build` exits 0
- 7 component files + 1 hook file all exist under their declared paths
- Type-scale grep contract (font-medium/light/bold absent; text-sm/xl/2xl absent) holds across `src/components/strategy-v2/**/*.tsx`
</verification>

<success_criteria>
1. `useLazyPanelMetrics` hook is SSR-safe and one-shot.
2. StrategyV2Shell composes the 7-section layout in declared order.
3. HeadlineMetricsPanel renders the segmented control with 2 active + 2 disabled buttons; BTC checkbox default-ON.
4. Panel partial-data banners trigger on the documented thresholds (`history_days < 1` Panel 1; `< 30` Panel 2 KPI strip; `< 7` Panel 2 chart; `< 30` Panel 3 chart).
5. `npm run build` exits 0.
</success_criteria>

<output>
After completion, create `.planning/phases/14a-single-strategy-v2-eager-panels-identity/14a-03-SUMMARY.md` describing:
- Whether EquityCurve was modified (added `hideBenchmarkToggle` prop) or not, and the rationale
- Final list of created files with LOC counts
- tsc + build status
- Any deviations (e.g. Disclaimer prop mismatch, EquityCurve not modified, etc.)
</output>
