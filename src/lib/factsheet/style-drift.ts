import { compute } from "./compute";
import type { ComputeSummary } from "./types";

/**
 * Two-sample Kolmogorov-Smirnov D-statistic + asymptotic p-value.
 * Ports the mockup's `_ks_stat_pvalue()` exactly, including the tied-zeros
 * walker fix: on equality, advances BOTH CDFs past all equal values before
 * recording the difference. (Financial return series have many no-move days
 * that would otherwise inflate D.)
 */
export function ksStatPValue(a: number[], b: number[]): { d: number; p: number } {
  const sa = [...a].sort((x, y) => x - y);
  const sb = [...b].sort((x, y) => x - y);
  const na = sa.length;
  const nb = sb.length;
  if (na === 0 || nb === 0) return { d: 0, p: 1 };
  let i = 0;
  let j = 0;
  let d = 0;
  while (i < na && j < nb) {
    if (sa[i] < sb[j]) i++;
    else if (sa[i] > sb[j]) j++;
    else {
      const v = sa[i];
      while (i < na && sa[i] === v) i++;
      while (j < nb && sb[j] === v) j++;
    }
    const diff = Math.abs(i / na - j / nb);
    if (diff > d) d = diff;
  }
  if (i < na) d = Math.max(d, Math.abs(1 - j / nb));
  if (j < nb) d = Math.max(d, Math.abs(i / na - 1));
  // Asymptotic p with Stephens (1970) finite-n correction.
  const en = Math.sqrt((na * nb) / (na + nb));
  const lam = (en + 0.12 + 0.11 / en) * d;
  let p = 0;
  for (let k = 1; k <= 100; k++) {
    p += (k % 2 === 1 ? 1 : -1) * Math.exp(-2 * k * k * lam * lam);
  }
  return { d, p: Math.max(0, Math.min(1, 2 * p)) };
}

export type StyleDriftMetrics = {
  h1: ComputeSummary;
  h2: ComputeSummary;
  ksD: number;
  ksP: number;
};

/**
 * Split strategy returns 50/50 chronologically and compute regime-stability
 * metrics on each half. The KS test on the two empirical CDFs reports
 * whether the distributions are statistically distinct.
 *
 * Returns {@link ComputeSummary} (no eq/dd) so the payload that crosses to the
 * client doesn't ship two half-length equity/drawdown arrays nobody reads.
 */
export function computeStyleDrift(rets: number[], dates: string[]): StyleDriftMetrics | null {
  if (rets.length < 4) return null;
  const mid = Math.floor(rets.length / 2);
  const { eq: _eq1, dd: _dd1, ...h1 } = compute(rets.slice(0, mid), dates.slice(0, mid));
  const { eq: _eq2, dd: _dd2, ...h2 } = compute(rets.slice(mid), dates.slice(mid));
  const { d, p } = ksStatPValue(rets.slice(0, mid), rets.slice(mid));
  return { h1, h2, ksD: d, ksP: p };
}
