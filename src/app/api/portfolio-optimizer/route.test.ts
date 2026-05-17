import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

/**
 * Tests for POST /api/portfolio-optimizer — audit-2026-05-07 cluster A.
 *
 * Coverage anchors:
 *   - C-0106 (pr-test-analyzer c8): unauth 401, missing portfolio_id
 *     400, cross-tenant 403, timeout 504, analytics 5xx 503.
 *   - C-0107 (api-contract c8): rate-limit wired to userActionLimiter,
 *     429 + Retry-After.
 *   - C-0108 (red-team c5): assertPortfolioOwnership is called with
 *     (portfolioId, user.id); a non-owner gets 403 without ever
 *     invoking the analytics client.
 *   - M-0332 (type-design-analyzer c8): suggestions surface in the
 *     response unchanged (no `as` cast, schema-modeled).
 *   - M-0333 (api-contract c8): 503 envelope is opaque
 *     ("Analytics service unreachable") — does NOT leak err.message.
 */

vi.mock("server-only", () => ({}));

const { FakeAnalyticsTimeoutError } = vi.hoisted(() => {
  class FakeAnalyticsTimeoutError extends Error {
    constructor() {
      super("timeout");
      this.name = "AnalyticsTimeoutError";
    }
  }
  return { FakeAnalyticsTimeoutError };
});

const STATE = vi.hoisted(() => ({
  authUser: { id: "00000000-0000-0000-0000-000000000001" } as
    | { id: string }
    | null,
  csrfResponse: null as null | Response,
  checkLimitResult: { success: true } as
    | { success: true }
    | { success: false; retryAfter: number },
  ownershipResult: true,
  ownershipCalls: [] as Array<{ portfolioId: string; userId: string }>,
  optimizerImpl: (async (_id: string, _ms?: number) => ({
    status: "complete",
    suggestions: [{ symbol: "BTC", weight: 0.3 }],
  })) as (id: string, ms?: number) => Promise<unknown>,
  // Audit-2026-05-07 red-team R-0002: track refund calls so the
  // symmetric-refund tests can assert the 504/503 paths refund the token.
  refundCalls: [] as string[],
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: {
      getUser: async () => ({ data: { user: STATE.authUser }, error: null }),
    },
  }),
}));

vi.mock("@/lib/csrf", () => ({
  assertSameOrigin: () => STATE.csrfResponse,
}));

vi.mock("@/lib/ratelimit", () => ({
  userActionLimiter: {
    resetUsedTokens: async (key: string) => {
      STATE.refundCalls.push(key);
    },
  },
  checkLimit: async () => STATE.checkLimitResult,
}));

vi.mock("@/lib/queries", () => ({
  assertPortfolioOwnership: async (portfolioId: string, userId: string) => {
    STATE.ownershipCalls.push({ portfolioId, userId });
    return STATE.ownershipResult;
  },
}));

vi.mock("@/lib/analytics-client", () => ({
  runPortfolioOptimizer: (id: string, ms?: number) =>
    STATE.optimizerImpl(id, ms),
  AnalyticsTimeoutError: FakeAnalyticsTimeoutError,
}));

import { POST } from "./route";

function buildRequest(body: unknown): NextRequest {
  return new NextRequest("https://example.com/api/portfolio-optimizer", {
    method: "POST",
    headers: {
      origin: "https://example.com",
      "content-type": "application/json",
    },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

beforeEach(() => {
  STATE.authUser = { id: "00000000-0000-0000-0000-000000000001" };
  STATE.csrfResponse = null;
  STATE.checkLimitResult = { success: true };
  STATE.ownershipResult = true;
  STATE.ownershipCalls = [];
  STATE.optimizerImpl = async () => ({
    status: "complete",
    suggestions: [{ symbol: "BTC", weight: 0.3 }],
  });
  STATE.refundCalls = [];
});

describe("POST /api/portfolio-optimizer — audit-2026-05-07 cluster A", () => {
  it("C-0106 #1: returns 401 when unauthenticated", async () => {
    STATE.authUser = null;
    const res = await POST(
      buildRequest({ portfolio_id: "0000-portfolio" }),
    );
    expect(res.status).toBe(401);
  });

  it("C-0106 #2: returns 400 when portfolio_id is missing", async () => {
    const res = await POST(buildRequest({}));
    expect(res.status).toBe(400);
  });

  it("CSRF: returns CSRF response when origin doesn't match", async () => {
    STATE.csrfResponse = new Response(null, { status: 403 }) as Response;
    const res = await POST(buildRequest({ portfolio_id: "x" }));
    expect(res.status).toBe(403);
  });

  it("C-0107: returns 429 + Retry-After when over rate limit", async () => {
    STATE.checkLimitResult = { success: false, retryAfter: 42 };
    const res = await POST(buildRequest({ portfolio_id: "x" }));
    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toBe("42");
  });

  it("C-0106 #3 / C-0108: returns 403 when assertPortfolioOwnership=false (cross-tenant)", async () => {
    STATE.ownershipResult = false;
    let optimizerCalled = false;
    STATE.optimizerImpl = async () => {
      optimizerCalled = true;
      return { status: "complete", suggestions: [] };
    };
    const res = await POST(
      buildRequest({ portfolio_id: "00000000-0000-0000-0000-000000000999" }),
    );
    expect(res.status).toBe(403);
    expect(optimizerCalled).toBe(false);
    // assertPortfolioOwnership called with the auth-derived user id.
    expect(STATE.ownershipCalls).toHaveLength(1);
    expect(STATE.ownershipCalls[0].userId).toBe(
      "00000000-0000-0000-0000-000000000001",
    );
  });

  it("C-0106 #4: returns 504 on AnalyticsTimeoutError", async () => {
    STATE.optimizerImpl = async () => {
      throw new FakeAnalyticsTimeoutError();
    };
    const res = await POST(buildRequest({ portfolio_id: "x" }));
    expect(res.status).toBe(504);
    const body = await res.json();
    expect(body.error).toBe("Optimizer timed out");
  });

  it("C-0106 #5 / M-0333: returns 503 with OPAQUE error envelope on analytics 5xx (does NOT leak err.message)", async () => {
    STATE.optimizerImpl = async () => {
      throw new Error("INTERNAL DEBUG: http://localhost:8002/x failed with token=ABC");
    };
    const res = await POST(buildRequest({ portfolio_id: "x" }));
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.error).toBe("Analytics service unreachable");
    expect(body.error).not.toContain("localhost");
    expect(body.error).not.toContain("token=ABC");
  });

  it("M-0332: suggestions field passes through unchanged on happy path", async () => {
    const res = await POST(buildRequest({ portfolio_id: "x" }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("complete");
    expect(body.suggestions).toEqual([{ symbol: "BTC", weight: 0.3 }]);
  });

  it("M-0332: missing suggestions in upstream response coerces to []", async () => {
    STATE.optimizerImpl = async () => ({ status: "complete" });
    const res = await POST(buildRequest({ portfolio_id: "x" }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.suggestions).toEqual([]);
  });

  it("Invalid JSON body returns 400", async () => {
    const res = await POST(buildRequest("not json"));
    expect(res.status).toBe(400);
  });

  it("red-team R-0002: 504 timeout refunds the 5/min token (analytics-side failure)", async () => {
    STATE.optimizerImpl = async () => {
      throw new FakeAnalyticsTimeoutError();
    };
    const res = await POST(buildRequest({ portfolio_id: "x" }));
    expect(res.status).toBe(504);
    expect(STATE.refundCalls).toContain(
      "optimizer:00000000-0000-0000-0000-000000000001",
    );
  });

  it("red-team R-0002: 503 analytics-unreachable refunds the 5/min token", async () => {
    STATE.optimizerImpl = async () => {
      throw new Error("connection refused");
    };
    const res = await POST(buildRequest({ portfolio_id: "x" }));
    expect(res.status).toBe(503);
    expect(STATE.refundCalls).toContain(
      "optimizer:00000000-0000-0000-0000-000000000001",
    );
  });

  it("red-team R-0002: 200 happy path does NOT refund (only failure paths refund)", async () => {
    const res = await POST(buildRequest({ portfolio_id: "x" }));
    expect(res.status).toBe(200);
    expect(STATE.refundCalls).toHaveLength(0);
  });
});
