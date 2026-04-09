import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { NextFiveMillionCard } from "./NextFiveMillionCard";
import type { OptimizerSuggestionRow } from "@/lib/types";

function suggestion(
  strategy_id: string,
  strategy_name: string,
  score: number,
): OptimizerSuggestionRow {
  return {
    strategy_id,
    strategy_name,
    corr_with_portfolio: 0,
    sharpe_lift: 0,
    dd_improvement: 0,
    score,
  };
}

describe("<NextFiveMillionCard>", () => {
  it("returns null when suggestions is null", () => {
    const { container } = render(
      <NextFiveMillionCard suggestions={null} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("returns null when suggestions is empty", () => {
    const { container } = render(<NextFiveMillionCard suggestions={[]} />);
    expect(container.firstChild).toBeNull();
  });

  it("renders the top 3 suggestions weighted by score", () => {
    render(
      <NextFiveMillionCard
        suggestions={[
          suggestion("a", "Alpha", 0.4),
          suggestion("b", "Beta", 0.3),
          suggestion("c", "Gamma", 0.2),
          suggestion("d", "Delta", 0.1),
        ]}
      />,
    );
    expect(screen.getByText("Alpha")).toBeInTheDocument();
    expect(screen.getByText("Beta")).toBeInTheDocument();
    expect(screen.getByText("Gamma")).toBeInTheDocument();
    expect(screen.queryByText("Delta")).toBeNull();
    expect(screen.getByText("$2.2M")).toBeInTheDocument(); // 5M * 0.4 / 0.9
  });

  it("distributes equally when all scores are zero", () => {
    render(
      <NextFiveMillionCard
        suggestions={[
          suggestion("a", "Alpha", 0),
          suggestion("b", "Beta", 0),
          suggestion("c", "Gamma", 0),
        ]}
      />,
    );
    const cells = screen.getAllByText("$1.7M");
    expect(cells).toHaveLength(3);
  });

  it("respects custom amount", () => {
    render(
      <NextFiveMillionCard
        amount={1_000_000}
        suggestions={[suggestion("a", "Alpha", 1)]}
      />,
    );
    expect(screen.getByText("$1.0M")).toBeInTheDocument();
    expect(
      screen.getByText(/Where would the next \$1.0M go/),
    ).toBeInTheDocument();
  });
});
