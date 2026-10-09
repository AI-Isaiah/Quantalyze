import "server-only";
import { fetchAndBuildPayloadWithReason } from "@/lib/factsheet/fetch-and-build-payload";
import {
  V2_JOINT_NULL_VALUES,
  v2JointFromBuildResult,
  type V2BenchmarkJoint,
} from "@/lib/factsheet/v2-joint";
import type { StrategyV2Detail } from "@/lib/queries";
import { captureToSentry } from "@/lib/sentry-capture";
import { withPublishedOnly } from "@/lib/visibility";

/**
 * Phase 170.5 (D-07) - the composite builder path for the v2 benchmark greeks.
 *
 * `getStrategyDetailV2`'s light read (`readV2BenchmarkJoint`) cannot read a
 * composite's series (it lives behind a `server-only` reader), so it answers
 * `needs_builder`. The v2 page then calls this, which runs the factsheet's own
 * builder and takes the five figures from the payload's own
 * `comparators.btc.joint` (`v2JointFromBuildResult`). A composite therefore
 * shows exactly what its factsheet shows.
 *
 * Boundaries:
 *   - The builder runs on the SERVICE-ROLE client, so the visibility predicate
 *     is the only row gate. `withPublishedOnly` is passed explicitly (the
 *     parameter is required by design) and the page only reaches here after the
 *     RLS-scoped `getStrategyDetailV2` found the row published (T-170.5-17).
 *   - The builder is imported ONLY through its canonical specifier, which the
 *     phase-148 cache-isolation gate allows (rule 4b(ii)). The cached wrapper
 *     stays page-private to the factsheet (rule 4a); a cache around this read
 *     would serve one viewer's payload to the next (T-170.5-19).
 *   - Only five scalars and a status leave this module (`withV2Joint` copies
 *     nothing else), never the payload's series or bundles (T-170.5-18).
 *   - Failure is not absence: any throw, from the builder or from the mapper, is
 *     status `error` with a stable Sentry stage tag, never `not_computed` and
 *     never a 500 for the page (T-170.5-21). The mapping call sits INSIDE the
 *     try on purpose: the plan-04 mapper throws on an unreachable payload shape.
 */
export async function readCompositeV2Joint(id: string): Promise<V2BenchmarkJoint> {
  try {
    const result = await fetchAndBuildPayloadWithReason(id, withPublishedOnly);
    return v2JointFromBuildResult(result);
  } catch (err) {
    console.error("[v2-composite-joint] builder path failed", { id });
    captureToSentry(err, { tags: { stage: "v2-composite-joint", strategy_id: id } });
    return { values: { ...V2_JOINT_NULL_VALUES }, status: { kind: "error" } };
  }
}

/**
 * Merge a joint into a v2 detail: a new object whose `panel7Inputs` carries the
 * joint's values and status. Every other field keeps its reference.
 */
export function withV2Joint(
  detail: StrategyV2Detail,
  joint: V2BenchmarkJoint,
): StrategyV2Detail {
  return {
    ...detail,
    panel7Inputs: {
      ...detail.panel7Inputs,
      benchmark_greeks: joint.values,
      benchmark_joint: joint.status,
    },
  };
}
