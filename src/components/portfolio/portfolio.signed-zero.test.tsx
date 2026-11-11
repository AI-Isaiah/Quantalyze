/**
 * Phase 170.6 DISPLAYPOLISH plan 09 (D-02, D-03, D-04, D-06) — the portfolio surfaces print and
 * colour a figure from the value ROUNDED to the precision it is printed at, never from the raw
 * value. A raw -0.0004 shown as "0.00" is neutral and unsigned; `-0.00`, `-0.0%` and `+0.00`
 * never appear.
 *
 * Every expected string and class below is typed by hand. None is computed by the code under test.
 * Heatmap cell FILLS are unchanged (D-06): the fill assertion compares against the unchanged
 * `correlationBg` helper, not against a sign rule.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { ReplacementCard } from "./ReplacementCard";
import PortfolioOptimizer, { type OptimizerSuggestion } from "./PortfolioOptimizer";
import { PortfolioImpactPanel, formatDelta } from "./PortfolioImpactPanel";
import { CorrelationHeatmap, correlationBg } from "./CorrelationHeatmap";
import type { BridgeCandidate, SimulatorCandidate } from "@/lib/types";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }),
}));

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

// ---------------------------------------------------------------------------
// Task 1 - ReplacementCard
// ---------------------------------------------------------------------------

function candidate(partial: Partial<BridgeCandidate> = {}): BridgeCandidate {
  return {
    strategy_id: "s-1",
    strategy_name: "Replacement Alpha",
    sharpe_delta: 0.25,
    dd_delta: 0.04,
    corr_delta: 0.1,
    composite_score: 0.82,
    fit_label: "Strong fit",
    ...partial,
  };
}

describe("170.6-09 ReplacementCard - delta text and tone on the rounded sign", () => {
  it("a Sharpe delta of -0.004 prints '0.00 Sharpe' with neither green nor red", () => {
    render(<ReplacementCard candidate={candidate({ sharpe_delta: -0.004 })} replacementFor="old" />);
    const chip = screen.getByText("0.00 Sharpe");
    expect(chip.className).not.toContain("text-positive");
    expect(chip.className).not.toContain("text-negative");
    expect(chip.className).toContain("text-text-primary");
  });

  it("a MaxDD delta of 0.0004 prints '0.0% MaxDD' neutral", () => {
    render(<ReplacementCard candidate={candidate({ dd_delta: 0.0004 })} replacementFor="old" />);
    const chip = screen.getByText("0.0% MaxDD");
    expect(chip.className).not.toContain("text-positive");
    expect(chip.className).not.toContain("text-negative");
  });

  it("a Corr delta of -0.0004 prints '0.0% Corr' neutral", () => {
    render(<ReplacementCard candidate={candidate({ corr_delta: -0.0004 })} replacementFor="old" />);
    const chip = screen.getByText("0.0% Corr");
    expect(chip.className).not.toContain("text-positive");
    expect(chip.className).not.toContain("text-negative");
  });

  it("a Sharpe delta of 0.12 prints '+0.12 Sharpe' green; -0.12 prints '-0.12 Sharpe' red", () => {
    const { unmount } = render(
      <ReplacementCard candidate={candidate({ sharpe_delta: 0.12 })} replacementFor="old" />,
    );
    expect(screen.getByText("+0.12 Sharpe").className).toContain("text-positive");
    unmount();
    render(<ReplacementCard candidate={candidate({ sharpe_delta: -0.12 })} replacementFor="old" />);
    expect(screen.getByText("-0.12 Sharpe").className).toContain("text-negative");
  });
});

// ---------------------------------------------------------------------------
// Task 1 - PortfolioOptimizer
// ---------------------------------------------------------------------------

function suggestion(partial: Partial<OptimizerSuggestion> = {}): OptimizerSuggestion {
  return {
    strategy_id: "s-1",
    strategy_name: "Uncorrelated Vol",
    corr_with_portfolio: 0.45,
    sharpe_lift: 0.15,
    dd_improvement: 0.03,
    score: 0.8,
    ...partial,
  };
}

/** The value <p> of the MetricCell that owns `label`. */
function metricEl(label: string): HTMLElement {
  const cell = screen.getByText(label).closest("div") as HTMLElement;
  return cell.querySelectorAll("p")[1] as HTMLElement;
}

function renderOptimizer(s: OptimizerSuggestion) {
  return render(
    <PortfolioOptimizer
      portfolioId="p1"
      initialSuggestions={[s]}
      computedAt="2026-07-11T00:00:00Z"
      computationStatus="complete"
    />,
  );
}

describe("170.6-09 PortfolioOptimizer - signedDecimal and lift tone on the rounded sign", () => {
  it("a Sharpe lift of 0.004 prints '0.00' (not '+0.00') and is not green", () => {
    renderOptimizer(suggestion({ sharpe_lift: 0.004 }));
    const el = metricEl("Sharpe lift");
    expect(el.textContent).toBe("0.00");
    expect(el.className).not.toContain("text-positive");
    expect(el.className).toContain("text-text-secondary");
  });

  it("a Sharpe lift of 0.15 prints '+0.15' green", () => {
    renderOptimizer(suggestion({ sharpe_lift: 0.15 }));
    const el = metricEl("Sharpe lift");
    expect(el.textContent).toBe("+0.15");
    expect(el.className).toContain("text-positive");
  });

  // The TEXT of a negative lift that rounds to zero comes from `formatNumber` (Intl), which
  // plan 02 moves onto display-sign; this plan owns the "+" and the tone, so only those are pinned.
  it("a Sharpe lift of -0.004 is not green and carries no '+'", () => {
    renderOptimizer(suggestion({ sharpe_lift: -0.004 }));
    const el = metricEl("Sharpe lift");
    expect(el.textContent).not.toContain("+");
    expect(el.className).not.toContain("text-positive");
  });

  it("the percent cell reads its tone at the percent scale: 0.004 (0.40%) green, 0.00004 (0.00%) not green", () => {
    const { unmount } = renderOptimizer(suggestion({ dd_improvement: 0.004 }));
    expect(metricEl("DD improve").className).toContain("text-positive");
    unmount();
    renderOptimizer(suggestion({ dd_improvement: 0.00004 }));
    expect(metricEl("DD improve").className).not.toContain("text-positive");
  });
});

// ---------------------------------------------------------------------------
// Task 1 - PortfolioImpactPanel
// ---------------------------------------------------------------------------

describe("170.6-09 PortfolioImpactPanel formatDelta (D-02)", () => {
  it("an exact zero prints unsigned, no '±'", () => {
    expect(formatDelta(0, "ratio")).toBe("0.000");
    expect(formatDelta(0, "percent")).toBe("0.00%");
  });
  it("a value that rounds to zero prints unsigned", () => {
    expect(formatDelta(-0.0004, "ratio")).toBe("0.000");
    expect(formatDelta(-0.00004, "percent")).toBe("0.00%");
    expect(formatDelta(0.0004, "ratio")).toBe("0.000");
  });
  it("non-zero figures keep their digits and signs", () => {
    expect(formatDelta(0.0123, "percent")).toBe("+1.23%");
    expect(formatDelta(-0.0123, "percent")).toBe("-1.23%");
    expect(formatDelta(0.15, "ratio")).toBe("+0.150");
    expect(formatDelta(-0.15, "ratio")).toBe("-0.150");
  });
  it("a null is still '—', distinct from a zero", () => {
    expect(formatDelta(null, "ratio")).toBe("—");
    expect(formatDelta(null, "percent")).toBe("—");
  });
});

type ImpactDeltas = {
  sharpe_delta: number | null;
  dd_delta: number | null;
  corr_delta: number | null;
  concentration_delta: number | null;
};

function impactResponse(deltas: ImpactDeltas): SimulatorCandidate {
  return {
    candidate_id: "c1",
    candidate_name: "High Sharpe Strategy",
    portfolio_id: "p1",
    status: "ok",
    overlap_days: 200,
    annualization_periods: 252,
    partial_history: false,
    current_metrics_reliable: true,
    deltas,
    current: { sharpe: 1.2, max_drawdown: -0.18, avg_correlation: 0.45, concentration: 0.5 },
    proposed: { sharpe: 1.35, max_drawdown: -0.16, avg_correlation: 0.42, concentration: 0.45 },
    equity_curve_current: [
      { date: "2025-01-01", value: 1.0 },
      { date: "2025-01-02", value: 1.005 },
    ],
    equity_curve_proposed: [
      { date: "2025-01-01", value: 1.0 },
      { date: "2025-01-02", value: 1.008 },
    ],
  };
}

describe("170.6-09 PortfolioImpactPanel chip tone follows the rounded sign (D-03)", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify(
              impactResponse({
                sharpe_delta: -0.0004,
                dd_delta: -0.00004,
                corr_delta: 0.03,
                concentration_delta: 0.05,
              }),
            ),
            { status: 200, headers: { "Content-Type": "application/json" } },
          ),
      ) as unknown as typeof fetch,
    );
  });

  it("a Sharpe delta of -0.0004 prints '0.000' and a MaxDD delta of -0.00004 prints '0.00%', both neutral, neither red", async () => {
    render(
      <PortfolioImpactPanel
        portfolioId="p1"
        candidateStrategyId="c1"
        candidateName="Rounded zero"
        onClose={() => {}}
      />,
    );
    const ratio = await screen.findByText("0.000");
    expect(ratio.className).toContain("text-text-secondary");
    expect(ratio.className).not.toContain("text-negative");
    const pct = await screen.findByText("0.00%");
    expect(pct.className).toContain("text-text-secondary");
    expect(pct.className).not.toContain("text-negative");
  });
});

// ---------------------------------------------------------------------------
// Task 2 - CorrelationHeatmap (AttributionBar and PortfolioEquityCurve went with /portfolios, 195-06)
// ---------------------------------------------------------------------------

describe("170.6-09 CorrelationHeatmap - cell text and aria-label on the rounded sign (D-06 fill unchanged)", () => {
  const matrix = {
    a: { a: 1, b: -0.004 },
    b: { a: -0.004, b: 1 },
  };

  it("a correlation of -0.004 prints '0.00' and reads '0.00 correlation'", () => {
    render(<CorrelationHeatmap correlationMatrix={matrix} strategyNames={{ a: "Alpha", b: "Beta" }} />);
    const cell = screen.getByLabelText("Alpha and Beta: 0.00 correlation");
    expect(cell.textContent).toBe("0.00");
    expect(screen.queryByLabelText(/-0\.00/)).toBeNull();
  });

  it("the cell FILL is unchanged: it is the same colour correlationBg gives -0.004", () => {
    render(<CorrelationHeatmap correlationMatrix={matrix} strategyNames={{ a: "Alpha", b: "Beta" }} />);
    const cell = screen.getByLabelText("Alpha and Beta: 0.00 correlation");
    const probe = document.createElement("div");
    probe.style.backgroundColor = correlationBg(-0.004);
    expect(cell.style.backgroundColor).toBe(probe.style.backgroundColor);
  });

  it("a non-zero correlation keeps its sign and digits", () => {
    render(
      <CorrelationHeatmap
        correlationMatrix={{ a: { a: 1, b: -0.35 }, b: { a: -0.35, b: 1 } }}
        strategyNames={{ a: "Alpha", b: "Beta" }}
      />,
    );
    expect(screen.getByLabelText("Alpha and Beta: -0.35 correlation").textContent).toBe("-0.35");
  });
});
