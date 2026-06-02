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
// NextResponse is imported STATICALLY (like every sibling route.test.ts and
// like route.ts under test) rather than via a dynamic `await import` inside a
// test body. A dynamic import under vi.mock isolation can resolve to a
// DIFFERENT NextResponse module instance than the handler's, so the handler's
// early-return `if (csrfError) return csrfError;` would forward a foreign
// object whose `.status` the test reads by luck. Sharing the one static
// instance keeps the fixture and the production code on the same contract.
import { NextRequest, NextResponse } from "next/server";
// PostgrestError is imported as a VALUE (it is a class extending Error) so the
// fixtures can construct real instances; AuthUser is type-only.
import { PostgrestError } from "@supabase/supabase-js";
import type { AuthUser } from "@supabase/supabase-js";

// The supabase delete builder the handler exercises is EXACTLY
// `.delete().eq("user_id", …).eq("strategy_id", …)` then awaited. We model
// that contract explicitly instead of a `chain as unknown as {…}` double-cast:
// each `.eq()` returns either the same builder (more filters to chain) or the
// awaited `{ error }` result. If a future supabase-js upgrade changed the
// filter method (e.g. renamed `.eq` → `.match`, or the handler grew a third
// `.eq()`), this interface would no longer describe what `route.ts` calls and
// the mock would stop type-checking — surfacing the drift in the test build.
interface MockSupabaseDeleteResult {
  error: PostgrestError | null;
}
interface MockSupabaseDeleteChain {
  eq(
    col: string,
    val: string,
  ): MockSupabaseDeleteChain | Promise<MockSupabaseDeleteResult>;
}

/**
 * Construct a real PostgrestError so error fixtures match the production
 * `PostgrestError | null` contract supabase-js returns — not a bare
 * `{ message }` object the handler's `error.message ?? error` only happens to
 * tolerate. Seeding a wrong-shape error (a string, a number) now fails to
 * compile rather than running green against a fiction.
 */
function makePgError(message: string): PostgrestError {
  return new PostgrestError({
    message,
    details: "",
    hint: "",
    code: "P0001",
  });
}

// vi.hoisted lets the mock factories below reach the recorder.
const recorders = vi.hoisted(() => ({
  // Typed as the real supabase `User | null`. The handler reads `user.id`;
  // pinning the full `User` shape means a future handler that reads
  // `user.email` / `user.app_metadata.role` sees the fixture's real value
  // instead of a silent `undefined` from a `{ id }`-only stub.
  user: null as AuthUser | null,
  upsertCalls: [] as Array<{
    table: string;
    row: Record<string, unknown>;
    options: Record<string, unknown>;
  }>,
  deleteCalls: [] as Array<{
    table: string;
    eqs: Array<[string, string]>;
  }>,
  // Strict `PostgrestError | null` — supabase-js never returns a string/number
  // here, and the test must not be allowed to pretend it does.
  upsertResponse: { error: null as PostgrestError | null },
  deleteResponse: { error: null as PostgrestError | null },
  rateLimitResponse: { success: true as boolean, retryAfter: 0 as number },
  rateLimitCalls: [] as string[],
  csrfReturn: null as NextResponse | null,
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
      delete: (): MockSupabaseDeleteChain => {
        const eqs: Array<[string, string]> = [];
        const chain: MockSupabaseDeleteChain = {
          eq(col: string, val: string) {
            eqs.push([col, val]);
            // After 2 .eq() calls (user_id + strategy_id) await resolves —
            // mirrors supabase-js, where `.eq().eq()` yields a thenable.
            if (eqs.length >= 2) {
              recorders.deleteCalls.push({ table, eqs: [...eqs] });
              return Promise.resolve({ error: recorders.deleteResponse.error });
            }
            return chain;
          },
        };
        return chain;
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

// A complete supabase `User`, not a `{ id }` stub. Typing the recorder slot as
// the real `AuthUser` forces this fixture to carry every field the production
// auth contract guarantees (id, app_metadata, user_metadata, aud, created_at),
// so a handler that later reads e.g. `user.app_metadata.role` exercises a real
// value here instead of silently reading `undefined` off a partial mock.
const VALID_USER: AuthUser = {
  id: "00000000-0000-0000-0000-000000000aaa",
  app_metadata: { provider: "email" },
  user_metadata: {},
  aud: "authenticated",
  created_at: "2026-01-01T00:00:00.000Z",
  email: "allocator@quantalyze.test",
  role: "authenticated",
};
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
    // The handler constructs this response with its OWN `NextResponse.json`.
    // Asserting `instanceof NextResponse` against the test's statically-imported
    // class proves the handler and the test resolve the SAME next/server module
    // instance. A reintroduced dynamic `await import("next/server")` (or any
    // vi.mock isolation that forks the module) would make this fail — catching
    // the cross-instance divergence the contract-drift finding warns about,
    // which a `res.status` check alone (works on any Response-like) would miss.
    expect(res).toBeInstanceOf(NextResponse);
  });

  it("returns 403 when assertSameOrigin returns a NextResponse (CSRF mismatch)", async () => {
    // Uses the statically-imported NextResponse — the SAME module instance the
    // handler imports — so the handler's `if (csrfError) return csrfError;`
    // forwards exactly this object. The route is expected to short-circuit
    // BEFORE auth/body/rate-limit, so we also pin that the supabase mock was
    // never touched (no upsert/delete recorded).
    recorders.csrfReturn = NextResponse.json(
      { error: "Origin not allowed" },
      { status: 403 },
    );
    const res = await PUT(makeReq({ action: "add" }), makeCtx());
    expect(res.status).toBe(403);
    expect(res).toBe(recorders.csrfReturn);
    expect(recorders.upsertCalls).toHaveLength(0);
    expect(recorders.deleteCalls).toHaveLength(0);
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
    // A real PostgrestError, the only error shape supabase-js returns. The
    // handler logs `error.message ?? error`, so the fixture MUST carry a
    // `.message` — seeding a bare `{ message }` (or worse, a string) would no
    // longer type-check against the `PostgrestError | null` recorder slot.
    recorders.upsertResponse = { error: makePgError("db down") };
    const res = await PUT(makeReq({ action: "add" }), makeCtx());
    expect(res.status).toBe(500);
  });

  it("returns 500 when supabase delete reports an error", async () => {
    recorders.deleteResponse = { error: makePgError("db down") };
    const res = await PUT(makeReq({ action: "remove" }), makeCtx());
    expect(res.status).toBe(500);
  });
});
