---
phase: 14b
plan: 04
type: execute
wave: 2
depends_on: [14b-01]
files_modified:
  - src/components/strategy-v2/TradeAndPositionPanel.tsx
  - src/components/strategy-v2/TradeAndPositionPanel.test.tsx
  - src/components/strategy-v2/TradeMixSubPanel.tsx
  - src/components/strategy-v2/TradeMixSubPanel.test.tsx
  - src/components/strategy-v2/MetricCell.tsx
  - src/components/strategy-v2/MetricCell.test.tsx
autonomous: true
requirements: [KPI-12, KPI-13, KPI-14, KPI-15, KPI-16, KPI-17, KPI-23b]
requirements_addressed: [KPI-12, KPI-13, KPI-14, KPI-15, KPI-16, KPI-17, KPI-23b]
tags: [strategy-v2, panel-6, trade-position, trade-mix, partial-data, kpi-17-2bucket]
must_haves:
  truths:
    - "Panel 6 mounts <TradeAndPositionPanel /> with 4 metric rows + Trade Mix sub-panel"
    - "Trade Summary row: Total trades / Long / Short / Wins / Losses / Win rate (KPI-12, 6 cells)"
    - "Position Summary row: Open / Closed / Long / Short / Win rate / Avg duration (KPI-13, 6 cells)"
    - "Risk-Reward row: R:R / Weighted R:R / Profit factor / Payoff ratio / Long PF / Short PF / Expectancy + SQN (KPI-14 + KPI-15, 8 cells)"
    - "Volume row: Gross volume / Mean trade size / Daily turnover / Monthly turnover (KPI-16, 4 cells)"
    - "Trade Mix sub-panel: 2-bucket Long entries / Short entries with mode prop default '2-bucket' (KPI-17 partial; 4-bucket descoped to v0.17.1)"
    - "Negative metric values render in --color-negative; null values render as em-dash"
    - "Panel-level partial-data when trade_metrics === null OR trade_metrics.total_positions === 0 (KPI-23b)"
    - "Eager rows (Trade summary / Position summary / Risk-Reward / Volume) render unconditionally from props.trade_metrics — they DO NOT depend on the lazy fetch (Grok B-04: lazy fetch error must not mask valid eager data)"
    - "panelId 'panel6' uses fetchOnIntersect=false — no lazy network call (Grok B-04 option (a)). Lifecycle still emits idle → ready on intersection so keyboard / parity / partial-data tests see data-panel-status='ready' for the section."
  artifacts:
    - path: "src/components/strategy-v2/TradeAndPositionPanel.tsx"
      provides: "Wrapper for Panel 6 — 4 metric rows + Trade Mix sub-panel; eager-only render path (no lazy fetch error masking)"
      exports: ["TradeAndPositionPanel"]
    - path: "src/components/strategy-v2/TradeMixSubPanel.tsx"
      provides: "2-bucket Long/Short bar visualization with mode prop reserved for v0.17.1 4-bucket flip"
      exports: ["TradeMixSubPanel"]
    - path: "src/components/strategy-v2/MetricCell.tsx"
      provides: "Shared 12px label + 18px value primitive used in Panel 6 + Panel 7 Greeks table"
      exports: ["MetricCell"]
  key_links:
    - from: "src/components/strategy-v2/TradeAndPositionPanel.tsx"
      to: "src/components/strategy-v2/TradeMixSubPanel.tsx"
      via: "import + render with mode='2-bucket'"
      pattern: "TradeMixSubPanel"
    - from: "src/components/strategy-v2/TradeAndPositionPanel.tsx"
      to: "src/lib/types.ts"
      via: "TradeMetrics + TradeMixBuckets type imports"
      pattern: "TradeMetrics"
---

<objective>
Ship Panel 6 — Trade & position. Mounts a 4-row metric strip (Trade Summary / Position Summary / Risk-Reward / Volume) and a 2-bucket Trade Mix sub-panel inside the 14a panel chrome. Reads from the EAGER analytics blob's `trade_metrics` field (Phase 12 METRICS-07 / METRICS-08 / METRICS-09 shipped derived metrics into `strategy_analytics.trade_metrics` JSONB). **Per Grok B-04**, no lazy fetch fires for `panel6` — `panelId='panel6'` maps to `'trades'` which the migration 087 CASE returns as an empty array (no sibling-table reads). Firing the lazy hook with `fetchOnIntersect: true` only created an opportunity for a transient RPC error to mask the entire panel even though all data is already in props. Trade Mix is **2-bucket only** (KPI-17 partial); the `mode: '2-bucket' | '4-bucket'` prop is reserved for v0.17.1 flip but the 4-bucket render branch is NOT implemented.

Purpose: KPI-12 / KPI-13 / KPI-14 / KPI-15 / KPI-16 / KPI-17 (2-bucket) + Panel 6 portion of KPI-23b.
Output: 1 panel wrapper + 1 sub-panel + 1 shared MetricCell primitive + 3 test files. NOT yet mounted in StrategyV2Shell.

**Revision (2026-04-29 Grok B-04):** TradeAndPositionPanel calls `useLazyPanelMetrics("panel6", { fetchOnIntersect: false })` — the hook still observes intersection (so keyboard / parity / partial-data tests see `data-panel-status="ready"` once scrolled), but the network fetch is skipped. The eager `trade_metrics` blob is the only data source. Lazy fetch errors cannot mask the panel.
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
@src/lib/types.ts
@src/components/charts/chart-tokens.ts
@src/components/strategy-v2/PartialDataBanner.tsx
@src/components/strategy-v2/HeadlineMetricsPanel.tsx

<interfaces>
<!-- Contracts the executor uses directly. -->

From src/lib/types.ts (Phase 12 — DO NOT MODIFY):

```typescript
export interface TradeMetrics {
  total_positions: number;
  open_positions: number;
  closed_positions: number;
  win_rate: number;
  avg_roi: number;
  avg_duration_days: number;
  long_count: number;
  short_count: number;
  best_trade_roi: number;
  worst_trade_roi: number;
  expectancy: number | null;
  risk_reward_ratio: number | null;
  weighted_risk_reward_ratio: number | null;
  sqn: number | null;
  profit_factor_long: number | null;
  profit_factor_short: number | null;
  trade_mix?: TradeMixBuckets;
}

export interface TradeMixBucket {
  count: number;
  total_notional: number;
  avg_holding_period_hours: number;
}

export interface TradeMixBuckets {
  long?: TradeMixBucket;
  short?: TradeMixBucket;
  long_maker?: TradeMixBucket;
  long_taker?: TradeMixBucket;
  short_maker?: TradeMixBucket;
  short_taker?: TradeMixBucket;
}

export interface VolumeMetrics {
  buy_volume_pct: number;
  sell_volume_pct: number;
  long_volume_pct: number;
  short_volume_pct: number;
  total_fills: number;
  total_volume_usd: number;
}
```

Panel 6 needs additional volume aggregator + per-trade derived stats not all on TradeMetrics. Phase 12 Plan 12-05 SUMMARY confirms `_compute_volume_aggregator` produced 4 keys (gross_volume_usd, mean_trade_size_usd, daily_turnover_usd, monthly_turnover_usd) merged into the trade_metrics JSONB at the orchestrator level. Therefore the trade_metrics JSONB blob in the database carries these as `Record<string, unknown>` extras beyond the frozen interface. Plan 14b-04 reads them via type-narrowing on `analytics.trade_metrics as Record<string, unknown>`. Concrete extra keys (per Plan 12-05 SUMMARY):

```
- gross_volume_usd: number | null
- mean_trade_size_usd: number | null
- daily_turnover_usd: number | null
- monthly_turnover_usd: number | null
- payoff_ratio: number | null  (NEW per KPI-14)
- profit_factor: number | null (overall PF, both sides)
- avg_winning_trade: number | null
- avg_losing_trade: number | null
- winners_count: number | null
- losers_count: number | null
```

If a key is absent at runtime, render em-dash.

From src/lib/queries.ts:441 — Panel 6 has NO heavy series. Per migration 087 CASE: `WHEN 'trades' THEN ARRAY[]::TEXT[]`. The lazy RPC would return `{}`. **Grok B-04**: there is no value in firing the lazy fetch for panel6 — it can only fail (network / RPC / 500) without producing useful data. Plan 14b-04 sets `fetchOnIntersect: false` so the IntersectionObserver still tracks the lifecycle (idle → ready on intersection per 14a placeholder semantics) but no network call is made.

From DESIGN.md / chart-tokens.ts:
- `--color-negative: #DC2626`
- `--color-positive: #16A34A` (cell value when threshold-positive — discretion per UI-SPEC §3.3)
- CHART_ACCENT = "#1B6B5A" (Trade Mix Long bar)
- CHART_TEXT_MUTED = "#94A3B8" (Trade Mix Short bar)
</interfaces>
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: Ship MetricCell + TradeMixSubPanel primitives</name>
  <files>src/components/strategy-v2/MetricCell.tsx, src/components/strategy-v2/MetricCell.test.tsx, src/components/strategy-v2/TradeMixSubPanel.tsx, src/components/strategy-v2/TradeMixSubPanel.test.tsx</files>
  <read_first>
    - .planning/phases/14b-single-strategy-v2-lazy-panels-trade-exposure/14B-UI-SPEC.md §3.3 (full Panel 6 spec — metric cell pattern + Trade Mix sub-panel layout)
    - .planning/phases/14b-single-strategy-v2-lazy-panels-trade-exposure/14B-UI-SPEC.md §10.3 (verbatim cell labels)
    - src/components/strategy-v2/HeadlineMetricsPanel.tsx (Phase 14a — uses 18px Geist Mono semibold tabular-nums; mirror that visual treatment)
    - src/components/charts/chart-tokens.ts (CHART_ACCENT for Long bar; CHART_TEXT_MUTED for Short bar)
  </read_first>
  <behavior>
    - Test 1 (MetricCell label): Renders `<dt>` with class `text-xs font-normal text-text-muted`, content = label string verbatim.
    - Test 2 (MetricCell value): Renders `<dd>` with class `text-lg font-semibold tabular-nums text-text-primary` for non-negative non-null. Content matches the formatted value string.
    - Test 3 (MetricCell em-dash): When `value === null`, renders `—` (em-dash, U+2014) in `<dd>`. Verify via `screen.getByText("—")`.
    - Test 4 (MetricCell negative styling): When `negative` prop is true (callsite calls based on `value < 0`), `<dd>` carries class `text-negative` (or inline `style={{ color: 'var(--color-negative)' }}` per project convention; verify which is in tailwind.config.* — if `text-negative` exists, use it).
    - Test 5 (MetricCell semantic HTML): Each MetricCell renders a `<dl><dt><dd></dd></dt></dl>` triple — verify with `container.querySelector("dl > dt + dd")` truthy.
    - Test 6 (TradeMixSubPanel 2-bucket render): With `buckets={{ long: { count: 1247, total_notional: 1, avg_holding_period_hours: 0 }, short: { count: 701, total_notional: 1, avg_holding_period_hours: 0 } }}`, renders 2 horizontal bars: Long bar with `style={{ width: '64%', backgroundColor: '#1B6B5A' }}` and Short with `'36%'` and `'#94A3B8'`. Percent label = "64%" / "36%" rendered OUTSIDE the bar (right-aligned, NOT inside).
    - Test 7 (TradeMixSubPanel raw count): Renders `(1,247 fills)` and `(701 fills)` next to each percent label in 12px regular muted (NOT inside the bar).
    - Test 8 (TradeMixSubPanel mode prop default): Without explicit `mode`, defaults to `'2-bucket'`. Source code emits `mode = '2-bucket'` as default.
    - Test 9 (TradeMixSubPanel 4-bucket NOT implemented): When `mode='4-bucket'`, renders an empty container with a code comment / fallback render — NOT 4 bars. The 4-bucket render branch must NOT have working bars in 14b. Document this with: a `<p>` saying "4-bucket maker/taker mode is reserved for v0.17.1." or similar safe fallback. The mode prop exists in the interface but the branch is intentionally unimplemented.
    - Test 10 (TradeMixSubPanel empty): When `buckets` is undefined or both `.count === 0`, renders heading + "Trade mix unavailable for this strategy." in 12px regular muted.
    - Test 11 (TradeMixSubPanel break/border): Container has `mt-8 border-t border-border pt-6` per UI-SPEC §3.3.
    - Test 12 (TradeMixSubPanel H3): Renders `Trade mix` (sentence-case) as H3 with `text-xs font-normal uppercase tracking-wider text-text-secondary`.
  </behavior>
  <action>
    **A. src/components/strategy-v2/MetricCell.tsx:**

    ```typescript
    interface MetricCellProps {
      label: string;
      value: string | null;
      /** When true, value renders in --color-negative. Caller decides based on data semantics. */
      negative?: boolean;
    }

    /**
     * Phase 14b — Shared metric-cell primitive used in Panel 6 (4 metric rows)
     * and Panel 7 (Benchmark Greeks table). Pattern:
     *   - 12px DM Sans regular text-text-muted label
     *   - 18px Geist Mono semibold tabular-nums value
     *   - Em-dash for null
     *   - --color-negative when `negative=true`
     * Wrapped in <dl>/<dt>/<dd> for A11Y semantic-HTML rule.
     */
    export function MetricCell({ label, value, negative }: MetricCellProps) {
      return (
        <dl className="space-y-1">
          <dt className="text-xs font-normal text-text-muted">{label}</dt>
          <dd
            className={
              "text-lg font-semibold tabular-nums " +
              (negative ? "text-negative" : "text-text-primary")
            }
            style={{ fontFamily: "var(--font-mono), monospace" }}
          >
            {value ?? "—"}
          </dd>
        </dl>
      );
    }
    ```

    Concrete value: em-dash escape `"—"` (NOT `—` literal — keep escape so the source grep is unambiguous).

    Verify `text-negative` Tailwind class exists by `grep -E "(text-negative|--color-negative)" src/app/globals.css tailwind.config.*`. If `text-negative` is NOT a known utility, replace with inline `style={{ color: 'var(--color-negative)' }}`.

    **B. src/components/strategy-v2/TradeMixSubPanel.tsx:**

    ```typescript
    "use client";

    import type { TradeMixBuckets } from "@/lib/types";

    type TradeMixMode = "2-bucket" | "4-bucket";

    interface TradeMixSubPanelProps {
      buckets?: TradeMixBuckets;
      mode?: TradeMixMode;
    }

    export function TradeMixSubPanel({
      buckets,
      mode = "2-bucket",
    }: TradeMixSubPanelProps) {
      const longCount = buckets?.long?.count ?? 0;
      const shortCount = buckets?.short?.count ?? 0;
      const total = longCount + shortCount;

      if (mode === "4-bucket") {
        // Phase 14b ships 2-bucket only. Maker/taker 4-bucket dimension is
        // descoped to v0.17.1 — gated on `is_maker` flag fix in
        // analytics-service/services/exchange.py for Binance/OKX/Bybit.
        return (
          <div className="mt-8 border-t border-border pt-6">
            <h3 className="mb-4 text-xs font-normal uppercase tracking-wider text-text-secondary">
              Trade mix
            </h3>
            <p className="text-xs font-normal text-text-muted">
              4-bucket maker/taker mode is reserved for v0.17.1.
            </p>
          </div>
        );
      }

      // 2-bucket path
      return (
        <div className="mt-8 border-t border-border pt-6">
          <h3 className="mb-4 text-xs font-normal uppercase tracking-wider text-text-secondary">
            Trade mix
          </h3>
          {total === 0 ? (
            <p className="text-xs font-normal text-text-muted">
              Trade mix unavailable for this strategy.
            </p>
          ) : (
            <div className="space-y-3">
              <BucketBar
                label="Long entries"
                count={longCount}
                total={total}
                fillColor="#1B6B5A"
              />
              <BucketBar
                label="Short entries"
                count={shortCount}
                total={total}
                fillColor="#94A3B8"
              />
            </div>
          )}
        </div>
      );
    }

    function BucketBar({
      label, count, total, fillColor,
    }: { label: string; count: number; total: number; fillColor: string }) {
      const pct = total === 0 ? 0 : Math.round((count / total) * 100);
      return (
        <div className="flex items-center gap-3">
          <div className="w-32 text-xs font-normal text-text-muted">{label}</div>
          <div className="relative h-6 flex-1 rounded-sm bg-surface-subtle">
            <div
              className="h-full rounded-sm"
              style={{ width: `${pct}%`, backgroundColor: fillColor }}
              aria-hidden="true"
            />
          </div>
          <div
            className="w-32 text-right text-lg font-semibold tabular-nums text-text-primary"
            style={{ fontFamily: "var(--font-mono), monospace" }}
          >
            {pct}%
            <span className="ml-2 text-xs font-normal text-text-muted">
              ({count.toLocaleString()} fills)
            </span>
          </div>
        </div>
      );
    }
    ```

    Concrete values to keep stable:
    - H3 copy: `Trade mix` (sentence-case)
    - Long label: `Long entries` (verbatim)
    - Short label: `Short entries` (verbatim)
    - Long bar fill: `#1B6B5A` (CHART_ACCENT literal — kept inline so Tailwind class resolution doesn't matter)
    - Short bar fill: `#94A3B8` (CHART_TEXT_MUTED literal)
    - Empty body copy: `Trade mix unavailable for this strategy.` (verbatim)
    - 4-bucket fallback copy: `4-bucket maker/taker mode is reserved for v0.17.1.` (verbatim)
    - Container classes: `mt-8 border-t border-border pt-6` (verbatim)
    - Bar height: `h-6` (24px per UI-SPEC)

    Create both test files covering tests 1-12. Use `@testing-library/react`.
  </action>
  <verify>
    <automated>npm test -- src/components/strategy-v2/MetricCell.test.tsx src/components/strategy-v2/TradeMixSubPanel.test.tsx --run</automated>
  </verify>
  <done>
    - `npm test -- src/components/strategy-v2/MetricCell.test.tsx --run` passes 5/5.
    - `npm test -- src/components/strategy-v2/TradeMixSubPanel.test.tsx --run` passes 7/7.
    - `grep -c "Trade mix" src/components/strategy-v2/TradeMixSubPanel.tsx` ≥ 1.
    - `grep -c "Long entries" src/components/strategy-v2/TradeMixSubPanel.tsx` returns 1.
    - `grep -c "Short entries" src/components/strategy-v2/TradeMixSubPanel.tsx` returns 1.
    - `grep -c "#1B6B5A" src/components/strategy-v2/TradeMixSubPanel.tsx` returns 1 (Long bar fill).
    - `grep -c "#94A3B8" src/components/strategy-v2/TradeMixSubPanel.tsx` returns 1 (Short bar fill).
    - `grep -c "4-bucket maker/taker" src/components/strategy-v2/TradeMixSubPanel.tsx` ≥ 1.
    - `grep -cE "(font-medium|text-sm|text-xl|text-2xl)" src/components/strategy-v2/{MetricCell,TradeMixSubPanel}.tsx` returns 0.
    - `grep -c "\\\\u2014" src/components/strategy-v2/MetricCell.tsx` returns 1 (em-dash escape).
  </done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: Ship TradeAndPositionPanel wrapper with 4 metric rows (Grok B-04: eager-only — no lazy fetch)</name>
  <files>src/components/strategy-v2/TradeAndPositionPanel.tsx, src/components/strategy-v2/TradeAndPositionPanel.test.tsx</files>
  <read_first>
    - .planning/phases/14b-single-strategy-v2-lazy-panels-trade-exposure/14B-UI-SPEC.md §3.3 (full Panel 6 layout — 4 rows + Trade Mix sub-panel, SQN as 8th cell on RR row recommendation)
    - .planning/phases/14b-single-strategy-v2-lazy-panels-trade-exposure/14B-UI-SPEC.md §10.3 (verbatim cell labels)
    - src/lib/types.ts:113-183 (TradeMetrics + TradeMixBuckets shape)
    - .planning/phases/12-backend-metric-contracts/12-05-SUMMARY.md (volume aggregator extras merged into trade_metrics — fields list)
    - src/components/strategy-v2/MetricCell.tsx (post-task-1)
    - src/components/strategy-v2/TradeMixSubPanel.tsx (post-task-1)
    - src/lib/utils.ts (formatPercent / formatNumber if exported — re-use for cell value formatting)
    - supabase/migrations/087_strategy_analytics_series.sql (verify CASE entry — `WHEN 'trades' THEN ARRAY[]::TEXT[]` confirms no sibling-table reads for panel6; this confirms Grok B-04 — fetching adds risk without value)
  </read_first>
  <behavior>
    - Test 1 (chrome): Renders `<section data-panel="trades" data-panel-status="..." aria-label="Trades & positions">` with 14a panel chrome.
    - Test 2 (panel-level partial data — eager source only): When `trade_metrics === null` OR `trade_metrics.total_positions === 0`, renders `<PartialDataBanner heading="Awaiting more data" body="This strategy hasn't logged any trades yet." />` and NO rows. NOTE: This decision is independent of `data-panel-status` (lazy lifecycle) — the partial-data check looks at `props.trade_metrics` directly. **Grok B-04**: lazy state never gates the panel body.
    - Test 3 (Trade summary row): When trade_metrics populated, row 1 H3 = `Trade summary` with 6 cells in order: `Total trades` / `Long` / `Short` / `Wins` / `Losses` / `Win rate`. Win rate value formatted as `(win_rate * 100).toFixed(1) + '%'`. Renders unconditionally — no dependency on lazy data.
    - Test 4 (Position summary row): H3 = `Position summary`, 6 cells: `Open` / `Closed` / `Long` / `Short` / `Win rate` / `Avg duration`. Avg duration formatted as `${avg_duration_days.toFixed(1)} d`.
    - Test 5 (Risk-Reward row): H3 = `Risk-reward profile`, 8 cells: `R:R` / `Weighted R:R` / `Profit factor` / `Payoff ratio` / `Long PF` / `Short PF` / `Expectancy` / `SQN`. Each value uses `toFixed(2)`. Null values render em-dash. Negative R:R / SQN render in `--color-negative`.
    - Test 6 (Volume row): H3 = `Volume metrics`, 4 cells: `Gross volume` / `Mean trade size` / `Daily turnover` / `Monthly turnover`. USD values formatted with `Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 })` so $1,234,567 → `$1.2M`.
    - Test 7 (Trade Mix sub-panel mounted): Renders `<TradeMixSubPanel buckets={trade_metrics.trade_mix} mode="2-bucket" />`.
    - **Test 8 (Grok B-04 — no fetch fired): The component invokes `useLazyPanelMetrics("panel6", { fetchOnIntersect: false })`. Verified by mocking the hook and asserting the `opts.fetchOnIntersect` it received is `false` (or absent). The hook's internal call to `fetchStrategyLazyMetrics` is NEVER fired. With `vi.spyOn(queries, 'fetchStrategyLazyMetrics')`, after intersect, `mock.calls.length === 0`.**
    - **Test 9 (Grok B-04 — eager rows survive lazy 'error'): Drive `useLazyPanelMetrics` mock to return `status='error'` AND populated `props.trade_metrics`. The 4 metric rows still render fully. The panel does NOT show the error PartialDataBanner. (This guards the "lazy fetch error masks valid eager data" regression.)**
    - **Test 10 (Grok B-04 — placeholder rendered cleanly): When `status='idle'` (pre-intersect), the panel shows H2 + placeholder state — but the eager rows STILL render (since trade_metrics is in props and does not depend on intersection). Verification: assert MetricCell renders for at least the Total trades cell even at status='idle'.**
    - Test 11 (semantic <dl>): Each row's MetricCells are wrapped in a single grid container; each cell uses its own `<dl>` (semantic correctness — verify with `container.querySelectorAll("dl").length` equals total cell count).
    - Test 12 (no forbidden classes): No `font-medium`, `text-sm`, `text-xl`, `text-2xl`, `text-[14px]`.
  </behavior>
  <action>
    Create `src/components/strategy-v2/TradeAndPositionPanel.tsx`:

    ```typescript
    "use client";

    import { useLazyPanelMetrics } from "@/hooks/useLazyPanelMetrics";
    import { PartialDataBanner } from "./PartialDataBanner";
    import { MetricCell } from "./MetricCell";
    import { TradeMixSubPanel } from "./TradeMixSubPanel";
    import type { TradeMetrics } from "@/lib/types";

    interface TradeAndPositionPanelProps {
      strategyId: string;
      /** From getStrategyDetailV2 — may carry extras beyond the frozen TradeMetrics interface. */
      trade_metrics: (TradeMetrics & Record<string, unknown>) | null;
    }

    /** Compact USD formatter — $1,234,567 → "$1.2M". */
    const COMPACT_USD = new Intl.NumberFormat("en-US", {
      notation: "compact",
      maximumFractionDigits: 1,
      style: "currency",
      currency: "USD",
    });

    function fmtNum(v: number | null | undefined, digits = 2): string | null {
      if (v == null || !Number.isFinite(v)) return null;
      return v.toFixed(digits);
    }

    function fmtPct(v: number | null | undefined): string | null {
      if (v == null || !Number.isFinite(v)) return null;
      return `${(v * 100).toFixed(1)}%`;
    }

    function fmtUsdCompact(v: number | null | undefined): string | null {
      if (v == null || !Number.isFinite(v)) return null;
      return COMPACT_USD.format(v);
    }

    function fmtCount(v: number | null | undefined): string | null {
      if (v == null || !Number.isFinite(v)) return null;
      return Math.round(v).toLocaleString();
    }

    export function TradeAndPositionPanel({
      strategyId,
      trade_metrics,
    }: TradeAndPositionPanelProps) {
      // Grok B-04: panel6 maps to 'trades' which migration 087 returns as
      // ARRAY[]::TEXT[] (no sibling kinds). All Panel-6 data lives on the eager
      // analytics blob (props.trade_metrics). Firing the lazy fetch creates an
      // opportunity for transient RPC errors to mask valid eager data with no
      // upside (lazy payload is always {}). We pass fetchOnIntersect: false so
      // the hook only tracks intersection lifecycle (idle → ready) — keyboard,
      // chart-parity, and partial-data tests still see data-panel-status="ready"
      // once the section scrolls into view, but no network call is made.
      // strategyId is intentionally referenced (not consumed) to keep the parent
      // wiring contract identical to other lazy panels for symmetry.
      void strategyId;
      const { ref, status } = useLazyPanelMetrics<Record<string, never>>(
        "panel6",
        { fetchOnIntersect: false },
      );

      // Eager partial-data gate: looks at props.trade_metrics ONLY. Independent
      // of `status` so a transient lazy lifecycle hiccup cannot hide valid data.
      const noTrades =
        !trade_metrics || (trade_metrics.total_positions ?? 0) === 0;

      return (
        <section
          ref={ref}
          data-panel="trades"
          data-panel-status={status === "idle" ? "placeholder" : status}
          aria-label="Trades & positions"
          className="mt-8 min-h-[240px] rounded-lg border border-border bg-surface p-6 shadow-card"
        >
          <h2 className="text-base font-semibold text-text-primary">Trades &amp; positions</h2>

          {noTrades ? (
            <div className="mt-4">
              <PartialDataBanner
                heading="Awaiting more data"
                body="This strategy hasn't logged any trades yet."
              />
            </div>
          ) : (
            <Body trade_metrics={trade_metrics!} />
          )}
        </section>
      );
    }

    function Body({ trade_metrics: tm }: { trade_metrics: TradeMetrics & Record<string, unknown> }) {
      // Volume aggregator extras (Phase 12 Plan 12-05 SUMMARY) live as JSONB extras
      // on the trade_metrics blob. Read defensively.
      const grossVolume = tm["gross_volume_usd"] as number | null | undefined;
      const meanTradeSize = tm["mean_trade_size_usd"] as number | null | undefined;
      const dailyTurnover = tm["daily_turnover_usd"] as number | null | undefined;
      const monthlyTurnover = tm["monthly_turnover_usd"] as number | null | undefined;
      const payoffRatio = tm["payoff_ratio"] as number | null | undefined;
      const profitFactor = tm["profit_factor"] as number | null | undefined;
      // Trade-side wins/losses extras
      const winners = tm["winners_count"] as number | null | undefined;
      const losers = tm["losers_count"] as number | null | undefined;

      return (
        <div className="mt-4 space-y-4">
          {/* Trade summary */}
          <Section title="Trade summary">
            <Grid cols={6}>
              <MetricCell label="Total trades" value={fmtCount(tm.total_positions)} />
              <MetricCell label="Long" value={fmtCount(tm.long_count)} />
              <MetricCell label="Short" value={fmtCount(tm.short_count)} />
              <MetricCell label="Wins" value={fmtCount(winners)} />
              <MetricCell label="Losses" value={fmtCount(losers)} />
              <MetricCell label="Win rate" value={fmtPct(tm.win_rate)} />
            </Grid>
          </Section>

          {/* Position summary */}
          <Section title="Position summary">
            <Grid cols={6}>
              <MetricCell label="Open" value={fmtCount(tm.open_positions)} />
              <MetricCell label="Closed" value={fmtCount(tm.closed_positions)} />
              <MetricCell label="Long" value={fmtCount(tm.long_count)} />
              <MetricCell label="Short" value={fmtCount(tm.short_count)} />
              <MetricCell label="Win rate" value={fmtPct(tm.win_rate)} />
              <MetricCell
                label="Avg duration"
                value={tm.avg_duration_days != null ? `${tm.avg_duration_days.toFixed(1)} d` : null}
              />
            </Grid>
          </Section>

          {/* Risk-Reward + SQN as 8th cell */}
          <Section title="Risk-reward profile">
            <Grid cols={8}>
              <MetricCell
                label="R:R"
                value={fmtNum(tm.risk_reward_ratio)}
                negative={(tm.risk_reward_ratio ?? 0) < 0}
              />
              <MetricCell
                label="Weighted R:R"
                value={fmtNum(tm.weighted_risk_reward_ratio)}
                negative={(tm.weighted_risk_reward_ratio ?? 0) < 0}
              />
              <MetricCell label="Profit factor" value={fmtNum(profitFactor)} />
              <MetricCell label="Payoff ratio" value={fmtNum(payoffRatio)} />
              <MetricCell label="Long PF" value={fmtNum(tm.profit_factor_long)} />
              <MetricCell label="Short PF" value={fmtNum(tm.profit_factor_short)} />
              <MetricCell
                label="Expectancy"
                value={fmtNum(tm.expectancy)}
                negative={(tm.expectancy ?? 0) < 0}
              />
              <MetricCell
                label="SQN"
                value={fmtNum(tm.sqn)}
                negative={(tm.sqn ?? 0) < 0}
              />
            </Grid>
          </Section>

          {/* Volume row */}
          <Section title="Volume metrics">
            <Grid cols={4}>
              <MetricCell label="Gross volume" value={fmtUsdCompact(grossVolume)} />
              <MetricCell label="Mean trade size" value={fmtUsdCompact(meanTradeSize)} />
              <MetricCell label="Daily turnover" value={fmtUsdCompact(dailyTurnover)} />
              <MetricCell label="Monthly turnover" value={fmtUsdCompact(monthlyTurnover)} />
            </Grid>
          </Section>

          {/* Trade Mix sub-panel (2-bucket only — KPI-17 partial; v0.17.1 flips 4-bucket) */}
          <TradeMixSubPanel buckets={tm.trade_mix} mode="2-bucket" />
        </div>
      );
    }

    function Section({ title, children }: { title: string; children: React.ReactNode }) {
      return (
        <div className="border-t border-border pt-4">
          <h3 className="mb-4 text-xs font-normal uppercase tracking-wider text-text-secondary">
            {title}
          </h3>
          {children}
        </div>
      );
    }

    function Grid({ cols, children }: { cols: 4 | 6 | 8; children: React.ReactNode }) {
      const gridCols =
        cols === 4 ? "grid-cols-4" : cols === 6 ? "grid-cols-6" : "grid-cols-8";
      return <div className={`grid ${gridCols} gap-3`}>{children}</div>;
    }
    ```

    Concrete values to keep stable:
    - `data-panel="trades"` (kebab-case)
    - H2: `Trades & positions` (with HTML entity `&amp;` in JSX)
    - H3 row labels (verbatim): `Trade summary`, `Position summary`, `Risk-reward profile`, `Volume metrics`
    - Cell labels (verbatim per UI-SPEC §10.3): `Total trades`, `Long`, `Short`, `Wins`, `Losses`, `Win rate`, `Open`, `Closed`, `Avg duration`, `R:R`, `Weighted R:R`, `Profit factor`, `Payoff ratio`, `Long PF`, `Short PF`, `Expectancy`, `SQN`, `Gross volume`, `Mean trade size`, `Daily turnover`, `Monthly turnover`
    - Empty banner body: `This strategy hasn't logged any trades yet.` (curly apostrophe — verbatim)
    - SQN ships as 8th cell on the RR row (planner discretion in UI-SPEC §3.3 — recommendation chosen)
    - **`fetchOnIntersect: false` (Grok B-04) — verbatim in source.**

    Create `src/components/strategy-v2/TradeAndPositionPanel.test.tsx` covering all 12 behaviours. Use `vi.mock("@/hooks/useLazyPanelMetrics")` to drive status. For test 8, also `vi.mock("@/lib/queries")` and assert `fetchStrategyLazyMetrics` was never called. Use `vi.mock("./TradeMixSubPanel")` to assert it's invoked with mode='2-bucket'.
  </action>
  <verify>
    <automated>npm test -- src/components/strategy-v2/TradeAndPositionPanel.test.tsx --run</automated>
  </verify>
  <done>
    - `npm test -- src/components/strategy-v2/TradeAndPositionPanel.test.tsx --run` passes 12/12.
    - `grep -c "data-panel=\"trades\"" src/components/strategy-v2/TradeAndPositionPanel.tsx` returns 1.
    - `grep -c "useLazyPanelMetrics" src/components/strategy-v2/TradeAndPositionPanel.tsx` ≥ 1.
    - `grep -c "panel6" src/components/strategy-v2/TradeAndPositionPanel.tsx` ≥ 1.
    - **`grep -c "fetchOnIntersect: false" src/components/strategy-v2/TradeAndPositionPanel.tsx` returns 1 (Grok B-04 — no lazy fetch).**
    - **`grep -c "fetchOnIntersect: true" src/components/strategy-v2/TradeAndPositionPanel.tsx` returns 0 (must NOT fire fetch).**
    - `grep -c "TradeMixSubPanel" src/components/strategy-v2/TradeAndPositionPanel.tsx` ≥ 2 (import + render).
    - `grep -c "mode=\"2-bucket\"" src/components/strategy-v2/TradeAndPositionPanel.tsx` returns 1.
    - `grep -c "MetricCell" src/components/strategy-v2/TradeAndPositionPanel.tsx` ≥ 21 (1 import + 20 cell renders).
    - `grep -cE "(font-medium|text-sm|text-xl|text-2xl|text-\\[14px\\])" src/components/strategy-v2/TradeAndPositionPanel.tsx` returns 0.
    - `npx tsc --noEmit` exits 0.
    - `npm run build` exits 0.
  </done>
</task>

</tasks>

<verification>
- `npm test -- src/components/strategy-v2/{MetricCell,TradeMixSubPanel,TradeAndPositionPanel}.test.tsx --run` all green.
- `grep -rn "TradeAndPositionPanel\\|TradeMixSubPanel" src/components/strategy-v2/StrategyV2Shell.tsx` returns 0 (NOT yet wired — that's 14b-06).
- KPI-17 ships 2-bucket only — `grep -c "long_maker\\|long_taker\\|short_maker\\|short_taker" src/components/strategy-v2/TradeMixSubPanel.tsx` returns 0 in the active 2-bucket render path (the type union from src/lib/types.ts still imports them transitively, but the component does not render them).
- **Grok B-04 invariant: panel6 makes ZERO calls to `fetchStrategyLazyMetrics`. `grep -c "fetchOnIntersect: false" src/components/strategy-v2/TradeAndPositionPanel.tsx` returns 1.**
- `npm test -- src/components --run` (existing 14a tests + new 14b-04 tests) all green.
</verification>

<success_criteria>
- KPI-12 (Trade summary), KPI-13 (Position summary), KPI-14 (Risk-Reward), KPI-15 (SQN), KPI-16 (Volume), KPI-17 partial (2-bucket Trade Mix) all rendered.
- KPI-23b Panel 6 partial-data: panel-level banner when no trades.
- 4-bucket maker/taker explicitly NOT rendered — mode prop reserved for v0.17.1 flip.
- MetricCell primitive ready for re-use in 14b-05 BenchmarkGreeksTable.
- **Grok B-04 mitigation: panel6 does NOT fire the lazy fetch. Eager `trade_metrics` is the sole data source. Lazy lifecycle errors cannot mask valid panel content. Keyboard / parity / partial-data tests still observe `data-panel-status="ready"` once the section scrolls into view because the hook's intersection lifecycle still runs.**
</success_criteria>

<output>
After completion, create `.planning/phases/14b-single-strategy-v2-lazy-panels-trade-exposure/14b-04-SUMMARY.md` documenting the cell label inventory, the volume-aggregator JSONB extras read pattern, the Grok B-04 fetchOnIntersect=false decision and rationale, and any deviations.
</output>
