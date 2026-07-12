/**
 * Watchlist + optimizer server reads (PI-05, Phase 100, v1.10).
 *
 * Owner-scoped, secretless RLS reads that back the two /allocations panels.
 * INTERFACE-FIRST: the exported `FavoriteRow` / `OptimizerPrefetch` types are
 * the contract plan 100-04 imports to thread these into `page.tsx`'s
 * `Promise.all` as new props — do not widen them without updating that consumer.
 *
 * Error discipline mirrors the Phase-98 exposure read layer
 * (src/lib/portfolio-exposure.ts): a PostgREST error THROWS (reaching
 * allocations/error.tsx). An empty result and a query failure are DISTINCT
 * states and are NEVER collapsed into `[]` / honest-empty — a transient
 * RLS/network/schema-drift failure must not read as "you have no favorites."
 *
 * Trust boundary: both reads take the caller's USER Supabase client (owner
 * RLS: user_favorites owner-only policies; portfolios/portfolio_analytics
 * owner-scoped) plus an explicit `.eq(user_id/portfolio_id, …)` gate as
 * defence-in-depth. The admin client is NEVER used here (it would bypass RLS).
 * The projection is a column allow-list; no key-material / raw-payload columns
 * are ever selected.
 *
 * DEVIATION (Rule 3 — plan referenced a nonexistent column): the UI-SPEC/plan
 * name the portfolio recency signal `updated_at`, but `public.portfolios` has
 * NO `updated_at` column (only `created_at`). Rather than invent a timestamp,
 * the default portfolio is the most-recently-CREATED one and the contract
 * surfaces the real `created_at`. "Most recently updated" ⇒ "most recently
 * created" for the default pick.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import type { OptimizerSuggestion } from "@/components/portfolio/PortfolioOptimizer";
import type { TrustTier } from "@/lib/design-tokens/trust-tier";

/** Mirror of PortfolioOptimizer's internal (unexported) ComputationStatus. */
type ComputationStatus = "pending" | "computing" | "complete" | "failed" | null;

type SupabaseUserClient = SupabaseClient<Database>;

/** One favorited strategy, real columns only (nothing synthesized). */
export interface FavoriteRow {
  strategy_id: string;
  name: string;
  slug: string;
  /** Latest verification tier, or null if the strategy is unverified. */
  trust_tier: TrustTier | null;
  /** When the allocator favorited it (user_favorites.created_at). */
  created_at: string;
}

/** Prefetched optimizer state for the /allocations OptimizerPanel wrapper. */
export interface OptimizerPrefetch {
  /**
   * The user's portfolios, most-recent first. `created_at` is the real
   * recency signal (portfolios has no `updated_at` — see module deviation).
   */
  portfolios: { id: string; name: string; created_at: string }[];
  /** Most-recently-created portfolio, or null when the user has none. */
  defaultPortfolioId: string | null;
  /** Persisted suggestions for the default portfolio (null = never computed). */
  initialSuggestions: OptimizerSuggestion[] | null;
  computedAt: string | null;
  computationStatus: ComputationStatus;
}

/** Shape of one embedded user_favorites → strategies → verifications row. */
interface FavoriteJoinRow {
  strategy_id: string;
  created_at: string;
  strategies: {
    name: string;
    slug: string;
    strategy_verifications:
      | { trust_tier: string; status: string; created_at: string }[]
      | null;
  } | null;
}

/**
 * PI-05 — the allocator's watchlist: `user_favorites` (owner RLS) joined to
 * `strategies` for the display fields, with the latest `strategy_verifications`
 * tier picked in JS (locked decision D-04: trust_tier lives ONLY on
 * strategy_verifications; no `strategies.trust_tier` column exists). Ordered
 * most-recently-favorited first. Returns [] for no favorites; THROWS on error.
 */
export async function getFavoritesWithStrategies(
  supabase: SupabaseUserClient,
  userId: string,
): Promise<FavoriteRow[]> {
  const { data, error } = await supabase
    .from("user_favorites")
    .select(
      `strategy_id, created_at, strategies!inner (name, slug, strategy_verifications (trust_tier, status, created_at))`,
    )
    .eq("user_id", userId)
    .order("created_at", { ascending: false });

  if (error) throw error;

  const rows = (data ?? []) as unknown as FavoriteJoinRow[];
  return rows
    .filter(
      (r): r is FavoriteJoinRow & { strategies: NonNullable<FavoriteJoinRow["strategies"]> } =>
        r.strategies != null,
    )
    .map((r) => {
      const latest = (r.strategies.strategy_verifications ?? [])
        .slice()
        .sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
      return {
        strategy_id: r.strategy_id,
        name: r.strategies.name,
        slug: r.strategies.slug,
        trust_tier: (latest?.trust_tier ?? null) as TrustTier | null,
        created_at: r.created_at,
      };
    });
}

/**
 * PI-05 — prefetch the optimizer state the same way `/portfolios/[id]/page.tsx`
 * reads it: the user's portfolios plus the persisted
 * `optimizer_suggestions` / `computed_at` / `computation_status` for the
 * DEFAULT portfolio (most recently created — see module deviation). 0
 * portfolios → `{ portfolios: [], defaultPortfolioId: null, … }`. THROWS on any
 * PostgREST error (both reads).
 */
export async function getOptimizerPrefetch(
  supabase: SupabaseUserClient,
  userId: string,
): Promise<OptimizerPrefetch> {
  const { data: portfolioData, error: portfolioError } = await supabase
    .from("portfolios")
    .select("id, name, created_at")
    .eq("user_id", userId)
    .order("created_at", { ascending: false });

  if (portfolioError) throw portfolioError;

  const portfolios = (portfolioData ?? []) as {
    id: string;
    name: string;
    created_at: string;
  }[];

  if (portfolios.length === 0) {
    return {
      portfolios: [],
      defaultPortfolioId: null,
      initialSuggestions: null,
      computedAt: null,
      computationStatus: null,
    };
  }

  const defaultPortfolioId = portfolios[0].id;

  const { data: analytics, error: analyticsError } = await supabase
    .from("portfolio_analytics")
    .select("optimizer_suggestions, computed_at, computation_status")
    .eq("portfolio_id", defaultPortfolioId)
    .order("computed_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (analyticsError) throw analyticsError;

  return {
    portfolios,
    defaultPortfolioId,
    initialSuggestions:
      (analytics?.optimizer_suggestions as OptimizerSuggestion[] | null) ?? null,
    computedAt: analytics?.computed_at ?? null,
    computationStatus:
      (analytics?.computation_status as ComputationStatus) ?? null,
  };
}
