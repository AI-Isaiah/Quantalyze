import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";
import {
  installFetchMock,
  restoreFetchMock,
  type FetchMock,
} from "@/test/helpers/fetch";
import { seedBreakerOpen } from "@/test/helpers/upstash-breaker";
// 146.1 / B2 — the scrub case's vacuity fence reads production's own floor
// rather than re-typing a number that could drift away from it.
import { MIN_REDACTABLE_SECRET_LENGTH } from "@/lib/seam-redaction";

/**
 * Phase 140 / SC-1a — route-level SEAM integration proof for
 * POST /api/keys/sync, the Mechanism-B twin of the SC-1b proof on
 * admin/match/recompute.
 *
 * WHY THIS FILE EXISTS, given `route.test.ts` already covers this handler.
 * ----------------------------------------------------------------------
 * The sibling `route.test.ts` replaces `@/lib/process-key-client` wholesale
 * with a factory — as do all five Mechanism-B route tests. Those files
 * therefore prove the route's response TRANSLATION and nothing else: the
 * client, the shared resilience core, the wall-clock budget and the
 * `breaker:railway` circuit are all absent from the object graph under test. A
 * regression that deleted the deadline, bypassed the core, or broke the breaker
 * would leave every one of them green. That blind spot is exactly how the
 * third, unbudgeted Railway seam survived for months (research §4.5), and
 * keys/sync is the money-onboarding chokepoint — the route a manager hits when
 * connecting a key.
 *
 * This file closes it by running the REAL `@/lib/process-key-client` and the
 * REAL `@/lib/resilient-fetch`, faking only the things that genuinely leave the
 * process: `fetch` (the Railway round-trip), `@upstash/*` (the breaker's store)
 * and Supabase. It must therefore NEVER replace the process-key client module
 * with a mock — doing so silently reverts this file to a duplicate of
 * `route.test.ts`. The absence of that mock is grep-asserted by the plan's
 * acceptance criteria, so the literal call text is deliberately not written
 * anywhere in this file, comments included.
 *
 * Cases:
 *   1. SC-1a — Railway hangs (fetch rejects with the `TimeoutError`
 *      DOMException `AbortSignal.timeout` produces) → the full chain
 *      route → postProcessKey → resilientFetch → the typed 504
 *      `UPSTREAM_TIMEOUT` envelope, promptly, with the lambda released rather
 *      than held to the 300s ceiling.
 *   2. Breaker OPEN → typed 503 `CIRCUIT_OPEN` + `Retry-After`, and `fetch` is
 *      never called — the short-circuit is real, not cosmetic.
 *   3. T-140-12 oracle — UNAUTHENTICATED caller with the breaker open gets 401,
 *      never 503, no `Retry-After`, no breaker vocabulary in the body.
 */

vi.mock("server-only", () => ({}));

const VALID_ORIGIN = { origin: "http://localhost:3000" };
const ANALYTICS_BASE = "http://analytics.invalid";
const TEST_USER_ID = "00000000-0000-0000-0000-aaaaaaaaaaaa";
const TEST_STRATEGY_ID = "11111111-1111-1111-1111-111111111111";
const TEST_API_KEY_ID = "22222222-2222-4222-8222-222222222222";
const TEST_CORRELATION_ID = "11111111-2222-3333-4444-555555555555";

const authState = vi.hoisted(() => ({
  user: { id: "00000000-0000-0000-0000-aaaaaaaaaaaa" } as { id: string } | null,
}));

const ownership = vi.hoisted(() => ({
  data: null as Record<string, string | null> | null,
}));

/**
 * A realistic end-user Supabase JWT.
 *
 * ⚠️ 146.1 / B2 (2026-08-18) — THIS FIXTURE OUTLIVED ITS ORIGINAL PURPOSE AND IS
 * STILL LOAD-BEARING, in a DIFFERENT way: `sessionState` below is seeded with it
 * so the route has a perfectly READABLE session, which is what makes the
 * inverted wire case meaningful. "Nothing forwarded because nothing was there"
 * would be vacuous; "nothing forwarded even though a live session existed" is
 * the actual claim.
 *
 * The value's LENGTH is load-bearing for the redaction case: a realistic JWT is
 * ~200 characters, and it deliberately contains no `SEAM_PRESERVE_TOKENS` member
 * so it cannot collide with the diagnostic half of that assertion.
 */
const TEST_USER_JWT =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.dGhpcy1pcy1hLXRlc3QtdXNlci1hY2Nlc3MtdG9rZW4tdmFsdWU.c2lnbmF0dXJlLWJ5dGVz";

const sessionState = vi.hoisted(() => ({
  session: { access_token: "" } as { access_token: string } | null,
}));

/**
 * The "shared Upstash database". MUST be hoisted: `vi.resetModules()` below
 * re-evaluates the resilience core, and only state living OUTSIDE the module
 * graph survives that — which is the whole premise of a cross-instance breaker.
 * The store object identity is stable (cleared, never reassigned) because the
 * mocked `Redis.fromEnv()` closes over this exact reference.
 */
const shared = vi.hoisted(() => ({
  store: new Map<string, { value: string; expiresAt: number }>(),
}));

// The doubles come from the shared helper; only the WIRING is per-file, because
// vi.mock factories are hoisted per-module and cannot be shared.
vi.mock("@upstash/redis", async () => {
  const { fakeRedisFor } = await import("@/test/helpers/upstash-breaker");
  return { Redis: { fromEnv: () => fakeRedisFor(shared.store) } };
});

vi.mock("@upstash/ratelimit", async () => {
  const { fakeRatelimitFor } = await import("@/test/helpers/upstash-breaker");
  return {
    Ratelimit: class {
      static slidingWindow(tokens: number, window: string) {
        return { tokens, window };
      }
      private readonly fake: ReturnType<typeof fakeRatelimitFor>;
      // `_opts` is deliberately UNREAD. This previously passed the mocked
      // constructor's own options value straight into the fake as its
      // threshold — i.e. production's own
      // `slidingWindow(BREAKER_FAILURE_THRESHOLD, ...)` argument read straight
      // back out — so the double inherited every mutation to it and could not
      // disagree with production by construction. The fake now
      // takes its hand-typed FAKE_THRESHOLD default. The parameter and
      // `slidingWindow` both stay: the core must still be able to CONSTRUCT
      // this class with the table's values, and `resilient-fetch.test.ts`
      // asserts those values as a plumbing pin.
      constructor(_opts: { limiter: { tokens: number } }) {
        this.fake = fakeRatelimitFor(shared.store);
      }
      limit(identifier: string) {
        return this.fake.limit(identifier);
      }
    },
  };
});

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: {
      getUser: async () => ({ data: { user: authState.user }, error: null }),
      // 146.1 / B2 — the session is still MOCKED READABLE on purpose even
      // though the route no longer reads it for this header. A readable
      // session is what makes the "not on the wire" case non-vacuous.
      getSession: async () => ({
        data: { session: sessionState.session },
        error: null,
      }),
    },
    from: () => {
      const builder = {
        select: () => builder,
        eq: () => builder,
        single: async () => ownership,
        // 140.3-10 / TRAP-3 — the ownership read is `.maybeSingle()` so the
        // route can tell a Supabase transport fault (500 about us) apart from
        // an absent row (404). The exchange resolver still ends in `.single()`,
        // so both terminals are served from this one builder.
        maybeSingle: async () => ownership,
      };
      return builder;
    },
  }),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    rpc: async () => ({ data: null, error: null }),
    from: () => ({
      select: () => ({
        eq: () => ({
          single: async () => ({ data: { exchange: "okx" }, error: null }),
        }),
      }),
      upsert: async () => ({ error: null }),
    }),
  }),
}));

// The per-user route limiters are orthogonal to the seam under test; the
// breaker has its own dedicated Upstash client (mocked above) and never routes
// through this module.
vi.mock("@/lib/ratelimit", () => ({
  userActionLimiter: null,
  keysSyncUserLimiter: null,
  checkLimit: async () => ({ success: true, retryAfter: 0 }),
}));

vi.mock("@/lib/csrf", () => ({
  assertSameOrigin: () => null,
}));

vi.mock("@/lib/audit", () => ({
  logAuditEvent: vi.fn(),
  logAuditEventAsUser: vi.fn(),
}));

vi.mock("@/lib/sentry-capture", () => ({
  captureToSentry: vi.fn(),
}));

// Orthogonal to the seam: the real helper reads next/headers, which has no
// request scope under vitest. Stubbing it keeps the correlation_id assertions
// below deterministic without touching the transport under test.
vi.mock("@/lib/correlation-id", () => ({
  getCorrelationId: async () => TEST_CORRELATION_ID,
  CORRELATION_HEADER: "x-correlation-id",
}));

/** Static copy the route is allowed to emit. Duplicated deliberately: a test
 *  that imported the constant from the client could not detect it changing. */
const CIRCUIT_OPEN_HUMAN_COPY =
  "The analytics service is temporarily unavailable. Please try again in a moment.";

const ORIGINAL_ENV = { ...process.env };
let fetchMock: FetchMock;

function buildPostRequest() {
  return new NextRequest("http://localhost:3000/api/keys/sync", {
    method: "POST",
    headers: { "content-type": "application/json", ...VALID_ORIGIN },
    body: JSON.stringify({ strategy_id: TEST_STRATEGY_ID }),
  });
}

describe("POST /api/keys/sync — REAL client through the seam (SC-1a)", () => {
  beforeEach(() => {
    // ENV BEFORE IMPORT. The core captures `ANALYTICS_SERVICE_URL` and decides
    // whether the breaker exists at all (`UPSTASH_* → Redis.fromEnv()`) in its
    // MODULE BODY. Setting these after the dynamic import would leave the
    // breaker permanently inert and cases 2/3 would pass for the wrong reason.
    process.env.UPSTASH_REDIS_REST_URL = "https://fake.upstash.invalid";
    process.env.UPSTASH_REDIS_REST_TOKEN = "fake-token";
    process.env.ANALYTICS_SERVICE_URL = ANALYTICS_BASE;
    process.env.INTERNAL_API_TOKEN = "test-internal-token";
    vi.resetModules();

    shared.store.clear();
    authState.user = { id: TEST_USER_ID };
    sessionState.session = { access_token: TEST_USER_JWT };
    // api_key_id SET → definitively single-key, so the composite hoist is
    // skipped and the request reaches the unified /process-key dispatch.
    ownership.data = {
      id: TEST_STRATEGY_ID,
      user_id: TEST_USER_ID,
      api_key_id: TEST_API_KEY_ID,
    };
    fetchMock = installFetchMock();
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    restoreFetchMock();
    // A leaked `vi.stubGlobal("fetch")` is this repo's known CI-only (Node 22)
    // failure cause. Unstub unconditionally, not just on the happy path.
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    process.env = { ...ORIGINAL_ENV };
  });

  async function postAsUser() {
    const { POST } = await import("./route");
    return POST(buildPostRequest());
  }

  it("SC-1a: Railway hangs → typed 504 UPSTREAM_TIMEOUT through the real client, lambda released", async () => {
    // The exact rejection shape `AbortSignal.timeout()` produces when the
    // core's `process-key-enqueue` budget (15s) fires. jsdom's DOMException does
    // NOT extend Error, which is precisely the case the client's widened shape
    // guard exists for.
    fetchMock.mockRejectedValue(new DOMException("aborted", "TimeoutError"));

    const startedAt = Date.now();
    const res = await postAsUser();
    const elapsedMs = Date.now() - startedAt;

    expect(res.status).toBe(504);
    const raw = await res.text();
    const body = JSON.parse(raw);
    expect(body.ok).toBe(false);
    expect(body.code).toBe("UPSTREAM_TIMEOUT");
    expect(body.recoverable).toBe(true);
    expect(body.correlation_id).toBe(TEST_CORRELATION_ID);

    // The REAL client ran: the request actually reached the core's fetch with
    // the core-owned base URL, the client's path, a deadline signal, and the
    // CT-4 tenant header. Under the wholesale mock in route.test.ts none of
    // this is observable.
    //
    // ONCE, since 141.2 / D-03 — this count was 2 between Phase 141 and here.
    // `resync` was allowlisted for one retry on the strength of a claim that
    // the draft-SV pre-check made a replay safe; 141.1-02 re-derived that claim,
    // found it false (the compute worker's tick advances the draft out of draft
    // status inside the backoff, so the second attempt inserts a SECOND draft
    // row) and deleted it, leaving the grant behind. D-03 withdrew the grant, so
    // this route's timed-out enqueue now surfaces the 504 on its FIRST attempt.
    //
    // The 504 outcome and the lambda-release guarantee below are unchanged; what
    // changed is that the worst case is one budget span rather than two, which
    // only widens the SC-4b headroom this route already cleared.
    expect(
      fetchMock,
      "the resync enqueue re-attempted. D-03 withdrew resync's retry verdict — " +
        "a replay can double the draft strategy_verifications row.",
    ).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${ANALYTICS_BASE}/process-key`);
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect(init.headers).toMatchObject({
      Authorization: "Bearer test-internal-token",
      "X-User-Id": TEST_USER_ID,
      "X-Correlation-Id": TEST_CORRELATION_ID,
    });
    expect(JSON.parse(String(init.body))).toMatchObject({
      flow_type: "resync",
      source: "okx",
      context: { strategy_id: TEST_STRATEGY_ID, user_id: TEST_USER_ID },
    });

    // No lambda hold: the handler resolved on the rejection instead of waiting
    // out a wall-clock budget. (In production the bound is
    // SEAM_BUDGETS["process-key-enqueue"] = 15s against a 300s ceiling; here
    // the fake rejects at once, so any multi-second elapsed would mean the
    // route swallowed and stalled.)
    expect(elapsedMs).toBeLessThan(2_000);

    // The upstream detail is logged server-side, never echoed to the client.
    expect(raw).not.toContain("aborted");
  });

  it("breaker OPEN → typed 503 CIRCUIT_OPEN + Retry-After, and fetch is NEVER called", async () => {
    // Deliberately NOT 30: 30 is simultaneously BREAKER_COOLDOWN_S and
    // DEFAULT_RETRY_AFTER_S, so a hardcoded "30" would satisfy a 30-valued
    // assertion while forwarding nothing from the breaker's actual TTL.
    //
    // 140.2-06 per-site decision: THE GLOBAL KEY. `process-key-enqueue` declares
    // NO dependencies — no /process-key site raises a counting 503 naming one —
    // so the global key is the only key in this row's check set, and it is what
    // "the breaker is open for this route" now means here.
    seedBreakerOpen(shared.store, "breaker:railway", 13);

    const res = await postAsUser();

    expect(res.status).toBe(503);
    expect(res.headers.get("Retry-After")).toBe("13");
    const raw = await res.text();
    const body = JSON.parse(raw);
    expect(body.ok).toBe(false);
    expect(body.code).toBe("CIRCUIT_OPEN");
    expect(body.human_message).toBe(CIRCUIT_OPEN_HUMAN_COPY);
    expect(body.recoverable).toBe(true);
    expect(body.correlation_id).toBe(TEST_CORRELATION_ID);
    expect(raw).not.toMatch(/breaker|upstash|railway|circuit is open/i);

    // The load-bearing assertion: an open circuit means the seam is not
    // crossed. A 503 emitted AFTER a doomed round-trip would still pass the
    // status check while holding the lambda for the full budget.
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("T-140-12: UNAUTHENTICATED + breaker open → 401, never a breaker-state oracle", async () => {
    // 140.2-06 per-site decision: THE GLOBAL KEY — same reasoning as the case
    // above, and additionally the ordering argument: the seed must be a key the
    // route WOULD read, or "the gate ran first" is indistinguishable from "that
    // key is never consulted here".
    seedBreakerOpen(shared.store, "breaker:railway", 13);
    authState.user = null;

    const res = await postAsUser();

    // An anonymous caller must not be able to distinguish "Railway is
    // degraded" from "Railway is healthy" by poking this endpoint.
    expect([401, 403]).toContain(res.status);
    expect(res.status).not.toBe(503);
    expect(res.headers.get("Retry-After")).toBeNull();

    const raw = await res.text();
    expect(raw).not.toContain("CIRCUIT_OPEN");
    expect(raw).not.toMatch(/circuit|breaker|upstash|railway|unavailable/i);

    // And the gate short-circuits before the seam is even consulted.
    expect(fetchMock).not.toHaveBeenCalled();
  });

  /**
   * Phase 140.2-11 / SEAMCORE-11 (A-27) — the null-body status, END TO END.
   *
   * `src/lib/process-key-client.test.ts` pins the envelope at the client. This
   * case pins the thing the envelope exists for: that the ROUTE responds at
   * all. Before the fix, `postProcessKey`'s status pass-through called
   * `NextResponse.json(body, { status: 304 })`, which throws
   * `TypeError: Response constructor: Invalid response status code` (verified
   * by execution on Node; WHATWG-spec, so CI's Node 22 agrees) — and that throw
   * left a function declared `Promise<PostProcessKeyResult>` whose five caller
   * routes, this one included, have no catch for it. The client-level assertion
   * alone could not see that, because the crash was in what the CALLER then did
   * with the result.
   */
  it("SEAMCORE-11 / A-27: a 304 upstream → typed 502 envelope, the route RESPONDS rather than crashing", async () => {
    // A real null-body response: `new Response(null, { status: 304 })` is
    // constructible, `Response.json(x, { status: 304 })` is not. That asymmetry
    // is the whole defect.
    fetchMock.mockResolvedValue(new Response(null, { status: 304 }));

    const res = await postAsUser();

    expect(res.status).toBe(502);
    const raw = await res.text();
    const body = JSON.parse(raw);
    expect(body.ok).toBe(false);
    expect(body.code).toBe("UPSTREAM_NETWORK_ERROR");
    expect(body.recoverable).toBe(true);
    expect(body.correlation_id).toBe(TEST_CORRELATION_ID);
    // No new user-facing copy — the existing "never reached it" envelope.
    expect(body.human_message).toBe("Could not reach the ingestion service.");
    // The seam WAS crossed: this is an upstream answer, not a short-circuit.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    // The observed status is an operator fact, not a user-facing one.
    expect(raw).not.toContain("304");
  });

  /**
   * Phase 146.1 / B2 (2026-08-18) — THE PREMISE IS INVERTED, THE CASE IS NOT
   * DELETED.
   *
   * TS-15 (140.3-02) pinned that the session access token RIDES the outgoing
   * request as `X-User-Access-Token`. The v1.19 xhigh review measured the far
   * side and found no reader: `analytics-service/services/db.py`'s
   * `get_user_scoped_supabase` has had ZERO production callers since Phase 145,
   * and `analytics-service/tests/test_process_key.py` (~:2220) PINS that
   * non-use. So a LIVE end-user Supabase JWT was crossing the Vercel→Railway
   * boundary on EVERY resync — the money-onboarding chokepoint — and being read
   * by nobody. The forward is gone; this case now pins its absence.
   *
   * ⛔ INVERTED, NOT DELETED, and the distinction is the whole point: an
   * inverted assertion reds the day someone re-adds the forward, while a
   * deleted one is silent forever and is indistinguishable from "we stopped
   * caring".
   */
  it("B2: a READABLE session does NOT put X-User-Access-Token on the outgoing request", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ ok: true, queued: true }), {
        status: 202,
        headers: { "content-type": "application/json" },
      }),
    );

    // Non-vacuity, stated before the assertion it protects: the mocked session
    // IS readable and DOES hold a live JWT, so "nothing on the wire" cannot be
    // explained by "there was nothing to send".
    expect(sessionState.session?.access_token).toBe(TEST_USER_JWT);

    const res = await postAsUser();
    expect(res.status).toBe(202);

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const headers = init.headers as Record<string, string>;
    // The seam WAS crossed and the headers object IS populated — otherwise the
    // absence assertions below would pass on an empty object.
    expect(headers["Authorization"]).toMatch(/^Bearer /);
    // ABSENCE, case-insensitively over the whole key set. A single-key lookup
    // is satisfied by a differently-cased re-add (`x-user-access-token`), which
    // `fetch` would send just the same.
    expect(
      Object.keys(headers).filter(
        (k) => k.toLowerCase() === "x-user-access-token",
      ),
      "A live end-user Supabase JWT is on the wire again. The only reader on " +
        "the far side has zero callers (146.1 / B2) — decide deliberately " +
        "whether to re-open that exposure, and write the reason down.",
    ).toEqual([]);
    expect(JSON.stringify(headers)).not.toContain(TEST_USER_JWT);
  });

  /**
   * ⚠️ 146.1 / B2 — THE FIXTURE'S CREDENTIAL CHANGED; THE MECHANISM UNDER TEST
   * DID NOT, AND THAT IS THE POINT.
   *
   * This case used to embed `X-User-Access-Token` in the transport error. No
   * caller sends that header any more, so pinning it here would assert that the
   * core scrubs a value NOTHING EVER HANDED IT — unsatisfiable by construction,
   * and the only way to make it green again would be to re-add the very forward
   * B2 removed. A test that can only pass by reverting the change is not
   * coverage, it is a hostage.
   *
   * `X-Tenant-Claim` is the replacement, chosen because it has the SAME
   * properties that made the JWT the right probe: a real outgoing
   * credential-bearing header, computed PER REQUEST (an HMAC over the tenant
   * id), whose value NO `SEAM_SECRET_ENV_NAMES` member can reach. Only
   * `credentialHeaderValues(requestInit)` — the DERIVED mechanism that made the
   * 140.3-02 fix a CLASS result — can scrub it. So this case still proves
   * exactly what it always proved, about a credential the seam actually carries.
   *
   * ⭐ IT ALSO CAUGHT A LIVE PRE-EXISTING LEAK. With this probe in place the
   * CLIENT's own log site was shown to ship the tenant claim VERBATIM: it used
   * a caller-declared `[args.userAccessToken]` array, which no more reaches a
   * tenant claim than an env list does. `process-key-client.ts` now derives.
   *
   * The error message is built from the REAL outgoing headers rather than a
   * hand-typed literal, which is also closer to what undici actually produces.
   */
  it("SCRUB COVERAGE (B2): a transport error embedding this request's OWN per-request credential leaks neither it nor the syscall token", async () => {
    let tenantClaim = "";
    fetchMock.mockImplementation(async (...args: unknown[]) => {
      const headers = (args[1] as RequestInit).headers as Record<
        string,
        string
      >;
      tenantClaim = headers["X-Tenant-Claim"];
      throw new Error(
        `connect ECONNREFUSED 10.0.0.1:443 (headers: ${JSON.stringify(headers)})`,
      );
    });
    // The suite's beforeEach already silences console.error; re-spy so THIS
    // case can read what was written rather than only that it was written.
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const res = await postAsUser();
    expect(res.status).toBe(502);

    // VACUITY FENCE, before anything is asserted about the scrub. A blank or
    // short claim would be REFUSED by `MIN_REDACTABLE_SECRET_LENGTH`, and
    // `not.toContain("")` is true of every string ever written.
    expect(
      tenantClaim?.length ?? 0,
      "the seam sent no usable X-Tenant-Claim, so this case is asserting " +
        "nothing — fix the probe before trusting the scrub assertions below",
    ).toBeGreaterThanOrEqual(MIN_REDACTABLE_SECRET_LENGTH);
    expect(await res.text()).not.toContain(tenantClaim);

    const logged = errorSpy.mock.calls
      .map((c) => c.map(String).join(" "))
      .join("\n");
    // BOTH log sites on this path are asserted by one read of the spy: the
    // client's `/process-key upstream fetch threw:` and the core's own
    // `network failure reaching the analytics service:`. The second one was
    // uncovered by 140.3-02 — see `credentialHeaderValues` in
    // `resilient-fetch.ts`; the FIRST one was still leaking until 146.1 / B2.
    expect(
      logged,
      "A seam log line carrying this request's signed tenant claim is the " +
        "same leak class the redaction leaf exists to close. No env list can " +
        "reach a per-request value — only the DERIVED header scrub can — so " +
        "this reddening means that derivation broke — TRAP-1.",
    ).not.toContain(tenantClaim);
    expect(logged).toContain("network failure reaching the analytics service");
    expect(logged).toContain("/process-key upstream fetch threw");
    // ⚠️ The other half of TRAP-1: over-redaction destroys the diagnosis, and a
    // one-sided assertion ships that state green.
    expect(
      logged,
      "ECONNREFUSED is the most valuable thing in a transport line. A redactor " +
        "that eats it has replaced one incident with two.",
    ).toContain("ECONNREFUSED");
  });
});
