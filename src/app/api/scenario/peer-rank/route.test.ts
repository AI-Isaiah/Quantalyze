import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";

/**
 * Tests for POST /api/scenario/peer-rank (Phase 42 — PEER-03).
 *
 * The route ranks the composer's hypothetical blend against the verified
 * cohort via the get_verified_cohort_rank SECURITY DEFINER RPC and returns
 * ONLY { peer: PeerPercentilePayload | null }. The cohort distribution NEVER
 * crosses the network.
 *
 * Coverage matrix:
 *   TC1  — 401 when unauthenticated; no RPC call.
 *   TC2  — approval gate denial (assertProfileApproved) short-circuits.
 *   TC3  — non-object body (null) → 400 + NO_STORE; no RPC.
 *   TC4  — non-finite metric (NaN sharpe) → 400 + NO_STORE; no RPC.
 *   TC5  — missing field (no n) → 400 + NO_STORE; no RPC.
 *   TC6  — invalid JSON body → 400 + NO_STORE; no RPC.
 *   TC7  — rate-limit exhausted → 429 + Retry-After + NO_STORE; no RPC.
 *   TC8  — rate-limit misconfigured (prod fail-CLOSED) → 503 + Retry-After + NO_STORE; no RPC.
 *   TC9  — RPC NULL-rank row (cohort_n < 20) → 200 { peer: null } + NO_STORE.
 *   TC10 — RPC full rank → 200 { peer: { cohortSize, sharpe, sortino, max_dd } } + NO_STORE;
 *          response has ONLY the `peer` key with EXACTLY the 4 fields (no distribution, no identity).
 *   TC11 — RPC passes p_max_dd = Math.abs(maxDD) (magnitude convention).
 *   TC12 — RPC error → structured 500 (no raw DB message) + NO_STORE.
 *   TC13 — CSRF short-circuits before auth/RPC.
 *   TC14 — limiter consumed only after validation (a 400 burns no token).
 *   TC15 — the route is wired to scenarioPeerLimiter (not another bucket).
 */

const SCENARIO_PEER_LIMITER_SENTINEL = {
  __id: "scenarioPeerLimiter",
  __limit: "60/60s",
};

const STATE = vi.hoisted(() => ({
  authUser: {
    id: "00000000-0000-0000-0000-000000000001",
    email: "alloc@test.sec",
  } as { id: string; email: string } | null,
  rpcCalls: [] as Array<{ name: string; args: Record<string, unknown> }>,
  // The single row the get_verified_cohort_rank RPC returns. Supabase .rpc()
  // for a RETURNS TABLE resolves to { data: rows[], error }.
  rpcRows: [] as Array<Record<string, unknown>>,
  rpcError: null as { code?: string; message?: string } | null,
  checkLimitResult: { success: true, retryAfter: 0 } as {
    success: boolean;
    retryAfter: number;
    reason?: "ratelimit_misconfigured";
  },
  approvalDenied: null as ReturnType<typeof import("next/server").NextResponse.json> | null,
  csrfResponse: null as ReturnType<typeof import("next/server").NextResponse.json> | null,
  lastCheckLimitArg: null as unknown,
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: {
      getUser: async () => ({
        data: { user: STATE.authUser },
        error: null,
      }),
    },
    rpc: async (name: string, args: Record<string, unknown>) => {
      STATE.rpcCalls.push({ name, args });
      return { data: STATE.rpcRows, error: STATE.rpcError };
    },
  }),
}));

// The vitest setup file (src/test-setup.ts) vi.mocks the approval gate to a
// no-op pass. Override it here so TC2 can drive the denial response, and the
// rest pass through.
vi.mock("@/lib/api/approval-gate", () => ({
  assertProfileApproved: async () => STATE.approvalDenied,
}));

vi.mock("@/lib/ratelimit", () => ({
  scenarioPeerLimiter: SCENARIO_PEER_LIMITER_SENTINEL,
  checkLimit: async (limiter: unknown) => {
    STATE.lastCheckLimitArg = limiter;
    return STATE.checkLimitResult;
  },
  isRateLimitMisconfigured: (result: { success: boolean; reason?: string }) =>
    result.success === false && result.reason === "ratelimit_misconfigured",
}));

vi.mock("@/lib/csrf", () => ({
  assertSameOrigin: () => STATE.csrfResponse,
}));

function makeRequest(body: Record<string, unknown> | string): NextRequest {
  const bodyStr = typeof body === "string" ? body : JSON.stringify(body);
  return new NextRequest("http://localhost:3000/api/scenario/peer-rank", {
    method: "POST",
    headers: {
      origin: "http://localhost:3000",
      "content-type": "application/json",
    },
    body: bodyStr,
  });
}

// A valid blend body — all three metrics finite + n.
const VALID_BODY = { sharpe: 1.4, sortino: 2.1, maxDD: -0.18, n: 300 };

beforeEach(() => {
  STATE.authUser = {
    id: "00000000-0000-0000-0000-000000000001",
    email: "alloc@test.sec",
  };
  STATE.rpcCalls = [];
  STATE.rpcRows = [];
  STATE.rpcError = null;
  STATE.checkLimitResult = { success: true, retryAfter: 0 };
  STATE.approvalDenied = null;
  STATE.csrfResponse = null;
  STATE.lastCheckLimitArg = null;
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("POST /api/scenario/peer-rank", () => {
  it("TC1 — 401 when unauthenticated; no RPC call, NO_STORE", async () => {
    STATE.authUser = null;
    const { POST } = await import("./route");

    const res = await POST(makeRequest(VALID_BODY));

    expect(res.status).toBe(401);
    expect(res.headers.get("Cache-Control")).toBe("private, no-store");
    const body = await res.json();
    expect(body.error).toBe("Unauthorized");
    expect(STATE.rpcCalls).toHaveLength(0);
  });

  it("TC2 — approval gate denial short-circuits before the RPC", async () => {
    const { NextResponse } = await import("next/server");
    STATE.approvalDenied = NextResponse.json(
      { error: "Account pending approval" },
      { status: 403, headers: { "Cache-Control": "private, no-store" } },
    );
    const { POST } = await import("./route");

    const res = await POST(makeRequest(VALID_BODY));

    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toBe("Account pending approval");
    expect(STATE.rpcCalls).toHaveLength(0);
  });

  it("TC3 — non-object body (null) → 400 + NO_STORE, no RPC", async () => {
    const { POST } = await import("./route");

    const res = await POST(makeRequest("null"));

    expect(res.status).toBe(400);
    expect(res.headers.get("Cache-Control")).toBe("private, no-store");
    const body = await res.json();
    expect(typeof body.error).toBe("string");
    expect(STATE.rpcCalls).toHaveLength(0);
  });

  it("TC3b — array body → 400 + NO_STORE, no RPC", async () => {
    const { POST } = await import("./route");

    const res = await POST(makeRequest("[1,2,3]"));

    expect(res.status).toBe(400);
    expect(res.headers.get("Cache-Control")).toBe("private, no-store");
    expect(STATE.rpcCalls).toHaveLength(0);
  });

  it("TC4 — non-finite metric (NaN sharpe) → 400 + NO_STORE, no RPC", async () => {
    const { POST } = await import("./route");

    // JSON has no NaN literal; send a string where a finite number is required.
    const res = await POST(
      makeRequest({ sharpe: "not-a-number", sortino: 2.1, maxDD: -0.18, n: 300 }),
    );

    expect(res.status).toBe(400);
    expect(res.headers.get("Cache-Control")).toBe("private, no-store");
    expect(STATE.rpcCalls).toHaveLength(0);
  });

  it("TC4b — Infinity-shaped metric (huge non-finite via string) → 400, no RPC", async () => {
    const { POST } = await import("./route");
    // A raw JSON body whose sortino is a non-finite encoding is impossible in
    // strict JSON; instead assert a null metric is rejected as non-finite.
    const res = await POST(
      makeRequest({ sharpe: 1.4, sortino: null, maxDD: -0.18, n: 300 }),
    );

    expect(res.status).toBe(400);
    expect(STATE.rpcCalls).toHaveLength(0);
  });

  it("TC5 — missing field (no n) → 400 + NO_STORE, no RPC", async () => {
    const { POST } = await import("./route");

    const res = await POST(makeRequest({ sharpe: 1.4, sortino: 2.1, maxDD: -0.18 }));

    expect(res.status).toBe(400);
    expect(res.headers.get("Cache-Control")).toBe("private, no-store");
    expect(STATE.rpcCalls).toHaveLength(0);
  });

  it("TC6 — invalid JSON body → 400 + NO_STORE, no RPC", async () => {
    const { POST } = await import("./route");

    const res = await POST(makeRequest("{not valid json"));

    expect(res.status).toBe(400);
    expect(res.headers.get("Cache-Control")).toBe("private, no-store");
    expect(STATE.rpcCalls).toHaveLength(0);
  });

  it("TC7 — rate-limit exhausted → 429 + Retry-After + NO_STORE, no RPC", async () => {
    STATE.checkLimitResult = { success: false, retryAfter: 42 };
    const { POST } = await import("./route");

    const res = await POST(makeRequest(VALID_BODY));

    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBe("42");
    expect(res.headers.get("Cache-Control")).toBe("private, no-store");
    const body = await res.json();
    expect(body.error).toBe("Too many requests");
    expect(STATE.rpcCalls).toHaveLength(0);
  });

  it("TC8 — rate-limit misconfigured (fail-CLOSED) → 503 + Retry-After + NO_STORE, no RPC", async () => {
    STATE.checkLimitResult = {
      success: false,
      retryAfter: 60,
      reason: "ratelimit_misconfigured",
    };
    const { POST } = await import("./route");

    const res = await POST(makeRequest(VALID_BODY));

    expect(res.status).toBe(503);
    expect(res.headers.get("Retry-After")).toBe("60");
    expect(res.headers.get("Cache-Control")).toBe("private, no-store");
    const body = await res.json();
    expect(body.error).toBe("Service temporarily unavailable");
    expect(STATE.rpcCalls).toHaveLength(0);
  });

  it("TC9 — RPC NULL-rank row (cohort_n < 20) → 200 { peer: null } + NO_STORE", async () => {
    STATE.rpcRows = [
      { cohort_n: 7, sharpe_pct: null, sortino_pct: null, max_dd_pct: null },
    ];
    const { POST } = await import("./route");

    const res = await POST(makeRequest(VALID_BODY));

    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("private, no-store");
    const body = await res.json();
    expect(body).toEqual({ peer: null });
    // The RPC was still called (the suppression is the RPC's, not the route's).
    const call = STATE.rpcCalls.find((c) => c.name === "get_verified_cohort_rank");
    expect(call).toBeDefined();
  });

  it("TC9b — empty rows (no cohort at all) → 200 { peer: null }", async () => {
    STATE.rpcRows = [];
    const { POST } = await import("./route");

    const res = await POST(makeRequest(VALID_BODY));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ peer: null });
  });

  it("TC10 — RPC full rank → 200 { peer: {cohortSize,sharpe,sortino,max_dd} }, ONLY those keys, no distribution/identity", async () => {
    STATE.rpcRows = [
      { cohort_n: 42, sharpe_pct: 70, sortino_pct: 65, max_dd_pct: 55 },
    ];
    const { POST } = await import("./route");

    const res = await POST(makeRequest(VALID_BODY));

    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("private, no-store");
    const body = await res.json();

    // The top-level response carries ONLY the `peer` key.
    expect(Object.keys(body)).toEqual(["peer"]);
    // The peer object carries EXACTLY the 4 PeerPercentilePayload fields — no
    // cohort distribution, no per-strategy id/name/returns, no extra column.
    expect(Object.keys(body.peer).sort()).toEqual(
      ["cohortSize", "max_dd", "sharpe", "sortino"],
    );
    expect(body.peer).toEqual({
      cohortSize: 42,
      sharpe: 70,
      sortino: 65,
      max_dd: 55,
    });
  });

  it("TC11 — RPC is called with p_max_dd = Math.abs(maxDD) (magnitude convention)", async () => {
    STATE.rpcRows = [
      { cohort_n: 42, sharpe_pct: 70, sortino_pct: 65, max_dd_pct: 55 },
    ];
    const { POST } = await import("./route");

    await POST(makeRequest({ sharpe: 1.4, sortino: 2.1, maxDD: -0.23, n: 300 }));

    const call = STATE.rpcCalls.find((c) => c.name === "get_verified_cohort_rank");
    expect(call).toBeDefined();
    expect(call!.args).toEqual({
      p_sharpe: 1.4,
      p_sortino: 2.1,
      p_max_dd: 0.23, // abs(-0.23)
    });
  });

  it("TC12 — RPC error → structured 500 (no raw DB message) + NO_STORE", async () => {
    const rawDbMessage =
      "function public.get_verified_cohort_rank: relation strategy_analytics does not exist";
    STATE.rpcError = { code: "42P01", message: rawDbMessage };
    const { POST } = await import("./route");

    const res = await POST(makeRequest(VALID_BODY));

    expect(res.status).toBe(500);
    expect(res.headers.get("Cache-Control")).toBe("private, no-store");
    const body = await res.json();
    expect(typeof body.error).toBe("string");
    // The raw DB internals must never reach the client.
    expect(body.error).not.toBe(rawDbMessage);
    expect(body.error).not.toMatch(/strategy_analytics/);
    expect(body.error).not.toMatch(/get_verified_cohort_rank/);
  });

  it("TC13 — CSRF short-circuits before auth/RPC", async () => {
    const { NextResponse } = await import("next/server");
    STATE.csrfResponse = NextResponse.json(
      { error: "Origin not allowed" },
      { status: 403 },
    );
    const { POST } = await import("./route");

    const res = await POST(makeRequest(VALID_BODY));

    expect(res.status).toBe(403);
    expect(STATE.rpcCalls).toHaveLength(0);
  });

  it("TC14 — a 400 validation failure consumes no rate-limit token (limiter after validate)", async () => {
    const { POST } = await import("./route");

    const res = await POST(makeRequest({ sharpe: 1.4 })); // missing fields

    expect(res.status).toBe(400);
    // checkLimit must NOT have been reached on the rejected-body path.
    expect(STATE.lastCheckLimitArg).toBeNull();
  });

  it("TC15 — the route is wired to scenarioPeerLimiter", async () => {
    STATE.rpcRows = [
      { cohort_n: 42, sharpe_pct: 70, sortino_pct: 65, max_dd_pct: 55 },
    ];
    const { POST } = await import("./route");

    await POST(makeRequest(VALID_BODY));

    expect(STATE.lastCheckLimitArg).toBe(SCENARIO_PEER_LIMITER_SENTINEL);
  });
});
