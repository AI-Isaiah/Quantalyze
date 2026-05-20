import type { EventSignature, EventSignaturesPayload, EventSignaturesSet } from "./types";

/**
 * Event-study (a.k.a. "returns signature") aggregator.
 *
 * For each "win" / "loss" event in the strategy's return series, capture the
 * trajectory ±WINDOW days around it across two target views:
 *
 *   - Of Benchmark: the comparator's *cumulative-from-event* return path.
 *     Rebased to 0% at t=0 so all events overlay on a common baseline.
 *   - Of Accumulated Capital: the strategy's *cumulative-from-event* equity
 *     path. Also rebased to 0% at t=0.
 *
 * Aggregations across the event population: mean, median, P25/P75, P5/P95.
 *
 * Event definitions:
 *   - 1-day horizon: any day with positive return = win, negative = loss.
 *   - 7-day horizon: trailing-7-day compounded return > 0 = win, < 0 = loss.
 *
 * Events with insufficient window coverage at the series edges are skipped
 * (no padding — partial trajectories would skew the percentile bands).
 */

const WINDOW = 14;
const TRACE_LEN = WINDOW * 2 + 1; // [-14..0..+14] = 29 points

/** Aggregate signature for one event population × one target view. */
function aggregate(traces: number[][]): EventSignature {
  if (traces.length === 0) {
    const empty = new Array<number>(TRACE_LEN).fill(0);
    return { mean: empty, median: empty.slice(), p25: empty.slice(), p75: empty.slice(), p05: empty.slice(), p95: empty.slice() };
  }
  const mean = new Array<number>(TRACE_LEN).fill(0);
  const median = new Array<number>(TRACE_LEN).fill(0);
  const p25 = new Array<number>(TRACE_LEN).fill(0);
  const p75 = new Array<number>(TRACE_LEN).fill(0);
  const p05 = new Array<number>(TRACE_LEN).fill(0);
  const p95 = new Array<number>(TRACE_LEN).fill(0);
  for (let t = 0; t < TRACE_LEN; t++) {
    const col = new Array<number>(traces.length);
    for (let i = 0; i < traces.length; i++) col[i] = traces[i][t];
    col.sort((a, b) => a - b);
    let sum = 0;
    for (const v of col) sum += v;
    mean[t] = sum / col.length;
    median[t] = quantile(col, 0.5);
    p25[t] = quantile(col, 0.25);
    p75[t] = quantile(col, 0.75);
    p05[t] = quantile(col, 0.05);
    p95[t] = quantile(col, 0.95);
  }
  return { mean, median, p25, p75, p05, p95 };
}

function quantile(sorted: number[], p: number): number {
  const n = sorted.length;
  if (n === 0) return 0;
  if (n === 1) return sorted[0];
  const idx = p * (n - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  const frac = idx - lo;
  return sorted[lo] * (1 - frac) + sorted[hi] * frac;
}

/**
 * Build trace[t] = cumulative-from-event return on the target series at offset
 * `t - WINDOW`. Anchored to 0 at t=WINDOW (the event day).
 *
 * For the benchmark view we accumulate aligned daily returns. For the equity
 * view we read the equity-curve ratio relative to the event day.
 */
function buildReturnTrace(targetRet: number[], eventIdx: number): number[] | null {
  const start = eventIdx - WINDOW;
  const end = eventIdx + WINDOW;
  if (start < 0 || end >= targetRet.length) return null;
  const trace = new Array<number>(TRACE_LEN);
  // Backward leg: walk from event toward -14, undoing returns. Sign convention:
  // value at -k = -(compounded backward return), so the curve is rooted at 0.
  // A return of -100% (delisting / total loss) divides by 0 and explodes; reject
  // the entire trace to avoid NaN poisoning the percentile aggregation.
  let cum = 0;
  trace[WINDOW] = 0;
  for (let k = 1; k <= WINDOW; k++) {
    const r = targetRet[eventIdx - k + 1];
    if (!Number.isFinite(r) || r <= -0.9999) return null;
    cum = (1 + cum) / (1 + r) - 1;
    trace[WINDOW - k] = cum;
  }
  // Forward leg: walk from event toward +14, compounding returns.
  cum = 0;
  for (let k = 1; k <= WINDOW; k++) {
    const r = targetRet[eventIdx + k];
    if (!Number.isFinite(r) || r <= -0.9999) return null;
    cum = (1 + cum) * (1 + r) - 1;
    trace[WINDOW + k] = cum;
  }
  return trace;
}

function buildEquityTrace(equity: number[], eventIdx: number): number[] | null {
  const start = eventIdx - WINDOW;
  const end = eventIdx + WINDOW;
  if (start < 0 || end >= equity.length) return null;
  const base = equity[eventIdx];
  if (!Number.isFinite(base) || base <= 0) return null;
  const trace = new Array<number>(TRACE_LEN);
  for (let t = 0; t < TRACE_LEN; t++) {
    const i = eventIdx - WINDOW + t;
    trace[t] = equity[i] / base - 1;
  }
  return trace;
}

/**
 * One horizon's full bundle: win/loss events × {of benchmark, of equity}.
 * `eventTest` returns true if index i is a win event, false if loss, null if
 * neither (skip).
 */
function computeHorizon(
  stratRet: number[],
  benchRet: number[],
  equity: number[],
  eventTest: (i: number) => boolean | null,
  horizonDays: number,
): EventSignaturesSet {
  const winBench: number[][] = [];
  const lossBench: number[][] = [];
  const winEquity: number[][] = [];
  const lossEquity: number[][] = [];
  let eligibleWinCount = 0;
  let eligibleLossCount = 0;

  for (let i = 0; i < stratRet.length; i++) {
    const verdict = eventTest(i);
    if (verdict == null) continue;
    if (verdict) eligibleWinCount++; else eligibleLossCount++;
    const bTrace = buildReturnTrace(benchRet, i);
    const eTrace = buildEquityTrace(equity, i);
    if (bTrace) (verdict ? winBench : lossBench).push(bTrace);
    if (eTrace) (verdict ? winEquity : lossEquity).push(eTrace);
  }

  return {
    horizonDays,
    winCount: winBench.length,
    lossCount: lossBench.length,
    eligibleWinCount,
    eligibleLossCount,
    winOfBenchmark: aggregate(winBench),
    lossOfBenchmark: aggregate(lossBench),
    winOfEquity: aggregate(winEquity),
    lossOfEquity: aggregate(lossEquity),
  };
}

export function computeEventSignatures(
  stratRet: number[],
  benchRet: number[],
  equity: number[],
): EventSignaturesPayload {
  // 1-day horizon: positive day = win, negative = loss, zero = skip.
  const h1 = computeHorizon(
    stratRet,
    benchRet,
    equity,
    i => {
      const r = stratRet[i];
      if (!Number.isFinite(r) || r === 0) return null;
      return r > 0;
    },
    1,
  );
  // 7-day horizon: rolling 7-day compounded return > 0 = win, < 0 = loss.
  // Skip the first 6 indices since no trailing-7-day window exists.
  const h7 = computeHorizon(
    stratRet,
    benchRet,
    equity,
    i => {
      if (i < 6) return null;
      let cum = 1;
      for (let k = 0; k < 7; k++) cum *= 1 + stratRet[i - k];
      const ret = cum - 1;
      if (ret === 0) return null;
      return ret > 0;
    },
    7,
  );
  return { h1, h7, windowDays: WINDOW };
}
