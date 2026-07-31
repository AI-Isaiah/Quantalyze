import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest, NextResponse } from "next/server";
// Phase 140 / SEAM-04: the REAL breaker error, taken from the dependency-free
// leaf. It must NEVER be picked up through `@/lib/analytics-client` — this file
// mocks that module wholesale (a full factory, no importActual), so the class
// read through it would be `undefined` and `err instanceof undefined` throws a
// TypeError from inside the route's own catch block (threat T-140-30). Nothing
// mocks the leaf, and this file never calls vi.resetModules(), so a static
// import here is the same class object the route narrows against.
import { CircuitOpenError } from "@/lib/seam-errors";

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
  // M-0887: whether the portfolio row that exists in the DB belongs to the
  // session user. `portfolioFound` (legacy) collapses "no row" and "wrong
  // owner" into one boolean; `portfolioOwnedBySession` lets a test assert the
  // cross-tenant case where the row EXISTS but for another user — which the
  // route must reject via the `.eq("user_id", user.id)` filter, not luck.
  portfolioOwnedBySession: true,
  // M-0887: records every `.eq(col, val)` the route applies to the
  // `portfolios` query, so a test can pin that the tenant filter is present.
  eqCalls: [] as Array<[string, unknown]>,
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
        // M-0887: the eq() chain RECORDS the column+value it filters on and
        // models ownership by `user_id` (not a bare flag) so that dropping the
        // tenant filter in the route is observable. Each builder node is BOTH
        // chainable (`.eq`) and terminal (`.single`), so the route may end the
        // chain at any depth — a row is returned ONLY when it applied both
        // `.eq("id", …)` and `.eq("user_id", session.id)` AND the row is owned
        // by the session user. Dropping the `.eq("user_id", …)` filter therefore
        // surfaces as the foreign row leaking (no 404) + a missing-filter
        // assertion, not a structural TypeError.
        const makeNode = () => ({
          eq: (col: string, val: unknown) => {
            STATE.eqCalls.push([col, val]);
            return makeNode();
          },
          single: async () => {
            const idOk = STATE.eqCalls.some(([c]) => c === "id");
            const ownerOk = STATE.eqCalls.some(
              ([c, v]) => c === "user_id" && v === STATE.authUser?.id,
            );
            return idOk &&
              ownerOk &&
              STATE.portfolioFound &&
              STATE.portfolioOwnedBySession
              ? {
                  data: { id: "00000000-0000-0000-0000-000000000010" },
                  error: null,
                }
              : { data: null, error: { message: "not found" } };
          },
        });
        return { select: () => makeNode() };
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
    // 140.3-G6 / SEAMUX-03 — the stable MACHINE code the real class carries
    // (analytics-client.ts:119). Additive + optional: every pre-existing
    // construction here passes two args and keeps `null`, so the route's
    // `code: err.seamCode ?? "UNKNOWN"` forward can be driven both ways.
    readonly seamCode: string | null;
    constructor(message: string, status: number, seamCode: string | null = null) {
      super(message);
      this.name = "AnalyticsUpstreamError";
      this.status = status;
      this.seamCode = seamCode;
    }
  }
  class AnalyticsTimeoutError extends Error {
    constructor(path: string, timeoutMs: number) {
      super(`Analytics request to ${path} timed out after ${timeoutMs}ms`);
      this.name = "AnalyticsTimeoutError";
    }
  }
  return {
    AnalyticsUpstreamError,
    AnalyticsTimeoutError,
    findReplacementCandidates: (
      portfolioId: string,
      underperformerId: string,
      userId: string,
    ) => STATE.findReplacementImpl(portfolioId, underperformerId, userId),
  };
});

// Sentry capture is fire-and-forget; spy on it so the 500-path tests can pin
// the server-side-preservation half of the H-1062 fix (now that err.message is
// no longer echoed to the client, captureToSentry is the structured channel)
// without attempting a real @sentry/nextjs import.
const captureSpy = vi.hoisted(() => vi.fn());
vi.mock("@/lib/sentry-capture", () => ({
  captureToSentry: captureSpy,
}));

// Valid v4 UUIDs — real portfolio/strategy ids are gen_random_uuid() (v4).
// The pre-M-0884 route did presence-only validation, so these fixtures used
// version-0 strings; the new UUID schema correctly requires a real version.
const PORTFOLIO_ID = "00000000-0000-4000-8000-000000000010";
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
  STATE.portfolioOwnedBySession = true;
  STATE.eqCalls = [];
  STATE.findReplacementImpl = async () => ({ candidates: [] });
  captureSpy.mockClear();
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

  it("M-0888/M-0889 — success AND 401 carry Cache-Control: private, no-store", async () => {
    const { POST } = await import("./route");
    // 200 success — user-specific BridgeCandidate[] must never be shared-cached.
    STATE.findReplacementImpl = async () => ({ candidates: [] });
    const ok = await POST(
      makeRequest({
        portfolio_id: PORTFOLIO_ID,
        underperformer_strategy_id: UNDERPERFORMER_ID,
      }),
    );
    expect(ok.status).toBe(200);
    expect(ok.headers.get("Cache-Control")).toBe("private, no-store");

    // 401 — supplied by the withAuth wrapper this route now uses (M-0888).
    STATE.authUser = null;
    const unauth = await POST(
      makeRequest({
        portfolio_id: PORTFOLIO_ID,
        underperformer_strategy_id: UNDERPERFORMER_ID,
      }),
    );
    expect(unauth.status).toBe(401);
    expect(unauth.headers.get("Cache-Control")).toBe("private, no-store");
  });

  it("M-0889 — error paths (404, upstream-4xx-forward, 504, 500) all carry no-store", async () => {
    // F5b review #3: the leak-bearing error branches must be pinned, not just
    // 200+401. The 4xx-forward path echoes the upstream err.message (operator
    // copy that can be tenant-distinguishing) — the highest-value path to guard.
    const { POST } = await import("./route");
    const req = () =>
      makeRequest({
        portfolio_id: PORTFOLIO_ID,
        underperformer_strategy_id: UNDERPERFORMER_ID,
      });

    STATE.portfolioFound = false; // 404 portfolio-not-found
    let res = await POST(req());
    expect(res.status).toBe(404);
    expect(res.headers.get("Cache-Control")).toBe("private, no-store");
    STATE.portfolioFound = true;

    STATE.findReplacementImpl = async () => {
      const { AnalyticsUpstreamError } = await import("@/lib/analytics-client");
      throw new AnalyticsUpstreamError("no returns data", 400); // 4xx forward
    };
    res = await POST(req());
    expect(res.status).toBe(400);
    expect(res.headers.get("Cache-Control")).toBe("private, no-store");

    STATE.findReplacementImpl = async () => {
      const { AnalyticsTimeoutError } = await import("@/lib/analytics-client");
      throw new AnalyticsTimeoutError("/api/portfolio-bridge", 15000); // 504
    };
    res = await POST(req());
    expect(res.status).toBe(504);
    expect(res.headers.get("Cache-Control")).toBe("private, no-store");

    STATE.findReplacementImpl = async () => {
      const { AnalyticsUpstreamError } = await import("@/lib/analytics-client");
      throw new AnalyticsUpstreamError("traceback", 502); // 500 generic
    };
    res = await POST(req());
    expect(res.status).toBe(500);
    expect(res.headers.get("Cache-Control")).toBe("private, no-store");
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

  it("TC6b — cross-tenant: a portfolio owned by another user 404s, and the route MUST filter on session user.id", async () => {
    // M-0887: the discriminating cross-tenant case. The portfolio row EXISTS
    // (portfolioFound stays true) but it is NOT owned by the session user.
    // The route's ONLY defence against returning it is the
    // `.eq("user_id", user.id)` filter on the portfolios query. TC6's
    // flag-only mock could not detect that filter being dropped — this test
    // both asserts the 404 (ownership-modelled mock) AND pins, on the recorded
    // eq() chain, that the route actually applied the tenant filter.
    STATE.portfolioOwnedBySession = false;
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
    // Discriminating: the route must have scoped the lookup to the session
    // user — without `.eq("user_id", user.id)` this assertion fails.
    expect(STATE.eqCalls).toContainEqual(["user_id", STATE.authUser!.id]);
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

  it("TC8 — scoring throws → 500 with STATIC message (H-1062: no leak)", async () => {
    // The thrown message mimics the multi-line Zod issue list parseResponse()
    // builds from the Python boundary — exactly what must NOT reach the client.
    STATE.findReplacementImpl = async () => {
      throw new Error(
        "Zod: candidates.0.score Required at simulator_scoring.py:188",
      );
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
    expect(body.error).toBe("Bridge scoring failed. Please try again.");
    // The internal Python detail must never appear in the response envelope.
    expect(body.error).not.toContain("simulator_scoring.py");
    expect(body.error).not.toContain("Zod");
    // ...but it MUST still reach Sentry — the static client message means
    // captureToSentry is now the structured observability channel for 5xx.
    expect(captureSpy).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({
        tags: { route: "api/bridge", op: "findReplacementCandidates" },
      }),
    );
  });

  it("TC9 — upstream 4xx forwarded with its status (H-1061/H-1063)", async () => {
    STATE.findReplacementImpl = async () => {
      const { AnalyticsUpstreamError } = await import("@/lib/analytics-client");
      throw new AnalyticsUpstreamError("Portfolio not found", 404);
    };
    const { POST } = await import("./route");
    const res = await POST(
      makeRequest({
        portfolio_id: PORTFOLIO_ID,
        underperformer_strategy_id: UNDERPERFORMER_ID,
      }),
    );
    // Without the fix this would be 500; the actionable 4xx now reaches the UI.
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toBe("Portfolio not found");
    // A forwarded 4xx is an expected user error, NOT an operator alert.
    expect(captureSpy).not.toHaveBeenCalled();
  });

  it("TC9b — upstream 5xx stays 500 with static message (no leak)", async () => {
    STATE.findReplacementImpl = async () => {
      const { AnalyticsUpstreamError } = await import("@/lib/analytics-client");
      throw new AnalyticsUpstreamError("upstream traceback line 42", 502);
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
    expect(body.error).toBe("Bridge scoring failed. Please try again.");
    expect(body.error).not.toContain("traceback");
    expect(captureSpy).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({
        tags: { route: "api/bridge", op: "findReplacementCandidates" },
      }),
    );
  });

  it("TC10 — upstream timeout → 504 (H-1061)", async () => {
    STATE.findReplacementImpl = async () => {
      const { AnalyticsTimeoutError } = await import("@/lib/analytics-client");
      throw new AnalyticsTimeoutError("/api/portfolio-bridge", 15000);
    };
    const { POST } = await import("./route");
    const res = await POST(
      makeRequest({
        portfolio_id: PORTFOLIO_ID,
        underperformer_strategy_id: UNDERPERFORMER_ID,
      }),
    );
    expect(res.status).toBe(504);
    const body = await res.json();
    expect(body.error).toMatch(/timed out/i);
  });

  // Phase 140 / SEAM-04 (SC-5c): a tripped Railway breaker is a distinct
  // condition from "scoring blew up" — it means no request was even issued and
  // the caller should come back after a known cooldown. Before this arm existed
  // it fell through to the generic 500, telling the client to retry immediately
  // against a service we already know is down.
  it("TC11 — CircuitOpenError → 503 + Retry-After carrying the breaker's own TTL (SC-5c)", async () => {
    // 7, deliberately NOT the 30s breaker default: 30 is simultaneously
    // BREAKER_COOLDOWN_S and DEFAULT_RETRY_AFTER_S, so a route that hardcoded
    // "30" would pass a 30-second fixture. This one only passes if the route
    // forwards err.retryAfterS.
    STATE.findReplacementImpl = async () => {
      throw new CircuitOpenError(7);
    };
    const { POST } = await import("./route");
    const res = await POST(
      makeRequest({
        portfolio_id: PORTFOLIO_ID,
        underperformer_strategy_id: UNDERPERFORMER_ID,
      }),
    );
    expect(res.status).toBe(503);
    expect(res.headers.get("Retry-After")).toBe("7");
    // M-0889: the breaker arm is a response like any other — no-store holds.
    expect(res.headers.get("Cache-Control")).toBe("private, no-store");
    const body = await res.json();
    expect(body.error).toBe(
      "The analytics service is temporarily unavailable. Please try again in a moment.",
    );
    // T-140-17: the client-facing copy names no infrastructure.
    expect(body.error).not.toMatch(/circuit|breaker|upstash|railway|http/i);
    // A breaker trip is an infrastructure state shared by every caller, not a
    // per-request defect: capturing it would emit one Sentry event per request
    // for the whole cooldown window. The console.error line is the signal.
    expect(captureSpy).not.toHaveBeenCalled();
  });

  it("TC5c — 400 when ids are non-UUID strings (M-0884)", async () => {
    const { POST } = await import("./route");
    const res = await POST(
      makeRequest({
        portfolio_id: "not-a-uuid",
        underperformer_strategy_id: "also-bad",
      }),
    );
    // Without the schema the presence-only check passes non-empty strings.
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/required/i);
  });

  // ── 140.3-G6 / SEAMUX-03 — every ROUTE-EMITTED arm carries a machine `code` ──
  // A client discriminates the fault on a stable token instead of sniffing the
  // prose (which 140.3-12 owns and may reword). The `withAuth` 401 is
  // helper-owned and excluded — the verifier accepted keys/sync the same way.
  // Each arm is driven independently so a code dropped from ONE reddens here and
  // does not hide behind another arm's assertion.
  const okBody = () => ({
    portfolio_id: PORTFOLIO_ID,
    underperformer_strategy_id: UNDERPERFORMER_ID,
  });

  it("G6 — 400 invalid JSON carries code VALIDATION_FAILED", async () => {
    const { POST } = await import("./route");
    const res = await POST(makeRequest(null, { rawBody: "{not json" }));
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe("VALIDATION_FAILED");
  });

  it("G6 — 400 invalid body shape carries code VALIDATION_FAILED", async () => {
    const { POST } = await import("./route");
    const res = await POST(makeRequest({ portfolio_id: PORTFOLIO_ID }));
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe("VALIDATION_FAILED");
  });

  it("G6 — 503 limiter-misconfigured carries code SEAM_MISCONFIGURED", async () => {
    STATE.checkLimitResult = {
      success: false,
      retryAfter: 60,
      reason: "ratelimit_misconfigured",
    };
    const { POST } = await import("./route");
    const res = await POST(makeRequest(okBody()));
    expect(res.status).toBe(503);
    expect((await res.json()).code).toBe("SEAM_MISCONFIGURED");
  });

  it("G6 — 429 real throttle carries code RATE_LIMITED (retryAfter body field kept)", async () => {
    STATE.checkLimitResult = { success: false, retryAfter: 30 };
    const { POST } = await import("./route");
    const res = await POST(makeRequest(okBody()));
    expect(res.status).toBe(429);
    const body = await res.json();
    expect(body.code).toBe("RATE_LIMITED");
    // Additive: the pre-existing retryAfter body field must survive alongside.
    expect(body.retryAfter).toBe(30);
  });

  it("G6 — 404 carries code PORTFOLIO_NOT_FOUND", async () => {
    STATE.portfolioFound = false;
    const { POST } = await import("./route");
    const res = await POST(makeRequest(okBody()));
    expect(res.status).toBe(404);
    expect((await res.json()).code).toBe("PORTFOLIO_NOT_FOUND");
  });

  it("G6 — breaker 503 carries code CIRCUIT_OPEN", async () => {
    STATE.findReplacementImpl = async () => {
      throw new CircuitOpenError(7);
    };
    const { POST } = await import("./route");
    const res = await POST(makeRequest(okBody()));
    expect(res.status).toBe(503);
    expect((await res.json()).code).toBe("CIRCUIT_OPEN");
  });

  it("G6 — forwarded upstream 4xx PRESERVES err.seamCode", async () => {
    STATE.findReplacementImpl = async () => {
      const { AnalyticsUpstreamError } = await import("@/lib/analytics-client");
      throw new AnalyticsUpstreamError("no returns data", 400, "NO_RETURNS_DATA");
    };
    const { POST } = await import("./route");
    const res = await POST(makeRequest(okBody()));
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe("NO_RETURNS_DATA");
  });

  it("G6 — forwarded upstream 4xx with NO seamCode falls back to UNKNOWN", async () => {
    STATE.findReplacementImpl = async () => {
      const { AnalyticsUpstreamError } = await import("@/lib/analytics-client");
      throw new AnalyticsUpstreamError("unprocessable", 422);
    };
    const { POST } = await import("./route");
    const res = await POST(makeRequest(okBody()));
    expect(res.status).toBe(422);
    expect((await res.json()).code).toBe("UNKNOWN");
  });

  it("G6 — 504 timeout carries code UPSTREAM_TIMEOUT", async () => {
    STATE.findReplacementImpl = async () => {
      const { AnalyticsTimeoutError } = await import("@/lib/analytics-client");
      throw new AnalyticsTimeoutError("/api/portfolio-bridge", 15000);
    };
    const { POST } = await import("./route");
    const res = await POST(makeRequest(okBody()));
    expect(res.status).toBe(504);
    expect((await res.json()).code).toBe("UPSTREAM_TIMEOUT");
  });

  it("G6 — terminal 500 carries code UNKNOWN", async () => {
    STATE.findReplacementImpl = async () => {
      throw new Error("Zod contract drift at scoring.py:188");
    };
    const { POST } = await import("./route");
    const res = await POST(makeRequest(okBody()));
    expect(res.status).toBe(500);
    expect((await res.json()).code).toBe("UNKNOWN");
  });
});
