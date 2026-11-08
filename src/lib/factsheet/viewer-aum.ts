import type { SupabaseClient } from "@supabase/supabase-js";
import { getUserRolesResult } from "@/lib/auth";
import type { FactsheetPayload } from "@/lib/factsheet/types";

/**
 * 194 D-06 / D-22: AUM is shown ONLY to a signed-in allocator or to the strategy's own
 * manager. This is the one rule behind the tearsheet's AUM row, the v2 factsheet's AUM chip
 * and the factsheet JSON-LD `feesAndCommissionsSpecification`.
 *
 * `viewerId` is the server-validated id from `supabase.auth.getUser()` (never `getSession()`,
 * never client input); null for an anonymous viewer. `strategyOwnerId` is the id on the
 * server-read strategy row. Fail closed: an anonymous viewer, a failed roles read and any
 * throw all answer false.
 *
 * The answer is PER VIEWER, so callers must apply it at render time, never to a payload the
 * shared id-keyed cache serves.
 */
export async function canViewAum(
  supabase: SupabaseClient,
  viewerId: string | null,
  strategyOwnerId: string | null | undefined,
  logTag = "[aum]",
): Promise<boolean> {
  if (viewerId == null) return false;
  try {
    if (strategyOwnerId != null && viewerId === strategyOwnerId) return true;
    const roles = await getUserRolesResult(supabase, viewerId);
    if (roles.ok) return roles.roles.includes("allocator");
    console.error(`${logTag} aum gate failed:`, roles.error);
    return false;
  } catch (err) {
    console.error(`${logTag} aum gate failed:`, err);
    return false;
  }
}

/**
 * 194 D-22 (security review): hiding the chip is not enough, because the payload object is
 * serialised into the page for the client component. A viewer who may not see AUM gets a
 * per-request COPY with `aum` and `maxCapacity` nulled (the USD view's payload too); the
 * cached object is never mutated.
 */
export function withViewerAum(payload: FactsheetPayload, showAum: boolean): FactsheetPayload {
  if (showAum) return payload;
  const strip = (p: FactsheetPayload): FactsheetPayload => ({ ...p, aum: null, maxCapacity: null });
  if (!payload.usdView) return strip(payload);
  return { ...strip(payload), usdView: { ...payload.usdView, payload: strip(payload.usdView.payload) } };
}
