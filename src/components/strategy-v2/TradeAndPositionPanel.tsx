"use client";

import { useLazyPanelMetrics } from "@/hooks/useLazyPanelMetrics";
import { PartialDataBanner } from "./PartialDataBanner";
import { MetricCell } from "./MetricCell";
import { TradeMixSubPanel } from "./TradeMixSubPanel";
import type { TradeMetrics } from "@/lib/types";

interface TradeAndPositionPanelProps {
  strategyId: string;
  /**
   * From getStrategyDetailV2 — the trade_metrics JSONB blob may carry
   * volume-aggregator extras beyond the frozen TradeMetrics interface
   * (Phase 12 Plan 12-05 SUMMARY merges {gross/mean/daily/monthly}_volume_usd
   * etc. into the same blob at orchestrator level).
   */
  trade_metrics: (TradeMetrics & Record<string, unknown>) | null;
}

/**
 * Deterministic compact USD formatter — avoids Intl.NumberFormat compact-notation
 * ICU divergence across Node versions (Node 20 ICU 73 renders $320.0K; Node 25 renders $320K).
 * Produces: $12.5M, $6.4K, $320K, $9.7M etc. — trailing `.0` is always suppressed.
 */
function fmtUsdCompactDeterministic(v: number): string {
  const abs = Math.abs(v);
  let scaled: number;
  let suffix: string;
  if (abs >= 1_000_000_000) {
    scaled = v / 1_000_000_000;
    suffix = "B";
  } else if (abs >= 1_000_000) {
    scaled = v / 1_000_000;
    suffix = "M";
  } else if (abs >= 1_000) {
    scaled = v / 1_000;
    suffix = "K";
  } else {
    return `$${v.toFixed(0)}`;
  }
  // Round to 1 decimal; strip trailing ".0".
  const str = scaled.toFixed(1).replace(/\.0$/, "");
  return `$${str}${suffix}`;
}

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
  return fmtUsdCompactDeterministic(v);
}

function fmtCount(v: number | null | undefined): string | null {
  if (v == null || !Number.isFinite(v)) return null;
  return Math.round(v).toLocaleString();
}

/**
 * Phase 14b-04 / KPI-12+13+14+15+16+17(2-bucket)+23b — Panel 6 wrapper.
 *
 * Mounts a 4-row metric strip (Trade Summary / Position Summary /
 * Risk-Reward + SQN / Volume) and a 2-bucket Trade Mix sub-panel inside the
 * 14a panel chrome. Reads from the EAGER analytics blob's `trade_metrics`
 * field (Phase 12 METRICS-07 / METRICS-08 / METRICS-09 shipped derived
 * metrics into `strategy_analytics.trade_metrics` JSONB).
 *
 * Grok B-04: panel6 maps to 'trades' which migration 087 returns as
 * ARRAY[]::TEXT[] (no sibling kinds). All Panel-6 data lives on the eager
 * analytics blob (props.trade_metrics). Firing the lazy fetch creates an
 * opportunity for transient RPC errors to mask valid eager data with no
 * upside (lazy payload is always {}). The opts.fetchOnIntersect=false flag
 * (see hook call below) makes the hook only track intersection lifecycle
 * (idle → ready) without firing a fetch — keyboard,
 * chart-parity, and partial-data tests still see `data-panel-status="ready"`
 * once the section scrolls into view, but no network call is made.
 *
 * Eager partial-data gate looks at props.trade_metrics ONLY — independent
 * of `status` so a transient lazy lifecycle hiccup cannot hide valid data.
 *
 * KPI-17 partial: 2-bucket Trade Mix only. The 4-bucket maker/taker
 * dimension is descoped to v0.17.1 (gated on `is_maker` ingestion fix in
 * analytics-service/services/exchange.py for Binance/OKX/Bybit).
 */
export function TradeAndPositionPanel({
  strategyId,
  trade_metrics,
}: TradeAndPositionPanelProps) {
  // strategyId is intentionally referenced (not consumed) to keep the
  // parent wiring contract identical to other lazy panels for symmetry.
  void strategyId;
  const { ref, status } = useLazyPanelMetrics<Record<string, never>>("panel6", {
    fetchOnIntersect: false,
  });

  const noTrades =
    !trade_metrics || (trade_metrics.total_positions ?? 0) === 0;

  return (
    <section
      ref={ref}
      id="panel-trades"
      tabIndex={-1}
      data-panel="trades"
      data-panel-status={status === "idle" ? "placeholder" : status}
      aria-label="Trades & positions"
      className="mt-8 min-h-[240px] rounded-lg border border-border bg-surface p-6 shadow-card"
    >
      <h2 className="text-base font-semibold text-text-primary">
        Trades &amp; positions
      </h2>

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

function Body({
  trade_metrics: tm,
}: {
  trade_metrics: TradeMetrics & Record<string, unknown>;
}) {
  // Volume aggregator extras (Phase 12 Plan 12-05 SUMMARY) live as JSONB extras
  // on the trade_metrics blob. Read defensively.
  const grossVolume = tm["gross_volume_usd"] as number | null | undefined;
  const meanTradeSize = tm["mean_trade_size_usd"] as number | null | undefined;
  const dailyTurnover = tm["daily_turnover_usd"] as number | null | undefined;
  const monthlyTurnover = tm["monthly_turnover_usd"] as number | null | undefined;
  const payoffRatio = tm["payoff_ratio"] as number | null | undefined;
  const profitFactor = tm["profit_factor"] as number | null | undefined;
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
            value={
              tm.avg_duration_days != null && Number.isFinite(tm.avg_duration_days)
                ? `${tm.avg_duration_days.toFixed(1)} d`
                : null
            }
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

      {/* Trade Mix sub-panel (KPI-17 partial — 2-bucket only; v0.17.1 flips 4-bucket) */}
      <TradeMixSubPanel buckets={tm.trade_mix} mode="2-bucket" />
    </div>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="border-t border-border pt-4">
      <h3 className="mb-4 text-xs font-normal uppercase tracking-wider text-text-secondary">
        {title}
      </h3>
      {children}
    </div>
  );
}

function Grid({
  cols,
  children,
}: {
  cols: 4 | 6 | 8;
  children: React.ReactNode;
}) {
  const gridCols =
    cols === 4 ? "grid-cols-4" : cols === 6 ? "grid-cols-6" : "grid-cols-8";
  return <div className={`grid ${gridCols} gap-3`}>{children}</div>;
}
