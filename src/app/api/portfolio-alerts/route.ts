import { NextRequest, NextResponse } from "next/server";
import { withAuth } from "@/lib/api/withAuth";
import { createClient } from "@/lib/supabase/server";
import { assertPortfolioOwnership } from "@/lib/queries";
import type { User } from "@supabase/supabase-js";

export const GET = withAuth(async (req: NextRequest, user: User) => {
  const portfolioId = new URL(req.url).searchParams.get("portfolio_id");
  const supabase = await createClient();

  let query = supabase
    .from("portfolio_alerts")
    .select("*")
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

export const PATCH = withAuth(async (req: NextRequest, user: User) => {
  const body = await req.json();
  const { alert_id } = body as { alert_id?: string };

  if (!alert_id) {
    return NextResponse.json({ error: "Missing alert_id" }, { status: 400 });
  }

  // Single UPDATE with subquery for ownership check (no TOCTOU window)
  const supabase = await createClient();
  const { data: portfolios } = await supabase
    .from("portfolios")
    .select("id")
    .eq("user_id", user.id);
  const portfolioIds = (portfolios ?? []).map((p) => p.id);

  if (portfolioIds.length === 0) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { data, error } = await supabase
    .from("portfolio_alerts")
    .update({ acknowledged_at: new Date().toISOString() })
    .eq("id", alert_id)
    .in("portfolio_id", portfolioIds)
    .select("id");

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!data || data.length === 0) {
    return NextResponse.json({ error: "Alert not found or forbidden" }, { status: 404 });
  }
  return NextResponse.json({ success: true });
});
