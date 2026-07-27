import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";
import {
  installFetchMock,
  restoreFetchMock,
  type FetchMock,
} from "@/test/helpers/fetch";
import { seedBreakerOpen } from "@/test/helpers/upstash-breaker";

/**
 * Phase 140 / SC-1b — route-level SEAM integration proof for
 * POST /api/admin/match/recompute.
 *
 * WHY THIS FILE EXISTS, given `route.test.ts` already covers this handler.
 * ----------------------------------------------------------------------
 * `route.test.ts` — like all sixteen of this repo's route tests that touch the
 * Vercel→Railway seam — replaces `@/lib/analytics-client` wholesale with a
 * `vi.mock` factory. It therefore proves the route's error MAPPING and
 * literally nothing else: the client, the shared resilience core, the wall-clock
 * budget and the `breaker:railway` circuit are all absent from the object graph
 * under test. A regression that deleted the timeout, bypassed the core, or
 * broke the breaker would leave every one of those tests green. That blind spot
 * is exactly how the third, unbudgeted Railway seam survived for months
 * (research §4.5).
 *
 * This file closes it by running the REAL `@/lib/analytics-client` and the REAL
 * `@/lib/resilient-fetch`, faking only the two things that genuinely leave the
 * process: `fetch` (the Railway round-trip) and `@upstash/*` (the breaker's
 * store). It must therefore NEVER mock the analytics client module — doing so
 * silently reverts this file to a duplicate of `route.test.ts`. The absence of
 * that mock is grep-asserted by the plan's acceptance criteria, so the literal
 * call text is deliberately not written anywhere in this file, comments
 * included.
 *
 * Cases:
 *   1. SC-1b — Railway hangs (fetch rejects with the `TimeoutError`
 *      DOMException `AbortSignal.timeout` produces) → the full chain
 *      route → analyticsRequest → resilientFetch → typed 504 envelope,
 *      promptly, with the lambda released rather than held.
 *   2. Breaker OPEN → typed 503 + `Retry-After`, and `fetch` is never called —
 *      the short-circuit is real, not cosmetic.
 *   3. T-140-12 oracle — UNAUTHENTICATED caller with the breaker open gets
 *      401, never 503, no `Retry-After`, no breaker vocabulary in the body.
 *      This is the AUTOMATED form of "the error arms live after the auth
 *      gate"; a diff-read of the handler is not evidence.
 */

vi.mock("server-only", () => ({}));

const VALID_ORIGIN = { origin: "http://localhost:3000" };

const userState = vi.hoisted<{ current: { id: string } | null }>(() => ({
  current: null,
}));
const adminFlag = vi.hoisted(() => ({ isAdmin: false }));

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

// The ADMIN rate limiter is orthogonal to the seam under test; the breaker has
// its own dedicated Upstash client (mocked above) and never routes through this
// module.
vi.mock("@/lib/ratelimit", () => ({
  adminActionLimiter: {},
  checkLimit: async () => ({ success: true, retryAfter: 0 }),
}));

vi.mock("@/lib/csrf", () => ({
  assertSameOrigin: () => null,
}));

/** Static copies the route is allowed to emit. Duplicated deliberately: a test
 *  that imports the constant from the route cannot detect the copy changing. */
const CIRCUIT_OPEN_COPY =
  "The analytics service is temporarily unavailable. Please try again in a moment.";
const TIMEOUT_COPY = "Match recompute timed out. Please try again.";

const ANALYTICS_BASE = "http://analytics.invalid";
const ORIGINAL_ENV = { ...process.env };

let fetchMock: FetchMock;
let errorSpy: ReturnType<typeof vi.spyOn>;

function buildPostRequest(body: unknown) {
  return new NextRequest("http://localhost:3000/api/admin/match/recompute", {
    method: "POST",
    headers: { "content-type": "application/json", ...VALID_ORIGIN },
    body: JSON.stringify(body),
  });
}

describe("POST /api/admin/match/recompute — REAL client through the seam (SC-1b)", () => {
  beforeEach(() => {
    // ENV BEFORE IMPORT. The core captures `ANALYTICS_SERVICE_URL` and decides
    // whether the breaker exists at all (`UPSTASH_* → Redis.fromEnv()`) in its
    // MODULE BODY. Setting these after the dynamic import would leave the
    // breaker permanently inert and cases 2/3 would pass for the wrong reason.
    process.env.UPSTASH_REDIS_REST_URL = "https://fake.upstash.invalid";
    process.env.UPSTASH_REDIS_REST_TOKEN = "fake-token";
    process.env.ANALYTICS_SERVICE_URL = ANALYTICS_BASE;
    vi.resetModules();

    shared.store.clear();
    userState.current = null;
    adminFlag.isAdmin = false;
    fetchMock = installFetchMock();
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
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

  async function postAsAdmin() {
    userState.current = { id: "admin-seam-1" };
    adminFlag.isAdmin = true;
    const { POST } = await import("./route");
    return POST(buildPostRequest({ allocator_id: "alloc-seam-1", force: false }));
  }

  it("SC-1b: Railway hangs → typed 504 through the real client, lambda released", async () => {
    // The exact rejection shape `AbortSignal.timeout()` produces when the
    // core's budget fires. jsdom's DOMException does NOT extend Error, which is
    // precisely the case the client's widened shape guard exists for.
    fetchMock.mockRejectedValue(new DOMException("aborted", "TimeoutError"));

    const startedAt = Date.now();
    const res = await postAsAdmin();
    const elapsedMs = Date.now() - startedAt;

    expect(res.status).toBe(504);
    const raw = await res.text();
    expect(JSON.parse(raw).error).toBe(TIMEOUT_COPY);

    // The REAL client ran: the request actually reached the core's fetch with
    // the core-owned base URL, the route's path, and a deadline signal. Under
    // the wholesale mock in route.test.ts none of this is observable.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${ANALYTICS_BASE}/api/match/recompute`);
    expect(init.signal).toBeInstanceOf(AbortSignal);

    // No lambda hold: the handler resolved on the rejection instead of waiting
    // out a wall-clock budget. (In production the bound is
    // SEAM_BUDGETS["match-recompute"] = 30s; here the fake rejects at once, so
    // any multi-second elapsed would mean the route swallowed and stalled.)
    expect(elapsedMs).toBeLessThan(2_000);

    // The upstream detail is logged server-side, never echoed to the client.
    expect(raw).not.toContain("aborted");
    expect(errorSpy).toHaveBeenCalled();
  });

  it("breaker OPEN → typed 503 + Retry-After, and fetch is NEVER called", async () => {
    // 140.2-06 per-site decision: this case means "THIS ROUTE'S DECLARED
    // DEPENDENCY is down", and the literal is the key `match-recompute`'s
    // SEAM_BUDGETS row declares. Deliberately NOT the global key: the property
    // asserted below (open ⇒ typed 503 + observed TTL + no seam crossing) is
    // unchanged, and seeding the per-dependency key additionally proves the
    // declared set is genuinely consulted at a REAL route rather than only in
    // the core's own unit test. `match.py:1657,1691` raise
    // service_error(503, dependency="supabase") on exactly this endpoint, so
    // this is the key that can actually open in production.
    seedBreakerOpen(shared.store, "breaker:supabase", 30);

    const res = await postAsAdmin();

    expect(res.status).toBe(503);
    expect(res.headers.get("Retry-After")).toBe("30");
    const raw = await res.text();
    expect(JSON.parse(raw).error).toBe(CIRCUIT_OPEN_COPY);
    expect(raw).not.toMatch(/circuit|breaker|upstash|railway/i);

    // The load-bearing assertion: an open circuit means the seam is not
    // crossed. A 503 emitted AFTER a doomed round-trip would still pass the
    // status check while holding the lambda for the full budget.
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("T-140-12: UNAUTHENTICATED + breaker open → 401, never a breaker-state oracle", async () => {
    // 140.2-06 per-site decision: THE GLOBAL KEY. This case is about ORDERING —
    // the auth gate must short-circuit before the breaker is consulted at all —
    // so the seed must be the key that is checked on EVERY row, or a green here
    // could mean "the gate ran first" or merely "this route never reads that
    // key". The global key removes the second reading.
    seedBreakerOpen(shared.store, "breaker:railway", 30);
    userState.current = null;
    adminFlag.isAdmin = false;

    const { POST } = await import("./route");
    const res = await POST(
      buildPostRequest({ allocator_id: "alloc-seam-1", force: false }),
    );

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
