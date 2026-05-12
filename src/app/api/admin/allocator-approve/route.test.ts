import { vi } from "vitest";
import type { NextRequest } from "next/server";

/**
 * audit-2026-05-07 P199 + P200 — route-level coverage for the CSRF +
 * rate-limit sweep on /api/admin/allocator-approve. See
 * intro-request/route.test.ts for the full pattern rationale and the
 * v0.22.24.1 I5 helper refactor.
 */

vi.mock("server-only", () => ({}));

const TEST_USER = vi.hoisted(() => ({
  id: "00000000-0000-0000-0000-000000000126",
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
      rpc: async () => ({ data: null, error: null }),
      from: () => ({
        update: () => ({ eq: async () => ({ error: null }) }),
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
    }),
  }),
}));

import { runAdminPostCsrfRateLimitSuite } from "@/__tests__/helpers/adminPostCsrfRateLimit";

runAdminPostCsrfRateLimitSuite({
  path: "/api/admin/allocator-approve",
  pNumber: "P199 + P200",
  validBody: { id: "abc" },
  importRoute: async () => {
    const mod = await import("./route");
    return { POST: mod.POST as (req: NextRequest) => Promise<Response> };
  },
  supabaseCallCount: supabaseState,
});
