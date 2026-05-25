import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";

/**
 * Tests for GET /api/admin/allocators/[id]/holdings — closes audit
 * finding H-0215 (the route shipped with zero tests).
 *
 * The route is admin-only and returns another user's portfolio holdings,
 * so the load-bearing branch is the 403 RBAC deny: any regression that
 * flips the `await isAdminUser(...)` short-circuit (e.g. an accidental
 * `!await`) would expose any allocator's holdings list to any authed
 * non-admin user. Each of the five branches is pinned:
 *
 *   TC1 — 400 when the dynamic `id` segment is empty.
 *   TC2 — 401 when unauthenticated (RFC 7235 — distinct from 403).
 *   TC3 — 403 RBAC deny when authed but isAdminUser=false. The admin
 *         client (PII source) must NEVER be reached on this path.
 *   TC4 — 500 when the portfolio lookup errors.
 *   TC5 — 200 { holdings: [] } when the allocator has no real portfolio.
 *   TC6 — 200 happy path with embedded-join normalization (object form
 *         AND array form, plus the Unnamed-strategy fallback).
 *   TC7 — CSRF short-circuit fires before auth/admin work.
 */

// admin.ts / supabase admin.ts pull in "server-only" which throws under
// vitest+jsdom.
vi.mock("server-only", () => ({}));

const ALLOCATOR_ID = "00000000-0000-0000-0000-aaaaaaaaaaaa";
const ADMIN_USER_ID = "00000000-0000-0000-0000-bbbbbbbbbbbb";
const PORTFOLIO_ID = "00000000-0000-0000-0000-cccccccccccc";

type PortfolioResult = {
  data: { id: string } | null;
  error: { message: string } | null;
};
type RowsResult = {
  data: Array<Record<string, unknown>> | null;
  error: { message: string } | null;
};

const STATE = vi.hoisted(() => ({
  // `vi.hoisted` runs before the module-level `const`s above, so the
  // admin user id is inlined here and re-set from ADMIN_USER_ID in
  // beforeEach (both are the same literal).
  authUser: { id: "00000000-0000-0000-0000-bbbbbbbbbbbb" } as {
    id: string;
  } | null,
  isAdmin: true,
  portfolioResult: { data: { id: "" }, error: null } as PortfolioResult,
  rowsResult: { data: [], error: null } as RowsResult,
  csrfResponse: null as ReturnType<
    typeof import("next/server").NextResponse.json
  > | null,
  // Track whether the admin client was constructed at all — the 401/403
  // paths must short-circuit BEFORE the PII source is touched.
  adminClientCreated: false,
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: {
      getUser: async () => ({ data: { user: STATE.authUser }, error: null }),
    },
  }),
}));

// Admin client serves portfolios (maybeSingle) and portfolio_strategies
// (order). Each `from()` call records that the PII source was reached.
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => {
    STATE.adminClientCreated = true;
    return {
      from: (table: string) => {
        if (table === "portfolios") {
          return {
            select: () => ({
              eq: () => ({
                eq: () => ({
                  maybeSingle: async () => STATE.portfolioResult,
                }),
              }),
            }),
          };
        }
        if (table === "portfolio_strategies") {
          return {
            select: () => ({
              eq: () => ({
                order: async () => STATE.rowsResult,
              }),
            }),
          };
        }
        throw new Error(`unexpected admin.from(${table})`);
      },
    };
  },
}));

const mockIsAdminUser = vi.fn(async () => STATE.isAdmin);
vi.mock("@/lib/admin", () => ({
  isAdminUser: mockIsAdminUser,
}));

vi.mock("@/lib/csrf", () => ({
  assertSameOrigin: () => STATE.csrfResponse,
}));

function makeRequest(): NextRequest {
  return new NextRequest(
    `http://localhost:3000/api/admin/allocators/${ALLOCATOR_ID}/holdings`,
    { method: "GET", headers: { origin: "http://localhost:3000" } },
  );
}

function withParams(id: string) {
  return { params: Promise.resolve({ id }) };
}

beforeEach(() => {
  STATE.authUser = { id: ADMIN_USER_ID };
  STATE.isAdmin = true;
  STATE.portfolioResult = { data: { id: PORTFOLIO_ID }, error: null };
  STATE.rowsResult = { data: [], error: null };
  STATE.csrfResponse = null;
  STATE.adminClientCreated = false;
  mockIsAdminUser.mockImplementation(async () => STATE.isAdmin);
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("GET /api/admin/allocators/[id]/holdings — H-0215", () => {
  it("TC1 — 400 when the dynamic id segment is empty", async () => {
    const { GET } = await import("./route");
    const res = await GET(makeRequest(), withParams(""));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("id required");
    // No admin / RBAC work on a malformed id.
    expect(mockIsAdminUser).not.toHaveBeenCalled();
    expect(STATE.adminClientCreated).toBe(false);
  });

  it("TC2 — 401 when unauthenticated (distinct from 403)", async () => {
    STATE.authUser = null;
    const { GET } = await import("./route");
    const res = await GET(makeRequest(), withParams(ALLOCATOR_ID));
    expect(res.status).toBe(401);
    expect((await res.json()).error).toBe("Unauthorized");
    // The admin role check + PII source must not run for an anon caller.
    expect(mockIsAdminUser).not.toHaveBeenCalled();
    expect(STATE.adminClientCreated).toBe(false);
  });

  it("TC3 — 403 RBAC deny when authed but NOT an admin, and the PII admin client is never reached", async () => {
    // This is the dangerous branch: a non-admin authed user must get 403
    // and the route must NOT construct the service-role admin client that
    // can read any allocator's holdings. If `isAdminUser` is ever flipped
    // (e.g. `!await isAdminUser`), this test fails by returning 200 +
    // leaking holdings.
    STATE.isAdmin = false;
    const { GET } = await import("./route");
    const res = await GET(makeRequest(), withParams(ALLOCATOR_ID));
    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe("Forbidden");
    expect(mockIsAdminUser).toHaveBeenCalledTimes(1);
    // The admin (PII) client must NOT have been constructed on a deny.
    expect(STATE.adminClientCreated).toBe(false);
  });

  it("TC4 — 500 when the portfolio lookup errors", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    STATE.portfolioResult = {
      data: null,
      error: { message: "connection reset" },
    };
    const { GET } = await import("./route");
    const res = await GET(makeRequest(), withParams(ALLOCATOR_ID));
    expect(res.status).toBe(500);
    expect((await res.json()).error).toBe("Internal error");
    errorSpy.mockRestore();
  });

  it("TC5 — 200 { holdings: [] } when the allocator has no real portfolio", async () => {
    STATE.portfolioResult = { data: null, error: null };
    const { GET } = await import("./route");
    const res = await GET(makeRequest(), withParams(ALLOCATOR_ID));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ holdings: [] });
  });

  it("TC6 — 200 happy path normalizes the embedded join (object + array forms, name fallback)", async () => {
    STATE.rowsResult = {
      data: [
        // Supabase may return the embedded `strategy` join as an object…
        {
          strategy_id: "strat-1",
          strategy: { id: "strat-1", name: "Momentum Alpha" },
        },
        // …or as a single-element array.
        {
          strategy_id: "strat-2",
          strategy: [{ id: "strat-2", name: "Mean Reversion" }],
        },
        // null name → "Unnamed strategy" fallback.
        {
          strategy_id: "strat-3",
          strategy: { id: "strat-3", name: null },
        },
      ],
      error: null,
    };
    const { GET } = await import("./route");
    const res = await GET(makeRequest(), withParams(ALLOCATOR_ID));
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      holdings: Array<{ id: string; name: string }>;
    };
    expect(body.holdings).toEqual([
      { id: "strat-1", name: "Momentum Alpha" },
      { id: "strat-2", name: "Mean Reversion" },
      { id: "strat-3", name: "Unnamed strategy" },
    ]);
  });

  it("TC4b — 500 when the portfolio_strategies rows lookup errors", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    STATE.rowsResult = { data: null, error: { message: "rows blew up" } };
    const { GET } = await import("./route");
    const res = await GET(makeRequest(), withParams(ALLOCATOR_ID));
    expect(res.status).toBe(500);
    expect((await res.json()).error).toBe("Internal error");
    errorSpy.mockRestore();
  });

  it("TC7 — CSRF short-circuit fires before auth and the admin role check", async () => {
    const { NextResponse } = await import("next/server");
    STATE.csrfResponse = NextResponse.json(
      { error: "Origin not allowed" },
      { status: 403 },
    );
    const { GET } = await import("./route");
    const res = await GET(makeRequest(), withParams(ALLOCATOR_ID));
    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe("Origin not allowed");
    // CSRF deny must precede any auth/admin work.
    expect(mockIsAdminUser).not.toHaveBeenCalled();
    expect(STATE.adminClientCreated).toBe(false);
  });
});
