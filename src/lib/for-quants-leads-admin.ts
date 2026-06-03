import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { WizardStepKey } from "@/lib/wizard/localStorage";

/**
 * Server-role chokepoint for `for_quants_leads`. Migration 030 made
 * service-role the only access path; a static regression test
 * (`for-quants-leads-projection.test.ts`) enforces that every file
 * touching the table imports `createAdminClient` directly. Keeping
 * the table access here lets pages and routes stay user-scoped.
 */

/**
 * `step` is the canonical WizardStepKey union — same source of truth
 * as the route's `WIZARD_STEP_KEYS as const satisfies readonly
 * WizardStepKey[]` enum (G9.B.4) and RequestCallModal's
 * `RequestCallWizardContext.step: WizardStepKey` prop type (G9.B.18).
 * Importing rather than re-listing prevents the admin/reader
 * projection from drifting out of sync with what the route accepts —
 * the same class of bug G9.B.4 fixed at the API boundary.
 */
export type WizardContext = {
  draft_strategy_id?: string | null;
  step?: WizardStepKey;
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
  /** audit-2026-05-07 G9.B.7 / migration 115 — set when after()
   *  begins the founder-notify path. NULL pre-attempt or for legacy
   *  rows. */
  notify_attempted_at: string | null;
  /** Set when notifyFounderGeneric returned without throwing. NULL
   *  while the send is in flight, the helper threw, or ADMIN_EMAIL
   *  was unset. Pair-with-attempted indicates a clean send. */
  notify_succeeded_at: string | null;
  /** Sanitized error message (max 500 chars) when the send failed
   *  OR ADMIN_EMAIL was unset. NULL on clean sends. */
  notify_error: string | null;
}

/** Hard cap on the `?show=all` view so a growing table doesn't ship
 *  a huge payload to the admin page. The unprocessed-only view is
 *  unbounded because it should never grow past ~10 rows in practice. */
export const FOR_QUANTS_LEADS_FULL_VIEW_CAP = 500;

const LEAD_SELECT =
  "id, name, firm, email, preferred_time, notes, wizard_context, created_at, processed_at, processed_by, notify_attempted_at, notify_succeeded_at, notify_error";

export interface ListForQuantsLeadsResult {
  rows: ForQuantsLeadRow[];
  /** True only when the full-history view was served and the cap
   *  was actually hit — so the UI can surface the truncation note. */
  hitCap: boolean;
  /** Set when the underlying query failed. Callers MUST distinguish
   *  this from `rows.length === 0` so the admin UI can render an
   *  error banner instead of the misleading "All caught up" empty
   *  state. audit-2026-05-07 G10.D.1. */
  error?: string;
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
    // M-0519: over-fetch by one. With `.limit(CAP)` the result length can never
    // exceed CAP, so `rows.length >= CAP` (below) was equivalent to `=== CAP` —
    // a table holding EXACTLY 500 leads (none older) wrongly showed the "older
    // leads exist" banner. Fetching CAP+1 lets the extra row PROVE truncation;
    // we trim back to CAP before returning.
    query = query.limit(FOR_QUANTS_LEADS_FULL_VIEW_CAP + 1);
  } else {
    query = query.is("processed_at", null);
  }

  const { data, error } = await query;
  if (error) {
    // audit-2026-05-07 G10.D.1: surface the error to the caller so the
    // admin page renders "Could not load leads" instead of conflating
    // RLS / network / 5xx failures with "All caught up. No unprocessed
    // leads." The founder uses this page as a notification queue —
    // misclassifying a query error as "nothing to do" silently drops
    // real lead follow-ups.
    console.error("[for-quants-leads-admin] list query failed:", error);
    return {
      rows: [],
      hitCap: false,
      error: error.message ?? "Failed to load for-quants leads.",
    };
  }
  // M-0519: the (CAP+1)th row is the truncation proof; trim it off the returned
  // rows so the cap contract (≤ CAP rows) holds, and report hitCap iff it was
  // actually present.
  const fetched = (data as ForQuantsLeadRow[] | null) ?? [];
  const hitCap = showAll && fetched.length > FOR_QUANTS_LEADS_FULL_VIEW_CAP;
  const rows = hitCap
    ? fetched.slice(0, FOR_QUANTS_LEADS_FULL_VIEW_CAP)
    : fetched;
  return { rows, hitCap };
}

export type SetLeadProcessedResult =
  | { ok: true }
  | { ok: false; reason: "not_found" | "db_error" };

// Filters on the opposite state so double-clicks are idempotent and
// the returned row count distinguishes real toggles from no-ops.
//
// Operator triage clears `notify_error` because the operator has now
// acknowledged the underlying state (the lead is being followed up on
// out-of-band). Without the clear, a row that's later flipped back to
// unprocessed via unmarkLeadProcessed would re-render the historical
// "Founder notify failed: <stale message>" badge with no temporal
// context — the operator would see a fresh-looking error for an issue
// resolved hours ago. Red-team specialist regression.
export async function markLeadProcessed(
  id: string,
  client?: SupabaseClient,
): Promise<SetLeadProcessedResult> {
  const admin = client ?? createAdminClient();
  const { data, error } = await admin
    .from("for_quants_leads")
    .update({
      processed_at: new Date().toISOString(),
      notify_error: null,
    })
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

/**
 * M-0269: distinguishes "row already in the requested state" from "row
 * genuinely missing". The conditional UPDATE in mark/unmarkLeadProcessed
 * filters on `processed_at`, so a no-op toggle matches 0 rows == not_found,
 * indistinguishable from a missing row. The process route uses this to return
 * an idempotent 200 for the already-in-state case instead of a spurious 404
 * to a retried/double-submitted POST. Access stays in this service-role
 * chokepoint so the Migration 030 discipline (every for_quants_leads call site
 * goes through createAdminClient) holds — the route never touches the table.
 */
export async function leadExists(
  id: string,
  client?: SupabaseClient,
): Promise<boolean> {
  const admin = client ?? createAdminClient();
  const { data, error } = await admin
    .from("for_quants_leads")
    .select("id")
    .eq("id", id)
    .maybeSingle();
  if (error) {
    console.error("[for-quants-leads-admin] existence check failed:", error);
    // Fail closed: treat an errored existence probe as "missing" so the route
    // returns 404 rather than a misleading idempotent-success 200.
    return false;
  }
  return data !== null;
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
