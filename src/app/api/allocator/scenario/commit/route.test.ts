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

// `import "server-only"` (transitive via @/lib/analytics/onboarding-funnel)
// throws in jsdom — stub it so route imports resolve under test.
vi.mock("server-only", () => ({}));

// Phase 11 / Plan 03 — onboarding marker stamp is non-blocking analytics.
// Mock to a no-op so route tests don't depend on Supabase auth.admin.
vi.mock("@/lib/analytics/onboarding-funnel", () => ({
  stampOutcomeMarker: vi.fn(async () => undefined),
}));

// ---------------------------------------------------------------------------
// Mock supabase admin client.
//
// Pre-migration-131 the route lookup-and-upserted on `scenario_commit_idempotency`
// directly. That logic now lives inside commit_scenario_batch (the SQL function);
// the route only touches the admin client lazily inside `after()` for
// `stampOutcomeMarker`, which is itself mocked above. So the route should
// NEVER reach `admin.from(...)` in tests — fail loudly if it does, so a
// future regression that re-introduces route-layer cache plumbing fails
// the suite instead of silently passing on a permissive mock.
// ---------------------------------------------------------------------------

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    auth: { admin: { getUserById: vi.fn(), updateUserById: vi.fn() } },
    from: () => {
      throw new Error(
        "[test] route should not touch admin.from() — idempotency lives in commit_scenario_batch since migration 131",
      );
    },
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
// PR-2 NEW-C18-04 (2026-05-28): scenario-commit now SELECTs allocator_holdings
// to recompute the audit-trail size_at_decision_usd from authoritative server
// data (the holdings.value_usd column) instead of trusting the client's
// number. The from() mock must therefore return a thenable chain shaped like
// `.from("allocator_holdings").select(...).eq(...)` resolving to
// `{ data: [], error: null }`. Other from() callers (emit's internal
// supabase calls etc.) just need an object that exposes `.select()` returning
// the same shape — keep the surface narrow so a test that needs to inspect a
// different from() chain can override locally.
// Per-test injection of allocator_holdings rows for NEW-C18-04 server-side
// audit recompute coverage. Default empty (lookup_failed branch); a test can
// set holdingsFixture / holdingsErrorFixture in beforeEach to exercise the
// server_holding / server_aum / lookup_failed branches independently.
type HoldingRowFixture = {
  venue: string;
  symbol: string;
  holding_type: string;
  value_usd: number;
  asof: string;
};
let holdingsFixture: HoldingRowFixture[] = [];
let holdingsErrorFixture: { message: string } | null = null;
const buildHoldingsChain = () => {
  const chain: { data: HoldingRowFixture[]; error: { message: string } | null } & {
    select: () => typeof chain;
    eq: () => typeof chain;
    in: () => typeof chain;
    order: () => typeof chain;
  } = {
    data: holdingsFixture,
    error: holdingsErrorFixture,
    select: () => chain,
    eq: () => chain,
    in: () => chain,
    order: () => chain,
  };
  return chain;
};
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    from: vi.fn(() => buildHoldingsChain()),
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
  // PR-2 (2026-05-28): routes now narrow on this type-guard before
  // mapping the misconfig denial to 503. The default-allow test path
  // never reaches it; the deny path returns no `reason` so it's false.
  isRateLimitMisconfigured: vi.fn(
    (rl: { success: boolean; reason?: string }) =>
      rl.success === false && rl.reason === "ratelimit_misconfigured",
  ),
}));

// ---------------------------------------------------------------------------
// Mock audit
// ---------------------------------------------------------------------------

vi.mock("@/lib/audit", () => ({
  // Default async impl so the route's `emit(...).then(ok, fail)` per-promise
  // guard resolves; survives clearAllMocks (it only clears call history, not
  // the vi.fn implementation). Individual tests override with mockRejectedValueOnce.
  emit: vi.fn(async () => {}),
}));

// NEW-C18-11: spy on the Sentry capture so the audit-incompleteness alert
// is assertable.
vi.mock("@/lib/sentry-capture", () => ({
  captureToSentry: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Imports after mocks
// ---------------------------------------------------------------------------

import { POST } from "./route";
import { emit } from "@/lib/audit";
import { captureToSentry } from "@/lib/sentry-capture";
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
  holdingsFixture = [];
  holdingsErrorFixture = null;
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
// T_R1b — auth gate short-circuits the handler (H-0243)
// ===========================================================================
//
// H-0243 flagged T_R1 as tautological: `expect(res.status).toBe(401)` is
// satisfied by ANY 401, including one a future refactor returns by
// accident after the handler has already done work. The withAuth mock is
// a pass-through, so the REAL Origin/CSRF/auth gate cannot be exercised
// offline (it needs Supabase) — that integration belongs in
// withAllocatorAuth.test.ts. What we CAN pin here, without the antipattern,
// is the load-bearing wiring property: when the wrapper denies (401), the
// handler body MUST NOT run — no rate-limit, no RPC, no audit. A
// regression that invoked the handler before the gate (or ignored the
// gate's deny) would do real work on an unauthenticated request and fail
// this test even though the bare status check still passed.

describe("T_R1b — 401 short-circuits the handler body (H-0243)", () => {
  it("does not reach rate-limit, RPC, or audit when withAllocatorAuth denies", async () => {
    withAuthShouldFail = true;
    const res = await POST(mkReq({ diffs: [VALID_VR] }));
    expect(res.status).toBe(401);
    // The handler body must be fully short-circuited by the gate.
    expect(checkLimit).not.toHaveBeenCalled();
    expect(mockRpc).not.toHaveBeenCalled();
    expect(emit).not.toHaveBeenCalled();
  });

  it("does not reach RPC or audit when the allocator-role gate denies (403)", async () => {
    allocatorGateShouldFail = true;
    const res = await POST(mkReq({ diffs: [VALID_VR] }));
    expect(res.status).toBe(403);
    expect(checkLimit).not.toHaveBeenCalled();
    expect(mockRpc).not.toHaveBeenCalled();
    expect(emit).not.toHaveBeenCalled();
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

  // H-0244: the assertion above (`body2...toBe('md-br-new')`) is
  // tautological — it asserts the mock returned the value the test fed it,
  // and would pass verbatim even if the RPC body were gutted to always
  // INSERT. The reuse-or-create LOGIC lives in the SQL function
  // (migration 082) and can only be proven against a live DB (see
  // FLAG/SKIP below). What the ROUTE actually owns — and what this test
  // pins non-tautologically — is that BOTH commits of the same logical
  // diff forward the IDENTICAL reuse tuple (allocator_id + holding_ref +
  // strategy_id + kind) to the RPC. That identical tuple is the
  // PRECONDITION the RPC's reuse SELECT keys on; if the route mangled,
  // dropped, or re-derived any of those fields between calls, the RPC
  // could never match the existing row and would duplicate-INSERT. This
  // test inspects mockRpc.mock.calls[0] vs [1] for that contract.
  it("forwards the IDENTICAL reuse tuple to the RPC on both commits of the same diff (route-level precondition for migration-082 reuse)", async () => {
    const okEnvelope = (mdId: string, boId: string) => ({
      data: {
        ok: true,
        recorded: [
          {
            index: 0,
            match_decision_id: mdId,
            bridge_outcome_id: boId,
            kind: "bridge_recommended",
          },
        ],
      },
      error: null,
    });
    mockRpc.mockResolvedValueOnce(okEnvelope("md-br-new", "bo-br-1"));
    await POST(mkReq({ diffs: [VALID_BR] }));
    mockRpc.mockResolvedValueOnce(okEnvelope("md-br-new", "bo-br-2"));
    await POST(mkReq({ diffs: [VALID_BR] }));

    expect(mockRpc).toHaveBeenCalledTimes(2);
    const call0 = mockRpc.mock.calls[0] as unknown as [
      string,
      { p_allocator_id: string; p_diffs: Array<Record<string, unknown>> },
    ];
    const call1 = mockRpc.mock.calls[1] as unknown as [
      string,
      { p_allocator_id: string; p_diffs: Array<Record<string, unknown>> },
    ];

    // Same allocator on both calls (sourced from withAuth, not the body).
    expect(call0[1].p_allocator_id).toBe("alloc-A");
    expect(call1[1].p_allocator_id).toBe(call0[1].p_allocator_id);

    // The reuse-key tuple the RPC SELECTs on must be byte-identical
    // across both forwards. Pin the three fields that compose migration
    // 082's (allocator_id, original_holding_ref, strategy_id,
    // kind='bridge_recommended') unique tuple.
    const d0 = call0[1].p_diffs[0];
    const d1 = call1[1].p_diffs[0];
    expect(d0.kind).toBe("bridge_recommended");
    expect(d1.kind).toBe("bridge_recommended");
    expect(d1.holding_ref).toBe(d0.holding_ref);
    expect(d1.strategy_id).toBe(d0.strategy_id);
    expect(d0.holding_ref).toBe(VALID_BR.holding_ref);
    expect(d0.strategy_id).toBe(VALID_BR.strategy_id);
  });

  // H-0244 FLAG/SKIP: the INSERT-then-REUSE proof itself (first commit
  // INSERTs a new match_decision_id, second commit REUSEs that same id by
  // SELECTing the existing tuple instead of INSERTing) lives entirely
  // inside the commit_scenario_batch SQL function (migration 082) and
  // cannot be verified with a mocked RPC — the mock cannot run the
  // SELECT-or-INSERT branch. It requires a seeded live DB. Skipped offline
  // and FLAGGED for a live-DB integration test (e.g. alongside
  // src/__tests__/update-allocator-mandates-rpc.test.ts).
  it.skip("[live-DB] second bridge_recommended commit REUSEs the first match_decision_id via the RPC's SELECT-or-INSERT (migration 082) — requires seeded Supabase", () => {
    // Intentionally empty — see FLAG note above. The reuse-or-create
    // branch is SQL-side and needs a real Postgres transaction.
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
    expect(emit).not.toHaveBeenCalled();
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
    expect(emit).not.toHaveBeenCalled();
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

    expect(emit).toHaveBeenCalledTimes(2);
    expect(emit).toHaveBeenNthCalledWith(
      1,
      expect.anything(),
      expect.objectContaining({
        action: "match.decision_record",
        entity_type: "match_decision",
        entity_id: "md-1",
        metadata: expect.objectContaining({ kind: "voluntary_remove", source: "scenario_commit" }),
      }),
    );
    expect(emit).toHaveBeenNthCalledWith(
      2,
      expect.anything(),
      expect.objectContaining({
        action: "match.decision_record",
        entity_id: "md-2",
        metadata: expect.objectContaining({ kind: "voluntary_add" }),
      }),
    );
  });

  it("NEW-C18-11: a hard audit emit failure raises a commit-scoped scenario_commit_audit_incomplete alert", async () => {
    // WHY: a scenario commit is a financial decision; its Art.-grade audit
    // trail must never drop silently. Pre-fix the per-row logAuditEvent
    // swallowed emit()'s re-throw, so a dropped audit row produced NO
    // commit-scoped signal and a cached replay returned 200 trusting the
    // original. Now one hard failure raises a single Sentry alert carrying
    // the commit_batch_id so ops can backfill the exact commit.
    vi.mocked(emit).mockRejectedValueOnce(new Error("permission_denied"));
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
    // Data already committed inside the RPC — the response stays 200; the
    // audit gap is surfaced out-of-band, not by failing the commit.
    expect(res.status).toBe(200);

    // The completeness alert fires from the deferred after()/microtask
    // flush — drain the microtask queue before asserting.
    await new Promise((r) => setTimeout(r, 0));

    expect(captureToSentry).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({
        tags: expect.objectContaining({ scenario_commit_audit_incomplete: "true" }),
        extra: expect.objectContaining({ failed: 1, total: 2 }),
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

describe("T_R20 — Idempotency-Key dedup (P1945, migration 131 SQL-side)", () => {
  // Migration 131 moved the cache lookup + reservation + write INTO the
  // commit_scenario_batch RPC. The route now just passes the key + hash to
  // the RPC and inspects the envelope. These tests therefore mock mockRpc
  // (the only Postgres surface the route touches for idempotency) and
  // assert on:
  //   - WHAT THE ROUTE PASSES to the RPC (p_idempotency_key, p_request_hash)
  //   - HOW THE ROUTE MAPS the RPC's envelope shape to HTTP status
  //
  // The admin-client mock throws on `.from(...)` (see top-of-file mock) so
  // any regression that re-introduces route-layer cache plumbing fails the
  // suite immediately. stampOutcomeMarker is mocked separately above.
  const KEY = "a".repeat(24);

  it("valid Idempotency-Key is passed to the RPC as p_idempotency_key + p_request_hash", async () => {
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

    expect(mockRpc).toHaveBeenCalledWith(
      "commit_scenario_batch",
      expect.objectContaining({
        p_allocator_id: "alloc-A",
        p_idempotency_key: KEY,
        p_request_hash: expect.stringMatching(/^[a-f0-9]{64}$/),
      }),
    );
    // Route does not touch admin.from() directly — the SQL function
    // handles caching. The admin-mock would throw if the route did.
  });

  it("RPC ok:true + cached:true returns 200 WITHOUT re-emitting audit events", async () => {
    // The original commit (whoever wrote the cache row) already emitted
    // audit events. A cached replay must NOT duplicate them.
    mockRpc.mockResolvedValueOnce({
      data: {
        ok: true,
        cached: true,
        recorded: [
          { index: 0, match_decision_id: "md-1", bridge_outcome_id: "bo-1", kind: "voluntary_remove" },
        ],
      },
      error: null,
    });

    const res = await POST(mkReqWithIdempotency({ diffs: [VALID_VR] }, KEY));
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("private, no-store");

    const body = await res.json();
    expect(body.recorded).toBe(1);
    // Critical: NO audit emission on cached replay.
    expect(emit).not.toHaveBeenCalled();
  });

  it("RPC ok:false + code=idempotency_body_mismatch → 422 (RFC §2.5)", async () => {
    mockRpc.mockResolvedValueOnce({
      data: {
        ok: false,
        errors: [
          {
            index: -1,
            error: "Idempotency-Key reuse with different body",
            code: "idempotency_body_mismatch",
          },
        ],
      },
      error: null,
    });

    const res = await POST(mkReqWithIdempotency({ diffs: [VALID_VR] }, KEY));
    expect(res.status).toBe(422);
    expect(res.headers.get("Cache-Control")).toBe("private, no-store");
    const body = await res.json();
    expect(body.error).toMatch(/Idempotency-Key reuse/i);
    expect(emit).not.toHaveBeenCalled();
  });

  it("RPC ok:false + code=idempotency_in_flight → 409 with Retry-After", async () => {
    // A concurrent retry holds the placeholder row inside the SQL function.
    // The route maps this to 409 so the client can re-poll.
    mockRpc.mockResolvedValueOnce({
      data: {
        ok: false,
        errors: [
          {
            index: -1,
            error: "Idempotent commit is already in flight",
            code: "idempotency_in_flight",
          },
        ],
      },
      error: null,
    });

    const res = await POST(mkReqWithIdempotency({ diffs: [VALID_VR] }, KEY));
    expect(res.status).toBe(409);
    expect(res.headers.get("Cache-Control")).toBe("private, no-store");
    expect(res.headers.get("Retry-After")).toBe("1");
    expect(emit).not.toHaveBeenCalled();
  });

  it("RPC ok:false + code=idempotency_schema_drift → 503", async () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    mockRpc.mockResolvedValueOnce({
      data: {
        ok: false,
        errors: [
          {
            index: -1,
            error: "Cached response has an unknown schema_version",
            code: "idempotency_schema_drift",
          },
        ],
      },
      error: null,
    });

    const res = await POST(mkReqWithIdempotency({ diffs: [VALID_VR] }, KEY));
    expect(res.status).toBe(503);
    expect(res.headers.get("Cache-Control")).toBe("private, no-store");
    expect(consoleSpy).toHaveBeenCalledWith(
      "[scenario-commit] idempotency schema drift:",
      expect.objectContaining({ user_id: "alloc-A" }),
    );
    consoleSpy.mockRestore();
  });

  it("key boundary: 16 chars (min) → RPC receives p_idempotency_key", async () => {
    const minKey = "k".repeat(16);
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
    expect(mockRpc).toHaveBeenCalledWith(
      "commit_scenario_batch",
      expect.objectContaining({ p_idempotency_key: minKey }),
    );
  });

  it("key boundary: 128 chars (max) → RPC receives p_idempotency_key", async () => {
    const maxKey = "k".repeat(128);
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
    expect(mockRpc).toHaveBeenCalledWith(
      "commit_scenario_batch",
      expect.objectContaining({ p_idempotency_key: maxKey }),
    );
  });

  it("key boundary: 129 chars → 400 (PR-2 reviewer #2 hardening)", async () => {
    const overKey = "k".repeat(129);
    const res = await POST(mkReqWithIdempotency({ diffs: [VALID_VR] }, overKey));
    expect(res.status).toBe(400);
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it("Idempotency-Key with non-RFC-charset (space) → 400 (PR-2 reviewer #2 hardening)", async () => {
    const spacedKey = "abcdefghijklmnop qrstuvwx";
    const res = await POST(mkReqWithIdempotency({ diffs: [VALID_VR] }, spacedKey));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("Idempotency-Key format invalid");
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it("Idempotency-Key too short (8 chars) → 400 (PR-2 reviewer #2 hardening)", async () => {
    // Pre-PR-2 the route silently dropped a malformed key and treated the
    // commit as non-idempotent. That turned a client's retry storm under
    // a stuck Idempotency-Key into a duplicate-commit vector. Per RFC
    // draft-ietf-httpapi-idempotency-key §2.5, a present-but-invalid key
    // must be rejected, not ignored.
    const res = await POST(mkReqWithIdempotency({ diffs: [VALID_VR] }, "shortkey"));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("Idempotency-Key format invalid");
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it("request without Idempotency-Key header → RPC called with p_idempotency_key=null", async () => {
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
    expect(mockRpc).toHaveBeenCalledWith(
      "commit_scenario_batch",
      expect.objectContaining({
        p_idempotency_key: null,
        p_request_hash: null,
      }),
    );
  });
});

// ===========================================================================
// T_R21 — RPC error → 500 + Cache-Control (round-2-D test-analyzer M2)
// ===========================================================================

describe("T_R21 — RPC error 500 path", () => {
  it("RPC error returns 500 with Cache-Control + no audit", async () => {
    mockRpc.mockResolvedValueOnce({
      data: null,
      error: { code: "P0001", message: "RPC blew up" },
    });

    const res = await POST(
      mkReqWithIdempotency({ diffs: [VALID_VR] }, "k".repeat(24)),
    );
    expect(res.status).toBe(500);
    expect(res.headers.get("Cache-Control")).toBe("private, no-store");
    expect(emit).not.toHaveBeenCalled();
    // Migration 131: when the RPC raises EXCEPTION the function's
    // transaction (including the idempotency placeholder reservation) rolls
    // back. The route does not need to do anything else — the cache stays
    // clean.
  });

  // M-0295 (api-contract) — the RPC is SECURITY DEFINER and its RAISE
  // EXCEPTION messages (migration 082/131) embed internal state: the literal
  // holding_ref, strategy_id, row index, the `auth.uid() <> p_allocator_id`
  // guard text, plus raw Postgres constraint/column names on an unexpected
  // error. The route must NOT echo rpcErr.message to the allocator client —
  // it logs the full message server-side and returns a stable, opaque body.
  // This test fails if a regression re-introduces the raw-message echo.
  it("does NOT leak the raw RPC error message to the client (M-0295)", async () => {
    const leak =
      "commit_scenario_batch[index=0]: holding_ref holding:binance:BTC:spot not owned by allocator a1b2c3d4";
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    mockRpc.mockResolvedValueOnce({
      data: null,
      error: { code: "P0001", message: leak },
    });

    const res = await POST(mkReq({ diffs: [VALID_VR] }));
    expect(res.status).toBe(500);

    const body = await res.json();
    // Stable, opaque client message — the schema-bearing RPC string must be
    // fully absent from BOTH fields of the response body.
    expect(body.error).toBe("Commit failed");
    expect(body.message).not.toContain("holding_ref");
    expect(body.message).not.toContain("binance");
    expect(body.message).not.toContain("commit_scenario_batch");
    expect(body.message).not.toBe(leak);
    expect(JSON.stringify(body)).not.toContain(leak);

    // The full message is still logged server-side for diagnostics — the
    // fix suppresses client leakage, not observability.
    expect(consoleSpy).toHaveBeenCalledWith(
      "scenario_commit RPC error",
      expect.objectContaining({ message: leak, user: "alloc-A" }),
    );
    consoleSpy.mockRestore();
  });
});

// ===========================================================================
// T_R22 — Idempotency + voluntary_modify post-normalisation
// (round-2-D test-analyzer M1)
// ===========================================================================

describe("T_R22 — Idempotency + voluntary_modify percent normalisation", () => {
  it("modify with new_weight + Idempotency-Key passes normalised percent + hash to the RPC", async () => {
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

    // RPC receives the normalised percent_allocated (8 = 0.08 * 100) AND
    // the new idempotency params. Migration 131 SQL handles the cache row.
    expect(mockRpc).toHaveBeenCalledWith(
      "commit_scenario_batch",
      expect.objectContaining({
        p_diffs: expect.arrayContaining([
          expect.objectContaining({
            kind: "voluntary_modify",
            percent_allocated: 8,
          }),
        ]),
        p_idempotency_key: key,
        p_request_hash: expect.stringMatching(/^[a-f0-9]{64}$/),
      }),
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
    expect(emit).toHaveBeenCalledTimes(2);

    const calls = (emit as unknown as { mock: { calls: unknown[][] } })
      .mock.calls as Array<
      [unknown, { metadata: { commit_batch_id: string } }]
    >;
    const batchId1 = calls[0][1].metadata.commit_batch_id;
    const batchId2 = calls[1][1].metadata.commit_batch_id;

    expect(batchId1).toMatch(/^[0-9a-f-]{36}$/);
    expect(batchId2).toBe(batchId1);
  });
});

// ===========================================================================
// NEW-C18-04 (PR-2 2026-05-28) — audit-trust server-side size recompute
//
// Specialist code-reviewer flagged C1: a naive SUM(value_usd) would inflate
// AUM by the per-day snapshot count (UNIQUE allocator_id+venue+symbol+asof
// in migration 20260420073003). Fix uses .order("asof", desc) + first-seen-
// wins dedup per (venue, symbol, holding_type) to mirror the RPC's MAX(asof).
// These tests pin the contract so a regression cannot silently reintroduce
// the SUM-all-history bug.
// ===========================================================================

describe("NEW-C18-04 — server-side audit recompute of size_at_decision_usd", () => {
  function getAuditMetadata(call: number): Record<string, unknown> {
    const calls = (emit as unknown as { mock: { calls: unknown[][] } })
      .mock.calls as Array<[unknown, { metadata: Record<string, unknown> }]>;
    return calls[call][1].metadata;
  }

  it("voluntary_add: server_size = percent_allocated × total_aum / 100, source = server_aum", async () => {
    // Two holdings, latest asof: 80k + 120k = 200k AUM
    holdingsFixture = [
      { venue: "binance", symbol: "BTC", holding_type: "spot", value_usd: 80_000, asof: "2026-05-28" },
      { venue: "binance", symbol: "ETH", holding_type: "spot", value_usd: 120_000, asof: "2026-05-28" },
    ];
    mockRpc.mockResolvedValueOnce({
      data: {
        ok: true,
        recorded: [
          { index: 0, match_decision_id: "md-1", bridge_outcome_id: "bo-1", kind: "voluntary_add" },
        ],
      },
      error: null,
    });

    // Client claims size=999_999 — bogus. percent_allocated=5 → server says 5% × 200k = 10_000.
    const liarDiff = { ...VALID_VA, size_at_decision_usd: 999_999, percent_allocated: 5 };
    const res = await POST(mkReq({ diffs: [liarDiff] }));
    expect(res.status).toBe(200);

    const meta = getAuditMetadata(0);
    expect(meta._size_source).toBe("server_aum");
    expect(meta.size_at_decision_usd).toBe(10_000);
    expect(meta.size_at_decision_usd_client).toBe(999_999);
  });

  it("voluntary_remove: server_size = holding.value_usd, source = server_holding", async () => {
    holdingsFixture = [
      { venue: "binance", symbol: "BTC", holding_type: "spot", value_usd: 42_000, asof: "2026-05-28" },
    ];
    mockRpc.mockResolvedValueOnce({
      data: {
        ok: true,
        recorded: [
          { index: 0, match_decision_id: "md-1", bridge_outcome_id: "bo-1", kind: "voluntary_remove" },
        ],
      },
      error: null,
    });

    // Client claims size=1_000 (way under real 42_000). Server recomputes.
    const liarDiff = { ...VALID_VR, size_at_decision_usd: 1_000 };
    const res = await POST(mkReq({ diffs: [liarDiff] }));
    expect(res.status).toBe(200);

    const meta = getAuditMetadata(0);
    expect(meta._size_source).toBe("server_holding");
    expect(meta.size_at_decision_usd).toBe(42_000);
    expect(meta.size_at_decision_usd_client).toBe(1_000);
  });

  it("lookup_failed: holdings SELECT errors → _size_source = lookup_failed, server_size = null", async () => {
    holdingsErrorFixture = { message: "connection refused (test)" };
    mockRpc.mockResolvedValueOnce({
      data: {
        ok: true,
        recorded: [
          { index: 0, match_decision_id: "md-1", bridge_outcome_id: "bo-1", kind: "voluntary_add" },
        ],
      },
      error: null,
    });

    const res = await POST(mkReq({ diffs: [VALID_VA] }));
    // Audit recompute failure must NOT fail the commit — the data layer
    // already landed via the RPC.
    expect(res.status).toBe(200);

    const meta = getAuditMetadata(0);
    expect(meta._size_source).toBe("lookup_failed");
    expect(meta.size_at_decision_usd).toBeNull();
    // Client number preserved for forensic diff.
    expect(meta.size_at_decision_usd_client).toBe(VALID_VA.size_at_decision_usd);
  });

  it("C1 REGRESSION: multi-asof per holding → latest-only wins, AUM is NOT summed across history", async () => {
    // 3 snapshots of the same BTC holding across 3 days. If the bug returned
    // the AUM would be 100k+50k+10k = 160k (and server_size = 5% × 160k = 8_000).
    // With latest-asof-only, AUM is just the newest snapshot (100k → 5_000).
    holdingsFixture = [
      // Order DESC — newest first (mirrors .order("asof", { ascending: false }))
      { venue: "binance", symbol: "BTC", holding_type: "spot", value_usd: 100_000, asof: "2026-05-28" },
      { venue: "binance", symbol: "BTC", holding_type: "spot", value_usd:  50_000, asof: "2026-05-27" },
      { venue: "binance", symbol: "BTC", holding_type: "spot", value_usd:  10_000, asof: "2026-05-26" },
    ];
    mockRpc.mockResolvedValueOnce({
      data: {
        ok: true,
        recorded: [
          { index: 0, match_decision_id: "md-1", bridge_outcome_id: "bo-1", kind: "voluntary_add" },
        ],
      },
      error: null,
    });

    const diff = { ...VALID_VA, percent_allocated: 5 };
    const res = await POST(mkReq({ diffs: [diff] }));
    expect(res.status).toBe(200);

    const meta = getAuditMetadata(0);
    expect(meta._size_source).toBe("server_aum");
    // Latest BTC snapshot is 100k. 5% × 100k = 5_000. Sum-all-history would be 8_000.
    expect(meta.size_at_decision_usd).toBe(5_000);
  });

  it("C1 REGRESSION: voluntary_remove picks the LATEST asof value, not a stale snapshot", async () => {
    holdingsFixture = [
      { venue: "binance", symbol: "BTC", holding_type: "spot", value_usd: 75_000, asof: "2026-05-28" }, // latest
      { venue: "binance", symbol: "BTC", holding_type: "spot", value_usd:  1_000, asof: "2024-01-01" }, // ancient
    ];
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

    const meta = getAuditMetadata(0);
    // Must be 75_000 (latest), NOT 1_000 (ancient) and NOT 76_000 (sum).
    expect(meta.size_at_decision_usd).toBe(75_000);
    expect(meta._size_source).toBe("server_holding");
  });
});

describe("T_R24 — B11 / NEW-C18-10 portfolio-fingerprint precondition", () => {
  it("forwards init_holdings_fingerprint from the body to the RPC as p_portfolio_fingerprint", async () => {
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
      mkReq({ diffs: [VALID_VR], init_holdings_fingerprint: "BTC:binance:spot" }),
    );
    expect(res.status).toBe(200);
    expect(mockRpc).toHaveBeenCalledWith(
      "commit_scenario_batch",
      expect.objectContaining({ p_portfolio_fingerprint: "BTC:binance:spot" }),
    );
  });

  it("passes p_portfolio_fingerprint: null when the body omits init_holdings_fingerprint (backward compat)", async () => {
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
    expect(mockRpc).toHaveBeenCalledWith(
      "commit_scenario_batch",
      expect.objectContaining({ p_portfolio_fingerprint: null }),
    );
  });

  it("RPC ok:false + code=portfolio_fingerprint_stale → 409 (no Retry-After), no audit", async () => {
    // The holdings changed since the draft was built; the RPC recomputed the
    // current fingerprint, found divergence, and committed nothing. The route
    // maps this to 409 Conflict (reload) — and, unlike idempotency_in_flight,
    // WITHOUT a Retry-After header: a stale-snapshot conflict is resolved by a
    // reload, not a timed retry.
    mockRpc.mockResolvedValueOnce({
      data: {
        ok: false,
        errors: [
          {
            index: -1,
            error: "Portfolio holdings changed since this scenario draft was created",
            code: "portfolio_fingerprint_stale",
          },
        ],
      },
      error: null,
    });

    const res = await POST(
      mkReq({ diffs: [VALID_VR], init_holdings_fingerprint: "BTC:binance:spot" }),
    );
    expect(res.status).toBe(409);
    expect(res.headers.get("Cache-Control")).toBe("private, no-store");
    expect(res.headers.get("Retry-After")).toBeNull();
    const body = await res.json();
    expect(body.code).toBe("portfolio_fingerprint_stale");
    expect(body.error).toMatch(/Portfolio changed/i);
    expect(emit).not.toHaveBeenCalled();
  });
});
