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
    // ...and the detail is not simply discarded — it goes to the server log.
    expect(errorSpy).toHaveBeenCalledWith(expect.any(String), leaky);
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
    expect(JSON.parse(raw).error).toBe(CIRCUIT_OPEN_COPY);
    // The breaker is an internal mechanism; its vocabulary must not reach an
    // HTTP body (threat T-140-05 / T-140-08).
    expect(raw).not.toMatch(/circuit|breaker|upstash|railway/i);
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
