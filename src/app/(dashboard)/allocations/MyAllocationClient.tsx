"use client";

import { useMemo, useState } from "react";
import { Card } from "@/components/ui/Card";
import {
  formatCurrency,
  formatPercent,
  formatNumber,
  metricColor,
  STRATEGY_PALETTE,
} from "@/lib/utils";
import {
  buildDateMapCache,
  computeScenario,
  type StrategyForBuilder,
  type DailyPoint,
  type ScenarioState,
} from "@/lib/scenario";
import { AllocatorExchangeManager } from "@/components/exchanges/AllocatorExchangeManager";
import type { Portfolio, PortfolioAnalytics } from "@/lib/types";

import { TimeframeSelector, type TimeframeKey } from "@/components/ui/TimeframeSelector";
import { MetricCard } from "@/components/ui/MetricCard";
import { MultiLineEquityChart, StrategyLegend, type StrategySeries } from "@/components/portfolio/MultiLineEquityChart";
import { AllocationPie } from "@/components/portfolio/AllocationPie";
import { AliasEditor } from "@/components/portfolio/AliasEditor";
import { normalizeDailyReturns, displayName, getTimeframeStart } from "@/lib/allocation-helpers";

/**
 * My Allocation — Scenario-Builder-style live view of the allocator's
 * actual investments.
 *
 * Each row is a real investment they made by giving an external team
 * read-only API key access to their exchange account. Data comes from
 * the analytics-service sync pipeline (trade pulls → portfolio_strategies
 * + allocation_events). The page uses the same scenario math library
 * the /scenarios page uses so the KPI strip, equity curve, and
 * correlation matrix are structurally identical to the what-if lab,
 * just fed with REAL data instead of hypothetical toggles.
 *
 * Interactive bits on top of the scenarios layer:
 *  - Timeframe selector (1DTD ... All) that re-windows every metric and
 *    both the composite + per-strategy curves.
 *  - Legend under the chart -- click a strategy chip to hide/show its
 *    line. Hidden strategies drop out of the composite and every KPI.
 *  - Allocation pie -- AUM share per strategy, clickable to toggle.
 *  - Editable alias per row (pencil icon), stored in
 *    portfolio_strategies.alias. Falls back to the strategy's codename
 *    or canonical name.
 */

interface StrategyRow {
  strategy_id: string;
  current_weight: number | null;
  allocated_amount: number | null;
  alias: string | null;
  strategy: {
    id: string;
    name: string;
    codename: string | null;
    disclosure_tier: string;
    strategy_types: string[];
    markets: string[];
    start_date: string | null;
    strategy_analytics: {
      daily_returns:
        | Record<string, Record<string, number>>
        | DailyPoint[]
        | null;
      cagr: number | null;
      sharpe: number | null;
      volatility: number | null;
      max_drawdown: number | null;
    } | null;
  };
}

interface ApiKeyRow {
  id: string;
  exchange: string;
  label: string;
  is_active: boolean;
  sync_status: string | null;
  last_sync_at: string | null;
  account_balance_usdt: number | null;
  created_at: string;
}

interface MyAllocationClientProps {
  portfolio: Portfolio;
  analytics: PortfolioAnalytics | null;
  strategies: StrategyRow[];
  apiKeys: ApiKeyRow[];
}

// =========================================================================
// Main client component
// =========================================================================

export function MyAllocationClient({
  portfolio,
  analytics,
  strategies,
  apiKeys,
}: MyAllocationClientProps) {
  // Build StrategyForBuilder rows the scenario math consumes. Rows
  // without daily_returns drop out of the chart/metric computation
  // but stay in the investment list below.
  const strategiesForBuilder = useMemo<StrategyForBuilder[]>(
    () =>
      strategies
        .map((row) => {
          const dr = normalizeDailyReturns(
            row.strategy.strategy_analytics?.daily_returns,
          );
          return {
            id: row.strategy_id,
            name: displayName(row),
            codename: row.strategy.codename ?? null,
            disclosure_tier: row.strategy.disclosure_tier ?? "exploratory",
            strategy_types: row.strategy.strategy_types,
            markets: row.strategy.markets,
            start_date: row.strategy.start_date,
            daily_returns: dr,
            cagr: row.strategy.strategy_analytics?.cagr ?? null,
            sharpe: row.strategy.strategy_analytics?.sharpe ?? null,
            volatility: row.strategy.strategy_analytics?.volatility ?? null,
            max_drawdown:
              row.strategy.strategy_analytics?.max_drawdown ?? null,
          };
        })
        .filter((s) => s.daily_returns.length > 0),
    [strategies],
  );

  // Build a stable strategy_id -> palette color map in the order the
  // strategies appear in the allocation list.
  const colorById = useMemo(() => {
    const m = new Map<string, string>();
    strategiesForBuilder.forEach((s, i) => {
      m.set(s.id, STRATEGY_PALETTE[i % STRATEGY_PALETTE.length]);
    });
    return m;
  }, [strategiesForBuilder]);

  // Pre-build the date-map cache so the scenario recompute is fast.
  const dateMapCache = useMemo(
    () => buildDateMapCache(strategiesForBuilder),
    [strategiesForBuilder],
  );

  // The last date in the data (union of all strategies' daily_returns).
  const lastDataDate = useMemo(() => {
    let latest: string | null = null;
    for (const s of strategiesForBuilder) {
      const tail = s.daily_returns[s.daily_returns.length - 1]?.date;
      if (tail && (!latest || tail > latest)) latest = tail;
    }
    return latest;
  }, [strategiesForBuilder]);

  const inceptionDate =
    portfolio.created_at?.slice(0, 10) ?? "2022-01-01";

  const [timeframe, setTimeframe] = useState<TimeframeKey>("1YTD");
  const [hiddenIds, setHiddenIds] = useState<Set<string>>(new Set());

  const timeframeStart = useMemo(
    () => getTimeframeStart(timeframe, lastDataDate, inceptionDate),
    [timeframe, lastDataDate, inceptionDate],
  );

  // Scenario state: hidden -> inactive; per-strategy start clamped to
  // max(timeframeStart, own start_date).
  const scenarioState = useMemo<ScenarioState>(() => {
    const selected: Record<string, boolean> = {};
    const weights: Record<string, number> = {};
    const startDates: Record<string, string> = {};
    for (const row of strategies) {
      const ownStart = row.strategy.start_date ?? inceptionDate;
      const clampedStart = timeframeStart > ownStart ? timeframeStart : ownStart;
      selected[row.strategy_id] = !hiddenIds.has(row.strategy_id);
      weights[row.strategy_id] = row.current_weight ?? 0;
      startDates[row.strategy_id] = clampedStart;
    }
    return { selected, weights, startDates };
  }, [strategies, hiddenIds, timeframeStart, inceptionDate]);

  const metrics = useMemo(
    () => computeScenario(strategiesForBuilder, scenarioState, dateMapCache),
    [strategiesForBuilder, scenarioState, dateMapCache],
  );

  // Scenario math returns null metrics + empty equity_curve when the
  // common-date window has fewer than 10 days. For short timeframes
  // (1D / 1W / 1M) that's most of the time. Compute a simple weighted
  // composite curve manually so the chart still has a portfolio line
  // and the TWR + Max DD KPIs still populate. Sharpe / Sortino / CAGR
  // stay null for small n because they're statistically noisy.
  const fallback = useMemo(() => {
    if (metrics.equity_curve.length > 0) {
      return { compositeCurve: null, twr: null, max_drawdown: null };
    }
    const visible = strategiesForBuilder.filter(
      (s) => scenarioState.selected[s.id],
    );
    if (visible.length === 0)
      return { compositeCurve: null, twr: null, max_drawdown: null };

    const allDates = new Set<string>();
    for (const s of visible) {
      const from = scenarioState.startDates[s.id];
      for (const p of s.daily_returns) {
        if (p.date >= from) allDates.add(p.date);
      }
    }
    const dates = Array.from(allDates).sort();
    if (dates.length < 2)
      return { compositeCurve: null, twr: null, max_drawdown: null };

    const totalWeight = visible.reduce(
      (sum, s) => sum + (scenarioState.weights[s.id] ?? 0),
      0,
    );
    if (totalWeight <= 0)
      return { compositeCurve: null, twr: null, max_drawdown: null };

    const compositeCurve: DailyPoint[] = [];
    let wealth = 1;
    for (const d of dates) {
      let activeWeight = 0;
      let weightedReturn = 0;
      for (const s of visible) {
        const from = scenarioState.startDates[s.id];
        if (d < from) continue;
        const point = s.daily_returns.find((p) => p.date === d);
        if (!point) continue;
        const w = scenarioState.weights[s.id] ?? 0;
        activeWeight += w;
        weightedReturn += w * point.value;
      }
      if (activeWeight > 0) {
        wealth *= 1 + weightedReturn / activeWeight;
      }
      compositeCurve.push({ date: d, value: wealth - 1 });
    }

    if (compositeCurve.length < 2)
      return { compositeCurve: null, twr: null, max_drawdown: null };

    const twr =
      compositeCurve[compositeCurve.length - 1].value - compositeCurve[0].value;

    let peak = compositeCurve[0].value;
    let maxDD = 0;
    for (const p of compositeCurve) {
      if (p.value > peak) peak = p.value;
      const dd = (p.value - peak) / (1 + peak);
      if (dd < maxDD) maxDD = dd;
    }

    return { compositeCurve, twr, max_drawdown: maxDD };
  }, [metrics.equity_curve.length, strategiesForBuilder, scenarioState]);

  const displayTwr = metrics.twr ?? fallback.twr;
  const displayMaxDD = metrics.max_drawdown ?? fallback.max_drawdown;
  const displayComposite = metrics.equity_curve.length > 0
    ? metrics.equity_curve
    : fallback.compositeCurve ?? [];

  // Per-strategy curves for the multi-line chart. Each is the cumulative
  // growth of that strategy from the timeframe start, normalized so the
  // first visible point is 0% (matches the composite's scale).
  const strategySeries = useMemo<StrategySeries[]>(() => {
    return strategiesForBuilder
      .map((s) => {
        if (hiddenIds.has(s.id)) return null;
        const window = s.daily_returns.filter((p) => p.date >= timeframeStart);
        if (window.length < 2) return null;
        let cum = 1;
        const points: DailyPoint[] = new Array(window.length);
        for (let i = 0; i < window.length; i++) {
          cum *= 1 + window[i].value;
          points[i] = { date: window[i].date, value: cum - 1 };
        }
        return {
          id: s.id,
          name: s.name,
          color: colorById.get(s.id) ?? "#64748B",
          points,
        };
      })
      .filter((s): s is StrategySeries => s !== null);
  }, [strategiesForBuilder, hiddenIds, timeframeStart, colorById]);

  const legendItems = strategiesForBuilder.map((s) => ({
    id: s.id,
    name: s.name,
    color: colorById.get(s.id) ?? "#64748B",
  }));

  const toggleStrategy = (id: string) => {
    setHiddenIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  // Allocation pie slices -- use allocated_amount when present, fall back
  // to current_weight as a share, skipping zero-amount rows.
  const pieSlices = strategies
    .map((row) => {
      const amount =
        row.allocated_amount ??
        (row.current_weight != null && analytics?.total_aum != null
          ? analytics.total_aum * row.current_weight
          : 0);
      return {
        id: row.strategy_id,
        name: displayName(row),
        color: colorById.get(row.strategy_id) ?? "#64748B",
        amount,
      };
    })
    .filter((s) => s.amount > 0);

  const totalAllocated = strategies.reduce(
    (sum, row) => sum + (row.allocated_amount ?? 0),
    0,
  );

  return (
    <main className="max-w-[1280px] mx-auto p-6 pb-20">
      {/* Header */}
      <header className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl md:text-4xl text-text-primary tracking-tight">
            My Allocation
          </h1>
          <p className="mt-1 text-sm text-text-secondary">
            <span>{portfolio.name}</span>
            <span className="mx-2 text-text-muted">&middot;</span>
            <span className="font-metric tabular-nums">
              {strategies.length}
            </span>
            <span className="text-text-muted">
              {" "}
              {strategies.length === 1 ? "investment" : "investments"}
            </span>
            {analytics?.total_aum != null ? (
              <>
                <span className="mx-2 text-text-muted">&middot;</span>
                <span className="font-metric tabular-nums">
                  {formatCurrency(analytics.total_aum)}
                </span>
              </>
            ) : totalAllocated > 0 ? (
              <>
                <span className="mx-2 text-text-muted">&middot;</span>
                <span className="font-metric tabular-nums">
                  {formatCurrency(totalAllocated)}
                </span>
              </>
            ) : null}
          </p>
        </div>
        <TimeframeSelector value={timeframe} onChange={setTimeframe} />
      </header>

      {/* KPI strip (scenario-style, windowed by timeframe) */}
      <div className="grid grid-cols-2 md:grid-cols-6 gap-3 mb-6">
        <MetricCard
          label="TWR"
          value={formatPercent(displayTwr)}
          positive={displayTwr != null && displayTwr > 0}
          negative={displayTwr != null && displayTwr < 0}
        />
        <MetricCard label="CAGR" value={formatPercent(metrics.cagr)} />
        <MetricCard label="Sharpe" value={formatNumber(metrics.sharpe)} />
        <MetricCard label="Sortino" value={formatNumber(metrics.sortino)} />
        <MetricCard
          label="Max DD"
          value={formatPercent(displayMaxDD)}
          negative={displayMaxDD != null && displayMaxDD < 0}
        />
        <MetricCard
          label="Avg |corr|"
          value={formatNumber(metrics.avg_pairwise_correlation)}
        />
      </div>

      {/* Equity curve (multi-line) */}
      <Card className="mb-6">
        <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
          <div>
            <h2 className="text-sm font-semibold text-text-primary">
              Allocation equity curve
            </h2>
            <p className="text-xs text-text-muted mt-0.5">
              {strategiesForBuilder.length - hiddenIds.size} of{" "}
              {strategiesForBuilder.length} active
              {metrics.effective_start && metrics.effective_end ? (
                <>
                  {" "}
                  &middot; {metrics.effective_start} &rarr; {metrics.effective_end} &middot;{" "}
                  {metrics.n} days
                </>
              ) : null}
            </p>
          </div>
        </div>
        <MultiLineEquityChart
          composite={displayComposite}
          strategies={strategySeries}
          emptyMessage={
            strategies.length === 0
              ? "Connect an exchange below to start tracking your real investments."
              : "No data in the selected timeframe."
          }
        />
        <StrategyLegend
          items={legendItems}
          hiddenIds={hiddenIds}
          onToggle={toggleStrategy}
        />
      </Card>

      {/* Allocation pie */}
      {pieSlices.length > 0 ? (
        <Card className="mb-6">
          <div className="mb-3">
            <h2 className="text-sm font-semibold text-text-primary">
              Allocation share
            </h2>
            <p className="text-xs text-text-muted mt-0.5">
              AUM split across your connected investments. Click a row to
              hide it from the chart and KPIs above.
            </p>
          </div>
          <AllocationPie
            slices={pieSlices}
            hiddenIds={hiddenIds}
            onToggle={toggleStrategy}
          />
        </Card>
      ) : null}

      {/* Investments list */}
      <Card className="mb-6">
        <div className="mb-3">
          <h2 className="text-sm font-semibold text-text-primary">
            Investments
          </h2>
          <p className="text-xs text-text-muted mt-0.5">
            Each row is a team you&apos;ve connected to your exchange account.
            Click the pencil to rename it.
          </p>
        </div>
        {strategies.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border bg-bg-secondary p-8 text-center">
            <p className="text-sm text-text-secondary">
              No investments yet. Connect a read-only exchange API key below
              to start tracking your real positions.
            </p>
          </div>
        ) : (
          <div className="divide-y divide-border border border-border rounded-lg overflow-hidden">
            {strategies.map((row) => {
              const a = row.strategy.strategy_analytics;
              const canonical =
                (row.strategy.disclosure_tier === "exploratory" &&
                  row.strategy.codename) ||
                row.strategy.name;
              return (
                <div
                  key={row.strategy_id}
                  className="grid grid-cols-[minmax(0,2fr)_1fr_1fr_1fr_1fr] items-center gap-3 bg-surface px-4 py-3"
                >
                  <div className="min-w-0">
                    <AliasEditor
                      row={row}
                      portfolioId={portfolio.id}
                      initial={row.alias}
                      canonical={canonical}
                    />
                    <p className="mt-0.5 text-[10px] text-text-muted line-clamp-1">
                      {row.strategy.strategy_types.join(" \u00B7 ")}
                      {row.strategy.markets.length > 0
                        ? ` \u00B7 ${row.strategy.markets.slice(0, 3).join(", ")}`
                        : ""}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-[10px] uppercase tracking-wider text-text-muted font-semibold">
                      Allocated
                    </p>
                    <p className="text-sm font-metric tabular-nums text-text-primary">
                      {row.allocated_amount != null
                        ? formatCurrency(row.allocated_amount)
                        : "\u2014"}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-[10px] uppercase tracking-wider text-text-muted font-semibold">
                      CAGR
                    </p>
                    <p
                      className={`text-sm font-metric tabular-nums ${metricColor(a?.cagr)}`}
                    >
                      {formatPercent(a?.cagr ?? null)}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-[10px] uppercase tracking-wider text-text-muted font-semibold">
                      Sharpe
                    </p>
                    <p
                      className={`text-sm font-metric tabular-nums ${metricColor(a?.sharpe)}`}
                    >
                      {formatNumber(a?.sharpe ?? null)}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-[10px] uppercase tracking-wider text-text-muted font-semibold">
                      Max DD
                    </p>
                    <p className="text-sm font-metric tabular-nums text-negative">
                      {formatPercent(a?.max_drawdown ?? null)}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Card>

      {/* Exchange connections (inline) */}
      <AllocatorExchangeManager initialKeys={apiKeys} />
    </main>
  );
}
