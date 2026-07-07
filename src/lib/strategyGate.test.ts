import { describe, it, expect } from "vitest";
import {
  checkStrategyGate,
  STRATEGY_GATE_MIN_TRADES,
  STRATEGY_GATE_MIN_DAYS,
  STRATEGY_GATE_MIN_CSV_ROWS,
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

  it("passes complete_with_warnings — a terminal success this deny-list must admit (mig 20260707120000)", () => {
    // The gate is a DENY-LIST: only null/pending/computing/failed are rejected;
    // both 'complete' and 'complete_with_warnings' fall through to PASS. This
    // pins that intent so a future refactor to an allow-list (=== 'complete')
    // can't silently make warned strategies un-approvable — the admin
    // strategy-review re-check (which admits warned) relies on this.
    const result = checkStrategyGate({
      ...BASE,
      computationStatus: "complete_with_warnings",
    });
    expect(result.passed).toBe(true);
    expect(result.code).toBeNull();
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

  // --- CSV-uploaded strategies (no API key, zero trades, history in
  //     csv_daily_returns). Regression for the un-approvable-CSV bug:
  //     the gate previously returned NO_DATA_SOURCE for every CSV strategy
  //     because it only counted the `trades` table. ---

  it("CSV strategy PASSES: no key, zero trades, enough csv rows, analytics complete", () => {
    const result = checkStrategyGate({
      ...BASE,
      apiKeyId: null,
      tradeCount: 0,
      earliestTradeAt: null,
      latestTradeAt: null,
      csvRowCount: 1112,
    });
    expect(result.passed).toBe(true);
    expect(result.code).toBeNull();
  });

  it("CSV strategy is NOT gated by the 5-trade / 7-day-span trade thresholds", () => {
    // Zero trades + null trade span would trip INSUFFICIENT_TRADES/DAYS on the
    // exchange path; the CSV branch must ignore both.
    const result = checkStrategyGate({
      ...BASE,
      apiKeyId: null,
      tradeCount: 0,
      earliestTradeAt: null,
      latestTradeAt: null,
      csvRowCount: 90,
    });
    expect(result.passed).toBe(true);
  });

  it("rejects a CSV strategy below the minimum row count", () => {
    const result = checkStrategyGate({
      ...BASE,
      apiKeyId: null,
      tradeCount: 0,
      earliestTradeAt: null,
      latestTradeAt: null,
      csvRowCount: 3,
    });
    expect(result.passed).toBe(false);
    expect(result.code).toBe("INSUFFICIENT_CSV_HISTORY");
    expect(result.detail).toEqual({ rows: 3, min: STRATEGY_GATE_MIN_CSV_ROWS });
  });

  it("passes a CSV strategy at EXACTLY the minimum row count (7)", () => {
    const result = checkStrategyGate({
      ...BASE,
      apiKeyId: null,
      tradeCount: 0,
      earliestTradeAt: null,
      latestTradeAt: null,
      csvRowCount: STRATEGY_GATE_MIN_CSV_ROWS,
    });
    expect(result.passed).toBe(true);
  });

  it("still rejects NO_DATA_SOURCE when there is no key, no trades, AND no csv rows", () => {
    const result = checkStrategyGate({
      ...BASE,
      apiKeyId: null,
      tradeCount: 0,
      earliestTradeAt: null,
      latestTradeAt: null,
      csvRowCount: 0,
    });
    expect(result.passed).toBe(false);
    expect(result.code).toBe("NO_DATA_SOURCE");
  });

  it("a CSV strategy still requires analytics to be complete", () => {
    const result = checkStrategyGate({
      ...BASE,
      apiKeyId: null,
      tradeCount: 0,
      earliestTradeAt: null,
      latestTradeAt: null,
      csvRowCount: 1112,
      computationStatus: "computing",
    });
    expect(result.passed).toBe(false);
    expect(result.code).toBe("ANALYTICS_COMPUTING");
  });

  // --- P72: keyed ledger-backed strategies (Deribit). Returns are derived into
  //     csv_daily_returns and NEVER populate `trades`, so a keyed Deribit
  //     strategy has tradeCount 0. The daily-returns branch must apply — but
  //     ONLY when the venue is ledger-backed (`isLedgerBacked: true`). A keyed
  //     fill-based (perp) strategy with 0 trades + a funding series must stay on
  //     the trade branch (its series has no completeness gate). ---

  it("keyed Deribit PASSES: ledger-backed, api key set, zero trades, enough csv rows, complete", () => {
    const result = checkStrategyGate({
      ...BASE,
      apiKeyId: "ak-deribit",
      isLedgerBacked: true,
      tradeCount: 0,
      earliestTradeAt: null,
      latestTradeAt: null,
      csvRowCount: 30,
    });
    expect(result.passed).toBe(true);
    expect(result.code).toBeNull();
  });

  it("keyed Deribit below the CSV floor → INSUFFICIENT_CSV_HISTORY (not INSUFFICIENT_TRADES)", () => {
    const result = checkStrategyGate({
      ...BASE,
      apiKeyId: "ak-deribit",
      isLedgerBacked: true,
      tradeCount: 0,
      earliestTradeAt: null,
      latestTradeAt: null,
      csvRowCount: 3,
    });
    expect(result.passed).toBe(false);
    // Pre-P72 a keyed + zero-trades strategy took the trade branch and reported
    // INSUFFICIENT_TRADES; the ledger-backed daily-returns branch owns it now.
    expect(result.code).toBe("INSUFFICIENT_CSV_HISTORY");
    expect(result.detail).toEqual({ rows: 3, min: STRATEGY_GATE_MIN_CSV_ROWS });
  });

  it("keyed FILL-based (perp) with 0 trades + funding series must NOT publish → INSUFFICIENT_TRADES (Finding 1 regression guard)", () => {
    // A keyed perp ALSO writes csv_daily_returns (funding series via
    // derive_broker_dailies), so tradeCount 0 + csvRowCount >= floor is
    // reachable. Without the venue term it would wrongly take the daily-returns
    // branch and PUBLISH on a funding-only series that has no completeness gate.
    // isLedgerBacked defaults false → must stay on the trade branch.
    const result = checkStrategyGate({
      ...BASE,
      apiKeyId: "ak-perp",
      // isLedgerBacked omitted (undefined → false)
      tradeCount: 0,
      earliestTradeAt: null,
      latestTradeAt: null,
      csvRowCount: 30,
    });
    expect(result.passed).toBe(false);
    expect(result.code).toBe("INSUFFICIENT_TRADES");
  });

  it("keyed perp WITH trades stays on the trade branch (no regression)", () => {
    // tradeCount > 0 → NOT daily-returns-sourced even if csvRowCount is set;
    // the perp trade-count floor still governs.
    const result = checkStrategyGate({
      ...BASE,
      apiKeyId: "ak-perp",
      tradeCount: 3,
      csvRowCount: 0,
    });
    expect(result.passed).toBe(false);
    expect(result.code).toBe("INSUFFICIENT_TRADES");
    expect(result.detail).toEqual({ trades: 3, min: STRATEGY_GATE_MIN_TRADES });
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

  it("rejects just below the 7-day boundary (6.99 days) — pins < STRATEGY_GATE_MIN_DAYS", () => {
    // M-0572: the historic inline gate used `< 7`; the helper uses
    // `< STRATEGY_GATE_MIN_DAYS`. A future tweak to `<=` would silently
    // shift the threshold by a day, so pin 6.99 days as a rejection.
    const earliest = new Date("2026-04-01T00:00:00Z");
    const latest = new Date(
      earliest.getTime() + 6.99 * 24 * 60 * 60 * 1000,
    );
    const result = checkStrategyGate({
      ...BASE,
      earliestTradeAt: earliest,
      latestTradeAt: latest,
    });
    expect(result.passed).toBe(false);
    expect(result.code).toBe("INSUFFICIENT_DAYS");
    expect(result.detail?.days).toBe(6.99);
  });

  it("passes just above the 7-day boundary (7.01 days)", () => {
    const earliest = new Date("2026-04-01T00:00:00Z");
    const latest = new Date(
      earliest.getTime() + 7.01 * 24 * 60 * 60 * 1000,
    );
    const result = checkStrategyGate({
      ...BASE,
      earliestTradeAt: earliest,
      latestTradeAt: latest,
    });
    expect(result.passed).toBe(true);
  });

  it("skips the day-span check when latest < earliest (computeSpanDays returns null on negative delta)", () => {
    // M-0572: a corrupt trades table where latestTradeAt < earliestTradeAt
    // yields a negative delta → computeSpanDays returns null → the
    // `spanDays !== null` guard SKIPS the day check entirely. With analytics
    // complete + enough trades, the gate currently PASSES (no temporal
    // validation). This pins the documented current behavior so a future
    // change (e.g. a new code that rejects corrupt timestamps) is a
    // deliberate, test-visible decision rather than a silent drift.
    const result = checkStrategyGate({
      ...BASE,
      earliestTradeAt: new Date("2026-04-10T00:00:00Z"),
      latestTradeAt: new Date("2026-04-01T00:00:00Z"), // earlier than earliest
    });
    expect(result.passed).toBe(true);
    expect(result.code).toBeNull();
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
