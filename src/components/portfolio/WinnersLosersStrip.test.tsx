import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { WinnersLosersStrip } from "./WinnersLosersStrip";
import type { AttributionRow } from "@/lib/types";

function row(
  strategy_id: string,
  strategy_name: string,
  contribution: number,
): AttributionRow {
  return { strategy_id, strategy_name, contribution, allocation_effect: 0 };
}

describe("<WinnersLosersStrip>", () => {
  it("never unmounts — renders fallback copy when attribution is null", () => {
    // Editorial /demo policy: cards never vanish, only their content does.
    // A null-attribution reload must keep the strip present so layout is
    // stable across refreshes. Regression test for PR 6 review finding C1.
    render(<WinnersLosersStrip attribution={null} />);
    expect(
      screen.getByRole("region", { name: "Winners and losers" }),
    ).toBeInTheDocument();
    const fallbacks = screen.getAllByText(
      /Waiting for the first attribution run/,
    );
    expect(fallbacks).toHaveLength(2);
  });

  it("renders content fallback copy when all contributions are zero", () => {
    render(
      <WinnersLosersStrip
        attribution={[row("a", "Alpha", 0), row("b", "Beta", 0)]}
      />,
    );
    expect(
      screen.getByRole("region", { name: "Winners and losers" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText("No positive contributors yet."),
    ).toBeInTheDocument();
    expect(
      screen.getByText("No detractors this period."),
    ).toBeInTheDocument();
  });

  it("renders winners and losers in two columns", () => {
    render(
      <WinnersLosersStrip
        attribution={[
          row("a", "Alpha", 0.05),
          row("b", "Beta", -0.03),
          row("c", "Gamma", 0.02),
          row("d", "Delta", -0.01),
        ]}
      />,
    );
    expect(screen.getByText("Top contributors")).toBeInTheDocument();
    expect(screen.getByText("Top detractors")).toBeInTheDocument();
    expect(screen.getByText("Alpha")).toBeInTheDocument();
    expect(screen.getByText("Beta")).toBeInTheDocument();
    expect(screen.getByText("+5.00%")).toBeInTheDocument();
    expect(screen.getByText("-3.00%")).toBeInTheDocument();
  });

  it("shows fallback copy when there are no positive contributors", () => {
    render(
      <WinnersLosersStrip
        attribution={[
          row("a", "Alpha", -0.05),
          row("b", "Beta", -0.03),
        ]}
      />,
    );
    expect(screen.getByText("No positive contributors yet.")).toBeInTheDocument();
    expect(screen.getByText("Alpha")).toBeInTheDocument();
  });

  it("shows fallback copy when there are no detractors", () => {
    render(
      <WinnersLosersStrip
        attribution={[
          row("a", "Alpha", 0.05),
          row("b", "Beta", 0.03),
        ]}
      />,
    );
    expect(screen.getByText("No detractors this period.")).toBeInTheDocument();
  });
});
