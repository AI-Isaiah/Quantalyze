import { describe, it, expect, beforeEach, vi } from "vitest";
import { NextRequest } from "next/server";

/**
 * Shared describe-suite for admin POST routes that must enforce both
 * `assertSameOrigin` (CSRF) and `checkLimit(adminActionLimiter, ...)`
 * (rate-limit) at the route layer.
 *
 * Review-fix v0.22.24.1 (I5 — maintainability conf 8): the 4 admin POST
 * route tests under src/app/api/admin/{intro-request,strategy-review,
 * allocator-approve,notify-submission}/route.test.ts shipped ~90%
 * identical test harnesses. This helper consolidates the three suites
 * that go through `withAdminAuth` — the notify-submission test stays
 * standalone because its handler shape diverges (no withAdminAuth
 * wrapper, plus an extra "surfaces 429 with Retry-After" assertion).
 *
 * Vitest constraint: `vi.mock(...)` calls are hoisted to module top and
 * MUST live in the caller's file (per-route mock shapes vary —
 * different Supabase from() chains, different `@/lib/email` mocks,
 * etc.). This helper therefore only owns the describe/it BODIES — the
 * supabase / admin / email mocks remain in each route.test.ts.
 *
 * Each caller:
 *   1. Sets up its own `vi.mock(...)` calls + `supabaseCallCount` state.
 *   2. Calls runAdminPostCsrfRateLimitSuite({ path, validBody,
 *      importRoute, supabaseCallCount }).
 *
 * The suite asserts:
 *   - CSRF: 403 when no Origin/Referer header is present.
 *   - CSRF: 403 when Origin host is not in the allowlist.
 *   - Both CSRF tests also confirm `supabaseCallCount === 0`, i.e. the
 *     route short-circuits BEFORE opening a Supabase client.
 *   - Rate limit: 100/100 rapid requests come back 429 when the bucket
 *     mock denies every call (I3 — the "denied > 0" predicate was a
 *     trivial true).
 */

export type AdminPostCsrfRateLimitSuiteOptions = {
  /** The route's URL path (used for the NextRequest URL constructor and the suite description). */
  path: `/api/admin/${string}`;
  /** Audit P-numbers covered by this suite (e.g. "P197 + P200") — surfaces in the describe label. */
  pNumber: string;
  /** A valid JSON body for the route. Used for both CSRF + rate-limit requests. */
  validBody: Record<string, unknown>;
  /**
   * Importer for the route module. Called inside each test (after
   * `vi.resetModules()` runs in beforeEach) so vi.doMock-style stubs
   * applied to `@/lib/ratelimit` are picked up by the dynamic import.
   */
  importRoute: () => Promise<{
    POST: (req: NextRequest) => Promise<Response>;
  }>;
  /**
   * Ref to the `vi.hoisted({ callCount: 0 })` state in the caller. The
   * helper reads `.callCount` to assert the route short-circuited before
   * createClient() ran. Caller is responsible for zeroing it in their
   * own beforeEach.
   */
  supabaseCallCount: { callCount: number };
};

const VALID_ORIGIN = { origin: "http://localhost:3000" };

export function runAdminPostCsrfRateLimitSuite(
  opts: AdminPostCsrfRateLimitSuiteOptions,
): void {
  const { path, pNumber, validBody, importRoute, supabaseCallCount } = opts;
  const url = `http://localhost:3000${path}`;

  describe(`POST ${path}`, () => {
    beforeEach(() => {
      supabaseCallCount.callCount = 0;
      // Wipe Upstash env so the un-stubbed checkLimit() takes its
      // dev-fallback path (success=true) for any non-rate-limit test
      // that lands here. The rate-limit test mocks checkLimit directly
      // to force the deny path.
      delete process.env.UPSTASH_REDIS_REST_URL;
      delete process.env.UPSTASH_REDIS_REST_TOKEN;
      vi.resetModules();
    });

    describe(`CSRF (${pNumber})`, () => {
      it("returns 403 when no Origin or Referer header is present", async () => {
        const { POST } = await importRoute();
        const req = new NextRequest(url, {
          method: "POST",
          body: JSON.stringify(validBody),
        });
        const res = await POST(req);
        expect(res.status).toBe(403);
        // Never even opened a Supabase client for the bad-origin request.
        expect(supabaseCallCount.callCount).toBe(0);
      });

      it("returns 403 when Origin host is not in the allowlist", async () => {
        const { POST } = await importRoute();
        const req = new NextRequest(url, {
          method: "POST",
          headers: { origin: "https://evil.example.com" },
          body: JSON.stringify(validBody),
        });
        const res = await POST(req);
        expect(res.status).toBe(403);
        expect(supabaseCallCount.callCount).toBe(0);
      });
    });

    describe(`rate limit (${pNumber})`, () => {
      it("denies all 100 of 100 rapid requests when bucket is exhausted", async () => {
        // Simulate an exhausted bucket — every call denied. With a 100%
        // deny mock, all 100 requests MUST come back 429; anything less
        // means the route bypassed the gate at least once (the prior
        // `denied > 0` predicate was trivially true — review-fix I3).
        vi.doMock("@/lib/ratelimit", async () => {
          const actual = await vi.importActual<
            typeof import("@/lib/ratelimit")
          >("@/lib/ratelimit");
          return {
            ...actual,
            checkLimit: async () => ({ success: false, retryAfter: 60 }),
          };
        });
        const { POST } = await importRoute();
        const statuses: number[] = [];
        for (let i = 0; i < 100; i++) {
          const req = new NextRequest(url, {
            method: "POST",
            headers: VALID_ORIGIN,
            body: JSON.stringify(validBody),
          });
          const res = await POST(req);
          statuses.push(res.status);
        }
        const denied = statuses.filter((s) => s === 429).length;
        expect(denied).toBe(100);
      });
    });
  });
}
