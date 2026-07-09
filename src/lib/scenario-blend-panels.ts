/**
 * Blend-graph adapter — the single source of truth for every derived series
 * the Phase-30 factsheet graphs render on the BLENDED portfolio.
 *
 * Pure TS, zero dependencies, no fetch / DOM / time. Consumes the frozen
 * engine's UNROUNDED `portfolio_daily_returns` (`{ date, value }[]`, where
 * `value` is the daily RETURN, not a cumulative wealth value) and derives:
 *   - histogramSeries : cumprod(1+r) wealth series for ReturnHistogram (which
 *                       re-derives daily returns internally — see Pitfall 1).
 *   - quantiles       : Record<label, [q0,q25,q50,q75,q100]> for ReturnQuantiles.
 *   - rollingSharpe    : { sharpe_365d: series } so RollingMetrics resolves the
 *                       CHART_ACCENT stroke via its STROKE_BY_KEY map.
 *   - rollingVol       : sample-std, sqrt-N-annualized (periodsPerYear, default 252; mirrors portfolio-stats.ts).
 *   - rollingSortino   : downside RMS over TOTAL window n, sqrt-N-annualized (periodsPerYear, default 252; mirrors the engine).
 *   - usableN          : count of usable daily returns (drives the empty branch).
 *
 * Convention pins (LOCKED — see scenario-blend-panels.test.ts):
 *   - Rolling vol/Sharpe are numerically IDENTICAL to
 *     portfolio-stats.ts::computeRollingMetric (SAMPLE std n-1, NOT the
 *     population std of factsheet/rolling.ts). We REUSE the same `mean`/`stdDev`
 *     from portfolio-math-utils so parity is exact, not re-derived.
 *   - Rolling Sortino divides the downside sum-of-squares by the TOTAL window
 *     length (n), NOT by the count of down days — mirroring the frozen engine
 *     (scenario.ts:354-361). Numerator = mean annualized over the full year.
 *   - Degenerate input (length < window, fewer than MIN_USABLE points, or any
 *     non-finite value present) collapses EVERY series to [] / {}.
 *   - Annualizes on `periodsPerYear` (default 252; #597 threads 365 for crypto).
 */
import type { DailyPoint } from "@/lib/portfolio-math-utils";
import { mean, stdDev } from "@/lib/portfolio-math-utils";

/**
 * Default annualization basis — 252 trading days/year (traditional). #597 makes
 * this a per-call `periodsPerYear` argument (365 for crypto) threaded through
 * buildBlendPanels; the module constant remains the default so the blend path
 * (a mixed book) stays byte-identical unless a caller passes 365.
 */
const TRADING_DAYS_PER_YEAR = 252;

/** Below this many usable points every series collapses to []/{}. */
const MIN_USABLE = 10;

export interface BlendPanelSeries {
  /** CUMULATIVE-wealth series for ReturnHistogram (it derives daily internally). [] if degenerate. */
  histogramSeries: { date: string; value: number }[];
  /** Record<periodLabel, [q0,q25,q50,q75,q100]> for ReturnQuantiles. {} if degenerate. */
  quantiles: Record<string, number[]>;
  /** { sharpe_365d: series } so RollingMetrics resolves CHART_ACCENT. {} if degenerate. */
  rollingSharpe: Record<string, { date: string; value: number }[]>;
  /** sample-std × √N (periodsPerYear, default 252). [] if degenerate. */
  rollingVol: { date: string; value: number }[];
  /** downside RMS ÷ TOTAL window n × √N (periodsPerYear, default 252). [] if degenerate. */
  rollingSortino: { date: string; value: number }[];
  /** Count of usable daily returns — drives the empty branch + disclosure copy. */
  usableN: number;
}

const EMPTY: Omit<BlendPanelSeries, "usableN"> = {
  histogramSeries: [],
  quantiles: {},
  rollingSharpe: {},
  rollingVol: [],
  rollingSortino: [],
};

/**
 * Rolling volatility — mirrors computeRollingMetric(daily, window, "volatility")
 * EXACTLY (sample std n-1, × √N (periodsPerYear, default 252), dated at the window's last day, [] below window).
 */
function rollingVolatility(
  daily: DailyPoint[],
  window: number,
  periodsPerYear: number,
): DailyPoint[] {
  if (daily.length < window) return [];
  const annualize = Math.sqrt(periodsPerYear);
  const result: DailyPoint[] = [];
  for (let i = window - 1; i < daily.length; i++) {
    const slice = daily.slice(i - window + 1, i + 1).map((d) => d.value);
    const s = stdDev(slice, true);
    result.push({ date: daily[i].date, value: s * annualize });
  }
  return result;
}

/**
 * Rolling Sharpe — mirrors computeRollingMetric(daily, window, "sharpe") EXACTLY
 * (mean × √N ÷ sample std (periodsPerYear, default 252); 0 when std is 0).
 */
function rollingSharpeSeries(
  daily: DailyPoint[],
  window: number,
  periodsPerYear: number,
): DailyPoint[] {
  if (daily.length < window) return [];
  const annualize = Math.sqrt(periodsPerYear);
  const result: DailyPoint[] = [];
  for (let i = window - 1; i < daily.length; i++) {
    const slice = daily.slice(i - window + 1, i + 1).map((d) => d.value);
    const m = mean(slice);
    const s = stdDev(slice, true);
    result.push({ date: daily[i].date, value: s > 0 ? (m * annualize) / s : 0 });
  }
  return result;
}

/**
 * Rolling Sortino — mirrors the frozen engine (scenario.ts:354-361): the
 * downside sum-of-squares divides by the TOTAL window length (n), NOT the
 * count of down days; × √N; numerator = mean × N (periodsPerYear, default 252); 0 when no downside.
 */
function rollingSortinoSeries(
  daily: DailyPoint[],
  window: number,
  periodsPerYear: number,
): DailyPoint[] {
  if (daily.length < window) return [];
  const annualize = Math.sqrt(periodsPerYear);
  const result: DailyPoint[] = [];
  for (let i = window - 1; i < daily.length; i++) {
    const slice = daily.slice(i - window + 1, i + 1).map((d) => d.value);
    const m = mean(slice);
    let downSq = 0;
    for (const x of slice) if (x < 0) downSq += x * x;
    const dd = Math.sqrt(downSq / window) * annualize; // ÷ window (total n)
    result.push({
      date: daily[i].date,
      value: dd > 0 ? (m * periodsPerYear) / dd : 0,
    });
  }
  return result;
}

/** Linear-interpolation percentile over an already-ascending-sorted array. */
function percentile(sorted: number[], p: number): number {
  if (sorted.length === 1) return sorted[0];
  const idx = p * (sorted.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  const frac = idx - lo;
  return sorted[lo] + (sorted[hi] - sorted[lo]) * frac;
}

/**
 * Derive every blend-graph series from the frozen engine's unrounded
 * `portfolio_daily_returns`. See the file header for the LOCKED convention pins.
 */
export function buildBlendPanels(
  portfolioDaily: { date: string; value: number }[],
  window: number, // 63 | 126 | 252 (default 63 per RESEARCH; 3M/6M/12M toggle)
  periodsPerYear = TRADING_DAYS_PER_YEAR, // #597 — 252 traditional (default) / 365 crypto
): BlendPanelSeries {
  // ── Degenerate guard FIRST (LOCKED pin) ───────────────────────────
  // Count finite points; any non-finite value present collapses every series.
  let usableN = 0;
  let hasNonFinite = false;
  for (const p of portfolioDaily) {
    if (Number.isFinite(p.value)) usableN++;
    else hasNonFinite = true;
  }
  if (
    hasNonFinite ||
    portfolioDaily.length < MIN_USABLE ||
    portfolioDaily.length < window
  ) {
    // A non-finite value poisons the ENTIRE series (LOCKED pin), so there are
    // effectively 0 USABLE points — report 0, NOT the finite count. usableN is
    // the gate the composer's SegmentedControl + panel body key on
    // (`usableN < window`); a finite count ≥ a smaller window would otherwise
    // enable that window and render empty charts instead of the "Awaiting more
    // data" banner. A merely-too-short (but all-finite) series keeps its real
    // count: re-running at a smaller window legitimately recovers it, so its
    // gate must reflect the history actually available.
    return { ...EMPTY, usableN: hasNonFinite ? 0 : usableN };
  }

  // ── Histogram cumulative-wealth (Pitfall 1) ───────────────────────
  // cumprod off the UNROUNDED daily returns → wealth series ~1.0. NEVER raw
  // daily, NEVER the rounded/downsampled equity_curve. ReturnHistogram
  // re-derives daily internally as v/cumulative[i]-1.
  let c = 1;
  const histogramSeries = portfolioDaily.map((p) => {
    c *= 1 + p.value;
    return { date: p.date, value: c };
  });

  // ── Quantiles (5-number positional, single honest "All" period) ───
  const sorted = portfolioDaily.map((p) => p.value).sort((a, b) => a - b);
  const quantiles: Record<string, number[]> = {
    All: [
      sorted[0],
      percentile(sorted, 0.25),
      percentile(sorted, 0.5),
      percentile(sorted, 0.75),
      sorted[sorted.length - 1],
    ],
  };

  // ── Rolling series (sample-std × √N, periodsPerYear default 252; engine-mirror Sortino) ──────
  return {
    histogramSeries,
    quantiles,
    rollingSharpe: {
      sharpe_365d: rollingSharpeSeries(portfolioDaily, window, periodsPerYear),
    },
    rollingVol: rollingVolatility(portfolioDaily, window, periodsPerYear),
    rollingSortino: rollingSortinoSeries(portfolioDaily, window, periodsPerYear),
    usableN,
  };
}
