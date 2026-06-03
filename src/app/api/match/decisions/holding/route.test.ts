/**
 * Phase 09 / Task 5 — TDD RED gate tests for POST /api/match/decisions/holding
 * (finding f2 / T-09-03.b).
 *
 * Covered behaviours:
 *   1. Zod validation: 400 on missing top_candidate_strategy_id.
 *   2. Zod validation: 400 on non-UUID top_candidate_strategy_id.
 *   3. Zod validation: 400 on malformed holding_ref.
 *   4. Ownership gate (T-09-03.b): 403 when allocator_holdings has no matching row.
 *   5. Happy path: 201, inserts match_decisions row with correct shape, emits
 *      match.decision_record audit event, returns { match_decision_id }.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

// `import "server-only"` (transitive via @/lib/analytics/onboarding-funnel)
// throws in jsdom — stub it so route imports resolve under test.
vi.mock("server-only", () => ({}));

// Phase 11 / Plan 03 — onboarding marker stamp is non-blocking analytics.
// Mock to a no-op so route tests don't depend on Supabase auth.admin.
vi.mock("@/lib/analytics/onboarding-funnel", () => ({
  stampOutcomeMarker: vi.fn(async () => undefined),
}));

// ---------------------------------------------------------------------------
// Mock withAuth — invokes handler immediately with a fixed user
// ---------------------------------------------------------------------------

const MOCK_USER = { id: "alloc-1" } as unknown as import("@supabase/supabase-js").User;

vi.mock("@/lib/api/withAuth", () => ({
  withAuth:
    (h: (req: NextRequest, user: typeof MOCK_USER) => unknown) =>
    (req: NextRequest) =>
      h(req, MOCK_USER),
}));

// ---------------------------------------------------------------------------
// Mock supabase client
// ---------------------------------------------------------------------------

const mockHoldingSelectSingle = vi.fn();
const mockStrategySelectSingle = vi.fn();
const mockDecisionInsertSingle = vi.fn();
// F6 (H-0436): the 23505 idempotent-replay branch looks up the existing
// sent_as_intro decision via admin.from("match_decisions").select(...).eq×3.maybeSingle().
const mockDecisionExistingMaybeSingle = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    from: vi.fn((table: string) => {
      if (table === "allocator_holdings") {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                eq: () => ({
                  eq: () => ({
                    limit: () => ({
                      maybeSingle: mockHoldingSelectSingle,
                    }),
                  }),
                }),
              }),
            }),
          }),
        };
      }
      if (table === "strategies") {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                maybeSingle: mockStrategySelectSingle,
              }),
            }),
          }),
        };
      }
      return {};
    }),
  }),
}));

// ---------------------------------------------------------------------------
// Mock admin client — match_decisions INSERT requires service-role under RLS
// ---------------------------------------------------------------------------

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: vi.fn((table: string) => {
      if (table === "match_decisions") {
        return {
          insert: (row: unknown) => ({
            select: () => ({
              single: () => mockDecisionInsertSingle(row),
            }),
          }),
          // F6 (H-0436): existing-decision lookup on the 23505 replay path.
          select: () => ({
            eq: () => ({
              eq: () => ({
                eq: () => ({
                  maybeSingle: () => mockDecisionExistingMaybeSingle(),
                }),
              }),
            }),
          }),
        };
      }
      return {};
    }),
  }),
}));

// ---------------------------------------------------------------------------
// Mock audit
// ---------------------------------------------------------------------------

vi.mock("@/lib/audit", () => ({
  logAuditEvent: vi.fn(),
  logAuditEventAsUser: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Import after mocks
// ---------------------------------------------------------------------------

import { POST } from "./route";
import { logAuditEventAsUser } from "@/lib/audit";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mkReq(body: unknown) {
  return new NextRequest(
    new URL("http://localhost/api/match/decisions/holding"),
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    },
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// Zod validation
// ---------------------------------------------------------------------------

describe("POST /api/match/decisions/holding — zod validation", () => {
  it("rejects missing top_candidate_strategy_id with 400", async () => {
    const res = await POST(mkReq({ holding_ref: "holding:binance:BTC:spot" }));
    expect(res.status).toBe(400);
  });

  it("rejects non-UUID top_candidate_strategy_id with 400", async () => {
    const res = await POST(
      mkReq({
        holding_ref: "holding:binance:BTC:spot",
        top_candidate_strategy_id: "not-a-uuid",
      }),
    );
    expect(res.status).toBe(400);
  });

  it("rejects malformed holding_ref (no 'holding:' prefix) with 400", async () => {
    const res = await POST(
      mkReq({
        holding_ref: "not-a-holding-ref",
        top_candidate_strategy_id: "11111111-2222-4333-8444-555555555555",
      }),
    );
    expect(res.status).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// Ownership gate (T-09-03.b)
// ---------------------------------------------------------------------------

describe("POST /api/match/decisions/holding — ownership gate (T-09-03.b)", () => {
  it("returns 403 when allocator_holdings has no row for this user + venue/symbol/type", async () => {
    mockHoldingSelectSingle.mockResolvedValueOnce({ data: null, error: null });
    const res = await POST(
      mkReq({
        holding_ref: "holding:binance:BTC:spot",
        top_candidate_strategy_id: "11111111-2222-4333-8444-555555555555",
      }),
    );
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toBe("Unauthorized");
  });
});

// ---------------------------------------------------------------------------
// Happy path
// ---------------------------------------------------------------------------

describe("POST /api/match/decisions/holding — happy path", () => {
  it("inserts match_decisions + emits match.decision_record audit + returns 201 + match_decision_id", async () => {
    mockHoldingSelectSingle.mockResolvedValueOnce({
      data: { id: "holding-row-id" },
      error: null,
    });
    mockStrategySelectSingle.mockResolvedValueOnce({
      data: { id: "11111111-2222-4333-8444-555555555555" },
      error: null,
    });
    mockDecisionInsertSingle.mockResolvedValueOnce({
      data: { id: "new-dec-uuid" },
      error: null,
    });

    const res = await POST(
      mkReq({
        holding_ref: "holding:binance:BTC:spot",
        top_candidate_strategy_id: "11111111-2222-4333-8444-555555555555",
      }),
    );

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.match_decision_id).toBe("new-dec-uuid");

    // Verify insert shape
    expect(mockDecisionInsertSingle).toHaveBeenCalledWith(
      expect.objectContaining({
        allocator_id: "alloc-1",
        strategy_id: "11111111-2222-4333-8444-555555555555",
        original_strategy_id: null,
        original_holding_ref: "holding:binance:BTC:spot",
        decision: "sent_as_intro",
      }),
    );

    // Verify audit event emitted with correct action + entity_id.
    // B4b: the match_decisions INSERT rides the service-role admin client, so
    // the audit now emits via logAuditEventAsUser(admin, actingUserId, event)
    // — JWT-immune, with the explicit actor as the second arg.
    expect(logAuditEventAsUser).toHaveBeenCalledWith(
      expect.anything(), // admin (service-role) client
      "alloc-1", // acting user id (MOCK_USER.id)
      expect.objectContaining({
        action: "match.decision_record",
        entity_id: "new-dec-uuid",
      }),
    );
  });
});

// ---------------------------------------------------------------------------
// F9 H-0084 — server-side cancellation honoring
// ---------------------------------------------------------------------------

describe("POST /api/match/decisions/holding — idempotent replay on 23505 (F6 H-0436)", () => {
  it("returns the existing decision id (200) without re-auditing when uniq_match_dec_sent_per_pair rejects a duplicate", async () => {
    mockHoldingSelectSingle.mockResolvedValueOnce({
      data: { id: "holding-row-id" },
      error: null,
    });
    mockStrategySelectSingle.mockResolvedValueOnce({
      data: { id: "11111111-2222-4333-8444-555555555555" },
      error: null,
    });
    // The insert hits the partial-unique index → 23505 (the row already exists
    // from a first, perceived-failed attempt).
    mockDecisionInsertSingle.mockResolvedValueOnce({
      data: null,
      error: { code: "23505", message: "duplicate key value" },
    });
    mockDecisionExistingMaybeSingle.mockResolvedValueOnce({
      data: { id: "existing-dec-uuid" },
      error: null,
    });

    const res = await POST(
      mkReq({
        holding_ref: "holding:binance:BTC:spot",
        top_candidate_strategy_id: "11111111-2222-4333-8444-555555555555",
      }),
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.match_decision_id).toBe("existing-dec-uuid");
    // Replay must NOT emit a second audit event — the original insert already did.
    expect(logAuditEventAsUser).not.toHaveBeenCalled();
  });

  it("23505 but the existing-decision lookup returns null → 500, no undefined id leaked", async () => {
    mockHoldingSelectSingle.mockResolvedValueOnce({
      data: { id: "holding-row-id" },
      error: null,
    });
    mockStrategySelectSingle.mockResolvedValueOnce({
      data: { id: "11111111-2222-4333-8444-555555555555" },
      error: null,
    });
    mockDecisionInsertSingle.mockResolvedValueOnce({
      data: null,
      error: { code: "23505", message: "duplicate key value" },
    });
    // The replay lookup faults / races (row gone) — must NOT return a 200 with
    // an undefined match_decision_id; must fall through to 500.
    mockDecisionExistingMaybeSingle.mockResolvedValueOnce({
      data: null,
      error: null,
    });

    const res = await POST(
      mkReq({
        holding_ref: "holding:binance:BTC:spot",
        top_candidate_strategy_id: "11111111-2222-4333-8444-555555555555",
      }),
    );
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.match_decision_id).toBeUndefined();
    expect(logAuditEventAsUser).not.toHaveBeenCalled();
  });

  it("still 500s on a non-23505 insert error (no silent swallow)", async () => {
    mockHoldingSelectSingle.mockResolvedValueOnce({
      data: { id: "holding-row-id" },
      error: null,
    });
    mockStrategySelectSingle.mockResolvedValueOnce({
      data: { id: "11111111-2222-4333-8444-555555555555" },
      error: null,
    });
    mockDecisionInsertSingle.mockResolvedValueOnce({
      data: null,
      error: { code: "42P01", message: "relation does not exist" },
    });

    const res = await POST(
      mkReq({
        holding_ref: "holding:binance:BTC:spot",
        top_candidate_strategy_id: "11111111-2222-4333-8444-555555555555",
      }),
    );
    expect(res.status).toBe(500);
    expect(mockDecisionExistingMaybeSingle).not.toHaveBeenCalled();
  });
});

describe("POST /api/match/decisions/holding — abort honoring (F9 H-0084)", () => {
  it("returns 499 and does NOT insert/audit when the request is already aborted", async () => {
    // Ownership + strategy gates pass so we actually reach the pre-write guard.
    mockHoldingSelectSingle.mockResolvedValueOnce({
      data: { id: "holding-row-id" },
      error: null,
    });
    mockStrategySelectSingle.mockResolvedValueOnce({
      data: { id: "11111111-2222-4333-8444-555555555555" },
      error: null,
    });

    const abortedReq = new NextRequest(
      new URL("http://localhost/api/match/decisions/holding"),
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          holding_ref: "holding:binance:BTC:spot",
          top_candidate_strategy_id: "11111111-2222-4333-8444-555555555555",
        }),
        signal: AbortSignal.abort(),
      },
    );

    const res = await POST(abortedReq);

    expect(res.status).toBe(499);
    // The whole point: no match_decisions row, no audit event for the action the
    // allocator canceled.
    expect(mockDecisionInsertSingle).not.toHaveBeenCalled();
    expect(logAuditEventAsUser).not.toHaveBeenCalled();
  });
});
