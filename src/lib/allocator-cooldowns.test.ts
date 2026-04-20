/**
 * Unit test for the ISSUE-006 client-side cooldown math.
 *
 * Mirrors `EXCHANGE_COOLDOWNS` in analytics-service/services/job_worker.py.
 * A drift between the two maps would show a countdown that doesn't match
 * when the Python worker actually retries — silent contract break.
 */

import { describe, it, expect } from "vitest";
import {
  EXCHANGE_COOLDOWN_SECONDS,
  DEFAULT_EXCHANGE_COOLDOWN_SECONDS,
  computeRetryAtSeconds,
} from "./allocator-cooldowns";

describe("allocator-cooldowns — ISSUE-006 retry math", () => {
  it("matches the Python EXCHANGE_COOLDOWNS map (binance/okx/bybit)", () => {
    // Keep this in sync with job_worker.py:66. If you change one, change
    // the other and grep both sides for the number.
    expect(EXCHANGE_COOLDOWN_SECONDS.binance).toBe(120);
    expect(EXCHANGE_COOLDOWN_SECONDS.okx).toBe(300);
    expect(EXCHANGE_COOLDOWN_SECONDS.bybit).toBe(600);
    expect(DEFAULT_EXCHANGE_COOLDOWN_SECONDS).toBe(120);
  });

  it("okx: last_429 35s ago → ~265s remaining (300s cooldown)", () => {
    const last429 = new Date(Date.now() - 35_000).toISOString();
    const remaining = computeRetryAtSeconds("okx", last429);
    expect(remaining).toBeGreaterThanOrEqual(263);
    expect(remaining).toBeLessThanOrEqual(267);
  });

  it("binance: last_429 10s ago → ~110s remaining (120s cooldown)", () => {
    const last429 = new Date(Date.now() - 10_000).toISOString();
    const remaining = computeRetryAtSeconds("binance", last429);
    expect(remaining).toBeGreaterThanOrEqual(108);
    expect(remaining).toBeLessThanOrEqual(112);
  });

  it("clamps to 0 when the cooldown has already elapsed", () => {
    const last429 = new Date(Date.now() - 400_000).toISOString();
    expect(computeRetryAtSeconds("okx", last429)).toBe(0);
  });

  it("returns undefined when last_429_at is missing (caller shows 0s)", () => {
    expect(computeRetryAtSeconds("okx", null)).toBeUndefined();
    expect(computeRetryAtSeconds("okx", undefined)).toBeUndefined();
    expect(computeRetryAtSeconds("okx", "")).toBeUndefined();
  });

  it("returns undefined on unparseable timestamp", () => {
    expect(computeRetryAtSeconds("okx", "not-a-date")).toBeUndefined();
  });

  it("unknown exchange falls back to 120s default", () => {
    const last429 = new Date(Date.now() - 10_000).toISOString();
    const remaining = computeRetryAtSeconds("kraken", last429);
    expect(remaining).toBeGreaterThanOrEqual(108);
    expect(remaining).toBeLessThanOrEqual(112);
  });
});
