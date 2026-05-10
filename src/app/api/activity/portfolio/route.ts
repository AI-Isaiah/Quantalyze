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
  // Audit 2026-05-07 G12.G.6: destructure error and surface as 500. The
  // pre-audit code ignored the error field entirely, so an RLS regression
  // or a transient DB failure returned `{ ok: true, items: [] }` —
  // indistinguishable from a portfolio that genuinely has no strategies.
  // Operators got no signal; the widget hid its "Now showing fills"
  // footnote inappropriately. Now: every Supabase call checks .error and
  // bails to a structured 500.
  const { data: psRows, error: psError } = await admin
    .from("portfolio_strategies")
    .select("strategy_id, strategies(name)")
    .eq("portfolio_id", portfolioId);

  if (psError) {
    console.error("[activity/portfolio] portfolio_strategies query failed", {
      portfolioId,
      message: psError.message,
      code: psError.code,
    });
    return NextResponse.json(
      { error: "Failed to load portfolio strategies" },
      { status: 500 },
    );
  }

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
  const { count: fillCount, error: fillCountError } = await admin
    .from("trades")
    .select("id", { count: "exact", head: true })
    .in("strategy_id", strategyIds)
    .eq("is_fill", true);

  if (fillCountError) {
    console.error("[activity/portfolio] fill-count query failed", {
      portfolioId,
      message: fillCountError.message,
      code: fillCountError.code,
    });
    return NextResponse.json(
      { error: "Failed to count fills" },
      { status: 500 },
    );
  }

  const hasFills = (fillCount ?? 0) > 0;

  // Query trades — prefer fills when available, fall back to legacy daily_pnl rows
  const { data: trades, error: tradesError } = await admin
    .from("trades")
    .select("timestamp, strategy_id, symbol, realized_pnl, exchange")
    .in("strategy_id", strategyIds)
    .eq("is_fill", hasFills)
    .order("timestamp", { ascending: false })
    .limit(5000);

  if (tradesError) {
    console.error("[activity/portfolio] trades query failed", {
      portfolioId,
      hasFills,
      message: tradesError.message,
      code: tradesError.code,
    });
    return NextResponse.json(
      { error: "Failed to load trades" },
      { status: 500 },
    );
  }

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
