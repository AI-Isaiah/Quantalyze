import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

// F9 M-0189 — OutcomesWidget retry now calls useRouter().refresh() (soft
// re-fetch) instead of window.location.reload(). Provide a router stub.
vi.mock("next/navigation", () => ({
  useRouter: () => ({
    refresh: vi.fn(),
    push: vi.fn(),
    replace: vi.fn(),
    prefetch: vi.fn(),
    back: vi.fn(),
    forward: vi.fn(),
  }),
}));

/**
 * Phase 11 / UI-BLOCK-01 — Regression test asserting that
 * OutcomesWidget routes its render through the shared <WidgetState>
 * primitive in two of its 4 real branches when the `widget_state_v2`
 * feature flag is ON:
 *   - error  → mode="error" with onRetry callback (window.location.reload)
 *   - populated → mode="success" passthrough
 *
 * Loading + empty branches are intentionally NOT wired:
 *   - loading: the rich 3-cell + 5-row LoadingState skeleton is more
 *     informative than the primitive's generic 2-line skeleton.
 *   - empty: WidgetHeader sits ABOVE the empty body and can't be
 *     surfaced inside the primitive's centered Card without
 *     manufacturing wrapper structure.
 *
 * RED before the wiring (no WidgetState invocation), GREEN after.
 */

// Recharts ResponsiveContainer needs a layout shim for jsdom.
vi.mock("recharts", async () => {
  const actual = await vi.importActual<typeof import("recharts")>("recharts");
  return {
    ...actual,
    ResponsiveContainer: ({ children }: { children: React.ReactNode }) => (
      <div style={{ width: 200, height: 48 }}>{children}</div>
    ),
  };
});

// Mock WidgetState BEFORE importing the widget so the spy intercepts.
const widgetStateSpy = vi.fn();
vi.mock("../../components/WidgetState", () => ({
  WidgetState: (props: {
    mode: string;
    children?: React.ReactNode;
    error?: { message: string; onRetry?: () => void };
  }) => {
    widgetStateSpy(props.mode, props.error?.message);
    // Render minimal stand-in so downstream assertions (e.g. error
    // message text) still resolve.
    if (props.mode === "error") {
      return (
        <div role="alert" aria-live="polite" data-mock-widget-state="error">
          <span>{props.error?.message}</span>
          {props.error?.onRetry && (
            <button type="button" onClick={props.error.onRetry}>
              Retry
            </button>
          )}
        </div>
      );
    }
    return <>{props.children}</>;
  },
}));

import OutcomesWidget from "./OutcomesWidget";

const originalLocation = window.location;

const WIDGET_PROPS_BASE = {
  timeframe: "1YTD" as const,
  width: 1200,
  height: 300,
};

beforeEach(() => {
  widgetStateSpy.mockClear();
  Object.defineProperty(window, "location", {
    configurable: true,
    writable: true,
    value: { ...originalLocation, search: "" },
  });
});

describe("OutcomesWidget — UI-BLOCK-01 WidgetState v2 wiring", () => {
  it("flag OFF + error data: renders legacy 'Try again' button (no WidgetState)", () => {
    render(
      <OutcomesWidget
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        data={{ outcomes: undefined, __error: true } as any}
        {...WIDGET_PROPS_BASE}
      />,
    );
    expect(widgetStateSpy).not.toHaveBeenCalled();
    expect(screen.getByText("Could not load outcomes")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Try again/ }),
    ).toBeInTheDocument();
  });

  it("flag ON + error data: routes through <WidgetState mode='error'> with reload retry", () => {
    Object.defineProperty(window, "location", {
      configurable: true,
      writable: true,
      value: { ...originalLocation, search: "?widget_state=v2" },
    });
    render(
      <OutcomesWidget
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        data={{ outcomes: undefined, __error: true } as any}
        {...WIDGET_PROPS_BASE}
      />,
    );
    expect(widgetStateSpy).toHaveBeenCalledWith("error", "Could not load outcomes");
    expect(screen.getByText("Could not load outcomes")).toBeInTheDocument();
  });

  it("flag OFF + populated data: renders timeline directly (no WidgetState)", () => {
    render(
      <OutcomesWidget
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        data={{ outcomes: [] } as any}
        {...WIDGET_PROPS_BASE}
      />,
    );
    expect(widgetStateSpy).not.toHaveBeenCalled();
  });

  it("flag ON + populated data: wraps timeline in <WidgetState mode='success'>", () => {
    Object.defineProperty(window, "location", {
      configurable: true,
      writable: true,
      value: { ...originalLocation, search: "?widget_state=v2" },
    });
    const oneOutcome = [
      {
        id: "o1",
        strategy_id: "s-repl",
        match_decision_id: null,
        kind: "allocated" as const,
        percent_allocated: 12,
        allocated_at: "2026-03-01",
        rejection_reason: null,
        note: null,
        delta_30d: 0.04,
        delta_90d: null,
        delta_180d: null,
        estimated_delta_bps: null,
        estimated_days: null,
        needs_recompute: false,
        created_at: "2026-03-01T00:00:00Z",
        replacement_strategy: { id: "s-repl", name: "Repl LP" },
        match_decision: null,
      },
    ];
    render(
      <OutcomesWidget
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        data={{ outcomes: oneOutcome } as any}
        {...WIDGET_PROPS_BASE}
      />,
    );
    expect(widgetStateSpy).toHaveBeenCalledWith("success", undefined);
  });
});
