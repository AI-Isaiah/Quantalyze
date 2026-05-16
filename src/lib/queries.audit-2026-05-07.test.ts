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
  error: null | { message: string };
  count?: number;
};

const buildResult = vi.hoisted(() => ({
  byTable: {} as Record<string, MockResult>,
  // For `count: 'exact', head: true` queries that need a count without rows.
  countByTable: {} as Record<string, number>,
  // For `.maybeSingle()` results — keyed by table.
  maybeSingleByTable: {} as Record<string, MockResult>,
  // audit-2026-05-07 H-0502: getMyAllocationDashboard now asserts
  // auth.uid() === userId. Tests that exercise the happy path keep
  // authUserId = "user-1"; the H-0502 mismatch test overrides it.
  authUserId: "user-1" as string | null,
}));

function reset() {
  buildResult.byTable = {};
  buildResult.countByTable = {};
  buildResult.maybeSingleByTable = {};
  buildResult.authUserId = "user-1";
}

function chainFor(table: string) {
  let headCount = false;
  const chain: Record<string, unknown> = {
    select: (_cols?: string, opts?: { head?: boolean }) => {
      if (opts?.head === true) headCount = true;
      return chain;
    },
    eq: () => chain,
    in: () => chain,
    is: () => chain,
    not: () => chain,
    gt: () => chain,
    order: () => chain,
    limit: () => chain,
    maybeSingle: async () => {
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

beforeEach(reset);

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
