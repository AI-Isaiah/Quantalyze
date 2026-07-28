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

// ─────────────────────────────────────────────────────────────────────────────
// 140.3-13b / SEAMUX-08 — the Sentry capture, tested through the REAL helper.
//
// ⚠️ `@sentry/nextjs` is mocked here and `@/lib/sentry-capture` is DELIBERATELY
// NOT. The house pattern elsewhere mocks the helper itself, which answers "did
// the call site fire" but makes every payload assertion VACUOUS about scrubbing:
// the scrub lives INSIDE the helper (SEAMCORE-06), so a mocked helper never runs
// it and a test asserting "no secret in the payload" would pass with the
// scrubber deleted. Running the real helper over a faked transport is what makes
// both halves of TRAP-1 falsifiable. Inherited verbatim from `140.3-13a`.
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
  sentryState.captured.length = 0;
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
    //
    // 140.4-08 / SEAMRIM-06 — pinned to the SCRUBBED rendering. `expect.any(Error)`
    // pinned the raw instance in place, so it failed on correct code once the
    // site was wrapped. The replacement is strictly stronger: it pins that the
    // value went through `scrubSeamError` (a string, not the Error) AND that
    // the diagnosis survived the scrub. That second half is the A-10 non-drop
    // check, and it is the only mechanism in this tree that reddens if someone
    // "fixes" a future scrub finding by deleting the value instead — the source
    // predicate scores a dropped value clean.
    expect(errorSpy).toHaveBeenCalledWith(
      "[scenario/optimize] unexpected error",
      expect.stringContaining("boom-internal-detail"),
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

/**
 * 140.3-13b / SEAMUX-08 — this route captures to Sentry, under the ONE policy
 * written out in `src/app/api/admin/match/eval/route.ts`.
 *
 * ⚠️ THE BASELINE WAS ZERO, measured on the untouched tree:
 * `grep -vE '^\s*(//|\*)' route.ts | grep -c captureToSentry` read **0** here
 * and at four sibling routes, while `wizardErrors.ts` copy told users "our team
 * has been notified". `140.3-12` removed the claim; `140.3-13a` and this plan
 * make it true — 4 + 5 = 9 of 9.
 *
 * Every NEGATIVE case pairs its zero-capture assertion with a POSITIVE
 * assertion that the arm actually ran (its own status), so a route that threw
 * before reaching any arm could not satisfy it.
 */
describe("[140.3-13b / SEAMUX-08] POST /api/scenario/optimize — Sentry capture policy", () => {
  /** A 40-char internal token, the shape INTERNAL_API_TOKEN actually carries. */
  const INTERNAL_TOKEN = "int_9f3a1c7e5b2d84a6f0c1e3d5b7a9f2c48e6d0b1a";

  beforeEach(() => {
    vi.stubEnv("INTERNAL_API_TOKEN", INTERNAL_TOKEN);
  });

  afterEach(() => {
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
    STATE.optimizeImpl = async () => {
      throw new Error(
        `connect ECONNREFUSED 10.0.0.5:8002 (X-Internal-Token: ${INTERNAL_TOKEN})`,
      );
    };
    const { POST } = await import("./route");
    const res = await POST(makeRequest(validBody()));
    expect(res.status).toBe(500);

    const { err, options } = await nextCapture();
    expect(options.tags?.surface).toBe("scenario-optimize");
    expect(options.tags?.step).toBe("unexpected-error");
    // The Error TYPE survives — `captureToSentry` rebuilds an Error rather than
    // stringifying, so Sentry keeps its grouping and stack.
    expect(err).toBeInstanceOf(Error);
    expect(options.extra?.objective).toBe("min_vol");
    expect(options.extra?.series_count).toBe(2);
  });

  it("TRAP-1 BOTH DIRECTIONS: the captured payload loses the secret and KEEPS the syscall token", async () => {
    STATE.optimizeImpl = async () => {
      throw new Error(
        `connect ECONNREFUSED 10.0.0.5:8002 (X-Internal-Token: ${INTERNAL_TOKEN})`,
      );
    };
    const { POST } = await import("./route");
    await POST(makeRequest(validBody()));

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
    STATE.optimizeImpl = async () => {
      throw new CircuitOpenError(13);
    };
    const { POST } = await import("./route");
    const res = await POST(makeRequest(validBody()));
    // The POSITIVE half: the breaker arm really ran, so the zero below is about
    // the policy and not about the request never reaching the catch.
    expect(res.status).toBe(503);
    expect(res.headers.get("Retry-After")).toBe("13");
    await expectNoCapture();
  });

  it("NEGATIVE: an upstream timeout is NEVER captured (expected under a cold start; a sustained one trips the breaker)", async () => {
    const { AnalyticsTimeoutError } = await import("@/lib/analytics-client");
    STATE.optimizeImpl = async () => {
      throw new AnalyticsTimeoutError("/api/optimize-weights", 30_000);
    };
    const { POST } = await import("./route");
    const res = await POST(makeRequest(validBody()));
    expect(res.status).toBe(504);
    await expectNoCapture();
  });

  /**
   * AMBIGUITY-1, pinned in BOTH directions — see the block comment on the
   * `AnalyticsUpstreamError` arm in route.ts.
   *
   * This route answers every `AnalyticsUpstreamError` with a flat 502 (no range
   * split, unlike `admin/match/eval`). The inherited policy excludes a
   * "forwarded upstream 4xx" and includes the service-permanent 5xx half, so the
   * reading applied here discriminates on STATUS rather than on which arm the
   * value happened to land in. Both directions are asserted, because a
   * capture-everything and a capture-nothing implementation each satisfy only
   * one of them.
   */
  it("NEGATIVE: an upstream 4xx is NEVER captured (a deliberate refusal is not our defect)", async () => {
    const { AnalyticsUpstreamError } = await import("@/lib/analytics-client");
    STATE.optimizeImpl = async () => {
      throw new AnalyticsUpstreamError("bybit is not responding", 424);
    };
    const { POST } = await import("./route");
    const res = await POST(makeRequest(validBody()));
    expect(res.status).toBe(502);
    await expectNoCapture();
  });

  it("POSITIVE: an upstream 5xx IS captured — the policy's service-permanent half", async () => {
    const { AnalyticsUpstreamError } = await import("@/lib/analytics-client");
    STATE.optimizeImpl = async () => {
      throw new AnalyticsUpstreamError("optimizer crashed", 503);
    };
    const { POST } = await import("./route");
    const res = await POST(makeRequest(validBody()));
    // Unchanged response contract: the capture is additive, the flat 502 stays.
    expect(res.status).toBe(502);

    const { options } = await nextCapture();
    expect(options.tags?.step).toBe("upstream-5xx");
    expect(options.extra?.upstream_status).toBe(503);
  });

  it("NEGATIVE: a caller-fault 400 is NEVER captured, and never reaches the seam at all", async () => {
    const { POST } = await import("./route");
    const res = await POST(
      makeRequest({ series: SERIES, objective: "max_return" }),
    );
    expect(res.status).toBe(400);
    expect(STATE.optimizeCalls).toHaveLength(0);
    await expectNoCapture();
  });

  it("NEGATIVE: our own rate-limit rejection is NEVER captured (the limiter working is not a fault)", async () => {
    STATE.checkLimitResult = { success: false, retryAfter: 30 };
    const { POST } = await import("./route");
    const res = await POST(makeRequest(validBody()));
    expect(res.status).toBe(429);
    await expectNoCapture();
  });
});
