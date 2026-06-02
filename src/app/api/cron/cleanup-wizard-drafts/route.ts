import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { safeCompare } from "@/lib/timing-safe-compare";

/**
 * Vercel Cron — weekly (Sundays 02:00 UTC), deletes wizard-draft
 * strategies (`source='wizard' AND status='draft'`) whose `created_at`
 * is older than 30 days. The user has clearly abandoned the wizard.
 *
 * Why the policy: a wizard draft is a `strategies` row in the
 * draft → pending_review pipeline (migration 031). Without a sweep,
 * abandoned drafts accumulate forever and pollute both the user's
 * "Resume draft" UI and the admin queue. 30 days is conservative —
 * typical wizard sessions complete in under an hour.
 *
 * Cascade: ON DELETE CASCADE on strategy_analytics + trades wipes
 * downstream rows automatically. Linked `api_keys` rows are best-effort
 * revoked only when no other strategy still references them — same
 * logic the user-driven `/api/strategies/draft/[id]` DELETE handler
 * uses.
 *
 * Auth: Bearer ${CRON_SECRET}, timing-safe — mirrors cleanup-ack-tokens.
 * Vercel Cron dispatches GET; POST accepted for manual incident response.
 *
 * Schedule + secret: see `vercel.json`
 * (`/api/cron/cleanup-wizard-drafts`).
 */

export const dynamic = "force-dynamic";

const ABANDON_DAYS = 30;

async function handle(req: NextRequest): Promise<NextResponse> {
  const auth = req.headers.get("authorization") ?? "";
  const expected = `Bearer ${process.env.CRON_SECRET}`;
  if (!process.env.CRON_SECRET || !safeCompare(auth, expected)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = createAdminClient();
  const cutoff = new Date(
    Date.now() - ABANDON_DAYS * 24 * 60 * 60 * 1000,
  ).toISOString();

  // Find abandoned wizard drafts. Capture api_key_id so we can
  // best-effort clean orphaned keys after the cascade fires.
  const { data: drafts, error: selectError } = await admin
    .from("strategies")
    .select("id, api_key_id")
    .eq("source", "wizard")
    .eq("status", "draft")
    .lt("created_at", cutoff);

  if (selectError) {
    console.error("[cron/cleanup-wizard-drafts] select failed:", selectError);
    // Generic envelope — keep the raw PostgREST message in the log, not the
    // response body (it can carry SQL state / table / constraint names).
    return NextResponse.json({ error: "Cron select failed" }, { status: 500 });
  }

  const draftRows = drafts ?? [];
  if (draftRows.length === 0) {
    // Keep the success shape consistent across every clean run so a monitor
    // can read key_sweep_errors uniformly (a clean drafts-present run also
    // returns key_sweep_errors:0).
    return NextResponse.json({
      deleted: 0,
      orphaned_keys_revoked: 0,
      key_sweep_errors: 0,
    });
  }

  const draftIds = draftRows.map((d) => d.id);

  // Hard-delete the wizard-draft rows. ON DELETE CASCADE handles
  // strategy_analytics + trades. Re-apply the source/status filter as a
  // belt-and-suspenders TOCTOU guard — between the select above and now,
  // a row could have flipped to pending_review.
  // @audit-skip: cron garbage collection, no user attribution. The
  // user-driven /api/strategies/draft/[id] DELETE handler emits an
  // audit event for user-initiated cleanup; this sweep handles drafts
  // the user never returned to finish.
  const { error: delError, count: deletedCount } = await admin
    .from("strategies")
    .delete({ count: "exact" })
    .in("id", draftIds)
    .eq("source", "wizard")
    .eq("status", "draft");

  if (delError) {
    console.error("[cron/cleanup-wizard-drafts] delete failed:", delError);
    return NextResponse.json({ error: "Cron delete failed" }, { status: 500 });
  }

  // Best-effort revoke orphaned api_keys — only when no strategy still
  // references the key. Mirrors the user-driven DELETE handler so a
  // shared key isn't accidentally yanked from a different live strategy.
  let orphanedKeysRevoked = 0;
  // Track per-key sweep failures so a partially-failed run can't masquerade
  // as a clean one. Without this, a 200 `{orphaned_keys_revoked: N}` is
  // indistinguishable from "M other keys were kept because still-referenced"
  // vs. "M keys FAILED to revoke and orphan rows now point at deleted
  // strategies" (H-1251). Mirrors the sibling cron `errors[]` convention.
  const sweepErrors: string[] = [];
  const apiKeyIds = Array.from(
    new Set(
      draftRows
        .map((d) => d.api_key_id)
        .filter((k): k is string => typeof k === "string" && k.length > 0),
    ),
  );

  for (const keyId of apiKeyIds) {
    // M-0347: atomic check+delete via the shared delete_api_key_if_unreferenced
    // RPC. As service_role the auth.uid()-IS-NULL arm lets the cron revoke ANY
    // unreferenced key, and the NOT EXISTS makes the reference check + delete a
    // single statement — closing the prior two-step "count then delete" TOCTOU
    // where a wizard re-attaching the key mid-sweep got its strategy yanked.
    // The RPC returns rows deleted (0 = still referenced, kept; 1 = revoked).
    // @audit-skip: cron garbage collection, no user attribution.
    const { data: revoked, error: keyErr } = await admin.rpc(
      "delete_api_key_if_unreferenced",
      { p_api_key_id: keyId },
    );
    if (keyErr) {
      // A failed revoke means an orphan may have been left pointing at the
      // strategies we just deleted — real integrity drift, not a no-op. Surface
      // it loudly so the run reports degraded (M-1144/M-1145/H-1251).
      console.error(
        `[cron/cleanup-wizard-drafts] atomic key revoke failed for key=${keyId} (orphan NOT revoked):`,
        keyErr,
      );
      sweepErrors.push(`${keyId}: revoke failed: ${keyErr.message}`);
      continue;
    }
    // revoked === 0 → key is still referenced by a live strategy, correctly
    // kept (no error, no increment); revoked > 0 → orphan successfully swept.
    if ((revoked ?? 0) > 0) orphanedKeysRevoked += 1;
  }

  // H-1251: when any orphan-sweep step errored, the run is degraded — orphan
  // api_keys rows may have been left pointing at deleted strategies. Return a
  // non-2xx (500) so Vercel Cron treats the run as FAILED and alerts: a 207
  // Multi-Status is still in the 2xx family, so Vercel would key it as success
  // and bury the partial failure. (The per-key console.error above also names
  // each failing key.) A retried run early-returns once the drafts are gone, so
  // this is alert-only, not auto-heal — surfacing the orphan is the point.
  return NextResponse.json(
    {
      deleted: deletedCount ?? draftIds.length,
      orphaned_keys_revoked: orphanedKeysRevoked,
      key_sweep_errors: sweepErrors.length,
      ...(sweepErrors.length > 0 ? { errors: sweepErrors.slice(0, 5) } : {}),
    },
    { status: sweepErrors.length > 0 ? 500 : 200 },
  );
}

export const GET = handle;
export const POST = handle;
