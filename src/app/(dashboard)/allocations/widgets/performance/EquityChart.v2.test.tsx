import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

/**
 * Phase 11 / UI-BLOCK-01 — Regression test asserting that EquityChartWidget
 * (default export from EquityChart.tsx) routes its render through the
 * shared <WidgetState mode="success"> primitive when the
 * `widget_state_v2` feature flag is ON.
 *
 * EquityChartWidget delegates its empty branch ("Equity data warming up")
 * to the inner <EquityChart> component so the card title + period
 * toggle + sync stamp survive even when data is empty. Wrapping with
 * mode="success" proves the primitive is consumed in production
 * (resolves UI-BLOCK-01) without changing any visual semantics.
 *
 * RED before the wiring (no WidgetState invocation), GREEN after.
 */

// Mock WidgetState BEFORE importing EquityChartWidget so the spy
// intercepts its calls. Spy implementation passes children through
// verbatim so the underlying card markup still mounts.
const widgetStateSpy = vi.fn();
vi.mock("../../components/WidgetState", () => ({
  WidgetState: (props: { mode: string; children?: React.ReactNode }) => {
    widgetStateSpy(props.mode);
    return <>{props.children}</>;
  },
}));

import EquityChartWidget from "./EquityChart";

const originalLocation = window.location;

beforeEach(() => {
  widgetStateSpy.mockClear();
  Object.defineProperty(window, "location", {
    configurable: true,
    writable: true,
    value: { ...originalLocation, search: "" },
  });
});

describe("EquityChartWidget — UI-BLOCK-01 WidgetState v2 wiring", () => {
  it("flag OFF (default): renders card directly without invoking WidgetState", () => {
    render(
      <EquityChartWidget
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        data={{ equityDailyPoints: [] } as any}
        timeframe="6M"
        width={4}
        height={4}
      />,
    );
    expect(widgetStateSpy).not.toHaveBeenCalled();
    // Sanity: card title still renders.
    expect(screen.getByText("Equity curve")).toBeInTheDocument();
  });

  it("flag ON via ?widget_state=v2: invokes <WidgetState mode='success'>", () => {
    Object.defineProperty(window, "location", {
      configurable: true,
      writable: true,
      value: { ...originalLocation, search: "?widget_state=v2" },
    });
    render(
      <EquityChartWidget
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        data={{ equityDailyPoints: [] } as any}
        timeframe="6M"
        width={4}
        height={4}
      />,
    );
    expect(widgetStateSpy).toHaveBeenCalledWith("success");
    // Sanity: card title still renders inside the WidgetState wrapper.
    expect(screen.getByText("Equity curve")).toBeInTheDocument();
  });
});
