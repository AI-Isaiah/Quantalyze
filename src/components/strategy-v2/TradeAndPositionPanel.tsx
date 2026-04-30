"use client";

import { useLazyPanelMetrics } from "@/hooks/useLazyPanelMetrics";
import { PartialDataBanner } from "./PartialDataBanner";
import { MetricCell } from "./MetricCell";
import { TradeMixSubPanel } from "./TradeMixSubPanel";
import type { TradeMetrics } from "@/lib/types";

interface TradeAndPositionPanelProps {
  strategyId: string;
  /**
   * From getStrategyDetailV2 — the trade_metrics JSONB blob carries
   * volume-aggregator extras (gross/mean/daily/monthly volume, payoff,
   * profit_factor, winners/losers counts). All are declared optional on
   * `TradeMetrics` so consumers must null-check; no `Record<string,unknown>`
   * widening is needed.
   */
  trade_metrics: TradeMetrics | null;
  /**
   * data_quality_flags subset relevant to this panel. trade_mix_approximation
   * is true when the strategy has any short positions — the buy→long fill-side
   * bucketing mis-attributes "buy to close short" as a long entry.
   */
  data_quality_flags?: { trade_mix_approximation?: boolean } | null;
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
 * Trades & positions panel wrapper.
 *
 * Mounts a 4-row metric strip (Trade Summary / Position Summary /
 * Risk-Reward + SQN / Volume) and a 2-bucket Trade Mix sub-panel. Reads
 * from the EAGER analytics blob's `trade_metrics` field — derived metrics
 * are persisted in `strategy_analytics.trade_metrics` JSONB.
 *
 * The trades panel maps to a kinds row that returns ARRAY[]::TEXT[] (no
 * sibling kinds). All panel data lives on the eager analytics blob
 * (props.trade_metrics). Firing the lazy fetch creates an opportunity for
 * transient RPC errors to mask valid eager data with no upside (lazy
 * payload is always {}). The opts.fetchOnIntersect=false flag (see hook
 * call below) makes the hook only track intersection lifecycle
 * (idle → ready) without firing a fetch — keyboard, chart-parity, and
 * partial-data tests still see `data-panel-status="ready"` once the
 * section scrolls into view, but no network call is made.
 *
 * Eager partial-data gate looks at props.trade_metrics ONLY — independent
 * of `status` so a transient lazy lifecycle hiccup cannot hide valid data.
 *
 * Trade Mix renders 2-bucket or 4-bucket based on buckets shape. The
 * 4-bucket maker/taker render is driven by the analytics worker's
 * TRADE_MIX_HAS_MAKER_TAKER env flag.
 */
export function TradeAndPositionPanel({
  strategyId,
  trade_metrics,
  data_quality_flags,
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
        <Body
          trade_metrics={trade_metrics!}
          data_quality_flags={data_quality_flags}
        />
      )}
    </section>
  );
}

function Body({
  trade_metrics: tm,
  data_quality_flags,
}: {
  trade_metrics: TradeMetrics;
  data_quality_flags?: { trade_mix_approximation?: boolean } | null;
}) {
  const grossVolume = tm.gross_volume_usd;
  const meanTradeSize = tm.mean_trade_size_usd;
  const dailyTurnover = tm.daily_turnover_usd;
  const monthlyTurnover = tm.monthly_turnover_usd;
  const payoffRatio = tm.payoff_ratio;
  const profitFactor = tm.profit_factor;
  const winners = tm.winners_count;
  const losers = tm.losers_count;

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

      <TradeMixSubPanel
        buckets={tm.trade_mix}
        approximate={data_quality_flags?.trade_mix_approximation === true}
      />
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
