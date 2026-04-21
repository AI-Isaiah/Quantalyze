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
      if (table === "match_decisions") {
        return {
          insert: (row: unknown) => ({
            select: () => ({
              single: () => mockDecisionInsertSingle(row),
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
}));

// ---------------------------------------------------------------------------
// Import after mocks
// ---------------------------------------------------------------------------

import { POST } from "./route";
import { logAuditEvent } from "@/lib/audit";

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
        top_candidate_strategy_id: "11111111-2222-3333-4444-555555555555",
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
        top_candidate_strategy_id: "11111111-2222-3333-4444-555555555555",
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
      data: { id: "11111111-2222-3333-4444-555555555555" },
      error: null,
    });
    mockDecisionInsertSingle.mockResolvedValueOnce({
      data: { id: "new-dec-uuid" },
      error: null,
    });

    const res = await POST(
      mkReq({
        holding_ref: "holding:binance:BTC:spot",
        top_candidate_strategy_id: "11111111-2222-3333-4444-555555555555",
      }),
    );

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.match_decision_id).toBe("new-dec-uuid");

    // Verify insert shape
    expect(mockDecisionInsertSingle).toHaveBeenCalledWith(
      expect.objectContaining({
        allocator_id: "alloc-1",
        strategy_id: "11111111-2222-3333-4444-555555555555",
        original_strategy_id: null,
        original_holding_ref: "holding:binance:BTC:spot",
        decision: "sent_as_intro",
      }),
    );

    // Verify audit event emitted with correct action + entity_id
    expect(logAuditEvent).toHaveBeenCalledWith(
      expect.anything(), // supabase client
      expect.objectContaining({
        action: "match.decision_record",
        entity_id: "new-dec-uuid",
      }),
    );
  });
});
