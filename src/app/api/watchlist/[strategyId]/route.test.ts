/**
 * Phase 13 / Plan 13-01 / DISCO-01 — Watchlist PUT route handler tests.
 *
 * Threat coverage (cross-link to 13-01-PLAN <threat_model>):
 *   - T-13-01-01 CSRF        → 403 when Origin/Referer missing-or-mismatched
 *   - T-13-01-02 DoS         → 429 when mandateAutoSaveLimiter is exhausted
 *   - T-13-01-03 IDOR        → DELETE constrained to (user_id, strategy_id)
 *   - T-13-01-06 input val   → 400 on body shape that is not { action: "add" | "remove" }
 *
 * The handler MUST be idempotent under rapid double-toggle:
 *   - add: upsert with onConflict='user_id,strategy_id' + ignoreDuplicates=true
 *     so a second `add` does NOT throw (PRIMARY KEY (user_id, strategy_id) on
 *     user_favorites — migration 024).
 *   - remove: a second `remove` after the row is gone is a no-op DELETE that
 *     resolves with 200 (Postgres treats "row not found" as a 0-row delete,
 *     not an error).
 *
 * The mock recorder pattern mirrors src/lib/queries.test.ts: vi.hoisted records
 * are reset in beforeEach, the supabase + ratelimit modules are mocked at
 * module top so the production code under test sees deterministic chains.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

// vi.hoisted lets the mock factories below reach the recorder.
const recorders = vi.hoisted(() => ({
  user: null as { id: string } | null,
  upsertCalls: [] as Array<{
    table: string;
    row: Record<string, unknown>;
    options: Record<string, unknown>;
  }>,
  deleteCalls: [] as Array<{
    table: string;
    eqs: Array<[string, string]>;
  }>,
  upsertResponse: { error: null as unknown },
  deleteResponse: { error: null as unknown },
  rateLimitResponse: { success: true as boolean, retryAfter: 0 as number },
  rateLimitCalls: [] as string[],
  csrfReturn: null as unknown,
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: {
      getUser: async () => ({ data: { user: recorders.user }, error: null }),
    },
    from: (table: string) => ({
      upsert: (row: Record<string, unknown>, options: Record<string, unknown>) => {
        recorders.upsertCalls.push({ table, row, options });
        return Promise.resolve({ error: recorders.upsertResponse.error });
      },
      delete: () => {
        const eqs: Array<[string, string]> = [];
        const chain: { eq: (col: string, val: string) => typeof chain | Promise<{ error: unknown }> } = {
          eq(col: string, val: string) {
            eqs.push([col, val]);
            // After 2 .eq() calls (user_id + strategy_id) await resolves.
            if (eqs.length >= 2) {
              recorders.deleteCalls.push({ table, eqs: [...eqs] });
              return Promise.resolve({ error: recorders.deleteResponse.error });
            }
            return chain;
          },
        };
        // Some chains resolve as a thenable — emulate the supabase-js behavior
        // where .eq().eq() returns a Promise on the final eq.
        return chain as unknown as { eq: (col: string, val: string) => unknown };
      },
    }),
  }),
}));

vi.mock("@/lib/csrf", () => ({
  assertSameOrigin: () => recorders.csrfReturn,
}));

vi.mock("@/lib/ratelimit", () => ({
  mandateAutoSaveLimiter: { __mock: "limiter" },
  checkLimit: async (_limiter: unknown, key: string) => {
    recorders.rateLimitCalls.push(key);
    if (recorders.rateLimitResponse.success) return { success: true };
    return { success: false, retryAfter: recorders.rateLimitResponse.retryAfter };
  },
}));

import { PUT } from "./route";

const VALID_USER = { id: "00000000-0000-0000-0000-000000000aaa" };
const STRATEGY_ID = "cccccccc-0001-4000-8000-000000000001";

function makeReq(body: unknown): NextRequest {
  return new NextRequest(`http://localhost:3000/api/watchlist/${STRATEGY_ID}`, {
    method: "PUT",
    headers: new Headers({
      "content-type": "application/json",
      origin: "http://localhost:3000",
    }),
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

function makeCtx(): { params: Promise<{ strategyId: string }> } {
  return { params: Promise.resolve({ strategyId: STRATEGY_ID }) };
}

beforeEach(() => {
  recorders.user = VALID_USER;
  recorders.upsertCalls = [];
  recorders.deleteCalls = [];
  recorders.upsertResponse = { error: null };
  recorders.deleteResponse = { error: null };
  recorders.rateLimitResponse = { success: true, retryAfter: 0 };
  recorders.rateLimitCalls = [];
  recorders.csrfReturn = null; // assertSameOrigin returns null on pass
});

describe("PUT /api/watchlist/[strategyId]", () => {
  it("returns 401 when supabase getUser returns null", async () => {
    recorders.user = null;
    const res = await PUT(makeReq({ action: "add" }), makeCtx());
    expect(res.status).toBe(401);
  });

  it("returns 403 when assertSameOrigin returns a NextResponse (CSRF mismatch)", async () => {
    recorders.csrfReturn = new (await import("next/server")).NextResponse(
      JSON.stringify({ error: "Origin not allowed" }),
      { status: 403 },
    );
    const res = await PUT(makeReq({ action: "add" }), makeCtx());
    expect(res.status).toBe(403);
  });

  it("returns 400 when body action is invalid", async () => {
    const res = await PUT(makeReq({ action: "garbage" }), makeCtx());
    expect(res.status).toBe(400);
  });

  it("returns 400 when body is missing action key", async () => {
    const res = await PUT(makeReq({}), makeCtx());
    expect(res.status).toBe(400);
  });

  it("returns 400 when body is non-JSON", async () => {
    const res = await PUT(makeReq("not json {{"), makeCtx());
    expect(res.status).toBe(400);
  });

  it("returns 429 when checkLimit reports failure with retryAfter", async () => {
    recorders.rateLimitResponse = { success: false, retryAfter: 30 };
    const res = await PUT(makeReq({ action: "add" }), makeCtx());
    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toBe("30");
  });

  it("calls checkLimit with key 'watchlist:{user.id}'", async () => {
    await PUT(makeReq({ action: "add" }), makeCtx());
    expect(recorders.rateLimitCalls).toEqual([`watchlist:${VALID_USER.id}`]);
  });

  it("action='add' calls upsert exactly once with onConflict + ignoreDuplicates", async () => {
    const res = await PUT(makeReq({ action: "add" }), makeCtx());
    expect(res.status).toBe(200);
    expect(recorders.upsertCalls).toHaveLength(1);
    expect(recorders.upsertCalls[0].table).toBe("user_favorites");
    expect(recorders.upsertCalls[0].row).toEqual({
      user_id: VALID_USER.id,
      strategy_id: STRATEGY_ID,
    });
    expect(recorders.upsertCalls[0].options).toMatchObject({
      onConflict: "user_id,strategy_id",
      ignoreDuplicates: true,
    });
  });

  it("action='remove' calls delete().eq(user_id).eq(strategy_id) exactly once", async () => {
    const res = await PUT(makeReq({ action: "remove" }), makeCtx());
    expect(res.status).toBe(200);
    expect(recorders.deleteCalls).toHaveLength(1);
    expect(recorders.deleteCalls[0].table).toBe("user_favorites");
    // Both eq filters must be present and reference the route + auth ids.
    const eqMap = Object.fromEntries(recorders.deleteCalls[0].eqs);
    expect(eqMap.user_id).toBe(VALID_USER.id);
    expect(eqMap.strategy_id).toBe(STRATEGY_ID);
  });

  it("action='add' twice in a row resolves 200 both times (server-side idempotency)", async () => {
    const r1 = await PUT(makeReq({ action: "add" }), makeCtx());
    const r2 = await PUT(makeReq({ action: "add" }), makeCtx());
    expect(r1.status).toBe(200);
    expect(r2.status).toBe(200);
    // Two upserts attempted; ignoreDuplicates=true silences the conflict.
    expect(recorders.upsertCalls).toHaveLength(2);
    for (const call of recorders.upsertCalls) {
      expect(call.options).toMatchObject({
        onConflict: "user_id,strategy_id",
        ignoreDuplicates: true,
      });
    }
  });

  it("action='remove' twice in a row resolves 200 both times (0-row delete is a no-op)", async () => {
    // M-0879 (audit-2026-05-07 / reverify-2026-05-25): the route header
    // contracts "a second remove on a non-existent row is a 0-row delete
    // (200)" (route.ts:11, :74-87). The add-twice path is pinned above, but
    // the symmetric remove-twice path was undocumented at the test layer.
    // The StarToggle retry path issues remove → remove on double-tap; if a
    // future refactor made the DELETE return 404/409 on a missing row, the
    // retry would surface a user-visible failure. Postgres treats "row not
    // found" as a 0-row delete (no error), so the second remove MUST still
    // resolve 200. Here the mock's delete resolves `{ error: null }` both
    // times (the gone-row case); the assertion is that the handler does NOT
    // turn a benign 0-row delete into a non-200.
    const r1 = await PUT(makeReq({ action: "remove" }), makeCtx());
    const r2 = await PUT(makeReq({ action: "remove" }), makeCtx());
    expect(r1.status).toBe(200);
    expect(r2.status).toBe(200);
    // Two deletes attempted; each constrained to (user_id, strategy_id).
    expect(recorders.deleteCalls).toHaveLength(2);
    for (const call of recorders.deleteCalls) {
      const eqMap = Object.fromEntries(call.eqs);
      expect(eqMap.user_id).toBe(VALID_USER.id);
      expect(eqMap.strategy_id).toBe(STRATEGY_ID);
    }
  });

  it("returns 500 when supabase upsert reports an error", async () => {
    recorders.upsertResponse = { error: { message: "db down" } };
    const res = await PUT(makeReq({ action: "add" }), makeCtx());
    expect(res.status).toBe(500);
  });

  it("returns 500 when supabase delete reports an error", async () => {
    recorders.deleteResponse = { error: { message: "db down" } };
    const res = await PUT(makeReq({ action: "remove" }), makeCtx());
    expect(res.status).toBe(500);
  });
});
