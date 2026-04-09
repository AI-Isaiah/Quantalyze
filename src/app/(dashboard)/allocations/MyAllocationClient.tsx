"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
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
 * Interactive bits on top of the scenarios layer:
 *  - Timeframe selector (1DTD … All) that re-windows every metric and
 *    both the composite + per-strategy curves.
 *  - Legend under the chart — click a strategy chip to hide/show its
 *    line. Hidden strategies drop out of the composite and every KPI.
 *  - Allocation pie — AUM share per strategy, clickable to toggle.
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
// Timeframe
// =========================================================================

const TIMEFRAMES = [
  { key: "1DTD", label: "1D" },
  { key: "1WTD", label: "1W" },
  { key: "1MTD", label: "1M" },
  { key: "1QTD", label: "1Q" },
  { key: "1YTD", label: "YTD" },
  { key: "3YTD", label: "3Y" },
  { key: "ALL", label: "All" },
] as const;

type TimeframeKey = (typeof TIMEFRAMES)[number]["key"];

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * Compute the timeframe's start date (ISO YYYY-MM-DD) from the
 * reference "today" date. The reference is the most recent date in
 * the data — not wall-clock today — so the window lines up with
 * whatever the analytics pipeline last synced.
 */
function getTimeframeStart(
  timeframe: TimeframeKey,
  lastDataDate: string | null,
  portfolioInceptionDate: string,
): string {
  if (timeframe === "ALL" || !lastDataDate) return portfolioInceptionDate;

  const [y, m, d] = lastDataDate.split("-").map((x) => parseInt(x, 10));
  const ref = new Date(Date.UTC(y, m - 1, d));

  switch (timeframe) {
    case "1DTD": {
      const start = new Date(ref);
      start.setUTCDate(start.getUTCDate() - 1);
      return isoDate(start);
    }
    case "1WTD": {
      // Monday of the week containing ref (UTC)
      const start = new Date(ref);
      const dow = start.getUTCDay(); // 0 = Sun
      const delta = dow === 0 ? 6 : dow - 1;
      start.setUTCDate(start.getUTCDate() - delta);
      return isoDate(start);
    }
    case "1MTD": {
      return isoDate(new Date(Date.UTC(ref.getUTCFullYear(), ref.getUTCMonth(), 1)));
    }
    case "1QTD": {
      const qStartMonth = Math.floor(ref.getUTCMonth() / 3) * 3;
      return isoDate(new Date(Date.UTC(ref.getUTCFullYear(), qStartMonth, 1)));
    }
    case "1YTD": {
      return isoDate(new Date(Date.UTC(ref.getUTCFullYear(), 0, 1)));
    }
    case "3YTD": {
      const start = new Date(ref);
      start.setUTCFullYear(start.getUTCFullYear() - 3);
      return isoDate(start);
    }
    default:
      return portfolioInceptionDate;
  }
}

function TimeframeSelector({
  value,
  onChange,
}: {
  value: TimeframeKey;
  onChange: (next: TimeframeKey) => void;
}) {
  return (
    <div
      role="tablist"
      aria-label="Timeframe"
      className="inline-flex items-center rounded-lg border border-border bg-surface p-0.5 gap-0.5"
    >
      {TIMEFRAMES.map((t) => {
        const active = value === t.key;
        return (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(t.key)}
            className={`px-2.5 py-1 text-xs font-medium tabular-nums rounded-md transition-colors ${
              active
                ? "bg-accent text-white"
                : "text-text-secondary hover:text-text-primary hover:bg-bg-secondary"
            }`}
          >
            {t.label}
          </button>
        );
      })}
    </div>
  );
}

// =========================================================================
// Multi-line equity curve (composite + per-strategy)
// =========================================================================

interface StrategySeries {
  id: string;
  name: string;
  color: string;
  points: DailyPoint[];
}

function MultiLineEquityChart({
  composite,
  strategies,
  emptyMessage,
}: {
  composite: DailyPoint[];
  strategies: StrategySeries[];
  emptyMessage: string;
}) {
  const hasAnything =
    composite.length >= 2 || strategies.some((s) => s.points.length >= 2);
  if (!hasAnything) {
    return (
      <div className="flex h-64 items-center justify-center rounded-lg border border-border bg-bg-secondary text-sm text-text-muted">
        {emptyMessage}
      </div>
    );
  }

  const width = 800;
  const height = 280;
  const padding = { top: 12, right: 16, bottom: 28, left: 48 };
  const innerW = width - padding.left - padding.right;
  const innerH = height - padding.top - padding.bottom;

  // Build the union date axis from the composite (it's the densest).
  // Fallback to the longest strategy if no composite.
  const axis =
    composite.length > 0
      ? composite.map((p) => p.date)
      : [...strategies].sort((a, b) => b.points.length - a.points.length)[0]
          ?.points.map((p) => p.date) ?? [];
  if (axis.length < 2) {
    return (
      <div className="flex h-64 items-center justify-center rounded-lg border border-border bg-bg-secondary text-sm text-text-muted">
        {emptyMessage}
      </div>
    );
  }

  const axisIndex = new Map(axis.map((d, i) => [d, i]));

  // Gather every value to compute the Y range across composite + strategies
  const allValues: number[] = [];
  for (const p of composite) allValues.push(p.value);
  for (const s of strategies) for (const p of s.points) allValues.push(p.value);
  const minV = Math.min(0, ...allValues);
  const maxV = Math.max(0, ...allValues);
  const range = maxV - minV || 1;

  const xFor = (i: number) =>
    padding.left + (i / (axis.length - 1)) * innerW;
  const yFor = (v: number) =>
    padding.top + innerH - ((v - minV) / range) * innerH;

  const pointsToPath = (pts: DailyPoint[]): string => {
    if (pts.length === 0) return "";
    const segs: string[] = [];
    let started = false;
    for (const p of pts) {
      const i = axisIndex.get(p.date);
      if (i === undefined) continue;
      segs.push(`${started ? "L" : "M"} ${xFor(i).toFixed(2)} ${yFor(p.value).toFixed(2)}`);
      started = true;
    }
    return segs.join(" ");
  };

  const compositePath = pointsToPath(composite);
  const compositeArea =
    composite.length > 0
      ? compositePath +
        ` L ${xFor(axis.length - 1).toFixed(2)} ${yFor(0).toFixed(2)}` +
        ` L ${xFor(0).toFixed(2)} ${yFor(0).toFixed(2)} Z`
      : "";

  const yTicks = Array.from(
    new Set([minV, 0, maxV].map((v) => Math.round(v * 1000) / 1000)),
  );

  return (
    <div className="rounded-lg border border-border bg-bg-secondary p-3">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="w-full h-72"
        aria-label="Allocation equity curve, portfolio composite plus per-strategy lines"
        role="img"
      >
        <defs>
          <linearGradient id="my-allocation-grad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#1B6B5A" stopOpacity="0.22" />
            <stop offset="100%" stopColor="#1B6B5A" stopOpacity="0.02" />
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

        {/* Per-strategy lines first so the composite sits on top */}
        {strategies.map((s) => {
          const d = pointsToPath(s.points);
          if (!d) return null;
          return (
            <path
              key={s.id}
              d={d}
              stroke={s.color}
              strokeWidth="1.5"
              fill="none"
              strokeLinecap="round"
              strokeLinejoin="round"
              opacity="0.85"
            />
          );
        })}

        {/* Composite area + line */}
        {compositeArea ? (
          <path d={compositeArea} fill="url(#my-allocation-grad)" stroke="none" />
        ) : null}
        {compositePath ? (
          <path
            d={compositePath}
            stroke="#1B6B5A"
            strokeWidth="2.5"
            fill="none"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        ) : null}

        <text x={padding.left} y={height - 8} fontSize="10" fill="#64748B">
          {axis[0]}
        </text>
        <text
          x={width - padding.right}
          y={height - 8}
          fontSize="10"
          textAnchor="end"
          fill="#64748B"
        >
          {axis[axis.length - 1]}
        </text>
      </svg>
    </div>
  );
}

// =========================================================================
// Legend — clickable chips that toggle strategy visibility
// =========================================================================

function StrategyLegend({
  items,
  hiddenIds,
  onToggle,
}: {
  items: { id: string; name: string; color: string }[];
  hiddenIds: Set<string>;
  onToggle: (id: string) => void;
}) {
  if (items.length === 0) return null;
  return (
    <div className="mt-3 flex flex-wrap items-center gap-2">
      <div className="inline-flex items-center gap-1.5 rounded-md bg-bg-secondary px-2 py-1">
        <span
          className="inline-block h-0.5 w-3 rounded"
          style={{ background: "#1B6B5A" }}
          aria-hidden="true"
        />
        <span className="text-[11px] font-medium text-text-primary">
          Portfolio
        </span>
      </div>
      {items.map((it) => {
        const hidden = hiddenIds.has(it.id);
        return (
          <button
            key={it.id}
            type="button"
            onClick={() => onToggle(it.id)}
            aria-pressed={!hidden}
            className={`inline-flex items-center gap-1.5 rounded-md px-2 py-1 border transition-colors ${
              hidden
                ? "border-border bg-surface text-text-muted"
                : "border-transparent bg-bg-secondary text-text-primary hover:bg-border"
            }`}
            title={hidden ? `Show ${it.name}` : `Hide ${it.name}`}
          >
            <span
              className="inline-block h-0.5 w-3 rounded"
              style={{ background: hidden ? "#CBD5E1" : it.color }}
              aria-hidden="true"
            />
            <span className="text-[11px] font-medium">{it.name}</span>
          </button>
        );
      })}
    </div>
  );
}

// =========================================================================
// Allocation pie — AUM share per strategy
// =========================================================================

function AllocationPie({
  slices,
  hiddenIds,
  onToggle,
}: {
  slices: {
    id: string;
    name: string;
    color: string;
    amount: number;
  }[];
  hiddenIds: Set<string>;
  onToggle: (id: string) => void;
}) {
  const visible = slices.filter((s) => !hiddenIds.has(s.id));
  const total = visible.reduce((sum, s) => sum + s.amount, 0);
  if (total <= 0) {
    return (
      <div className="flex h-48 items-center justify-center rounded-lg border border-border bg-bg-secondary text-sm text-text-muted">
        Allocation data unavailable.
      </div>
    );
  }

  const cx = 90;
  const cy = 90;
  const r = 80;

  // Build SVG arc paths. Pre-compute start angles as a cumulative sum so
  // the render-time closure never mutates state.
  const startAngles: number[] = [];
  {
    let running = -Math.PI / 2; // start at 12 o'clock
    for (const s of visible) {
      startAngles.push(running);
      running += (s.amount / total) * Math.PI * 2;
    }
  }
  const paths = visible.map((s, i) => {
    const angle = startAngles[i];
    const sweep = (s.amount / total) * Math.PI * 2;
    const x1 = cx + Math.cos(angle) * r;
    const y1 = cy + Math.sin(angle) * r;
    const x2 = cx + Math.cos(angle + sweep) * r;
    const y2 = cy + Math.sin(angle + sweep) * r;
    const largeArc = sweep > Math.PI ? 1 : 0;
    // Full-circle edge case: draw a tiny gap so the path still renders
    const d =
      sweep >= Math.PI * 2 - 1e-6
        ? `M ${cx} ${cy - r} A ${r} ${r} 0 1 1 ${cx - 0.01} ${cy - r} Z`
        : `M ${cx} ${cy} L ${x1.toFixed(3)} ${y1.toFixed(3)} A ${r} ${r} 0 ${largeArc} 1 ${x2.toFixed(3)} ${y2.toFixed(3)} Z`;
    return {
      id: s.id,
      name: s.name,
      color: s.color,
      d,
      pct: s.amount / total,
    };
  });

  return (
    <div className="flex flex-col items-start gap-3 md:flex-row md:items-center md:gap-6">
      <svg
        viewBox="0 0 180 180"
        className="w-44 h-44 shrink-0"
        aria-label="Allocation share per strategy"
        role="img"
      >
        {paths.map((p) => (
          <path
            key={p.id}
            d={p.d}
            fill={p.color}
            stroke="#F8FAFC"
            strokeWidth="1.5"
          />
        ))}
      </svg>
      <ul className="min-w-0 flex-1 space-y-1.5">
        {slices.map((s) => {
          const hidden = hiddenIds.has(s.id);
          const pct = hidden ? 0 : s.amount / total;
          return (
            <li key={s.id}>
              <button
                type="button"
                onClick={() => onToggle(s.id)}
                aria-pressed={!hidden}
                className={`flex w-full items-center gap-2 rounded-md px-2 py-1 text-left transition-colors ${
                  hidden
                    ? "text-text-muted hover:bg-bg-secondary"
                    : "text-text-primary hover:bg-bg-secondary"
                }`}
              >
                <span
                  className="inline-block h-3 w-3 rounded-sm shrink-0"
                  style={{
                    background: hidden ? "#E2E8F0" : s.color,
                  }}
                  aria-hidden="true"
                />
                <span className="flex-1 truncate text-[12px] font-medium">
                  {s.name}
                </span>
                <span className="shrink-0 text-[11px] font-metric tabular-nums text-text-muted">
                  {hidden ? "—" : `${(pct * 100).toFixed(1)}%`}
                </span>
                <span className="shrink-0 w-16 text-right text-[11px] font-metric tabular-nums">
                  {formatCurrency(s.amount)}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
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

  // Build a stable strategy_id → palette color map in the order the
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

  // Scenario state: hidden → inactive; per-strategy start clamped to
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

  // Allocation pie slices — use allocated_amount when present, fall back
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
                  · {metrics.effective_start} → {metrics.effective_end} ·{" "}
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
