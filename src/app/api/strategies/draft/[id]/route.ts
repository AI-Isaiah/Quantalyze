import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { assertSameOrigin } from "@/lib/csrf";
import { assertProfileApproved } from "@/lib/api/approval-gate";
import { userActionLimiter, checkLimit, isRateLimitMisconfigured } from "@/lib/ratelimit";
import { captureToSentry } from "@/lib/sentry-capture";
import { logAuditEvent } from "@/lib/audit";
import { NO_STORE_HEADERS } from "@/lib/api/headers";

/**
 * GET  /api/strategies/draft/[id] — fetch a specific wizard draft for
 *                                   resume. Verifies ownership and that
 *                                   the row is still a wizard draft.
 *
 * DELETE /api/strategies/draft/[id] — user-initiated "Delete draft" from
 *                                     the wizard chrome. Hard-deletes the
 *                                     strategies row and the linked
 *                                     api_keys row. Cascade handles
 *                                     strategy_analytics + trades.
 *
 * Auth inlined here (not via withAuth) so we can read the dynamic `id`
 * param from the second handler argument. withAuth's forwarded shape
 * does not include the Next.js App Router ctx.
 */

interface RouteContext {
  params: Promise<{ id: string }>;
}

async function getAuthedUserIdOrError(
  req: NextRequest,
): Promise<{ userId: string } | NextResponse> {
  if (req.method !== "GET" && req.method !== "HEAD") {
    const csrfError = assertSameOrigin(req);
    if (csrfError) return csrfError;
  }
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: NO_STORE_HEADERS });
  }
  // Approval gate (PR #266 follow-up): wizard drafts belong to the
  // post-approval flow; pre-approval users cannot create or mutate one.
  const denied = await assertProfileApproved(supabase, user.id);
  if (denied) return denied;
  return { userId: user.id };
}

export async function GET(req: NextRequest, ctx: RouteContext) {
  const authResult = await getAuthedUserIdOrError(req);
  if (authResult instanceof NextResponse) return authResult;
  const userId = authResult.userId;

  const { id } = await ctx.params;
  if (!id || typeof id !== "string") {
    return NextResponse.json({ error: "id required" }, { status: 400, headers: NO_STORE_HEADERS });
  }

  // audit-2026-05-07 H-0253 follow-up (PR-2 2026-05-28): per-surface key.
  // Was `strategies-draft-get:${userId}`, shared with the list GET in the
  // sibling /strategies/draft/route.ts. Split to :by-id.
  // B15 (2026-05-30): consume the limiter AFTER input validation so a
  // malformed request rejected with 400 above never burns a token.
  const rl = await checkLimit(userActionLimiter, `strategies-draft-get-by-id:${userId}`);
  if (!rl.success) {
    if (isRateLimitMisconfigured(rl)) {
      return NextResponse.json(
        { error: "Rate limiter unavailable" },
        { status: 503, headers: { ...NO_STORE_HEADERS, "Retry-After": String(rl.retryAfter) } },
      );
    }
    return NextResponse.json(
      { error: "Too many requests" },
      { status: 429, headers: { ...NO_STORE_HEADERS, "Retry-After": String(rl.retryAfter) } },
    );
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("strategies")
    .select(
      "id, user_id, source, status, name, description, category_id, strategy_types, subtypes, markets, supported_exchanges, leverage_range, aum, max_capacity, api_key_id, created_at",
    )
    .eq("id", id)
    .eq("user_id", userId)
    .maybeSingle();

  // PR-2 silent-failure-hunter F8 (2026-05-28): pre-fix collapsed a
  // transient Postgres error (network blip, RLS regression, connection
  // pool exhaustion) into the same 404 "Draft not found" returned for
  // genuinely-missing rows. A user who owned the draft would see 404,
  // retry, get 404 again, abandon. Split the two cases + Sentry capture
  // so the failure mode is observable.
  if (error) {
    console.error("[strategies/draft:GET by id] query error:", error.message);
    captureToSentry(error, {
      tags: { area: "strategies-draft-get-by-id", code: error.code },
      extra: { user_id: userId, draft_id: id },
      level: "error",
    });
    return NextResponse.json(
      { error: "draft_lookup_failed" },
      { status: 500, headers: NO_STORE_HEADERS },
    );
  }
  if (!data) {
    return NextResponse.json({ error: "Draft not found" }, { status: 404, headers: NO_STORE_HEADERS });
  }

  if (data.source !== "wizard" || data.status !== "draft") {
    return NextResponse.json({ error: "Not a wizard draft" }, { status: 404, headers: NO_STORE_HEADERS });
  }

  return NextResponse.json({ draft: data }, { headers: NO_STORE_HEADERS });
}

export async function DELETE(req: NextRequest, ctx: RouteContext) {
  const authResult = await getAuthedUserIdOrError(req);
  if (authResult instanceof NextResponse) return authResult;
  const userId = authResult.userId;

  const { id } = await ctx.params;
  if (!id || typeof id !== "string") {
    return NextResponse.json({ error: "id required" }, { status: 400, headers: NO_STORE_HEADERS });
  }

  // B15 (2026-05-30): consume the limiter AFTER input validation so a
  // malformed request rejected with 400 above never burns a token.
  const rl = await checkLimit(
    userActionLimiter,
    `strategies-draft-delete:${userId}`,
  );
  if (!rl.success) {
    if (isRateLimitMisconfigured(rl)) {
      return NextResponse.json(
        { error: "Rate limiter unavailable" },
        { status: 503, headers: { ...NO_STORE_HEADERS, "Retry-After": String(rl.retryAfter) } },
      );
    }
    return NextResponse.json(
      { error: "Too many requests" },
      { status: 429, headers: { ...NO_STORE_HEADERS, "Retry-After": String(rl.retryAfter) } },
    );
  }

  const supabase = await createClient();

  // Verify it is a wizard draft owned by this user before deleting.
  // The .eq("source", "wizard").eq("status", "draft") combo is the
  // guardrail that prevents a misfire on a published strategy.
  const { data: draft } = await supabase
    .from("strategies")
    .select("id, api_key_id, source, status")
    .eq("id", id)
    .eq("user_id", userId)
    .eq("source", "wizard")
    .eq("status", "draft")
    .maybeSingle();

  if (!draft) {
    return NextResponse.json({ error: "Draft not found" }, { status: 404, headers: NO_STORE_HEADERS });
  }

  // Delete the strategies row. Re-apply the source + status filter so a
  // TOCTOU race (e.g., the draft flipped to pending_review between the
  // preflight and now) leaves the row intact rather than silently
  // clobbering a promoted strategy. ON DELETE CASCADE on strategy_analytics
  // + trades wipes the downstream rows automatically (see the initial
  // schema migration's strategies FK definitions) — same cascade the
  // cron/cleanup-wizard-drafts sweep relies on.
  const { error: delStrategyErr } = await supabase
    .from("strategies")
    .delete()
    .eq("id", id)
    .eq("user_id", userId)
    .eq("source", "wizard")
    .eq("status", "draft");
  if (delStrategyErr) {
    console.error(
      "[strategies/draft DELETE] strategies delete error:",
      delStrategyErr,
    );
    return NextResponse.json(
      { error: "Failed to delete draft" },
      { status: 500, headers: NO_STORE_HEADERS },
    );
  }

  // Sprint 6 Task 7.1b — audit the wizard-draft deletion. Even though
  // the row is gone, the audit trail pins the acting user + draft id
  // for forensic reconstruction.
  logAuditEvent(supabase, {
    action: "strategy.delete",
    entity_type: "strategy",
    entity_id: id,
    metadata: { source: "wizard", status_before_delete: "draft" },
  });

  // Hard-delete the linked api_keys row ONLY if no other strategy still
  // references it. Otherwise the FK's ON DELETE SET NULL would silently break
  // another strategy that happened to share the same key.
  if (draft.api_key_id) {
    const keyToRevoke = draft.api_key_id;
    // M-0347: the check + delete is ONE atomic statement inside the
    // delete_api_key_if_unreferenced RPC:
    //   DELETE FROM api_keys WHERE id=$1 AND user_id=auth.uid()
    //     AND NOT EXISTS (SELECT 1 FROM strategies WHERE api_key_id=$1)
    // The prior two-statement "SELECT count(*) ... then conditional DELETE"
    // had a TOCTOU window: a concurrent wizard session re-attaching this key
    // between the count and the delete got its fresh strategy's key revoked.
    // The RPC returns the number of rows it deleted (0 = still referenced or
    // not owned; 1 = revoked).
    const { data: revoked, error: revokeErr } = await supabase.rpc(
      "delete_api_key_if_unreferenced",
      { p_api_key_id: keyToRevoke },
    );
    // H-0314: never treat an RPC failure as "orphaned → safe to ignore". The
    // strategy row is already deleted above; a dangling api_key is swept later
    // by cron/cleanup-wizard-drafts. Skip + log, never risk breaking a sibling.
    if (revokeErr) {
      console.warn(
        "[strategies/draft DELETE] api_keys atomic revoke failed (skip cleanup):",
        revokeErr,
      );
    } else if ((revoked ?? 0) > 0) {
      // Audit only when a key was ACTUALLY revoked (zero referencing strategies
      // inside the same atomic statement). A 0 return means the key is still
      // referenced by another strategy — correctly preserved, nothing to audit.
      logAuditEvent(supabase, {
        action: "api_key.revoke",
        entity_type: "api_key",
        entity_id: keyToRevoke,
        metadata: { reason: "wizard_draft_cleanup", strategy_id: id },
      });
    }
  }

  return NextResponse.json({ deleted: true }, { headers: NO_STORE_HEADERS });
}
