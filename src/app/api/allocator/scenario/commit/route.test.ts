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
import { createHash } from "node:crypto";
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
// Mock supabase admin client — used for the P1945 idempotency cache lookup
// and post-success upsert.
// ---------------------------------------------------------------------------

const idemMaybeSingleMock = vi.fn();
const idemUpsertMock = vi.fn(async () => ({ error: null }));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    auth: { admin: { getUserById: vi.fn(), updateUserById: vi.fn() } },
    // Chainable .from('scenario_commit_idempotency').select().eq().eq().maybeSingle()
    // for the lookup; .from(...).upsert(...) for the post-success write.
    from: (_table: string) => ({
      select: () => ({
        eq: () => ({
          eq: () => ({
            maybeSingle: idemMaybeSingleMock,
          }),
        }),
      }),
      upsert: idemUpsertMock,
    }),
  }),
}));

// ---------------------------------------------------------------------------
// Mock withAllocatorAuth — toggleable so we can exercise the no-auth 401 path
// and the non-allocator 403 path independently.
// ---------------------------------------------------------------------------

const MOCK_USER = { id: "alloc-A" } as unknown as import("@supabase/supabase-js").User;

let withAuthShouldFail = false;
let allocatorGateShouldFail = false;

vi.mock("@/lib/api/withAllocatorAuth", () => ({
  withAllocatorAuth:
    (h: (req: NextRequest, user: typeof MOCK_USER) => unknown) =>
    (req: NextRequest) => {
      if (withAuthShouldFail) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), {
          status: 401,
          headers: { "content-type": "application/json" },
        });
      }
      if (allocatorGateShouldFail) {
        return new Response(
          JSON.stringify({ error: "Forbidden — allocator role required" }),
          {
            status: 403,
            headers: {
              "content-type": "application/json",
              "Cache-Control": "private, no-store",
            },
          },
        );
      }
      return h(req, MOCK_USER);
    },
}));

// ---------------------------------------------------------------------------
// Mock supabase server client — user-scoped supabase.rpc('commit_scenario_batch')
// is the H4 hook (must be user-scoped so the RPC's auth.uid() guard passes;
// service-role admin client would set auth.uid() to NULL and fail closed).
// ---------------------------------------------------------------------------

const mockRpc = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    from: vi.fn(() => ({})),
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

// P1945 — a request bearing an Idempotency-Key header. The header value
// length defaults to 24 (uuid-style without dashes), which sits inside the
// 16..128 acceptance window defined in route.ts.
function mkReqWithIdempotency(body: unknown, key: string) {
  return new NextRequest(
    new URL("http://localhost/api/allocator/scenario/commit"),
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "Idempotency-Key": key,
      },
      body: JSON.stringify(body),
    },
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  withAuthShouldFail = false;
  allocatorGateShouldFail = false;
  rateLimitAllow = true;
  mockRpc.mockReset();
  idemMaybeSingleMock.mockReset();
  idemMaybeSingleMock.mockResolvedValue({ data: null, error: null });
  idemUpsertMock.mockReset();
  idemUpsertMock.mockResolvedValue({ error: null });
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
  strategy_id: "22222222-3333-4444-9555-666666666666",
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
  it("returns 429 + Retry-After + Cache-Control when rate limit exceeded", async () => {
    rateLimitAllow = false;
    const res = await POST(mkReq({ diffs: [VALID_VR] }));
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBe("42");
    // P1947 — every response carries no-store.
    expect(res.headers.get("Cache-Control")).toBe("private, no-store");
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

  it("T_R7: voluntary_modify(legacy new_weight) → RPC invoked with percent_allocated = new_weight * 100, no new_weight key", async () => {
    // P1956 (audit-2026-05-07 round 2): route.ts normalises new_weight → percent_allocated
    // before forwarding to the RPC. Migration 128 dropped the SQL COALESCE
    // fallback, so this transition shim is the single canonical encoding
    // path until Block C/D's drawer/adapter stops emitting new_weight.
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
    const [, payload] = (mockRpc.mock.calls[0] ?? []) as [unknown, { p_diffs: Array<Record<string, unknown>> }];
    const vm = payload.p_diffs[0];
    expect(vm.kind).toBe("voluntary_modify");
    expect(vm.percent_allocated).toBeCloseTo(8, 10); // 0.08 * 100 = 8 (P1956 canonical encoding)
    expect("new_weight" in vm).toBe(false); // P1956: new_weight stripped before RPC
  });

  it("T_R7b: voluntary_modify(percent_allocated direct) → RPC invoked with percent_allocated unchanged", async () => {
    // P1956: the canonical post-Block-D wire shape. Client sends percent_allocated
    // directly; route.ts forwards as-is. Verified here so the future zod
    // tightening (drop new_weight, require percent_allocated) doesn't break
    // the contract being established now.
    mockRpc.mockResolvedValueOnce({
      data: {
        ok: true,
        recorded: [
          {
            index: 0,
            match_decision_id: "md-vm-2",
            bridge_outcome_id: "bo-vm-2",
            kind: "voluntary_modify",
          },
        ],
      },
      error: null,
    });

    const VALID_VM_PCT = {
      kind: "voluntary_modify" as const,
      holding_ref: "holding:binance:BTC-USDT:spot",
      percent_allocated: 12.5,
      size_at_decision_usd: 1000,
    };

    const res = await POST(mkReq({ diffs: [VALID_VM_PCT] }));
    expect(res.status).toBe(200);
    const [, payload] = (mockRpc.mock.calls[0] ?? []) as [unknown, { p_diffs: Array<Record<string, unknown>> }];
    expect(payload.p_diffs[0]).toMatchObject({ kind: "voluntary_modify", percent_allocated: 12.5 });
    expect("new_weight" in (payload.p_diffs[0] as object)).toBe(false);
  });

  it("T_R7c: voluntary_modify(neither new_weight nor percent_allocated) → 400, RPC not called", async () => {
    // The schema allows both fields optional, so the at-least-one check is
    // enforced imperatively in the POST handler. Discriminated-union members
    // must be ZodObjects (no .refine), hence the imperative validation.
    const VALID_VM_MISSING = {
      kind: "voluntary_modify" as const,
      holding_ref: "holding:binance:BTC-USDT:spot",
      size_at_decision_usd: 1000,
    };

    const res = await POST(mkReq({ diffs: [VALID_VM_MISSING] }));
    expect(res.status).toBe(400);
    expect(mockRpc).not.toHaveBeenCalled();
    const body = await res.json();
    expect(body.error).toMatch(/Invalid request body/);
  });

  it("T_R7d: voluntary_modify(both fields) → percent_allocated wins, new_weight ignored", async () => {
    // Defensive: if a transitional client sends both, the canonical field
    // (percent_allocated) wins. Eliminates encoding ambiguity.
    mockRpc.mockResolvedValueOnce({
      data: {
        ok: true,
        recorded: [
          { index: 0, match_decision_id: "md-vm-3", bridge_outcome_id: "bo-vm-3", kind: "voluntary_modify" },
        ],
      },
      error: null,
    });

    const VALID_VM_BOTH = {
      kind: "voluntary_modify" as const,
      holding_ref: "holding:binance:BTC-USDT:spot",
      new_weight: 0.5, // would map to 50
      percent_allocated: 25, // canonical — wins
      size_at_decision_usd: 1000,
    };

    const res = await POST(mkReq({ diffs: [VALID_VM_BOTH] }));
    expect(res.status).toBe(200);
    const [, payload] = (mockRpc.mock.calls[0] ?? []) as [unknown, { p_diffs: Array<Record<string, unknown>> }];
    expect(payload.p_diffs[0]).toMatchObject({ kind: "voluntary_modify", percent_allocated: 25 });
    expect("new_weight" in (payload.p_diffs[0] as object)).toBe(false);
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
  // audit-2026-05-07 round-2 / P1945:
  // Rolled-back batches now respond with HTTP 422 (Unprocessable Entity),
  // not 200. The recorded:0 + errors[] payload shape is unchanged so the
  // drawer UI continues to render per-row errors inline.
  it("T_R9: voluntary_remove with un-owned holding_ref → 422 (recorded:0), no audit", async () => {
    mockRpc.mockResolvedValueOnce({
      data: {
        ok: false,
        recorded: [],
        errors: [{ index: 0, error: "Holding not owned by user" }],
      },
      error: null,
    });

    const res = await POST(mkReq({ diffs: [VALID_VR] }));
    expect(res.status).toBe(422);
    expect(res.headers.get("Cache-Control")).toBe("private, no-store");
    const body = await res.json();
    expect(body.recorded).toBe(0);
    expect(body.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ index: 0, error: expect.stringContaining("not owned") }),
      ]),
    );
    expect(logAuditEvent).not.toHaveBeenCalled();
  });

  it("T_R10: voluntary_add with non-existent strategy_id → 422", async () => {
    mockRpc.mockResolvedValueOnce({
      data: {
        ok: false,
        recorded: [],
        errors: [{ index: 0, error: "Strategy not found or not published" }],
      },
      error: null,
    });

    const res = await POST(mkReq({ diffs: [VALID_VA] }));
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.recorded).toBe(0);
  });

  it("T_R11: voluntary_add for strategy with status='draft' → 422", async () => {
    mockRpc.mockResolvedValueOnce({
      data: {
        ok: false,
        recorded: [],
        errors: [{ index: 0, error: "Strategy not found or not published" }],
      },
      error: null,
    });

    const res = await POST(mkReq({ diffs: [VALID_VA] }));
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.recorded).toBe(0);
  });

  it("T_R12: H4 mixed batch — row-2 fails → 422, recorded:0 (row-1 NOT persisted), no audit on partial", async () => {
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
    expect(res.status).toBe(422);
    expect(res.headers.get("Cache-Control")).toBe("private, no-store");
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
    // and the RPC always receives user.id from withAuth. mkReq() accepts
    // `unknown`, so the extraneous field passes through the JSON encoder.
    const res = await POST(
      mkReq({
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

// ===========================================================================
// T_R18 — audit-2026-05-07 round-2 / P1946 allocator gate
// ===========================================================================
//
// The route is now wrapped in withAllocatorAuth, which returns 403 +
// Cache-Control before the handler runs whenever the caller is authenticated
// but not in profiles.role IN ('allocator','both'). We toggle the mock's
// allocatorGateShouldFail flag to exercise that path without re-implementing
// the profile lookup here (that's covered by withAllocatorAuth.test.ts).

describe("T_R18 — allocator gate (P1946)", () => {
  it("returns 403 + Cache-Control when the caller is not an allocator", async () => {
    allocatorGateShouldFail = true;
    const res = await POST(mkReq({ diffs: [VALID_VR] }));
    expect(res.status).toBe(403);
    expect(res.headers.get("Cache-Control")).toBe("private, no-store");
    // RPC must not fire — the gate is upstream of the handler.
    expect(mockRpc).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// T_R19 — P1947: Cache-Control on the happy path
// ===========================================================================

describe("T_R19 — Cache-Control on happy-path 200", () => {
  it("sets Cache-Control: private, no-store on successful 200 response", async () => {
    mockRpc.mockResolvedValueOnce({
      data: {
        ok: true,
        recorded: [
          { index: 0, match_decision_id: "md-1", bridge_outcome_id: "bo-1", kind: "voluntary_remove" },
        ],
      },
      error: null,
    });
    const res = await POST(mkReq({ diffs: [VALID_VR] }));
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("private, no-store");
  });

  it("sets Cache-Control on validation 400 response", async () => {
    const res = await POST(mkReq({ diffs: [] }));
    expect(res.status).toBe(400);
    expect(res.headers.get("Cache-Control")).toBe("private, no-store");
  });
});

// ===========================================================================
// T_R20 — P1945: Idempotency-Key dedup
// ===========================================================================
//
// First request with a valid Idempotency-Key → RPC fires, success body is
// cached via the admin client upsert. Second request with the SAME key →
// the cached body is returned WITHOUT calling the RPC. We assert mockRpc
// is invoked exactly once across both calls and the second response payload
// equals the cached body.

describe("T_R20 — Idempotency-Key dedup (P1945)", () => {
  const KEY = "a".repeat(24); // 24 chars — inside 16..128 window

  it("first request runs the RPC and caches; duplicate request short-circuits to cache", async () => {
    // First call: cache miss → RPC fires → success → cache upsert.
    idemMaybeSingleMock.mockResolvedValueOnce({ data: null, error: null });
    mockRpc.mockResolvedValueOnce({
      data: {
        ok: true,
        recorded: [
          { index: 0, match_decision_id: "md-1", bridge_outcome_id: "bo-1", kind: "voluntary_remove" },
        ],
      },
      error: null,
    });

    const res1 = await POST(mkReqWithIdempotency({ diffs: [VALID_VR] }, KEY));
    expect(res1.status).toBe(200);
    const body1 = await res1.json();
    expect(body1.recorded).toBe(1);

    // The admin client should have been asked to upsert the response.
    // Round-2-D review: upsert now also carries the body-binding
    // request_hash + schema_version (migration 130 columns).
    expect(idemUpsertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        allocator_id: "alloc-A",
        idempotency_key: KEY,
        response: expect.objectContaining({ recorded: 1 }),
        request_hash: expect.stringMatching(/^[a-f0-9]{64}$/),
        schema_version: 1,
      }),
      expect.anything(),
    );

    // Capture the request_hash that the route stamped on the upsert. The
    // second request constructs the same body bytes, so the route will
    // compute the same hash; we mirror it back via the cache mock so the
    // body-binding check (request_hash mismatch → 422) doesn't fire.
    const firstUpsertCall = (idemUpsertMock.mock.calls as unknown[][])[0][0] as {
      request_hash: string;
    };

    // Second call: cache HIT → RPC must NOT fire again.
    idemMaybeSingleMock.mockResolvedValueOnce({
      data: {
        response: body1,
        request_hash: firstUpsertCall.request_hash,
        schema_version: 1,
      },
      error: null,
    });

    const res2 = await POST(mkReqWithIdempotency({ diffs: [VALID_VR] }, KEY));
    expect(res2.status).toBe(200);
    expect(res2.headers.get("Cache-Control")).toBe("private, no-store");
    const body2 = await res2.json();
    expect(body2).toEqual(body1);

    // Critical assertion: the RPC ran EXACTLY ONCE across both requests.
    expect(mockRpc).toHaveBeenCalledTimes(1);
  });

  it("Idempotency-Key reuse with DIFFERENT body returns 422 (RFC §2.5 body-binding)", async () => {
    // Pre-populate the cache as if a previous commit with this key+different
    // body landed. The stored request_hash is for the "original" body; the
    // current request hashes to a different value → 422.
    idemMaybeSingleMock.mockResolvedValueOnce({
      data: {
        response: { recorded: 1, results: [], errors: [] },
        request_hash: "0".repeat(64),
        schema_version: 1,
      },
      error: null,
    });

    const res = await POST(mkReqWithIdempotency({ diffs: [VALID_VR] }, KEY));
    expect(res.status).toBe(422);
    expect(res.headers.get("Cache-Control")).toBe("private, no-store");
    const body = await res.json();
    expect(body.error).toMatch(/Idempotency-Key reuse/i);
    // RPC must NOT have been invoked — the gate is upstream of the RPC.
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it("cache lookup error WITH valid Idempotency-Key fails closed with 503", async () => {
    // Round-2-D silent-failure-hunter (conf 8): the prior implementation
    // logged-and-fell-through. A flaky lookup is exactly when retries fire,
    // so falling through doubles writes precisely when the user needs dedup.
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    idemMaybeSingleMock.mockResolvedValueOnce({
      data: null,
      error: { code: "PGRST000", message: "DB timeout" },
    });

    const res = await POST(mkReqWithIdempotency({ diffs: [VALID_VR] }, KEY));
    expect(res.status).toBe(503);
    expect(res.headers.get("Cache-Control")).toBe("private, no-store");
    expect(mockRpc).not.toHaveBeenCalled();
    expect(consoleSpy).toHaveBeenCalledWith(
      "[scenario-commit] idempotency lookup failed:",
      expect.objectContaining({ user_id: "alloc-A", code: "PGRST000" }),
    );
    consoleSpy.mockRestore();
  });

  it("cached row with mismatched schema_version is treated as a miss + overwritten", async () => {
    // A row written by an older route revision (schema_version=0) must not
    // be served verbatim. The route falls through to a fresh RPC and the
    // upsert replaces the stale row. Hash MATCHES (same body bytes), so the
    // request_hash check passes and we exercise the schema_version branch.
    const bodyHash = createHash("sha256")
      .update(JSON.stringify({ diffs: [VALID_VR] }))
      .digest("hex");
    idemMaybeSingleMock.mockResolvedValueOnce({
      data: {
        response: { recorded: 99, legacy_field: "drift" },
        request_hash: bodyHash,
        schema_version: 0,
      },
      error: null,
    });
    mockRpc.mockResolvedValueOnce({
      data: {
        ok: true,
        recorded: [
          { index: 0, match_decision_id: "md-1", bridge_outcome_id: "bo-1", kind: "voluntary_remove" },
        ],
      },
      error: null,
    });

    const res = await POST(mkReqWithIdempotency({ diffs: [VALID_VR] }, KEY));
    expect(res.status).toBe(200);
    expect(mockRpc).toHaveBeenCalledTimes(1);
    expect(idemUpsertMock).toHaveBeenCalledWith(
      expect.objectContaining({ schema_version: 1 }),
      expect.anything(),
    );
    // Crucially, NOT the stale shape from the old row.
    const body = await res.json();
    expect(body.legacy_field).toBeUndefined();
    expect(body.recorded).toBe(1);
  });

  it("key boundary: 16 chars (min) → cache is consulted", async () => {
    const minKey = "k".repeat(16);
    idemMaybeSingleMock.mockResolvedValueOnce({ data: null, error: null });
    mockRpc.mockResolvedValueOnce({
      data: {
        ok: true,
        recorded: [
          { index: 0, match_decision_id: "md-1", bridge_outcome_id: "bo-1", kind: "voluntary_remove" },
        ],
      },
      error: null,
    });
    await POST(mkReqWithIdempotency({ diffs: [VALID_VR] }, minKey));
    expect(idemMaybeSingleMock).toHaveBeenCalledTimes(1);
    expect(idemUpsertMock).toHaveBeenCalledTimes(1);
  });

  it("key boundary: 128 chars (max) → cache is consulted", async () => {
    const maxKey = "k".repeat(128);
    idemMaybeSingleMock.mockResolvedValueOnce({ data: null, error: null });
    mockRpc.mockResolvedValueOnce({
      data: {
        ok: true,
        recorded: [
          { index: 0, match_decision_id: "md-1", bridge_outcome_id: "bo-1", kind: "voluntary_remove" },
        ],
      },
      error: null,
    });
    await POST(mkReqWithIdempotency({ diffs: [VALID_VR] }, maxKey));
    expect(idemMaybeSingleMock).toHaveBeenCalledTimes(1);
    expect(idemUpsertMock).toHaveBeenCalledTimes(1);
  });

  it("key boundary: 129 chars → treated as no-idempotency (cache skipped)", async () => {
    const overKey = "k".repeat(129);
    mockRpc.mockResolvedValueOnce({
      data: {
        ok: true,
        recorded: [
          { index: 0, match_decision_id: "md-1", bridge_outcome_id: "bo-1", kind: "voluntary_remove" },
        ],
      },
      error: null,
    });
    await POST(mkReqWithIdempotency({ diffs: [VALID_VR] }, overKey));
    expect(idemMaybeSingleMock).not.toHaveBeenCalled();
    expect(idemUpsertMock).not.toHaveBeenCalled();
  });

  it("cache write failure does NOT block the 200 success response", async () => {
    // Best-effort dedup contract: the RPC has already committed. We MUST
    // still return 200 with the success body to the client; the failed
    // cache write is logged at error level for SRE follow-up.
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    idemMaybeSingleMock.mockResolvedValueOnce({ data: null, error: null });
    idemUpsertMock.mockResolvedValueOnce({
      error: { code: "23505", message: "concurrent retry race" },
    } as unknown as { error: null });
    mockRpc.mockResolvedValueOnce({
      data: {
        ok: true,
        recorded: [
          { index: 0, match_decision_id: "md-1", bridge_outcome_id: "bo-1", kind: "voluntary_remove" },
        ],
      },
      error: null,
    });

    const res = await POST(mkReqWithIdempotency({ diffs: [VALID_VR] }, KEY));
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("private, no-store");
    expect(consoleSpy).toHaveBeenCalledWith(
      "[scenario-commit] idempotency cache write failed:",
      expect.objectContaining({ user_id: "alloc-A", code: "23505" }),
    );
    consoleSpy.mockRestore();
  });

  it("malformed Idempotency-Key (too short) is ignored — RPC runs as normal", async () => {
    mockRpc.mockResolvedValueOnce({
      data: {
        ok: true,
        recorded: [
          { index: 0, match_decision_id: "md-1", bridge_outcome_id: "bo-1", kind: "voluntary_remove" },
        ],
      },
      error: null,
    });

    // 8-char key is below the 16-char floor → treated as no-idempotency.
    const res = await POST(mkReqWithIdempotency({ diffs: [VALID_VR] }, "shortkey"));
    expect(res.status).toBe(200);
    expect(mockRpc).toHaveBeenCalledTimes(1);
    // The cache should NOT have been consulted for a malformed key.
    expect(idemMaybeSingleMock).not.toHaveBeenCalled();
    expect(idemUpsertMock).not.toHaveBeenCalled();
  });

  it("request without Idempotency-Key header skips cache entirely", async () => {
    mockRpc.mockResolvedValueOnce({
      data: {
        ok: true,
        recorded: [
          { index: 0, match_decision_id: "md-1", bridge_outcome_id: "bo-1", kind: "voluntary_remove" },
        ],
      },
      error: null,
    });

    const res = await POST(mkReq({ diffs: [VALID_VR] }));
    expect(res.status).toBe(200);
    expect(idemMaybeSingleMock).not.toHaveBeenCalled();
    expect(idemUpsertMock).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// T_R21 — RPC error → 500 + Cache-Control (round-2-D test-analyzer M2)
// ===========================================================================

describe("T_R21 — RPC error 500 path", () => {
  it("RPC error returns 500 with Cache-Control + no audit + no cache write", async () => {
    mockRpc.mockResolvedValueOnce({
      data: null,
      error: { code: "P0001", message: "RPC blew up" },
    });

    const res = await POST(
      mkReqWithIdempotency({ diffs: [VALID_VR] }, "k".repeat(24)),
    );
    expect(res.status).toBe(500);
    expect(res.headers.get("Cache-Control")).toBe("private, no-store");
    expect(logAuditEvent).not.toHaveBeenCalled();
    // 500 means the RPC was attempted but failed; cache MUST NOT capture
    // a failure response (a retry should be able to succeed).
    expect(idemUpsertMock).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// T_R22 — Idempotency + voluntary_modify post-normalisation
// (round-2-D test-analyzer M1)
// ===========================================================================

describe("T_R22 — Idempotency + voluntary_modify percent normalisation", () => {
  it("cached success body for a new_weight modify request carries percent_allocated", async () => {
    // First call: voluntary_modify with new_weight; route normalises to
    // percent_allocated before calling the RPC. The cached response should
    // reflect what was actually committed.
    idemMaybeSingleMock.mockResolvedValueOnce({ data: null, error: null });
    mockRpc.mockResolvedValueOnce({
      data: {
        ok: true,
        recorded: [
          { index: 0, match_decision_id: "md-1", bridge_outcome_id: "bo-1", kind: "voluntary_modify" },
        ],
      },
      error: null,
    });

    const key = "m".repeat(32);
    const res = await POST(
      mkReqWithIdempotency({ diffs: [VALID_VM] }, key),
    );
    expect(res.status).toBe(200);

    // RPC should have been called with normalised percent_allocated (8) — NOT
    // new_weight (0.08).
    expect(mockRpc).toHaveBeenCalledWith(
      "commit_scenario_batch",
      expect.objectContaining({
        p_diffs: expect.arrayContaining([
          expect.objectContaining({
            kind: "voluntary_modify",
            percent_allocated: 8,
          }),
        ]),
      }),
    );

    // The cache row stamped on upsert carries the canonical successBody (no
    // new_weight leak), the request_hash, and the schema_version.
    expect(idemUpsertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        response: expect.objectContaining({ recorded: 1 }),
        request_hash: expect.stringMatching(/^[a-f0-9]{64}$/),
        schema_version: 1,
      }),
      expect.anything(),
    );
  });

  it("voluntary_modify with neither new_weight nor percent_allocated returns 400 + Cache-Control", async () => {
    // Pre-normalisation imperative check (the schema admits both-undefined
    // because Zod's discriminatedUnion requires ZodObject members).
    const res = await POST(
      mkReq({
        diffs: [
          {
            kind: "voluntary_modify",
            holding_ref: "holding:binance:ETH:spot",
            size_at_decision_usd: 8000,
            // new_weight + percent_allocated both omitted
          },
        ],
      }),
    );
    expect(res.status).toBe(400);
    expect(res.headers.get("Cache-Control")).toBe("private, no-store");
    const body = await res.json();
    expect(body.issues[0].message).toMatch(/either new_weight or percent_allocated/);
  });
});

// ===========================================================================
// T_R23 — audit emission carries commit_batch_id (round-2-D code-review #4)
// ===========================================================================

describe("T_R23 — audit metadata.commit_batch_id", () => {
  it("each per-row audit event in one batch shares the same commit_batch_id", async () => {
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

    const res = await POST(mkReq({ diffs: [VALID_VR, VALID_VA] }));
    expect(res.status).toBe(200);
    expect(logAuditEvent).toHaveBeenCalledTimes(2);

    const calls = (logAuditEvent as unknown as { mock: { calls: unknown[][] } })
      .mock.calls as Array<
      [unknown, { metadata: { commit_batch_id: string } }]
    >;
    const batchId1 = calls[0][1].metadata.commit_batch_id;
    const batchId2 = calls[1][1].metadata.commit_batch_id;

    expect(batchId1).toMatch(/^[0-9a-f-]{36}$/);
    expect(batchId2).toBe(batchId1);
  });
});
