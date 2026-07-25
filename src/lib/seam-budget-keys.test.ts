import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { SeamBudgetKey } from "./resilient-fetch";

/**
 * Phase 140 review / G2 — WHICH BUDGET EACH CALL SITE ACTUALLY SPENDS.
 *
 * `SEAM_ROUTE_BUDGETS` declares, per route, which budget keys it spends and how
 * many times, and `seam-budgets.invariant.test.ts` checks the ARITHMETIC that
 * follows from those declarations (the SC-4b headroom sum, the SC-4d fan-out
 * bound). What nothing checked is whether the declaration is TRUE — whether the
 * key a wrapper hands the core is the key the table says it spends.
 *
 * That gap was demonstrated, not theorised: swapping `portfolio-optimizer` for
 * `optimize-weights` at a call site left 239 tests green, and 8 of the 13 keys
 * were pinned by nothing at all. The consequence is silent and expensive — the
 * table would keep asserting a 15s budget while the call site actually spent
 * 30s, so every downstream conclusion about lambda headroom (including the one
 * that justifies MAX_COMPOSITE_MEMBERS_PROBED) would be computed from a number
 * production does not use.
 *
 * The core is mocked wholesale so the assertion is on the ARGUMENT, not on any
 * downstream behaviour. Wrappers are allowed to throw afterwards (the mocked
 * response satisfies no Zod schema) — the budget key is chosen BEFORE the
 * response is parsed, so a rejected promise does not weaken the assertion.
 */

// `process-key-client` pulls in correlation-id, which imports `server-only`.
// Same shape process-key-client.test.ts already uses to load the module.
vi.mock("server-only", () => ({}));
vi.mock("@/lib/correlation-id", () => ({
  getCorrelationId: async () => "test-correlation-id",
}));

const spy = vi.hoisted(() => ({
  calls: [] as Array<{ budgetKey: string; path: string }>,
}));

vi.mock("./resilient-fetch", async (importOriginal) => {
  // importOriginal keeps SEAM_BUDGETS / the error classes real, so nothing here
  // depends on a hand-maintained duplicate of the table.
  const actual = await importOriginal<typeof import("./resilient-fetch")>();
  return {
    ...actual,
    resilientFetch: vi.fn(
      async (budgetKey: string, path: string): Promise<Response> => {
        spy.calls.push({ budgetKey, path });
        return new Response(JSON.stringify({}), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      },
    ),
  };
});

beforeEach(() => {
  spy.calls.length = 0;
  vi.resetModules();
  process.env.INTERNAL_API_TOKEN = "test-token";
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/** Swallow the post-fetch schema/shape rejection; we assert on the argument. */
async function ignoringResult(run: () => Promise<unknown>): Promise<void> {
  await run().catch(() => undefined);
}

describe("G2 — every analytics-client wrapper spends its declared budget key", () => {
  const CASES: Array<{
    wrapper: string;
    expected: SeamBudgetKey;
    invoke: (m: typeof import("./analytics-client")) => Promise<unknown>;
  }> = [
    {
      wrapper: "validateKey",
      expected: "validate-key",
      invoke: (m) => m.validateKey("binance", "k", "s"),
    },
    {
      wrapper: "encryptKey",
      expected: "encrypt-key",
      invoke: (m) => m.encryptKey("binance", "k", "s"),
    },
    {
      wrapper: "optimizeScenarioWeights",
      expected: "optimize-weights",
      invoke: (m) => m.optimizeScenarioWeights({}, "min_vol"),
    },
    {
      wrapper: "computePortfolioAnalytics",
      expected: "portfolio-analytics",
      invoke: (m) => m.computePortfolioAnalytics("p1", "u1"),
    },
    {
      wrapper: "runPortfolioOptimizer",
      expected: "portfolio-optimizer",
      invoke: (m) => m.runPortfolioOptimizer("p1", "u1"),
    },
    {
      wrapper: "findReplacementCandidates",
      expected: "bridge",
      invoke: (m) => m.findReplacementCandidates("p1", "s1", "u1"),
    },
    {
      wrapper: "simulateAddCandidate",
      expected: "simulator",
      invoke: (m) => m.simulateAddCandidate("p1", "c1", "u1"),
    },
    {
      wrapper: "recomputeMatch",
      expected: "match-recompute",
      invoke: (m) => m.recomputeMatch("a1", false, "u1"),
    },
    {
      wrapper: "evalMatch",
      expected: "match-eval",
      invoke: (m) => m.evalMatch({ lookback_days: "30" }),
    },
  ];

  it.each(CASES)(
    "$wrapper spends '$expected'",
    async ({ expected, invoke }) => {
      const mod = await import("./analytics-client");
      await ignoringResult(() => invoke(mod));

      expect(spy.calls).toHaveLength(1);
      expect(spy.calls[0].budgetKey).toBe(expected);
    },
  );

  it("covers every wrapper that reaches the core", async () => {
    // Anti-drift fence: a NEW wrapper added to analytics-client without a row
    // above would otherwise inherit the same unpinned status this test exists
    // to end. Counted against the exported surface rather than a literal.
    const mod = await import("./analytics-client");
    const exported = Object.entries(mod)
      .filter(
        ([name, v]) =>
          typeof v === "function" &&
          // Classes (AnalyticsUpstreamError, …) and the @internal escape hatch
          // are not seam wrappers.
          !/^[A-Z]/.test(name) &&
          !name.startsWith("__INTERNAL"),
      )
      .map(([name]) => name);

    expect(new Set(CASES.map((c) => c.wrapper))).toEqual(new Set(exported));
  });
});

/**
 * `postProcessKey` picks its budget key from the FLOW TYPE, mirroring the
 * server's `_is_long_fetch` split: {resync, onboard} are merely enqueued and
 * return 202, while {teaser, csv} run the full pipeline inline. Getting this
 * backwards spends 60s on a call that returns in milliseconds, or — much worse
 * — cuts the inline pipeline's budget, which is the public teaser path.
 */
describe("G2 — postProcessKey maps flow_type to the declared budget key", () => {
  const FLOW_CASES: Array<{ flow: string; expected: SeamBudgetKey }> = [
    { flow: "teaser", expected: "process-key-sync" },
    { flow: "csv", expected: "process-key-sync" },
    { flow: "onboard", expected: "process-key-enqueue" },
    { flow: "resync", expected: "process-key-enqueue" },
  ];

  it.each(FLOW_CASES)("flow_type '$flow' spends '$expected'", async ({ flow, expected }) => {
    const { postProcessKey } = await import("./process-key-client");

    await ignoringResult(() =>
      postProcessKey({
        flow_type: flow as "teaser" | "csv" | "onboard" | "resync",
        source: "test",
        context: {},
        userId: "u1",
        correlationId: "c1",
      }),
    );

    expect(spy.calls).toHaveLength(1);
    expect(spy.calls[0].budgetKey).toBe(expected);
    expect(spy.calls[0].path).toBe("/process-key");
  });
});
