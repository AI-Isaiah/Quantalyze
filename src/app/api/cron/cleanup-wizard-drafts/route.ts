import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { safeCompare } from "@/lib/timing-safe-compare";

/**
 * Vercel Cron — daily (02:00 UTC). Deletes ABANDONED wizard-draft strategies
 * (`source='wizard' AND status='draft'`) and best-effort revokes their now-
 * orphaned API keys, in ONE atomic transaction via the
 * `cleanup_abandoned_wizard_drafts()` RPC (SECURITY DEFINER, migration
 * 20260713120000). The route is a thin auth gate + single-RPC dispatch +
 * response shaping; the DB owns the predicate and atomicity.
 *
 * Abandonment window = created_at < now() - 7 days (lives in the RPC, NOT here
 * — the old route-level day-count constant is gone). ⚠️ LOCKED
 * requirement-deviation (96-VALIDATION
 * decision 1): the requirement asked for 24h, but `strategies` has no
 * `updated_at`, so a 24h-on-`created_at` sweep would delete a draft a user
 * intends to RESUME on day 2 — colliding with Phase-94 wizard resumability.
 * 7d is realistically past abandonment while still preventing accumulation;
 * reversible (add `updated_at` + a moddatetime trigger and window on that for
 * stricter hygiene).
 *
 * M-0255: REJECTED wizard drafts (status='draft' but `review_note` set by the
 * admin reject path) are EXEMPT — their created_at is never reset, so sweeping
 * them would CASCADE-delete a row the user may still re-edit. The exemption
 * (`review_note IS NULL`) is now enforced INSIDE the RPC.
 *
 * Race safety (CLEAN-01): the sweep is a single guarded DELETE re-checking
 * `status='draft'`. finalize (`finalize_wizard_strategy`) promotes
 * draft→pending_review via a committed guarded UPDATE under `SELECT … FOR
 * UPDATE` (verified in 96-01) — READ-COMMITTED EvalPlanQual serializes the two
 * on the row lock, so no torn state. Residual "cron wins → finalize 404s
 * (GATE_DRAFT_GONE)" is clean/recoverable.
 *
 * Response is monitor-stable: `{deleted, orphaned_keys_revoked,
 * key_sweep_errors}`. `key_sweep_errors` is now CONSTANTLY 0 — the sweep is
 * one transaction, so a partial failure is impossible: any failure fails the
 * WHOLE call → a plain 500, which Vercel Cron treats as FAILED and alerts on
 * (preserving H-1251's loud-degradation intent without the old per-key
 * machinery). The key is kept in the shape so monitors read it uniformly.
 *
 * Schedule weekly→daily: with a 7d window a weekly cadence leaves drafts alive
 * 7-14 days; daily keeps effective lifetime 7-8 days. Planner discretion (NOT
 * a locked decision), trivially reversible — see `vercel.json`
 * (`/api/cron/cleanup-wizard-drafts`, `0 2 * * *`).
 *
 * Auth: Bearer ${CRON_SECRET}, timing-safe — mirrors cleanup-ack-tokens.
 * Vercel Cron dispatches GET; POST accepted for manual incident response.
 *
 * @audit-skip: cron garbage collection, no user attribution. The user-driven
 * /api/strategies/draft/[id] DELETE handler emits an audit event for
 * user-initiated cleanup; this sweep collects drafts the user never returned
 * to finish, and the deletion happens inside the SECURITY DEFINER RPC.
 */

export const dynamic = "force-dynamic";

// Soft sanity threshold (observability only, NOT a hard cap): a single cron run
// deleting more than this many drafts is almost certainly a runaway first-run and
// must be loud in the logs. A hard cap mid-sweep would break the RPC's single-
// transaction atomicity, so this only escalates the log level — behavior is
// unchanged (the route still returns 200 with the counts).
const CLEANUP_SANITY_WARN_THRESHOLD = 500;

async function handle(req: NextRequest): Promise<NextResponse> {
  const auth = req.headers.get("authorization") ?? "";
  const expected = `Bearer ${process.env.CRON_SECRET}`;
  if (!process.env.CRON_SECRET || !safeCompare(auth, expected)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = createAdminClient();

  // One atomic transaction owns the whole job (draft sweep + scoped orphaned-
  // key revoke). RETURNS TABLE(deleted_drafts int, swept_keys int) → supabase-js
  // hands back `data` as an array of one row.
  const { data, error } = await admin.rpc("cleanup_abandoned_wizard_drafts");

  if (error) {
    console.error(
      "[cron/cleanup-wizard-drafts] cleanup RPC failed:",
      error,
    );
    // Generic envelope — keep the raw PostgREST message in the log, not the
    // response body (it can carry SQL state / table / constraint names).
    return NextResponse.json(
      { error: "Cron cleanup failed" },
      { status: 500 },
    );
  }

  const row = (Array.isArray(data) ? data[0] : data) as
    | { deleted_drafts?: number; swept_keys?: number }
    | null
    | undefined;

  const deleted = row?.deleted_drafts ?? 0;
  const orphanedKeysRevoked = row?.swept_keys ?? 0;

  // Observability for a DESTRUCTIVE cron: Vercel Cron only alerts on non-2xx, so a
  // large SUCCESSFUL deletion would otherwise be invisible. Always log the
  // magnitude on success so the first real destructive run is auditable.
  console.info(
    `[cron/cleanup-wizard-drafts] deleted=${deleted} orphaned_keys_revoked=${orphanedKeysRevoked}`,
  );
  // Soft sanity warning (NOT a hard cap — see CLEANUP_SANITY_WARN_THRESHOLD):
  // escalate to WARN so a runaway sweep is loud without altering behavior.
  if (deleted > CLEANUP_SANITY_WARN_THRESHOLD) {
    console.warn(
      `[cron/cleanup-wizard-drafts] unexpectedly large cleanup: deleted=${deleted} exceeds sanity threshold ${CLEANUP_SANITY_WARN_THRESHOLD} — verify this is not a runaway sweep`,
    );
  }

  return NextResponse.json({
    deleted,
    orphaned_keys_revoked: orphanedKeysRevoked,
    // Constant 0: a partial sweep is structurally impossible (one transaction);
    // any failure short-circuits above to a 500. Kept for monitor-shape
    // continuity across clean runs.
    key_sweep_errors: 0,
  });
}

export const GET = handle;
export const POST = handle;
