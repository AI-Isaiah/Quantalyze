/**
 * Pearson correlation coefficient for two equal-length numeric arrays.
 * Returns 0 when there's not enough data (< 2 pairs) or when variance is
 * zero (avoids dividing by zero and producing NaN).
 */
export function pearson(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length);
  if (n < 2) return 0;
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
  return denom > 0 ? cov / denom : 0;
}

/**
 * Rolling Pearson correlation over a sliding window. For each index >= window-1,
 * computes pearson on the previous `window` points of both arrays. Indices
 * before window-1 are skipped (not enough history). Returns [{ index, value }].
 *
 * The arrays MUST be aligned to the same dates/timestamps; alignment is the
 * caller's responsibility. When both inputs are shorter than `window`, returns [].
 */
export function rollingCorrelation(
  a: number[],
  b: number[],
  window: number,
): { index: number; value: number }[] {
  const n = Math.min(a.length, b.length);
  if (n < window || window < 2) return [];
  const result: { index: number; value: number }[] = [];
  for (let i = window - 1; i < n; i++) {
    const winA = a.slice(i - window + 1, i + 1);
    const winB = b.slice(i - window + 1, i + 1);
    result.push({ index: i, value: pearson(winA, winB) });
  }
  return result;
}
