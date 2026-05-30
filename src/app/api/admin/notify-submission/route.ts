// audit-2026-05-07 P203 (review-fix v0.22.24.2) — this route lives under
// /api/admin/ for historical reasons but does NOT require admin role. Any
// authenticated user may notify about a strategy they own. The route's
// auth contract is enforced via .eq("user_id", user.id) on the strategy
// lookup below, not via isAdminUser. The original first-pass landed the
// rate-limit on `adminActionLimiter` with bucket key `admin:<uid>:...`,
// which read as if this were admin-only. Re-classified here:
//   - limiter: userActionLimiter (canonical 5/min user-mutation bucket)
//   - bucket key: notify-submission:<uid> (no "admin:" prefix)
// The sibling routes that ARE admin-gated (intro-request, strategy-review,
// allocator-approve) continue to use adminActionLimiter; this is the only
// admin/ route exempt from that pattern, and the grep gate notes the
// carve-out.
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { assertSameOrigin } from "@/lib/csrf";
import { userActionLimiter, checkLimit } from "@/lib/ratelimit";
import { notifyFounderNewStrategy, resolveManagerName } from "@/lib/email";

export async function POST(req: NextRequest) {
  const csrfError = assertSameOrigin(req);
  if (csrfError) return csrfError;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // B15b (audit-2026-05-07): guard the parse so a malformed body returns 400
  // (matching the sibling admin routes) instead of an uncaught 500. The parse
  // now runs BEFORE the limiter, so an unguarded throw would let a malformed
  // body 500 without ever consuming a token — bypassing the rate limit.
  let body: { strategy_id?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }
  const { strategy_id } = body;
  if (!strategy_id) {
    return NextResponse.json({ error: "Missing strategy_id" }, { status: 400 });
  }

  // Rate-limit keyed on the authenticated (non-admin) user — see the
  // top-of-file comment for why this uses userActionLimiter rather than
  // adminActionLimiter. 5/min is the standard sensitive-POST cadence and
  // is well above the realistic strategy-submission notification rate.
  //
  // B15b (audit-2026-05-07): consumed AFTER validating strategy_id so a
  // body missing strategy_id never burns one of the user's tokens.
  const rl = await checkLimit(
    userActionLimiter,
    `notify-submission:${user.id}`,
  );
  if (!rl.success) {
    return NextResponse.json(
      { error: "Too many requests" },
      {
        status: 429,
        headers: { "Retry-After": String(rl.retryAfter) },
      },
    );
  }

  // Verify the caller owns this strategy
  const { data: owned } = await supabase
    .from("strategies")
    .select("id")
    .eq("id", strategy_id)
    .eq("user_id", user.id)
    .single();

  if (!owned) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const admin = createAdminClient();

  const [{ data: strategy }, managerName] = await Promise.all([
    admin.from("strategies").select("name").eq("id", strategy_id).single(),
    resolveManagerName(admin, user),
  ]);

  await notifyFounderNewStrategy(strategy?.name ?? "Unknown strategy", managerName);

  return NextResponse.json({ success: true });
}
