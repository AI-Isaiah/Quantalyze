"use client";

import { useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import {
  formatCurrency,
  formatPercent,
  formatNumber,
  metricColor,
} from "@/lib/utils";
import { FundKPIStrip } from "@/components/portfolio/FundKPIStrip";
import { StrategyMtdBars } from "@/components/portfolio/StrategyMtdBars";
import { FavoritesPanel } from "@/components/portfolio/FavoritesPanel";
import {
  buildDateMapCache,
  computeCompositeCurve,
  computeFavoritesOverlayCurve,
  computeStrategyCurve,
  type StrategyForBuilder,
  type DailyPoint,
} from "@/lib/scenario";
import type {
  PortfolioAnalytics,
  Portfolio,
  UserFavoriteWithStrategy,
} from "@/lib/types";
import Link from "next/link";

/**
 * My Allocation client shell.
 *
 * Takes the server-fetched payload from getMyAllocationDashboard and
 * renders the full multi-strategy view: Fund KPI strip, YTD PnL chart
 * (multi-line overlay, one per strategy + portfolio composite), MTD
 * return bars, and strategy breakdown table.
 *
 * This is a client component because PortfolioEquityCurve (lightweight-
 * charts) is client-only. The server component (page.tsx) passes
 * pre-fetched data as props — no further fetches happen here.
 *
 * PR 4 adds the Favorites panel wiring on top: a right-side slide-out
 * panel whose toggles feed into computeCompositeCurve to produce the
 * dashed "+ Favorites" overlay line on the chart. The Favorites button
 * in the header is stubbed as a no-op in PR 3 and fully wired in PR 4.
 */

// Lazy-load the equity curve — lightweight-charts is a ~200KB client
// dependency and isn't needed for above-the-fold rendering.
const PortfolioEquityCurve = dynamic(
  () =>
    import("@/components/portfolio/PortfolioEquityCurve").then(
      (m) => m.PortfolioEquityCurve,
    ),
  {
    ssr: false,
    loading: () => (
      <div className="h-[350px] bg-bg-secondary rounded-lg animate-pulse" />
    ),
  },
);

interface StrategyRow {
  strategy_id: string;
  current_weight: number | null;
  allocated_amount: number | null;
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

interface MyAllocationClientProps {
  portfolio: Portfolio;
  analytics: PortfolioAnalytics | null;
  strategies: StrategyRow[];
  favorites: UserFavoriteWithStrategy[];
  alertCount: { high: number; medium: number; low: number; total: number };
}

/**
 * Coerce the strategy_analytics.daily_returns JSONB into a flat
 * { date, value }[] series. The analytics-service writer stores this as
 * an array of daily points but older rows may have a dict-of-dicts
 * shape — this normalizer handles both without assuming one.
 */
function normalizeDailyReturns(
  raw: unknown,
): DailyPoint[] {
  if (!raw) return [];
  if (Array.isArray(raw)) {
    // Already in the expected shape.
    return raw
      .filter(
        (p): p is DailyPoint =>
          p !== null &&
          typeof p === "object" &&
          "date" in p &&
          "value" in p &&
          typeof (p as DailyPoint).date === "string" &&
          typeof (p as DailyPoint).value === "number",
      )
      .sort((a, b) => a.date.localeCompare(b.date));
  }
  // Dict-of-dicts fallback: { "2024": { "01-02": 0.003, ... } } or
  // { "2024-01-02": 0.003, ... } — we handle both because it's cheap.
  const out: DailyPoint[] = [];
  const obj = raw as Record<string, unknown>;
  for (const [k, v] of Object.entries(obj)) {
    if (typeof v === "number") {
      out.push({ date: k, value: v });
    } else if (v && typeof v === "object") {
      for (const [kk, vv] of Object.entries(v as Record<string, unknown>)) {
        if (typeof vv === "number") {
          const date = kk.length === 10 ? kk : `${k}-${kk}`;
          out.push({ date, value: vv });
        }
      }
    }
  }
  return out.sort((a, b) => a.date.localeCompare(b.date));
}

export function MyAllocationClient({
  portfolio,
  analytics,
  strategies,
  favorites,
  alertCount,
}: MyAllocationClientProps) {
  // Panel open/close state — driven by the "View Favorites" button.
  const [panelOpen, setPanelOpen] = useState(false);
  // Active favorite strategy ids — driven by toggles inside the panel.
  // When non-empty, we compute a "+ Favorites" overlay curve and pass it
  // to PortfolioEquityCurve as the dashed overlay line.
  const [activeFavoriteIds, setActiveFavoriteIds] = useState<string[]>([]);

  // Build the StrategyForBuilder shapes the scenario math consumes,
  // once per render. Strategies without daily_returns drop out of the
  // chart but stay in the breakdown table.
  const strategiesForBuilder = useMemo<StrategyForBuilder[]>(
    () =>
      strategies
        .map((row) => {
          const dr = normalizeDailyReturns(
            row.strategy.strategy_analytics?.daily_returns,
          );
          return {
            id: row.strategy.id,
            name: row.strategy.name,
            codename: row.strategy.codename,
            disclosure_tier: row.strategy.disclosure_tier,
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

  const weightsById = useMemo(() => {
    const out: Record<string, number> = {};
    for (const row of strategies) {
      out[row.strategy_id] = row.current_weight ?? 0;
    }
    return out;
  }, [strategies]);

  const inceptionDate = portfolio.created_at.slice(0, 10);

  // Build per-strategy cumulative curves for the chart's strategies prop.
  const strategyCurves = useMemo(
    () =>
      strategiesForBuilder.map((s) => ({
        id: s.id,
        name: s.name,
        equityCurve: computeStrategyCurve(s.daily_returns),
      })),
    [strategiesForBuilder],
  );

  // Build the portfolio composite curve from the real strategies +
  // current weights. This is what draws as the bold accent line on the
  // chart (the "Portfolio" series). Matches the data-density principle:
  // one composite, one line, no widget chrome.
  const dateMapCache = useMemo(
    () => buildDateMapCache(strategiesForBuilder),
    [strategiesForBuilder],
  );
  const portfolioEquityCurve = useMemo(
    () =>
      computeCompositeCurve(
        strategiesForBuilder,
        weightsById,
        inceptionDate,
        dateMapCache,
      ),
    [strategiesForBuilder, weightsById, inceptionDate, dateMapCache],
  );

  // Build StrategyForBuilder shapes for favorites (same normalization
  // pipeline as the real strategies — the overlay math treats both sets
  // uniformly). Favorites without daily_returns drop out. codename +
  // disclosure_tier coalesce to safe defaults because the Strategy type
  // marks them optional; StrategyForBuilder requires them non-undefined.
  const favoritesForBuilder = useMemo<StrategyForBuilder[]>(
    () =>
      favorites
        .map((f) => {
          const dr = normalizeDailyReturns(
            f.strategy.strategy_analytics?.daily_returns,
          );
          return {
            id: f.strategy.id,
            name: f.strategy.name,
            codename: f.strategy.codename ?? null,
            disclosure_tier: f.strategy.disclosure_tier ?? "exploratory",
            strategy_types: f.strategy.strategy_types,
            markets: f.strategy.markets,
            start_date: f.strategy.start_date,
            daily_returns: dr,
            cagr: f.strategy.strategy_analytics?.cagr ?? null,
            sharpe: f.strategy.strategy_analytics?.sharpe ?? null,
            volatility: f.strategy.strategy_analytics?.volatility ?? null,
            max_drawdown:
              f.strategy.strategy_analytics?.max_drawdown ?? null,
          };
        })
        .filter((s) => s.daily_returns.length > 0),
    [favorites],
  );

  // Compute the "+ Favorites" overlay curve when any favorite is
  // toggled ON. When all are off (or no favorites exist at all), the
  // overlay is null and the chart renders only the real portfolio line
  // + per-strategy lines.
  const overlayCurve = useMemo(() => {
    if (activeFavoriteIds.length === 0) return null;
    const activeFavorites = favoritesForBuilder.filter((f) =>
      activeFavoriteIds.includes(f.id),
    );
    if (activeFavorites.length === 0) return null;
    return computeFavoritesOverlayCurve(
      strategiesForBuilder,
      weightsById,
      activeFavorites,
      inceptionDate,
    );
  }, [
    activeFavoriteIds,
    favoritesForBuilder,
    strategiesForBuilder,
    weightsById,
    inceptionDate,
  ]);

  // MTD bars: use the server-side attribution_breakdown from the
  // portfolio_analytics row if present, otherwise fall back to each
  // strategy's summary metric if available. The plan only specs
  // return_mtd at the fund level, not per-strategy, so we approximate
  // by using each strategy's recent 21-day cumulative return.
  const mtdRows = useMemo(
    () =>
      strategiesForBuilder.map((s) => {
        // Recent 21 business days ≈ 1 month.
        const slice = s.daily_returns.slice(-21);
        let c = 1;
        for (const d of slice) c *= 1 + d.value;
        const mtd = slice.length > 0 ? c - 1 : null;
        return {
          strategy_id: s.id,
          strategy_name: s.name,
          return_mtd: mtd,
        };
      }),
    [strategiesForBuilder],
  );

  return (
    <>
      <header className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl md:text-4xl text-text-primary tracking-tight">
            My Allocation
          </h1>
          <p className="mt-1 text-sm text-text-secondary">
            <span>{portfolio.name}</span>
            <span className="mx-2 text-text-muted">·</span>
            <span className="font-metric tabular-nums">
              {strategies.length}
            </span>
            <span className="text-text-muted">
              {" "}
              {strategies.length === 1 ? "strategy" : "strategies"}
            </span>
            {analytics?.total_aum != null && (
              <>
                <span className="mx-2 text-text-muted">·</span>
                <span className="font-metric tabular-nums">
                  {formatCurrency(analytics.total_aum)}
                </span>
              </>
            )}
          </p>
        </div>
        {/* Favorites panel trigger. Opens the right-side slide-out that
            hosts the watchlist toggles and the Save-as-Test modal. */}
        <button
          type="button"
          onClick={() => setPanelOpen(true)}
          className="inline-flex items-center gap-1 rounded-md border border-border px-3 py-2 text-sm text-text-secondary hover:text-text-primary hover:border-accent/40 hover:bg-bg-secondary transition-colors"
          aria-label="View favorites"
        >
          View Favorites
          <span aria-hidden="true">›</span>
          {favorites.length > 0 && (
            <span className="ml-1 rounded-full bg-accent/10 px-1.5 text-[10px] font-medium text-accent font-metric tabular-nums">
              {favorites.length}
            </span>
          )}
        </button>
      </header>

      {alertCount.total > 0 && (
        <div className="mb-6 bg-accent/5 border border-accent/20 rounded-md px-4 py-3 flex items-center justify-between gap-4">
          <p className="text-sm text-text-secondary">
            <span className="font-medium text-text-primary">
              {alertCount.total}
            </span>{" "}
            unacknowledged{" "}
            {alertCount.total === 1 ? "alert" : "alerts"}
          </p>
          <div className="flex items-center gap-2">
            {alertCount.high > 0 && (
              <Badge label={`${alertCount.high} High`} />
            )}
            {alertCount.medium > 0 && (
              <Badge label={`${alertCount.medium} Medium`} />
            )}
            {alertCount.low > 0 && (
              <Badge label={`${alertCount.low} Low`} />
            )}
          </div>
        </div>
      )}

      <div className="mb-8">
        <FundKPIStrip
          aum={analytics?.total_aum ?? null}
          return24h={analytics?.return_24h ?? null}
          returnMtd={analytics?.return_mtd ?? null}
          returnYtd={analytics?.return_ytd ?? null}
        />
      </div>

      <section aria-label="YTD PnL by strategy" className="mb-8 space-y-3">
        <h2 className="text-[10px] uppercase tracking-wider text-text-muted font-semibold">
          YTD PnL by Strategy
        </h2>
        <div className="bg-surface border border-border rounded-lg">
          {strategiesForBuilder.length === 0 ? (
            <div className="h-[350px] flex items-center justify-center text-sm text-text-muted">
              No strategies with daily return history yet.
            </div>
          ) : (
            <PortfolioEquityCurve
              portfolioEquityCurve={portfolioEquityCurve}
              strategies={strategyCurves}
              overlayCurve={overlayCurve}
              overlayLabel="+ Favorites"
            />
          )}
        </div>
      </section>

      <div className="mb-8">
        <StrategyMtdBars rows={mtdRows} />
      </div>

      <section aria-label="Strategy breakdown" className="space-y-3">
        <h2 className="text-[10px] uppercase tracking-wider text-text-muted font-semibold">
          Strategies
        </h2>
        {strategies.length === 0 ? (
          <Card className="text-center py-8">
            <p className="text-text-muted mb-4">
              Your book is empty. Browse strategies to add your first
              allocation.
            </p>
            <Link
              href="/strategies"
              className="inline-flex items-center rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-hover transition-colors"
            >
              Browse Strategies
            </Link>
          </Card>
        ) : (
          <div className="bg-surface border border-border rounded-lg overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border">
                  <th className="text-left px-5 py-3 text-[10px] uppercase tracking-wider text-text-muted font-semibold">
                    Name
                  </th>
                  <th className="text-right px-3 py-3 text-[10px] uppercase tracking-wider text-text-muted font-semibold">
                    Weight
                  </th>
                  <th className="text-right px-3 py-3 text-[10px] uppercase tracking-wider text-text-muted font-semibold">
                    Allocated
                  </th>
                  <th className="text-right px-3 py-3 text-[10px] uppercase tracking-wider text-text-muted font-semibold">
                    CAGR
                  </th>
                  <th className="text-right px-3 py-3 text-[10px] uppercase tracking-wider text-text-muted font-semibold">
                    Sharpe
                  </th>
                  <th className="text-right px-3 py-3 text-[10px] uppercase tracking-wider text-text-muted font-semibold">
                    Max DD
                  </th>
                  <th className="text-right px-5 py-3 text-[10px] uppercase tracking-wider text-text-muted font-semibold">
                    Vol
                  </th>
                </tr>
              </thead>
              <tbody>
                {strategies.map((row) => {
                  const a = row.strategy.strategy_analytics;
                  return (
                    <tr
                      key={row.strategy_id}
                      className="border-b border-border last:border-b-0 hover:bg-accent/5 transition-colors"
                    >
                      <td className="px-5 py-3">
                        <Link
                          href={`/strategies/${row.strategy.id}`}
                          className="text-text-primary hover:text-accent transition-colors font-medium"
                        >
                          {row.strategy.name}
                        </Link>
                        <p className="text-[10px] text-text-muted mt-0.5">
                          {row.strategy.strategy_types.join(" · ")}
                        </p>
                      </td>
                      <td className="text-right px-3 py-3 font-metric tabular-nums text-text-primary">
                        {row.current_weight != null
                          ? `${(row.current_weight * 100).toFixed(0)}%`
                          : "—"}
                      </td>
                      <td className="text-right px-3 py-3 font-metric tabular-nums text-text-secondary">
                        {row.allocated_amount != null
                          ? formatCurrency(row.allocated_amount)
                          : "—"}
                      </td>
                      <td
                        className={`text-right px-3 py-3 font-metric tabular-nums ${metricColor(a?.cagr)}`}
                      >
                        {formatPercent(a?.cagr ?? null)}
                      </td>
                      <td
                        className={`text-right px-3 py-3 font-metric tabular-nums ${metricColor(a?.sharpe)}`}
                      >
                        {formatNumber(a?.sharpe ?? null)}
                      </td>
                      <td className="text-right px-3 py-3 font-metric tabular-nums text-negative">
                        {formatPercent(a?.max_drawdown ?? null)}
                      </td>
                      <td className="text-right px-5 py-3 font-metric tabular-nums text-text-secondary">
                        {formatPercent(a?.volatility ?? null)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <FavoritesPanel
        open={panelOpen}
        onClose={() => setPanelOpen(false)}
        favorites={favoritesForBuilder}
        realStrategyIds={strategies.map((s) => s.strategy_id)}
        realPortfolioName={portfolio.name}
        onSelectionChange={setActiveFavoriteIds}
      />
    </>
  );
}
