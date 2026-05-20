import type { JointMetrics } from "./types";

/**
 * Port of `joint_metrics()` from `/tmp/gen_factsheet_v3.py`. Computes
 * strategy-vs-benchmark joint statistics on daily-return series of equal
 * length. Up/down capture is the ratio of cumulative strategy return to
 * cumulative benchmark return on the days the benchmark was positive
 * (resp. negative).
 */
export function jointMetrics(rets: number[], bench: number[], rf = 0): JointMetrics {
  const n = rets.length;
  if (n === 0 || bench.length !== n) {
    throw new Error("jointMetrics(): inputs must be non-empty arrays of equal length");
  }

  const m = mean(rets);
  const mb = mean(bench);
  const s = pstdev(rets, m);
  const sb = pstdev(bench, mb);

  let cov = 0;
  let varB = 0;
  for (let i = 0; i < n; i++) {
    cov += (rets[i] - m) * (bench[i] - mb);
    varB += (bench[i] - mb) ** 2;
  }
  cov /= n;
  varB /= n;

  const beta = varB > 0 ? cov / varB : 0;
  const alpha = (m - beta * mb) * 252;
  const corr = s > 0 && sb > 0 ? cov / (s * sb) : 0;
  const r2 = corr * corr;

  let teSum = 0;
  for (let i = 0; i < n; i++) {
    const diff = rets[i] - bench[i] - (m - mb);
    teSum += diff * diff;
  }
  const trackingError = Math.sqrt(teSum / n) * Math.sqrt(252);
  const infoRatio = trackingError > 0 ? ((m - mb) * 252) / trackingError : 0;
  const treynor = beta !== 0 ? ((m - rf / 252) * 252) / beta : 0;

  let upBenchSum = 0;
  let upStratSum = 0;
  let downBenchSum = 0;
  let downStratSum = 0;
  for (let i = 0; i < n; i++) {
    if (bench[i] > 0) {
      upBenchSum += bench[i];
      upStratSum += rets[i];
    } else if (bench[i] < 0) {
      downBenchSum += bench[i];
      downStratSum += rets[i];
    }
  }
  const upCapture = upBenchSum !== 0 ? upStratSum / upBenchSum : 0;
  const downCapture = downBenchSum !== 0 ? downStratSum / downBenchSum : 0;

  return {
    alpha,
    beta,
    corr,
    r2,
    info_ratio: infoRatio,
    treynor,
    tracking_error: trackingError,
    up_capture: upCapture,
    down_capture: downCapture,
  };
}

function mean(xs: number[]): number {
  let s = 0;
  for (const x of xs) s += x;
  return s / xs.length;
}

function pstdev(xs: number[], m: number): number {
  let s = 0;
  for (const x of xs) s += (x - m) * (x - m);
  return Math.sqrt(s / xs.length);
}
