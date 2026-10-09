import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Phase 170.5 plan 05 — producer-shape contract for Panel 7.
 *
 * The v2 Exposure & benchmark greeks panel reads three JSONB shapes whose only
 * writer is Python. The panel's guards (`panel7-series.ts`) and the resolver
 * for `btc_rolling_correlation_90d` are written against those shapes. A
 * fixture invented on the TypeScript side proves nothing about the producer
 * (RESEARCH Anti-Patterns: the turnover `{date, turnover}` vs `{date, value}`
 * mismatch shipped precisely because both sides were tested against their own
 * invention).
 *
 * This test reads the Python source as text and fails when a key the panel
 * depends on is renamed or removed there, so the drift surfaces at the
 * producer's commit rather than as an empty chart on PROD.
 */
function readSource(relPath: string): string {
  return readFileSync(resolve(process.cwd(), relPath), "utf8");
}

describe("v2 Panel 7 producer shapes", () => {
  const reconstruction = readSource(
    "analytics-service/services/position_reconstruction.py",
  );
  const metrics = readSource("analytics-service/services/metrics.py");

  it("ExposurePoint carries date, gross and net (the keys keepExposurePoints reads)", () => {
    expect(reconstruction).toContain("class ExposurePoint");
    const block = reconstruction.slice(
      reconstruction.indexOf("class ExposurePoint"),
    );
    expect(block).toMatch(/^\s+date: str/m);
    expect(block).toMatch(/^\s+gross: float/m);
    expect(block).toMatch(/^\s+net: float/m);
  });

  it("the turnover series is written under the key `turnover`, not `value` (why the chart gate exists)", () => {
    expect(reconstruction).toContain('"turnover":');
    expect(reconstruction).not.toMatch(/series\.append\(\{"date": date, "value":/);
  });

  it("the 90-day rolling correlation is written to metrics_json.btc_rolling_correlation_90d", () => {
    expect(metrics).toContain('metrics_json["btc_rolling_correlation_90d"]');
  });
});
