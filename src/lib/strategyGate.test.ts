import { describe, it, expect } from "vitest";
import {
  checkStrategyGate,
  STRATEGY_GATE_MIN_TRADES,
  STRATEGY_GATE_MIN_DAYS,
  type StrategyGateInput,
} from "./strategyGate";

/**
 * Gate helper regression tests. This module is called from two places:
 *  - src/app/api/admin/strategy-review/route.ts (admin approval gate)
 *  - src/app/(dashboard)/strategies/new/wizard/steps/SyncPreviewStep.tsx
 *
 * Each failure mode must be deterministic so that the wizard's scripted
 * error copy (src/lib/wizardErrors.ts) can look up a stable code.
 *
 * Boundary cases: EXACTLY 5 trades passes, EXACTLY 7.0 days passes.
 * These match the historic inline gate at strategy-review/route.ts:34,45.
 */

const BASE: StrategyGateInput = {
  apiKeyId: "ak-1",
  tradeCount: 10,
  earliestTradeAt: new Date("2026-04-01T00:00:00Z"),
  latestTradeAt: new Date("2026-04-10T00:00:00Z"),
  computationStatus: "complete",
  computationError: null,
};

describe("checkStrategyGate", () => {
  it("passes when every threshold is satisfied", () => {
    expect(checkStrategyGate(BASE)).toEqual({
      passed: true,
      code: null,
      reason: null,
      detail: null,
    });
  });

  it("rejects when there is no API key and no trades", () => {
    const result = checkStrategyGate({
      ...BASE,
      apiKeyId: null,
      tradeCount: 0,
      earliestTradeAt: null,
      latestTradeAt: null,
    });
    expect(result.passed).toBe(false);
    expect(result.code).toBe("NO_DATA_SOURCE");
    expect(result.reason).toMatch(/no API key/i);
  });

  it("allows a strategy with no API key when trades exist (CSV upload path)", () => {
    const result = checkStrategyGate({
      ...BASE,
      apiKeyId: null,
      tradeCount: 12,
    });
    expect(result.passed).toBe(true);
  });

  it("rejects below the minimum trade count", () => {
    const result = checkStrategyGate({ ...BASE, tradeCount: 3 });
    expect(result.passed).toBe(false);
    expect(result.code).toBe("INSUFFICIENT_TRADES");
    expect(result.detail).toEqual({ trades: 3, min: STRATEGY_GATE_MIN_TRADES });
  });

  it("passes at EXACTLY the minimum trade count (5)", () => {
    const result = checkStrategyGate({ ...BASE, tradeCount: STRATEGY_GATE_MIN_TRADES });
    expect(result.passed).toBe(true);
  });

  it("rejects below the minimum day span", () => {
    const result = checkStrategyGate({
      ...BASE,
      earliestTradeAt: new Date("2026-04-05T00:00:00Z"),
      latestTradeAt: new Date("2026-04-09T00:00:00Z"), // 4 days
    });
    expect(result.passed).toBe(false);
    expect(result.code).toBe("INSUFFICIENT_DAYS");
    expect(result.detail?.days).toBeLessThan(STRATEGY_GATE_MIN_DAYS);
  });

  it("passes at EXACTLY 7.0 days span (boundary case, matches historic behavior)", () => {
    // Seven full days: 2026-04-01T00:00 to 2026-04-08T00:00
    const result = checkStrategyGate({
      ...BASE,
      earliestTradeAt: new Date("2026-04-01T00:00:00Z"),
      latestTradeAt: new Date("2026-04-08T00:00:00Z"),
    });
    expect(result.passed).toBe(true);
  });

  it("rejects when analytics row is missing", () => {
    const result = checkStrategyGate({ ...BASE, computationStatus: null });
    expect(result.code).toBe("ANALYTICS_MISSING");
  });

  it("rejects when analytics are pending", () => {
    const result = checkStrategyGate({ ...BASE, computationStatus: "pending" });
    expect(result.code).toBe("ANALYTICS_PENDING");
  });

  it("rejects when analytics are still computing", () => {
    const result = checkStrategyGate({ ...BASE, computationStatus: "computing" });
    expect(result.code).toBe("ANALYTICS_COMPUTING");
  });

  it("rejects and surfaces the error detail when analytics failed", () => {
    const result = checkStrategyGate({
      ...BASE,
      computationStatus: "failed",
      computationError: "Railway fetch timed out",
    });
    expect(result.code).toBe("ANALYTICS_FAILED");
    expect(result.reason).toContain("Railway fetch timed out");
    expect(result.detail).toEqual({ error: "Railway fetch timed out" });
  });

  it("rejects analytics-failed without an error message gracefully", () => {
    const result = checkStrategyGate({
      ...BASE,
      computationStatus: "failed",
      computationError: null,
    });
    expect(result.code).toBe("ANALYTICS_FAILED");
    expect(result.reason).not.toContain("undefined");
    expect(result.detail).toBeNull();
  });

  it("skips day-span check when trade timestamps are missing", () => {
    // A strategy with >= 5 trades reported by count but no timestamps
    // should still pass if analytics are complete. This handles the
    // edge case where the trades count is fetched from a head query
    // but the timestamp query returned no rows due to an ordering bug.
    const result = checkStrategyGate({
      ...BASE,
      earliestTradeAt: null,
      latestTradeAt: null,
    });
    expect(result.passed).toBe(true);
  });
});
