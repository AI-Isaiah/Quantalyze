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

/**
 * M-0278 (testgap API2) — body-validation + GET-handler branches the
 * happy-path audit test never reaches. The kill switch is a
 * security-critical flag, so every guard deserves a test:
 *   - POST: 401 (null user), non-boolean body.enabled → 400, invalid JSON
 *     → 400, system_flags update error → 500 (+ no audit emitted).
 *   - GET:  401/403 split, 503 migration-011 hint when the select errors,
 *     and the enabled=true fallback when no row exists (data null).
 *
 * Uses vi.resetModules() + vi.doMock so the admin client can be tuned per
 * test (the module-level mock above only models the POST happy path).
 */
describe("kill-switch — M-0278 validation + GET branches", () => {
  beforeEach(() => {
    userState.current = null;
    adminFlag.isAdmin = false;
    auditEmissions.length = 0;
    vi.resetModules();
  });

  /** Admin client whose system_flags update resolves to `updateError`. */
  function mockAdminUpdate(updateError: { message: string } | null): void {
    vi.doMock("@/lib/supabase/admin", () => ({
      createAdminClient: () => ({
        from: () => ({
          update: () => ({ eq: async () => ({ error: updateError }) }),
        }),
      }),
    }));
  }

  /** Admin client whose system_flags select resolves to {data, error}. */
  function mockAdminSelect(
    data: { enabled: boolean; updated_at?: string } | null,
    error: { message: string } | null,
  ): void {
    vi.doMock("@/lib/supabase/admin", () => ({
      createAdminClient: () => ({
        from: () => ({
          select: () => ({
            eq: () => ({ maybeSingle: async () => ({ data, error }) }),
          }),
        }),
      }),
    }));
  }

  // ── POST validation ─────────────────────────────────────────────────
  it("POST returns 401 when there is no authenticated user", async () => {
    userState.current = null;
    mockAdminUpdate(null);
    const { POST } = await import("./route");
    const res = await POST(makePostReq({ enabled: true }));
    expect(res.status).toBe(401);
    expect(auditEmissions).toHaveLength(0);
  });

  it("POST returns 400 when body.enabled is not a boolean", async () => {
    userState.current = { id: "admin-1" };
    adminFlag.isAdmin = true;
    mockAdminUpdate(null);
    const { POST } = await import("./route");
    const res = await POST(makePostReq({ enabled: "yes" }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("enabled (boolean) required");
    // Validation failure must not flip the flag → no audit.
    expect(auditEmissions).toHaveLength(0);
  });

  it("POST returns 400 when body.enabled is missing entirely", async () => {
    userState.current = { id: "admin-1" };
    adminFlag.isAdmin = true;
    mockAdminUpdate(null);
    const { POST } = await import("./route");
    const res = await POST(makePostReq({}));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("enabled (boolean) required");
    expect(auditEmissions).toHaveLength(0);
  });

  it("POST returns 400 on invalid JSON body", async () => {
    userState.current = { id: "admin-1" };
    adminFlag.isAdmin = true;
    mockAdminUpdate(null);
    const { POST } = await import("./route");
    const req = new NextRequest(
      "http://localhost:3000/api/admin/match/kill-switch",
      { method: "POST", headers: VALID_ORIGIN, body: "{not json" },
    );
    const res = await POST(req);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("Invalid request body");
    expect(auditEmissions).toHaveLength(0);
  });

  it("POST returns 500 (no audit) when the system_flags update errors", async () => {
    userState.current = { id: "admin-1" };
    adminFlag.isAdmin = true;
    mockAdminUpdate({ message: "update conflict" });
    const { POST } = await import("./route");
    const res = await POST(makePostReq({ enabled: false }));
    expect(res.status).toBe(500);
    expect((await res.json()).error).toBe("Failed to update flag");
    // The flip failed at the DB → the audit row must NOT be emitted.
    expect(auditEmissions).toHaveLength(0);
  });

  // ── GET branches ────────────────────────────────────────────────────
  it("GET returns 401 when there is no authenticated user", async () => {
    userState.current = null;
    mockAdminSelect(null, null);
    const { GET } = await import("./route");
    const res = await GET();
    expect(res.status).toBe(401);
  });

  it("GET returns 403 when the authenticated caller is not an admin", async () => {
    userState.current = { id: "user-1" };
    adminFlag.isAdmin = false;
    mockAdminSelect(null, null);
    const { GET } = await import("./route");
    const res = await GET();
    expect(res.status).toBe(403);
  });

  it("GET returns 503 with the migration-011 hint when the system_flags select errors", async () => {
    userState.current = { id: "admin-1" };
    adminFlag.isAdmin = true;
    mockAdminSelect(null, { message: "relation system_flags does not exist" });
    const { GET } = await import("./route");
    const res = await GET();
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.error).toMatch(/migration 011/i);
  });

  it("GET falls back to enabled=true when no system_flags row exists (data null)", async () => {
    userState.current = { id: "admin-1" };
    adminFlag.isAdmin = true;
    mockAdminSelect(null, null);
    const { GET } = await import("./route");
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    // No row → the engine is treated as enabled (fail-open default).
    expect(body.enabled).toBe(true);
  });

  it("GET reflects the persisted enabled=false flag when a row exists", async () => {
    userState.current = { id: "admin-1" };
    adminFlag.isAdmin = true;
    mockAdminSelect({ enabled: false, updated_at: "2026-05-01T00:00:00Z" }, null);
    const { GET } = await import("./route");
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.enabled).toBe(false);
    expect(body.updated_at).toBe("2026-05-01T00:00:00Z");
  });
});
