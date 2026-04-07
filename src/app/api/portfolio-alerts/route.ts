import { NextRequest, NextResponse } from "next/server";
import { withAuth } from "@/lib/api/withAuth";
import { createClient } from "@/lib/supabase/server";
import type { User } from "@supabase/supabase-js";

export const GET = withAuth(async (req: NextRequest, user: User) => {
  const portfolioId = new URL(req.url).searchParams.get("portfolio_id");
  const supabase = await createClient();

  if (portfolioId) {
    const { data: portfolio } = await supabase
      .from("portfolios")
      .select("id")
      .eq("id", portfolioId)
      .eq("user_id", user.id)
      .single();
    if (!portfolio) {
      return NextResponse.json({ error: "Portfolio not found" }, { status: 404 });
    }

    const { data, error } = await supabase
      .from("portfolio_alerts")
      .select("*")
      .eq("portfolio_id", portfolioId)
      .is("acknowledged_at", null)
      .order("triggered_at", { ascending: false });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json({ alerts: data ?? [] });
  }

  const { data: portfolios } = await supabase
    .from("portfolios")
    .select("id")
    .eq("user_id", user.id);

  const portfolioIds = (portfolios ?? []).map((p) => p.id);
  if (portfolioIds.length === 0) {
    return NextResponse.json({ alerts: [] });
  }

  const { data, error } = await supabase
    .from("portfolio_alerts")
    .select("*")
    .in("portfolio_id", portfolioIds)
    .is("acknowledged_at", null)
    .order("triggered_at", { ascending: false });

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

  const supabase = await createClient();
  const { data: alert } = await supabase
    .from("portfolio_alerts")
    .select("id, portfolio_id")
    .eq("id", alert_id)
    .single();
  if (!alert) {
    return NextResponse.json({ error: "Alert not found" }, { status: 404 });
  }

  const { data: portfolio } = await supabase
    .from("portfolios")
    .select("id")
    .eq("id", alert.portfolio_id)
    .eq("user_id", user.id)
    .single();
  if (!portfolio) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { error } = await supabase
    .from("portfolio_alerts")
    .update({ acknowledged_at: new Date().toISOString() })
    .eq("id", alert_id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ success: true });
});
