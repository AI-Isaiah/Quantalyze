import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { withPublishedOnly } from "@/lib/visibility";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/layout/PageHeader";
import { ScenarioBuilder } from "@/components/scenarios/ScenarioBuilder";

export const dynamic = "force-dynamic";

interface DailyPoint {
  date: string;
  value: number;
}

interface StrategyForBuilder {
  id: string;
  name: string;
  codename: string | null;
  disclosure_tier: string;
  strategy_types: string[];
  markets: string[];
  start_date: string | null;
  daily_returns: DailyPoint[];
  cagr: number | null;
  sharpe: number | null;
  volatility: number | null;
  max_drawdown: number | null;
}

export default async function ScenariosPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/scenarios");

  // C-0017 (audit-2026-05-07): role gate. /scenarios surfaces raw
  // daily_returns + codename mapping for the institutional-tier strategy
  // universe via createAdminClient (RLS-bypassed). The sidebar HIDES the
  // entry point from non-allocators, but the route itself must enforce
  // the same gate or a non-allocator can directly navigate and pull the
  // RSC payload. Mirrors the `isAllocator = role IN ('allocator','both')`
  // contract used by withAllocatorAuth, the dashboard layout, and the
  // sibling /api/intro route.
  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .maybeSingle();
  const isAllocator =
    profile?.role === "allocator" || profile?.role === "both";
  if (!isAllocator) redirect("/");

  // Use admin client to fetch all strategy analytics + daily returns. The
  // scenario builder is read-only: every allocator can compare the same
  // universe of strategies; the client-side recomputation math depends on
  // the raw daily_returns which RLS doesn't know to restrict.
  const admin = createAdminClient();
  const { data: strategyRows } = await withPublishedOnly(
    admin
      .from("strategies")
      .select(
        "id, name, codename, disclosure_tier, strategy_types, markets, start_date",
      )
      .eq("is_example", true),
  )
    .order("name");

  const strategies = (strategyRows ?? []) as Array<{
    id: string;
    name: string;
    codename: string | null;
    disclosure_tier: string;
    strategy_types: string[];
    markets: string[];
    start_date: string | null;
  }>;

  const ids = strategies.map((s) => s.id);
  if (ids.length === 0) {
    return (
      <main className="max-w-[1280px] mx-auto p-6">
        <PageHeader
          title="Scenario Builder"
          description="Toggle strategies on and off to see how a hypothetical allocation would have performed."
        />
        <p className="mt-8 text-sm text-text-muted">
          No strategies available yet. Seed demo data first.
        </p>
      </main>
    );
  }

  const { data: analyticsRows } = await admin
    .from("strategy_analytics")
    .select(
      "strategy_id, daily_returns, cagr, sharpe, volatility, max_drawdown",
    )
    .in("strategy_id", ids);

  const analyticsById = new Map<
    string,
    {
      daily_returns: DailyPoint[];
      cagr: number | null;
      sharpe: number | null;
      volatility: number | null;
      max_drawdown: number | null;
    }
  >();
  for (const row of analyticsRows ?? []) {
    const r = row as {
      strategy_id: string;
      daily_returns: unknown;
      cagr: number | null;
      sharpe: number | null;
      volatility: number | null;
      max_drawdown: number | null;
    };
    analyticsById.set(r.strategy_id, {
      daily_returns: Array.isArray(r.daily_returns)
        ? (r.daily_returns as DailyPoint[])
        : [],
      cagr: r.cagr,
      sharpe: r.sharpe,
      volatility: r.volatility,
      max_drawdown: r.max_drawdown,
    });
  }

  const enriched: StrategyForBuilder[] = strategies.map((s) => {
    const a = analyticsById.get(s.id);
    return {
      ...s,
      daily_returns: a?.daily_returns ?? [],
      cagr: a?.cagr ?? null,
      sharpe: a?.sharpe ?? null,
      volatility: a?.volatility ?? null,
      max_drawdown: a?.max_drawdown ?? null,
    };
  });

  return (
    <main className="max-w-[1280px] mx-auto p-6 pb-20">
      <PageHeader
        title="Scenario Builder"
        description="Toggle strategies on and off to see how a hypothetical allocation would have performed. Every metric recomputes live as you change the composition."
      />
      <ScenarioBuilder strategies={enriched} />
    </main>
  );
}
