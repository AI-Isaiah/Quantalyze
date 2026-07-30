import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest, NextResponse } from "next/server";
// Phase 140 / SEAM-04: the REAL breaker error, taken from the dependency-free
// leaf. It must NEVER be picked up through `@/lib/analytics-client` — this file
// mocks that module wholesale, so the class read through it would be
// `undefined` and `err instanceof undefined` throws a TypeError from inside the
// route's own catch block (threat T-140-30). Nothing mocks the leaf, and this
// file never calls vi.resetModules(), so a static import here is the same class
// object the route narrows against.
import { CircuitOpenError } from "@/lib/seam-errors";

/**
 * First route tests for POST /api/scenario/optimize (Phase 140 / 140-05).
 *
 * This route shipped in Phase 28 with ZERO coverage: the four arms of its
 * catch block — breaker, timeout, upstream, generic — had never been exercised,
 * and neither had its happy path. Phase 140 adds the breaker arm, so the file
 * exists now to pin all of them.
 *
 * ⚠️ MOCK-FACTORY NOTE, load-bearing. The `@/lib/analytics-client` factory
 * below carries hand-written `AnalyticsTimeoutError` / `AnalyticsUpstreamError`
 * class shims, mirroring the sibling bridge / simulator route tests. This is
 * NOT decoration: the route imports both classes from that module
 * (`route.ts:5-9`) and branches on both in its catch. A bare factory would
 * leave those two bindings `undefined`, and the FIRST `instanceof` the catch
 * evaluates would throw `TypeError: Right-hand side of 'instanceof' is not
 * callable` — reddening every case in this file, including the ones that never
 * mention an analytics error. The 502 and 504 cases below are what keeps that
 * true: delete either shim and they fail loudly rather than silently.
 *
 * `CircuitOpenError`, by contrast, is deliberately NOT in the factory — it is
 * imported from the never-mocked leaf above, which is the whole reason that
 * leaf is dependency-free.
 */

// route.ts reaches server-only modules transitively (supabase/server, csrf).
vi.mock("server-only", () => ({}));

const STATE = vi.hoisted(() => ({
  authUser: {
    id: "00000000-0000-0000-0000-000000000001",
    email: "alloc@test.sec",
  } as { id: string; email: string } | null,
  csrfShouldReject: false,
  checkLimitResult: { success: true } as
    | { success: true }
    | { success: false; retryAfter: number },
  // Records every call so the "never reached" negatives below are real
  // assertions about the route's ordering rather than assumptions.
  optimizeCalls: [] as Array<{
    series: Record<string, Array<{ date: string; value: number }>>;
    objective: string;
  }>,
  optimizeImpl: (async () => ({
    ok: true,
    objective: "min_vol",
    n: 2,
    k: 2,
    weights: { "strategy-a": 0.6, "strategy-b": 0.4 },
    in_sample: true,
    reason: "solved",
  })) as (
    series: Record<string, Array<{ date: string; value: number }>>,
    objective: string,
  ) => Promise<unknown>,
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: {
      getUser: async () => ({ data: { user: STATE.authUser }, error: null }),
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
}));

vi.mock("@/lib/analytics-client", async () => {
  // Hand-written shims — see the MOCK-FACTORY NOTE in the file header. Both
  // classes must exist as real constructors or the route's catch throws.
  class AnalyticsUpstreamError extends Error {
    readonly status: number;
    constructor(message: string, status: number) {
      super(message);
      this.name = "AnalyticsUpstreamError";
      this.status = status;
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
    optimizeScenarioWeights: (
      series: Record<string, Array<{ date: string; value: number }>>,
      objective: string,
    ) => {
      STATE.optimizeCalls.push({ series, objective });
      return STATE.optimizeImpl(series, objective);
    },
  };
});

const SERIES = {
  "strategy-a": [
    { date: "2026-01-01", value: 0.01 },
    { date: "2026-01-02", value: -0.004 },
  ],
  "strategy-b": [
    { date: "2026-01-01", value: 0.002 },
    { date: "2026-01-02", value: 0.003 },
  ],
};

function makeRequest(body: unknown, opts?: { rawBody?: string }): NextRequest {
  return new NextRequest("http://localhost:3000/api/scenario/optimize", {
    method: "POST",
    headers: {
      origin: "http://localhost:3000",
      "content-type": "application/json",
    },
    body: opts?.rawBody ?? JSON.stringify(body),
  });
}

const validBody = () => ({ series: SERIES, objective: "min_vol" });

let errorSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  STATE.authUser = {
    id: "00000000-0000-0000-0000-000000000001",
    email: "alloc@test.sec",
  };
  STATE.csrfShouldReject = false;
  STATE.checkLimitResult = { success: true };
  STATE.optimizeCalls = [];
  STATE.optimizeImpl = async () => ({
    ok: true,
    objective: "min_vol",
    n: 2,
    k: 2,
    weights: { "strategy-a": 0.6, "strategy-b": 0.4 },
    in_sample: true,
    reason: "solved",
  });
  // The error arms are asserted to keep their diagnostics server-side, so the
  // log channel is spied rather than merely silenced.
  errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.clearAllMocks();
  vi.restoreAllMocks();
  // This repo's known CI-only failure mode: a leaked global stub from one file
  // reddens an unrelated one under Node 22. Unstub unconditionally.
  vi.unstubAllGlobals();
});

describe("POST /api/scenario/optimize", () => {
  it("happy path — 200 forwards the optimizer envelope and the validated series", async () => {
    const { POST } = await import("./route");
    const res = await POST(makeRequest(validBody()));

    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("private, no-store");
    const body = await res.json();
    expect(body).toMatchObject({
      ok: true,
      objective: "min_vol",
      weights: { "strategy-a": 0.6, "strategy-b": 0.4 },
      in_sample: true,
    });
    // The normalized (not raw) series reaches the client, with the objective
    // the caller asked for.
    expect(STATE.optimizeCalls).toHaveLength(1);
    expect(STATE.optimizeCalls[0].objective).toBe("min_vol");
    expect(STATE.optimizeCalls[0].series).toEqual(SERIES);
  });

  // Phase 140 / SEAM-04 (SC-5c) — the arm this plan adds.
  it("CircuitOpenError → 503 + Retry-After carrying the breaker's own TTL (SC-5c)", async () => {
    // 13, deliberately NOT the 30s breaker default (which is simultaneously
    // BREAKER_COOLDOWN_S and DEFAULT_RETRY_AFTER_S): a route that hardcoded
    // "30" would pass a 30-second fixture but fails this one.
    STATE.optimizeImpl = async () => {
      throw new CircuitOpenError(13);
    };
    const { POST } = await import("./route");
    const res = await POST(makeRequest(validBody()));

    expect(res.status).toBe(503);
    expect(res.headers.get("Retry-After")).toBe("13");
    expect(res.headers.get("Cache-Control")).toBe("private, no-store");
    const body = await res.json();
    expect(body.error).toBe(
      "The analytics service is temporarily unavailable. Please try again in a moment.",
    );
    // T-140-17: the client-facing copy names no infrastructure.
    expect(body.error).not.toMatch(/circuit|breaker|upstash|railway|http/i);
  });

  // T-140-20: the breaker arm must live INSIDE the handler, after the auth
  // gate. If it were hoisted above the gate, an unauthenticated caller could
  // read Railway's health from the status code — this case pins that they
  // cannot, and that no seam call is even attempted for them.
  it("unauthenticated caller gets a plain 401 even with the breaker primed to trip", async () => {
    STATE.authUser = null;
    STATE.optimizeImpl = async () => {
      throw new CircuitOpenError(13);
    };
    const { POST } = await import("./route");
    const res = await POST(makeRequest(validBody()));

    expect(res.status).toBe(401);
    expect(res.headers.get("Retry-After")).toBeNull();
    const body = await res.json();
    expect(body.error).toBe("Unauthorized");
    expect(body.error).not.toMatch(/circuit|breaker|unavailable/i);
    expect(STATE.optimizeCalls).toHaveLength(0);
  });

  it("AnalyticsTimeoutError → 504 with static copy", async () => {
    STATE.optimizeImpl = async () => {
      const { AnalyticsTimeoutError } = await import("@/lib/analytics-client");
      throw new AnalyticsTimeoutError("/api/optimize-weights", 30000);
    };
    const { POST } = await import("./route");
    const res = await POST(makeRequest(validBody()));

    // Read from the route's own arm, not guessed: a timed-out Python
    // round-trip is a gateway timeout.
    expect(res.status).toBe(504);
    const body = await res.json();
    expect(body.error).toBe("The optimizer timed out. Try again shortly.");
  });

  it("AnalyticsUpstreamError → 502 without echoing the upstream detail", async () => {
    STATE.optimizeImpl = async () => {
      const { AnalyticsUpstreamError } = await import("@/lib/analytics-client");
      throw new AnalyticsUpstreamError(
        "solver failed: singular covariance at optimizer.py:214",
        500,
      );
    };
    const { POST } = await import("./route");
    const res = await POST(makeRequest(validBody()));

    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.error).toBe("The optimizer is unavailable right now.");
    // The Python internals stay server-side.
    expect(JSON.stringify(body)).not.toContain("optimizer.py");
    expect(JSON.stringify(body)).not.toContain("singular covariance");
    expect(errorSpy).toHaveBeenCalled();
  });

  it("generic error → 500 STATIC, and the internal detail never reaches the client", async () => {
    STATE.optimizeImpl = async () => {
      throw new Error("boom-internal-detail");
    };
    const { POST } = await import("./route");
    const res = await POST(makeRequest(validBody()));

    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toBe("Could not compute suggested weights.");
    // The whole envelope, not just `.error` — a leak into any field counts.
    expect(JSON.stringify(body)).not.toContain("boom-internal-detail");
    // ...but the operator MUST still get it. "Static body" must not be
    // satisfiable by discarding the diagnostic.
    expect(errorSpy).toHaveBeenCalledWith(
      "[scenario/optimize] unexpected error",
      expect.any(Error),
    );
  });

  it("403 when the CSRF origin allowlist rejects, before any seam call", async () => {
    STATE.csrfShouldReject = true;
    const { POST } = await import("./route");
    const res = await POST(makeRequest(validBody()));

    expect(res.status).toBe(403);
    expect(STATE.optimizeCalls).toHaveLength(0);
  });

  it("429 when the limiter denies — and the token is spent only AFTER validation (B15)", async () => {
    STATE.checkLimitResult = { success: false, retryAfter: 30 };
    const { POST } = await import("./route");

    const throttled = await POST(makeRequest(validBody()));
    expect(throttled.status).toBe(429);
    expect(STATE.optimizeCalls).toHaveLength(0);

    // B15 ordering: a malformed body is rejected as 400 by the validation
    // above the limiter, so it never reaches the (denying) limiter at all.
    // If the limiter ran first this would be a 429.
    const malformed = await POST(
      makeRequest({ series: SERIES, objective: "max_return" }),
    );
    expect(malformed.status).toBe(400);
  });

  it("400 on a malformed point — a non-finite value never reaches the solver", async () => {
    const { POST } = await import("./route");
    const res = await POST(
      makeRequest({
        series: { "strategy-a": [{ date: "2026-01-01", value: "0.01" }] },
        objective: "min_vol",
      }),
    );

    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/malformed point/i);
    expect(STATE.optimizeCalls).toHaveLength(0);
  });

  it("400 on invalid JSON", async () => {
    const { POST } = await import("./route");
    const res = await POST(makeRequest(null, { rawBody: "{not json" }));

    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("Invalid JSON body");
  });
});
