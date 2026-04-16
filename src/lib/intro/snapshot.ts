import "server-only";

import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import type { PortfolioAnalytics } from "@/lib/types";

/**
 * Snapshot of an allocator's primary portfolio at intro-request time.
 *
 * Written into `contact_requests.portfolio_snapshot` so the manager receiving
 * the intro has a compact picture of the allocator's book: where they are
 * strong/weak, how concentrated they run, and how many alerts have fired in
 * the last week. Everything here is derived from user-owned rows (portfolios,
 * portfolio_strategies, portfolio_analytics, strategy_analytics, portfolio_alerts).
 *
 * The /api/intro route calls this with a 2s budget. If the compute does not
 * resolve in time, the route inserts snapshot_status='pending' and enqueues a
 * compute_intro_snapshot compute job to finish the computation asynchronously.
 */

const STRATEGY_REF = z.object({
  // Stored as text — the surrounding system already validates UUIDs at
  // insert time. The snapshot schema's job is shape integrity, not
  // re-validating ids that came back from a trusted DB.
  strategy_id: z.string().min(1),
  strategy_name: z.string(),
  sharpe: z.number().nullable(),
});

const PORTFOLIO_SNAPSHOT_SCHEMA = z.object({
  sharpe: z.number().nullable(),
  max_drawdown: z.number().nullable(),
  /**
   * Herfindahl-Hirschman on allocation weights. 1/n = perfectly diversified,
   * 1 = single strategy. Null when no weights are set.
   */
  concentration: z.number().nullable(),
  top_3_strategies: z.array(STRATEGY_REF).max(3),
  bottom_3_strategies: z.array(STRATEGY_REF).max(3),
  alerts_last_7d: z.number().int().nonnegative(),
});

export type PortfolioSnapshotJSON = z.infer<typeof PORTFOLIO_SNAPSHOT_SCHEMA>;
export type PortfolioSnapshotStrategy = z.infer<typeof STRATEGY_REF>;

/**
 * Compute the snapshot for the given user's primary portfolio (most recent
 * for that user_id). Returns a Zod-validated object; throws if the shape is
 * unexpectedly broken — the /api/intro caller catches and treats as failed,
 * not pending.
 *
 * Uses the service-role admin client because this runs server-side after
 * auth + allocator role check has already happened.
 */
export async function computePortfolioSnapshot(
  userId: string,
): Promise<PortfolioSnapshotJSON> {
  const admin = createAdminClient();

  // 1. Primary portfolio = most recently created for this user.
  const { data: portfolio, error: portfolioErr } = await admin
    .from("portfolios")
    .select("id")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (portfolioErr) throw portfolioErr;

  if (!portfolio) {
    // Brand-new allocator with no portfolio. Return a fully-zero snapshot
    // rather than failing — the intro can still go through, the manager just
    // has nothing to read.
    return PORTFOLIO_SNAPSHOT_SCHEMA.parse({
      sharpe: null,
      max_drawdown: null,
      concentration: null,
      top_3_strategies: [],
      bottom_3_strategies: [],
      alerts_last_7d: 0,
    });
  }

  const portfolioId = portfolio.id as string;

  // Steps 2-4 are independent of each other — fire them in parallel to
  // save 2 RTTs. Each branch still throws its own error on failure.
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const [
    { data: analyticsRow, error: analyticsErr },
    { data: strategyLinks, error: strategyLinksErr },
    { count, error: alertsErr },
  ] = await Promise.all([
    admin
      .from("portfolio_analytics")
      .select("portfolio_sharpe, portfolio_max_drawdown")
      .eq("portfolio_id", portfolioId)
      .order("computed_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    admin
      .from("portfolio_strategies")
      .select(
        "strategy_id, current_weight, allocated_amount, strategies ( id, name ), strategy_analytics:strategy_analytics ( strategy_id, sharpe )",
      )
      .eq("portfolio_id", portfolioId),
    admin
      .from("portfolio_alerts")
      .select("id", { count: "exact", head: true })
      .eq("portfolio_id", portfolioId)
      .gte("triggered_at", sevenDaysAgo),
  ]);
  if (analyticsErr) throw analyticsErr;
  if (strategyLinksErr) throw strategyLinksErr;
  if (alertsErr) throw alertsErr;

  const analytics = analyticsRow as
    | Pick<PortfolioAnalytics, "portfolio_sharpe" | "portfolio_max_drawdown">
    | null;

  // PostgREST returns embedded relations as arrays even when they are
  // logically 1:1; we collapse to the first element below. Cast through
  // unknown because the runtime shape is what we actually care about.
  const links = ((strategyLinks ?? []) as unknown) as Array<{
    strategy_id: string;
    current_weight: number | null;
    allocated_amount: number | null;
    strategies: { id: string; name: string } | { id: string; name: string }[] | null;
    strategy_analytics:
      | { strategy_id: string; sharpe: number | null }
      | { strategy_id: string; sharpe: number | null }[]
      | null;
  }>;

  function firstOrSingle<T>(value: T | T[] | null): T | null {
    if (value === null) return null;
    if (Array.isArray(value)) return value[0] ?? null;
    return value;
  }

  // Concentration (HHI) — defined over current_weight if populated, else
  // allocated_amount normalized, else null.
  const concentration = computeConcentration(
    links.map((l) => ({
      weight: l.current_weight,
      amount: l.allocated_amount,
    })),
  );

  // Top/bottom by Sharpe. Strategies without analytics are omitted from
  // the ranking (null Sharpe tells the manager nothing).
  const ranked: PortfolioSnapshotStrategy[] = links
    .map((l) => {
      const strat = firstOrSingle(l.strategies);
      const sa = firstOrSingle(l.strategy_analytics);
      const name = strat?.name ?? "Unnamed strategy";
      const sharpe = sa?.sharpe ?? null;
      return {
        strategy_id: l.strategy_id,
        strategy_name: name,
        sharpe,
      };
    })
    .filter((s) => s.sharpe !== null)
    .sort((a, b) => (b.sharpe ?? 0) - (a.sharpe ?? 0));

  const top3 = ranked.slice(0, 3);
  // Bottom 3: reverse sort, take 3, then reverse back so the returned order
  // is still "worst first" (readable in the admin UI).
  const bottom3 = ranked.slice(Math.max(0, ranked.length - 3)).reverse();

  const snapshot: PortfolioSnapshotJSON = {
    sharpe: analytics?.portfolio_sharpe ?? null,
    max_drawdown: analytics?.portfolio_max_drawdown ?? null,
    concentration,
    top_3_strategies: top3,
    bottom_3_strategies: bottom3,
    alerts_last_7d: count ?? 0,
  };

  return PORTFOLIO_SNAPSHOT_SCHEMA.parse(snapshot);
}

/**
 * HHI on strategy weights. Prefers explicit current_weight (0..1); falls
 * back to normalizing allocated_amount. Returns null when neither source
 * yields a usable total.
 */
function computeConcentration(
  entries: Array<{ weight: number | null; amount: number | null }>,
): number | null {
  if (entries.length === 0) return null;

  const weights = entries
    .map((e) => (typeof e.weight === "number" ? e.weight : null))
    .filter((w): w is number => w !== null && Number.isFinite(w));

  if (weights.length === entries.length) {
    const total = weights.reduce((s, w) => s + w, 0);
    if (total > 0) {
      return weights.reduce((s, w) => s + (w / total) ** 2, 0);
    }
  }

  const amounts = entries
    .map((e) => (typeof e.amount === "number" ? e.amount : null))
    .filter((a): a is number => a !== null && Number.isFinite(a) && a > 0);

  if (amounts.length > 0) {
    const total = amounts.reduce((s, a) => s + a, 0);
    return amounts.reduce((s, a) => s + (a / total) ** 2, 0);
  }

  return null;
}

/** Exposed for /admin/intros + tests. */
export const PortfolioSnapshotSchema = PORTFOLIO_SNAPSHOT_SCHEMA;
