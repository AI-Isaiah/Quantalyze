import { compute, cumEq, drawdowns } from "./compute";
import { dispersion, pearson } from "@/lib/return-stats";

/**
 * Demo allocator portfolios composed from REAL benchmark return series.
 * The portfolio weights are illustrative; the underlying assets are not.
 * Production will replace this picker with file-upload + saved-portfolio
 * chooser wired to the allocator's actual book.
 */

const VOL_TARGET = 0.18;
const DD_THRESHOLD = -0.05;
const TAIL_WINDOW = 21;

export type AllocatorPortfolio = {
  key: string;
  name: string;
  composition: string;
  metrics: AllocatorMetrics;
};

export type AllocatorMetrics = {
  ann_vol: number;
  cum_ret: number;
  max_dd: number;
  corr: number;
  sleeve_pct: number;
  blend_vol: number;
  vol_target: number;
  tail_count: number;
  tail_mm_mean: number;
  tail_mm_median: number;
  tail_mm_pos: number;
  dd_threshold: number;
  window: number;
};

/** Weighted blend of multiple daily-return series of equal length. */
export function blend(weights: number[], series: number[][]): number[] {
  if (weights.length !== series.length || series.length === 0) {
    throw new Error("blend(): weight/series length mismatch");
  }
  const n = series[0].length;
  const out: number[] = new Array(n);
  for (let i = 0; i < n; i++) {
    let s = 0;
    for (let j = 0; j < weights.length; j++) s += weights[j] * series[j][i];
    out[i] = s;
  }
  return out;
}

/**
 * @param periodsPerYear Annualization basis for the frequency-annualized vols
 *   (ann_vol / mmAnnVol, and therefore blend_vol + the sleeve grid-scan).
 *   Defaults to 252 so a caller that passes NO arg (the 60/40 pure-tradfi
 *   reference panel) stays byte-identical to the pre-#597 hardcode. The caller
 *   derives the basis from the REFERENCE blend's constituent legs per the locked
 *   #597-part-2 ruling: a BTC/ETH leg makes the joined series calendar-daily
 *   (√365); a pure-tradfi blend stays √252. cum_ret / max_dd / corr / tail_* are
 *   basis-FREE and unaffected.
 */
export function buildAllocatorMetrics(
  rets: number[],
  mmRets: number[],
  periodsPerYear = 252,
): AllocatorMetrics {
  const n = rets.length;
  const eq = cumEq(rets);
  const dd = drawdowns(eq);
  // Vols and correlation are computed by `@/lib/return-stats` (Phase 166.2
  // D-17), population sd. A leg whose only dispersion is float residue has an sd
  // of exactly 0 and a correlation of 0, as an all-zero leg does (D-07).
  const s = dispersion(rets, 0).sd;
  const mmS = dispersion(mmRets.length === n ? mmRets : mmRets.slice(0, n), 0).sd;
  const annVol = s * Math.sqrt(periodsPerYear);
  const mmAnnVol = mmS * Math.sqrt(periodsPerYear);
  const corr = pearson(rets, mmRets) ?? 0;
  const cumRet = eq[n - 1] - 1;
  const maxDd = Math.min(...dd);

  // Sleeve sizing: 1% grid scan to find allocation that hits the vol target.
  let bestW = 0;
  let bestDiff = Math.abs(annVol - VOL_TARGET);
  let bestVol = annVol;
  for (let wInt = 0; wInt <= 100; wInt++) {
    const w = wInt / 100;
    const blendVar =
      (1 - w) ** 2 * annVol ** 2 + w ** 2 * mmAnnVol ** 2 + 2 * (1 - w) * w * corr * annVol * mmAnnVol;
    const v = Math.sqrt(Math.max(0, blendVar));
    if (Math.abs(v - VOL_TARGET) < bestDiff) {
      bestDiff = Math.abs(v - VOL_TARGET);
      bestW = w;
      bestVol = v;
    }
  }

  // Tail co-movement: rolling 21d windows where the portfolio drew ≥ 5%.
  const tailMm: number[] = [];
  for (let i = TAIL_WINDOW; i < n; i++) {
    let pRet = 1;
    for (let k = i - TAIL_WINDOW + 1; k <= i; k++) pRet *= 1 + rets[k];
    pRet -= 1;
    if (pRet <= DD_THRESHOLD) {
      let mmRet = 1;
      for (let k = i - TAIL_WINDOW + 1; k <= i; k++) mmRet *= 1 + mmRets[k];
      tailMm.push(mmRet - 1);
    }
  }
  let tailMean = 0;
  let tailPos = 0;
  let tailMedian = 0;
  if (tailMm.length > 0) {
    tailMean = tailMm.reduce((a, x) => a + x, 0) / tailMm.length;
    const sorted = [...tailMm].sort((a, b) => a - b);
    tailMedian =
      sorted.length % 2 === 1 ? sorted[Math.floor(sorted.length / 2)] : (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2;
    tailPos = tailMm.filter(x => x > 0).length / tailMm.length;
  }

  // discard unused compute import warning (kept import for symmetry with mockup helpers)
  void compute;

  return {
    ann_vol: annVol,
    cum_ret: cumRet,
    max_dd: maxDd,
    corr,
    sleeve_pct: bestW,
    blend_vol: bestVol,
    vol_target: VOL_TARGET,
    tail_count: tailMm.length,
    tail_mm_mean: tailMean,
    tail_mm_median: tailMedian,
    tail_mm_pos: tailPos,
    dd_threshold: DD_THRESHOLD,
    window: TAIL_WINDOW,
  };
}
