import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { CustomKpiStrip } from "./CustomKpiStrip";
import { NotesWidget } from "./NotesWidget";
import { QuickActions } from "./QuickActions";

const baseProps = { timeframe: "YTD", width: 6, height: 3 };

// ---------------------------------------------------------------------------
// CustomKpiStrip
// ---------------------------------------------------------------------------

describe("CustomKpiStrip", () => {
  it("renders all four KPI labels", () => {
    render(<CustomKpiStrip data={{}} {...baseProps} />);
    expect(screen.getByText("TWR")).toBeInTheDocument();
    expect(screen.getByText("Sharpe")).toBeInTheDocument();
    expect(screen.getByText("Max DD")).toBeInTheDocument();
    expect(screen.getByText("CAGR")).toBeInTheDocument();
  });

  it("renders formatted values from analytics", () => {
    render(
      <CustomKpiStrip
        data={{
          analytics: { twr: 0.15, sharpe: 1.2, max_drawdown: -0.08, cagr: 0.12 },
        }}
        {...baseProps}
      />,
    );
    // TWR = +15.00%
    expect(screen.getByText("+15.00%")).toBeInTheDocument();
  });

  it("renders dash for null values", () => {
    render(<CustomKpiStrip data={{}} {...baseProps} />);
    const dashes = screen.getAllByText("\u2014"); // em dash
    expect(dashes.length).toBe(4);
  });
});

// ---------------------------------------------------------------------------
// NotesWidget
// ---------------------------------------------------------------------------

describe("NotesWidget", () => {
  it("renders textarea with placeholder", () => {
    render(<NotesWidget data={{}} {...baseProps} />);
    const textarea = screen.getByPlaceholderText(
      "Personal portfolio notes. Persistence coming soon.",
    );
    expect(textarea).toBeInTheDocument();
  });

  it("shows reset warning text", () => {
    render(<NotesWidget data={{}} {...baseProps} />);
    expect(screen.getByText("Notes reset on page reload")).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// QuickActions
// ---------------------------------------------------------------------------

describe("QuickActions", () => {
  it("renders three action buttons/links", () => {
    render(
      <QuickActions
        data={{ portfolio: { id: "test-123" } }}
        {...baseProps}
      />,
    );
    expect(screen.getByText("Recompute")).toBeInTheDocument();
    expect(screen.getByText("Export PDF")).toBeInTheDocument();
    expect(screen.getByText("Share")).toBeInTheDocument();
  });

  it("has Recompute button disabled", () => {
    render(
      <QuickActions data={{ portfolio: { id: "p1" } }} {...baseProps} />,
    );
    const btn = screen.getByText("Recompute").closest("button");
    expect(btn).toBeDisabled();
  });

  it("links Export PDF to correct URL", () => {
    render(
      <QuickActions data={{ portfolio: { id: "abc" } }} {...baseProps} />,
    );
    const link = screen.getByText("Export PDF").closest("a");
    expect(link).toHaveAttribute("href", "/api/portfolio-pdf/abc");
  });
});
