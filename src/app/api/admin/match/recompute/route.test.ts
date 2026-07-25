import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";

/**
 * C-PR5-01 (audit-2026-05-07) — route-level coverage for
 * POST /api/admin/match/recompute focused on the actor-binding
 * contract:
 *
 *   1. Forwards the authenticated admin's user.id as the third arg to
 *      ``recomputeMatch`` (this is the load-bearing field that the
 *      analytics-service ``recompute()`` endpoint asserts equals the
 *      allocator_id OR is an admin profile). A regression that drops
 *      this arg restores the cross-tenant write vector PR-5 closed.
 *
 *   2. Non-admin → 403 BEFORE recomputeMatch is invoked. The existing
 *      admin gate remains the production authorization; this test pins
 *      that the actor-binding fix didn't accidentally widen the gate.
 *
 *   3. Unauthenticated → 401 (RFC 7235) before any call to
 *      recomputeMatch.
 *
 *   4. Phase 140 / SEAM-04 error taxonomy — CircuitOpenError → 503 +
 *      Retry-After, AnalyticsTimeoutError → 504, everything else → 500 with
 *      STATIC copy. The generic arm used to echo `err.message` (the
 *      pre-existing information-disclosure leak T-140-11, already closed on
 *      bridge as H-1062 and portfolio-optimizer as M-0333); the case below
 *      pins its ABSENCE.
 *
 * Mirrors the pattern in kill-switch/route.test.ts.
 *
 * ⚠️ Error classes are imported DYNAMICALLY inside each test, from the same
 * module registry the route is imported from. This file does not currently
 * call `vi.resetModules()`, so a static import would work TODAY — but the
 * moment a reset is added, a statically imported `CircuitOpenError` becomes a
 * DIFFERENT class object from the one the route re-evaluates, the route's
 * `instanceof` silently misses, and the 503 assertion fails as a 500 with no
 * obvious cause (measured in 140-01, deviation 3). Same-registry import
 * removes that trap in advance.
 *
 * ⚠️ SCOPE. These are MOCK-based tests: `@/lib/analytics-client` is replaced,
 * so they prove the ROUTE's error mapping and nothing about the client, the
 * resilience core, or the breaker. `route.seam.test.ts` is the companion that
 * runs the REAL client with only `fetch` faked (SC-1b).
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
  }),
}));

vi.mock("@/lib/admin", () => ({
  isAdminUser: async () => adminFlag.isAdmin,
}));

vi.mock("@/lib/ratelimit", () => ({
  adminActionLimiter: {},
  checkLimit: async () => ({ success: true, retryAfter: 0 }),
}));

// Capture every call to recomputeMatch so we can assert the third arg.
const recomputeCalls: Array<{
  allocatorId: string;
  force: boolean;
  actorId?: string;
}> = [];

/** When set, the mocked recomputeMatch rejects with this value. */
const recomputeState: { throwValue: unknown } = { throwValue: null };

// Phase 140 / T-140-30: PARTIAL mock, not a bare factory. `AnalyticsTimeoutError`
// genuinely lives in this module and the route branches on it; through a bare
// factory that binding is `undefined` and `err instanceof undefined` throws
// `TypeError` from inside the route's catch block. The spread is the only new
// part — the `recomputeMatch` body below still drives `recomputeCalls` exactly
// as the pre-140 factory did, so every pre-existing case is untouched.
vi.mock("@/lib/analytics-client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/analytics-client")>()),
  recomputeMatch: async (allocatorId: string, force: boolean, actorId?: string) => {
    recomputeCalls.push({ allocatorId, force, actorId });
    if (recomputeState.throwValue !== null) {
      throw recomputeState.throwValue;
    }
    return { ok: true, batch_id: "b-test" };
  },
}));

vi.mock("@/lib/csrf", () => ({
  assertSameOrigin: () => null,
}));

/** The three STATIC bodies the route is allowed to emit from its catch block. */
const CIRCUIT_OPEN_COPY =
  "The analytics service is temporarily unavailable. Please try again in a moment.";
const TIMEOUT_COPY = "Match recompute timed out. Please try again.";
const GENERIC_COPY = "Match recompute failed. Please try again.";

let errorSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  userState.current = null;
  adminFlag.isAdmin = false;
  recomputeCalls.length = 0;
  recomputeState.throwValue = null;
  // Spy rather than silence-and-forget: the leak-closure case asserts the
  // detail IS still logged, so a static body cannot be achieved by dropping it.
  errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  // This repo's known CI-only (Node 22) failure cause is a leaked global stub.
  vi.unstubAllGlobals();
});

function buildPostRequest(body: unknown) {
  return new NextRequest("http://localhost:3000/api/admin/match/recompute", {
    method: "POST",
    headers: { "content-type": "application/json", ...VALID_ORIGIN },
    body: JSON.stringify(body),
  });
}

describe("POST /api/admin/match/recompute — actor binding (C-PR5-01)", () => {
  it("forwards user.id as actorId on the third arg of recomputeMatch", async () => {
    userState.current = { id: "admin-user-uuid-001" };
    adminFlag.isAdmin = true;

    const { POST } = await import("./route");
    const res = await POST(
      buildPostRequest({ allocator_id: "alloc-uuid-target", force: false }),
    );
    expect(res.status).toBe(200);

    expect(recomputeCalls).toHaveLength(1);
    expect(recomputeCalls[0].allocatorId).toBe("alloc-uuid-target");
    expect(recomputeCalls[0].force).toBe(false);
    // The load-bearing assertion: the authenticated admin's id flows
    // through as actor_id so analytics-service can defense-in-depth
    // gate the cross-tenant write.
    expect(recomputeCalls[0].actorId).toBe("admin-user-uuid-001");
  });

  it("preserves force=true forwarding alongside actorId", async () => {
    userState.current = { id: "admin-user-uuid-002" };
    adminFlag.isAdmin = true;

    const { POST } = await import("./route");
    await POST(
      buildPostRequest({ allocator_id: "alloc-target-002", force: true }),
    );

    expect(recomputeCalls).toHaveLength(1);
    expect(recomputeCalls[0].force).toBe(true);
    expect(recomputeCalls[0].actorId).toBe("admin-user-uuid-002");
  });

  it("non-admin → 403 BEFORE recomputeMatch is called", async () => {
    userState.current = { id: "non-admin-uuid" };
    adminFlag.isAdmin = false;

    const { POST } = await import("./route");
    const res = await POST(
      buildPostRequest({ allocator_id: "alloc-x", force: false }),
    );
    expect(res.status).toBe(403);
    // Crucial: actor binding does NOT widen the gate; if the admin gate
    // fails, the analytics-service never sees the request and thus the
    // actor-id forwarding contract isn't even exercised.
    expect(recomputeCalls).toHaveLength(0);
  });

  it("unauthenticated → 401 BEFORE recomputeMatch is called", async () => {
    userState.current = null;

    const { POST } = await import("./route");
    const res = await POST(
      buildPostRequest({ allocator_id: "alloc-x", force: false }),
    );
    expect(res.status).toBe(401);
    expect(recomputeCalls).toHaveLength(0);
  });

  it("missing allocator_id → 400 BEFORE recomputeMatch is called", async () => {
    userState.current = { id: "admin-id" };
    adminFlag.isAdmin = true;

    const { POST } = await import("./route");
    const res = await POST(buildPostRequest({ force: false }));
    expect(res.status).toBe(400);
    expect(recomputeCalls).toHaveLength(0);
  });
});

describe("POST /api/admin/match/recompute — SEAM-04 error taxonomy (Phase 140)", () => {
  async function postAsAdmin() {
    userState.current = { id: "admin-id" };
    adminFlag.isAdmin = true;
    const { POST } = await import("./route");
    return POST(buildPostRequest({ allocator_id: "alloc-1", force: false }));
  }

  it("maps CircuitOpenError to 503 with Retry-After and static copy", async () => {
    // Same-registry import — see the class-identity warning in the file header.
    const { CircuitOpenError } = await import("@/lib/seam-errors");
    recomputeState.throwValue = new CircuitOpenError(30);
    const res = await postAsAdmin();
    expect(res.status).toBe(503);
    expect(res.headers.get("Retry-After")).toBe("30");
    const raw = await res.text();
    expect(JSON.parse(raw).error).toBe(CIRCUIT_OPEN_COPY);
    // The breaker is an internal mechanism; its vocabulary must not reach an
    // HTTP body (threat T-140-05 / T-140-08).
    expect(raw).not.toMatch(/circuit|breaker|upstash|railway/i);
  });

  it("forwards the breaker's own cooldown as Retry-After rather than a constant", async () => {
    const { CircuitOpenError } = await import("@/lib/seam-errors");
    recomputeState.throwValue = new CircuitOpenError(11);
    const res = await postAsAdmin();
    expect(res.status).toBe(503);
    expect(res.headers.get("Retry-After")).toBe("11");
  });

  it("maps AnalyticsTimeoutError to 504 with static copy", async () => {
    // The REAL class, reachable only because the analytics-client mock above is
    // a spread-importActual partial rather than a bare factory.
    // C9 — the LEAF, which nothing mocks, so the class the test throws is the
    // class the route ships. Reaching it through `@/lib/analytics-client` made
    // the assertion depend on the mock agreeing with itself.
    const { AnalyticsTimeoutError } = await import("@/lib/seam-errors");
    recomputeState.throwValue = new AnalyticsTimeoutError(
      "/api/match/recompute",
      30_000,
    );
    const res = await postAsAdmin();
    expect(res.status).toBe(504);
    const raw = await res.text();
    expect(JSON.parse(raw).error).toBe(TIMEOUT_COPY);
    // AnalyticsTimeoutError's message quotes both the deadline and the upstream
    // path; neither may reach the client.
    expect(raw).not.toContain("30000");
    expect(raw).not.toContain("/api/match/recompute");
  });

  /**
   * Phase 140 review / D-12 — an admin must be able to tell "I passed a bad
   * parameter" from "Railway is broken". Flattening every
   * AnalyticsUpstreamError to 500 erased exactly the distinction that class
   * exists to preserve, and the two failures need opposite responses.
   */
  it.each([
    { status: 400, detail: "allocator_id is not a valid uuid" },
    { status: 404, detail: "allocator not found" },
    { status: 409, detail: "a recompute is already running for this allocator" },
  ])("D-12: forwards an upstream $status with its detail", async ({ status, detail }) => {
    // From the LEAF, not through the mocked `@/lib/analytics-client`. The mock
    // factory does not re-run on vi.resetModules(), so a class reached through
    // it is registry #1's while the freshly-imported route holds registry #N's
    // — `instanceof` is then false and the arm silently falls through to 500.
    const { AnalyticsUpstreamError } = await import("@/lib/seam-errors");
    recomputeState.throwValue = new AnalyticsUpstreamError(detail, status);
    const res = await postAsAdmin();
    expect(res.status).toBe(status);
    expect(JSON.parse(await res.text()).error).toBe(detail);
  });

  it("D-12: an upstream 5xx STAYS generic — the leak closure must not reopen", async () => {
    // The 4xx forwarding must not become a blanket passthrough. A 5xx detail
    // can carry a Python traceback (T-140-11), so it keeps the static copy.
    // From the LEAF, not through the mocked `@/lib/analytics-client`. The mock
    // factory does not re-run on vi.resetModules(), so a class reached through
    // it is registry #1's while the freshly-imported route holds registry #N's
    // — `instanceof` is then false and the arm silently falls through to 500.
    const { AnalyticsUpstreamError } = await import("@/lib/seam-errors");
    recomputeState.throwValue = new AnalyticsUpstreamError(
      "Traceback: psycopg2 at http://localhost:8002 secret detail",
      503,
    );
    const res = await postAsAdmin();
    expect(res.status).toBe(500);
    const raw = await res.text();
    expect(JSON.parse(raw).error).toBe(GENERIC_COPY);
    expect(raw).not.toContain("Traceback");
    expect(raw).not.toContain("localhost");
  });

  it("returns 500 with STATIC copy and NEVER echoes the upstream Error message (T-140-11)", async () => {
    // Deliberately shaped like the two things this arm used to leak: a raw
    // upstream detail string and the analytics service's base URL.
    const leaky = new Error("boom with http://localhost:8002 secret detail");
    recomputeState.throwValue = leaky;
    const res = await postAsAdmin();
    expect(res.status).toBe(500);
    const raw = await res.text();
    expect(raw).not.toContain("boom");
    expect(raw).not.toContain("localhost");
    expect(JSON.parse(raw).error).toBe(GENERIC_COPY);
    // ...and the detail is not simply discarded — it goes to the server log.
    expect(errorSpy).toHaveBeenCalledWith(expect.any(String), leaky);
  });

  it("returns 500 with the same STATIC copy when recomputeMatch throws a non-Error value", async () => {
    recomputeState.throwValue = "string rejection, not an Error";
    const res = await postAsAdmin();
    expect(res.status).toBe(500);
    const raw = await res.text();
    expect(raw).not.toContain("string rejection");
    expect(JSON.parse(raw).error).toBe(GENERIC_COPY);
  });

  it("keeps the breaker arm BEHIND the admin gate — unauthenticated + CircuitOpenError never yields 503 (T-140-12)", async () => {
    // The error arms live inside the handler, after auth, so an unauthenticated
    // caller cannot use the status code as a breaker-state oracle.
    // recomputeMatch is primed to trip, but the gate must return first.
    const { CircuitOpenError } = await import("@/lib/seam-errors");
    recomputeState.throwValue = new CircuitOpenError(30);
    userState.current = null;
    const { POST } = await import("./route");
    const res = await POST(
      buildPostRequest({ allocator_id: "alloc-1", force: false }),
    );
    expect(res.status).toBe(401);
    expect(res.headers.get("Retry-After")).toBeNull();
    expect(recomputeCalls).toHaveLength(0);
  });
});
