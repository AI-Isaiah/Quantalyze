import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import fs from "node:fs";
import path from "node:path";

/**
 * Route-level tests for POST/DELETE /api/portfolio-strategies/allocation —
 * Phase 150 / OWN-03, the phase's MONEY WRITE.
 *
 * Oracle discipline (MEMORY: economic-invariant oracles, not self-referential):
 * every cap boundary and every provisioning literal is TYPED INTO THIS FILE as
 * a literal. Nothing is imported from the module under test, and nothing is
 * imported from `@/lib/closed-sets` or `@/lib/capital-ownership` — a mutation
 * that edits the constant must redden here, which it cannot do if the test
 * reads the same constant the route reads.
 *
 * The load-bearing cases (the falsifiability ledger's oracles):
 *   - SC-4: the upsert's `onConflict` string is asserted LITERALLY. A mutation
 *     to `"portfolio_id"` (dropping strategy_id) must redden — that mutation is
 *     what turns duplicate-add from structurally-impossible into a second row.
 *   - rev-4 W-1: the strategy pre-checks (404 / 409) run BEFORE provisioning,
 *     so a rejected request never mints a container.
 *   - rev-4 W-2: a 23505 race whose re-select comes back empty is a 500 with
 *     ZERO position writes — never an upsert with an undefined portfolio_id.
 *   - rev-4 W-3: the resolve select's captured filter chain contains
 *     `is_test = false`. Dropping that filter would let a *test* portfolio
 *     become the allocator's real book.
 *   - T-150-24: `current_weight` appears nowhere in the route source.
 */

// audit.ts imports "server-only" which throws under vitest+jsdom.
vi.mock("server-only", () => ({}));

// audit.ts schedules the RPC via next/server's `after()`. Pass through
// synchronously so emission is observable.
vi.mock("next/server", async () => {
  const actual =
    await vi.importActual<typeof import("next/server")>("next/server");
  return {
    ...actual,
    after: (cb: () => void | Promise<void>) => {
      void cb();
    },
  };
});

const STRATEGY_ID = "00000000-0000-0000-0000-bbbbbbbbbbbb";
const TEST_USER_ID = "00000000-0000-0000-0000-cccccccccccc";
const EXISTING_PORTFOLIO_ID = "00000000-0000-0000-0000-aaaaaaaaaaaa";
const MINTED_PORTFOLIO_ID = "00000000-0000-0000-0000-eeeeeeeeeeee";

// Literal oracles — the $1B ticket cap boundary. NEVER import MAGNITUDE_CAPS
// here: the whole point is that editing the constant reddens this file.
const CAP_EXACTLY = 1_000_000_000;
const CAP_PLUS_ONE = 1_000_000_001;

const { mockFrom, mockRpc, authResult, checkLimitSpy } = vi.hoisted(() => {
  const userId = "00000000-0000-0000-0000-cccccccccccc";
  return {
    mockFrom: vi.fn(),
    mockRpc: vi.fn(async (..._args: unknown[]) => ({ data: null, error: null })),
    authResult: {
      data: { user: { id: userId } as { id: string } | null },
      error: null,
    },
    checkLimitSpy: vi.fn(),
  };
});

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: async () => authResult },
    from: mockFrom,
    rpc: mockRpc,
  }),
}));

vi.mock("@/lib/ratelimit", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/ratelimit")>("@/lib/ratelimit");
  return { ...actual, checkLimit: checkLimitSpy };
});

// ──────────────────────────────────────────────────────────── request helpers

function makeReq(
  method: "POST" | "DELETE",
  body: unknown,
  opts: { origin?: string | null; raw?: string } = {},
) {
  const headers: Record<string, string> = {
    "content-type": "application/json",
  };
  const origin = "origin" in opts ? opts.origin : "http://localhost:3000";
  if (origin) headers["origin"] = origin;

  return new NextRequest(
    "http://localhost:3000/api/portfolio-strategies/allocation",
    { method, headers, body: opts.raw ?? JSON.stringify(body) },
  );
}

const post = (body: unknown, opts?: { origin?: string | null; raw?: string }) =>
  makeReq("POST", body, opts);
const del = (body: unknown, opts?: { origin?: string | null; raw?: string }) =>
  makeReq("DELETE", body, opts);

// ──────────────────────────────────────────────────────────────── mock chains

type EqCall = [string, unknown];

/** `strategies` ownership + mark pre-check: select().eq().eq().maybeSingle() */
function strategiesChain(
  row: { id: string; capital_ownership: string | null } | null,
  error: { message: string } | null = null,
) {
  const eqCalls: EqCall[] = [];
  const builder = {
    eq: (col: string, val: unknown) => {
      eqCalls.push([col, val]);
      return builder;
    },
    maybeSingle: async () => ({ data: row, error }),
  };
  return { chain: { select: () => builder }, eqCalls };
}

/**
 * `portfolios` resolve-or-provision.
 *
 * `resolve` is the ORDERED list of maybeSingle results: index 0 is the initial
 * resolve, index 1 the post-23505 re-select. The LAST entry repeats for any
 * further calls, because the DB state a second request observes is the state
 * the first one left — a fixture that exhausted after one call would fake a
 * portfolio disappearing between two allocates. `insert` is the single insert
 * result. Every insert payload is captured so "ZERO portfolios inserts" is a
 * real assertion, not an absence of evidence.
 */
function portfoliosChain(opts: {
  resolve: Array<{ id: string } | null>;
  resolveError?: { message: string } | null;
  insert?: {
    data: { id: string } | null;
    error: { code?: string; message: string } | null;
  };
}) {
  const selectEqCalls: EqCall[][] = [];
  const insertPayloads: Record<string, unknown>[] = [];
  let resolveIdx = 0;

  const chain = {
    select: () => {
      const calls: EqCall[] = [];
      selectEqCalls.push(calls);
      const builder = {
        eq: (col: string, val: unknown) => {
          calls.push([col, val]);
          return builder;
        },
        maybeSingle: async () => {
          const data =
            opts.resolve[Math.min(resolveIdx, opts.resolve.length - 1)] ?? null;
          resolveIdx += 1;
          return { data, error: opts.resolveError ?? null };
        },
      };
      return builder;
    },
    insert: (payload: Record<string, unknown>) => {
      insertPayloads.push(payload);
      return {
        select: () => ({
          single: async () =>
            opts.insert ?? {
              data: null,
              error: { message: "no insert configured in this fixture" },
            },
        }),
      };
    },
  };

  return { chain, selectEqCalls, insertPayloads };
}

/** `portfolio_strategies` upsert (POST) + delete (DELETE). */
function psChain(opts: {
  upsertRows?: number;
  upsertError?: { message: string } | null;
  deleteRows?: number;
  deleteError?: { message: string } | null;
}) {
  const upsertCalls: Array<{
    payload: Record<string, unknown>;
    options: Record<string, unknown> | undefined;
  }> = [];
  const deleteEqCalls: EqCall[] = [];

  const rows = (n: number) =>
    Array.from({ length: n }, () => ({ strategy_id: STRATEGY_ID }));

  const chain = {
    upsert: (
      payload: Record<string, unknown>,
      options?: Record<string, unknown>,
    ) => {
      upsertCalls.push({ payload, options });
      return {
        select: async () =>
          opts.upsertError
            ? { data: null, error: opts.upsertError }
            : { data: rows(opts.upsertRows ?? 1), error: null },
      };
    },
    delete: () => {
      const builder = {
        eq: (col: string, val: unknown) => {
          deleteEqCalls.push([col, val]);
          return builder;
        },
        select: async () =>
          opts.deleteError
            ? { data: null, error: opts.deleteError }
            : { data: rows(opts.deleteRows ?? 1), error: null },
      };
      return builder;
    },
  };

  return { chain, upsertCalls, deleteEqCalls };
}

interface Fixture {
  strategies: ReturnType<typeof strategiesChain>;
  portfolios: ReturnType<typeof portfoliosChain>;
  ps: ReturnType<typeof psChain>;
}

/** Wire the three tables onto `mockFrom`. Unknown tables throw loudly. */
function setup(over: {
  strategy?: { id: string; capital_ownership: string | null } | null;
  strategyError?: { message: string } | null;
  portfolios?: Parameters<typeof portfoliosChain>[0];
  ps?: Parameters<typeof psChain>[0];
}): Fixture {
  const strategies = strategiesChain(
    over.strategy === undefined
      ? { id: STRATEGY_ID, capital_ownership: "own_capital" }
      : over.strategy,
    over.strategyError ?? null,
  );
  const portfolios = portfoliosChain(
    over.portfolios ?? { resolve: [{ id: EXISTING_PORTFOLIO_ID }] },
  );
  const ps = psChain(over.ps ?? {});

  mockFrom.mockImplementation((table: string) => {
    if (table === "strategies") return strategies.chain;
    if (table === "portfolios") return portfolios.chain;
    if (table === "portfolio_strategies") return ps.chain;
    throw new Error(`unexpected from(${table})`);
  });

  return { strategies, portfolios, ps };
}

function resetMocks() {
  vi.clearAllMocks();
  authResult.data = { user: { id: TEST_USER_ID } };
  checkLimitSpy.mockImplementation(async () => ({
    success: true,
    retryAfter: 0,
  }));
  mockRpc.mockImplementation(async () => ({ data: null, error: null }));
}

function auditCall() {
  return mockRpc.mock.calls.find((call) => call[0] === "log_audit_event");
}

const NO_STORE = "private, no-store";

// ═══════════════════════════════════════════════════════ auth / CSRF / limits

describe("POST /api/portfolio-strategies/allocation — auth, CSRF, rate limit", () => {
  beforeEach(resetMocks);

  it("returns 403 on a cross-origin request (CSRF)", async () => {
    const { POST } = await import("./route");
    const res = await POST(
      post(
        { strategy_id: STRATEGY_ID, allocated_amount: 1000 },
        { origin: "https://evil.example.com" },
      ),
    );
    expect(res.status).toBe(403);
  });

  it("returns 401 when unauthenticated", async () => {
    authResult.data = { user: null };
    const { POST } = await import("./route");
    const res = await POST(
      post({ strategy_id: STRATEGY_ID, allocated_amount: 1000 }),
    );
    expect(res.status).toBe(401);
  });

  it("returns 429 with Retry-After when the limiter rejects", async () => {
    checkLimitSpy.mockImplementation(async () => ({
      success: false,
      retryAfter: 17,
    }));
    setup({});
    const { POST } = await import("./route");
    const res = await POST(
      post({ strategy_id: STRATEGY_ID, allocated_amount: 1000 }),
    );
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBe("17");
  });
});

// ═════════════════════════════════════════════════════════ amount validation

describe("POST — amount validation ($1B ticket cap, literal oracles)", () => {
  beforeEach(resetMocks);

  async function postAmount(amount: unknown) {
    const fx = setup({});
    const { POST } = await import("./route");
    const res = await POST(
      post({ strategy_id: STRATEGY_ID, allocated_amount: amount }),
    );
    return { res, fx };
  }

  it.each([
    ["zero", 0],
    ["negative", -1],
    ["NaN", Number.NaN],
    ["Infinity", Number.POSITIVE_INFINITY],
    ["-Infinity", Number.NEGATIVE_INFINITY],
    ["null", null],
    ["undefined", undefined],
    ["boolean true", true],
    ["an empty array", []],
    ["an object", {}],
    ["a non-numeric string", "lots"],
  ])("rejects %s with 400 and writes nothing", async (_label, amount) => {
    const { res, fx } = await postAmount(amount);
    expect(res.status).toBe(400);
    expect(fx.ps.upsertCalls).toHaveLength(0);
    expect(fx.portfolios.insertPayloads).toHaveLength(0);
  });

  it("accepts EXACTLY 1_000_000_000 (the approved '$1B sanity cap' fires only ABOVE $1B)", async () => {
    const { res, fx } = await postAmount(CAP_EXACTLY);
    expect(res.status).toBe(200);
    expect(fx.ps.upsertCalls[0].payload.allocated_amount).toBe(CAP_EXACTLY);
  });

  it("rejects 1_000_000_001 with 400", async () => {
    const { res, fx } = await postAmount(CAP_PLUS_ONE);
    expect(res.status).toBe(400);
    expect(fx.ps.upsertCalls).toHaveLength(0);
  });

  it("does NOT burn a rate-limit token on an invalid amount (validate before checkLimit)", async () => {
    await postAmount(-5);
    expect(checkLimitSpy).not.toHaveBeenCalled();
  });

  it("returns 400 on a malformed JSON body and logs the parse failure", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    setup({});
    const { POST } = await import("./route");
    const res = await POST(post(undefined, { raw: "{not json" }));
    expect(res.status).toBe(400);
    expect(errorSpy).toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  it("returns 400 when strategy_id is missing or not UUID-shaped", async () => {
    setup({});
    const { POST } = await import("./route");
    for (const bad of [undefined, "", "   ", 42, "not-a-uuid"]) {
      const res = await POST(post({ strategy_id: bad, allocated_amount: 1000 }));
      expect(res.status).toBe(400);
    }
  });
});

// ══════════════════════════════════════════════ strategy pre-checks: 404 / 409

describe("POST — strategy pre-checks (ownership 404, mark 409)", () => {
  beforeEach(resetMocks);

  it("returns 404 when the strategy is not owned by the caller", async () => {
    const fx = setup({ strategy: null });
    const { POST } = await import("./route");
    const res = await POST(
      post({ strategy_id: STRATEGY_ID, allocated_amount: 120_000 }),
    );
    expect(res.status).toBe(404);
    expect(fx.ps.upsertCalls).toHaveLength(0);
    // The ownership gate is the explicit .eq pair, not RLS alone.
    expect(fx.strategies.eqCalls).toEqual(
      expect.arrayContaining([
        ["id", STRATEGY_ID],
        ["user_id", TEST_USER_ID],
      ]),
    );
  });

  it("returns 409 not_allocatable for a team_review strategy", async () => {
    const fx = setup({
      strategy: { id: STRATEGY_ID, capital_ownership: "team_review" },
    });
    const { POST } = await import("./route");
    const res = await POST(
      post({ strategy_id: STRATEGY_ID, allocated_amount: 120_000 }),
    );
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("not_allocatable");
    expect(fx.ps.upsertCalls).toHaveLength(0);
  });

  it("returns 409 not_allocatable for an UNMARKED (null) strategy — SC 3, null is never allocatable", async () => {
    const fx = setup({
      strategy: { id: STRATEGY_ID, capital_ownership: null },
    });
    const { POST } = await import("./route");
    const res = await POST(
      post({ strategy_id: STRATEGY_ID, allocated_amount: 120_000 }),
    );
    expect(res.status).toBe(409);
    expect(fx.ps.upsertCalls).toHaveLength(0);
  });

  it("fails CLOSED (409) on a garbled mark from the untyped text column", async () => {
    const fx = setup({
      strategy: { id: STRATEGY_ID, capital_ownership: "OWN_CAPITAL " },
    });
    const { POST } = await import("./route");
    const res = await POST(
      post({ strategy_id: STRATEGY_ID, allocated_amount: 120_000 }),
    );
    expect(res.status).toBe(409);
    expect(fx.ps.upsertCalls).toHaveLength(0);
  });

  it("returns 500 (not 404) when the strategy lookup itself errors", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const fx = setup({
      strategy: null,
      strategyError: { message: "connection reset" },
    });
    const { POST } = await import("./route");
    const res = await POST(
      post({ strategy_id: STRATEGY_ID, allocated_amount: 120_000 }),
    );
    expect(res.status).toBe(500);
    expect(fx.ps.upsertCalls).toHaveLength(0);
    errorSpy.mockRestore();
  });
});

// ═══════════════════════════════════════════════════ the write itself (SC 2/4)

describe("POST — the money write (SC 2) and the SC-4 duplicate-add oracle", () => {
  beforeEach(resetMocks);

  it("upserts EXACTLY {portfolio_id, strategy_id, allocated_amount} into the resolved portfolio", async () => {
    const fx = setup({});
    const { POST } = await import("./route");
    const res = await POST(
      post({ strategy_id: STRATEGY_ID, allocated_amount: 120_000 }),
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, allocated_amount: 120_000 });
    expect(fx.ps.upsertCalls).toHaveLength(1);
    // EXACTLY these three keys — an extra key here is a money-path change.
    expect(fx.ps.upsertCalls[0].payload).toEqual({
      portfolio_id: EXISTING_PORTFOLIO_ID,
      strategy_id: STRATEGY_ID,
      allocated_amount: 120_000,
    });
  });

  it("[SC-4 ORACLE] pins the onConflict target to the literal 'portfolio_id,strategy_id'", async () => {
    const fx = setup({});
    const { POST } = await import("./route");
    await POST(post({ strategy_id: STRATEGY_ID, allocated_amount: 120_000 }));

    // The composite PK (portfolio_id, strategy_id) is what makes duplicate-add
    // structurally impossible. Narrowing this to "portfolio_id" would make the
    // second allocate REPLACE a sibling strategy's row; widening/dropping it
    // would mint a second row. Either mutation must redden here.
    expect(fx.ps.upsertCalls[0].options).toMatchObject({
      onConflict: "portfolio_id,strategy_id",
    });
  });

  it("[D-13 / SC 4] a SECOND allocate for the same pair takes the same upsert path — an edit, never a second row", async () => {
    const fx = setup({});
    const { POST } = await import("./route");
    await POST(post({ strategy_id: STRATEGY_ID, allocated_amount: 120_000 }));
    await POST(post({ strategy_id: STRATEGY_ID, allocated_amount: 250_000 }));

    expect(fx.ps.upsertCalls).toHaveLength(2);
    expect(fx.ps.upsertCalls[1].payload).toEqual({
      portfolio_id: EXISTING_PORTFOLIO_ID,
      strategy_id: STRATEGY_ID,
      allocated_amount: 250_000,
    });
    expect(fx.ps.upsertCalls[1].options).toMatchObject({
      onConflict: "portfolio_id,strategy_id",
    });
    // No INSERT-shaped second container, either.
    expect(fx.portfolios.insertPayloads).toHaveLength(0);
  });

  it("returns 500 when the upsert returns zero rows (an anomaly, not a 404)", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    setup({ ps: { upsertRows: 0 } });
    const { POST } = await import("./route");
    const res = await POST(
      post({ strategy_id: STRATEGY_ID, allocated_amount: 120_000 }),
    );
    expect(res.status).toBe(500);
    errorSpy.mockRestore();
  });

  it("returns 500 when the upsert errors (e.g. the D-03-A trigger rejects)", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    setup({ ps: { upsertError: { message: "check_violation" } } });
    const { POST } = await import("./route");
    const res = await POST(
      post({ strategy_id: STRATEGY_ID, allocated_amount: 120_000 }),
    );
    expect(res.status).toBe(500);
    errorSpy.mockRestore();
  });

  it("emits allocation.update anchored on the portfolio with the strategy + amount in metadata", async () => {
    setup({});
    const { POST } = await import("./route");
    await POST(post({ strategy_id: STRATEGY_ID, allocated_amount: 120_000 }));

    const call = auditCall();
    expect(call).toBeDefined();
    const args = call![1] as Record<string, unknown>;
    expect(args.p_action).toBe("allocation.update");
    expect(args.p_entity_type).toBe("allocation");
    expect(args.p_entity_id).toBe(EXISTING_PORTFOLIO_ID);
    expect(args.p_metadata).toMatchObject({
      strategy_id: STRATEGY_ID,
      allocated_amount: 120_000,
    });
  });
});

// ═════════════════════════════════ rev-4 / D-03-B lazy real-book provisioning

describe("POST — lazy real-portfolio provisioning (rev-4, D-03-B)", () => {
  beforeEach(resetMocks);

  it("[rev-4 W-3] the resolve filter pins is_test = false AND user_id = auth.uid()", async () => {
    const fx = setup({});
    const { POST } = await import("./route");
    await POST(post({ strategy_id: STRATEGY_ID, allocated_amount: 120_000 }));

    // Dropping `is_test = false` would let a SCENARIO portfolio become the
    // allocator's real book — silent, and money lands in the wrong container.
    expect(fx.portfolios.selectEqCalls[0]).toEqual(
      expect.arrayContaining([
        ["user_id", TEST_USER_ID],
        ["is_test", false],
      ]),
    );
  });

  it("mints the real book on a zero-portfolio first allocate, then writes the position into it", async () => {
    const fx = setup({
      portfolios: {
        resolve: [null],
        insert: { data: { id: MINTED_PORTFOLIO_ID }, error: null },
      },
    });
    const { POST } = await import("./route");
    const res = await POST(
      post({ strategy_id: STRATEGY_ID, allocated_amount: 120_000 }),
    );

    expect(res.status).toBe(200);
    expect(fx.portfolios.insertPayloads).toHaveLength(1);
    // Literal oracles: is_test false and the migration-023 seed name.
    expect(fx.portfolios.insertPayloads[0]).toEqual({
      user_id: TEST_USER_ID,
      name: "Active Allocation",
      is_test: false,
    });
    // The position lands in the MINTED container, not somewhere else.
    expect(fx.ps.upsertCalls[0].payload).toMatchObject({
      portfolio_id: MINTED_PORTFOLIO_ID,
    });
  });

  it("records provisioned:true in the audit metadata only when it actually minted", async () => {
    setup({
      portfolios: {
        resolve: [null],
        insert: { data: { id: MINTED_PORTFOLIO_ID }, error: null },
      },
    });
    const { POST } = await import("./route");
    await POST(post({ strategy_id: STRATEGY_ID, allocated_amount: 120_000 }));
    expect(
      (auditCall()![1] as Record<string, unknown>).p_metadata,
    ).toMatchObject({ provisioned: true });

    resetMocks();
    setup({});
    await POST(post({ strategy_id: STRATEGY_ID, allocated_amount: 120_000 }));
    expect(
      (auditCall()![1] as Record<string, unknown>).p_metadata,
    ).not.toHaveProperty("provisioned");
  });

  it("performs ZERO portfolios inserts when a real book already exists", async () => {
    const fx = setup({});
    const { POST } = await import("./route");
    const res = await POST(
      post({ strategy_id: STRATEGY_ID, allocated_amount: 120_000 }),
    );
    expect(res.status).toBe(200);
    expect(fx.portfolios.insertPayloads).toHaveLength(0);
  });

  it("[rev-4 W-1] a 404 (not-owned strategy) with zero portfolios mints NOTHING", async () => {
    const fx = setup({
      strategy: null,
      portfolios: {
        resolve: [null],
        insert: { data: { id: MINTED_PORTFOLIO_ID }, error: null },
      },
    });
    const { POST } = await import("./route");
    const res = await POST(
      post({ strategy_id: STRATEGY_ID, allocated_amount: 120_000 }),
    );
    expect(res.status).toBe(404);
    expect(fx.portfolios.insertPayloads).toHaveLength(0);
  });

  it("[rev-4 W-1] a 409 (unmarked strategy) with zero portfolios mints NOTHING", async () => {
    const fx = setup({
      strategy: { id: STRATEGY_ID, capital_ownership: null },
      portfolios: {
        resolve: [null],
        insert: { data: { id: MINTED_PORTFOLIO_ID }, error: null },
      },
    });
    const { POST } = await import("./route");
    const res = await POST(
      post({ strategy_id: STRATEGY_ID, allocated_amount: 120_000 }),
    );
    expect(res.status).toBe(409);
    expect(fx.portfolios.insertPayloads).toHaveLength(0);
  });

  it("survives the portfolios_one_real_per_user 23505 race by re-selecting and proceeding", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const fx = setup({
      portfolios: {
        // resolve #1 (empty) → insert rejects 23505 → resolve #2 finds the
        // row the concurrent request just committed.
        resolve: [null, { id: EXISTING_PORTFOLIO_ID }],
        insert: {
          data: null,
          error: { code: "23505", message: "portfolios_one_real_per_user" },
        },
      },
    });
    const { POST } = await import("./route");
    const res = await POST(
      post({ strategy_id: STRATEGY_ID, allocated_amount: 120_000 }),
    );

    expect(res.status).toBe(200);
    expect(fx.ps.upsertCalls[0].payload).toMatchObject({
      portfolio_id: EXISTING_PORTFOLIO_ID,
    });
    errorSpy.mockRestore();
  });

  it("[rev-4 W-2] a 23505 whose re-select comes back EMPTY is a 500 with ZERO position writes", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const fx = setup({
      portfolios: {
        resolve: [null, null],
        insert: {
          data: null,
          error: { code: "23505", message: "portfolios_one_real_per_user" },
        },
      },
    });
    const { POST } = await import("./route");
    const res = await POST(
      post({ strategy_id: STRATEGY_ID, allocated_amount: 120_000 }),
    );

    // NEVER an upsert with an undefined portfolio_id.
    expect(res.status).toBe(500);
    expect(fx.ps.upsertCalls).toHaveLength(0);
    errorSpy.mockRestore();
  });

  it("returns 500 on a non-23505 insert failure, with zero position writes", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const fx = setup({
      portfolios: {
        resolve: [null],
        insert: { data: null, error: { code: "42501", message: "denied" } },
      },
    });
    const { POST } = await import("./route");
    const res = await POST(
      post({ strategy_id: STRATEGY_ID, allocated_amount: 120_000 }),
    );
    expect(res.status).toBe(500);
    expect(fx.ps.upsertCalls).toHaveLength(0);
    errorSpy.mockRestore();
  });

  it("returns 500 when the resolve select itself errors (never provisions on top of an unknown state)", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const fx = setup({
      portfolios: {
        resolve: [null],
        resolveError: { message: "connection reset" },
        insert: { data: { id: MINTED_PORTFOLIO_ID }, error: null },
      },
    });
    const { POST } = await import("./route");
    const res = await POST(
      post({ strategy_id: STRATEGY_ID, allocated_amount: 120_000 }),
    );
    expect(res.status).toBe(500);
    expect(fx.portfolios.insertPayloads).toHaveLength(0);
    expect(fx.ps.upsertCalls).toHaveLength(0);
    errorSpy.mockRestore();
  });
});

// ═══════════════════════════════════════════════════════════════════ DELETE

describe("DELETE /api/portfolio-strategies/allocation — remove a position", () => {
  beforeEach(resetMocks);

  it("returns 403 on a cross-origin request", async () => {
    const { DELETE } = await import("./route");
    const res = await DELETE(
      del({ strategy_id: STRATEGY_ID }, { origin: "https://evil.example.com" }),
    );
    expect(res.status).toBe(403);
  });

  it("returns 401 when unauthenticated", async () => {
    authResult.data = { user: null };
    const { DELETE } = await import("./route");
    const res = await DELETE(del({ strategy_id: STRATEGY_ID }));
    expect(res.status).toBe(401);
  });

  it("returns 400 when strategy_id is missing or not UUID-shaped", async () => {
    setup({});
    const { DELETE } = await import("./route");
    for (const bad of [undefined, "", 7, "nope"]) {
      const res = await DELETE(del({ strategy_id: bad }));
      expect(res.status).toBe(400);
    }
  });

  it("deletes the (portfolio_id, strategy_id) pair and returns 200", async () => {
    const fx = setup({ ps: { deleteRows: 1 } });
    const { DELETE } = await import("./route");
    const res = await DELETE(del({ strategy_id: STRATEGY_ID }));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(fx.ps.deleteEqCalls).toEqual([
      ["portfolio_id", EXISTING_PORTFOLIO_ID],
      ["strategy_id", STRATEGY_ID],
    ]);
  });

  it("returns 404 when the pair matches zero rows", async () => {
    setup({ ps: { deleteRows: 0 } });
    const { DELETE } = await import("./route");
    const res = await DELETE(del({ strategy_id: STRATEGY_ID }));
    expect(res.status).toBe(404);
  });

  it("returns 404 and mints NOTHING when the caller has no real portfolio", async () => {
    const fx = setup({
      portfolios: {
        resolve: [null],
        insert: { data: { id: MINTED_PORTFOLIO_ID }, error: null },
      },
    });
    const { DELETE } = await import("./route");
    const res = await DELETE(del({ strategy_id: STRATEGY_ID }));

    // A removal must NEVER mint a container.
    expect(res.status).toBe(404);
    expect(fx.portfolios.insertPayloads).toHaveLength(0);
  });

  it("emits allocation.update with removed:true", async () => {
    setup({ ps: { deleteRows: 1 } });
    const { DELETE } = await import("./route");
    await DELETE(del({ strategy_id: STRATEGY_ID }));

    const args = auditCall()![1] as Record<string, unknown>;
    expect(args.p_action).toBe("allocation.update");
    expect(args.p_entity_id).toBe(EXISTING_PORTFOLIO_ID);
    expect(args.p_metadata).toMatchObject({
      strategy_id: STRATEGY_ID,
      removed: true,
    });
  });

  it("returns 500 when the delete errors", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    setup({ ps: { deleteError: { message: "boom" } } });
    const { DELETE } = await import("./route");
    const res = await DELETE(del({ strategy_id: STRATEGY_ID }));
    expect(res.status).toBe(500);
    errorSpy.mockRestore();
  });
});

// ══════════════════════════════════════════════════ no-store on EVERY arm

describe("every arm of both verbs stamps Cache-Control: private, no-store", () => {
  beforeEach(resetMocks);

  it("POST: 403 / 401 / 400 / 429 / 404 / 409 / 500 / 200 all carry the header", async () => {
    const { POST } = await import("./route");
    const seen: number[] = [];

    // 403
    setup({});
    seen.push(
      (
        await POST(
          post(
            { strategy_id: STRATEGY_ID, allocated_amount: 1 },
            { origin: "https://evil.example.com" },
          ),
        )
      ).status,
    );

    const arms: Array<() => Promise<Response>> = [
      // 401
      async () => {
        authResult.data = { user: null };
        setup({});
        const r = await POST(
          post({ strategy_id: STRATEGY_ID, allocated_amount: 1 }),
        );
        authResult.data = { user: { id: TEST_USER_ID } };
        return r;
      },
      // 400
      async () => {
        setup({});
        return POST(post({ strategy_id: STRATEGY_ID, allocated_amount: -1 }));
      },
      // 429
      async () => {
        checkLimitSpy.mockImplementation(async () => ({
          success: false,
          retryAfter: 9,
        }));
        setup({});
        const r = await POST(
          post({ strategy_id: STRATEGY_ID, allocated_amount: 1 }),
        );
        checkLimitSpy.mockImplementation(async () => ({
          success: true,
          retryAfter: 0,
        }));
        return r;
      },
      // 404
      async () => {
        setup({ strategy: null });
        return POST(post({ strategy_id: STRATEGY_ID, allocated_amount: 1 }));
      },
      // 409
      async () => {
        setup({ strategy: { id: STRATEGY_ID, capital_ownership: null } });
        return POST(post({ strategy_id: STRATEGY_ID, allocated_amount: 1 }));
      },
      // 500
      async () => {
        const errorSpy = vi
          .spyOn(console, "error")
          .mockImplementation(() => {});
        setup({ ps: { upsertRows: 0 } });
        const r = await POST(
          post({ strategy_id: STRATEGY_ID, allocated_amount: 1 }),
        );
        errorSpy.mockRestore();
        return r;
      },
      // 200
      async () => {
        setup({});
        return POST(post({ strategy_id: STRATEGY_ID, allocated_amount: 1 }));
      },
    ];

    for (const arm of arms) {
      const res = await arm();
      seen.push(res.status);
      expect(res.headers.get("Cache-Control")).toBe(NO_STORE);
    }

    expect(seen).toEqual([403, 401, 400, 429, 404, 409, 500, 200]);
  });

  it("DELETE: 403 / 401 / 400 / 404 / 500 / 200 all carry the header", async () => {
    const { DELETE } = await import("./route");
    const seen: number[] = [];

    setup({});
    const csrf = await DELETE(
      del({ strategy_id: STRATEGY_ID }, { origin: "https://evil.example.com" }),
    );
    seen.push(csrf.status);
    expect(csrf.headers.get("Cache-Control")).toBe(NO_STORE);

    const arms: Array<() => Promise<Response>> = [
      async () => {
        authResult.data = { user: null };
        setup({});
        const r = await DELETE(del({ strategy_id: STRATEGY_ID }));
        authResult.data = { user: { id: TEST_USER_ID } };
        return r;
      },
      async () => {
        setup({});
        return DELETE(del({ strategy_id: "nope" }));
      },
      async () => {
        setup({ ps: { deleteRows: 0 } });
        return DELETE(del({ strategy_id: STRATEGY_ID }));
      },
      async () => {
        const errorSpy = vi
          .spyOn(console, "error")
          .mockImplementation(() => {});
        setup({ ps: { deleteError: { message: "boom" } } });
        const r = await DELETE(del({ strategy_id: STRATEGY_ID }));
        errorSpy.mockRestore();
        return r;
      },
      async () => {
        setup({ ps: { deleteRows: 1 } });
        return DELETE(del({ strategy_id: STRATEGY_ID }));
      },
    ];

    for (const arm of arms) {
      const res = await arm();
      seen.push(res.status);
      expect(res.headers.get("Cache-Control")).toBe(NO_STORE);
    }

    expect(seen).toEqual([403, 401, 400, 404, 500, 200]);
  });
});

// ═════════════════════════════════════════════════════════ T-150-24 source pin

describe("[T-150-24] the route never touches current_weight", () => {
  it("contains zero non-comment occurrences of current_weight", () => {
    const src = fs.readFileSync(
      path.join(__dirname, "route.ts"),
      "utf8",
    );
    const code = src
      .split("\n")
      .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l))
      .join("\n");
    // Writing current_weight beside legacy NULL rows silently distorts
    // portfolio_returns_series and match scoring (150-RESEARCH § Schema
    // Findings 2 — two analytics consumers default NULL → 1.0 and renormalize).
    expect(code).not.toContain("current_weight");
  });
});
