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

// UIFIX-01 — the tooltip must render its full bubble OUTSIDE any overflow/scroll
// clip, stay on-screen near a viewport edge, and clear an open Dialog/drawer
// (z-[200] body-portaled overlay). These tests pin the portaled, fixed-position
// behavior; each fails by ASSERTION on the current absolute/z-50/in-tree bubble.
describe("UIFIX-01: portaled positioning", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
  });

  // Open the tooltip by hovering the wrapper and elapsing the 150ms enter delay.
  const openVia = (wrapper: HTMLElement) => {
    fireEvent.mouseEnter(wrapper);
    act(() => {
      vi.advanceTimersByTime(150);
    });
  };

  it("Test 1: portals the bubble to document.body, escaping an overflow clip", () => {
    render(
      <div data-testid="clip" style={{ overflow: "hidden" }} className="overflow-x-auto">
        <Tooltip content="Sharpe ratio explained">
          <button>info</button>
        </Tooltip>
      </div>,
    );
    openVia(screen.getByText("info").parentElement!.parentElement!);

    const bubble = screen.getByRole("tooltip");
    // The bubble is a direct child of document.body (portaled), not nested in the
    // clip container — so no `overflow-*` ancestor can clip it.
    expect(bubble.parentElement).toBe(document.body);
    expect(screen.getByTestId("clip").contains(bubble)).toBe(false);
  });

  it("Test 2: clamps horizontally so an edge-adjacent bubble stays on-screen", () => {
    // Near the right edge: a 16px trigger at left:1000 in a 1024px viewport. A
    // naive center (1000 + 8 - 112 = 896) would push the 224px bubble off-screen
    // (896 + 224 = 1120 > 1024); the clamp must pull it back inside.
    const rectSpy = vi
      .spyOn(Element.prototype, "getBoundingClientRect")
      .mockReturnValue({
        left: 1000,
        right: 1016,
        top: 300,
        bottom: 316,
        width: 16,
        height: 16,
        x: 1000,
        y: 300,
        toJSON: () => ({}),
      } as DOMRect);
    try {
      render(
        <Tooltip content="edge case">
          <button>info</button>
        </Tooltip>,
      );
      openVia(screen.getByText("info").parentElement!.parentElement!);

      const bubble = screen.getByRole("tooltip");
      const L = parseFloat(bubble.style.left);
      // w-56 === 224px. The full bubble must lie within [0, window.innerWidth].
      expect(L).toBeGreaterThanOrEqual(0);
      expect(L + 224).toBeLessThanOrEqual(window.innerWidth);
    } finally {
      rectSpy.mockRestore();
    }
  });

  it("Test 3: clears a z-[200] Dialog/drawer overlay (body-portaled, z-[210])", () => {
    // Trigger nested inside a stub overlay that mimics ContributionWizardOverlay /
    // ScenarioCommitDrawer stacking. A body-portaled tooltip at z-50 would render
    // BEHIND this overlay; z-[210] > z-[200] is what lifts it above.
    render(
      <div data-testid="overlay" className="fixed inset-0 z-[200]">
        <Tooltip content="inside a drawer">
          <button>info</button>
        </Tooltip>
      </div>,
    );
    openVia(screen.getByText("info").parentElement!.parentElement!);

    const bubble = screen.getByRole("tooltip");
    // (a) portaled out of the overlay subtree, under document.body
    expect(bubble.parentElement).toBe(document.body);
    expect(screen.getByTestId("overlay").contains(bubble)).toBe(false);
    // (b) stacks above the z-[200] overlay
    expect(bubble.className).toContain("z-[210]");
    expect(bubble.className).not.toContain("z-50");
  });

  it("Test 4: adds scroll/resize listeners on open, removes them on close AND unmount", () => {
    const addSpy = vi.spyOn(window, "addEventListener");
    const removeSpy = vi.spyOn(window, "removeEventListener");
    const { unmount } = render(
      <Tooltip content="hi">
        <button>info</button>
      </Tooltip>,
    );
    const wrapper = screen.getByText("info").parentElement!.parentElement!;

    // Open → reposition listeners registered.
    openVia(wrapper);
    const scrollAdd = addSpy.mock.calls.find((c) => c[0] === "scroll");
    const resizeAdd = addSpy.mock.calls.find((c) => c[0] === "resize");
    expect(scrollAdd).toBeTruthy();
    expect(resizeAdd).toBeTruthy();
    const scrollHandler = scrollAdd![1];
    const resizeHandler = resizeAdd![1];

    // Close → both removed with the SAME handler references.
    fireEvent.mouseLeave(wrapper);
    expect(
      removeSpy.mock.calls.some((c) => c[0] === "scroll" && c[1] === scrollHandler),
    ).toBe(true);
    expect(
      removeSpy.mock.calls.some((c) => c[0] === "resize" && c[1] === resizeHandler),
    ).toBe(true);

    // Re-open, then unmount → removed again (no leak).
    removeSpy.mockClear();
    addSpy.mockClear();
    openVia(wrapper);
    const scrollAdd2 = addSpy.mock.calls.find((c) => c[0] === "scroll");
    const resizeAdd2 = addSpy.mock.calls.find((c) => c[0] === "resize");
    const scrollHandler2 = scrollAdd2![1];
    const resizeHandler2 = resizeAdd2![1];
    unmount();
    expect(
      removeSpy.mock.calls.some((c) => c[0] === "scroll" && c[1] === scrollHandler2),
    ).toBe(true);
    expect(
      removeSpy.mock.calls.some((c) => c[0] === "resize" && c[1] === resizeHandler2),
    ).toBe(true);

    addSpy.mockRestore();
    removeSpy.mockRestore();
  });

  it("Test 5: preserves role=tooltip + aria-describedby wiring through the portal", () => {
    render(
      <Tooltip content="aria stays wired">
        <button>info</button>
      </Tooltip>,
    );
    const innerTrigger = screen.getByText("info").parentElement!;
    const wrapper = innerTrigger.parentElement!;
    openVia(wrapper);

    const bubble = screen.getByRole("tooltip");
    // Portaled, yet a11y-linked: the bubble lives under document.body while the
    // trigger's aria-describedby still points at its id.
    expect(bubble.parentElement).toBe(document.body);
    expect(bubble.id).toBeTruthy();
    expect(innerTrigger.getAttribute("aria-describedby")).toBe(bubble.id);

    // On close the association is removed.
    fireEvent.mouseLeave(wrapper);
    act(() => {
      vi.advanceTimersByTime(0);
    });
    expect(innerTrigger.getAttribute("aria-describedby")).toBeNull();
  });
});
