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
          select: async () => ({ data: [], error: null }),
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
