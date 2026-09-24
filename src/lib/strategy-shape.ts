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

/** A composite's `strategy_keys` member key ids, or why they could not be read. */
export type CompositeMemberKeyIds =
  | { ok: true; keyIds: string[] }
  | { ok: false; message: string };

/**
 * 167.2-REVIEW CR-02: read the strategy's `strategy_keys` member KEY IDS on the
 * client the caller passes (one column, `api_key_id`, scoped to the strategy).
 * The key card lists only these beneath KCS23-COMPOSITE, so its "reads from
 * every key below" is true of the list as rendered. The count is their number,
 * so a caller that needs both makes one read, not two.
 *
 * Fails closed exactly like `countCompositeMembers`: an error, a non-array
 * answer, a row without a string id, or a throw is `ok: false` with a message
 * for the caller to log. Never logs, never throws. Type-only cast as above:
 * RLS (`strategy_keys_owner`) still applies to the caller's runtime client.
 */
export async function readCompositeMemberKeyIds(
  client: SupabaseClient,
  strategyId: string,
): Promise<CompositeMemberKeyIds> {
  try {
    const { data, error } = await client
      .from("strategy_keys")
      .select("api_key_id")
      .eq("strategy_id", strategyId);
    if (error) {
      return { ok: false, message: `strategy_keys member read failed: ${error.message}` };
    }
    if (!Array.isArray(data)) {
      return {
        ok: false,
        message: "strategy_keys member read returned no rows array without an error",
      };
    }
    const keyIds: string[] = [];
    for (const row of data as Array<{ api_key_id?: unknown }>) {
      if (typeof row?.api_key_id !== "string") {
        return { ok: false, message: "strategy_keys member read returned a row without a key id" };
      }
      keyIds.push(row.api_key_id);
    }
    return { ok: true, keyIds };
  } catch (err) {
    return {
      ok: false,
      message: `strategy_keys member read threw: ${err instanceof Error ? err.message : String(err)}`,
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
