import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";
// Phase 140 / SEAM-04: the REAL breaker error, taken from the dependency-free
// leaf. It must NEVER be picked up through `@/lib/analytics-client` — this file
// mocks that module wholesale (a bare factory), so the class read through it
// would be `undefined` and `err instanceof undefined` throws a TypeError from
// inside the route's own catch block (threat T-140-30). Nothing mocks the leaf,
// and this file never calls vi.resetModules(), so a static import here is the
// same class object the route narrows against.
import { CircuitOpenError } from "@/lib/seam-errors";

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

// ─────────────────────────────────────────────────────────────────────────────
// 140.3-13b / SEAMUX-08 — the Sentry capture, tested through the REAL helper.
//
// ⚠️ `@sentry/nextjs` is mocked here and `@/lib/sentry-capture` is DELIBERATELY
// NOT. Mocking the helper would answer "did the call site fire" while making
// every payload assertion VACUOUS about scrubbing — the scrub lives INSIDE the
// helper (SEAMCORE-06), so a mocked helper never runs it and "no secret in the
// payload" would pass with the scrubber deleted. Inherited from `140.3-13a`.
// ─────────────────────────────────────────────────────────────────────────────
const sentryState = vi.hoisted(() => ({
  captured: [] as Array<{
    err: unknown;
    options: {
      tags?: Record<string, string>;
      extra?: Record<string, unknown>;
      level?: string;
    };
  }>,
}));

vi.mock("@sentry/nextjs", () => ({
  captureException: (err: unknown, options: Record<string, unknown>) => {
    sentryState.captured.push({
      err,
      options: options as (typeof sentryState.captured)[number]["options"],
    });
  },
}));

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
  optimizerImpl: (async (_id: string, _actorId: string, _ms?: number) => ({
    status: "complete",
    suggestions: [{ symbol: "BTC", weight: 0.3 }],
  })) as (id: string, actorId: string, ms?: number) => Promise<unknown>,
  // C-PR5-01 follow-up (audit-2026-05-07): pin every actor_id forwarded
  // through to the analytics service so a future regression dropping
  // the user.id arg (re-opening the cross-tenant compute path) breaks a
  // test rather than silently shipping. Symmetric to ownershipCalls.
  optimizerCalls: [] as Array<{
    id: string;
    actorId: string;
    ms?: number;
  }>,
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
  runPortfolioOptimizer: (id: string, actorId: string, ms?: number) => {
    STATE.optimizerCalls.push({ id, actorId, ms });
    return STATE.optimizerImpl(id, actorId, ms);
  },
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
  STATE.optimizerCalls = [];
  STATE.refundCalls = [];
  sentryState.captured.length = 0;
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

  // C-PR5-01 follow-up (audit-2026-05-07, PR-5 security review):
  // the analytics-service `/api/portfolio-optimizer` Python handler
  // gates ownership on `req.user_id`. The TS route MUST forward
  // `user.id` (NOT a body-supplied value) so a forged request can't
  // pass an arbitrary `user_id` and bypass the ownership filter.
  // PR #347 closed the same shape on /api/match/recompute via actor
  // binding; this pins the corresponding forward here.
  it("C-PR5-01: forwards authenticated user.id as actorId, not body-supplied", async () => {
    STATE.authUser = { id: "11111111-1111-4111-8111-111111111111" };
    const res = await POST(
      buildRequest({
        portfolio_id: "00000000-0000-0000-0000-000000000123",
        // Spoofed user_id in body — MUST be ignored.
        user_id: "99999999-9999-9999-9999-999999999999",
      }),
    );
    expect(res.status).toBe(200);
    expect(STATE.optimizerCalls).toHaveLength(1);
    expect(STATE.optimizerCalls[0].actorId).toBe(
      "11111111-1111-4111-8111-111111111111",
    );
    // Negative: the body-supplied value never reached the analytics layer.
    expect(STATE.optimizerCalls[0].actorId).not.toBe(
      "99999999-9999-9999-9999-999999999999",
    );
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

  // Phase 140 / SEAM-04 (SC-5c). Status alone does NOT discriminate here: the
  // pre-existing generic arm ALSO returns 503. What separates a breaker trip
  // from "analytics unreachable" is the Retry-After cooldown and the distinct
  // static copy — so both are asserted, not just the status.
  it("SEAM-04: CircuitOpenError → 503 + Retry-After with the breaker's own TTL, distinct from the generic 503", async () => {
    // 9, deliberately NOT the 30s breaker default (which is simultaneously
    // BREAKER_COOLDOWN_S and DEFAULT_RETRY_AFTER_S): a hardcoded "30" in the
    // route would pass a 30-second fixture but fails this one.
    STATE.optimizerImpl = async () => {
      throw new CircuitOpenError(9);
    };
    const res = await POST(buildRequest({ portfolio_id: "x" }));

    expect(res.status).toBe(503);
    expect(res.headers.get("Retry-After")).toBe("9");
    expect(res.headers.get("Cache-Control")).toBe("private, no-store");
    const body = await res.json();
    // The route's own envelope shape is preserved on the new arm.
    expect(body.status).toBe("failed");
    expect(body.suggestions).toBeNull();
    expect(body.error).toBe(
      "The analytics service is temporarily unavailable. Please try again in a moment.",
    );
    // M-0333 / T-140-17: the copy names no infrastructure.
    expect(body.error).not.toMatch(/circuit|breaker|upstash|railway|http/i);
  });

  // red-team R-0002 consistency: this route already refunds the 5/min token on
  // both upstream-failure arms (504 timeout, 503 unreachable) because the
  // failure is upstream of the caller. A breaker trip is the PUREST case of
  // that — the request was never even issued — so it must refund too. Without
  // this, a Railway outage silently burns a legitimate user's whole budget on
  // requests that never left Vercel.
  it("red-team R-0002: the CIRCUIT_OPEN arm refunds the 5/min token", async () => {
    STATE.optimizerImpl = async () => {
      throw new CircuitOpenError(9);
    };
    const res = await POST(buildRequest({ portfolio_id: "x" }));

    expect(res.status).toBe(503);
    expect(STATE.refundCalls).toContain(
      "optimizer:00000000-0000-0000-0000-000000000001",
    );
  });

  // Phase 140 / SEAM-02: the route's deadline is owned by the ONE budget table
  // (SEAM_BUDGETS["portfolio-optimizer"]), reached via the wrapper's budgetKey.
  // The route must NOT pass a per-call timeout override — a local constant is
  // exactly the scattered-budget drift the table exists to end, and it silently
  // wins over the table whenever the two disagree.
  it("SEAM-02: the route passes NO timeout override — the budget comes from the table", async () => {
    const res = await POST(buildRequest({ portfolio_id: "x" }));
    expect(res.status).toBe(200);
    expect(STATE.optimizerCalls).toHaveLength(1);
    expect(STATE.optimizerCalls[0].ms).toBeUndefined();
  });

  it("F5b: every response carries Cache-Control: private, no-store", async () => {
    // audit-2026-05-07 Block D / P1947: the 200 body is the allocator's
    // optimizer suggestions — a shared cache must never retain it. Pin
    // no-store on the 200 success body and representative error paths,
    // including coexistence with Retry-After on the 429 throttle.
    const okRes = await POST(buildRequest({ portfolio_id: "x" }));
    expect(okRes.status).toBe(200);
    expect(okRes.headers.get("Cache-Control")).toBe("private, no-store");

    STATE.checkLimitResult = { success: false, retryAfter: 42 };
    const throttled = await POST(buildRequest({ portfolio_id: "x" }));
    expect(throttled.status).toBe(429);
    expect(throttled.headers.get("Cache-Control")).toBe("private, no-store");
    expect(throttled.headers.get("retry-after")).toBe("42");

    STATE.authUser = null;
    const unauth = await POST(buildRequest({ portfolio_id: "x" }));
    expect(unauth.status).toBe(401);
    expect(unauth.headers.get("Cache-Control")).toBe("private, no-store");
  });
});

/**
 * 140.3-13b / SEAMUX-08 — this route captures to Sentry, under the ONE policy
 * written out in `src/app/api/admin/match/eval/route.ts`.
 *
 * ⚠️ THE BASELINE WAS ZERO, measured on the untouched tree:
 * `grep -vE '^\s*(//|\*)' route.ts | grep -c captureToSentry` read **0** here.
 * Nine of the fifteen seam routes read 0, while `wizardErrors.ts` copy told
 * users "our team has been notified". `140.3-12` removed the claim; `140.3-13a`
 * (4 routes) and this plan (5) make it true.
 *
 * ⚠️ B-26 CONTEXT: this is the route whose invalidated result used to stay on
 * screen with live "Add to portfolio" links. The failure was money-bearing AND
 * completely unreported — nobody was ever paged for it.
 */
describe("[140.3-13b / SEAMUX-08] POST /api/portfolio-optimizer — Sentry capture policy", () => {
  /** A 40-char internal token, the shape INTERNAL_API_TOKEN actually carries. */
  const INTERNAL_TOKEN = "int_9f3a1c7e5b2d84a6f0c1e3d5b7a9f2c48e6d0b1a";
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubEnv("INTERNAL_API_TOKEN", INTERNAL_TOKEN);
  });

  afterEach(() => {
    errorSpy.mockRestore();
    vi.unstubAllEnvs();
  });

  /** Wait for `captureToSentry`'s lazy `import(...).then(...)` chain. */
  async function nextCapture() {
    await vi.waitFor(() =>
      expect(
        sentryState.captured.length,
        "nothing was captured — the terminal arm is the only place an unclassified seam failure at this route is ever reported",
      ).toBeGreaterThan(0),
    );
    return sentryState.captured[sentryState.captured.length - 1];
  }

  /** Assert no capture happened, allowing the lazy chain time to have fired. */
  async function expectNoCapture() {
    await new Promise((r) => setTimeout(r, 0));
    expect(sentryState.captured).toEqual([]);
  }

  it("POSITIVE: an unclassified transport failure IS captured, with this route's tags", async () => {
    STATE.optimizerImpl = async () => {
      throw new Error(
        `connect ECONNREFUSED 10.0.0.5:8002 (X-Internal-Token: ${INTERNAL_TOKEN})`,
      );
    };
    const res = await POST(buildRequest({ portfolio_id: "pf-77" }));
    expect(res.status).toBe(503);

    const { err, options } = await nextCapture();
    expect(options.tags?.surface).toBe("portfolio-optimizer");
    expect(options.tags?.step).toBe("analytics-unreachable");
    // The Error TYPE survives — `captureToSentry` rebuilds an Error rather than
    // stringifying, so Sentry keeps its grouping and stack.
    expect(err).toBeInstanceOf(Error);
    expect(options.extra?.portfolio_id).toBe("pf-77");
  });

  it("TRAP-1 BOTH DIRECTIONS: the captured payload loses the secret and KEEPS the syscall token", async () => {
    STATE.optimizerImpl = async () => {
      throw new Error(
        `connect ECONNREFUSED 10.0.0.5:8002 (X-Internal-Token: ${INTERNAL_TOKEN})`,
      );
    };
    await POST(buildRequest({ portfolio_id: "pf-77" }));

    const message = ((await nextCapture()).err as Error).message;
    // UNDER-redaction: a credential leaving our infrastructure for a third
    // party is the whole of T-140.3-13-01.
    expect(
      message,
      "a live INTERNAL_API_TOKEN was dispatched to Sentry — undici inlines outgoing headers into err.message (TRAP-1)",
    ).not.toContain(INTERNAL_TOKEN);
    // OVER-redaction: destroying the syscall token replaces one incident with
    // two, and a one-sided test ships that state green.
    expect(
      message,
      "the syscall token was eaten by the redactor — ECONNREFUSED is the most valuable thing in a transport line",
    ).toContain("ECONNREFUSED");
  });

  it("NEGATIVE: a breaker short-circuit is NEVER captured (it fires on every seam route at once)", async () => {
    STATE.optimizerImpl = async () => {
      throw new CircuitOpenError(13);
    };
    const res = await POST(buildRequest({ portfolio_id: "pf-77" }));
    // The POSITIVE half: the breaker arm really ran — status, cooldown header
    // AND the R-0002 refund — so the zero below is about the policy and not
    // about the request never reaching the catch.
    expect(res.status).toBe(503);
    expect(res.headers.get("Retry-After")).toBe("13");
    expect(STATE.refundCalls).toHaveLength(1);
    await expectNoCapture();
  });

  it("NEGATIVE: an upstream timeout is NEVER captured (expected under a cold start; a sustained one trips the breaker)", async () => {
    STATE.optimizerImpl = async () => {
      throw new FakeAnalyticsTimeoutError();
    };
    const res = await POST(buildRequest({ portfolio_id: "pf-77" }));
    expect(res.status).toBe(504);
    await expectNoCapture();
  });

  it("NEGATIVE: our own 403 ownership refusal is NEVER captured, and never reaches the seam", async () => {
    STATE.ownershipResult = false;
    const res = await POST(buildRequest({ portfolio_id: "someone-elses" }));
    expect(res.status).toBe(403);
    expect(STATE.optimizerCalls).toHaveLength(0);
    await expectNoCapture();
  });

  it("NEGATIVE: our own rate-limit rejection is NEVER captured (the limiter working is not a fault)", async () => {
    STATE.checkLimitResult = { success: false, retryAfter: 42 };
    const res = await POST(buildRequest({ portfolio_id: "pf-77" }));
    expect(res.status).toBe(429);
    await expectNoCapture();
  });
});
