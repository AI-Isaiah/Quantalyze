import { describe, it, expect, vi, beforeEach } from "vitest";

// snapshot.ts imports "server-only" which throws under vitest+jsdom.
// Mirrors the pattern in for-quants-leads-admin.test.ts.
vi.mock("server-only", () => ({}));

/**
 * Snapshot computation tests. Mocks the admin Supabase client so we can
 * pin the shape returned by computePortfolioSnapshot for /api/intro and
 * /admin/intros to read.
 *
 * Three contracts under test:
 *   1. No portfolio → returns the empty snapshot (all metrics null,
 *      empty top/bottom). The intro still goes through; the manager
 *      just has nothing to read.
 *   2. Full happy path → top/bottom by Sharpe, HHI from current_weight,
 *      alerts_last_7d from the count query.
 *   3. Falls back to allocated_amount for HHI when current_weight is
 *      missing on any link.
 */

type FromCallback = (table: string) => unknown;

const mockState = vi.hoisted(() => {
  return {
    fromImpl: null as FromCallback | null,
  };
});

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from(table: string) {
      if (!mockState.fromImpl) throw new Error("test must set mockState.fromImpl");
      return mockState.fromImpl(table);
    },
  }),
}));

import { computePortfolioSnapshot, PortfolioSnapshotSchema } from "./snapshot";

const USER_ID = "00000000-0000-0000-0000-000000000001";

beforeEach(() => {
  mockState.fromImpl = null;
});

describe("computePortfolioSnapshot — empty allocator", () => {
  it("returns null/empty snapshot for an allocator with no portfolio", async () => {
    mockState.fromImpl = (table) => {
      if (table === "portfolios") {
        return {
          select: () => ({
            eq: () => ({
              order: () => ({
                limit: () => ({
                  maybeSingle: async () => ({ data: null, error: null }),
                }),
              }),
            }),
          }),
        };
      }
      throw new Error(`unexpected from(${table})`);
    };

    const snap = await computePortfolioSnapshot(USER_ID);
    expect(snap).toEqual({
      sharpe: null,
      max_drawdown: null,
      concentration: null,
      top_3_strategies: [],
      bottom_3_strategies: [],
      alerts_last_7d: 0,
    });
    // Schema parses cleanly — guards against the writer drifting away from the
    // shape /api/intro stores.
    expect(() => PortfolioSnapshotSchema.parse(snap)).not.toThrow();
  });
});

describe("computePortfolioSnapshot — full happy path", () => {
  it("computes Sharpe/MDD/HHI/top/bottom + alerts from joined rows", async () => {
    const portfolioId = "00000000-0000-0000-0000-0000000000a0";
    const sa = "00000000-0000-0000-0000-00000000000a";
    const sb = "00000000-0000-0000-0000-00000000000b";
    const sc = "00000000-0000-0000-0000-00000000000c";
    const linkRows = [
      {
        strategy_id: sa,
        current_weight: 0.5,
        allocated_amount: 100,
        strategies: { id: sa, name: "Alpha" },
        strategy_analytics: { strategy_id: sa, sharpe: 2.5 },
      },
      {
        strategy_id: sb,
        current_weight: 0.3,
        allocated_amount: 60,
        strategies: { id: sb, name: "Beta" },
        strategy_analytics: { strategy_id: sb, sharpe: 1.0 },
      },
      {
        strategy_id: sc,
        current_weight: 0.2,
        allocated_amount: 40,
        strategies: { id: sc, name: "Gamma" },
        strategy_analytics: { strategy_id: sc, sharpe: -0.5 },
      },
    ];

    mockState.fromImpl = (table) => {
      if (table === "portfolios") {
        return {
          select: () => ({
            eq: () => ({
              order: () => ({
                limit: () => ({
                  maybeSingle: async () => ({ data: { id: portfolioId }, error: null }),
                }),
              }),
            }),
          }),
        };
      }
      if (table === "portfolio_analytics") {
        return {
          select: () => ({
            eq: () => ({
              order: () => ({
                limit: () => ({
                  maybeSingle: async () => ({
                    data: { portfolio_sharpe: 1.4, portfolio_max_drawdown: -0.18 },
                    error: null,
                  }),
                }),
              }),
            }),
          }),
        };
      }
      if (table === "portfolio_strategies") {
        return {
          select: () => ({
            eq: async () => ({ data: linkRows, error: null }),
          }),
        };
      }
      if (table === "portfolio_alerts") {
        return {
          select: () => ({
            eq: () => ({
              gte: async () => ({ data: null, count: 4, error: null }),
            }),
          }),
        };
      }
      throw new Error(`unexpected from(${table})`);
    };

    const snap = await computePortfolioSnapshot(USER_ID);

    expect(snap.sharpe).toBeCloseTo(1.4);
    expect(snap.max_drawdown).toBeCloseTo(-0.18);

    // HHI(0.5, 0.3, 0.2) = 0.25 + 0.09 + 0.04 = 0.38
    expect(snap.concentration).toBeCloseTo(0.38, 5);

    // Top 3 by Sharpe (descending)
    expect(snap.top_3_strategies.map((s) => s.strategy_name)).toEqual(["Alpha", "Beta", "Gamma"]);
    // Bottom 3: ranked desc [Alpha, Beta, Gamma], slice last 3 = same,
    // reversed → ["Gamma", "Beta", "Alpha"]
    expect(snap.bottom_3_strategies.map((s) => s.strategy_name)).toEqual(["Gamma", "Beta", "Alpha"]);

    expect(snap.alerts_last_7d).toBe(4);
    expect(() => PortfolioSnapshotSchema.parse(snap)).not.toThrow();
  });
});

describe("computePortfolioSnapshot — HHI fallback to allocated_amount", () => {
  it("falls back to allocated_amount when any current_weight is missing", async () => {
    const portfolioId = "00000000-0000-0000-0000-0000000000a1";
    const sa = "00000000-0000-0000-0000-00000000001a";
    const sb = "00000000-0000-0000-0000-00000000001b";
    const linkRows = [
      {
        strategy_id: sa,
        current_weight: null,
        allocated_amount: 100,
        strategies: { id: sa, name: "Alpha" },
        strategy_analytics: { strategy_id: sa, sharpe: 1.5 },
      },
      {
        strategy_id: sb,
        current_weight: null,
        allocated_amount: 100,
        strategies: { id: sb, name: "Beta" },
        strategy_analytics: { strategy_id: sb, sharpe: 0.8 },
      },
    ];

    mockState.fromImpl = (table) => {
      if (table === "portfolios") {
        return {
          select: () => ({
            eq: () => ({
              order: () => ({
                limit: () => ({
                  maybeSingle: async () => ({ data: { id: portfolioId }, error: null }),
                }),
              }),
            }),
          }),
        };
      }
      if (table === "portfolio_analytics") {
        return {
          select: () => ({
            eq: () => ({
              order: () => ({
                limit: () => ({
                  maybeSingle: async () => ({ data: null, error: null }),
                }),
              }),
            }),
          }),
        };
      }
      if (table === "portfolio_strategies") {
        return {
          select: () => ({
            eq: async () => ({ data: linkRows, error: null }),
          }),
        };
      }
      if (table === "portfolio_alerts") {
        return {
          select: () => ({
            eq: () => ({
              gte: async () => ({ data: null, count: 0, error: null }),
            }),
          }),
        };
      }
      throw new Error(`unexpected from(${table})`);
    };

    const snap = await computePortfolioSnapshot(USER_ID);

    // Equal allocation → HHI = 0.5
    expect(snap.concentration).toBeCloseTo(0.5, 5);
    // Top sorted by sharpe
    expect(snap.top_3_strategies.map((s) => s.strategy_name)).toEqual(["Alpha", "Beta"]);
  });
});
