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
                data: STATE.outcomeRow,
                error: null,
              }),
            }),
          }),
        };
      }
      throw new Error(`unexpected from(${table}) on user-scoped client`);
    },
  }),
}));

// admin client: serves match_decisions lookup + strategy_analytics
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: (table: string) => {
      if (table === "match_decisions") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({
                data: STATE.decisionRow,
                error: null,
              }),
            }),
          }),
        };
      }
      if (table === "strategy_analytics") {
        return {
          select: () => ({
            in: async () => ({
              data: STATE.analyticsRows,
              error: null,
            }),
          }),
        };
      }
      throw new Error(`unexpected from(${table}) on admin client`);
    },
  }),
}));

// ratelimit mock: both limiters exported; checkLimit captures the limiter it
// was called with so TC6 can assert Voice-D10.
vi.mock("@/lib/ratelimit", () => ({
  userActionLimiter: { __name: "userActionLimiter" },
  bridgeOutcomeCurvesLimiter: { __name: "bridgeOutcomeCurvesLimiter" },
  checkLimit: async (limiter: unknown, _id: string) => {
    STATE.lastLimiterArg = limiter;
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
});
