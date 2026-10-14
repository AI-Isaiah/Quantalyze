/** @vitest-environment jsdom */
/**
 * Phase 170.6 DISPLAYPOLISH plan 10 (D-03, D-04): the Max DD cell of the portfolio
 * PDF's holdings table is red only when the drawdown rounds below zero at the 2 dp the
 * cell prints. A drawdown that prints "0.00%" or "—" is not red, and a drawdown is
 * never green. Today the cell carries a constant `text-negative`.
 *
 * Mock idiom copied from page.stale-analytics.test.tsx. The cell is the fifth <td> of
 * the strategy row (Strategy, Weight, TWR, Sharpe, Max DD, Contribution), found by
 * position so the test does not depend on how `formatPercent` prints a zero (plan 02).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import React from "react";

vi.mock("server-only", () => ({}));
vi.mock("@/components/ui/Disclaimer", () => ({
  Disclaimer: () => React.createElement("div", { "data-testid": "disclaimer" }),
}));
vi.mock("@/lib/pdf-render-token", () => ({
  verifyPdfRenderToken: () => true,
}));

const seeded = vi.hoisted(() => ({
  portfolio: null as unknown,
  portfolioAnalytics: null as unknown,
  constituents: [] as unknown[],
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: (table: string) => {
      const chain: Record<string, unknown> = {};
      chain.select = () => chain;
      chain.eq = () => chain;
      chain.order = () => chain;
      chain.limit = () => chain;
      chain.single = () => Promise.resolve({ data: seeded.portfolio, error: null });
      chain.maybeSingle = () =>
        Promise.resolve({ data: seeded.portfolioAnalytics, error: null });
      chain.then = (onFulfilled: (v: { data: unknown; error: unknown }) => unknown) =>
        Promise.resolve(
          table === "portfolio_strategies"
            ? { data: seeded.constituents, error: null }
            : { data: null, error: null },
        ).then(onFulfilled);
      return chain;
    },
  }),
}));

import PortfolioPdfPage from "./page";

const PORTFOLIO_ID = "51a10001-0000-4000-8000-0000000000f0";
const STRATEGY_ID = "51a10001-0000-4000-8000-00000000000e";

beforeEach(() => {
  seeded.portfolio = { id: PORTFOLIO_ID, name: "Alpha Book", description: "A book." };
  seeded.portfolioAnalytics = null;
  seeded.constituents = [];
});

/** Render the PDF with one `complete` constituent and return its Max DD <td>. */
async function maxDdCell(maxDrawdown: number | null): Promise<HTMLElement> {
  seeded.constituents = [
    {
      strategy_id: STRATEGY_ID,
      current_weight: 0.5,
      strategies: {
        id: STRATEGY_ID,
        name: "Meridian",
        strategy_analytics: {
          cagr: 0.05,
          sharpe: 0.6,
          max_drawdown: maxDrawdown,
          volatility: 0.2,
          computation_status: "complete",
        },
      },
    },
  ];
  const ui = await PortfolioPdfPage({
    params: Promise.resolve({ id: PORTFOLIO_ID }),
    searchParams: Promise.resolve({ renderToken: "stub" }),
  });
  render(ui as React.ReactElement);
  const tr = screen.getByText("Meridian").closest("tr") as HTMLElement;
  return tr.querySelectorAll("td")[4] as HTMLElement;
}

describe("portfolio PDF Max DD cell tone", () => {
  it("a drawdown of -0.00004 (prints 0.00%) is not red", async () => {
    const cell = await maxDdCell(-0.00004);
    expect(cell.textContent).toMatch(/^[+\-−]?0\.00%$/);
    expect(cell.className).not.toContain("text-negative");
    expect(cell.className).toContain("text-text-primary");
  });

  it("a null drawdown (prints a dash) is not red", async () => {
    const cell = await maxDdCell(null);
    expect(cell.textContent).toBe("—");
    expect(cell.className).not.toContain("text-negative");
  });

  it("a drawdown of -0.0342 (prints -3.42%) is red", async () => {
    const cell = await maxDdCell(-0.0342);
    expect(cell.textContent).toBe("-3.42%");
    expect(cell.className).toContain("text-negative");
  });

  it("a drawdown is never green", async () => {
    const cell = await maxDdCell(0.05);
    expect(cell.className).not.toContain("text-positive");
    expect(cell.className).not.toContain("text-negative");
  });
});
