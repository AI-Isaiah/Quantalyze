import { NextRequest, NextResponse } from "next/server";
import { withAuth } from "@/lib/api/withAuth";
import { createClient } from "@/lib/supabase/server";
import { assertPortfolioOwnership } from "@/lib/queries";
import type { User } from "@supabase/supabase-js";

/**
 * GET /api/alerts/critical?portfolio_id=X — the rows that can feed the
 * critical-only AlertBanner on /allocations.
 *
 * Filters RLS-enforced portfolio_alerts to:
 *   - severity = 'critical'
 *   - acknowledged_at IS NULL
 * ordered by triggered_at DESC. Per alert-routing-v1.md §"Hard rules", the
 * banner renders the most recent row; callers treat the tail as "+N more".
 *
 * When `portfolio_id` is omitted, results span every portfolio the caller
 * owns — keeps this endpoint usable from other surfaces (mobile nav, a
 * future global badge) without a second implementation.
 */
export const GET = withAuth(async (req: NextRequest, user: User) => {
  const portfolioId = new URL(req.url).searchParams.get("portfolio_id");
  const supabase = await createClient();

  let query = supabase
    .from("portfolio_alerts")
    .select("id, portfolio_id, alert_type, severity, message, triggered_at")
    .eq("severity", "critical")
    .is("acknowledged_at", null)
    .order("triggered_at", { ascending: false });

  if (portfolioId) {
    if (!(await assertPortfolioOwnership(portfolioId, user.id))) {
      return NextResponse.json({ error: "Portfolio not found" }, { status: 404 });
    }
    query = query.eq("portfolio_id", portfolioId);
  } else {
    const { data: portfolios } = await supabase
      .from("portfolios")
      .select("id")
      .eq("user_id", user.id);
    const portfolioIds = (portfolios ?? []).map((p) => p.id);
    if (portfolioIds.length === 0) {
      return NextResponse.json({ alerts: [] });
    }
    query = query.in("portfolio_id", portfolioIds);
  }

  const { data, error } = await query;
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ alerts: data ?? [] });
});
