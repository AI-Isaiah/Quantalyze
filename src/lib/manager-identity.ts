import type { SupabaseClient } from "@supabase/supabase-js";
import type { ManagerIdentity } from "@/lib/types";

/**
 * Load a strategy's manager identity row via the admin client.
 *
 * Requires the admin-scoped client because `profiles.bio`, `years_trading`,
 * `aum_range` (migration 012) and `linkedin` (migration 017) have column
 * SELECT REVOKE'd from `anon` + `authenticated`. A user-scoped client
 * would come back missing the bio fields — or worse, silently return
 * null — which is why this helper exists as a thin, explicit admin-path
 * wrapper.
 *
 * Returns `null` on database error OR missing row so callers can render a
 * redacted "identity disclosed later" block without a try/catch. The error
 * is logged to the server console for observability.
 *
 * Used by the admin send-intro route and the self-serve intro route for
 * the institutional-tier email block. Not to be confused with the
 * redaction helper in `queries.ts` — that one takes a strategy + tier and
 * enforces the "only load for institutional-tier" predicate; this one is
 * the low-level fetch primitive both paths reuse.
 */
export async function loadManagerIdentity(
  admin: SupabaseClient,
  strategyUserId: string,
): Promise<ManagerIdentity | null> {
  const { data, error } = await admin
    .from("profiles")
    .select("display_name, company, bio, years_trading, aum_range, linkedin")
    .eq("id", strategyUserId)
    .maybeSingle();
  if (error) {
    console.error("[loadManagerIdentity]", error);
    return null;
  }
  if (!data) return null;
  return {
    display_name: data.display_name ?? null,
    company: data.company ?? null,
    bio: (data as { bio?: string | null }).bio ?? null,
    years_trading:
      (data as { years_trading?: number | null }).years_trading ?? null,
    aum_range: (data as { aum_range?: string | null }).aum_range ?? null,
    linkedin: (data as { linkedin?: string | null }).linkedin ?? null,
  };
}
