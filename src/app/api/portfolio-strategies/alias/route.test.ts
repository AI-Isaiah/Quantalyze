import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

/**
 * Route-level tests for PATCH /api/portfolio-strategies/alias.
 *
 * Covers FIX-LIST atomic IDs:
 *   - G8.B.2 (P263) — coverage gap: the route shipped without any
 *     route-level test, so 6 distinct status paths (CSRF/401/400/404/422/429)
 *     plus the alias trim-cap-null normalization were never pinned.
 *   - G8.B.3 (P264) — empty `catch {}` on req.json() hides parse failures.
 *     The new `catch (err)` branch logs via console.error; this suite
 *     asserts a 400 still comes back AND that the log fires (vi.spyOn).
 *   - G8.B.6 (P267) — UPDATE without .select() returned 200 even when zero
 *     rows changed (mass-assignment oracle). The route now uses
 *     .update(...).select('strategy_id'); a zero-row response is a 404
 *     "investment row not found". This is the regression test for that.
 *   - G8.B.7 (P268) — alias write surface lacked CSRF + rate-limit. CSRF
 *     was added previously; this suite pins both 403-on-bad-origin and
 *     429-on-burst paths.
 */

// audit.ts imports "server-only" which throws under vitest+jsdom.
vi.mock("server-only", () => ({}));

// audit.ts schedules the RPC via next/server's `after()`. Pass through
// synchronously so emission is observable.
vi.mock("next/server", async () => {
  const actual = await vi.importActual<typeof import("next/server")>(
    "next/server",
  );
  return {
    ...actual,
    after: (cb: () => void | Promise<void>) => {
      void cb();
    },
  };
});

const PORTFOLIO_ID = "00000000-0000-0000-0000-aaaaaaaaaaaa";
const STRATEGY_ID = "00000000-0000-0000-0000-bbbbbbbbbbbb";
const TEST_USER_ID = "00000000-0000-0000-0000-cccccccccccc";
const OTHER_USER_PORTFOLIO_ID = "00000000-0000-0000-0000-dddddddddddd";

const { mockFrom, mockRpc, authResult, rateLimitState } = vi.hoisted(() => {
  const userId = "00000000-0000-0000-0000-cccccccccccc";
  return {
    mockFrom: vi.fn(),
    mockRpc: vi.fn(async () => ({ data: null, error: null })),
    authResult: {
      data: { user: { id: userId } as { id: string } | null },
      error: null,
    },
    rateLimitState: { allow: true, retryAfter: 60 },
  };
});

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: {
      getUser: async () => authResult,
    },
    from: mockFrom,
    rpc: mockRpc,
  }),
}));

vi.mock("@/lib/ratelimit", async () => {
  const actual = await vi.importActual<typeof import("@/lib/ratelimit")>(
    "@/lib/ratelimit",
  );
  return {
    ...actual,
    checkLimit: vi.fn(async () =>
      rateLimitState.allow
        ? { success: true, retryAfter: 0 }
        : { success: false, retryAfter: rateLimitState.retryAfter },
    ),
  };
});

function makeReq(
  body: unknown,
  opts: { origin?: string | null; raw?: string } = {},
) {
  const headers: Record<string, string> = {
    "content-type": "application/json",
  };
  // Default to a same-origin localhost header so the CSRF guard
  // (assertSameOrigin) passes.
  const origin = "origin" in opts ? opts.origin : "http://localhost:3000";
  if (origin) headers["origin"] = origin;

  return new NextRequest("http://localhost:3000/api/portfolio-strategies/alias", {
    method: "PATCH",
    headers,
    body: opts.raw ?? JSON.stringify(body),
  });
}

/**
 * Build a mock supabase chain for the portfolios ownership lookup. Returns
 * `{ id }` when `owner=true`, null otherwise (404 path).
 */
function portfoliosChain(owner: boolean, id: string = PORTFOLIO_ID) {
  return {
    select: () => ({
      eq: () => ({
        eq: () => ({
          maybeSingle: async () => ({
            data: owner ? { id } : null,
            error: null,
          }),
        }),
      }),
    }),
  };
}

/**
 * Build a portfolio_strategies UPDATE chain. The terminal `.select()` returns
 * `rowsAffected` rows so we can simulate the G8.B.6 zero-row mass-assignment
 * path AND the happy path with a single returned strategy_id.
 *
 * Records the update payload via `payloadSpy` so trim/null-coercion
 * normalizations can be asserted.
 */
function portfolioStrategiesChain(
  rowsAffected: number,
  errorOnUpdate: { message: string } | null = null,
): { chain: unknown; payloadSpy: ReturnType<typeof vi.fn> } {
  const payloadSpy = vi.fn();
  const chain = {
    update: (payload: Record<string, unknown>) => {
      payloadSpy(payload);
      return {
        eq: () => ({
          eq: () => ({
            select: async () => {
              if (errorOnUpdate) {
                return { data: null, error: errorOnUpdate };
              }
              const data: Array<{ strategy_id: string }> = [];
              for (let i = 0; i < rowsAffected; i++) {
                data.push({ strategy_id: STRATEGY_ID });
              }
              return { data, error: null };
            },
          }),
        }),
      };
    },
  };
  return { chain, payloadSpy };
}

function resetMocks() {
  vi.clearAllMocks();
  authResult.data = { user: { id: TEST_USER_ID } };
  rateLimitState.allow = true;
  rateLimitState.retryAfter = 60;
}

describe("PATCH /api/portfolio-strategies/alias — auth/CSRF/rate-limit", () => {
  beforeEach(resetMocks);

  it("returns 403 when the Origin header is missing/cross-origin (CSRF)", async () => {
    const { PATCH } = await import("./route");
    const res = await PATCH(
      makeReq(
        {
          portfolio_id: PORTFOLIO_ID,
          strategy_id: STRATEGY_ID,
          alias: "Helios alpha",
        },
        { origin: "https://evil.example.com" },
      ),
    );
    expect(res.status).toBe(403);
  });

  it("returns 401 when the user is not authenticated", async () => {
    authResult.data = { user: null };

    const { PATCH } = await import("./route");
    const res = await PATCH(
      makeReq({
        portfolio_id: PORTFOLIO_ID,
        strategy_id: STRATEGY_ID,
        alias: "Helios alpha",
      }),
    );
    expect(res.status).toBe(401);
  });

  it("returns 429 with Retry-After when the rate limiter rejects", async () => {
    rateLimitState.allow = false;
    rateLimitState.retryAfter = 12;

    const { PATCH } = await import("./route");
    const res = await PATCH(
      makeReq({
        portfolio_id: PORTFOLIO_ID,
        strategy_id: STRATEGY_ID,
        alias: "Helios alpha",
      }),
    );
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBe("12");
  });
});

describe("PATCH /api/portfolio-strategies/alias — input validation", () => {
  beforeEach(resetMocks);

  it("[G8.B.3 regression] returns 400 AND logs the parse error when the body is malformed JSON", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const { PATCH } = await import("./route");
    const res = await PATCH(makeReq(undefined, { raw: "{not json" }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("invalid json");
    // The previous bare `catch {}` swallowed all req.json failures
    // silently — this assert pins the G8.B.3 fix so a future revert
    // (back to empty catch) breaks the test.
    expect(errorSpy).toHaveBeenCalled();
    const args = errorSpy.mock.calls[0];
    expect(String(args[0])).toContain("body parse failed");
    errorSpy.mockRestore();
  });

  it("returns 400 when portfolio_id is missing", async () => {
    const { PATCH } = await import("./route");
    const res = await PATCH(
      makeReq({ strategy_id: STRATEGY_ID, alias: "x" }),
    );
    expect(res.status).toBe(400);
  });

  it("returns 400 when strategy_id is missing", async () => {
    const { PATCH } = await import("./route");
    const res = await PATCH(
      makeReq({ portfolio_id: PORTFOLIO_ID, alias: "x" }),
    );
    expect(res.status).toBe(400);
  });

  it("returns 400 when alias is the wrong type (number)", async () => {
    const { PATCH } = await import("./route");
    const res = await PATCH(
      makeReq({
        portfolio_id: PORTFOLIO_ID,
        strategy_id: STRATEGY_ID,
        alias: 42,
      }),
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/alias must be a string or null/i);
  });
});

describe("PATCH /api/portfolio-strategies/alias — ownership / 404", () => {
  beforeEach(resetMocks);

  it("returns 404 when the portfolio is not owned by the authed user", async () => {
    mockFrom.mockImplementation((table: string) => {
      if (table === "portfolios") return portfoliosChain(false);
      throw new Error(`unexpected from(${table})`);
    });

    const { PATCH } = await import("./route");
    const res = await PATCH(
      makeReq({
        portfolio_id: OTHER_USER_PORTFOLIO_ID,
        strategy_id: STRATEGY_ID,
        alias: "Cross-tenant probe",
      }),
    );
    expect(res.status).toBe(404);
    expect((await res.json()).error).toBe("portfolio not found");
  });

  it("[G8.B.6 regression] returns 404 when the (portfolio_id, strategy_id) tuple updates zero rows", async () => {
    // Cross-user mass-assignment surface: ownership check on the
    // portfolio passes (e.g., the attacker IS authed for this portfolio
    // but is trying to rename a strategy that's not actually in the
    // portfolio). Pre-fix, the route returned 200/{ok:true} with no row
    // changed. Post-fix, .select() forces a hard 404.
    const psChain = portfolioStrategiesChain(0);
    mockFrom.mockImplementation((table: string) => {
      if (table === "portfolios") return portfoliosChain(true);
      if (table === "portfolio_strategies") return psChain.chain;
      throw new Error(`unexpected from(${table})`);
    });

    const { PATCH } = await import("./route");
    const res = await PATCH(
      makeReq({
        portfolio_id: PORTFOLIO_ID,
        strategy_id: STRATEGY_ID,
        alias: "Phishing rename probe",
      }),
    );

    expect(res.status).toBe(404);
    expect((await res.json()).error).toBe("investment row not found");
    expect(psChain.payloadSpy).toHaveBeenCalledWith({ alias: "Phishing rename probe" });
  });
});

describe("PATCH /api/portfolio-strategies/alias — happy path + alias normalization", () => {
  beforeEach(resetMocks);

  function setupHappyPath(rowsAffected = 1) {
    const psChain = portfolioStrategiesChain(rowsAffected);
    mockFrom.mockImplementation((table: string) => {
      if (table === "portfolios") return portfoliosChain(true);
      if (table === "portfolio_strategies") return psChain.chain;
      throw new Error(`unexpected from(${table})`);
    });
    return psChain;
  }

  it("returns 200 with normalized alias on the happy path", async () => {
    const psChain = setupHappyPath();

    const { PATCH } = await import("./route");
    const res = await PATCH(
      makeReq({
        portfolio_id: PORTFOLIO_ID,
        strategy_id: STRATEGY_ID,
        alias: "Helios alpha sleeve",
      }),
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ ok: true, alias: "Helios alpha sleeve" });
    expect(psChain.payloadSpy).toHaveBeenCalledWith({ alias: "Helios alpha sleeve" });
  });

  it("trims and caps alias to 120 chars", async () => {
    const psChain = setupHappyPath();
    const longInput = "  " + "a".repeat(200) + "  ";
    const expected = "a".repeat(120);

    const { PATCH } = await import("./route");
    const res = await PATCH(
      makeReq({
        portfolio_id: PORTFOLIO_ID,
        strategy_id: STRATEGY_ID,
        alias: longInput,
      }),
    );

    expect(res.status).toBe(200);
    expect((await res.json()).alias).toBe(expected);
    expect(psChain.payloadSpy).toHaveBeenCalledWith({ alias: expected });
  });

  it("coerces whitespace-only alias to null", async () => {
    const psChain = setupHappyPath();

    const { PATCH } = await import("./route");
    const res = await PATCH(
      makeReq({
        portfolio_id: PORTFOLIO_ID,
        strategy_id: STRATEGY_ID,
        alias: "   ",
      }),
    );

    expect(res.status).toBe(200);
    expect((await res.json()).alias).toBeNull();
    expect(psChain.payloadSpy).toHaveBeenCalledWith({ alias: null });
  });

  it("accepts null alias to clear a prior alias", async () => {
    const psChain = setupHappyPath();

    const { PATCH } = await import("./route");
    const res = await PATCH(
      makeReq({
        portfolio_id: PORTFOLIO_ID,
        strategy_id: STRATEGY_ID,
        alias: null,
      }),
    );

    expect(res.status).toBe(200);
    expect((await res.json()).alias).toBeNull();
    expect(psChain.payloadSpy).toHaveBeenCalledWith({ alias: null });
  });
});
