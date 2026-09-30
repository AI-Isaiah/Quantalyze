"use client";

import { useMemo } from "react";
import { z } from "zod";
import { normalizeDailyReturns, compound } from "@/lib/portfolio-math-utils";
import { dispersion } from "@/lib/return-stats";
import { annualizationPeriods } from "@/lib/closed-sets";
import { alignCoveredReturns, COMPARATOR_CALENDARS } from "@/lib/factsheet/align";
import { jointMetrics } from "@/lib/factsheet/joint";
import { ALLOCATOR_PORTFOLIO_ASSET_CLASS } from "@/lib/factsheet/allocator-portfolio-payload";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  ResponsiveContainer,
  Legend,
} from "recharts";
import { TouchTooltip } from "@/components/charts/TouchTooltip";
import { withWidgetBoundary, type BaseWidgetProps } from "../lib/widget-boundary";
import { riskWidgetDataSchema } from "../lib/widget-data";

/**
 * Phase 169.4 plan 02 (SC2, D-69). The widget-local contract: the shared risk
 * contract plus the three dashboard fields this widget reads. Kept here, not in
 * `widget-data.ts`, so no other widget's contract moves. `dailyPointSchema` is
 * not exported there, so the `{ date, value }` shape is declared locally.
 * `btcBenchmarkPrices` is the dashboard's `BenchmarkPricesOpt` (closes, or the
 * unavailable marker); an array of daily points (the equity chart's BTC form)
 * matches neither branch and the boundary rejects it.
 */
const bookDailyReturnSchema = z.object({ date: z.string(), value: z.number() });
const btcBenchmarkPricesSchema = z.union([
  z.object({
    prices: z.array(z.object({ date: z.string(), close: z.number() })),
    through: z.string().nullable(),
    dropped: z.array(z.string()),
  }),
  z.object({ unavailable: z.literal(true) }),
]);
export const alphaBetaWidgetDataSchema = riskWidgetDataSchema
  .extend({
    equityHistoryState: z.string().optional(),
    equityDailyReturns: z.array(bookDailyReturnSchema).optional(),
    btcBenchmarkPrices: btcBenchmarkPricesSchema.nullable().optional(),
  })
  .loose(); // eslint-disable-line quantalyze/no-passthrough-on-ipc -- B9 sanctioned-exception: read-only widget render contract (withWidgetBoundary display), never spread into a write

export type AlphaBetaWidgetData = z.infer<typeof alphaBetaWidgetDataSchema>;

/** The book's annualization basis: the Overview factsheet's, by construction. */
const BOOK_PERIODS_PER_YEAR = annualizationPeriods(ALLOCATOR_PORTFOLIO_ASSET_CLASS);

export type BookAlphaBeta =
  | { kind: "not_ready" }
  | { kind: "btc_unavailable" }
  | { kind: "undefined_beta"; benchmarkFlat: boolean }
  | {
      kind: "ok";
      alpha: number;
      beta: number;
      pairedCount: number;
      totalReturn: number;
      betaContribution: number;
      residual: number;
    };

/**
 * Alpha and beta of the allocator's BOOK against BTC — the same computation
 * the /allocations Overview's BTC comparator block runs (169.4 D-69), so the
 * two figures on one page are one number:
 *   - the book's own flow-neutral daily returns (`equityDailyReturns`),
 *     normalized exactly as `buildFactsheetPayload` normalizes them;
 *   - the dashboard's database BTC closes (`btcBenchmarkPrices`, read by the
 *     factsheet's own `readFactsheetBenchmark`);
 *   - paired by `alignCoveredReturns` on BTC's calendar: an interval is paired
 *     only with a close at both endpoints (166.4 D-A), never bridged over a gap;
 *   - `jointMetrics` over the paired indices, on the book's basis.
 * No figure while the history is not ready, and none when BTC is unavailable.
 */
export function computeBookAlphaBeta(data: AlphaBetaWidgetData): BookAlphaBeta {
  // D-02 fail-closed: anything other than an explicit "ready" is not ready.
  if (data.equityHistoryState !== "ready") return { kind: "not_ready" };
  const book = normalizeDailyReturns(data.equityDailyReturns ?? []);
  // The Overview builds no factsheet under 2 returns; neither does this.
  if (book.length < 2) return { kind: "not_ready" };

  const btc = data.btcBenchmarkPrices;
  if (btc == null || "unavailable" in btc) return { kind: "btc_unavailable" };

  const dates = book.map((d) => d.date);
  const aligned = alignCoveredReturns(btc.prices, btc.dropped, dates, COMPARATOR_CALENDARS.btc);
  const strat: number[] = [];
  const bench: number[] = [];
  for (let i = 0; i < aligned.paired.length; i++) {
    const b = aligned.returns[i];
    if (aligned.paired[i] && b != null) {
      strat.push(book[i].value);
      bench.push(b);
    }
  }
  if (strat.length === 0) return { kind: "undefined_beta", benchmarkFlat: false };

  const { alpha, beta } = jointMetrics(strat, bench, 0, BOOK_PERIODS_PER_YEAR);
  // Founder decision D7 (2026-09-26): a beta that does not exist (BTC has no
  // dispersion over the paired intervals, or a return is non-finite) is an
  // absence, NaN from `jointMetrics`. Alpha is built on beta, so both read "—"
  // rather than a beta of 0 that would label the whole return "alpha". The
  // muted line names the benchmark only when that IS the cause.
  if (!Number.isFinite(alpha) || !Number.isFinite(beta)) {
    const benchmarkFlat = bench.every((v) => Number.isFinite(v)) && dispersion(bench, 0).sd === 0;
    return { kind: "undefined_beta", benchmarkFlat };
  }
  const totalReturn = compound(strat);
  const betaContribution = beta * compound(bench);
  return {
    kind: "ok",
    alpha,
    beta,
    pairedCount: strat.length,
    totalReturn,
    betaContribution,
    residual: totalReturn - alpha - betaContribution,
  };
}

/**
 * Alpha/Beta Decomposition — decomposes the book's return into Alpha (skill),
 * Beta contribution (market) and Residual, against BTC: the benchmark the
 * Overview uses, over the same paired intervals (see `computeBookAlphaBeta`).
 */
function AlphaBetaDecompositionInner({ data }: { data: AlphaBetaWidgetData } & BaseWidgetProps) {
  const result = useMemo(() => {
    const r = computeBookAlphaBeta(data);
    if (r.kind !== "ok") return r;
    return {
      ...r,
      chartData: [
        {
          name: "Return Decomposition",
          Beta: r.betaContribution,
          Alpha: r.alpha,
          Residual: r.residual,
        },
      ],
    };
  }, [data]);

  if (result.kind === "not_ready") {
    return (
      <div className="flex h-full items-center justify-center text-sm text-text-muted">
        Insufficient data for alpha/beta decomposition.
      </div>
    );
  }

  if (result.kind === "btc_unavailable") {
    return (
      <div className="flex h-full items-center justify-center px-3 text-sm text-text-muted">
        BTC prices are unavailable, so alpha and beta cannot be measured.
      </div>
    );
  }

  if (result.kind === "undefined_beta") {
    // D7: "—" with no sign colour (DESIGN.md: a "—" never carries a semantic
    // colour) and no chart, plus one muted line naming why.
    return (
      <div className="flex h-full flex-col">
        <div className="mb-3 flex items-baseline gap-2 px-3 pt-2">
          <span className="text-xs font-semibold uppercase tracking-wider text-text-muted">
            Alpha
          </span>
          <span
            className="text-2xl font-metric tabular-nums font-bold text-text-primary"
            data-testid="alpha-value"
          >
            —
          </span>
          <span className="text-xs text-text-muted">annualized</span>
        </div>
        <p className="px-3 text-xs text-text-muted">
          {result.benchmarkFlat
            ? "Alpha and beta cannot be measured: the benchmark has no dispersion over this window."
            : "Alpha and beta cannot be measured over this window."}
        </p>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      {/* Alpha callout */}
      <div className="mb-3 flex items-baseline gap-2 px-3 pt-2">
        <span className="text-xs font-semibold uppercase tracking-wider text-text-muted">
          Alpha
        </span>
        <span
          className={`text-2xl font-metric tabular-nums font-bold ${
            result.alpha >= 0 ? "text-positive" : "text-negative"
          }`}
        >
          {result.alpha >= 0 ? "+" : ""}
          {(result.alpha * 100).toFixed(1)}%
        </span>
        <span className="text-xs text-text-muted">annualized</span>
      </div>

      {/* Stacked bar chart */}
      <div className="flex-1 min-h-0">
        <ResponsiveContainer width="100%" height="100%" initialDimension={{ width: 100, height: 100 }}>
          <BarChart
            accessibilityLayer={false}
            data={result.chartData}
            margin={{ top: 4, right: 8, bottom: 4, left: 8 }}
            layout="vertical"
          >
            <XAxis
              type="number"
              tick={{
                fontSize: 11,
                fill: "#64748B",
                fontFamily: "var(--font-geist-mono), monospace",
              }}
              tickLine={false}
              axisLine={{ stroke: "#E2E8F0" }}
              tickFormatter={(v: number) => `${(v * 100).toFixed(0)}%`}
            />
            <YAxis
              type="category"
              dataKey="name"
              tick={{ fontSize: 11, fill: "#64748B" }}
              tickLine={false}
              axisLine={false}
              width={0}
            />
            <TouchTooltip
              formatter={(v) => [`${(Number(v) * 100).toFixed(2)}%`]}
              contentStyle={{ fontSize: 12, borderColor: "#E2E8F0" }}
            />
            <Legend
              wrapperStyle={{ fontSize: 11 }}
              iconType="square"
              iconSize={10}
            />
            <Bar dataKey="Beta" stackId="decomp" fill="#94A3B8" radius={[0, 0, 0, 0]} />
            <Bar dataKey="Alpha" stackId="decomp" fill="#15803D" radius={[0, 0, 0, 0]} />
            <Bar dataKey="Residual" stackId="decomp" fill="#E2E8F0" radius={[2, 2, 2, 2]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

// B21: validate `data` against the widget-local contract (the shared risk
// contract plus the book and BTC fields) + contain throws.
// Default export — the registry imports this module's default directly.
export default withWidgetBoundary(
  alphaBetaWidgetDataSchema,
  AlphaBetaDecompositionInner,
  { area: "alpha-beta-decomposition" },
);
