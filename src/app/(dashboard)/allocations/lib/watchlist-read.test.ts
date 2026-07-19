/**
 * Phase 100 / Plan 02 / Task 1 — colocated unit tests for watchlist-read.ts.
 *
 * These cover the BRANCH-HEAVY read paths the render tests (WatchlistPanel /
 * OptimizerPanel) will NOT exercise. The branch ratchet (`branches 72`) is
 * enforced at wave-2 (plan 100-04), where this server module can't be cleanly
 * fixed, so the coverage lives here:
 *   (a) THROW on a PostgREST error for BOTH reads (never collapse error → []),
 *   (b) 0-portfolio path → { portfolios: [], defaultPortfolioId: null, … },
 *   (c) the default-portfolio pick (most-recent among ≥2 portfolios),
 *   (d) 0-favorites → [].
 *
 * The mock honours `.order()` + `.limit()` so the default-pick test can seed
 * portfolios OUT of order and still prove the read orders by created_at desc.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";

// Phase 126-04: the watchlist trust_tier now comes from the published-gated DB
// primitive via readPublicVerificationSignals (queries.ts), NOT an owner-only
// RLS strategy_verifications embed. Mock the helper so these unit tests feed the
// signal directly and pin that getFavoritesWithStrategies routes trust_tier
// through it (keyed by strategy_id).
const trustSignals = vi.hoisted(
  () => new Map<string, { trust_tier: string | null; status: string | null }>(),
);
const readSignalsMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/queries", () => ({
  readPublicVerificationSignals: readSignalsMock,
}));

import {
  getFavoritesWithStrategies,
  getOptimizerPrefetch,
} from "./watchlist-read";

type Resp = { data: unknown; error: { message: string } | null };

beforeEach(() => {
  trustSignals.clear();
  readSignalsMock.mockReset();
  // Default: return the signals seeded per-test, keyed by requested id.
  readSignalsMock.mockImplementation(async (ids: readonly string[]) => {
    const out = new Map<
      string,
      { trust_tier: string | null; status: string | null }
    >();
    for (const id of ids) {
      const s = trustSignals.get(id);
      if (s) out.set(id, s);
    }
    return out;
  });
});

/**
 * A minimal chainable Supabase stand-in that routes each `.from(table)` to a
 * pre-canned response, and — for array responses — HONOURS `.order()` /
 * `.limit()` so ordering-dependent assertions are real, not delegated away.
 */
function makeClient(
  config: Record<string, Resp>,
  captures?: { selects: string[] },
): SupabaseClient<Database> {
  function from(table: string) {
    const resp = config[table];
    if (!resp) throw new Error(`unexpected table read: ${table}`);
    const state: { orderCol: string | null; asc: boolean; limit?: number } = {
      orderCol: null,
      asc: true,
    };

    function compute(): { rows: unknown; error: { message: string } | null } {
      if (resp.error) return { rows: null, error: resp.error };
      let rows = resp.data;
      if (Array.isArray(rows) && state.orderCol) {
        const col = state.orderCol;
        rows = [...rows].sort((a, b) => {
          const av = String((a as Record<string, unknown>)[col]);
          const bv = String((b as Record<string, unknown>)[col]);
          return av.localeCompare(bv) * (state.asc ? 1 : -1);
        });
      }
      if (Array.isArray(rows) && state.limit != null) {
        rows = rows.slice(0, state.limit);
      }
      return { rows, error: null };
    }

    const builder = {
      select: (projection?: string) => {
        if (captures && typeof projection === "string")
          captures.selects.push(projection);
        return builder;
      },
      eq: () => builder,
      order: (col: string, opts?: { ascending?: boolean }) => {
        state.orderCol = col;
        state.asc = opts?.ascending ?? true;
        return builder;
      },
      limit: (n: number) => {
        state.limit = n;
        return builder;
      },
      maybeSingle: () => {
        const { rows, error } = compute();
        const data = error
          ? null
          : Array.isArray(rows)
            ? (rows[0] ?? null)
            : rows;
        return Promise.resolve({ data, error });
      },
      then<T>(resolve: (v: { data: unknown; error: unknown }) => T): Promise<T> {
        const { rows, error } = compute();
        return Promise.resolve().then(() =>
          resolve({ data: error ? null : rows, error }),
        );
      },
    };
    return builder;
  }
  return { from } as unknown as SupabaseClient<Database>;
}

const USER = "11111111-1111-1111-1111-111111111111";

function favoriteRow(overrides: {
  strategy_id: string;
  created_at: string;
  name: string;
}) {
  return {
    strategy_id: overrides.strategy_id,
    created_at: overrides.created_at,
    strategies: {
      name: overrides.name,
    },
  };
}

describe("getFavoritesWithStrategies", () => {
  it("(a) THROWS on a PostgREST error — never collapses to []", async () => {
    const client = makeClient({
      user_favorites: { data: null, error: { message: "boom" } },
    });
    await expect(getFavoritesWithStrategies(client, USER)).rejects.toEqual({
      message: "boom",
    });
  });

  it("(d) returns [] for a user with no favorites", async () => {
    const client = makeClient({ user_favorites: { data: [], error: null } });
    await expect(getFavoritesWithStrategies(client, USER)).resolves.toEqual([]);
  });

  it("maps real columns + sources trust_tier from the published-gated primitive (keyed by strategy_id)", async () => {
    // Phase 126-04: the published-gated DB primitive resolves the tier for a
    // NON-owner allocator (the owner-only RLS embed returned zero rows → badge
    // vanished). The helper returns the latest tier already; the read is keyed
    // by strategy_id.
    trustSignals.set("s-1", { trust_tier: "api_verified", status: "active" });
    const client = makeClient({
      user_favorites: {
        data: [
          favoriteRow({
            strategy_id: "s-1",
            created_at: "2026-06-01T00:00:00Z",
            name: "Alpha",
          }),
        ],
        error: null,
      },
    });
    const rows = await getFavoritesWithStrategies(client, USER);
    expect(rows).toEqual([
      {
        strategy_id: "s-1",
        name: "Alpha",
        trust_tier: "api_verified",
        created_at: "2026-06-01T00:00:00Z",
      },
    ]);
    // The tier came through the published-gated primitive, keyed on the
    // favorited strategy ids — NOT an RLS strategy_verifications embed.
    expect(readSignalsMock).toHaveBeenCalledWith(["s-1"]);
  });

  // Regression (v1.10 e2e-seeded): the embedded `strategies` projection MUST
  // reference only columns that EXIST on public.strategies. A prior revision
  // selected a phantom `strategies.slug`, which PostgREST rejects with 42703 at
  // runtime — crashing the whole /allocations page (this read is in page.tsx's
  // Promise.all) into error.tsx. Phase 126-04: the projection also MUST NOT
  // re-embed `strategy_verifications` (owner-only RLS → zero rows for non-owner
  // favorites → vanished badge). This test captures the actual select and fails
  // loud on either a phantom slug OR a re-added verification embed.
  it("projects only real strategies columns (no phantom slug, no RLS verification embed)", async () => {
    const captures = { selects: [] as string[] };
    const client = makeClient(
      { user_favorites: { data: [], error: null } },
      captures,
    );
    await getFavoritesWithStrategies(client, USER);
    const strategiesEmbed = captures.selects.find((s) =>
      s.includes("strategies"),
    );
    expect(strategiesEmbed).toBeDefined();
    // `slug` is NOT a column on public.strategies (id / name / codename …).
    expect(strategiesEmbed).not.toMatch(/\bslug\b/);
    // The owner-only RLS embed is GONE — trust_tier now routes through the
    // published-gated primitive (keeps a non-owner from losing the badge).
    expect(strategiesEmbed).not.toMatch(/strategy_verifications/);
  });

  it("yields trust_tier null when the primitive returns no signal (unverified / non-published)", async () => {
    // No signal seeded for s-2 → the primitive's map has no entry → null tier.
    const client = makeClient({
      user_favorites: {
        data: [
          favoriteRow({
            strategy_id: "s-2",
            created_at: "2026-06-02T00:00:00Z",
            name: "Beta",
          }),
        ],
        error: null,
      },
    });
    const rows = await getFavoritesWithStrategies(client, USER);
    expect(rows[0].trust_tier).toBeNull();
  });
});

describe("getOptimizerPrefetch", () => {
  it("(a) THROWS when the portfolios read errors", async () => {
    const client = makeClient({
      portfolios: { data: null, error: { message: "pg down" } },
    });
    await expect(getOptimizerPrefetch(client, USER)).rejects.toEqual({
      message: "pg down",
    });
  });

  it("THROWS when the analytics read errors (default portfolio present)", async () => {
    const client = makeClient({
      portfolios: {
        data: [{ id: "p-1", name: "Book", created_at: "2026-06-01T00:00:00Z" }],
        error: null,
      },
      portfolio_analytics: { data: null, error: { message: "analytics down" } },
    });
    await expect(getOptimizerPrefetch(client, USER)).rejects.toEqual({
      message: "analytics down",
    });
  });

  it("(b) 0 portfolios → empty portfolios + null default + null suggestions", async () => {
    const client = makeClient({ portfolios: { data: [], error: null } });
    await expect(getOptimizerPrefetch(client, USER)).resolves.toEqual({
      portfolios: [],
      defaultPortfolioId: null,
      initialSuggestions: null,
      computedAt: null,
      computationStatus: null,
    });
  });

  it("(c) picks the MOST-RECENT portfolio as default among ≥2 (seeded out of order)", async () => {
    const suggestions = [
      {
        strategy_id: "s-9",
        strategy_name: "Nine",
        corr_with_portfolio: -0.2,
        sharpe_lift: 0.3,
        dd_improvement: 0.1,
        score: 0.8,
      },
    ];
    const client = makeClient({
      portfolios: {
        // Deliberately NOT in created_at order — the read must sort desc.
        data: [
          { id: "p-old", name: "Old", created_at: "2026-01-01T00:00:00Z" },
          { id: "p-new", name: "New", created_at: "2026-06-01T00:00:00Z" },
          { id: "p-mid", name: "Mid", created_at: "2026-03-01T00:00:00Z" },
        ],
        error: null,
      },
      portfolio_analytics: {
        data: [
          {
            optimizer_suggestions: suggestions,
            computed_at: "2026-06-02T00:00:00Z",
            computation_status: "complete",
          },
        ],
        error: null,
      },
    });
    const result = await getOptimizerPrefetch(client, USER);
    expect(result.defaultPortfolioId).toBe("p-new");
    expect(result.portfolios[0].id).toBe("p-new");
    expect(result.initialSuggestions).toEqual(suggestions);
    expect(result.computedAt).toBe("2026-06-02T00:00:00Z");
    expect(result.computationStatus).toBe("complete");
  });

  it("returns null suggestions when the default portfolio has no analytics row", async () => {
    const client = makeClient({
      portfolios: {
        data: [{ id: "p-1", name: "Book", created_at: "2026-06-01T00:00:00Z" }],
        error: null,
      },
      portfolio_analytics: { data: [], error: null },
    });
    const result = await getOptimizerPrefetch(client, USER);
    expect(result.defaultPortfolioId).toBe("p-1");
    expect(result.initialSuggestions).toBeNull();
    expect(result.computedAt).toBeNull();
    expect(result.computationStatus).toBeNull();
  });
});
