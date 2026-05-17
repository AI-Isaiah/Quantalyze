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
  // Cluster-K (audit-2026-05-07): CAS UPDATE returns 0 rows when
  // another admin already won the race (completed_at IS NOT NULL at
  // UPDATE time). Default to TRUE (CAS wins) so the existing happy-path
  // assertions keep their meaning; flip per-test for race coverage.
  casWins: true,
  sanitizeRpc: vi.fn(),
  updateCompleted: vi.fn(),
  auditLog: vi.fn(),
}));

// Track call ORDER so we can assert requireRole (and thus the rate-limit
// + role-gate) runs BEFORE sanitize_user.
const callOrder: string[] = [];

/**
 * Lane F (audit-2026-05-07 P705) wired `requireAdmin(supabase, user)` into
 * the approve route immediately before the sanitize_user RPC. `requireAdmin`
 * calls `isAdminUser` which OR's THREE signals:
 *   1. `user_app_roles.select("role").eq("user_id", id).eq("role","admin").limit(1)`
 *   2. `profiles.select("is_admin").eq("id", id).single()`
 *   3. ADMIN_EMAIL env-fallback (not exercised here)
 *
 * `withRole("admin")` also calls `requireRole` which does the user_app_roles
 * SELECT-by-user_id (no `.eq("role")` chain) and only falls into the
 * isAdminUser union when the user_app_roles read misses. We support BOTH
 * shapes — single-eq for `requireRole`, double-eq + limit for
 * `hasAdminRoleRow` — and we also handle the `profiles` table fallback so
 * the negative path returns cleanly instead of throwing on an unmocked
 * chain.
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
              // Attach the chained `.eq().limit()` shape used by
              // `hasAdminRoleRow` so an `await` on the bare `.eq()` resolves
              // to the full role set (requireRole / getUserRoles path),
              // while the chained `.eq(...).limit(1)` resolves to a filtered
              // single-role match (isAdminUser fallback path).
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
        // Lane F: `hasIsAdminFlag` reads profiles.is_admin under the
        // isAdminUser union. Return `false` so non-admin callers stay
        // forbidden; admin callers already pass via user_app_roles.
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
        // Cluster-K (audit-2026-05-07): the approve route now does a
        // compare-and-swap `.update(...).eq("id",...).is("completed_at",
        // null).select("id")` to close the C-0033 / H-0217 double-audit
        // race. The mock returns an empty array when `casWins` is false
        // so race tests can simulate "another admin already approved".
        update: (patch: Record<string, unknown>) => ({
          eq: (_idCol: string, _idVal: string) => ({
            is: (_completedCol: string, _nullSentinel: unknown) => ({
              select: async (_cols: string) => {
                state.updateCompleted(patch);
                return {
                  data: state.casWins ? [{ id: TEST_REQUEST_ID }] : [],
                  error: null,
                };
              },
            }),
          }),
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

// Cluster-K C-0032: route now calls checkLimit(adminActionLimiter, ...)
// at entry. In non-production with no Upstash env, the real limiter
// fails OPEN — but vitest sometimes synthesizes VERCEL_ENV in fixtures,
// so mock the module to always return success and surface a per-call
// recorder for the rate-limit test.
const rateLimitRecorder = vi.hoisted(() => vi.fn());
vi.mock("@/lib/ratelimit", () => ({
  adminActionLimiter: {} as unknown,
  checkLimit: async (_limiter: unknown, identifier: string) => {
    rateLimitRecorder(identifier);
    return { success: true } as const;
  },
  isRateLimitMisconfigured: () => false,
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

/**
 * Apply the canonical mocks for `@/lib/ratelimit` (always-pass) and
 * `@/lib/supabase/admin` (default chained CAS-aware shape). beforeEach
 * calls this AFTER `vi.resetModules` so any per-test `vi.doMock` from a
 * prior test is overridden cleanly. Vitest does NOT auto-restore the
 * hoisted `vi.mock` declarations after `vi.doMock` overrides them, so
 * we re-install them explicitly here.
 */
function reapplyDefaultMocks() {
  vi.doMock("@/lib/ratelimit", () => ({
    adminActionLimiter: {} as unknown,
    checkLimit: async (_limiter: unknown, identifier: string) => {
      rateLimitRecorder(identifier);
      return { success: true } as const;
    },
    isRateLimitMisconfigured: () => false,
  }));
  vi.doMock("@/lib/supabase/admin", () => ({
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
            eq: (_idCol: string, _idVal: string) => ({
              is: (_completedCol: string, _nullSentinel: unknown) => ({
                select: async (_cols: string) => {
                  state.updateCompleted(patch);
                  return {
                    data: state.casWins ? [{ id: TEST_REQUEST_ID }] : [],
                    error: null,
                  };
                },
              }),
            }),
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
}

describe("POST /api/admin/deletion-requests/[id]/approve (P452)", () => {
  beforeEach(() => {
    callOrder.length = 0;
    state.authedUser = null;
    state.userRoles = [];
    state.deletionRow = null;
    state.casWins = true;
    state.sanitizeRpc.mockReset();
    state.updateCompleted.mockReset();
    state.auditLog.mockReset();
    rateLimitRecorder.mockReset();
    vi.resetModules();
    reapplyDefaultMocks();
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

  /**
   * Cluster-K C-0032 — GDPR Art. 17 approve must be rate-limited so a
   * stolen admin session cannot fire hundreds of sanitize_user calls in
   * a burst. The limiter call must happen BEFORE the irreversible RPC,
   * and must key on the admin user id (not IP) so a single compromised
   * account can't rotate IPs to defeat the cap.
   *
   * This test re-mocks `@/lib/ratelimit` to return a denial and asserts:
   *   - response status 429
   *   - sanitize_user RPC NEVER invoked
   *   - audit log NEVER written
   *   - the limit identifier carries the admin user id prefix
   */
  it("Cluster-K C-0032 — rate-limit denial returns 429 BEFORE sanitize_user", async () => {
    state.authedUser = TEST_ADMIN;
    state.userRoles = ["admin"];
    state.deletionRow = {
      id: TEST_REQUEST_ID,
      user_id: TEST_TARGET_USER_ID,
      requested_at: "2026-05-01T00:00:00Z",
      completed_at: null,
      rejected_at: null,
    };

    // Replace the rate-limit module just for this test with a denial.
    vi.resetModules();
    vi.doMock("@/lib/ratelimit", () => ({
      adminActionLimiter: {} as unknown,
      checkLimit: async (_l: unknown, identifier: string) => {
        rateLimitRecorder(identifier);
        return { success: false, retryAfter: 42 } as const;
      },
      isRateLimitMisconfigured: () => false,
    }));

    const { POST } = await import("./route");
    const res = await POST(makeReq(), makeCtx());

    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBe("42");
    expect(state.sanitizeRpc).not.toHaveBeenCalled();
    expect(state.auditLog).not.toHaveBeenCalled();
    // Identifier must include the acting admin's user id so per-user
    // bucketing works (and a different admin's burst doesn't blow this
    // one's quota).
    expect(rateLimitRecorder).toHaveBeenCalledTimes(1);
    expect(rateLimitRecorder.mock.calls[0][0]).toContain(TEST_ADMIN.id);
    expect(rateLimitRecorder.mock.calls[0][0]).toMatch(/^del-approve:/);

  });

  /**
   * Cluster-K C-0032 — rate-limit MISCONFIG (Upstash env missing in
   * production) is fail-CLOSED on the destructive approve path. We map
   * `{success:false, reason:'ratelimit_misconfigured'}` to 503 with a
   * Retry-After so canary alerting catches the configuration gap rather
   * than seeing a 429 (which would mask "wide-open" as "throttled").
   */
  it("Cluster-K C-0032 — misconfigured limiter returns 503 (fail-CLOSED)", async () => {
    state.authedUser = TEST_ADMIN;
    state.userRoles = ["admin"];
    state.deletionRow = {
      id: TEST_REQUEST_ID,
      user_id: TEST_TARGET_USER_ID,
      requested_at: "2026-05-01T00:00:00Z",
      completed_at: null,
      rejected_at: null,
    };

    vi.resetModules();
    vi.doMock("@/lib/ratelimit", () => ({
      adminActionLimiter: {} as unknown,
      checkLimit: async () => ({
        success: false,
        retryAfter: 60,
        reason: "ratelimit_misconfigured",
      }) as const,
      isRateLimitMisconfigured: (r: { reason?: string }) =>
        r.reason === "ratelimit_misconfigured",
    }));

    const { POST } = await import("./route");
    const res = await POST(makeReq(), makeCtx());

    expect(res.status).toBe(503);
    expect(res.headers.get("Retry-After")).toBe("60");
    expect(state.sanitizeRpc).not.toHaveBeenCalled();

  });

  /**
   * Cluster-K C-0033 / H-0217 — when two admins race the approve route,
   * BOTH pass loadDeletionRequestForAction (no row lock at read), BOTH
   * call sanitize_user (idempotent — first does the destructive work,
   * second is a no-op), but only ONE wins the CAS UPDATE. The loser
   * must NOT emit `deletion.request.approve` (that would leave two
   * different `approved_by` admins in the immutable audit_log).
   *
   * `account.sanitize` IS emitted by both — that's the honest forensic
   * signal: the destructive RPC ran twice (once first-run, once
   * idempotent re-run), and the audit_log captures BOTH calls with
   * accurate `was_first_run` flags.
   */
  it("Cluster-K C-0033/H-0217 — CAS loser emits account.sanitize but NOT deletion.request.approve", async () => {
    state.authedUser = TEST_ADMIN;
    state.userRoles = ["admin"];
    state.deletionRow = {
      id: TEST_REQUEST_ID,
      user_id: TEST_TARGET_USER_ID,
      requested_at: "2026-05-01T00:00:00Z",
      completed_at: null,
      rejected_at: null,
    };
    state.casWins = false; // another admin already approved

    const { POST } = await import("./route");
    const res = await POST(makeReq(), makeCtx());

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.completed_by_this_call).toBe(false);

    // sanitize_user STILL ran (idempotent — safe). Audit must reflect
    // the call BUT must NOT claim this admin approved the request.
    expect(state.sanitizeRpc).toHaveBeenCalledTimes(1);

    const actions = state.auditLog.mock.calls.map(
      (call) => (call[0] as { action: string }).action,
    );
    expect(actions).toContain("account.sanitize");
    expect(actions).not.toContain("deletion.request.approve");
  });

  /**
   * Cluster-K H-0216 / M-0265 — the `account.sanitize` audit MUST be
   * emitted IMMEDIATELY after sanitize_user returns, NOT after the
   * downstream completed_at UPDATE succeeds. Pre-fix the audit only
   * fired on the UPDATE-success branch, which meant a transient network
   * blip on the UPDATE left the destructive RPC un-audited (audit_log
   * is immutable, so the gap was permanent).
   *
   * This test forces the UPDATE to error out and asserts:
   *   - sanitize_user was called (destruction happened)
   *   - account.sanitize audit was STILL emitted
   *   - deletion.request.approve audit was NOT emitted (no successful
   *     terminal state to anchor it to)
   *   - route returns 500 (so the operator retries)
   */
  it("Cluster-K H-0216/M-0265 — account.sanitize emits even when completed_at UPDATE fails", async () => {
    state.authedUser = TEST_ADMIN;
    state.userRoles = ["admin"];
    state.deletionRow = {
      id: TEST_REQUEST_ID,
      user_id: TEST_TARGET_USER_ID,
      requested_at: "2026-05-01T00:00:00Z",
      completed_at: null,
      rejected_at: null,
    };

    // Override the admin client mock for this test so the UPDATE
    // returns an error. We have to re-mock the whole module.
    vi.resetModules();
    vi.doMock("@/lib/supabase/admin", () => ({
      createAdminClient: () => ({
        from: (_table: string) => ({
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({
                data: state.deletionRow,
                error: null,
              }),
            }),
          }),
          update: (_patch: Record<string, unknown>) => ({
            eq: (_idCol: string, _idVal: string) => ({
              is: (_c: string, _n: unknown) => ({
                select: async (_cols: string) => ({
                  data: null,
                  error: { message: "transient db error" },
                }),
              }),
            }),
          }),
        }),
        rpc: async (name: string, args: Record<string, unknown>) => {
          state.sanitizeRpc(name, args);
          return { data: true, error: null };
        },
      }),
    }));

    const { POST } = await import("./route");
    const res = await POST(makeReq(), makeCtx());

    expect(res.status).toBe(500);
    // CRITICAL: the destructive RPC ran AND the audit fired even
    // though the downstream UPDATE failed. Pre-fix, the audit would
    // have been gated on UPDATE success and we'd have an un-audited
    // anonymize.
    expect(state.sanitizeRpc).toHaveBeenCalledTimes(1);
    const actions = state.auditLog.mock.calls.map(
      (call) => (call[0] as { action: string }).action,
    );
    expect(actions).toContain("account.sanitize");
    expect(actions).not.toContain("deletion.request.approve");
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
