import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { KpiPanel, type KpiPanelCell } from "./KpiPanel";

/**
 * Phase 170 / SC1-LAYERS (C1-A2, 2026-09-28).
 *
 * `variant` defaults to "cards" so PortfolioKpiPanel and the live KpiStrip stay
 * byte-identical: the @container host stays a SEPARATE ancestor of the grid,
 * and each cell stays a rounded surface card. `variant="panel"` is the square
 * hairline row the Allocations scenario tab nests under the Blend-window panel.
 * Only the shell changes — labels, values and children pass through.
 *
 * The cards assertions are the neuter tripwire: defaulting `variant` to
 * "panel" turns this suite RED, which is what keeps PortfolioKpiPanel from
 * silently adopting the panel shell.
 */

const CELLS: KpiPanelCell[] = [
  {
    key: "YTD TWR",
    label: "YTD TWR",
    value: "+5.00%",
    valueClassName: "text-positive",
    children: <div>year-to-date time-weighted return</div>,
  },
  {
    key: "Sharpe",
    label: "Sharpe",
    value: "1.20",
    children: <div>risk-adjusted return (selected period)</div>,
  },
  { key: "Max DD 12m", label: "Max DD 12m", value: "−8.00%" },
  {
    key: "Avg |ρ|",
    label: "Avg |ρ|",
    value: "—",
    children: <div>Requires per-holding correlation data (pending)</div>,
  },
];

const CARDS_GRID =
  "grid grid-cols-1 gap-3 @sm:grid-cols-2 @lg:grid-cols-4";
const CARDS_CELL = "rounded-lg border border-border bg-surface p-4";

function group(): HTMLElement {
  return screen.getByRole("group", { name: "Portfolio KPIs" });
}

describe("KpiPanel — default variant is cards (PortfolioKpiPanel / live strip)", () => {
  it("omitting variant renders today's markup: separate @container host, gapped card grid, rounded cells", () => {
    render(<KpiPanel cells={CELLS} />);
    const grid = group();
    expect(grid.className).toBe(CARDS_GRID);
    // The host must NOT be the grid. An element never queries its own container.
    expect(grid.className).not.toContain("@container");
    expect(grid.parentElement?.className).toBe("@container");
    expect(grid.getAttribute("aria-label")).toBe("Portfolio KPIs");
    const cells = Array.from(grid.children) as HTMLElement[];
    expect(cells).toHaveLength(4);
    for (const cell of cells) {
      expect(cell.className).toBe(CARDS_CELL);
    }
    // Inside the cell nothing moves: label, value, signed color, children.
    expect(screen.getByText("YTD TWR").className).toBe(
      "text-micro font-semibold uppercase tracking-wider text-text-muted",
    );
    const value = screen.getByText("+5.00%");
    expect(value.className).toContain("font-mono");
    expect(value.className).toContain("tabular-nums");
    expect(value.className).toContain("text-positive");
    expect(
      screen.getByText("Requires per-holding correlation data (pending)"),
    ).toBeInTheDocument();
  });
});

describe('KpiPanel — variant="panel" (Blend-window row)', () => {
  it("renders a 2-col hairline grid that steps to 4, with no gap, radius or shadow", () => {
    render(<KpiPanel cells={CELLS} variant="panel" />);
    const grid = group();
    // Token match, not substring: the cards grid's `@sm:grid-cols-2` contains
    // the characters `grid-cols-2` and would false-pass a toContain check.
    const tokens = grid.className.split(/\s+/);
    expect(tokens).toContain("grid-cols-2");
    expect(tokens).toContain("@lg:grid-cols-4");
    expect(tokens).not.toContain("gap-3");
    expect(tokens).not.toContain("grid-cols-1");
    expect(tokens).not.toContain("@sm:grid-cols-2");
    // Still a separate @container host. role and the accessible name stay.
    expect(grid.className).not.toContain("@container");
    expect(grid.parentElement?.className).toContain("@container");
    expect(grid.parentElement).not.toBe(grid);
    expect(grid.getAttribute("role")).toBe("group");
    expect(grid.getAttribute("aria-label")).toBe("Portfolio KPIs");
    const cells = Array.from(grid.children) as HTMLElement[];
    expect(cells).toHaveLength(4);
    for (const cell of cells) {
      expect(cell.className).toContain("px-4");
      expect(cell.className).toContain("py-3");
      expect(cell.className).toContain("border-border");
      // Right and top hairlines, not a rounded card and not a shadow.
      expect(cell.className).toContain("border-r");
      expect(cell.className).toContain("border-t");
      expect(cell.className).not.toMatch(/\brounded-/);
      expect(cell.className).not.toContain("shadow");
      expect(cell.className).not.toContain("p-4");
    }
    // The shell change must not touch what a cell says.
    expect(screen.getByText("Sharpe").className).toBe(
      "text-micro font-semibold uppercase tracking-wider text-text-muted",
    );
    expect(screen.getByText("1.20").className).toContain("font-mono");
    expect(screen.getByText("1.20").className).toContain("tabular-nums");
    expect(
      screen.getByText("risk-adjusted return (selected period)"),
    ).toBeInTheDocument();
  });
});
