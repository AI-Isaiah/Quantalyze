/**
 * Phase 13 / Plan 13-01 / DISCO-01 — Watchlist toggle handler.
 *
 * PUT /api/watchlist/[strategyId]
 * Body: { action: "add" | "remove" }
 *
 * Idempotency lives server-side:
 *   - "add"    → upsert with onConflict='user_id,strategy_id' + ignoreDuplicates=true.
 *                user_favorites' PRIMARY KEY (user_id, strategy_id) (migration 024)
 *                turns the second add into a no-op instead of a 409 error.
 *   - "remove" → delete().eq("user_id", user.id).eq("strategy_id", strategyId).
 *                A second remove on a non-existent row is a 0-row delete (200).
 *
 * Threat dispositions (cross-link to 13-01-PLAN <threat_model>):
 *   - T-13-01-01 CSRF        → assertSameOrigin(req) at handler entry.
 *   - T-13-01-02 DoS         → checkLimit(mandateAutoSaveLimiter, "watchlist:" + uid)
 *                              30/min cap (Open Q #3 in TODOS.md — toggle bursts can
 *                              legitimately exceed the 5/min userActionLimiter).
 *   - T-13-01-03 IDOR        → DELETE constrained to (user_id, strategy_id) and RLS
 *                              on user_favorites enforces user_id=auth.uid().
 *   - T-13-01-06 input val   → strict { action: "add" | "remove" } whitelist; any
 *                              other body shape returns 400.
 *
 * Pattern source: src/app/api/preferences/route.ts:28-44 — inline auth +
 * CSRF + rate-limit. We do NOT use withAuth here because withAuth does not
 * forward route ctx (params), and Next 16 dynamic-segment params is a
 * Promise that must be awaited (RESEARCH.md Pitfall 5).
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { assertSameOrigin } from "@/lib/csrf";
import { mandateAutoSaveLimiter, checkLimit } from "@/lib/ratelimit";

export async function PUT(
  req: NextRequest,
  ctx: { params: Promise<{ strategyId: string }> },
): Promise<NextResponse> {
  // T-13-01-01 — CSRF mitigation. Returns 403 NextResponse on Origin mismatch.
  const csrfError = assertSameOrigin(req);
  if (csrfError) return csrfError;

  // Next 16: dynamic-segment params is a Promise (await ctx.params, NOT
  // ctx.params.strategyId — which would be a Promise<string>).
  const { strategyId } = await ctx.params;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // T-13-01-02 — DoS / rapid-toggle spam. 30/min per user.
  const rl = await checkLimit(mandateAutoSaveLimiter, `watchlist:${user.id}`);
  if (!rl.success) {
    return NextResponse.json(
      { error: "Too many requests" },
      { status: 429, headers: { "Retry-After": String(rl.retryAfter) } },
    );
  }

  // T-13-01-06 — input validation. Reject malformed bodies BEFORE touching the DB.
  let body: { action?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }
  if (body.action !== "add" && body.action !== "remove") {
    return NextResponse.json({ error: "Invalid action" }, { status: 400 });
  }

  if (body.action === "add") {
    // ON CONFLICT DO NOTHING via onConflict + ignoreDuplicates. The
    // PRIMARY KEY (user_id, strategy_id) on user_favorites guarantees
    // a duplicate add is silently absorbed.
    // @audit-skip: T-13-01-05 (accept) — watchlist toggle is an allocator
    // self-action with no security/commercial impact; mirrors the
    // src/app/api/preferences/route.ts pattern of NOT auditing self-action
    // mutations. See 13-01-PLAN.md <threat_model>.
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
    // T-13-01-03 — IDOR mitigation. The .eq("user_id", user.id) filter on
    // top of the table-level RLS prevents a malicious caller from constructing
    // a request that deletes someone else's favorites even if RLS were
    // misconfigured.
    // @audit-skip: T-13-01-05 (accept) — see add-branch comment above.
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
