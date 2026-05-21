import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

/**
 * audit-2026-05-07 C-0045 — route-level coverage for the match-engine
 * kill switch (POST /api/admin/match/kill-switch). Asserts:
 *
 *   1. CSRF — off-origin Origin header is rejected with 403 by
 *      `assertSameOrigin` BEFORE the auth check runs.
 *   2. AuthZ — authenticated-but-non-admin caller gets 403 (RFC 7235
 *      split: non-admin = forbidden, not unauthorized).
 *   3. Audit — admin success path emits `admin.kill_switch` with
 *      entity_type=`system_flag`, entity_id=acting admin id, and
 *      metadata `{ flag: "match_engine_enabled", new_value: <bool> }`.
 *
 * Mirrors the patterns from
 *   - decisions/route.test.ts (CSRF + auth split + admin gating)
 *   - allocator-approve/route.test.ts and partner-import/route.test.ts
 *     (audit emission capture via `logAuditEvent` mock).
 */

vi.mock("server-only", () => ({}));

const VALID_ORIGIN = { origin: "http://localhost:3000" };

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
    rpc: async () => ({ data: null, error: null }),
  }),
}));

vi.mock("@/lib/admin", () => ({
  isAdminUser: async () => adminFlag.isAdmin,
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: () => ({
      update: () => ({ eq: async () => ({ error: null }) }),
    }),
  }),
}));

const auditEmissions: Array<{
  action: string;
  entity_type: string;
  entity_id: string;
  metadata: Record<string, unknown>;
}> = [];

vi.mock("@/lib/audit", async () => {
  const actual = await vi.importActual<typeof import("@/lib/audit")>(
    "@/lib/audit",
  );
  return {
    ...actual,
    logAuditEvent: (
      _client: unknown,
      event: {
        action: string;
        entity_type: string;
        entity_id: string;
        metadata?: Record<string, unknown>;
      },
    ) => {
      auditEmissions.push({
        action: event.action,
        entity_type: event.entity_type,
        entity_id: event.entity_id,
        metadata: event.metadata ?? {},
      });
    },
  };
});

function makePostReq(
  body: unknown,
  headers: Record<string, string> = VALID_ORIGIN,
): NextRequest {
  return new NextRequest("http://localhost:3000/api/admin/match/kill-switch", {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
}

describe("POST /api/admin/match/kill-switch (C-0045)", () => {
  beforeEach(() => {
    userState.current = null;
    adminFlag.isAdmin = false;
    auditEmissions.length = 0;
    vi.resetModules();
  });

  it("rejects an off-origin request with 403 (CSRF guard)", async () => {
    // Authenticated admin — proves CSRF runs BEFORE the auth check.
    userState.current = { id: "admin-1" };
    adminFlag.isAdmin = true;

    const { POST } = await import("./route");
    const res = await POST(
      makePostReq(
        { enabled: false },
        { origin: "https://evil.example.com" },
      ),
    );

    expect(res.status).toBe(403);
    // No audit row should have been emitted — CSRF short-circuits.
    expect(auditEmissions).toHaveLength(0);
  });

  it("returns 403 when authenticated caller is not an admin", async () => {
    userState.current = { id: "user-1" };
    adminFlag.isAdmin = false;

    const { POST } = await import("./route");
    const res = await POST(makePostReq({ enabled: true }));

    expect(res.status).toBe(403);
    // Non-admin path must not produce an audit row.
    expect(auditEmissions).toHaveLength(0);
  });

  it("emits admin.kill_switch audit on admin success path", async () => {
    const adminId = "00000000-0000-0000-0000-0000000000aa";
    userState.current = { id: adminId };
    adminFlag.isAdmin = true;

    const { POST } = await import("./route");
    const res = await POST(makePostReq({ enabled: false }));

    expect(res.status).toBe(200);
    const json = (await res.json()) as { success: boolean; enabled: boolean };
    expect(json).toEqual({ success: true, enabled: false });

    expect(auditEmissions).toHaveLength(1);
    expect(auditEmissions[0]).toEqual({
      action: "admin.kill_switch",
      entity_type: "system_flag",
      // entity_id anchors to the acting admin's id (system_flags rows
      // are keyed by `key` text, no UUID to point at — see route comment).
      entity_id: adminId,
      metadata: { flag: "match_engine_enabled", new_value: false },
    });
  });
});
