import { describe, it, expect, beforeEach, vi } from "vitest";

/**
 * Tests for /api/favorites (POST + DELETE) added in PR 4 of the My
 * Allocation restructure. The route is thin — validate body, enforce
 * auth, delegate to Supabase with user-scoped identity. RLS on
 * user_favorites (migration 024) is the second gate and is tested via
 * the DB, not here — this file tests the HTTP + server-identity surface.
 */

const authState = vi.hoisted(() => ({
  user: null as { id: string } | null,
  lastInsert: null as Record<string, unknown> | null,
  lastDeleteFilters: [] as Array<{ column: string; value: unknown }>,
  insertError: null as { code?: string; message: string } | null,
  deleteError: null as { message: string } | null,
}));

function resetAuthState() {
  authState.user = { id: "user-1" };
  authState.lastInsert = null;
  authState.lastDeleteFilters = [];
  authState.insertError = null;
  authState.deleteError = null;
}

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: {
      getUser: async () => ({
        data: { user: authState.user },
        error: null,
      }),
    },
    from: (table: string) => {
      if (table !== "user_favorites") throw new Error(`unexpected table ${table}`);
      const deleteChain = {
        eq: (column: string, value: unknown) => {
          authState.lastDeleteFilters.push({ column, value });
          return deleteChain;
        },
        then: (resolve: (v: { error: typeof authState.deleteError }) => void) => {
          resolve({ error: authState.deleteError });
        },
      };
      return {
        insert: (row: Record<string, unknown>) => {
          authState.lastInsert = row;
          return Promise.resolve({ error: authState.insertError });
        },
        delete: () => deleteChain,
      };
    },
  }),
}));

describe("POST /api/favorites", () => {
  beforeEach(resetAuthState);

  it("returns 401 when not authenticated", async () => {
    authState.user = null;
    const { POST } = await import("./route");
    const req = new Request("http://localhost/api/favorites", {
      method: "POST",
      body: JSON.stringify({ strategy_id: "strat-a" }),
    });
    const res = await POST(req);
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBe("unauthorized");
  });

  it("returns 400 when strategy_id is missing", async () => {
    const { POST } = await import("./route");
    const req = new Request("http://localhost/api/favorites", {
      method: "POST",
      body: JSON.stringify({}),
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/strategy_id/);
  });

  it("returns 400 when strategy_id is not a string", async () => {
    const { POST } = await import("./route");
    const req = new Request("http://localhost/api/favorites", {
      method: "POST",
      body: JSON.stringify({ strategy_id: 123 }),
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it("inserts the favorite scoped to the authed user (server cannot be overridden via body)", async () => {
    const { POST } = await import("./route");
    const req = new Request("http://localhost/api/favorites", {
      method: "POST",
      body: JSON.stringify({
        strategy_id: "strat-a",
        // Attempt to spoof a different user.
        user_id: "other-user",
      }),
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
    expect(authState.lastInsert).toEqual({
      user_id: "user-1", // from auth, NOT the body spoof
      strategy_id: "strat-a",
    });
  });

  it("treats 23505 (unique_violation) as idempotent success", async () => {
    authState.insertError = { code: "23505", message: "duplicate key" };
    const { POST } = await import("./route");
    const req = new Request("http://localhost/api/favorites", {
      method: "POST",
      body: JSON.stringify({ strategy_id: "strat-a" }),
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ ok: true, already: true });
  });

  it("returns 500 on other DB errors", async () => {
    authState.insertError = { message: "boom" };
    const { POST } = await import("./route");
    const req = new Request("http://localhost/api/favorites", {
      method: "POST",
      body: JSON.stringify({ strategy_id: "strat-a" }),
    });
    const res = await POST(req);
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toBe("boom");
  });
});

describe("DELETE /api/favorites", () => {
  beforeEach(resetAuthState);

  it("returns 401 when not authenticated", async () => {
    authState.user = null;
    const { DELETE } = await import("./route");
    const req = new Request("http://localhost/api/favorites", {
      method: "DELETE",
      body: JSON.stringify({ strategy_id: "strat-a" }),
    });
    const res = await DELETE(req);
    expect(res.status).toBe(401);
  });

  it("deletes scoped to the authed user + the requested strategy", async () => {
    const { DELETE } = await import("./route");
    const req = new Request("http://localhost/api/favorites", {
      method: "DELETE",
      body: JSON.stringify({ strategy_id: "strat-a" }),
    });
    const res = await DELETE(req);
    expect(res.status).toBe(200);
    // Both filters must be applied: user_id + strategy_id, and user_id
    // must come from the auth session.
    const userFilter = authState.lastDeleteFilters.find(
      (f) => f.column === "user_id",
    );
    const strategyFilter = authState.lastDeleteFilters.find(
      (f) => f.column === "strategy_id",
    );
    expect(userFilter?.value).toBe("user-1");
    expect(strategyFilter?.value).toBe("strat-a");
  });

  it("returns 400 on missing strategy_id", async () => {
    const { DELETE } = await import("./route");
    const req = new Request("http://localhost/api/favorites", {
      method: "DELETE",
      body: JSON.stringify({}),
    });
    const res = await DELETE(req);
    expect(res.status).toBe(400);
  });
});
