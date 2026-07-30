import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";
import {
  installFetchMock,
  restoreFetchMock,
  type FetchMock,
} from "@/test/helpers/fetch";
import { seedBreakerOpen } from "@/test/helpers/upstash-breaker";

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
      constructor(opts: { limiter: { tokens: number } }) {
        this.fake = fakeRatelimitFor(shared.store, opts.limiter.tokens);
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
    },
    from: () => {
      const builder = {
        select: () => builder,
        eq: () => builder,
        single: async () => ownership,
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
    expect(fetchMock).toHaveBeenCalledTimes(1);
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
    seedBreakerOpen(shared.store, 13);

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
    seedBreakerOpen(shared.store, 13);
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
});
