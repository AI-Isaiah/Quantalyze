import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

/**
 * audit-2026-05-07 P444 — route-level coverage for the RFC 7235 split
 * between 401 (unauthenticated) and 403 (authenticated-but-not-admin).
 *
 * Pre-fix: BOTH branches returned 403 + "Unauthorized" — that test would
 * have asserted 401 and failed on the unauthenticated path. Post-fix
 * the route returns 401 when `auth.getUser()` resolves to a null user
 * and 403 when the user lacks the admin role.
 */

vi.mock("server-only", () => ({}));

const VALID_ORIGIN = { origin: "http://localhost:3000" };

const userState = vi.hoisted<{ current: { id: string } | null }>(() => ({
  current: null,
}));

const adminFlag = vi.hoisted(() => ({ isAdmin: false }));

// M-0276: rows returned by the DELETE .match().select() — empty array models
// a no-op un-decide (nothing matched the composite filter).
const deleteState = vi.hoisted<{ rows: Array<{ id: string }> }>(() => ({
  rows: [],
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: {
      getUser: async () => ({
        data: { user: userState.current },
        error: null,
      }),
    },
    rpc: async () => ({ data: null, error: null }),
    from: () => ({
      insert: () => ({
        select: () => ({
          single: async () => ({ data: { id: "row-id" }, error: null }),
        }),
      }),
    }),
  }),
}));

vi.mock("@/lib/admin", () => ({
  isAdminUser: async () => adminFlag.isAdmin,
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: () => ({
      insert: () => ({
        select: () => ({
          single: async () => ({ data: { id: "row-id" }, error: null }),
        }),
      }),
      delete: () => ({
        match: () => ({
          select: async () => ({ data: deleteState.rows, error: null }),
        }),
      }),
    }),
  }),
}));

function makePostReq(): NextRequest {
  return new NextRequest("http://localhost:3000/api/admin/match/decisions", {
    method: "POST",
    headers: VALID_ORIGIN,
    body: JSON.stringify({
      allocator_id: "alloc-1",
      strategy_id: "strat-1",
      decision: "thumbs_up",
    }),
  });
}

function makeDeleteReq(): NextRequest {
  return new NextRequest(
    "http://localhost:3000/api/admin/match/decisions?allocator_id=alloc-1&strategy_id=strat-1&decision=thumbs_up",
    {
      method: "DELETE",
      headers: VALID_ORIGIN,
    },
  );
}

describe("POST /api/admin/match/decisions — 401 vs 403 (P444)", () => {
  beforeEach(() => {
    userState.current = null;
    adminFlag.isAdmin = false;
    vi.resetModules();
  });

  it("returns 401 when unauthenticated (pre-fix returned 403)", async () => {
    userState.current = null;
    const { POST } = await import("./route");
    const res = await POST(makePostReq());
    // RFC 7235: unauthenticated MUST be 401. Pre-fix this was 403 because
    // the route ran isAdminUser(supabase, null) which returns false,
    // landing on the single 403 branch.
    expect(res.status).toBe(401);
  });

  it("returns 403 when authenticated but not admin", async () => {
    userState.current = { id: "user-1" };
    adminFlag.isAdmin = false;
    const { POST } = await import("./route");
    const res = await POST(makePostReq());
    expect(res.status).toBe(403);
  });

  it("does not return 401 when caller IS an admin (sanity)", async () => {
    userState.current = { id: "admin-1" };
    adminFlag.isAdmin = true;
    const { POST } = await import("./route");
    const res = await POST(makePostReq());
    expect(res.status).not.toBe(401);
    expect(res.status).not.toBe(403);
  });
});

describe("POST /api/admin/match/decisions — canonical error shape (C-0043)", () => {
  beforeEach(() => {
    userState.current = { id: "admin-1" };
    adminFlag.isAdmin = true;
    vi.resetModules();
  });

  it("returns canonical { error: string } shape for invalid decision value", async () => {
    const { POST } = await import("./route");
    const req = new NextRequest("http://localhost:3000/api/admin/match/decisions", {
      method: "POST",
      headers: VALID_ORIGIN,
      body: JSON.stringify({
        allocator_id: "alloc-1",
        strategy_id: "strat-1",
        decision: "thumbs_sideways",
      }),
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
    const json = (await res.json()) as Record<string, unknown>;
    // C-0043: canonical shape is flat `{ error: string }` — NOT the
    // legacy/mixed `{ error, fields: { name: string[] } }` shape. Assert
    // both directions so regressions surface either way.
    expect(typeof json.error).toBe("string");
    expect(json.error).toContain("decision");
    expect(json).not.toHaveProperty("fields");
    expect(Object.keys(json)).toEqual(["error"]);
  });
});

describe("DELETE /api/admin/match/decisions — 401 vs 403 (P444)", () => {
  beforeEach(() => {
    userState.current = null;
    adminFlag.isAdmin = false;
    vi.resetModules();
  });

  it("returns 401 when unauthenticated (pre-fix returned 403)", async () => {
    userState.current = null;
    const { DELETE } = await import("./route");
    const res = await DELETE(makeDeleteReq());
    expect(res.status).toBe(401);
  });

  it("returns 403 when authenticated but not admin", async () => {
    userState.current = { id: "user-1" };
    adminFlag.isAdmin = false;
    const { DELETE } = await import("./route");
    const res = await DELETE(makeDeleteReq());
    expect(res.status).toBe(403);
  });
});

describe("DELETE /api/admin/match/decisions — M-0276 no-op vs match", () => {
  beforeEach(() => {
    userState.current = { id: "admin-1" };
    adminFlag.isAdmin = true;
    deleteState.rows = [];
    vi.resetModules();
  });

  it("M-0276: a DELETE matching zero rows returns 404, not a misleading 200", async () => {
    // No decision matched the (allocator_id, strategy_id, decision) tuple.
    deleteState.rows = [];
    const { DELETE } = await import("./route");
    const res = await DELETE(makeDeleteReq());
    // Pre-fix this returned { success: true } (200) for a no-op un-decide —
    // the founder believed they removed a decision that never existed.
    expect(res.status).toBe(404);
    const json = (await res.json()) as Record<string, unknown>;
    expect(json.error).toBe("No matching decision to delete");
  });

  it("a DELETE that removes a real decision still returns 200 success", async () => {
    deleteState.rows = [{ id: "dec-1" }];
    const { DELETE } = await import("./route");
    const res = await DELETE(makeDeleteReq());
    expect(res.status).toBe(200);
    const json = (await res.json()) as Record<string, unknown>;
    expect(json).toMatchObject({ success: true });
  });
});
