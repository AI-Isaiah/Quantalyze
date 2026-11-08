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

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { figureRecord } from "@/lib/figure-gate";
import { RECORD_SCALAR_ALIASES } from "@/lib/figure-record-scalars";
import { computePortfolioSnapshot, PortfolioSnapshotSchema, toSnapshotRecord } from "./snapshot";

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
              eq: () => ({
                order: () => ({
                  limit: () => ({
                    maybeSingle: async () => ({ data: null, error: null }),
                  }),
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
      sharpe_record: null,
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

describe("computePortfolioSnapshot — G8.E.1 is_test filter", () => {
  it("only matches portfolios where is_test=false (excludes saved scenarios)", async () => {
    // Pre-fix this query landed on the most-recently-created portfolio
    // regardless of is_test. After the v0.4.0 pivot, allocators can save
    // what-if scenarios as is_test=true portfolios — and the snapshot
    // would then leak hypothetical KPIs to the manager. This test pins
    // the .eq('is_test', false) filter at the mock layer: the chain
    // builder counts how many .eq() calls land before the order/limit/
    // maybeSingle terminator and what columns they target.
    const eqCalls: Array<[string, unknown]> = [];

    mockState.fromImpl = (table) => {
      if (table === "portfolios") {
        const buildChain = () => {
          const api: {
            eq: (col: string, val: unknown) => typeof api;
            order: () => typeof orderApi;
          } = {
            eq(col, val) {
              eqCalls.push([col, val]);
              return api;
            },
            order: () => orderApi,
          };
          const orderApi = {
            limit: () => ({
              maybeSingle: async () => ({ data: null, error: null }),
            }),
          };
          return api;
        };
        return {
          select: () => buildChain(),
        };
      }
      throw new Error(`unexpected from(${table})`);
    };

    const snap = await computePortfolioSnapshot(USER_ID);
    // Both filters fired in the right shape — user_id AND is_test=false.
    expect(eqCalls).toContainEqual(["user_id", USER_ID]);
    expect(eqCalls).toContainEqual(["is_test", false]);
    // No portfolio → empty-shape snapshot.
    expect(snap.top_3_strategies).toEqual([]);
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
              eq: () => ({
                order: () => ({
                  limit: () => ({
                    maybeSingle: async () => ({ data: { id: portfolioId }, error: null }),
                  }),
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
              eq: () => ({
                order: () => ({
                  limit: () => ({
                    maybeSingle: async () => ({ data: { id: portfolioId }, error: null }),
                  }),
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

/**
 * Phase 194.1 B12c (194 D-12 / D-15) - each frozen Sharpe carries the record it was computed
 * on. Expected records are typed by hand; dates come from `endAfter` (start plus `days - 1`,
 * D-20: both ends counted).
 *
 * Neuter to redden: drop the `.slice(0, 10)` on the book dates in `snapshot.ts` (a datetime
 * is not a yyyy-mm-dd date, so the book reads unreadable and the 200-day case fails).
 */
describe("computePortfolioSnapshot - frozen Sharpe records (194.1 B12c)", () => {
  const START = "2026-01-01";
  function endAfter(days: number): string {
    const d = new Date(`${START}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + days - 1);
    return d.toISOString().slice(0, 10);
  }
  const PORTFOLIO_ID = "00000000-0000-0000-0000-0000000000b0";

  type Leg = {
    id: string;
    name: string;
    sharpe: number | null;
    assetClass: string | null | undefined;
    aliases?: Record<string, unknown>;
  };

  function install(
    legs: Leg[],
    curve: { start: string | null; end: string | null } | null,
    captured: { strategiesSelect?: string; analyticsSelect?: string } = {},
  ) {
    const linkRows = legs.map((l) => ({
      strategy_id: l.id,
      current_weight: 1 / legs.length,
      allocated_amount: 100,
      strategies:
        l.assetClass === undefined ? { id: l.id, name: l.name } : { id: l.id, name: l.name, asset_class: l.assetClass },
      strategy_analytics: { strategy_id: l.id, sharpe: l.sharpe, ...(l.aliases ?? {}) },
    }));
    mockState.fromImpl = (table) => {
      if (table === "portfolios") {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                order: () => ({
                  limit: () => ({
                    maybeSingle: async () => ({ data: { id: PORTFOLIO_ID }, error: null }),
                  }),
                }),
              }),
            }),
          }),
        };
      }
      if (table === "portfolio_analytics") {
        return {
          select: (cols: string) => {
            captured.analyticsSelect = cols;
            return {
              eq: () => ({
                order: () => ({
                  limit: () => ({
                    maybeSingle: async () => ({
                      data: {
                        portfolio_sharpe: 1.4,
                        portfolio_max_drawdown: -0.18,
                        curve_start: curve?.start ?? null,
                        curve_end: curve?.end ?? null,
                      },
                      error: null,
                    }),
                  }),
                }),
              }),
            };
          },
        };
      }
      if (table === "portfolio_strategies") {
        return {
          select: (cols: string) => {
            captured.strategiesSelect = cols;
            return { eq: async () => ({ data: linkRows, error: null }) };
          },
        };
      }
      if (table === "portfolio_alerts") {
        return {
          select: () => ({ eq: () => ({ gte: async () => ({ data: null, count: 0, error: null }) }) }),
        };
      }
      throw new Error(`unexpected from(${table})`);
    };
  }

  const aliases40 = { series_start: START, series_end: endAfter(40), headline_since: null, record_observations: 38 };

  it("freezes a 40-day crypto leg's record beside its Sharpe and leaves Sharpe and rank alone", async () => {
    install(
      [
        { id: "s-a", name: "Alpha", sharpe: 2.5, assetClass: "crypto", aliases: aliases40 },
        { id: "s-b", name: "Beta", sharpe: 1.0, assetClass: "traditional", aliases: { ...aliases40, record_observations: 59 } },
      ],
      { start: `${START}T00:00:00`, end: `${endAfter(200)}T00:00:00` },
    );
    const snap = await computePortfolioSnapshot(USER_ID);

    expect(snap.top_3_strategies.map((s) => [s.strategy_name, s.sharpe])).toEqual([
      ["Alpha", 2.5],
      ["Beta", 1.0],
    ]);
    expect(snap.top_3_strategies[0].sharpe_record).toEqual({ span_days: 40, observations: 38, crypto: true });
    expect(snap.top_3_strategies[1].sharpe_record).toEqual({ span_days: 40, observations: 59, crypto: false });
    expect(snap.bottom_3_strategies.map((s) => s.strategy_name)).toEqual(["Beta", "Alpha"]);
  });

  it("freezes a null count as null and a record-less leg as an unknown record", async () => {
    install(
      [
        { id: "s-a", name: "Alpha", sharpe: 2.5, assetClass: "crypto", aliases: { ...aliases40, record_observations: null } },
        { id: "s-b", name: "Beta", sharpe: 1.0, assetClass: "crypto" },
      ],
      null,
    );
    const snap = await computePortfolioSnapshot(USER_ID);
    expect(snap.top_3_strategies[0].sharpe_record).toEqual({ span_days: 40, observations: null, crypto: true });
    expect(snap.top_3_strategies[1].sharpe_record).toEqual({ span_days: null, observations: null, crypto: true });
  });

  it("freezes the book's record from the equity-curve dates, cut to yyyy-mm-dd, with no count", async () => {
    install(
      [{ id: "s-a", name: "Alpha", sharpe: 2.5, assetClass: "crypto", aliases: aliases40 }],
      { start: `${START}T00:00:00`, end: `${endAfter(200)}T00:00:00` },
    );
    const snap = await computePortfolioSnapshot(USER_ID);
    expect(snap.sharpe).toBeCloseTo(1.4);
    expect(snap.sharpe_record).toEqual({ span_days: 200, observations: null, crypto: true });
  });

  it("a book of one crypto and one traditional leg is crypto; two traditional legs are not", async () => {
    const curve = { start: `${START}T00:00:00`, end: `${endAfter(200)}T00:00:00` };
    install(
      [
        { id: "s-a", name: "Alpha", sharpe: 2.5, assetClass: "crypto", aliases: aliases40 },
        { id: "s-b", name: "Beta", sharpe: 1.0, assetClass: "traditional", aliases: aliases40 },
      ],
      curve,
    );
    expect((await computePortfolioSnapshot(USER_ID)).sharpe_record?.crypto).toBe(true);

    install(
      [
        { id: "s-a", name: "Alpha", sharpe: 2.5, assetClass: "traditional", aliases: aliases40 },
        { id: "s-b", name: "Beta", sharpe: 1.0, assetClass: "traditional", aliases: aliases40 },
      ],
      curve,
    );
    expect((await computePortfolioSnapshot(USER_ID)).sharpe_record?.crypto).toBe(false);
  });

  it("a leg whose asset class is unknown makes the book crypto (the blend rule)", async () => {
    install(
      [
        { id: "s-a", name: "Alpha", sharpe: 2.5, assetClass: "traditional", aliases: aliases40 },
        { id: "s-b", name: "Beta", sharpe: 1.0, assetClass: null, aliases: aliases40 },
      ],
      { start: `${START}T00:00:00`, end: `${endAfter(200)}T00:00:00` },
    );
    expect((await computePortfolioSnapshot(USER_ID)).sharpe_record?.crypto).toBe(true);
  });

  it("a book with no equity curve freezes an unknown span, never a verdict", async () => {
    install([{ id: "s-a", name: "Alpha", sharpe: 2.5, assetClass: "crypto", aliases: aliases40 }], null);
    const snap = await computePortfolioSnapshot(USER_ID);
    expect(snap.sharpe_record).toEqual({ span_days: null, observations: null, crypto: true });
  });

  it("a curve date that is present but not a date freezes unreadable", async () => {
    install(
      [{ id: "s-a", name: "Alpha", sharpe: 2.5, assetClass: "crypto", aliases: aliases40 }],
      { start: `${START}T00:00:00`, end: "not-a-date" },
    );
    const snap = await computePortfolioSnapshot(USER_ID);
    expect(snap.sharpe_record).toMatchObject({ unreadable: true });
  });

  it("reads the four record scalars, the asset class and the curve ends", async () => {
    const captured: { strategiesSelect?: string; analyticsSelect?: string } = {};
    install([{ id: "s-a", name: "Alpha", sharpe: 2.5, assetClass: "crypto", aliases: aliases40 }], null, captured);
    await computePortfolioSnapshot(USER_ID);
    expect(captured.strategiesSelect).toContain(RECORD_SCALAR_ALIASES);
    expect(captured.strategiesSelect).toContain("asset_class");
    expect(captured.analyticsSelect).toContain("curve_start:portfolio_equity_curve->0->>date");
    expect(captured.analyticsSelect).toContain("curve_end:portfolio_equity_curve->-1->>date");
  });

  it("a snapshot frozen before this phase (no record anywhere) still parses", () => {
    const legacy = {
      sharpe: 1.1,
      max_drawdown: -0.1,
      concentration: 0.5,
      top_3_strategies: [{ strategy_id: "s", strategy_name: "A", sharpe: 1.2 }],
      bottom_3_strategies: [],
      alerts_last_7d: 0,
    };
    const parsed = PortfolioSnapshotSchema.parse(legacy);
    expect(parsed.sharpe_record).toBeUndefined();
    expect(parsed.top_3_strategies[0].sharpe_record).toBeUndefined();
  });
});

/**
 * Phase 194.1 B12c - the TS producer's record helper against the ONE fixture the Python
 * producer's pytest (`analytics-service/tests/test_intro_snapshot_record.py`) also asserts, so
 * the two writers of `contact_requests.portfolio_snapshot` cannot freeze different records for
 * the same inputs. The fixture's expected records are hand-counted.
 *
 * Neuter to redden (from a byte backup of `analytics-service/services/metrics.py`): drop the
 * `+ 1` in `figure_record_from_scalars`' span; the 40-day case fails in the pytest AND, once
 * `coveredDays` in `figure-gate.ts` is neutered the same way, here.
 */
type ParityCase = {
  name: string;
  input: {
    series_start: string | null;
    series_end: string | null;
    headline_since: string | null;
    record_observations: unknown;
    crypto: boolean;
  };
  expected: Record<string, unknown>;
};

const PARITY = JSON.parse(
  readFileSync(
    resolve(process.cwd(), "analytics-service/tests/fixtures/intro_snapshot_record_parity.json"),
    "utf8",
  ),
) as { aliases: string; cases: ParityCase[] };

describe("toSnapshotRecord - parity with the Python producer (194.1 B12c)", () => {
  it("reads the same alias string as the Python producer", () => {
    expect(RECORD_SCALAR_ALIASES).toBe(PARITY.aliases);
  });

  it("the fixture is non-empty (a vacuous loop would pass)", () => {
    expect(PARITY.cases.length).toBeGreaterThanOrEqual(8);
  });

  it.each(PARITY.cases.map((c) => [c.name, c] as const))("freezes %s", (_name, c) => {
    const record = toSnapshotRecord(
      figureRecord({
        seriesStart: c.input.series_start,
        seriesEnd: c.input.series_end,
        headlineSince: c.input.headline_since,
        observations: c.input.record_observations as number | null,
        periodsPerYear: c.input.crypto ? 365 : 252,
      }),
    );
    expect(record).toEqual(c.expected);
  });
});
