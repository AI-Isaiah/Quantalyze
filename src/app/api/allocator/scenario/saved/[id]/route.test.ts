/**
 * Phase 23 / Plan 02 / PERSIST-03 — TDD tests for
 * PATCH / PUT / DELETE /api/allocator/scenario/saved/[id].
 *
 * Covered behaviours:
 *   T_I1  Non-uuid id                                                       → 400 (before auth/limiter)
 *   T_I2  No auth (allocator gate)                                          → 401
 *   T_I3  PATCH empty/over-length name                                      → 400, limiter NOT called
 *   T_I4  PUT invalid body (missing draft)                                  → 400, limiter NOT called
 *   T_I5  Rate-limit denied → 429 + Retry-After; misconfig → 503
 *   T_I6  PATCH success → 200; update fired
 *   T_I7  PUT success → 200; update touches updated_at + schema_version
 *   T_I8  DELETE success → 200
 *   T_I9  PATCH/PUT/DELETE on a PGRST116 / empty result → 404 (not 403)
 *         (these prove the mock-injected 0-rows path returns 404, NOT tenant
 *         isolation — the real cross-tenant proof is supabase/tests/test_scenarios_rls.sql)
 *   T_I10 DB error → redacted stable message (NOT raw error.message), 500
 *   T_I11 NO_STORE_HEADERS on every response (success + error)
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("server-only", () => ({}));

const MOCK_USER = { id: "alloc-A" } as unknown as import("@supabase/supabase-js").User;
let authShouldFail = false;

vi.mock("@/lib/api/withAllocatorAuth", () => ({
  withAllocatorAuth:
    (h: (req: NextRequest, user: typeof MOCK_USER) => unknown) => (req: NextRequest) => {
      if (authShouldFail) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), {
          status: 401,
          headers: { "content-type": "application/json", "Cache-Control": "private, no-store" },
        });
      }
      return h(req, MOCK_USER);
    },
}));

// ---------------------------------------------------------------------------
// Mock supabase server client — chainable builder for the update/delete paths:
//   .from("scenarios").update(payload).eq("id", id).select(cols).single()
//   .from("scenarios").delete().eq("id", id).select(cols)
// Capture the update payload + the eq("id", …) filter.
// ---------------------------------------------------------------------------

type DbResult = { data: unknown; error: { code?: string; message: string } | null };
let updateResult: DbResult = { data: { id: "scen-1" }, error: null };
let deleteResult: DbResult = { data: [{ id: "scen-1" }], error: null };
let lastUpdatePayload: Record<string, unknown> | null = null;
let lastEqFilter: [string, unknown] | null = null;

function buildChain() {
  return {
    update(payload: Record<string, unknown>) {
      lastUpdatePayload = payload;
      return {
        eq: (col: string, val: unknown) => {
          lastEqFilter = [col, val];
          return {
            select: () => ({
              single: async () => updateResult,
            }),
          };
        },
      };
    },
    delete() {
      return {
        eq: (col: string, val: unknown) => {
          lastEqFilter = [col, val];
          return {
            select: async () => deleteResult,
          };
        },
      };
    },
  };
}

const fromSpy = vi.fn(() => buildChain());
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ from: fromSpy }),
}));

// ---------------------------------------------------------------------------
// Mock rate limiter
// ---------------------------------------------------------------------------

let rateLimitState: "allow" | "deny" | "misconfig" = "allow";
const checkLimitMock = vi.fn(async () => {
  if (rateLimitState === "allow") return { success: true };
  if (rateLimitState === "misconfig")
    return { success: false, retryAfter: 60, reason: "ratelimit_misconfigured" };
  return { success: false, retryAfter: 42 };
});
vi.mock("@/lib/ratelimit", () => ({
  userActionLimiter: {},
  checkLimit: (...args: unknown[]) => checkLimitMock(...(args as [])),
  isRateLimitMisconfigured: (rl: { success: boolean; reason?: string }) =>
    rl.success === false && rl.reason === "ratelimit_misconfigured",
}));

vi.mock("@/lib/sentry-capture", () => ({ captureToSentry: vi.fn() }));

// ---------------------------------------------------------------------------
// Imports after mocks
// ---------------------------------------------------------------------------

import { PATCH, PUT, DELETE } from "./route";
import { MAX_DRAFT_BODY_BYTES } from "../route";

const VALID_ID = "11111111-2222-4333-8444-555555555555";
const PGRST_NO_ROWS = "PGRST116";

const VALID_DRAFT = {
  schema_version: 2,
  init_holdings_fingerprint: "BTC:binance:spot",
  toggleByScopeRef: { "holding:binance:BTC:spot": true },
  addedStrategies: [],
  weightOverrides: { "holding:binance:BTC:spot": 1 },
  lastEditedAt: "2026-06-21T00:00:00.000Z",
};

function mkReq(method: string, body?: unknown) {
  return new NextRequest(
    new URL(`http://localhost/api/allocator/scenario/saved/${VALID_ID}`),
    {
      method,
      headers: { "content-type": "application/json", origin: "http://localhost" },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    },
  );
}

// FIX A — request with a raw (already-serialised) body string so a test can
// craft an oversized payload the byte-cap must reject before parse.
function mkReqRaw(method: string, rawBody: string) {
  return new NextRequest(
    new URL(`http://localhost/api/allocator/scenario/saved/${VALID_ID}`),
    {
      method,
      headers: { "content-type": "application/json", origin: "http://localhost" },
      body: rawBody,
    },
  );
}

function ctx(id: string) {
  return { params: Promise.resolve({ id }) };
}

beforeEach(() => {
  vi.clearAllMocks();
  authShouldFail = false;
  rateLimitState = "allow";
  updateResult = { data: { id: "scen-1", name: "Renamed" }, error: null };
  deleteResult = { data: [{ id: "scen-1" }], error: null };
  lastUpdatePayload = null;
  lastEqFilter = null;
});

// ===========================================================================
// id validation
// ===========================================================================

describe("[id] validation", () => {
  it("T_I1 — PATCH non-uuid id → 400 before auth/limiter", async () => {
    const res = await PATCH(mkReq("PATCH", { name: "x" }), ctx("not-a-uuid"));
    expect(res.status).toBe(400);
    expect(checkLimitMock).not.toHaveBeenCalled();
    expect(res.headers.get("Cache-Control")).toBe("private, no-store");
  });

  it("T_I1b — DELETE non-uuid id → 400", async () => {
    const res = await DELETE(mkReq("DELETE"), ctx("../etc/passwd"));
    expect(res.status).toBe(400);
  });
});

// ===========================================================================
// auth gate
// ===========================================================================

describe("auth gate", () => {
  it("T_I2 — PATCH 401 when the allocator gate fails", async () => {
    authShouldFail = true;
    const res = await PATCH(mkReq("PATCH", { name: "x" }), ctx(VALID_ID));
    expect(res.status).toBe(401);
  });
});

// ===========================================================================
// PATCH (rename)
// ===========================================================================

describe("PATCH (rename)", () => {
  it("T_I3 — 400 on empty name, limiter not called", async () => {
    const res = await PATCH(mkReq("PATCH", { name: "  " }), ctx(VALID_ID));
    expect(res.status).toBe(400);
    expect(checkLimitMock).not.toHaveBeenCalled();
  });

  it("T_I3b — 400 on over-length name", async () => {
    const res = await PATCH(mkReq("PATCH", { name: "z".repeat(121) }), ctx(VALID_ID));
    expect(res.status).toBe(400);
  });

  it("T_I6 — 200; update fired with name, filtered by id", async () => {
    const res = await PATCH(mkReq("PATCH", { name: "Renamed" }), ctx(VALID_ID));
    expect(res.status).toBe(200);
    expect(fromSpy).toHaveBeenCalledWith("scenarios");
    expect(lastUpdatePayload).toEqual({ name: "Renamed" });
    expect(lastEqFilter).toEqual(["id", VALID_ID]);
    expect(res.headers.get("Cache-Control")).toBe("private, no-store");
  });

  // NOTE: the 0-rows result is MOCK-INJECTED (updateResult.error = PGRST116),
  // so this proves "PGRST116 / empty result → 404 (RLS-filtered row not
  // visible)" — it does NOT exercise real RLS and would stay green even if the
  // scenarios_owner policy were dropped. The actual cross-tenant isolation
  // proof lives in supabase/tests/test_scenarios_rls.sql.
  it("T_I9 — PGRST116 / empty result → 404 (RLS-filtered row not visible), not 403", async () => {
    updateResult = { data: null, error: { code: PGRST_NO_ROWS, message: "no rows" } };
    const res = await PATCH(mkReq("PATCH", { name: "x" }), ctx(VALID_ID));
    expect(res.status).toBe(404);
    expect(res.headers.get("Cache-Control")).toBe("private, no-store");
  });

  it("T_I5 — rate-limit denied → 429 + Retry-After; misconfig → 503", async () => {
    rateLimitState = "deny";
    const denied = await PATCH(mkReq("PATCH", { name: "x" }), ctx(VALID_ID));
    expect(denied.status).toBe(429);
    expect(denied.headers.get("Retry-After")).toBe("42");

    rateLimitState = "misconfig";
    const misc = await PATCH(mkReq("PATCH", { name: "x" }), ctx(VALID_ID));
    expect(misc.status).toBe(503);
  });
});

// ===========================================================================
// PUT (update draft)
// ===========================================================================

describe("PUT (update draft)", () => {
  it("T_I4 — 400 on missing draft, limiter not called", async () => {
    const res = await PUT(mkReq("PUT", { name: "x" }), ctx(VALID_ID));
    expect(res.status).toBe(400);
    expect(checkLimitMock).not.toHaveBeenCalled();
  });

  it("T_I7 — 200; update touches updated_at + schema_version from the draft", async () => {
    const res = await PUT(mkReq("PUT", { name: "Updated", draft: VALID_DRAFT }), ctx(VALID_ID));
    expect(res.status).toBe(200);
    expect(lastUpdatePayload).not.toBeNull();
    expect(lastUpdatePayload!.name).toBe("Updated");
    expect(lastUpdatePayload!.schema_version).toBe(2);
    // updated_at touched in the route payload (no trigger fn).
    expect(typeof lastUpdatePayload!.updated_at).toBe("string");
    expect(Number.isNaN(Date.parse(lastUpdatePayload!.updated_at as string))).toBe(false);
    expect(lastEqFilter).toEqual(["id", VALID_ID]);
  });

  // Mock-injected PGRST116 → 404; not a real RLS exercise. Cross-tenant proof:
  // supabase/tests/test_scenarios_rls.sql.
  it("T_I9b — PUT on a PGRST116 / empty result → 404 (RLS-filtered row not visible)", async () => {
    updateResult = { data: null, error: { code: PGRST_NO_ROWS, message: "no rows" } };
    const res = await PUT(mkReq("PUT", { name: "x", draft: VALID_DRAFT }), ctx(VALID_ID));
    expect(res.status).toBe(404);
  });

  it("T_I10 — DB error → redacted message (not raw error.message), 500", async () => {
    updateResult = {
      data: null,
      error: { code: "42703", message: 'column "draft" does not exist' },
    };
    const res = await PUT(mkReq("PUT", { name: "x", draft: VALID_DRAFT }), ctx(VALID_ID));
    expect(res.status).toBe(500);
    const json = await res.json();
    expect(JSON.stringify(json)).not.toContain("does not exist");
    expect(json.message).toContain("Couldn't update this scenario");
    expect(res.headers.get("Cache-Control")).toBe("private, no-store");
  });

  // FIX A (HIGH, DoS / storage-poison) — an oversized raw body is rejected
  // with 413 BEFORE JSON.parse, WITHOUT writing (no update) and WITHOUT
  // consuming a rate-limit token.
  it("T_I12 — PUT oversized body → 413, no update, no token consumed", async () => {
    const oversized = "x".repeat(MAX_DRAFT_BODY_BYTES + 1);
    const res = await PUT(mkReqRaw("PUT", oversized), ctx(VALID_ID));
    expect(res.status).toBe(413);
    expect(fromSpy).not.toHaveBeenCalled(); // nothing written
    expect(checkLimitMock).not.toHaveBeenCalled(); // no token burned
    expect(res.headers.get("Cache-Control")).toBe("private, no-store");
  });

  it("T_I13 — a normal (under-cap) PUT still updates", async () => {
    const res = await PUT(mkReq("PUT", { name: "Updated", draft: VALID_DRAFT }), ctx(VALID_ID));
    expect(res.status).toBe(200);
    expect(fromSpy).toHaveBeenCalledWith("scenarios");
  });
});

// ===========================================================================
// DELETE
// ===========================================================================

describe("DELETE", () => {
  it("T_I8 — 200 on success; delete filtered by id", async () => {
    const res = await DELETE(mkReq("DELETE"), ctx(VALID_ID));
    expect(res.status).toBe(200);
    expect(lastEqFilter).toEqual(["id", VALID_ID]);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(res.headers.get("Cache-Control")).toBe("private, no-store");
  });

  // Mock-injected empty result (deleteResult.data = []) → 404; not a real RLS
  // exercise. Cross-tenant proof: supabase/tests/test_scenarios_rls.sql.
  it("T_I9c — DELETE on an empty result (0 rows returned) → 404 (RLS-filtered row not visible), not 403", async () => {
    deleteResult = { data: [], error: null };
    const res = await DELETE(mkReq("DELETE"), ctx(VALID_ID));
    expect(res.status).toBe(404);
    expect(res.headers.get("Cache-Control")).toBe("private, no-store");
  });

  it("T_I10b — DELETE DB error → redacted 500", async () => {
    deleteResult = { data: null, error: { message: "connection reset by peer" } };
    const res = await DELETE(mkReq("DELETE"), ctx(VALID_ID));
    expect(res.status).toBe(500);
    const json = await res.json();
    expect(JSON.stringify(json)).not.toContain("connection reset");
  });
});
