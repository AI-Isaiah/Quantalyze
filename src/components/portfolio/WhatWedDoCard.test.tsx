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

  it("hides the card entirely when sharpe_lift is negative", () => {
    // A negative sharpe_lift recommendation would make the portfolio worse;
    // the card should not render it.
    const { container } = render(
      <WhatWedDoCard suggestions={[suggestion({ sharpe_lift: -0.1 })]} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("hides the card when the optimizer score is NaN", () => {
    const { container } = render(
      <WhatWedDoCard suggestions={[suggestion({ score: Number.NaN })]} />,
    );
    expect(container.firstChild).toBeNull();
  });

  // 166.1 D7 (founder 2026-09-26) / round-1 SFH HIGH-1: the optimizer emits a
  // null correlation when the portfolio does not disperse (a constant-yield
  // book). Coerced to 0 it rendered "reduce average correlation toward 0.00",
  // a perfect-diversifier claim about a statistic that does not exist.
  it("states no correlation sentence when corr_with_portfolio is null", () => {
    render(
      <WhatWedDoCard
        suggestions={[suggestion({ corr_with_portfolio: null, sharpe_lift: 0.2 })]}
      />,
    );
    expect(screen.getByText(/lift Sharpe by/)).toBeInTheDocument();
    expect(screen.queryByText(/average correlation/)).toBeNull();
    expect(screen.queryByText(/toward 0\.00/)).toBeNull();
  });

  it("keeps the card but states no Sharpe sentence when sharpe_lift is null", () => {
    render(
      <WhatWedDoCard
        suggestions={[
          suggestion({ sharpe_lift: null, corr_with_portfolio: null, dd_improvement: 0.012 }),
        ]}
      />,
    );
    expect(screen.getByText("Vega Volatility Harvester")).toBeInTheDocument();
    expect(screen.queryByText(/lift Sharpe/)).toBeNull();
    expect(screen.queryByText(/average correlation/)).toBeNull();
    expect(screen.getByText(/improve drawdown by/)).toBeInTheDocument();
  });

  it("hides the card when sharpe_lift is non-finite", () => {
    const { container } = render(
      <WhatWedDoCard
        suggestions={[suggestion({ sharpe_lift: Number.POSITIVE_INFINITY })]}
      />,
    );
    expect(container.firstChild).toBeNull();
  });
});
