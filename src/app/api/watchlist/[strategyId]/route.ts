/**
 * Watchlist toggle handler.
 *
 * PUT /api/watchlist/[strategyId]
 * Body: { action: "add" | "remove" }
 *
 * Idempotency lives server-side:
 *   - "add"    → upsert onConflict='user_id,strategy_id' + ignoreDuplicates.
 *                The PRIMARY KEY (user_id, strategy_id) on user_favorites
 *                turns a duplicate add into a no-op instead of a 409.
 *   - "remove" → delete is naturally idempotent (a 0-row delete returns 200).
 *
 * Auth/CSRF/rate-limit are inlined rather than wrapped via `withAuth`
 * because `withAuth` doesn't forward route ctx (params), and Next.js
 * dynamic-segment params is a Promise that must be awaited.
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { assertSameOrigin } from "@/lib/csrf";
import { mandateAutoSaveLimiter, checkLimit } from "@/lib/ratelimit";

export async function PUT(
  req: NextRequest,
  ctx: { params: Promise<{ strategyId: string }> },
): Promise<NextResponse> {
  const csrfError = assertSameOrigin(req);
  if (csrfError) return csrfError;

  const { strategyId } = await ctx.params;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: { action?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }
  if (body.action !== "add" && body.action !== "remove") {
    return NextResponse.json({ error: "Invalid action" }, { status: 400 });
  }

  // 30/min per user. Toggle bursts can legitimately exceed the global
  // userActionLimiter's 5/min cap.
  const rl = await checkLimit(mandateAutoSaveLimiter, `watchlist:${user.id}`);
  if (!rl.success) {
    return NextResponse.json(
      { error: "Too many requests" },
      { status: 429, headers: { "Retry-After": String(rl.retryAfter) } },
    );
  }

  if (body.action === "add") {
    // @audit-skip: watchlist toggle is an allocator self-action with no
    // security/commercial impact; mirrors the preferences-route pattern of
    // NOT auditing self-action mutations.
    const { error } = await supabase
      .from("user_favorites")
      .upsert(
        { user_id: user.id, strategy_id: strategyId },
        { onConflict: "user_id,strategy_id", ignoreDuplicates: true },
      );
    if (error) {
      console.error("[api/watchlist] add failed:", error.message ?? error);
      return NextResponse.json({ error: "Failed to add" }, { status: 500 });
    }
  } else {
    // .eq("user_id", user.id) on top of RLS — defense-in-depth against
    // misconfigured RLS letting a delete reach another user's favorites.
    // @audit-skip: see add-branch comment above.
    const { error } = await supabase
      .from("user_favorites")
      .delete()
      .eq("user_id", user.id)
      .eq("strategy_id", strategyId);
    if (error) {
      console.error("[api/watchlist] remove failed:", error.message ?? error);
      return NextResponse.json({ error: "Failed to remove" }, { status: 500 });
    }
  }

  return NextResponse.json({ success: true });
}
