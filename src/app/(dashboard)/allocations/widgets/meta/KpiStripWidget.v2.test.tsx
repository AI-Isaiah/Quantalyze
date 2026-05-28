import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { KpiStripWidget } from "./KpiStripWidget";

/**
 * Phase 11 / UI-BLOCK-01 — Regression test asserting that KpiStripWidget
 * routes its render through the shared <WidgetState mode="success">
 * primitive when the `widget_state_v2` feature flag is ON.
 *
 * KpiStripWidget has no explicit empty/error branches — it renders 5
 * cells with em-dashes for missing values regardless. So the wiring is
 * a `mode="success"` passthrough that proves the primitive is consumed
 * in production (resolves UI-BLOCK-01 "WidgetState has zero production
 * consumers"). The test asserts WidgetState is called with mode="success"
 * by mocking the primitive module.
 *
 * RED before the wiring (no WidgetState invocation), GREEN after.
 */

// Mock WidgetState BEFORE importing KpiStripWidget so the spy intercepts
// its calls. Spy implementation passes children through verbatim so the
// downstream rendering assertions still reach the real strip body.
const widgetStateSpy = vi.fn();
vi.mock("../../components/WidgetState", () => ({
  WidgetState: (props: { mode: string; children?: React.ReactNode }) => {
    widgetStateSpy(props.mode);
    return <>{props.children}</>;
  },
}));

const originalLocation = window.location;

beforeEach(() => {
  widgetStateSpy.mockClear();
  Object.defineProperty(window, "location", {
    configurable: true,
    writable: true,
    value: { ...originalLocation, search: "" },
  });
});

describe("KpiStripWidget — UI-BLOCK-01 WidgetState v2 wiring", () => {
  it("flag OFF (default): renders strip directly without invoking WidgetState", () => {
    render(
      <KpiStripWidget
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        data={{} as any}
        timeframe="1YTD"
        width={4}
        height={2}
      />,
    );
    expect(widgetStateSpy).not.toHaveBeenCalled();
    // Sanity: strip body still renders.
    expect(screen.getByText("AUM")).toBeInTheDocument();
  });

  it("flag ON via ?widget_state=v2: invokes <WidgetState mode='success'>", () => {
    Object.defineProperty(window, "location", {
      configurable: true,
      writable: true,
      value: { ...originalLocation, search: "?widget_state=v2" },
    });
    render(
      <KpiStripWidget
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        data={{} as any}
        timeframe="1YTD"
        width={4}
        height={2}
      />,
    );
    expect(widgetStateSpy).toHaveBeenCalledWith("success");
    // Sanity: strip body still renders inside the WidgetState wrapper.
    expect(screen.getByText("AUM")).toBeInTheDocument();
    expect(screen.getByText("YTD TWR")).toBeInTheDocument();
  });
});
