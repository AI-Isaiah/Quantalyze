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

// ─────────────────────────────────────────────────────────────────────────────
// 140.3-13a / SEAMUX-08 — the Sentry capture, tested through the REAL helper.
//
// ⚠️ `@sentry/nextjs` is mocked here and `@/lib/sentry-capture` is DELIBERATELY
// NOT. The house pattern elsewhere mocks the helper itself, which is fine for
// "did the call site fire" but makes every payload assertion VACUOUS about
// scrubbing: the scrub lives INSIDE the helper (SEAMCORE-06), so a mocked
// helper never runs it and a test asserting "no secret in the payload" would
// pass with the scrubber deleted. Running the real helper over a faked Sentry
// transport is what makes both halves of TRAP-1 falsifiable here.
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

/**
 * 140.4-13 / SEAMRIM-05 — the limiter verdict this file drives the route with.
 * Hoisted so the factory closes over it; default is the ALLOW every pre-existing
 * test was written against, and the SEAMRIM-05 describe restores it.
 */
const limiter = vi.hoisted(() => ({
  result: { success: true, retryAfter: 0 } as
    | { success: true; retryAfter?: number }
    | { success: false; retryAfter: number; reason?: "ratelimit_misconfigured" },
}));

// ⚠️ EXTENDED, NOT REPLACED. The pure helpers come from `importActual` so this
// mock cannot drift from the real 503-vs-429 decision.
vi.mock("@/lib/ratelimit", async (importActual) => {
  const actual = await importActual<typeof import("@/lib/ratelimit")>();
  return {
    adminActionLimiter: {},
    checkLimit: async () => limiter.result,
    rateLimitDenyJson: actual.rateLimitDenyJson,
    isRateLimitMisconfigured: actual.isRateLimitMisconfigured,
  };
});

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

/**
 * 140.4-13 / SEAMRIM-05 — the ADMIN auth shape of the three this plan pins
 * behaviourally.
 *
 * ⚠️ WHY THE ADMIN SURFACE MATTERS HERE AND NOT LESS. This route already maps a
 * breaker trip to 503, so an operator reading the logs during an outage sees
 * 503s from the seam and — until this plan — 429s from the limiter beside it,
 * for the SAME incident. The limiter runs FIRST, so during an Upstash outage
 * the breaker never even gets to trip: the 429 was the only signal, and it says
 * "an admin is clicking too fast".
 */
describe("[140.4-13 / SEAMRIM-05] POST /api/admin/match/recompute — the limiter deny arm", () => {
  async function postAsAdmin() {
    userState.current = { id: "admin-id" };
    adminFlag.isAdmin = true;
    const { POST } = await import("./route");
    return POST(buildPostRequest({ allocator_id: "alloc-1", force: false }));
  }

  afterEach(() => {
    limiter.result = { success: true, retryAfter: 0 };
    vi.restoreAllMocks();
  });

  it("ratelimit_misconfigured → 503, not a 429 that reads as admin over-clicking", async () => {
    limiter.result = {
      success: false,
      retryAfter: 60,
      reason: "ratelimit_misconfigured",
    };
    const res = await postAsAdmin();

    expect(res.status).toBe(503);
    // 140.3-G8 / SEAMUX-03 — the sentence is BYTE-KEPT and a machine code now
    // rides beside it. SEAM_MISCONFIGURED is the limiter-unavailable token.
    expect(await res.json()).toEqual({
      error: "Rate limiter unavailable",
      code: "SEAM_MISCONFIGURED",
    });
    expect(res.headers.get("Retry-After")).toBe("60");
    expect(res.headers.get("Cache-Control")).toBe("private, no-store");
    expect(recomputeCalls).toHaveLength(0);
  });

  it("a genuine throttle → 429 with a BYTE-IDENTICAL body and headers", async () => {
    limiter.result = { success: false, retryAfter: 42 };
    const res = await postAsAdmin();

    expect(res.status).toBe(429);
    // Hand-typed from the pre-adoption source, not read back off the builder.
    // 140.3-G8 / SEAMUX-03 — sentence BYTE-KEPT, RATE_LIMITED code beside it
    // (OUR limiter's token, not the exchange-family KEY_RATE_LIMIT).
    expect(await res.json()).toEqual({
      error: "Too many requests",
      code: "RATE_LIMITED",
    });
    expect(res.headers.get("Retry-After")).toBe("42");
    expect(res.headers.get("Cache-Control")).toBe("private, no-store");
    expect(recomputeCalls).toHaveLength(0);
  });

  it("success → the deny arm does not fire", async () => {
    limiter.result = { success: true, retryAfter: 0 };
    const res = await postAsAdmin();

    expect(res.status).not.toBe(429);
    expect(res.status).not.toBe(503);
    expect(recomputeCalls.length).toBeGreaterThan(0);
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
    const parsed = JSON.parse(raw);
    expect(parsed.error).toBe(CIRCUIT_OPEN_COPY);
    // The breaker is an internal mechanism; its vocabulary must not reach the
    // human-facing COPY (threat T-140-05 / T-140-08). Scoped to `.error`, not
    // the raw body: 140.3-G8 puts a deliberate machine `code: "CIRCUIT_OPEN"`
    // on `.code` as a stable discriminator (an established seam WIRE token —
    // the same exemption the sibling scenario/optimize route's test makes).
    expect(parsed.error).not.toMatch(/circuit|breaker|upstash|railway/i);
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
    const { AnalyticsTimeoutError } = await import("@/lib/analytics-client");
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
    // ...and the detail is not simply discarded — it goes to the server log,
    // SCRUBBED (140.4-08 / SEAMRIM-06). Same strengthening as the sibling
    // route's, for the same reason: pinning the raw object pinned the leak in
    // place, while pinning the scrubbed rendering pins BOTH that the value went
    // through `scrubSeamError` and that the diagnosis survived — the A-10
    // non-drop half, which the source predicate is structurally unable to see.
    expect(errorSpy).toHaveBeenCalledWith(
      expect.any(String),
      expect.stringContaining("boom with http://localhost:8002 secret detail"),
    );
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

/**
 * 140.3-11 / TS-19 — an upstream status SURVIVES this route.
 *
 * The flattening this closes is BROADER than the finding that named it. Before
 * this plan the catch block branched on exactly two types, so every OTHER
 * upstream status fell to the unconditional terminal arm and became a
 * `500 {"error":"Match recompute failed. Please try again."}`. Measured on the
 * untouched tree: `grep -c AnalyticsUpstreamError` was **0** in this route and
 * **0** in its sibling `eval` — the arm did not exist at all, in either file.
 *
 * `analytics-service/routers/match.py` raises 400, 403, 422 and 429 on this
 * very endpoint (`:1668`, `:1697`, `:1741`, `:1783`), so this was not
 * hypothetical: a deliberate, immediate refusal from the service was reported
 * to an admin as OUR server failing, with "Please try again" attached to a
 * request that would be refused identically every time.
 *
 * THE RANGE SPLIT IS LOAD-BEARING, not a simplification. Only 4xx forwards.
 * A 5xx keeps falling to the static arm, because `AnalyticsUpstreamError.message`
 * on a 5xx carries the FastAPI `detail`, the `parseResponse()` contract-drift
 * string and the service's base URL — the exact T-140-11 leak this file's
 * existing case pins the absence of. The case below re-pins it THROUGH the new
 * arm, so widening the range later reddens a test rather than shipping a leak.
 *
 * ⚠️ 161-08 / WIZERR-06 AMENDS THE SCOPE OF THAT SENTENCE, and the amendment is
 * written here rather than left to inference. "Only 4xx forwards" is about the
 * MESSAGE. The terminal arm now forwards the upstream's `seamCode` as well, so
 * `code` crosses on both sides of 500 while `error` still crosses on the 4xx
 * side alone. The four `WIZERR-06` cases in the machine-code block below pin
 * both halves — the code that must cross, and the message that must not.
 *
 * Fixtures are hand-typed here. Nothing is imported from the module under test.
 */
describe("POST /api/admin/match/recompute — upstream status survives (140.3-11 / TS-19)", () => {
  async function postAsAdmin() {
    userState.current = { id: "admin-id" };
    adminFlag.isAdmin = true;
    const { POST } = await import("./route");
    return POST(buildPostRequest({ allocator_id: "alloc-1", force: false }));
  }

  it("an upstream 424 answers 424 with its sentence intact — NOT a bodyless 500", async () => {
    const { AnalyticsUpstreamError } = await import("@/lib/analytics-client");
    recomputeState.throwValue = new AnalyticsUpstreamError(
      "Binance is not responding right now. Try again shortly.",
      424,
      "EXCHANGE_UNAVAILABLE",
    );
    const res = await postAsAdmin();

    // The whole point: the status survives the hop. Without the new arm this
    // is 500 and the sentence is replaced by GENERIC_COPY.
    expect(res.status).toBe(424);
    const body = JSON.parse(await res.text());
    expect(body.error).toBe(
      "Binance is not responding right now. Try again shortly.",
    );
    expect(body.error).not.toBe(GENERIC_COPY);
  });

  it("an upstream 4xx that is NOT 424 also survives with its own status", async () => {
    // 429 rather than 424: a second member of the class, so a fix that special-
    // cased the one status this plan renders would not satisfy this file.
    const { AnalyticsUpstreamError } = await import("@/lib/analytics-client");
    recomputeState.throwValue = new AnalyticsUpstreamError(
      "Too many recomputes for this allocator.",
      429,
      "RATE_LIMITED",
    );
    const res = await postAsAdmin();
    expect(res.status).toBe(429);
    expect(JSON.parse(await res.text()).error).toBe(
      "Too many recomputes for this allocator.",
    );
  });

  it("a 403 refusal from the service is not reported as OUR 500", async () => {
    const { AnalyticsUpstreamError } = await import("@/lib/analytics-client");
    recomputeState.throwValue = new AnalyticsUpstreamError(
      "actor is not entitled to recompute this allocator",
      403,
    );
    const res = await postAsAdmin();
    expect(res.status).toBe(403);
    expect(res.status).not.toBe(500);
  });

  it("ANTI-REGRESSION: an upstream 5xx still answers the STATIC 500 and never echoes its message (T-140-11)", async () => {
    // Shaped like what a FastAPI unhandled exception actually puts in this
    // field: a traceback fragment and the service's base URL.
    const { AnalyticsUpstreamError } = await import("@/lib/analytics-client");
    recomputeState.throwValue = new AnalyticsUpstreamError(
      'Traceback (most recent call last): File "/app/routers/match.py" http://localhost:8002',
      502,
    );
    const res = await postAsAdmin();
    expect(res.status).toBe(500);
    const raw = await res.text();
    expect(raw).not.toContain("Traceback");
    expect(raw).not.toContain("localhost");
    expect(raw).not.toContain("match.py");
    expect(JSON.parse(raw).error).toBe(GENERIC_COPY);
  });

  it("ANTI-REGRESSION: the new arm stays BEHIND the admin gate (T-140-12)", async () => {
    const { AnalyticsUpstreamError } = await import("@/lib/analytics-client");
    recomputeState.throwValue = new AnalyticsUpstreamError("venue down", 424);
    userState.current = null;
    const { POST } = await import("./route");
    const res = await POST(
      buildPostRequest({ allocator_id: "alloc-1", force: false }),
    );
    // An anonymous caller must not learn a venue's state from this endpoint
    // either — the new arm is inside the same catch block, after the gate.
    expect(res.status).toBe(401);
    expect(recomputeCalls).toHaveLength(0);
  });
});

/**
 * 140.3-13a / SEAMUX-08 — this route captures to Sentry, under the SAME ONE
 * policy as its sibling (`admin/match/eval/route.ts`, where it is written out).
 *
 * ⚠️ ASSERTED PER FILE, DELIBERATELY. These two routes have the same shape and
 * had the same gap — each read 0 `captureToSentry` on the untouched tree — and
 * `140.3-11` recorded the same reasoning when it added the 4xx arm to both:
 * fixing one and reporting the class closed is this programme's signature
 * failure. A shared assertion could not tell a two-of-two delivery from a
 * one-of-two.
 *
 * `@sentry/nextjs` is mocked and `@/lib/sentry-capture` is NOT — see the note
 * at the top of this file. The scrub lives inside the helper, so a mocked
 * helper would make every payload assertion below vacuous.
 */
describe("[140.3-13a / SEAMUX-08] POST /api/admin/match/recompute — Sentry capture policy", () => {
  const INTERNAL_TOKEN = "int_9f3a1c7e5b2d84a6f0c1e3d5b7a9f2c48e6d0b1a";

  beforeEach(() => {
    sentryState.captured.length = 0;
    userState.current = { id: "admin-1" };
    adminFlag.isAdmin = true;
    vi.stubEnv("INTERNAL_API_TOKEN", INTERNAL_TOKEN);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  async function nextCapture() {
    await vi.waitFor(() =>
      expect(
        sentryState.captured.length,
        "nothing was captured — the terminal arm is the only place an unclassified seam failure is ever reported",
      ).toBeGreaterThan(0),
    );
    return sentryState.captured[sentryState.captured.length - 1];
  }

  async function expectNoCapture() {
    await new Promise((r) => setTimeout(r, 0));
    expect(sentryState.captured).toEqual([]);
  }

  it("POSITIVE: an unclassified transport failure IS captured, with THIS route's tags", async () => {
    recomputeState.throwValue = new Error(
      `getaddrinfo ENOTFOUND analytics.invalid (X-Internal-Token: ${INTERNAL_TOKEN})`,
    );
    const { POST } = await import("./route");
    const res = await POST(buildPostRequest({ allocator_id: "a-1" }));
    expect(res.status).toBe(500);

    const { options } = await nextCapture();
    // The surface tag is this route's own — a shared literal would let one
    // route's capture satisfy the other's assertion.
    expect(options.tags?.surface).toBe("admin-match-recompute");
    expect(options.tags?.step).toBe("upstream-error");
  });

  it("TRAP-1 BOTH DIRECTIONS: the captured payload loses the secret and KEEPS the syscall token", async () => {
    recomputeState.throwValue = new Error(
      `getaddrinfo ENOTFOUND analytics.invalid (X-Internal-Token: ${INTERNAL_TOKEN})`,
    );
    const { POST } = await import("./route");
    await POST(buildPostRequest({ allocator_id: "a-1" }));

    const message = ((await nextCapture()).err as Error).message;
    expect(
      message,
      "a live INTERNAL_API_TOKEN was dispatched to Sentry — undici inlines outgoing headers into err.message (TRAP-1)",
    ).not.toContain(INTERNAL_TOKEN);
    expect(
      message,
      "the syscall token was eaten by the redactor — ENOTFOUND is the most valuable thing in a DNS failure line",
    ).toContain("ENOTFOUND");
  });

  it("NEGATIVE: a breaker short-circuit is NEVER captured", async () => {
    const { CircuitOpenError } = await import("@/lib/seam-errors");
    recomputeState.throwValue = new CircuitOpenError(30);
    const { POST } = await import("./route");
    const res = await POST(buildPostRequest({ allocator_id: "a-1" }));
    expect(res.status).toBe(503);
    expect(res.headers.get("Retry-After")).toBe("30");
    await expectNoCapture();
  });

  it("NEGATIVE: an upstream timeout is NEVER captured", async () => {
    const { AnalyticsTimeoutError } = await import("@/lib/analytics-client");
    recomputeState.throwValue = new AnalyticsTimeoutError("/api/match/recompute", 30_000);
    const { POST } = await import("./route");
    const res = await POST(buildPostRequest({ allocator_id: "a-1" }));
    expect(res.status).toBe(504);
    await expectNoCapture();
  });

  it("NEGATIVE: a forwarded upstream 4xx is NEVER captured", async () => {
    const { AnalyticsUpstreamError } = await import("@/lib/analytics-client");
    recomputeState.throwValue = new AnalyticsUpstreamError("bybit is not responding", 424);
    const { POST } = await import("./route");
    const res = await POST(buildPostRequest({ allocator_id: "a-1" }));
    expect(res.status).toBe(424);
    await expectNoCapture();
  });

  it("POSITIVE COUNTERPART: an upstream 5xx DOES reach the terminal arm and IS captured", async () => {
    const { AnalyticsUpstreamError } = await import("@/lib/analytics-client");
    recomputeState.throwValue = new AnalyticsUpstreamError("upstream exploded", 500);
    const { POST } = await import("./route");
    const res = await POST(buildPostRequest({ allocator_id: "a-1" }));
    expect(res.status).toBe(500);
    expect((await nextCapture()).options.tags?.surface).toBe(
      "admin-match-recompute",
    );
  });

  it("NEGATIVE: a caller fault (non-admin) is NEVER captured", async () => {
    adminFlag.isAdmin = false;
    const { POST } = await import("./route");
    const res = await POST(buildPostRequest({ allocator_id: "a-1" }));
    expect(res.status).toBe(403);
    await expectNoCapture();
  });
});

/**
 * 140.3-G8 / SEAMUX-03 — a machine `code` on every arm THIS route owns.
 *
 * REQUIREMENTS.md names "the admin match routes" verbatim. Each arm is pinned
 * individually so a `code` dropped from one is not hidden behind another's
 * assertion. MISSING_ALLOCATOR_ID is the named-id-param token (the keys/sync
 * MISSING_STRATEGY_ID precedent), deliberately DISTINCT from VALIDATION_FAILED
 * which this plan set reserves for the structural unparseable-JSON rejection —
 * a case below drives BOTH so a collapse of one onto the other reddens. The two
 * deny bodies are asserted in the SEAMRIM-05 block above (byte-kept sentence +
 * code); the 4xx-forward seamCode survival is the load-bearing case here.
 */
describe("[140.3-G8 / SEAMUX-03] POST /api/admin/match/recompute — machine code per arm", () => {
  async function postAsAdmin(body: unknown = { allocator_id: "alloc-1", force: false }) {
    userState.current = { id: "admin-id" };
    adminFlag.isAdmin = true;
    const { POST } = await import("./route");
    return POST(buildPostRequest(body));
  }

  it("401 answers code UNAUTHENTICATED", async () => {
    userState.current = null;
    const { POST } = await import("./route");
    const res = await POST(buildPostRequest({ allocator_id: "alloc-1" }));
    expect(res.status).toBe(401);
    expect((await res.json()).code).toBe("UNAUTHENTICATED");
  });

  it("403 answers code FORBIDDEN", async () => {
    userState.current = { id: "user-1" };
    adminFlag.isAdmin = false;
    const { POST } = await import("./route");
    const res = await POST(buildPostRequest({ allocator_id: "alloc-1" }));
    expect(res.status).toBe(403);
    expect((await res.json()).code).toBe("FORBIDDEN");
  });

  it("an unparseable body answers 400 code VALIDATION_FAILED (structural rejection)", async () => {
    userState.current = { id: "admin-id" };
    adminFlag.isAdmin = true;
    const { POST } = await import("./route");
    const req = new NextRequest("http://localhost:3000/api/admin/match/recompute", {
      method: "POST",
      headers: { "content-type": "application/json", ...VALID_ORIGIN },
      body: "{ not json",
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe("VALIDATION_FAILED");
  });

  it("a missing allocator_id answers 400 code MISSING_ALLOCATOR_ID — NOT VALIDATION_FAILED", async () => {
    const res = await postAsAdmin({ force: false });
    expect(res.status).toBe(400);
    const body = await res.json();
    // The named-id fact is distinct from the structural VALIDATION_FAILED above.
    expect(body.code).toBe("MISSING_ALLOCATOR_ID");
    expect(body.code).not.toBe("VALIDATION_FAILED");
  });

  it("the breaker 503 answers code CIRCUIT_OPEN", async () => {
    const { CircuitOpenError } = await import("@/lib/seam-errors");
    recomputeState.throwValue = new CircuitOpenError(30);
    const res = await postAsAdmin();
    expect(res.status).toBe(503);
    expect((await res.json()).code).toBe("CIRCUIT_OPEN");
  });

  it("the timeout 504 answers code UPSTREAM_TIMEOUT", async () => {
    const { AnalyticsTimeoutError } = await import("@/lib/analytics-client");
    recomputeState.throwValue = new AnalyticsTimeoutError("/api/match/recompute", 30_000);
    const res = await postAsAdmin();
    expect(res.status).toBe(504);
    expect((await res.json()).code).toBe("UPSTREAM_TIMEOUT");
  });

  it("the 4xx forward carries the upstream's OWN seamCode AND keeps error + dependency (TS-18/TS-19)", async () => {
    const { AnalyticsUpstreamError } = await import("@/lib/analytics-client");
    recomputeState.throwValue = new AnalyticsUpstreamError(
      "Binance is not responding right now. Try again shortly.",
      424,
      "EXCHANGE_UNAVAILABLE",
      "binance",
    );
    const res = await postAsAdmin();
    expect(res.status).toBe(424);
    const body = await res.json();
    expect(body.code).toBe("EXCHANGE_UNAVAILABLE");
    expect(body.error).toBe(
      "Binance is not responding right now. Try again shortly.",
    );
    expect(body.dependency).toBe("binance");
  });

  it("a 4xx forward whose upstream carried NO code falls back to UNKNOWN, dependency still null", async () => {
    const { AnalyticsUpstreamError } = await import("@/lib/analytics-client");
    recomputeState.throwValue = new AnalyticsUpstreamError("venue down", 429);
    const res = await postAsAdmin();
    expect(res.status).toBe(429);
    const body = await res.json();
    expect(body.code).toBe("UNKNOWN");
    expect(body.dependency).toBeNull();
  });

  it("the terminal 500 answers code UNKNOWN", async () => {
    recomputeState.throwValue = new Error("boom");
    const res = await postAsAdmin();
    expect(res.status).toBe(500);
    expect((await res.json()).code).toBe("UNKNOWN");
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 161-08 / WIZERR-06 — the terminal arm forwards the CODE and still refuses
  // the MESSAGE. Same four cases, same shape, as the other four routes carrying
  // the 4xx-forward / 5xx-terminal pair.
  //
  // ⚠️ The static sentence is the file-level `GENERIC_COPY` constant declared at
  // the top of THIS test file — hand-typed there, imported from nothing. It is
  // deliberately NOT the route's own constant.
  // ───────────────────────────────────────────────────────────────────────────

  /**
   * Shaped like what T-140-11 keeps off the wire: FastAPI detail, the
   * `parseResponse()` contract-drift string and a service base URL.
   */
  const LEAKY_5XX_MESSAGE =
    "InternalError: recompute_allocator raised at match.py:1801 — upstream base http://analytics.invalid:8000";

  it("WIZERR-06 (a) — a 5xx seam error carrying a code forwards THAT code, sentence unchanged", async () => {
    const { AnalyticsUpstreamError } = await import("@/lib/analytics-client");
    // The service's own declared 500 residue, `retryable=False`.
    recomputeState.throwValue = new AnalyticsUpstreamError(
      "Internal error",
      500,
      "INTERNAL",
    );
    const res = await postAsAdmin();
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.code).toBe("INTERNAL");
    expect(body.error).toBe(GENERIC_COPY);
  });

  it("WIZERR-06 (b) — a 5xx seam error with a NULL code still answers UNKNOWN, sentence unchanged", async () => {
    const { AnalyticsUpstreamError } = await import("@/lib/analytics-client");
    recomputeState.throwValue = new AnalyticsUpstreamError("upstream exploded", 502);
    const res = await postAsAdmin();
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.code).toBe("UNKNOWN");
    expect(body.error).toBe(GENERIC_COPY);
  });

  it("WIZERR-06 (c) — a NON-SEAM throwable answers UNKNOWN, sentence unchanged", async () => {
    recomputeState.throwValue = new Error("ECONNRESET");
    const res = await postAsAdmin();
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.code).toBe("UNKNOWN");
    expect(body.error).toBe(GENERIC_COPY);
  });

  it("WIZERR-06 (d) — NEGATIVE CONTROL: no substring of the thrown message reaches the body", async () => {
    const { AnalyticsUpstreamError } = await import("@/lib/analytics-client");
    recomputeState.throwValue = new AnalyticsUpstreamError(
      LEAKY_5XX_MESSAGE,
      500,
      "INTERNAL",
    );
    const res = await postAsAdmin();
    const serialized = JSON.stringify(await res.json());

    // ⚠️ VACUITY GUARD, FIRST — `"anything".includes("")` is `true`.
    expect(LEAKY_5XX_MESSAGE.trim().length).toBeGreaterThan(40);
    const tokens = LEAKY_5XX_MESSAGE.split(/\s+/).filter((t) => t.length >= 4);
    expect(
      tokens.length,
      "the leak corpus produced too few usable tokens to be a real control",
    ).toBeGreaterThan(5);

    for (const token of tokens) {
      expect(
        serialized,
        `the 5xx body leaked "${token}" out of err.message`,
      ).not.toContain(token);
    }
    expect(serialized).not.toContain(LEAKY_5XX_MESSAGE);
    expect(serialized).toContain("INTERNAL");
  });
});
