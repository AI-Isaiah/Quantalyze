import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { CounterfactualStrip } from "./CounterfactualStrip";

describe("<CounterfactualStrip>", () => {
  it("returns null when portfolio TWR is missing", () => {
    const { container } = render(
      <CounterfactualStrip portfolioTwr={null} benchmarkTwr={0.12} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("returns null when benchmark TWR is missing", () => {
    const { container } = render(
      <CounterfactualStrip portfolioTwr={0.18} benchmarkTwr={null} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders the comparison sentence with default period", () => {
    render(
      <CounterfactualStrip portfolioTwr={0.18} benchmarkTwr={0.12} />,
    );
    expect(screen.getByText(/Had you allocated 12 months ago/)).toBeInTheDocument();
    expect(screen.getByText(/portfolio \+18.00%/)).toBeInTheDocument();
    expect(screen.getByText(/BTC \+12.00%/)).toBeInTheDocument();
  });

  it("supports custom period and benchmark label", () => {
    render(
      <CounterfactualStrip
        portfolioTwr={0.05}
        benchmarkTwr={-0.03}
        period="6 months ago"
        benchmarkLabel="ETH"
      />,
    );
    expect(screen.getByText(/Had you allocated 6 months ago/)).toBeInTheDocument();
    expect(screen.getByText(/ETH -3.00%/)).toBeInTheDocument();
  });
});
