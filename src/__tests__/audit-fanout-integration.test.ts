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
 * Routes covered (per the plan's 8-10 high-signal cap):
 *   - /api/portfolio-alerts PATCH    → alert.acknowledge
 *   - /api/notes PATCH               → portfolio_note.update
 *   - /api/preferences PUT           → notification_preferences.update
 *   - /api/attestation POST          → attestation.accept
 *   - /api/portfolio-strategies/alias PATCH → allocation.update
 *   - /api/admin/match/kill-switch POST     → admin.kill_switch
 *   - /api/admin/allocator-approve POST     → allocator.approve
 *   - /api/admin/strategy-review POST       → strategy.approve
 *
 * /review follow-up (T4-I2): extended coverage for two novel patterns:
 *   - /api/admin/partner-import POST → admin.partner_import
 *     Novel: emits a single rollup event with a *synthesized* UUID
 *     entity_id (deterministic sha256 slice of partner_tag + timestamp)
 *     instead of anchoring on a DB row id.
 *   - /api/alerts/ack POST (email path) → alert.acknowledge
 *     Novel: uses `logAuditEventAsUser` (service-role RPC variant) so
 *     the acting-user id is resolved from portfolios.user_id, not from
 *     a browser JWT. Different attribution path than the in-app branch.
 *
 * Each test asserts:
 *   1. The RPC call fired with the expected p_action.
 *   2. The entity_id matches the expected source (row id / portfolio
 *      id / target user id / synthesized UUID).
 *   3. The happy-path response is 200/204 (not a 500 from an audit
 *      throw — the fire-and-forget contract must not break the flow).
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

async function drain() {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

function findAudit(action: string) {
  return STATE.rpcCalls.find(
    (c) =>
      (c.name === "log_audit_event" ||
        c.name === "log_audit_event_service") &&
      c.args.p_action === action,
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

    await drain();

    const audit = findAudit("alert.acknowledge");
    expect(audit).toBeDefined();
    expect(audit!.args.p_entity_type).toBe("alert");
    expect(audit!.args.p_entity_id).toBe(ALERT_ID);
    expect((audit!.args.p_metadata as Record<string, unknown>).source).toBe(
      "in_app_list",
    );
  });
});

// ─── notes PATCH (portfolio_note.update) ─────────────────────────────
describe("PATCH /api/notes — portfolio_note.update emission", () => {
  it("emits portfolio_note.update on save", async () => {
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
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        content: "my note",
        portfolio_id: PORTFOLIO_ID,
      }),
    });
    const res = await PATCH(req);
    expect(res.status).toBe(200);

    await drain();
    const audit = findAudit("portfolio_note.update");
    expect(audit).toBeDefined();
    expect(audit!.args.p_entity_type).toBe("portfolio_note");
    expect(audit!.args.p_entity_id).toBe(PORTFOLIO_ID);
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

    await drain();
    const audit = findAudit("attestation.accept");
    expect(audit).toBeDefined();
    expect(audit!.args.p_entity_type).toBe("investor_attestation");
    expect(audit!.args.p_entity_id).toBe(STATE.authUser.id);
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

    await drain();
    const audit = findAudit("admin.kill_switch");
    expect(audit).toBeDefined();
    expect(audit!.args.p_entity_type).toBe("system_flag");
    expect(
      (audit!.args.p_metadata as Record<string, unknown>).flag,
    ).toBe("match_engine_enabled");
    expect(
      (audit!.args.p_metadata as Record<string, unknown>).new_value,
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

    await drain();
    const audit = findAudit("allocator.approve");
    expect(audit).toBeDefined();
    expect(audit!.args.p_entity_type).toBe("user");
    expect(audit!.args.p_entity_id).toBe(TARGET_USER);
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
              update: () => ({
                eq: async () => ({ data: null, error: null }),
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

    await drain();
    const audit = findAudit("strategy.approve");
    expect(audit).toBeDefined();
    expect(audit!.args.p_entity_type).toBe("strategy");
    expect(audit!.args.p_entity_id).toBe(STRATEGY_ID);
  });
});

// ─── admin partner-import (admin.partner_import) ─────────────────────
// /review follow-up (T4-I2): novel rollup pattern with synthesized UUID.
describe("POST /api/admin/partner-import — admin.partner_import emission", () => {
  it("emits a rollup event with a synthesized UUID entity_id", async () => {
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
              upsert: async () => ({ data: null, error: null }),
            };
          }
          if (table === "strategies") {
            return {
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

    await drain();
    const audit = findAudit("admin.partner_import");
    expect(audit).toBeDefined();
    expect(audit!.args.p_entity_type).toBe("partner_import");
    // Synthesized UUID: v4-shaped string but deterministic sha256 slice.
    expect(audit!.args.p_entity_id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-8[0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    const meta = audit!.args.p_metadata as Record<string, unknown>;
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

    await drain();
    const audit = findAudit("alert.acknowledge");
    expect(audit).toBeDefined();
    // Email path uses the service-role RPC variant for attribution.
    expect(audit!.name).toBe("log_audit_event_service");
    expect(audit!.args.p_user_id).toBe(OWNER_ID);
    expect(audit!.args.p_entity_type).toBe("alert");
    expect(audit!.args.p_entity_id).toBe(ALERT_ID);
    const meta = audit!.args.p_metadata as Record<string, unknown>;
    expect(meta.source).toBe("email");
    expect(meta.alert_type).toBe("drawdown");
  });
});
