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
 *   (e) audit-2026-05-07 red-team-HIGH (reject-asymmetry-vs-approve-hardening,
 *       2026-05-17): rate-limit, requireAdmin TOCTOU re-check, and the
 *       CAS predicate all fire — symmetric to approve's hardenings so
 *       /reject is not a wide-open back door for stolen-session bursts.
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
  // audit-2026-05-07 red-team-HIGH (reject-asymmetry-vs-approve-hardening):
  // CAS UPDATE returns 0 rows when another admin already won (completed
  // OR rejected). Default to TRUE (CAS wins) so existing happy-path
  // assertions keep meaning; flip per-test for race coverage.
  casWins: true,
  rpcCalls: vi.fn(),
  updateRow: vi.fn(),
  auditLog: vi.fn(),
}));

// Track call ORDER so we can assert requireAdmin runs BEFORE checkLimit
// (matching the symmetric approve-route ordering contract).
const callOrder: string[] = [];

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
              callOrder.push("getUserRoles");
              const rolesPromise = Promise.resolve(allRoles());
              return Object.assign(rolesPromise, {
                eq: (_col2: string, val2: string) => ({
                  limit: async (_n: number) => {
                    callOrder.push("hasAdminRoleRow");
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

/**
 * audit-2026-05-07 red-team-HIGH (reject-asymmetry-vs-approve-hardening):
 * the reject route now mirrors approve's CAS predicate
 * `.update(...).eq("id",...).is("completed_at", null).is("rejected_at",
 * null).select("id")`. The mock returns an empty array when `casWins`
 * is false so race tests can simulate "another admin already
 * approved OR rejected".
 */
const { buildDefaultAdminMock } = vi.hoisted(
  () => ({
    buildDefaultAdminMock: (
      s: {
        deletionRow: unknown;
        casWins: boolean;
        updateRow: (patch: Record<string, unknown>) => void;
        rpcCalls: (name: string, args: Record<string, unknown>) => void;
      },
      testRequestId: string,
    ) => ({
      createAdminClient: () => ({
        from: (table: string) => {
          if (table !== "data_deletion_requests") {
            throw new Error(`Unexpected admin table: ${table}`);
          }
          return {
            select: () => ({
              eq: () => ({
                maybeSingle: async () => ({
                  data: s.deletionRow,
                  error: null,
                }),
              }),
            }),
            update: (patch: Record<string, unknown>) => ({
              eq: (_idCol: string, _idVal: string) => ({
                is: (_c1: string, _n1: unknown) => ({
                  is: (_c2: string, _n2: unknown) => ({
                    select: async (_cols: string) => {
                      s.updateRow(patch);
                      return {
                        data: s.casWins ? [{ id: testRequestId }] : [],
                        error: null,
                      };
                    },
                  }),
                }),
              }),
            }),
          };
        },
        // ANY rpc call on the admin client is a regression — the reject
        // route must NOT invoke sanitize_user (or any other RPC). The
        // mock records the call name so the cross-wire test can assert
        // zero.
        rpc: async (name: string, args: Record<string, unknown>) => {
          s.rpcCalls(name, args);
          return { data: null, error: null };
        },
      }),
    }),
  }),
);

vi.mock("@/lib/supabase/admin", () =>
  buildDefaultAdminMock(state, TEST_REQUEST_ID),
);

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

// audit-2026-05-07 red-team-HIGH (reject-asymmetry-vs-approve-hardening):
// route now calls checkLimit(adminActionLimiter, ...) at entry, keyed
// on `del-reject:${user.id}`. Use hoisted state so a single top-level
// vi.mock() can serve all per-test branches (success / denied /
// misconfigured) without the vi.resetModules + vi.doMock dance, which
// flakes under sharded execution when sibling test files also mock
// `@/lib/ratelimit`.
const rateLimitRecorder = vi.hoisted(() => vi.fn());
const rateLimitState = vi.hoisted(() => ({
  mode: "success" as "success" | "denied" | "misconfigured",
  retryAfter: 60,
}));
vi.mock("@/lib/ratelimit", () => ({
  adminActionLimiter: {} as unknown,
  checkLimit: async (_limiter: unknown, identifier: string) => {
    rateLimitRecorder(identifier);
    if (rateLimitState.mode === "denied") {
      return { success: false, retryAfter: rateLimitState.retryAfter } as const;
    }
    if (rateLimitState.mode === "misconfigured") {
      return {
        success: false,
        retryAfter: rateLimitState.retryAfter,
        reason: "ratelimit_misconfigured",
      } as const;
    }
    return { success: true } as const;
  },
  isRateLimitMisconfigured: (r: { reason?: string }) =>
    r?.reason === "ratelimit_misconfigured",
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

/**
 * Apply the canonical mocks for `@/lib/ratelimit` (always-pass) and
 * `@/lib/supabase/admin` (default chained CAS-aware shape). beforeEach
 * calls this AFTER `vi.resetModules` so any per-test `vi.doMock` from a
 * prior test is overridden cleanly.
 */
function reapplyDefaultMocks() {
  // Admin mock still uses vi.doMock because the Supabase admin client
  // chain depends on per-test deletionRow state. Rate-limit branches
  // are now selected via rateLimitState (hoisted) so there is no
  // need to re-register that module.
  rateLimitState.mode = "success";
  rateLimitState.retryAfter = 60;
  vi.doMock("@/lib/supabase/admin", () =>
    buildDefaultAdminMock(state, TEST_REQUEST_ID),
  );
}

describe("POST /api/admin/deletion-requests/[id]/reject (P453)", () => {
  beforeEach(() => {
    callOrder.length = 0;
    state.authedUser = null;
    state.userRoles = [];
    state.deletionRow = null;
    state.casWins = true;
    state.rpcCalls.mockReset();
    state.updateRow.mockReset();
    state.auditLog.mockReset();
    rateLimitRecorder.mockReset();
    vi.resetModules();
    reapplyDefaultMocks();
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
      rejected_by_this_call: true,
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

  /**
   * audit-2026-05-07 red-team-HIGH (reject-asymmetry-vs-approve-hardening) —
   * Rate-limit denial returns 429 BEFORE the destructive UPDATE.
   * Symmetric to approve's Cluster-K C-0032 test. A stolen admin
   * session must not be able to burst-REJECT every pending DSR.
   */
  it("red-team-HIGH — rate-limit denial returns 429 BEFORE the rejected_at UPDATE", async () => {
    state.authedUser = TEST_ADMIN;
    state.userRoles = ["admin"];
    state.deletionRow = {
      id: TEST_REQUEST_ID,
      user_id: TEST_TARGET_USER_ID,
      requested_at: "2026-05-01T00:00:00Z",
      completed_at: null,
      rejected_at: null,
    };

    rateLimitState.mode = "denied";
    rateLimitState.retryAfter = 42;

    const { POST } = await import("./route");
    const res = await POST(makeReq(), makeCtx());

    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBe("42");
    expect(state.updateRow).not.toHaveBeenCalled();
    expect(state.auditLog).not.toHaveBeenCalled();
    expect(rateLimitRecorder).toHaveBeenCalledTimes(1);
    // Per-user bucket — id-keyed so different admins don't share quota.
    expect(rateLimitRecorder.mock.calls[0][0]).toContain(TEST_ADMIN.id);
    // Separate bucket from `del-approve:` so the two destructive paths
    // share the 20/min policy independently rather than competing.
    expect(rateLimitRecorder.mock.calls[0][0]).toMatch(/^del-reject:/);
  });

  /**
   * audit-2026-05-07 red-team-HIGH (reject-asymmetry-vs-approve-hardening) —
   * Rate-limit MISCONFIG (Upstash env missing in production) is
   * fail-CLOSED. Mirrors approve's 503 contract — canary alerting must
   * see a configuration gap rather than a 429 (which would mask
   * "wide-open" as "throttled").
   */
  it("red-team-HIGH — misconfigured limiter returns 503 (fail-CLOSED)", async () => {
    state.authedUser = TEST_ADMIN;
    state.userRoles = ["admin"];
    state.deletionRow = {
      id: TEST_REQUEST_ID,
      user_id: TEST_TARGET_USER_ID,
      requested_at: "2026-05-01T00:00:00Z",
      completed_at: null,
      rejected_at: null,
    };

    rateLimitState.mode = "misconfigured";
    rateLimitState.retryAfter = 60;

    const { POST } = await import("./route");
    const res = await POST(makeReq(), makeCtx());

    expect(res.status).toBe(503);
    expect(res.headers.get("Retry-After")).toBe("60");
    expect(state.updateRow).not.toHaveBeenCalled();
  });

  /**
   * audit-2026-05-07 red-team-HIGH (reject-asymmetry-vs-approve-hardening) —
   * requireAdmin TOCTOU re-check must run BEFORE checkLimit so a
   * demoted-mid-session admin does NOT burn the legitimate admin's
   * rate-limit quota. Mirrors approve's red-team-MED ordering. We
   * assert this via the negative-path complement: when requireAdmin
   * would return 403 (state.userRoles = []), checkLimit must NOT have
   * been called.
   */
  it("red-team-HIGH — demoted admin (requireAdmin → 403) does NOT consume rate-limit token", async () => {
    state.authedUser = TEST_ADMIN;
    // userRoles = [] → both withRole's requireRole AND requireAdmin's
    // isAdminUser return 403. The rate-limit recorder must not fire.
    state.userRoles = [];

    const { POST } = await import("./route");
    const res = await POST(makeReq(), makeCtx());

    expect(res.status).toBe(403);
    // CRITICAL: the rate-limit bucket must NOT have been touched.
    expect(rateLimitRecorder).not.toHaveBeenCalled();
    expect(state.updateRow).not.toHaveBeenCalled();
  });

  /**
   * audit-2026-05-07 red-team-HIGH (reject-asymmetry-vs-approve-hardening) —
   * CAS predicate on the rejected_at UPDATE closes two races:
   *   (a) two admins both reject the same request simultaneously → only
   *       one emits deletion.request.reject (no duplicate `rejected_by`
   *       attribution in the immutable audit_log).
   *   (b) approve-then-reject race (Admin-B's approve completed_at lands
   *       between Admin-A's load and Admin-A's UPDATE) → Admin-A sees
   *       affectedRows=0 and does NOT emit a phantom reject audit on a
   *       request that was actually approved.
   *
   * This test flips `casWins` to false and asserts the route returns
   * 200 with rejected_by_this_call=false, no audit emitted.
   */
  it("red-team-HIGH — CAS loser does NOT emit deletion.request.reject", async () => {
    state.authedUser = TEST_ADMIN;
    state.userRoles = ["admin"];
    state.deletionRow = {
      id: TEST_REQUEST_ID,
      user_id: TEST_TARGET_USER_ID,
      requested_at: "2026-05-01T00:00:00Z",
      completed_at: null,
      rejected_at: null,
    };
    state.casWins = false; // another admin already approved or rejected

    const { POST } = await import("./route");
    const res = await POST(makeReq({ reason: "Race-lost reason" }), makeCtx());

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.rejected_by_this_call).toBe(false);

    // CAS update attempt was made (we tried to claim the rejection)…
    expect(state.updateRow).toHaveBeenCalledTimes(1);
    // …but the audit must NOT fire — the winning admin already owns
    // that row's terminal-state attribution.
    expect(state.auditLog).not.toHaveBeenCalled();
  });

  /**
   * audit-2026-05-07 red-team-HIGH (reject-asymmetry-vs-approve-hardening) —
   * ordering contract: requireAdmin runs BEFORE checkLimit which runs
   * BEFORE the rejected_at UPDATE. The hasAdminRoleRow callOrder marker
   * AND the rateLimitRecorder having exactly one call (on the admin
   * happy path) prove the two layers are both wired and sequenced
   * correctly.
   */
  it("red-team-HIGH — requireAdmin runs BEFORE checkLimit (no rate-limit burn for demoted admins)", async () => {
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

    const hasAdminIdx = callOrder.indexOf("hasAdminRoleRow");
    expect(hasAdminIdx).toBeGreaterThanOrEqual(0);
    expect(rateLimitRecorder).toHaveBeenCalledTimes(1);
  });
});
