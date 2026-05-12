import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

/**
 * audit-2026-05-07 review fix I4 (red-team conf 9) — route-level coverage
 * for the rate-limit added on top of the existing withRole CSRF + admin
 * guard. The narrow contract: a compromised admin session cannot spam
 * unbounded role grants — the route surfaces 429 once the bucket is
 * exhausted, BEFORE the user_app_roles mutation runs.
 *
 * Companion grep gate: src/__tests__/admin-csrf-ratelimit-grep.test.ts
 * (this route is now removed from RATE_LIMIT_EXEMPTIONS as the proof of
 * concept that the C1 fix's exemption list is closeable).
 */

vi.mock("server-only", () => ({}));

const VALID_ORIGIN = { origin: "http://localhost:3000" };

const TEST_ADMIN = vi.hoisted(() => ({
  id: "00000000-0000-0000-0000-000000000201",
  email: "admin@quantalyze.test",
}));

const upsertSpy = vi.hoisted(() => vi.fn());

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: {
      getUser: async () => ({ data: { user: TEST_ADMIN }, error: null }),
    },
    rpc: async () => ({ data: null, error: null }),
    from: (table: string) => {
      if (table === "user_app_roles") {
        return {
          select: () => ({
            eq: async () => ({
              data: [{ role: "admin" }],
              error: null,
            }),
          }),
        };
      }
      throw new Error(`Unexpected table on user client: ${table}`);
    },
  }),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: (table: string) => {
      if (table !== "user_app_roles") {
        throw new Error(`Unexpected table on admin client: ${table}`);
      }
      return {
        upsert: async (...args: unknown[]) => {
          upsertSpy(...args);
          return { error: null };
        },
        delete: () => ({
          eq: () => ({
            eq: async () => ({ error: null, count: 1 }),
          }),
        }),
      };
    },
  }),
}));

function makeReq(
  body: Record<string, unknown> = { action: "grant", role: "analyst" },
): NextRequest {
  return new NextRequest(
    "http://localhost:3000/api/admin/users/00000000-0000-0000-0000-000000000999/roles",
    {
      method: "POST",
      headers: VALID_ORIGIN,
      body: JSON.stringify(body),
    },
  );
}

function makeCtx() {
  return {
    params: Promise.resolve({ id: "00000000-0000-0000-0000-000000000999" }),
  };
}

describe("POST /api/admin/users/[id]/roles — rate limit (I4)", () => {
  beforeEach(() => {
    upsertSpy.mockClear();
    delete process.env.UPSTASH_REDIS_REST_URL;
    delete process.env.UPSTASH_REDIS_REST_TOKEN;
    vi.resetModules();
  });

  it("surfaces 429 with Retry-After when adminActionLimiter denies", async () => {
    vi.doMock("@/lib/ratelimit", async () => {
      const actual = await vi.importActual<typeof import("@/lib/ratelimit")>(
        "@/lib/ratelimit",
      );
      return {
        ...actual,
        checkLimit: async () => ({ success: false, retryAfter: 23 }),
      };
    });
    const { POST } = await import("./route");
    const res = await POST(makeReq(), makeCtx());

    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBe("23");
    // The mutation must NOT have run — the gate sits BEFORE the upsert.
    expect(upsertSpy).not.toHaveBeenCalled();
  });

  it("denies all 100 of 100 rapid requests when bucket is exhausted", async () => {
    // Tightened from the prior `denied > 0` (I3): with the mock denying
    // every call, ALL 100 must come back 429 — anything less means the
    // route bypassed the gate at least once.
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
      const res = await POST(makeReq(), makeCtx());
      statuses.push(res.status);
    }
    const denied = statuses.filter((s) => s === 429).length;
    expect(denied).toBe(100);
    expect(upsertSpy).not.toHaveBeenCalled();
  });
});
