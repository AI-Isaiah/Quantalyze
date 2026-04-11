import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import {
  FactsheetPreview,
  type FactsheetPreviewMetric,
} from "./FactsheetPreview";

/**
 * Component tests for FactsheetPreview — the shared preview used by the
 * /for-quants landing page (Sprint 1 Task 1.1) and the Sprint 1 Task 1.2
 * wizard preview.
 *
 * These assertions pin the design guardrails from the Task 1.1 design
 * review:
 *   - 6 metrics in a single shared-axis row (not 3x2 cards)
 *   - sparkline is optional (absent when data is missing or has <2 points)
 *   - sample label only renders when explicitly passed (caller opt-in)
 *   - computed timestamp renders when provided
 */

const METRICS: FactsheetPreviewMetric[] = [
  { label: "CAGR", value: "+24.3%", qualifier: "Strong" },
  { label: "Sharpe", value: "1.82", qualifier: "Strong" },
  { label: "Sortino", value: "2.46" },
  { label: "Max Drawdown", value: "-14.2%" },
  { label: "Volatility", value: "12.8%" },
  { label: "Cumulative Return", value: "+158.4%" },
];

describe("FactsheetPreview", () => {
  it("renders the strategy name and subtitle in the header", () => {
    render(
      <FactsheetPreview
        strategyName="Alpha Codename"
        subtitle="SMA crossover · BTC, ETH"
        metrics={METRICS}
      />,
    );
    expect(screen.getByText("Alpha Codename")).toBeInTheDocument();
    expect(screen.getByText("SMA crossover · BTC, ETH")).toBeInTheDocument();
    expect(screen.getByText("Verified by Quantalyze")).toBeInTheDocument();
  });

  it("renders all 6 metric labels and values", () => {
    render(<FactsheetPreview strategyName="X" metrics={METRICS} />);
    for (const m of METRICS) {
      expect(screen.getByText(m.label)).toBeInTheDocument();
      expect(screen.getByText(m.value)).toBeInTheDocument();
    }
    // Pin the 6-metric contract so a 5-metric refactor fails loudly.
    const labelCount = METRICS.reduce(
      (n, m) => n + screen.getAllByText(m.label).length,
      0,
    );
    expect(labelCount).toBe(6);
  });

  it("renders the qualifier text for metrics that have one", () => {
    render(<FactsheetPreview strategyName="X" metrics={METRICS} />);
    // Two metrics have "Strong" — assert at least one qualifier renders.
    expect(screen.getAllByText("Strong").length).toBeGreaterThan(0);
  });

  it("omits the sparkline when sparklineReturns is null", () => {
    render(
      <FactsheetPreview
        strategyName="X"
        metrics={METRICS}
        sparklineReturns={null}
      />,
    );
    expect(screen.queryByText("Equity Curve")).not.toBeInTheDocument();
  });

  it("omits the sparkline when sparklineReturns has fewer than 2 points", () => {
    render(
      <FactsheetPreview
        strategyName="X"
        metrics={METRICS}
        sparklineReturns={[1.0]}
      />,
    );
    expect(screen.queryByText("Equity Curve")).not.toBeInTheDocument();
  });

  it("renders the sparkline label when sparklineReturns has 2+ points", () => {
    render(
      <FactsheetPreview
        strategyName="X"
        metrics={METRICS}
        sparklineReturns={[1.0, 1.1, 1.2]}
      />,
    );
    expect(screen.getByText("Equity Curve")).toBeInTheDocument();
  });

  it("only renders the sample label when explicitly passed", () => {
    const { rerender } = render(
      <FactsheetPreview strategyName="X" metrics={METRICS} />,
    );
    expect(screen.queryByText(/Sample Strategy/)).not.toBeInTheDocument();

    rerender(
      <FactsheetPreview
        strategyName="X"
        metrics={METRICS}
        sampleLabel="Sample Strategy (Demo Data)"
      />,
    );
    expect(screen.getByText("Sample Strategy (Demo Data)")).toBeInTheDocument();
  });

  it("renders the computedAt date caption on the verified variant", () => {
    render(
      <FactsheetPreview
        strategyName="X"
        metrics={METRICS}
        computedAt="2026-04-10T00:00:00Z"
      />,
    );
    // Task 1.2 refactored FactsheetPreview to derive the caption from
    // `verificationState`. The verified variant (the default) now shows
    // "Data from exchange API · <date>" instead of the historic
    // "Data verified from exchange API · <date>" prefix.
    expect(
      screen.getByText(/Data from exchange API/),
    ).toBeInTheDocument();
  });

  describe("verificationState prop (Task 1.2 regression fence)", () => {
    it("defaults to 'verified' with the accent-colored badge", () => {
      render(<FactsheetPreview strategyName="X" metrics={METRICS} />);
      const badge = screen.getByTestId("factsheet-verification-badge");
      expect(badge).toHaveTextContent("Verified by Quantalyze");
      expect(badge).toHaveAttribute("data-verification-state", "verified");
    });

    it("renders the draft badge when verificationState is 'draft'", () => {
      render(
        <FactsheetPreview
          strategyName="X"
          metrics={METRICS}
          verificationState="draft"
        />,
      );
      const badge = screen.getByTestId("factsheet-verification-badge");
      // Pre-ship blocking: wizard must never show "Verified by Quantalyze"
      // before admin review.
      expect(badge).toHaveTextContent("Draft preview · pending review");
      expect(badge).toHaveAttribute("data-verification-state", "draft");
    });

    it("renders the pending badge when verificationState is 'pending'", () => {
      render(
        <FactsheetPreview
          strategyName="X"
          metrics={METRICS}
          verificationState="pending"
        />,
      );
      const badge = screen.getByTestId("factsheet-verification-badge");
      expect(badge).toHaveTextContent("Submitted for review");
      expect(badge).toHaveAttribute("data-verification-state", "pending");
    });

    it("never shows 'Verified by Quantalyze' in the draft state", () => {
      render(
        <FactsheetPreview
          strategyName="X"
          metrics={METRICS}
          verificationState="draft"
        />,
      );
      expect(screen.queryByText("Verified by Quantalyze")).not.toBeInTheDocument();
    });
  });
});
