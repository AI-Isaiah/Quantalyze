import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

/**
 * P453 (audit-2026-05-07) — coverage for POST
 * /api/admin/deletion-requests/[id]/reject. The route marks the DSR
 * row `rejected_at = now()` with an optional reason and emits a single
 * audit event. CRITICALLY it must NEVER invoke sanitize_user (that path
 * belongs to /approve).
 *
 * Coverage contract:
 *   (a) unauthenticated callers → 401 (withRole wrapper)
 *   (b) authenticated non-admin → 403 (withRole wrapper)
 *   (c) admin happy path → 200 + DSR row updated to rejected + audit log
 *   (d) sanitize_user RPC is NEVER called from this route under any
 *       scenario (anti-cross-wire test)
 */

vi.mock("server-only", () => ({}));

const VALID_ORIGIN = { origin: "http://localhost:3000" };

const TEST_ADMIN = vi.hoisted(() => ({
  id: "00000000-0000-0000-0000-000000000201",
  email: "admin@quantalyze.test",
}));
const TEST_REQUEST_ID = "11111111-1111-1111-1111-111111111111";
const TEST_TARGET_USER_ID = "22222222-2222-2222-2222-222222222222";

const state = vi.hoisted(() => ({
  authedUser: null as null | { id: string; email?: string },
  userRoles: [] as string[],
  deletionRow: null as null | {
    id: string;
    user_id: string;
    requested_at: string;
    completed_at: string | null;
    rejected_at: string | null;
  },
  rpcCalls: vi.fn(),
  updateRow: vi.fn(),
  auditLog: vi.fn(),
}));

/**
 * audit-2026-05-07 P459 + P699 + P703: `requireRole("admin")` falls back to
 * `isAdminUser` (the unified union) when user_app_roles misses, which chains
 * `.eq("user_id", id).eq("role", "admin").limit(1)` AND reads
 * `profiles.is_admin`. Mock both shapes so the negative path (non-admin
 * caller) returns cleanly instead of throwing on an unmocked chain.
 */
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: {
      getUser: async () => ({
        data: { user: state.authedUser },
        error: null,
      }),
    },
    from: (table: string) => {
      if (table === "user_app_roles") {
        const allRoles = () => ({
          data: state.userRoles.map((r) => ({ role: r })),
          error: null,
        });
        return {
          select: () => ({
            eq: (_col1: string, _val1: string) => {
              const rolesPromise = Promise.resolve(allRoles());
              return Object.assign(rolesPromise, {
                eq: (_col2: string, val2: string) => ({
                  limit: async (_n: number) => {
                    const filtered = state.userRoles
                      .filter((r) => r === val2)
                      .map((r) => ({ role: r }));
                    return { data: filtered, error: null };
                  },
                }),
              });
            },
          }),
        };
      }
      if (table === "profiles") {
        return {
          select: () => ({
            eq: () => ({
              single: async () => ({
                data: { is_admin: false },
                error: null,
              }),
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
      if (table !== "data_deletion_requests") {
        throw new Error(`Unexpected admin table: ${table}`);
      }
      return {
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({
              data: state.deletionRow,
              error: null,
            }),
          }),
        }),
        update: (patch: Record<string, unknown>) => ({
          eq: async () => {
            state.updateRow(patch);
            return { error: null };
          },
        }),
      };
    },
    // ANY rpc call on the admin client is a regression — the reject
    // route must NOT invoke sanitize_user (or any other RPC). The mock
    // records the call name so the cross-wire test can assert zero.
    rpc: async (name: string, args: Record<string, unknown>) => {
      state.rpcCalls(name, args);
      return { data: null, error: null };
    },
  }),
}));

vi.mock("@/lib/audit", () => ({
  logAuditEvent: (
    _supabase: unknown,
    event: { action: string; entity_id: string; metadata?: unknown },
  ) => {
    state.auditLog(event);
  },
}));

vi.mock("@/lib/csrf", () => ({
  assertSameOrigin: () => null,
}));

function makeReq(body: Record<string, unknown> = {}): NextRequest {
  return new NextRequest(
    `http://localhost:3000/api/admin/deletion-requests/${TEST_REQUEST_ID}/reject`,
    {
      method: "POST",
      headers: VALID_ORIGIN,
      body: JSON.stringify(body),
    },
  );
}

function makeCtx() {
  return { params: Promise.resolve({ id: TEST_REQUEST_ID }) };
}

describe("POST /api/admin/deletion-requests/[id]/reject (P453)", () => {
  beforeEach(() => {
    state.authedUser = null;
    state.userRoles = [];
    state.deletionRow = null;
    state.rpcCalls.mockReset();
    state.updateRow.mockReset();
    state.auditLog.mockReset();
    vi.resetModules();
  });

  it("returns 401 when unauthenticated", async () => {
    state.authedUser = null;

    const { POST } = await import("./route");
    const res = await POST(makeReq(), makeCtx());

    expect(res.status).toBe(401);
    expect(state.updateRow).not.toHaveBeenCalled();
    expect(state.auditLog).not.toHaveBeenCalled();
    expect(state.rpcCalls).not.toHaveBeenCalled();
  });

  it("returns 403 when authenticated user lacks admin role", async () => {
    state.authedUser = { id: "0000-non-admin", email: "x@example.test" };
    state.userRoles = ["allocator"];

    const { POST } = await import("./route");
    const res = await POST(makeReq(), makeCtx());

    expect(res.status).toBe(403);
    expect(state.updateRow).not.toHaveBeenCalled();
    expect(state.auditLog).not.toHaveBeenCalled();
    expect(state.rpcCalls).not.toHaveBeenCalled();
  });

  it("admin happy path: 200 + row updated with rejected_at + audit event", async () => {
    state.authedUser = TEST_ADMIN;
    state.userRoles = ["admin"];
    state.deletionRow = {
      id: TEST_REQUEST_ID,
      user_id: TEST_TARGET_USER_ID,
      requested_at: "2026-05-01T00:00:00Z",
      completed_at: null,
      rejected_at: null,
    };

    const { POST } = await import("./route");
    const res = await POST(makeReq({ reason: "Duplicate request" }), makeCtx());

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({
      success: true,
      request_id: TEST_REQUEST_ID,
      target_user_id: TEST_TARGET_USER_ID,
    });

    expect(state.updateRow).toHaveBeenCalledTimes(1);
    const patch = state.updateRow.mock.calls[0][0] as Record<string, unknown>;
    expect(typeof patch.rejected_at).toBe("string");
    expect(patch.rejection_reason).toBe("Duplicate request");

    expect(state.auditLog).toHaveBeenCalledTimes(1);
    const event = state.auditLog.mock.calls[0][0] as { action: string };
    expect(event.action).toBe("deletion.request.reject");
  });

  it("P453 anti-cross-wire — sanitize_user RPC is NEVER invoked on this route", async () => {
    // Even on the happy path, the reject route must not touch the
    // sanitize_user RPC (that's /approve's job). A regression that
    // wired them together would be an unrecoverable data-loss bug.
    state.authedUser = TEST_ADMIN;
    state.userRoles = ["admin"];
    state.deletionRow = {
      id: TEST_REQUEST_ID,
      user_id: TEST_TARGET_USER_ID,
      requested_at: "2026-05-01T00:00:00Z",
      completed_at: null,
      rejected_at: null,
    };

    const { POST } = await import("./route");
    await POST(makeReq(), makeCtx());

    // Zero rpc calls on the admin client. The fn captures (name, args)
    // pairs; if anyone wires in `sanitize_user`, this fails immediately.
    expect(state.rpcCalls).not.toHaveBeenCalled();
  });
});
