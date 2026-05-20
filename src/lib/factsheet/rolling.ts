/**
 * Rolling-window statistics ported from `rolling()` in
 * `/tmp/gen_factsheet_v3.py`. Default window is 6 months (126 trading
 * days) — matches the mockup's `W6` constant.
 *
 * Each function returns an array of the same length as input, with `null`
 * for indices before the window fills (i < window-1). Consumers paint a
 * warmup overlay over the leading null region so the user knows those
 * samples are statistically noisy.
 */

export const ROLL_WINDOW_6MO = 126;
export const ROLL_WINDOW_90D = 90;

/**
 * Rolling regression beta of `strat` on `bench` over a sliding window.
 * Ports `_rolling_beta()` from the mockup generator. Default window 90d
 * matches the mockup's choice for the Rolling β chart.
 */
export function rollingBeta(
  strat: number[],
  bench: number[],
  window = ROLL_WINDOW_90D,
): Array<number | null> {
  const n = Math.min(strat.length, bench.length);
  const out: Array<number | null> = new Array(n).fill(null);
  for (let i = window - 1; i < n; i++) {
    let sumS = 0;
    let sumB = 0;
    for (let k = i - window + 1; k <= i; k++) {
      sumS += strat[k];
      sumB += bench[k];
    }
    const ms = sumS / window;
    const mb = sumB / window;
    let cov = 0;
    let varB = 0;
    for (let k = i - window + 1; k <= i; k++) {
      const ds = strat[k] - ms;
      const db = bench[k] - mb;
      cov += ds * db;
      varB += db * db;
    }
    cov /= window;
    varB /= window;
    out[i] = varB !== 0 ? cov / varB : 0;
  }
  return out;
}

export function rollingVol(rets: number[], window = ROLL_WINDOW_6MO): Array<number | null> {
  const out: Array<number | null> = new Array(rets.length).fill(null);
  const sqrt252 = Math.sqrt(252);
  for (let i = window - 1; i < rets.length; i++) {
    const w = rets.slice(i - window + 1, i + 1);
    out[i] = pstdev(w) * sqrt252;
  }
  return out;
}

export function rollingSharpe(rets: number[], window = ROLL_WINDOW_6MO): Array<number | null> {
  const out: Array<number | null> = new Array(rets.length).fill(null);
  for (let i = window - 1; i < rets.length; i++) {
    const w = rets.slice(i - window + 1, i + 1);
    const m = mean(w);
    const s = pstdev(w);
    out[i] = s > 0 ? (m * 252) / (s * Math.sqrt(252)) : 0;
  }
  return out;
}

export function rollingSortino(rets: number[], window = ROLL_WINDOW_6MO): Array<number | null> {
  const out: Array<number | null> = new Array(rets.length).fill(null);
  const sqrt252 = Math.sqrt(252);
  for (let i = window - 1; i < rets.length; i++) {
    const w = rets.slice(i - window + 1, i + 1);
    const m = mean(w);
    let downSq = 0;
    let hasNeg = false;
    for (const x of w) {
      if (x < 0) {
        downSq += x * x;
        hasNeg = true;
      }
    }
    const dd = hasNeg ? Math.sqrt(downSq / window) * sqrt252 : 0;
    out[i] = dd > 0 ? (m * 252) / dd : 0;
  }
  return out;
}

function mean(xs: number[]): number {
  let s = 0;
  for (const x of xs) s += x;
  return s / xs.length;
}

function pstdev(xs: number[]): number {
  const m = mean(xs);
  let s = 0;
  for (const x of xs) s += (x - m) * (x - m);
  return Math.sqrt(s / xs.length);
}
