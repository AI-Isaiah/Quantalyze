import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Server-role chokepoint for `for_quants_leads`. Migration 030 made
 * service-role the only access path; a static regression test
 * (`for-quants-leads-projection.test.ts`) enforces that every file
 * touching the table imports `createAdminClient` directly. Keeping
 * the table access here lets pages and routes stay user-scoped.
 */

export type WizardContext = {
  draft_strategy_id?: string | null;
  step?: "connect_key" | "sync_preview" | "metadata" | "submit";
  wizard_session_id?: string;
} | null;

export interface ForQuantsLeadRow {
  id: string;
  name: string;
  firm: string;
  email: string;
  preferred_time: string | null;
  notes: string | null;
  wizard_context: WizardContext;
  created_at: string;
  processed_at: string | null;
  processed_by: string | null;
}

/** Hard cap on the `?show=all` view so a growing table doesn't ship
 *  a huge payload to the admin page. The unprocessed-only view is
 *  unbounded because it should never grow past ~10 rows in practice. */
export const FOR_QUANTS_LEADS_FULL_VIEW_CAP = 500;

const LEAD_SELECT =
  "id, name, firm, email, preferred_time, notes, wizard_context, created_at, processed_at, processed_by";

export interface ListForQuantsLeadsResult {
  rows: ForQuantsLeadRow[];
  /** True only when the full-history view was served and the cap
   *  was actually hit — so the UI can surface the truncation note. */
  hitCap: boolean;
}

export async function listForQuantsLeads({
  showAll,
  client,
}: {
  showAll: boolean;
  /** Optional injected client for unit tests. Production callers omit
   *  this and the helper builds its own admin client. */
  client?: SupabaseClient;
}): Promise<ListForQuantsLeadsResult> {
  const admin = client ?? createAdminClient();
  let query = admin
    .from("for_quants_leads")
    .select(LEAD_SELECT)
    .order("created_at", { ascending: false });

  if (showAll) {
    query = query.limit(FOR_QUANTS_LEADS_FULL_VIEW_CAP);
  } else {
    query = query.is("processed_at", null);
  }

  const { data, error } = await query;
  if (error) {
    console.error("[for-quants-leads-admin] list query failed:", error);
    return { rows: [], hitCap: false };
  }
  const rows = (data as ForQuantsLeadRow[] | null) ?? [];
  return {
    rows,
    hitCap: showAll && rows.length >= FOR_QUANTS_LEADS_FULL_VIEW_CAP,
  };
}

export type SetLeadProcessedResult =
  | { ok: true }
  | { ok: false; reason: "not_found" | "db_error" };

// Filters on the opposite state so double-clicks are idempotent and
// the returned row count distinguishes real toggles from no-ops.
export async function markLeadProcessed(
  id: string,
  client?: SupabaseClient,
): Promise<SetLeadProcessedResult> {
  const admin = client ?? createAdminClient();
  const { data, error } = await admin
    .from("for_quants_leads")
    .update({ processed_at: new Date().toISOString() })
    .eq("id", id)
    .is("processed_at", null)
    .select("id");
  return toResult(data, error);
}

export async function unmarkLeadProcessed(
  id: string,
  client?: SupabaseClient,
): Promise<SetLeadProcessedResult> {
  const admin = client ?? createAdminClient();
  const { data, error } = await admin
    .from("for_quants_leads")
    .update({ processed_at: null })
    .eq("id", id)
    .not("processed_at", "is", null)
    .select("id");
  return toResult(data, error);
}

function toResult(
  data: { id: string }[] | null,
  error: { message: string } | null,
): SetLeadProcessedResult {
  if (error) {
    console.error("[for-quants-leads-admin] update failed:", error);
    return { ok: false, reason: "db_error" };
  }
  if (!data || data.length === 0) {
    return { ok: false, reason: "not_found" };
  }
  return { ok: true };
}
