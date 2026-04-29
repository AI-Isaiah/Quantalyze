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
    return NextResponse.json({ error: selectError.message }, { status: 500 });
  }

  const draftRows = drafts ?? [];
  if (draftRows.length === 0) {
    return NextResponse.json({ deleted: 0, orphaned_keys_revoked: 0 });
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
    return NextResponse.json({ error: delError.message }, { status: 500 });
  }

  // Best-effort revoke orphaned api_keys — only when no strategy still
  // references the key. Mirrors the user-driven DELETE handler so a
  // shared key isn't accidentally yanked from a different live strategy.
  let orphanedKeysRevoked = 0;
  const apiKeyIds = Array.from(
    new Set(
      draftRows
        .map((d) => d.api_key_id)
        .filter((k): k is string => typeof k === "string" && k.length > 0),
    ),
  );

  for (const keyId of apiKeyIds) {
    const { count: refCount, error: countErr } = await admin
      .from("strategies")
      .select("id", { count: "exact", head: true })
      .eq("api_key_id", keyId);
    if (countErr) {
      console.warn(
        "[cron/cleanup-wizard-drafts] count check failed (skip):",
        countErr,
      );
      continue;
    }
    if ((refCount ?? 0) > 0) continue;

    // @audit-skip: cron garbage collection, no user attribution. Deletes
    // api_keys rows whose only references were wizard drafts that just
    // got auto-cleaned by this same sweep — the keys are now orphaned.
    const { error: keyErr } = await admin
      .from("api_keys")
      .delete()
      .eq("id", keyId);
    if (keyErr) {
      console.warn(
        "[cron/cleanup-wizard-drafts] api_key delete failed (non-fatal):",
        keyErr,
      );
      continue;
    }
    orphanedKeysRevoked += 1;
  }

  return NextResponse.json({
    deleted: deletedCount ?? draftIds.length,
    orphaned_keys_revoked: orphanedKeysRevoked,
  });
}

export const GET = handle;
export const POST = handle;
