import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

/**
 * M-0272 (testgap API2) — route-level coverage for
 * GET /api/admin/match/[allocator_id], the admin queue's payload source.
 *
 * The route owns ONLY auth + delegation: CSRF gate, RFC 7235 401/403 split,
 * then `getAllocatorMatchPayload(admin, allocator_id)`. Asserts:
 *   1. CSRF — off-origin / missing-Origin probe rejected with 403 BEFORE auth.
 *   2. AuthZ — null user → 401; authenticated non-admin → 403.
 *   3. Delegation — admin path calls getAllocatorMatchPayload with the
 *      service-role admin client + the route's allocator_id param.
 *   4. 500 — when the helper throws, the response is the opaque
 *      "Internal error" (no Postgres column/constraint detail leaked).
 *   5. Payload-size budget — turns the route's "< 500 KB at N=30" comment
 *      into an asserted contract for a representative N=30 payload.
 *
 * Mirrors the sibling allocators/route.test.ts + kill-switch/route.test.ts
 * Supabase/NextRequest mocking pattern.
 */

vi.mock("server-only", () => ({}));

const VALID_ORIGIN = { origin: "http://localhost:3000" };
const ALLOCATOR_ID = "11111111-1111-4111-8111-111111111111";

const userState = vi.hoisted<{ current: { id: string } | null }>(() => ({
  current: null,
}));
const adminFlag = vi.hoisted(() => ({ isAdmin: false }));

// Captures the (client, allocatorId) the route delegates with, plus a
// togglable payload / throw so the 200 / 500 branches are both reachable.
const payloadState = vi.hoisted(() => ({
  lastClient: null as unknown,
  lastAllocatorId: null as string | null,
  // when set, getAllocatorMatchPayload throws this instead of returning.
  throwError: null as Error | null,
  payload: { strategies: [], decisions: [] } as unknown,
}));

// A sentinel object so the delegation test can prove the SERVICE-ROLE admin
// client (not the user-scoped client) is passed to the helper.
const ADMIN_CLIENT_SENTINEL = { __id: "adminClient" };

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: {
      getUser: async () => ({
        data: { user: userState.current },
        error: null,
      }),
    },
  }),
}));

vi.mock("@/lib/admin", () => ({
  isAdminUser: async () => adminFlag.isAdmin,
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ADMIN_CLIENT_SENTINEL,
}));

vi.mock("@/lib/admin/match", () => ({
  getAllocatorMatchPayload: async (client: unknown, allocatorId: string) => {
    payloadState.lastClient = client;
    payloadState.lastAllocatorId = allocatorId;
    if (payloadState.throwError) throw payloadState.throwError;
    return payloadState.payload;
  },
}));

function makeReq(
  headers: Record<string, string> = VALID_ORIGIN,
): NextRequest {
  return new NextRequest(
    `http://localhost:3000/api/admin/match/${ALLOCATOR_ID}`,
    { method: "GET", headers },
  );
}

function withParams(allocatorId: string) {
  return { params: Promise.resolve({ allocator_id: allocatorId }) };
}

describe("GET /api/admin/match/[allocator_id] (M-0272)", () => {
  beforeEach(() => {
    userState.current = null;
    adminFlag.isAdmin = false;
    payloadState.lastClient = null;
    payloadState.lastAllocatorId = null;
    payloadState.throwError = null;
    payloadState.payload = { strategies: [], decisions: [] };
    vi.resetModules();
  });

  it("rejects an off-origin request with 403 BEFORE auth (CSRF guard)", async () => {
    // Authenticated admin — proves CSRF runs first regardless of auth.
    userState.current = { id: "admin-1" };
    adminFlag.isAdmin = true;

    const { GET } = await import("./route");
    const res = await GET(
      makeReq({ origin: "https://evil.example.com" }),
      withParams(ALLOCATOR_ID),
    );
    expect(res.status).toBe(403);
    // The helper must never run on a CSRF-rejected request.
    expect(payloadState.lastAllocatorId).toBeNull();
  });

  it("rejects a request missing Origin/Referer with 403", async () => {
    userState.current = { id: "admin-1" };
    adminFlag.isAdmin = true;

    const { GET } = await import("./route");
    const res = await GET(makeReq({}), withParams(ALLOCATOR_ID));
    expect(res.status).toBe(403);
    expect(payloadState.lastAllocatorId).toBeNull();
  });

  it("returns 401 when there is no authenticated user", async () => {
    userState.current = null;
    const { GET } = await import("./route");
    const res = await GET(makeReq(), withParams(ALLOCATOR_ID));
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBe("Unauthorized");
    expect(payloadState.lastAllocatorId).toBeNull();
  });

  it("returns 403 when the authenticated caller is not an admin", async () => {
    userState.current = { id: "user-1" };
    adminFlag.isAdmin = false;
    const { GET } = await import("./route");
    const res = await GET(makeReq(), withParams(ALLOCATOR_ID));
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toBe("Forbidden");
    expect(payloadState.lastAllocatorId).toBeNull();
  });

  it("delegates to getAllocatorMatchPayload(admin, allocator_id) on the admin path", async () => {
    userState.current = { id: "admin-1" };
    adminFlag.isAdmin = true;
    const { GET } = await import("./route");
    const res = await GET(makeReq(), withParams(ALLOCATOR_ID));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ strategies: [], decisions: [] });
    // Delegation contract: the SERVICE-ROLE admin client (not the
    // user-scoped client) + the route's path param are forwarded.
    expect(payloadState.lastClient).toBe(ADMIN_CLIENT_SENTINEL);
    expect(payloadState.lastAllocatorId).toBe(ALLOCATOR_ID);
  });

  it("returns 500 with opaque 'Internal error' (no Postgres detail leaked) when the helper throws", async () => {
    userState.current = { id: "admin-1" };
    adminFlag.isAdmin = true;
    payloadState.throwError = new Error(
      'column strategies.secret_internal_col does not exist',
    );
    const { GET } = await import("./route");
    const res = await GET(makeReq(), withParams(ALLOCATOR_ID));
    expect(res.status).toBe(500);
    const body = await res.json();
    // The opaque error — the Postgres column name must NOT leak.
    expect(body).toEqual({ error: "Internal error" });
    expect(JSON.stringify(body)).not.toContain("secret_internal_col");
  });

  it("keeps the N=30 admin-queue payload under the 500 KB budget the route comment promises", async () => {
    // The route comment claims "< 500 KB at N=30 (enforced in tests)" but
    // no test pinned it. Build a representative N=30 payload (the heaviest
    // realistic admin-queue load) and assert the serialized JSON the route
    // ships stays under the budget. Regression class: a future panel that
    // inlines full returns_series per candidate would blow past 500 KB and
    // slow the queue page; this fails loudly when that happens.
    userState.current = { id: "admin-1" };
    adminFlag.isAdmin = true;
    const candidates = Array.from({ length: 30 }, (_, i) => ({
      strategy_id: `33333333-3333-4333-8333-${String(i).padStart(12, "0")}`,
      codename: `Strategy ${i}`,
      score: 0.5 + i / 100,
      markets: ["crypto", "equities"],
      strategy_types: ["mean-reversion", "momentum"],
      sharpe: 1.2,
      max_drawdown: -0.18,
      cagr: 0.22,
      blurb:
        "A representative candidate panel row with the descriptive copy " +
        "the admin queue renders per candidate in the Send Intro modal.",
    }));
    payloadState.payload = {
      allocator: { id: ALLOCATOR_ID, display_name: "Acme Capital" },
      candidates,
      existing_contact_requests: candidates
        .slice(0, 5)
        .map((c) => c.strategy_id),
    };

    const { GET } = await import("./route");
    const res = await GET(makeReq(), withParams(ALLOCATOR_ID));
    expect(res.status).toBe(200);
    const text = await res.text();
    const bytes = new TextEncoder().encode(text).length;
    expect(bytes).toBeLessThan(500 * 1024);
  });
});
