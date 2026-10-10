import { annualizationPeriods, isComputedAnalytics } from "@/lib/closed-sets";
import { dispersion } from "@/lib/return-stats";
import { captureToSentry } from "@/lib/sentry-capture";
import type { createAdminClient } from "@/lib/supabase/admin";
import { withPublishedOnly } from "@/lib/visibility";
import { alignCoveredReturns, COMPARATOR_CALENDARS } from "./align";
import { hasBuildableSeries, normalizeDailyReturns } from "./build-payload";
import type { BenchmarkPricesOpt } from "./build-payload";
import { readFactsheetBenchmark } from "./benchmark-read";
import { gateFlatLeg, jointMetrics, MIN_PAIRED_OBSERVATIONS } from "./joint";
import { parseReturnsUnit } from "./returns-unit";
import { curveMethodFromFlags, resolveDailyReturnSeries } from "./resolve-series";
import type { DailyReturn, FactsheetPayload } from "./types";

/**
 * Phase 170.5 (D-07) — the benchmark greeks on `/strategy/[id]/v2` are the
 * factsheet's own: alpha, beta, correlation, information ratio and Treynor,
 * computed by the factsheet's TypeScript chain, never read from the stored
 * Python `metrics_json`. Both pages therefore print one number.
 *
 * `computeV2Joint` repeats the factsheet's steps in the factsheet's order, each
 * from its own exported symbol (never a re-typed formula):
 *   normalizeDailyReturns -> alignCoveredReturns with COMPARATOR_CALENDARS.btc
 *   -> paired indices (as `buildComparatorBlock` collects them)
 *   -> MIN_PAIRED_OBSERVATIONS floor
 *   -> jointMetrics with rf 0 and annualizationPeriods(asset_class)
 *   -> gateFlatLeg (164.6.6.3.3): a flat strategy leg withholds alpha, beta and IR.
 * `v2-joint.parity.test.ts` pins it `toBe`-equal to `buildFactsheetPayload`'s
 * `comparators.btc.joint` on the same rows and the same BenchmarkPricesOpt.
 *
 * Known differences from the full builder, stated rather than hidden:
 *   - v2 shows the factsheet's default view (cash basis, leverage 1x).
 *   - The light path's BTC read window is the cash axis only (buildOpts
 *     undefined), which does not change a cash-date alignment.
 *
 * ⛔ SERVER-SAFE BY CONSTRUCTION. This module loads no `server-only` module:
 * `fetch-and-build-payload` and `composite-read-path` are never imported at
 * runtime (the builder's result is taken structurally), and the admin client is
 * named for its TYPE only, so `src/lib/queries.ts` can import it.
 */

/** The five figures, each null when it is not computable. A NaN never becomes 0. */
export type V2JointValues = {
  alpha: number | null;
  beta: number | null;
  correlation: number | null;
  ir: number | null;
  treynor: number | null;
};

/** Why the five figures are what they are: a closed set a panel maps to copy. */
export type V2JointStatus =
  | { kind: "computed"; paired: number; flatLeg: boolean }
  | { kind: "native_unit"; unit: string }
  | { kind: "benchmark_unavailable" }
  | { kind: "below_floor"; paired: number; floor: number }
  | { kind: "not_computed" }
  | { kind: "needs_builder" }
  | { kind: "error" };

export type V2BenchmarkJoint = { values: V2JointValues; status: V2JointStatus };

export const V2_JOINT_NULL_VALUES: V2JointValues = {
  alpha: null,
  beta: null,
  correlation: null,
  ir: null,
  treynor: null,
};

const finiteOrNull = (v: number): number | null => (Number.isFinite(v) ? v : null);

const withheld = (status: V2JointStatus): V2BenchmarkJoint => ({
  values: { ...V2_JOINT_NULL_VALUES },
  status,
});

/**
 * The paired strategy and BTC legs of one record, collected exactly as
 * `buildComparatorBlock` collects them. Null when BTC prices are unavailable.
 */
function pairedLegs(
  dates: string[],
  strategyReturns: number[],
  benchmarkPrices: BenchmarkPricesOpt,
): { strat: number[]; bench: number[] } | null {
  if ("unavailable" in benchmarkPrices) return null;
  const aligned = alignCoveredReturns(
    benchmarkPrices.prices,
    benchmarkPrices.dropped,
    dates,
    COMPARATOR_CALENDARS.btc,
  );
  const strat: number[] = [];
  const bench: number[] = [];
  for (let i = 0; i < aligned.paired.length; i++) {
    if (!aligned.paired[i]) continue;
    strat.push(strategyReturns[i]);
    bench.push(aligned.returns[i] as number);
  }
  return { strat, bench };
}

/** The reason input for `flatLeg`. The VALUES are gated by `gateFlatLeg` (strategy leg only); this also reads a flat BTC leg. */
const hasFlatLeg = (strat: number[], bench: number[]): boolean =>
  dispersion(strat, 0).sd === 0 || dispersion(bench, 0).sd === 0;

export function computeV2Joint(
  dailyReturns: DailyReturn[],
  benchmarkPrices: BenchmarkPricesOpt,
  assetClass: string | null,
): V2BenchmarkJoint {
  const clipped = normalizeDailyReturns(dailyReturns);
  const legs = pairedLegs(
    clipped.map((d) => d.date),
    clipped.map((d) => d.value),
    benchmarkPrices,
  );
  if (legs === null) return withheld({ kind: "benchmark_unavailable" });
  if (legs.strat.length < MIN_PAIRED_OBSERVATIONS) {
    return withheld({ kind: "below_floor", paired: legs.strat.length, floor: MIN_PAIRED_OBSERVATIONS });
  }
  // The builder's flat-leg gate (Phase 164.6.6.3.3 D-04), the same helper: a flat
  // strategy leg has no alpha, beta or IR, so they are NaN here and null below.
  const { joint } = gateFlatLeg(
    jointMetrics(legs.strat, legs.bench, 0, annualizationPeriods(assetClass)),
    legs.strat,
  );
  return {
    values: {
      alpha: finiteOrNull(joint.alpha),
      beta: finiteOrNull(joint.beta),
      correlation: finiteOrNull(joint.corr),
      ir: finiteOrNull(joint.info_ratio),
      treynor: finiteOrNull(joint.treynor),
    },
    status: { kind: "computed", paired: legs.strat.length, flatLeg: hasFlatLeg(legs.strat, legs.bench) },
  };
}

/**
 * The light path: one admin read, then the factsheet's own steps, for a
 * single-key strategy. A composite cannot be read here (its series lives behind
 * `server-only` code), so it answers `needs_builder` and the page asks the
 * builder instead (`v2JointFromBuildResult`).
 *
 * The read goes through `withPublishedOnly` (the service role bypasses RLS, so
 * the predicate is the only row gate; T-170.5-09) and the series never leaves
 * the server: only the five scalars do (T-170.5-10). A failed or empty read is
 * `error`, never "not computed": an outage is not a data fact (T-170.5-12).
 * Only the DB read sits in the try; a throw from the pure steps is a code bug
 * and propagates, as in `benchmark-read.ts`.
 */
export async function readV2BenchmarkJoint(
  admin: ReturnType<typeof createAdminClient>,
  strategyId: string,
): Promise<V2BenchmarkJoint> {
  type Analytics = {
    daily_returns?: unknown;
    returns_series?: unknown;
    data_quality_flags?: unknown;
    computation_status?: string | null;
  };
  type Row = { asset_class?: string | null; strategy_analytics?: Analytics | Analytics[] | null };

  let row: Row | null;
  try {
    const { data, error } = await withPublishedOnly(
      admin
        .from("strategies")
        .select("id, asset_class, strategy_analytics ( daily_returns, returns_series, data_quality_flags, computation_status )")
        .eq("id", strategyId),
    ).maybeSingle();
    if (error) {
      reportReadFailure(strategyId, (error as { code?: string }).code || "none");
      return withheld({ kind: "error" });
    }
    row = data as unknown as Row | null;
  } catch {
    reportReadFailure(strategyId, "threw");
    return withheld({ kind: "error" });
  }
  if (!row) return withheld({ kind: "error" });

  const analytics = Array.isArray(row.strategy_analytics) ? row.strategy_analytics[0] : row.strategy_analytics;
  if (!isComputedAnalytics(analytics?.computation_status)) return withheld({ kind: "not_computed" });

  const dqf = analytics?.data_quality_flags as { composite?: unknown; native_unit?: unknown } | null | undefined;
  if (dqf?.composite === true) return withheld({ kind: "needs_builder" });
  const unit = parseReturnsUnit(dqf?.native_unit);
  if (unit !== null) return withheld({ kind: "native_unit", unit });

  const series = resolveDailyReturnSeries(analytics?.daily_returns, analytics?.returns_series, curveMethodFromFlags(dqf));
  if (!hasBuildableSeries(series)) return withheld({ kind: "not_computed" });

  const benchmarkPrices = await readFactsheetBenchmark(admin, series, undefined, strategyId);
  return computeV2Joint(series, benchmarkPrices, row.asset_class ?? null);
}

/** A failed admin read is an outage: log it and capture it once, with a stable stage tag and no row data. */
function reportReadFailure(strategyId: string, code: string): void {
  console.error("[v2-joint] admin read failed", { id: strategyId, code });
  captureToSentry(new Error(`v2-joint: admin read failed (${code})`), {
    tags: { stage: "v2-joint", strategy_id: strategyId },
  });
}

/**
 * The builder path: a factsheet build result (`fetchAndBuildPayloadWithReason`)
 * mapped to the same closed status, for a composite. Typed structurally so this
 * module never imports the builder. The five VALUES are the payload's own
 * `comparators.btc.joint` (the factsheet's numbers, a NaN or a JSON-round-trip
 * null mapped to null); `paired` and `flatLeg` are reason inputs only.
 */
export function v2JointFromBuildResult(result: {
  payload: FactsheetPayload | null;
  reason: string | null;
}): V2BenchmarkJoint {
  const { payload, reason } = result;
  if (payload === null) {
    switch (reason) {
      case "not_computed":
      case "composite_unbuildable":
      case "too_few_points":
      case "malformed_series":
        return withheld({ kind: "not_computed" });
      // read_error, not_visible, and anything this module does not know: a
      // failure to answer is never read as "there is nothing to answer".
      default:
        return withheld({ kind: "error" });
    }
  }
  if (payload.returnsUnit) return withheld({ kind: "native_unit", unit: payload.returnsUnit });
  if (payload.benchmarkPrices && "unavailable" in payload.benchmarkPrices) {
    return withheld({ kind: "benchmark_unavailable" });
  }
  const block = payload.comparators.btc;
  if (block.jointWithheld) {
    return withheld({ kind: "below_floor", paired: block.jointWithheld.paired, floor: block.jointWithheld.floor });
  }
  const joint = block.joint;
  if (!joint) return withheld({ kind: "not_computed" });
  if (!payload.benchmarkPrices) {
    throw new Error("v2JointFromBuildResult: payload has a BTC joint but no benchmarkPrices");
  }
  const legs = pairedLegs(payload.dates, payload.strategyReturns, payload.benchmarkPrices);
  if (legs === null) return withheld({ kind: "benchmark_unavailable" });
  return {
    values: {
      alpha: finiteOrNull(joint.alpha),
      beta: finiteOrNull(joint.beta),
      correlation: finiteOrNull(joint.corr),
      ir: finiteOrNull(joint.info_ratio),
      treynor: finiteOrNull(joint.treynor),
    },
    status: { kind: "computed", paired: legs.strat.length, flatLeg: hasFlatLeg(legs.strat, legs.bench) },
  };
}
