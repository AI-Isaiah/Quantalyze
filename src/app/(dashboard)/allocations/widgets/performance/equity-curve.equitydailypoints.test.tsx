import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { WidgetProps } from "../../lib/types";
import type { DailyPoint } from "@/lib/portfolio-math-utils";

import EquityCurve from "./EquityCurve";
import DrawdownChart from "./DrawdownChart";

/**
 * Phase 07 / 07-03 — parallel-prop test coverage for the f7 equityDailyPoints
 * prop on EquityCurve and DrawdownChart.
 *
 * Spec (per VOICES-ACCEPTED f7):
 *   - When equityDailyPoints is PRESENT (including empty array [] — an
 *     explicit override), the widget renders from that prop and does NOT
 *     fall back to the strategies-derived compute.
 *   - When equityDailyPoints is ABSENT (undefined), the widget falls back
 *     to the existing buildCompositeReturns / computeCompositeCurve path.
 *
 * The test strategy is to:
 *   (a) feed a mismatched strategies[] + equityDailyPoints so the output
 *       is distinguishable (snapshot-derived path uses ascending value
 *       markers; strategies path produces a different curve);
 *   (b) inspect the rendered SVG data or empty-state text to distinguish
 *       the two paths without coupling to exact chart pixels.
 */

function makeDailyReturns(n: number, startDate = "2023-01-01") {
  const pts: Array<{ date: string; value: number }> = [];
  const d = new Date(startDate + "T00:00:00Z");
  for (let i = 0; i < n; i++) {
    const dateStr = d.toISOString().slice(0, 10);
    const value = Math.sin(i * 0.7) * 0.02;
    pts.push({ date: dateStr, value });
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return pts;
}

const STRATEGIES_DATA: WidgetProps["data"] = {
  strategies: [
    {
      strategy_id: "s-1",
      weight: 1.0,
      strategy: {
        name: "Alpha Strategy",
        strategy_analytics: {
          daily_returns: makeDailyReturns(60),
        },
      },
    },
  ],
  portfolio: { created_at: "2023-01-01T00:00:00Z" },
  analytics: null,
};

const EMPTY_DATA: WidgetProps["data"] = {
  strategies: [],
  portfolio: null,
  analytics: null,
};

// 30 ascending snapshot-derived DailyPoints — distinguishable from the
// sinusoidal strategies-derived curve by visual inspection of the path.
const SNAPSHOT_POINTS: DailyPoint[] = Array.from({ length: 30 }, (_, i) => ({
  date: new Date(Date.UTC(2026, 2, i + 1)).toISOString().slice(0, 10),
  value: 1 + i * 0.01,
}));

const baseProps: Omit<WidgetProps, "data"> = {
  timeframe: "all",
  width: 6,
  height: 4,
};

describe("EquityCurve — equityDailyPoints parallel-prop (f7)", () => {
  it("(a) when equityDailyPoints is provided, the widget renders a chart (snapshot-derived path)", () => {
    const { container } = render(
      <EquityCurve
        {...baseProps}
        data={EMPTY_DATA}
        equityDailyPoints={SNAPSHOT_POINTS}
      />,
    );
    // Snapshot-derived path MUST render even when strategies is empty.
    // With strategies empty + no prop, the existing baseline renders the
    // "No equity curve data available" text (per performance.test.tsx).
    // When equityDailyPoints is provided, we expect an SVG instead.
    expect(container.querySelector("svg")).toBeTruthy();
  });

  it("(b) when equityDailyPoints is absent (undefined), widget falls back to strategies-derived compute", () => {
    const { container } = render(
      <EquityCurve {...baseProps} data={STRATEGIES_DATA} />,
    );
    // Strategies-derived path renders the SVG (confirms fallback works).
    expect(container.querySelector("svg")).toBeTruthy();
  });

  it("(c) when equityDailyPoints === [], widget renders empty chart instead of falling back to strategies", () => {
    const { queryByText } = render(
      <EquityCurve
        {...baseProps}
        data={STRATEGIES_DATA}
        equityDailyPoints={[]}
      />,
    );
    // Explicit empty override: even though STRATEGIES_DATA has content,
    // the widget MUST honour the empty prop and not render the
    // strategies-derived curve. The empty-message copy is the signal.
    expect(queryByText(/no equity curve/i)).not.toBeNull();
  });
});

describe("DrawdownChart — equityDailyPoints parallel-prop (f7)", () => {
  it("(a) when equityDailyPoints is provided, widget renders (snapshot-derived path)", () => {
    const { queryByText } = render(
      <DrawdownChart
        {...baseProps}
        data={EMPTY_DATA}
        equityDailyPoints={SNAPSHOT_POINTS}
      />,
    );
    // Empty strategies + no prop would render "No drawdown data available";
    // with the prop, the path is populated and the empty text is absent.
    expect(queryByText(/no drawdown data/i)).toBeNull();
  });

  it("(b) when equityDailyPoints is absent, widget falls back to strategies-derived compute", () => {
    const { queryByText } = render(
      <DrawdownChart {...baseProps} data={STRATEGIES_DATA} />,
    );
    expect(queryByText(/no drawdown data/i)).toBeNull();
  });

  it("(c) when equityDailyPoints === [], widget renders empty state instead of falling back to strategies", () => {
    const { queryByText } = render(
      <DrawdownChart
        {...baseProps}
        data={STRATEGIES_DATA}
        equityDailyPoints={[]}
      />,
    );
    expect(queryByText(/no drawdown data/i)).not.toBeNull();
  });
});
