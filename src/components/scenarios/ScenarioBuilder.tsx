"use client";

/**
 * Interactive scenario builder.
 *
 * Renders the universe of example strategies as toggle chips. For each
 * active strategy, the allocator picks an "include from" date (defaults to
 * the strategy's inception). On every toggle or date change, the component
 * recomputes portfolio metrics CLIENT-SIDE using the raw daily-return
 * series that came down from the server:
 *
 *   weighted_daily_return[t] = sum(weight_i * strategy_i_return[t])
 *                              for strategies active at time t
 *   cumulative[t]            = prod(1 + weighted_daily_return[0..t]) - 1
 *   volatility               = std(weighted_daily_return) * sqrt(252)
 *   sharpe                   = mean(weighted_daily_return) * 252 / vol
 *   sortino                  = same, downside-only
 *   max_drawdown             = running underwater min
 *   correlation_matrix       = pairwise Pearson on active strategies
 *
 * The entire calculation runs in pure JS on every render, memoized against
 * the {selected, startDates, weights} tuple. With ~15 strategies × ~1000
 * data points each, a full recompute takes ~5-15ms — fast enough to feel
 * instant on toggle.
 *
 * No server writes. Scenarios are ephemeral. The allocator compares
 * compositions, makes a decision, then uses the rest of the app to act on
 * it (add to a portfolio via the MigrationWizard, contact the manager,
 * etc.).
 */

import { useMemo, useState } from "react";
import { CorrelationHeatmap } from "@/components/portfolio/CorrelationHeatmap";
import { Card } from "@/components/ui/Card";
import { formatPercent, formatNumber } from "@/lib/utils";

interface DailyPoint {
  date: string;
  value: number;
}

export interface StrategyForBuilder {
  id: string;
  name: string;
  codename: string | null;
  disclosure_tier: string;
  strategy_types: string[];
  markets: string[];
  start_date: string | null;
  daily_returns: DailyPoint[];
  cagr: number | null;
  sharpe: number | null;
  volatility: number | null;
  max_drawdown: number | null;
}

interface Props {
  strategies: StrategyForBuilder[];
}

interface ScenarioState {
  selected: Record<string, boolean>;
  weights: Record<string, number>; // 0..1
  startDates: Record<string, string>; // ISO date; strategy included from >= this
}

interface ComputedMetrics {
  n: number;
  twr: number | null;
  cagr: number | null;
  volatility: number | null;
  sharpe: number | null;
  sortino: number | null;
  max_drawdown: number | null;
  max_dd_days: number | null;
  correlation_matrix: Record<string, Record<string, number>> | null;
  avg_pairwise_correlation: number | null;
  equity_curve: Array<{ date: string; value: number }>;
  effective_start: string | null;
  effective_end: string | null;
}

function computeScenario(
  strategies: StrategyForBuilder[],
  state: ScenarioState,
  // Pre-built lookup Map per strategy id → (date → daily return).
  // Built once per strategies change and reused across every recompute so
  // toggling a checkbox or scrubbing a weight input doesn't reallocate 15
  // Maps of ~1000 entries each.
  dateMapCache: Map<string, Map<string, number>>,
): ComputedMetrics {
  const activeIds = strategies
    .map((s) => s.id)
    .filter((id) => state.selected[id]);
  if (activeIds.length === 0) {
    return {
      n: 0,
      twr: null,
      cagr: null,
      volatility: null,
      sharpe: null,
      sortino: null,
      max_drawdown: null,
      max_dd_days: null,
      correlation_matrix: null,
      avg_pairwise_correlation: null,
      equity_curve: [],
      effective_start: null,
      effective_end: null,
    };
  }

  const activeStrategies = strategies.filter((s) => state.selected[s.id]);
  const totalWeight = activeStrategies.reduce(
    (s, x) => s + (state.weights[x.id] ?? 0),
    0,
  );
  const normWeight = (id: string) =>
    totalWeight > 0 ? (state.weights[id] ?? 0) / totalWeight : 0;

  // Per-strategy "include from" dates are now HONORED per strategy, not
  // reduced to a global max. Build the merged date axis as the UNION of
  // every active strategy's dates >= its own configured start date. On
  // days where a strategy isn't yet active, its return is zero-filled so
  // it contributes nothing to the weighted sum for that day.
  //
  // This fixes two bugs:
  //   (a) Previously, setting an earlier "Include from" date on one
  //       strategy was a no-op — the scenarioStart was always the LATEST
  //       across the set, so the earliest control was ignored.
  //   (b) Previously, toggling on a late-inception strategy silently
  //       shrank the scenario window to the overlap, discarding years
  //       of history from the earlier strategies.
  const strategyStart = new Map<string, string>();
  for (const s of activeStrategies) {
    const chosen = state.startDates[s.id] ?? s.start_date ?? "2022-01-01";
    strategyStart.set(s.id, chosen);
  }

  // Union of all dates that appear in ANY active strategy AFTER its own
  // include-from. Sorted chronologically.
  const allDateSet = new Set<string>();
  for (const s of activeStrategies) {
    const from = strategyStart.get(s.id)!;
    for (const d of s.daily_returns) {
      if (d.date >= from) allDateSet.add(d.date);
    }
  }
  const commonDates = Array.from(allDateSet).sort();
  const n = commonDates.length;
  if (n < 10) {
    return {
      n,
      twr: null,
      cagr: null,
      volatility: null,
      sharpe: null,
      sortino: null,
      max_drawdown: null,
      max_dd_days: null,
      correlation_matrix: null,
      avg_pairwise_correlation: null,
      equity_curve: [],
      effective_start: commonDates[0] ?? null,
      effective_end: commonDates[n - 1] ?? null,
    };
  }

  // Per-strategy daily return vector, zero-filled on days before that
  // strategy's include-from date. `dateMapCache` is keyed by strategy id
  // so repeated toggles against the same strategies reuse the same Map
  // instead of rebuilding it on every recompute (hot-path perf fix).
  const strategyReturns: Record<string, number[]> = {};
  for (const s of activeStrategies) {
    const map = dateMapCache.get(s.id)!;
    const from = strategyStart.get(s.id)!;
    strategyReturns[s.id] = commonDates.map((d) =>
      d >= from ? (map.get(d) ?? 0) : 0,
    );
  }

  // Portfolio daily returns = weighted sum. For days where a strategy
  // isn't active yet, its zero-fill means it simply doesn't contribute,
  // and the remaining active strategies are re-normalised to still sum
  // to 1 so we don't silently shrink the portfolio on early days.
  const portDaily: number[] = new Array(n);
  for (let i = 0; i < n; i++) {
    let r = 0;
    let activeWeightSum = 0;
    for (const s of activeStrategies) {
      const from = strategyStart.get(s.id)!;
      if (commonDates[i] < from) continue;
      const w = normWeight(s.id);
      r += w * strategyReturns[s.id][i];
      activeWeightSum += w;
    }
    // Renormalize to the active weight subset on days where some
    // strategies haven't started yet.
    portDaily[i] = activeWeightSum > 0 ? r / activeWeightSum : 0;
  }

  // Cumulative + equity curve (downsampled to every 5 points for payload)
  const cumulative: number[] = new Array(n);
  let c = 1;
  for (let i = 0; i < n; i++) {
    c *= 1 + portDaily[i];
    cumulative[i] = c;
  }
  const twr = cumulative[n - 1] - 1;
  const years = n / 252;
  const cagr = years > 0 ? Math.pow(1 + twr, 1 / years) - 1 : null;

  // Vol (sample std), Sharpe (rf=0), Sortino (rf=0)
  const meanR = portDaily.reduce((s, r) => s + r, 0) / n;
  const variance =
    portDaily.reduce((s, r) => s + (r - meanR) * (r - meanR), 0) / (n - 1);
  const volDaily = Math.sqrt(variance);
  const volatility = volDaily * Math.sqrt(252);
  const sharpe = volatility > 0 ? (meanR * 252) / volatility : null;

  // Sortino: downside RMS divides by TOTAL observations (n), not by the
  // count of negative days. Dividing by downsides.length artificially
  // inflates Sortino during calm periods.
  const downsideSumSq = portDaily.reduce(
    (s, r) => s + (r < 0 ? r * r : 0),
    0,
  );
  const downsideVar = downsideSumSq / n;
  const downsideVol = Math.sqrt(downsideVar) * Math.sqrt(252);
  const sortino = downsideVol > 0 ? (meanR * 252) / downsideVol : (sharpe ?? 0);

  // Max drawdown + duration
  let peak = cumulative[0];
  let maxDD = 0;
  let currentDuration = 0;
  let maxDuration = 0;
  for (let i = 0; i < n; i++) {
    if (cumulative[i] > peak) {
      peak = cumulative[i];
      currentDuration = 0;
    } else {
      currentDuration += 1;
    }
    const dd = cumulative[i] / peak - 1;
    if (dd < maxDD) maxDD = dd;
    if (currentDuration > maxDuration) maxDuration = currentDuration;
  }

  // Correlation matrix (Pearson on daily returns of each active strategy).
  // Uses sample covariance (n-1) to stay consistent with the sample-std
  // used for portfolio volatility above. Precompute each strategy's mean
  // and stdev once to avoid O(N² × T) recomputation of per-strategy stats.
  const strategyStats = new Map<
    string,
    { mean: number; std: number; demeaned: number[] }
  >();
  for (const s of activeStrategies) {
    const vec = strategyReturns[s.id];
    const mean = vec.reduce((sum, v) => sum + v, 0) / vec.length;
    const demeaned = vec.map((v) => v - mean);
    const sampleVar =
      vec.length > 1
        ? demeaned.reduce((sum, d) => sum + d * d, 0) / (vec.length - 1)
        : 0;
    strategyStats.set(s.id, {
      mean,
      std: Math.sqrt(sampleVar),
      demeaned,
    });
  }

  const correlation_matrix: Record<string, Record<string, number>> = {};
  let absCorrSum = 0;
  let corrCount = 0;
  for (let i = 0; i < activeStrategies.length; i++) {
    const idA = activeStrategies[i].id;
    correlation_matrix[idA] = {};
    const statA = strategyStats.get(idA)!;
    for (let j = 0; j < activeStrategies.length; j++) {
      const idB = activeStrategies[j].id;
      if (i === j) {
        correlation_matrix[idA][idB] = 1;
        continue;
      }
      const statB = strategyStats.get(idB)!;
      const T = statA.demeaned.length;
      let cov = 0;
      for (let k = 0; k < T; k++) {
        cov += statA.demeaned[k] * statB.demeaned[k];
      }
      // Sample covariance to match the sample-std denominator above.
      cov = T > 1 ? cov / (T - 1) : 0;
      const corr =
        statA.std > 0 && statB.std > 0 ? cov / (statA.std * statB.std) : 0;
      correlation_matrix[idA][idB] = Number(corr.toFixed(3));
      if (j > i) {
        // The KPI is labelled "Avg |corr|" — accumulate absolute values to
        // match. A signed average masks a book that's half strongly
        // positive and half strongly negative as "diversified".
        absCorrSum += Math.abs(corr);
        corrCount += 1;
      }
    }
  }
  const avg_pairwise_correlation =
    corrCount > 0 ? Number((absCorrSum / corrCount).toFixed(3)) : null;

  // Equity curve downsampled to weekly (every 5 business days)
  const equity_curve: Array<{ date: string; value: number }> = [];
  for (let i = 0; i < n; i += 5) {
    equity_curve.push({
      date: commonDates[i],
      value: Number((cumulative[i] - 1).toFixed(5)),
    });
  }
  if (equity_curve[equity_curve.length - 1]?.date !== commonDates[n - 1]) {
    equity_curve.push({
      date: commonDates[n - 1],
      value: Number((cumulative[n - 1] - 1).toFixed(5)),
    });
  }

  return {
    n,
    twr: Number(twr.toFixed(5)),
    cagr: cagr !== null ? Number(cagr.toFixed(5)) : null,
    volatility: Number(volatility.toFixed(5)),
    sharpe: sharpe !== null ? Number(sharpe.toFixed(3)) : null,
    sortino: Number(sortino.toFixed(3)),
    max_drawdown: Number(maxDD.toFixed(5)),
    max_dd_days: maxDuration,
    correlation_matrix,
    avg_pairwise_correlation,
    equity_curve,
    effective_start: commonDates[0],
    effective_end: commonDates[n - 1],
  };
}

// =========================================================================
// SVG Equity Curve
// =========================================================================

function EquityCurveChart({
  points,
}: {
  points: Array<{ date: string; value: number }>;
}) {
  if (points.length < 2) {
    return (
      <div className="flex h-64 items-center justify-center rounded-lg border border-border bg-bg-secondary text-sm text-text-muted">
        Select at least 2 strategies with overlapping history to see the
        equity curve.
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
    .map((p, i) => `${i === 0 ? "M" : "L"} ${xFor(i).toFixed(2)} ${yFor(p.value).toFixed(2)}`)
    .join(" ");

  // Area below curve
  const areaPath =
    path +
    ` L ${xFor(points.length - 1).toFixed(2)} ${yFor(0).toFixed(2)}` +
    ` L ${xFor(0).toFixed(2)} ${yFor(0).toFixed(2)} Z`;

  // Y-axis gridlines at 0, max, min
  const yTicks = [minV, 0, maxV].filter(
    (v, i, arr) => arr.indexOf(v) === i,
  );

  return (
    <div className="rounded-lg border border-border bg-bg-secondary p-3">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="w-full h-64"
        aria-label="Scenario equity curve"
        role="img"
      >
        <defs>
          <linearGradient id="scenario-grad" x1="0" y1="0" x2="0" y2="1">
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
        <path d={areaPath} fill="url(#scenario-grad)" stroke="none" />
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
// Main component
// =========================================================================

export function ScenarioBuilder({ strategies }: Props) {
  // Default state: all strategies selected, equal-weighted, start from each
  // strategy's inception date. weightInputs is a PARALLEL string-state for
  // the weight number inputs so typing "0." or ".5" doesn't get coerced to
  // 0 mid-keystroke and force a full recompute with a wrong value.
  const [state, setState] = useState<ScenarioState>(() => {
    const selected: Record<string, boolean> = {};
    const weights: Record<string, number> = {};
    const startDates: Record<string, string> = {};
    for (const s of strategies) {
      selected[s.id] = true;
      weights[s.id] = 1;
      startDates[s.id] = s.start_date ?? "2022-01-01";
    }
    return { selected, weights, startDates };
  });
  const [weightInputs, setWeightInputs] = useState<Record<string, string>>(
    () => {
      const out: Record<string, string> = {};
      for (const s of strategies) out[s.id] = "1";
      return out;
    },
  );

  // Build once per strategies change — avoids reallocating 15 Maps on
  // every toggle/weight/date change.
  const dateMapCache = useMemo(() => {
    const cache = new Map<string, Map<string, number>>();
    for (const s of strategies) {
      const m = new Map<string, number>();
      for (const d of s.daily_returns) m.set(d.date, d.value);
      cache.set(s.id, m);
    }
    return cache;
  }, [strategies]);

  const metrics = useMemo(
    () => computeScenario(strategies, state, dateMapCache),
    [strategies, state, dateMapCache],
  );

  const strategyNames = useMemo(() => {
    const out: Record<string, string> = {};
    for (const s of strategies) out[s.id] = s.name;
    return out;
  }, [strategies]);

  const selectedCount = Object.values(state.selected).filter(Boolean).length;

  function toggle(id: string) {
    setState((prev) => ({
      ...prev,
      selected: { ...prev.selected, [id]: !prev.selected[id] },
    }));
  }
  function setWeightInput(id: string, raw: string) {
    // Keep the raw string in a parallel state so the user can type "0."
    // and ".5" without the parseFloat coercion zeroing it mid-keystroke.
    // Only commit to `state.weights` when the string parses to a valid
    // non-negative number. Partial inputs (empty, "-", ".") are held in
    // weightInputs but leave the numeric weight at its last good value.
    setWeightInputs((prev) => ({ ...prev, [id]: raw }));
    const parsed = parseFloat(raw);
    if (!Number.isNaN(parsed) && parsed >= 0) {
      setState((prev) => ({
        ...prev,
        weights: { ...prev.weights, [id]: parsed },
      }));
    }
  }
  function setStartDate(id: string, d: string) {
    setState((prev) => ({
      ...prev,
      startDates: { ...prev.startDates, [id]: d },
    }));
  }
  function selectAll() {
    setState((prev) => {
      const sel: Record<string, boolean> = {};
      for (const s of strategies) sel[s.id] = true;
      return { ...prev, selected: sel };
    });
  }
  function selectNone() {
    setState((prev) => {
      const sel: Record<string, boolean> = {};
      for (const s of strategies) sel[s.id] = false;
      return { ...prev, selected: sel };
    });
  }
  function equalWeight() {
    setState((prev) => {
      const w: Record<string, number> = {};
      for (const s of strategies) w[s.id] = 1;
      return { ...prev, weights: w };
    });
    const ins: Record<string, string> = {};
    for (const s of strategies) ins[s.id] = "1";
    setWeightInputs(ins);
  }

  return (
    <div className="mt-6 space-y-6">
      {/* KPI strip */}
      <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
        <MetricCard
          label="TWR (cumulative)"
          value={formatPercent(metrics.twr)}
          positive={metrics.twr !== null && metrics.twr > 0}
        />
        <MetricCard label="CAGR" value={formatPercent(metrics.cagr)} />
        <MetricCard label="Sharpe" value={formatNumber(metrics.sharpe)} />
        <MetricCard label="Sortino" value={formatNumber(metrics.sortino)} />
        <MetricCard
          label="Max DD"
          value={formatPercent(metrics.max_drawdown)}
          negative={metrics.max_drawdown !== null && metrics.max_drawdown < 0}
        />
        <MetricCard
          label="Avg |corr|"
          value={formatNumber(metrics.avg_pairwise_correlation)}
        />
      </div>

      {/* Equity curve */}
      <Card>
        <div className="flex items-center justify-between mb-3">
          <div>
            <h2 className="text-sm font-semibold text-text-primary">
              Scenario equity curve
            </h2>
            <p className="text-xs text-text-muted mt-0.5">
              {selectedCount} strategies active
              {metrics.effective_start && metrics.effective_end ? (
                <>
                  {" "}
                  · {metrics.effective_start} → {metrics.effective_end} ·{" "}
                  {metrics.n} days
                </>
              ) : null}
            </p>
          </div>
          <div className="flex gap-2">
            <button
              onClick={selectAll}
              className="text-xs px-2 py-1 rounded border border-border text-text-secondary hover:text-text-primary hover:bg-bg-secondary"
            >
              All
            </button>
            <button
              onClick={selectNone}
              className="text-xs px-2 py-1 rounded border border-border text-text-secondary hover:text-text-primary hover:bg-bg-secondary"
            >
              None
            </button>
            <button
              onClick={equalWeight}
              className="text-xs px-2 py-1 rounded border border-border text-text-secondary hover:text-text-primary hover:bg-bg-secondary"
            >
              Equal weight
            </button>
          </div>
        </div>
        <EquityCurveChart points={metrics.equity_curve} />
      </Card>

      {/* Strategy shortlist */}
      <Card>
        <div className="mb-3">
          <h2 className="text-sm font-semibold text-text-primary">
            Strategy shortlist
          </h2>
          <p className="text-xs text-text-muted mt-0.5">
            Toggle strategies on or off. Every metric, chart and the
            correlation matrix recomputes live.
          </p>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {strategies.map((s) => {
            const active = state.selected[s.id];
            return (
              <div
                key={s.id}
                className={`rounded-lg border p-3 transition-colors ${
                  active
                    ? "border-accent bg-bg-secondary"
                    : "border-border bg-surface opacity-60"
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={active}
                        onChange={() => toggle(s.id)}
                        className="h-4 w-4 shrink-0"
                      />
                      <span className="text-sm font-medium text-text-primary truncate">
                        {s.name}
                      </span>
                    </label>
                    <p className="text-[10px] text-text-muted mt-1 line-clamp-1">
                      {s.strategy_types.join(" · ")} ·{" "}
                      {s.markets.slice(0, 3).join(", ")}
                    </p>
                    <div className="mt-1.5 flex gap-3 text-[10px] text-text-muted">
                      <span>
                        CAGR:{" "}
                        <span className="text-text-secondary font-metric">
                          {formatPercent(s.cagr)}
                        </span>
                      </span>
                      <span>
                        Sharpe:{" "}
                        <span className="text-text-secondary font-metric">
                          {formatNumber(s.sharpe)}
                        </span>
                      </span>
                      <span>
                        MDD:{" "}
                        <span className="text-text-secondary font-metric">
                          {formatPercent(s.max_drawdown)}
                        </span>
                      </span>
                    </div>
                  </div>
                </div>
                {active ? (
                  <div className="mt-2 grid grid-cols-2 gap-2">
                    <label className="text-[10px] text-text-muted">
                      Weight
                      <input
                        type="number"
                        min={0}
                        step={0.1}
                        value={weightInputs[s.id] ?? ""}
                        onChange={(e) => setWeightInput(s.id, e.target.value)}
                        className="mt-0.5 w-full rounded border border-border px-1.5 py-0.5 text-xs font-metric"
                      />
                    </label>
                    <label className="text-[10px] text-text-muted">
                      Include from
                      <input
                        type="date"
                        value={state.startDates[s.id] ?? ""}
                        min={s.start_date ?? undefined}
                        onChange={(e) => setStartDate(s.id, e.target.value)}
                        className="mt-0.5 w-full rounded border border-border px-1.5 py-0.5 text-xs font-metric"
                      />
                    </label>
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      </Card>

      {/* Correlation matrix */}
      <Card>
        <div className="mb-3">
          <h2 className="text-sm font-semibold text-text-primary">
            Pairwise correlation
          </h2>
          <p className="text-xs text-text-muted mt-0.5">
            Live-computed from the selected strategies&apos; daily returns.
            Teal = diversifying, orange = concentrated.
          </p>
        </div>
        <CorrelationHeatmap
          correlationMatrix={metrics.correlation_matrix}
          strategyNames={strategyNames}
        />
      </Card>
    </div>
  );
}

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
