import { describe, it, expect, beforeEach, vi } from "vitest";
import { NextRequest } from "next/server";

/**
 * audit-2026-05-07 P198 + P200 — route-level coverage for the CSRF +
 * rate-limit sweep on /api/admin/strategy-review. See
 * intro-request/route.test.ts for the full pattern rationale and the
 * v0.22.24.1 I5 helper refactor.
 *
 * audit-2026-05-07 C-0060 — additional TOCTOU re-check coverage. The
 * approve path runs a final sequential gate (trade-count + analytics
 * status) immediately before the UPDATE and pins status='pending_review'
 * inside the UPDATE filter so a concurrent state change returns 409
 * rather than silently flipping the strategy to 'published'.
 */

vi.mock("server-only", () => ({}));

const TEST_USER = vi.hoisted(() => ({
  id: "00000000-0000-0000-0000-000000000125",
}));

const supabaseState = vi.hoisted(() => ({
  callCount: 0,
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => {
    supabaseState.callCount += 1;
    return {
      auth: {
        getUser: async () => ({ data: { user: TEST_USER }, error: null }),
      },
      rpc: async () => ({ data: null, error: null }),
      from: () => ({
        update: () => ({ eq: async () => ({ error: null }) }),
        select: () => ({
          eq: () => ({
            single: async () => ({ data: null, error: null }),
          }),
        }),
      }),
    };
  },
}));

vi.mock("@/lib/admin", () => ({
  isAdminUser: async () => true,
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: () => ({
      update: () => ({ eq: async () => ({ error: null }) }),
      select: () => ({
        eq: () => ({ single: async () => ({ data: null, error: null }) }),
      }),
    }),
  }),
}));

vi.mock("@/lib/email", () => ({
  notifyManagerApproved: async () => undefined,
}));

vi.mock("@/lib/strategyGate", () => ({
  checkStrategyGate: () => ({ passed: true }),
}));

import { runAdminPostCsrfRateLimitSuite } from "@/__tests__/helpers/adminPostCsrfRateLimit";

runAdminPostCsrfRateLimitSuite({
  path: "/api/admin/strategy-review",
  pNumber: "P198 + P200",
  validBody: { id: "abc", action: "approve" },
  importRoute: async () => {
    const mod = await import("./route");
    return { POST: mod.POST as (req: NextRequest) => Promise<Response> };
  },
  supabaseCallCount: supabaseState,
});

/**
 * audit-2026-05-07 C-0060 — TOCTOU re-check suite.
 *
 * Uses vi.resetModules() + vi.doMock so each test installs its own
 * admin-client mock that returns the trade count + analytics status it
 * wants the re-check to see. The first-pass gate (`@/lib/strategyGate`)
 * is stubbed to passed:true so we isolate the re-check behavior — the
 * shared helper above already covers gate-passes-through wiring.
 */
describe("POST /api/admin/strategy-review — C-0060 TOCTOU re-check", () => {
  const url = "http://localhost:3000/api/admin/strategy-review";
  const validApproveBody = { id: "strat-1", action: "approve" } as const;

  beforeEach(() => {
    supabaseState.callCount = 0;
    delete process.env.UPSTASH_REDIS_REST_URL;
    delete process.env.UPSTASH_REDIS_REST_TOKEN;
    // The shared CSRF/rate-limit suite above leaves vi.doMock for
    // `@/lib/ratelimit` registered (denying every call) — without an
    // explicit doUnmock, every test below would 429 before reaching the
    // gate logic we want to exercise.
    vi.doUnmock("@/lib/ratelimit");
    vi.resetModules();
  });

  type RecheckMock = {
    /** count returned by the final pre-UPDATE trades count query. */
    recheckTradeCount: number;
    /** computation_status returned by the final pre-UPDATE analytics query. */
    recheckStatus: "pending" | "computing" | "complete" | "failed" | null;
    /** rows returned by the strategies UPDATE().eq().eq().select('id'). */
    updateAffected: Array<{ id: string }>;
  };

  /**
   * Install an admin-client mock that routes from('trades') and
   * from('strategy_analytics') calls separately so the re-check sees
   * exactly the values this test wants, then a strategies UPDATE that
   * returns `updateAffected` to simulate row-match / no-match.
   */
  function mockAdminClient(opts: RecheckMock): void {
    vi.doMock("@/lib/supabase/admin", () => ({
      createAdminClient: () => ({
        from: (table: string) => {
          if (table === "trades") {
            return {
              // First-pass gate: head:true count + earliest/latest probes.
              select: (
                _cols: string,
                meta?: { count?: "exact"; head?: boolean },
              ) => ({
                eq: () => {
                  if (meta?.head) {
                    // count probe (used by both first-pass and re-check)
                    return Promise.resolve({
                      count: opts.recheckTradeCount,
                      data: null,
                      error: null,
                    });
                  }
                  // earliest/latest probes: any non-empty array passes
                  // the wizard-shape `[0]?.timestamp` access without
                  // tripping the < 7 days branch (matched timestamps =>
                  // span 0; checkStrategyGate is mocked passed:true).
                  return {
                    order: () => ({
                      limit: () =>
                        Promise.resolve({
                          data: [{ timestamp: new Date().toISOString() }],
                          error: null,
                        }),
                    }),
                  };
                },
              }),
            };
          }
          if (table === "strategy_analytics") {
            return {
              select: () => ({
                eq: () => ({
                  single: async () => ({
                    data:
                      opts.recheckStatus === null
                        ? null
                        : {
                            computation_status: opts.recheckStatus,
                            computation_error: null,
                          },
                    error: null,
                  }),
                }),
              }),
            };
          }
          // strategies — supports both the first-pass single() lookup
          // and the .update().eq().eq().select() write path.
          return {
            select: () => ({
              eq: () => ({
                single: async () => ({
                  data: {
                    api_key_id: "key-1",
                    name: "Strat 1",
                    user_id: "user-1",
                  },
                  error: null,
                }),
              }),
            }),
            update: () => ({
              eq: () => ({
                // reject path: single .eq('id')
                then: (resolve: (v: { error: null }) => unknown) =>
                  resolve({ error: null }),
                // approve path: .eq('id').eq('status').select('id')
                eq: () => ({
                  select: async () => ({
                    data: opts.updateAffected,
                    error: null,
                  }),
                }),
              }),
            }),
          };
        },
      }),
    }));
  }

  async function postApprove(): Promise<Response> {
    const mod = await import("./route");
    const req = new NextRequest(url, {
      method: "POST",
      headers: { origin: "http://localhost:3000" },
      body: JSON.stringify(validApproveBody),
    });
    return (mod.POST as (req: NextRequest) => Promise<Response>)(req);
  }

  it("returns 409 when re-check finds analytics no longer 'complete'", async () => {
    // Cron-sync set status back to 'computing' between the first-pass
    // gate and the UPDATE — the route MUST reject with 409 rather than
    // publishing a strategy whose computation is in flight.
    mockAdminClient({
      recheckTradeCount: 10,
      recheckStatus: "computing",
      updateAffected: [{ id: "strat-1" }],
    });
    const res = await postApprove();
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toMatch(/analytics no longer complete/i);
  });

  it("returns 409 when re-check finds trade count fell below 5", async () => {
    // Pathological case: trades were deleted (or a cleanup job ran)
    // after the first-pass gate passed. The route MUST refuse to
    // publish a strategy with insufficient data.
    mockAdminClient({
      recheckTradeCount: 3,
      recheckStatus: "complete",
      updateAffected: [{ id: "strat-1" }],
    });
    const res = await postApprove();
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toMatch(/trade count fell below threshold/i);
  });

  it("returns 200 when re-check sees complete analytics + >=5 trades", async () => {
    // Happy path: nothing changed between the first-pass gate and the
    // UPDATE, the row is still in pending_review, status flips to
    // published.
    mockAdminClient({
      recheckTradeCount: 12,
      recheckStatus: "complete",
      updateAffected: [{ id: "strat-1" }],
    });
    const res = await postApprove();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
  });

  it("returns 409 when status-pinning UPDATE matches 0 rows (strategy left pending_review)", async () => {
    // Another admin already approved/rejected this strategy. The
    // .eq('status', 'pending_review') filter matches 0 rows, and the
    // route surfaces a 409 instead of pretending success.
    mockAdminClient({
      recheckTradeCount: 10,
      recheckStatus: "complete",
      updateAffected: [],
    });
    const res = await postApprove();
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toMatch(/no longer awaiting review/i);
  });
});
