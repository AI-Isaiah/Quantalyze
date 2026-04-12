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
        return {
          select: () => ({
            in: () => ({
              order: () => ({
                limit: () => ({
                  data: [
                    {
                      timestamp: "2026-04-10T12:00:00Z",
                      strategy_id: "s1",
                      symbol: "BTCUSDT",
                      realized_pnl: 100.5,
                      exchange: "binance",
                    },
                  ],
                  error: null,
                }),
              }),
            }),
          }),
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
});
