/**
 * Phase 167.2 / KCS-21, KCS-23 — a strategy's SHAPE, resolved in one place.
 *
 * The owner factsheet's remedy line (KCS-21) and the key card (KCS-23) both
 * need to know whether a strategy is a single-key API strategy, an API strategy
 * with no key linked, a composite, or a CSV upload, because the control that
 * re-runs a computation differs by shape and a remedy naming a control the
 * screen does not paint is a false remedy. The composite predicate is written
 * ONCE, here: a strategy is a composite when its `strategy_keys` member count
 * is greater than zero (the same predicate `compositeMemberCount` applies in
 * the keys/sync and finalize-wizard routes).
 *
 * FAIL CLOSED ON AN UNKNOWABLE COUNT. A count that errors, comes back null
 * without an error, or throws is `ok: false`, and `resolveStrategyShape` maps it
 * to "unknown", never to "single": a POSSIBLE composite must not be offered a
 * single-key remedy or a control that rewrites `strategies.api_key_id` (which
 * would silently turn it into a single-key strategy).
 *
 * No client directive (server pages call it). The Supabase import is TYPE-ONLY:
 * the runtime client is whatever the caller passes, which in every consumer is
 * the RLS-scoped request client (`strategy_keys_owner`), never the admin one.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

/** The four shapes a strategy can have. "unknown" is resolved separately. */
export type StrategyShape = "single" | "unlinked" | "composite" | "csv";

/** A `strategy_keys` member count, or why it could not be read. */
export type CompositeMemberCount =
  | { ok: true; count: number }
  | { ok: false; message: string };

/**
 * Head-count the strategy's `strategy_keys` rows on the client the caller
 * passes (no rows are returned). An error, a null count or a throw is
 * `ok: false` with a message for the caller to log; this function never logs
 * and never throws.
 *
 * The parameter is the untyped `SupabaseClient` because the generated database
 * types predate the `strategy_keys` table (the same type-only cast
 * src/app/api/strategies/composite/members/route.ts takes). It casts the TYPE
 * only: RLS still applies to the caller's runtime client.
 */
export async function countCompositeMembers(
  client: SupabaseClient,
  strategyId: string,
): Promise<CompositeMemberCount> {
  try {
    const { count, error } = await client
      .from("strategy_keys")
      .select("*", { count: "exact", head: true })
      .eq("strategy_id", strategyId);
    if (error) {
      return { ok: false, message: `strategy_keys count failed: ${error.message}` };
    }
    if (typeof count !== "number") {
      return {
        ok: false,
        message: "strategy_keys count returned null without an error",
      };
    }
    return { ok: true, count };
  } catch (err) {
    return {
      ok: false,
      message: `strategy_keys count threw: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

/**
 * Resolve the shape: source "csv" → csv (whatever the count); an unknowable
 * member count → "unknown"; a member count above zero → composite; a linked
 * `api_key_id` → single; otherwise unlinked.
 */
export function resolveStrategyShape(input: {
  source: string | null | undefined;
  apiKeyId: string | null | undefined;
  memberCount: CompositeMemberCount;
}): StrategyShape | "unknown" {
  if (input.source === "csv") return "csv";
  if (!input.memberCount.ok) return "unknown";
  if (input.memberCount.count > 0) return "composite";
  if (input.apiKeyId) return "single";
  return "unlinked";
}
