import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { assertSameOrigin } from "@/lib/csrf";
import { userActionLimiter, checkLimit } from "@/lib/ratelimit";

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
  return { userId: user.id };
}

export async function GET(req: NextRequest, ctx: RouteContext) {
  const authResult = await getAuthedUserIdOrError(req);
  if (authResult instanceof NextResponse) return authResult;
  const userId = authResult.userId;

  const rl = await checkLimit(userActionLimiter, `strategies-draft-get:${userId}`);
  if (!rl.success) {
    return NextResponse.json(
      { error: "Too many requests" },
      { status: 429, headers: { "Retry-After": String(rl.retryAfter) } },
    );
  }

  const { id } = await ctx.params;
  if (!id || typeof id !== "string") {
    return NextResponse.json({ error: "id required" }, { status: 400 });
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

  if (error || !data) {
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

  const rl = await checkLimit(
    userActionLimiter,
    `strategies-draft-delete:${userId}`,
  );
  if (!rl.success) {
    return NextResponse.json(
      { error: "Too many requests" },
      { status: 429, headers: { "Retry-After": String(rl.retryAfter) } },
    );
  }

  const { id } = await ctx.params;
  if (!id || typeof id !== "string") {
    return NextResponse.json({ error: "id required" }, { status: 400 });
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
  // clobbering a promoted strategy. ON DELETE CASCADE handles:
  //   - strategy_analytics (FK with CASCADE per migration 001:72)
  //   - trades (FK with CASCADE per migration 001:112)
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

  // Hard-delete the linked api_keys row ONLY if no other strategy
  // still references it. Otherwise the FK's ON DELETE SET NULL would
  // silently break another strategy that happened to share the same
  // key. Check first, then delete; the check is best-effort.
  if (draft.api_key_id) {
    const { count: refCount } = await supabase
      .from("strategies")
      .select("id", { count: "exact", head: true })
      .eq("api_key_id", draft.api_key_id);
    if ((refCount ?? 0) === 0) {
      const { error: delKeyErr } = await supabase
        .from("api_keys")
        .delete()
        .eq("id", draft.api_key_id);
      if (delKeyErr) {
        // Non-fatal: the strategy row is gone, the dangling api_key is
        // a cosmetic issue the Sprint 2 cleanup cron will sweep.
        console.warn(
          "[strategies/draft DELETE] api_keys cleanup failed (non-fatal):",
          delKeyErr,
        );
      }
    }
  }

  return NextResponse.json({ deleted: true });
}
