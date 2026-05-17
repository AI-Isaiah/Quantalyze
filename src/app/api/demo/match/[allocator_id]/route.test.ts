import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

/**
 * Tests for GET /api/demo/match/[allocator_id] — audit-2026-05-07
 * cluster A.
 *
 * Coverage anchors:
 *   - C-0082 (pr-test-analyzer c9): 403 for non-seed allocator UUIDs
 *     (STALLED + COLD allocator IDs + 'admin' path-traversal-like
 *     strings + uppercase variant).
 *   - C-0081 (red-team c7): publicIpLimiter wired; 429 when over budget.
 *   - C-0084 / C-0085 (security / red-team c7): exploratory candidate
 *     rows have name / user_id / aum / max_capacity stripped in the
 *     response. Institutional rows pass through unchanged. Exploratory
 *     rows with a codename also pass through.
 */

vi.mock("server-only", () => ({}));

const SEED_UUID = "aaaaaaaa-0001-4000-8000-000000000002";

const STATE = vi.hoisted(() => ({
  checkLimitResult: { success: true } as
    | { success: true }
    | { success: false; retryAfter: number; reason?: string },
  payload: {
    profile: null,
    preferences: null,
    batch: null,
    candidates: [] as Array<Record<string, unknown>>,
    excluded: [] as Array<Record<string, unknown>>,
    decisions: [] as Array<Record<string, unknown>>,
    existing_contact_requests: [],
  } as Record<string, unknown>,
  throwFromHelper: null as Error | null,
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({}),
}));

vi.mock("@/lib/admin/match", () => ({
  getAllocatorMatchPayload: async () => {
    if (STATE.throwFromHelper) throw STATE.throwFromHelper;
    return STATE.payload;
  },
}));

vi.mock("@/lib/ratelimit", () => ({
  publicIpLimiter: {},
  checkLimit: async () => STATE.checkLimitResult,
  getClientIp: (headers: Headers) =>
    headers.get("x-real-ip") ||
    headers.get("x-forwarded-for")?.split(",").pop()?.trim() ||
    "unknown",
  isRateLimitMisconfigured: (rl: { success: boolean; reason?: string }) =>
    rl.success === false && rl.reason === "ratelimit_misconfigured",
}));

import { GET } from "./route";

function buildRequest(headers: Record<string, string> = {}): NextRequest {
  return new NextRequest("https://example.com/api/demo/match/x", { headers });
}

function callRoute(allocatorId: string) {
  return GET(buildRequest(), {
    params: Promise.resolve({ allocator_id: allocatorId }),
  });
}

beforeEach(() => {
  STATE.checkLimitResult = { success: true };
  STATE.payload = {
    profile: null,
    preferences: null,
    batch: null,
    candidates: [],
    excluded: [],
    decisions: [],
    existing_contact_requests: [],
  };
  STATE.throwFromHelper = null;
});

describe("GET /api/demo/match/[allocator_id] — audit-2026-05-07 cluster A", () => {
  it("C-0082: 403 for STALLED allocator UUID (non-seed)", async () => {
    const res = await callRoute("aaaaaaaa-0001-4000-8000-000000000003");
    expect(res.status).toBe(403);
  });

  it("C-0082: 403 for COLD allocator UUID (non-seed)", async () => {
    const res = await callRoute("aaaaaaaa-0001-4000-8000-000000000001");
    expect(res.status).toBe(403);
  });

  it("C-0082: 403 for uppercase variant of seed UUID (no case folding)", async () => {
    const res = await callRoute(SEED_UUID.toUpperCase());
    expect(res.status).toBe(403);
  });

  it("C-0082: 403 for path-traversal-like strings", async () => {
    const res = await callRoute("../admin/match/x");
    expect(res.status).toBe(403);
  });

  it("C-0082: 200 for the pinned seed UUID", async () => {
    const res = await callRoute(SEED_UUID);
    expect(res.status).toBe(200);
  });

  it("C-0081: 429 when publicIpLimiter denies + Retry-After", async () => {
    STATE.checkLimitResult = { success: false, retryAfter: 30 };
    const res = await callRoute(SEED_UUID);
    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toBe("30");
  });

  it("C-0081: 503 when rate limiter is misconfigured (Upstash safety-valve)", async () => {
    // Phase-2 testing finding (route.test.ts:57): the 503
    // ratelimit_misconfigured branch is the production safety-valve for
    // Upstash misconfiguration — without coverage, a future refactor
    // that reverses the if-order (returning 429 first then never
    // reaching the 503 branch) would land green.
    STATE.checkLimitResult = {
      success: false,
      retryAfter: 30,
      reason: "ratelimit_misconfigured",
    };
    const res = await callRoute(SEED_UUID);
    expect(res.status).toBe(503);
    expect(res.headers.get("retry-after")).toBe("30");
  });

  it("C-0084 / C-0085: exploratory candidate without codename is masked", async () => {
    STATE.payload.candidates = [
      {
        id: "cand-1",
        strategy_id: "strat-1",
        strategies: {
          id: "strat-1",
          name: "SECRET-STRATEGY-NAME",
          codename: null,
          disclosure_tier: "exploratory",
          user_id: "user-uuid-aaaa",
          aum: 50000000,
          max_capacity: 100000000,
          strategy_types: ["macro"],
          supported_exchanges: ["okx"],
        },
      },
    ];
    const res = await callRoute(SEED_UUID);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      candidates: Array<{ strategies: Record<string, unknown> }>;
    };
    const strat = body.candidates[0].strategies;
    expect(strat.name).toMatch(/^Exploratory #/);
    expect(strat.user_id).toBeNull();
    expect(strat.aum).toBeNull();
    expect(strat.max_capacity).toBeNull();
    // Non-PII metadata still passes through.
    expect(strat.strategy_types).toEqual(["macro"]);
    expect(strat.disclosure_tier).toBe("exploratory");
  });

  it("C-0084 / C-0085: exploratory candidate WITH codename passes through unchanged", async () => {
    STATE.payload.candidates = [
      {
        id: "cand-2",
        strategy_id: "strat-2",
        strategies: {
          id: "strat-2",
          name: "Internal Real Name",
          codename: "BLUEBIRD",
          disclosure_tier: "exploratory",
          user_id: "user-uuid-bbbb",
          aum: 10000000,
          max_capacity: 50000000,
        },
      },
    ];
    const res = await callRoute(SEED_UUID);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      candidates: Array<{ strategies: Record<string, unknown> }>;
    };
    // codename present → manager has opted into pseudonymous display
    // → all fields pass through unchanged.
    expect(body.candidates[0].strategies.name).toBe("Internal Real Name");
    expect(body.candidates[0].strategies.user_id).toBe("user-uuid-bbbb");
  });

  it("C-0084 / C-0085: institutional candidate passes through unchanged", async () => {
    STATE.payload.candidates = [
      {
        id: "cand-3",
        strategy_id: "strat-3",
        strategies: {
          id: "strat-3",
          name: "Acme Macro Fund",
          codename: null,
          disclosure_tier: "institutional",
          user_id: "user-uuid-cccc",
          aum: 100000000,
          max_capacity: 500000000,
        },
      },
    ];
    const res = await callRoute(SEED_UUID);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      candidates: Array<{ strategies: Record<string, unknown> }>;
    };
    expect(body.candidates[0].strategies.name).toBe("Acme Macro Fund");
    expect(body.candidates[0].strategies.user_id).toBe("user-uuid-cccc");
    expect(body.candidates[0].strategies.aum).toBe(100000000);
  });

  it("masking applies to `excluded` and `decisions` arrays too", async () => {
    const exploratory = {
      id: "strat-x",
      name: "Hidden Name",
      codename: null,
      disclosure_tier: "exploratory",
      user_id: "user-uuid-x",
      aum: 1,
      max_capacity: 2,
    };
    STATE.payload.excluded = [
      { id: "exc-1", strategy_id: "strat-x", strategies: exploratory },
    ];
    STATE.payload.decisions = [
      { id: "dec-1", strategy_id: "strat-x", strategies: exploratory },
    ];
    const res = await callRoute(SEED_UUID);
    const body = (await res.json()) as {
      excluded: Array<{ strategies: Record<string, unknown> }>;
      decisions: Array<{ strategies: Record<string, unknown> }>;
    };
    expect(body.excluded[0].strategies.user_id).toBeNull();
    expect(body.excluded[0].strategies.aum).toBeNull();
    expect(body.decisions[0].strategies.user_id).toBeNull();
  });

  it("handles helper throw with 500", async () => {
    STATE.throwFromHelper = new Error("DB exploded");
    const res = await callRoute(SEED_UUID);
    expect(res.status).toBe(500);
  });

  it("red-team R6: exploratory candidate analytics.total_aum is masked", async () => {
    STATE.payload.candidates = [
      {
        id: "cand-r6",
        strategy_id: "strat-r6",
        strategies: {
          id: "strat-r6",
          name: "Hidden",
          codename: null,
          disclosure_tier: "exploratory",
          user_id: "user-uuid",
          aum: 5_000_000,
          max_capacity: 50_000_000,
        },
        analytics: {
          strategy_id: "strat-r6",
          sharpe: 1.7,
          sortino: 2.1,
          total_aum: 5_500_000, // same exfil vector as C-0085
          cagr: 0.18,
        },
      },
    ];
    const res = await callRoute(SEED_UUID);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      candidates: Array<{
        strategies: Record<string, unknown>;
        analytics: Record<string, unknown>;
      }>;
    };
    const candidate = body.candidates[0];
    expect(candidate.strategies.aum).toBeNull();
    // R6: analytics.total_aum must ALSO be masked when strategies is masked.
    expect(candidate.analytics.total_aum).toBeNull();
    // Performance ratios are NOT masked — they don't identify the
    // strategy by capacity, only by track-record shape.
    expect(candidate.analytics.sharpe).toBe(1.7);
    expect(candidate.analytics.cagr).toBe(0.18);
  });

  it("red-team R-0001: decisions[].founder_note (allocator-side private commentary) is masked", async () => {
    STATE.payload.decisions = [
      {
        id: "dec-r1",
        strategy_id: "strat-r1",
        founder_note: "confidential allocator note about this strategy",
        strategies: {
          id: "strat-r1",
          name: "Acme Macro",
          disclosure_tier: "institutional",
        },
      },
    ];
    const res = await callRoute(SEED_UUID);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      decisions: Array<Record<string, unknown>>;
    };
    expect(body.decisions[0].founder_note).toBeNull();
    // The strategies join still rides through unchanged for institutional.
    const strategies = body.decisions[0].strategies as Record<string, unknown>;
    expect(strategies.name).toBe("Acme Macro");
  });

  it("red-team R-0001: preferences.founder_notes and scoring_weight_overrides are masked", async () => {
    STATE.payload.preferences = {
      user_id: SEED_UUID,
      mandate_archetype: "family_office",
      founder_notes: "private mandate notes",
      scoring_weight_overrides: { sharpe: 2 },
      target_ticket_size_usd: 1_000_000,
    };
    const res = await callRoute(SEED_UUID);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      preferences: Record<string, unknown>;
    };
    expect(body.preferences.founder_notes).toBeNull();
    expect(body.preferences.scoring_weight_overrides).toBeNull();
    // Non-sensitive preference fields still pass through.
    expect(body.preferences.mandate_archetype).toBe("family_office");
    expect(body.preferences.target_ticket_size_usd).toBe(1_000_000);
  });

  it("red-team R-0001: batch.effective_preferences is masked", async () => {
    STATE.payload.batch = {
      id: "batch-1",
      computed_at: "2026-05-17T00:00:00Z",
      effective_preferences: { mandate: "secret" },
      candidate_count: 5,
    };
    const res = await callRoute(SEED_UUID);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { batch: Record<string, unknown> };
    expect(body.batch.effective_preferences).toBeNull();
    // Non-sensitive batch fields still pass through.
    expect(body.batch.candidate_count).toBe(5);
  });

  it("red-team R-0001: existing_contact_requests[].strategy_id is masked to opaque placeholder", async () => {
    STATE.payload.existing_contact_requests = [
      {
        strategy_id: "real-strat-uuid-abcdef0123456789",
        created_at: "2026-05-01T00:00:00Z",
        status: "pending",
      },
    ];
    const res = await callRoute(SEED_UUID);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      existing_contact_requests: Array<{
        strategy_id: string;
        created_at: string;
        status: string;
      }>;
    };
    // The real strategy_id must not leak. Timestamps + status are kept
    // for legitimate UI grouping.
    expect(body.existing_contact_requests[0].strategy_id).not.toBe(
      "real-strat-uuid-abcdef0123456789",
    );
    expect(body.existing_contact_requests[0].strategy_id).toMatch(
      /^exploratory-/,
    );
    expect(body.existing_contact_requests[0].status).toBe("pending");
  });

  it("red-team R-0001: null preferences / null batch pass through unchanged", async () => {
    STATE.payload.preferences = null;
    STATE.payload.batch = null;
    const res = await callRoute(SEED_UUID);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { preferences: unknown; batch: unknown };
    expect(body.preferences).toBeNull();
    expect(body.batch).toBeNull();
  });

  it("red-team R6: institutional candidate analytics.total_aum passes through unchanged", async () => {
    STATE.payload.candidates = [
      {
        id: "cand-inst",
        strategy_id: "strat-inst",
        strategies: {
          id: "strat-inst",
          name: "Public Fund",
          codename: null,
          disclosure_tier: "institutional",
          user_id: "user-uuid",
        },
        analytics: {
          strategy_id: "strat-inst",
          total_aum: 9_999_999,
          sharpe: 1.2,
        },
      },
    ];
    const res = await callRoute(SEED_UUID);
    const body = (await res.json()) as {
      candidates: Array<{ analytics: Record<string, unknown> }>;
    };
    expect(body.candidates[0].analytics.total_aum).toBe(9_999_999);
  });
});
