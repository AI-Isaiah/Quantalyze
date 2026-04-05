import { NextRequest, NextResponse } from "next/server";
import { fetchTrades, computeAnalytics } from "@/lib/analytics-client";
import { createClient } from "@/lib/supabase/server";
import { withAuth } from "@/lib/api/withAuth";
import type { User } from "@supabase/supabase-js";

export const POST = withAuth(async (req: NextRequest, user: User) => {
  const body = await req.json();
  const { strategy_id } = body;

  if (!strategy_id) {
    return NextResponse.json({ error: "Missing strategy_id" }, { status: 400 });
  }

  const supabase = await createClient();
  const { data: strategy } = await supabase
    .from("strategies")
    .select("id, user_id")
    .eq("id", strategy_id)
    .eq("user_id", user.id)
    .single();

  if (!strategy) {
    return NextResponse.json({ error: "Strategy not found or not owned by you" }, { status: 403 });
  }

  try {
    const tradeResult = await fetchTrades(strategy_id);
    const analyticsResult = await computeAnalytics(strategy_id);
    return NextResponse.json({
      trades_fetched: tradeResult.trades_fetched,
      analytics_status: analyticsResult.status,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Sync failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
});
