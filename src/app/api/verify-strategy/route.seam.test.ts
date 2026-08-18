import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";
import {
  installFetchMock,
  restoreFetchMock,
  type FetchMock,
} from "@/test/helpers/fetch";
// 146.1 / B2 — the scrub cases' vacuity fence reads production's own floor
// rather than re-typing a number that could drift away from it.
import { MIN_REDACTABLE_SECRET_LENGTH } from "@/lib/seam-redaction";

/**
 * Phase 140.3-02 / TS-15 — route-level SEAM proof for POST /api/verify-strategy.
 *
 * WHY THIS FILE EXISTS, given `route.test.ts` already covers this handler.
 * ----------------------------------------------------------------------
 * The sibling `route.test.ts` replaces `@/lib/process-key-client` with a factory
 * on every case that reaches the seam, so it can prove the route's response
 * TRANSLATION and nothing else: the client, the shared resilience core and the
 * HEADER ASSEMBLY are all absent from the object graph under test. TS-15's whole
 * claim is about a header and about what a transport error does to it, so it is
 * unprovable there — a test that asserted "we passed a value to a mock" would
 * pin the call site and say nothing about the wire or the log.
 *
 * This file runs the REAL `@/lib/process-key-client` and the REAL
 * `@/lib/resilient-fetch`, faking only what genuinely leaves the process:
 * `fetch`, `@upstash/*` and Supabase. It must therefore NEVER replace the
 * process-key client with a mock — doing so silently reverts it to a duplicate
 * of `route.test.ts`.
 *
 * ⚠️ WHAT THIS FILE NOW ENFORCES (Phase 146.1 / B2, 2026-08-18). This route no
 * longer forwards `X-User-Access-Token` AT ALL. TS-15 (140.3-02) added the
 * forward so the unified router could build a user-scoped, RLS-enforcing
 * client; the v1.19 xhigh review measured the far side and found no reader —
 * `analytics-service/services/db.py`'s `get_user_scoped_supabase` has had ZERO
 * production callers since Phase 145, and
 * `analytics-service/tests/test_process_key.py` (~:2220) PINS that non-use. A
 * live end-user Supabase JWT was leaving Vercel on every session-bearing teaser
 * submit and being read by nobody, so the forward was removed.
 *
 * ⛔ CASE 1 WAS INVERTED, NOT DELETED. An inverted assertion reds the day the
 * forward comes back; a deleted one is silent forever.
 *
 * ⛔ CASE 3 STAYS, and it is about the CORE's redaction, which derives its
 * per-request secrets from the outgoing headers (`credentialHeaderValues` in
 * `resilient-fetch.ts`) — a CLASS fix covering whatever this seam carries NEXT,
 * not a fact about this caller. undici still embeds outgoing headers in
 * `err.message`, and this route still puts raw exchange `api_key` /
 * `api_secret` in the outgoing BODY.
 *
 * Cases:
 *   1. A READABLE session → the header is still ABSENT. (Inverted from TS-15.)
 *   2. NO session (the normal public-teaser case) → the header is ABSENT.
 *      A fabricated value here would be elevation of privilege. ⛔ UNCHANGED —
 *      it is the proof that case 1's inversion did not simply delete
 *      assertions, and it must keep passing byte-for-byte.
 *   3. A transport error whose message embeds THIS REQUEST'S OWN per-request
 *      credential (`X-Tenant-Claim`, a signed HMAC no env list can reach) → the
 *      logged line has no claim and STILL has its syscall token. The probe
 *      changed from the JWT to the claim because the JWT is no longer in
 *      flight; the DERIVED mechanism it exercises is identical. Over-redaction
 *      is the other half of TRAP-1 and a one-sided assertion ships it green.
 */

vi.mock("server-only", () => ({}));

const ANALYTICS_BASE = "http://analytics.invalid";
const TEST_CORRELATION_ID = "11111111-2222-3333-4444-555555555555";

/**
 * The "JWT". Hand-typed, and its LENGTH is load-bearing: `seam-redaction`'s
 * MIN_REDACTABLE_SECRET_LENGTH floor governs env-derived candidates only, but a
 * realistic value keeps this case honest about the real thing (a Supabase JWT is
 * ~200 chars). It contains no preserve token, so nothing here can collide with
 * the diagnostic half of the assertion.
 */
const TEST_USER_JWT =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.dGhpcy1pcy1hLXRlc3QtdXNlci1hY2Nlc3MtdG9rZW4tdmFsdWU.c2lnbmF0dXJlLWJ5dGVz";

const sessionState = vi.hoisted(() => ({
  session: { access_token: "" } as { access_token: string } | null,
}));

const shared = vi.hoisted(() => ({
  store: new Map<string, { value: string; expiresAt: number }>(),
}));

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
      constructor(_opts: { limiter: { tokens: number } }) {
        this.fake = fakeRatelimitFor(shared.store);
      }
      limit(identifier: string) {
        return this.fake.limit(identifier);
      }
    },
  };
});

vi.mock("@/lib/csrf", () => ({ assertSameOrigin: () => null }));

// The route's own per-IP limiter is orthogonal to the seam under test; the
// breaker has its own dedicated Upstash client (mocked above).
vi.mock("@/lib/ratelimit", () => ({
  publicIpLimiter: null,
  checkLimit: async () => ({ success: true, retryAfter: 0 }),
  getClientIp: () => "127.0.0.1",
}));

// 146.1 / B2 — the session is still MOCKED READABLE on purpose even though the
// route no longer reads it for this header. Case 1 asserts absence WITH a live
// session (otherwise the absence would be explained by "nothing was there"),
// and case 2 nulls it for the ordinary anonymous teaser path.
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: {
      getSession: async () => ({
        data: { session: sessionState.session },
        error: null,
      }),
    },
  }),
}));

/**
 * 140.3-13a / SEAMUX-08 — the admin client, now driveable.
 *
 * `adminState.persistThrow` defaults to `null`, so every case written before
 * this plan sees the identical no-op success it saw before. The new case sets
 * it to a Supabase transport failure so the route's persist-threw arm — one of
 * this route's four Sentry captures — becomes reachable with the REAL capture
 * helper in the loop.
 */
const adminState = vi.hoisted(() => ({
  persistThrow: null as unknown,
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: () => ({
      update: () => ({
        eq: async () => {
          if (adminState.persistThrow !== null) throw adminState.persistThrow;
          return { error: null };
        },
      }),
    }),
  }),
}));

/**
 * 140.3-13a / SEAMUX-08 — a FAKE Sentry transport, with the REAL capture helper.
 *
 * `@/lib/sentry-capture` is deliberately NOT mocked in this file: the scrub is
 * folded into that helper (SEAMCORE-06), so mocking it would make the payload
 * assertions below pass with the scrubber deleted — the vacuous-oracle shape
 * this phase keeps finding. The sibling `route.test.ts` DOES mock the helper
 * (it predates this plan) and therefore proves only the call site; this file is
 * where "the dispatched payload is genuinely scrubbed" is falsifiable.
 */
const sentryState = vi.hoisted(() => ({
  captured: [] as Array<{
    err: unknown;
    options: { tags?: Record<string, string>; extra?: Record<string, unknown> };
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

vi.mock("@/lib/correlation-id", () => ({
  getCorrelationId: async () => TEST_CORRELATION_ID,
  CORRELATION_HEADER: "x-correlation-id",
}));

const ORIGINAL_ENV = { ...process.env };
let fetchMock: FetchMock;

function postReq(): NextRequest {
  return new NextRequest("http://localhost:3000/api/verify-strategy", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: "http://localhost:3000",
    },
    body: JSON.stringify({
      email: "test@example.com",
      exchange: "okx",
      api_key: "k",
      api_secret: "s",
    }),
  });
}

/** The teaser terminal-success reply, hand-typed from the Python builder. */
function successResponse(): Response {
  return new Response(
    JSON.stringify({
      ok: true,
      code: null,
      verification_id: "99999999-9999-9999-9999-999999999999",
      status: "published",
      trust_tier: "api_verified",
      metrics_snapshot: { twr: 0.12 },
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}

describe("[140.3-02 / TS-15] POST /api/verify-strategy — REAL client through the seam", () => {
  beforeEach(() => {
    // ENV BEFORE IMPORT. The core captures `ANALYTICS_SERVICE_URL` and decides
    // whether the breaker exists at all in its MODULE BODY; setting these after
    // the dynamic import would leave the seam inert and every case would pass
    // for the wrong reason.
    process.env.UPSTASH_REDIS_REST_URL = "https://fake.upstash.invalid";
    process.env.UPSTASH_REDIS_REST_TOKEN = "fake-token";
    process.env.ANALYTICS_SERVICE_URL = ANALYTICS_BASE;
    process.env.INTERNAL_API_TOKEN = "test-internal-token-32-chars-long";
    vi.resetModules();

    shared.store.clear();
    sessionState.session = { access_token: TEST_USER_JWT };
    fetchMock = installFetchMock();
    adminState.persistThrow = null;
    sentryState.captured.length = 0;
  });

  afterEach(() => {
    restoreFetchMock();
    // A leaked `vi.stubGlobal("fetch")` is this repo's known CI-only (Node 22)
    // failure cause. Unstub unconditionally, not just on the happy path.
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    process.env = { ...ORIGINAL_ENV };
  });

  async function post() {
    const { POST } = await import("./route");
    return POST(postReq());
  }

  it("B2 (inverted from TS-15): a READABLE session still puts NO X-User-Access-Token on the wire", async () => {
    fetchMock.mockResolvedValue(successResponse());

    // Non-vacuity, asserted BEFORE the absence it protects: the session really
    // is readable and really does hold a live JWT. Without this line, "nothing
    // on the wire" would be equally explained by "nothing was there".
    expect(sessionState.session?.access_token).toBe(TEST_USER_JWT);

    const res = await post();
    expect(res.status).toBe(200);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${ANALYTICS_BASE}/process-key`);
    const headers = init.headers as Record<string, string>;
    // The pre-existing identity headers must survive — and they are what proves
    // the headers object is populated, so the absence below is not vacuous.
    expect(headers).toMatchObject({
      Authorization: "Bearer test-internal-token-32-chars-long",
      "X-User-Id": "public",
    });
    // ABSENCE, case-insensitively over the whole key set. A single-key lookup
    // is satisfied by a differently-cased re-add that `fetch` would still send.
    expect(
      Object.keys(headers).filter(
        (k) => k.toLowerCase() === "x-user-access-token",
      ),
      "A live end-user Supabase JWT is crossing the Vercel→Railway boundary " +
        "again. Its only reader (db.py get_user_scoped_supabase) has zero " +
        "callers — 146.1 / B2. Re-open that exposure deliberately or not at all.",
    ).toEqual([]);
    expect(JSON.stringify(headers)).not.toContain(TEST_USER_JWT);
  });

  it("NEGATIVE — no session forwards NO header at all (the public teaser fabricates nothing)", async () => {
    sessionState.session = null;
    fetchMock.mockResolvedValue(successResponse());

    const res = await post();
    expect(res.status).toBe(200);

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const headers = init.headers as Record<string, string>;
    expect(
      Object.keys(headers),
      "The header is OPTIONAL BY CONSTRUCTION. Emitting it with an empty or " +
        "placeholder value on the unauthenticated teaser would hand the " +
        "upstream a caller identity nobody proved — T-140.3-02-02.",
    ).not.toContain("X-User-Access-Token");
    // The anonymous tenant bucket is still selected, so the limiter isolation
    // that DOES apply to this route is untouched.
    expect(headers["X-User-Id"]).toBe("public");
  });

  /**
   * ⚠️ 146.1 / B2 — THE FIXTURE'S CREDENTIAL CHANGED; THE MECHANISM UNDER TEST
   * DID NOT.
   *
   * This case used to embed `X-User-Access-Token`. Nothing sends that header
   * now, so pinning it would assert that the core scrubs a value nothing ever
   * handed it — unsatisfiable except by re-adding the forward B2 removed.
   * `X-Tenant-Claim` has the SAME properties that made the JWT the right probe:
   * a real outgoing credential header, computed PER REQUEST, whose value no
   * `SEAM_SECRET_ENV_NAMES` member can reach — so only the DERIVED
   * `credentialHeaderValues(requestInit)` scrub can remove it. Same claim, live
   * credential.
   */
  it("SCRUB COVERAGE (B2) — a transport error embedding this request's OWN per-request credential logs neither it nor a destroyed syscall token", async () => {
    // The shape undici actually produces: the outgoing headers inlined into the
    // message, alongside the syscall token that is the whole diagnosis. Built
    // from the REAL headers rather than a literal, so the probe cannot drift
    // away from what the seam actually sends.
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
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const res = await post();

    // The route still answers a clean envelope rather than leaking upstream.
    expect(res.status).toBe(502);
    // VACUITY FENCE first: a blank or sub-floor claim would be REFUSED by
    // `MIN_REDACTABLE_SECRET_LENGTH`, and `not.toContain("")` is true of every
    // string ever written.
    expect(
      tenantClaim?.length ?? 0,
      "the seam sent no usable X-Tenant-Claim, so every scrub assertion below " +
        "is vacuous — fix the probe before trusting them",
    ).toBeGreaterThanOrEqual(MIN_REDACTABLE_SECRET_LENGTH);
    const raw = await res.text();
    expect(raw).not.toContain(tenantClaim);

    const logged = errorSpy.mock.calls.map((c) => c.map(String).join(" ")).join("\n");
    expect(
      logged,
      "undici embeds outgoing headers in err.message. A seam log line carrying " +
        "this request's signed tenant claim is the exact leak class the " +
        "redaction leaf exists to close, and only the DERIVED header scrub can " +
        "reach a per-request value — TRAP-1.",
    ).not.toContain(tenantClaim);
    // The INTERNAL token is redacted by the leaf's env list on the same line.
    expect(logged).not.toContain("test-internal-token-32-chars-long");
    // ⚠️ THE OTHER HALF OF TRAP-1. Over-redaction destroys the diagnosis:
    // ECONNREFUSED is the most valuable thing in a transport line, and a
    // one-sided assertion ships a scrubber that eats it, green.
    expect(
      logged,
      "A redactor that eats the syscall token has replaced one incident with " +
        "two. TRAP-1 is two-sided and both sides are asserted here.",
    ).toContain("ECONNREFUSED");
    // And the line is genuinely the seam's transport log, not some other error.
    expect(logged).toContain("/process-key upstream fetch threw");
  });
});

/**
 * 140.3-13a / SEAMUX-08 — the Sentry payload is scrubbed, END TO END, with the
 * REAL `captureToSentry` in the loop.
 *
 * ⚠️ WHY THIS LIVES HERE AND NOT IN `route.test.ts`. That file mocks
 * `@/lib/sentry-capture` wholesale, and the scrub lives INSIDE that helper. A
 * "no secret in the payload" assertion written there would pass with the
 * scrubber deleted — it would assert nothing about redaction at all. This file
 * mocks only the Sentry transport, so the helper's scrub actually runs.
 *
 * ⚠️ THE SECRET HERE IS PER-REQUEST AND UNKNOWABLE TO ANY ENV LIST. The JWT is
 * a live end-user Supabase token and the api_secret is the caller's raw
 * exchange credential. Neither can be defended by `SEAM_SECRET_ENV_NAMES`;
 * both reach the redactor ONLY because the route names them in `secrets`.
 * That is why the negative below is falsifiable: delete `perRequestSecrets`
 * from the persist arm and this case reddens, while the INTERNAL_API_TOKEN
 * assertion (env-derived) would stay green and hide it.
 */
describe("[140.3-13a / SEAMUX-08] POST /api/verify-strategy — the Sentry payload is scrubbed", () => {
  /** The caller's RAW exchange secret — per-request, above the redaction floor. */
  const RAW_API_SECRET = "SEC_kX7pQ2mN9vB4tR8sL1wY6hG3jD5fA0cZ";
  /**
   * The caller's RAW exchange key — also per-request and also above the floor.
   * 146.1 / B2 promoted it from "carried in the fixture" to "asserted": with the
   * live JWT no longer forwarded, `api_key` and `api_secret` ARE the route's
   * whole per-request secret set, so one of them must carry the falsifiability
   * this case claims.
   */
  const RAW_API_KEY = "AK_LIVE_9f3a1c7e5b2d84a6f0c1e3d5";

  // ⚠️ A SIBLING describe does NOT inherit the outer one's `beforeEach`. The
  // full seam setup is repeated here deliberately: without `shared.store
  // .clear()` the breaker carries failure counts over from the outer block and
  // every case in here answers 503 for the wrong reason. Same "ENV BEFORE
  // IMPORT" rule as above — the core reads ANALYTICS_SERVICE_URL in its module
  // body, so setting it after the dynamic import leaves the seam inert.
  beforeEach(() => {
    process.env.UPSTASH_REDIS_REST_URL = "https://fake.upstash.invalid";
    process.env.UPSTASH_REDIS_REST_TOKEN = "fake-token";
    process.env.ANALYTICS_SERVICE_URL = ANALYTICS_BASE;
    process.env.INTERNAL_API_TOKEN = "test-internal-token-32-chars-long";
    vi.resetModules();

    shared.store.clear();
    sessionState.session = { access_token: TEST_USER_JWT };
    adminState.persistThrow = null;
    sentryState.captured.length = 0;
    fetchMock = installFetchMock();
  });

  afterEach(() => {
    restoreFetchMock();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    process.env = { ...ORIGINAL_ENV };
  });

  function postReqWithSecret(): NextRequest {
    return new NextRequest("http://localhost:3000/api/verify-strategy", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "http://localhost:3000",
      },
      body: JSON.stringify({
        email: "test@example.com",
        exchange: "okx",
        api_key: RAW_API_KEY,
        api_secret: RAW_API_SECRET,
      }),
    });
  }

  async function nextCapture() {
    await vi.waitFor(() =>
      expect(
        sentryState.captured.length,
        "the persist arm captured nothing — a verification that succeeded upstream and failed to persist reaches nobody",
      ).toBeGreaterThan(0),
    );
    return sentryState.captured[sentryState.captured.length - 1];
  }

  /**
   * ⚠️ 146.1 / B2 — THE PER-REQUEST HALF NOW PROBES THE `api_key` INSTEAD OF THE
   * JWT, AND THE CLAIM IS UNCHANGED.
   *
   * `perRequestSecrets` used to be `[userAccessToken, api_key, api_secret]`.
   * The route no longer reads a session, so the array is `[api_key, api_secret]`
   * — BOTH still unknowable to any module-level env list, which is the property
   * this case exists to pin. Probing the (now never-present) JWT would assert
   * that `scrubSeamError` removes a value the route was never given, which is
   * impossible by construction and would have to be "fixed" by re-adding the
   * forward. The `api_key` was previously carried in the fixture but never
   * ASSERTED; asserting it keeps "dropping the `secrets` argument reddens here"
   * true, on a credential that is actually in flight.
   */
  it("TRAP-1 BOTH DIRECTIONS: the dispatched payload loses the raw api_key, the raw api_secret and the internal token — and KEEPS ECONNREFUSED", async () => {
    fetchMock.mockResolvedValue(successResponse());
    // The shape a Supabase transport failure actually produces at this hop:
    // the outgoing request's headers and body inlined into the message,
    // alongside the syscall token that IS the diagnosis.
    adminState.persistThrow = new Error(
      `connect ECONNREFUSED 10.0.0.9:5432 ` +
        `(headers: {"X-Internal-Token":"test-internal-token-32-chars-long"}, ` +
        `body: {"api_key":"${RAW_API_KEY}","api_secret":"${RAW_API_SECRET}"})`,
    );
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const { POST } = await import("./route");
    const res = await POST(postReqWithSecret());
    expect(res.status).toBe(500);

    const { err, options } = await nextCapture();
    expect(options.tags?.surface).toBe("verify-strategy");
    expect(options.tags?.step).toBe("public-token-persist-threw");

    const message = (err as Error).message;
    // UNDER-redaction, the per-request half. 140.3-02 closed exactly this leak
    // on the LOG channel; adding Sentry must not re-open it on a third-party one.
    expect(
      message,
      "the caller's RAW exchange api_key was dispatched to Sentry. No env list can know it — only the route's `secrets` array can, which is why dropping that argument must redden here.",
    ).not.toContain(RAW_API_KEY);
    expect(
      message,
      "the caller's RAW exchange api_secret was dispatched to Sentry",
    ).not.toContain(RAW_API_SECRET);
    // UNDER-redaction, the env half — a different mechanism, asserted separately
    // so a regression in one cannot hide behind the other.
    expect(message).not.toContain("test-internal-token-32-chars-long");
    // ⚠️ OVER-redaction. A redactor that eats the syscall token has replaced one
    // incident with two, and a one-sided assertion ships that state green.
    expect(
      message,
      "the syscall token was destroyed — ECONNREFUSED is the most valuable thing in a transport line",
    ).toContain("ECONNREFUSED");
    errorSpy.mockRestore();
  });

  it("ANTI-REGRESSION: a clean terminal success dispatches NOTHING to Sentry", async () => {
    fetchMock.mockResolvedValue(successResponse());
    const { POST } = await import("./route");
    const res = await POST(postReqWithSecret());
    expect(res.status).toBe(200);
    await new Promise((r) => setTimeout(r, 0));
    expect(sentryState.captured).toEqual([]);
  });
});
