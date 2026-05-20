import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { buildFactsheetPayload } from "@/lib/factsheet/build-payload";
import { FactsheetProvider, useActiveComparator } from "./factsheet-context";
import { ComparatorPicker } from "./ComparatorPicker";

// Regression: "None" radio was removed in favor of toggle-off semantics.
// Clicking the active comparator chip clears it to "none"; clicking a
// different chip selects it. Found by /qa on 2026-05-20.

function makePayload() {
  // 200 days of synthetic returns — long enough to clear every internal
  // length threshold (benchmark window, rolling window, etc).
  const dailyReturns = Array.from({ length: 200 }).map((_, i) => ({
    date: `2024-${String(((i / 28) | 0) + 1).padStart(2, "0")}-${String(
      (i % 28) + 1,
    ).padStart(2, "0")}`,
    value: Math.sin(i / 9) * 0.005,
  }));
  const payload = buildFactsheetPayload(
    {
      id: "test-strategy",
      name: "Test Strategy",
      types: ["test"],
      markets: ["crypto"],
      computedAt: "2026-05-20T00:00:00Z",
      trustTier: null,
    },
    dailyReturns,
  );
  if (!payload) throw new Error("buildFactsheetPayload returned null in test");
  return payload;
}

function CurrentComparator() {
  const { key } = useActiveComparator();
  return <span data-testid="active-comparator">{key}</span>;
}

function renderPicker() {
  return render(
    <FactsheetProvider payload={makePayload()}>
      <ComparatorPicker />
      <CurrentComparator />
    </FactsheetProvider>,
  );
}

describe("ComparatorPicker", () => {
  it("renders BTC and SPX chips with no 'None' option", () => {
    renderPicker();
    expect(screen.getByRole("button", { name: /BTC/ })).toBeDefined();
    expect(screen.getByRole("button", { name: /SPX/ })).toBeDefined();
    expect(screen.queryByRole("button", { name: /None/i })).toBeNull();
  });

  it("starts with the payload's activeComparator pressed", () => {
    renderPicker();
    expect(screen.getByRole("button", { name: /BTC/ })).toHaveProperty(
      "ariaPressed",
      "true",
    );
    expect(screen.getByRole("button", { name: /SPX/ })).toHaveProperty(
      "ariaPressed",
      "false",
    );
  });

  it("clicking a different chip swaps the active comparator", () => {
    renderPicker();
    fireEvent.click(screen.getByRole("button", { name: /SPX/ }));
    expect(screen.getByTestId("active-comparator").textContent).toBe("spx");
    expect(screen.getByRole("button", { name: /SPX/ })).toHaveProperty(
      "ariaPressed",
      "true",
    );
    expect(screen.getByRole("button", { name: /BTC/ })).toHaveProperty(
      "ariaPressed",
      "false",
    );
  });

  it("clicking the active chip toggles off to 'none'", () => {
    renderPicker();
    fireEvent.click(screen.getByRole("button", { name: /BTC/ }));
    expect(screen.getByTestId("active-comparator").textContent).toBe("none");
    expect(screen.getByRole("button", { name: /BTC/ })).toHaveProperty(
      "ariaPressed",
      "false",
    );
    expect(screen.getByRole("button", { name: /SPX/ })).toHaveProperty(
      "ariaPressed",
      "false",
    );
  });
});
