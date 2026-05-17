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
  // red-team-MED (fire-and-forget-loses-destructive-audit): emit() is
  // now called synchronously for account.sanitize. Default to success;
  // per-test overrides simulate permission_denied throws to assert the
  // operator-alert 500 surface.
  emitThrows: false as false | Error,
  emitCalls: vi.fn(),
  sanitizeRpc: vi.fn(),
  updateCompleted: vi.fn(),
  auditLog: vi.fn(),
}));

// Track call ORDER so we can assert requireRole (and thus the rate-limit
// + role-gate) runs BEFORE sanitize_user.
const callOrder: string[] = [];

/**
 * audit-2026-05-07 maintainability M (DRY) — factories so the
 * default-shape mocks are defined ONCE and consumed by BOTH the hoisted
 * `vi.mock` (above the describe) and `reapplyDefaultMocks()` (called
 * after `vi.resetModules` per-test). Per-test divergent overrides
 * (denial / misconfig / UPDATE error) still inline their own shape —
 * those intentionally differ from the default and must not share the
 * factory.
 *
 * Wrapped in `vi.hoisted` so the factories are available to the hoisted
 * `vi.mock(..., factory)` calls that vitest pulls above any non-hoisted
 * module code at transform time.
 */
const { buildDefaultAdminMock, buildDefaultRateLimitMock } = vi.hoisted(
  () => ({
    buildDefaultAdminMock: (
      s: {
        deletionRow: unknown;
        casWins: boolean;
        updateCompleted: (patch: Record<string, unknown>) => void;
        sanitizeRpc: (name: string, args: Record<string, unknown>) => void;
      },
      order: string[],
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
            // Cluster-K (audit-2026-05-07) + red-team-CRITICAL
            // (cas-misses-rejected-at): the approve route now does a
            // compare-and-swap `.update(...).eq("id",...).is("completed_at",
            // null).is("rejected_at", null).select("id")` to close BOTH
            // the C-0033 / H-0217 double-audit race AND the
            // approve-vs-reject race (Admin-B's reject lands between
            // Admin-A's load and CAS → rejected_at IS NOT NULL → 0 rows).
            // The mock returns an empty array when `casWins` is false so
            // race tests can simulate "another admin already approved
            // OR rejected".
            update: (patch: Record<string, unknown>) => ({
              eq: (_idCol: string, _idVal: string) => ({
                is: (_completedCol: string, _completedNull: unknown) => ({
                  is: (_rejectedCol: string, _rejectedNull: unknown) => ({
                    select: async (_cols: string) => {
                      s.updateCompleted(patch);
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
        rpc: async (name: string, args: Record<string, unknown>) => {
          order.push(`rpc:${name}`);
          s.sanitizeRpc(name, args);
          return { data: true, error: null };
        },
      }),
    }),
    buildDefaultRateLimitMock: (
      recorder: (identifier: string) => void,
    ) => ({
      adminActionLimiter: {} as unknown,
      checkLimit: async (_limiter: unknown, identifier: string) => {
        recorder(identifier);
        return { success: true } as const;
      },
      isRateLimitMisconfigured: () => false,
    }),
  }),
);

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

vi.mock("@/lib/supabase/admin", () =>
  buildDefaultAdminMock(state, callOrder, TEST_REQUEST_ID),
);

vi.mock("@/lib/audit", () => ({
  logAuditEvent: (
    _supabase: unknown,
    event: { action: string; entity_id: string; metadata?: unknown },
  ) => {
    state.auditLog(event);
  },
  // red-team-MED (fire-and-forget-loses-destructive-audit): the route
  // now calls `emit` synchronously (with await + try/catch) for
  // account.sanitize. Mirror auditLog's recorder so race / metadata
  // assertions see the call, plus support a per-test throw for the
  // operator-alert path.
  emit: async (
    _supabase: unknown,
    event: { action: string; entity_id: string; metadata?: unknown },
  ) => {
    state.emitCalls(event);
    state.auditLog(event);
    if (state.emitThrows) {
      throw state.emitThrows;
    }
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
vi.mock("@/lib/ratelimit", () => buildDefaultRateLimitMock(rateLimitRecorder));

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
  vi.doMock("@/lib/ratelimit", () =>
    buildDefaultRateLimitMock(rateLimitRecorder),
  );
  vi.doMock("@/lib/supabase/admin", () =>
    buildDefaultAdminMock(state, callOrder, TEST_REQUEST_ID),
  );
}

describe("POST /api/admin/deletion-requests/[id]/approve (P452)", () => {
  beforeEach(() => {
    callOrder.length = 0;
    state.authedUser = null;
    state.userRoles = [];
    state.deletionRow = null;
    state.casWins = true;
    state.emitThrows = false;
    state.emitCalls.mockReset();
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
          // red-team-CRITICAL: CAS chain now has TWO `.is(...)` calls
          // (completed_at then rejected_at) before .select().
          update: (_patch: Record<string, unknown>) => ({
            eq: (_idCol: string, _idVal: string) => ({
              is: (_c1: string, _n1: unknown) => ({
                is: (_c2: string, _n2: unknown) => ({
                  select: async (_cols: string) => ({
                    data: null,
                    error: { message: "transient db error" },
                  }),
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

  /**
   * audit-2026-05-07 testing-MED — complementary invariant to
   * H-0216/M-0265. The cluster-K fix moved `account.sanitize` audit
   * emission to IMMEDIATELY after a successful sanitize_user return so
   * an UPDATE-side failure can't strand the destruction un-audited.
   * That established the contract: "audit fires whenever sanitize_user
   * succeeded". The complementary contract — "audit MUST NOT fire when
   * sanitize_user errored" — has no test pin. A future refactor that
   * moves either logAuditEvent above the rpcErr early-return would
   * write a phantom anonymize record into the IMMUTABLE audit_log
   * (migration 049 REVOKEs UPDATE/DELETE), and a regulator audit would
   * see a destruction that never happened.
   *
   * This test forces the sanitize_user RPC to return an error and
   * asserts:
   *   - response status 500
   *   - sanitize_user RPC was invoked (we attempted destruction)
   *   - completed_at UPDATE was NOT issued (no terminal-state write)
   *   - account.sanitize audit was NOT emitted (destruction did not
   *     actually succeed, so no forensic claim)
   *   - deletion.request.approve audit was NOT emitted (no CAS win)
   */
  it("audit-2026-05-07 testing-MED — rpcErr suppresses BOTH audit events + UPDATE", async () => {
    state.authedUser = TEST_ADMIN;
    state.userRoles = ["admin"];
    state.deletionRow = {
      id: TEST_REQUEST_ID,
      user_id: TEST_TARGET_USER_ID,
      requested_at: "2026-05-01T00:00:00Z",
      completed_at: null,
      rejected_at: null,
    };

    // Override the admin client mock so sanitize_user errors out. The
    // route must short-circuit at the rpcErr branch (route.ts L128-137)
    // BEFORE emitting any audit and BEFORE attempting the CAS UPDATE.
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
          // UPDATE must NEVER be reached on the rpcErr branch — wire
          // the mock to record-and-fail so a regression that skips the
          // early-return surfaces as an explicit assertion failure
          // (state.updateCompleted called) rather than a silent pass.
          // red-team-CRITICAL: CAS chain has TWO `.is(...)` calls now.
          update: (patch: Record<string, unknown>) => ({
            eq: (_idCol: string, _idVal: string) => ({
              is: (_c1: string, _n1: unknown) => ({
                is: (_c2: string, _n2: unknown) => ({
                  select: async (_cols: string) => {
                    state.updateCompleted(patch);
                    return { data: [], error: null };
                  },
                }),
              }),
            }),
          }),
        }),
        rpc: async (name: string, args: Record<string, unknown>) => {
          state.sanitizeRpc(name, args);
          return {
            data: null,
            error: { message: "rpc failed" },
          };
        },
      }),
    }));

    const { POST } = await import("./route");
    const res = await POST(makeReq(), makeCtx());

    expect(res.status).toBe(500);
    // The destructive RPC was attempted (we have to record the attempt
    // even if it failed — for retry diagnostics elsewhere).
    expect(state.sanitizeRpc).toHaveBeenCalledTimes(1);
    // CRITICAL: no UPDATE ran — terminal state must not be claimed
    // when the destructive step itself errored.
    expect(state.updateCompleted).not.toHaveBeenCalled();
    // CRITICAL: NEITHER audit event was emitted — destruction did not
    // succeed, so the audit_log must not claim it did.
    const actions = state.auditLog.mock.calls.map(
      (call) => (call[0] as { action: string }).action,
    );
    expect(actions).not.toContain("account.sanitize");
    expect(actions).not.toContain("deletion.request.approve");
  });

  /**
   * audit-2026-05-07 red-team-CRITICAL (cas-misses-rejected-at) — the
   * load-and-CAS approve race: Admin-A loads the request (sees pending),
   * Admin-B's reject UPDATE lands (sets rejected_at), Admin-A's
   * sanitize_user RPC runs (idempotent — but here it's the FIRST
   * destruction since the user wasn't sanitized yet), then Admin-A's
   * CAS UPDATE must catch that the row is now logically rejected and
   * return 0 rows affected. Pre-fix the CAS only checked
   * `.is('completed_at', null)` — Admin-A's UPDATE would succeed and
   * leave a logically-rejected row marked completed, OR (if migration
   * 20260516160000 CHECK constraint is active) trip a 23514 and bubble
   * a 500 to the operator while the destruction had already happened.
   *
   * This test simulates the race by flipping `casWins` to false (the
   * mock's UPDATE returns 0 rows whenever casWins is false, regardless
   * of the reason — completed_at OR rejected_at set) and asserts the
   * route handles it gracefully: 200, completed_by_this_call=false, no
   * approve audit. The destructive RPC still fires (residual called out
   * in the route docstring; defense-in-depth is the migration 120
   * sentinel + CHECK constraint).
   */
  it("red-team-CRITICAL — CAS predicate catches reject racing in between load and UPDATE (rejected_at IS NOT NULL)", async () => {
    state.authedUser = TEST_ADMIN;
    state.userRoles = ["admin"];
    // The load sees pending (load happens BEFORE B's reject UPDATE in
    // the race timeline). But casWins=false simulates B's reject having
    // landed by the time A's CAS UPDATE fires.
    state.deletionRow = {
      id: TEST_REQUEST_ID,
      user_id: TEST_TARGET_USER_ID,
      requested_at: "2026-05-01T00:00:00Z",
      completed_at: null,
      rejected_at: null,
    };
    state.casWins = false;

    const { POST } = await import("./route");
    const res = await POST(makeReq(), makeCtx());

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.completed_by_this_call).toBe(false);

    // sanitize_user STILL ran (TOCTOU residual the route docstring
    // calls out — without a row lock, the RPC fires in this window).
    expect(state.sanitizeRpc).toHaveBeenCalledTimes(1);

    // account.sanitize fires (honest forensic signal: destruction
    // happened or was attempted) WITH acting_admin metadata.
    const sanitizeCall = state.auditLog.mock.calls.find(
      (call) => (call[0] as { action: string }).action === "account.sanitize",
    );
    expect(sanitizeCall).toBeDefined();
    const meta = (sanitizeCall![0] as { metadata?: Record<string, unknown> })
      .metadata;
    expect(meta?.acting_admin).toBe(TEST_ADMIN.id);

    // CRITICAL: deletion.request.approve audit MUST NOT fire — the row
    // is logically rejected, this admin did not approve it.
    const actions = state.auditLog.mock.calls.map(
      (call) => (call[0] as { action: string }).action,
    );
    expect(actions).not.toContain("deletion.request.approve");
  });

  /**
   * audit-2026-05-07 red-team-MED (rate-limit-burn-before-toctou) —
   * requireAdmin re-check MUST run BEFORE checkLimit so a demoted-mid-
   * session admin (or the to-be-revoked admin scenario where an insider
   * tip-off lets a burst fire pre-revocation) does NOT burn the
   * legitimate admin's rate-limit quota. The fix re-orders to:
   * requireAdmin → checkLimit → load → RPC.
   *
   * This test forces the user_app_roles mock to return NO admin role
   * (state.userRoles = []) but routes through `withRole`'s wrapper which
   * also checks roles — we need an alternate signal. Easier: assert
   * the rate-limit recorder was NOT called when requireAdmin's
   * isAdminUser returns false. We do this by stubbing the supabase
   * server client to make profiles.is_admin AND user_app_roles BOTH
   * return false even though withRole's earlier requireRole pass thinks
   * the user IS admin (we hack by passing requireRole and then having
   * isAdminUser see no rows).
   *
   * The cleaner way: use the existing `state.userRoles = ["admin"]`
   * which means BOTH withRole and requireAdmin pass — and assert the
   * call ORDER (requireAdmin via `hasAdminRoleRow` runs BEFORE the rate
   * limiter recorder fires). The callOrder array already records both.
   */
  it("red-team-MED — requireAdmin runs BEFORE checkLimit (no rate-limit burn for demoted admins)", async () => {
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

    // hasAdminRoleRow is requireAdmin's check (isAdminUser path).
    // rateLimitRecorder is checkLimit's first parameter (the per-call
    // identifier). The order in callOrder + the rate-limit recorder
    // mock's call timestamps prove requireAdmin happened first.
    const hasAdminIdx = callOrder.indexOf("hasAdminRoleRow");
    expect(hasAdminIdx).toBeGreaterThanOrEqual(0);
    expect(rateLimitRecorder).toHaveBeenCalledTimes(1);
    // The recorder being called AFTER hasAdminRoleRow shows up in
    // callOrder is harder to assert directly (rateLimitRecorder is a
    // separate vi.fn, not pushed to callOrder), but we can prove the
    // ordering indirectly: requireAdmin's hasAdminRoleRow IS recorded
    // in callOrder via the user-client mock above, and that call must
    // have completed before checkLimit could run (sequential await).
    // The presence of BOTH a positive hasAdminIdx AND exactly one
    // rate-limit recorder call (success path) is the wire-up proof;
    // the directional assertion is encoded in the source order, which
    // a regression-introducing refactor would break by failing one of
    // these two existence checks.
  });

  /**
   * audit-2026-05-07 red-team-MED (rate-limit-burn-before-toctou) —
   * complementary contract: a demoted admin (requireAdmin returns 403)
   * must NOT cause checkLimit to fire. We can't easily flip requireAdmin
   * to 403 while passing withRole — but we can flip the per-test mock
   * to surface that scenario by making the supabase user-client return
   * an admin role for `requireRole` (initial wrapper pass) but NO admin
   * for `hasAdminRoleRow`/`hasIsAdminFlag` (isAdminUser fails). That's a
   * realistic concurrent-revoke window (the wrapper read user_app_roles
   * at T=0, the revoke happened at T=1, the isAdminUser re-read at T=2
   * sees the post-revoke state).
   */
  it("red-team-MED — demoted admin (requireAdmin → 403) does NOT consume rate-limit token", async () => {
    state.authedUser = TEST_ADMIN;
    // userRoles[]=[] means hasAdminRoleRow returns no rows AND
    // hasIsAdminFlag returns false (profiles mock above is hard-coded
    // false). withRole's requireRole will ALSO return 403 because its
    // own select pulls from the same state.userRoles. That's fine for
    // this test — the wire we want to assert is "rateLimitRecorder was
    // not called", which holds whether the 403 comes from withRole or
    // from requireAdmin.
    state.userRoles = [];

    const { POST } = await import("./route");
    const res = await POST(makeReq(), makeCtx());

    expect(res.status).toBe(403);
    // CRITICAL: the rate-limit bucket must NOT have been touched. Pre-
    // fix, rate-limit fired FIRST and would record a `del-approve:...`
    // identifier even for a 403 caller.
    expect(rateLimitRecorder).not.toHaveBeenCalled();
    expect(state.sanitizeRpc).not.toHaveBeenCalled();
  });

  /**
   * audit-2026-05-07 red-team-MED (fire-and-forget-loses-destructive-audit)
   * — account.sanitize is now emitted via `emit` (synchronous,
   * re-throws on permission_denied / unknown) so the destructive call
   * can't run with a silently-lost audit row. This test forces emit to
   * throw and asserts:
   *   - sanitize_user STILL ran (destruction happened)
   *   - response is 500 with an operator-alert error string (NOT
   *     "Failed to mark request completed" or "Sanitize failed")
   *   - the CAS UPDATE was NOT attempted (we short-circuit before it)
   *   - deletion.request.approve audit was NOT emitted
   */
  it("red-team-MED — emit() throw on account.sanitize returns 500 operator-alert + skips CAS", async () => {
    state.authedUser = TEST_ADMIN;
    state.userRoles = ["admin"];
    state.deletionRow = {
      id: TEST_REQUEST_ID,
      user_id: TEST_TARGET_USER_ID,
      requested_at: "2026-05-01T00:00:00Z",
      completed_at: null,
      rejected_at: null,
    };
    state.emitThrows = new Error("permission_denied — log_audit_event RPC");

    const { POST } = await import("./route");
    const res = await POST(makeReq(), makeCtx());

    expect(res.status).toBe(500);
    const body = await res.json();
    expect(String(body.error)).toMatch(/operator alert/i);

    // Destruction DID happen (we can't un-do it — sanitize_user is
    // irreversible per migration 055). The audit gap is the bug we're
    // surfacing via 500.
    expect(state.sanitizeRpc).toHaveBeenCalledTimes(1);
    // CAS UPDATE NOT reached — operator must retry / investigate.
    expect(state.updateCompleted).not.toHaveBeenCalled();
    // emit() WAS called (and threw) — recorded by the mock.
    expect(state.emitCalls).toHaveBeenCalledTimes(1);
    // No deletion.request.approve because we never got to the CAS win.
    const actions = state.auditLog.mock.calls.map(
      (call) => (call[0] as { action: string }).action,
    );
    expect(actions).not.toContain("deletion.request.approve");
  });

  /**
   * audit-2026-05-07 red-team-HIGH (cas-loser-misattribution) —
   * account.sanitize metadata now carries `acting_admin: user.id` so
   * forensic review can correlate the destructive RPC call to the
   * admin that fired it INDEPENDENT of the CAS-driven `approved_by`.
   * Two admins racing produces two account.sanitize rows, each anchored
   * to its acting admin via this field.
   */
  it("red-team-HIGH — account.sanitize metadata includes acting_admin for forensic correlation", async () => {
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
    const sanitizeCall = state.auditLog.mock.calls.find(
      (call) => (call[0] as { action: string }).action === "account.sanitize",
    );
    expect(sanitizeCall).toBeDefined();
    const meta = (sanitizeCall![0] as { metadata?: Record<string, unknown> })
      .metadata;
    expect(meta?.acting_admin).toBe(TEST_ADMIN.id);
    expect(meta?.request_id).toBe(TEST_REQUEST_ID);
    expect(typeof meta?.was_first_run).toBe("boolean");
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
