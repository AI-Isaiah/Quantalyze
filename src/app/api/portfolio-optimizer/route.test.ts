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
 *   - C-0107 (api-contract c8): rate-limit wired to a per-caller limiter,
 *     429 + Retry-After. (Phase 163 SEC-04 moved it from `userActionLimiter`
 *     to `bridgeComputeLimiter`; WR-03 then removed the 5xx token refund.)
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
  // 140.4-13 / SEAMRIM-05 — the THIRD outcome. `reason` absent is a genuine
  // throttle (429); "ratelimit_misconfigured" is OUR store being unreachable
  // and must answer 503.
  checkLimitResult: { success: true } as
    | { success: true }
    | {
        success: false;
        retryAfter: number;
        reason?: "ratelimit_misconfigured";
      },
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
  // WR-03 (163 review): every `resetUsedTokens` the route makes, in call order.
  // The assertions INVERTED in this phase — they used to pin that the 5xx arms
  // refund; they now pin that the token stays spent. See the WR-03 block below.
  refundCalls: [] as string[],
  /**
   * WR-03 — a stateful stand-in for the real sliding window, `null` unless a
   * test opts in (so every other case keeps driving `checkLimitResult`
   * directly).
   *
   * ⚠️ THIS MODELS THE LIBRARY, NOT THE FIX. `used` counts consumed tokens and
   * `reset()` sets it back to ZERO — because that is what
   * `@upstash/ratelimit` v2.0.8 actually does: `resetUsedTokens` DELETES every
   * store key matching `<prefix>:<identifier>*` (dist/index.js:881-884 ->
   * `resetTokens`), and the package exposes no decrement. If the double
   * implemented a one-token give-back the invariant test below would pass with
   * the defect in place, which is the vacuity this note exists to prevent.
   */
  bucket: null as null | { limit: number; used: number },
  // Phase 163 SEC-04 — every limiter instance handed to `checkLimit`, in call
  // order, so a test can assert WHICH bucket this route spends BY IDENTITY.
  limitersSeen: [] as unknown[],
}));

/**
 * Phase 163 SEC-04 — the limiter instance this route must consume.
 *
 * A distinguishable object, not `{}`: the identity assertion compares against
 * this exact reference, so "the route called checkLimit" and "the route called
 * checkLimit WITH THE COMPUTE BUCKET" stay different claims.
 */
const BRIDGE_COMPUTE_LIMITER_SENTINEL = vi.hoisted(() => ({
  __id: "bridgeComputeLimiter",
  __limit: "10/3600s",
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

// ⚠️ EXTENDED, NOT REPLACED (140.4-13 / SEAMRIM-05). See the note in
// `src/__tests__/csv-validate-route.test.ts`: the pure helpers come from
// `importActual` so this mock cannot drift from the real 503-vs-429 decision.
// Phase 163 SEC-04 — this route consumes `bridgeComputeLimiter` (10/3600s),
// NOT the shared `userActionLimiter` (5/60s). The mock exposes ONLY the
// limiter the route is supposed to use, so a revert to the shared bucket
// fails here rather than passing quietly. The refund spy hangs off the SAME
// object, which is what pins that a refunded token returns to the bucket the
// token was taken from.
vi.mock("@/lib/ratelimit", async (importActual) => {
  const actual = await importActual<typeof import("@/lib/ratelimit")>();
  return {
    bridgeComputeLimiter: Object.assign(BRIDGE_COMPUTE_LIMITER_SENTINEL, {
      resetUsedTokens: async (key: string) => {
        STATE.refundCalls.push(key);
        // WR-03: the LIBRARY's semantics, faithfully — a reset clears the whole
        // window. Modelling it as "give back one" would hide the defect.
        if (STATE.bucket) STATE.bucket.used = 0;
      },
    }),
    checkLimit: async (limiter: unknown) => {
      STATE.limitersSeen.push(limiter);
      if (!STATE.bucket) return STATE.checkLimitResult;
      // WR-03: consume for real, so denial is an OUTCOME rather than a fixture.
      if (STATE.bucket.used >= STATE.bucket.limit) {
        return { success: false, retryAfter: 3600 };
      }
      STATE.bucket.used += 1;
      return { success: true };
    },
    rateLimitDenyJson: actual.rateLimitDenyJson,
    isRateLimitMisconfigured: actual.isRateLimitMisconfigured,
  };
});

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
  STATE.limitersSeen = [];
  STATE.bucket = null;
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
    // 140.4-13 / SEAMRIM-05 — the 429 SENTENCE is byte-unchanged from the
    // pre-adoption source; 140.3-G6 / SEAMUX-03 adds the machine `code` beside
    // it via the throttledBody override (the builder default is codeless).
    expect(await res.json()).toEqual({
      error: "Too many requests",
      code: "RATE_LIMITED",
    });
    expect(res.headers.get("Cache-Control")).toBe("private, no-store");
  });

  it("[140.4-13 / SEAMRIM-05] ratelimit_misconfigured → 503, not 429", async () => {
    STATE.checkLimitResult = {
      success: false,
      retryAfter: 60,
      reason: "ratelimit_misconfigured",
    };
    const res = await POST(buildRequest({ portfolio_id: "x" }));
    expect(
      res.status,
      "Our Upstash store being unreachable is OUR outage. A 429 renders it as " +
        "the allocator over-using the optimizer, and hides it from the canary.",
    ).toBe(503);
    expect(await res.json()).toEqual({
      error: "Rate limiter unavailable",
      code: "SEAM_MISCONFIGURED",
    });
    expect(res.headers.get("retry-after")).toBe("60");
    expect(res.headers.get("Cache-Control")).toBe("private, no-store");
  });

  /**
   * Phase 163 SEC-04 — the deny arms above, bound to the limiter IDENTITY.
   *
   * ⚠️ WHY THESE EXIST WHEN THE 429/503 CASES ALREADY COVER THE SHAPES. Those
   * drive `STATE.checkLimitResult` directly, so they assert what the route does
   * GIVEN a denial — identically, whichever bucket produced it. Reverting this
   * route to the shared `userActionLimiter` leaves them green. The contracts
   * are therefore not evidence about WHICH budget the caller spends, and
   * SEC-04 is entirely a claim about which budget.
   *
   * ── RED DEMO: neuter -> RED -> restore (performed on the sibling route) ────
   * Reverting a route to `checkLimit(userActionLimiter, ...)` fails on BOTH
   * tiers: STRUCTURALLY in `seam-ratelimit-posture.invariant.test.ts` via
   * EXPECTED_ROUTE_LIMITERS, which names the route and both limiters; and
   * BEHAVIOURALLY here, because the mock exports ONLY `bridgeComputeLimiter`,
   * so the revert cannot resolve its import and fails at the module boundary
   * instead of quietly spending the wrong bucket. Observed on
   * `src/app/api/bridge/route.ts`, then restored from a byte backup (NOT
   * `git checkout --`, which would have destroyed uncommitted work) and
   * verified by shasum.
   */
  it("[163 SEC-04] the 429 is spent from bridgeComputeLimiter, BY IDENTITY", async () => {
    STATE.checkLimitResult = { success: false, retryAfter: 42 };
    const res = await POST(buildRequest({ portfolio_id: "x" }));

    expect(res.status).toBe(429);
    expect(await res.json()).toEqual({
      error: "Too many requests",
      code: "RATE_LIMITED",
    });
    expect(res.headers.get("retry-after")).toBe("42");

    expect(
      STATE.limitersSeen,
      "This route must spend the COMPUTE bucket (10/3600s), not the shared " +
        "userActionLimiter (5/60s = 300/hour). /portfolio-optimizer is capped " +
        "at 10/hour per tenant on the Python side and fires a ~15s round-trip " +
        "per call, so the shared bucket advertised 30x a budget the backend " +
        "will not serve.",
    ).toEqual([BRIDGE_COMPUTE_LIMITER_SENTINEL]);
  });

  it("[163 SEC-04] the misconfigured 503 arm is unchanged by the swap", async () => {
    STATE.checkLimitResult = {
      success: false,
      retryAfter: 60,
      reason: "ratelimit_misconfigured",
    };
    const res = await POST(buildRequest({ portfolio_id: "x" }));

    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({
      error: "Rate limiter unavailable",
      code: "SEAM_MISCONFIGURED",
    });
    expect(STATE.limitersSeen).toEqual([BRIDGE_COMPUTE_LIMITER_SENTINEL]);
  });

  it("[140.4-13 / SEAMRIM-05] success → the deny arm does not fire", async () => {
    STATE.checkLimitResult = { success: true };
    const res = await POST(buildRequest({ portfolio_id: "x" }));
    expect(res.status).not.toBe(429);
    expect(res.status).not.toBe(503);
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

  // ── WR-03 (163 review) — THE REFUND IS GONE, AND THESE PIN THAT ────────────
  //
  // ⚠️ THESE THREE CASES USED TO ASSERT THE OPPOSITE. They pinned that the 504
  // and 503 arms called `bridgeComputeLimiter.resetUsedTokens(key)` — red-team
  // R-0002's "symmetric refund", correct against the 5/60s bucket this route
  // spent when it was written. Phase 163 SEC-04 moved the route to 10/3600s
  // WITHOUT revisiting the refund, and `resetUsedTokens` clears the WHOLE
  // window (there is no decrement in @upstash/ratelimit v2.0.8), so the refund
  // handed back up to ten tokens and up to an hour per failed call. They are
  // INVERTED rather than deleted because the old behaviour is the defect and a
  // reader needs to see that the reversal was deliberate.
  it("[163 WR-03] a 504 timeout does NOT reset the window — the token stays spent", async () => {
    STATE.optimizerImpl = async () => {
      throw new FakeAnalyticsTimeoutError();
    };
    const res = await POST(buildRequest({ portfolio_id: "x" }));
    expect(res.status).toBe(504);
    expect(
      STATE.refundCalls,
      "`resetUsedTokens` clears the caller's entire 10/3600s window. On the " +
        "arm that fires the full ~15s Python round-trip before failing, that " +
        "is an authenticated caller resetting their own cap on every attempt.",
    ).toHaveLength(0);
  });

  it("[163 WR-03] a 503 analytics-unreachable does NOT reset the window", async () => {
    STATE.optimizerImpl = async () => {
      throw new Error("connection refused");
    };
    const res = await POST(buildRequest({ portfolio_id: "x" }));
    expect(res.status).toBe(503);
    expect(STATE.refundCalls).toHaveLength(0);
  });

  it("[163 WR-03] the 200 happy path does not reset the window either", async () => {
    const res = await POST(buildRequest({ portfolio_id: "x" }));
    expect(res.status).toBe(200);
    expect(STATE.refundCalls).toHaveLength(0);
  });

  /**
   * ⭐ WR-03 — THE ECONOMIC INVARIANT. This is the load-bearing case; the three
   * above are its mechanism spelled out.
   *
   * It deliberately does NOT assert that `resetUsedTokens` went uncalled — that
   * assertion pins the implementation to itself and would survive any refund
   * built out of a different call. It asserts the OUTCOME the limiter exists
   * for: a caller who loops into upstream failures is eventually DENIED at the
   * front door. `bridgeComputeLimiter`'s docblock clause (c) states the
   * property in full — "without a compute-sized cap an authenticated caller can
   * hold the single analytics replica busy far past the backend's own budget,
   * degrading every other tenant on it".
   *
   * The bucket double models the LIBRARY (consume decrements; reset zeroes the
   * window), never the fix. With the refund restored, the loop below runs to
   * its 40-iteration ceiling without ever seeing a 429.
   */
  it("[163 WR-03] a caller looping into upstream 504s is EVENTUALLY DENIED", async () => {
    STATE.bucket = { limit: 10, used: 0 };
    STATE.optimizerImpl = async () => {
      throw new FakeAnalyticsTimeoutError();
    };

    const statuses: number[] = [];
    // 40 = 4x the bucket. Bounded so a regression fails the assertion rather
    // than hanging the suite.
    for (let i = 0; i < 40; i += 1) {
      const res = await POST(buildRequest({ portfolio_id: "x" }));
      statuses.push(res.status);
      if (res.status === 429) break;
    }

    expect(
      statuses,
      "The caller was NEVER denied across 40 consecutive failing calls. Each " +
        "one spends a token, fires the ~15s Python round-trip and times out — " +
        "so an unbounded loop is sustaining 15s round-trips against a single " +
        "already-unhealthy replica while the front door says yes. That is the " +
        "DoS `bridgeComputeLimiter` was added to prevent, re-opened by its " +
        "own 5xx escape hatch.",
    ).toContain(429);

    // ...and the cap is the REAL one, not merely "eventually something denied".
    // A refund that gave back a bounded number of tokens would still admit more
    // than the bucket, and this is what tells the two apart.
    expect(
      statuses.filter((s) => s === 504),
      "The bucket is 10/hour, so at most 10 attempts may reach the analytics " +
        "service before the 11th is refused.",
    ).toHaveLength(10);
    expect(statuses[statuses.length - 1]).toBe(429);
  });

  it("[163 WR-03] control: the bucket double can still ADMIT — the denial above is earned, not universal", async () => {
    // Without this, a double that answered 429 unconditionally would satisfy
    // the invariant test while proving nothing about the route.
    STATE.bucket = { limit: 10, used: 0 };
    const res = await POST(buildRequest({ portfolio_id: "x" }));
    expect(res.status).toBe(200);
    expect(STATE.bucket.used).toBe(1);
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
    // The route's own B-26 envelope shape is preserved on the new arm.
    expect(body.status).toBe("failed");
    expect(body.suggestions).toBeNull();
    expect(body.error).toBe(
      "The analytics service is temporarily unavailable. Please try again in a moment.",
    );
    // 140.3-G6 / SEAMUX-03 — the machine code is additive BESIDE the money-
    // bearing shape: a shape regression (status/suggestions) and a dropped code
    // both redden this one case.
    expect(body.code).toBe("CIRCUIT_OPEN");
    // M-0333 / T-140-17: the copy names no infrastructure.
    expect(body.error).not.toMatch(/circuit|breaker|upstash|railway|http/i);
  });

  // ⚠️ WR-03 — INVERTED, and this is the arm where the reversal costs
  // something. It used to read "the CIRCUIT_OPEN arm refunds the 5/min token",
  // on the argument that a breaker trip is the purest upstream failure: the
  // request was never issued, so nothing was consumed. That argument is still
  // right and the refund is gone anyway, because the only refund
  // @upstash/ratelimit offers is a whole-window reset — so a caller looping
  // against an open breaker would hold a permanently full bucket. A limiter any
  // caller can zero on demand is not a limiter.
  it("[163 WR-03] the CIRCUIT_OPEN arm does NOT reset the window either", async () => {
    STATE.optimizerImpl = async () => {
      throw new CircuitOpenError(9);
    };
    const res = await POST(buildRequest({ portfolio_id: "x" }));

    expect(res.status).toBe(503);
    expect(STATE.refundCalls).toHaveLength(0);
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

  // ── 140.3-G6 / SEAMUX-03 — a machine `code` on every ROUTE-EMITTED arm ──────
  // The consumer discriminates the fault on a stable token, not the prose. The
  // CSRF 403 (assertSameOrigin) and the approval-gate 403 (assertProfileApproved)
  // are HELPER-emitted across the whole API surface and stay codeless — excluded
  // exactly as the verifier accepted for keys/sync's withAuth 401. Each arm is
  // driven on its own so a dropped code reddens here and cannot hide.
  it("G6 — 401 carries code UNAUTHENTICATED", async () => {
    STATE.authUser = null;
    const res = await POST(buildRequest({ portfolio_id: "x" }));
    expect(res.status).toBe(401);
    expect((await res.json()).code).toBe("UNAUTHENTICATED");
  });

  it("G6 — 400 invalid JSON carries code VALIDATION_FAILED", async () => {
    const res = await POST(buildRequest("not json"));
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe("VALIDATION_FAILED");
  });

  it("G6 — 400 missing portfolio_id carries code MISSING_PORTFOLIO_ID", async () => {
    // The named-id-param fact (keys/sync MISSING_STRATEGY_ID precedent) — NOT
    // VALIDATION_FAILED, which this set reserves for structural body rejections.
    const res = await POST(buildRequest({}));
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe("MISSING_PORTFOLIO_ID");
  });

  it("G6 — 403 ownership refusal carries code FORBIDDEN", async () => {
    STATE.ownershipResult = false;
    const res = await POST(
      buildRequest({ portfolio_id: "00000000-0000-0000-0000-000000000999" }),
    );
    expect(res.status).toBe(403);
    expect((await res.json()).code).toBe("FORBIDDEN");
  });

  it("G6 — 504 timeout carries code UPSTREAM_TIMEOUT beside the B-26 shape", async () => {
    STATE.optimizerImpl = async () => {
      throw new FakeAnalyticsTimeoutError();
    };
    const res = await POST(buildRequest({ portfolio_id: "x" }));
    expect(res.status).toBe(504);
    const body = await res.json();
    expect(body.status).toBe("failed");
    expect(body.suggestions).toBeNull();
    expect(body.error).toBe("Optimizer timed out");
    expect(body.code).toBe("UPSTREAM_TIMEOUT");
  });

  it("G6 — 503 unreachable carries code UPSTREAM_NETWORK_ERROR beside the B-26 shape", async () => {
    STATE.optimizerImpl = async () => {
      throw new Error("connection refused");
    };
    const res = await POST(buildRequest({ portfolio_id: "x" }));
    expect(res.status).toBe(503);
    const body = await res.json();
    // B-26: PortfolioOptimizer discards suggestions off this shape — a shape
    // regression AND a dropped code both redden this case.
    expect(body.status).toBe("failed");
    expect(body.suggestions).toBeNull();
    expect(body.error).toBe("Analytics service unreachable");
    expect(body.code).toBe("UPSTREAM_NETWORK_ERROR");
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
    // The POSITIVE half: the breaker arm really ran — status AND the breaker's
    // own cooldown header — so the zero below is about the capture POLICY and
    // not about the request never reaching the catch. (WR-03 removed the third
    // witness that used to stand here, the R-0002 refund; the cooldown header
    // is arm-specific enough on its own — the generic 503 carries none.)
    expect(res.status).toBe(503);
    expect(res.headers.get("Retry-After")).toBe("13");
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
