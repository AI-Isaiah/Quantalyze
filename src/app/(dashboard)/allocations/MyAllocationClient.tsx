"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Card } from "@/components/ui/Card";
import {
  formatCurrency,
  formatPercent,
  formatNumber,
  metricColor,
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
import Link from "next/link";

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
 * What's different from /scenarios:
 *  - No toggles. These are real investments, not optional what-ifs.
 *  - Each row has an editable alias (the allocator's name for this
 *    investment, stored in portfolio_strategies.alias). Falls back to
 *    the strategy's canonical display name when null.
 *  - An inline "Exchange connections" section below the dashboard
 *    reuses AllocatorExchangeManager so the allocator can add more
 *    investments without leaving the page.
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

/**
 * Normalize the analytics.daily_returns JSONB into a flat
 * { date, value }[] series. Handles three real-world shapes: already
 * an array, a flat {date: value} dict, and a nested {year: {MM-DD: value}}
 * dict. The nested case zero-pads MM-DD components so lexicographic
 * sorting aligns with every other strategy's dates.
 */
function normalizeDailyReturns(raw: unknown): DailyPoint[] {
  if (!raw) return [];
  if (Array.isArray(raw)) {
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
  const out: DailyPoint[] = [];
  const obj = raw as Record<string, unknown>;
  for (const [k, v] of Object.entries(obj)) {
    if (typeof v === "number") {
      out.push({ date: k, value: v });
    } else if (v && typeof v === "object") {
      for (const [kk, vv] of Object.entries(v as Record<string, unknown>)) {
        if (typeof vv === "number") {
          // If the inner key is already a full ISO date, use it. If it's
          // a month-day ("01-02" or "1-2"), pad both components and
          // prefix with the outer year key.
          if (kk.length === 10) {
            out.push({ date: kk, value: vv });
          } else {
            const [mm = "", dd = ""] = kk.split("-");
            const paddedMm = mm.padStart(2, "0");
            const paddedDd = dd.padStart(2, "0");
            out.push({ date: `${k}-${paddedMm}-${paddedDd}`, value: vv });
          }
        }
      }
    }
  }
  return out.sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * Pick the display name for an investment row. The allocator-provided
 * alias takes priority; otherwise the strategy's codename (for
 * exploratory-tier) or canonical name.
 */
function displayName(row: StrategyRow): string {
  if (row.alias && row.alias.trim()) return row.alias.trim();
  if (row.strategy.disclosure_tier === "exploratory" && row.strategy.codename) {
    return row.strategy.codename;
  }
  return row.strategy.name;
}

// =========================================================================
// Pure-SVG equity curve — identical style to ScenarioBuilder's chart
// =========================================================================

function EquityCurveChart({
  points,
  emptyMessage,
}: {
  points: Array<{ date: string; value: number }>;
  emptyMessage: string;
}) {
  if (points.length < 2) {
    return (
      <div className="flex h-64 items-center justify-center rounded-lg border border-border bg-bg-secondary text-sm text-text-muted">
        {emptyMessage}
      </div>
    );
  }
  const width = 800;
  const height = 260;
  const padding = { top: 12, right: 16, bottom: 28, left: 48 };
  const innerW = width - padding.left - padding.right;
  const innerH = height - padding.top - padding.bottom;

  const values = points.map((p) => p.value);
  const minV = Math.min(0, ...values);
  const maxV = Math.max(0, ...values);
  const range = maxV - minV || 1;

  const xFor = (i: number) =>
    padding.left + (i / (points.length - 1)) * innerW;
  const yFor = (v: number) =>
    padding.top + innerH - ((v - minV) / range) * innerH;

  const path = points
    .map(
      (p, i) => `${i === 0 ? "M" : "L"} ${xFor(i).toFixed(2)} ${yFor(p.value).toFixed(2)}`,
    )
    .join(" ");

  const areaPath =
    path +
    ` L ${xFor(points.length - 1).toFixed(2)} ${yFor(0).toFixed(2)}` +
    ` L ${xFor(0).toFixed(2)} ${yFor(0).toFixed(2)} Z`;

  const yTicks = [minV, 0, maxV].filter(
    (v, i, arr) => arr.indexOf(v) === i,
  );

  return (
    <div className="rounded-lg border border-border bg-bg-secondary p-3">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="w-full h-64"
        aria-label="My Allocation equity curve"
        role="img"
      >
        <defs>
          <linearGradient id="my-allocation-grad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#1B6B5A" stopOpacity="0.35" />
            <stop offset="100%" stopColor="#1B6B5A" stopOpacity="0.05" />
          </linearGradient>
        </defs>
        {yTicks.map((v) => (
          <g key={v}>
            <line
              x1={padding.left}
              x2={width - padding.right}
              y1={yFor(v)}
              y2={yFor(v)}
              stroke="#E2E8F0"
              strokeDasharray="3 3"
            />
            <text
              x={padding.left - 6}
              y={yFor(v) + 4}
              fontSize="10"
              textAnchor="end"
              fill="#64748B"
            >
              {(v * 100).toFixed(0)}%
            </text>
          </g>
        ))}
        <path d={areaPath} fill="url(#my-allocation-grad)" stroke="none" />
        <path
          d={path}
          stroke="#1B6B5A"
          strokeWidth="2"
          fill="none"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <text
          x={padding.left}
          y={height - 8}
          fontSize="10"
          fill="#64748B"
        >
          {points[0].date}
        </text>
        <text
          x={width - padding.right}
          y={height - 8}
          fontSize="10"
          textAnchor="end"
          fill="#64748B"
        >
          {points[points.length - 1].date}
        </text>
      </svg>
    </div>
  );
}

// =========================================================================
// KPI metric card — same visual as ScenarioBuilder's MetricCard
// =========================================================================

function MetricCard({
  label,
  value,
  positive,
  negative,
}: {
  label: string;
  value: string;
  positive?: boolean;
  negative?: boolean;
}) {
  const color = positive
    ? "text-positive"
    : negative
      ? "text-negative"
      : "text-text-primary";
  return (
    <div className="rounded-lg border border-border bg-surface p-3">
      <p className="text-[10px] uppercase tracking-wider text-text-muted font-medium">
        {label}
      </p>
      <p
        className={`mt-1 text-xl font-bold font-metric tabular-nums ${color}`}
      >
        {value}
      </p>
    </div>
  );
}

// =========================================================================
// Inline alias editor — pencil icon flips the row into edit mode
// =========================================================================

function AliasEditor({
  row,
  portfolioId,
  initial,
  canonical,
}: {
  row: StrategyRow;
  portfolioId: string;
  initial: string | null;
  canonical: string;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(initial ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    if (saving) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/portfolio-strategies/alias", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          portfolio_id: portfolioId,
          strategy_id: row.strategy_id,
          alias: value.trim() || null,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `Save failed (${res.status})`);
      }
      setEditing(false);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  function cancel() {
    setValue(initial ?? "");
    setEditing(false);
    setError(null);
  }

  if (!editing) {
    const shown = initial?.trim() || canonical;
    return (
      <div className="flex items-center gap-2 min-w-0">
        <Link
          href={`/strategies/${row.strategy.id}`}
          className="font-medium text-text-primary hover:text-accent transition-colors truncate"
          title={canonical}
        >
          {shown}
        </Link>
        <button
          type="button"
          onClick={() => setEditing(true)}
          className="shrink-0 text-text-muted hover:text-accent transition-colors"
          aria-label={`Rename ${shown}`}
          title="Rename this investment"
        >
          <svg
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="w-3.5 h-3.5"
            aria-hidden="true"
          >
            <path d="M11.5 2.5l2 2L6 12l-3 .5L3.5 9.5z" />
          </svg>
        </button>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2 min-w-0">
      <input
        type="text"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") save();
          if (e.key === "Escape") cancel();
        }}
        placeholder={canonical}
        autoFocus
        maxLength={120}
        disabled={saving}
        className="flex-1 min-w-0 rounded-md border border-border px-2 py-1 text-sm font-medium bg-surface focus:outline-none focus:border-accent"
      />
      <button
        type="button"
        onClick={save}
        disabled={saving}
        className="text-xs px-2 py-1 rounded border border-accent bg-accent text-white hover:bg-accent-hover disabled:opacity-60"
      >
        {saving ? "…" : "Save"}
      </button>
      <button
        type="button"
        onClick={cancel}
        disabled={saving}
        className="text-xs px-2 py-1 rounded border border-border text-text-secondary hover:text-text-primary"
      >
        Cancel
      </button>
      {error && <span className="text-[10px] text-negative">{error}</span>}
    </div>
  );
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

  // Pre-build the date-map cache so the scenario recompute is fast.
  const dateMapCache = useMemo(
    () => buildDateMapCache(strategiesForBuilder),
    [strategiesForBuilder],
  );

  // Scenario state: all strategies active, weighted by their
  // current_weight from portfolio_strategies, starting from each
  // strategy's own start_date (or the seed default).
  const scenarioState = useMemo<ScenarioState>(() => {
    const selected: Record<string, boolean> = {};
    const weights: Record<string, number> = {};
    const startDates: Record<string, string> = {};
    for (const row of strategies) {
      selected[row.strategy_id] = true;
      weights[row.strategy_id] = row.current_weight ?? 0;
      startDates[row.strategy_id] = row.strategy.start_date ?? "2022-01-01";
    }
    return { selected, weights, startDates };
  }, [strategies]);

  const metrics = useMemo(
    () => computeScenario(strategiesForBuilder, scenarioState, dateMapCache),
    [strategiesForBuilder, scenarioState, dateMapCache],
  );

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
            <span className="mx-2 text-text-muted">·</span>
            <span className="font-metric tabular-nums">
              {strategies.length}
            </span>
            <span className="text-text-muted">
              {" "}
              {strategies.length === 1 ? "investment" : "investments"}
            </span>
            {analytics?.total_aum != null ? (
              <>
                <span className="mx-2 text-text-muted">·</span>
                <span className="font-metric tabular-nums">
                  {formatCurrency(analytics.total_aum)}
                </span>
              </>
            ) : totalAllocated > 0 ? (
              <>
                <span className="mx-2 text-text-muted">·</span>
                <span className="font-metric tabular-nums">
                  {formatCurrency(totalAllocated)}
                </span>
              </>
            ) : null}
          </p>
        </div>
      </header>

      {/* KPI strip (scenario-style) */}
      <div className="grid grid-cols-2 md:grid-cols-6 gap-3 mb-6">
        <MetricCard
          label="TWR"
          value={formatPercent(metrics.twr)}
          positive={metrics.twr != null && metrics.twr > 0}
          negative={metrics.twr != null && metrics.twr < 0}
        />
        <MetricCard label="CAGR" value={formatPercent(metrics.cagr)} />
        <MetricCard label="Sharpe" value={formatNumber(metrics.sharpe)} />
        <MetricCard label="Sortino" value={formatNumber(metrics.sortino)} />
        <MetricCard
          label="Max DD"
          value={formatPercent(metrics.max_drawdown)}
          negative={metrics.max_drawdown != null && metrics.max_drawdown < 0}
        />
        <MetricCard
          label="Avg |corr|"
          value={formatNumber(metrics.avg_pairwise_correlation)}
        />
      </div>

      {/* Equity curve */}
      <Card className="mb-6">
        <div className="mb-3">
          <h2 className="text-sm font-semibold text-text-primary">
            Allocation equity curve
          </h2>
          <p className="text-xs text-text-muted mt-0.5">
            {strategiesForBuilder.length} active investments
            {metrics.effective_start && metrics.effective_end ? (
              <>
                {" "}
                · {metrics.effective_start} → {metrics.effective_end} ·{" "}
                {metrics.n} days
              </>
            ) : null}
          </p>
        </div>
        <EquityCurveChart
          points={metrics.equity_curve}
          emptyMessage={
            strategies.length === 0
              ? "Connect an exchange below to start tracking your real investments."
              : "Waiting for analytics to compute — check back after the next sync."
          }
        />
      </Card>

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
                      {row.strategy.strategy_types.join(" · ")}
                      {row.strategy.markets.length > 0
                        ? ` · ${row.strategy.markets.slice(0, 3).join(", ")}`
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
                        : "—"}
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
