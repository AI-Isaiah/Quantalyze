import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PortfolioImpactPanel, formatDelta, gateSimulatorDeltas } from "./PortfolioImpactPanel";
import type { SimulatorCandidate } from "@/lib/types";
import type { SimulatorResponseOk } from "@/lib/api/simulatorSchema";
import { widenedShortNote, widenedWithheldReason } from "@/lib/figure-gate";

function buildResponse(
  partial: Partial<SimulatorCandidate> = {},
): SimulatorCandidate {
  return {
    candidate_id: "c1",
    candidate_name: "High Sharpe Strategy",
    portfolio_id: "p1",
    status: "ok",
    overlap_days: 200,
    // 194 M3: the producer's risk clock. Absent means the Sharpe change is withheld.
    annualization_periods: 252,
    partial_history: false,
    current_metrics_reliable: true,
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
  // stubGlobal, not `globalThis.fetch = …`: only a stub is undone by
  // `unstubGlobals: true` (vitest.config.ts) / the `vi.unstubAllGlobals()`
  // below. A direct assignment leaks this mock to every later file in the
  // worker.
  vi.stubGlobal("fetch", vi.fn(impl) as unknown as typeof fetch);
}

describe("<PortfolioImpactPanel>", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    // A leaked global stub is this repo's known CI-only failure mode (CI Node 22
    // vs local Node 25). This fence used to be inert prose — the file assigned
    // `globalThis.fetch` directly, which `vi.unstubAllGlobals()` cannot see —
    // so `mockFetch` now installs a real stub and this line does real work.
    vi.unstubAllGlobals();
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

    expect(screen.getByLabelText("Loading allocation impact")).toBeInTheDocument();
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
    // 201 D-01: the three registered labels are Term triggers; Concentration has no entry.
    expect(screen.getByText("Sharpe")).toHaveAttribute("data-term", "sharpe");
    expect(screen.getByText("MaxDD")).toHaveAttribute("data-term", "max_drawdown");
    expect(screen.getByText("Correlation")).toHaveAttribute("data-term", "correlation");
    expect(screen.getByText("Concentration")).not.toHaveAttribute("data-term");
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

    // NEW-C11-07: magnitude-only (no sign prefix) — the word "improved" carries direction.
    await waitFor(() =>
      expect(
        screen.getByText(/Sharpe improved by 0\.150/),
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
    // NEW-C11-04: window alignment (C11-03) shipped — both sides are now scored
    // over the same overlap window. The banner must NOT claim they "mix two
    // different periods" / use "your full history"; it must say both are
    // measured over the shorter overlap window. Fails against the pre-fix copy.
    expect(screen.queryByText(/use your full history/i)).toBeNull();
    expect(screen.queryByText(/mix two different periods/i)).toBeNull();
    expect(
      screen.getByText(/measured over this shorter overlap window/i),
    ).toBeInTheDocument();
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
        screen.getByRole("region", { name: "Allocation impact deltas" }),
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

  it("B20: honors an HTTP-date Retry-After header (no body.retryAfter) — disables retry", async () => {
    // Pre-B20 the header was parsed with raw Number(), so an RFC 9110 HTTP-date
    // form (which Vercel edge / Upstash may emit) → NaN → retryAfter undefined →
    // the Retry button stayed ENABLED and a re-click just re-429'd. The shared
    // parser resolves the date against the response's own Date header.
    mockFetch(async () =>
      new Response(JSON.stringify({ error: "Too many simulations." }), {
        status: 429,
        headers: {
          "Content-Type": "application/json",
          Date: "Wed, 21 Oct 2026 07:28:00 GMT",
          "Retry-After": "Wed, 21 Oct 2026 07:30:00 GMT", // +120s
        },
      }),
    );

    render(
      <PortfolioImpactPanel
        portfolioId="p1"
        candidateStrategyId="c1"
        candidateName="HTTP-date limited"
        onClose={() => {}}
      />,
    );

    const retryButton = await screen.findByRole("button", { name: "Retry" });
    expect(retryButton).toBeDisabled();
    expect(screen.getByText(/Try again in 2 min/)).toBeInTheDocument();
  });

  // ---------------------------------------------------------------------------
  // 140.3-09 / SEAMUX-06 (B-23) — the breaker's 503 drives the countdown too.
  //
  // The `Retry-After` read used to sit INSIDE `if (res.status === 429)`, so every
  // wait `/api/simulator` published on a 503 (the breaker short-circuit's
  // `String(err.retryAfterS)`, and the fail-CLOSED limiter-misconfigured arm) was
  // discarded. Re-gating the read on `res.status === 429` must redden the 503
  // cases below WHILE the 429 cases above stay green — that is mutation M65, and
  // it is what proves the two statuses are independently covered rather than one
  // shared assertion standing in for both.
  //
  // ⚠️ This component is the ONLY seam-route `Retry-After` reader on the client.
  // The complete reader class is three sites; the other two — `useMandateAutoSave`
  // (/api/preferences) and `StarToggle` (/api/watchlist/*) — do not call a seam
  // route and are deliberately untouched.
  // ---------------------------------------------------------------------------
  it("[140.3-09] a breaker 503 carrying Retry-After disables retry and drives the countdown", async () => {
    // The exact shape `/api/simulator`'s CircuitOpenError arm emits: a 503 whose
    // wait lives ONLY in the header — there is no body `retryAfter` on that path.
    mockFetch(async () =>
      new Response(
        JSON.stringify({
          error: "Our service is temporarily unavailable.",
          code: "CIRCUIT_OPEN",
        }),
        {
          status: 503,
          headers: {
            "Content-Type": "application/json",
            "Retry-After": "30",
          },
        },
      ),
    );

    render(
      <PortfolioImpactPanel
        portfolioId="p1"
        candidateStrategyId="c1"
        candidateName="Breaker open"
        onClose={() => {}}
      />,
    );

    const retryButton = await screen.findByRole("button", { name: "Retry" });
    expect(retryButton).toBeDisabled();
    expect(screen.getByText(/Try again in 30s/)).toBeInTheDocument();
    // The server's own sentence still reaches the user — the wait is additive
    // to the copy, it does not replace it with the throttle sentence.
    expect(
      screen.getByText("Our service is temporarily unavailable."),
    ).toBeInTheDocument();
    expect(screen.queryByText(/Too many simulations/)).toBeNull();
  });

  it("[140.3-09] a 503 with an HTTP-DATE Retry-After yields a finite wait, not NaN", async () => {
    // The ONE parser handles the RFC 9110 date form against the response's own
    // Date header. A raw `Number(header)` here would be NaN, `isRateLimited`
    // would be false, and the Retry button would stay ENABLED during an outage
    // the server had already dated — the B20 defect, re-opened at a new status.
    mockFetch(async () =>
      new Response(JSON.stringify({ error: "Service unavailable." }), {
        status: 503,
        headers: {
          "Content-Type": "application/json",
          Date: "Wed, 21 Oct 2026 07:28:00 GMT",
          "Retry-After": "Wed, 21 Oct 2026 07:30:00 GMT", // +120s
        },
      }),
    );

    render(
      <PortfolioImpactPanel
        portfolioId="p1"
        candidateStrategyId="c1"
        candidateName="Breaker open, dated"
        onClose={() => {}}
      />,
    );

    const retryButton = await screen.findByRole("button", { name: "Retry" });
    expect(retryButton).toBeDisabled();
    expect(screen.getByText(/Try again in 2 min/)).toBeInTheDocument();
    expect(screen.queryByText(/NaN/)).toBeNull();
  });

  it("[140.3-09] a 503 with NO Retry-After renders the error state with retry ENABLED and no countdown", async () => {
    // TRAP-3: absence of a header must not become a fabricated duration. The
    // surface must say nothing about timing rather than invent a wait — and the
    // Retry control stays usable, because nobody told us to wait.
    mockFetch(async () =>
      new Response(JSON.stringify({ error: "Service unavailable." }), {
        status: 503,
        headers: { "Content-Type": "application/json" },
      }),
    );

    render(
      <PortfolioImpactPanel
        portfolioId="p1"
        candidateStrategyId="c1"
        candidateName="Breaker open, no header"
        onClose={() => {}}
      />,
    );

    const retryButton = await screen.findByRole("button", { name: "Retry" });
    expect(retryButton).toBeEnabled();
    expect(screen.getByText("Service unavailable.")).toBeInTheDocument();
    expect(screen.queryByText(/Try again in/)).toBeNull();
    // Specifically NOT a zero-countdown, which is what a `?? 0` default would
    // have produced and would read as "retry now" beside a dead service.
    expect(screen.queryByText(/Try again in 0/)).toBeNull();
  });

  it("[140.3-09] ANTI-REGRESSION: the 429 path keeps body-over-header precedence", async () => {
    // Hoisting the read must not disturb B20's precedence rule. The body says
    // 300s and the header says 30s; the body must win, exactly as before.
    mockFetch(async () =>
      new Response(
        JSON.stringify({ error: "Too many simulations.", retryAfter: 300 }),
        {
          status: 429,
          headers: {
            "Content-Type": "application/json",
            "Retry-After": "30",
          },
        },
      ),
    );

    render(
      <PortfolioImpactPanel
        portfolioId="p1"
        candidateStrategyId="c1"
        candidateName="Body wins"
        onClose={() => {}}
      />,
    );

    const retryButton = await screen.findByRole("button", { name: "Retry" });
    expect(retryButton).toBeDisabled();
    expect(screen.getByText(/Try again in 5 min/)).toBeInTheDocument();
    expect(screen.queryByText(/Try again in 30s/)).toBeNull();
  });

  it("[140.3-09] ANTI-REGRESSION: a 500 with no wait still throws to the generic error path", async () => {
    // The new `retryAfter !== undefined` arm must not swallow ordinary failures.
    // A 500 with no header still reaches the outer catch and its operator log.
    const consoleSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    mockFetch(async () =>
      new Response(JSON.stringify({ error: "Simulation failed." }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      }),
    );

    render(
      <PortfolioImpactPanel
        portfolioId="p1"
        candidateStrategyId="c1"
        candidateName="Plain 500"
        onClose={() => {}}
      />,
    );

    expect(await screen.findByText("Simulation failed.")).toBeInTheDocument();
    expect(
      await screen.findByRole("button", { name: "Retry" }),
    ).toBeEnabled();
    expect(consoleSpy).toHaveBeenCalledWith(
      "[PortfolioImpactPanel] simulate impact failed",
      expect.anything(),
    );
    consoleSpy.mockRestore();
  });

  it("renders the insufficient_data empty state", async () => {
    mockFetch(async () =>
      new Response(
        JSON.stringify(
          buildResponse({
            status: "insufficient_data",
            overlap_days: 10,
            partial_history: true,
            // PR-3+4 H-1142: the typed discriminated union narrows
            // proposed/deltas/curves OFF non-ok branches — override-emitting
            // them here is a TS type error against the narrowed Partial.
            // The actual wire shape keeps Python's _empty_result nulls; the
            // schema's non-ok branches stay .passthrough() to accept them.
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
    // PR-3+4 H-1142: the typed union narrows those keys OFF the non-ok branch
    // — explicitly overriding them is a TS type error against the narrowed
    // Partial. The schema keeps .passthrough() on non-ok so Python's
    // _empty_result still parses; this fixture stays clean to mirror the
    // contract the TS reader sees.
    return buildResponse({
      status,
      overlap_days: 0,
      partial_history: false,
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
        screen.getByText(/already in your allocation/i),
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
        screen.getByText(/Your allocation has no strategies yet/i),
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

    // NEW-C11-07: value < 0 → "regressed by 0.150" (magnitude only, no double-negative).
    await waitFor(() =>
      expect(
        screen.getByText(/Sharpe regressed by 0\.150/),
      ).toBeInTheDocument(),
    );
    const status = screen.getByRole("status");
    expect(status.textContent).toMatch(/Sharpe regressed by 0\.150/);
    // Must NOT use double-negative "-0.150" nor "improved".
    expect(status.textContent).not.toMatch(/regressed by -/);
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

  // 166.1 D7 (founder 2026-09-26) / round-1 SFH HIGH-2: a constant-yield or
  // all-zero candidate (or book) leaves the correlation or the Sharpe delta
  // undefined. The producer now emits null there instead of 0.0, and the panel
  // must say "not computable" and show "—", never "unchanged".
  it("166.1 D7: a null Sharpe and Correlation delta read 'not computable', never 'unchanged'", async () => {
    mockFetch(async () =>
      new Response(
        JSON.stringify(
          buildResponse({
            deltas: {
              sharpe_delta: null,
              dd_delta: 0.01,
              corr_delta: null,
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
        candidateName="Constant Yield"
        onClose={() => {}}
      />,
    );

    await waitFor(() =>
      expect(screen.getByText(/Sharpe not computable/)).toBeInTheDocument(),
    );
    const status = screen.getByRole("status");
    expect(status.textContent).toMatch(/Correlation not computable/);
    expect(status.textContent).not.toMatch(/Sharpe unchanged|Correlation unchanged/);
    expect(screen.getAllByText("—").length).toBeGreaterThanOrEqual(2);
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
        screen.getByLabelText("Allocation equity curve: current vs proposed"),
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

  // 170.6 D-02 (founder, 2026-10-13): a delta that rounds to zero prints UNSIGNED, so the "±"
  // this case used to pin at an exact zero is replaced by "0.000". The neutral color is kept, and
  // a null delta still prints "—", so "no impact" and "not computable" stay distinct.
  it("H-1132 / D-02: renders a zero ratio delta unsigned ('0.000') and neutral color", async () => {
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

    const value = await screen.findByText("0.000");
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

  // -------------------------------------------------------------------------
  // NEW-C11-05 — degenerate ok row (overlap_days<30 or all-null deltas) renders
  // the fallback copy, not ±0 chips as a confident projection.
  // -------------------------------------------------------------------------

  it("NEW-C11-05: ok row with overlap_days<30 renders fallback copy, not chips", async () => {
    // Simulate a degenerate ok row that slips through schema validation
    // (e.g. producer sends overlap_days=5 with status="ok").
    mockFetch(async () =>
      new Response(
        JSON.stringify(
          buildResponse({
            status: "ok",
            overlap_days: 5,
            partial_history: true,
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
        candidateName="Degenerate ok"
        onClose={() => {}}
      />,
    );

    await waitFor(() =>
      expect(
        screen.getByText(/Not enough overlapping history/i),
      ).toBeInTheDocument(),
    );
    // Must NOT render the delta chips as a confident projection.
    expect(screen.queryByText("Projected impact")).toBeNull();
    expect(screen.queryByText("0.000")).toBeNull();
  });

  it("NEW-C11-05: ok row with all-null deltas renders fallback copy, not ±0 chips", async () => {
    mockFetch(async () =>
      new Response(
        JSON.stringify(
          buildResponse({
            deltas: {
              sharpe_delta: null,
              dd_delta: null,
              corr_delta: null,
              concentration_delta: null,
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
        candidateName="All null deltas"
        onClose={() => {}}
      />,
    );

    await waitFor(() =>
      expect(
        screen.getByText(/Not enough overlapping history/i),
      ).toBeInTheDocument(),
    );
    expect(screen.queryByText("Projected impact")).toBeNull();
  });

  // -------------------------------------------------------------------------
  // NEW-C11-08 — duplicate date in equity curve warns (last-write-wins)
  // -------------------------------------------------------------------------

  it("NEW-C11-08: duplicate date in equity curve logs a warning but still renders", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    mockFetch(async () =>
      new Response(
        JSON.stringify(
          buildResponse({
            equity_curve_current: [
              { date: "2025-01-01", value: 1.0 },
              { date: "2025-01-01", value: 1.01 }, // duplicate!
              { date: "2025-01-02", value: 1.02 },
            ],
            equity_curve_proposed: [
              { date: "2025-01-01", value: 1.0 },
              { date: "2025-01-02", value: 1.03 },
            ],
          }),
        ),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );

    render(
      <PortfolioImpactPanel
        portfolioId="p1"
        candidateStrategyId="c1"
        candidateName="Dupe dates"
        onClose={() => {}}
      />,
    );

    await waitFor(() =>
      expect(
        screen.getByLabelText("Allocation equity curve: current vs proposed"),
      ).toBeInTheDocument(),
    );

    // The chart renders despite the duplicate (last-write-wins).
    expect(screen.getByLabelText("Allocation equity curve: current vs proposed")).toBeTruthy();
    // A dev warning must have been emitted so the problem is visible in tests.
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('duplicate date "2025-01-01" in current series'),
    );
  });

  // -------------------------------------------------------------------------
  // NEW-C11-01 — null delta renders as "—" (not computable), not ±0.000
  // -------------------------------------------------------------------------

  it("NEW-C11-01: null Sharpe delta renders '—' chip (not computable), not ±0.000", async () => {
    mockFetch(async () =>
      new Response(
        JSON.stringify(
          buildResponse({
            deltas: {
              sharpe_delta: null,
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
        candidateName="Null Sharpe"
        onClose={() => {}}
      />,
    );

    await waitFor(() =>
      expect(screen.getByText("Sharpe")).toBeInTheDocument(),
    );
    // "—" must appear for the not-computable chip.
    expect(screen.getByText("—")).toBeInTheDocument();
    // Must NOT render a zero delta ("0.000", D-02 replaced the "±0.000") — a not-computable chip is "—".
    expect(screen.queryByText("0.000")).toBeNull();
    // ARIA live region must say "not computable", not "unchanged".
    const status = screen.getByRole("status");
    expect(status.textContent).toMatch(/Sharpe not computable/);
    expect(status.textContent).not.toMatch(/Sharpe unchanged/);
  });

  // -------------------------------------------------------------------------
  // NEW-C11-02 — null corr_delta (single-strategy baseline) shows "—" not ±0.000
  // -------------------------------------------------------------------------

  it("NEW-C11-02: null corr_delta (single-strategy portfolio) renders '—', not ±0.000", async () => {
    mockFetch(async () =>
      new Response(
        JSON.stringify(
          buildResponse({
            current: {
              sharpe: 1.2,
              max_drawdown: -0.18,
              avg_correlation: null, // single-strategy baseline — no pair
              concentration: 0.5,
            },
            deltas: {
              sharpe_delta: 0.15,
              dd_delta: 0.02,
              corr_delta: null, // _delta(None, proposed) must be null, not 0.0
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
        candidateName="Single strategy portfolio"
        onClose={() => {}}
      />,
    );

    await waitFor(() =>
      expect(screen.getByText("Correlation")).toBeInTheDocument(),
    );
    // The not-computable em-dash must be rendered for the Correlation chip.
    expect(screen.getByText("—")).toBeInTheDocument();
    expect(screen.queryByText("0.000")).toBeNull();
    // ARIA live region: "Correlation not computable", not "Correlation unchanged".
    const status = screen.getByRole("status");
    expect(status.textContent).toMatch(/Correlation not computable/);
  });

  // -------------------------------------------------------------------------
  // H-1127 — non-OK error bodies whose schema is not `{ error }` (loud-fail)
  // -------------------------------------------------------------------------

  it("H-1127: surfaces a `{ detail }` error body (FastAPI HTTPException), not 'HTTP 400'", async () => {
    // The Python service raises HTTPException, which serializes to `{ detail }`.
    // Pre-fix the panel only read `body.error`, so the real, actionable message
    // was discarded and the user saw the opaque "HTTP 400".
    mockFetch(async () =>
      new Response(
        JSON.stringify({ detail: "No returns data available for the candidate" }),
        { status: 400, headers: { "Content-Type": "application/json" } },
      ),
    );

    render(
      <PortfolioImpactPanel
        portfolioId="p1"
        candidateStrategyId="c1"
        candidateName="Detail-shaped error"
        onClose={() => {}}
      />,
    );

    await waitFor(() =>
      expect(
        screen.getByText("No returns data available for the candidate"),
      ).toBeInTheDocument(),
    );
    // The pre-fix opaque fallback must NOT be shown.
    expect(screen.queryByText("HTTP 400")).toBeNull();
  });

  it("H-1127: surfaces a `{ message }` error body, not 'HTTP 500'", async () => {
    mockFetch(async () =>
      new Response(JSON.stringify({ message: "Candidate is already in this portfolio" }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      }),
    );

    render(
      <PortfolioImpactPanel
        portfolioId="p1"
        candidateStrategyId="c1"
        candidateName="Message-shaped error"
        onClose={() => {}}
      />,
    );

    await waitFor(() =>
      expect(
        screen.getByText("Candidate is already in this portfolio"),
      ).toBeInTheDocument(),
    );
    expect(screen.queryByText("HTTP 500")).toBeNull();
  });

  it("H-1127: logs the unrecognized body shape (contract drift is observable)", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    // A body that parses but matches none of error/detail/message — the panel
    // must fall back to "HTTP 500" AND log so contract drift is not silent.
    mockFetch(async () =>
      new Response(JSON.stringify({ errors: ["nested", "array"] }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      }),
    );

    render(
      <PortfolioImpactPanel
        portfolioId="p1"
        candidateStrategyId="c1"
        candidateName="Unrecognized error shape"
        onClose={() => {}}
      />,
    );

    await waitFor(() =>
      expect(screen.getByText("HTTP 500")).toBeInTheDocument(),
    );
    expect(errorSpy).toHaveBeenCalledWith(
      "[PortfolioImpactPanel] unrecognized error body shape",
      expect.objectContaining({ status: 500 }),
    );
  });

  it("H-1127: coerces a non-string `{ error }` value rather than rendering '[object Object]'", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    // A nested object under `error` must NOT coerce to "[object Object]" copy.
    mockFetch(async () =>
      new Response(JSON.stringify({ error: { nested: "object" } }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      }),
    );

    render(
      <PortfolioImpactPanel
        portfolioId="p1"
        candidateStrategyId="c1"
        candidateName="Object error value"
        onClose={() => {}}
      />,
    );

    await waitFor(() =>
      expect(screen.getByText("HTTP 500")).toBeInTheDocument(),
    );
    expect(screen.queryByText(/\[object Object\]/)).toBeNull();
    expect(errorSpy).toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // M-0969 — catch block: friendly copy + console.error for swallowed failures
  // -------------------------------------------------------------------------

  it("M-0969: a network failure shows friendly copy (not a raw 'Failed to fetch') and is logged", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    // `fetch` rejects with a TypeError on a genuine network failure.
    mockFetch(async () => {
      throw new TypeError("Failed to fetch");
    });

    render(
      <PortfolioImpactPanel
        portfolioId="p1"
        candidateStrategyId="c1"
        candidateName="Offline"
        onClose={() => {}}
      />,
    );

    await waitFor(() =>
      expect(screen.getByText(/Network error — check your connection/i)).toBeInTheDocument(),
    );
    // The raw browser string must never reach the user.
    expect(screen.queryByText(/Failed to fetch/)).toBeNull();
    // The operator must be able to see the underlying error in logs.
    expect(errorSpy).toHaveBeenCalledWith(
      "[PortfolioImpactPanel] simulate impact failed",
      expect.any(TypeError),
    );
  });

  it("M-0969: a malformed success body (JSON parse error) shows friendly copy, not a SyntaxError string", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    // A 200 response with a non-JSON body (e.g. an HTML error page) makes
    // res.json() throw a SyntaxError. Pre-fix the user saw "Unexpected token …".
    mockFetch(async () =>
      new Response("<!DOCTYPE html><html>502 Bad Gateway</html>", {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    render(
      <PortfolioImpactPanel
        portfolioId="p1"
        candidateStrategyId="c1"
        candidateName="Malformed body"
        onClose={() => {}}
      />,
    );

    await waitFor(() =>
      expect(
        screen.getByText(/server returned an unexpected response/i),
      ).toBeInTheDocument(),
    );
    expect(screen.queryByText(/Unexpected token/i)).toBeNull();
    expect(errorSpy).toHaveBeenCalledWith(
      "[PortfolioImpactPanel] simulate impact failed",
      expect.any(SyntaxError),
    );
  });
});

/**
 * [140.3-01 / TS-05 + TS-08] Class-5 member 3 of 3 — `PortfolioImpactPanel`.
 *
 * ⚠️ THIS FILE WAS CITED AS THE FIX-SHAPE TEMPLATE IN THREE DOCUMENTS. It is
 * the DEFECT (correction C-3, verified first-hand at the 140.3 planning gate).
 * `ErrorResponseSchema.safeParse(raw)` ran two lines above the panel's `typeof
 * body.detail === "string"` check, and `src/lib/api/errorSchema.ts` declares
 * `detail: z.string().optional()` — so a nested `service_error` body FAILED the
 * parse outright, collapsed to `{}` through `parsedError.success ?
 * parsedError.data : {}`, and `error`, `retryAfter` and `detail` were all
 * discarded before the `typeof` check was ever reached. On the exact envelope
 * this plan exists to render, the named template threw the whole error body
 * away and rendered `"HTTP 500"`.
 *
 * The fix is the leaf applied to the RAW parsed body, ABOVE the narrowing
 * schema. `src/lib/api/errorSchema.ts` is deliberately NOT widened: narrowing
 * (or widening) an error-body schema for one consumer is the documented
 * Pitfall-3 hazard, and its `{}` fallback is correct for the `{error,
 * retryAfter}` fields it was designed for.
 *
 * ⚠️ Out of scope here, deliberately (TRAP-8): the `if (res.status === 429)`
 * gate that hides `Retry-After` from the breaker's 503 is B-23 / SEAMUX-06.
 */
describe("[140.3-01 / TS-05] <PortfolioImpactPanel> reads the seam error body through the ONE discriminator", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("CONTRACT A — a `service_error` 500 (OBJECT detail): renders `body.detail.detail`, not 'HTTP 500'", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    // §2 envelope. `/api/simulator` is a seam route, so this is the body this
    // component actually receives from a deliberate 5xx — and it is now the
    // EXECUTED constructor's output rather than a hand-typed approximation.
    //
    // ⚠️ 140.5-06 / WP-14 — WHAT THIS FIXTURE USED TO BE AND WHY IT WAS A LIE.
    // It carried `{code:"SEAM_DEGRADED", dependency:"supabase", retryable:true}`
    // at status 500, byte-identically to two other suites. `error_contract.
    // _validate` REFUSES to construct it: a 500 is SERVICE-PERMANENT (rule R-1),
    // so `retryable:true` there is the self-sustaining retry loop R-1 exists to
    // stop. The fixture was certifying a body no raise site can emit.
    //
    // The replacement is this component's OWN upstream, executed:
    // `routers/simulator.py`'s permanent 500 for a failed simulation. It names
    // no dependency — the fault is ours but not attributable to one of our named
    // dependencies, which the 500 arm permits — and `dependency: null` is the
    // key the constructor really puts on the wire in that case.
    //
    //   cd analytics-service && python3 -c "from services.error_contract import \
    //     service_error; print(service_error(500,'SIMULATION_FAILED', \
    //     retryable=False, detail='Portfolio impact simulation failed').detail)"
    //   → {'code': 'SIMULATION_FAILED', 'dependency': None,
    //      'retryable': False, 'detail': 'Portfolio impact simulation failed'}
    //
    // The R-1 rule this fixture now obeys is pinned in Python by
    // `tests/test_error_contract_r1_permanent_500.py`.
    mockFetch(async () =>
      new Response(
        JSON.stringify({
          detail: {
            code: "SIMULATION_FAILED",
            dependency: null,
            retryable: false,
            detail: "Portfolio impact simulation failed",
          },
        }),
        { status: 500, headers: { "Content-Type": "application/json" } },
      ),
    );

    render(
      <PortfolioImpactPanel
        portfolioId="p1"
        candidateStrategyId="c1"
        candidateName="Nested seam envelope"
        onClose={() => {}}
      />,
    );

    await waitFor(() =>
      expect(
        screen.getByText("Portfolio impact simulation failed"),
      ).toBeInTheDocument(),
    );
    // The pre-plan render. `ErrorResponseSchema` rejected the nested body, the
    // cascade saw `{}`, and the user got a bare status code.
    expect(screen.queryByText("HTTP 500")).toBeNull();
    expect(screen.queryByText(/\[object Object\]/)).toBeNull();
    // The drift signal must NOT fire: the leaf read the body successfully, so
    // reporting "unrecognized error body shape" would be a false alarm on the
    // one shape the seam is contractually guaranteed to send.
    expect(
      errorSpy.mock.calls.some(
        (call) => call[0] === "[PortfolioImpactPanel] unrecognized error body shape",
      ),
      "The drift log fires only when the LEAF also returned null. A nested " +
        "service_error envelope is a recognised shape, not drift.",
    ).toBe(false);
    errorSpy.mockRestore();
  });

  it("CONTRACT B — an app-global 429 (SCALAR detail): the rendered string is BYTE-IDENTICAL to its pre-plan value (TS-07 is negative)", async () => {
    mockFetch(async () =>
      new Response(
        JSON.stringify({
          ok: false,
          code: "RATE_LIMITED",
          human_message: "Too many requests.",
          detail: "Too many simulations. Try again in 60 seconds.",
          correlation_id: "cid-429-simulator",
          recoverable: true,
          retry_after_seconds: 60,
        }),
        {
          status: 429,
          headers: {
            "Content-Type": "application/json",
            "Retry-After": "60",
          },
        },
      ),
    );

    render(
      <PortfolioImpactPanel
        portfolioId="p1"
        candidateStrategyId="c1"
        candidateName="Flat app-global 429"
        onClose={() => {}}
      />,
    );

    await waitFor(() =>
      expect(
        screen.getByText("Too many simulations. Try again in 60 seconds."),
      ).toBeInTheDocument(),
    );
    // The flat shape parsed cleanly through the schema BEFORE this plan and
    // rendered exactly this sentence. If the literal moved, the 429 path was
    // "fixed" and TS-07's NEGATIVE obligation was violated.
    const retryButton = await screen.findByRole("button", { name: "Retry" });
    expect(retryButton).toBeDisabled();
  });

  it("a body matching neither the seam nor the three-key cascade still logs drift and falls back to `HTTP <status>`", async () => {
    // The drift signal is a live contract-drift detector (TRAP-9) — it is
    // re-pointed by this plan, never deleted.
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    mockFetch(async () =>
      new Response(JSON.stringify({ errors: ["nested", "array"] }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      }),
    );

    render(
      <PortfolioImpactPanel
        portfolioId="p1"
        candidateStrategyId="c1"
        candidateName="Neither shape"
        onClose={() => {}}
      />,
    );

    await waitFor(() =>
      expect(screen.getByText("HTTP 500")).toBeInTheDocument(),
    );
    expect(
      errorSpy.mock.calls.some(
        (call) => call[0] === "[PortfolioImpactPanel] unrecognized error body shape",
      ),
    ).toBe(true);
    errorSpy.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// 194 D-11 as superseded by D-15 — the Sharpe delta is withheld only when the compared
// record fails the total-record minimum; a short window qualifies with one muted note.
// ---------------------------------------------------------------------------
describe("<PortfolioImpactPanel> D-15 Sharpe delta gate", () => {
  /** Daily curve points that cover exactly `days` days (D-20: one point per day, both ends counted). */
  function curve(start: string, days: number) {
    const t0 = Date.parse(`${start}T00:00:00Z`);
    return Array.from({ length: days }, (_, i) => ({
      date: new Date(t0 + i * 86_400_000).toISOString().slice(0, 10),
      value: 1 + i * 0.001,
    }));
  }

  function ok(over: Partial<SimulatorCandidate>): SimulatorResponseOk {
    return buildResponse({
      equity_curve_current: curve("2025-01-01", 400),
      equity_curve_proposed: curve("2025-01-01", 400),
      ...over,
    }) as SimulatorResponseOk;
  }

  async function renderWith(data: SimulatorResponseOk) {
    mockFetch(
      async () =>
        new Response(JSON.stringify(data), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
    );
    render(
      <PortfolioImpactPanel
        portfolioId="p1"
        candidateStrategyId="c1"
        candidateName="Candidate"
        onClose={() => {}}
      />,
    );
    await waitFor(() => expect(screen.getByText(/Projected impact/i)).toBeInTheDocument());
  }

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  const sharpeCard = () => screen.getByText("Sharpe").closest("[title]") as HTMLElement;
  const sharpeValue = () => sharpeCard().querySelector("p.font-metric") as HTMLElement;
  const otherChips = () =>
    ["MaxDD", "Correlation", "Concentration"].map(
      (label) => (screen.getByText(label).closest("[title]") as HTMLElement).outerHTML,
    );
  const note = () => screen.queryByTestId("impact-delta-annualization-note");

  it("crypto book, curves spanning 59 days: Sharpe withheld, untoned dash, reason in title and note, not announced", async () => {
    const data = ok({
      annualization_periods: 365,
      overlap_days: 60,
      equity_curve_current: curve("2025-01-01", 59),
      equity_curve_proposed: curve("2025-01-01", 59),
    });
    const record = { spanDays: 59, observations: 60, crypto: true };
    await renderWith(data);

    expect(sharpeValue().textContent).toBe("—");
    expect(sharpeValue().className).toContain("text-text-muted");
    expect(sharpeValue().className).not.toMatch(/text-(positive|negative)/);
    expect(sharpeCard().getAttribute("title")).toBe(widenedWithheldReason("delta", record));
    expect(note()?.textContent).toBe(widenedWithheldReason("delta", record));
    const status = screen.getByRole("status").textContent ?? "";
    expect(status).not.toMatch(/Sharpe (improved|regressed|unchanged|not computable)/);
    expect(status).toContain(widenedWithheldReason("delta", record));
    // The other chips still speak.
    expect(status).toMatch(/Max drawdown improved/);
  });

  it("traditional book, 60 observations over 84 days: value kept, short note (D-15: 60 observations clear)", async () => {
    await renderWith(
      ok({
        annualization_periods: 252,
        overlap_days: 60,
        equity_curve_current: curve("2025-01-01", 84),
        equity_curve_proposed: curve("2025-01-01", 84),
      }),
    );
    expect(sharpeValue().textContent).toBe(formatDelta(0.15, "ratio"));
    expect(note()?.textContent).toBe(widenedShortNote("delta", 84));
    expect(screen.getByText(/Sharpe improved by 0\.150/)).toBeInTheDocument();
  });

  it("traditional book, 59 observations: withheld, the record names its own count", async () => {
    await renderWith(
      ok({
        annualization_periods: 252,
        overlap_days: 59,
        equity_curve_current: curve("2025-01-01", 84),
        equity_curve_proposed: curve("2025-01-01", 84),
      }),
    );
    const record = { spanDays: 84, observations: 59, crypto: false };
    expect(sharpeValue().textContent).toBe("—");
    expect(note()?.textContent).toBe(widenedWithheldReason("delta", record));
  });

  it("200-day curves on a cleared record: value kept, note carries the 200-day span", async () => {
    await renderWith(
      ok({
        annualization_periods: 252,
        overlap_days: 200,
        equity_curve_current: curve("2025-01-01", 200),
        equity_curve_proposed: curve("2025-01-01", 200),
      }),
    );
    expect(sharpeValue().textContent).toBe(formatDelta(0.15, "ratio"));
    expect(note()?.textContent).toBe(widenedShortNote("delta", 200));
  });

  it("400-day curves: no note, the Sharpe chip and the announcement as an ungated response", async () => {
    await renderWith(ok({ annualization_periods: 252, overlap_days: 400 }));
    expect(note()).toBeNull();
    expect(sharpeValue().textContent).toBe(formatDelta(0.15, "ratio"));
    expect(screen.getByRole("status").textContent).toBe(
      "Simulation complete. Sharpe improved by 0.150. Max drawdown improved by 2.00%. Correlation improved by 0.030. Concentration improved by 0.050.",
    );
  });

  it("no annualization_periods (older analytics deploy): Sharpe change withheld with a reason, never an ungated chip", async () => {
    await renderWith(
      ok({
        annualization_periods: undefined,
        overlap_days: 400,
        equity_curve_current: curve("2025-01-01", 400),
        equity_curve_proposed: curve("2025-01-01", 400),
      }),
    );
    const unavailable = "Sharpe change is temporarily unavailable. Reload to retry.";
    expect(sharpeValue().textContent).toBe("—");
    expect(sharpeValue().className).not.toMatch(/text-(positive|negative)/);
    expect(note()?.textContent).toBe(unavailable);
    expect(screen.getByRole("status").textContent).toBe(
      `Simulation complete. Max drawdown improved by 2.00%. Correlation improved by 0.030. Concentration improved by 0.050. ${unavailable}`,
    );
  });

  it("MaxDD, Correlation and Concentration chips and the partial-history banner are identical when Sharpe is withheld", async () => {
    const base = { overlap_days: 60, partial_history: true } as const;
    const span59 = {
      equity_curve_current: curve("2025-01-01", 59),
      equity_curve_proposed: curve("2025-01-01", 59),
    };
    await renderWith(ok({ ...base, ...span59, annualization_periods: 365 }));
    const withheldOthers = otherChips();
    const banner = screen.getByText(/Partial history:/).closest("[role=note]")?.outerHTML;
    expect(banner).toBeDefined();
    cleanup();

    await renderWith(ok({ ...base, ...span59 }));
    expect(otherChips()).toEqual(withheldOthers);
    expect(screen.getByText(/Partial history:/).closest("[role=note]")?.outerHTML).toBe(banner);
  });

  describe("gateSimulatorDeltas", () => {
    it("passes the producer's value through when cleared and nulls only sharpe_delta when withheld", () => {
      const cleared = gateSimulatorDeltas(ok({ annualization_periods: 252, overlap_days: 400 }));
      expect(cleared.state).toBe("full");
      expect(cleared.deltas.sharpe_delta).toBe(0.15);

      const withheld = gateSimulatorDeltas(
        ok({
          annualization_periods: 365,
          overlap_days: 60,
          equity_curve_current: curve("2025-01-01", 59),
          equity_curve_proposed: curve("2025-01-01", 59),
        }),
      );
      expect(withheld.state).toBe("withheld");
      expect(withheld.deltas).toEqual({ ...cleared.deltas, sharpe_delta: null });
      expect(withheld.record).toEqual({ spanDays: 59, observations: 60, crypto: true });
    });

    it("an absent basis is withheld with no record, and the Sharpe change is null", () => {
      const { annualization_periods: _drop, ...noBasis } = ok({ overlap_days: 60 });
      const g = gateSimulatorDeltas(noBasis as SimulatorResponseOk);
      expect(g.state).toBe("withheld");
      expect(g.record).toBeNull();
      expect(g.deltas.sharpe_delta).toBeNull();
    });
  });
});
