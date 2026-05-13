import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

/**
 * P452 (audit-2026-05-07) — coverage for POST
 * /api/admin/deletion-requests/[id]/approve. The route is the
 * irreversible-anonymization path: it invokes the `sanitize_user` RPC
 * via the service-role admin client, marks the data_deletion_requests
 * row completed, and emits TWO audit events (deletion.request.approve
 * + account.sanitize).
 *
 * Coverage contract:
 *   (a) unauthenticated callers → 401 (withRole wrapper)
 *   (b) authenticated non-admin → 403 (withRole wrapper)
 *   (c) admin happy path → 200 + sanitize_user RPC called + audit logs
 *   (d) the admin-role recheck inside withRole fires BEFORE the RPC, so
 *       a request that fails authz never reaches the irreversible
 *       sanitize_user call (the audit-2026-05-07 / Lane F TOCTOU close).
 */

vi.mock("server-only", () => ({}));

const VALID_ORIGIN = { origin: "http://localhost:3000" };

const TEST_ADMIN = vi.hoisted(() => ({
  id: "00000000-0000-0000-0000-000000000201",
  email: "admin@quantalyze.test",
}));
const TEST_REQUEST_ID = "11111111-1111-1111-1111-111111111111";
const TEST_TARGET_USER_ID = "22222222-2222-2222-2222-222222222222";

// Hoisted mock state — flipped per test.
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
  sanitizeRpc: vi.fn(),
  updateCompleted: vi.fn(),
  auditLog: vi.fn(),
}));

// Track call ORDER so we can assert requireRole (and thus the rate-limit
// + role-gate) runs BEFORE sanitize_user.
const callOrder: string[] = [];

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
        return {
          select: () => ({
            eq: async () => {
              callOrder.push("getUserRoles");
              return {
                data: state.userRoles.map((r) => ({ role: r })),
                error: null,
              };
            },
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
            state.updateCompleted(patch);
            return { error: null };
          },
        }),
      };
    },
    rpc: async (name: string, args: Record<string, unknown>) => {
      callOrder.push(`rpc:${name}`);
      state.sanitizeRpc(name, args);
      return { data: true, error: null };
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

function makeReq(): NextRequest {
  return new NextRequest(
    `http://localhost:3000/api/admin/deletion-requests/${TEST_REQUEST_ID}/approve`,
    {
      method: "POST",
      headers: VALID_ORIGIN,
      body: JSON.stringify({}),
    },
  );
}

function makeCtx() {
  return { params: Promise.resolve({ id: TEST_REQUEST_ID }) };
}

describe("POST /api/admin/deletion-requests/[id]/approve (P452)", () => {
  beforeEach(() => {
    callOrder.length = 0;
    state.authedUser = null;
    state.userRoles = [];
    state.deletionRow = null;
    state.sanitizeRpc.mockReset();
    state.updateCompleted.mockReset();
    state.auditLog.mockReset();
    vi.resetModules();
  });

  it("returns 401 when unauthenticated", async () => {
    state.authedUser = null;
    state.userRoles = [];

    const { POST } = await import("./route");
    const res = await POST(makeReq(), makeCtx());

    expect(res.status).toBe(401);
    // The irreversible RPC must NOT have run.
    expect(state.sanitizeRpc).not.toHaveBeenCalled();
    expect(state.auditLog).not.toHaveBeenCalled();
  });

  it("returns 403 when authenticated user lacks admin role", async () => {
    state.authedUser = { id: "0000-non-admin", email: "x@example.test" };
    state.userRoles = ["allocator"]; // not admin

    const { POST } = await import("./route");
    const res = await POST(makeReq(), makeCtx());

    expect(res.status).toBe(403);
    // Critical: a non-admin caller must not trigger sanitize_user.
    expect(state.sanitizeRpc).not.toHaveBeenCalled();
    expect(state.auditLog).not.toHaveBeenCalled();
  });

  it("admin happy path: 200, sanitize_user invoked, both audit events emitted", async () => {
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
    const res = await POST(makeReq(), makeCtx());

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({
      success: true,
      request_id: TEST_REQUEST_ID,
      target_user_id: TEST_TARGET_USER_ID,
    });

    expect(state.sanitizeRpc).toHaveBeenCalledTimes(1);
    expect(state.sanitizeRpc).toHaveBeenCalledWith("sanitize_user", {
      p_user_id: TEST_TARGET_USER_ID,
    });
    expect(state.updateCompleted).toHaveBeenCalledTimes(1);

    // TWO audit events: deletion.request.approve + account.sanitize.
    const actions = state.auditLog.mock.calls.map(
      (call) => (call[0] as { action: string }).action,
    );
    expect(actions).toContain("deletion.request.approve");
    expect(actions).toContain("account.sanitize");
  });

  it("Lane F TOCTOU close — admin role gate fires BEFORE sanitize_user RPC", async () => {
    // The withRole wrapper calls requireRole → getUserRoles BEFORE the
    // handler body runs sanitize_user. callOrder records the literal
    // sequence; an inversion would mean a forbidden caller could still
    // trigger the irreversible RPC.
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

    const roleCheckIdx = callOrder.indexOf("getUserRoles");
    const rpcIdx = callOrder.indexOf("rpc:sanitize_user");
    expect(roleCheckIdx).toBeGreaterThanOrEqual(0);
    expect(rpcIdx).toBeGreaterThanOrEqual(0);
    expect(roleCheckIdx).toBeLessThan(rpcIdx);
  });
});
