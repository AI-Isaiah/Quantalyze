import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { assertSameOrigin } from "@/lib/csrf";
import { trackUsageEventServer } from "@/lib/analytics/usage-events";

/**
 * POST /api/alerts/[id]/acknowledge — in-app ack from the critical banner.
 *
 * Idempotent: if the alert is already acked (or the id doesn't exist), we
 * still return 204 as long as the caller owns the portfolio. The optimistic
 * remove on the client doesn't need to distinguish "already acked" from
 * "just acked now".
 *
 * Auth is inlined (not via withAuth) so we can read the dynamic `id` param
 * from the second handler argument. Ownership is enforced by the UPDATE's
 * `.in("portfolio_id", ownedPortfolioIds)` guard — this is the same
 * pattern used by `src/app/api/portfolio-alerts/route.ts`'s PATCH.
 */
interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function POST(req: NextRequest, ctx: RouteContext) {
  const csrfError = assertSameOrigin(req);
  if (csrfError) return csrfError;

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await ctx.params;
  if (!id) {
    return NextResponse.json({ error: "Missing alert id" }, { status: 400 });
  }

  // Pull the caller's portfolios, then scope the UPDATE to that set. A
  // single UPDATE with an IN-subquery keeps ownership + mutation atomic
  // (no TOCTOU window).
  const { data: portfolios } = await supabase
    .from("portfolios")
    .select("id")
    .eq("user_id", user.id);
  const portfolioIds = (portfolios ?? []).map((p) => p.id);
  if (portfolioIds.length === 0) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // Verify the alert belongs to one of the caller's portfolios before
  // mutating. A separate SELECT gives us an explicit 404 when the alert
  // exists but isn't ours (vs. a silent 204 from a scoped UPDATE that
  // matches 0 rows, which would mask ownership mismatches).
  const { data: existing, error: lookupError } = await supabase
    .from("portfolio_alerts")
    .select("id, acknowledged_at, alert_type")
    .eq("id", id)
    .in("portfolio_id", portfolioIds)
    .maybeSingle();

  if (lookupError) {
    return NextResponse.json({ error: lookupError.message }, { status: 500 });
  }
  if (!existing) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // Idempotent: if already acked, short-circuit to 204.
  if (existing.acknowledged_at) {
    return new NextResponse(null, { status: 204 });
  }

  const { error: updateError } = await supabase
    .from("portfolio_alerts")
    .update({ acknowledged_at: new Date().toISOString() })
    .eq("id", id)
    .in("portfolio_id", portfolioIds);

  if (updateError) {
    return NextResponse.json({ error: updateError.message }, { status: 500 });
  }

  // Usage funnel event. In-app source; the email ack path in
  // `/api/alerts/ack` fires the same event with source: "email" using
  // the resolved portfolio owner id.
  void trackUsageEventServer("alert_acknowledged", user.id, {
    alert_id: id,
    alert_type: existing.alert_type,
  });

  return new NextResponse(null, { status: 204 });
}
