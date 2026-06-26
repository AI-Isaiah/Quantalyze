import type { QuantilePayload } from "./types";

export function quantileSummary(rets: number[]): QuantilePayload {
  const n = rets.length;
  if (n === 0) {
    return { p05: 0, p25: 0, p50: 0, p75: 0, p95: 0, min: 0, max: 0, mean: 0 };
  }
  const sorted = [...rets].sort((a, b) => a - b);
  const q = (p: number) => {
    if (n === 1) return sorted[0];
    const idx = p * (n - 1);
    const lo = Math.floor(idx);
    const hi = Math.ceil(idx);
    const frac = idx - lo;
    return sorted[lo] * (1 - frac) + sorted[hi] * frac;
  };
  let sum = 0;
  for (const r of rets) sum += r;
  return {
    p05: q(0.05),
    p25: q(0.25),
    p50: q(0.5),
    p75: q(0.75),
    p95: q(0.95),
    min: sorted[0],
    max: sorted[n - 1],
    mean: sum / n,
  };
}
