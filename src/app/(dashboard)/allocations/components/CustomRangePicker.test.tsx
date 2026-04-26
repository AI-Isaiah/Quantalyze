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

  // ───────────────────────────────────────────────────── PR3 (HANDOFF G6)
  // dual-month grid + presets rail coverage

  it("PR3 — renders both presets rail and two month grids", () => {
    const { getByText, getAllByText } = render(
      <CustomRangePicker
        isOpen
        onClose={() => {}}
        onApply={() => {}}
        min={MIN}
        max={MAX}
      />,
    );
    // Presets rail labels (matching prototype range-picker.jsx:121-130).
    expect(getByText(/Last 7 days/i)).toBeTruthy();
    expect(getByText(/Last 30 days/i)).toBeTruthy();
    expect(getByText(/Last 90 days/i)).toBeTruthy();
    expect(getByText(/Month to date/i)).toBeTruthy();
    expect(getByText(/Year to date/i)).toBeTruthy();
    // Two month-nav arrows: ‹ on left grid, › on right grid.
    expect(getAllByText("‹").length).toBeGreaterThanOrEqual(1);
    expect(getAllByText("›").length).toBeGreaterThanOrEqual(1);
  });

  it("PR3 — preset 'Last 7 days' sets a 7-day window ending at MAX", () => {
    const onApply = vi.fn();
    const { getByText, getByRole } = render(
      <CustomRangePicker
        isOpen
        onClose={() => {}}
        onApply={onApply}
        min={MIN}
        max={MAX}
      />,
    );
    fireEvent.click(getByText(/Last 7 days/i));
    fireEvent.click(getByRole("button", { name: /apply/i }));
    expect(onApply).toHaveBeenCalledTimes(1);
    const arg = onApply.mock.calls[0][0];
    // End is MAX; start is 6 days before (inclusive 7-day window).
    expect(arg.end).toBe("2024-06-30");
    expect(arg.start).toBe("2024-06-24");
  });

  it("PR3 — preset 'Year to date' sets January 1st of the MAX year as start", () => {
    const onApply = vi.fn();
    const { getByText, getByRole } = render(
      <CustomRangePicker
        isOpen
        onClose={() => {}}
        onApply={onApply}
        min={MIN}
        max={MAX}
      />,
    );
    fireEvent.click(getByText(/Year to date/i));
    fireEvent.click(getByRole("button", { name: /apply/i }));
    const arg = onApply.mock.calls[0][0];
    expect(arg.start).toBe("2024-01-01");
    expect(arg.end).toBe("2024-06-30");
  });

  it("PR3 — preset 'Max' uses min..max as the range", () => {
    const onApply = vi.fn();
    const { getByText, getByRole } = render(
      <CustomRangePicker
        isOpen
        onClose={() => {}}
        onApply={onApply}
        min={MIN}
        max={MAX}
      />,
    );
    fireEvent.click(getByText(/^Max$/));
    fireEvent.click(getByRole("button", { name: /apply/i }));
    const arg = onApply.mock.calls[0][0];
    expect(arg.start).toBe("2024-01-01");
    expect(arg.end).toBe("2024-06-30");
  });

  it("PR3 — day count chip reads '180 days' for a 180-day window", () => {
    const min = new Date(2024, 0, 1);
    const max = new Date(2024, 5, 28); // 180 days inclusive
    const { getByText } = render(
      <CustomRangePicker
        isOpen
        onClose={() => {}}
        onApply={() => {}}
        min={min}
        max={max}
        initialRange={{ start: "2024-01-01", end: "2024-06-28" }}
      />,
    );
    expect(getByText(/180 days/i)).toBeTruthy();
  });

  it("PR3 — left + right month grids show consecutive months", () => {
    const min = new Date(2024, 2, 1); // March 2024
    const max = new Date(2024, 5, 30); // June 30, 2024
    const { getByText } = render(
      <CustomRangePicker
        isOpen
        onClose={() => {}}
        onApply={() => {}}
        min={min}
        max={max}
        initialRange={{ start: "2024-03-15", end: "2024-04-15" }}
      />,
    );
    // initialRange.start is March 15 → leftMonth = March, rightMonth = April.
    expect(getByText(/March 2024/)).toBeTruthy();
    expect(getByText(/April 2024/)).toBeTruthy();
  });
});
