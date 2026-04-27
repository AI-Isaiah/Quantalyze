import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

/**
 * Phase 11 / UI-BLOCK-01 — Regression test asserting that
 * HoldingsTableWidget routes its render through the shared
 * <WidgetState mode="success"> primitive when the `widget_state_v2`
 * feature flag is ON.
 *
 * HoldingsTableWidget is a thin adapter; <HoldingsTable> owns its own
 * empty branch internally so the wrapper has no discrete state
 * branches to wire. mode="success" passthrough proves the primitive
 * is consumed in production (resolves UI-BLOCK-01) without changing
 * visual semantics.
 *
 * RED before the wiring (no WidgetState invocation), GREEN after.
 */

// next/navigation is consumed by HoldingsTable's row-expand surface.
vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: vi.fn(),
    replace: vi.fn(),
    refresh: vi.fn(),
    back: vi.fn(),
    forward: vi.fn(),
    prefetch: vi.fn(),
  }),
}));

// Mock WidgetState BEFORE importing HoldingsTableWidget so the spy
// intercepts its calls. Spy passes children through verbatim.
const widgetStateSpy = vi.fn();
vi.mock("../../components/WidgetState", () => ({
  WidgetState: (props: { mode: string; children?: React.ReactNode }) => {
    widgetStateSpy(props.mode);
    return <>{props.children}</>;
  },
}));

import { HoldingsTableWidget } from "./HoldingsTableWidget";

const originalLocation = window.location;

beforeEach(() => {
  widgetStateSpy.mockClear();
  Object.defineProperty(window, "location", {
    configurable: true,
    writable: true,
    value: { ...originalLocation, search: "" },
  });
});

describe("HoldingsTableWidget — UI-BLOCK-01 WidgetState v2 wiring", () => {
  it("flag OFF (default): renders table directly without invoking WidgetState", () => {
    render(
      <HoldingsTableWidget
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        data={{} as any}
        timeframe="YTD"
        width={3}
        height={4}
      />,
    );
    expect(widgetStateSpy).not.toHaveBeenCalled();
    // Sanity: the empty-state copy from HoldingsTable still renders.
    expect(screen.getByText("No holdings to display.")).toBeInTheDocument();
  });

  it("flag ON via ?widget_state=v2: invokes <WidgetState mode='success'>", () => {
    Object.defineProperty(window, "location", {
      configurable: true,
      writable: true,
      value: { ...originalLocation, search: "?widget_state=v2" },
    });
    render(
      <HoldingsTableWidget
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        data={{} as any}
        timeframe="YTD"
        width={3}
        height={4}
      />,
    );
    expect(widgetStateSpy).toHaveBeenCalledWith("success");
    // Sanity: the empty-state copy still renders inside the wrapper.
    expect(screen.getByText("No holdings to display.")).toBeInTheDocument();
  });
});
