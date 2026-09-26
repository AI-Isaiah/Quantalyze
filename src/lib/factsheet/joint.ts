import type { JointMetrics } from "./types";
import { mean } from "@/lib/portfolio-math-utils";
import { beta as betaOf, dispersion, pearson, sharpe } from "@/lib/return-stats";

/**
 * Port of `joint_metrics()` from `/tmp/gen_factsheet_v3.py`. Computes
 * strategy-vs-benchmark joint statistics on daily-return series of equal
 * length. Up/down capture is the ratio of cumulative strategy return to
 * cumulative benchmark return on the days the benchmark was positive
 * (resp. negative).
 */
export function jointMetrics(rets: number[], bench: number[], rf = 0, periodsPerYear = 252): JointMetrics {
  const n = rets.length;
  if (n === 0 || bench.length !== n) {
    throw new Error("jointMetrics(): inputs must be non-empty arrays of equal length");
  }

  const m = mean(rets);
  const mb = mean(bench);

  // Beta, correlation, tracking error and information ratio are computed by
  // `@/lib/return-stats` (Phase 166.2 D-17), not by a local formula. A leg whose
  // only dispersion is float residue (a compounding constant yield) therefore
  // answers exactly as an all-zero leg does (D-07): 0 for each ratio here.
  const beta = betaOf(rets, bench) ?? 0;
  const alpha = (m - beta * mb) * periodsPerYear;
  const corr = pearson(rets, bench) ?? 0;
  const r2 = corr * corr;

  // Tracking error and information ratio are the dispersion and the Sharpe of
  // the ACTIVE series (strategy minus benchmark), population sd.
  const active = rets.map((r, i) => r - bench[i]);
  const trackingError = dispersion(active, 0).sd * Math.sqrt(periodsPerYear);
  const infoRatio = sharpe(active, { periodsPerYear, ddof: 0 }) ?? 0;
  const treynor = beta !== 0 ? ((m - rf / periodsPerYear) * periodsPerYear) / beta : 0;

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
