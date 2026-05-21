import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest, NextResponse } from "next/server";

/**
 * Tests for POST /api/bridge (G13-004).
 *
 * Covers 7 branches: CSRF, auth, rate-limit, JSON parse, validation,
 * ownership, scoring. Mirrors simulator/route.test.ts.
 *
 * TC4 (G13-038/G15-046 family) asserts the desired behavior: a
 * ratelimit_misconfigured fail-CLOSED result SHOULD surface as 503 so
 * canary alarms fire instead of looking like a normal 429 throttle.
 * The route does not currently call isRateLimitMisconfigured(rl); the
 * test is marked it.fails so the regression is visible and unblocks
 * merge until the fix lands.
 *
 * G13-038 separately notes the route's 429 envelope is missing the
 * Retry-After header. TC3 pins both the absence of the header AND the
 * desired presence as a follow-up TODO.
 */

vi.mock("server-only", () => ({}));

const STATE = vi.hoisted(() => ({
  authUser: {
    id: "00000000-0000-0000-0000-000000000001",
    email: "alloc@test.sec",
  } as { id: string; email: string } | null,
  checkLimitResult: { success: true } as
    | { success: true }
    | { success: false; retryAfter: number; reason?: "ratelimit_misconfigured" },
  csrfShouldReject: false,
  portfolioFound: true,
  findReplacementImpl: (async () => ({
    candidates: [],
  })) as (
    portfolioId: string,
    underperformerId: string,
    userId: string,
  ) => Promise<unknown>,
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: {
      getUser: async () => ({
        data: { user: STATE.authUser },
        error: null,
      }),
    },
    from: (table: string) => {
      if (table === "portfolios") {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                single: async () =>
                  STATE.portfolioFound
                    ? {
                        data: { id: "00000000-0000-0000-0000-000000000010" },
                        error: null,
                      }
                    : { data: null, error: { message: "not found" } },
              }),
            }),
          }),
        };
      }
      throw new Error(`unexpected from(${table})`);
    },
  }),
}));

vi.mock("@/lib/csrf", () => ({
  assertSameOrigin: () =>
    STATE.csrfShouldReject
      ? NextResponse.json({ error: "Origin not allowed" }, { status: 403 })
      : null,
}));

vi.mock("@/lib/ratelimit", () => ({
  userActionLimiter: {},
  checkLimit: async () => STATE.checkLimitResult,
  isRateLimitMisconfigured: (
    rl: { success: boolean; reason?: string },
  ): boolean =>
    rl.success === false && rl.reason === "ratelimit_misconfigured",
}));

vi.mock("@/lib/analytics-client", async () => {
  class AnalyticsUpstreamError extends Error {
    readonly status: number;
    constructor(message: string, status: number) {
      super(message);
      this.name = "AnalyticsUpstreamError";
      this.status = status;
    }
  }
  return {
    AnalyticsUpstreamError,
    findReplacementCandidates: (
      portfolioId: string,
      underperformerId: string,
      userId: string,
    ) => STATE.findReplacementImpl(portfolioId, underperformerId, userId),
  };
});

const PORTFOLIO_ID = "00000000-0000-0000-0000-000000000010";
const UNDERPERFORMER_ID = "11111111-1111-4111-8111-111111111111";

function makeRequest(body: unknown, opts?: { rawBody?: string }): NextRequest {
  return new NextRequest("http://localhost:3000/api/bridge", {
    method: "POST",
    headers: {
      origin: "http://localhost:3000",
      "content-type": "application/json",
    },
    body: opts?.rawBody ?? JSON.stringify(body),
  });
}

beforeEach(() => {
  STATE.authUser = {
    id: "00000000-0000-0000-0000-000000000001",
    email: "alloc@test.sec",
  };
  STATE.checkLimitResult = { success: true };
  STATE.csrfShouldReject = false;
  STATE.portfolioFound = true;
  STATE.findReplacementImpl = async () => ({ candidates: [] });
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("POST /api/bridge", () => {
  it("TC1 — 401 when no user", async () => {
    STATE.authUser = null;
    const { POST } = await import("./route");
    const res = await POST(
      makeRequest({
        portfolio_id: PORTFOLIO_ID,
        underperformer_strategy_id: UNDERPERFORMER_ID,
      }),
    );
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBe("Unauthorized");
  });

  it("TC2 — 403 CSRF when origin allowlist fails", async () => {
    STATE.csrfShouldReject = true;
    const { POST } = await import("./route");
    const res = await POST(
      makeRequest({
        portfolio_id: PORTFOLIO_ID,
        underperformer_strategy_id: UNDERPERFORMER_ID,
      }),
    );
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toBe("Origin not allowed");
  });

  it("TC3 — 429 when checkLimit() denies (real throttle)", async () => {
    STATE.checkLimitResult = { success: false, retryAfter: 30 };
    const { POST } = await import("./route");
    const res = await POST(
      makeRequest({
        portfolio_id: PORTFOLIO_ID,
        underperformer_strategy_id: UNDERPERFORMER_ID,
      }),
    );
    expect(res.status).toBe(429);
    const body = await res.json();
    expect(body.error).toMatch(/Too many requests/i);
  });

  // G13-038: 429 envelope includes Retry-After header (parity with sibling
  // routes). Closed by the route emitting headers: { "Retry-After": ... }.
  it("TC3b — 429 envelope includes Retry-After header (G13-038)", async () => {
    STATE.checkLimitResult = { success: false, retryAfter: 30 };
    const { POST } = await import("./route");
    const res = await POST(
      makeRequest({
        portfolio_id: PORTFOLIO_ID,
        underperformer_strategy_id: UNDERPERFORMER_ID,
      }),
    );
    expect(res.headers.get("Retry-After")).toBe("30");
  });

  // G15-046 / G20-030 family: ratelimit_misconfigured surfaces as 503 so
  // canary alarms catch the configuration outage rather than treating
  // users as throttled. Closed by the route calling isRateLimitMisconfigured(rl).
  it("TC3c — 503 when checkLimit() returns ratelimit_misconfigured", async () => {
    STATE.checkLimitResult = {
      success: false,
      retryAfter: 60,
      reason: "ratelimit_misconfigured",
    };
    const { POST } = await import("./route");
    const res = await POST(
      makeRequest({
        portfolio_id: PORTFOLIO_ID,
        underperformer_strategy_id: UNDERPERFORMER_ID,
      }),
    );
    expect(res.status).toBe(503);
  });

  it("TC4 — 400 bad JSON", async () => {
    const { POST } = await import("./route");
    const res = await POST(makeRequest(null, { rawBody: "{not json" }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("Invalid JSON");
  });

  it("TC5 — 400 invalid body shape (missing fields)", async () => {
    const { POST } = await import("./route");
    const res = await POST(
      makeRequest({ portfolio_id: PORTFOLIO_ID }),
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/required/i);
  });

  it("TC5b — 400 invalid body shape (empty fields)", async () => {
    const { POST } = await import("./route");
    const res = await POST(
      makeRequest({ portfolio_id: "", underperformer_strategy_id: "" }),
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/required/i);
  });

  it("TC6 — 404 when portfolio ownership check fails (cross-tenant)", async () => {
    STATE.portfolioFound = false;
    const { POST } = await import("./route");
    const res = await POST(
      makeRequest({
        portfolio_id: PORTFOLIO_ID,
        underperformer_strategy_id: UNDERPERFORMER_ID,
      }),
    );
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toBe("Portfolio not found");
  });

  it("TC7 — happy path forwards body shape from analytics-client", async () => {
    let capturedArgs: { portfolio: string; under: string; user: string } | null =
      null;
    STATE.findReplacementImpl = async (portfolioId, underId, userId) => {
      capturedArgs = { portfolio: portfolioId, under: underId, user: userId };
      return {
        candidates: [{ id: "cand-1", score: 0.9 }],
      };
    };
    const { POST } = await import("./route");
    const res = await POST(
      makeRequest({
        portfolio_id: PORTFOLIO_ID,
        underperformer_strategy_id: UNDERPERFORMER_ID,
      }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({
      candidates: [{ id: "cand-1", score: 0.9 }],
    });
    expect(capturedArgs).toEqual({
      portfolio: PORTFOLIO_ID,
      under: UNDERPERFORMER_ID,
      user: "00000000-0000-0000-0000-000000000001",
    });
  });

  it("TC8 — scoring throws → 500 with err.message", async () => {
    STATE.findReplacementImpl = async () => {
      throw new Error("scoring went sideways");
    };
    const { POST } = await import("./route");
    const res = await POST(
      makeRequest({
        portfolio_id: PORTFOLIO_ID,
        underperformer_strategy_id: UNDERPERFORMER_ID,
      }),
    );
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toBe("scoring went sideways");
  });
});
