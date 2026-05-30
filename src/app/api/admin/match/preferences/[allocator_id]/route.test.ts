import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

/**
 * C-0046 (audit-2026-05-07) — route-level coverage for PUT
 * /api/admin/match/preferences/[allocator_id].
 *
 * The route lets an admin edit another allocator's preference mandate
 * (self-editable + admin-only fields). Coverage contract:
 *   (a) CSRF guard via `assertSameOrigin` — missing/invalid Origin → 403
 *   (b) authenticated non-admin → 403, with NO upsert + NO audit emission
 *   (c) admin happy path → 200, upsert wired to the right user_id, and the
 *       `mandate_preference.admin_update` audit row carries
 *       `metadata.self_edit === false` + `edited_by === user.id` per the
 *       ADR-0023 taxonomy.
 *
 * Note: this route is admin-only — the `self_edit=true` branch lives on
 * /api/preferences (the allocator's own self-edit endpoint). It is
 * intentionally NOT covered here; see that route's co-located tests.
 */

vi.mock("server-only", () => ({}));

const VALID_ORIGIN = { origin: "http://localhost:3000" };

const TEST_ADMIN = vi.hoisted(() => ({
  id: "00000000-0000-0000-0000-000000000901",
  email: "admin@quantalyze.test",
}));

const TEST_ALLOCATOR_ID = "11111111-1111-1111-1111-111111111111";

const state = vi.hoisted(() => ({
  authedUser: null as null | { id: string; email?: string },
  isAdmin: false,
  upsertCalls: vi.fn<(row: Record<string, unknown>) => void>(),
  profilesUpdate: vi.fn<(patch: Record<string, unknown>, id: string) => void>(),
  auditLog: vi.fn<(event: Record<string, unknown>) => void>(),
  upsertError: null as null | { message: string },
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: {
      getUser: async () => ({
        data: { user: state.authedUser },
        error: null,
      }),
    },
  }),
}));

vi.mock("@/lib/admin", () => ({
  isAdminUser: async () => state.isAdmin,
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: (table: string) => {
      if (table === "allocator_preferences") {
        return {
          upsert: async (
            row: Record<string, unknown>,
            _opts: Record<string, unknown>,
          ) => {
            state.upsertCalls(row);
            return { error: state.upsertError };
          },
        };
      }
      if (table === "profiles") {
        return {
          update: (patch: Record<string, unknown>) => ({
            eq: async (_col: string, id: string) => {
              state.profilesUpdate(patch, id);
              return { error: null };
            },
          }),
        };
      }
      throw new Error(`Unexpected admin table: ${table}`);
    },
  }),
}));

vi.mock("@/lib/audit", () => ({
  logAuditEvent: (
    _client: unknown,
    event: Record<string, unknown>,
  ) => {
    state.auditLog(event);
  },
  // B4b: the admin mandate audit now emits via the service path
  // (log_audit_event_service — JWT-immune) with the explicit acting-admin id;
  // forward the event so the existing state.auditLog assertions still hold.
  logAuditEventAsUser: (
    _admin: unknown,
    _actingUserId: string,
    event: Record<string, unknown>,
  ) => {
    state.auditLog(event);
  },
}));

function makeReq(body: Record<string, unknown> = {}, headers = VALID_ORIGIN): NextRequest {
  return new NextRequest(
    `http://localhost:3000/api/admin/match/preferences/${TEST_ALLOCATOR_ID}`,
    {
      method: "PUT",
      headers,
      body: JSON.stringify(body),
    },
  );
}

function makeCtx() {
  return { params: Promise.resolve({ allocator_id: TEST_ALLOCATOR_ID }) };
}

describe("PUT /api/admin/match/preferences/[allocator_id] (C-0046)", () => {
  beforeEach(() => {
    state.authedUser = null;
    state.isAdmin = false;
    state.upsertError = null;
    state.upsertCalls.mockReset();
    state.profilesUpdate.mockReset();
    state.auditLog.mockReset();
  });

  it("returns 403 when the Origin header is missing (CSRF guard)", async () => {
    state.authedUser = TEST_ADMIN;
    state.isAdmin = true;

    const { PUT } = await import("./route");
    const req = new NextRequest(
      `http://localhost:3000/api/admin/match/preferences/${TEST_ALLOCATOR_ID}`,
      {
        method: "PUT",
        // No origin/referer at all — assertSameOrigin must 403.
        body: JSON.stringify({ founder_notes: "blocked by csrf" }),
      },
    );
    const res = await PUT(req, makeCtx());

    expect(res.status).toBe(403);
    // No mutation + no audit when the CSRF guard fires.
    expect(state.upsertCalls).not.toHaveBeenCalled();
    expect(state.auditLog).not.toHaveBeenCalled();
  });

  it("returns 401 when unauthenticated", async () => {
    state.authedUser = null;
    state.isAdmin = false;

    const { PUT } = await import("./route");
    const res = await PUT(makeReq({ founder_notes: "x" }), makeCtx());

    expect(res.status).toBe(401);
    expect(state.upsertCalls).not.toHaveBeenCalled();
    expect(state.auditLog).not.toHaveBeenCalled();
  });

  it("returns 403 when authenticated caller is not an admin", async () => {
    state.authedUser = { id: "non-admin-user", email: "x@example.test" };
    state.isAdmin = false;

    const { PUT } = await import("./route");
    const res = await PUT(makeReq({ founder_notes: "x" }), makeCtx());

    expect(res.status).toBe(403);
    // Critical: a non-admin caller must not write OR audit-emit.
    expect(state.upsertCalls).not.toHaveBeenCalled();
    expect(state.auditLog).not.toHaveBeenCalled();
  });

  it("admin happy path: 200 + audit with self_edit=false + edited_by=user.id", async () => {
    state.authedUser = TEST_ADMIN;
    state.isAdmin = true;

    const { PUT } = await import("./route");
    const res = await PUT(
      makeReq({
        founder_notes: "promising mandate",
        min_sharpe: 1.0,
        // also exercise a self-editable field on the admin path
        mandate_archetype: "diversified crypto SMA",
      }),
      makeCtx(),
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ success: true });

    // Upsert targeted the right allocator and tagged the editor.
    expect(state.upsertCalls).toHaveBeenCalledTimes(1);
    const row = state.upsertCalls.mock.calls[0][0];
    expect(row.user_id).toBe(TEST_ALLOCATOR_ID);
    expect(row.edited_by_user_id).toBe(TEST_ADMIN.id);
    expect(row.founder_notes).toBe("promising mandate");
    expect(row.min_sharpe).toBe(1.0);
    expect(row.mandate_archetype).toBe("diversified crypto SMA");

    // Exactly one audit row — mandate_preference.admin_update — with the
    // ADR-0023 metadata contract: self_edit:false + edited_by:user.id.
    expect(state.auditLog).toHaveBeenCalledTimes(1);
    const event = state.auditLog.mock.calls[0][0] as {
      action: string;
      entity_type: string;
      entity_id: string;
      metadata: Record<string, unknown>;
    };
    expect(event.action).toBe("mandate_preference.admin_update");
    expect(event.entity_type).toBe("allocator_preference_mandate");
    expect(event.entity_id).toBe(TEST_ALLOCATOR_ID);
    expect(event.metadata.self_edit).toBe(false);
    expect(event.metadata.edited_by).toBe(TEST_ADMIN.id);
    // The `fields` list mirrors the body keys the admin actually wrote.
    expect(Array.isArray(event.metadata.fields)).toBe(true);
    expect(event.metadata.fields as string[]).toEqual(
      expect.arrayContaining([
        "founder_notes",
        "min_sharpe",
        "mandate_archetype",
      ]),
    );

    // The profiles preferences_updated_at touch fired on the same allocator.
    expect(state.profilesUpdate).toHaveBeenCalledTimes(1);
    expect(state.profilesUpdate.mock.calls[0][1]).toBe(TEST_ALLOCATOR_ID);
  });

  it("returns 400 on validation failure (non-string founder_notes) — no audit", async () => {
    state.authedUser = TEST_ADMIN;
    state.isAdmin = true;

    const { PUT } = await import("./route");
    const res = await PUT(
      // founder_notes must be a string per validateAdminEditableInput.
      makeReq({ founder_notes: 12345 }),
      makeCtx(),
    );

    expect(res.status).toBe(400);
    expect(state.upsertCalls).not.toHaveBeenCalled();
    // Validation failures must NOT emit an audit row — there's no
    // forensic event to anchor to (no mutation attempted).
    expect(state.auditLog).not.toHaveBeenCalled();
  });

  it("returns 500 + no audit when the upsert errors", async () => {
    state.authedUser = TEST_ADMIN;
    state.isAdmin = true;
    state.upsertError = { message: "db down" };

    const { PUT } = await import("./route");
    const res = await PUT(makeReq({ founder_notes: "x" }), makeCtx());

    expect(res.status).toBe(500);
    expect(state.upsertCalls).toHaveBeenCalledTimes(1);
    // No mutation → no audit row.
    expect(state.auditLog).not.toHaveBeenCalled();
  });
});
