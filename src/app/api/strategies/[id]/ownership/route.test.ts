/**
 * Phase 150 / Plan 150-04 / OWN-03 — PATCH /api/strategies/[id]/ownership.
 *
 * The retro path (D-09 / D-11): an owner sets or changes the capital-ownership
 * mark on a strategy that was finalized before the wizard ever asked.
 *
 * Threat coverage (cross-link to 150-04-PLAN <threat_model>):
 *   - T-150-13 EoP        → cross-tenant mark via a forged id is a 404, never {ok:true}
 *   - T-150-16 Tampering  → a flip that would strand a live position is 409-until-confirmed,
 *                           and the confirmed removal runs the ONE-transaction RPC
 *   - T-150-17 Tampering  → mass assignment: only {mark, confirm_remove_allocation} are read
 *   - T-150-18 DoS        → checkLimit is consumed AFTER validation (B15 ordering)
 *   - T-150-19 Repudiation→ every successful write emits strategy.ownership_mark
 *
 * The mock recorder pattern mirrors src/app/api/watchlist/[strategyId]/route.test.ts:
 * vi.hoisted records are reset in beforeEach and the supabase / csrf / ratelimit
 * modules are mocked at module top so the handler sees deterministic chains.
 *
 * NextResponse is imported STATICALLY (never via a dynamic `await import` inside a
 * test body) so the handler's `if (csrfError) return csrfError;` forwards the very
 * object this file constructed — the same cross-instance contract the watchlist
 * suite pins at its :24-30 comment.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { NextRequest, NextResponse } from "next/server";
// PostgrestError is imported as a VALUE (it is a class extending Error) so the
// fixtures construct real instances rather than a `{ message }` shape the
// handler only happens to tolerate.
import { PostgrestError } from "@supabase/supabase-js";
import type { AuthUser } from "@supabase/supabase-js";

/**
 * A recorded PostgREST chain. `filters` captures every `.eq()` / `.in()` in call
 * order, so the tests can assert the tenant predicate is genuinely on the wire
 * rather than trusting that RLS would have caught it (T-150-13: `strategies_update`
 * has NO WITH CHECK, so the explicit `.eq("user_id", …)` is the real gate).
 */
interface RecordedQuery {
  table: string;
  op: "select" | "update";
  columns: string | null;
  payload: Record<string, unknown> | null;
  filters: Array<{ kind: "eq" | "in"; column: string; value: unknown }>;
}

interface MockResult {
  data: Array<Record<string, unknown>> | null;
  error: PostgrestError | null;
}

/** Construct a real PostgrestError so error fixtures match the production
 *  `PostgrestError | null` contract supabase-js returns. */
function makePgError(message: string, code = "P0001"): PostgrestError {
  return new PostgrestError({ message, details: "", hint: "", code });
}

const recorders = vi.hoisted(() => ({
  user: null as AuthUser | null,
  queries: [] as Array<{
    table: string;
    op: "select" | "update";
    columns: string | null;
    payload: Record<string, unknown> | null;
    filters: Array<{ kind: "eq" | "in"; column: string; value: unknown }>;
  }>,
  /** Keyed `${table}:${op}` — the handler's expected result for that chain. */
  results: {} as Record<
    string,
    {
      data: Array<Record<string, unknown>> | null;
      error: PostgrestError | null;
    }
  >,
  rpcCalls: [] as Array<{ fn: string; args: Record<string, unknown> }>,
  rpcResult: {
    data: null as Array<Record<string, unknown>> | null,
    error: null as PostgrestError | null,
  },
  /** Anything the handler tries to DELETE — must stay empty forever (T-150-16:
   *  the RPC is the ONLY removal path, because two statements can strand). */
  deleteCalls: [] as string[],
  auditEvents: [] as Array<{
    action: string;
    entity_type: string;
    entity_id: string;
    metadata: Record<string, unknown> | undefined;
  }>,
  rateLimitResponse: { success: true as boolean, retryAfter: 0 as number },
  rateLimitCalls: [] as string[],
  csrfReturn: null as NextResponse | null,
}));

vi.mock("@/lib/supabase/server", () => {
  interface Builder extends PromiseLike<MockResult> {
    select(columns: string): Builder;
    eq(column: string, value: unknown): Builder;
    in(column: string, value: unknown): Builder;
  }

  function makeBuilder(
    table: string,
    op: "select" | "update",
    payload: Record<string, unknown> | null,
  ): Builder {
    const query: RecordedQuery = {
      table,
      op,
      columns: null,
      payload,
      filters: [],
    };
    const builder: Builder = {
      select(columns: string) {
        query.columns = columns;
        return builder;
      },
      eq(column: string, value: unknown) {
        query.filters.push({ kind: "eq", column, value });
        return builder;
      },
      in(column: string, value: unknown) {
        query.filters.push({ kind: "in", column, value });
        return builder;
      },
      then(onfulfilled, onrejected) {
        recorders.queries.push({
          ...query,
          filters: [...query.filters],
        });
        const result = recorders.results[`${table}:${op}`] ?? {
          data: [],
          error: null,
        };
        return Promise.resolve(result).then(onfulfilled, onrejected);
      },
    };
    return builder;
  }

  return {
    createClient: async () => ({
      auth: {
        getUser: async () => ({ data: { user: recorders.user }, error: null }),
      },
      from: (table: string) => ({
        select: (columns: string) =>
          makeBuilder(table, "select", null).select(columns),
        update: (payload: Record<string, unknown>) =>
          makeBuilder(table, "update", payload),
        // Present ONLY so a route that reached for it would be recorded and
        // fail the source pin loudly rather than throwing an opaque TypeError.
        delete: () => {
          recorders.deleteCalls.push(table);
          return makeBuilder(table, "select", null);
        },
      }),
      rpc: (fn: string, args: Record<string, unknown>) => {
        recorders.rpcCalls.push({ fn, args });
        return Promise.resolve(recorders.rpcResult);
      },
    }),
  };
});

vi.mock("@/lib/csrf", () => ({
  assertSameOrigin: () => recorders.csrfReturn,
}));

vi.mock("@/lib/ratelimit", () => ({
  mandateAutoSaveLimiter: { __mock: "limiter" },
  checkLimit: async (_limiter: unknown, key: string) => {
    recorders.rateLimitCalls.push(key);
    if (recorders.rateLimitResponse.success) return { success: true };
    return {
      success: false,
      retryAfter: recorders.rateLimitResponse.retryAfter,
    };
  },
}));

vi.mock("@/lib/audit", () => ({
  logAuditEvent: (
    _client: unknown,
    event: {
      action: string;
      entity_type: string;
      entity_id: string;
      metadata?: Record<string, unknown>;
    },
  ) => {
    recorders.auditEvents.push({
      action: event.action,
      entity_type: event.entity_type,
      entity_id: event.entity_id,
      metadata: event.metadata,
    });
  },
}));

import { PATCH } from "./route";

const VALID_USER: AuthUser = {
  id: "00000000-0000-0000-0000-000000000aaa",
  app_metadata: { provider: "email" },
  user_metadata: {},
  aud: "authenticated",
  created_at: "2026-01-01T00:00:00.000Z",
  email: "owner@quantalyze.test",
  role: "authenticated",
};
const STRATEGY_ID = "cccccccc-0001-4000-8000-000000000001";
const PORTFOLIO_ID = "dddddddd-0001-4000-8000-000000000001";

function makeReq(body: unknown): NextRequest {
  return new NextRequest(
    `http://localhost:3000/api/strategies/${STRATEGY_ID}/ownership`,
    {
      method: "PATCH",
      headers: new Headers({
        "content-type": "application/json",
        origin: "http://localhost:3000",
      }),
      body: typeof body === "string" ? body : JSON.stringify(body),
    },
  );
}

function makeCtx(id: string = STRATEGY_ID): {
  params: Promise<{ id: string }>;
} {
  return { params: Promise.resolve({ id }) };
}

/** The caller owns one portfolio; used by the flip-safety lookup. */
function seedOwnedPortfolio(): void {
  recorders.results["portfolios:select"] = {
    data: [{ id: PORTFOLIO_ID }],
    error: null,
  };
}

/** The caller holds `amount` in this strategy on their own portfolio.
 *  `undefined` seeds a row with the key ABSENT (not present-and-null), which is
 *  the shape that turns an uncoalesced sum into NaN. */
function seedLivePosition(...amounts: Array<number | null | undefined>): void {
  seedOwnedPortfolio();
  recorders.results["portfolio_strategies:select"] = {
    data: amounts.map((allocated_amount) =>
      allocated_amount === undefined
        ? { portfolio_id: PORTFOLIO_ID }
        : { allocated_amount, portfolio_id: PORTFOLIO_ID },
    ),
    error: null,
  };
}

/** The owner-predicated UPDATE matched one row. */
function seedUpdateHit(): void {
  recorders.results["strategies:update"] = {
    data: [{ id: STRATEGY_ID }],
    error: null,
  };
}

const updateQueries = () => recorders.queries.filter((q) => q.op === "update");

beforeEach(() => {
  recorders.user = VALID_USER;
  recorders.queries = [];
  recorders.results = {};
  recorders.rpcCalls = [];
  recorders.rpcResult = { data: null, error: null };
  recorders.deleteCalls = [];
  recorders.auditEvents = [];
  recorders.rateLimitResponse = { success: true, retryAfter: 0 };
  recorders.rateLimitCalls = [];
  recorders.csrfReturn = null;
});

describe("PATCH /api/strategies/[id]/ownership — the six-defence stack", () => {
  it("returns 403 and touches nothing when assertSameOrigin rejects", async () => {
    recorders.csrfReturn = NextResponse.json(
      { error: "Origin not allowed" },
      { status: 403 },
    );
    const res = await PATCH(makeReq({ mark: "own_capital" }), makeCtx());
    expect(res.status).toBe(403);
    expect(res).toBe(recorders.csrfReturn);
    expect(recorders.queries).toHaveLength(0);
    expect(recorders.rateLimitCalls).toHaveLength(0);
  });

  it("returns 401 when there is no session", async () => {
    recorders.user = null;
    const res = await PATCH(makeReq({ mark: "own_capital" }), makeCtx());
    expect(res.status).toBe(401);
    expect(res).toBeInstanceOf(NextResponse);
    expect(res.headers.get("cache-control")).toBe("private, no-store");
  });

  it("returns 400 on a non-JSON body", async () => {
    const res = await PATCH(makeReq("not json {{"), makeCtx());
    expect(res.status).toBe(400);
    expect(res.headers.get("cache-control")).toBe("private, no-store");
  });

  it("returns 400 on a malformed strategy id without burning a token or touching the DB", async () => {
    const res = await PATCH(
      makeReq({ mark: "own_capital" }),
      makeCtx("not-a-uuid"),
    );
    expect(res.status).toBe(400);
    expect(recorders.rateLimitCalls).toHaveLength(0);
    expect(recorders.queries).toHaveLength(0);
  });

  it("returns 429 with Retry-After when the limiter is exhausted", async () => {
    recorders.rateLimitResponse = { success: false, retryAfter: 30 };
    const res = await PATCH(makeReq({ mark: "own_capital" }), makeCtx());
    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toBe("30");
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    expect(updateQueries()).toHaveLength(0);
  });

  it("scopes the rate-limit key to ownership:{user.id}", async () => {
    seedUpdateHit();
    await PATCH(makeReq({ mark: "own_capital" }), makeCtx());
    expect(recorders.rateLimitCalls).toEqual([`ownership:${VALID_USER.id}`]);
  });
});

describe("PATCH /api/strategies/[id]/ownership — mark validation (closed set)", () => {
  // B15 ordering: a rejected body must not cost the caller a token. The
  // assertion is on rateLimitCalls, not on the status alone — a route that
  // validated AFTER checkLimit would still answer 400 and look correct.
  it.each([
    ["an unknown string", { mark: "borrowed_capital" }],
    ["the empty string", { mark: "" }],
    ["a missing key", {}],
    ["a non-string", { mark: 42 }],
    ["null", { mark: null }],
    ["an object (JSON-injection shape)", { mark: { own_capital: true } }],
  ])(
    "rejects %s with 400 before any rate-limit token is consumed",
    async (_label, body) => {
      const res = await PATCH(makeReq(body), makeCtx());
      expect(res.status).toBe(400);
      expect(recorders.rateLimitCalls).toHaveLength(0);
      expect(recorders.queries).toHaveLength(0);
    },
  );

  it("rejects a non-boolean confirm_remove_allocation with 400", async () => {
    // T-150-17: the flag is read as a strict boolean. A truthy string like
    // "false" must not be able to authorise a destructive flip.
    const res = await PATCH(
      makeReq({ mark: "team_review", confirm_remove_allocation: "false" }),
      makeCtx(),
    );
    expect(res.status).toBe(400);
    expect(recorders.rateLimitCalls).toHaveLength(0);
  });

  it.each(["own_capital", "team_review"])(
    "accepts the closed-set member %s",
    async (mark) => {
      seedUpdateHit();
      const res = await PATCH(makeReq({ mark }), makeCtx());
      expect(res.status).toBe(200);
      await expect(res.json()).resolves.toEqual({ ok: true, mark });
    },
  );
});

describe("PATCH /api/strategies/[id]/ownership — the plain mark write", () => {
  it("writes own_capital through an owner-predicated UPDATE with a count-check", async () => {
    seedUpdateHit();
    const res = await PATCH(makeReq({ mark: "own_capital" }), makeCtx());
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("private, no-store");

    const updates = updateQueries();
    expect(updates).toHaveLength(1);
    expect(updates[0].table).toBe("strategies");
    // Mass-assignment guard: the payload is a literal, not a spread of the body.
    expect(updates[0].payload).toEqual({ capital_ownership: "own_capital" });
    // T-150-13: both predicates on the wire. `strategies_update` RLS has no
    // WITH CHECK, so the user_id eq is the tenant gate, not belt-and-braces.
    expect(updates[0].filters).toEqual([
      { kind: "eq", column: "id", value: STRATEGY_ID },
      { kind: "eq", column: "user_id", value: VALID_USER.id },
    ]);
    // Zero-rows-is-404 is only possible if the UPDATE asks for the ids back.
    expect(updates[0].columns).toBe("id");
  });

  it("does NOT gate the mark on status — a published own strategy stays markable", async () => {
    // UI-SPEC row-actions table: unlike the rename (D-17), the mark carries no
    // status restriction. A `.in("status", …)` here would silently break the
    // retro path for every published legacy row.
    seedUpdateHit();
    await PATCH(makeReq({ mark: "own_capital" }), makeCtx());
    const statusFilters = updateQueries()[0].filters.filter(
      (f) => f.column === "status",
    );
    expect(statusFilters).toEqual([]);
  });

  it("returns 404 — never {ok:true} — when the UPDATE matches zero rows", async () => {
    // Wrong owner or unknown id. The silent-success oracle is the bug this
    // count-check exists to prevent (alias route G8.B.6).
    recorders.results["strategies:update"] = { data: [], error: null };
    const res = await PATCH(makeReq({ mark: "own_capital" }), makeCtx());
    expect(res.status).toBe(404);
    await expect(res.json()).resolves.not.toHaveProperty("ok");
    expect(recorders.auditEvents).toHaveLength(0);
  });

  it("returns 500 when the UPDATE itself errors", async () => {
    recorders.results["strategies:update"] = {
      data: null,
      error: makePgError("db down"),
    };
    const res = await PATCH(makeReq({ mark: "own_capital" }), makeCtx());
    expect(res.status).toBe(500);
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    expect(recorders.auditEvents).toHaveLength(0);
  });

  it("audits a successful mark as strategy.ownership_mark on the strategy entity", async () => {
    seedUpdateHit();
    await PATCH(makeReq({ mark: "own_capital" }), makeCtx());
    expect(recorders.auditEvents).toHaveLength(1);
    expect(recorders.auditEvents[0]).toMatchObject({
      action: "strategy.ownership_mark",
      entity_type: "strategy",
      entity_id: STRATEGY_ID,
    });
    expect(recorders.auditEvents[0].metadata).toMatchObject({
      mark: "own_capital",
    });
  });

  it("takes the plain-UPDATE path (no position lookup) when marking own_capital", async () => {
    // The flip-safety read is for the TEAM_REVIEW direction only. Marking
    // own_capital never removes anything, so it must not pay for the lookup.
    seedLivePosition(120_000);
    seedUpdateHit();
    const res = await PATCH(makeReq({ mark: "own_capital" }), makeCtx());
    expect(res.status).toBe(200);
    expect(
      recorders.queries.some((q) => q.table === "portfolio_strategies"),
    ).toBe(false);
    expect(recorders.rpcCalls).toHaveLength(0);
  });
});

describe("PATCH /api/strategies/[id]/ownership — flip safety (T-150-16)", () => {
  it("refuses an unconfirmed flip with 409 + the allocated amount, and writes NOTHING", async () => {
    seedLivePosition(120_000);
    seedUpdateHit(); // seeded on purpose: if the route wrote anyway it would 200
    const res = await PATCH(makeReq({ mark: "team_review" }), makeCtx());

    expect(res.status).toBe(409);
    // 161-10 — the SENTENCE is byte-identical; `code` is purely additive.
    await expect(res.json()).resolves.toEqual({
      code: "LIVE_ALLOCATION",
      error: "live_allocation",
      allocated_amount: 120_000,
    });
    expect(res.headers.get("cache-control")).toBe("private, no-store");

    // The load-bearing half of this case: NO write of any kind happened.
    expect(updateQueries()).toHaveLength(0);
    expect(recorders.rpcCalls).toHaveLength(0);
    expect(recorders.auditEvents).toHaveLength(0);
  });

  it("sums multiple positions and counts a null allocated_amount as 0", async () => {
    // `allocated_amount` is a nullable NUMERIC. A null must not poison the sum
    // — the dialog renders this number as the confirm copy.
    seedLivePosition(120_000, null, 30_000);
    const res = await PATCH(makeReq({ mark: "team_review" }), makeCtx());
    expect(res.status).toBe(409);
    await expect(res.json()).resolves.toEqual({
      code: "LIVE_ALLOCATION",
      error: "live_allocation",
      allocated_amount: 150_000,
    });
  });

  it("counts an ABSENT allocated_amount as 0 rather than reporting NaN", async () => {
    // Measured blind spot (Rule 9). The null case above CANNOT see a missing
    // `?? 0`, because JS `sum + null` is `sum + 0` — dropping the coalesce left
    // that test green. The shape that actually breaks is a row whose key is
    // absent (a narrowed `.select()` column list, or a PostgREST embed change):
    // `sum + undefined` is NaN, which serialises to `null` in JSON and would
    // render the confirm dialog as "remove your $null allocation".
    seedLivePosition(120_000, undefined);
    const res = await PATCH(makeReq({ mark: "team_review" }), makeCtx());
    expect(res.status).toBe(409);
    const body = (await res.json()) as { allocated_amount: number };
    expect(Number.isFinite(body.allocated_amount)).toBe(true);
    expect(body.allocated_amount).toBe(120_000);
  });

  it("scopes the position lookup to the caller's OWN portfolios", async () => {
    seedLivePosition(120_000);
    await PATCH(makeReq({ mark: "team_review" }), makeCtx());

    const portfolioRead = recorders.queries.find(
      (q) => q.table === "portfolios",
    );
    expect(portfolioRead?.filters).toEqual([
      { kind: "eq", column: "user_id", value: VALID_USER.id },
    ]);

    const positionRead = recorders.queries.find(
      (q) => q.table === "portfolio_strategies",
    );
    expect(positionRead?.filters).toEqual([
      { kind: "eq", column: "strategy_id", value: STRATEGY_ID },
      { kind: "in", column: "portfolio_id", value: [PORTFOLIO_ID] },
    ]);
  });

  it("flips through the plain UPDATE when the caller owns no portfolios at all", async () => {
    recorders.results["portfolios:select"] = { data: [], error: null };
    seedUpdateHit();
    const res = await PATCH(makeReq({ mark: "team_review" }), makeCtx());
    expect(res.status).toBe(200);
    // No portfolios ⇒ no positions ⇒ nothing to strand ⇒ no RPC needed.
    expect(recorders.rpcCalls).toHaveLength(0);
    expect(updateQueries()).toHaveLength(1);
  });

  it("flips through the plain UPDATE when there is no live position", async () => {
    seedOwnedPortfolio();
    recorders.results["portfolio_strategies:select"] = {
      data: [],
      error: null,
    };
    seedUpdateHit();
    const res = await PATCH(makeReq({ mark: "team_review" }), makeCtx());
    expect(res.status).toBe(200);
    expect(recorders.rpcCalls).toHaveLength(0);
    expect(updateQueries()).toHaveLength(1);
  });

  it("returns 500 (not a silent flip) when the position lookup errors", async () => {
    // Fail loud: an unreadable position table must never be treated as
    // "no positions" — that is exactly how a live allocation gets stranded.
    seedOwnedPortfolio();
    recorders.results["portfolio_strategies:select"] = {
      data: null,
      error: makePgError("db down"),
    };
    const res = await PATCH(makeReq({ mark: "team_review" }), makeCtx());
    expect(res.status).toBe(500);
    expect(updateQueries()).toHaveLength(0);
    expect(recorders.rpcCalls).toHaveLength(0);
  });

  it("returns 500 (not a silent flip) when the portfolio lookup errors", async () => {
    recorders.results["portfolios:select"] = {
      data: null,
      error: makePgError("db down"),
    };
    const res = await PATCH(makeReq({ mark: "team_review" }), makeCtx());
    expect(res.status).toBe(500);
    expect(updateQueries()).toHaveLength(0);
    expect(recorders.rpcCalls).toHaveLength(0);
  });
});

describe("PATCH /api/strategies/[id]/ownership — the confirmed flip is ONE transaction", () => {
  it("calls flip_capital_ownership_to_team_review and never a two-statement removal", async () => {
    seedLivePosition(120_000);
    recorders.rpcResult = {
      data: [{ removed_positions: 1, updated_strategies: 1 }],
      error: null,
    };
    const res = await PATCH(
      makeReq({ mark: "team_review", confirm_remove_allocation: true }),
      makeCtx(),
    );

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      ok: true,
      mark: "team_review",
    });
    expect(recorders.rpcCalls).toEqual([
      {
        fn: "flip_capital_ownership_to_team_review",
        args: { p_strategy_id: STRATEGY_ID },
      },
    ]);
    // Atomicity: the removal rides INSIDE the RPC. A route that deleted the
    // position itself and then updated the mark could strand on a mid-flight
    // failure — the exact D-03 hole this arm exists to close.
    expect(recorders.deleteCalls).toEqual([]);
    expect(updateQueries()).toHaveLength(0);
  });

  it("records removed_positions in the audit metadata of a confirmed flip", async () => {
    seedLivePosition(120_000);
    recorders.rpcResult = {
      data: [{ removed_positions: 2, updated_strategies: 1 }],
      error: null,
    };
    await PATCH(
      makeReq({ mark: "team_review", confirm_remove_allocation: true }),
      makeCtx(),
    );
    expect(recorders.auditEvents).toHaveLength(1);
    expect(recorders.auditEvents[0]).toMatchObject({
      action: "strategy.ownership_mark",
      entity_type: "strategy",
      entity_id: STRATEGY_ID,
    });
    expect(recorders.auditEvents[0].metadata).toMatchObject({
      mark: "team_review",
      removed_positions: 2,
    });
  });

  it("returns 404 when the RPC reports updated_strategies === 0 (non-owner)", async () => {
    // The RPC is auth.uid()-scoped: a non-owner removes nothing and updates
    // nothing. That total no-op must read as 404, never as a successful flip.
    seedLivePosition(120_000);
    recorders.rpcResult = {
      data: [{ removed_positions: 0, updated_strategies: 0 }],
      error: null,
    };
    const res = await PATCH(
      makeReq({ mark: "team_review", confirm_remove_allocation: true }),
      makeCtx(),
    );
    expect(res.status).toBe(404);
    await expect(res.json()).resolves.not.toHaveProperty("ok");
    expect(recorders.auditEvents).toHaveLength(0);
  });

  it("returns 500 when the RPC errors", async () => {
    seedLivePosition(120_000);
    recorders.rpcResult = { data: null, error: makePgError("deadlock") };
    const res = await PATCH(
      makeReq({ mark: "team_review", confirm_remove_allocation: true }),
      makeCtx(),
    );
    expect(res.status).toBe(500);
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    expect(recorders.auditEvents).toHaveLength(0);
  });

  it("returns 500 when the RPC returns no row at all", async () => {
    // A RETURNS TABLE function that yields zero rows would leave the counts
    // undefined. Treating that as success would report a flip that may not
    // have happened (Rule 12 — fail loud).
    seedLivePosition(120_000);
    recorders.rpcResult = { data: [], error: null };
    const res = await PATCH(
      makeReq({ mark: "team_review", confirm_remove_allocation: true }),
      makeCtx(),
    );
    expect(res.status).toBe(500);
    expect(recorders.auditEvents).toHaveLength(0);
  });

  it("ignores confirm_remove_allocation entirely when marking own_capital", async () => {
    // The confirm flag authorises ONE thing: removing the caller's positions on
    // a flip to team_review. It must never reach the RPC on the other direction.
    seedLivePosition(120_000);
    seedUpdateHit();
    const res = await PATCH(
      makeReq({ mark: "own_capital", confirm_remove_allocation: true }),
      makeCtx(),
    );
    expect(res.status).toBe(200);
    expect(recorders.rpcCalls).toHaveLength(0);
  });
});

describe("PATCH /api/strategies/[id]/ownership — source pins", () => {
  const SOURCE = readFileSync(
    join(process.cwd(), "src/app/api/strategies/[id]/ownership/route.ts"),
    "utf8",
  );
  /** Comment-stripped body: the negative pins below must not be satisfied (or
   *  defeated) by prose. Block comments first, then whole-line `//`. */
  const CODE = SOURCE.replace(/\/\*[\s\S]*?\*\//g, "").replace(
    /^\s*\/\/.*$/gm,
    "",
  );

  it("anti-vacuity: the stripper really strips and the source really loaded", () => {
    expect(SOURCE.length).toBeGreaterThan(500);
    expect(SOURCE).toContain("/**");
    expect(CODE).not.toContain("/**");
    // The docblock names the RPC; the code must too (proven separately below).
    expect(CODE).toContain("PATCH");
  });

  it("contains NO .delete() — the RPC is the only removal path", () => {
    expect(CODE).not.toMatch(/\.delete\(/);
  });

  it("calls the flip RPC by name", () => {
    expect(CODE).toContain("flip_capital_ownership_to_team_review");
  });

  it("imports the closed-set constants instead of spelling the marks ad hoc", () => {
    // T-150-07 / phase gate: the `own_capital` literal lives in
    // src/lib/capital-ownership.ts alone. A raw string here would be the drift.
    expect(SOURCE).toContain("@/lib/capital-ownership");
    expect(CODE).not.toMatch(/["']own_capital["']/);
    expect(CODE).not.toMatch(/["']team_review["']/);
  });

  it("stamps NO_STORE_HEADERS on every response arm", () => {
    const responses = (CODE.match(/NextResponse\.json\(/g) ?? []).length;
    const stamps = (CODE.match(/NO_STORE_HEADERS/g) ?? []).length;
    expect(responses).toBeGreaterThan(0);
    // One import + at least one stamp per locally-constructed response.
    expect(stamps).toBeGreaterThanOrEqual(responses + 1);
  });
});

/**
 * [161-10 / WIZERR-07] EVERY ERROR ARM CARRIES A CODE, AND NO SENTENCE MOVED.
 *
 * Two independent claims over the ownership route, and the plan requires BOTH — the
 * second is what makes the first safe to ship:
 *
 *   1. every arm puts a stable machine token on the wire, so the dialog behind
 *      this route discriminates on a token instead of matching prose;
 *   2. every `error` SENTENCE is byte-identical to what shipped before, so
 *      `code` is purely additive and no other consumer changes behaviour.
 *
 * ⛔ THE SENTENCES BELOW ARE HAND-TYPED, transcribed from this route as it
 * stood at the commit BEFORE the codes landed. Deriving them from the current
 * source would make this suite agree with any rewording — which is precisely
 * the drift claim (2) exists to refuse.
 *
 * ⚠️ SCANNED COMMENT-STRIPPED. This route's docblock discusses its own arms, so
 * a raw-text scan would count prose as emitters (the receipt for this is the
 * 14-vs-12 delta `wizardErrors.invariant.test.ts` records).
 *
 * ⚠️ The CSRF arm is deliberately absent: it is emitted by the shared
 * `assertSameOrigin` helper in `src/lib/csrf.ts`, which serves many routes, and
 * coding it is a cross-cutting change this plan did not scope. It is an
 * explicit terminal-UNKNOWN disposition in `dialog-envelope.invariant.test.ts`.
 */
describe("[161-10 / WIZERR-07] the ownership route classifies every arm it refuses", () => {
  const RAW = readFileSync(
    join(process.cwd(), "src/app/api/strategies/[id]/ownership/route.ts"),
    "utf8",
  );
  const SRC = RAW.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

  it("anti-vacuity: the source loaded and the stripper really stripped", () => {
    expect(RAW.length).toBeGreaterThan(2000);
    expect(RAW).toContain("/**");
    expect(SRC).not.toContain("/**");
    expect(SRC).toContain("PATCH");
  });

  /**
   * Hand-typed from the pre-code source. A sentence that is reworded, or an arm
   * that is deleted, reddens here by name.
   */
  const SENTENCES: readonly string[] = [
    "unauthorized",
    "id must be a UUID",
    "invalid json",
    "confirm_remove_allocation must be a boolean",
    "Too many requests",
    "internal error",
    "live_allocation",
    "strategy not found",
  ];

  it("every pre-existing sentence is still on the wire, byte-identical", () => {
    // NON-VACUITY: an empty list would make the loop pass trivially, and
    // `"anything".includes("")` would make a blank needle pass too.
    expect(SENTENCES.length).toBe(8);
    for (const sentence of SENTENCES) {
      expect(sentence.length).toBeGreaterThan(3);
      expect(SRC, `the sentence "${sentence}" is gone or reworded`).toContain(
        `error: "${sentence}"`,
      );
    }
  });

  it("every code literal is written FIRST in its object literal", () => {
    // The coverage laws derive their populations with a `code:`-first
    // predicate, so an arm written `{ error, code }` is invisible to them (the
    // D-34 reorder). Hand-typed count, re-measured at HEAD.
    const codeFirst = (
      SRC.match(/code: "[A-Z][A-Z0-9_]*",\s*error: ["`]/g) ?? []
    ).length;
    expect(codeFirst).toBe(14);
    // …and NOT ONE arm is written the other way round.
    expect(SRC).not.toMatch(/\{\s*error: [^}]*,\s*code:/);
  });

  it("NO error arm is left code-less — the population has no silent hole", () => {
    // Two DIFFERENT predicates over the same source. Deleting every arm takes
    // both sides to zero together, which is why the hand-typed literal in the
    // case above is what catches a shrink; this catches an arm ADDED without a
    // code.
    // The predicate is STRING-VALUED `error:` keys only, so the route's own
    // `const { data, error: xxErr } = await supabase…` destructurings are not
    // counted as response arms.
    const errorKeys = (SRC.match(/error: ["`]/g) ?? []).length;
    const codeFirst = (
      SRC.match(/code: "[A-Z][A-Z0-9_]*",\s*error: ["`]/g) ?? []
    ).length;
    expect(errorKeys).toBeGreaterThan(0);
    expect(
      errorKeys,
      "an error key exists that no code opens - a client cannot " +
        "discriminate that arm and it will render the generic terminal",
    ).toBe(codeFirst);
  });

  it("the FIVE internal-error arms share ONE code, and that is the decision", () => {
    // The decision is recorded in the route's docblock: they differ by WHICH
    // internal query failed, which the user cannot act on, and each site
    // already logs its own distinct server-side line. This pin is what stops
    // the decision being reversed silently in either direction — by splitting
    // them per call site, or by an arm losing its code entirely.
    const internal = (
      SRC.match(
        /\{ code: "DASHBOARD_WRITE_FAILED", error: "internal error" \},/g,
      ) ?? []
    ).length;
    expect(internal).toBe(5);
  });

  it("the live_allocation 409 keeps its amount field AND its sentence", () => {
    // The dialog renders that number as the confirm copy. A code that arrived
    // without the amount would swap the body in and name $0.
    expect(SRC).toContain('code: "LIVE_ALLOCATION"');
    expect(SRC).toContain('error: "live_allocation"');
    expect(SRC).toContain("allocated_amount: allocatedAmount");
  });
  it("the concatenated mark sentence is unchanged and still carries its code", () => {
    // Built as `"mark must be one of: " + ALLOWED_MARKS.join(", ")`, so the
    // literal-suffix scan above cannot see it. Pinned on its own terms.
    expect(SRC).toContain(
      'error: "mark must be one of: " + ALLOWED_MARKS.join(", ")',
    );
  });
});
