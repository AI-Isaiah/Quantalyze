import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { assertProfileApproved } from "@/lib/api/approval-gate";
import type { DailyPnlRow } from "@/lib/types";

export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  // Approval gate (PR #266 follow-up): activity feed is dashboard data;
  // unapproved users shouldn't reach it via curl.
  const denied = await assertProfileApproved(supabase, user.id);
  if (denied) return denied;

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

  // Audit 2026-05-07 G12.G.3: identify which strategies in the portfolio
  // have ingested fills under USE_RAW_TRADE_INGESTION, so we can route
  // each strategy's trade query to the right is_fill filter. The pre-
  // audit code computed a single portfolio-level hasFills and applied
  // `.eq("is_fill", hasFills)` to the entire IN list. The moment ONE
  // strategy ingested its first fill, the API stopped returning legacy
  // daily_pnl rows for ALL strategies in the portfolio — a sudden data
  // cliff in the TradingActivityLog and TradeVolume widgets.
  //
  // PostgREST: select strategy_ids that have any is_fill=true row.
  // Cap at strategyIds.length to avoid fetching unbounded duplicate rows.
  const { data: fillStrategiesRows, error: fillStrategiesError } = await admin
    .from("trades")
    .select("strategy_id")
    .in("strategy_id", strategyIds)
    .eq("is_fill", true)
    .limit(strategyIds.length);

  if (fillStrategiesError) {
    console.error("[activity/portfolio] fill-strategies query failed", {
      portfolioId,
      message: fillStrategiesError.message,
      code: fillStrategiesError.code,
    });
    return NextResponse.json(
      { error: "Failed to identify strategies with fills" },
      { status: 500 },
    );
  }

  const strategiesWithFills = new Set<string>(
    (fillStrategiesRows ?? []).map(
      (r: Record<string, unknown>) => r.strategy_id as string,
    ),
  );
  const strategiesWithoutFills = strategyIds.filter(
    (id) => !strategiesWithFills.has(id),
  );
  const hasFills = strategiesWithFills.size > 0;

  // Audit 2026-05-07 G12.G.3: run up to two trade queries — one for the
  // fill-mode subset, one for the legacy daily_pnl subset — so each
  // strategy gets its appropriate trade rows. Either subset may be
  // empty (skip the query in that case).
  const fillsQuery = strategiesWithFills.size > 0
    ? admin
        .from("trades")
        .select("timestamp, strategy_id, symbol, realized_pnl, exchange")
        .in("strategy_id", Array.from(strategiesWithFills))
        .eq("is_fill", true)
        .order("timestamp", { ascending: false })
        .limit(5000)
    : null;
  const dailyQuery = strategiesWithoutFills.length > 0
    ? admin
        .from("trades")
        .select("timestamp, strategy_id, symbol, realized_pnl, exchange")
        .in("strategy_id", strategiesWithoutFills)
        .eq("is_fill", false)
        .order("timestamp", { ascending: false })
        .limit(5000)
    : null;

  const [fillsResult, dailyResult] = await Promise.all([
    fillsQuery,
    dailyQuery,
  ]);

  if (fillsResult?.error) {
    console.error("[activity/portfolio] trades (fill subset) query failed", {
      portfolioId,
      message: fillsResult.error.message,
      code: fillsResult.error.code,
    });
    return NextResponse.json(
      { error: "Failed to load trades" },
      { status: 500 },
    );
  }

  if (dailyResult?.error) {
    console.error("[activity/portfolio] trades (daily subset) query failed", {
      portfolioId,
      message: dailyResult.error.message,
      code: dailyResult.error.code,
    });
    return NextResponse.json(
      { error: "Failed to load trades" },
      { status: 500 },
    );
  }

  const trades = [
    ...(fillsResult?.data ?? []),
    ...(dailyResult?.data ?? []),
  ].sort((a, b) =>
    (b.timestamp as string).localeCompare(a.timestamp as string),
  );

  if (trades.length === 0) {
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
