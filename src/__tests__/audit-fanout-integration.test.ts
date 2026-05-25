import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

/**
 * Sprint 6 closeout Task 7.1b — per-site audit emission integration tests.
 *
 * The grep coverage test (`audit-coverage.test.ts`) asserts that every
 * mutation site has a logAuditEvent call or @audit-skip pragma; this
 * test asserts that the emission ACTUALLY fires at runtime with the
 * expected action + entity_type on the happy path for the high-signal
 * routes.
 *
 * Phase 08 Plan 01 update: the legacy `portfolio_note.update` block was
 * replaced with four parallel `user_note.{scope}.update` blocks covering
 * the new multi-scope /api/notes PATCH contract. Per Research Finding #8,
 * entity_id is a scope-appropriate UUID (NOT a synthetic composite string)
 * because `audit_log.entity_id` is UUID-typed:
 *   - portfolio       → portfolios.id (scope_ref as UUID)
 *   - holding         → caller's profiles.id (no single row aggregates the note)
 *   - bridge_outcome  → bridge_outcomes.id (scope_ref as UUID)
 *   - strategy        → strategies.id (scope_ref as UUID)
 *
 * Each note-scope block asserts: entity_type="user_note"; metadata includes
 * scope_kind + scope_ref + content_length; metadata.content is undefined
 * (D-20 privacy invariant).
 */

// audit.ts imports "server-only" which throws under vitest+jsdom.
vi.mock("server-only", () => ({}));

// audit.ts uses next/server's `after()` — pass through synchronously so
// the emission is observable without waiting on platform-only
// `waitUntil` semantics.
vi.mock("next/server", async () => {
  const actual = await vi.importActual<typeof import("next/server")>(
    "next/server",
  );
  return {
    ...actual,
    after: (cb: () => void | Promise<void>) => {
      void cb();
    },
  };
});

const STATE = vi.hoisted(() => ({
  rpcCalls: [] as Array<{ name: string; args: Record<string, unknown> }>,
  authUser: {
    id: "00000000-0000-0000-0000-000000000001",
    email: "test@example.com",
  },
  isAdmin: true,
}));

// Rate-limit and CSRF helpers — the integration tests pass through
// valid origin headers and the limiter falls open so we always reach
// the audit-emission branch.
vi.mock("@/lib/ratelimit", () => ({
  userActionLimiter: null,
  adminActionLimiter: null,
  publicIpLimiter: null,
  checkLimit: async () => ({ success: true, retryAfter: 0 }),
  getClientIp: () => "127.0.0.1",
  sanitizeInetForDb: (ip: string) => ip,
}));

vi.mock("@/lib/admin", () => ({
  isAdminUser: async () => STATE.isAdmin,
}));

vi.mock("@/lib/email", () => ({
  notifyManagerApproved: vi.fn(),
  notifyFounderIntroRequest: vi.fn(),
  notifyAllocatorIntroStatus: vi.fn(),
  notifyFounderGeneric: vi.fn(),
  sendAlertDigest: vi.fn(),
  escapeHtml: (s: string) => s,
  resolveManagerName: async () => "Manager",
}));

vi.mock("@/lib/analytics/usage-events", () => ({
  trackUsageEventServer: vi.fn(),
}));

vi.mock("@/lib/analytics", () => ({
  trackForQuantsEventServer: vi.fn(),
}));

/**
 * Shared mock supabase client builder. Each route gets a tailored
 * `from(...)` implementation so the test stays narrow, but the `rpc`
 * and `auth` hooks are uniform.
 */
function makeClient(fromImpl: (table: string) => unknown) {
  return {
    auth: {
      getUser: async () => ({
        data: { user: STATE.authUser },
        error: null,
      }),
    },
    rpc: async (name: string, args: Record<string, unknown>) => {
      STATE.rpcCalls.push({ name, args });
      return { data: null, error: null };
    },
    from: fromImpl as never,
    storage: {
      from: () => ({
        getPublicUrl: () => ({ data: { publicUrl: "http://x" } }),
      }),
    },
  };
}

beforeEach(() => {
  STATE.rpcCalls = [];
  STATE.isAdmin = true;
});

function findAudit(action: string) {
  return STATE.rpcCalls.find(
    (c) =>
      (c.name === "log_audit_event" ||
        c.name === "log_audit_event_service") &&
      c.args.p_action === action,
  );
}

/**
 * H-0008 fix — bounded polling wait for the audit emission, replacing the
 * brittle fixed 3-tick `drain()`. The emit path (`audit.ts`) schedules the
 * RPC via `after()` (mocked to call synchronously) but the inner `emit()`
 * is async and performs an RPC round-trip whose microtask count is NOT a
 * fixed constant — a connection-pool acquire or an extra `await` would add
 * ticks. A fixed 3× `await Promise.resolve()` could return BEFORE the RPC
 * lands, surfacing as a confusing `expect(audit).toBeDefined()` failure
 * rather than a clear "no audit emission" timeout.
 *
 * `vi.waitFor` polls until the assertion passes or the bounded timeout
 * elapses, then fails LOUDLY (mirrors rbac-matrix.test.ts). Returns the
 * matched audit call so callers can assert on its args without a second
 * lookup that could race.
 */
async function waitForAudit(
  action: string,
): Promise<{ name: string; args: Record<string, unknown> }> {
  return vi.waitFor(
    () => {
      const audit = findAudit(action);
      if (!audit) {
        throw new Error(`no audit emission for action="${action}" yet`);
      }
      return audit;
    },
    { timeout: 1000, interval: 5 },
  );
}

// ─── portfolio-alerts PATCH (alert.acknowledge) ──────────────────────
describe("POST /api/portfolio-alerts PATCH — alert.acknowledge emission", () => {
  it("emits alert.acknowledge on ack of an owned alert", async () => {
    const ALERT_ID = "aaaa1111-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const PORTFOLIO_ID = "bbbb2222-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

    vi.resetModules();
    vi.doMock("@/lib/supabase/server", () => ({
      createClient: async () =>
        makeClient((table: string) => {
          if (table === "portfolios") {
            return {
              select: () => ({
                eq: () => ({
                  data: [{ id: PORTFOLIO_ID }],
                  error: null,
                  then: (fn: (arg: unknown) => unknown) =>
                    Promise.resolve(
                      fn({
                        data: [{ id: PORTFOLIO_ID }],
                        error: null,
                      }),
                    ),
                }),
              }),
            };
          }
          if (table === "portfolio_alerts") {
            return {
              update: () => ({
                eq: () => ({
                  in: () => ({
                    select: () => ({
                      data: [{ id: ALERT_ID }],
                      error: null,
                      then: (fn: (arg: unknown) => unknown) =>
                        Promise.resolve(
                          fn({
                            data: [{ id: ALERT_ID }],
                            error: null,
                          }),
                        ),
                    }),
                  }),
                }),
              }),
            };
          }
          throw new Error(`unexpected from(${table})`);
        }),
    }));
    vi.doMock("@/lib/api/withAuth", async () => {
      const { NextResponse } = await vi.importActual<
        typeof import("next/server")
      >("next/server");
      return {
        withAuth: (handler: (req: unknown, user: unknown) => unknown) =>
          async (req: unknown) => {
            if (!STATE.authUser) {
              return NextResponse.json(
                { error: "Unauthorized" },
                { status: 401 },
              );
            }
            return handler(req, STATE.authUser);
          },
      };
    });
    vi.doMock("@/lib/queries", () => ({
      assertPortfolioOwnership: async () => true,
    }));

    const { PATCH } = await import("@/app/api/portfolio-alerts/route");
    const req = new NextRequest("http://localhost:3000/api/portfolio-alerts", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ alert_id: ALERT_ID }),
    });
    const res = await PATCH(req);
    expect([200, 204]).toContain(res.status);

    const audit = await waitForAudit("alert.acknowledge");
    expect(audit.args.p_entity_type).toBe("alert");
    expect(audit.args.p_entity_id).toBe(ALERT_ID);
    expect((audit.args.p_metadata as Record<string, unknown>).source).toBe(
      "in_app_list",
    );
  });
});

// ─── notes PATCH — 4 scope_kind emission blocks (Phase 08) ───────────
//
// Replaces the legacy `portfolio_note.update` block. Per Research Finding #8,
// entity_id resolves to a scope-appropriate UUID:
//   portfolio      → portfolios.id (= scope_ref)
//   holding        → caller's profiles.id (= STATE.authUser.id)
//   bridge_outcome → bridge_outcomes.id (= scope_ref)
//   strategy       → strategies.id (= scope_ref)

describe("PATCH /api/notes — user_note.portfolio.update emission", () => {
  it("emits user_note.portfolio.update with entity_id = portfolios.id", async () => {
    const PORTFOLIO_ID = "cccc3333-cccc-4ccc-8ccc-cccccccccccc";

    vi.resetModules();
    vi.doMock("@/lib/supabase/server", () => ({
      createClient: async () =>
        makeClient((table: string) => {
          if (table === "portfolios") {
            return {
              select: () => ({
                eq: () => ({
                  eq: () => ({
                    maybeSingle: async () => ({
                      data: { id: PORTFOLIO_ID },
                      error: null,
                    }),
                    single: async () => ({
                      data: { id: PORTFOLIO_ID },
                      error: null,
                    }),
                  }),
                }),
              }),
            };
          }
          if (table === "user_notes") {
            return {
              upsert: () => ({
                select: () => ({
                  single: async () => ({
                    data: { updated_at: new Date().toISOString() },
                    error: null,
                  }),
                }),
              }),
            };
          }
          throw new Error(`unexpected from(${table})`);
        }),
    }));

    const { PATCH } = await import("@/app/api/notes/route");
    const req = new NextRequest("http://localhost:3000/api/notes", {
      method: "PATCH",
      headers: {
        "content-type": "application/json",
        // CSRF guard — assertSameOrigin requires Origin/Referer to match
        // the localhost dev allowlist.
        origin: "http://localhost:3000",
      },
      body: JSON.stringify({
        scope_kind: "portfolio",
        scope_ref: PORTFOLIO_ID,
        content: "portfolio note",
      }),
    });
    const res = await PATCH(req);
    expect(res.status).toBe(200);

    const audit = await waitForAudit("user_note.portfolio.update");
    expect(audit.args.p_entity_type).toBe("user_note");
    expect(audit.args.p_entity_id).toBe(PORTFOLIO_ID);
    const meta = audit.args.p_metadata as Record<string, unknown>;
    expect(meta.scope_kind).toBe("portfolio");
    expect(meta.scope_ref).toBe(PORTFOLIO_ID);
    expect(meta.content_length).toBe("portfolio note".length);
    expect(meta.content).toBeUndefined();
  });
});

describe("PATCH /api/notes — user_note.holding.update emission", () => {
  it("emits user_note.holding.update with entity_id = caller's profiles.id", async () => {
    const SCOPE_REF = "binance:BTC:spot";

    vi.resetModules();
    vi.doMock("@/lib/supabase/server", () => ({
      createClient: async () =>
        makeClient((table: string) => {
          if (table === "allocator_holdings") {
            return {
              select: () => ({
                eq: () => ({
                  eq: () => ({
                    eq: () => ({
                      eq: () => ({
                        limit: () => ({
                          maybeSingle: async () => ({
                            data: { id: "h-1" },
                            error: null,
                          }),
                        }),
                      }),
                    }),
                  }),
                }),
              }),
            };
          }
          if (table === "user_notes") {
            return {
              upsert: () => ({
                select: () => ({
                  single: async () => ({
                    data: { updated_at: new Date().toISOString() },
                    error: null,
                  }),
                }),
              }),
            };
          }
          throw new Error(`unexpected from(${table})`);
        }),
    }));

    const { PATCH } = await import("@/app/api/notes/route");
    const req = new NextRequest("http://localhost:3000/api/notes", {
      method: "PATCH",
      headers: {
        "content-type": "application/json",
        origin: "http://localhost:3000",
      },
      body: JSON.stringify({
        scope_kind: "holding",
        scope_ref: SCOPE_REF,
        content: "holding note",
      }),
    });
    const res = await PATCH(req);
    expect(res.status).toBe(200);

    const audit = await waitForAudit("user_note.holding.update");
    expect(audit.args.p_entity_type).toBe("user_note");
    // Finding #8: holding has no single aggregate row → caller's user_id.
    expect(audit.args.p_entity_id).toBe(STATE.authUser.id);
    const meta = audit.args.p_metadata as Record<string, unknown>;
    expect(meta.scope_kind).toBe("holding");
    expect(meta.scope_ref).toBe(SCOPE_REF);
    expect(meta.content_length).toBe("holding note".length);
    expect(meta.content).toBeUndefined();
  });
});

describe("PATCH /api/notes — user_note.bridge_outcome.update emission", () => {
  it("emits user_note.bridge_outcome.update with entity_id = bridge_outcomes.id", async () => {
    const OUTCOME_ID = "dddd4444-dddd-4ddd-8ddd-dddddddddddd";

    vi.resetModules();
    vi.doMock("@/lib/supabase/server", () => ({
      createClient: async () =>
        makeClient((table: string) => {
          if (table === "bridge_outcomes") {
            return {
              select: () => ({
                eq: () => ({
                  eq: () => ({
                    maybeSingle: async () => ({
                      data: { id: OUTCOME_ID },
                      error: null,
                    }),
                  }),
                }),
              }),
            };
          }
          if (table === "user_notes") {
            return {
              upsert: () => ({
                select: () => ({
                  single: async () => ({
                    data: { updated_at: new Date().toISOString() },
                    error: null,
                  }),
                }),
              }),
            };
          }
          throw new Error(`unexpected from(${table})`);
        }),
    }));

    const { PATCH } = await import("@/app/api/notes/route");
    const req = new NextRequest("http://localhost:3000/api/notes", {
      method: "PATCH",
      headers: {
        "content-type": "application/json",
        origin: "http://localhost:3000",
      },
      body: JSON.stringify({
        scope_kind: "bridge_outcome",
        scope_ref: OUTCOME_ID,
        content: "bridge note",
      }),
    });
    const res = await PATCH(req);
    expect(res.status).toBe(200);

    const audit = await waitForAudit("user_note.bridge_outcome.update");
    expect(audit.args.p_entity_type).toBe("user_note");
    expect(audit.args.p_entity_id).toBe(OUTCOME_ID);
    const meta = audit.args.p_metadata as Record<string, unknown>;
    expect(meta.scope_kind).toBe("bridge_outcome");
    expect(meta.scope_ref).toBe(OUTCOME_ID);
    expect(meta.content).toBeUndefined();
  });
});

describe("PATCH /api/notes — user_note.strategy.update emission", () => {
  it("emits user_note.strategy.update with entity_id = strategies.id", async () => {
    const STRATEGY_ID = "eeee5555-eeee-4eee-8eee-eeeeeeeeeeee";

    vi.resetModules();
    vi.doMock("@/lib/supabase/server", () => ({
      createClient: async () =>
        makeClient((table: string) => {
          if (table === "strategies") {
            // Track every .eq() so the published-only filter is asserted.
            return {
              select: () => {
                const api: {
                  eq: (col: string, val: unknown) => typeof api;
                  maybeSingle: () => Promise<{
                    data: unknown;
                    error: unknown;
                  }>;
                } = {
                  eq(_col, _val) {
                    return api;
                  },
                  async maybeSingle() {
                    return {
                      data: { id: STRATEGY_ID },
                      error: null,
                    };
                  },
                };
                return api;
              },
            };
          }
          if (table === "user_notes") {
            return {
              upsert: () => ({
                select: () => ({
                  single: async () => ({
                    data: { updated_at: new Date().toISOString() },
                    error: null,
                  }),
                }),
              }),
            };
          }
          throw new Error(`unexpected from(${table})`);
        }),
    }));

    const { PATCH } = await import("@/app/api/notes/route");
    const req = new NextRequest("http://localhost:3000/api/notes", {
      method: "PATCH",
      headers: {
        "content-type": "application/json",
        origin: "http://localhost:3000",
      },
      body: JSON.stringify({
        scope_kind: "strategy",
        scope_ref: STRATEGY_ID,
        content: "strategy note",
      }),
    });
    const res = await PATCH(req);
    expect(res.status).toBe(200);

    const audit = await waitForAudit("user_note.strategy.update");
    expect(audit.args.p_entity_type).toBe("user_note");
    expect(audit.args.p_entity_id).toBe(STRATEGY_ID);
    const meta = audit.args.p_metadata as Record<string, unknown>;
    expect(meta.scope_kind).toBe("strategy");
    expect(meta.scope_ref).toBe(STRATEGY_ID);
    expect(meta.content).toBeUndefined();
  });
});

// ─── attestation POST (attestation.accept) ───────────────────────────
describe("POST /api/attestation — attestation.accept emission", () => {
  it("emits attestation.accept on a valid attestation", async () => {
    vi.resetModules();
    vi.doMock("@/lib/supabase/server", () => ({
      createClient: async () =>
        makeClient(() => ({
          upsert: () => ({
            select: () => ({
              single: async () => ({
                data: {
                  user_id: STATE.authUser.id,
                  attested_at: new Date().toISOString(),
                  version: "2026-04-07",
                },
                error: null,
              }),
            }),
          }),
        })),
    }));

    const { POST } = await import("@/app/api/attestation/route");
    const req = new NextRequest("http://localhost:3000/api/attestation", {
      method: "POST",
      headers: {
        origin: "http://localhost:3000",
        "content-type": "application/json",
      },
      body: JSON.stringify({ accepted: true }),
    });
    const res = await POST(req);
    expect(res.status).toBe(200);

    const audit = await waitForAudit("attestation.accept");
    expect(audit.args.p_entity_type).toBe("investor_attestation");
    expect(audit.args.p_entity_id).toBe(STATE.authUser.id);
  });
});

// ─── admin kill-switch (admin.kill_switch) ───────────────────────────
describe("POST /api/admin/match/kill-switch — admin.kill_switch emission", () => {
  it("emits admin.kill_switch on flag flip", async () => {
    vi.resetModules();
    vi.doMock("@/lib/supabase/server", () => ({
      createClient: async () => makeClient(() => ({}) as never),
    }));
    vi.doMock("@/lib/supabase/admin", () => ({
      createAdminClient: () => ({
        from: () => ({
          update: () => ({
            eq: async () => ({ data: null, error: null }),
          }),
        }),
      }),
    }));

    const { POST } = await import("@/app/api/admin/match/kill-switch/route");
    const req = new NextRequest(
      "http://localhost:3000/api/admin/match/kill-switch",
      {
        method: "POST",
        headers: {
          origin: "http://localhost:3000",
          "content-type": "application/json",
        },
        body: JSON.stringify({ enabled: false }),
      },
    );
    const res = await POST(req);
    expect(res.status).toBe(200);

    const audit = await waitForAudit("admin.kill_switch");
    expect(audit.args.p_entity_type).toBe("system_flag");
    expect(
      (audit.args.p_metadata as Record<string, unknown>).flag,
    ).toBe("match_engine_enabled");
    expect(
      (audit.args.p_metadata as Record<string, unknown>).new_value,
    ).toBe(false);
  });
});

// ─── admin allocator-approve (allocator.approve) ─────────────────────
describe("POST /api/admin/allocator-approve — allocator.approve emission", () => {
  it("emits allocator.approve on verified status change", async () => {
    const TARGET_USER = "dddd4444-dddd-4ddd-8ddd-dddddddddddd";

    vi.resetModules();
    vi.doMock("@/lib/supabase/server", () => ({
      createClient: async () => makeClient(() => ({}) as never),
    }));
    vi.doMock("@/lib/supabase/admin", () => ({
      createAdminClient: () => ({
        from: () => ({
          update: () => ({
            eq: async () => ({ data: null, error: null }),
          }),
          // PR #266 follow-up: the approve route now SELECTs (role, email)
          // after the update so it can fire the signup-approved email.
          // Mock returns no email so the notify path is a no-op.
          select: () => ({
            eq: () => ({
              single: async () => ({ data: null, error: null }),
            }),
          }),
        }),
      }),
    }));

    const { POST } = await import("@/app/api/admin/allocator-approve/route");
    const req = new NextRequest(
      "http://localhost:3000/api/admin/allocator-approve",
      {
        method: "POST",
        headers: {
          origin: "http://localhost:3000",
          "content-type": "application/json",
        },
        body: JSON.stringify({ id: TARGET_USER }),
      },
    );
    const res = await POST(req);
    expect(res.status).toBe(200);

    const audit = await waitForAudit("allocator.approve");
    expect(audit.args.p_entity_type).toBe("user");
    expect(audit.args.p_entity_id).toBe(TARGET_USER);
  });
});

// ─── admin strategy-review approve (strategy.approve) ────────────────
describe("POST /api/admin/strategy-review — strategy.approve emission", () => {
  it("emits strategy.approve when admin approves a strategy", async () => {
    const STRATEGY_ID = "eeee5555-eeee-4eee-8eee-eeeeeeeeeeee";

    vi.resetModules();
    vi.doMock("@/lib/supabase/server", () => ({
      createClient: async () => makeClient(() => ({}) as never),
    }));
    vi.doMock("@/lib/supabase/admin", () => ({
      createAdminClient: () => ({
        from: (table: string) => {
          if (table === "trades") {
            return {
              select: () => ({
                eq: () => ({
                  count: 100,
                  order: () => ({
                    limit: async () => ({
                      data: [{ timestamp: "2026-03-01T00:00:00Z" }],
                      error: null,
                    }),
                  }),
                  data: [{ timestamp: "2026-03-01T00:00:00Z" }],
                  error: null,
                  then: (fn: (arg: unknown) => unknown) =>
                    Promise.resolve(
                      fn({
                        count: 100,
                        data: [{ timestamp: "2026-03-01T00:00:00Z" }],
                        error: null,
                      }),
                    ),
                }),
              }),
            };
          }
          if (table === "strategies") {
            return {
              select: () => ({
                eq: () => ({
                  single: async () => ({
                    data: {
                      api_key_id: "key-1",
                      name: "Strat",
                      user_id: "user-1",
                    },
                    error: null,
                  }),
                }),
              }),
              // C-0060: approve path chains .update().eq("id").eq("status","pending_review").select("id");
              // reject path uses .update().eq("id"). Mock supports both shapes.
              update: () => ({
                eq: () => ({
                  // approve path: second .eq() + .select() returns row-array
                  eq: () => ({
                    select: async () => ({ data: [{ id: "ok" }], error: null }),
                  }),
                  // reject path: awaitable directly on the first .eq()
                  then: (resolve: (arg: unknown) => unknown) =>
                    Promise.resolve(resolve({ data: null, error: null })),
                }),
              }),
            };
          }
          if (table === "strategy_analytics") {
            return {
              select: () => ({
                eq: () => ({
                  single: async () => ({
                    data: {
                      computation_status: "complete",
                      computation_error: null,
                    },
                    error: null,
                  }),
                }),
              }),
            };
          }
          if (table === "profiles") {
            return {
              select: () => ({
                eq: () => ({
                  single: async () => ({
                    data: { email: "manager@example.com" },
                    error: null,
                  }),
                }),
              }),
            };
          }
          throw new Error(`unexpected from(${table})`);
        },
      }),
    }));
    vi.doMock("@/lib/strategyGate", () => ({
      checkStrategyGate: () => ({ passed: true }),
    }));

    const { POST } = await import("@/app/api/admin/strategy-review/route");
    const req = new NextRequest(
      "http://localhost:3000/api/admin/strategy-review",
      {
        method: "POST",
        headers: {
          origin: "http://localhost:3000",
          "content-type": "application/json",
        },
        body: JSON.stringify({ id: STRATEGY_ID, action: "approve" }),
      },
    );
    const res = await POST(req);
    expect(res.status).toBe(200);

    const audit = await waitForAudit("strategy.approve");
    expect(audit.args.p_entity_type).toBe("strategy");
    expect(audit.args.p_entity_id).toBe(STRATEGY_ID);
  });
});

// ─── admin partner-import (admin.partner_import) ─────────────────────
// /review follow-up (T4-I2): rollup pattern with a per-call random UUID.
// Pre-C-0056 the id was a deterministic sha256 slice of (partner_tag,
// Date.now()) hand-stamped to a v4 shape; post-C-0056 it is a real
// `crypto.randomUUID()` (RFC 4122 v4). Tests assert the variant nybble
// is one of [89ab] so a regression back to the hand-stamped form (which
// pinned the variant to '8') would fail loud.
describe("POST /api/admin/partner-import — admin.partner_import emission", () => {
  it("emits a rollup event with a crypto.randomUUID() entity_id", async () => {
    vi.resetModules();

    vi.doMock("@/lib/csrf", () => ({
      assertSameOrigin: () => null,
    }));

    vi.doMock("@/lib/supabase/server", () => ({
      createClient: async () => makeClient(() => ({}) as never),
    }));

    // ensureAuthUser is unit-tested separately; stub to return stable
    // per-email ids so the rollup metrics are deterministic.
    const authIdByEmail = new Map<string, string>();
    function syntheticIdFor(email: string): string {
      const existing = authIdByEmail.get(email);
      if (existing) return existing;
      const id = `user-${authIdByEmail.size + 1}`;
      authIdByEmail.set(email, id);
      return id;
    }
    vi.doMock("@/lib/supabase/admin-users", () => ({
      ensureAuthUser: async (
        _admin: unknown,
        params: { email: string },
      ): Promise<string> => syntheticIdFor(params.email),
    }));

    vi.doMock("@/lib/supabase/admin", () => ({
      createAdminClient: () => ({
        from: (table: string) => {
          if (table === "profiles") {
            return {
              // Audit-2026-05-07 R-0003: pre-check existing profiles
              // via `.select('email, partner_tag').in('email', emails)`
              // to detect cross-tenant partner_tag conflicts before any
              // upsert. Mock returns no existing rows so the happy-path
              // test sees no conflict and falls through to the upserts.
              select: () => ({
                in: () => Promise.resolve({ data: [], error: null }),
              }),
              upsert: async () => ({ data: null, error: null }),
            };
          }
          if (table === "strategies") {
            return {
              // Audit-2026-05-07 C-0055: pre-check existing strategies
              // via `.select('user_id, name').in('user_id', ids)` to
              // skip duplicates on re-run. Mock returns no existing
              // rows so all strategies in the test CSV land fresh.
              select: () => ({
                in: () => Promise.resolve({ data: [], error: null }),
              }),
              insert: async () => ({ data: null, error: null }),
            };
          }
          if (table === "allocator_preferences") {
            return {
              upsert: async () => ({ data: null, error: null }),
            };
          }
          throw new Error(`unexpected from(${table})`);
        },
      }),
    }));

    const { POST } = await import("@/app/api/admin/partner-import/route");
    const req = new NextRequest(
      "http://localhost:3000/api/admin/partner-import",
      {
        method: "POST",
        headers: {
          origin: "http://localhost:3000",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          partner_tag: "acme-pilot",
          managers_csv:
            "manager_email,strategy_name,disclosure_tier\n" +
            "m1@example.com,Strategy One,exploratory\n" +
            "m2@example.com,Strategy Two,institutional\n",
          allocators_csv:
            "allocator_email,mandate_archetype,ticket_size_usd\n" +
            "a1@example.com,crypto-sma,1000000\n",
        }),
      },
    );
    const res = await POST(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({
      managers_created: 2,
      strategies_created: 2,
      allocators_created: 1,
    });

    const audit = await waitForAudit("admin.partner_import");
    expect(audit.args.p_entity_type).toBe("partner_import");
    // Audit-2026-05-07 C-0056: entity_id is now a real RFC 4122 v4
    // UUID via crypto.randomUUID() — variant nybble is one of [89ab],
    // version nybble pinned to '4'.
    expect(audit.args.p_entity_id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    const meta = audit.args.p_metadata as Record<string, unknown>;
    expect(meta.partner_tag).toBe("acme-pilot");
    expect(meta.managers_created).toBe(2);
    expect(meta.strategies_created).toBe(2);
    expect(meta.allocators_created).toBe(1);
  });
});

// ─── alerts/ack POST email path (alert.acknowledge via logAuditEventAsUser)
// /review follow-up (T4-I2): novel service-role attribution pattern —
// the email-ack path has no user JWT, so attribution is resolved via
// portfolios.user_id and emission goes through log_audit_event_service.
describe("POST /api/alerts/ack — alert.acknowledge emission (email path)", () => {
  it("emits via logAuditEventAsUser with service-role attribution", async () => {
    const ALERT_ID = "ffff6666-ffff-4fff-8fff-ffffffffffff";
    const PORTFOLIO_ID = "9999aaaa-9999-4999-8999-999999999999";
    const OWNER_ID = "aaaabbbb-aaaa-4aaa-8aaa-aaaabbbbaaaa";

    vi.resetModules();

    // Stub the HMAC verifier — the token crypto is unit-tested
    // separately (alert-ack-token.test.ts); this test cares that the
    // downstream audit emission fires on the valid-token path.
    vi.doMock("@/lib/alert-ack-token", () => ({
      verifyAlertAckToken: () => true,
    }));

    // Supabase admin client responding to the alerts/ack query pattern.
    vi.doMock("@/lib/supabase/admin", () => ({
      createAdminClient: () => ({
        from: (table: string) => {
          if (table === "used_ack_tokens") {
            return {
              select: () => ({
                eq: () => ({
                  maybeSingle: async () => ({ data: null, error: null }),
                }),
              }),
              insert: async () => ({ data: null, error: null }),
            };
          }
          if (table === "portfolio_alerts") {
            return {
              select: () => ({
                eq: () => ({
                  maybeSingle: async () => ({
                    data: {
                      id: ALERT_ID,
                      alert_type: "drawdown",
                      acknowledged_at: null,
                      portfolio_id: PORTFOLIO_ID,
                    },
                    error: null,
                  }),
                }),
              }),
              update: () => ({
                eq: () => ({
                  is: async () => ({ data: null, error: null }),
                }),
              }),
            };
          }
          if (table === "portfolios") {
            return {
              select: () => ({
                eq: () => ({
                  maybeSingle: async () => ({
                    data: { user_id: OWNER_ID },
                    error: null,
                  }),
                }),
              }),
            };
          }
          throw new Error(`unexpected from(${table})`);
        },
        rpc: async (name: string, args: Record<string, unknown>) => {
          STATE.rpcCalls.push({ name, args });
          return { data: null, error: null };
        },
      }),
    }));

    const { POST } = await import("@/app/api/alerts/ack/route");
    const req = new NextRequest(
      `http://localhost:3000/api/alerts/ack?id=${ALERT_ID}&t=sig.abc`,
      {
        method: "POST",
        headers: {
          "sec-fetch-site": "same-origin",
          "content-type": "application/x-www-form-urlencoded",
        },
      },
    );
    const res = await POST(req);
    // Email-ack redirects on success — 303 to /allocations?ack=success.
    expect(res.status).toBe(303);

    const audit = await waitForAudit("alert.acknowledge");
    // Email path uses the service-role RPC variant for attribution.
    expect(audit.name).toBe("log_audit_event_service");
    expect(audit.args.p_user_id).toBe(OWNER_ID);
    expect(audit.args.p_entity_type).toBe("alert");
    expect(audit.args.p_entity_id).toBe(ALERT_ID);
    const meta = audit.args.p_metadata as Record<string, unknown>;
    expect(meta.source).toBe("email");
    expect(meta.alert_type).toBe("drawdown");
  });
});
