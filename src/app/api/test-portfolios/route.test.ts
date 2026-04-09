import { describe, it, expect, beforeEach, vi } from "vitest";

/**
 * Tests for /api/test-portfolios POST. This route creates a saved
 * hypothetical portfolio from the Save-as-Test flow on the Favorites
 * panel: inserts a portfolios row (is_test=true) and a set of
 * portfolio_strategies rows with equal weights. Rollback on the
 * strategies insert: if it fails, the portfolio is deleted so the
 * user doesn't end up with an orphaned empty Test Portfolios row.
 */

const state = vi.hoisted(() => ({
  user: null as { id: string } | null,
  insertedPortfolio: null as Record<string, unknown> | null,
  insertedStrategies: null as Record<string, unknown>[] | null,
  deletedPortfolioIds: [] as string[],
  portfolioInsertError: null as { message: string } | null,
  strategiesInsertError: null as { message: string } | null,
  nextPortfolioId: "new-test-1",
}));

function resetState() {
  state.user = { id: "user-1" };
  state.insertedPortfolio = null;
  state.insertedStrategies = null;
  state.deletedPortfolioIds = [];
  state.portfolioInsertError = null;
  state.strategiesInsertError = null;
  state.nextPortfolioId = "new-test-1";
}

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: {
      getUser: async () => ({ data: { user: state.user }, error: null }),
    },
    from: (table: string) => {
      if (table === "portfolios") {
        return {
          insert: (row: Record<string, unknown>) => ({
            select: () => ({
              single: async () => {
                if (state.portfolioInsertError) {
                  return { data: null, error: state.portfolioInsertError };
                }
                state.insertedPortfolio = row;
                return {
                  data: { id: state.nextPortfolioId },
                  error: null,
                };
              },
            }),
          }),
          delete: () => ({
            eq: (column: string, value: unknown) => {
              if (column === "id" && typeof value === "string") {
                state.deletedPortfolioIds.push(value);
              }
              return Promise.resolve({ error: null });
            },
          }),
        };
      }
      if (table === "portfolio_strategies") {
        return {
          insert: (rows: Record<string, unknown>[]) => {
            if (state.strategiesInsertError) {
              return Promise.resolve({ error: state.strategiesInsertError });
            }
            state.insertedStrategies = rows;
            return Promise.resolve({ error: null });
          },
        };
      }
      throw new Error(`unexpected table ${table}`);
    },
  }),
}));

describe("POST /api/test-portfolios", () => {
  beforeEach(resetState);

  it("returns 401 when not authenticated", async () => {
    state.user = null;
    const { POST } = await import("./route");
    const req = new Request("http://localhost/api/test-portfolios", {
      method: "POST",
      body: JSON.stringify({
        name: "Active + Orion",
        strategyIds: ["s1", "s2"],
      }),
    });
    const res = await POST(req);
    expect(res.status).toBe(401);
  });

  it("returns 400 when name is missing", async () => {
    const { POST } = await import("./route");
    const req = new Request("http://localhost/api/test-portfolios", {
      method: "POST",
      body: JSON.stringify({ strategyIds: ["s1"] }),
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it("returns 400 when strategyIds is empty", async () => {
    const { POST } = await import("./route");
    const req = new Request("http://localhost/api/test-portfolios", {
      method: "POST",
      body: JSON.stringify({ name: "Test", strategyIds: [] }),
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it("creates a portfolio with is_test=true scoped to the authed user", async () => {
    const { POST } = await import("./route");
    const req = new Request("http://localhost/api/test-portfolios", {
      method: "POST",
      body: JSON.stringify({
        name: "Active + Orion",
        description: "Curious about Orion's contribution",
        strategyIds: ["s1", "s2"],
        user_id: "spoof-user", // attempt to spoof
      }),
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.id).toBe("new-test-1");

    expect(state.insertedPortfolio).toMatchObject({
      user_id: "user-1", // from auth, NOT the spoof
      name: "Active + Orion",
      description: "Curious about Orion's contribution",
      is_test: true,
    });
  });

  it("inserts equal-weight portfolio_strategies for every strategy in the payload", async () => {
    const { POST } = await import("./route");
    const req = new Request("http://localhost/api/test-portfolios", {
      method: "POST",
      body: JSON.stringify({
        name: "Active + 3 favorites",
        strategyIds: ["s1", "s2", "s3", "s4"],
      }),
    });
    const res = await POST(req);
    expect(res.status).toBe(200);

    expect(state.insertedStrategies).toHaveLength(4);
    // Each row should have current_weight = 1/4 = 0.25.
    for (const row of state.insertedStrategies ?? []) {
      expect(row.portfolio_id).toBe("new-test-1");
      expect(row.current_weight).toBeCloseTo(0.25, 6);
    }
  });

  it("rolls back the portfolio insert if the strategies insert fails", async () => {
    state.strategiesInsertError = { message: "FK violation" };
    const { POST } = await import("./route");
    const req = new Request("http://localhost/api/test-portfolios", {
      method: "POST",
      body: JSON.stringify({
        name: "Test",
        strategyIds: ["bad-strategy-id"],
      }),
    });
    const res = await POST(req);
    expect(res.status).toBe(500);
    // Rollback: the newly-created portfolio should have been deleted.
    expect(state.deletedPortfolioIds).toContain("new-test-1");
  });

  it("returns 500 if the portfolio insert itself fails", async () => {
    state.portfolioInsertError = { message: "boom" };
    const { POST } = await import("./route");
    const req = new Request("http://localhost/api/test-portfolios", {
      method: "POST",
      body: JSON.stringify({ name: "Test", strategyIds: ["s1"] }),
    });
    const res = await POST(req);
    expect(res.status).toBe(500);
  });
});
