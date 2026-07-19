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
 *
 * DEVIATION (Rule 3 — same class): the plan named a `strategies.slug` field for
 * the favorite, but `public.strategies` has NO `slug` column (only `id` /
 * `name` / `codename` …). Selecting it made PostgREST throw 42703 at runtime —
 * crashing the WHOLE /allocations page into error.tsx (this read is in
 * page.tsx's Promise.all). The mocked unit tests pinned the phantom column and
 * stayed green over it. The WatchlistPanel links by `strategy_id`
 * (`/factsheet/${strategy_id}`) and displays `name`, so `slug` was never
 * rendered — it is dropped from the projection and contract entirely.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import type { OptimizerSuggestion } from "@/components/portfolio/PortfolioOptimizer";
import type { TrustTier } from "@/lib/design-tokens/trust-tier";
import { readPublicVerificationSignals } from "@/lib/queries";

/** Mirror of PortfolioOptimizer's internal (unexported) ComputationStatus. */
type ComputationStatus = "pending" | "computing" | "complete" | "failed" | null;

type SupabaseUserClient = SupabaseClient<Database>;

/** One favorited strategy, real columns only (nothing synthesized). */
export interface FavoriteRow {
  strategy_id: string;
  name: string;
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

/** Shape of one embedded user_favorites → strategies row (display fields). */
interface FavoriteJoinRow {
  strategy_id: string;
  created_at: string;
  strategies: {
    name: string;
  } | null;
}

/**
 * PI-05 — the allocator's watchlist: `user_favorites` (owner RLS) joined to
 * `strategies` for the display fields. Ordered most-recently-favorited first.
 * Returns [] for no favorites; THROWS on error.
 *
 * Phase 126-04 (FACTSHEET-01 hardening) — trust_tier is NO LONGER read via an
 * RLS-scoped `strategy_verifications` embed. `strategy_verifications` grants
 * SELECT to the OWNER only (migration 093), so the embed returned ZERO rows for
 * an allocator's favorited (NON-owner) strategies — the trust badge silently
 * vanished on the watchlist (same class as the public-factsheet gap fixed in
 * 126-01). trust_tier now comes from `readPublicVerificationSignals` (the DB
 * `get_published_trust_signals` SECURITY DEFINER primitive, migration 135):
 * published-gated, column-scoped, and readable by a non-owner. Locked decision
 * D-04 (trust_tier lives ONLY on strategy_verifications) is preserved — the
 * primitive is the single source of that signal.
 */
export async function getFavoritesWithStrategies(
  supabase: SupabaseUserClient,
  userId: string,
): Promise<FavoriteRow[]> {
  const { data, error } = await supabase
    .from("user_favorites")
    .select(`strategy_id, created_at, strategies!inner (name)`)
    .eq("user_id", userId)
    .order("created_at", { ascending: false });

  if (error) throw error;

  const rows = (data ?? []) as unknown as FavoriteJoinRow[];
  const present = rows.filter(
    (r): r is FavoriteJoinRow & { strategies: NonNullable<FavoriteJoinRow["strategies"]> } =>
      r.strategies != null,
  );

  // Batched public trust-signal read (published-gated, non-owner-readable).
  // Fail-soft: on error the map is empty → every tier resolves null → badges
  // hide, the watchlist still renders (readPublicVerificationSignals never
  // throws).
  const signals = await readPublicVerificationSignals(
    present.map((r) => r.strategy_id),
  );

  return present.map((r) => ({
    strategy_id: r.strategy_id,
    name: r.strategies.name,
    trust_tier: (signals.get(r.strategy_id)?.trust_tier ?? null) as TrustTier | null,
    created_at: r.created_at,
  }));
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
