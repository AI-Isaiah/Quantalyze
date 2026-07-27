import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";
import {
  installFetchMock,
  restoreFetchMock,
  type FetchMock,
} from "@/test/helpers/fetch";

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
 * ⚠️ THE ORDERING THIS FILE ENFORCES. `X-User-Access-Token` is a LIVE end-user
 * Supabase JWT, and undici embeds the outgoing headers in `err.message`. So
 * forwarding it BEFORE the redaction leaf exists ships a window in which a
 * production log line carries a live JWT. `src/lib/seam-redaction.ts` (140.2-08)
 * is a hard prerequisite of this obligation, and case 3 proves the coverage BY
 * EXECUTION rather than asserting it from the leaf's existence.
 *
 * Cases:
 *   1. A readable session → the header is on the wire.
 *   2. NO session (the normal public-teaser case) → the header is ABSENT.
 *      A fabricated value here would be elevation of privilege.
 *   3. A transport error whose message embeds the JWT → the logged line has no
 *      JWT and STILL has its syscall token. Over-redaction is the other half of
 *      TRAP-1 and a one-sided assertion ships it green.
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

// TS-15 — the session read the forwarding is derived from. `sessionState` is
// hoisted so case 2 can null it and assert the header's ABSENCE.
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

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: () => ({ update: () => ({ eq: async () => ({ error: null }) }) }),
  }),
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

  it("a readable session puts X-User-Access-Token ON THE WIRE", async () => {
    fetchMock.mockResolvedValue(successResponse());

    const res = await post();
    expect(res.status).toBe(200);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${ANALYTICS_BASE}/process-key`);
    expect(
      (init.headers as Record<string, string>)["X-User-Access-Token"],
      "Without this header the analytics service cannot build a user-scoped, " +
        "RLS-enforcing client for this caller — TS-15.",
    ).toBe(TEST_USER_JWT);
    // The pre-existing identity headers must survive alongside it.
    expect(init.headers).toMatchObject({
      Authorization: "Bearer test-internal-token-32-chars-long",
      "X-User-Id": "public",
    });
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

  it("SCRUB COVERAGE — a transport error embedding the JWT logs neither the JWT nor a destroyed syscall token", async () => {
    // The shape undici actually produces: the outgoing headers inlined into the
    // message, alongside the syscall token that is the whole diagnosis.
    fetchMock.mockRejectedValue(
      new Error(
        `connect ECONNREFUSED 10.0.0.1:443 (headers: {"Authorization":"Bearer test-internal-token-32-chars-long","X-User-Access-Token":"${TEST_USER_JWT}"})`,
      ),
    );
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const res = await post();

    // The route still answers a clean envelope rather than leaking upstream.
    expect(res.status).toBe(502);
    const raw = await res.text();
    expect(raw).not.toContain(TEST_USER_JWT);

    const logged = errorSpy.mock.calls.map((c) => c.map(String).join(" ")).join("\n");
    expect(
      logged,
      "undici embeds outgoing headers in err.message. A seam log line carrying " +
        "a LIVE user Supabase JWT is the exact leak the redaction leaf exists " +
        "to close, and the reason TS-15 lands strictly AFTER it — TRAP-1.",
    ).not.toContain(TEST_USER_JWT);
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
