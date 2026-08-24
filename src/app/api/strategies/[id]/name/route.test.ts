/**
 * Phase 150 / Plan 150-04 / OWN-05 — PATCH /api/strategies/[id]/name.
 *
 * The owner relabels their OWN private/draft strategy in their own words.
 *
 * Threat coverage (cross-link to 150-04-PLAN <threat_model>):
 *   - T-150-13 EoP        → cross-tenant rename via a forged id is a 404
 *   - T-150-14 Tampering  → renaming a PUBLISHED row is refused SERVER-SIDE by
 *                           `.in("status", ["private","draft"])`, not by hiding
 *                           the button (D-17). Hiding a button is not enforcement.
 *   - T-150-17 Tampering  → mass assignment: only `name` is read, and the UPDATE
 *                           payload is a literal
 *   - T-150-18 DoS        → checkLimit is consumed AFTER validation (B15)
 *   - T-150-19 Repudiation→ every successful rename emits strategy.rename
 *
 * Mock recorder pattern mirrors the sibling ownership route test and
 * src/app/api/watchlist/[strategyId]/route.test.ts.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { NextRequest, NextResponse } from "next/server";
import { PostgrestError } from "@supabase/supabase-js";
import type { AuthUser } from "@supabase/supabase-js";

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
  results: {} as Record<
    string,
    { data: Array<Record<string, unknown>> | null; error: PostgrestError | null }
  >,
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
        recorders.queries.push({ ...query, filters: [...query.filters] });
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
        select: (columns: string) => makeBuilder(table, "select", null).select(columns),
        update: (payload: Record<string, unknown>) => makeBuilder(table, "update", payload),
      }),
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
    return { success: false, retryAfter: recorders.rateLimitResponse.retryAfter };
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

/** The product cap (UI-SPEC). Typed here as a literal oracle rather than
 *  imported from the route, so a widened cap in production fails this suite
 *  instead of silently moving the boundary with it. */
const MAX_NAME_LENGTH = 80;

function makeReq(body: unknown): NextRequest {
  return new NextRequest(
    `http://localhost:3000/api/strategies/${STRATEGY_ID}/name`,
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

function makeCtx(id: string = STRATEGY_ID): { params: Promise<{ id: string }> } {
  return { params: Promise.resolve({ id }) };
}

/** The owner-predicated, status-gated UPDATE matched one row. */
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
  recorders.auditEvents = [];
  recorders.rateLimitResponse = { success: true, retryAfter: 0 };
  recorders.rateLimitCalls = [];
  recorders.csrfReturn = null;
});

describe("PATCH /api/strategies/[id]/name — the six-defence stack", () => {
  it("returns 403 and touches nothing when assertSameOrigin rejects", async () => {
    recorders.csrfReturn = NextResponse.json(
      { error: "Origin not allowed" },
      { status: 403 },
    );
    const res = await PATCH(makeReq({ name: "Helios alpha sleeve" }), makeCtx());
    expect(res.status).toBe(403);
    expect(res).toBe(recorders.csrfReturn);
    expect(recorders.queries).toHaveLength(0);
    expect(recorders.rateLimitCalls).toHaveLength(0);
  });

  it("returns 401 when there is no session", async () => {
    recorders.user = null;
    const res = await PATCH(makeReq({ name: "Helios alpha sleeve" }), makeCtx());
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
    const res = await PATCH(makeReq({ name: "Helios" }), makeCtx("not-a-uuid"));
    expect(res.status).toBe(400);
    expect(recorders.rateLimitCalls).toHaveLength(0);
    expect(recorders.queries).toHaveLength(0);
  });

  it("returns 429 with Retry-After when the limiter is exhausted", async () => {
    recorders.rateLimitResponse = { success: false, retryAfter: 30 };
    const res = await PATCH(makeReq({ name: "Helios" }), makeCtx());
    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toBe("30");
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    expect(updateQueries()).toHaveLength(0);
  });

  it("scopes the rate-limit key to rename:{user.id}", async () => {
    seedUpdateHit();
    await PATCH(makeReq({ name: "Helios" }), makeCtx());
    expect(recorders.rateLimitCalls).toEqual([`rename:${VALID_USER.id}`]);
  });
});

describe("PATCH /api/strategies/[id]/name — name validation (reject, never truncate)", () => {
  it.each([
    ["the empty string", ""],
    ["whitespace only", "   "],
    ["a tab and newline", "\t\n"],
  ])("rejects %s with 400 'invalid name' and no token burned", async (_label, name) => {
    const res = await PATCH(makeReq({ name }), makeCtx());
    expect(res.status).toBe(400);
    // 161-10 — the SENTENCE is byte-identical; `code` is purely additive.
    await expect(res.json()).resolves.toEqual({
      code: "NAME_REQUIRED",
      error: "invalid name",
    });
    expect(recorders.rateLimitCalls).toHaveLength(0);
    expect(updateQueries()).toHaveLength(0);
  });

  it.each([
    ["a missing key", {}],
    ["a non-string", { name: 42 }],
    ["null", { name: null }],
    ["an object (JSON-injection shape)", { name: { toString: "x" } }],
  ])("rejects %s with 400 'invalid name'", async (_label, body) => {
    const res = await PATCH(makeReq(body), makeCtx());
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({
      code: "NAME_REQUIRED",
      error: "invalid name",
    });
    expect(recorders.rateLimitCalls).toHaveLength(0);
  });

  it(`accepts a ${MAX_NAME_LENGTH}-character name (the boundary is inclusive)`, async () => {
    seedUpdateHit();
    const name = "a".repeat(MAX_NAME_LENGTH);
    const res = await PATCH(makeReq({ name }), makeCtx());
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ ok: true, name });
  });

  it(`rejects a ${MAX_NAME_LENGTH + 1}-character name with 400 'name too long'`, async () => {
    const res = await PATCH(
      makeReq({ name: "a".repeat(MAX_NAME_LENGTH + 1) }),
      makeCtx(),
    );
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({
      code: "NAME_TOO_LONG",
      error: "name too long",
    });
    expect(recorders.rateLimitCalls).toHaveLength(0);
    expect(updateQueries()).toHaveLength(0);
  });

  it("NEVER truncates an over-long name into a successful write", async () => {
    // The alias route caps with a silent truncation at 120 chars. This route
    // deliberately does NOT copy that: a user-visible proper name silently
    // losing its tail is a fail-quiet. Rejection is the contract.
    seedUpdateHit();
    const res = await PATCH(
      makeReq({ name: "b".repeat(MAX_NAME_LENGTH + 40) }),
      makeCtx(),
    );
    expect(res.status).toBe(400);
    expect(updateQueries()).toHaveLength(0);
    expect(recorders.auditEvents).toHaveLength(0);
  });

  it("measures the cap AFTER trimming, so padding cannot push a legal name over", async () => {
    seedUpdateHit();
    const name = "c".repeat(MAX_NAME_LENGTH);
    const res = await PATCH(makeReq({ name: `   ${name}   ` }), makeCtx());
    expect(res.status).toBe(200);
    // The trimmed value is what is persisted and echoed.
    await expect(res.json()).resolves.toEqual({ ok: true, name });
    expect(updateQueries()[0].payload).toEqual({ name });
  });
});

describe("PATCH /api/strategies/[id]/name — the owner-scoped, status-gated write", () => {
  it("renames through eq(id) + eq(user_id) + in(status) with a count-check", async () => {
    seedUpdateHit();
    const res = await PATCH(makeReq({ name: "Helios alpha sleeve" }), makeCtx());
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("private, no-store");

    const updates = updateQueries();
    expect(updates).toHaveLength(1);
    expect(updates[0].table).toBe("strategies");
    // Mass-assignment guard: the payload is a literal with exactly one key.
    expect(updates[0].payload).toEqual({ name: "Helios alpha sleeve" });
    expect(updates[0].filters).toEqual([
      { kind: "eq", column: "id", value: STRATEGY_ID },
      { kind: "eq", column: "user_id", value: VALID_USER.id },
      { kind: "in", column: "status", value: ["private", "draft"] },
    ]);
    expect(updates[0].columns).toBe("id");
  });

  it("D-17: the status gate is a server-side predicate, never a client-trusted flag", async () => {
    // The published-row refusal must come from the UPDATE's own predicate. A
    // route that read a caller-supplied status, or that gated only in the UI,
    // would pass every other test in this file.
    seedUpdateHit();
    await PATCH(
      makeReq({ name: "Helios", status: "private" }),
      makeCtx(),
    );
    const statusFilter = updateQueries()[0].filters.find((f) => f.column === "status");
    expect(statusFilter).toEqual({
      kind: "in",
      column: "status",
      value: ["private", "draft"],
    });
    // The extra body key reached nothing.
    expect(updateQueries()[0].payload).toEqual({ name: "Helios" });
  });

  it("returns 404 for a published own row, a wrong owner, and an unknown id alike", async () => {
    // One honest arm: zero rows means the caller may not rename this row, and
    // the route deliberately does not distinguish which of the three it was
    // (distinguishing would leak row existence).
    recorders.results["strategies:update"] = { data: [], error: null };
    const res = await PATCH(makeReq({ name: "Helios" }), makeCtx());
    expect(res.status).toBe(404);
    await expect(res.json()).resolves.not.toHaveProperty("ok");
    expect(recorders.auditEvents).toHaveLength(0);
  });

  it("returns 500 when the UPDATE itself errors", async () => {
    recorders.results["strategies:update"] = {
      data: null,
      error: makePgError("db down"),
    };
    const res = await PATCH(makeReq({ name: "Helios" }), makeCtx());
    expect(res.status).toBe(500);
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    expect(recorders.auditEvents).toHaveLength(0);
  });

  it("audits a successful rename as strategy.rename with the new name", async () => {
    seedUpdateHit();
    await PATCH(makeReq({ name: "Helios alpha sleeve" }), makeCtx());
    expect(recorders.auditEvents).toHaveLength(1);
    expect(recorders.auditEvents[0]).toMatchObject({
      action: "strategy.rename",
      entity_type: "strategy",
      entity_id: STRATEGY_ID,
    });
    expect(recorders.auditEvents[0].metadata).toMatchObject({
      name: "Helios alpha sleeve",
    });
  });
});

describe("PATCH /api/strategies/[id]/name — source pins", () => {
  const SOURCE = readFileSync(
    join(process.cwd(), "src/app/api/strategies/[id]/name/route.ts"),
    "utf8",
  );
  const CODE = SOURCE.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

  it("anti-vacuity: the stripper really strips and the source really loaded", () => {
    expect(SOURCE.length).toBeGreaterThan(500);
    expect(SOURCE).toContain("/**");
    expect(CODE).not.toContain("/**");
    expect(CODE).toContain("PATCH");
  });

  it("uses in(status) and never the raw published predicate (B10 sweep)", () => {
    expect(CODE).toContain('in("status"');
    // `.eq("status","published")` anywhere new must route through
    // withPublishedOnly() — src/lib/visibility.test.ts:87-134 walks all of src/.
    expect(CODE).not.toMatch(/\.eq\(\s*["']status["']/);
  });

  it("never truncates — no slicing of the name", () => {
    expect(CODE).not.toMatch(/\.slice\(/);
  });

  it("records the Pitfall-3 conscious acceptance in the docblock", () => {
    // The rename is the first free-text path into strategies.name. The
    // acceptance (admin-gated publication reviews the name, and public
    // surfaces render codename per C-0112 regardless) must be written down,
    // otherwise it reads as an oversight to the next reader.
    expect(SOURCE).toContain("guard_strategies_publish_transition");
    expect(SOURCE).toContain("C-0112");
  });

  it("stamps NO_STORE_HEADERS on every response arm", () => {
    const responses = (CODE.match(/NextResponse\.json\(/g) ?? []).length;
    const stamps = (CODE.match(/NO_STORE_HEADERS/g) ?? []).length;
    expect(responses).toBeGreaterThan(0);
    expect(stamps).toBeGreaterThanOrEqual(responses + 1);
  });
});

/**
 * [161-10 / WIZERR-07] EVERY ERROR ARM CARRIES A CODE, AND NO SENTENCE MOVED.
 *
 * Two independent claims, and the plan requires BOTH — the second is what makes
 * the first safe to ship:
 *
 *   1. every arm this route can answer with now puts a stable machine token on
 *      the wire, so `RenameStrategyDialog` discriminates on a token instead of
 *      matching prose (the SEAMUX-03 intent);
 *   2. the `error` SENTENCE of every arm is byte-identical to what shipped
 *      before, so `code` is purely additive and no other consumer of this route
 *      changes behaviour.
 *
 * ⛔ THE SENTENCES BELOW ARE HAND-TYPED. Importing them from the route — or
 * asserting only `typeof body.error === "string"` — would make this suite agree
 * with any rewording, which is precisely the drift claim (2) exists to refuse.
 *
 * ⚠️ The CSRF arm is deliberately absent from this table. It is emitted by the
 * shared `assertSameOrigin` helper in `src/lib/csrf.ts`, which serves many
 * routes; coding it is a cross-cutting change this plan did not scope. It is
 * recorded as an explicit terminal-UNKNOWN disposition in
 * `src/lib/dialog-envelope.invariant.test.ts` rather than left as an omission.
 */
describe("[161-10 / WIZERR-07] the name route classifies every arm it refuses", () => {
  /**
   * One row per REACHABLE error arm, in source order. Hand-typed from the
   * route's arms read at HEAD — never derived from the route, which would make
   * the count agree with a deletion.
   */
  const ARMS: ReadonlyArray<{
    label: string;
    status: number;
    code: string;
    sentence: string;
    run: () => Promise<Response>;
  }> = [
    {
      label: "no session",
      status: 401,
      code: "DASHBOARD_SIGNED_OUT",
      sentence: "unauthorized",
      run: () => {
        recorders.user = null;
        return PATCH(makeReq({ name: "Helios" }), makeCtx()) as Promise<Response>;
      },
    },
    {
      label: "malformed strategy id",
      status: 400,
      code: "DASHBOARD_REQUEST_INVALID",
      sentence: "id must be a UUID",
      run: () =>
        PATCH(makeReq({ name: "Helios" }), makeCtx("not-a-uuid")) as Promise<Response>,
    },
    {
      label: "unparseable body",
      status: 400,
      code: "DASHBOARD_REQUEST_INVALID",
      sentence: "invalid json",
      run: () => PATCH(makeReq("not json {{"), makeCtx()) as Promise<Response>,
    },
    {
      label: "empty after trim (FIELD-LEVEL)",
      status: 400,
      code: "NAME_REQUIRED",
      sentence: "invalid name",
      run: () => PATCH(makeReq({ name: "   " }), makeCtx()) as Promise<Response>,
    },
    {
      label: "over the cap (FIELD-LEVEL)",
      status: 400,
      code: "NAME_TOO_LONG",
      sentence: "name too long",
      run: () =>
        PATCH(
          makeReq({ name: "a".repeat(MAX_NAME_LENGTH + 1) }),
          makeCtx(),
        ) as Promise<Response>,
    },
    {
      label: "limiter exhausted",
      status: 429,
      code: "RATE_LIMITED",
      sentence: "Too many requests",
      run: () => {
        recorders.rateLimitResponse = { success: false, retryAfter: 30 };
        return PATCH(makeReq({ name: "Helios" }), makeCtx()) as Promise<Response>;
      },
    },
    {
      label: "the UPDATE itself errored",
      status: 500,
      code: "DASHBOARD_WRITE_FAILED",
      sentence: "internal error",
      run: () => {
        recorders.results["strategies:update"] = {
          data: null,
          error: makePgError("db down"),
        };
        return PATCH(makeReq({ name: "Helios" }), makeCtx()) as Promise<Response>;
      },
    },
    {
      label: "zero rows matched (wrong owner / unknown id / published)",
      status: 404,
      code: "DASHBOARD_ROW_STALE",
      sentence: "strategy not found",
      run: () => {
        recorders.results["strategies:update"] = { data: [], error: null };
        return PATCH(makeReq({ name: "Helios" }), makeCtx()) as Promise<Response>;
      },
    },
  ];

  it("the arm table is non-empty and covers every arm measured at HEAD", () => {
    // ⛔ NEVER `ARMS.length` compared against itself. 8 is hand-typed from the
    // route read at HEAD: 401, 400×4 (uuid / json / invalid-name / too-long),
    // 429, 500, 404. The route's second `invalid name` arm (a non-string
    // `name`) answers the SAME status, code and sentence as the first, so it is
    // one row here and is exercised separately by the validation describe above.
    expect(ARMS.length).toBe(8);
  });

  it.each(ARMS.map((a) => [a.label, a] as const))(
    "%s answers its own code with its sentence unchanged",
    async (_label, arm) => {
      const res = await arm.run();
      expect(res.status).toBe(arm.status);
      const body = (await res.json()) as { code?: unknown; error?: unknown };

      // NON-VACUITY: a blank sentence would make the equality below pass
      // against a route that answered nothing at all.
      expect(typeof body.error).toBe("string");
      expect(String(body.error).length).toBeGreaterThan(0);

      expect(body.error).toBe(arm.sentence);
      expect(body.code).toBe(arm.code);
    },
  );

  it("every arm's code is UPPER_SNAKE and never the generic terminal", () => {
    for (const arm of ARMS) {
      expect(arm.code).toMatch(/^[A-Z][A-Z0-9_]*$/);
      // The whole requirement: an arm the route classified must not reach the
      // client as "we could not classify this failure".
      expect(arm.code).not.toBe("UNKNOWN");
    }
  });

  it("SOURCE PIN: every code literal is written FIRST in its object literal", () => {
    // The coverage laws derive their populations with a `code:`-first
    // predicate, so an arm written `{ error, code }` is invisible to them (the
    // D-34 reorder). A comment-stripped scan, so prose cannot satisfy it.
    const src = readFileSync(
      join(process.cwd(), "src/app/api/strategies/[id]/name/route.ts"),
      "utf8",
    )
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");

    const codeFirst = (src.match(/\{ code: "[A-Z][A-Z0-9_]*", error:/g) ?? []).length;
    // 9 emitters in source (the two `invalid name` arms are separate sites).
    expect(codeFirst).toBe(9);
    // …and NOT ONE arm is written the other way round.
    expect(src).not.toMatch(/\{ error: "[^"]*", code:/);
  });
});
