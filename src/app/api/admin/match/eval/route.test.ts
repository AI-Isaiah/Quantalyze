import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";

/**
 * M-0277 (testgap API2) — route-level coverage for
 * GET /api/admin/match/eval, the MatchEvalDashboard data source. Asserts:
 *   1. CSRF — off-origin probe rejected with 403 BEFORE auth.
 *   2. AuthZ — null user → 401; authenticated non-admin → 403.
 *   3. Defaults — lookback_days defaults to "28" when the query param is
 *      omitted; partner_tag is undefined (not "" / null) when omitted.
 *   4. Passthrough — provided lookback_days + partner_tag reach evalMatch.
 *   5. Phase 140 / SEAM-04 error taxonomy — CircuitOpenError → 503 +
 *      Retry-After, AnalyticsTimeoutError → 504, everything else → 500 with
 *      STATIC copy. (5) previously asserted the OPPOSITE: that the upstream
 *      `err.message` was surfaced verbatim. That was the pre-existing
 *      information-disclosure leak T-140-11 — the same defect bridge H-1062
 *      and portfolio-optimizer M-0333 already closed — so those two cases now
 *      pin its ABSENCE.
 *
 * Mirrors the sibling allocators/route.test.ts mocking pattern.
 *
 * ⚠️ CLASS IDENTITY UNDER `vi.resetModules()`. `beforeEach` resets the module
 * registry, so the route re-evaluates `@/lib/seam-errors` and mints a FRESH
 * `CircuitOpenError` class object. A top-level static import would be a
 * DIFFERENT class and the route's `instanceof` would silently miss, turning a
 * real 503 assertion into a false 500 (measured in 140-01, deviation 3).
 * Every error class used below is therefore imported DYNAMICALLY, inside the
 * test, from the same registry the route is imported from.
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

const evalState = vi.hoisted(() => ({
  lastArgs: null as { lookback_days: string; partner_tag: string | undefined } | null,
  // when set, evalMatch rejects with this value (Error or non-Error).
  throwValue: null as unknown,
  result: { rows: [] } as unknown,
}));

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

// Phase 140 / T-140-30: PARTIAL mock, not a bare factory. `AnalyticsTimeoutError`
// genuinely lives in this module and the route branches on it; through a bare
// factory that binding is `undefined` and `err instanceof undefined` throws
// `TypeError` from inside the route's catch block. The spread is the only new
// part — `evalMatch` below is the pre-140 implementation verbatim, because it
// drives `evalState` for every pre-existing case in this file.
vi.mock("@/lib/analytics-client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/analytics-client")>()),
  evalMatch: async (args: {
    lookback_days: string;
    partner_tag: string | undefined;
  }) => {
    evalState.lastArgs = args;
    if (evalState.throwValue !== null) {
      throw evalState.throwValue;
    }
    return evalState.result;
  },
}));

function makeReq(
  query = "",
  headers: Record<string, string> = VALID_ORIGIN,
): NextRequest {
  return new NextRequest(
    `http://localhost:3000/api/admin/match/eval${query}`,
    { method: "GET", headers },
  );
}

/** The three STATIC bodies the route is allowed to emit from its catch block. */
const CIRCUIT_OPEN_COPY =
  "The analytics service is temporarily unavailable. Please try again in a moment.";
const TIMEOUT_COPY = "Match evaluation timed out. Please try again.";
const GENERIC_COPY = "Match evaluation failed. Please try again.";

describe("GET /api/admin/match/eval (M-0277)", () => {
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    userState.current = null;
    adminFlag.isAdmin = false;
    evalState.lastArgs = null;
    evalState.throwValue = null;
    evalState.result = { rows: [] };
    // The route logs the diagnosable half of every failure server-side. Spy
    // rather than silence-and-forget: the leak-closure tests assert the detail
    // IS still logged, so "static body" cannot be satisfied by dropping it.
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.resetModules();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    // This repo's known CI-only (Node 22) failure cause is a leaked global stub.
    vi.unstubAllGlobals();
  });

  it("rejects an off-origin request with 403 BEFORE auth (CSRF guard)", async () => {
    userState.current = { id: "admin-1" };
    adminFlag.isAdmin = true;
    const { GET } = await import("./route");
    const res = await GET(
      makeReq("", { origin: "https://evil.example.com" }),
    );
    expect(res.status).toBe(403);
    expect(evalState.lastArgs).toBeNull();
  });

  it("returns 401 when there is no authenticated user", async () => {
    userState.current = null;
    const { GET } = await import("./route");
    const res = await GET(makeReq());
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBe("Unauthorized");
    expect(evalState.lastArgs).toBeNull();
  });

  it("returns 403 when the authenticated caller is not an admin", async () => {
    userState.current = { id: "user-1" };
    adminFlag.isAdmin = false;
    const { GET } = await import("./route");
    const res = await GET(makeReq());
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toBe("Forbidden");
    expect(evalState.lastArgs).toBeNull();
  });

  it("defaults lookback_days to '28' and partner_tag to undefined when the query is omitted", async () => {
    userState.current = { id: "admin-1" };
    adminFlag.isAdmin = true;
    const { GET } = await import("./route");
    const res = await GET(makeReq());
    expect(res.status).toBe(200);
    expect(evalState.lastArgs).toEqual({
      lookback_days: "28",
      partner_tag: undefined,
    });
  });

  it("passes provided lookback_days and partner_tag through to evalMatch", async () => {
    userState.current = { id: "admin-1" };
    adminFlag.isAdmin = true;
    const { GET } = await import("./route");
    const res = await GET(
      makeReq("?lookback_days=90&partner_tag=acme"),
    );
    expect(res.status).toBe(200);
    expect(evalState.lastArgs).toEqual({
      lookback_days: "90",
      partner_tag: "acme",
    });
  });

  it("returns 500 with STATIC copy and NEVER echoes the upstream Error message (T-140-11)", async () => {
    userState.current = { id: "admin-1" };
    adminFlag.isAdmin = true;
    // Deliberately shaped like the two things this arm used to leak: a raw
    // upstream detail string and the analytics service's base URL.
    const leaky = new Error("boom with http://localhost:8002 secret detail");
    evalState.throwValue = leaky;
    const { GET } = await import("./route");
    const res = await GET(makeReq());
    expect(res.status).toBe(500);
    const raw = await res.text();
    expect(raw).not.toContain("boom");
    expect(raw).not.toContain("localhost");
    expect(JSON.parse(raw).error).toBe(GENERIC_COPY);
    // ...and the detail is not simply discarded — it goes to the server log,
    // SCRUBBED (140.4-08 / SEAMRIM-06). Pinning the raw `leaky` object here
    // pinned the leak in place; pinning the scrubbed rendering pins two facts
    // instead of one — that the value went through `scrubSeamError` (it is a
    // string, not the Error instance) AND that the diagnosis survived it. The
    // second half is the A-10 non-drop check, and it is the ONLY mechanism in
    // this tree that catches a "fix" which answers a scrub finding by dropping
    // the value: the source predicate cannot see a drop, this assertion can.
    expect(errorSpy).toHaveBeenCalledWith(
      expect.any(String),
      expect.stringContaining("boom with http://localhost:8002 secret detail"),
    );
  });

  it("returns 500 with the same STATIC copy when evalMatch throws a non-Error value", async () => {
    userState.current = { id: "admin-1" };
    adminFlag.isAdmin = true;
    evalState.throwValue = "string rejection, not an Error";
    const { GET } = await import("./route");
    const res = await GET(makeReq());
    expect(res.status).toBe(500);
    const raw = await res.text();
    expect(raw).not.toContain("string rejection");
    expect(JSON.parse(raw).error).toBe(GENERIC_COPY);
  });

  it("maps CircuitOpenError to 503 with Retry-After and static copy (SEAM-04)", async () => {
    userState.current = { id: "admin-1" };
    adminFlag.isAdmin = true;
    // Same-registry import — see the class-identity warning in the file header.
    const { CircuitOpenError } = await import("@/lib/seam-errors");
    evalState.throwValue = new CircuitOpenError(30);
    const { GET } = await import("./route");
    const res = await GET(makeReq());
    expect(res.status).toBe(503);
    expect(res.headers.get("Retry-After")).toBe("30");
    const raw = await res.text();
    const parsed = JSON.parse(raw);
    expect(parsed.error).toBe(CIRCUIT_OPEN_COPY);
    // The breaker is an internal mechanism; its vocabulary must not reach the
    // human-facing COPY (threat T-140-05 / T-140-08). Scoped to `.error`, not
    // the raw body: 140.3-G8 puts a deliberate machine `code: "CIRCUIT_OPEN"`
    // on `.code` as a stable discriminator (an established seam WIRE token — the
    // same exemption the sibling scenario/optimize route's test already makes).
    expect(parsed.error).not.toMatch(/circuit|breaker|upstash|railway/i);
  });

  it("forwards the breaker's own cooldown as Retry-After rather than a constant", async () => {
    userState.current = { id: "admin-1" };
    adminFlag.isAdmin = true;
    const { CircuitOpenError } = await import("@/lib/seam-errors");
    evalState.throwValue = new CircuitOpenError(7);
    const { GET } = await import("./route");
    const res = await GET(makeReq());
    expect(res.status).toBe(503);
    expect(res.headers.get("Retry-After")).toBe("7");
  });

  it("maps AnalyticsTimeoutError to 504 with static copy (SEAM-04)", async () => {
    userState.current = { id: "admin-1" };
    adminFlag.isAdmin = true;
    // The REAL class, reachable only because the analytics-client mock above is
    // a spread-importActual partial rather than a bare factory.
    const { AnalyticsTimeoutError } = await import("@/lib/analytics-client");
    evalState.throwValue = new AnalyticsTimeoutError(
      "/api/match/eval?lookback_days=28",
      30_000,
    );
    const { GET } = await import("./route");
    const res = await GET(makeReq());
    expect(res.status).toBe(504);
    const raw = await res.text();
    expect(JSON.parse(raw).error).toBe(TIMEOUT_COPY);
    // AnalyticsTimeoutError's message quotes both the deadline and the upstream
    // path; neither may reach the client.
    expect(raw).not.toContain("30000");
    expect(raw).not.toContain("/api/match/eval");
  });

  it("keeps the breaker arm BEHIND the admin gate — unauthenticated + CircuitOpenError never yields 503 (T-140-12)", async () => {
    // The error arms live inside the handler, after auth, so an unauthenticated
    // caller cannot use the status code as a breaker-state oracle. evalMatch is
    // primed to trip, but the gate must return first and never reach it.
    userState.current = null;
    const { CircuitOpenError } = await import("@/lib/seam-errors");
    evalState.throwValue = new CircuitOpenError(30);
    const { GET } = await import("./route");
    const res = await GET(makeReq());
    expect(res.status).toBe(401);
    expect(res.headers.get("Retry-After")).toBeNull();
    expect(evalState.lastArgs).toBeNull();
  });
});

/**
 * 140.3-11 / TS-19 — an upstream status SURVIVES this route.
 *
 * The sibling of `recompute/route.test.ts`'s block of the same name, and it is
 * a SEPARATE delivery rather than a shared helper on purpose: this programme's
 * signature failure is closing one member of an identically-shaped pair and
 * reporting the class done (5-of-7, 3-of-5). Measured on the untouched tree,
 * `grep -c AnalyticsUpstreamError` was **0** in BOTH route files — neither had
 * the arm — so a one-of-two delivery here would have been indistinguishable
 * from a complete one without this file.
 *
 * The 4xx/5xx range split is the same load-bearing one: only 4xx forwards,
 * because a 5xx `message` carries the FastAPI detail and the service base URL
 * (T-140-11). Fixtures hand-typed; nothing imported from the module under test.
 */
describe("GET /api/admin/match/eval — upstream status survives (140.3-11 / TS-19)", () => {
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    userState.current = { id: "admin-1" };
    adminFlag.isAdmin = true;
    evalState.lastArgs = null;
    evalState.throwValue = null;
    evalState.result = { rows: [] };
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.resetModules();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("an upstream 424 answers 424 with its sentence intact — NOT a bodyless 500", async () => {
    const { AnalyticsUpstreamError } = await import("@/lib/analytics-client");
    evalState.throwValue = new AnalyticsUpstreamError(
      "Binance is not responding right now. Try again shortly.",
      424,
      "EXCHANGE_UNAVAILABLE",
    );
    const { GET } = await import("./route");
    const res = await GET(makeReq());

    expect(res.status).toBe(424);
    const body = JSON.parse(await res.text());
    expect(body.error).toBe(
      "Binance is not responding right now. Try again shortly.",
    );
    expect(body.error).not.toBe(GENERIC_COPY);
  });

  it("an upstream 4xx that is NOT 424 also survives with its own status", async () => {
    const { AnalyticsUpstreamError } = await import("@/lib/analytics-client");
    evalState.throwValue = new AnalyticsUpstreamError(
      "lookback_days must be between 1 and 365",
      422,
      "VALIDATION_FAILED",
    );
    const { GET } = await import("./route");
    const res = await GET(makeReq());
    expect(res.status).toBe(422);
    expect(JSON.parse(await res.text()).error).toBe(
      "lookback_days must be between 1 and 365",
    );
  });

  it("ANTI-REGRESSION: an upstream 5xx still answers the STATIC 500 and never echoes its message (T-140-11)", async () => {
    const { AnalyticsUpstreamError } = await import("@/lib/analytics-client");
    evalState.throwValue = new AnalyticsUpstreamError(
      'Traceback (most recent call last): File "/app/routers/match.py" http://localhost:8002',
      502,
    );
    const { GET } = await import("./route");
    const res = await GET(makeReq());
    expect(res.status).toBe(500);
    const raw = await res.text();
    expect(raw).not.toContain("Traceback");
    expect(raw).not.toContain("localhost");
    expect(raw).not.toContain("match.py");
    expect(JSON.parse(raw).error).toBe(GENERIC_COPY);
    // The diagnosable half is still logged rather than dropped.
    expect(errorSpy).toHaveBeenCalled();
  });

  it("ANTI-REGRESSION: the new arm stays BEHIND the admin gate (T-140-12)", async () => {
    const { AnalyticsUpstreamError } = await import("@/lib/analytics-client");
    evalState.throwValue = new AnalyticsUpstreamError("venue down", 424);
    userState.current = null;
    const { GET } = await import("./route");
    const res = await GET(makeReq());
    expect(res.status).toBe(401);
    expect(evalState.lastArgs).toBeNull();
  });
});

/**
 * 140.3-13a / SEAMUX-08 — this route captures to Sentry, under ONE policy.
 *
 * ⚠️ THE BASELINE WAS ZERO, AND SO WAS IT AT EIGHT SIBLINGS. Measured on the
 * untouched tree, nine of the fifteen seam routes read 0 for
 * `grep -vE '^\s*(//|\*)' | grep -c captureToSentry`, while `wizardErrors.ts`
 * copy told users "our team has been notified". `140.3-12` removed the claim;
 * this is where it starts becoming true. The policy is written out in full in
 * `src/app/api/admin/match/eval/route.ts` and `140.3-13b` applies it verbatim
 * at the remaining five routes.
 *
 * The NEGATIVE cases below are the ones that keep the policy from being "log
 * everything". Each pairs its zero-capture assertion with a POSITIVE assertion
 * that the arm actually ran (its own status), so a route that threw before
 * reaching any arm could not satisfy them.
 */
describe("[140.3-13a / SEAMUX-08] GET /api/admin/match/eval — Sentry capture policy", () => {
  /** A 40-char internal token, the shape INTERNAL_API_TOKEN actually carries. */
  const INTERNAL_TOKEN = "int_9f3a1c7e5b2d84a6f0c1e3d5b7a9f2c48e6d0b1a";
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    sentryState.captured.length = 0;
    userState.current = { id: "admin-1" };
    adminFlag.isAdmin = true;
    evalState.lastArgs = null;
    evalState.throwValue = null;
    evalState.result = { rows: [] };
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubEnv("INTERNAL_API_TOKEN", INTERNAL_TOKEN);
    vi.resetModules();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  /** Wait for `captureToSentry`'s lazy `import(...).then(...)` chain. */
  async function nextCapture() {
    await vi.waitFor(() =>
      expect(
        sentryState.captured.length,
        "nothing was captured — the terminal arm is the only place an unclassified seam failure is ever reported",
      ).toBeGreaterThan(0),
    );
    return sentryState.captured[sentryState.captured.length - 1];
  }

  /** Assert no capture happened, allowing the lazy chain time to have fired. */
  async function expectNoCapture() {
    await new Promise((r) => setTimeout(r, 0));
    expect(sentryState.captured).toEqual([]);
  }

  it("POSITIVE: an unclassified transport failure IS captured, with the route's tags", async () => {
    evalState.throwValue = new Error(
      `connect ECONNREFUSED 10.0.0.5:8002 (X-Internal-Token: ${INTERNAL_TOKEN})`,
    );
    const { GET } = await import("./route");
    const res = await GET(makeReq("?lookback_days=7"));
    expect(res.status).toBe(500);

    const { err, options } = await nextCapture();
    expect(options.tags?.surface).toBe("admin-match-eval");
    expect(options.tags?.step).toBe("upstream-error");
    expect(err).toBeInstanceOf(Error);
  });

  it("TRAP-1 BOTH DIRECTIONS: the captured payload loses the secret and KEEPS the syscall token", async () => {
    evalState.throwValue = new Error(
      `connect ECONNREFUSED 10.0.0.5:8002 (X-Internal-Token: ${INTERNAL_TOKEN})`,
    );
    const { GET } = await import("./route");
    await GET(makeReq());

    const { err } = await nextCapture();
    const message = (err as Error).message;
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
    const { CircuitOpenError } = await import("@/lib/seam-errors");
    evalState.throwValue = new CircuitOpenError(30);
    const { GET } = await import("./route");
    const res = await GET(makeReq());
    // The POSITIVE half: the breaker arm really ran, so the zero below is
    // about the policy and not about the request never reaching the catch.
    expect(res.status).toBe(503);
    expect(res.headers.get("Retry-After")).toBe("30");
    await expectNoCapture();
  });

  it("NEGATIVE: an upstream timeout is NEVER captured (expected under a cold start; a sustained one trips the breaker)", async () => {
    const { AnalyticsTimeoutError } = await import("@/lib/analytics-client");
    evalState.throwValue = new AnalyticsTimeoutError("/api/match/eval", 30_000);
    const { GET } = await import("./route");
    const res = await GET(makeReq());
    expect(res.status).toBe(504);
    await expectNoCapture();
  });

  it("NEGATIVE: a forwarded upstream 4xx is NEVER captured (a deliberate refusal is not our defect)", async () => {
    const { AnalyticsUpstreamError } = await import("@/lib/analytics-client");
    evalState.throwValue = new AnalyticsUpstreamError("bybit is not responding", 424);
    const { GET } = await import("./route");
    const res = await GET(makeReq());
    expect(res.status).toBe(424);
    await expectNoCapture();
  });

  it("POSITIVE COUNTERPART: an upstream 5xx DOES fall through to the terminal arm and IS captured", async () => {
    // The 4xx/5xx split is the policy's "service-permanent outcome" half. If
    // the range check ever widened to forward 5xx too, this reddens — which is
    // what stops the negative above from silently becoming "never capture".
    const { AnalyticsUpstreamError } = await import("@/lib/analytics-client");
    evalState.throwValue = new AnalyticsUpstreamError("upstream exploded", 503);
    const { GET } = await import("./route");
    const res = await GET(makeReq());
    expect(res.status).toBe(500);
    expect((await nextCapture()).options.tags?.surface).toBe("admin-match-eval");
  });

  it("NEGATIVE: a caller fault (unauthenticated) is NEVER captured", async () => {
    userState.current = null;
    const { GET } = await import("./route");
    const res = await GET(makeReq());
    expect(res.status).toBe(401);
    await expectNoCapture();
  });

  it("the capture never replaces the operator log line — both channels fire", async () => {
    evalState.throwValue = new Error("boom");
    const { GET } = await import("./route");
    await GET(makeReq());
    await nextCapture();
    expect(errorSpy).toHaveBeenCalled();
  });
});

/**
 * 140.3-G8 / SEAMUX-03 — a machine `code` on every arm THIS route owns.
 *
 * REQUIREMENTS.md names "the admin match routes" verbatim: a consumer must be
 * able to discriminate on a stable token instead of the prose (140.3-12's to
 * reword). Each arm is pinned individually so a `code` dropped from one is not
 * hidden behind another's assertion — this programme's signature failure.
 *
 * The 4xx-forward arm is the load-bearing one: it must carry the UPSTREAM'S own
 * `seamCode` (the thread TS-19 started) AND keep `error` + `dependency` intact,
 * so the case below drives an `AnalyticsUpstreamError` bearing all three and
 * asserts all three survive together. UNAUTHENTICATED / FORBIDDEN are inline
 * gate codes, not WizardErrorCode members, so an admin arm never forces wizard
 * copy — the same non-union choice the keys/sync template ships.
 */
describe("[140.3-G8 / SEAMUX-03] GET /api/admin/match/eval — machine code per arm", () => {
  beforeEach(() => {
    userState.current = { id: "admin-1" };
    adminFlag.isAdmin = true;
    evalState.lastArgs = null;
    evalState.throwValue = null;
    evalState.result = { rows: [] };
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.resetModules();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("401 answers code UNAUTHENTICATED", async () => {
    userState.current = null;
    const { GET } = await import("./route");
    const res = await GET(makeReq());
    expect(res.status).toBe(401);
    expect((await res.json()).code).toBe("UNAUTHENTICATED");
  });

  it("403 answers code FORBIDDEN", async () => {
    userState.current = { id: "user-1" };
    adminFlag.isAdmin = false;
    const { GET } = await import("./route");
    const res = await GET(makeReq());
    expect(res.status).toBe(403);
    expect((await res.json()).code).toBe("FORBIDDEN");
  });

  it("the breaker 503 answers code CIRCUIT_OPEN", async () => {
    const { CircuitOpenError } = await import("@/lib/seam-errors");
    evalState.throwValue = new CircuitOpenError(30);
    const { GET } = await import("./route");
    const res = await GET(makeReq());
    expect(res.status).toBe(503);
    expect((await res.json()).code).toBe("CIRCUIT_OPEN");
  });

  it("the timeout 504 answers code UPSTREAM_TIMEOUT", async () => {
    const { AnalyticsTimeoutError } = await import("@/lib/analytics-client");
    evalState.throwValue = new AnalyticsTimeoutError("/api/match/eval", 30_000);
    const { GET } = await import("./route");
    const res = await GET(makeReq());
    expect(res.status).toBe(504);
    expect((await res.json()).code).toBe("UPSTREAM_TIMEOUT");
  });

  it("the 4xx forward carries the upstream's OWN seamCode AND keeps error + dependency (TS-18/TS-19)", async () => {
    const { AnalyticsUpstreamError } = await import("@/lib/analytics-client");
    // All three fields present on the wire: seamCode is the Python token, the
    // dependency names the caller's venue on the nested 424 shape.
    evalState.throwValue = new AnalyticsUpstreamError(
      "Binance is not responding right now. Try again shortly.",
      424,
      "EXCHANGE_UNAVAILABLE",
      "binance",
    );
    const { GET } = await import("./route");
    const res = await GET(makeReq());
    expect(res.status).toBe(424);
    const body = await res.json();
    // The code is the UPSTREAM'S, not a route-local synonym…
    expect(body.code).toBe("EXCHANGE_UNAVAILABLE");
    // …and it did not eat either of the two fields beside it.
    expect(body.error).toBe(
      "Binance is not responding right now. Try again shortly.",
    );
    expect(body.dependency).toBe("binance");
  });

  it("a 4xx forward whose upstream carried NO code falls back to UNKNOWN, dependency still null", async () => {
    const { AnalyticsUpstreamError } = await import("@/lib/analytics-client");
    // seamCode omitted → null; the flat 424 shape carries no dependency either.
    evalState.throwValue = new AnalyticsUpstreamError("venue down", 424);
    const { GET } = await import("./route");
    const res = await GET(makeReq());
    expect(res.status).toBe(424);
    const body = await res.json();
    expect(body.code).toBe("UNKNOWN");
    expect(body.dependency).toBeNull();
  });

  it("the terminal 500 answers code UNKNOWN", async () => {
    evalState.throwValue = new Error("boom");
    const { GET } = await import("./route");
    const res = await GET(makeReq());
    expect(res.status).toBe(500);
    expect((await res.json()).code).toBe("UNKNOWN");
  });
});
