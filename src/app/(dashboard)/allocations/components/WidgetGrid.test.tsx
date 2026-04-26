import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import type { TileConfig } from "../lib/types";
import { WidgetGrid } from "./WidgetGrid";

/**
 * Phase 09.1 Plan 05 — WidgetGrid behavior tests.
 *
 * Covers the D-01 + D-04 contract:
 *   1. Renders one .widget-cell per tile.
 *   2. Each cell carries gridColumn: span {w} matching the tile's w.
 *   3. Each cell carries data-widget-id={k}.
 *   4. onDragStart + onDrop on different tiles fires onMove(fromK, toK).
 *   5. onRemove (via the chrome close button) fires onRemove(k).
 *   6. SizeStepper button fires onResize(k, w) with the clicked width.
 *   7. Self-drag is a no-op (does NOT call onMove).
 *   8. V1 keyboard reorder: Enter toggles aria-pressed; ArrowDown calls
 *      onMove(k, "next"); Esc clears aria-pressed.
 *   9. V1 overflow menu: clicking ⋯ opens a role=menu with 3 menuitem
 *      buttons; clicking "Move up" → onMove(k, "prev"); "Remove" →
 *      onRemove(k).
 *  10. V2 pointer-resize: pointerdown on .widget-resize-handle, pointermove
 *      with deltaX = +columnWidth, pointerup → onResize(k, w+1).
 *
 * Uses fireEvent (not user-event — Phase 08 Plan 03 decision: user-event
 * is not installed). renderWidget is stubbed to a marker div; the actual
 * widget body content is irrelevant to these tests.
 */

const TILES: TileConfig[] = [
  { k: "kpi-strip", w: 4 },
  { k: "equity-curve", w: 2 },
  { k: "allocation-donut", w: 1 },
];

function makeProps() {
  return {
    tiles: TILES,
    onResize: vi.fn(),
    onRemove: vi.fn(),
    onMove: vi.fn(),
    renderWidget: (k: string) => (
      <div data-testid={`body-${k}`}>body-{k}</div>
    ),
  };
}

beforeEach(() => {
  // jsdom doesn't expose IntersectionObserver — stub minimally so any
  // downstream consumer doesn't crash. WidgetGrid itself doesn't use it,
  // but the Suspense fallback or future additions might.
  if (typeof globalThis.IntersectionObserver === "undefined") {
    (globalThis as unknown as { IntersectionObserver: unknown }).IntersectionObserver =
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      };
  }
});

/** jsdom's DragEvent leaves dataTransfer undefined. Real browsers — and
 *  the Phase A5 Firefox DnD fix in WidgetGrid.tsx — always populate it.
 *  This helper hands fireEvent.dragStart a minimal stub matching the
 *  parts the production handler touches (setData + effectAllowed). */
function makeDataTransferStub() {
  const setDataCalls: Array<[string, string]> = [];
  let effectAllowed = "";
  const stub = {
    setData: (type: string, value: string) => {
      setDataCalls.push([type, value]);
    },
    get effectAllowed() {
      return effectAllowed;
    },
    set effectAllowed(value: string) {
      effectAllowed = value;
    },
    types: [] as string[],
    files: [] as File[],
    items: [] as DataTransferItem[],
  } as unknown as DataTransfer;
  return { stub, setDataCalls, getEffectAllowed: () => effectAllowed };
}

describe("WidgetGrid", () => {
  it("renders one .widget-cell per tile", () => {
    const props = makeProps();
    const { container } = render(<WidgetGrid {...props} />);
    const cells = container.querySelectorAll(".widget-cell");
    expect(cells.length).toBe(TILES.length);
  });

  it("each cell carries gridColumn: span {w} matching the tile's w", () => {
    const props = makeProps();
    const { container } = render(<WidgetGrid {...props} />);
    const cells = container.querySelectorAll<HTMLDivElement>(".widget-cell");
    cells.forEach((cell, i) => {
      const expectedSpan = `span ${TILES[i].w}`;
      expect(cell.style.gridColumn).toBe(expectedSpan);
    });
  });

  it("each cell carries data-widget-id={k}", () => {
    const props = makeProps();
    const { container } = render(<WidgetGrid {...props} />);
    for (const tile of TILES) {
      expect(
        container.querySelector(`[data-widget-id="${tile.k}"]`),
      ).not.toBeNull();
    }
  });

  it("onDragStart + onDrop on different tiles fires onMove(fromK, toK)", () => {
    const props = makeProps();
    const { container } = render(<WidgetGrid {...props} />);
    const sourceCell = container.querySelector<HTMLDivElement>(
      '[data-widget-id="kpi-strip"]',
    )!;
    const targetCell = container.querySelector<HTMLDivElement>(
      '[data-widget-id="equity-curve"]',
    )!;

    fireEvent.dragStart(sourceCell, { dataTransfer: makeDataTransferStub().stub });
    fireEvent.dragOver(targetCell);
    fireEvent.drop(targetCell);

    expect(props.onMove).toHaveBeenCalledTimes(1);
    expect(props.onMove).toHaveBeenCalledWith("kpi-strip", "equity-curve");
  });

  it("A5: dragStart sets dataTransfer payload (Firefox requires setData to initiate drag)", () => {
    const props = makeProps();
    const { container } = render(<WidgetGrid {...props} />);
    const sourceCell = container.querySelector<HTMLDivElement>(
      '[data-widget-id="kpi-strip"]',
    )!;

    const { stub, setDataCalls, getEffectAllowed } = makeDataTransferStub();
    fireEvent.dragStart(sourceCell, { dataTransfer: stub });

    // Pre-fix Firefox would silently fail to initiate a drag because
    // dataTransfer remained empty. The contract pins setData("text/plain",
    // <widgetKey>) — anything missing breaks Firefox without warning.
    expect(setDataCalls).toContainEqual(["text/plain", "kpi-strip"]);
    expect(getEffectAllowed()).toBe("move");
  });

  // 09.1-REVIEW IN-02: drop handler prefers dataTransfer payload over the
  // React closure variable. When dataTransfer carries a different key
  // (e.g. via an external drop target or a future detached-DnD refactor),
  // the move MUST honor the payload — not the stale closure.
  it("IN-02: onDrop reads source key from dataTransfer.getData, falling back to closure", () => {
    const props = makeProps();
    const { container } = render(<WidgetGrid {...props} />);
    const targetCell = container.querySelector<HTMLDivElement>(
      '[data-widget-id="equity-curve"]',
    )!;

    // Synthetic drop with a dataTransfer payload — no preceding dragStart.
    // Without the IN-02 fix, the handler would read the (null) closure
    // draggingK and skip the onMove call. With the fix, it reads from
    // dataTransfer and fires onMove with the payload key.
    const dropTransfer = {
      getData: (type: string) => (type === "text/plain" ? "kpi-strip" : ""),
    } as unknown as DataTransfer;
    fireEvent.drop(targetCell, { dataTransfer: dropTransfer });

    expect(props.onMove).toHaveBeenCalledTimes(1);
    expect(props.onMove).toHaveBeenCalledWith("kpi-strip", "equity-curve");
  });

  it("clicking the close button in the chrome fires onRemove(k)", () => {
    const props = makeProps();
    const { container } = render(<WidgetGrid {...props} />);
    const targetCell = container.querySelector<HTMLDivElement>(
      '[data-widget-id="equity-curve"]',
    )!;
    const closeBtn = targetCell.querySelector<HTMLButtonElement>(
      'button[aria-label="Remove equity-curve widget"]',
    )!;
    expect(closeBtn).not.toBeNull();
    fireEvent.click(closeBtn);
    expect(props.onRemove).toHaveBeenCalledTimes(1);
    expect(props.onRemove).toHaveBeenCalledWith("equity-curve");
  });

  it("clicking a SizeStepper button fires onResize(k, w) with the clicked width", () => {
    const props = makeProps();
    const { container } = render(<WidgetGrid {...props} />);
    const targetCell = container.querySelector<HTMLDivElement>(
      '[data-widget-id="kpi-strip"]',
    )!;
    // The first cell starts at w=4; click width=2 to drive a real change.
    const widthBtn = targetCell.querySelector<HTMLButtonElement>(
      'button[aria-label="Width 2 of 4"]',
    )!;
    expect(widthBtn).not.toBeNull();
    fireEvent.click(widthBtn);
    expect(props.onResize).toHaveBeenCalledTimes(1);
    expect(props.onResize).toHaveBeenCalledWith("kpi-strip", 2);
  });

  it("self-drag does NOT call onMove (no-op)", () => {
    const props = makeProps();
    const { container } = render(<WidgetGrid {...props} />);
    const cell = container.querySelector<HTMLDivElement>(
      '[data-widget-id="kpi-strip"]',
    )!;
    fireEvent.dragStart(cell, { dataTransfer: makeDataTransferStub().stub });
    fireEvent.dragOver(cell);
    fireEvent.drop(cell);
    expect(props.onMove).not.toHaveBeenCalled();
  });

  it("V1 keyboard reorder: Enter toggles aria-pressed; ArrowDown calls onMove(k, 'next'); Esc clears aria-pressed", () => {
    const props = makeProps();
    const { container } = render(<WidgetGrid {...props} />);
    const targetCell = container.querySelector<HTMLDivElement>(
      '[data-widget-id="kpi-strip"]',
    )!;
    const dragHandle = targetCell.querySelector<HTMLButtonElement>(
      'button[aria-label="Reorder widget"]',
    )!;
    expect(dragHandle).not.toBeNull();
    expect(dragHandle.getAttribute("aria-pressed")).toBe("false");

    // Enter → enters keyboard-reorder mode.
    fireEvent.keyDown(dragHandle, { key: "Enter" });
    expect(dragHandle.getAttribute("aria-pressed")).toBe("true");

    // ArrowDown → onMove(k, "next").
    fireEvent.keyDown(dragHandle, { key: "ArrowDown" });
    expect(props.onMove).toHaveBeenCalledWith("kpi-strip", "next");

    // Esc → exits the mode.
    fireEvent.keyDown(dragHandle, { key: "Escape" });
    expect(dragHandle.getAttribute("aria-pressed")).toBe("false");
  });

  it("V1 overflow menu: clicking ⋯ opens role=menu with 3 menuitems; Move up → onMove(k,'prev'); Remove → onRemove(k)", () => {
    const props = makeProps();
    const { container } = render(<WidgetGrid {...props} />);
    const targetCell = container.querySelector<HTMLDivElement>(
      '[data-widget-id="equity-curve"]',
    )!;
    const overflowBtn = targetCell.querySelector<HTMLButtonElement>(
      'button[aria-label="Widget options"]',
    )!;
    expect(overflowBtn).not.toBeNull();
    expect(overflowBtn.getAttribute("aria-expanded")).toBe("false");

    fireEvent.click(overflowBtn);
    expect(overflowBtn.getAttribute("aria-expanded")).toBe("true");

    const menu = targetCell.querySelector<HTMLDivElement>('[role="menu"]')!;
    expect(menu).not.toBeNull();
    const items = menu.querySelectorAll<HTMLButtonElement>(
      'button[role="menuitem"]',
    );
    expect(items.length).toBe(3);

    // First menuitem is "Move up".
    fireEvent.click(items[0]);
    expect(props.onMove).toHaveBeenCalledWith("equity-curve", "prev");

    // Reopen the menu (it auto-closes on click) and click Remove (3rd menuitem).
    fireEvent.click(overflowBtn);
    const items2 = targetCell.querySelectorAll<HTMLButtonElement>(
      'button[role="menuitem"]',
    );
    fireEvent.click(items2[2]);
    expect(props.onRemove).toHaveBeenCalledWith("equity-curve");
  });

  it("V2 pointer-resize: pointerdown on the resize handle + pointermove past one column + pointerup fires onResize with the next snap", () => {
    const props = makeProps();
    // Stub getBoundingClientRect on the grid container so colWidth math
    // produces a deterministic column-width of 100px (gridWidth=430,
    // gap=10, columns=4 → (430 - 30)/4 = 100). With deltaX=110 (one
    // column-width plus one gap), Math.round(0 + 1.0) = +1 column.
    const origRect = HTMLElement.prototype.getBoundingClientRect;
    HTMLElement.prototype.getBoundingClientRect = function () {
      if (this.classList.contains("widget-grid")) {
        return {
          width: 430,
          height: 200,
          top: 0,
          left: 0,
          right: 430,
          bottom: 200,
          x: 0,
          y: 0,
          toJSON: () => ({}),
        } as DOMRect;
      }
      return origRect.call(this) as DOMRect;
    };

    try {
      const { container } = render(<WidgetGrid {...props} />);
      const targetCell = container.querySelector<HTMLDivElement>(
        '[data-widget-id="equity-curve"]',
      )!; // starts at w=2
      const handle = targetCell.querySelector<HTMLDivElement>(
        ".widget-resize-handle",
      )!;
      expect(handle).not.toBeNull();

      // Stub setPointerCapture (jsdom doesn't implement pointer capture).
      handle.setPointerCapture = vi.fn();

      fireEvent.pointerDown(handle, { clientX: 200, pointerId: 1 });

      // Dispatch window-level pointermove + pointerup that the cell's
      // listener attached after pointerDown.
      window.dispatchEvent(
        new PointerEvent("pointermove", { clientX: 310, pointerId: 1 }),
      );
      window.dispatchEvent(
        new PointerEvent("pointerup", { clientX: 310, pointerId: 1 }),
      );

      expect(props.onResize).toHaveBeenCalledTimes(1);
      // equity-curve starts at w=2; +1 column → w=3.
      expect(props.onResize).toHaveBeenCalledWith("equity-curve", 3);
    } finally {
      HTMLElement.prototype.getBoundingClientRect = origRect;
    }
  });

  // ────────────────────────────────────────────────────────────────────
  // Phase A4 keyboard a11y additions — Home / End traversal + aria-live
  // announcements. Drag-handle key handlers and the visually-hidden
  // aria-live region live in WidgetChrome but are easiest to exercise
  // through WidgetGrid because the focusEndpointHandle DOM query needs
  // multiple sibling chrome instances mounted.
  // ────────────────────────────────────────────────────────────────────

  it("A4: Home outside kbdMode focuses the FIRST drag handle; End focuses the LAST", () => {
    const props = makeProps();
    const { container } = render(<WidgetGrid {...props} />);
    const handles = container.querySelectorAll<HTMLButtonElement>(
      'button[aria-label="Reorder widget"]',
    );
    expect(handles.length).toBe(TILES.length);

    // Start with focus on the middle widget's handle.
    handles[1].focus();
    expect(document.activeElement).toBe(handles[1]);

    fireEvent.keyDown(handles[1], { key: "Home" });
    expect(document.activeElement).toBe(handles[0]);

    fireEvent.keyDown(handles[0], { key: "End" });
    expect(document.activeElement).toBe(handles[handles.length - 1]);

    // No move calls fired — focus traversal only outside kbdMode.
    expect(props.onMove).not.toHaveBeenCalled();
  });

  it("A4: Home / End inside kbdMode call onMove(k, 'first' / 'last') instead of moving focus", () => {
    const props = makeProps();
    const { container } = render(<WidgetGrid {...props} />);
    const middleHandle = container
      .querySelector<HTMLDivElement>('[data-widget-id="equity-curve"]')!
      .querySelector<HTMLButtonElement>('button[aria-label="Reorder widget"]')!;

    // Enter kbdMode via Enter, then Home.
    fireEvent.keyDown(middleHandle, { key: "Enter" });
    expect(middleHandle.getAttribute("aria-pressed")).toBe("true");

    fireEvent.keyDown(middleHandle, { key: "Home" });
    expect(props.onMove).toHaveBeenCalledWith("equity-curve", "first");

    fireEvent.keyDown(middleHandle, { key: "End" });
    expect(props.onMove).toHaveBeenCalledWith("equity-curve", "last");
  });

  it("A4: aria-live region announces reorder-mode toggles, moves, and resizes", () => {
    const props = makeProps();
    const { container, getByTestId } = render(<WidgetGrid {...props} />);
    const dragHandle = container
      .querySelector<HTMLDivElement>('[data-widget-id="kpi-strip"]')!
      .querySelector<HTMLButtonElement>('button[aria-label="Reorder widget"]')!;
    const liveRegion = getByTestId("widget-chrome-live-kpi-strip");

    // Empty initially.
    expect(liveRegion.getAttribute("aria-live")).toBe("polite");
    expect(liveRegion.textContent?.trim()).toBe("");

    // Enter kbdMode → announcement contains "Reorder mode active".
    fireEvent.keyDown(dragHandle, { key: "Enter" });
    expect(liveRegion.textContent).toContain("Reorder mode active");
    expect(liveRegion.textContent).toContain("kpi-strip");

    // ArrowDown → "Moved kpi-strip down."
    fireEvent.keyDown(dragHandle, { key: "ArrowDown" });
    expect(liveRegion.textContent).toContain("Moved kpi-strip down");

    // Escape → "Reorder mode exited"
    fireEvent.keyDown(dragHandle, { key: "Escape" });
    expect(liveRegion.textContent).toContain("Reorder mode exited");
  });
});
