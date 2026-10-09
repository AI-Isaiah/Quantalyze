/**
 * Phase 170.5 plan 06 (D-07, D-06) - getStrategyDetailV2 reads the factsheet's
 * live joint instead of the stored Python greeks.
 *
 * Root cause being pinned: v2 mapped `metrics_json.alpha / beta / information_ratio
 * / treynor_ratio` into `benchmark_greeks`. The producer writes `info_ratio` and
 * `treynor`, so IR and Treynor were permanently null, and the stored alpha / beta
 * are not the figures the factsheet prints. `readV2BenchmarkJoint` (plan 04) is
 * the factsheet's own chain; the query now calls it and carries the five values
 * plus a status.
 *
 * The fixture's stored keys are the producer's literals (alpha, beta, info_ratio,
 * treynor) with values that differ from the helper's, so a regression that reads
 * the stored blob cannot pass.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));

const ID = "22222222-2222-4222-8222-222222222222";

const rec = vi.hoisted(() => ({
  sentry: [] as { err: unknown; opts: { tags?: Record<string, string> } }[],
  adminClient: { tag: "admin-client" } as unknown,
  joint: vi.fn(),
  strategyRow: null as unknown,
}));

function row(analyticsOverrides: Record<string, unknown> = {}) {
  return {
    id: ID,
    name: "Joint Test Strategy",
    start_date: "2025-01-01",
    supported_exchanges: ["Binance"],
    strategy_types: ["systematic"],
    subtypes: [],
    markets: ["crypto"],
    leverage_range: null,
    avg_daily_turnover: null,
    strategy_analytics: {
      computation_status: "complete",
      cumulative_return: 0.2,
      returns_series: [
        { date: "2025-01-01", value: 1 },
        { date: "2025-01-02", value: 1.01 },
      ],
      // The producer's literal keys, with values that differ from the helper's.
      metrics_json: { history_days: 2, alpha: 0.11, beta: -0.0055, info_ratio: -1.8457, treynor: -2.8659 },
      data_quality_flags: null,
      ...analyticsOverrides,
    },
  };
}

function buildChain() {
  const result = () => ({ data: rec.strategyRow, error: null });
  const chain: Record<string, unknown> = {};
  chain.select = () => chain;
  chain.eq = () => chain;
  chain.order = () => chain;
  chain.limit = () => chain;
  chain.single = async () => result();
  chain.maybeSingle = async () => result();
  return chain;
}

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    from: () => buildChain(),
    rpc: () => Promise.resolve({ data: [], error: null }),
  }),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => rec.adminClient,
}));

vi.mock("@/lib/sentry-capture", () => ({
  captureToSentry: (err: unknown, opts: { tags?: Record<string, string> }) => {
    rec.sentry.push({ err, opts });
  },
}));

vi.mock("@/lib/factsheet/v2-joint", async (importActual) => ({
  ...(await importActual<typeof import("@/lib/factsheet/v2-joint")>()),
  readV2BenchmarkJoint: rec.joint,
}));

import { getStrategyDetailV2 } from "./queries";

const COMPUTED = {
  values: { alpha: 0.2, beta: 0.38, correlation: 0.4, ir: 0.5, treynor: 0.1 },
  status: { kind: "computed", paired: 111, flatLeg: false },
};
const NULLS = { alpha: null, beta: null, correlation: null, ir: null, treynor: null };

beforeEach(() => {
  rec.sentry = [];
  rec.joint.mockReset();
  rec.strategyRow = row();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("getStrategyDetailV2 - live benchmark joint (Phase 170.5 D-07)", () => {
  it("a computed strategy carries the helper's five values and status, not the stored metrics_json greeks", async () => {
    rec.joint.mockResolvedValue(COMPUTED);
    const result = await getStrategyDetailV2(ID);
    expect(result!.panel7Inputs.benchmark_greeks).toEqual(COMPUTED.values);
    expect(result!.panel7Inputs.benchmark_joint).toEqual(COMPUTED.status);
  });

  it("calls the helper once with the admin client and the strategy id", async () => {
    rec.joint.mockResolvedValue(COMPUTED);
    await getStrategyDetailV2(ID);
    expect(rec.joint).toHaveBeenCalledTimes(1);
    expect(rec.joint.mock.calls[0][0]).toBe(rec.adminClient);
    expect(rec.joint.mock.calls[0][1]).toBe(ID);
  });

  it("a non-computed strategy skips the admin read: all five null, status not_computed", async () => {
    rec.strategyRow = row({ computation_status: "pending" });
    const result = await getStrategyDetailV2(ID);
    expect(rec.joint).not.toHaveBeenCalled();
    expect(result!.panel7Inputs.benchmark_greeks).toEqual(NULLS);
    expect(result!.panel7Inputs.benchmark_joint).toEqual({ kind: "not_computed" });
  });

  it("needs_builder is passed through unchanged for the page to resolve", async () => {
    rec.joint.mockResolvedValue({ values: NULLS, status: { kind: "needs_builder" } });
    const result = await getStrategyDetailV2(ID);
    expect(result!.panel7Inputs.benchmark_joint).toEqual({ kind: "needs_builder" });
    expect(result!.panel7Inputs.benchmark_greeks).toEqual(NULLS);
  });

  it("a helper rejection becomes status error (not a 500, not not_computed) and is captured with stage v2-joint", async () => {
    rec.joint.mockRejectedValue(new Error("boom"));
    const result = await getStrategyDetailV2(ID);
    expect(result).not.toBeNull();
    expect(result!.panel7Inputs.benchmark_joint).toEqual({ kind: "error" });
    expect(result!.panel7Inputs.benchmark_greeks).toEqual(NULLS);
    const captured = rec.sentry.filter((c) => c.opts?.tags?.stage === "v2-joint");
    expect(captured).toHaveLength(1);
    expect(captured[0].opts.tags).toEqual({ stage: "v2-joint", strategy_id: ID });
  });
});
