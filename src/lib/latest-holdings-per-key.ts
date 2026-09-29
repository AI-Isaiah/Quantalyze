/**
 * Phase 167.1.2 plan 15 (item 8, D-16): which `allocator_holdings` rows are a
 * key's CURRENT holdings.
 *
 * The rule, in the same words as plan 10's Python helper
 * (`_fetch_latest_holdings_per_eligible_key`): that key's rows at its own
 * latest asof; ordering is not trusted for correctness.
 *
 * Why per key and not allocator-wide: `getLatestExposureSnapshot` takes the
 * allocator's single latest `asof`, which drops every position of a key that
 * did not poll on that day, so a quiet key would read as flat. Each key keeps
 * its own latest poll instead.
 *
 * Why the key set is not narrowed: every key the allocator owns counts,
 * departed ones included. Phase 167.1 routes a holding whose key is not
 * trusted, or is outside the eligible set, into a DISCLOSED part
 * (`untrusted`, `unknownStatus`, `excludedUntrusted`, `excludedUnknownStatus`
 * in `live-holdings-summary.ts`); dropping those keys here would move their
 * dollars out of the disclosures silently. Plan 10 counts eligible keys only
 * because it computes an equity total (D-07); the two share the grain rule,
 * not the key set.
 *
 * Before D-16 the Open Positions collapse kept the newest row per
 * venue:symbol:type across EVERY date, so a position a key closed before its
 * latest poll survived from its last row.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";

/**
 * Keep, for each `api_key_id`, only the rows whose `asof` equals that key's
 * maximum `asof`. One scan finds each key's maximum, a second keeps the rows
 * at it. Input order is preserved and never relied on: the maximum is
 * computed by comparison, so ascending, descending and shuffled input give
 * the same rows. Rows sharing a key's latest `asof` are all kept.
 */
export function latestHoldingsPerKey<
  T extends { api_key_id: string; asof: string },
>(rows: readonly T[]): T[] {
  const latestByKey = new Map<string, string>();
  for (const r of rows) {
    const current = latestByKey.get(r.api_key_id);
    if (current === undefined || r.asof > current) {
      latestByKey.set(r.api_key_id, r.asof);
    }
  }
  return rows.filter((r) => r.asof === latestByKey.get(r.api_key_id));
}

/**
 * The most rows one read may return before it counts as possibly truncated.
 * PostgREST's `max_rows` is 1000 on this project, and a read at that ceiling
 * returns a silent partial list with no error (the failure
 * `getLatestExposureSnapshot`'s docblock records for the old full-window
 * scan). Every read below also asks for at most this many rows with an
 * explicit `.limit`, so the check does not depend on the server setting.
 */
export const HOLDINGS_ROW_CAP = 1000;

type ReadError = { message: string };

/**
 * The bounded read behind Open Positions. Three steps, in the shape of
 * `getLatestExposureSnapshot` (read the latest `asof` first, then the rows at
 * it) but at the per-key grain (D-16):
 *
 * 1. the owner's key ids (`api_keys.select("id")`, allowed by SEC-005). This
 *    is the whole key set the old read covered: every `allocator_holdings`
 *    row names one of the owner's `api_keys` rows (the FK, which refuses a
 *    key delete while holdings exist, and the
 *    `enforce_allocator_holdings_owner_coherence` trigger), and a departed
 *    key is soft-disconnected, so its row stays;
 * 2. per key, that key's latest `asof` (`order(asof desc).limit(1)`);
 * 3. per key, that key's rows at that `asof`.
 *
 * Steps 2 and 3 run in parallel across keys. There is no date window: a key
 * that has been quiet for a long time still shows its last poll, never flat.
 * Every read runs on the caller's user-scoped client under owner RLS and also
 * filters explicitly by `user_id` / `allocator_id`.
 *
 * Never throws. Returns `{ data, error }` so the caller's `assertOk` treats it
 * like any other Supabase result. Any step's error is returned as `error`. A
 * read that reaches `HOLDINGS_ROW_CAP` returns a named error instead of a
 * partial list. A key with no holdings contributes nothing.
 */
export async function fetchLatestHoldingsPerKey(
  supabase: SupabaseClient<Database>,
  userId: string,
  columns: string,
): Promise<{ data: unknown[] | null; error: ReadError | null }> {
  const keysRes = await supabase
    .from("api_keys")
    .select("id")
    .eq("user_id", userId)
    .limit(HOLDINGS_ROW_CAP);
  if (keysRes.error) return { data: null, error: keysRes.error };
  const keyIds = (keysRes.data ?? []).map((k) => k.id);
  if (keyIds.length >= HOLDINGS_ROW_CAP) {
    return {
      data: null,
      error: { message: "api_keys id read reached the row cap" },
    };
  }

  const perKey = await Promise.all(
    keyIds.map(
      async (
        keyId,
      ): Promise<{ rows: unknown[]; error: ReadError | null }> => {
        const latestRes = await supabase
          .from("allocator_holdings")
          .select("asof")
          .eq("allocator_id", userId)
          .eq("api_key_id", keyId)
          .order("asof", { ascending: false })
          .limit(1);
        if (latestRes.error) return { rows: [], error: latestRes.error };
        const latestAsof = latestRes.data?.[0]?.asof;
        if (!latestAsof) return { rows: [], error: null };

        const rowsRes = await supabase
          .from("allocator_holdings")
          .select(columns)
          .eq("allocator_id", userId)
          .eq("api_key_id", keyId)
          .eq("asof", latestAsof)
          .limit(HOLDINGS_ROW_CAP);
        if (rowsRes.error) return { rows: [], error: rowsRes.error };
        const rows = (rowsRes.data ?? []) as unknown[];
        if (rows.length >= HOLDINGS_ROW_CAP) {
          return {
            rows: [],
            error: {
              message: "allocator_holdings per-key read reached the row cap",
            },
          };
        }
        return { rows, error: null };
      },
    ),
  );

  const failed = perKey.find((k) => k.error !== null);
  if (failed) return { data: null, error: failed.error };
  return { data: perKey.flatMap((k) => k.rows), error: null };
}
