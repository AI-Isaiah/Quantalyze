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

  it("shows '—' for individual missing values in the correct dd cells", () => {
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
    // Verify the specific null-filled cells rather than a global count,
    // so adding a new "—" elsewhere won't silently pass this assertion.
    const btcTwrLabel = screen.getByText("BTC TWR");
    expect(btcTwrLabel.nextSibling?.textContent).toBe("—");
    const btcDdLabel = screen.getByText("BTC drawdown");
    expect(btcDdLabel.nextSibling?.textContent).toBe("—");
  });

  it("uses a <dl>/<dt>/<dd> structure so the hero numbers form a term list", () => {
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
    // 4 labels → 4 <dt> elements, 4 values → 4 <dd> elements inside one <dl>
    const section = screen.getByRole("region");
    const dl = section.querySelector("dl");
    expect(dl).not.toBeNull();
    expect(dl?.querySelectorAll("dt").length).toBe(4);
    expect(dl?.querySelectorAll("dd").length).toBe(4);
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
