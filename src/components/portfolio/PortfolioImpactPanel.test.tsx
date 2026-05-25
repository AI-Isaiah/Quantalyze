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

  // M-0970 (audit-2026-05-07) — the error-state test above asserts the
  // Retry button is PRESENT but never clicks it. For a non-429 error the
  // button must be enabled and clicking it must re-fire fetchImpact and
  // recover. A regression that breaks the useCallback memoization or fails
  // to re-enable the button would slip past the present-only assertion.
  it("M-0970: clicking Retry on a 500 re-fires the fetch and recovers", async () => {
    let call = 0;
    mockFetch(async () => {
      call += 1;
      if (call === 1) {
        return new Response(
          JSON.stringify({ error: "Simulator service error" }),
          { status: 500, headers: { "Content-Type": "application/json" } },
        );
      }
      return new Response(JSON.stringify(buildResponse()), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });

    render(
      <PortfolioImpactPanel
        portfolioId="p1"
        candidateStrategyId="c1"
        candidateName="Recoverable"
        onClose={() => {}}
      />,
    );

    // First fetch fails → error state with an ENABLED Retry button (non-429).
    const retryButton = await screen.findByRole("button", { name: "Retry" });
    expect(retryButton).not.toBeDisabled();

    fireEvent.click(retryButton);

    // Second fetch succeeds → the deltas section renders.
    await waitFor(() =>
      expect(
        screen.getByRole("region", { name: "Portfolio impact deltas" }),
      ).toBeInTheDocument(),
    );
    expect(call).toBe(2);
  });

  it("disables the retry button and shows a countdown on 429", async () => {
    mockFetch(async () =>
      new Response(
        JSON.stringify({
          error: "Too many simulations. Try again later.",
          retryAfter: 2520,
        }),
        {
          status: 429,
          headers: {
            "Content-Type": "application/json",
            "Retry-After": "2520",
          },
        },
      ),
    );

    render(
      <PortfolioImpactPanel
        portfolioId="p1"
        candidateStrategyId="c1"
        candidateName="Rate limited"
        onClose={() => {}}
      />,
    );

    const retryButton = await screen.findByRole("button", { name: "Retry" });
    expect(retryButton).toBeDisabled();
    // 2520s = 42 min — surfaced to the user so they know when to come back.
    expect(screen.getByText(/Try again in 42 min/)).toBeInTheDocument();
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

  // -------------------------------------------------------------------------
  // H-1128 — NonOkState copy for already_in_portfolio + empty_portfolio
  // -------------------------------------------------------------------------

  function nonOkResponse(status: "already_in_portfolio" | "empty_portfolio") {
    // The non-ok branches expose no deltas / proposed metrics / proposed curve.
    return buildResponse({
      status,
      overlap_days: 0,
      partial_history: false,
      proposed: {
        sharpe: null,
        max_drawdown: null,
        avg_correlation: null,
        concentration: null,
      },
      equity_curve_proposed: [],
    });
  }

  it("H-1128: renders the already_in_portfolio empty state copy with no delta chips", async () => {
    mockFetch(async () =>
      new Response(JSON.stringify(nonOkResponse("already_in_portfolio")), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    render(
      <PortfolioImpactPanel
        portfolioId="p1"
        candidateStrategyId="c1"
        candidateName="Already held"
        onClose={() => {}}
      />,
    );

    await waitFor(() =>
      expect(
        screen.getByText(/already in your portfolio/i),
      ).toBeInTheDocument(),
    );
    // NonOkState must NOT render the DeltaHero / chips.
    expect(screen.queryByText("Projected impact")).toBeNull();
    expect(screen.queryByText("Sharpe")).toBeNull();
    expect(screen.queryByText(/Not enough overlapping history/i)).toBeNull();
  });

  it("H-1128: renders the empty_portfolio empty state copy", async () => {
    mockFetch(async () =>
      new Response(JSON.stringify(nonOkResponse("empty_portfolio")), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    render(
      <PortfolioImpactPanel
        portfolioId="p1"
        candidateStrategyId="c1"
        candidateName="No holdings"
        onClose={() => {}}
      />,
    );

    await waitFor(() =>
      expect(
        screen.getByText(/Your portfolio has no strategies yet/i),
      ).toBeInTheDocument(),
    );
    expect(screen.queryByText("Projected impact")).toBeNull();
  });

  // -------------------------------------------------------------------------
  // H-1129 — buildDeltaAnnouncement regressed / unchanged paths (ARIA live)
  // -------------------------------------------------------------------------

  it("H-1129: announces a regression through the ARIA live region", async () => {
    mockFetch(async () =>
      new Response(
        JSON.stringify(
          buildResponse({
            deltas: {
              sharpe_delta: -0.15,
              dd_delta: -0.02,
              corr_delta: -0.03,
              concentration_delta: -0.05,
            },
          }),
        ),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );

    render(
      <PortfolioImpactPanel
        portfolioId="p1"
        candidateStrategyId="c1"
        candidateName="Worse Strategy"
        onClose={() => {}}
      />,
    );

    // value < 0 → "regressed by -0.150" (NOT "improved").
    await waitFor(() =>
      expect(
        screen.getByText(/Sharpe regressed by -0\.150/),
      ).toBeInTheDocument(),
    );
    const status = screen.getByRole("status");
    expect(status.textContent).toMatch(/Sharpe regressed by -0\.150/);
    expect(status.textContent).not.toMatch(/Sharpe improved/);
  });

  it("H-1129: announces 'unchanged' when a delta is exactly zero", async () => {
    mockFetch(async () =>
      new Response(
        JSON.stringify(
          buildResponse({
            deltas: {
              sharpe_delta: 0,
              dd_delta: 0,
              corr_delta: 0,
              concentration_delta: 0,
            },
          }),
        ),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );

    render(
      <PortfolioImpactPanel
        portfolioId="p1"
        candidateStrategyId="c1"
        candidateName="Flat Strategy"
        onClose={() => {}}
      />,
    );

    await waitFor(() =>
      expect(screen.getByText(/Sharpe unchanged/)).toBeInTheDocument(),
    );
    const status = screen.getByRole("status");
    expect(status.textContent).toMatch(/Sharpe unchanged/);
  });

  // -------------------------------------------------------------------------
  // H-1130 — EquityOverlay gap handling + empty-axis branches
  // -------------------------------------------------------------------------

  it("H-1130: renders a gapped proposed path when the proposed curve is sparser than current", async () => {
    const current = [
      { date: "2025-01-01", value: 1.0 },
      { date: "2025-01-02", value: 1.01 },
      { date: "2025-01-03", value: 1.02 },
      { date: "2025-01-04", value: 1.03 },
      { date: "2025-01-05", value: 1.04 },
    ];
    // Proposed only covers the last two dates → the first three merged points
    // have proposed === null, forcing buildPath's gap (started=false) branch.
    const proposed = [
      { date: "2025-01-04", value: 1.05 },
      { date: "2025-01-05", value: 1.07 },
    ];

    mockFetch(async () =>
      new Response(
        JSON.stringify(
          buildResponse({
            equity_curve_current: current,
            equity_curve_proposed: proposed,
          }),
        ),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );

    const { container } = render(
      <PortfolioImpactPanel
        portfolioId="p1"
        candidateStrategyId="c1"
        candidateName="Sparse proposed"
        onClose={() => {}}
      />,
    );

    await waitFor(() =>
      expect(
        screen.getByLabelText("Portfolio equity curve: current vs proposed"),
      ).toBeInTheDocument(),
    );

    const paths = Array.from(container.querySelectorAll("path"));
    expect(paths.length).toBeGreaterThanOrEqual(2);
    // The proposed line (teal #1B6B5A) starts with a fresh M segment after the
    // null gap. Its path begins partway across the x-axis (x > left padding 8).
    const proposedPath = paths.find(
      (p) => p.getAttribute("stroke") === "#1B6B5A",
    );
    expect(proposedPath).toBeTruthy();
    const d = proposedPath!.getAttribute("d") ?? "";
    expect(d.startsWith("M")).toBe(true);
    const firstX = Number(d.slice(1).split(",")[0]);
    expect(firstX).toBeGreaterThan(8);
  });

  it("H-1130: renders the no-data state when both equity curves are empty", async () => {
    mockFetch(async () =>
      new Response(
        JSON.stringify(
          buildResponse({
            equity_curve_current: [],
            equity_curve_proposed: [],
          }),
        ),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );

    render(
      <PortfolioImpactPanel
        portfolioId="p1"
        candidateStrategyId="c1"
        candidateName="No curves"
        onClose={() => {}}
      />,
    );

    await waitFor(() =>
      expect(screen.getByText(/No equity history available/i)).toBeInTheDocument(),
    );
  });

  // -------------------------------------------------------------------------
  // H-1131 — abort-on-unmount: no setState-after-unmount warning
  // -------------------------------------------------------------------------

  it("H-1131: aborts the in-flight fetch on unmount without a setState-after-unmount warning", async () => {
    // A fetch that resolves only when the AbortController fires, mirroring a
    // real in-flight request that is cancelled on cleanup.
    let abortListenerInstalled = false;
    mockFetch(
      (input?: RequestInfo | URL, init?: RequestInit) =>
        new Promise<Response>((resolve, reject) => {
          const signal = init?.signal;
          if (signal) {
            abortListenerInstalled = true;
            signal.addEventListener("abort", () => {
              reject(
                new DOMException("The operation was aborted.", "AbortError"),
              );
            });
          }
        }) as unknown as ReturnType<typeof fetch>,
    );

    const errorSpy = vi.spyOn(console, "error");

    const { unmount } = render(
      <PortfolioImpactPanel
        portfolioId="p1"
        candidateStrategyId="c1"
        candidateName="Rapid close"
        onClose={() => {}}
      />,
    );

    // Fetch is in flight (never resolves on its own); unmount triggers abort.
    expect(abortListenerInstalled).toBe(true);
    unmount();

    // Give any rejected promise microtasks a chance to flush.
    await Promise.resolve();
    await Promise.resolve();

    // No "Can't perform a React state update on an unmounted component" or
    // act() warnings should have been logged.
    const warned = errorSpy.mock.calls.some((call) =>
      call.some(
        (arg) =>
          typeof arg === "string" &&
          /unmounted|not wrapped in act|state update/i.test(arg),
      ),
    );
    expect(warned).toBe(false);
  });

  // -------------------------------------------------------------------------
  // H-1132 — formatDelta sign convention through the rendered chips
  // -------------------------------------------------------------------------

  it("H-1132: renders a negative ratio delta with no '+' prefix and the negative color", async () => {
    mockFetch(async () =>
      new Response(
        JSON.stringify(
          buildResponse({
            deltas: {
              sharpe_delta: -0.15,
              dd_delta: 0.02,
              corr_delta: 0.03,
              concentration_delta: 0.05,
            },
          }),
        ),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );

    render(
      <PortfolioImpactPanel
        portfolioId="p1"
        candidateStrategyId="c1"
        candidateName="Neg sharpe"
        onClose={() => {}}
      />,
    );

    const value = await screen.findByText("-0.150");
    expect(value).toBeInTheDocument();
    expect(value.className).toContain("text-negative");
  });

  it("H-1132: renders a zero ratio delta with the '±' prefix and neutral color", async () => {
    mockFetch(async () =>
      new Response(
        JSON.stringify(
          buildResponse({
            deltas: {
              sharpe_delta: 0,
              dd_delta: 0.02,
              corr_delta: 0.03,
              concentration_delta: 0.05,
            },
          }),
        ),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );

    render(
      <PortfolioImpactPanel
        portfolioId="p1"
        candidateStrategyId="c1"
        candidateName="Zero sharpe"
        onClose={() => {}}
      />,
    );

    const value = await screen.findByText("±0.000");
    expect(value).toBeInTheDocument();
    expect(value.className).toContain("text-text-secondary");
  });

  it("H-1132: formats a percent delta (MaxDD) as a percentage with a '+' prefix", async () => {
    mockFetch(async () =>
      new Response(
        JSON.stringify(
          buildResponse({
            deltas: {
              sharpe_delta: 0.15,
              dd_delta: 0.025,
              corr_delta: 0.03,
              concentration_delta: 0.05,
            },
          }),
        ),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );

    render(
      <PortfolioImpactPanel
        portfolioId="p1"
        candidateStrategyId="c1"
        candidateName="MaxDD percent"
        onClose={() => {}}
      />,
    );

    expect(await screen.findByText("+2.50%")).toBeInTheDocument();
  });

  // -------------------------------------------------------------------------
  // H-1133 — formatRetryAfter boundaries (seconds / minutes / hours)
  // -------------------------------------------------------------------------

  function rateLimited(retryAfter: number) {
    return new Response(
      JSON.stringify({
        error: "Too many simulations. Try again later.",
        retryAfter,
      }),
      {
        status: 429,
        headers: {
          "Content-Type": "application/json",
          "Retry-After": String(retryAfter),
        },
      },
    );
  }

  it("H-1133: formats a sub-60s retry as seconds", async () => {
    mockFetch(async () => rateLimited(30));

    render(
      <PortfolioImpactPanel
        portfolioId="p1"
        candidateStrategyId="c1"
        candidateName="Fast recovery"
        onClose={() => {}}
      />,
    );

    expect(await screen.findByText(/Try again in 30s/)).toBeInTheDocument();
  });

  it("H-1133: clamps a fractional sub-second retry to 1s (Math.max(1, ...))", async () => {
    mockFetch(async () => rateLimited(0.5));

    render(
      <PortfolioImpactPanel
        portfolioId="p1"
        candidateStrategyId="c1"
        candidateName="Sub-second"
        onClose={() => {}}
      />,
    );

    expect(await screen.findByText(/Try again in 1s/)).toBeInTheDocument();
  });

  it("H-1133: formats an exactly-3600s retry as 1h (not 0h)", async () => {
    mockFetch(async () => rateLimited(3600));

    render(
      <PortfolioImpactPanel
        portfolioId="p1"
        candidateStrategyId="c1"
        candidateName="One hour"
        onClose={() => {}}
      />,
    );

    expect(await screen.findByText(/Try again in 1h/)).toBeInTheDocument();
  });

  it("H-1133: formats a 7200s retry as 2h", async () => {
    mockFetch(async () => rateLimited(7200));

    render(
      <PortfolioImpactPanel
        portfolioId="p1"
        candidateStrategyId="c1"
        candidateName="Two hours"
        onClose={() => {}}
      />,
    );

    expect(await screen.findByText(/Try again in 2h/)).toBeInTheDocument();
  });
});
