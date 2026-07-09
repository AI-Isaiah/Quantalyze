import { cumEq, drawdowns } from "./compute";

/** Pre-aggregated histogram of the resample distribution — small payload
 *  (40 numbers per metric) instead of shipping 2000 raw resamples.
 *  `degenerate` flags a zero-variance distribution so the UI can render
 *  an explicit "no variance" placeholder instead of a fake-padded shape. */
export type BootstrapHistogram = {
  lo: number;
  hi: number;
  bins: number[];
  degenerate?: boolean;
};

export type BootstrapCISummary = {
  sharpe: { point: number; lo: number; hi: number; hist: BootstrapHistogram };
  sortino: { point: number; lo: number; hi: number; hist: BootstrapHistogram };
  max_dd: { point: number; lo: number; hi: number; hist: BootstrapHistogram };
  n_resamples: number;
  block_len: number;
};

/**
 * Bootstrap 95% CIs on Sharpe / Sortino / Max-DD using a stationary block
 * bootstrap. Ports `_block_bootstrap_stats()` from the mockup. Block length
 * is fixed at 5 days (simpler than the Politis-Romano geometric draw but
 * preserves short-horizon autocorrelation which is the analytical point).
 *
 * Deterministic Mulberry32 PRNG with a fixed seed so the same series
 * produces the same CI on every render.
 */
export function bootstrapCI(rets: number[], n_resamples = 2000, block_len = 5, seed = 42, periodsPerYear = 252): BootstrapCISummary {
  const n = rets.length;
  const sharpes: number[] = new Array(n_resamples);
  const sortinos: number[] = new Array(n_resamples);
  const maxDds: number[] = new Array(n_resamples);
  const rand = mulberry32(seed);

  for (let k = 0; k < n_resamples; k++) {
    const resampled: number[] = new Array(n);
    let filled = 0;
    while (filled < n) {
      const startIdx = Math.floor(rand() * n);
      const take = Math.min(block_len, n - filled);
      for (let j = 0; j < take; j++) {
        resampled[filled + j] = rets[(startIdx + j) % n];
      }
      filled += take;
    }
    const stats = headlineStats(resampled, periodsPerYear);
    sharpes[k] = stats.sharpe;
    sortinos[k] = stats.sortino;
    maxDds[k] = stats.max_dd;
  }

  const point = headlineStats(rets, periodsPerYear);
  return {
    sharpe: { point: point.sharpe, ...ci95(sharpes), hist: histogram(sharpes, 40) },
    sortino: { point: point.sortino, ...ci95(sortinos), hist: histogram(sortinos, 40) },
    max_dd: { point: point.max_dd, ...ci95(maxDds), hist: histogram(maxDds, 40) },
    n_resamples,
    block_len,
  };
}

/** 40-bin density histogram with a small pad so the point estimate always
 *  fits visually inside the visible range. Returns `degenerate: true` when
 *  every resample produced the same value — the UI then renders a
 *  placeholder instead of a manufactured ±0.5 distribution width. */
function histogram(xs: number[], bins: number): BootstrapHistogram {
  if (xs.length === 0) return { lo: 0, hi: 0, bins: [], degenerate: true };
  let lo = Infinity;
  let hi = -Infinity;
  for (const v of xs) {
    if (!Number.isFinite(v)) continue;
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  if (!Number.isFinite(lo) || !Number.isFinite(hi) || lo === hi) {
    return { lo: Number.isFinite(lo) ? lo : 0, hi: Number.isFinite(hi) ? hi : 0, bins: [], degenerate: true };
  }
  const pad = (hi - lo) * 0.04;
  lo -= pad;
  hi += pad;
  const counts = new Array<number>(bins).fill(0);
  const span = hi - lo;
  for (const v of xs) {
    if (!Number.isFinite(v)) continue;
    const t = (v - lo) / span;
    const idx = Math.min(bins - 1, Math.max(0, Math.floor(t * bins)));
    counts[idx]++;
  }
  return { lo, hi, bins: counts };
}

function headlineStats(rets: number[], periodsPerYear = 252): { sharpe: number; sortino: number; max_dd: number } {
  const n = rets.length;
  if (n === 0) return { sharpe: 0, sortino: 0, max_dd: 0 };
  let sum = 0;
  for (const r of rets) sum += r;
  const m = sum / n;
  let varSum = 0;
  let downSqSum = 0;
  let hasNeg = false;
  for (const r of rets) {
    const dr = r - m;
    varSum += dr * dr;
    if (r < 0) {
      downSqSum += r * r;
      hasNeg = true;
    }
  }
  const s = Math.sqrt(varSum / n);
  const sharpe = s > 0 ? (m * periodsPerYear) / (s * Math.sqrt(periodsPerYear)) : 0;
  const downDev = hasNeg ? Math.sqrt(downSqSum / n) * Math.sqrt(periodsPerYear) : 0;
  const sortino = downDev > 0 ? (m * periodsPerYear) / downDev : 0;
  const eq = cumEq(rets);
  const dd = drawdowns(eq);
  let maxDd = 0;
  for (let i = 0; i < dd.length; i++) if (dd[i] < maxDd) maxDd = dd[i];
  return { sharpe, sortino, max_dd: maxDd };
}

function ci95(xs: number[]): { lo: number; hi: number } {
  const sorted = [...xs].sort((a, b) => a - b);
  const loIdx = Math.floor(0.025 * sorted.length);
  const hiIdx = Math.floor(0.975 * sorted.length);
  return { lo: sorted[loIdx], hi: sorted[hiIdx] };
}

function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
