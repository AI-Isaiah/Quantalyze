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

  // ─────────────────────────────────────────── M-1099 — pickDay state machine
  //
  // Returns the ENABLED, day-numbered cell button. The two month grids each
  // render 42 cells (incl. overflow days), so a bare day number is ambiguous;
  // we filter to enabled cells whose inline color marks them as in-month
  // (text-primary), selected (white edge) or in-range (accent) — i.e. NOT the
  // muted out-of-month color.
  function dayCell(container: HTMLElement, day: number): HTMLButtonElement {
    const btns = Array.from(
      container.querySelectorAll("button"),
    ) as HTMLButtonElement[];
    const matches = btns.filter(
      (b) => b.textContent === String(day) && !b.disabled,
    );
    const inMonth = matches.filter((b) => {
      const s = b.getAttribute("style") ?? "";
      return (
        s.includes("--color-text-primary") ||
        s.includes("255, 255, 255") ||
        s.includes("--color-accent")
      );
    });
    const cell = inMonth[0] ?? matches[0];
    if (!cell) throw new Error(`No enabled day cell for ${day}`);
    return cell;
  }

  const PICK_MIN = new Date(2024, 0, 1); // Jan 1 2024
  const PICK_MAX = new Date(2024, 4, 30); // May 30 2024 (April fully visible)

  it("M-1099 — clicking Apr 10 then Apr 20 (forward) applies {2024-04-10, 2024-04-20}", () => {
    const onApply = vi.fn();
    const { container, getByRole } = render(
      <CustomRangePicker
        isOpen
        onClose={() => {}}
        onApply={onApply}
        min={PICK_MIN}
        max={PICK_MAX}
        initialRange={{ start: "2024-04-01", end: "2024-04-01" }}
      />,
    );
    fireEvent.click(dayCell(container, 10));
    fireEvent.click(dayCell(container, 20));
    fireEvent.click(getByRole("button", { name: /apply/i }));
    expect(onApply).toHaveBeenCalledTimes(1);
    expect(onApply).toHaveBeenCalledWith({
      start: "2024-04-10",
      end: "2024-04-20",
    });
  });

  it(
    "M-1099 — clicking Apr 20 then Apr 10 (reverse) SHOULD swap to {2024-04-10, 2024-04-20} but the dead swap branch collapses it to {Apr10, Apr10} — fix in follow-up (the `|| d < start` clause in the first branch shadows the swap branch)",
    () => {
      const onApply = vi.fn();
      const { container, getByRole } = render(
        <CustomRangePicker
          isOpen
          onClose={() => {}}
          onApply={onApply}
          min={PICK_MIN}
          max={PICK_MAX}
          initialRange={{ start: "2024-04-01", end: "2024-04-01" }}
        />,
      );
      // Reverse order: later day first, then earlier.
      fireEvent.click(dayCell(container, 20));
      fireEvent.click(dayCell(container, 10));
      fireEvent.click(getByRole("button", { name: /apply/i }));
      // CORRECT behaviour: a reverse pick swaps into a forward range.
      expect(onApply).toHaveBeenCalledWith({
        start: "2024-04-10",
        end: "2024-04-20",
      });
    },
  );

  it("M-1099 — clicking a day below min is a no-op (cell disabled; range unchanged)", () => {
    const onApply = vi.fn();
    const min = new Date(2024, 3, 10); // Apr 10 2024
    const max = new Date(2024, 4, 30); // May 30 2024
    const { container, getByRole } = render(
      <CustomRangePicker
        isOpen
        onClose={() => {}}
        onApply={onApply}
        min={min}
        max={max}
        initialRange={{ start: "2024-04-15", end: "2024-04-20" }}
      />,
    );
    // Apr 5 is below min → its cell renders disabled, so clicking it cannot
    // mutate start/end (pickDay's clamp guard is the backstop).
    const btns = Array.from(
      container.querySelectorAll("button"),
    ) as HTMLButtonElement[];
    const apr5 = btns.find(
      (b) => b.textContent === "5" && b.disabled,
    );
    expect(apr5).toBeTruthy();
    fireEvent.click(apr5 as HTMLButtonElement);
    // Range is untouched.
    fireEvent.click(getByRole("button", { name: /apply/i }));
    expect(onApply).toHaveBeenCalledWith({
      start: "2024-04-15",
      end: "2024-04-20",
    });
  });

  it("M-1099 — clicking the same day twice yields a 1-day range ('1 day' singular chip)", () => {
    const onApply = vi.fn();
    const { container, getByText, getByRole } = render(
      <CustomRangePicker
        isOpen
        onClose={() => {}}
        onApply={onApply}
        min={PICK_MIN}
        max={PICK_MAX}
        initialRange={{ start: "2024-04-01", end: "2024-04-15" }}
      />,
    );
    fireEvent.click(dayCell(container, 12));
    fireEvent.click(dayCell(container, 12));
    // Day-count chip reads the singular "1 day".
    expect(getByText(/^1 day$/)).toBeTruthy();
    fireEvent.click(getByRole("button", { name: /apply/i }));
    expect(onApply).toHaveBeenCalledWith({
      start: "2024-04-12",
      end: "2024-04-12",
    });
  });

  // ─────────────────────────────────── M-1105 — manual date-input edits
  //
  // PR3 wired the Start input's onChange to parse → clampDate → setStart AND
  // setViewMonth(startOfMonth(c)) (CustomRangePicker.tsx:284-291). The
  // existing "disables Apply when start > end" case types a value but only
  // asserts the Apply disabled flag — it never pins the viewMonth advance or
  // the clamp. A regression that dropped setViewMonth would strand the
  // calendar on the old month while the user typed a far-away date; a
  // regression that dropped clampDate would let an out-of-range typed value
  // escape the [min,max] bound.

  it("M-1105 — typing a Start date advances the visible calendar to that month", () => {
    const min = new Date(2024, 0, 1); // Jan 2024
    const max = new Date(2024, 11, 31); // Dec 2024
    const { container } = render(
      <CustomRangePicker
        isOpen
        onClose={() => {}}
        onApply={() => {}}
        min={min}
        max={max}
        initialRange={{ start: "2024-01-15", end: "2024-12-15" }}
      />,
    );
    // Initially the left grid shows January 2024 (start's month).
    const startInput = container.querySelectorAll<HTMLInputElement>(
      'input[type="date"]',
    )[0];
    fireEvent.change(startInput, { target: { value: "2024-05-15" } });
    // viewMonth advanced → left grid = May 2024, right grid = June 2024.
    const labels = Array.from(container.querySelectorAll("div"))
      .map((d) => d.textContent ?? "")
      .filter((t) => /^[A-Z][a-z]+ \d{4}$/.test(t));
    expect(labels).toEqual(["May 2024", "June 2024"]);
  });

  it("M-1105 — typing a Start date ABOVE max clamps to maxIso; Apply emits the clamped value, not the typed one", () => {
    const onApply = vi.fn();
    const min = new Date(2024, 0, 1); // 2024-01-01
    const max = new Date(2024, 5, 30); // 2024-06-30
    const { container, getByRole } = render(
      <CustomRangePicker
        isOpen
        onClose={() => {}}
        onApply={onApply}
        min={min}
        max={max}
        initialRange={{ start: "2024-02-01", end: "2024-06-30" }}
      />,
    );
    const startInput = container.querySelectorAll<HTMLInputElement>(
      'input[type="date"]',
    )[0];
    // jsdom's fireEvent.change bypasses the native max attribute, so the
    // out-of-range value reaches onChange → clampDate pins it to max.
    fireEvent.change(startInput, { target: { value: "2099-01-01" } });
    // Displayed value is the clamped maxIso, NOT the typed 2099 value.
    expect(startInput.value).toBe("2024-06-30");
    // start == end == max → valid 1-day range; Apply fires with the clamp,
    // never 2099.
    fireEvent.click(getByRole("button", { name: /apply/i }));
    expect(onApply).toHaveBeenCalledTimes(1);
    expect(onApply.mock.calls[0][0]).toEqual({
      start: "2024-06-30",
      end: "2024-06-30",
    });
  });

  it("M-1105 — typing a malformed Start value is a no-op (parseISODate→null; no state change, no crash)", () => {
    const onApply = vi.fn();
    const min = new Date(2024, 0, 1);
    const max = new Date(2024, 5, 30);
    const { container, getByRole } = render(
      <CustomRangePicker
        isOpen
        onClose={() => {}}
        onApply={onApply}
        min={min}
        max={max}
        initialRange={{ start: "2024-03-01", end: "2024-04-01" }}
      />,
    );
    const startInput = container.querySelectorAll<HTMLInputElement>(
      'input[type="date"]',
    )[0];
    // Empty string → split("-").map(Number) yields [NaN] → parseISODate
    // returns null → the onChange guard skips setStart/setViewMonth entirely.
    expect(() =>
      fireEvent.change(startInput, { target: { value: "" } }),
    ).not.toThrow();
    // State unchanged → Apply still emits the original range.
    fireEvent.click(getByRole("button", { name: /apply/i }));
    expect(onApply).toHaveBeenCalledWith({
      start: "2024-03-01",
      end: "2024-04-01",
    });
  });

  // ─────────────────────────────────── M-1100 — month-navigation arrows
  function monthLabels(container: HTMLElement): string[] {
    return Array.from(container.querySelectorAll("div"))
      .map((d) => d.textContent ?? "")
      .filter((t) => /^[A-Z][a-z]+ \d{4}$/.test(t));
  }

  it("M-1100 — 'Previous month' advances BOTH grid labels back one month", () => {
    const min = new Date(2024, 0, 1); // Jan 2024
    const max = new Date(2024, 5, 30); // June 2024
    const { container, getAllByLabelText } = render(
      <CustomRangePicker
        isOpen
        onClose={() => {}}
        onApply={() => {}}
        min={min}
        max={max}
        initialRange={{ start: "2024-04-15", end: "2024-04-15" }}
      />,
    );
    // leftMonth = April, rightMonth = May initially.
    expect(monthLabels(container)).toEqual(["April 2024", "May 2024"]);
    fireEvent.click(getAllByLabelText("Previous month")[0]);
    // After one ‹ click: left → March, right → April.
    expect(monthLabels(container)).toEqual(["March 2024", "April 2024"]);
  });

  it("M-1100 — 'Next month' advances BOTH grid labels forward one month", () => {
    const min = new Date(2024, 0, 1);
    const max = new Date(2024, 5, 30);
    const { container, getAllByLabelText } = render(
      <CustomRangePicker
        isOpen
        onClose={() => {}}
        onApply={() => {}}
        min={min}
        max={max}
        initialRange={{ start: "2024-04-15", end: "2024-04-15" }}
      />,
    );
    expect(monthLabels(container)).toEqual(["April 2024", "May 2024"]);
    fireEvent.click(getAllByLabelText("Next month")[0]);
    expect(monthLabels(container)).toEqual(["May 2024", "June 2024"]);
  });

  it("M-1100 — navigating across the year boundary (Jan → Dec) renders 'December 2023'", () => {
    const min = new Date(2023, 11, 1); // Dec 1 2023
    const max = new Date(2024, 1, 1); // Feb 1 2024
    const { container, getAllByLabelText } = render(
      <CustomRangePicker
        isOpen
        onClose={() => {}}
        onApply={() => {}}
        min={min}
        max={max}
        initialRange={{ start: "2024-01-15", end: "2024-01-15" }}
      />,
    );
    // leftMonth = January 2024 initially.
    expect(monthLabels(container)).toEqual(["January 2024", "February 2024"]);
    fireEvent.click(getAllByLabelText("Previous month")[0]);
    // Cross-year: left → December 2023.
    expect(monthLabels(container)).toEqual(["December 2023", "January 2024"]);
  });

  it("M-1100 — leap-day Feb 2024 renders the clickable 29th without throwing", () => {
    const min = new Date(2024, 1, 1); // Feb 1 2024
    const max = new Date(2024, 2, 31); // Mar 31 2024
    const onApply = vi.fn();
    const { container, getByRole } = render(
      <CustomRangePicker
        isOpen
        onClose={() => {}}
        onApply={onApply}
        min={min}
        max={max}
        initialRange={{ start: "2024-02-01", end: "2024-02-01" }}
      />,
    );
    // Feb 2024 is a leap year — the 29th cell exists and is enabled.
    const feb29 = dayCell(container, 29);
    expect(feb29).toBeTruthy();
    fireEvent.click(feb29);
    fireEvent.click(getByRole("button", { name: /apply/i }));
    // start clicks to Feb 29 (start=end after a single pick).
    expect(onApply).toHaveBeenCalledWith({
      start: "2024-02-29",
      end: "2024-02-29",
    });
  });

  // ─────────────────────────────────── H-1231 — parseISODate rollover guard
  //
  // parseISODate previously only checked Number.isFinite on the three
  // components, then constructed `new Date(y, m-1, d)`. JS silently rolls
  // out-of-range components over (2024-13-01 → Jan 2025; 2024-02-31 → Mar 2),
  // so a malformed string handed to the parser yielded a real-but-wrong date.
  //
  // NOTE on reachability: the manual <input type="date"> controls cannot
  // deliver a malformed string to parseISODate — the native date control only
  // fires change with a valid YYYY-MM-DD or "" (verified against jsdom). The
  // REACHABLE path that feeds raw strings into parseISODate is the
  // `initialRange` prop, consumed by the start/end useState initializers
  // (CustomRangePicker.tsx:95-108). These tests drive that path: a rollover-
  // prone initialRange must NOT be silently coerced into a wrong-but-valid
  // date; instead parseISODate returns null and the initializer falls back to
  // the min/max bound. This is a defensive root-cause fix on the parsing
  // primitive (H-1231).

  it("H-1231 — initialRange.start of month 13 (2024-13-01) is rejected, not rolled to Jan 2025", () => {
    const onApply = vi.fn();
    const min = new Date(2024, 0, 1); // 2024-01-01
    const max = new Date(2024, 11, 31); // 2024-12-31
    const { getByRole } = render(
      <CustomRangePicker
        isOpen
        onClose={() => {}}
        onApply={onApply}
        min={min}
        max={max}
        // Pre-fix: parseISODate('2024-13-01') → new Date(2024,12,1) → Jan 1
        // 2025, clamped to max → start becomes 2024-12-31 (a date nobody
        // supplied). Post-fix: parseISODate returns null → start falls back to
        // min (2024-01-01).
        initialRange={{ start: "2024-13-01", end: "2024-06-30" }}
      />,
    );
    fireEvent.click(getByRole("button", { name: /apply/i }));
    expect(onApply).toHaveBeenCalledTimes(1);
    // Discriminating: start is the min fallback, NOT the clamped rollover.
    expect(onApply.mock.calls[0][0]).toEqual({
      start: "2024-01-01",
      end: "2024-06-30",
    });
  });

  it("H-1231 — initialRange.start of a non-existent calendar day (2024-02-31) is rejected, not rolled to Mar 2", () => {
    const onApply = vi.fn();
    const min = new Date(2024, 0, 1); // 2024-01-01
    const max = new Date(2024, 11, 31); // 2024-12-31
    const { getByRole } = render(
      <CustomRangePicker
        isOpen
        onClose={() => {}}
        onApply={onApply}
        min={min}
        max={max}
        // Pre-fix: new Date(2024, 1, 31) → Mar 2 2024 (in-range, no clamp) →
        // start becomes 2024-03-02. Post-fix: round-trip check fails →
        // parseISODate returns null → start falls back to min.
        initialRange={{ start: "2024-02-31", end: "2024-06-30" }}
      />,
    );
    fireEvent.click(getByRole("button", { name: /apply/i }));
    expect(onApply.mock.calls[0][0]).toEqual({
      start: "2024-01-01",
      end: "2024-06-30",
    });
  });

  it("H-1231 — a valid initialRange (2024-02-29 leap day) still parses through unchanged", () => {
    const onApply = vi.fn();
    const min = new Date(2024, 0, 1);
    const max = new Date(2024, 11, 31);
    const { getByRole } = render(
      <CustomRangePicker
        isOpen
        onClose={() => {}}
        onApply={onApply}
        min={min}
        max={max}
        // 2024 is a leap year, so Feb 29 is a real day and must round-trip.
        initialRange={{ start: "2024-02-29", end: "2024-03-15" }}
      />,
    );
    fireEvent.click(getByRole("button", { name: /apply/i }));
    expect(onApply.mock.calls[0][0]).toEqual({
      start: "2024-02-29",
      end: "2024-03-15",
    });
  });
});
