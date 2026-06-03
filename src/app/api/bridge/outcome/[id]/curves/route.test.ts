import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";

/**
 * Tests for GET /api/bridge/outcome/[id]/curves
 *
 * Coverage:
 *   TC1 — 401 when unauth: authUser=null -> status 401
 *   TC2 — 404 when outcome id not owned: user-scoped SELECT returns null
 *   TC3 — 400 when id missing
 *   TC4 — 200 happy path (original + replacement rebased to 100)
 *   TC5 — 200 windowing: dates capped at allocated_at+180d
 *   TC6 — 429 rate-limit; Retry-After header + limiter assertion (Voice-D10:
 *          bridgeOutcomeCurvesLimiter, NOT userActionLimiter)
 *   TC7 — 200 but empty original when match_decision_id is NULL
 */

// server-only guard (audit.ts / admin.ts precedent)
vi.mock("server-only", () => ({}));

type OutcomeRow = {
  id: string;
  allocator_id: string;
  strategy_id: string;
  match_decision_id: string | null;
  allocated_at: string | null;
};

type DecisionRow = {
  original_strategy_id: string | null;
};

type AnalyticsRow = {
  strategy_id: string;
  returns_series: Array<{ date: string; value: number }> | null;
};

const STATE = vi.hoisted(() => ({
  authUser: {
    id: "00000000-0000-0000-0000-000000000001",
  } as { id: string } | null,
  outcomeRow: null as OutcomeRow | null,
  decisionRow: null as DecisionRow | null,
  analyticsRows: [] as AnalyticsRow[],
  checkLimitResult: { success: true, retryAfter: 0 } as
    | { success: true }
    | { success: false; retryAfter: number },
  // Spy tracker for the Voice-D10 limiter-identity assertion
  lastLimiterArg: null as unknown,
  // H-0255: capture the per-user rate-limit KEY so a test can pin the
  // `bridge_outcome_curves:${userId}` bucket shape (per-user, not global).
  lastLimiterKey: null as string | null,
  // M-0300: count createAdminClient() instantiations so a test can prove
  // the admin client is NOT reached when the ownership gate fails.
  adminClientCreated: 0,
  // M-0307: when set, the strategy_analytics .in() query resolves with
  // this error so the route's 500 "Failed to load curves" branch is hit.
  analyticsError: null as { code?: string; message: string } | null,
  // H-0258: when set, the user-scoped bridge_outcomes SELECT resolves with
  // this error so the route's "real DB error -> 500, not a masked 404"
  // branch is exercised.
  outcomeError: null as { code?: string; message: string } | null,
  // H-0256 / M-0305: when set, the admin match_decisions SELECT resolves
  // with this error so the loud-fail (console.error, no silent swallow)
  // branch is exercised.
  decisionError: null as { code?: string; message: string } | null,
}));

// user-scoped supabase client: returns auth + outcomeRow from bridge_outcomes
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: {
      getUser: async () => ({
        data: { user: STATE.authUser },
        error: null,
      }),
    },
    from: (table: string) => {
      if (table === "bridge_outcomes") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({
                // H-0258: error injection for the real-DB-error branch.
                data: STATE.outcomeError ? null : STATE.outcomeRow,
                error: STATE.outcomeError,
              }),
            }),
          }),
        };
      }
      throw new Error(`unexpected from(${table}) on user-scoped client`);
    },
  }),
}));

// admin client: serves match_decisions lookup + strategy_analytics.
// M-0300: increment a counter on EVERY instantiation so the ownership-gate
// ordering invariant (admin client only after ownership proof) is assertable.
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => {
    STATE.adminClientCreated += 1;
    return {
      from: (table: string) => {
        if (table === "match_decisions") {
          return {
            select: () => ({
              eq: () => ({
                maybeSingle: async () => ({
                  // H-0256 / M-0305: error injection for the loud-fail branch.
                  data: STATE.decisionError ? null : STATE.decisionRow,
                  error: STATE.decisionError,
                }),
              }),
            }),
          };
        }
        if (table === "strategy_analytics") {
          return {
            select: () => ({
              in: async () => ({
                // M-0307: error injection for the 500 branch.
                data: STATE.analyticsError ? null : STATE.analyticsRows,
                error: STATE.analyticsError,
              }),
            }),
          };
        }
        throw new Error(`unexpected from(${table}) on admin client`);
      },
    };
  },
}));

// ratelimit mock: both limiters exported; checkLimit captures the limiter it
// was called with so TC6 can assert Voice-D10.
vi.mock("@/lib/ratelimit", () => ({
  userActionLimiter: { __name: "userActionLimiter" },
  bridgeOutcomeCurvesLimiter: { __name: "bridgeOutcomeCurvesLimiter" },
  checkLimit: async (limiter: unknown, id: string) => {
    STATE.lastLimiterArg = limiter;
    STATE.lastLimiterKey = id;
    return STATE.checkLimitResult;
  },
}));

// UUIDs
const OUTCOME_ID = "22222222-2222-4222-8222-222222222222";
const STRAT_ID = "33333333-3333-4333-8333-333333333333";
const ORIG_ID = "44444444-4444-4444-8444-444444444444";
const MATCH_DEC_ID = "55555555-5555-4555-8555-555555555555";
const ALLOCATED_AT = "2026-01-01";

function makeRequest(): NextRequest {
  return new NextRequest(
    `http://localhost:3000/api/bridge/outcome/${OUTCOME_ID}/curves`,
    { method: "GET" },
  );
}

function withParams(id: string) {
  return { params: Promise.resolve({ id }) };
}

beforeEach(() => {
  STATE.authUser = { id: "00000000-0000-0000-0000-000000000001" };
  STATE.outcomeRow = {
    id: OUTCOME_ID,
    allocator_id: "00000000-0000-0000-0000-000000000001",
    strategy_id: STRAT_ID,
    match_decision_id: MATCH_DEC_ID,
    allocated_at: ALLOCATED_AT,
  };
  STATE.decisionRow = { original_strategy_id: ORIG_ID };
  STATE.analyticsRows = [
    {
      strategy_id: STRAT_ID,
      returns_series: [
        { date: "2025-12-25", value: 90 }, // pre-anchor — filtered
        { date: "2026-01-01", value: 100 },
        { date: "2026-01-15", value: 105 },
        { date: "2026-03-01", value: 110 },
        { date: "2026-08-01", value: 130 }, // > 180d from anchor
      ],
    },
    {
      strategy_id: ORIG_ID,
      returns_series: [
        { date: "2026-01-01", value: 200 },
        { date: "2026-01-15", value: 198 },
        { date: "2026-03-01", value: 196 },
      ],
    },
  ];
  STATE.checkLimitResult = { success: true };
  STATE.lastLimiterArg = null;
  STATE.lastLimiterKey = null;
  STATE.adminClientCreated = 0;
  STATE.analyticsError = null;
  STATE.outcomeError = null;
  STATE.decisionError = null;
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("GET /api/bridge/outcome/[id]/curves", () => {
  it("TC1 — 401 when unauth: authUser=null -> status 401", async () => {
    STATE.authUser = null;
    const { GET } = await import("./route");
    const res = await GET(makeRequest(), withParams(OUTCOME_ID));
    expect(res.status).toBe(401);
  });

  it("TC2 — 404 when outcome id not owned: user-scoped SELECT returns null", async () => {
    STATE.outcomeRow = null;
    const { GET } = await import("./route");
    const res = await GET(makeRequest(), withParams(OUTCOME_ID));
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body).toEqual({ error: "Not found" });
  });

  it("TC3 — 400 when id missing: params.id empty -> status 400 + { error: 'id required' }", async () => {
    const { GET } = await import("./route");
    const res = await GET(makeRequest(), withParams(""));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body).toEqual({ error: "id required" });
  });

  it("TC4 — 200 on happy path: returns { original: Array<{date,nav}>, replacement: Array<{date,nav}>, allocated_at }", async () => {
    const { GET } = await import("./route");
    const res = await GET(makeRequest(), withParams(OUTCOME_ID));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body.original)).toBe(true);
    expect(Array.isArray(body.replacement)).toBe(true);
    // Rebased to 100 at allocated_at
    expect(body.original[0]).toEqual({ date: "2026-01-01", nav: 100 });
    expect(body.replacement[0]).toEqual({ date: "2026-01-01", nav: 100 });
    expect(body.allocated_at).toBe(ALLOCATED_AT);
  });

  it("TC5 — 200 windowing: returned dates are allocated_at..allocated_at+180d inclusive", async () => {
    const { GET } = await import("./route");
    const res = await GET(makeRequest(), withParams(OUTCOME_ID));
    const body = await res.json();
    const lastRepl = body.replacement[body.replacement.length - 1].date;
    // 180d window end = 2026-06-30. Data at 2026-03-01 should be in; 2026-08-01 out.
    expect(lastRepl <= "2026-06-30").toBe(true);
    const allDates = body.replacement.map(
      (p: { date: string; nav: number }) => p.date,
    );
    expect(allDates).not.toContain("2026-08-01");
  });

  it("TC6 — 429 rate-limit: checkLimitResult={success:false,retryAfter:60} -> status 429 + Retry-After header = '60' (Voice-D10: asserts bridgeOutcomeCurvesLimiter)", async () => {
    STATE.checkLimitResult = { success: false, retryAfter: 60 };
    const { GET } = await import("./route");
    const res = await GET(makeRequest(), withParams(OUTCOME_ID));
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBe("60");
    // Voice-D10: must call through bridgeOutcomeCurvesLimiter, not userActionLimiter
    expect(
      (STATE.lastLimiterArg as { __name?: string })?.__name,
    ).toBe("bridgeOutcomeCurvesLimiter");
  });

  it("TC6b — H-0255: the rate-limit bucket key is scoped PER USER as `bridge_outcome_curves:${userId}` (not a global key)", async () => {
    // The companion TC6 (mock returns deny → assert 429) is the C3
    // antipattern: it cannot fail unless the route deletes the limit
    // branch. This test pins the load-bearing property the 429 test does
    // NOT — that the limiter is applied PER USER. A regression that
    // hard-codes a constant key (e.g. `bridge_outcome_curves:global`)
    // would let one user's curve-exploration burn every other user's
    // budget; that regression fails this test even though TC6 stays green.
    const userA = "00000000-0000-0000-0000-00000000000a";
    STATE.authUser = { id: userA };
    STATE.outcomeRow = {
      id: OUTCOME_ID,
      allocator_id: userA,
      strategy_id: STRAT_ID,
      match_decision_id: MATCH_DEC_ID,
      allocated_at: ALLOCATED_AT,
    };
    const { GET } = await import("./route");
    const res = await GET(makeRequest(), withParams(OUTCOME_ID));
    expect(res.status).toBe(200);
    // The key must embed the authenticated user's id — proof the bucket
    // is per-user, not shared.
    expect(STATE.lastLimiterKey).toBe(`bridge_outcome_curves:${userA}`);

    // And a different user must get a DIFFERENT key (the property that
    // makes "per user" meaningful).
    const userB = "00000000-0000-0000-0000-00000000000b";
    STATE.authUser = { id: userB };
    STATE.outcomeRow = {
      id: OUTCOME_ID,
      allocator_id: userB,
      strategy_id: STRAT_ID,
      match_decision_id: MATCH_DEC_ID,
      allocated_at: ALLOCATED_AT,
    };
    const res2 = await GET(makeRequest(), withParams(OUTCOME_ID));
    expect(res2.status).toBe(200);
    expect(STATE.lastLimiterKey).toBe(`bridge_outcome_curves:${userB}`);
    expect(STATE.lastLimiterKey).not.toBe(`bridge_outcome_curves:${userA}`);
  });

  it("TC7 — 200 but empty original curves when match_decision_id is NULL: original=[]", async () => {
    STATE.outcomeRow = {
      id: OUTCOME_ID,
      allocator_id: "00000000-0000-0000-0000-000000000001",
      strategy_id: STRAT_ID,
      match_decision_id: null,
      allocated_at: ALLOCATED_AT,
    };
    const { GET } = await import("./route");
    const res = await GET(makeRequest(), withParams(OUTCOME_ID));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.original).toEqual([]);
    // replacement still populated
    expect(body.replacement.length).toBeGreaterThan(0);
  });

  it("TC8 — C-0080 cross-tenant guard: outcome owned by a different allocator -> 404 with NO curve payload leaked", async () => {
    // Simulate the failure mode: caller is user_A, but the outcome row's
    // allocator_id belongs to user_B. In a correctly-configured prod DB,
    // RLS would already mask this row — but the route must NOT rely solely
    // on RLS, because the admin client downstream bypasses it. If the
    // equality check is removed, this test must fail by returning a 200 +
    // curve arrays (confirmed by deletion-rebuild).
    STATE.authUser = { id: "00000000-0000-0000-0000-000000000001" };
    STATE.outcomeRow = {
      id: OUTCOME_ID,
      allocator_id: "99999999-9999-4999-8999-999999999999", // different tenant
      strategy_id: STRAT_ID,
      match_decision_id: MATCH_DEC_ID,
      allocated_at: ALLOCATED_AT,
    };
    const { GET } = await import("./route");
    const res = await GET(makeRequest(), withParams(OUTCOME_ID));
    expect(res.status).toBe(404);
    const body = await res.json();
    // Disclosure check: response is the opaque "Not found" error, never a
    // shape with original/replacement arrays. Any curve key in the response
    // means the cross-tenant guard has failed.
    expect(body).toEqual({ error: "Not found" });
    expect(body).not.toHaveProperty("original");
    expect(body).not.toHaveProperty("replacement");
    expect(body).not.toHaveProperty("allocated_at");
  });

  it("M-0300 — ownership-gate-FIRST: the admin client is never created when the user-scoped ownership SELECT returns null (404)", async () => {
    // T-05-01 mitigation: the route docstring promises ownership is proved
    // FIRST via a user-scoped SELECT, and ONLY AFTER ownership proof does it
    // hit the admin client. TC2 verifies the 404; this pins the ORDERING
    // invariant the comment warns about. A refactor that instantiated the
    // admin client before the ownership check would leave adminClientCreated
    // > 0 here and fail — exactly the regression class T-05-01 guards.
    STATE.outcomeRow = null; // user-scoped SELECT returns no owned row
    const { GET } = await import("./route");
    const res = await GET(makeRequest(), withParams(OUTCOME_ID));
    expect(res.status).toBe(404);
    // The admin client (which bypasses RLS) must NOT have been reached.
    expect(STATE.adminClientCreated).toBe(0);
  });

  it("M-0300b — ownership-gate-FIRST: cross-tenant outcome (owned by another allocator) → 404 without ever creating the admin client", async () => {
    // Companion to TC8: the C-0080 equality check rejects a cross-tenant
    // outcome UUID. Prove the admin-client hop is skipped on that path too,
    // so a future reorder that reads strategy_analytics before the tenant
    // check is caught.
    STATE.authUser = { id: "00000000-0000-0000-0000-000000000001" };
    STATE.outcomeRow = {
      id: OUTCOME_ID,
      allocator_id: "99999999-9999-4999-8999-999999999999",
      strategy_id: STRAT_ID,
      match_decision_id: MATCH_DEC_ID,
      allocated_at: ALLOCATED_AT,
    };
    const { GET } = await import("./route");
    const res = await GET(makeRequest(), withParams(OUTCOME_ID));
    expect(res.status).toBe(404);
    expect(STATE.adminClientCreated).toBe(0);
  });

  it("M-0306 — rebaseToAnchor takes the cumulative-NAV RATIO, never the sum-of-daily-returns", async () => {
    // route.ts Pitfall 2: series is CUMULATIVE equity, NOT daily returns —
    // each point is `100 * value / anchorValue`. TC4 only checks the anchor
    // is 100, which passes even under a sum-of-returns regression. This pins
    // the full non-trivial sequence so a regression that compounded or summed
    // the points would produce different navs and fail.
    //
    // Anchor value = 50. Ratio rebase → [100, 150, 200] (50→75→100 doubles).
    // A sum-of-daily-returns regression (100 + Σ deltas) would yield e.g.
    // [100, 125, 150] or compounded values — all ≠ the ratio output below.
    STATE.outcomeRow = {
      id: OUTCOME_ID,
      allocator_id: "00000000-0000-0000-0000-000000000001",
      strategy_id: STRAT_ID,
      match_decision_id: null, // isolate replacement series
      allocated_at: ALLOCATED_AT,
    };
    STATE.analyticsRows = [
      {
        strategy_id: STRAT_ID,
        returns_series: [
          { date: "2026-01-01", value: 50 }, // anchor
          { date: "2026-01-15", value: 75 }, // 75/50 = 1.5 → nav 150
          { date: "2026-03-01", value: 100 }, // 100/50 = 2.0 → nav 200
        ],
      },
    ];
    const { GET } = await import("./route");
    const res = await GET(makeRequest(), withParams(OUTCOME_ID));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.replacement).toEqual([
      { date: "2026-01-01", nav: 100 },
      { date: "2026-01-15", nav: 150 },
      { date: "2026-03-01", nav: 200 },
    ]);
  });

  it("M-0307 — analyticsErr 500 branch: a strategy_analytics fetch error returns 500, NOT a 200 with empty curves", async () => {
    // route.ts:169-172 returns 500 "Failed to load curves" when the
    // analytics query errors. No prior TC mutated the analytics mock to
    // error. Regression class: a refactor that swallowed the error and
    // returned 200 with empty arrays would make the UI render zero curves —
    // indistinguishable from a genuinely thin dataset. This proves a fetch
    // failure surfaces as a server error.
    STATE.analyticsError = { code: "PGRST301", message: "db timeout" };
    const { GET } = await import("./route");
    const res = await GET(makeRequest(), withParams(OUTCOME_ID));
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body).toEqual({ error: "Failed to load curves" });
    // Must NOT degrade to an empty-curve 200.
    expect(body).not.toHaveProperty("original");
    expect(body).not.toHaveProperty("replacement");
  });

  it("H-0258 — bridge_outcomes lookup ERROR returns 500 (logged), NOT a masked 404", async () => {
    // Loud-fail discipline: `if (outcomeErr || !outcome) return 404` used to
    // collapse a real DB/RLS error into a 404 with no log — an operator could
    // not tell "row not owned" from "the ownership SELECT itself blew up".
    // A non-null outcomeErr must surface as a 500 AND be logged. Reverting the
    // discrimination (folding the error back into the 404 branch) flips this
    // to a silent 404 and fails the test.
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    STATE.outcomeError = { code: "PGRST301", message: "rls/network blip" };
    const { GET } = await import("./route");
    const res = await GET(makeRequest(), withParams(OUTCOME_ID));
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body).toEqual({ error: "Failed to load curves" });
    // The lookup failure must be observable (logged), not swallowed.
    expect(errSpy).toHaveBeenCalledWith(
      "[api/bridge/outcome/curves] outcome lookup error:",
      STATE.outcomeError,
    );
    errSpy.mockRestore();
  });

  it("H-0258b — genuine 'not owned' (no error, null row) still returns the opaque 404", async () => {
    // Happy-path / empty-state intact: the discrimination must NOT turn a
    // legitimate not-found into a 500. With outcomeError=null and a null row,
    // the route returns the same opaque 404 it always did, and does NOT log
    // an outcome lookup error.
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    STATE.outcomeRow = null;
    STATE.outcomeError = null;
    const { GET } = await import("./route");
    const res = await GET(makeRequest(), withParams(OUTCOME_ID));
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body).toEqual({ error: "Not found" });
    expect(errSpy).not.toHaveBeenCalledWith(
      "[api/bridge/outcome/curves] outcome lookup error:",
      expect.anything(),
    );
    errSpy.mockRestore();
  });

  it("H-0256 / M-0305 — match_decisions lookup ERROR is logged, NOT silently swallowed as 'no original strategy'", async () => {
    // Loud-fail discipline: `if (!decisionErr && decision)` used to discard a
    // non-null decisionErr, leaving originalStrategyId=null and returning an
    // empty original series — indistinguishable from the legitimate
    // match_decision_id=NULL case. The resolution FAILED and must be observable.
    // We keep the response 200 (replacement curve is still valid) but a
    // console.error MUST fire. Reverting to the silent-swallow gate drops the
    // log and fails the assertion below.
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    STATE.decisionError = { code: "PGRST301", message: "admin client transient" };
    const { GET } = await import("./route");
    const res = await GET(makeRequest(), withParams(OUTCOME_ID));
    // Response stays 200 — replacement series is independently valid.
    expect(res.status).toBe(200);
    const body = await res.json();
    // Original resolution failed → empty original (the same shape as before)…
    expect(body.original).toEqual([]);
    expect(body.replacement.length).toBeGreaterThan(0);
    // …BUT the failure is now loud: it was logged, not swallowed.
    expect(errSpy).toHaveBeenCalledWith(
      "[api/bridge/outcome/curves] match_decisions lookup error:",
      STATE.decisionError,
    );
    errSpy.mockRestore();
  });

  it("M-0301 — a non-positive cumulative NAV at the anchor logs a data-quality breadcrumb (not a silent empty curve)", async () => {
    // The rebase anchor value is the cumulative NAV at allocated_at. If it is
    // <= 0 (a strategy whose equity went to/below zero), rebaseToAnchor returns
    // [] — previously indistinguishable at the UI from a genuine no-data empty
    // curve. The fix surfaces a stderr breadcrumb (mirroring the decisionErr/
    // analyticsErr posture) so the anomaly is observable. Removing the log
    // (reverting to a bare `return []`) drops the breadcrumb and fails here.
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    STATE.outcomeRow = {
      id: OUTCOME_ID,
      allocator_id: "00000000-0000-0000-0000-000000000001",
      strategy_id: STRAT_ID,
      match_decision_id: null, // isolate the replacement series
      allocated_at: ALLOCATED_AT,
    };
    STATE.analyticsRows = [
      {
        strategy_id: STRAT_ID,
        returns_series: [
          { date: "2026-01-01", value: 0 }, // anchor NAV is non-positive
          { date: "2026-01-15", value: 5 },
        ],
      },
    ];
    const { GET } = await import("./route");
    const res = await GET(makeRequest(), withParams(OUTCOME_ID));
    expect(res.status).toBe(200);
    const body = await res.json();
    // Series is still dropped (no response-shape change)…
    expect(body.replacement).toEqual([]);
    // …but the data-quality anomaly is now loud.
    expect(errSpy).toHaveBeenCalledWith(
      "[api/bridge/outcome/curves] rebase rejected: non-positive anchor NAV",
      { strategy_id: STRAT_ID, anchor_value: 0 },
    );
    errSpy.mockRestore();
  });

  it("M-0301b — a benign empty series (all points pre-anchor) does NOT fire the non-positive-anchor breadcrumb", async () => {
    // Guard against over-firing: the postAnchor.length===0 windowing case is a
    // legitimate empty result, NOT a data-quality anomaly — it must stay silent.
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    STATE.outcomeRow = {
      id: OUTCOME_ID,
      allocator_id: "00000000-0000-0000-0000-000000000001",
      strategy_id: STRAT_ID,
      match_decision_id: null,
      allocated_at: ALLOCATED_AT,
    };
    STATE.analyticsRows = [
      {
        strategy_id: STRAT_ID,
        returns_series: [
          { date: "2025-06-01", value: 100 }, // entirely before the anchor
          { date: "2025-09-01", value: 110 },
        ],
      },
    ];
    const { GET } = await import("./route");
    const res = await GET(makeRequest(), withParams(OUTCOME_ID));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.replacement).toEqual([]);
    expect(errSpy).not.toHaveBeenCalledWith(
      "[api/bridge/outcome/curves] rebase rejected: non-positive anchor NAV",
      expect.anything(),
    );
    errSpy.mockRestore();
  });

  it("H-0256b — legitimate match_decision_id=NULL stays SILENT (no spurious error log)", async () => {
    // The empty-state UX for the genuine NULL case (migration 059 ON DELETE
    // SET NULL) must NOT log a match_decisions lookup error — only a real
    // decisionErr does. This guards against the loud-fail fix over-firing.
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    STATE.outcomeRow = {
      id: OUTCOME_ID,
      allocator_id: "00000000-0000-0000-0000-000000000001",
      strategy_id: STRAT_ID,
      match_decision_id: null,
      allocated_at: ALLOCATED_AT,
    };
    const { GET } = await import("./route");
    const res = await GET(makeRequest(), withParams(OUTCOME_ID));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.original).toEqual([]);
    expect(errSpy).not.toHaveBeenCalledWith(
      "[api/bridge/outcome/curves] match_decisions lookup error:",
      expect.anything(),
    );
    errSpy.mockRestore();
  });
});
