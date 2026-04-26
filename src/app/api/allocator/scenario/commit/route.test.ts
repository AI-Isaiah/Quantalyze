/**
 * Phase 10 / Plan 07 / SCENARIO-07 — TDD tests for POST /api/allocator/scenario/commit.
 *
 * Covered behaviours:
 *   T_R1  No auth (withAuth returns 401)                                     → 401
 *   T_R2  Empty diffs array                                                  → 400
 *   T_R3  More than 50 diffs (DoS cap)                                       → 400
 *   T_R4  Rate-limit exceeded                                                → 429 + Retry-After
 *   T_R5  Single voluntary_remove diff (with rejection_reason enum value)    → 200; RPC fired
 *   T_R6  Single voluntary_add diff (published strategy)                     → 200; RPC fired
 *   T_R7  Single voluntary_modify diff (with new_weight)                     → 200; RPC fired
 *   T_R8  M7 reuse-or-create — bridge_recommended new tuple → INSERT;
 *         second commit with same tuple → REUSE (no duplicate INSERT)
 *   T_R9  H4 single-tx full-failure — voluntary_remove with un-owned         → 200 ok=false
 *   T_R10 voluntary_add with non-existent strategy_id                        → 200 ok=false
 *   T_R11 voluntary_add with strategy status='draft'                         → 200 ok=false
 *   T_R12 H4 single-tx rollback — mixed batch row-2 fails → recorded:0,
 *         no rows persisted (RPC ok=false envelope)
 *   T_R13 Audit emission — per row in full-success batch only
 *   T_R14 Cross-tenant — body allocator_id ignored, route uses user.id
 *   T_R15 Invalid holding_ref format → 400 (regex enforced in zod)
 *   T_R16 M6 — rejection_reason enum (freeform string rejected; valid value
 *         passes through to RPC arg)
 *   T_R17 M6 — rejection_reason REQUIRED for voluntary_remove (omitted → 400)
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

// ---------------------------------------------------------------------------
// Mock withAuth — toggleable so T_R1 can exercise the no-auth 401 path
// ---------------------------------------------------------------------------

const MOCK_USER = { id: "alloc-A" } as unknown as import("@supabase/supabase-js").User;

let withAuthShouldFail = false;
vi.mock("@/lib/api/withAuth", () => ({
  withAuth:
    (h: (req: NextRequest, user: typeof MOCK_USER) => unknown) =>
    (req: NextRequest) => {
      if (withAuthShouldFail) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), {
          status: 401,
          headers: { "content-type": "application/json" },
        });
      }
      return h(req, MOCK_USER);
    },
}));

// ---------------------------------------------------------------------------
// Mock supabase server client
// ---------------------------------------------------------------------------

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    from: vi.fn(() => ({})),
  }),
}));

// ---------------------------------------------------------------------------
// Mock admin client — admin.rpc('commit_scenario_batch', ...) is the H4 hook
// ---------------------------------------------------------------------------

const mockRpc = vi.fn();
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    rpc: mockRpc,
  }),
}));

// ---------------------------------------------------------------------------
// Mock rate limiter — toggleable so T_R4 can force a 429
// ---------------------------------------------------------------------------

let rateLimitAllow = true;
vi.mock("@/lib/ratelimit", () => ({
  userActionLimiter: {},
  checkLimit: vi.fn(async () =>
    rateLimitAllow
      ? { success: true }
      : { success: false, retryAfter: 42 },
  ),
}));

// ---------------------------------------------------------------------------
// Mock audit
// ---------------------------------------------------------------------------

vi.mock("@/lib/audit", () => ({
  logAuditEvent: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Imports after mocks
// ---------------------------------------------------------------------------

import { POST } from "./route";
import { logAuditEvent } from "@/lib/audit";
import { checkLimit } from "@/lib/ratelimit";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mkReq(body: unknown) {
  return new NextRequest(
    new URL("http://localhost/api/allocator/scenario/commit"),
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    },
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  withAuthShouldFail = false;
  rateLimitAllow = true;
  mockRpc.mockReset();
});

const VALID_VR = {
  kind: "voluntary_remove" as const,
  holding_ref: "holding:binance:BTC:spot",
  size_at_decision_usd: 1000,
  rejection_reason: "underperforming_peers" as const,
};
const VALID_VA = {
  kind: "voluntary_add" as const,
  strategy_id: "11111111-2222-4333-8444-555555555555",
  percent_allocated: 5,
  size_at_decision_usd: 5000,
};
const VALID_VM = {
  kind: "voluntary_modify" as const,
  holding_ref: "holding:binance:ETH:spot",
  new_weight: 0.08,
  size_at_decision_usd: 8000,
};
const VALID_BR = {
  kind: "bridge_recommended" as const,
  holding_ref: "holding:binance:BTC:spot",
  strategy_id: "22222222-3333-4444-5555-666666666666",
  percent_allocated: 12,
  size_at_decision_usd: 12000,
};

// ===========================================================================
// T_R1 — withAuth gate
// ===========================================================================

describe("T_R1 — auth gate", () => {
  it("returns 401 when withAuth fails", async () => {
    withAuthShouldFail = true;
    const res = await POST(mkReq({ diffs: [VALID_VR] }));
    expect(res.status).toBe(401);
  });
});

// ===========================================================================
// T_R2 / T_R3 / T_R15 — zod
// ===========================================================================

describe("zod validation", () => {
  it("T_R2: rejects empty diffs array with 400", async () => {
    const res = await POST(mkReq({ diffs: [] }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("Invalid request body");
  });

  it("T_R3: rejects > 50 diffs with 400 (DoS cap)", async () => {
    const diffs = Array.from({ length: 51 }, () => VALID_VR);
    const res = await POST(mkReq({ diffs }));
    expect(res.status).toBe(400);
  });

  it("T_R15: rejects malformed holding_ref with 400", async () => {
    const res = await POST(
      mkReq({
        diffs: [
          {
            ...VALID_VR,
            holding_ref: "holding:bad",
          },
        ],
      }),
    );
    expect(res.status).toBe(400);
  });
});

// ===========================================================================
// T_R4 — rate limit
// ===========================================================================

describe("T_R4 — rate limit", () => {
  it("returns 429 + Retry-After when rate limit exceeded", async () => {
    rateLimitAllow = false;
    const res = await POST(mkReq({ diffs: [VALID_VR] }));
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBe("42");
    expect(checkLimit).toHaveBeenCalledWith(
      expect.anything(),
      "scenario_commit:alloc-A",
    );
  });
});

// ===========================================================================
// T_R5 / T_R6 / T_R7 — happy paths per kind
// ===========================================================================

describe("happy paths — per-kind RPC delegation", () => {
  it("T_R5: voluntary_remove → RPC invoked with rejection_reason passed through", async () => {
    mockRpc.mockResolvedValueOnce({
      data: {
        ok: true,
        recorded: [
          {
            index: 0,
            match_decision_id: "md-vr-1",
            bridge_outcome_id: "bo-vr-1",
            kind: "voluntary_remove",
          },
        ],
      },
      error: null,
    });

    const res = await POST(mkReq({ diffs: [VALID_VR] }));
    expect(res.status).toBe(200);

    expect(mockRpc).toHaveBeenCalledWith(
      "commit_scenario_batch",
      expect.objectContaining({
        p_allocator_id: "alloc-A",
        p_diffs: expect.arrayContaining([
          expect.objectContaining({
            kind: "voluntary_remove",
            holding_ref: "holding:binance:BTC:spot",
            rejection_reason: "underperforming_peers",
          }),
        ]),
      }),
    );

    const body = await res.json();
    expect(body.recorded).toBe(1);
    expect(body.errors).toEqual([]);
  });

  it("T_R6: voluntary_add → RPC invoked with strategy_id", async () => {
    mockRpc.mockResolvedValueOnce({
      data: {
        ok: true,
        recorded: [
          {
            index: 0,
            match_decision_id: "md-va-1",
            bridge_outcome_id: "bo-va-1",
            kind: "voluntary_add",
          },
        ],
      },
      error: null,
    });

    const res = await POST(mkReq({ diffs: [VALID_VA] }));
    expect(res.status).toBe(200);
    expect(mockRpc).toHaveBeenCalledWith(
      "commit_scenario_batch",
      expect.objectContaining({
        p_allocator_id: "alloc-A",
        p_diffs: [expect.objectContaining({ kind: "voluntary_add" })],
      }),
    );
  });

  it("T_R7: voluntary_modify → RPC invoked with new_weight", async () => {
    mockRpc.mockResolvedValueOnce({
      data: {
        ok: true,
        recorded: [
          {
            index: 0,
            match_decision_id: "md-vm-1",
            bridge_outcome_id: "bo-vm-1",
            kind: "voluntary_modify",
          },
        ],
      },
      error: null,
    });

    const res = await POST(mkReq({ diffs: [VALID_VM] }));
    expect(res.status).toBe(200);
    expect(mockRpc).toHaveBeenCalledWith(
      "commit_scenario_batch",
      expect.objectContaining({
        p_diffs: [expect.objectContaining({ kind: "voluntary_modify", new_weight: 0.08 })],
      }),
    );
  });
});

// ===========================================================================
// T_R8 — M7 reuse-or-create exercised at the RPC layer
// ===========================================================================

describe("T_R8 — M7 reuse-or-create (RPC level)", () => {
  it("first bridge_recommended diff → RPC INSERT path; second same tuple → RPC REUSE path; both succeed", async () => {
    // First call: tuple ABSENT → INSERT path; new match_decision_id
    mockRpc.mockResolvedValueOnce({
      data: {
        ok: true,
        recorded: [
          {
            index: 0,
            match_decision_id: "md-br-new",
            bridge_outcome_id: "bo-br-1",
            kind: "bridge_recommended",
          },
        ],
      },
      error: null,
    });
    const res1 = await POST(mkReq({ diffs: [VALID_BR] }));
    expect(res1.status).toBe(200);

    // Second call: tuple PRESENT → REUSE path; SAME match_decision_id, NEW bridge_outcome_id
    mockRpc.mockResolvedValueOnce({
      data: {
        ok: true,
        recorded: [
          {
            index: 0,
            match_decision_id: "md-br-new", // REUSED
            bridge_outcome_id: "bo-br-2",
            kind: "bridge_recommended",
          },
        ],
      },
      error: null,
    });
    const res2 = await POST(mkReq({ diffs: [VALID_BR] }));
    expect(res2.status).toBe(200);
    const body2 = await res2.json();
    expect(body2.recorded).toBe(1);
    expect(body2.results[0].match_decision_id).toBe("md-br-new");
  });
});

// ===========================================================================
// T_R9 / T_R10 / T_R11 / T_R12 — H4 single-tx full-failure paths
// ===========================================================================

describe("H4 single-tx full-failure paths", () => {
  it("T_R9: voluntary_remove with un-owned holding_ref → ok=false (recorded:0), no audit", async () => {
    mockRpc.mockResolvedValueOnce({
      data: {
        ok: false,
        recorded: [],
        errors: [{ index: 0, error: "Holding not owned by user" }],
      },
      error: null,
    });

    const res = await POST(mkReq({ diffs: [VALID_VR] }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.recorded).toBe(0);
    expect(body.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ index: 0, error: expect.stringContaining("not owned") }),
      ]),
    );
    expect(logAuditEvent).not.toHaveBeenCalled();
  });

  it("T_R10: voluntary_add with non-existent strategy_id → ok=false", async () => {
    mockRpc.mockResolvedValueOnce({
      data: {
        ok: false,
        recorded: [],
        errors: [{ index: 0, error: "Strategy not found or not published" }],
      },
      error: null,
    });

    const res = await POST(mkReq({ diffs: [VALID_VA] }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.recorded).toBe(0);
  });

  it("T_R11: voluntary_add for strategy with status='draft' → ok=false", async () => {
    mockRpc.mockResolvedValueOnce({
      data: {
        ok: false,
        recorded: [],
        errors: [{ index: 0, error: "Strategy not found or not published" }],
      },
      error: null,
    });

    const res = await POST(mkReq({ diffs: [VALID_VA] }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.recorded).toBe(0);
  });

  it("T_R12: H4 mixed batch — row-2 fails → recorded:0 (row-1 NOT persisted), no audit on partial", async () => {
    // Two-diff batch where row 1 fails; the RPC returns ok=false with recorded:0
    // (the entire tx rolled back — row 0 is NOT persisted).
    mockRpc.mockResolvedValueOnce({
      data: {
        ok: false,
        recorded: [],
        errors: [{ index: 1, error: "Holding not owned by user" }],
      },
      error: null,
    });

    const res = await POST(
      mkReq({
        diffs: [
          { ...VALID_VR, holding_ref: "holding:binance:ETH:spot" },
          { ...VALID_VR, holding_ref: "holding:other:NONE:spot" },
        ],
      }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.recorded).toBe(0);
    expect(body.errors[0].index).toBe(1);
    expect(logAuditEvent).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// T_R13 — audit emission per row in full-success batch
// ===========================================================================

describe("T_R13 — audit emission", () => {
  it("emits one audit event per recorded row in a full-success batch", async () => {
    mockRpc.mockResolvedValueOnce({
      data: {
        ok: true,
        recorded: [
          { index: 0, match_decision_id: "md-1", bridge_outcome_id: "bo-1", kind: "voluntary_remove" },
          { index: 1, match_decision_id: "md-2", bridge_outcome_id: "bo-2", kind: "voluntary_add" },
        ],
      },
      error: null,
    });

    const res = await POST(
      mkReq({ diffs: [VALID_VR, VALID_VA] }),
    );
    expect(res.status).toBe(200);

    expect(logAuditEvent).toHaveBeenCalledTimes(2);
    expect(logAuditEvent).toHaveBeenNthCalledWith(
      1,
      expect.anything(),
      expect.objectContaining({
        action: "match.decision_record",
        entity_type: "match_decision",
        entity_id: "md-1",
        metadata: expect.objectContaining({ kind: "voluntary_remove", source: "scenario_commit" }),
      }),
    );
    expect(logAuditEvent).toHaveBeenNthCalledWith(
      2,
      expect.anything(),
      expect.objectContaining({
        action: "match.decision_record",
        entity_id: "md-2",
        metadata: expect.objectContaining({ kind: "voluntary_add" }),
      }),
    );
  });
});

// ===========================================================================
// T_R14 — cross-tenant: body's allocator_id is ignored
// ===========================================================================

describe("T_R14 — cross-tenant (T-10-01)", () => {
  it("ignores extraneous allocator_id in request body, passes user.id from withAuth", async () => {
    mockRpc.mockResolvedValueOnce({
      data: {
        ok: true,
        recorded: [
          { index: 0, match_decision_id: "md-1", bridge_outcome_id: "bo-1", kind: "voluntary_remove" },
        ],
      },
      error: null,
    });

    // Inject an extraneous allocator_id field — zod's strip default drops it,
    // and the RPC always receives user.id from withAuth.
    const res = await POST(
      mkReq({
        // @ts-expect-error — intentional injection
        allocator_id: "alloc-OTHER",
        diffs: [VALID_VR],
      }),
    );
    expect(res.status).toBe(200);

    expect(mockRpc).toHaveBeenCalledWith(
      "commit_scenario_batch",
      expect.objectContaining({ p_allocator_id: "alloc-A" }),
    );
  });
});

// ===========================================================================
// T_R16 / T_R17 — M6 rejection_reason enum
// ===========================================================================

describe("T_R16 / T_R17 — M6 rejection_reason enum", () => {
  it("T_R16a: rejects voluntary_remove with freeform rejection_reason → 400", async () => {
    const res = await POST(
      mkReq({
        diffs: [
          {
            ...VALID_VR,
            rejection_reason: "freeform string",
          },
        ],
      }),
    );
    expect(res.status).toBe(400);
  });

  it("T_R16b: accepts valid rejection_reason and passes it to the RPC", async () => {
    mockRpc.mockResolvedValueOnce({
      data: {
        ok: true,
        recorded: [
          { index: 0, match_decision_id: "md-1", bridge_outcome_id: "bo-1", kind: "voluntary_remove" },
        ],
      },
      error: null,
    });
    const res = await POST(
      mkReq({
        diffs: [
          {
            ...VALID_VR,
            rejection_reason: "mandate_conflict",
          },
        ],
      }),
    );
    expect(res.status).toBe(200);
    expect(mockRpc).toHaveBeenCalledWith(
      "commit_scenario_batch",
      expect.objectContaining({
        p_diffs: [
          expect.objectContaining({ rejection_reason: "mandate_conflict" }),
        ],
      }),
    );
  });

  it("T_R17: rejects voluntary_remove without rejection_reason → 400 (REQUIRED, not nullish)", async () => {
    const res = await POST(
      mkReq({
        diffs: [
          {
            kind: "voluntary_remove",
            holding_ref: "holding:binance:BTC:spot",
            size_at_decision_usd: 1000,
            // rejection_reason intentionally omitted
          },
        ],
      }),
    );
    expect(res.status).toBe(400);
  });
});
