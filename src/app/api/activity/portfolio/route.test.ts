import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const TEST_USER = { id: "00000000-0000-0000-0000-aaaaaaaaaaaa" };
const PORTFOLIO_ID = "pppppppp-pppp-pppp-pppp-pppppppppppp";

const { mockFrom, mockAdminFrom, ownerResult } = vi.hoisted(() => ({
  mockFrom: vi.fn(),
  mockAdminFrom: vi.fn(),
  ownerResult: { data: null as Record<string, string> | null },
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: {
      getUser: async () => ({ data: { user: TEST_USER }, error: null }),
    },
    from: mockFrom,
  }),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: mockAdminFrom,
  }),
}));

function makeReq(params: Record<string, string> = {}) {
  const url = new URL("http://localhost:3000/api/activity/portfolio");
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return new NextRequest(url.toString(), { method: "GET" });
}

describe("GET /api/activity/portfolio", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    ownerResult.data = { id: PORTFOLIO_ID, user_id: TEST_USER.id };

    mockFrom.mockReturnValue({
      select: () => ({
        eq: () => ({
          eq: () => ({
            single: async () => ownerResult,
          }),
        }),
      }),
    });

    // Admin client: portfolio_strategies query
    //
    // Audit 2026-05-07 G12.G.3: the route now issues up to THREE queries
    // against `trades`:
    //   1. fill-strategies probe: .select("strategy_id").in().eq("is_fill", true)
    //   2. fills subset: .select(<cols>).in().eq("is_fill", true).order().limit()
    //   3. daily subset: .select(<cols>).in().eq("is_fill", false).order().limit()
    // Each strategy belongs to exactly one of #2 or #3 based on the
    // probe — no cross-strategy data cliff anymore.
    mockAdminFrom.mockImplementation((table: string) => {
      if (table === "portfolio_strategies") {
        return {
          select: () => ({
            eq: () => ({
              data: [
                { strategy_id: "s1", strategies: { name: "Alpha" } },
              ],
              error: null,
            }),
          }),
        };
      }
      if (table === "trades") {
        const tradeData = [
          {
            timestamp: "2026-04-10T12:00:00Z",
            strategy_id: "s1",
            symbol: "BTCUSDT",
            realized_pnl: 100.5,
            exchange: "binance",
          },
        ];
        return {
          select: (cols: string) => {
            // Probe query: select("strategy_id").in().eq("is_fill", true).
            // Identifies which strategies have any fills. By default the
            // probe returns no rows, so all strategies fall through to
            // the daily (is_fill=false) subset query.
            if (typeof cols === "string" && cols === "strategy_id") {
              return {
                in: () => ({
                  eq: () => ({
                    data: [],
                    error: null,
                  }),
                }),
              };
            }
            // Trades subset query: .select(<cols>).in().eq().order().limit()
            return {
              in: () => ({
                eq: () => ({
                  order: () => ({
                    limit: () => ({
                      data: tradeData,
                      error: null,
                    }),
                  }),
                }),
              }),
            };
          },
        };
      }
      return { select: () => ({ eq: () => ({ data: null, error: null }) }) };
    });
  });

  it("returns activity and volumeByDay for valid portfolio", async () => {
    const { GET } = await import("./route");
    const res = await GET(makeReq({ portfolio_id: PORTFOLIO_ID }));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.activity).toHaveLength(1);
    expect(body.activity[0].pnl_usd).toBe(100.5);
    expect(body.volumeByDay).toHaveLength(1);
  });

  it("returns 403 for foreign portfolio", async () => {
    ownerResult.data = null;

    const { GET } = await import("./route");
    const res = await GET(makeReq({ portfolio_id: PORTFOLIO_ID }));

    expect(res.status).toBe(403);
  });

  it("returns 400 for missing portfolio_id", async () => {
    const { GET } = await import("./route");
    const res = await GET(makeReq());

    expect(res.status).toBe(400);
  });

  it("returns empty arrays for portfolio with no strategies", async () => {
    mockAdminFrom.mockImplementation((table: string) => {
      if (table === "portfolio_strategies") {
        return {
          select: () => ({
            eq: () => ({ data: [], error: null }),
          }),
        };
      }
      return { select: () => ({ eq: () => ({ data: null, error: null }) }) };
    });

    const { GET } = await import("./route");
    const res = await GET(makeReq({ portfolio_id: PORTFOLIO_ID }));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.activity).toEqual([]);
    expect(body.volumeByDay).toEqual([]);
  });

  /**
   * Audit 2026-05-07 G12.G.6 regression: the pre-audit route ignored the
   * `error` field on every Supabase response, so an RLS regression or a
   * transient DB failure silently returned `{ activity: [], volumeByDay:
   * [], has_fills: false }` — indistinguishable from a portfolio that
   * genuinely has no strategies. The widget hid its "Now showing fills"
   * footnote inappropriately and operators got no signal. After the fix,
   * each query checks .error and bails to a structured 500.
   */
  it("returns 500 when portfolio_strategies query errors (audit G12.G.6)", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const consoleErr = vi.spyOn(console, "error").mockImplementation(() => {});

    mockAdminFrom.mockImplementation((table: string) => {
      if (table === "portfolio_strategies") {
        return {
          select: () => ({
            eq: () => ({
              data: null,
              error: { message: "rls denied", code: "PGRST301" },
            }),
          }),
        };
      }
      return { select: () => ({ eq: () => ({ data: null, error: null }) }) };
    });

    const { GET } = await import("./route");
    const res = await GET(makeReq({ portfolio_id: PORTFOLIO_ID }));

    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toBeTruthy();
    // Operators MUST see the error in the server log so on-call has a
    // searchable signature distinct from the empty-portfolio path.
    expect(consoleErr).toHaveBeenCalled();
    consoleErr.mockRestore();
  });

  it("returns 500 when fill-strategies probe query errors (audit G12.G.6)", async () => {
    const consoleErr = vi.spyOn(console, "error").mockImplementation(() => {});

    mockAdminFrom.mockImplementation((table: string) => {
      if (table === "portfolio_strategies") {
        return {
          select: () => ({
            eq: () => ({
              data: [{ strategy_id: "s1", strategies: { name: "Alpha" } }],
              error: null,
            }),
          }),
        };
      }
      if (table === "trades") {
        return {
          select: (cols: string) => {
            if (typeof cols === "string" && cols === "strategy_id") {
              return {
                in: () => ({
                  eq: () => ({
                    data: null,
                    error: { message: "DB unreachable", code: "PGRST500" },
                  }),
                }),
              };
            }
            return {
              in: () => ({
                eq: () => ({
                  order: () => ({
                    limit: () => ({ data: [], error: null }),
                  }),
                }),
              }),
            };
          },
        };
      }
      return { select: () => ({ eq: () => ({ data: null, error: null }) }) };
    });

    const { GET } = await import("./route");
    const res = await GET(makeReq({ portfolio_id: PORTFOLIO_ID }));

    expect(res.status).toBe(500);
    expect(consoleErr).toHaveBeenCalled();
    consoleErr.mockRestore();
  });

  it("returns 500 when trades subset query errors (audit G12.G.6)", async () => {
    const consoleErr = vi.spyOn(console, "error").mockImplementation(() => {});

    mockAdminFrom.mockImplementation((table: string) => {
      if (table === "portfolio_strategies") {
        return {
          select: () => ({
            eq: () => ({
              data: [{ strategy_id: "s1", strategies: { name: "Alpha" } }],
              error: null,
            }),
          }),
        };
      }
      if (table === "trades") {
        return {
          select: (cols: string) => {
            // Probe succeeds (no fills); subsequent daily-subset query fails.
            if (typeof cols === "string" && cols === "strategy_id") {
              return {
                in: () => ({
                  eq: () => ({ data: [], error: null }),
                }),
              };
            }
            return {
              in: () => ({
                eq: () => ({
                  order: () => ({
                    limit: () => ({
                      data: null,
                      error: { message: "timeout", code: "PGRST504" },
                    }),
                  }),
                }),
              }),
            };
          },
        };
      }
      return { select: () => ({ eq: () => ({ data: null, error: null }) }) };
    });

    const { GET } = await import("./route");
    const res = await GET(makeReq({ portfolio_id: PORTFOLIO_ID }));

    expect(res.status).toBe(500);
    expect(consoleErr).toHaveBeenCalled();
    consoleErr.mockRestore();
  });

  /**
   * Audit 2026-05-07 G12.G.3 regression: pre-audit code computed a single
   * portfolio-level `hasFills` and applied `.eq("is_fill", hasFills)` to
   * the entire IN list of strategies. The moment ONE strategy ingested
   * its first fill, the API stopped returning legacy daily_pnl rows for
   * ALL other strategies in the same portfolio — a sudden data cliff in
   * the TradingActivityLog and TradeVolume widgets.
   *
   * After the fix, the route partitions strategies into "with fills"
   * and "without fills" subsets and runs two queries: each strategy
   * gets its appropriate trade rows.
   *
   * Test setup: portfolio has strategy 's1' (with fills) and 's2'
   * (without fills, only legacy daily_pnl rows). Both should appear in
   * the response. Pre-audit code would have returned only 's1' rows.
   */
  it("returns rows for both fill-mode and daily_pnl-mode strategies in same portfolio (audit G12.G.3)", async () => {
    mockAdminFrom.mockImplementation((table: string) => {
      if (table === "portfolio_strategies") {
        return {
          select: () => ({
            eq: () => ({
              data: [
                { strategy_id: "s1", strategies: { name: "FillStrategy" } },
                { strategy_id: "s2", strategies: { name: "DailyStrategy" } },
              ],
              error: null,
            }),
          }),
        };
      }
      if (table === "trades") {
        return {
          select: (cols: string) => {
            // Probe: s1 has fills, s2 does not.
            if (typeof cols === "string" && cols === "strategy_id") {
              return {
                in: () => ({
                  eq: () => ({
                    data: [{ strategy_id: "s1" }],
                    error: null,
                  }),
                }),
              };
            }
            // Subset queries: track the eq() arg to differentiate.
            // The fills subset (.eq("is_fill", true)) returns s1's row.
            // The daily subset (.eq("is_fill", false)) returns s2's row.
            return {
              in: () => ({
                eq: (col: string, val: boolean) => ({
                  order: () => ({
                    limit: () => ({
                      data:
                        col === "is_fill" && val === true
                          ? [
                              {
                                timestamp: "2026-04-10T12:00:00Z",
                                strategy_id: "s1",
                                symbol: "BTCUSDT",
                                realized_pnl: 200,
                                exchange: "binance",
                              },
                            ]
                          : [
                              {
                                timestamp: "2026-04-09T12:00:00Z",
                                strategy_id: "s2",
                                symbol: "ETHUSDT",
                                realized_pnl: 50,
                                exchange: "binance",
                              },
                            ],
                      error: null,
                    }),
                  }),
                }),
              }),
            };
          },
        };
      }
      return { select: () => ({ eq: () => ({ data: null, error: null }) }) };
    });

    const { GET } = await import("./route");
    const res = await GET(makeReq({ portfolio_id: PORTFOLIO_ID }));

    expect(res.status).toBe(200);
    const body = await res.json();
    // Both strategies must have rows in the response. Pre-audit code
    // would have dropped s2 entirely once s1 had any fills.
    const strategyIdsInResponse = new Set(
      body.activity.map((row: { strategy_id: string }) => row.strategy_id),
    );
    expect(strategyIdsInResponse.has("s1")).toBe(true);
    expect(strategyIdsInResponse.has("s2")).toBe(true);
    // has_fills aggregate stays true because at least one strategy has fills.
    expect(body.has_fills).toBe(true);
  });
});
