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
  // Real impl (exchange === "deribit") — the venue-aware re-check predicate
  // depends on it, and the mockAdminClient `api_keys` route supplies the
  // exchange, so mocking it faithfully keeps the ledger-vs-perp branch honest.
  isLedgerBackedExchange: (exchange: string | null | undefined) =>
    exchange === "deribit",
  STRATEGY_GATE_MIN_TRADES: 5,
  STRATEGY_GATE_MIN_CSV_ROWS: 7,
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
    recheckStatus:
      | "pending"
      | "computing"
      | "complete"
      | "complete_with_warnings"
      | "failed"
      | null;
    /** rows returned by the strategies UPDATE().eq().eq().select('id'). */
    updateAffected: Array<{ id: string }>;
    /** api_key_id from the re-check strategies read. Default "key-1" (exchange
     *  path). Pass null to exercise the CSV-sourced re-check branch. */
    recheckApiKeyId?: string | null;
    /** count returned by the re-check csv_daily_returns query (CSV path). */
    recheckCsvCount?: number;
    /** exchange returned by the first-pass api_keys lookup (P72 venue gate).
     *  Default "okx" (fill-based). Set "deribit" to exercise the keyed
     *  ledger-backed daily-returns branch. Inert when recheckApiKeyId is null. */
    mockKeyExchange?: string | null;
    /** when true, the first-pass api_keys exchange lookup returns an error, so
     *  the route must fail loud (503) rather than coercing isLedgerBacked=false. */
    mockKeyExchangeError?: boolean;
    /**
     * PUB-01 (Phase 87) — number of strategy_keys members. Default 0 (single-key
     * / CSV: SC-4 byte-unchanged path). When >= 1 the route's defense-in-depth
     * re-check consults the latest stitch_composite compute_jobs row.
     */
    strategyKeysCount?: number;
    /**
     * PUB-01 — status of the latest stitch_composite compute_jobs row (ordered
     * created_at DESC, limit 1). Default undefined (no row). Only consulted when
     * strategyKeysCount >= 1.
     */
    latestStitchJobStatus?:
      | "pending"
      | "running"
      | "done"
      | "done_pending_children"
      | "failed"
      | "failed_final"
      | undefined;
    /** when true, the strategy_keys head-count read errors → fail-loud 503. */
    strategyKeysCountError?: boolean;
    /** when true, the compute_jobs stitch-job lookup errors → fail-loud 503. */
    stitchJobLookupError?: boolean;
  };

  /** Tracks whether the route issued the compute_jobs read (SC-4 assertion). */
  type RecheckTracker = { computeJobsQueried: boolean };

  /**
   * Install an admin-client mock that routes from('trades') and
   * from('strategy_analytics') calls separately so the re-check sees
   * exactly the values this test wants, then a strategies UPDATE that
   * returns `updateAffected` to simulate row-match / no-match.
   */
  function mockAdminClient(opts: RecheckMock): RecheckTracker {
    const tracker: RecheckTracker = { computeJobsQueried: false };
    vi.doMock("@/lib/supabase/admin", () => ({
      createAdminClient: () => ({
        from: (table: string) => {
          if (table === "strategy_keys") {
            // PUB-01 defense-in-depth: head-count of composite members.
            // .select("api_key_id", { count, head }).eq("strategy_id", id)
            return {
              select: () => ({
                eq: async () =>
                  opts.strategyKeysCountError
                    ? { count: null, data: null, error: { message: "boom" } }
                    : {
                        count: opts.strategyKeysCount ?? 0,
                        data: null,
                        error: null,
                      },
              }),
            };
          }
          if (table === "compute_jobs") {
            // Only reached when strategyKeysCount >= 1 — recording the query
            // proves SC-4 (zero-member approve never consults it).
            tracker.computeJobsQueried = true;
            // .select("status").eq("strategy_id").eq("kind")
            //   .order("created_at",{ascending:false}).limit(1).maybeSingle()
            return {
              select: () => ({
                eq: () => ({
                  eq: () => ({
                    order: () => ({
                      limit: () => ({
                        maybeSingle: async () =>
                          opts.stitchJobLookupError
                            ? { data: null, error: { message: "boom" } }
                            : {
                                data:
                                  opts.latestStitchJobStatus === undefined
                                    ? null
                                    : { status: opts.latestStitchJobStatus },
                                error: null,
                              },
                      }),
                    }),
                  }),
                }),
              }),
            };
          }
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
          if (table === "csv_daily_returns") {
            // Re-check csv row count (CSV-sourced path). .select().eq()
            // resolves to a head:true count shape.
            return {
              select: () => ({
                eq: async () => ({
                  count: opts.recheckCsvCount ?? 0,
                  data: null,
                  error: null,
                }),
              }),
            };
          }
          if (table === "api_keys") {
            // P72 venue gate: first-pass exchange lookup
            // (.select("exchange").eq("id").maybeSingle()).
            return {
              select: () => ({
                eq: () => ({
                  maybeSingle: async () =>
                    opts.mockKeyExchangeError
                      ? { data: null, error: { message: "boom" } }
                      : {
                          data: { exchange: opts.mockKeyExchange ?? "okx" },
                          error: null,
                        },
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
                    api_key_id:
                      opts.recheckApiKeyId !== undefined
                        ? opts.recheckApiKeyId
                        : "key-1",
                    name: "Strat 1",
                    user_id: "user-1",
                    // M-1152: the post-approve manager-notify reads
                    // profiles.email (admin.from("profiles").select("email")
                    // routes through this fallthrough). Present so the notify
                    // branch is reachable; inert for every other test because
                    // notifyManagerApproved is a no-op mock by default.
                    email: "manager-e2e@test.local",
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
    return tracker;
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

  it("returns 200 when re-check sees complete_with_warnings (terminal success)", async () => {
    // mig 20260707120000: complete_with_warnings is a terminal SUCCESS the
    // first-pass strategyGate deny-list admits. The re-check MUST admit it too,
    // else a warned strategy passes the gate then 409s here — un-approvable.
    mockAdminClient({
      recheckTradeCount: 12,
      recheckStatus: "complete_with_warnings",
      updateAffected: [{ id: "strat-1" }],
    });
    const res = await postApprove();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
  });

  it("M-1152: logs a tagged console.error when the manager-approval notify throws", async () => {
    // The post-approve "your strategy was approved" email is fire-and-forget
    // (Promise.resolve(...).then(...).catch(...)) — the admin already has a 200
    // by the time it settles. A regression that dropped the .catch back to a
    // silent swallow would hide a broken notify side-effect with zero signal.
    // Force notifyManagerApproved to throw and assert the tagged console.error
    // fires. Neuter check: delete the route's notify-catch console.error and
    // this fails.
    mockAdminClient({
      recheckTradeCount: 12,
      recheckStatus: "complete",
      updateAffected: [{ id: "strat-1" }],
    });
    vi.doMock("@/lib/email", () => ({
      // ASYNC rejection — the real production failure mode (notifyManagerApproved
      // awaits send()). This only reaches the route's .catch() because the route
      // RETURNs the notify promise from its .then(); against the old no-`return`
      // code the rejection floats and this assertion fails (proving the fix).
      notifyManagerApproved: async () => {
        throw new Error("smtp down");
      },
    }));
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const res = await postApprove();
    expect(res.status).toBe(200);

    // Flush the fire-and-forget notify chain (resolve → then → notify → catch).
    await new Promise((r) => setTimeout(r, 0));

    expect(errSpy).toHaveBeenCalledWith(
      "[admin/strategy-review] manager-approval notify failed:",
      expect.anything(),
    );
    errSpy.mockRestore();
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

  // --- CSV-sourced re-check branch (no key, 0 trades, history in
  //     csv_daily_returns). The route re-derives isCsvSourced independently
  //     of the (mocked-passed) gate, so these guard the route's own logic —
  //     the branch that actually delivers the un-approvable-CSV fix. ---

  it("CSV strategy PASSES the re-check: no key + 0 trades + >=7 csv rows + analytics complete -> 200", async () => {
    // Regression guard for the whole PR: with 0 trades the `< MIN_TRADES`
    // branch would 409 an exchange strategy, but isCsvSourced must route to
    // the csv-row check (1112 >= 7) and let it publish.
    mockAdminClient({
      recheckApiKeyId: null,
      recheckTradeCount: 0,
      recheckCsvCount: 1112,
      recheckStatus: "complete",
      updateAffected: [{ id: "strat-1" }],
    });
    const res = await postApprove();
    expect(res.status).toBe(200);
    expect((await res.json()).success).toBe(true);
  });

  it("CSV strategy with < MIN_CSV_ROWS in the re-check -> 409 (CSV history threshold, not trade count)", async () => {
    mockAdminClient({
      recheckApiKeyId: null,
      recheckTradeCount: 0,
      recheckCsvCount: 3,
      recheckStatus: "complete",
      updateAffected: [{ id: "strat-1" }],
    });
    const res = await postApprove();
    expect(res.status).toBe(409);
    expect((await res.json()).error).toMatch(/CSV history fell below threshold/i);
  });

  it("CSV strategy at EXACTLY the 7-row floor in the re-check -> 200 (pins MIN_CSV_ROWS, not < 5)", async () => {
    mockAdminClient({
      recheckApiKeyId: null,
      recheckTradeCount: 0,
      recheckCsvCount: 7,
      recheckStatus: "complete",
      updateAffected: [{ id: "strat-1" }],
    });
    const res = await postApprove();
    expect(res.status).toBe(200);
  });

  // --- P72: keyed ledger-backed (Deribit) strategies. A CONNECTED api key on a
  //     ledger-backed venue with 0 trades and a csv_daily_returns series must
  //     take the re-check's daily-returns branch (not the trade-count branch).
  //     The mirror predicate uses `!api_key_id || isLedgerBacked` (venue-aware),
  //     matching the shared gate — a keyed FILL-based venue must NOT be diverted. ---

  it("keyed Deribit PASSES the re-check: ledger-backed key + 0 trades + >=7 csv rows + complete -> 200", async () => {
    // Pre-P72 the mirror predicate required !api_key_id, so a keyed Deribit
    // strategy (0 trades by construction) fell to the trade branch and 409'd.
    // The venue-aware term routes a LEDGER-BACKED key to the csv-row check
    // (30 >= 7) and lets it publish.
    mockAdminClient({
      recheckApiKeyId: "key-deribit",
      mockKeyExchange: "deribit",
      recheckTradeCount: 0,
      recheckCsvCount: 30,
      recheckStatus: "complete",
      updateAffected: [{ id: "strat-1" }],
    });
    const res = await postApprove();
    expect(res.status).toBe(200);
    expect((await res.json()).success).toBe(true);
  });

  it("keyed Deribit below the CSV floor in the re-check -> 409 (CSV threshold, not trade count)", async () => {
    mockAdminClient({
      recheckApiKeyId: "key-deribit",
      mockKeyExchange: "deribit",
      recheckTradeCount: 0,
      recheckCsvCount: 3,
      recheckStatus: "complete",
      updateAffected: [{ id: "strat-1" }],
    });
    const res = await postApprove();
    expect(res.status).toBe(409);
    expect((await res.json()).error).toMatch(/CSV history fell below threshold/i);
  });

  it("keyed FILL-based (perp) with 0 trades + csv series -> 409 trade count (Finding 1 regression guard)", async () => {
    // A keyed perp (non-ledger-backed) with 0 fills in-window but a funding
    // csv_daily_returns series must NOT be diverted to the csv branch and
    // published — its series has no completeness gate. isLedgerBacked=false
    // (exchange "okx") keeps it on the trade branch → 409 trade count.
    mockAdminClient({
      recheckApiKeyId: "key-perp",
      mockKeyExchange: "okx",
      recheckTradeCount: 0,
      recheckCsvCount: 30,
      recheckStatus: "complete",
      updateAffected: [{ id: "strat-1" }],
    });
    const res = await postApprove();
    expect(res.status).toBe(409);
    expect((await res.json()).error).toMatch(/trade count fell below threshold/i);
  });

  it("fails LOUD (503) when the api_keys exchange lookup errors (WR-01) — never coerces isLedgerBacked=false", async () => {
    // A transient api_keys read error must not silently set isLedgerBacked=false
    // and reject a legit Deribit onboarding with a misleading trade-count 400.
    mockAdminClient({
      recheckApiKeyId: "key-deribit",
      mockKeyExchangeError: true,
      recheckTradeCount: 0,
      recheckCsvCount: 30,
      recheckStatus: "complete",
      updateAffected: [{ id: "strat-1" }],
    });
    const res = await postApprove();
    expect(res.status).toBe(503);
    expect((await res.json()).error).toMatch(/verify strategy data source/i);
  });

  // --- PUB-01 (Phase 87) composite gate: OQ-1 defense-in-depth pure READ. A
  //     composite (api_key_id NULL, csv series) with >=1 strategy_keys member
  //     must, atop the isComputedAnalytics primary gate, require the LATEST
  //     stitch_composite compute_jobs row to be status='done'. Pure read — no
  //     re-derive, no write (LOCKED / Pitfall 4). Scoped to >=1 member so the
  //     single-key/CSV approve path is byte-unchanged (SC-4). ---

  it("PUB-01: composite with all-done members + complete_with_warnings publishes -> 200", async () => {
    // The success shape the plan pins explicitly: 2 members, latest
    // stitch_composite job 'done', analytics complete_with_warnings (terminal
    // success). The defense-in-depth read admits it → UPDATE fires → published.
    mockAdminClient({
      recheckApiKeyId: null,
      recheckTradeCount: 0,
      recheckCsvCount: 30,
      recheckStatus: "complete_with_warnings",
      strategyKeysCount: 2,
      latestStitchJobStatus: "done",
      updateAffected: [{ id: "strat-1" }],
    });
    const res = await postApprove();
    expect(res.status).toBe(200);
    expect((await res.json()).success).toBe(true);
  });

  it("PUB-01: composite whose latest stitch job is 'running' -> 409, never published", async () => {
    // Laundered-complete guard: computation_status reads complete but the
    // member-fan-out stitch job never finished. The pure read blocks publish
    // with a 409 BEFORE the UPDATE (updateAffected would give 200 if reached).
    mockAdminClient({
      recheckApiKeyId: null,
      recheckTradeCount: 0,
      recheckCsvCount: 30,
      recheckStatus: "complete",
      strategyKeysCount: 2,
      latestStitchJobStatus: "running",
      updateAffected: [{ id: "strat-1" }],
    });
    const res = await postApprove();
    expect(res.status).toBe(409);
    expect((await res.json()).error).toMatch(/composite computation is not complete/i);
  });

  it("PUB-01: composite with NO stitch_composite job row -> 409, never published", async () => {
    // No latest stitch job at all (absent) is treated identically to not-done:
    // a composite whose stitch generation is missing cannot publish.
    mockAdminClient({
      recheckApiKeyId: null,
      recheckTradeCount: 0,
      recheckCsvCount: 30,
      recheckStatus: "complete",
      strategyKeysCount: 2,
      latestStitchJobStatus: undefined,
      updateAffected: [{ id: "strat-1" }],
    });
    const res = await postApprove();
    expect(res.status).toBe(409);
    expect((await res.json()).error).toMatch(/composite computation is not complete/i);
  });

  it("PUB-01: fails LOUD (503) when the strategy_keys count read errors — never coerces to 0", async () => {
    // A transient strategy_keys read error must not coerce memberCount=0 and
    // silently skip the composite check (which could publish a holed composite).
    // Mirrors the csvCountError 503 guard.
    mockAdminClient({
      recheckApiKeyId: null,
      recheckTradeCount: 0,
      recheckCsvCount: 30,
      recheckStatus: "complete",
      strategyKeysCountError: true,
      updateAffected: [{ id: "strat-1" }],
    });
    const res = await postApprove();
    expect(res.status).toBe(503);
    expect((await res.json()).error).toMatch(/verify strategy data source/i);
  });

  it("SC-4: single-key approve (0 members) never issues the compute_jobs read", async () => {
    // The compute_jobs read is consulted ONLY when strategyKeysCount >= 1. A
    // single-key strategy (0 members, default) must reach 200 WITHOUT the route
    // ever querying compute_jobs — proving the composite path is inert for every
    // pre-existing single-key/CSV strategy.
    const tracker = mockAdminClient({
      recheckApiKeyId: "key-1",
      recheckTradeCount: 12,
      recheckStatus: "complete",
      // strategyKeysCount defaults to 0.
      updateAffected: [{ id: "strat-1" }],
    });
    const res = await postApprove();
    expect(res.status).toBe(200);
    expect((await res.json()).success).toBe(true);
    expect(tracker.computeJobsQueried).toBe(false);
  });
});

/**
 * M-0285 (testgap API2) — the route refactor collapsed 5 inline approve
 * error strings into one `Cannot approve: ${gate.reason}` interpolation
 * (route.ts:94). AdminTabs.tsx renders that string to the founder. A
 * regression that swapped gate.reason for gate.code (e.g.
 * "Cannot approve: INSUFFICIENT_TRADES") would degrade admin UX without
 * any existing test failing — the suites above all mock checkStrategyGate
 * to { passed: true }, so the real reason-string contract is unpinned.
 *
 * This suite vi.doUnmocks @/lib/strategyGate so the REAL gate runs, then
 * drives the admin client's first-pass gate queries to produce two
 * distinct failure reasons and asserts the human-readable string lands in
 * the 400 body verbatim (prefixed with "Cannot approve: ").
 */
describe("POST /api/admin/strategy-review — M-0285 gate.reason error shape", () => {
  const url = "http://localhost:3000/api/admin/strategy-review";

  beforeEach(() => {
    supabaseState.callCount = 0;
    delete process.env.UPSTASH_REDIS_REST_URL;
    delete process.env.UPSTASH_REDIS_REST_TOKEN;
    // Shared CSRF/rate-limit suite leaves a denying doMock on ratelimit and
    // the top-of-file mock on strategyGate. Undo both so the REAL gate runs
    // and requests aren't 429'd before reaching it.
    vi.doUnmock("@/lib/ratelimit");
    vi.doUnmock("@/lib/strategyGate");
    vi.resetModules();
  });

  type GateFixture = {
    apiKeyId: string | null;
    tradeCount: number;
    /** ISO timestamps for the earliest/latest trade span. */
    earliest: string;
    latest: string;
    computationStatus:
      | "pending"
      | "computing"
      | "complete"
      | "complete_with_warnings"
      | "failed"
      | null;
    computationError: string | null;
    /** csv_daily_returns row count. Composites (apiKeyId null) source history
     *  here — supply >=7 so the gate reaches the analytics-status arm. */
    csvRowCount?: number;
  };

  /**
   * Admin client that feeds the route's FIVE first-pass gate queries
   * (strategies.single, trades count head, earliest, latest,
   * strategy_analytics.single). The gate fails before the TOCTOU re-check
   * / UPDATE, so those paths are never reached.
   */
  function mockGateAdminClient(fx: GateFixture): void {
    vi.doMock("@/lib/supabase/admin", () => ({
      createAdminClient: () => ({
        from: (table: string) => {
          if (table === "trades") {
            return {
              select: (
                _cols: string,
                meta?: { count?: "exact"; head?: boolean },
              ) => ({
                eq: () => {
                  if (meta?.head) {
                    return Promise.resolve({
                      count: fx.tradeCount,
                      data: null,
                      error: null,
                    });
                  }
                  // earliest / latest probes — distinguished by sort dir,
                  // but for the gate both just need a [0].timestamp.
                  return {
                    order: (
                      _col: string,
                      opts: { ascending: boolean },
                    ) => ({
                      limit: () =>
                        Promise.resolve({
                          data: [
                            {
                              timestamp: opts.ascending
                                ? fx.earliest
                                : fx.latest,
                            },
                          ],
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
                      fx.computationStatus === null
                        ? null
                        : {
                            computation_status: fx.computationStatus,
                            computation_error: fx.computationError,
                          },
                    error: null,
                  }),
                }),
              }),
            };
          }
          if (table === "csv_daily_returns") {
            // Composite / CSV strategies source history here. .select().eq()
            // resolves to a head:true count shape.
            return {
              select: () => ({
                eq: async () => ({
                  count: fx.csvRowCount ?? 0,
                  data: null,
                  error: null,
                }),
              }),
            };
          }
          if (table === "api_keys") {
            // P72 venue gate: first-pass exchange lookup. Non-ledger ("okx")
            // keeps a keyed strategy on the trade branch, matching these gate
            // fixtures' trade/analytics reason-string expectations.
            return {
              select: () => ({
                eq: () => ({
                  maybeSingle: async () => ({
                    data: { exchange: "okx" },
                    error: null,
                  }),
                }),
              }),
            };
          }
          // strategies — first-pass single() lookup.
          return {
            select: () => ({
              eq: () => ({
                single: async () => ({
                  data: {
                    api_key_id: fx.apiKeyId,
                    name: "Strat 1",
                    user_id: "user-1",
                  },
                  error: null,
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
      body: JSON.stringify({ id: "strat-1", action: "approve" }),
    });
    return (mod.POST as (req: NextRequest) => Promise<Response>)(req);
  }

  it("returns 400 with the INSUFFICIENT_TRADES reason string (not the code) when trade_count=3", async () => {
    mockGateAdminClient({
      apiKeyId: "key-1",
      tradeCount: 3,
      earliest: "2026-01-01T00:00:00Z",
      latest: "2026-02-01T00:00:00Z",
      computationStatus: "complete",
      computationError: null,
    });
    const res = await postApprove();
    expect(res.status).toBe(400);
    const body = await res.json();
    // Human-readable reason, prefixed by the route's template.
    expect(body.error).toMatch(/^Cannot approve: /);
    expect(body.error).toMatch(/only 3 trade/i);
    // Regression guard: the stable CODE must NOT leak in place of the reason.
    expect(body.error).not.toContain("INSUFFICIENT_TRADES");
  });

  it("returns 400 with the ANALYTICS_FAILED reason string when computation_status='failed'", async () => {
    mockGateAdminClient({
      apiKeyId: "key-1",
      tradeCount: 50,
      earliest: "2026-01-01T00:00:00Z",
      latest: "2026-03-01T00:00:00Z", // > 7 day span
      computationStatus: "failed",
      computationError: null,
    });
    const res = await postApprove();
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/^Cannot approve: /);
    expect(body.error).toContain("Analytics computation failed");
    expect(body.error).not.toContain("ANALYTICS_FAILED");
  });

  it("PUB-01: a COMPOSITE (api_key_id NULL, csv series) with computation_status='failed' -> 400 blocked at the first-pass gate", async () => {
    // A composite routes down isDailyReturnsSourced (api_key_id NULL + 0 trades
    // + csv rows >= 7); a failed member fan-out surfaces as
    // computation_status='failed', which the first-pass gate blocks with
    // ANALYTICS_FAILED (400) BEFORE any UPDATE. Pins PUB-01's route direction
    // for composites at the first pass (previously implicit / untested).
    mockGateAdminClient({
      apiKeyId: null,
      tradeCount: 0,
      csvRowCount: 30,
      earliest: "2026-01-01T00:00:00Z",
      latest: "2026-03-01T00:00:00Z",
      computationStatus: "failed",
      computationError: null,
    });
    const res = await postApprove();
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/^Cannot approve: /);
    expect(body.error).toContain("Analytics computation failed");
    expect(body.error).not.toContain("ANALYTICS_FAILED");
  });
});

/**
 * B9 boundary-validation parity (M-1143) — the reject path wrote the raw
 * request-body `review_note` into strategies.review_note (unbounded TEXT) with
 * no length cap; only the audit-metadata copy was bounded. The route now Zod-
 * validates the body with `review_note: z.string().max(2000)`, rejecting an
 * oversized note at the boundary BEFORE the DB write.
 *
 * Fail-without-fix: pre-fix the route only checked `!id` + the action enum, so
 * id='strat-1'/action='reject' with a 2001-char note passed straight through to
 * the strategies UPDATE and returned 200 — the assertion below would see 200.
 */
describe("POST /api/admin/strategy-review — B9 M-1143 review_note length cap", () => {
  const url = "http://localhost:3000/api/admin/strategy-review";

  beforeEach(() => {
    supabaseState.callCount = 0;
    delete process.env.UPSTASH_REDIS_REST_URL;
    delete process.env.UPSTASH_REDIS_REST_TOKEN;
    // Allow the limiter through so a 400 can only come from body validation,
    // not from the shared suite's deny-everything ratelimit doMock.
    vi.doUnmock("@/lib/ratelimit");
    vi.resetModules();
  });

  it("rejects a review_note exceeding 2000 chars with 400 before any DB write", async () => {
    const mod = await import("./route");
    const req = new NextRequest(url, {
      method: "POST",
      headers: { origin: "http://localhost:3000" },
      body: JSON.stringify({
        id: "strat-1",
        action: "reject",
        review_note: "x".repeat(2001),
      }),
    });
    const res = await (mod.POST as (req: NextRequest) => Promise<Response>)(req);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/invalid request/i);
  });
});
