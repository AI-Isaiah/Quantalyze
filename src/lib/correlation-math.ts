/**
 * Pearson correlation coefficient for two equal-length numeric arrays.
 *
 * Returns `null` when correlation is mathematically UNDEFINED — either
 * because there are fewer than 2 pairs of observations, or because one
 * of the series has zero variance (the denominator √(varA·varB) is 0).
 *
 * Audit 2026-05-07 G11.E.5: the pre-audit signature returned `0` for
 * undefined-variance windows, which collapsed two distinct semantic
 * outcomes — "no correlation" and "correlation cannot be measured" —
 * to the same number. For a strategy that was flat for 90 days,
 * allocators saw `correlation = 0.000` indistinguishable from a
 * genuinely uncorrelated 90-day window. Returning `null` lets the
 * chart layer surface a gap with a "flat window — correlation
 * undefined" tooltip instead.
 */
export function pearson(a: number[], b: number[]): number | null {
  const n = Math.min(a.length, b.length);
  if (n < 2) return null;
  let ma = 0;
  let mb = 0;
  for (let i = 0; i < n; i++) {
    ma += a[i];
    mb += b[i];
  }
  ma /= n;
  mb /= n;
  let cov = 0;
  let varA = 0;
  let varB = 0;
  for (let i = 0; i < n; i++) {
    const da = a[i] - ma;
    const db = b[i] - mb;
    cov += da * db;
    varA += da * da;
    varB += db * db;
  }
  const denom = Math.sqrt(varA * varB);
  return denom > 0 ? cov / denom : null;
}

/**
 * Rolling Pearson correlation over a sliding window. For each index >= window-1,
 * computes pearson on the previous `window` points of both arrays. Indices
 * before window-1 are skipped (not enough history). Returns [{ index, value }].
 *
 * The arrays MUST be aligned to the same dates/timestamps; alignment is the
 * caller's responsibility. When both inputs are shorter than `window`, returns [].
 *
 * Audit 2026-05-07 G11.E.5: `value` is now `number | null` so flat-variance
 * windows propagate as gaps (chart UI renders "—" with an explanatory
 * tooltip) instead of being collapsed to a misleading 0.
 */
export function rollingCorrelation(
  a: number[],
  b: number[],
  window: number,
): { index: number; value: number | null }[] {
  const n = Math.min(a.length, b.length);
  if (n < window || window < 2) return [];
  const result: { index: number; value: number | null }[] = [];
  for (let i = window - 1; i < n; i++) {
    const winA = a.slice(i - window + 1, i + 1);
    const winB = b.slice(i - window + 1, i + 1);
    result.push({ index: i, value: pearson(winA, winB) });
  }
  return result;
}
