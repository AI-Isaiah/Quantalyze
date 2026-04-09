import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { EditorialHero } from "./EditorialHero";

describe("<EditorialHero>", () => {
  it("renders the headline as h1", () => {
    render(
      <EditorialHero
        headline="Beat BTC on the way up."
        numbers={{
          portfolioTwr: 0.18,
          benchmarkTwr: 0.12,
          portfolioMaxDrawdown: -0.05,
          benchmarkMaxDrawdown: -0.22,
        }}
      />,
    );
    expect(
      screen.getByRole("heading", { level: 1, name: /Beat BTC/ }),
    ).toBeInTheDocument();
  });

  it("renders the four numbers in the hero grid", () => {
    render(
      <EditorialHero
        headline="x"
        numbers={{
          portfolioTwr: 0.18,
          benchmarkTwr: 0.12,
          portfolioMaxDrawdown: -0.05,
          benchmarkMaxDrawdown: -0.22,
        }}
      />,
    );
    expect(screen.getByText("+18.00%")).toBeInTheDocument();
    expect(screen.getByText("+12.00%")).toBeInTheDocument();
    expect(screen.getByText("-5.00%")).toBeInTheDocument();
    expect(screen.getByText("-22.00%")).toBeInTheDocument();
  });

  it("hides the numbers block when all four are null", () => {
    const { container } = render(
      <EditorialHero
        headline="x"
        numbers={{
          portfolioTwr: null,
          benchmarkTwr: null,
          portfolioMaxDrawdown: null,
          benchmarkMaxDrawdown: null,
        }}
      />,
    );
    expect(container.querySelector("dl")).toBeNull();
  });

  it("shows '—' for individual missing values", () => {
    render(
      <EditorialHero
        headline="x"
        numbers={{
          portfolioTwr: 0.18,
          benchmarkTwr: null,
          portfolioMaxDrawdown: -0.05,
          benchmarkMaxDrawdown: null,
        }}
      />,
    );
    const dashes = screen.getAllByText("—");
    expect(dashes.length).toBeGreaterThanOrEqual(2);
  });

  it("renders the descriptor when provided", () => {
    render(
      <EditorialHero
        headline="x"
        descriptor="Exchange-verified allocator portfolio review."
        numbers={{
          portfolioTwr: 0.18,
          benchmarkTwr: 0.12,
          portfolioMaxDrawdown: -0.05,
          benchmarkMaxDrawdown: -0.22,
        }}
      />,
    );
    expect(
      screen.getByText("Exchange-verified allocator portfolio review."),
    ).toBeInTheDocument();
  });

  it("renders the CTA slot", () => {
    render(
      <EditorialHero
        headline="x"
        numbers={{
          portfolioTwr: 0.18,
          benchmarkTwr: 0.12,
          portfolioMaxDrawdown: -0.05,
          benchmarkMaxDrawdown: -0.22,
        }}
        cta={<button type="button">Download IC Report</button>}
      />,
    );
    expect(
      screen.getByRole("button", { name: "Download IC Report" }),
    ).toBeInTheDocument();
  });
});
