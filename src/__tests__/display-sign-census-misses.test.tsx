import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

import { KpiStrip } from "@/app/(dashboard)/allocations/components/KpiStrip";
import {
  formatDecompositionTick,
  formatDecompositionTooltip,
} from "@/app/(dashboard)/allocations/widgets/attribution/AlphaBetaDecomposition";
import { formatPcrPercent } from "@/app/(dashboard)/allocations/components/ScenarioComposer";
import { WhatWedDoCard } from "@/components/portfolio/WhatWedDoCard";
import { ReplacementCard } from "@/components/portfolio/ReplacementCard";
import { formatRiskShareTooltip } from "@/components/portfolio/RiskAttribution";
import type { ComputedMetrics } from "@/lib/scenario";
import type { BridgeCandidate, OptimizerSuggestionRow } from "@/lib/types";

/**
 * Phase 170.6 plan 12 (D-02, D-03, D-05) — the figures the single-source guard found that
 * plans 02-11 had not converted. Each is a printed or toned signed figure that took its
 * sign from the RAW value, so a value that rounds to zero printed "-0.00" or drew red.
 * Every expected string and class is typed by hand; none comes from the code under test.
 */

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }),
}));

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

// ---------------------------------------------------------------------------
// Allocations: the Alpha / Beta decomposition chart axis and tooltip
// ---------------------------------------------------------------------------

describe("AlphaBetaDecomposition chart labels follow the rounded sign (D-02)", () => {
  it("an axis tick of -0.004 (a -0.4% share) prints 0%, not -0%", () => {
    expect(formatDecompositionTick(-0.004)).toBe("0%");
  });

  it("a tooltip value of -0.00004 prints 0.00%, not -0.00%", () => {
    expect(formatDecompositionTooltip(-0.00004)).toBe("0.00%");
  });

  it("a tooltip value of 0 prints 0.00% with no sign", () => {
    expect(formatDecompositionTooltip(0)).toBe("0.00%");
  });

  it("non-zero values keep the digits they printed before: -1.23%, 1.23%, -12%, 5%", () => {
    expect(formatDecompositionTooltip(-0.0123)).toBe("-1.23%");
    expect(formatDecompositionTooltip(0.0123)).toBe("1.23%");
    expect(formatDecompositionTick(-0.12)).toBe("-12%");
    expect(formatDecompositionTick(0.05)).toBe("5%");
  });

  it("a non-numeric tooltip value prints a dash, not NaN%", () => {
    expect(formatDecompositionTooltip(undefined)).toBe("—");
  });
});

// ---------------------------------------------------------------------------
// Allocations: the composer's risk-contribution percent
// ---------------------------------------------------------------------------

describe("ScenarioComposer percent contribution to risk follows the rounded sign (D-02)", () => {
  it("-0.0004 (a -0.04% share) prints 0.0%, not -0.0%", () => {
    expect(formatPcrPercent(-0.0004)).toBe("0.0%");
  });

  it("0 prints 0.0%", () => {
    expect(formatPcrPercent(0)).toBe("0.0%");
  });

  it("a hedge keeps its minus: -0.123 prints -12.3%; 0.456 prints 45.6%", () => {
    expect(formatPcrPercent(-0.123)).toBe("-12.3%");
    expect(formatPcrPercent(0.456)).toBe("45.6%");
  });
});

// ---------------------------------------------------------------------------
// Portfolio: the risk-attribution bar tooltip
// ---------------------------------------------------------------------------

describe("RiskAttribution tooltip follows the rounded sign (D-02)", () => {
  it("a hedge's share of -0.0004 (-0.04%) prints 0.0%, not -0.0%", () => {
    expect(formatRiskShareTooltip(-0.0004)).toBe("0.0%");
  });

  it("a share of 0 prints 0.0%", () => {
    expect(formatRiskShareTooltip(0)).toBe("0.0%");
  });

  it("a hedge keeps its minus and a normal share keeps its digits: -0.123 prints -12.3%, 0.456 prints 45.6%", () => {
    expect(formatRiskShareTooltip(-0.123)).toBe("-12.3%");
    expect(formatRiskShareTooltip(0.456)).toBe("45.6%");
  });
});

// ---------------------------------------------------------------------------
// Allocations: the KPI strip value colour and the delta pill at the noise floor
// ---------------------------------------------------------------------------

const EMPTY_METRICS: ComputedMetrics = {
  n: 0,
  twr: null,
  cagr: null,
  volatility: null,
  sharpe: null,
  sortino: null,
  max_drawdown: null,
  max_dd_days: null,
  correlation_matrix: null,
  avg_pairwise_correlation: null,
  equity_curve: [],
  effective_start: null,
  effective_end: null,
};

function renderStrip(analytics: Record<string, number | null>) {
  return render(
    <KpiStrip analytics={analytics} metrics={EMPTY_METRICS} timeframe="ALL" snapshotCount={30} />,
  );
}

describe("KpiStrip value colour follows the rounded sign (D-03)", () => {
  it("a YTD TWR of -0.00004 prints 0.00% in no sign colour, not red", () => {
    renderStrip({ ytd_twr: -0.00004 });
    const cell = screen.getByText("0.00%");
    expect(cell.className).not.toContain("text-negative");
    expect(cell.className).not.toContain("text-positive");
  });

  it("a Sharpe of 0.004 prints 0.00 in no sign colour, not green", () => {
    renderStrip({ sharpe: 0.004 });
    const cell = screen.getByText("0.00");
    expect(cell.className).not.toContain("text-positive");
    expect(cell.className).not.toContain("text-negative");
  });

  it("a Max DD of -0.00004 prints 0.00% in no sign colour, not red", () => {
    renderStrip({ max_drawdown_12m: -0.00004 });
    const cell = screen.getByText("0.00%");
    expect(cell.className).not.toContain("text-negative");
  });

  it("non-zero cells keep their colours: +12.00% green, -8.00% red, Sharpe 1.20 green", () => {
    renderStrip({ ytd_twr: 0.12, max_drawdown_12m: -0.08, sharpe: 1.2 });
    expect(screen.getByText("+12.00%").className).toContain("text-positive");
    expect(screen.getByText("-8.00%").className).toContain("text-negative");
    expect(screen.getByText("1.20").className).toContain("text-positive");
  });
});

// Phase 170.1 (D-11): the aria-label element holds two spans, the toned figure and the
// untoned "vs current book" suffix, so the colour pins read the first span.
describe("KpiStrip delta pill at the noise floor keeps its direction word and colour (characterization)", () => {
  const live: ComputedMetrics = { ...EMPTY_METRICS, n: 252, sharpe: 1.2, max_drawdown: -0.08, twr: 0.15 };
  const strip = (scenario: ComputedMetrics) =>
    render(
      <KpiStrip
        analytics={{ ytd_twr: 0.15, sharpe: 1.2, max_drawdown_12m: -0.08 }}
        metrics={live}
        timeframe="ALL"
        snapshotCount={30}
        mode="scenario"
        scenarioMetrics={scenario}
        liveMetrics={live}
      />,
    );

  it("a Sharpe delta of exactly +0.01 is 'improved' in text-positive", () => {
    const { container } = strip({ ...live, sharpe: 1.21 });
    const pill = container.querySelector('[aria-label^="Sharpe delta vs current book:"]');
    expect(pill).not.toBeNull();
    expect(pill!.getAttribute("aria-label")).toBe("Sharpe delta vs current book: +0.01 (improved)");
    expect((pill!.children[0] as HTMLElement).className).toContain("text-positive");
  });

  it("a Sharpe delta of exactly -0.01 is 'regressed' in text-negative", () => {
    const { container } = strip({ ...live, sharpe: 1.19 });
    const pill = container.querySelector('[aria-label^="Sharpe delta vs current book:"]');
    expect(pill!.getAttribute("aria-label")).toBe("Sharpe delta vs current book: −0.01 (regressed)");
    expect((pill!.children[0] as HTMLElement).className).toContain("text-negative");
  });

  it("a Sharpe delta of +0.004 is under the noise floor: 'no change' in the muted colour", () => {
    const { container } = strip({ ...live, sharpe: 1.204 });
    const pill = container.querySelector('[aria-label^="Sharpe delta vs current book:"]');
    expect(pill!.getAttribute("aria-label")).toBe("Sharpe delta vs current book: 0.00 (no change)");
    expect((pill!.children[0] as HTMLElement).className).toContain("text-text-muted");
  });

  it("a Max DD delta of +0.04 (a shallower drawdown) is 'improved' in text-positive", () => {
    const { container } = strip({ ...live, max_drawdown: -0.04 });
    const pill = container.querySelector('[aria-label^="Max DD 12m delta vs current book:"]');
    expect(pill!.getAttribute("aria-label")).toBe("Max DD 12m delta vs current book: +4.0% (improved)");
    expect((pill!.children[0] as HTMLElement).className).toContain("text-positive");
  });
});

// ---------------------------------------------------------------------------
// Portfolio: the optimizer score and the Bridge composite score
// ---------------------------------------------------------------------------

function suggestion(partial: Partial<OptimizerSuggestionRow> = {}): OptimizerSuggestionRow {
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

describe("WhatWedDoCard optimizer score follows the rounded sign (D-02)", () => {
  it("a score of -0.003 prints 0.00, not -0.00", () => {
    render(<WhatWedDoCard suggestions={[suggestion({ score: -0.003 })]} />);
    expect(screen.getByText(/Optimizer score 0\.00 on the/)).toBeInTheDocument();
    expect(screen.queryByText(/-0\.00/)).toBeNull();
  });

  it("an ordinary score keeps its digits: 0.142 prints 0.14", () => {
    render(<WhatWedDoCard suggestions={[suggestion({ score: 0.142 })]} />);
    expect(screen.getByText(/Optimizer score 0\.14 on the/)).toBeInTheDocument();
  });

  it("a score that is negative at the printed precision keeps its minus: -0.142 prints -0.14", () => {
    render(<WhatWedDoCard suggestions={[suggestion({ score: -0.142 })]} />);
    expect(screen.getByText(/Optimizer score -0\.14 on the/)).toBeInTheDocument();
  });
});

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

describe("ReplacementCard intro message prints the composite score on the rounded sign (D-02)", () => {
  async function sentMessage(composite: number): Promise<string> {
    const fetchSpy = vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 }));
    vi.stubGlobal("fetch", fetchSpy as unknown as typeof fetch);
    render(<ReplacementCard candidate={candidate({ composite_score: composite })} replacementFor="old" />);
    fireEvent.click(screen.getByRole("button", { name: "Request Intro" }));
    await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1));
    const init = (fetchSpy.mock.calls[0] as unknown as [string, RequestInit])[1];
    return (JSON.parse(String(init.body)) as { message: string }).message;
  }

  it("a composite score of -0.003 is sent as 0.00, not -0.00", async () => {
    expect(await sentMessage(-0.003)).toBe(
      "[Bridge] Replacement candidate for strategy old. Composite score: 0.00.",
    );
  });

  it("an ordinary composite score keeps its digits: 0.82 and -0.41", async () => {
    expect(await sentMessage(0.82)).toBe("[Bridge] Replacement candidate for strategy old. Composite score: 0.82.");
    cleanup();
    expect(await sentMessage(-0.41)).toBe("[Bridge] Replacement candidate for strategy old. Composite score: -0.41.");
  });
});
