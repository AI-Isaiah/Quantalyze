/**
 * Phase 100 / Plan 02 / Task 3 — OptimizerPanel (PI-05, optimizer half).
 *
 * The HONESTY-GATE tests (plan-checker-confirmed):
 *   - Suggestions render as a RANKED LIST sorted by `score` DESC.
 *   - NO pie/donut/weight-bar/"allocation %" framing anywhere (absence asserted).
 *   - Mandatory footer disclaimer renders verbatim.
 *   - The narrative metric glossary renders one entry per rendered column
 *     label (Sharpe lift / Corr w/ portfolio / DD improve); the never-rendered
 *     "Score" column is NOT documented (red-team F-2).
 *   - 0-portfolio honest gate (PortfolioOptimizer NOT mounted, no fake rows).
 *   - Portfolio switch remounts PortfolioOptimizer with null initials.
 */
import { describe, it, expect, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { OptimizerPanel } from "./OptimizerPanel";
import type { OptimizerPrefetch } from "../lib/watchlist-read";

// PortfolioOptimizer (mounted via next/dynamic) calls useRouter().
vi.mock("next/navigation", () => ({
  useRouter: () => ({
    refresh: vi.fn(),
    replace: vi.fn(),
    push: vi.fn(),
    back: vi.fn(),
    forward: vi.fn(),
    prefetch: vi.fn(),
  }),
  usePathname: () => "/allocations",
  useSearchParams: () => new URLSearchParams(),
}));

const SUGGESTIONS = [
  {
    strategy_id: "s-b",
    strategy_name: "Bravo",
    corr_with_portfolio: 0.1,
    sharpe_lift: 0.05,
    dd_improvement: 0.02,
    score: 0.5,
  },
  {
    strategy_id: "s-a",
    strategy_name: "Alpha",
    corr_with_portfolio: -0.1,
    sharpe_lift: 0.2,
    dd_improvement: 0.08,
    score: 0.9,
  },
  {
    strategy_id: "s-c",
    strategy_name: "Charlie",
    corr_with_portfolio: 0.0,
    sharpe_lift: 0.1,
    dd_improvement: 0.04,
    score: 0.7,
  },
];

const FOOTER =
  "Ranked by modeled fit from historical daily returns — suggestions, not an allocation and not a forecast.";

// The rendered column labels PortfolioOptimizer emits; every glossary entry
// must align to one of these (red-team F-2).
const COLUMN_LABELS = ["Sharpe lift", "Corr w/ portfolio", "DD improve"];

const TOOLTIPS = {
  sharpe:
    "Modeled change in your portfolio's Sharpe ratio if this strategy were added — a unitless delta, not a percentage. Positive means better risk-adjusted return in backtest.",
  corr:
    "Correlation of this strategy's daily returns with your current portfolio, from -1 to 1 (not a percentage). Lower means more diversification benefit.",
  dd:
    "Modeled reduction in your portfolio's maximum drawdown from adding this strategy, as a percentage of NAV.",
};

function prefetch(overrides: Partial<OptimizerPrefetch> = {}): OptimizerPrefetch {
  return {
    portfolios: [
      { id: "p1", name: "Book One", created_at: "2026-06-01T00:00:00Z" },
    ],
    defaultPortfolioId: "p1",
    initialSuggestions: SUGGESTIONS,
    computedAt: "2026-06-02T00:00:00Z",
    computationStatus: "complete",
    ...overrides,
  };
}

describe("OptimizerPanel", () => {
  it("0-portfolio gate: honest copy + Create portfolio link, no optimizer mount", () => {
    render(
      <OptimizerPanel
        prefetch={prefetch({
          portfolios: [],
          defaultPortfolioId: null,
          initialSuggestions: null,
          computedAt: null,
          computationStatus: null,
        })}
      />,
    );
    expect(
      screen.getByText(
        "Optimizer suggestions need a portfolio to optimize against. Create one to see which strategies would improve it.",
      ),
    ).toBeInTheDocument();
    const create = screen.getByRole("link", { name: /Create portfolio/i });
    expect(create).toHaveAttribute("href", "/portfolios");
    // No optimizer states leak in.
    expect(screen.queryByText(/Run Optimizer/i)).not.toBeInTheDocument();
  });

  it("renders the mandatory footer disclaimer verbatim", () => {
    render(<OptimizerPanel prefetch={prefetch()} />);
    expect(screen.getByText(FOOTER)).toBeInTheDocument();
  });

  it("renders the narrative metric glossary verbatim (one per column)", () => {
    render(<OptimizerPanel prefetch={prefetch()} />);
    expect(screen.getByTitle(TOOLTIPS.corr)).toBeInTheDocument();
    expect(screen.getByTitle(TOOLTIPS.sharpe)).toBeInTheDocument();
    expect(screen.getByTitle(TOOLTIPS.dd)).toBeInTheDocument();
  });

  it("glossary labels match the rendered column labels; 'Score' is NOT documented (F-2)", () => {
    render(<OptimizerPanel prefetch={prefetch()} />);
    // Rendered synchronously before the dynamic PortfolioOptimizer resolves, so
    // these <dt> labels are the glossary's own — one per real column label.
    for (const label of COLUMN_LABELS) {
      expect(screen.getByText(label, { selector: "dt" })).toBeInTheDocument();
    }
    // "Score" is only a sort key, never a rendered column → must not be a glossary entry.
    expect(
      screen.queryByText("Score", { selector: "dt" }),
    ).not.toBeInTheDocument();
  });

  it("renders suggestions as a ranked list sorted by score DESC", async () => {
    const { container } = render(<OptimizerPanel prefetch={prefetch()} />);
    // Dynamic mount of PortfolioOptimizer resolves; its rows appear.
    await screen.findByText("Alpha");
    const text = container.textContent ?? "";
    // score desc: Alpha (0.9) → Charlie (0.7) → Bravo (0.5).
    expect(text.indexOf("Alpha")).toBeLessThan(text.indexOf("Charlie"));
    expect(text.indexOf("Charlie")).toBeLessThan(text.indexOf("Bravo"));
  });

  it("FORBIDS pie/weights/allocation-% framing (absence asserted)", async () => {
    const { container } = render(<OptimizerPanel prefetch={prefetch()} />);
    await screen.findByText("Alpha");
    const text = container.textContent ?? "";
    expect(text).not.toMatch(/weight/i);
    expect(text).not.toMatch(/allocation %/i);
    // No pie/donut charts.
    expect(container.querySelector('[data-testid*="pie"]')).toBeNull();
    expect(container.querySelector('[data-testid*="donut"]')).toBeNull();
  });

  it("shows a selector for ≥2 portfolios; switching remounts with null initials", async () => {
    render(
      <OptimizerPanel
        prefetch={prefetch({
          portfolios: [
            { id: "p1", name: "Book One", created_at: "2026-06-02T00:00:00Z" },
            { id: "p2", name: "Book Two", created_at: "2026-06-01T00:00:00Z" },
          ],
        })}
      />,
    );
    const select = screen.getByRole("combobox", { name: /portfolio/i });
    // Default portfolio's persisted suggestions render first.
    await screen.findByText("Alpha");

    fireEvent.change(select, { target: { value: "p2" } });
    // Non-default portfolio → null initials → PortfolioOptimizer's own run flow.
    expect(await screen.findByText(/Run Optimizer/i)).toBeInTheDocument();
  });

  it("shows NO selector when the user has exactly one portfolio", () => {
    render(<OptimizerPanel prefetch={prefetch()} />);
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
  });
});
