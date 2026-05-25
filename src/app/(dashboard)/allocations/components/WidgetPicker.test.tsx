import { describe, it, expect, vi } from "vitest";
import { useRef } from "react";
import { render, screen, fireEvent, within, act } from "@testing-library/react";
import { WidgetPicker } from "./WidgetPicker";
import { WIDGET_REGISTRY } from "../lib/widget-registry";

/**
 * M-0123 — WidgetPicker shipped (S13a, 766 lines of feature) without a
 * dedicated test. Contract (WidgetPicker.tsx / D-08):
 *   - popover (role=dialog) lists every WIDGET_REGISTRY entry whose
 *     status === "ready", grouped by category section
 *   - search box filters by name / id / description (case-insensitive)
 *   - entries already on the dashboard (activeKeys) render disabled with a
 *     "Already on dashboard — {name}" label
 *   - clicking a non-active entry fires onPick(id) AND onClose
 *   - Escape + outside-click (after the deferred listener arms) fire onClose
 *   - isOpen=false renders null
 */

const READY_ENTRIES = Object.values(WIDGET_REGISTRY).filter(
  (e) => e.status === "ready",
);
const FIRST = READY_ENTRIES[0]; // e.g. equity-curve / "Equity Curve"

function Harness(props: {
  isOpen?: boolean;
  onClose?: () => void;
  onPick?: (k: string) => void;
  activeKeys?: Set<string>;
}) {
  const anchorRef = useRef<HTMLButtonElement | null>(null);
  return (
    <div>
      <button ref={anchorRef} data-testid="anchor">
        anchor
      </button>
      <span data-testid="outside">outside</span>
      <WidgetPicker
        isOpen={props.isOpen ?? true}
        onClose={props.onClose ?? vi.fn()}
        anchorRef={anchorRef}
        activeKeys={props.activeKeys ?? new Set()}
        onPick={props.onPick ?? vi.fn()}
      />
    </div>
  );
}

describe("WidgetPicker (M-0123)", () => {
  it("renders null when isOpen=false", () => {
    const { container } = render(<Harness isOpen={false} />);
    // Only the anchor + outside span; no dialog popover.
    expect(screen.queryByRole("dialog", { name: "Add widget" })).toBeNull();
    expect(container.querySelector('[data-testid="anchor"]')).not.toBeNull();
  });

  it("renders the popover dialog with the search box and at least one entry", () => {
    render(<Harness />);
    expect(
      screen.getByRole("dialog", { name: "Add widget" }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Search widgets")).toBeInTheDocument();
    // The first ready entry is listed (as an "Add {name}" button).
    expect(
      screen.getByRole("button", { name: `Add ${FIRST.name}` }),
    ).toBeInTheDocument();
  });

  it("groups entries into category sections", () => {
    render(<Harness />);
    const firstCategorySection = screen.getByRole("region", {
      name: FIRST.category,
    });
    expect(
      within(firstCategorySection).getByRole("button", {
        name: `Add ${FIRST.name}`,
      }),
    ).toBeInTheDocument();
  });

  it("filters by name substring (case-insensitive); non-matches drop", () => {
    render(<Harness />);
    const search = screen.getByLabelText("Search widgets");
    // Search for the first entry's name, uppercased, to prove case-insensitivity.
    fireEvent.change(search, {
      target: { value: FIRST.name.toUpperCase() },
    });
    expect(
      screen.getByRole("button", { name: `Add ${FIRST.name}` }),
    ).toBeInTheDocument();
    // A guaranteed non-match yields the empty-state copy.
    fireEvent.change(search, { target: { value: "zzz-no-such-widget-zzz" } });
    expect(screen.getByText(/No widgets match/)).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: `Add ${FIRST.name}` }),
    ).toBeNull();
  });

  it("an entry in activeKeys renders disabled with the 'Already on dashboard' label", () => {
    render(<Harness activeKeys={new Set([FIRST.id])} />);
    const activeBtn = screen.getByRole("button", {
      name: `Already on dashboard — ${FIRST.name}`,
    });
    expect(activeBtn).toBeDisabled();
    // The non-active "Add {name}" label is gone for this entry.
    expect(
      screen.queryByRole("button", { name: `Add ${FIRST.name}` }),
    ).toBeNull();
  });

  it("clicking a non-active entry fires onPick(id) then onClose", () => {
    const onPick = vi.fn();
    const onClose = vi.fn();
    render(<Harness onPick={onPick} onClose={onClose} />);
    fireEvent.click(screen.getByRole("button", { name: `Add ${FIRST.name}` }));
    expect(onPick).toHaveBeenCalledWith(FIRST.id);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("clicking a disabled (active) entry does NOT fire onPick", () => {
    const onPick = vi.fn();
    render(<Harness onPick={onPick} activeKeys={new Set([FIRST.id])} />);
    fireEvent.click(
      screen.getByRole("button", {
        name: `Already on dashboard — ${FIRST.name}`,
      }),
    );
    expect(onPick).not.toHaveBeenCalled();
  });

  it("Escape fires onClose", () => {
    const onClose = vi.fn();
    render(<Harness onClose={onClose} />);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("outside mousedown fires onClose once the deferred listener has armed", () => {
    vi.useFakeTimers();
    const onClose = vi.fn();
    try {
      render(<Harness onClose={onClose} />);
      // The mousedown listener arms on a setTimeout(0); flush it.
      act(() => {
        vi.runAllTimers();
      });
      fireEvent.mouseDown(screen.getByTestId("outside"));
      expect(onClose).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("mousedown on the anchor does NOT fire onClose (anchor-aware guard)", () => {
    vi.useFakeTimers();
    const onClose = vi.fn();
    try {
      render(<Harness onClose={onClose} />);
      act(() => {
        vi.runAllTimers();
      });
      fireEvent.mouseDown(screen.getByTestId("anchor"));
      expect(onClose).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
});
