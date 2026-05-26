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
 *
 * audit-2026-05-07 batch2 hi-fix (H-0211 / H-0212 / H-0213 / M-0261):
 *   TC8  — 400 "id must be a UUID" when the id segment is a non-UUID
 *          string, BEFORE any auth/admin/PII work (M-0261; closes the
 *          22P02-as-500 leak + narrows the H-0212 enumeration surface).
 *   TC9  — 429 Too many requests with Retry-After when adminActionLimiter
 *          denies (H-0211/H-0213 enumeration cap).
 *   TC10 — the limiter runs AFTER the admin gate: a non-admin 403s and
 *          never consumes/probes the admin bucket (checkLimit not called).
 *   TC11 — 503 ratelimit_misconfigured (NOT 429) when the limiter is
 *          unconfigured in production — fail-CLOSED, so a misconfig can't
 *          silently uncap the route.
 *   TC12 — both 200 paths set `Cache-Control: private, no-store` (H-0212;
 *          forbids proxy/CDN caching of per-user portfolio composition).
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
  // Rate-limit result returned by the mocked checkLimit. Default success so
  // the original TC1..TC7 (which predate the limiter) keep passing.
  rateLimitResult: { success: true } as
    | { success: true }
    | { success: false; retryAfter: number; reason?: "ratelimit_misconfigured" },
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

// Mock the limiter so 429 / 503-misconfig are deterministic. The real
// `isRateLimitMisconfigured` is a pure predicate over the result shape, so
// we re-implement it here rather than importActual (which would pull in the
// Upstash module). `checkLimit` records its invocation so TC10 can prove the
// limiter is gated behind the admin check.
const mockCheckLimit = vi.fn(async () => STATE.rateLimitResult);
vi.mock("@/lib/ratelimit", () => ({
  adminActionLimiter: {},
  checkLimit: mockCheckLimit,
  isRateLimitMisconfigured: (r: { success: boolean; reason?: string }) =>
    r.success === false && r.reason === "ratelimit_misconfigured",
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
  STATE.rateLimitResult = { success: true };
  mockIsAdminUser.mockImplementation(async () => STATE.isAdmin);
  mockCheckLimit.mockClear();
  mockCheckLimit.mockImplementation(async () => STATE.rateLimitResult);
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

  it("TC8 — 400 'id must be a UUID' for a non-UUID id, before any auth/admin/PII work (M-0261)", async () => {
    // A non-UUID id used to flow into `.eq('user_id', id)` and surface as a
    // 22P02-cast 500 (info leak) while also widening the H-0212 enumeration
    // surface. The UUID guard must reject it as a 400 BEFORE CSRF/auth/admin
    // and BEFORE the service-role client is constructed.
    const { GET } = await import("./route");
    const res = await GET(makeRequest(), withParams("not-a-uuid"));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("id must be a UUID");
    expect(mockIsAdminUser).not.toHaveBeenCalled();
    expect(mockCheckLimit).not.toHaveBeenCalled();
    expect(STATE.adminClientCreated).toBe(false);
  });

  it("TC9 — 429 Too many requests with Retry-After when the admin limiter denies (H-0211/H-0213)", async () => {
    // The enumeration cap: once the adminActionLimiter bucket is exhausted,
    // a compromised admin session must be throttled rather than free to walk
    // every allocator UUID. The PII admin client must NOT be reached.
    STATE.rateLimitResult = { success: false, retryAfter: 17 };
    const { GET } = await import("./route");
    const res = await GET(makeRequest(), withParams(ALLOCATOR_ID));
    expect(res.status).toBe(429);
    expect((await res.json()).error).toBe("Too many requests");
    expect(res.headers.get("Retry-After")).toBe("17");
    expect(STATE.adminClientCreated).toBe(false);
  });

  it("TC10 — the limiter runs AFTER the admin gate: a non-admin 403s and never touches the admin bucket", async () => {
    // Ordering invariant: if checkLimit ran before the isAdminUser gate, a
    // non-admin could consume/probe the shared admin bucket (a cross-tenant
    // DoS + a timing oracle). The deny must short-circuit at 403 with the
    // limiter untouched.
    STATE.isAdmin = false;
    const { GET } = await import("./route");
    const res = await GET(makeRequest(), withParams(ALLOCATOR_ID));
    expect(res.status).toBe(403);
    expect(mockCheckLimit).not.toHaveBeenCalled();
    expect(STATE.adminClientCreated).toBe(false);
  });

  it("TC11 — 503 ratelimit_misconfigured (not 429) when the limiter is unconfigured (fail-CLOSED)", async () => {
    // P709 fail-CLOSED: a production deploy with no Upstash env must surface
    // a 503 so the canary/health check sees the outage, rather than a 429
    // that masks an uncapped route as ordinary throttling.
    STATE.rateLimitResult = {
      success: false,
      retryAfter: 60,
      reason: "ratelimit_misconfigured",
    };
    const { GET } = await import("./route");
    const res = await GET(makeRequest(), withParams(ALLOCATOR_ID));
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.code).toBe("ratelimit_misconfigured");
    expect(res.headers.get("Retry-After")).toBe("60");
    expect(STATE.adminClientCreated).toBe(false);
  });

  it("TC12 — both 200 paths set Cache-Control: private, no-store (H-0212)", async () => {
    const { GET } = await import("./route");

    // Empty-portfolio 200.
    STATE.portfolioResult = { data: null, error: null };
    const emptyRes = await GET(makeRequest(), withParams(ALLOCATOR_ID));
    expect(emptyRes.status).toBe(200);
    expect(emptyRes.headers.get("Cache-Control")).toBe("private, no-store");

    // Populated 200.
    STATE.portfolioResult = { data: { id: PORTFOLIO_ID }, error: null };
    STATE.rowsResult = {
      data: [{ strategy_id: "s1", strategy: { id: "s1", name: "Alpha" } }],
      error: null,
    };
    const fullRes = await GET(makeRequest(), withParams(ALLOCATOR_ID));
    expect(fullRes.status).toBe(200);
    expect(fullRes.headers.get("Cache-Control")).toBe("private, no-store");
  });
});
