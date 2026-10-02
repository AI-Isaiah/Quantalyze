---
phase: 14b
plan: 04
subsystem: strategy-v2
tags: [strategy-v2, panel-6, trade-position, trade-mix, partial-data, kpi-17-2bucket, grok-b-04]
requires:
  - 14a panel chrome (data-panel/data-panel-status/aria-label/section + 14a card classes)
  - 14a PartialDataBanner primitive (src/components/strategy-v2/PartialDataBanner.tsx)
  - 14a useLazyPanelMetrics hook (src/hooks/useLazyPanelMetrics.ts) — fetchOnIntersect option already shipped
  - Phase 12 TradeMetrics + TradeMixBuckets contract (src/lib/types.ts)
  - Phase 12 / Plan 12-05 volume aggregator JSONB extras merged into trade_metrics blob
provides:
  - MetricCell primitive (src/components/strategy-v2/MetricCell.tsx) — reused by 14b-05 BenchmarkGreeksTable
  - TradeMixSubPanel (src/components/strategy-v2/TradeMixSubPanel.tsx) — 2-bucket Long/Short bars; mode prop reserved for v0.17.1 4-bucket flip
  - TradeAndPositionPanel wrapper (src/components/strategy-v2/TradeAndPositionPanel.tsx) — Panel 6 implementation, NOT yet wired in StrategyV2Shell
affects:
  - 14b-06 — will mount <TradeAndPositionPanel /> inside the StrategyV2Shell scroll, replacing the LazyPanelPlaceholder slot for Panel 6
  - v0.17.1 — flips TradeMixSubPanel mode prop to '4-bucket' once is_maker ingestion ships
tech-stack:
  added: []
  patterns:
    - Eager-only lazy panel (Grok B-04): useLazyPanelMetrics with fetchOnIntersect=false — intersection lifecycle still tracked, but no network call
    - Defensive JSONB-extras read via Record<string, unknown> indexing (gross_volume_usd / payoff_ratio / winners_count / etc. are out-of-band keys merged into the frozen TradeMetrics interface by the orchestrator)
    - Compact USD via Intl.NumberFormat({notation:"compact", style:"currency", currency:"USD"})
    - Semantic <dl><dt><dd> wrapping per MetricCell (24 dl elements per panel)
key-files:
  created:
    - src/components/strategy-v2/MetricCell.tsx
    - src/components/strategy-v2/MetricCell.test.tsx
    - src/components/strategy-v2/TradeMixSubPanel.tsx
    - src/components/strategy-v2/TradeMixSubPanel.test.tsx
    - src/components/strategy-v2/TradeAndPositionPanel.tsx
    - src/components/strategy-v2/TradeAndPositionPanel.test.tsx
  modified: []
decisions:
  - "Grok B-04: panel6 uses fetchOnIntersect=false because migration 087 returns ARRAY[]::TEXT[] for the 'trades' kind — there are no sibling rows to fetch. Firing the lazy fetch only created an opportunity for transient RPC errors to mask valid eager data with no upside (lazy payload is always {})."
  - "Eager partial-data gate looks at props.trade_metrics ONLY (not lazy lifecycle status) — independent so a transient lifecycle hiccup cannot hide valid data."
  - "KPI-17 ships 2-bucket only. The mode='2-bucket' | '4-bucket' prop signature is stable; the 4-bucket render branch returns a fallback message ('4-bucket maker/taker mode is reserved for v0.17.1.') so the v0.17.1 flip is a 1-prop change in the consumer."
  - "SQN renders as the 8th cell on the Risk-Reward row (UI-SPEC §3.3 planner discretion — chosen for visual symmetry with the 8-column grid)."
  - "Volume aggregator extras (gross_volume_usd / mean_trade_size_usd / daily_turnover_usd / monthly_turnover_usd / payoff_ratio / profit_factor / winners_count / losers_count) are out-of-band keys on the trade_metrics JSONB blob — read defensively via tm[key] as number | null | undefined, em-dash if absent."
metrics:
  duration_minutes: 8
  completed_date: "2026-04-29"
  tests: 25
  files_created: 6
  files_modified: 0
---

# Phase 14b Plan 04: Panel 6 — Trade & Position + Trade Mix (2-bucket) Summary

Panel 6 ships as an eager-only metric panel: 4 metric rows (Trade summary / Position summary / Risk-reward profile / Volume metrics) plus a 2-bucket Trade Mix sub-panel mounted in the 14a panel chrome, reading exclusively from the eager `trade_metrics` JSONB blob (no lazy network call) per Grok B-04.

## What shipped

### 1. `MetricCell` primitive (Task 1)

Shared 12px label + 18px Geist Mono semibold tabular-nums value primitive wrapped in semantic `<dl><dt><dd>`. Em-dash (`U+2014`) for null. `text-negative` Tailwind utility (resolved from `--color-negative: #DC2626` declared in `@theme inline` in `src/app/globals.css`) when the caller passes `negative={true}`. Designed for reuse by Plan 14b-05 BenchmarkGreeksTable.

### 2. `TradeMixSubPanel` (Task 1)

2-bucket Long/Short horizontal-bar visualization. Concrete visual contract:

- Container: `mt-8 border-t border-border pt-6`
- H3: "Trade mix" (sentence-case) — `text-xs font-normal uppercase tracking-wider text-text-secondary`
- Long bar: `#1B6B5A` (CHART_ACCENT), 24px tall (`h-6`), width = `pct%`
- Short bar: `#94A3B8` (CHART_TEXT_MUTED), 24px tall, width = `pct%`
- Percent label rendered OUTSIDE the bar (right-aligned, 18px Geist Mono semibold tabular-nums)
- Raw count "(1,247 fills)" 12px regular muted next to percent label
- Empty state: "Trade mix unavailable for this strategy."
- 4-bucket fallback: "4-bucket maker/taker mode is reserved for v0.17.1." (KPI-17 partial — descoped to v0.17.1, gated on `is_maker` ingestion fix in Binance/OKX/Bybit handlers in `analytics-service/services/exchange.py`)

The `mode: '2-bucket' | '4-bucket'` prop signature is stable; the 4-bucket branch is intentionally NOT implemented in 14b but renders the fallback message so the v0.17.1 flip is a 1-prop change in the consumer.

### 3. `TradeAndPositionPanel` wrapper (Task 2 — Grok B-04 eager-only)

Mounts the 14a panel chrome (`<section data-panel="trades" data-panel-status="..." aria-label="Trades & positions" />`) with H2 "Trades & positions". Wraps a Body component that renders the 4 metric rows + Trade Mix sub-panel.

**Grok B-04 — fetchOnIntersect=false:** the wrapper invokes `useLazyPanelMetrics<Record<string, never>>("panel6", { fetchOnIntersect: false })`. The hook's intersection lifecycle (idle → ready) still runs so keyboard / chart-parity / partial-data tests see `data-panel-status="ready"` once the section scrolls into view, but `fetchStrategyLazyMetricsClient` is NEVER invoked because:

1. `panel6` maps to `'trades'` in the hook's `PANEL_TO_ID` table (`src/hooks/useLazyPanelMetrics.ts:26-31`)
2. Migration 087 (`fetch_strategy_lazy_metrics`) returns `ARRAY[]::TEXT[]` for the `'trades'` kind (no sibling rows)
3. The lazy payload would always be `{}` — firing the fetch was a no-op with downside (transient RPC errors could mask valid eager data with no upside)

The eager partial-data gate (`!trade_metrics || total_positions === 0`) reads `props.trade_metrics` ONLY — independent of the lazy lifecycle status. A transient lazy 'error' state CANNOT mask the panel.

### Cell label inventory (verbatim per UI-SPEC §10.3)

| Row | Cells (verbatim) |
|-----|------------------|
| Trade summary (6) | Total trades / Long / Short / Wins / Losses / Win rate |
| Position summary (6) | Open / Closed / Long / Short / Win rate / Avg duration |
| Risk-reward profile (8) | R:R / Weighted R:R / Profit factor / Payoff ratio / Long PF / Short PF / Expectancy / SQN |
| Volume metrics (4) | Gross volume / Mean trade size / Daily turnover / Monthly turnover |

Total: 24 MetricCells = 24 `<dl>` semantic wrappers (asserted in Test 11).

### Volume-aggregator JSONB extras read pattern

The frozen `TradeMetrics` interface in `src/lib/types.ts` does NOT include the volume aggregator outputs (`gross_volume_usd`, `mean_trade_size_usd`, `daily_turnover_usd`, `monthly_turnover_usd`) or the trade-side breakdown (`payoff_ratio`, `profit_factor`, `winners_count`, `losers_count`). Phase 12 Plan 12-05 SUMMARY confirmed these are merged into the same `trade_metrics` JSONB blob at the orchestrator level — they live alongside the frozen interface keys at runtime.

The wrapper component types its prop as `(TradeMetrics & Record<string, unknown>) | null` and reads the extras via:

```typescript
const grossVolume = tm["gross_volume_usd"] as number | null | undefined;
```

If a key is absent at runtime (older analytics blob, partial backfill), the value formatter returns `null` and the MetricCell renders an em-dash. This is the correct behavior — no runtime errors, no crashes, graceful degradation.

### Format functions

| Helper | Purpose | Example |
|--------|---------|---------|
| `fmtCount(v)` | Integer counts with thousands separator | `1948 → "1,948"` |
| `fmtPct(v)` | Decimal probability → percent string | `0.642 → "64.2%"` |
| `fmtNum(v, digits=2)` | Floating-point ratios | `1.42 → "1.42"`, `-0.42 → "-0.42"` |
| `fmtUsdCompact(v)` | USD compact via Intl.NumberFormat | `12500000 → "$12.5M"`, `6400 → "$6.4K"` |

All return `null` (not the string "null") when input is `null`, `undefined`, or non-finite — `MetricCell` renders the em-dash.

## Test coverage (25/25 passing)

### `MetricCell.test.tsx` (5/5)
1. `<dt>` renders 12px DM Sans regular text-text-muted label
2. `<dd>` renders 18px Geist Mono semibold tabular-nums for non-null values
3. Em-dash (U+2014) when value is null
4. `text-negative` class applied when `negative={true}`
5. Semantic HTML — `<dl><dt><dd></dd></dt></dl>` triple

### `TradeMixSubPanel.test.tsx` (7/7)
6. 2-bucket render — Long 64% / Short 36% bars with `#1B6B5A` and `#94A3B8` fills, percent labels OUTSIDE the bar
7. Raw counts `(1,247 fills)` next to percent labels in 12px regular muted
8. `mode` prop defaults to `'2-bucket'`
9. `mode='4-bucket'` renders fallback message — NOT 4 bars (KPI-17 partial; v0.17.1)
10. Empty state — heading + "Trade mix unavailable for this strategy."
11. Container has `mt-8 border-t border-border pt-6`
12. H3 "Trade mix" sentence-case with `text-xs font-normal uppercase tracking-wider text-text-secondary`

### `TradeAndPositionPanel.test.tsx` (13/13)
1. Chrome — `<section data-panel="trades" aria-label="Trades & positions">` with 14a card classes
2. Panel-level partial data when `trade_metrics === null` OR `total_positions === 0`
3. Trade summary row — 6 cells with verbatim labels + win-rate format `64.2%`
4. Position summary row — 6 cells with avg duration formatted as `4.7 d`
5. Risk-reward row — 8 cells incl. SQN; negative styling on negative R:R / SQN / Expectancy
5b. Risk-reward row — null values render em-dash (8 em-dashes when all RR fields null)
6. Volume row — 4 cells with USD compact format ($12.5M / $6.4K / $320K / $9.7M)
7. TradeMixSubPanel mounted with `mode='2-bucket'` and `trade_mix` buckets
8. **Grok B-04** — `useLazyPanelMetrics` called with `fetchOnIntersect: false`; `fetchStrategyLazyMetricsClient` is NEVER invoked
9. **Grok B-04** — eager rows survive lazy `status='error'` (banner does NOT appear)
10. **Grok B-04** — at `status='idle'` (pre-intersect), eager rows still render
11. Each MetricCell uses its own `<dl>` — total `<dl>` count = 24 (6+6+8+4)
12. No forbidden type-scale classes (`font-medium` / `text-sm` / `text-xl` / `text-2xl` / `text-[14px]`)

## Verification gates (all green)

| Gate | Result |
|------|--------|
| `npm test -- src/components/strategy-v2/{MetricCell,TradeMixSubPanel,TradeAndPositionPanel}.test.tsx --run` | 25/25 |
| `npm test -- src/components --run` (full regression) | 512/512 |
| `npx tsc --noEmit` | exit 0 |
| `npm run build` | exit 0 |
| `grep -c 'fetchOnIntersect: false' TradeAndPositionPanel.tsx` (Grok B-04) | 1 |
| `grep -c 'fetchOnIntersect: true' TradeAndPositionPanel.tsx` (must be 0) | 0 |
| `grep -c 'TradeAndPositionPanel\|TradeMixSubPanel' StrategyV2Shell.tsx` (NOT wired — defers to 14b-06) | 0 |
| `grep -c 'long_maker\|long_taker\|short_maker\|short_taker' TradeMixSubPanel.tsx` (KPI-17 2-bucket only) | 0 |

## Commits

| Task | Hash | Message |
|------|------|---------|
| 1 | `6f359d2` | feat(14b-04): add MetricCell + TradeMixSubPanel primitives |
| 2 | `f548f58` | feat(14b-04): add TradeAndPositionPanel (Panel 6) wrapper — eager-only per Grok B-04 |

## Deviations from Plan

None — plan executed exactly as written. The Grok B-04 revision (eager-only fetchOnIntersect=false) was already baked into the plan; no further deviation needed.

The plan's grep contract for `#1B6B5A` and `#94A3B8` (return 1) required removing literal hex references from the `TradeMixSubPanel.tsx` JSDoc — done as part of normal authoring (no behavior change). Same for the JSDoc reference to `fetchOnIntersect: false` in `TradeAndPositionPanel.tsx` — JSDoc reworded to reference the flag generically while the code retains the literal opts setting (`grep -c 'fetchOnIntersect: false'` returns 1 as required).

## Auth gates

None.

## Known stubs

- **`mode='4-bucket'` fallback message** in `TradeMixSubPanel.tsx` is intentional — KPI-17 ships 2-bucket only; the 4-bucket branch is reserved for v0.17.1 flip. The `mode` prop signature is stable so the v0.17.1 release only needs to flip the consumer's `mode="2-bucket"` to `mode="4-bucket"` AND implement the 4-bucket render branch. Documented in:
  - 14B-CONTEXT.md decisions section ("KPI-17 Trade Mix scope (locked)")
  - The component JSDoc itself
  - This SUMMARY's "What shipped" section (TradeMixSubPanel)
  - TODOS.md entry: "v0.17.1: KPI-17 Trade Mix maker/taker — gated on `is_maker` flag population on Binance + OKX + Bybit `raw_fills` ingestion."

This is a tracked, intentional, time-bounded stub — not a regression risk.

- **Volume aggregator extras read defensively** — if `gross_volume_usd` / `mean_trade_size_usd` / `daily_turnover_usd` / `monthly_turnover_usd` / `payoff_ratio` / `profit_factor` / `winners_count` / `losers_count` are absent from a strategy's `trade_metrics` JSONB blob (older analytics or partial backfill), the cells render em-dash. This is correct graceful degradation — Phase 12 Plan 12-05 confirms the orchestrator merges these keys into the blob, so production data should always have them. Em-dash fallback handles backfill gaps cleanly.

## Threat flags

None — Panel 6 is a read-only render of pre-computed metric scalars from the eager analytics blob. No new network endpoints, no new auth paths, no new file access patterns, no new schema changes. The Grok B-04 fix actually REDUCES the surface (one fewer RPC call path on render).

## Self-Check: PASSED

- All 6 created source/test files present on disk
- SUMMARY.md present at expected path
- Both task commits (`6f359d2`, `f548f58`) present in git log
- 25/25 plan-specific tests passing
- 512/512 full src/components regression suite passing
- `npx tsc --noEmit` exits 0
- `npm run build` exits 0
- Grok B-04 invariants verified: `fetchOnIntersect: false` returns 1, `: true` returns 0
- Panel NOT yet wired in StrategyV2Shell (deferred to 14b-06 per plan)
- KPI-17 2-bucket-only invariant: 0 maker/taker references in `TradeMixSubPanel.tsx`
