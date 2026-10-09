import { pairedFloorReason } from "@/lib/factsheet/joint";
import { nativeUnitReason, parseReturnsUnit } from "@/lib/factsheet/returns-unit";
import type { V2JointStatus } from "@/lib/factsheet/v2-joint";
import { BENCHMARK_ROLLING_WINDOW_DAYS } from "@/lib/min-history";
import type { AnalyticsDataQualityFlags } from "@/lib/types";

/**
 * Phase 170.5 (D-01) — why a rolling BTC-paired series has nothing to draw.
 *
 * Pure and React-free. The rolling alpha/beta sub-section of the v2 Rolling
 * metrics panel and the Correlation-with-BTC chart both ask this question, so
 * the ladders live here rather than in either component (a shared chart must
 * not import from a page-specific folder).
 *
 * Each ladder is first-match-wins, the order fixed by the UI-SPEC:
 *   1. native unit            -> the returns are not in a currency BTC pairs with
 *   2. benchmark_unavailable  -> the worker had no BTC prices
 *   3. short history          -> fewer days than the window needs
 *   4. otherwise              -> a generic "not computed"
 *
 * Both always return a sentence: callers ask only when they have nothing to
 * draw. No sentence promises the figure will arrive ("yet" is deliberately
 * absent) and none names a job, worker or row.
 */
export interface BenchmarkWhyInputs {
  flags: AnalyticsDataQualityFlags | null | undefined;
  /** History length in days. An upper bound on the paired count. */
  historyDays: number;
}

/** First line of both ladders that does not depend on which series is asked about. */
function sharedReason({ flags }: BenchmarkWhyInputs): string | null {
  // native_unit is untrusted jsonb: parse it before it can reach visible text.
  const unit = parseReturnsUnit(flags?.native_unit);
  if (unit !== null) return `Not paired with BTC: ${nativeUnitReason(unit)}.`;
  if (flags?.benchmark_unavailable === true) {
    return "BTC benchmark prices were unavailable when this strategy was last computed.";
  }
  return null;
}

/** The history a rolling line needs: the window plus the one more point that makes a line. */
const NEEDED_DAYS = BENCHMARK_ROLLING_WINDOW_DAYS + 1;

function shortHistory(inputs: BenchmarkWhyInputs, series: string): string | null {
  if (inputs.historyDays >= NEEDED_DAYS) return null;
  return (
    `Not enough history for the ${BENCHMARK_ROLLING_WINDOW_DAYS}-day rolling ${series}: ` +
    `needs ${NEEDED_DAYS} days paired with BTC; ` +
    `this strategy has ${inputs.historyDays.toLocaleString("en-US")} days of history.`
  );
}

export function rollingAlphaBetaWhy(inputs: BenchmarkWhyInputs): string {
  return (
    sharedReason(inputs) ??
    shortHistory(inputs, "window") ??
    "Rolling alpha and beta are not computed for this strategy."
  );
}

export function btcCorrelationWhy(inputs: BenchmarkWhyInputs): string {
  return (
    sharedReason(inputs) ??
    shortHistory(inputs, "correlation") ??
    "Rolling correlation with BTC is not computed for this strategy."
  );
}

/**
 * Plan 07 (D-07) - why a Benchmark greeks cell reads a dash. The five figures
 * are the factsheet's own (`readV2BenchmarkJoint`, or the builder path); this is
 * the ONE line under the strip, shown only when at least one cell is a dash.
 *
 * Withheld ladder (every cell a dash; first match wins): native unit, benchmark
 * unavailable, below the paired floor, otherwise not computed. When the joint
 * WAS computed but a single ratio is undefined (`NaN` mapped to null), the line
 * names that cell's cause; a flat leg replaces every per-cell line. A null
 * alpha or beta on a computed joint has no per-cell cause, so it takes the
 * not-computed sentence (a dash never stands alone).
 *
 * `error` and `needs_builder` return null: a failure to answer is not a fact
 * about the strategy, and the panel renders the retry banner instead of a line.
 *
 * The sentences that exist on the factsheet are composed from its own helpers
 * (`nativeUnitReason`, `pairedFloorReason`), so the two pages cannot drift.
 */
export interface GreeksValues {
  alpha: number | null;
  beta: number | null;
  correlation?: number | null;
  ir: number | null;
  treynor: number | null;
}

const isDash = (v: number | null | undefined): boolean => v == null || !Number.isFinite(v);

const NOT_COMPUTED = "Benchmark greeks are not computed for this strategy.";

export function greeksReason(
  status: V2JointStatus | undefined,
  values: GreeksValues,
): string | null {
  if (status?.kind === "error" || status?.kind === "needs_builder") return null;
  const anyDash = [values.alpha, values.beta, values.correlation, values.ir, values.treynor].some(isDash);
  if (!anyDash) return null;

  switch (status?.kind) {
    case "native_unit":
      return `Not measurable: ${nativeUnitReason(status.unit)}. A BTC benchmark measured in ${status.unit} is a flat line.`;
    case "benchmark_unavailable":
      return "BTC benchmark prices are unavailable for this record.";
    case "below_floor":
      return pairedFloorReason("BTC", status.paired, "record", status.floor);
    case "computed": {
      if (status.flatLeg) return "No dispersion in this record.";
      if (isDash(values.alpha) || isDash(values.beta)) return NOT_COMPUTED;
      const causes: string[] = [];
      if (isDash(values.correlation)) causes.push("Correlation reads \u2014 when either return series is flat.");
      if (isDash(values.ir)) causes.push("IR reads \u2014 when tracking error is zero.");
      if (isDash(values.treynor)) causes.push("Treynor reads \u2014 when beta is zero.");
      return causes.join(" ");
    }
    default:
      return NOT_COMPUTED;
  }
}
