import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

/**
 * audit-2026-05-07 P199 + P200 — route-level coverage for the CSRF +
 * rate-limit sweep on /api/admin/allocator-approve. See intro-request/route.test.ts
 * for the full pattern rationale.
 */

vi.mock("server-only", () => ({}));

const VALID_ORIGIN = { origin: "http://localhost:3000" };

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

describe("POST /api/admin/allocator-approve", () => {
  beforeEach(() => {
    supabaseState.callCount = 0;
    delete process.env.UPSTASH_REDIS_REST_URL;
    delete process.env.UPSTASH_REDIS_REST_TOKEN;
    vi.resetModules();
  });

  describe("CSRF (P199 + P200)", () => {
    it("returns 403 when no Origin or Referer header is present", async () => {
      const { POST } = await import("./route");
      const req = new NextRequest(
        "http://localhost:3000/api/admin/allocator-approve",
        {
          method: "POST",
          body: JSON.stringify({ id: "abc" }),
        },
      );
      const res = await POST(req);
      expect(res.status).toBe(403);
      expect(supabaseState.callCount).toBe(0);
    });

    it("returns 403 when Origin host is not in the allowlist", async () => {
      const { POST } = await import("./route");
      const req = new NextRequest(
        "http://localhost:3000/api/admin/allocator-approve",
        {
          method: "POST",
          headers: { origin: "https://evil.example.com" },
          body: JSON.stringify({ id: "abc" }),
        },
      );
      const res = await POST(req);
      expect(res.status).toBe(403);
      expect(supabaseState.callCount).toBe(0);
    });
  });

  describe("rate limit (P199)", () => {
    it("at least one of 100 rapid requests as the same user is rate-limited", async () => {
      // Simulate an exhausted bucket — see strategy-review/route.test.ts
      // for the rationale on denying every call rather than modelling a
      // first-20-succeed bucket.
      vi.doMock("@/lib/ratelimit", async () => {
        const actual = await vi.importActual<typeof import("@/lib/ratelimit")>(
          "@/lib/ratelimit",
        );
        return {
          ...actual,
          checkLimit: async () => ({ success: false, retryAfter: 60 }),
        };
      });
      const { POST } = await import("./route");
      const statuses: number[] = [];
      for (let i = 0; i < 100; i++) {
        const req = new NextRequest(
          "http://localhost:3000/api/admin/allocator-approve",
          {
            method: "POST",
            headers: VALID_ORIGIN,
            body: JSON.stringify({ id: "abc" }),
          },
        );
        const res = await POST(req);
        statuses.push(res.status);
      }
      const denied = statuses.filter((s) => s === 429).length;
      // Review-fix v0.22.24.1 (I3): tightened from `denied > 0`. With the
      // mock denying every call, ALL 100 must come back 429 — anything
      // less means the route bypassed the gate at least once.
      expect(denied).toBe(100);
    });
  });
});
