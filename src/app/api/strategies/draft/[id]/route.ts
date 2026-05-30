import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { assertSameOrigin } from "@/lib/csrf";
import { assertProfileApproved } from "@/lib/api/approval-gate";
import { userActionLimiter, checkLimit, isRateLimitMisconfigured } from "@/lib/ratelimit";
import { captureToSentry } from "@/lib/sentry-capture";
import { logAuditEvent } from "@/lib/audit";

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
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
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
    return NextResponse.json({ error: "id required" }, { status: 400 });
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
        { status: 503, headers: { "Retry-After": String(rl.retryAfter) } },
      );
    }
    return NextResponse.json(
      { error: "Too many requests" },
      { status: 429, headers: { "Retry-After": String(rl.retryAfter) } },
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
      { status: 500 },
    );
  }
  if (!data) {
    return NextResponse.json({ error: "Draft not found" }, { status: 404 });
  }

  if (data.source !== "wizard" || data.status !== "draft") {
    return NextResponse.json({ error: "Not a wizard draft" }, { status: 404 });
  }

  return NextResponse.json({ draft: data });
}

export async function DELETE(req: NextRequest, ctx: RouteContext) {
  const authResult = await getAuthedUserIdOrError(req);
  if (authResult instanceof NextResponse) return authResult;
  const userId = authResult.userId;

  const { id } = await ctx.params;
  if (!id || typeof id !== "string") {
    return NextResponse.json({ error: "id required" }, { status: 400 });
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
        { status: 503, headers: { "Retry-After": String(rl.retryAfter) } },
      );
    }
    return NextResponse.json(
      { error: "Too many requests" },
      { status: 429, headers: { "Retry-After": String(rl.retryAfter) } },
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
    return NextResponse.json({ error: "Draft not found" }, { status: 404 });
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
      { status: 500 },
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

  // Hard-delete the linked api_keys row ONLY if no other strategy
  // still references it. Otherwise the FK's ON DELETE SET NULL would
  // silently break another strategy that happened to share the same
  // key. Check first, then delete; the check is best-effort.
  if (draft.api_key_id) {
    const { count: refCount, error: refCountErr } = await supabase
      .from("strategies")
      .select("id", { count: "exact", head: true })
      .eq("api_key_id", draft.api_key_id);
    // H-0314: a dropped error here is dangerous. On a transient query
    // failure `count` is null, `(null ?? 0) === 0` is true, and we would
    // delete the api_keys row even when sibling strategies still
    // reference it — the FK's ON DELETE SET NULL would then silently
    // break those siblings' sync. Treat a failed ref-count as "cannot
    // prove the key is orphaned" and skip the delete (the conservative
    // direction — never revoke a possibly-shared key on an unproven count).
    // NOTE: the draft strategy row is already deleted above, and
    // cron/cleanup-wizard-drafts only discovers keys via STILL-EXISTING draft
    // rows — so on this rare transient-failure path the key is NOT reclaimed by
    // that cron and may linger orphaned until a dedicated orphan-key sweep.
    // Mirrors that cron's own countErr → skip guard.
    if (refCountErr) {
      console.warn(
        "[strategies/draft DELETE] api_keys ref-count check failed (skip cleanup):",
        refCountErr,
      );
    } else if ((refCount ?? 0) === 0) {
      // Capture the api_key_id in a const so TS narrows it inside the
      // audit emission below (the if-guard already established it's
      // non-null, but the closure below loses that narrowing).
      const keyToRevoke = draft.api_key_id;
      const { error: delKeyErr } = await supabase
        .from("api_keys")
        .delete()
        .eq("id", keyToRevoke);
      if (delKeyErr) {
        // Non-fatal: the strategy row is gone, the dangling api_key is
        // a cosmetic issue the Sprint 2 cleanup cron will sweep.
        console.warn(
          "[strategies/draft DELETE] api_keys cleanup failed (non-fatal):",
          delKeyErr,
        );
      } else {
        // Audit the key revoke alongside the strategy delete so the
        // forensic record shows "wizard-draft delete cascaded into
        // api_key revoke".
        logAuditEvent(supabase, {
          action: "api_key.revoke",
          entity_type: "api_key",
          entity_id: keyToRevoke,
          metadata: { reason: "wizard_draft_cleanup", strategy_id: id },
        });
      }
    }
  }

  return NextResponse.json({ deleted: true });
}
