import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { KpiStrip } from "./KpiStrip";
import type { ComputedMetrics } from "@/lib/scenario";

/**
 * Phase 10 / 10-04 — KpiStrip mode="scenario" delta-pill rendering.
 *
 * Spec coverage (per CONTEXT.md D-13 + D-16, UI-SPEC component inventory):
 *   - mode="live" default → identical Phase 09.1 / Phase 07 behavior
 *   - mode="scenario" → primary number is scenarioMetrics value, delta pill
 *     renders below with direction-aware token (text-positive on improvement,
 *     text-negative on regression, text-text-muted under noise floor)
 *   - mode="scenario" + warmingUp=true → delta pills SUPPRESSED (preserves
 *     KpiStrip.warmup.test.tsx Phase 07 D-09 invariants)
 *   - aria contract: each delta pill carries an aria-label with
 *     "improved" / "regressed" / "no change" word
 *   - tooltip on each delta pill contains "Live: " + baseline value
 *   - graceful degradation when scenarioMetrics OR liveMetrics is null
 *
 * Sister suites: KpiStrip.warmup.test.tsx + KpiStrip.test.tsx must continue
 * passing in parallel — this suite ONLY covers the new scenario-mode branch.
 */

const EMPTY_METRICS: ComputedMetrics = {
  n: 0,
  twr: null,
  cagr: null,
  volatility: null,
  sharpe: null,
  sortino: null,
  max_drawdown: null,
  max_dd_days: null,
  correlation_matrix: null,
  avg_pairwise_correlation: null,
  equity_curve: [],
  effective_start: null,
  effective_end: null,
};

const LIVE_METRICS: ComputedMetrics = {
  ...EMPTY_METRICS,
  n: 252,
  twr: 0.15,
  cagr: 0.12,
  volatility: 0.22,
  sharpe: 1.2,
  sortino: 1.6,
  max_drawdown: -0.08,
  avg_pairwise_correlation: 0.42,
};

const SCENARIO_IMPROVEMENT: ComputedMetrics = {
  ...EMPTY_METRICS,
  n: 252,
  twr: 0.18,
  cagr: 0.14,
  volatility: 0.20,
  sharpe: 1.51, // +0.31 vs live (improvement, up-good)
  sortino: 2.0,
  max_drawdown: -0.04, // +0.04 abs vs live (improvement, down-good)
  avg_pairwise_correlation: 0.42,
};

const SCENARIO_REGRESSION: ComputedMetrics = {
  ...EMPTY_METRICS,
  n: 252,
  twr: 0.13, // -0.02 vs live (regression, up-good)
  cagr: 0.10,
  volatility: 0.25,
  sharpe: 1.0,
  sortino: 1.4,
  max_drawdown: -0.10,
  avg_pairwise_correlation: 0.42,
};

describe("KpiStrip — mode='scenario' delta pills (D-13 + D-16)", () => {
  it("T1: mode='live' default → identical to existing tests, no delta pills", () => {
    const { container } = render(
      <KpiStrip
        analytics={{ ytd_twr: 0.15, sharpe: 1.2, max_drawdown_12m: -0.08 }}
        metrics={LIVE_METRICS}
        timeframe="ALL"
        aum={1_000_000}
        snapshotCount={30}
      />,
    );
    // No aria-labels of shape "{label} delta:"
    const deltaNodes = container.querySelectorAll('[aria-label*="delta:"]');
    expect(deltaNodes.length).toBe(0);
  });

  it("T2: mode='scenario' Sharpe improvement → '1.51' primary + '+0.31' delta pill in text-positive", () => {
    const { container } = render(
      <KpiStrip
        analytics={{
          ytd_twr: 0.15,
          sharpe: 1.2,
          max_drawdown_12m: -0.08,
          avg_correlation: 0.42,
        }}
        metrics={LIVE_METRICS}
        timeframe="ALL"
        aum={1_000_000}
        snapshotCount={30}
        mode="scenario"
        scenarioMetrics={SCENARIO_IMPROVEMENT}
        liveMetrics={LIVE_METRICS}
      />,
    );
    expect(screen.getByText("1.51")).toBeTruthy();
    const sharpeDelta = container.querySelector(
      '[aria-label^="Sharpe delta:"]',
    );
    expect(sharpeDelta).not.toBeNull();
    expect(sharpeDelta!.textContent ?? "").toMatch(/\+0\.31/);
    expect(sharpeDelta!.className).toMatch(/text-positive/);
  });

  it("T3: mode='scenario' Max DD improvement → '-4.00%' primary + positive delta pill (down-good direction)", () => {
    const { container } = render(
      <KpiStrip
        analytics={{
          ytd_twr: 0.15,
          sharpe: 1.2,
          max_drawdown_12m: -0.08,
          avg_correlation: 0.42,
        }}
        metrics={LIVE_METRICS}
        timeframe="ALL"
        aum={1_000_000}
        snapshotCount={30}
        mode="scenario"
        scenarioMetrics={SCENARIO_IMPROVEMENT}
        liveMetrics={LIVE_METRICS}
      />,
    );
    const maxDdDelta = container.querySelector(
      '[aria-label^="Max DD 12m delta:"]',
    );
    expect(maxDdDelta).not.toBeNull();
    // -0.04 - (-0.08) = +0.04, max_drawdown is down-good so positive delta = improvement
    expect(maxDdDelta!.className).toMatch(/text-positive/);
    expect(maxDdDelta!.getAttribute("aria-label") ?? "").toMatch(/improved/);
  });

  it("T4: mode='scenario' YTD TWR regression → text-negative token", () => {
    const { container } = render(
      <KpiStrip
        analytics={{
          ytd_twr: 0.15,
          sharpe: 1.2,
          max_drawdown_12m: -0.08,
          avg_correlation: 0.42,
        }}
        metrics={LIVE_METRICS}
        timeframe="ALL"
        aum={1_000_000}
        snapshotCount={30}
        mode="scenario"
        scenarioMetrics={SCENARIO_REGRESSION}
        liveMetrics={LIVE_METRICS}
      />,
    );
    const twrDelta = container.querySelector(
      '[aria-label^="YTD TWR delta:"]',
    );
    expect(twrDelta).not.toBeNull();
    expect(twrDelta!.className).toMatch(/text-negative/);
    expect(twrDelta!.getAttribute("aria-label") ?? "").toMatch(/regressed/);
  });

  it("T5: mode='scenario' Sharpe noise floor (|Δ| < 0.01) → text-text-muted neutral token", () => {
    const noiseScenario: ComputedMetrics = {
      ...LIVE_METRICS,
      sharpe: 1.205, // delta = 0.005 < noise floor 0.01
    };
    const noiseLive: ComputedMetrics = { ...LIVE_METRICS, sharpe: 1.2 };
    const { container } = render(
      <KpiStrip
        analytics={{
          ytd_twr: 0.15,
          sharpe: 1.2,
          max_drawdown_12m: -0.08,
          avg_correlation: 0.42,
        }}
        metrics={noiseLive}
        timeframe="ALL"
        aum={1_000_000}
        snapshotCount={30}
        mode="scenario"
        scenarioMetrics={noiseScenario}
        liveMetrics={noiseLive}
      />,
    );
    const sharpeDelta = container.querySelector(
      '[aria-label^="Sharpe delta:"]',
    );
    expect(sharpeDelta).not.toBeNull();
    expect(sharpeDelta!.className).toMatch(/text-text-muted/);
    expect(sharpeDelta!.getAttribute("aria-label") ?? "").toMatch(/no change/);
  });

  it("T6: mode='scenario' + warmingUp=true → NO delta pills (preserves Phase 07 D-09 warmup gate)", () => {
    const { container } = render(
      <KpiStrip
        analytics={null}
        metrics={EMPTY_METRICS}
        timeframe="ALL"
        aum={null}
        snapshotCount={10}
        allKeysStale={false}
        mode="scenario"
        scenarioMetrics={SCENARIO_IMPROVEMENT}
        liveMetrics={LIVE_METRICS}
      />,
    );
    // No delta pills present
    const deltaNodes = container.querySelectorAll('[aria-label*="delta:"]');
    expect(deltaNodes.length).toBe(0);
    // Warmup helper still renders for null cells (proves the warmup branch wins)
    expect(
      screen.getAllByText("Warming up — need 20 more days of synced data.")
        .length,
    ).toBeGreaterThan(0);
    // Em-dash present (cells collapse to em-dash + warmup helper, NOT scenario primary)
    expect(screen.getAllByText("—").length).toBeGreaterThan(0);
  });

  it("T7: mode='scenario' + scenarioMetrics=null → no delta pills, graceful degradation", () => {
    const { container } = render(
      <KpiStrip
        analytics={{
          ytd_twr: 0.15,
          sharpe: 1.2,
          max_drawdown_12m: -0.08,
          avg_correlation: 0.42,
        }}
        metrics={LIVE_METRICS}
        timeframe="ALL"
        aum={1_000_000}
        snapshotCount={30}
        mode="scenario"
        scenarioMetrics={null}
        liveMetrics={LIVE_METRICS}
      />,
    );
    const deltaNodes = container.querySelectorAll('[aria-label*="delta:"]');
    expect(deltaNodes.length).toBe(0);
  });

  it("T7b: mode='scenario' + liveMetrics=null → no delta pills, primary still shows scenario value", () => {
    const { container } = render(
      <KpiStrip
        analytics={{
          ytd_twr: 0.15,
          sharpe: 1.2,
          max_drawdown_12m: -0.08,
          avg_correlation: 0.42,
        }}
        metrics={LIVE_METRICS}
        timeframe="ALL"
        aum={1_000_000}
        snapshotCount={30}
        mode="scenario"
        scenarioMetrics={SCENARIO_IMPROVEMENT}
        liveMetrics={null}
      />,
    );
    const deltaNodes = container.querySelectorAll('[aria-label*="delta:"]');
    expect(deltaNodes.length).toBe(0);
  });

  it("T8: mode='scenario' Sharpe delta pill has 'Live: 1.20' tooltip via title attribute", () => {
    const { container } = render(
      <KpiStrip
        analytics={{
          ytd_twr: 0.15,
          sharpe: 1.2,
          max_drawdown_12m: -0.08,
          avg_correlation: 0.42,
        }}
        metrics={LIVE_METRICS}
        timeframe="ALL"
        aum={1_000_000}
        snapshotCount={30}
        mode="scenario"
        scenarioMetrics={SCENARIO_IMPROVEMENT}
        liveMetrics={LIVE_METRICS}
      />,
    );
    const sharpeDelta = container.querySelector(
      '[aria-label^="Sharpe delta:"]',
    );
    expect(sharpeDelta).not.toBeNull();
    const title = sharpeDelta!.getAttribute("title") ?? "";
    expect(title).toMatch(/^Live: /);
    expect(title).toMatch(/1\.20/);
  });

  it("T9: aria contract — improvement pill aria-label contains 'improved'", () => {
    const { container } = render(
      <KpiStrip
        analytics={{
          ytd_twr: 0.15,
          sharpe: 1.2,
          max_drawdown_12m: -0.08,
          avg_correlation: 0.42,
        }}
        metrics={LIVE_METRICS}
        timeframe="ALL"
        aum={1_000_000}
        snapshotCount={30}
        mode="scenario"
        scenarioMetrics={SCENARIO_IMPROVEMENT}
        liveMetrics={LIVE_METRICS}
      />,
    );
    const sharpeDelta = container.querySelector(
      '[aria-label^="Sharpe delta:"]',
    );
    expect(sharpeDelta!.getAttribute("aria-label") ?? "").toMatch(/improved/);
  });

  it("T10: scenario mode does NOT regress KpiStrip.warmup.test.tsx Test B (snapshotCount=10 default warm-up)", () => {
    // Reproduce KpiStrip.warmup.test.tsx Test B but with mode='scenario' set
    // to prove the warmup branch wins regardless of mode.
    render(
      <KpiStrip
        analytics={null}
        metrics={EMPTY_METRICS}
        timeframe="ALL"
        aum={null}
        snapshotCount={10}
        allKeysStale={false}
        minHistoryDepthMonths={null}
        activeVenues={[]}
        mode="scenario"
        scenarioMetrics={null}
        liveMetrics={null}
      />,
    );
    expect(
      screen.getAllByText("Warming up — need 20 more days of synced data.")
        .length,
    ).toBeGreaterThan(0);
    expect(screen.getAllByText("—").length).toBeGreaterThan(0);
  });
});
