import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import BridgeHeroWidget from "./BridgeHeroWidget";

/**
 * Phase 11 / UI-BLOCK-01 — Regression test asserting that BridgeHeroWidget
 * routes its error branch through the shared <WidgetState mode="error">
 * primitive when the `widget_state_v2` feature flag is ON.
 *
 * This test fails before the wiring lands (the legacy branch renders a plain
 * <div> with no role="alert"), and passes after the wiring forwards the
 * error message through WidgetState. The flag is forced ON via the
 * `?widget_state=v2` URL override so we don't need to mutate localStorage
 * (matches the precedent in src/lib/widget-state-flag.test.ts).
 */

// next/navigation is consumed by BridgeDrawer (transitively via BridgeWidget)
// — stub so the widget can mount under jsdom without a Next router context.
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

const originalLocation = window.location;

beforeEach(() => {
  // Reset window.location.search between tests so the URL override doesn't
  // leak across cases. We restore the original Location object in the
  // top-level afterAll-equivalent (assigning back at end of suite).
  Object.defineProperty(window, "location", {
    configurable: true,
    writable: true,
    value: { ...originalLocation, search: "" },
  });
});

describe("BridgeHeroWidget — UI-BLOCK-01 WidgetState v2 wiring", () => {
  it("flag OFF (default): error branch renders the legacy plain <div> chrome (no role='alert')", () => {
    const { container } = render(
      <BridgeHeroWidget
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        data={{ __error: true } as any}
        timeframe="6M"
        width={4}
        height={3}
      />,
    );
    expect(screen.getByText("Bridge unavailable")).toBeInTheDocument();
    // Legacy chrome carries NO role="alert" — that's the BLOCK we resolve.
    expect(container.querySelector("[role='alert']")).toBeNull();
  });

  it("flag ON via ?widget_state=v2: error branch routes through <WidgetState mode='error'> (role='alert' + aria-live='polite')", () => {
    Object.defineProperty(window, "location", {
      configurable: true,
      writable: true,
      value: { ...originalLocation, search: "?widget_state=v2" },
    });
    const { container } = render(
      <BridgeHeroWidget
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        data={{ __error: true } as any}
        timeframe="6M"
        width={4}
        height={3}
      />,
    );
    expect(screen.getByText("Bridge unavailable")).toBeInTheDocument();
    const alert = container.querySelector("[role='alert']");
    expect(alert).not.toBeNull();
    expect(alert?.getAttribute("aria-live")).toBe("polite");
  });
});
