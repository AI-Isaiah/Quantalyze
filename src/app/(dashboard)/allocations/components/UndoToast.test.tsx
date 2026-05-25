import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { UndoToast } from "./UndoToast";

/**
 * M-0116 — UndoToast 10s auto-dismiss timer + clearTimeout-on-Undo +
 * clearTimeout-on-unmount were untested. These are exactly the timer-leak
 * regressions only a fake-timer test catches:
 *   (a) onDismiss fires once, after 10_000ms (not earlier, not twice)
 *   (b) clicking Undo fires onUndo AND clears the pending timer so a later
 *       advance past 10s does NOT also fire onDismiss
 *   (c) unmount clears the pending timer (no late onDismiss after unmount)
 */

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("UndoToast (M-0116)", () => {
  it("renders the widget name + Undo affordance with alert semantics", () => {
    render(
      <UndoToast widgetName="Equity Curve" onUndo={vi.fn()} onDismiss={vi.fn()} />,
    );
    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(screen.getByText("Equity Curve")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Undo" })).toBeInTheDocument();
  });

  it("(a) fires onDismiss exactly once after 10_000ms — not before", () => {
    const onDismiss = vi.fn();
    render(
      <UndoToast widgetName="W" onUndo={vi.fn()} onDismiss={onDismiss} />,
    );
    // Just before the deadline: not yet fired.
    act(() => {
      vi.advanceTimersByTime(9_999);
    });
    expect(onDismiss).not.toHaveBeenCalled();
    // Cross the deadline: fires exactly once.
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(onDismiss).toHaveBeenCalledTimes(1);
    // Advancing further does not re-fire.
    act(() => {
      vi.advanceTimersByTime(20_000);
    });
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it("(b) clicking Undo fires onUndo and clears the timer — onDismiss never fires", () => {
    const onUndo = vi.fn();
    const onDismiss = vi.fn();
    render(
      <UndoToast widgetName="W" onUndo={onUndo} onDismiss={onDismiss} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    expect(onUndo).toHaveBeenCalledTimes(1);
    // The 10s timer was cleared on Undo, so advancing well past it must NOT
    // fire onDismiss (the leak this test guards against).
    act(() => {
      vi.advanceTimersByTime(11_000);
    });
    expect(onDismiss).not.toHaveBeenCalled();
  });

  it("(c) unmounting before the deadline clears the timer — no late onDismiss", () => {
    const onDismiss = vi.fn();
    const { unmount } = render(
      <UndoToast widgetName="W" onUndo={vi.fn()} onDismiss={onDismiss} />,
    );
    unmount();
    act(() => {
      vi.advanceTimersByTime(11_000);
    });
    expect(onDismiss).not.toHaveBeenCalled();
  });
});
