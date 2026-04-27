import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

/**
 * Phase 11 / UI-BLOCK-01 — Regression test asserting that
 * MandateSnapshotWidget routes its render through the shared
 * <WidgetState mode="success"> primitive when the `widget_state_v2`
 * feature flag is ON.
 *
 * The widget's empty branch is a sub-copy swap inside the existing
 * card chrome ("No mandate set yet" vs "Auto-saved · N/M gates pass");
 * the 5 gate rows render verbatim in either case (em-dashed when no
 * data). mode="success" passthrough proves the primitive is consumed
 * in production (resolves UI-BLOCK-01) without changing visual
 * semantics.
 *
 * RED before the wiring (no WidgetState invocation), GREEN after.
 */

// Mock WidgetState BEFORE importing the widget so the spy intercepts.
const widgetStateSpy = vi.fn();
vi.mock("../../components/WidgetState", () => ({
  WidgetState: (props: { mode: string; children?: React.ReactNode }) => {
    widgetStateSpy(props.mode);
    return <>{props.children}</>;
  },
}));

import { MandateSnapshotWidget } from "./MandateSnapshotWidget";

const originalLocation = window.location;

beforeEach(() => {
  widgetStateSpy.mockClear();
  Object.defineProperty(window, "location", {
    configurable: true,
    writable: true,
    value: { ...originalLocation, search: "" },
  });
});

describe("MandateSnapshotWidget — UI-BLOCK-01 WidgetState v2 wiring", () => {
  it("flag OFF (default): renders card directly without invoking WidgetState", () => {
    render(
      <MandateSnapshotWidget
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        data={{ mandate: null } as any}
        timeframe="YTD"
        width={2}
        height={3}
      />,
    );
    expect(widgetStateSpy).not.toHaveBeenCalled();
    // Sanity: card heading still renders.
    expect(
      screen.getByRole("heading", { name: "Mandate", level: 3 }),
    ).toBeInTheDocument();
    expect(screen.getByText("No mandate set yet")).toBeInTheDocument();
  });

  it("flag ON via ?widget_state=v2: invokes <WidgetState mode='success'>", () => {
    Object.defineProperty(window, "location", {
      configurable: true,
      writable: true,
      value: { ...originalLocation, search: "?widget_state=v2" },
    });
    render(
      <MandateSnapshotWidget
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        data={{ mandate: null } as any}
        timeframe="YTD"
        width={2}
        height={3}
      />,
    );
    expect(widgetStateSpy).toHaveBeenCalledWith("success");
    // Sanity: card heading still renders inside the wrapper.
    expect(
      screen.getByRole("heading", { name: "Mandate", level: 3 }),
    ).toBeInTheDocument();
  });
});
