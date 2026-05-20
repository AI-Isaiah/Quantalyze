/**
 * Single-source formatters for every numeric on the factsheet view. Keeps
 * decimal counts and sign conventions consistent — Sharpe is always 2dp,
 * percentages always 1dp (or 2dp for tail-risk where precision matters),
 * counts integer with thousand separators.
 *
 * Allocators expect a uniform table; mixing formats across panels reads
 * sloppy. Prefer these over per-component inline formatting.
 */

const PCT_DEFAULT_DP = 1;
const RATIO_DP = 2;

/** Percentage with sign prefix. dp=1 by default, dp=2 for tail-risk metrics. */
export function pctSigned(v: number | null | undefined, dp = PCT_DEFAULT_DP): string {
  if (v == null || !Number.isFinite(v)) return "—";
  const x = v * 100;
  return `${x >= 0 ? "+" : ""}${x.toFixed(dp)}%`;
}

/** Unsigned percentage (e.g., for max DD which is conventionally written negative without explicit + sign). */
export function pct(v: number | null | undefined, dp = PCT_DEFAULT_DP): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return `${(v * 100).toFixed(dp)}%`;
}

/** Ratio (Sharpe, Sortino, Calmar, Omega) — always 2 decimal places. */
export function ratio(v: number | null | undefined, dp = RATIO_DP): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return v.toFixed(dp);
}

/** Signed scalar (Skew etc.) — 2dp with sign prefix. */
export function signed(v: number | null | undefined, dp = RATIO_DP): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return (v >= 0 ? "+" : "") + v.toFixed(dp);
}

/** Integer with thousand separators. */
export function intl(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return Math.round(v).toLocaleString();
}

/** USD in compact form (B / M / K). */
export function usdCompact(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "—";
  if (v >= 1e9) return `$${(v / 1e9).toFixed(1)}B`;
  if (v >= 1e6) return `$${(v / 1e6).toFixed(0)}M`;
  if (v >= 1e3) return `$${(v / 1e3).toFixed(0)}K`;
  return `$${v.toFixed(0)}`;
}

/** Percentage-points delta (a − b) — for "vs benchmark" delta cells. */
export function ppDelta(a: number | null | undefined, b: number | null | undefined, dp = 1): string {
  if (a == null || b == null || !Number.isFinite(a) || !Number.isFinite(b)) return "—";
  const x = (a - b) * 100;
  return `${x >= 0 ? "+" : ""}${x.toFixed(dp)}pp`;
}
