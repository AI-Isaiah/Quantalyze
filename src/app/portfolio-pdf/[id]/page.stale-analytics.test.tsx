/** @vitest-environment jsdom */
/**
 * STALE-01 part 2 — the portfolio PDF is a document that LEAVES the platform.
 *
 * It renders behind an HMAC render token, is printed to PDF and emailed on. A
 * wrong number here is wrong in a file the recipient keeps, with no page to
 * correct it on and no cache to expire.
 *
 * The per-constituent TWR / Sharpe / Max DD are read straight off each
 * strategy's own `strategy_analytics` row — OTHER managers' published rows, the
 * ones the production census found dead on 2026-08-25 (17 of 18 at
 * `computation_status = 'failed'`, still carrying cagr / sharpe /
 * max_drawdown). The embed did not even PROJECT the status column, so the page
 * had no way to tell a finished run's figures from a failed run's leftovers —
 * and printed them under a confident "Data as of …" vintage line.
 *
 * SCOPE NOTE, deliberately pinned by P-4 below: the portfolio-LEVEL KPI strip
 * comes from `portfolio_analytics`, a DIFFERENT table with its own status
 * vocabulary already handled by `adaptPortfolioAnalytics`. This fix does not
 * touch it, and the control asserts it still renders.
 *
 * ANTI-VACUITY: the dead constituent carries best-in-class values with unique
 * rendered strings; a terminal-success constituent sits beside it in the SAME
 * table asserting those strings DO render.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import React from "react";

vi.mock("server-only", () => ({}));
vi.mock("@/components/ui/Disclaimer", () => ({
  Disclaimer: () => React.createElement("div", { "data-testid": "disclaimer" }),
}));
// The HMAC token is not the claim under test; its own gate has its own spec.
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
      chain.single = () =>
        Promise.resolve({ data: seeded.portfolio, error: null });
      chain.maybeSingle = () =>
        Promise.resolve({ data: seeded.portfolioAnalytics, error: null });
      // `portfolio_strategies` awaits the builder directly (`.order(...)`).
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

// --- Fixtures -------------------------------------------------------------

const PORTFOLIO_ID = "51a10001-0000-4000-8000-0000000000f0";
const DEAD_ID = "51a10001-0000-4000-8000-00000000000d";
const LIVE_ID = "51a10001-0000-4000-8000-00000000000e";

const STALE_TEXT = { twr: "+66.12%", sharpe: "3.77", max_dd: "-3.11%" } as const;
const LIVE_TEXT = { twr: "+5.00%", sharpe: "0.60", max_dd: "-40.00%" } as const;

function constituent(
  id: string,
  name: string,
  status: string,
  kpis: { cagr: number; sharpe: number; max_drawdown: number },
) {
  return {
    strategy_id: id,
    current_weight: 0.5,
    strategies: {
      id,
      name,
      strategy_analytics: {
        ...kpis,
        volatility: 0.2,
        computation_status: status,
      },
    },
  };
}

const DEAD = (status = "failed") =>
  constituent(DEAD_ID, "Orpheus", status, {
    cagr: 0.6612,
    sharpe: 3.77,
    max_drawdown: -0.0311,
  });

const LIVE = (status = "complete") =>
  constituent(LIVE_ID, "Meridian", status, {
    cagr: 0.05,
    sharpe: 0.6,
    max_drawdown: -0.4,
  });

async function renderPdf(rows: ReturnType<typeof constituent>[]) {
  seeded.constituents = rows;
  const ui = await PortfolioPdfPage({
    params: Promise.resolve({ id: PORTFOLIO_ID }),
    searchParams: Promise.resolve({ renderToken: "stub" }),
  });
  render(ui as React.ReactElement);
}

function rowFor(name: string): HTMLElement {
  const cell = screen.getByText(name);
  const tr = cell.closest("tr");
  expect(tr, `no row rendered for ${name}`).not.toBeNull();
  return tr as HTMLElement;
}

beforeEach(() => {
  seeded.portfolio = {
    id: PORTFOLIO_ID,
    name: "Alpha Book",
    description: "A two-strategy book.",
  };
  // `adaptPortfolioAnalytics` REJECTS a row missing id / portfolio_id /
  // computed_at / a valid status — and a rejected row nulls the whole KPI strip
  // AND the attribution, which would make PD1's em-dash count and PD4 pass for
  // the wrong reason. All four are present deliberately.
  seeded.portfolioAnalytics = {
    id: "51a10001-0000-4000-8000-0000000000f1",
    portfolio_id: PORTFOLIO_ID,
    computation_status: "complete",
    computed_at: new Date().toISOString(),
    total_aum: 4_000_000,
    total_return_twr: 0.09,
    portfolio_sharpe: 1.1,
    portfolio_volatility: 0.18,
    portfolio_max_drawdown: -0.22,
    avg_pairwise_correlation: 0.31,
    attribution_breakdown: [
      { strategy_id: DEAD_ID, contribution: 0.11 },
      { strategy_id: LIVE_ID, contribution: 0.02 },
    ],
  };
  seeded.constituents = [];
});

describe("STALE-01 · portfolio PDF — a document that leaves the platform", () => {
  it("PD1: a `failed` constituent prints em-dashes where its dead figures were", async () => {
    await renderPdf([DEAD(), LIVE()]);
    const dead = within(rowFor("Orpheus"));

    for (const [metric, text] of Object.entries(STALE_TEXT)) {
      expect(
        dead.queryByText(text),
        `${metric} (${text}) from a failed run was printed into the PDF`,
      ).toBeNull();
    }
    expect(dead.getAllByText("—").length).toBe(3);
  });

  it("PD2: weight and the persisted attribution contribution survive", async () => {
    await renderPdf([DEAD(), LIVE()]);
    const dead = within(rowFor("Orpheus"));

    expect(dead.getByText("+50.00%")).toBeTruthy();
    expect(dead.getByText("+11.00%")).toBeTruthy();
  });

  it("PD3: a live `computing` constituent is withheld the same way", async () => {
    await renderPdf([DEAD("computing"), LIVE()]);

    expect(within(rowFor("Orpheus")).queryByText(STALE_TEXT.sharpe)).toBeNull();
  });

  it("PD4: the portfolio-level KPI strip is a DIFFERENT table and is untouched", async () => {
    await renderPdf([DEAD(), LIVE()]);

    expect(screen.getByText("$4.0M")).toBeTruthy();
    expect(screen.getByText("+9.00%")).toBeTruthy();
    expect(screen.getByText("1.10")).toBeTruthy();
  });

  it("PD5: CONTROL — the `complete` constituent prints every figure", async () => {
    await renderPdf([DEAD(), LIVE()]);
    const live = within(rowFor("Meridian"));

    for (const [metric, text] of Object.entries(LIVE_TEXT)) {
      expect(
        live.queryByText(text),
        `${metric} (${text}) vanished from a COMPLETE row — the gate is over-broad`,
      ).not.toBeNull();
    }
  });

  it("PD6: CONTROL — `complete_with_warnings` is a terminal SUCCESS and prints", async () => {
    await renderPdf([LIVE("complete_with_warnings")]);

    expect(within(rowFor("Meridian")).getByText(LIVE_TEXT.sharpe)).toBeTruthy();
  });
});
