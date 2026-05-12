import { vi } from "vitest";
import type { NextRequest } from "next/server";

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
