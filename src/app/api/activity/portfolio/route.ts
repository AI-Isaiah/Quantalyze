import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import type { DailyPnlRow } from "@/lib/types";

export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = request.nextUrl;
  const portfolioId = url.searchParams.get("portfolio_id");
  if (!portfolioId) {
    return NextResponse.json(
      { error: "Missing portfolio_id" },
      { status: 400 },
    );
  }

  // Ownership check: portfolio must belong to user
  const { data: portfolio } = await supabase
    .from("portfolios")
    .select("id, user_id")
    .eq("id", portfolioId)
    .eq("user_id", user.id)
    .single();

  if (!portfolio) {
    return NextResponse.json(
      { error: "Portfolio not found or not owned by user" },
      { status: 403 },
    );
  }

  const admin = createAdminClient();

  // Get portfolio's strategy IDs
  const { data: psRows } = await admin
    .from("portfolio_strategies")
    .select("strategy_id, strategies(name)")
    .eq("portfolio_id", portfolioId);

  if (!psRows || psRows.length === 0) {
    return NextResponse.json({ activity: [], volumeByDay: [], has_fills: false });
  }

  const strategyIds = psRows.map(
    (r: Record<string, unknown>) => r.strategy_id as string,
  );
  const nameMap: Record<string, string> = {};
  for (const r of psRows) {
    const strat = r.strategies as unknown as { name: string } | null;
    nameMap[r.strategy_id as string] = strat?.name ?? "Unknown";
  }

  // Check if any fills exist for these strategies
  const { count: fillCount } = await admin
    .from("trades")
    .select("id", { count: "exact", head: true })
    .in("strategy_id", strategyIds)
    .eq("is_fill", true);

  const hasFills = (fillCount ?? 0) > 0;

  // Query trades — prefer fills when available, fall back to legacy daily_pnl rows
  const { data: trades } = await admin
    .from("trades")
    .select("timestamp, strategy_id, symbol, realized_pnl, exchange")
    .in("strategy_id", strategyIds)
    .eq("is_fill", hasFills)
    .order("timestamp", { ascending: false })
    .limit(5000);

  if (!trades || trades.length === 0) {
    return NextResponse.json({ activity: [], volumeByDay: [], has_fills: hasFills });
  }

  // Aggregate by date+strategy+symbol
  const buckets = new Map<string, DailyPnlRow>();
  const dayTotals = new Map<string, number>();

  for (const t of trades) {
    const date = (t.timestamp as string).slice(0, 10);
    const key = `${date}|${t.strategy_id}|${t.symbol}`;
    const pnl = typeof t.realized_pnl === "number" ? t.realized_pnl : 0;

    const existing = buckets.get(key);
    if (existing) {
      existing.pnl_usd += pnl;
    } else {
      buckets.set(key, {
        date,
        strategy_id: t.strategy_id as string,
        strategy_name: nameMap[t.strategy_id as string] ?? "Unknown",
        symbol: t.symbol as string,
        pnl_usd: pnl,
        exchange: (t.exchange as string) ?? "",
      });
    }

    dayTotals.set(date, (dayTotals.get(date) ?? 0) + pnl);
  }

  const activity = Array.from(buckets.values()).sort(
    (a, b) => b.date.localeCompare(a.date),
  );

  const volumeByDay = Array.from(dayTotals.entries())
    .map(([date, pnlUsd]) => ({ date, pnlUsd }))
    .sort((a, b) => a.date.localeCompare(b.date));

  return NextResponse.json({ activity, volumeByDay, has_fills: hasFills });
}
