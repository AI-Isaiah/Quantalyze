/**
 * Phase 12 / METRICS-13: TS-side parity assertion.
 *
 * Reads the committed golden_252d_expected.json and asserts the JSON contract
 * conforms to the typed contract in src/lib/types.ts. This is the schema gate
 * (Reading A); math drift is gated by the Python-side test.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, it, expect } from "vitest";

import {
  assertMetricParity,
  assertTradeMixBucketCount,
  EXPECTED_SIBLING_KINDS,
  FROZEN_TRADE_METRICS_KEYS,
} from "../lib/metrics-parity-helper";

const FIXTURE_PATH = join(
  __dirname,
  "..",
  "..",
  "analytics-service",
  "tests",
  "fixtures",
  "golden_252d_expected.json",
);

describe("METRICS-13 cross-runtime parity (TS schema gate)", () => {
  const expected = JSON.parse(readFileSync(FIXTURE_PATH, "utf-8")) as {
    metrics_json: Record<string, unknown>;
    sibling: Record<string, unknown>;
  };

  it("expected JSON has metrics_json and sibling top-level keys", () => {
    expect(expected).toHaveProperty("metrics_json");
    expect(expected).toHaveProperty("sibling");
  });

  it("every sibling kind is a known StrategyAnalyticsSeriesKind", () => {
    expect(() => assertMetricParity(expected)).not.toThrow();
  });

  it("trade_metrics has only frozen D-16 keys", () => {
    const tm = expected.metrics_json["trade_metrics"] as Record<string, unknown>;
    expect(tm).toBeTruthy();
    for (const key of Object.keys(tm)) {
      expect(FROZEN_TRADE_METRICS_KEYS).toContain(key);
    }
  });

  it("trade_mix bucket count matches D-15 audit outcome", () => {
    expect(() => assertTradeMixBucketCount(expected)).not.toThrow();
  });

  it("expected sibling has all 12 H-A1 kinds (matches Python invariant)", () => {
    // H-A1 (REVIEWS.md): regen_golden.py simulates positions/prices/NAV →
    // exposure_series + turnover_series MUST be populated. Plan-checker Issue 6:
    // TS bar must match Python's tightened assertion to avoid false-green when
    // H-A1 wiring regresses. Tracks EXPECTED_SIBLING_KINDS.size dynamically.
    const keys = Object.keys(expected.sibling);
    expect(keys.length).toBe(EXPECTED_SIBLING_KINDS.size);
    // Every H-A1 / D-01 kind MUST be present
    expect(keys).toContain("rolling_sortino_3m");
    expect(keys).toContain("rolling_sortino_6m");
    expect(keys).toContain("rolling_sortino_12m");
    expect(keys).toContain("rolling_volatility_3m");
    expect(keys).toContain("rolling_volatility_6m");
    expect(keys).toContain("rolling_volatility_12m");
    expect(keys).toContain("rolling_alpha");
    expect(keys).toContain("rolling_beta");
    expect(keys).toContain("daily_returns_grid");
    expect(keys).toContain("log_returns_series");
    expect(keys).toContain("exposure_series"); // H-A1
    expect(keys).toContain("turnover_series"); // H-A1
    // H-D: equity_series_1y MUST NOT be a sibling kind (lives in metrics_json)
    expect(keys).not.toContain("equity_series_1y");
  });
});
