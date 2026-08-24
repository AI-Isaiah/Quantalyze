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
    mockRpc: vi.fn(async (..._args: unknown[]) => ({
      data: null,
      error: null,
    })),
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
  // 151 review E4 — `code` is the field the route branches on. PostgREST always
  // carries it; the fixture omitted it, so every write-error test drove the
  // route down the code-less path and the 23514 arm was untestable.
  upsertError?: { message: string; code?: string } | null;
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
      const res = await POST(
        post({ strategy_id: bad, allocated_amount: 1000 }),
      );
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

  /**
   * ⭐ 161-REVIEW / CR-01 — THE MONEY WRITE'S 500s SAY ONLY WHAT THEY KNOW.
   *
   * 161-10 gave every `internal error` 500 on this route
   * `DASHBOARD_WRITE_FAILED`, whose copy reads "Nothing was saved — the
   * strategy is as it was before you pressed save" and which offers a Retry.
   * Two of the arms it covered cannot support that:
   *
   *   · the upsert ERRORING — `supabase-js` reports a PostgREST rejection
   *     (rolled back) and a transport failure (may have committed, answer lost)
   *     through the same `{ data, error }` shape, and this route does not
   *     discriminate them;
   *   · the upsert returning ZERO ROWS — the route's own comment names "RLS ate
   *     the row" as a cause, and that means the write SUCCEEDED and only the
   *     returning row was suppressed. The allocation may be LIVE.
   *
   * These cases pin the arms by their measured code, with a negative control on
   * a READ-failure arm so "re-code everything" is not a passing strategy.
   */
  it("[161-CR-01] the upsert returning ZERO ROWS is INDETERMINATE — the write may have landed", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    setup({ ps: { upsertRows: 0 } });
    const { POST } = await import("./route");
    const res = await POST(
      post({ strategy_id: STRATEGY_ID, allocated_amount: 120_000 }),
    );

    // ⚠️ ARM PROOF FIRST — the code assertion below is satisfiable by a fixture
    // that never reached the upsert at all.
    expect(res.status).toBe(500);
    const body = (await res.json()) as { code?: unknown; error?: unknown };

    // The SENTENCE is byte-identical: `code` is the only thing that moved.
    expect(body.error).toBe("internal error");
    expect(
      body.code,
      "'RLS ate the row' means the upsert SUCCEEDED and the returning row was " +
        "suppressed. Answering DASHBOARD_WRITE_FAILED here tells an allocator " +
        "nothing was saved about a position that may be live, and invites a " +
        "one-click Retry on top of it.",
    ).toBe("DASHBOARD_WRITE_INDETERMINATE");
    errorSpy.mockRestore();
  });

  it("[161-CR-01] a non-23514 upsert ERROR is INDETERMINATE — an errored write is not a verified rollback", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    setup({
      ps: {
        upsertError: {
          code: "42501",
          message: "permission denied for table portfolio_strategies",
        },
      },
    });
    const { POST } = await import("./route");
    const res = await POST(
      post({ strategy_id: STRATEGY_ID, allocated_amount: 120_000 }),
    );

    expect(res.status).toBe(500);
    const body = (await res.json()) as { code?: unknown; error?: unknown };
    expect(body.error).toBe("internal error");
    expect(body.code).toBe("DASHBOARD_WRITE_INDETERMINATE");
    errorSpy.mockRestore();
  });

  it("[161-CR-01] NEGATIVE CONTROL: a failed strategy LOOKUP stays DASHBOARD_WRITE_FAILED", async () => {
    // The matched pair. Without this, the two cases above are satisfied by a
    // route that answers INDETERMINATE everywhere — which would replace one
    // false sentence with a vaguer one on arms that genuinely establish a zero
    // write, and would strip a Retry that is correct there.
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
    // ⭐ THE PROPERTY THAT EARNS THE SENTENCE, asserted rather than assumed:
    // nothing was sent. Zero upserts is what makes "Nothing was saved" a fact
    // about the control flow instead of a claim about a statement's outcome.
    expect(fx.ps.upsertCalls).toHaveLength(0);
    expect(fx.portfolios.insertPayloads).toHaveLength(0);

    const body = (await res.json()) as { code?: unknown; error?: unknown };
    expect(body.error).toBe("internal error");
    expect(
      body.code,
      "this arm fails on a SELECT with nothing sent, so it is entitled to the " +
        "'Nothing was saved' sentence and to its Retry. Widening the " +
        "indeterminate code to cover it would be over-correction.",
    ).toBe("DASHBOARD_WRITE_FAILED");
    errorSpy.mockRestore();
  });

  /**
   * 151 review E4 — THE GATE FIRING IS NOT A SERVER FAULT.
   *
   * This route's own docblock states the design: the 409 pre-check is UX, the
   * D-03-A BEFORE INSERT trigger is the gate. So the ONE case where the gate
   * actually fires — the mark flipped between the pre-check and the insert,
   * e.g. from MarkOwnershipDialog in another tab — was answered with
   * `internal error` / 500: our software claiming it broke, for a refusal the
   * caller can clear in one action. The oracle here is that the RACE and the
   * PRE-CHECK are indistinguishable to the client, because from the caller's
   * side they are the same fact ("this strategy is not allocatable right now").
   */
  it("[E4] a 23514 from the trigger answers 409 not_allocatable — the SAME shape the pre-check emits", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    setup({
      ps: {
        upsertError: {
          code: "23514",
          // The real trigger message embeds an internal strategy UUID.
          message:
            "strategy 99999999-9999-4999-8999-999999999999 cannot become a position: capital_ownership=unmarked (required: own_capital)",
        },
      },
    });
    const { POST } = await import("./route");
    const res = await POST(
      post({ strategy_id: STRATEGY_ID, allocated_amount: 120_000 }),
    );

    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toBe("not_allocatable");
    // The trigger's text (and the UUID in it) must never ride the response.
    expect(JSON.stringify(body)).not.toContain("capital_ownership");
    expect(JSON.stringify(body)).not.toContain("99999999");
    // A refusal is not a server fault: nothing may be logged as console.error.
    expect(errorSpy).not.toHaveBeenCalled();
    warnSpy.mockRestore();
    errorSpy.mockRestore();
  });

  it("[E4 control] a NON-23514 write error still returns the generic 500", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    setup({
      ps: {
        upsertError: {
          code: "42501",
          message: "permission denied for table portfolio_strategies",
        },
      },
    });
    const { POST } = await import("./route");
    const res = await POST(
      post({ strategy_id: STRATEGY_ID, allocated_amount: 120_000 }),
    );
    expect(res.status).toBe(500);
    expect((await res.json()).error).toBe("internal error");
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

  /**
   * ⭐ 161-REVIEW / CR-01 — the DELETE verb's own matched pair.
   *
   * Both of this verb's 500s were `DASHBOARD_WRITE_FAILED`, and they are on
   * opposite sides of the split: the book lookup fails on a SELECT with nothing
   * sent, while the DELETE itself is a statement whose outcome this route
   * cannot read. Telling a user "Nothing was saved" after a removal we could
   * not confirm is the worst direction to be wrong in — it says their position
   * is still there.
   */
  it("[161-CR-01] a failed DELETE is INDETERMINATE — the removal may have landed", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    setup({ ps: { deleteError: { message: "boom" } } });
    const { DELETE } = await import("./route");
    const res = await DELETE(del({ strategy_id: STRATEGY_ID }));

    expect(res.status).toBe(500);
    const body = (await res.json()) as { code?: unknown; error?: unknown };
    expect(body.error).toBe("internal error"); // sentence byte-identical
    expect(body.code).toBe("DASHBOARD_WRITE_INDETERMINATE");
    errorSpy.mockRestore();
  });

  it("[161-CR-01] NEGATIVE CONTROL: a failed BOOK LOOKUP stays DASHBOARD_WRITE_FAILED", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const fx = setup({
      portfolios: { resolve: [], resolveError: { message: "connection reset" } },
    });
    const { DELETE } = await import("./route");
    const res = await DELETE(del({ strategy_id: STRATEGY_ID }));

    expect(res.status).toBe(500);
    // The property that earns the sentence: no delete was issued.
    expect(fx.ps.deleteEqCalls).toHaveLength(0);
    const body = (await res.json()) as { code?: unknown; error?: unknown };
    expect(body.error).toBe("internal error");
    expect(body.code).toBe("DASHBOARD_WRITE_FAILED");
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
    const src = fs.readFileSync(path.join(__dirname, "route.ts"), "utf8");
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

/**
 * [161-10 / WIZERR-07] EVERY ERROR ARM CARRIES A CODE, AND NO SENTENCE MOVED.
 *
 * Two independent claims over the allocation route, and the plan requires BOTH — the
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
describe("[161-10 / WIZERR-07] the allocation route classifies every arm it refuses", () => {
  const RAW = fs.readFileSync(
    path.join(
      process.cwd(),
      "src/app/api/portfolio-strategies/allocation/route.ts",
    ),
    "utf8",
  );
  const SRC = RAW.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

  it("anti-vacuity: the source loaded and the stripper really stripped", () => {
    expect(RAW.length).toBeGreaterThan(2000);
    expect(RAW).toContain("/**");
    expect(SRC).not.toContain("/**");
    expect(SRC).toContain("export async function POST");
  });

  /**
   * Hand-typed from the pre-code source. A sentence that is reworded, or an arm
   * that is deleted, reddens here by name.
   */
  const SENTENCES: readonly string[] = [
    "unauthorized",
    "invalid json",
    "strategy_id is required",
    "Too many requests",
    "internal error",
    "strategy not found",
    "not_allocatable",
    "portfolio not found",
    "investment row not found",
  ];

  it("every pre-existing sentence is still on the wire, byte-identical", () => {
    // NON-VACUITY: an empty list would make the loop pass trivially, and
    // `"anything".includes("")` would make a blank needle pass too.
    expect(SENTENCES.length).toBe(9);
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
    expect(codeFirst).toBe(23);
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

  it("every code goes THROUGH the json() helper — no parallel response path", () => {
    // The helper is what stamps NO_STORE_HEADERS. An arm that bypassed it
    // would lose the header silently while looking correct, which is the
    // divergence shape this phase keeps closing.
    const viaHelper = (SRC.match(/json\(\s*\{\s*code: "/g) ?? []).length;
    expect(viaHelper).toBe(23);
    // `NextResponse.json(` appears exactly ONCE in this file: inside the
    // helper's own body. Any second occurrence is a parallel path.
    expect((SRC.match(/NextResponse\.json\(/g) ?? []).length).toBe(1);
  });

  it("the interpolated amount sentence is unchanged and carries its code", () => {
    // Built with a template literal, so the double-quoted scan above cannot
    // see it. Pinned on its own terms, interpolation included.
    expect(SRC).toContain(
      "error: `allocated_amount must be a positive number no greater than ${MAGNITUDE_CAPS.MAX_TICKET_SIZE_USD}`",
    );
  });
});
