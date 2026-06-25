import { describe, it, expect, beforeEach, vi } from "vitest";

/**
 * audit-2026-05-07 regression tests for `getMyAllocationDashboard` and
 * `getRealPortfolio`. Each test fails on the pre-fix behaviour described
 * in `.planning/audit-2026-05-07/FIX-LIST.md`:
 *
 *   - P34 (G8.A.1): Promise.all silently swallowed `.error` on every
 *     parallel query. Now throws so `error.tsx` + Sentry render a real
 *     failure instead of an empty-state "connect your first exchange".
 *   - P42 (G8.A.9): `getRealPortfolio` collapsed `error || !data` into
 *     `null`, so a transient infra failure presented as the
 *     onboarding empty state. Now throws on `error`; null reserved for
 *     the genuinely-absent row.
 *   - P35 (G8.A.2): `strategies[].strategy.name` was shipped to the
 *     RSC payload regardless of disclosure tier; canonical name is now
 *     `null` for non-institutional rows.
 *   - P44 (G8.A.11): `alertCount.total` over-counted unknown
 *     severities; `total === critical+high+medium+low` invariant
 *     restored.
 *   - P57 (G8.A.24): missing strategy embed (RLS denial / FK widow) hit
 *     `...strategy` and threw `Cannot read properties of null`. Now the
 *     row is dropped with a stable log instead.
 *
 * The mock surface is intentionally separate from `queries.my-allocation.test.ts`
 * so the error-injection plumbing doesn't bleed into the broader suite.
 */

type MockResult = {
  data: unknown;
  error: null | { message: string; code?: string };
  count?: number;
};

const buildResult = vi.hoisted(() => ({
  byTable: {} as Record<string, MockResult>,
  // For `count: 'exact', head: true` queries that need a count without rows.
  countByTable: {} as Record<string, number>,
  // For `.maybeSingle()` results — keyed by table.
  maybeSingleByTable: {} as Record<string, MockResult>,
  // For `.maybeSingle()` results keyed by `${table}|${eqKey}=${eqValue}`,
  // so callers can differentiate two queries against the same table that
  // only differ by an `.eq()` filter (e.g.
  // `getPortfolioAnalyticsWithFallback`'s latest vs "complete-only" pair).
  // Falls back to maybeSingleByTable when no match.
  maybeSingleByTableEq: {} as Record<string, MockResult>,
  // audit-2026-05-07 H-0502: getMyAllocationDashboard now asserts
  // auth.uid() === userId. Tests that exercise the happy path keep
  // authUserId = "user-1"; the H-0502 mismatch test overrides it.
  authUserId: "user-1" as string | null,
}));

function reset() {
  buildResult.byTable = {};
  buildResult.countByTable = {};
  buildResult.maybeSingleByTable = {};
  buildResult.maybeSingleByTableEq = {};
  buildResult.authUserId = "user-1";
}

function chainFor(table: string) {
  let headCount = false;
  // Track the `eq` filters applied so maybeSingle can pick differently
  // for two queries on the same table that only differ by a column filter.
  const eqFilters: Array<{ col: string; value: unknown }> = [];
  const chain: Record<string, unknown> = {
    select: (_cols?: string, opts?: { head?: boolean }) => {
      if (opts?.head === true) headCount = true;
      return chain;
    },
    eq: (col: string, value: unknown) => {
      eqFilters.push({ col, value });
      return chain;
    },
    in: () => chain,
    is: () => chain,
    not: () => chain,
    gt: () => chain,
    gte: () => chain,
    order: () => chain,
    limit: () => chain,
    maybeSingle: async () => {
      // First, try to match by an `eq` filter (most specific).
      for (const { col, value } of eqFilters) {
        const eqKey = `${table}|${col}=${String(value)}`;
        const eqHit = buildResult.maybeSingleByTableEq[eqKey];
        if (eqHit) return eqHit;
      }
      const r = buildResult.maybeSingleByTable[table];
      if (r) return r;
      return { data: null, error: null };
    },
    single: async () => {
      const r = buildResult.byTable[table];
      if (r) return r;
      return { data: null, error: null };
    },
    then: (resolve: (v: MockResult) => void) => {
      if (headCount) {
        resolve({
          data: null,
          error: null,
          count: buildResult.countByTable[table] ?? 0,
        });
        return;
      }
      const r = buildResult.byTable[table];
      if (r) {
        resolve(r);
        return;
      }
      resolve({ data: [], error: null });
    },
  };
  return chain;
}

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    from: (table: string) => chainFor(table),
    auth: {
      getUser: async () => ({
        data: {
          user: buildResult.authUserId
            ? { id: buildResult.authUserId }
            : null,
        },
        error: null,
      }),
    },
  }),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: (table: string) => chainFor(table),
  }),
}));

// audit-2026-05-07 M-0557 round-2: capture all `captureToSentry` invocations
// so the 4 new logging tests can assert ops alerting actually fires (the
// previous round only added `console.error` — half-fix). Pattern mirrors
// `src/app/api/strategies/finalize-wizard/route.test.ts`.
const captureToSentryState = vi.hoisted(() => ({
  calls: [] as Array<{
    err: unknown;
    options: {
      tags: Record<string, string>;
      extra?: Record<string, unknown>;
      level?: string;
    };
  }>,
}));

vi.mock("@/lib/sentry-capture", () => ({
  captureToSentry: (
    err: unknown,
    options: {
      tags: Record<string, string>;
      extra?: Record<string, unknown>;
      level?: string;
    },
  ) => {
    captureToSentryState.calls.push({ err, options });
  },
}));

beforeEach(() => {
  reset();
  captureToSentryState.calls = [];
});

describe("getRealPortfolio — audit-2026-05-07 G8.A.9 (P42)", () => {
  it("throws when supabase reports an error (was: silently null)", async () => {
    buildResult.maybeSingleByTable["portfolios"] = {
      data: null,
      error: { message: "permission denied for table portfolios" },
    };
    const { getRealPortfolio } = await import("./queries");
    await expect(getRealPortfolio("user-1")).rejects.toThrow(
      /getRealPortfolio failed: permission denied for table portfolios/,
    );
  });

  it("returns null for a genuinely-absent row (no error, no data)", async () => {
    buildResult.maybeSingleByTable["portfolios"] = {
      data: null,
      error: null,
    };
    const { getRealPortfolio } = await import("./queries");
    await expect(getRealPortfolio("user-1")).resolves.toBeNull();
  });
});

describe("getMyAllocationDashboard — audit-2026-05-07 G8.A.1 (P34)", () => {
  it("throws when a Step 1 raw Supabase query returns an error", async () => {
    // Step 1 wave: `allocator_holdings` is one of the parallel queries.
    buildResult.byTable["allocator_holdings"] = {
      data: null,
      error: { message: "rls denied" },
    };
    const { getMyAllocationDashboard } = await import("./queries");
    await expect(getMyAllocationDashboard("user-1")).rejects.toThrow(
      /allocator_holdings: rls denied/,
    );
  });

  it("throws when a Step 2 raw Supabase query returns an error", async () => {
    // Step 2 wave runs after a portfolio is found, so seed a real portfolio.
    buildResult.maybeSingleByTable["portfolios"] = {
      data: {
        id: "real-1",
        user_id: "user-1",
        name: "Active",
        description: null,
        created_at: "2024-06-01T00:00:00Z",
        is_test: false,
      },
      error: null,
    };
    buildResult.byTable["portfolio_strategies"] = {
      data: null,
      error: { message: "schema drift" },
    };
    const { getMyAllocationDashboard } = await import("./queries");
    await expect(getMyAllocationDashboard("user-1")).rejects.toThrow(
      /portfolio_strategies: schema drift/,
    );
  });
});

describe("getMyAllocationDashboard — audit-2026-05-07 G8.A.2 + 24 (P35, P57)", () => {
  beforeEach(() => {
    buildResult.maybeSingleByTable["portfolios"] = {
      data: {
        id: "real-1",
        user_id: "user-1",
        name: "Active",
        description: null,
        created_at: "2024-06-01T00:00:00Z",
        is_test: false,
      },
      error: null,
    };
  });

  it("redacts strategy.name to null for non-institutional disclosure tier (P35)", async () => {
    buildResult.byTable["portfolio_strategies"] = {
      data: [
        {
          strategy_id: "s-explor",
          current_weight: 0.5,
          allocated_amount: 100,
          alias: null,
          strategy: {
            id: "s-explor",
            name: "Manager-Given Canonical Name",
            codename: "Quasar",
            disclosure_tier: "exploratory",
            strategy_types: ["macro"],
            markets: ["BTC"],
            start_date: null,
            strategy_analytics: null,
          },
        },
        {
          strategy_id: "s-inst",
          current_weight: 0.5,
          allocated_amount: 100,
          alias: null,
          strategy: {
            id: "s-inst",
            name: "Institutional Strategy",
            codename: null,
            disclosure_tier: "institutional",
            strategy_types: ["systematic"],
            markets: ["ETH"],
            start_date: null,
            strategy_analytics: null,
          },
        },
      ],
      error: null,
    };

    const { getMyAllocationDashboard } = await import("./queries");
    const payload = await getMyAllocationDashboard("user-1");

    const explor = payload.strategies.find((s) => s.strategy_id === "s-explor");
    const inst = payload.strategies.find((s) => s.strategy_id === "s-inst");

    expect(explor?.strategy.name).toBeNull();
    expect(explor?.strategy.codename).toBe("Quasar");
    expect(inst?.strategy.name).toBe("Institutional Strategy");
  });

  it("filters out portfolio_strategies rows with a missing strategy embed instead of crashing (P57)", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    buildResult.byTable["portfolio_strategies"] = {
      data: [
        {
          strategy_id: "s-orphan",
          current_weight: 0.3,
          allocated_amount: 50,
          alias: null,
          strategy: null,
        },
        {
          strategy_id: "s-ok",
          current_weight: 0.7,
          allocated_amount: 150,
          alias: null,
          strategy: {
            id: "s-ok",
            name: "Ok Strategy",
            codename: null,
            disclosure_tier: "institutional",
            strategy_types: [],
            markets: [],
            start_date: null,
            strategy_analytics: null,
          },
        },
      ],
      error: null,
    };

    const { getMyAllocationDashboard } = await import("./queries");
    const payload = await getMyAllocationDashboard("user-1");

    expect(payload.strategies.map((s) => s.strategy_id)).toEqual(["s-ok"]);
    expect(errSpy).toHaveBeenCalledWith(
      expect.stringContaining("strategy embed missing"),
      expect.objectContaining({ strategy_id: "s-orphan" }),
    );
    errSpy.mockRestore();
  });
});

describe("getMyAllocationDashboard — audit-2026-05-07 G8.A.11 (P44)", () => {
  it("excludes unknown severities from alertCount.total (was: silently inflated)", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    buildResult.maybeSingleByTable["portfolios"] = {
      data: {
        id: "real-1",
        user_id: "user-1",
        name: "Active",
        description: null,
        created_at: "2024-06-01T00:00:00Z",
        is_test: false,
      },
      error: null,
    };
    buildResult.byTable["portfolio_alerts"] = {
      data: [
        { id: "a1", severity: "critical" },
        { id: "a2", severity: "high" },
        { id: "a3", severity: "medium" },
        { id: "a4", severity: "low" },
        { id: "a5", severity: "weird-future-value" },
      ],
      error: null,
    };

    const { getMyAllocationDashboard } = await import("./queries");
    const payload = await getMyAllocationDashboard("user-1");

    expect(payload.alertCount.critical).toBe(1);
    expect(payload.alertCount.high).toBe(1);
    expect(payload.alertCount.medium).toBe(1);
    expect(payload.alertCount.low).toBe(1);
    // Total counts only the four recognised buckets — `weird-future-value`
    // is logged and excluded so the dashboard invariant
    // `total === critical+high+medium+low` holds.
    expect(payload.alertCount.total).toBe(4);
    expect(errSpy).toHaveBeenCalledWith(
      expect.stringContaining("unknown severity"),
      "weird-future-value",
    );
    errSpy.mockRestore();
  });
});

describe("getMyAllocationDashboard — audit-2026-05-07 G8.A.2 (P35) follow-up: residual leak closures", () => {
  beforeEach(() => {
    buildResult.maybeSingleByTable["portfolios"] = {
      data: {
        id: "real-1",
        user_id: "user-1",
        name: "Active",
        description: null,
        created_at: "2024-06-01T00:00:00Z",
        is_test: false,
      },
      error: null,
    };
  });

  it("outcomes payload: replacement_strategy.name is redacted for exploratory tier (was: leaked canonical name)", async () => {
    buildResult.byTable["bridge_outcomes"] = {
      data: [
        {
          id: "o1",
          strategy_id: "s-explor-repl",
          match_decision_id: "md-1",
          kind: "allocated",
          percent_allocated: 25,
          allocated_at: "2026-04-01",
          rejection_reason: null,
          note: null,
          delta_30d: null,
          delta_90d: null,
          delta_180d: null,
          estimated_delta_bps: null,
          estimated_days: null,
          needs_recompute: false,
          created_at: "2026-04-15T00:00:00Z",
          replacement_strategy: {
            id: "s-explor-repl",
            name: "Leaked Manager Name",
            codename: "Pulsar",
            disclosure_tier: "exploratory",
          },
          match_decision: {
            original_strategy: {
              id: "s-explor-orig",
              name: "Original Leaked Name",
              codename: "Vega",
              disclosure_tier: "exploratory",
            },
          },
        },
      ],
      error: null,
    };

    const { getMyAllocationDashboard } = await import("./queries");
    const payload = await getMyAllocationDashboard("user-1");

    const outcome = payload.outcomes[0];
    expect(outcome).toBeDefined();
    // Tier-aware redaction: codename surfaces, raw name does NOT.
    expect(outcome.replacement_strategy?.name).toBe("Pulsar");
    expect(outcome.replacement_strategy?.name).not.toBe("Leaked Manager Name");
    expect(outcome.match_decision?.original_strategy.name).toBe("Vega");
    expect(outcome.match_decision?.original_strategy.name).not.toBe(
      "Original Leaked Name",
    );
  });

  // Phase B pr-test-analyzer F2: H-0484 explicit field copy now uses runtime
  // typeof guards. Every BridgeOutcome key must propagate from the raw
  // PostgREST row to the outcome dict — a regression that drops a key from
  // `pickBridgeOutcomeFields` (e.g. removes `needs_recompute` after a
  // schema rename) would otherwise produce `{ needs_recompute: false }`
  // silently. This test seeds distinctive values for every nullable +
  // boolean field and pins them on the response.
  it("propagates every BridgeOutcome field from the raw row", async () => {
    buildResult.byTable["bridge_outcomes"] = {
      data: [
        {
          id: "field-pin-1",
          strategy_id: "s-pin",
          match_decision_id: "md-pin",
          kind: "rejected",
          percent_allocated: 17.5,
          allocated_at: "2026-04-10",
          rejection_reason: "timing_wrong",
          note: "Distinctive note value",
          delta_30d: 0.012,
          delta_90d: -0.034,
          delta_180d: 0.056,
          estimated_delta_bps: 42,
          estimated_days: 90,
          needs_recompute: true,
          created_at: "2026-04-15T08:00:00Z",
          replacement_strategy: {
            id: "s-pin",
            name: "Pin Strategy",
            codename: null,
            disclosure_tier: "institutional",
          },
          match_decision: null,
        },
      ],
      error: null,
    };

    const { getMyAllocationDashboard } = await import("./queries");
    const payload = await getMyAllocationDashboard("user-1");
    const outcome = payload.outcomes.find((o) => o.id === "field-pin-1");
    expect(outcome).toBeDefined();
    expect(outcome!.kind).toBe("rejected");
    expect(outcome!.percent_allocated).toBe(17.5);
    expect(outcome!.allocated_at).toBe("2026-04-10");
    expect(outcome!.rejection_reason).toBe("timing_wrong");
    expect(outcome!.note).toBe("Distinctive note value");
    expect(outcome!.delta_30d).toBe(0.012);
    expect(outcome!.delta_90d).toBe(-0.034);
    expect(outcome!.delta_180d).toBe(0.056);
    expect(outcome!.estimated_delta_bps).toBe(42);
    expect(outcome!.estimated_days).toBe(90);
    expect(outcome!.needs_recompute).toBe(true);
    expect(outcome!.created_at).toBe("2026-04-15T08:00:00Z");
    expect(outcome!.match_decision_id).toBe("md-pin");
  });

  // Phase B type-design F2 + code-reviewer F2: a row missing a REQUIRED
  // BridgeOutcome field (id / created_at) must throw — the previous
  // `row.id as string` cast silently produced `{ id: undefined }`.
  it("throws when a required field (id) is missing on a bridge_outcomes row", async () => {
    buildResult.byTable["bridge_outcomes"] = {
      data: [
        {
          // id intentionally missing — simulates a SELECT column drop
          strategy_id: "s-missing",
          kind: "allocated",
          percent_allocated: 10,
          allocated_at: "2026-04-01",
          rejection_reason: null,
          note: null,
          delta_30d: null,
          delta_90d: null,
          delta_180d: null,
          estimated_delta_bps: null,
          estimated_days: null,
          needs_recompute: false,
          created_at: "2026-04-15T00:00:00Z",
          replacement_strategy: null,
          match_decision: null,
        },
      ],
      error: null,
    };

    const { getMyAllocationDashboard } = await import("./queries");
    await expect(getMyAllocationDashboard("user-1")).rejects.toThrow(
      /missing required id/,
    );
  });

  // Phase C red-team Finding 3: every other field uses a strict typeof
  // guard but `needs_recompute` previously used `Boolean(...)`. `Boolean("false")
  // === true`, so a column-type drift (BOOLEAN → TEXT) would silently flip
  // the stale-data UI indicator. Strict `=== true` is the contract.
  it("rejects non-boolean truthy values for needs_recompute (typeof discipline)", async () => {
    buildResult.byTable["bridge_outcomes"] = {
      data: [
        {
          id: "needs-recompute-string",
          strategy_id: "s-x",
          kind: "allocated",
          percent_allocated: 10,
          allocated_at: "2026-04-01",
          rejection_reason: null,
          note: null,
          delta_30d: null,
          delta_90d: null,
          delta_180d: null,
          estimated_delta_bps: null,
          estimated_days: null,
          needs_recompute: "false", // looks like a falsy intent
          created_at: "2026-04-15T00:00:00Z",
          replacement_strategy: null,
          match_decision: null,
        },
      ],
      error: null,
    };

    const { getMyAllocationDashboard } = await import("./queries");
    const payload = await getMyAllocationDashboard("user-1");
    const outcome = payload.outcomes.find(
      (o) => o.id === "needs-recompute-string",
    );
    expect(outcome).toBeDefined();
    // The string "false" must NOT coerce to true. Strict === true is the
    // contract; any non-boolean value resolves to false.
    expect(outcome!.needs_recompute).toBe(false);
  });

  // Phase B type-design F2: a row carrying an unknown `kind` (enum drift)
  // must throw rather than silently passing through.
  it("throws when a bridge_outcomes row carries an unknown kind value", async () => {
    buildResult.byTable["bridge_outcomes"] = {
      data: [
        {
          id: "bad-kind-1",
          strategy_id: "s-bad",
          kind: "totally_made_up",
          percent_allocated: 10,
          allocated_at: "2026-04-01",
          rejection_reason: null,
          note: null,
          delta_30d: null,
          delta_90d: null,
          delta_180d: null,
          estimated_delta_bps: null,
          estimated_days: null,
          needs_recompute: false,
          created_at: "2026-04-15T00:00:00Z",
          replacement_strategy: null,
          match_decision: null,
        },
      ],
      error: null,
    };

    const { getMyAllocationDashboard } = await import("./queries");
    await expect(getMyAllocationDashboard("user-1")).rejects.toThrow(
      /invalid kind/,
    );
  });

  it("outcomes payload: institutional tier still surfaces canonical name verbatim", async () => {
    buildResult.byTable["bridge_outcomes"] = {
      data: [
        {
          id: "o2",
          strategy_id: "s-inst-repl",
          match_decision_id: null,
          kind: "allocated",
          percent_allocated: 25,
          allocated_at: "2026-04-01",
          rejection_reason: null,
          note: null,
          delta_30d: null,
          delta_90d: null,
          delta_180d: null,
          estimated_delta_bps: null,
          estimated_days: null,
          needs_recompute: false,
          created_at: "2026-04-15T00:00:00Z",
          replacement_strategy: {
            id: "s-inst-repl",
            name: "Institutional Strategy",
            codename: null,
            disclosure_tier: "institutional",
          },
          match_decision: null,
        },
      ],
      error: null,
    };

    const { getMyAllocationDashboard } = await import("./queries");
    const payload = await getMyAllocationDashboard("user-1");

    expect(payload.outcomes[0].replacement_strategy?.name).toBe(
      "Institutional Strategy",
    );
  });

  // Phase C red-team Finding 2: the candidate-strategies SELECT used to
  // destructure `{ data }`-only, so a Supabase error silently produced an
  // empty `nameById` map → every flagged holding's `name` resolved to
  // `undefined` → the `if (!name) return null` filter stripped EVERY entry.
  // Allocators saw an empty flagged-holdings panel masking real breach
  // signals. Now the function throws via assertOk so the error reaches
  // error.tsx + Sentry.
  it("throws when the candidate_strategies SELECT errors (no silent flagged-holdings drop)", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);

    // Seed a flagged batch so the secondary `strategies` SELECT is actually
    // triggered (candidateIds.length > 0).
    buildResult.byTable["match_batches"] = {
      data: [
        {
          id: "batch-flag-err",
          holding_flags: [
            {
              holding_ref: "holding:binance:BTC:spot",
              value_usd: 50000,
              weight: 0.4,
              breach_reasons: ["max_weight"],
              top_candidate_strategy_id: "s-error-cand",
              top_candidate_composite: 80,
              flagged: true,
            },
          ],
        },
      ],
      error: null,
    };
    // Force the secondary strategies SELECT to error.
    buildResult.byTable["strategies"] = {
      data: null,
      error: { message: "rls denied on strategies" },
    };

    const { getMyAllocationDashboard } = await import("./queries");
    await expect(getMyAllocationDashboard("user-1")).rejects.toThrow(
      /flagged_candidate_strategies: rls denied on strategies/,
    );
    errSpy.mockRestore();
  });

  it("flaggedHoldings.top_candidate_name is redacted for exploratory candidate strategies (was: leaked canonical name)", async () => {
    // Seed a flagged batch pointing at an exploratory candidate strategy.
    buildResult.byTable["match_batches"] = {
      data: [
        {
          id: "batch-1",
          holding_flags: [
            {
              holding_ref: "holding:binance:BTC:spot",
              value_usd: 50000,
              weight: 0.4,
              breach_reasons: ["max_weight"],
              top_candidate_strategy_id: "s-explor-cand",
              top_candidate_composite: 80,
              flagged: true,
            },
          ],
        },
      ],
      error: null,
    };
    buildResult.byTable["strategies"] = {
      data: [
        {
          id: "s-explor-cand",
          name: "Leaked Candidate Name",
          codename: "Lyra",
          disclosure_tier: "exploratory",
        },
      ],
      error: null,
    };

    const { getMyAllocationDashboard } = await import("./queries");
    const payload = await getMyAllocationDashboard("user-1");

    expect(payload.flaggedHoldings.length).toBe(1);
    expect(payload.flaggedHoldings[0].top_candidate_name).toBe("Lyra");
    expect(payload.flaggedHoldings[0].top_candidate_name).not.toBe(
      "Leaked Candidate Name",
    );
  });
});

describe("getMyAllocationDashboard — audit-2026-05-07 H-0502 / C-0172 / H-0481 (auth backstop)", () => {
  it("throws when the userId argument does not match the authenticated user", async () => {
    // Simulate a caller passing a userId that wasn't sourced from
    // auth.getUser() (the foot-gun: a future caller takes the id from
    // a query param / header / cookie without auth verification). The
    // admin-client reads below would otherwise happily return THAT
    // user's full holdings + outcomes history.
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    buildResult.authUserId = "attacker"; // logged-in as attacker, queries victim
    const { getMyAllocationDashboard } = await import("./queries");
    await expect(getMyAllocationDashboard("victim")).rejects.toThrow(
      /userId does not match authenticated user/,
    );
    errSpy.mockRestore();
  });

  it("throws when there is no authenticated user at all", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    buildResult.authUserId = null;
    const { getMyAllocationDashboard } = await import("./queries");
    await expect(getMyAllocationDashboard("user-1")).rejects.toThrow(
      /userId does not match authenticated user/,
    );
    errSpy.mockRestore();
  });
});

describe("getUserApiKeys — audit-2026-05-07 H-0499", () => {
  it("throws when supabase reports an error (was: silently empty array)", async () => {
    // Force the api_keys chain to resolve with an error. Previously the
    // function only destructured `data` and returned `[]`, so a real RLS
    // / grant / schema-drift failure rendered the empty-state
    // "connect your first exchange" UI for allocators who actually had
    // keys, masking the regression on a money-display path.
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    buildResult.byTable["api_keys"] = {
      data: null,
      error: { message: "permission denied for table api_keys" },
    };
    const { getUserApiKeys } = await import("./queries");
    await expect(getUserApiKeys("user-1")).rejects.toThrow(
      /getUserApiKeys failed: permission denied for table api_keys/,
    );
    errSpy.mockRestore();
  });

  it("returns an empty array when no rows exist (no error, no data)", async () => {
    buildResult.byTable["api_keys"] = { data: [], error: null };
    const { getUserApiKeys } = await import("./queries");
    await expect(getUserApiKeys("user-1")).resolves.toEqual([]);
  });
});

// audit-2026-05-07 M-0557 round-2 c9 — the round-1 fix added `console.error`
// to 4 helpers but skipped `captureToSentry`, leaving ops alerting silent.
// Each test asserts BOTH log channels fire (console + Sentry) on a non-trivial
// RLS-style error AND that the empty fallback shape is still returned so
// downstream consumers stay shape-compatible.
describe("portfolio helpers — audit-2026-05-07 M-0557 round-2 (Sentry alerting)", () => {
  it("getPortfolioDetail logs to console AND captureToSentry on a non-PGRST116 error", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    buildResult.byTable["portfolios"] = {
      data: null,
      error: { code: "42501", message: "rls denied" },
    };
    const { getPortfolioDetail } = await import("./queries");
    const result = await getPortfolioDetail("p-1");
    expect(result).toBeNull();
    expect(errSpy).toHaveBeenCalledWith(
      expect.stringContaining("[queries.getPortfolioDetail]"),
      expect.objectContaining({ portfolioId: "p-1", code: "42501" }),
    );
    expect(captureToSentryState.calls).toHaveLength(1);
    expect(captureToSentryState.calls[0].options.tags).toEqual({
      op: "getPortfolioDetail",
    });
    expect(captureToSentryState.calls[0].options.level).toBe("error");
    errSpy.mockRestore();
  });

  it("getPortfolioStrategies logs to console AND captureToSentry on error", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    buildResult.byTable["portfolio_strategies"] = {
      data: null,
      error: { code: "42501", message: "rls denied" },
    };
    const { getPortfolioStrategies } = await import("./queries");
    const result = await getPortfolioStrategies("p-1");
    // Empty fallback shape preserved so the consumer's "no strategies" UI
    // still renders rather than throwing.
    expect(result).toEqual([]);
    expect(errSpy).toHaveBeenCalledWith(
      expect.stringContaining("[queries.getPortfolioStrategies]"),
      expect.objectContaining({ portfolioId: "p-1" }),
    );
    expect(captureToSentryState.calls).toHaveLength(1);
    expect(captureToSentryState.calls[0].options.tags).toEqual({
      op: "getPortfolioStrategies",
    });
    errSpy.mockRestore();
  });

  it("getPortfolioAlerts logs to console AND captureToSentry on error", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    buildResult.byTable["portfolio_alerts"] = {
      data: null,
      error: { code: "42501", message: "rls denied" },
    };
    const { getPortfolioAlerts } = await import("./queries");
    const result = await getPortfolioAlerts("p-1");
    expect(result).toEqual([]);
    expect(errSpy).toHaveBeenCalledWith(
      expect.stringContaining("[queries.getPortfolioAlerts]"),
      expect.objectContaining({ portfolioId: "p-1" }),
    );
    expect(captureToSentryState.calls).toHaveLength(1);
    expect(captureToSentryState.calls[0].options.tags).toEqual({
      op: "getPortfolioAlerts",
    });
    errSpy.mockRestore();
  });

  it("getAllocationEvents logs to console AND captureToSentry on error", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    buildResult.byTable["allocation_events"] = {
      data: null,
      error: { code: "42501", message: "rls denied" },
    };
    const { getAllocationEvents } = await import("./queries");
    const result = await getAllocationEvents("p-1");
    expect(result).toEqual([]);
    expect(errSpy).toHaveBeenCalledWith(
      expect.stringContaining("[queries.getAllocationEvents]"),
      expect.objectContaining({ portfolioId: "p-1" }),
    );
    expect(captureToSentryState.calls).toHaveLength(1);
    expect(captureToSentryState.calls[0].options.tags).toEqual({
      op: "getAllocationEvents",
    });
    errSpy.mockRestore();
  });
});

// audit-2026-05-07 L-0028 — `getPortfolioDetail` must SILENCE the PGRST116
// "no rows found" path (genuine not-found, not an infra failure). The error
// channel must remain quiet so server logs only surface real fetch / RLS
// failures.
describe("getPortfolioDetail — audit-2026-05-07 L-0028 (PGRST116 silence)", () => {
  it("returns null and does NOT log on PGRST116 (not-found)", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    buildResult.byTable["portfolios"] = {
      data: null,
      error: { code: "PGRST116", message: "no rows found" },
    };
    const { getPortfolioDetail } = await import("./queries");
    const result = await getPortfolioDetail("nonexistent");
    expect(result).toBeNull();
    expect(errSpy).not.toHaveBeenCalled();
    expect(captureToSentryState.calls).toHaveLength(0);
    errSpy.mockRestore();
  });

  it("returns null AND logs on a non-PGRST116 error (sibling assertion)", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    buildResult.byTable["portfolios"] = {
      data: null,
      error: { code: "42501", message: "rls denied" },
    };
    const { getPortfolioDetail } = await import("./queries");
    const result = await getPortfolioDetail("p-1");
    expect(result).toBeNull();
    expect(errSpy).toHaveBeenCalled();
    expect(captureToSentryState.calls).toHaveLength(1);
    errSpy.mockRestore();
  });
});

// audit-2026-05-07 M-0553 — sort each symbol series ONCE outside the
// per-holding loop so aliased holdings (BTC@binance + BTC@okx) share the same
// pre-sorted array instead of re-cloning + re-sorting per holding. The
// invariant we pin: aliased holdings produce identical ascending series, and
// the per-symbol sort runs once per symbol rather than once per holding.
describe("reconstructHoldingReturnsByScopeRef — audit-2026-05-07 M-0553", () => {
  it("returns identical ascending series for two holdings sharing a symbol (reverse-order snapshots)", async () => {
    const { reconstructHoldingReturnsByScopeRef } = await import("./queries");
    // Snapshots seeded in REVERSE-CHRONOLOGICAL order to verify the helper
    // sorts internally — DB queries are not guaranteed to return ascending
    // by asof, and the per-symbol sort is the M-0553 invariant.
    const equitySnapshots = [
      { asof: "2026-04-03", breakdown: { BTC: 110 } },
      { asof: "2026-04-01", breakdown: { BTC: 100 } },
      { asof: "2026-04-02", breakdown: { BTC: 105 } },
    ];
    const holdingsSummary = [
      { symbol: "BTC", venue: "binance", holding_type: "spot" as const },
      { symbol: "BTC", venue: "okx", holding_type: "spot" as const },
    ];
    const result = reconstructHoldingReturnsByScopeRef(
      equitySnapshots,
      holdingsSummary,
    );
    const binanceKey = "holding:binance:BTC:spot";
    const okxKey = "holding:okx:BTC:spot";
    expect(result[binanceKey]).toBeDefined();
    expect(result[okxKey]).toBeDefined();
    // Aliased holdings must produce the SAME derived series.
    expect(result[binanceKey]).toEqual(result[okxKey]);
    // Series must be ascending by date (proves the internal sort fired).
    const dates = result[binanceKey].map((p) => p.date);
    expect(dates).toEqual([...dates].sort((a, b) => a.localeCompare(b)));
    expect(dates).toEqual(["2026-04-02", "2026-04-03"]);
  });

  it("sorts each symbol series exactly once (not once per holding)", async () => {
    const sortSpy = vi.spyOn(Array.prototype, "sort");
    const { reconstructHoldingReturnsByScopeRef } = await import("./queries");
    const equitySnapshots = [
      { asof: "2026-04-03", breakdown: { BTC: 110, ETH: 60 } },
      { asof: "2026-04-01", breakdown: { BTC: 100, ETH: 50 } },
      { asof: "2026-04-02", breakdown: { BTC: 105, ETH: 55 } },
    ];
    const holdingsSummary = [
      { symbol: "BTC", venue: "binance", holding_type: "spot" as const },
      { symbol: "BTC", venue: "okx", holding_type: "spot" as const },
      { symbol: "BTC", venue: "bybit", holding_type: "spot" as const },
      { symbol: "ETH", venue: "binance", holding_type: "spot" as const },
      { symbol: "ETH", venue: "okx", holding_type: "spot" as const },
    ];
    const before = sortSpy.mock.calls.length;
    reconstructHoldingReturnsByScopeRef(equitySnapshots, holdingsSummary);
    const sortCalls = sortSpy.mock.calls.length - before;
    // 2 unique symbols (BTC + ETH) → exactly 2 sort calls. The pre-M-0553
    // implementation would have called sort 5x (once per holding).
    expect(sortCalls).toBe(2);
    sortSpy.mockRestore();
  });
});

// audit-2026-05-07 M-0559 round-2 — pin `getPortfolioAnalyticsWithFallback`'s
// 4-arm discriminated union. The helper picks `kind` based on whether a
// latest row exists, whether the latest is `complete`, and whether a prior
// `complete` row is present.
describe("getPortfolioAnalyticsWithFallback — audit-2026-05-07 M-0559", () => {
  it("returns kind='none' when both queries resolve null", async () => {
    // Both latest + lastGood queries return null (no rows).
    const { getPortfolioAnalyticsWithFallback } = await import("./queries");
    const result = await getPortfolioAnalyticsWithFallback("p-1");
    expect(result.kind).toBe("none");
  });

  it("returns kind='fresh' when latest.computation_status='complete'", async () => {
    buildResult.maybeSingleByTable["portfolio_analytics"] = {
      data: {
        portfolio_id: "p-1",
        computation_status: "complete",
        computed_at: "2026-05-01T00:00:00Z",
      },
      error: null,
    };
    const { getPortfolioAnalyticsWithFallback } = await import("./queries");
    const result = await getPortfolioAnalyticsWithFallback("p-1");
    expect(result.kind).toBe("fresh");
    if (result.kind === "fresh") {
      expect(result.row.computation_status).toBe("complete");
    }
  });

  it("returns kind='fallback' when latest='failed' AND a lastGood row exists", async () => {
    // Differentiate the two queries via the computation_status `eq` filter:
    // only the "complete" branch carries that filter.
    buildResult.maybeSingleByTableEq[
      "portfolio_analytics|computation_status=complete"
    ] = {
      data: {
        portfolio_id: "p-1",
        computation_status: "complete",
        computed_at: "2026-04-15T00:00:00Z",
      },
      error: null,
    };
    buildResult.maybeSingleByTable["portfolio_analytics"] = {
      data: {
        portfolio_id: "p-1",
        computation_status: "failed",
        computed_at: "2026-05-01T00:00:00Z",
        computation_error: "redis pipeline broke",
      },
      error: null,
    };
    const { getPortfolioAnalyticsWithFallback } = await import("./queries");
    const result = await getPortfolioAnalyticsWithFallback("p-1");
    expect(result.kind).toBe("fallback");
    if (result.kind === "fallback") {
      expect(result.latest.computation_status).toBe("failed");
      expect(result.lastGood.computation_status).toBe("complete");
    }
  });

  it("returns kind='latest_only' when latest='failed' AND no lastGood row exists", async () => {
    // Only the unfiltered query returns a row; the .eq("computation_status","complete")
    // query returns null.
    buildResult.maybeSingleByTable["portfolio_analytics"] = {
      data: {
        portfolio_id: "p-1",
        computation_status: "failed",
        computed_at: "2026-05-01T00:00:00Z",
      },
      error: null,
    };
    // The maybeSingleByTableEq lookup falls through to maybeSingleByTable for
    // BOTH queries, which would pick the same row for both. To produce the
    // "failed, no fallback" arm we need the eq-filtered query to return null.
    buildResult.maybeSingleByTableEq[
      "portfolio_analytics|computation_status=complete"
    ] = { data: null, error: null };
    const { getPortfolioAnalyticsWithFallback } = await import("./queries");
    const result = await getPortfolioAnalyticsWithFallback("p-1");
    expect(result.kind).toBe("latest_only");
    if (result.kind === "latest_only") {
      expect(result.latest.computation_status).toBe("failed");
    }
  });

  it("returns kind='latest_only' when latest='computing' AND lastGood exists (computing wins over fallback)", async () => {
    // Per the implementation: only `computation_status === "failed"` triggers
    // the fallback branch. `computing` falls through to latest_only even if
    // a prior complete row exists.
    buildResult.maybeSingleByTableEq[
      "portfolio_analytics|computation_status=complete"
    ] = {
      data: {
        portfolio_id: "p-1",
        computation_status: "complete",
        computed_at: "2026-04-15T00:00:00Z",
      },
      error: null,
    };
    buildResult.maybeSingleByTable["portfolio_analytics"] = {
      data: {
        portfolio_id: "p-1",
        computation_status: "computing",
        computed_at: "2026-05-01T00:00:00Z",
      },
      error: null,
    };
    const { getPortfolioAnalyticsWithFallback } = await import("./queries");
    const result = await getPortfolioAnalyticsWithFallback("p-1");
    expect(result.kind).toBe("latest_only");
    if (result.kind === "latest_only") {
      expect(result.latest.computation_status).toBe("computing");
    }
  });
});

// audit-2026-05-07 M-0559 round-2 — pin `chooseAnalytics` arm selection.
// The fallback arm has the most behaviour: it merges lastGood data with the
// latest row's `computation_status='failed'` flag + `computation_error`
// fallback default. Pinning these prevents a future refactor from silently
// dropping the stale-badge signal.
describe("chooseAnalytics — audit-2026-05-07 M-0559", () => {
  const makeRow = (overrides: Partial<{
    computation_status: "complete" | "failed" | "computing";
    computation_error: string | null;
    total_return_twr: number | null;
  }> = {}) => ({
    portfolio_id: "p-1",
    computation_status: "complete" as "complete" | "failed" | "computing",
    computed_at: "2026-05-01T00:00:00Z",
    computation_error: null as string | null,
    total_return_twr: 0.12 as number | null,
    ...overrides,
  });

  it("'none' arm returns null", async () => {
    const { chooseAnalytics } = await import(
      "@/app/(dashboard)/portfolios/[id]/page"
    );
    expect(chooseAnalytics({ kind: "none" })).toBeNull();
  });

  it("'fresh' arm returns the row verbatim", async () => {
    const { chooseAnalytics } = await import(
      "@/app/(dashboard)/portfolios/[id]/page"
    );
    const row = makeRow({ computation_status: "complete" });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = chooseAnalytics({ kind: "fresh", row: row as any });
    expect(result).toBe(row);
  });

  it("'latest_only' arm returns the latest row verbatim (failed-no-fallback)", async () => {
    const { chooseAnalytics } = await import(
      "@/app/(dashboard)/portfolios/[id]/page"
    );
    const latest = makeRow({ computation_status: "failed" });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = chooseAnalytics({ kind: "latest_only", latest: latest as any });
    expect(result).toBe(latest);
  });

  it("'fallback' arm: returned row is shaped from lastGood, computation_status='failed', computation_error falls back to default when null", async () => {
    const { chooseAnalytics } = await import(
      "@/app/(dashboard)/portfolios/[id]/page"
    );
    const lastGood = makeRow({
      computation_status: "complete",
      total_return_twr: 0.42, // distinctive value to prove lastGood is the data source
    });
    const latest = makeRow({
      computation_status: "failed",
      computation_error: null, // null → must fall back to the default string
      total_return_twr: -0.99,
    });
    const result = chooseAnalytics({
      kind: "fallback",
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      latest: latest as any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      lastGood: lastGood as any,
    });
    expect(result).not.toBeNull();
    expect(result!.total_return_twr).toBe(0.42); // shape from lastGood
    expect(result!.computation_status).toBe("failed"); // preserved from latest
    // computation_error falls back to the default string when latest.computation_error is null.
    expect(result!.computation_error).toBe(
      "Latest computation failed; showing last-good values.",
    );
  });

  it("'fallback' arm: preserves latest.computation_error when non-null (no default substitution)", async () => {
    const { chooseAnalytics } = await import(
      "@/app/(dashboard)/portfolios/[id]/page"
    );
    const lastGood = makeRow({ computation_status: "complete" });
    const latest = makeRow({
      computation_status: "failed",
      computation_error: "specific upstream redis timeout",
    });
    const result = chooseAnalytics({
      kind: "fallback",
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      latest: latest as any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      lastGood: lastGood as any,
    });
    expect(result!.computation_error).toBe("specific upstream redis timeout");
  });
});
