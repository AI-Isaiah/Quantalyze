import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { WidgetChrome } from "./WidgetChrome";

/**
 * M-0117 — WidgetChrome shipped (S13a) without a dedicated test. The
 * grid-level a11y traversal (Home/End across handles) is exercised via
 * WidgetGrid.test.tsx, but WidgetChrome's OWN contract — SizeStepper wiring,
 * the always-present overflow menu, the remove button, drag-mode toggle, and
 * the polite aria-live announcements (D-04 / Phase A4) — had no direct
 * coverage. These cases pin that contract in isolation.
 */

function makeProps(overrides: Partial<Parameters<typeof WidgetChrome>[0]> = {}) {
  return {
    k: "kpi-strip",
    w: 2 as 1 | 2 | 3 | 4,
    onResize: vi.fn(),
    onRemove: vi.fn(),
    onMove: vi.fn(),
    ...overrides,
  };
}

describe("WidgetChrome (M-0117)", () => {
  it("renders the SizeStepper reflecting the current width `w`", () => {
    render(<WidgetChrome {...makeProps({ w: 3 })} />);
    // The SizeStepper marks the current width pressed.
    expect(
      screen.getByRole("button", { name: "Width 3 of 4" }),
    ).toHaveAttribute("aria-pressed", "true");
  });

  it("clicking a SizeStepper width fires onResize(k, w) and announces the resize", () => {
    const onResize = vi.fn();
    render(<WidgetChrome {...makeProps({ k: "equity-curve", onResize })} />);
    fireEvent.click(screen.getByRole("button", { name: "Width 4 of 4" }));
    expect(onResize).toHaveBeenCalledWith("equity-curve", 4);
    // aria-live region carries the announcement.
    expect(
      screen.getByTestId("widget-chrome-live-equity-curve").textContent,
    ).toMatch(/Resized equity-curve to width 4/);
  });

  it("the remove (×) button fires onRemove(k)", () => {
    const onRemove = vi.fn();
    render(<WidgetChrome {...makeProps({ k: "drawdown", onRemove })} />);
    fireEvent.click(
      screen.getByRole("button", { name: "Remove drawdown widget" }),
    );
    expect(onRemove).toHaveBeenCalledWith("drawdown");
  });

  it("the overflow menu is always present and opens a role=menu with 3 menuitems", () => {
    render(<WidgetChrome {...makeProps()} />);
    const overflow = screen.getByRole("button", { name: "Widget options" });
    expect(overflow).toHaveAttribute("aria-expanded", "false");
    // Closed → no menu.
    expect(screen.queryByRole("menu")).toBeNull();
    fireEvent.click(overflow);
    expect(overflow).toHaveAttribute("aria-expanded", "true");
    const menu = screen.getByRole("menu", { name: "Widget actions" });
    const items = within(menu).getAllByRole("menuitem");
    expect(items.map((i) => i.textContent)).toEqual([
      "Move up",
      "Move down",
      "Remove",
    ]);
  });

  it("overflow 'Move up' fires onMove(k,'prev') and closes the menu", () => {
    const onMove = vi.fn();
    render(<WidgetChrome {...makeProps({ k: "kpi-strip", onMove })} />);
    fireEvent.click(screen.getByRole("button", { name: "Widget options" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Move up" }));
    expect(onMove).toHaveBeenCalledWith("kpi-strip", "prev");
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("overflow 'Remove' fires onRemove(k) and closes the menu", () => {
    const onRemove = vi.fn();
    render(<WidgetChrome {...makeProps({ k: "kpi-strip", onRemove })} />);
    fireEvent.click(screen.getByRole("button", { name: "Widget options" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Remove" }));
    expect(onRemove).toHaveBeenCalledWith("kpi-strip");
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("Enter on the drag handle toggles keyboard-reorder mode (aria-pressed) and announces it", () => {
    render(<WidgetChrome {...makeProps({ k: "kpi-strip" })} />);
    const handle = screen.getByRole("button", { name: "Reorder widget" });
    expect(handle).toHaveAttribute("aria-pressed", "false");
    fireEvent.keyDown(handle, { key: "Enter" });
    expect(handle).toHaveAttribute("aria-pressed", "true");
    expect(
      screen.getByTestId("widget-chrome-live-kpi-strip").textContent,
    ).toMatch(/Reorder mode active for kpi-strip/);
    // Enter again exits.
    fireEvent.keyDown(handle, { key: "Enter" });
    expect(handle).toHaveAttribute("aria-pressed", "false");
  });

  it("ArrowDown inside kbdMode fires onMove(k,'next'); ArrowDown OUTSIDE kbdMode is a no-op", () => {
    const onMove = vi.fn();
    render(<WidgetChrome {...makeProps({ k: "kpi-strip", onMove })} />);
    const handle = screen.getByRole("button", { name: "Reorder widget" });
    // Outside kbdMode → ignored.
    fireEvent.keyDown(handle, { key: "ArrowDown" });
    expect(onMove).not.toHaveBeenCalled();
    // Enter kbdMode, then ArrowDown → move.
    fireEvent.keyDown(handle, { key: "Enter" });
    fireEvent.keyDown(handle, { key: "ArrowDown" });
    expect(onMove).toHaveBeenCalledWith("kpi-strip", "next");
  });

  it("Escape exits keyboard-reorder mode", () => {
    render(<WidgetChrome {...makeProps({ k: "kpi-strip" })} />);
    const handle = screen.getByRole("button", { name: "Reorder widget" });
    fireEvent.keyDown(handle, { key: "Enter" });
    expect(handle).toHaveAttribute("aria-pressed", "true");
    fireEvent.keyDown(handle, { key: "Escape" });
    expect(handle).toHaveAttribute("aria-pressed", "false");
    expect(
      screen.getByTestId("widget-chrome-live-kpi-strip").textContent,
    ).toMatch(/Reorder mode exited for kpi-strip/);
  });

  it("clicking outside the open overflow menu (mousedown) dismisses it", () => {
    render(
      <div>
        <span data-testid="outside">outside</span>
        <WidgetChrome {...makeProps()} />
      </div>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Widget options" }));
    expect(screen.getByRole("menu")).toBeInTheDocument();
    fireEvent.mouseDown(screen.getByTestId("outside"));
    expect(screen.queryByRole("menu")).toBeNull();
  });
});
