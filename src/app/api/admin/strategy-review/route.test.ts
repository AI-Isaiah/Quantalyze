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

/**
 * The suite's standard gate stub: passes every input, so the tests below
 * isolate the ROUTE's own reads and re-check logic. Factored out because two
 * C-3 cases install a THROWING doMock and `vi.doMock` persists for the rest of
 * the file — the TOCTOU beforeEach re-asserts this one before every test so no
 * case can inherit a previous case's gate.
 */
/**
 * C-3 gate behaviour switch — the ONE knob the two gate-refusal cases turn.
 *
 * Why this exists instead of a second `vi.doMock("@/lib/strategyGate", ...)`:
 * a second `doMock` for a path that `beforeEach` has ALREADY doMocked does not
 * reliably override at import time (this file's own §G9 docblock says so). When
 * it silently lost, the throwing factory never took, the standard pass:true stub
 * ran, and the route legitimately answered 200 — reddening
 * "StrategyGateUnevaluableError -> 503" with `expected 200 to be 503` on
 * whichever CI shard happened to lose the race, while passing in isolation and
 * on the other shard. The assertion was sound; the harness under it was not.
 *
 * `gateThrow` is read INSIDE the stub at call time, so there is exactly one
 * registered factory for the path and nothing to race. `beforeEach` clears it,
 * so no case can inherit the previous case's throw.
 *
 * Declared `var` deliberately: `vi.mock` is hoisted, and `var` hoists to
 * `undefined` (falsy) rather than a TDZ ReferenceError if the factory is ever
 * evaluated earlier than expected.
 */
// eslint-disable-next-line no-var
var gateThrow: (() => never) | null = null;

async function stubbedGateModule() {
  const actual =
    await vi.importActual<typeof import("@/lib/strategyGate")>(
      "@/lib/strategyGate",
    );
  return {
    checkStrategyGate: () => {
      if (gateThrow) gateThrow();
      return { passed: true };
    },
    // THE REAL IMPLEMENTATION, deliberately (SC-4). The TOCTOU re-check is the
    // subject of this suite's daily-returns cases, and it now CALLS this export
    // rather than restating it inline. Stubbing it would make every re-check
    // branch assertion below a test of the stub. `checkStrategyGate` above is
    // still stubbed — the first-pass gate is covered elsewhere and is isolated
    // here on purpose — but the shared predicate must be genuine.
    isDailyReturnsSourced: actual.isDailyReturnsSourced,
    STRATEGY_GATE_MIN_TRADES: 5,
    STRATEGY_GATE_MIN_CSV_ROWS: 7,
    // C-3: the route narrows its gate-refusal catch with `instanceof`, so this
    // must be the REAL class — a stub would make the narrowing vacuously false
    // and the arm untestable.
    StrategyGateUnevaluableError: actual.StrategyGateUnevaluableError,
  };
}

vi.mock("@/lib/strategyGate", () => stubbedGateModule());

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
    // Re-assert the standard gate stub: the two C-3 gate-refusal cases used to
    // install a THROWING doMock, and vi.doMock persists for the remainder of the
    // file. Without this, the next test in declaration order inherited the throw
    // — observed, not hypothetical (it reddened SC-4 on the first run).
    //
    // Those two cases now flip `gateThrow` instead (see its docblock), so the
    // reset below is what actually clears them; the doMock re-assert stays
    // because the CSRF/rate-limit suite above registers its own factories and
    // this keeps ONE known-good factory on the path.
    gateThrow = null;
    vi.doMock("@/lib/strategyGate", () => stubbedGateModule());
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
    /**
     * `strategy_analytics.series_completeness` returned by BOTH the first-pass
     * and the re-check analytics reads (MT5-11/12). This is what decides the
     * daily-returns branch now — the api_keys venue lookup it replaced is gone
     * from the route entirely.
     *
     * Default `null` — a row no producer has stamped, which is the honest
     * default and the fail-CLOSED one. A test that wants the daily-returns
     * branch must say which verdict earns it.
     */
    mockSeriesCompleteness?: string | null;
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
    // --- C-3 (140.4-01): read-failure toggles for the SEVEN first-pass /
    //     re-check reads that participate in the approve decision and had no
    //     `error` binding. Each must answer 503 about US with NO publish write. ---
    /** first-pass `strategies` lookup returns a read error. */
    strategyReadError?: boolean;
    /** first-pass `trades` head count returns a read error. */
    tradeCountError?: boolean;
    /** first-pass `trades` head count returns count:null with NO error. */
    tradeCountNull?: boolean;
    /** earliest-trade probe (order ascending) returns a read error. */
    earliestTradeError?: boolean;
    /** latest-trade probe (order descending) returns a read error. */
    latestTradeError?: boolean;
    /** first-pass `strategy_analytics` read returns a read error. */
    analyticsReadError?: boolean;
    /** TOCTOU re-check `trades` head count returns a read error. */
    recheckTradeCountError?: boolean;
    /** TOCTOU re-check `trades` head count returns count:null with NO error. */
    recheckTradeCountNull?: boolean;
    /** TOCTOU re-check `strategy_analytics` read returns a read error. */
    recheckAnalyticsError?: boolean;
  };

  /**
   * Tracks whether the route issued the compute_jobs read (SC-4 assertion) and
   * whether it issued the `strategies` UPDATE at all. The UPDATE tracker is the
   * load-bearing half of every 503 case below: a status-only assertion cannot
   * distinguish "refused before writing" from "wrote, then answered 503".
   * `tradesHeadCalls` / `analyticsReads` order-discriminate the first-pass read
   * from its TOCTOU re-check twin (the route issues them in that order).
   */
  type RecheckTracker = {
    computeJobsQueried: boolean;
    publishUpdateIssued: boolean;
    tradesHeadCalls: number;
    analyticsReads: number;
  };

  /**
   * Install an admin-client mock that routes from('trades') and
   * from('strategy_analytics') calls separately so the re-check sees
   * exactly the values this test wants, then a strategies UPDATE that
   * returns `updateAffected` to simulate row-match / no-match.
   */
  function mockAdminClient(opts: RecheckMock): RecheckTracker {
    const tracker: RecheckTracker = {
      computeJobsQueried: false,
      publishUpdateIssued: false,
      tradesHeadCalls: 0,
      analyticsReads: 0,
    };
    const READ_ERROR = { message: "boom" };
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
                    // count probe. The route issues the first-pass count
                    // before the TOCTOU re-check count, so call order
                    // discriminates the two.
                    tracker.tradesHeadCalls += 1;
                    const firstPass = tracker.tradesHeadCalls === 1;
                    if (firstPass ? opts.tradeCountError : opts.recheckTradeCountError) {
                      return Promise.resolve({
                        count: null,
                        data: null,
                        error: READ_ERROR,
                      });
                    }
                    if (firstPass ? opts.tradeCountNull : opts.recheckTradeCountNull) {
                      // count:null with NO error — equally unrepresentable.
                      return Promise.resolve({
                        count: null,
                        data: null,
                        error: null,
                      });
                    }
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
                  // Sort direction distinguishes earliest (ascending) from
                  // latest (descending) so each can fail independently.
                  return {
                    order: (
                      _col: string,
                      orderOpts: { ascending: boolean },
                    ) => ({
                      limit: () =>
                        Promise.resolve(
                          (
                            orderOpts.ascending
                              ? opts.earliestTradeError
                              : opts.latestTradeError
                          )
                            ? { data: null, error: READ_ERROR }
                            : {
                                data: [
                                  { timestamp: new Date().toISOString() },
                                ],
                                error: null,
                              },
                        ),
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
                  single: async () => {
                    // First-pass gate read precedes the TOCTOU re-check read.
                    tracker.analyticsReads += 1;
                    const firstPass = tracker.analyticsReads === 1;
                    if (
                      firstPass
                        ? opts.analyticsReadError
                        : opts.recheckAnalyticsError
                    ) {
                      return { data: null, error: READ_ERROR };
                    }
                    return {
                      data:
                        opts.recheckStatus === null
                          ? null
                          : {
                              computation_status: opts.recheckStatus,
                              computation_error: null,
                              // MT5-11/12 — the completeness verdict rides this
                              // same read at both passes (the route widened the
                              // column list rather than adding a query).
                              series_completeness:
                                opts.mockSeriesCompleteness ?? null,
                            },
                      error: null,
                    };
                  },
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
          // MT5-11/12 — the `api_keys` arm that used to live here is GONE with
          // the route's venue lookup. The gate no longer asks which exchange a
          // key points at; it reads the verdict the series' producer stamped.
          // strategies — supports both the first-pass single() lookup
          // and the .update().eq().eq().select() write path.
          return {
            select: () => ({
              eq: () => ({
                single: async () =>
                  // The strategies read error is scoped to `strategies`; the
                  // `profiles` notify read routes through this same
                  // fallthrough and must stay healthy.
                  opts.strategyReadError && table === "strategies"
                    ? { data: null, error: READ_ERROR }
                    : {
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
                      },
              }),
            }),
            update: () => {
              // C-3: the route issues exactly one `strategies` UPDATE, and it
              // is the publish write. Recording it here is what lets a 503 case
              // assert "refused BEFORE writing" rather than merely "answered 503".
              if (table === "strategies") tracker.publishUpdateIssued = true;
              return {
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
              };
            },
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
    // 140.3-G9 / SEAMUX-03 — one token for the whole 409 re-check fact class.
    expect(body.code).toBe("REVIEW_RECHECK_FAILED");
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
    expect(body.code).toBe("REVIEW_RECHECK_FAILED");
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
    // 140.3-G9 — this 409 was BEYOND the plan's four-arm floor; it is the same
    // re-check fact class (state changed during review), so the same token.
    expect(body.code).toBe("REVIEW_RECHECK_FAILED");
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
      mockSeriesCompleteness: "user_supplied",
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
      mockSeriesCompleteness: "user_supplied",
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
      mockSeriesCompleteness: "user_supplied",
      recheckStatus: "complete",
      updateAffected: [{ id: "strat-1" }],
    });
    const res = await postApprove();
    expect(res.status).toBe(200);
  });

  // --- MT5-11/12: the re-check's daily-returns branch is decided by the
  //     PERSISTED completeness verdict. A CONNECTED api key with 0 trades and a
  //     csv_daily_returns series takes that branch iff its series is certified;
  //     the venue is never consulted. Verdict literals below are HAND-TYPED —
  //     nothing is imported from strategyGate.ts (Oracle Independence).
  //
  //     SC-4: these cases run against the REAL exported predicate (see
  //     stubbedGateModule). What used to sit in the route here was a
  //     hand-written copy of the first-pass predicate, kept in step by a comment
  //     saying the two "must never diverge". They diverged. ---

  it("keyed ledger_complete PASSES the re-check: certified series + 0 trades + >=7 csv rows -> 200", async () => {
    // The MT5-11 unblock, through the path that actually publishes. A deal
    // ledger has no fills to fetch, so `trades` is empty by construction; the
    // combiner certifies the series and the re-check routes to the csv-row
    // check (30 >= 7) instead of 409ing on a trade count that is 0 by design.
    mockAdminClient({
      recheckApiKeyId: "key-1",
      mockSeriesCompleteness: "ledger_complete",
      recheckTradeCount: 0,
      recheckCsvCount: 30,
      recheckStatus: "complete",
      updateAffected: [{ id: "strat-1" }],
    });
    const res = await postApprove();
    expect(res.status).toBe(200);
    expect((await res.json()).success).toBe(true);
  });

  it("keyed ledger_complete below the CSV floor in the re-check -> 409 (CSV threshold, not trade count)", async () => {
    mockAdminClient({
      recheckApiKeyId: "key-1",
      mockSeriesCompleteness: "ledger_complete",
      recheckTradeCount: 0,
      recheckCsvCount: 3,
      recheckStatus: "complete",
      updateAffected: [{ id: "strat-1" }],
    });
    const res = await postApprove();
    expect(res.status).toBe(409);
    expect((await res.json()).error).toMatch(/CSV history fell below threshold/i);
  });

  it("⭐ D-15 through the PUBLISHING path: keyed perp with fill_derived_unproven + 30 csv rows -> 409 trade count", async () => {
    // The phase's safety property, asserted on the admin approve route rather
    // than only on the pure gate. A keyed perp with 0 fills in-window still has
    // a funding-only csv_daily_returns series; its producer stamped
    // `fill_derived_unproven` because the realized-PnL fetch had a gap.
    // Admitting it here would publish a materially understated track record.
    mockAdminClient({
      recheckApiKeyId: "key-perp",
      mockSeriesCompleteness: "fill_derived_unproven",
      recheckTradeCount: 0,
      recheckCsvCount: 30,
      recheckStatus: "complete",
      updateAffected: [{ id: "strat-1" }],
    });
    const res = await postApprove();
    expect(res.status).toBe(409);
    expect((await res.json()).error).toMatch(/trade count fell below threshold/i);
  });

  // --- SC-4 ORACLE PAIR. These two cases exist to red-pin the shared-predicate
  //     call. A hand-copy that kept the deleted `!approveApiKeyId` term passes
  //     the first and WRONGLY passes the second, because keylessness alone used
  //     to admit. Only the second can distinguish the two implementations. ---

  it("SC-4(a) COMPOSITE (api_key_id NULL) with composite_stitched is approvable end-to-end -> 200", async () => {
    // Composites passed historically via `!api_key_id`, the term this phase
    // deleted. They now depend on the stitch job stamping a verdict. If this
    // reds, no composite can ever be approved again.
    mockAdminClient({
      recheckApiKeyId: null,
      mockSeriesCompleteness: "composite_stitched",
      recheckTradeCount: 0,
      recheckCsvCount: 30,
      recheckStatus: "complete",
      updateAffected: [{ id: "strat-1" }],
    });
    const res = await postApprove();
    expect(res.status).toBe(200);
    expect((await res.json()).success).toBe(true);
  });

  it("SC-4(b) COMPOSITE with a NULL verdict is REFUSED -> 409 (the hand-copy would wrongly publish it)", async () => {
    mockAdminClient({
      recheckApiKeyId: null,
      mockSeriesCompleteness: null,
      recheckTradeCount: 0,
      recheckCsvCount: 30,
      recheckStatus: "complete",
      updateAffected: [{ id: "strat-1" }],
    });
    const res = await postApprove();
    expect(res.status).toBe(409);
    expect((await res.json()).error).toMatch(/trade count fell below threshold/i);
  });

  it("WR-01: a failing first-pass verdict read fails LOUD (503) — never a coerced-null verdict rendered as a gate refusal", async () => {
    // REPURPOSED from "fails LOUD when the api_keys exchange lookup errors":
    // that lookup no longer exists, but the property it pinned is unchanged and
    // now attaches to the read that replaced it. The verdict is the value that
    // selects the gate's branch, and `null` is a MEANINGFUL verdict here (fail
    // closed) — which is exactly why an UNREAD one must never be coerced into
    // it. A silent `series_completeness = null` would reject a legitimate
    // ledger-backed onboarding with a misleading "0 trades" message about the
    // manager's strategy, when the failure was ours.
    //
    // Distinct from the generic first-pass read-error case below: this one
    // pins the negative — the response must NOT be the gate-refusal 400.
    const tracker = mockAdminClient({
      analyticsReadError: true,
      recheckApiKeyId: "key-1",
      recheckTradeCount: 0,
      recheckCsvCount: 30,
      recheckStatus: "complete",
      updateAffected: [{ id: "strat-1" }],
    });
    const res = await postApprove();
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.error).toMatch(/verify strategy data source/i);
    // 140.3-G9 / SEAMUX-03 — one token for the whole source-read 503 fact class.
    expect(body.code).toBe("REVIEW_SOURCE_READ_FAILED");
    // The negative half: not a verdict ABOUT THE STRATEGY, and nothing written.
    expect(body.code).not.toBe("GUARD_BLOCKED");
    expect(tracker.publishUpdateIssued).toBe(false);
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
      // MT5-11/12 — a composite reaches the daily-returns branch on the stitch
      // job's verdict now, not on `!api_key_id`. Without it every PUB-01 case
      // below would 409 on a trade count that is 0 by construction, and the
      // composite gate under test would never be reached.
      mockSeriesCompleteness: "composite_stitched",
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
      mockSeriesCompleteness: "composite_stitched",
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
      mockSeriesCompleteness: "composite_stitched",
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
      mockSeriesCompleteness: "composite_stitched",
      recheckStatus: "complete",
      strategyKeysCountError: true,
      updateAffected: [{ id: "strat-1" }],
    });
    const res = await postApprove();
    expect(res.status).toBe(503);
    expect((await res.json()).error).toMatch(/verify strategy data source/i);
  });

  // --- C-3 (140.4-01): every read that participates in the approve decision
  //     must bind `error` and answer 503 ABOUT US, with NO publish write.
  //
  //     On the untouched tree the route destructured six members from the
  //     first-pass Promise.all and read `.error` on exactly one (csvCountError),
  //     so a failed read arrived as a VALUE indistinguishable from real data:
  //     supabase-js 2.110.1 resolves rather than throws. The sharpest instance
  //     is the earliest/latest pair — a failed timestamp read made the gate's
  //     span null, `spanDays !== null &&` skipped the entire 7-day check, and
  //     the route PUBLISHED an under-history track record as verified.
  //
  //     Every case asserts BOTH halves: the 503 status AND publishUpdateIssued
  //     === false. Status alone cannot see a route that writes and then 503s. ---

  const READ_FAILURE_503 = /verify strategy data source/i;

  it("first-pass strategies read error -> 503, no publish UPDATE", async () => {
    const tracker = mockAdminClient({
      strategyReadError: true,
      recheckTradeCount: 12,
      recheckStatus: "complete",
      updateAffected: [{ id: "strat-1" }],
    });
    const res = await postApprove();
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.error).toMatch(READ_FAILURE_503);
    // 140.3-G9 / SEAMUX-03 — the source-read 503 token, on a first-pass read.
    expect(body.code).toBe("REVIEW_SOURCE_READ_FAILED");
    expect(tracker.publishUpdateIssued).toBe(false);
  });

  it("first-pass trades COUNT read error -> 503, no publish UPDATE", async () => {
    const tracker = mockAdminClient({
      tradeCountError: true,
      recheckTradeCount: 12,
      recheckStatus: "complete",
      updateAffected: [{ id: "strat-1" }],
    });
    const res = await postApprove();
    expect(res.status).toBe(503);
    expect((await res.json()).error).toMatch(READ_FAILURE_503);
    expect(tracker.publishUpdateIssued).toBe(false);
  });

  it("first-pass trades count of NULL with no error -> 503, no publish UPDATE (`?? 0` is the fabrication)", async () => {
    // A null count coerced to 0 is a MEASUREMENT the route did not make. It
    // reaches the gate as "this strategy has zero trades", which is a claim
    // about the user's account, not about our read.
    const tracker = mockAdminClient({
      tradeCountNull: true,
      recheckTradeCount: 12,
      recheckStatus: "complete",
      updateAffected: [{ id: "strat-1" }],
    });
    const res = await postApprove();
    expect(res.status).toBe(503);
    expect(tracker.publishUpdateIssued).toBe(false);
  });

  it("EARLIEST-trade read error -> 503, no publish UPDATE (the C-3 publish-side fail-open)", async () => {
    // Untouched tree: 200 + status published. The failed read made spanDays
    // null and the 7-day gate was skipped entirely.
    const tracker = mockAdminClient({
      earliestTradeError: true,
      recheckTradeCount: 12,
      recheckStatus: "complete",
      updateAffected: [{ id: "strat-1" }],
    });
    const res = await postApprove();
    expect(res.status).toBe(503);
    expect((await res.json()).error).toMatch(READ_FAILURE_503);
    expect(tracker.publishUpdateIssued).toBe(false);
  });

  it("LATEST-trade read error -> 503, no publish UPDATE (second member of the class)", async () => {
    const tracker = mockAdminClient({
      latestTradeError: true,
      recheckTradeCount: 12,
      recheckStatus: "complete",
      updateAffected: [{ id: "strat-1" }],
    });
    const res = await postApprove();
    expect(res.status).toBe(503);
    expect((await res.json()).error).toMatch(READ_FAILURE_503);
    expect(tracker.publishUpdateIssued).toBe(false);
  });

  it("first-pass strategy_analytics read error -> 503, no publish UPDATE", async () => {
    const tracker = mockAdminClient({
      analyticsReadError: true,
      recheckTradeCount: 12,
      recheckStatus: "complete",
      updateAffected: [{ id: "strat-1" }],
    });
    const res = await postApprove();
    expect(res.status).toBe(503);
    expect((await res.json()).error).toMatch(READ_FAILURE_503);
    expect(tracker.publishUpdateIssued).toBe(false);
  });

  it("TOCTOU re-check trades count read error -> 503 (not a 409 about the strategy), no publish UPDATE", async () => {
    // Untouched tree answered 409 "trade count fell below threshold during
    // review" — a claim about the STRATEGY derived from a read that failed.
    const tracker = mockAdminClient({
      recheckTradeCountError: true,
      recheckTradeCount: 12,
      recheckStatus: "complete",
      updateAffected: [{ id: "strat-1" }],
    });
    const res = await postApprove();
    expect(res.status).toBe(503);
    expect((await res.json()).error).toMatch(READ_FAILURE_503);
    expect(tracker.publishUpdateIssued).toBe(false);
  });

  it("TOCTOU re-check trades count of NULL with no error -> 503, no publish UPDATE", async () => {
    const tracker = mockAdminClient({
      recheckTradeCountNull: true,
      recheckTradeCount: 12,
      recheckStatus: "complete",
      updateAffected: [{ id: "strat-1" }],
    });
    const res = await postApprove();
    expect(res.status).toBe(503);
    expect(tracker.publishUpdateIssued).toBe(false);
  });

  it("TOCTOU re-check strategy_analytics read error -> 503 (not a 409), no publish UPDATE", async () => {
    const tracker = mockAdminClient({
      recheckAnalyticsError: true,
      recheckTradeCount: 12,
      recheckStatus: "complete",
      updateAffected: [{ id: "strat-1" }],
    });
    const res = await postApprove();
    expect(res.status).toBe(503);
    expect((await res.json()).error).toMatch(READ_FAILURE_503);
    expect(tracker.publishUpdateIssued).toBe(false);
  });

  it("checkStrategyGate throwing StrategyGateUnevaluableError -> 503, no publish UPDATE", async () => {
    // Defence in depth: the guards above should make this unreachable from the
    // route's own reads. The arm exists so a future caller-side hole, or a
    // third consumer, cannot turn the gate's refusal into an unhandled 500 —
    // and so the refusal can never be swallowed into a pass.
    const tracker = mockAdminClient({
      recheckTradeCount: 12,
      recheckStatus: "complete",
      updateAffected: [{ id: "strat-1" }],
    });
    // Flip the ONE registered stub's behaviour rather than racing a second
    // doMock onto the same path (see `gateThrow`). The REAL error class, so the
    // route's `instanceof` narrowing is exercised rather than a look-alike.
    const actualGate =
      await vi.importActual<typeof import("@/lib/strategyGate")>(
        "@/lib/strategyGate",
      );
    gateThrow = () => {
      throw new actualGate.StrategyGateUnevaluableError(12);
    };
    const res = await postApprove();
    expect(res.status).toBe(503);
    expect((await res.json()).error).toMatch(READ_FAILURE_503);
    expect(tracker.publishUpdateIssued).toBe(false);
  });

  it("a non-gate throw from checkStrategyGate is NOT swallowed into a 503", async () => {
    // Narrowed catch: rethrow anything that is not the gate's refusal.
    // Swallowing an unknown throw here is how a fail-open comes back.
    mockAdminClient({
      recheckTradeCount: 12,
      recheckStatus: "complete",
      updateAffected: [{ id: "strat-1" }],
    });
    // Same switch as the case above — one registered factory, nothing to race.
    gateThrow = () => {
      throw new TypeError("something else entirely");
    };
    await expect(postApprove()).rejects.toThrow(/something else entirely/);
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
    /**
     * `strategy_analytics.series_completeness` (MT5-11/12). Default null —
     * fail closed. A fixture that wants the daily-returns branch must name the
     * verdict that earns it; keylessness alone no longer admits anything.
     */
    seriesCompleteness?: string | null;
    /**
     * C-3 (140.4-01) anti-over-refusal control. When true the
     * strategy_analytics `.single()` returns PostgREST's PGRST116 — "the result
     * contains 0 rows" — which is an ABSENCE, not a read failure: `data` is
     * null either way and the gate already has a verdict for it
     * (ANALYTICS_MISSING, 400, fail-CLOSED). A blanket 503 on any bound error
     * would turn a legitimate "sync your trades first" into an outage message.
     */
    analyticsNoRows?: boolean;
  };

  /** Records whether the route reached the `strategies` publish UPDATE. */
  type GateTracker = { publishUpdateIssued: boolean };

  /**
   * Admin client that feeds the route's FIVE first-pass gate queries
   * (strategies.single, trades count head, earliest, latest,
   * strategy_analytics.single). The gate fails before the TOCTOU re-check
   * / UPDATE, so those paths are never reached.
   */
  function mockGateAdminClient(fx: GateFixture): GateTracker {
    const tracker: GateTracker = { publishUpdateIssued: false };
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
                  single: async () =>
                    fx.analyticsNoRows
                      ? {
                          data: null,
                          // PostgREST's own no-rows code from `.single()`.
                          error: {
                            code: "PGRST116",
                            message:
                              "JSON object requested, multiple (or no) rows returned",
                          },
                        }
                      : {
                          data:
                            fx.computationStatus === null
                              ? null
                              : {
                                  computation_status: fx.computationStatus,
                                  computation_error: fx.computationError,
                                  series_completeness:
                                    fx.seriesCompleteness ?? null,
                                },
                          error: null,
                        },
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
          // MT5-11/12 — the `api_keys` venue lookup this arm served is gone from
          // the route. What kept these fixtures on the trade branch was the
          // non-ledger exchange "okx"; what keeps them there now is the absent
          // verdict (seriesCompleteness defaults to null → fail closed), which
          // is the same outcome reached for a better reason.
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
            // Present so "did the route reach the publish write?" is observable
            // rather than a TypeError. Every fixture in this suite must fail the
            // gate BEFORE it.
            update: () => {
              if (table === "strategies") tracker.publishUpdateIssued = true;
              return {
                eq: () => ({
                  eq: () => ({
                    select: async () => ({
                      data: [{ id: "strat-1" }],
                      error: null,
                    }),
                  }),
                  then: (resolve: (v: { error: null }) => unknown) =>
                    resolve({ error: null }),
                }),
              };
            },
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
    // 140.3-G9 / SEAMUX-03 — the gate refusal carries GUARD_BLOCKED (the union
    // member finalize-wizard stamps a publish-gate refusal with). The
    // machine `code` lives ALONGSIDE the human reason, never in place of it —
    // the reason stays the founder-facing prose (M-0285), the code is the
    // client discriminator.
    expect(body.code).toBe("GUARD_BLOCKED");
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

  it("C-3 anti-regression: a genuine short span still 400s with the gate's own INSUFFICIENT_DAYS sentence", async () => {
    // The twin of the fail-open. When the earliest/latest reads SUCCEED and the
    // span is genuinely 2 days, the answer is a verdict about the STRATEGY
    // (400), not a 503 about us — and no publish write is issued. If this ever
    // became a 503, the read-failure guards would have over-refused.
    const tracker = mockGateAdminClient({
      apiKeyId: "key-1",
      tradeCount: 50,
      earliest: "2026-04-01T00:00:00Z",
      latest: "2026-04-03T00:00:00Z", // 2.0 days
      computationStatus: "complete",
      computationError: null,
    });
    const res = await postApprove();
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/^Cannot approve: /);
    expect(body.error).toMatch(/span only 2\.0 day/i);
    expect(body.error).not.toContain("INSUFFICIENT_DAYS");
    expect(tracker.publishUpdateIssued).toBe(false);
  });

  it("C-3 anti-over-refusal: PGRST116 (no analytics row) is an ABSENCE -> 400 ANALYTICS_MISSING, never 503", async () => {
    // `.single()` reports "0 rows" as an error object. Treating that as a read
    // FAILURE would answer 503 to every manager who has not synced yet, and
    // would replace a useful instruction with an outage message. In both
    // PGRST116 shapes `data` is null, so the gate fails CLOSED (400) — the
    // carve-out can never produce a publish.
    const tracker = mockGateAdminClient({
      apiKeyId: "key-1",
      tradeCount: 50,
      earliest: "2026-01-01T00:00:00Z",
      latest: "2026-03-01T00:00:00Z",
      computationStatus: "complete",
      computationError: null,
      analyticsNoRows: true,
    });
    const res = await postApprove();
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/^Cannot approve: /);
    expect(body.error).toMatch(/have not been computed/i);
    expect(tracker.publishUpdateIssued).toBe(false);
  });

  it("PUB-01: a COMPOSITE (api_key_id NULL, csv series) with computation_status='failed' -> 400 blocked at the first-pass gate", async () => {
    // A composite routes down isDailyReturnsSourced (0 trades + csv rows >= 7 +
    // the stitch job's `composite_stitched` verdict); a failed member fan-out
    // surfaces as computation_status='failed', which the first-pass gate blocks
    // with ANALYTICS_FAILED (400) BEFORE any UPDATE. Pins PUB-01's route
    // direction for composites at the first pass.
    //
    // MT5-11/12 — the verdict is now what puts it on that branch (api_key_id
    // NULL alone no longer does). Without it the composite falls to the trade
    // branch and reports INSUFFICIENT_TRADES, so this case ALSO covers the
    // first pass of the SC-4 composite-approvability property, through the real
    // gate rather than the stub.
    mockGateAdminClient({
      apiKeyId: null,
      tradeCount: 0,
      csvRowCount: 30,
      seriesCompleteness: "composite_stitched",
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
    // 140.3-G9 / SEAMUX-03 — a boundary-shape rejection carries VALIDATION_FAILED.
    expect(body.code).toBe("VALIDATION_FAILED");
  });
});

// ══════════════════════════════════════════════════════════════════════════
// 140.4-16 / WR-04 — the scrub predicate, applied to a file the CLASS guard is
// structurally blind to.
// ══════════════════════════════════════════════════════════════════════════

describe("[140.4-16 / WR-04] no console site passes a caught value unscrubbed", () => {
  /**
   * ⚠️ WHY THIS GUARD IS COLOCATED AND NOT A ROSTER ENTRY.
   *
   * `seam-log-coverage.test.ts` derives its route roster from the SEAM IMPORT
   * EDGE — a file joins when it imports `analytics-client`, `resilient-fetch`
   * or `process-key-client`. This route imports none of them, so
   * `deriveSeamRouteFiles` cannot reach it and `it.each(SEAM_FILES)` never
   * inspects it. That derivation is correct and is this phase's flagship; the
   * honest response is not to smuggle a route into the file's HAND-TYPED **lib
   * module** half (a category error that would also make the derived-vs-typed
   * set equality assert something it does not mean), but to run the same
   * predicate here, where the file lives.
   *
   * The exposure is real, not theoretical. Plan 140.4-01 converted six
   * `Promise.all` members to checked reads — the C-3 fix — and every one of the
   * seven new `console.error` sites it added passes the raw PostgREST error
   * object straight into the log. Those objects carry `message` / `details` /
   * `hint`; a constraint-violation `details` string can contain row values,
   * which is precisely why `describeThrown`'s plain-object branch exists in
   * `seam-redaction.ts`. Five credential leaks have already been found in this
   * milestone.
   */
  const ROUTE = "src/app/api/admin/strategy-review/route.ts";

  /** Strip comments so a docblock quoting `console.error(err)` is not counted. */
  function stripComments(src: string): string {
    return src
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/(^|[^:])\/\/[^\n]*/g, "$1");
  }

  it("every console.* argument that is an error binding goes through scrubSeamError", async () => {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const src = stripComments(
      readFileSync(join(process.cwd(), ROUTE), "utf8"),
    );

    // Every `console.<level>( ... )` call, arguments captured to the closing
    // paren of the call. Route sites are short and never nest a paren-heavy
    // expression, so a non-greedy scan to `);` is sufficient here — and the
    // vacuity fence below proves the scan found them.
    const calls = [...src.matchAll(/console\.\w+\(([\s\S]*?)\);/g)].map(
      (m) => m[1],
    );

    // VACUITY FENCE. A scan that matches nothing reports compliance forever.
    expect(
      calls.length,
      "the console scan found nothing — every assertion below is vacuous",
    ).toBeGreaterThanOrEqual(13);

    // An "error binding" is any identifier this route binds off a Supabase read
    // or a catch. Naming the SHAPE rather than the identifiers keeps the guard
    // from going stale the moment a new read is added.
    const ERRORISH = /\b([A-Za-z_$][\w$]*(?:[eE]rr|[eE]rror)\w*)\b/;
    const offenders: string[] = [];
    for (const args of calls) {
      const m = ERRORISH.exec(args);
      if (!m) continue;
      // `?? "..."` fallbacks and `.code` reads are allowlisted for the same
      // reason the class guard allowlists them: a five-character SQLSTATE and a
      // hand-typed string carry nothing.
      if (!/scrubSeamError\s*\(/.test(args)) {
        offenders.push(args.trim().replace(/\s+/g, " ").slice(0, 90));
      }
    }

    expect(
      offenders,
      "a caught value or PostgREST error object reaches console.* unscrubbed. " +
        "undici embeds OUTGOING HEADERS in err.message, and a PostgREST error " +
        "carries `details`/`hint` which can contain row values. Wrap it: " +
        "scrubSeamError(x) from @/lib/seam-redaction. Do NOT answer this by " +
        "dropping the value — that is the A-10 defect.",
    ).toEqual([]);
  });
});

// ══════════════════════════════════════════════════════════════════════════
// 140.3-G9 / SEAMUX-03 — the machine `code` on every arm this route emits.
// ══════════════════════════════════════════════════════════════════════════

/**
 * WHY (Rule 9). This route is the TENTH seam-importing production route — the
 * one the 140.3-VERIFICATION nine-route list MISSED (instance-not-class hazard).
 * A dropped `code` is a client-discrimination regression on the admin review
 * surface: 140.3-12 reserves the right to reword the human prose, so a consumer
 * that branches on the sentence breaks the day it does. These assertions run
 * against the PARSED RESPONSE BODY of the invoked handler — the wiring, not a
 * helper — so a code removed from an arm reddens here.
 *
 * The auth/throttle arms (401/403/429) are code-asserted ONLY here: the shared
 * `runAdminPostCsrfRateLimitSuite` above drives them but predates SEAMUX-03 and
 * asserts status only. The 503 / 409 / GUARD_BLOCKED / VALIDATION_FAILED classes
 * gain their `body.code` expectations in the suites where their fixtures already
 * live (C-0060, M-0285, B9). The arm-agnostic fence at the bottom is the
 * every-arm guarantee: it reads the route source and fails if ANY non-2xx arm
 * ships without a `code` — the check that survives a new arm being added.
 */
/**
 * Auth/throttle baseline driven by ONE hoisted state object per module, not by
 * competing per-test doMocks. vitest keeps doMock registrations across
 * resetModules and a second doMock for the same path does not reliably override
 * the first within a generation, so the null-user / non-admin / deny-limiter
 * cases are expressed as MUTATIONS of `g9` that a single stable factory reads at
 * import time. beforeEach resets `g9`, so no case leaks into the next.
 */
const g9 = vi.hoisted(() => ({
  user: null as unknown,
  isAdmin: true,
  denyLimiter: false,
}));

describe("POST /api/admin/strategy-review — 140.3-G9 SEAMUX-03 machine codes", () => {
  const url = "http://localhost:3000/api/admin/strategy-review";

  beforeEach(() => {
    vi.resetModules();
    delete process.env.UPSTASH_REDIS_REST_URL;
    delete process.env.UPSTASH_REDIS_REST_TOKEN;
    // Authed-admin, healthy-limiter baseline. Tests mutate g9 before post().
    g9.user = TEST_USER;
    g9.isAdmin = true;
    g9.denyLimiter = false;
    // One factory per module, reading the live g9 fields. A doMock overrides the
    // top-of-file vi.mock; reverting via doUnmock would hit the real
    // supabase/server and read the request-scoped cookie store outside a request.
    vi.doMock("@/lib/supabase/server", () => ({
      createClient: async () => ({
        auth: {
          getUser: async () => ({ data: { user: g9.user }, error: null }),
        },
      }),
    }));
    vi.doMock("@/lib/admin", () => ({ isAdminUser: async () => g9.isAdmin }));
    vi.doMock("@/lib/ratelimit", () => ({
      adminActionLimiter: {},
      checkLimit: async () =>
        g9.denyLimiter
          ? { success: false, retryAfter: 7 }
          : { success: true, retryAfter: 0 },
    }));
    vi.doMock("@/lib/strategyGate", () => stubbedGateModule());
  });

  async function post(body: unknown): Promise<Response> {
    const mod = await import("./route");
    const req = new NextRequest(url, {
      method: "POST",
      headers: { origin: "http://localhost:3000" },
      body: JSON.stringify(body),
    });
    return (mod.POST as (req: NextRequest) => Promise<Response>)(req);
  }

  it("401 unauthenticated → code UNAUTHENTICATED (auth verdict only, no seam state)", async () => {
    g9.user = null;
    const res = await post({ id: "abc", action: "approve" });
    expect(res.status).toBe(401);
    const b = await res.json();
    expect(b.error).toBe("Unauthorized");
    expect(b.code).toBe("UNAUTHENTICATED");
  });

  it("403 forbidden → code FORBIDDEN (a non-admin learns nothing beyond the status)", async () => {
    g9.isAdmin = false;
    const res = await post({ id: "abc", action: "approve" });
    expect(res.status).toBe(403);
    const b = await res.json();
    expect(b.error).toBe("Forbidden");
    expect(b.code).toBe("FORBIDDEN");
  });

  it("429 our-limiter refusal → code RATE_LIMITED", async () => {
    g9.denyLimiter = true;
    const res = await post({ id: "abc", action: "approve" });
    expect(res.status).toBe(429);
    const b = await res.json();
    expect(b.error).toBe("Too many requests");
    expect(b.code).toBe("RATE_LIMITED");
    // Additive-only: the Retry-After header the arm already carried survives.
    expect(res.headers.get("Retry-After")).toBe("7");
  });

  it("400 malformed action → code VALIDATION_FAILED (zod boundary, before the limiter)", async () => {
    const res = await post({ id: "abc", action: "bogus" });
    expect(res.status).toBe(400);
    const b = await res.json();
    expect(b.error).toMatch(/invalid request/i);
    expect(b.code).toBe("VALIDATION_FAILED");
  });

  it("400 non-object body → code VALIDATION_FAILED", async () => {
    const res = await post([1, 2, 3]);
    expect(res.status).toBe(400);
    const b = await res.json();
    expect(b.code).toBe("VALIDATION_FAILED");
  });

  it("ARM-AGNOSTIC FENCE: every non-2xx NextResponse.json arm carries a string `code`", async () => {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const src = readFileSync(
      join(process.cwd(), "src/app/api/admin/strategy-review/route.ts"),
      "utf8",
    );
    // Capture each NextResponse.json(body, { status: NNN ... }): the body object
    // (non-greedy to the `}, { status:` boundary — which correctly steps past the
    // `${gate.reason}` brace in the interpolated 400 arm) and its 3-digit status.
    // The lone 200 arm `NextResponse.json({ success: true })` has no status arg
    // and is excluded by construction.
    const arms = [
      ...src.matchAll(
        /NextResponse\.json\(\s*(\{[\s\S]*?\}),\s*\{\s*status:\s*(\d{3})/g,
      ),
    ];
    // VACUITY FENCE — a scan that matches nothing reports compliance forever.
    expect(
      arms.length,
      "the arm scan found nothing — the fence is vacuous",
    ).toBeGreaterThanOrEqual(25);

    const offenders: string[] = [];
    for (const [, bodyLiteral, status] of arms) {
      if (Number(status) < 300) continue; // 2xx arms need no code
      if (!/\bcode:\s*"/.test(bodyLiteral)) {
        offenders.push(
          `status ${status}: ${bodyLiteral.replace(/\s+/g, " ").slice(0, 80)}`,
        );
      }
    }
    expect(
      offenders,
      "a non-2xx arm reaches the client with no machine `code` — the SEAMUX-03 " +
        "client-discrimination regression this route was the 10th to close.",
    ).toEqual([]);
  });
});
