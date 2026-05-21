import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

/**
 * audit-2026-05-07 C-0041 — defense-in-depth CSRF guard on a GET that
 * exposes allocator PII (display_name, email, company). Sibling
 * /api/admin/match/{decisions,kill-switch,send-intro,recompute} POST/DELETE
 * handlers all run assertSameOrigin. The GET here was the outlier: a
 * stolen-session or token-replay probe from an off-origin context could
 * read the entire allocator roster. The check now runs BEFORE auth so a
 * cross-origin probe doesn't even reach the admin-gate (also avoids the
 * timing oracle of "auth gate slow vs CSRF gate fast").
 */

vi.mock("server-only", () => ({}));

const userState = vi.hoisted<{ current: { id: string } | null }>(() => ({
  current: null,
}));
const adminFlag = vi.hoisted(() => ({ isAdmin: false }));

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

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: () => ({
      select: () => ({ in: async () => ({ data: [], error: null }) }),
    }),
  }),
}));

function makeReq(headers: Record<string, string>): NextRequest {
  return new NextRequest("http://localhost:3000/api/admin/match/allocators", {
    method: "GET",
    headers,
  });
}

describe("GET /api/admin/match/allocators — C-0041 same-origin guard", () => {
  beforeEach(() => {
    userState.current = { id: "admin-1" };
    adminFlag.isAdmin = true;
    vi.resetModules();
  });

  it("rejects requests missing Origin and Referer with 403 (pre-fix: leaked PII)", async () => {
    const { GET } = await import("./route");
    const res = await GET(makeReq({}));
    // Pre-fix: handler ran auth + returned the allocator list to anyone
    // whose session cookie was replayed. Post-fix: CSRF gate runs first
    // and rejects on missing Origin/Referer.
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toMatch(/Origin|Referer/i);
  });

  it("rejects requests with an off-origin Origin header with 403", async () => {
    const { GET } = await import("./route");
    const res = await GET(
      makeReq({ origin: "https://evil.example.com" }),
    );
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toMatch(/not allowed/i);
  });

  it("passes the CSRF gate when the Origin matches the allowlist (sanity)", async () => {
    const { GET } = await import("./route");
    const res = await GET(makeReq({ origin: "http://localhost:3000" }));
    // After the CSRF gate passes, the handler runs auth + DB. The mocked
    // admin returns an empty profile set → 200 with `allocators: []`.
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ allocators: [] });
  });
});
