import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { SAMPLE_FLOOR_OVERLAPPING_DAYS } from "@/lib/sample-floor";

/**
 * TS half of the TS<->Python optimizer convention parity (Phase 28, OPT-02).
 *
 * Both this file and analytics-service/tests/test_optimizer_parity.py assert
 * their own constants against the SAME shared fixture. The real cross-codebase
 * risk is two independently-declared sample floors (the frontend's
 * SAMPLE_FLOOR_OVERLAPPING_DAYS and the Python optimizer's SAMPLE_FLOOR) silently
 * diverging — so the optimizer's "not enough history" gate and the frontend's
 * floor would disagree, and the UI would promise an estimate the service refuses
 * (or vice-versa). Pinning both to one fixture makes any such drift fail CI.
 */

const FIXTURE = JSON.parse(
  readFileSync(
    join(process.cwd(), "analytics-service/tests/fixtures/optimizer_parity.json"),
    "utf8",
  ),
) as { trading_days: number; sample_floor: number; min_obs_per_strategy: number };

describe("optimizer TS<->Python convention parity", () => {
  it("the frontend sample floor matches the Python optimizer's gate floor", () => {
    expect(SAMPLE_FLOOR_OVERLAPPING_DAYS).toBe(FIXTURE.sample_floor);
  });

  it("the shared fixture encodes the product-wide 252-day annualization", () => {
    // The scenario engine annualizes on 252 (computeScenario: years = n / 252;
    // vol/Sharpe use Math.sqrt(252)). The Python optimizer must use the same, so
    // suggested weights fed back through the engine are convention-consistent.
    expect(FIXTURE.trading_days).toBe(252);
  });

  it("the per-strategy observation gate is a positive integer", () => {
    expect(FIXTURE.min_obs_per_strategy).toBeGreaterThan(0);
    expect(Number.isInteger(FIXTURE.min_obs_per_strategy)).toBe(true);
  });
});
