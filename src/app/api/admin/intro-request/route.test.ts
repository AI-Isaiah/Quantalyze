import { describe, it, expect, beforeEach, vi } from "vitest";
import { NextRequest } from "next/server";

/**
 * audit-2026-05-07 P197 + P200 — route-level coverage for the CSRF +
 * rate-limit sweep on /api/admin/intro-request.
 *
 * The outer POST(req) handler runs assertSameOrigin + admin auth +
 * adminActionLimiter BEFORE delegating to the withAdminAuth-wrapped
 * admin handler (see v0.22.24.1 review-fix C4/I1/I2 reorder). These
 * tests prove the gates short-circuit at the outer layer (so the
 * inner withAdminAuth never runs on a bad-origin / unauth /
 * rate-limited request). Companion grep gate:
 * src/__tests__/admin-csrf-ratelimit-grep.test.ts.
 *
 * Review-fix v0.22.24.1 (I5 — maintainability): the per-route CSRF +
 * rate-limit suite is now lifted into a shared helper because all
 * three withAdminAuth-using admin POST tests (intro-request,
 * strategy-review, allocator-approve) were ~90% identical. Mocks
 * stay here (per-route Supabase from() shapes vary).
 */

vi.mock("server-only", () => ({}));

const TEST_USER = vi.hoisted(() => ({
  id: "00000000-0000-0000-0000-000000000124",
}));

const supabaseState = vi.hoisted(() => ({
  callCount: 0,
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => {
    supabaseState.callCount += 1;
    return {
      auth: {
        getUser: async () => ({ data: { user: TEST_USER }, error: null }),
      },
      // Used by logAuditEvent (RPC stub).
      rpc: async () => ({ data: null, error: null }),
      from: () => ({
        update: () => ({ eq: async () => ({ error: null }) }),
        select: () => ({
          eq: () => ({
            single: async () => ({ data: null, error: null }),
          }),
        }),
      }),
    };
  },
}));

vi.mock("@/lib/admin", () => ({
  isAdminUser: async () => true,
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: () => ({
      update: () => ({ eq: async () => ({ error: null }) }),
      select: () => ({
        eq: () => ({ single: async () => ({ data: null, error: null }) }),
      }),
    }),
  }),
}));

vi.mock("@/lib/email", () => ({
  notifyAllocatorIntroStatus: async () => undefined,
}));

import { runAdminPostCsrfRateLimitSuite } from "@/__tests__/helpers/adminPostCsrfRateLimit";

runAdminPostCsrfRateLimitSuite({
  path: "/api/admin/intro-request",
  pNumber: "P197 + P200",
  validBody: { id: "abc", status: "intro_made" },
  importRoute: async () => {
    const mod = await import("./route");
    return { POST: mod.POST as (req: NextRequest) => Promise<Response> };
  },
  supabaseCallCount: supabaseState,
});

/**
 * B9 boundary-validation parity (M-1143 sibling) — `admin_note` was written into
 * contact_requests.admin_note (unbounded TEXT) with no length cap. The route now
 * Zod-validates the body with `admin_note: z.string().max(2000)`, rejecting an
 * oversized note at the boundary BEFORE the DB write.
 *
 * Fail-without-fix: pre-fix the route checked only `!id` + the VALID_STATUSES
 * enum, so id='abc'/status='intro_made' with a 2001-char admin_note passed
 * straight through to the contact_requests UPDATE.
 */
describe("POST /api/admin/intro-request — B9 admin_note length cap", () => {
  const url = "http://localhost:3000/api/admin/intro-request";

  beforeEach(() => {
    delete process.env.UPSTASH_REDIS_REST_URL;
    delete process.env.UPSTASH_REDIS_REST_TOKEN;
    // Allow the limiter through so a 400 can only come from body validation,
    // not from the shared suite's deny-everything ratelimit doMock.
    vi.doUnmock("@/lib/ratelimit");
    vi.resetModules();
  });

  it("rejects an admin_note exceeding 2000 chars with 400 before any DB write", async () => {
    const mod = await import("./route");
    const req = new NextRequest(url, {
      method: "POST",
      headers: { origin: "http://localhost:3000" },
      body: JSON.stringify({
        id: "abc",
        status: "intro_made",
        admin_note: "x".repeat(2001),
      }),
    });
    const res = await (mod.POST as (req: NextRequest) => Promise<Response>)(req);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/invalid request/i);
  });
});

/**
 * M-1152 (testgap) — the allocator-status notify is a fire-and-forget Next 15+
 * `after(async () => …)` side-effect. Its catch promotes failures to a tagged
 * `console.error` + captureToSentry so a DB blip or email-provider 5xx is
 * observable (the admin already got a 200). The route previously had NO test
 * proving that catch fires — a regression back to a silent swallow would ship
 * green. This drives the full happy path with a throwing notify and asserts the
 * tagged log. Neuter check: delete the route's notify-catch console.error and
 * this fails.
 */
describe("POST /api/admin/intro-request — M-1152 allocator-notify failure logging", () => {
  const url = "http://localhost:3000/api/admin/intro-request";

  beforeEach(() => {
    delete process.env.UPSTASH_REDIS_REST_URL;
    delete process.env.UPSTASH_REDIS_REST_TOKEN;
    vi.doUnmock("@/lib/ratelimit");
    vi.resetModules();
  });

  it("logs a tagged console.error when the allocator-status notify throws", async () => {
    // Capture the fire-and-forget after() callback so we can invoke it
    // deterministically (no reliance on the Vercel runtime keep-alive).
    const captured: Array<() => Promise<void>> = [];
    vi.doMock("next/server", async (importOriginal) => {
      const actual = await importOriginal<typeof import("next/server")>();
      return { ...actual, after: (cb: () => Promise<void>) => captured.push(cb) };
    });
    // The main UPDATE must affect 1 row (else 409); the after() lookups must
    // return real allocator email + strategy name so the notify is reached.
    vi.doMock("@/lib/supabase/admin", () => ({
      createAdminClient: () => ({
        from: (table: string) => ({
          update: () => ({
            eq: () => ({
              eq: () => ({
                select: async () => ({ data: [{ id: "req-1" }], error: null }),
              }),
            }),
          }),
          select: () => ({
            eq: () => ({
              single: async () => ({
                data:
                  table === "contact_requests"
                    ? { allocator_id: "alloc-1", strategy_id: "strat-1" }
                    : table === "profiles"
                      ? { email: "allocator@test.local" }
                      : { name: "Strat 1" },
                error: null,
              }),
            }),
          }),
        }),
      }),
    }));
    vi.doMock("@/lib/email", () => ({
      notifyAllocatorIntroStatus: async () => {
        throw new Error("smtp boom");
      },
    }));
    // No-op the audit + Sentry side-effects so the test isolates the notify path.
    vi.doMock("@/lib/audit", () => ({
      logAuditEventAsUser: () => {},
      logAuditEvent: async () => {},
    }));
    vi.doMock("@/lib/sentry-capture", () => ({ captureToSentry: () => {} }));

    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const mod = await import("./route");
    const req = new NextRequest(url, {
      method: "POST",
      headers: { origin: "http://localhost:3000" },
      body: JSON.stringify({ id: "req-1", status: "intro_made" }),
    });
    const res = await (mod.POST as (r: NextRequest) => Promise<Response>)(req);
    expect(res.status).toBe(200);

    // Run the captured fire-and-forget after() callback (and await its
    // internal lookups + the throwing notify).
    expect(captured).toHaveLength(1);
    await captured[0]();

    expect(errSpy).toHaveBeenCalledWith(
      "[admin/intro-request] allocator-status notify failed:",
      expect.anything(),
    );
    errSpy.mockRestore();
  });
});
