import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/lib/database.types";
import { captureToSentry } from "@/lib/sentry-capture";
import type { TrustTierKind } from "./types";

/**
 * Phase 237 / FACT-04 — the owner's own data source on an UNPUBLISHED factsheet.
 *
 * `get_published_trust_signals` is published-gated at the database, so it answers
 * nothing for a draft and the owner read "Data source —" on their own key-backed
 * strategy. Decision (237-CONTEXT, FACT-04): on the OWNER LANE of
 * `/factsheet/[id]/v2` only, read the latest `strategy_verifications` row with the
 * request's user-scoped client. The existing `strategy_verifications_owner_select`
 * RLS policy is the ownership check, so a caller who does not own the strategy
 * gets zero rows even if this function were called for them. The published-signal
 * RPC is NOT widened, and an anonymous or non-owner reader still gets nothing for
 * an unpublished strategy.
 *
 * ⛔ The client is the REQUEST client, never the service-role admin client: an
 * admin read would bypass the policy that makes this safe.
 *
 * ⛔ The select is exactly `trust_tier, created_at`. The table also carries
 * `encrypted_credentials` and `public_token`; neither is ever projected.
 *
 * ⛔ The result is a per-request overlay (`withTrustTier`), never an input to
 * `buildFactsheetPayloadCached`, its key or its stored payload.
 *
 * Fail-soft, like `readPublicVerificationSignals`: a failed read is `null` (the
 * page shows "Data source —"), logged to the console first and then sent to
 * Sentry with a stage tag and no row content. It never throws.
 */

const TRUST_TIER_LITERALS: readonly TrustTierKind[] = [
  "api_verified",
  "csv_uploaded",
  "self_reported",
];

function asTrustTier(value: unknown): TrustTierKind | null {
  return TRUST_TIER_LITERALS.find((literal) => literal === value) ?? null;
}

export async function readOwnerTrustTier(
  client: SupabaseClient<Database>,
  strategyId: string,
): Promise<TrustTierKind | null> {
  try {
    // Newest first, one row: the same order get_published_trust_signals uses
    // (DISTINCT ON strategy_id ... ORDER BY created_at DESC).
    const { data, error } = await client
      .from("strategy_verifications")
      .select("trust_tier, created_at")
      .eq("strategy_id", strategyId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) {
      console.error("[readOwnerTrustTier] strategy_verifications read failed", {
        strategyId,
        code: error.code,
        message: error.message,
      });
      captureToSentry(error, {
        tags: { route: "factsheet/v2/page", stage: "owner-trust-tier" },
      });
      return null;
    }
    return asTrustTier(data?.trust_tier);
  } catch (err) {
    console.error("[readOwnerTrustTier] strategy_verifications read threw", {
      strategyId,
      message: err instanceof Error ? err.message : String(err),
    });
    captureToSentry(err, {
      tags: { route: "factsheet/v2/page", stage: "owner-trust-tier" },
    });
    return null;
  }
}
