import type { JointMetrics } from "./types";
import { mean } from "@/lib/portfolio-math-utils";
import { beta as betaOf, dispersion, pearson, sharpe } from "@/lib/return-stats";

/**
 * 169.4 review SFH MEDIUM-4: the fewest PAIRED strategy/benchmark
 * observations the joint statistics (alpha, beta, correlation, IR, ...) are
 * shown on. Below it an annualized alpha is noise dressed as a figure: a
 * 3-day book pairs 2 or 3 intervals and reads e.g. "+812% annualized". The
 * factsheet comparator block (`buildComparatorBlock`, so the allocator
 * Overview and every factsheet) and the Allocations alpha/beta widget both
 * gate on THIS constant, so under D-69 the two surfaces show one number or
 * neither does. 10 is the minimum the widget carried before 169.4.
 */
export const MIN_PAIRED_OBSERVATIONS = 10;

/**
 * 169.4 review round 2 (SFH-R2 MEDIUM-2): the ONE sentence naming why the
 * joint statistics are withheld below `MIN_PAIRED_OBSERVATIONS`. The
 * Allocations alpha/beta widget ("this book") and the factsheet KPI strip and
 * §IV ("this record") both print it, so one screen gives one cause.
 */
export function pairedFloorReason(
  comparator: string,
  paired: number,
  noun: "book" | "record",
  floor: number = MIN_PAIRED_OBSERVATIONS,
): string {
  return `Alpha and beta need at least ${floor} days paired with ${comparator}; this ${noun} has ${paired}.`;
}

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
  // answers exactly as an all-zero leg does (D-07). A ratio that does not exist
  // is NaN, which `num()` / `pct()` render as "—" (founder decision D7,
  // 2026-09-26), matching DistributionPanels' "—" for the same pair. Before D7
  // this function answered 0 and the same page read "Correlation 0.00" in one
  // panel and "—" in the next. Alpha and Treynor are built on beta, so an
  // undefined beta makes both NaN, which is the honest answer.
  const beta = betaOf(rets, bench) ?? NaN;
  const alpha = (m - beta * mb) * periodsPerYear;
  const corr = pearson(rets, bench) ?? NaN;
  const r2 = Number.isFinite(corr) ? corr * corr : NaN;

  // Tracking error and information ratio are the dispersion and the Sharpe of
  // the ACTIVE series (strategy minus benchmark), population sd.
  const active = rets.map((r, i) => r - bench[i]);
  const trackingError = dispersion(active, 0).sd * Math.sqrt(periodsPerYear);
  const infoRatio = sharpe(active, { periodsPerYear, ddof: 0 }) ?? NaN;
  const treynor =
    Number.isFinite(beta) && beta !== 0 ? ((m - rf / periodsPerYear) * periodsPerYear) / beta : NaN;

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
  // A capture ratio divides by the benchmark's own move on its up (down) days.
  // It does not exist when the benchmark has no such days, or when the benchmark
  // has no dispersion at all: every day of a compounding constant yield is an
  // "up day" whose tiny real sum made up_capture read -0.01 to -4.47 where an
  // all-zero benchmark read 0 (SFH-M3). Both are NaN, "—" (D7).
  const benchDisperses = dispersion(bench, 0).sd !== 0;
  const upCapture = benchDisperses && upBenchSum !== 0 ? upStratSum / upBenchSum : NaN;
  const downCapture = benchDisperses && downBenchSum !== 0 ? downStratSum / downBenchSum : NaN;

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
