import { render, fireEvent, act } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { CustomRangePicker } from "./CustomRangePicker";

// ---------------------------------------------------------------------------
// Phase 09.1 Plan 07 / Task 3 — CustomRangePicker test suite.
//
// Spec coverage:
//   1. isOpen=false → renders null.
//   2. isOpen=true → renders Start + End inputs and Apply + Cancel buttons.
//   3. min / max props clamp the input constraints.
//   4. Apply button is disabled when start > end.
//   5. Apply with a valid range fires onApply({start, end}).
//   6. Esc fires onClose.
//   7. Outside click fires onClose.
//
// The popover delays its document-level listener attachment by one tick
// (matches the designer-bundle pattern so the click that opens the popover
// doesn't immediately close it). The Esc + outside-click tests therefore
// flush the timer with `act` + `vi.useFakeTimers()` before firing events.
// ---------------------------------------------------------------------------

const MIN = new Date(2024, 0, 1);
const MAX = new Date(2024, 5, 30);

describe("CustomRangePicker", () => {
  it("renders null when isOpen=false", () => {
    const { container } = render(
      <CustomRangePicker
        isOpen={false}
        onClose={() => {}}
        onApply={() => {}}
        min={MIN}
        max={MAX}
      />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders Start + End inputs and Apply + Cancel when open", () => {
    const { getByRole, getAllByText } = render(
      <CustomRangePicker
        isOpen
        onClose={() => {}}
        onApply={() => {}}
        min={MIN}
        max={MAX}
      />,
    );
    // role="dialog" + aria-label
    expect(getByRole("dialog", { name: "Custom date range" })).toBeTruthy();
    // Start + End labels
    expect(getAllByText(/start/i).length).toBeGreaterThanOrEqual(1);
    expect(getAllByText(/end/i).length).toBeGreaterThanOrEqual(1);
    // Apply + Cancel buttons
    expect(getByRole("button", { name: /apply/i })).toBeTruthy();
    expect(getByRole("button", { name: /cancel/i })).toBeTruthy();
  });

  it("clamps Start input min/max to the provided min/max props", () => {
    const { container } = render(
      <CustomRangePicker
        isOpen
        onClose={() => {}}
        onApply={() => {}}
        min={MIN}
        max={MAX}
      />,
    );
    const dateInputs = container.querySelectorAll(
      'input[type="date"]',
    ) as NodeListOf<HTMLInputElement>;
    expect(dateInputs.length).toBeGreaterThanOrEqual(2);
    const start = dateInputs[0];
    expect(start.min).toBe("2024-01-01");
    // start.max clamps to the current end value (initially MAX → 2024-06-30)
    expect(start.max).toBe("2024-06-30");
  });

  it("disables Apply when start > end", () => {
    const { container, getByRole } = render(
      <CustomRangePicker
        isOpen
        onClose={() => {}}
        onApply={() => {}}
        min={MIN}
        max={MAX}
        initialRange={{ start: "2024-04-01", end: "2024-04-15" }}
      />,
    );
    const dateInputs = container.querySelectorAll(
      'input[type="date"]',
    ) as NodeListOf<HTMLInputElement>;
    const startInput = dateInputs[0];
    fireEvent.change(startInput, { target: { value: "2024-05-01" } });
    const applyBtn = getByRole("button", { name: /apply/i }) as HTMLButtonElement;
    expect(applyBtn.disabled).toBe(true);
  });

  it("fires onApply({start, end}) when a valid range is applied", () => {
    const onApply = vi.fn();
    const onClose = vi.fn();
    const { getByRole } = render(
      <CustomRangePicker
        isOpen
        onClose={onClose}
        onApply={onApply}
        min={MIN}
        max={MAX}
        initialRange={{ start: "2024-04-01", end: "2024-04-15" }}
      />,
    );
    const applyBtn = getByRole("button", { name: /apply/i });
    fireEvent.click(applyBtn);
    expect(onApply).toHaveBeenCalledTimes(1);
    expect(onApply).toHaveBeenCalledWith({
      start: "2024-04-01",
      end: "2024-04-15",
    });
  });

  it("Esc fires onClose", () => {
    vi.useFakeTimers();
    const onClose = vi.fn();
    render(
      <CustomRangePicker
        isOpen
        onClose={onClose}
        onApply={() => {}}
        min={MIN}
        max={MAX}
      />,
    );
    // Flush the setTimeout(0) that arms the listener.
    act(() => {
      vi.runAllTimers();
    });
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  it("outside click fires onClose", () => {
    vi.useFakeTimers();
    const onClose = vi.fn();
    render(
      <div>
        <span data-testid="outside">outside</span>
        <CustomRangePicker
          isOpen
          onClose={onClose}
          onApply={() => {}}
          min={MIN}
          max={MAX}
        />
      </div>,
    );
    act(() => {
      vi.runAllTimers();
    });
    const outside = document.querySelector('[data-testid="outside"]')!;
    fireEvent.mouseDown(outside);
    expect(onClose).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });
});
