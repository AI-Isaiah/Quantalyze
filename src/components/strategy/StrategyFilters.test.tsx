/**
 * StrategyFilters — the "All Filters" panel keyboard contract (Phase 201 D-12,
 * CLAR-06, UI-SPEC Interaction contract 7).
 *
 * Escape closes the panel and DISCARDS the unapplied draft (it is not Apply). An
 * Escape a nested control already handled (`defaultPrevented`) leaves the panel
 * open, the `CustomizeDrawer` M-0061 idiom. Close by Escape, the Close button or
 * the backdrop all return focus to the "All Filters" button that opened it.
 *
 * The panel deliberately stays a plain fixed div (A-9): no role="dialog", no focus
 * trap, no scroll lock, no initial focus move. The last arm pins that, so a later
 * "improvement" toward a modal is a conscious decision and not drift.
 */

import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";

import {
  StrategyFilters,
  EMPTY_ADVANCED_FILTERS,
  type AdvancedFilters,
} from "./StrategyFilters";

function renderFilters(overrides: { advancedFilters?: AdvancedFilters } = {}) {
  const onAdvancedFiltersChange = vi.fn<(f: AdvancedFilters) => void>();
  render(
    <StrategyFilters
      search=""
      onSearchChange={vi.fn()}
      showExamples
      onToggleExamples={vi.fn()}
      sortKey="sharpe"
      onSortKeyChange={vi.fn()}
      sortDir="desc"
      onSortDirChange={vi.fn()}
      viewMode="table"
      onViewModeChange={vi.fn()}
      advancedFilters={overrides.advancedFilters ?? EMPTY_ADVANCED_FILTERS}
      onAdvancedFiltersChange={onAdvancedFiltersChange}
    />,
  );
  return { onAdvancedFiltersChange };
}

/** Open the panel the way a keyboard user does: focus the button, then activate it. */
function openPanel(): HTMLElement {
  const button = screen.getByRole("button", { name: /^All Filters/ });
  button.focus();
  fireEvent.click(button);
  expect(screen.getByRole("heading", { name: "All Filters" })).toBeTruthy();
  return button;
}

/**
 * In a browser the user's click or Tab lands focus INSIDE the panel, and closing
 * unmounts that element, which drops focus to <body>. jsdom does not move focus on
 * a synthetic click, so a focus-return arm must place it there itself or it passes
 * with the code absent.
 */
function moveFocusIntoPanel() {
  const close = screen.getByRole("button", { name: "Close" });
  close.focus();
  expect(document.activeElement).toBe(close);
}

function pressEscape() {
  fireEvent.keyDown(document, { key: "Escape" });
}

describe("StrategyFilters — All Filters panel Escape (D-12)", () => {
  it("Escape closes the open panel", () => {
    renderFilters();
    openPanel();
    pressEscape();
    expect(screen.queryByRole("heading", { name: "All Filters" })).toBeNull();
  });

  it("an Escape a nested control already handled (defaultPrevented) leaves it open", () => {
    renderFilters();
    openPanel();
    const evt = new KeyboardEvent("keydown", {
      key: "Escape",
      bubbles: true,
      cancelable: true,
    });
    evt.preventDefault();
    // Outside act() React would not flush a close, and the arm would pass with
    // the defaultPrevented check deleted.
    act(() => {
      document.dispatchEvent(evt);
    });
    expect(screen.getByRole("heading", { name: "All Filters" })).toBeTruthy();
  });

  it("a key other than Escape does not close it", () => {
    renderFilters();
    openPanel();
    fireEvent.keyDown(document, { key: "a" });
    expect(screen.getByRole("heading", { name: "All Filters" })).toBeTruthy();
  });

  it("Escape discards the unapplied draft: nothing is applied and reopening shows the applied values", () => {
    const { onAdvancedFiltersChange } = renderFilters();
    openPanel();
    fireEvent.click(screen.getByText("Long-Only"));
    expect((screen.getByLabelText("Long-Only") as HTMLInputElement).checked).toBe(true);

    pressEscape();
    expect(screen.queryByRole("heading", { name: "All Filters" })).toBeNull();
    expect(onAdvancedFiltersChange).not.toHaveBeenCalled();

    openPanel();
    expect((screen.getByLabelText("Long-Only") as HTMLInputElement).checked).toBe(false);
  });

  it("Apply filters still applies the draft", () => {
    const { onAdvancedFiltersChange } = renderFilters();
    openPanel();
    fireEvent.click(screen.getByText("Long-Only"));
    fireEvent.click(screen.getByRole("button", { name: "Apply filters" }));
    expect(onAdvancedFiltersChange).toHaveBeenCalledTimes(1);
    expect(onAdvancedFiltersChange.mock.calls[0][0].types).toContain("Long-Only");
    expect(screen.queryByRole("heading", { name: "All Filters" })).toBeNull();
  });
});

describe("StrategyFilters — focus returns to the opener (D-12)", () => {
  it("after Escape", () => {
    renderFilters();
    const button = openPanel();
    moveFocusIntoPanel();
    pressEscape();
    expect(screen.queryByRole("heading", { name: "All Filters" })).toBeNull();
    expect(document.activeElement).toBe(button);
  });

  it("after the Close button", () => {
    renderFilters();
    const button = openPanel();
    moveFocusIntoPanel();
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("heading", { name: "All Filters" })).toBeNull();
    expect(document.activeElement).toBe(button);
  });

  it("after a backdrop click", () => {
    renderFilters();
    const button = openPanel();
    moveFocusIntoPanel();
    fireEvent.click(screen.getByTestId("filters-backdrop"));
    expect(screen.queryByRole("heading", { name: "All Filters" })).toBeNull();
    expect(document.activeElement).toBe(button);
  });
});

describe("StrategyFilters — the panel stays a plain panel (A-9)", () => {
  it("adds no dialog role, no scroll lock and no initial focus move", () => {
    renderFilters();
    const button = openPanel();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.body.style.overflow).not.toBe("hidden");
    expect(document.activeElement).toBe(button);
  });
});

// Phase 201 plan 16 (D-02): in "All Filters" only the term's own words are a Form A trigger; the unit
// that follows ("CAGR %") stays plain text, so the label reads the same.
describe("StrategyFilters - All Filters labels are terms (D-02)", () => {
  const LABELS = [
    { text: "CAGR %", term: "cagr", words: "CAGR" },
    { text: "Max DD %", term: "max_drawdown", words: "Max DD" },
    { text: "Volatility %", term: "volatility", words: "Volatility" },
    { text: "Sharpe", term: "sharpe", words: "Sharpe" },
    { text: "Calmar", term: "calmar", words: "Calmar" },
  ];

  it.each(LABELS)("$text wraps only $words", ({ text, term, words }) => {
    renderFilters();
    openPanel();
    const label = screen
      .getAllByText((_, el) => el?.tagName === "SPAN" && el.textContent === text)
      .find((el) => el.querySelector("[data-term]"));
    const trigger = label?.querySelector("[data-term]");
    expect(trigger?.getAttribute("data-term")).toBe(term);
    expect(trigger?.textContent).toBe(words);
  });

  it("a label that names no registered term gets no trigger", () => {
    renderFilters();
    openPanel();
    const label = screen
      .getAllByText((_, el) => el?.tagName === "SPAN" && el.textContent === "Return %")
      .at(0);
    expect(label).toBeTruthy();
    expect(label?.querySelector("[data-term]")).toBeNull();
  });
});
