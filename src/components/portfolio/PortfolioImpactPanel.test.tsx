import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PortfolioImpactPanel } from "./PortfolioImpactPanel";
import type { SimulatorCandidate } from "@/lib/types";

function buildResponse(
  partial: Partial<SimulatorCandidate> = {},
): SimulatorCandidate {
  return {
    candidate_id: "c1",
    candidate_name: "High Sharpe Strategy",
    portfolio_id: "p1",
    status: "ok",
    overlap_days: 200,
    partial_history: false,
    deltas: {
      sharpe_delta: 0.15,
      dd_delta: 0.02,
      corr_delta: 0.03,
      concentration_delta: 0.05,
    },
    current: {
      sharpe: 1.2,
      max_drawdown: -0.18,
      avg_correlation: 0.45,
      concentration: 0.5,
    },
    proposed: {
      sharpe: 1.35,
      max_drawdown: -0.16,
      avg_correlation: 0.42,
      concentration: 0.45,
    },
    equity_curve_current: [
      { date: "2025-01-01", value: 1.0 },
      { date: "2025-01-02", value: 1.005 },
    ],
    equity_curve_proposed: [
      { date: "2025-01-01", value: 1.0 },
      { date: "2025-01-02", value: 1.008 },
    ],
    ...partial,
  };
}

function mockFetch(impl: () => Promise<Response>) {
  globalThis.fetch = vi.fn(impl) as unknown as typeof fetch;
}

describe("<PortfolioImpactPanel>", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders the loading skeleton while the fetch is in flight", () => {
    mockFetch(
      () =>
        new Promise(() => {
          /* never resolves — keeps loading state */
        }),
    );

    render(
      <PortfolioImpactPanel
        portfolioId="p1"
        candidateStrategyId="c1"
        candidateName="High Sharpe Strategy"
        onClose={() => {}}
      />,
    );

    expect(screen.getByLabelText("Loading portfolio impact")).toBeInTheDocument();
  });

  it("renders all four delta chips after a successful fetch", async () => {
    mockFetch(async () =>
      new Response(JSON.stringify(buildResponse()), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    render(
      <PortfolioImpactPanel
        portfolioId="p1"
        candidateStrategyId="c1"
        candidateName="High Sharpe Strategy"
        onClose={() => {}}
      />,
    );

    await waitFor(() =>
      expect(screen.getByText(/Projected impact/i)).toBeInTheDocument(),
    );

    expect(screen.getByText("Sharpe")).toBeInTheDocument();
    expect(screen.getByText("MaxDD")).toBeInTheDocument();
    expect(screen.getByText("Correlation")).toBeInTheDocument();
    expect(screen.getByText("Concentration")).toBeInTheDocument();
  });

  it("announces improvements through the ARIA live region", async () => {
    mockFetch(async () =>
      new Response(JSON.stringify(buildResponse()), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    render(
      <PortfolioImpactPanel
        portfolioId="p1"
        candidateStrategyId="c1"
        candidateName="High Sharpe Strategy"
        onClose={() => {}}
      />,
    );

    await waitFor(() =>
      expect(
        screen.getByText(/Sharpe improved by \+0\.150/),
      ).toBeInTheDocument(),
    );
  });

  it("renders the partial-history warning when flagged", async () => {
    mockFetch(async () =>
      new Response(
        JSON.stringify(
          buildResponse({ partial_history: true, overlap_days: 40 }),
        ),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      ),
    );

    render(
      <PortfolioImpactPanel
        portfolioId="p1"
        candidateStrategyId="c1"
        candidateName="Short history"
        onClose={() => {}}
      />,
    );

    await waitFor(() =>
      expect(screen.getByText(/Partial history:/)).toBeInTheDocument(),
    );
    expect(screen.getByText(/40 overlapping trading days/)).toBeInTheDocument();
  });

  it("renders a retryable error state on failed fetch", async () => {
    mockFetch(async () =>
      new Response(JSON.stringify({ error: "Simulator service error" }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      }),
    );

    render(
      <PortfolioImpactPanel
        portfolioId="p1"
        candidateStrategyId="c1"
        candidateName="Errored"
        onClose={() => {}}
      />,
    );

    await waitFor(() =>
      expect(screen.getByText("Simulator service error")).toBeInTheDocument(),
    );
    expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
  });

  it("renders the insufficient_data empty state", async () => {
    mockFetch(async () =>
      new Response(
        JSON.stringify(
          buildResponse({
            status: "insufficient_data",
            overlap_days: 10,
            partial_history: true,
            proposed: {
              sharpe: null,
              max_drawdown: null,
              avg_correlation: null,
              concentration: null,
            },
            equity_curve_proposed: [],
          }),
        ),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      ),
    );

    render(
      <PortfolioImpactPanel
        portfolioId="p1"
        candidateStrategyId="c1"
        candidateName="Too short"
        onClose={() => {}}
      />,
    );

    await waitFor(() =>
      expect(
        screen.getByText(/Not enough overlapping history/i),
      ).toBeInTheDocument(),
    );
  });

  it("closes on Escape key", async () => {
    mockFetch(async () =>
      new Response(JSON.stringify(buildResponse()), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    const handleClose = vi.fn();
    render(
      <PortfolioImpactPanel
        portfolioId="p1"
        candidateStrategyId="c1"
        candidateName="High Sharpe Strategy"
        onClose={handleClose}
      />,
    );

    fireEvent.keyDown(document, { key: "Escape" });
    expect(handleClose).toHaveBeenCalled();
  });

  it("closes on backdrop click", () => {
    mockFetch(
      () => new Promise(() => {}),
    );

    const handleClose = vi.fn();
    const { container } = render(
      <PortfolioImpactPanel
        portfolioId="p1"
        candidateStrategyId="c1"
        candidateName="High Sharpe Strategy"
        onClose={handleClose}
      />,
    );

    const dialog = container.querySelector('[role="dialog"]') as HTMLElement;
    expect(dialog).toBeTruthy();
    fireEvent.click(dialog);
    expect(handleClose).toHaveBeenCalled();
  });

  it("renders an aria-label on the close button", async () => {
    mockFetch(async () =>
      new Response(JSON.stringify(buildResponse()), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    render(
      <PortfolioImpactPanel
        portfolioId="p1"
        candidateStrategyId="c1"
        candidateName="High Sharpe Strategy"
        onClose={() => {}}
      />,
    );

    expect(
      screen.getByRole("button", { name: "Close panel" }),
    ).toBeInTheDocument();
  });
});
