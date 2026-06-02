import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { Tooltip } from "./Tooltip";

// F9 (HIGH-tackle batch) — regression guard for the Tooltip enter-delay timer
// lifecycle. Three folded findings shared one root cause: `show()` queued a
// 150ms setTimeout into `timerRef` without (a) clearing a prior pending timer
// (M-0898 — orphaned timer fires an extra setOpen on an already-open tooltip)
// and (b) a cleanup that cancels the timer on unmount (M-0899 / L-0044 —
// post-unmount setState + timer leak when the parent unmounts mid-hover).
describe("Tooltip enter-delay timer lifecycle", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
  });

  it("opens after the 150ms enter delay on hover", () => {
    render(
      <Tooltip content="Sharpe ratio explained">
        <button>info</button>
      </Tooltip>,
    );
    fireEvent.mouseEnter(screen.getByText("info").parentElement!.parentElement!);
    // Not yet — the delay hasn't elapsed.
    expect(screen.queryByRole("tooltip")).toBeNull();
    act(() => {
      vi.advanceTimersByTime(150);
    });
    expect(screen.getByRole("tooltip").textContent).toBe(
      "Sharpe ratio explained",
    );
  });

  it("M-0898: a second show() before the delay elapses clears the first timer (no orphan)", () => {
    const clearSpy = vi.spyOn(globalThis, "clearTimeout");
    render(
      <Tooltip content="hi">
        <button>info</button>
      </Tooltip>,
    );
    const wrapper = screen.getByText("info").parentElement!.parentElement!;
    // focus-then-hover: two show() calls inside the 150ms window. The second
    // MUST clear the first pending timer, leaving exactly one live timer.
    fireEvent.focus(wrapper);
    fireEvent.mouseEnter(wrapper);
    expect(clearSpy).toHaveBeenCalled();
    clearSpy.mockRestore();
  });

  it("M-0899 / L-0044: cancels the pending enter timer on unmount", () => {
    const clearSpy = vi.spyOn(globalThis, "clearTimeout");
    const { unmount } = render(
      <Tooltip content="hi">
        <button>info</button>
      </Tooltip>,
    );
    fireEvent.mouseEnter(
      screen.getByText("info").parentElement!.parentElement!,
    );
    // Unmount while the 150ms timer is still pending.
    unmount();
    expect(clearSpy).toHaveBeenCalled();
    // Advancing past the delay must NOT throw or warn — the timer was cancelled,
    // so the delayed setOpen never runs against the unmounted component.
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(errSpy).not.toHaveBeenCalled();
    errSpy.mockRestore();
    clearSpy.mockRestore();
  });
});
