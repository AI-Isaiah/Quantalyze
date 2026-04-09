import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { FundKPIStrip } from "./FundKPIStrip";

/**
 * Regression test for the DESIGN.md "data density > card density" rule.
 * FundKPIStrip must render as ONE shared panel with hairline column
 * dividers, NOT four separate Card components. This is the single most
 * important structural property of the component — if a future refactor
 * accidentally splits it back into Cards, the page silently drifts into
 * the exact card-mosaic anti-pattern DESIGN.md rejects.
 */
describe("FundKPIStrip", () => {
  it("renders a single semantic section, not four separate cards", () => {
    const { container } = render(
      <FundKPIStrip
        aum={425_214_000}
        return24h={0.01}
        returnMtd={0.023}
        returnYtd={0.184}
      />,
    );
    const sections = container.querySelectorAll("section");
    expect(sections).toHaveLength(1);
    // Exactly 4 cells inside the one section.
    const cells = container.querySelectorAll("section > div > div");
    expect(cells.length).toBe(4);
  });

  it("applies column-divider classes (shared panel, hairline dividers)", () => {
    const { container } = render(
      <FundKPIStrip
        aum={1_000_000}
        return24h={0}
        returnMtd={0}
        returnYtd={0}
      />,
    );
    // The grid wrapper should carry `divide-x` so TailwindCSS renders
    // the hairline column dividers DESIGN.md mandates.
    const grid = container.querySelector("section > div");
    expect(grid?.className).toMatch(/divide-x/);
    // And the outer section should carry a single border, not
    // per-cell borders.
    const section = container.querySelector("section");
    expect(section?.className).toMatch(/border/);
  });

  it("renders all four metric labels", () => {
    render(
      <FundKPIStrip
        aum={1_000_000}
        return24h={0.01}
        returnMtd={0.02}
        returnYtd={0.18}
      />,
    );
    expect(screen.getByText("Fund AUM")).toBeInTheDocument();
    expect(screen.getByText("24h")).toBeInTheDocument();
    expect(screen.getByText("MTD")).toBeInTheDocument();
    expect(screen.getByText("YTD")).toBeInTheDocument();
  });

  it("shows an em dash placeholder for null AUM + null return metrics", () => {
    render(
      <FundKPIStrip
        aum={null}
        return24h={null}
        returnMtd={null}
        returnYtd={null}
      />,
    );
    // AUM and all three return metrics render as em dashes when null
    // (formatPercent(null) === "—"). All four placeholders should be
    // present — exactly one per cell.
    const dashes = screen.getAllByText("—");
    expect(dashes.length).toBe(4);
  });

  it("applies aria-label for the section", () => {
    render(
      <FundKPIStrip
        aum={1_000_000}
        return24h={0.01}
        returnMtd={0.02}
        returnYtd={0.18}
      />,
    );
    expect(screen.getByLabelText("Fund-level metrics")).toBeInTheDocument();
  });
});
