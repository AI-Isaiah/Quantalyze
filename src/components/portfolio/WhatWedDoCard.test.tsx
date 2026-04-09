import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { WhatWedDoCard } from "./WhatWedDoCard";
import type { OptimizerSuggestionRow } from "@/lib/types";

function suggestion(
  partial: Partial<OptimizerSuggestionRow> = {},
): OptimizerSuggestionRow {
  return {
    strategy_id: "x",
    strategy_name: "Vega Volatility Harvester",
    corr_with_portfolio: 0.08,
    sharpe_lift: 0.18,
    dd_improvement: 0.012,
    score: 0.142,
    ...partial,
  };
}

describe("<WhatWedDoCard>", () => {
  it("returns null when suggestions is null", () => {
    const { container } = render(<WhatWedDoCard suggestions={null} />);
    expect(container.firstChild).toBeNull();
  });

  it("returns null when suggestions is empty", () => {
    const { container } = render(<WhatWedDoCard suggestions={[]} />);
    expect(container.firstChild).toBeNull();
  });

  it("renders the top suggestion's strategy name", () => {
    render(<WhatWedDoCard suggestions={[suggestion()]} />);
    expect(screen.getByText("Vega Volatility Harvester")).toBeInTheDocument();
  });

  it("includes the sharpe lift framing", () => {
    render(<WhatWedDoCard suggestions={[suggestion({ sharpe_lift: 0.2 })]} />);
    expect(screen.getByText(/lift Sharpe by/)).toBeInTheDocument();
  });

  it("falls back to a generic 'diversify' phrase when no win lines fire", () => {
    render(
      <WhatWedDoCard
        suggestions={[
          suggestion({
            sharpe_lift: 0,
            corr_with_portfolio: 0.5,
            dd_improvement: 0,
          }),
        ]}
      />,
    );
    expect(screen.getByText(/diversify the portfolio/)).toBeInTheDocument();
  });
});
