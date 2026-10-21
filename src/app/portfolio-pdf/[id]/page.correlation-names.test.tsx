/** @vitest-environment jsdom */
/**
 * 170.1.2 CR-02 — the portfolio PDF leaves the platform (HMAC render token,
 * printed, emailed), so a strategy id fragment in its correlation matrix is a
 * leak the recipient keeps. A stored matrix can still carry a strategy that has
 * since left the portfolio; its name lives in `strategies`, so the page must
 * read it, and fall back to "Unnamed strategy" only on a true miss.
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
  strategies: [] as Array<{ id: string; name: string | null }>,
  strategiesError: null as { message: string } | null,
  strategyLookups: [] as string[][],
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: (table: string) => {
      const chain: Record<string, unknown> = {};
      chain.select = () => chain;
      chain.eq = () => chain;
      chain.order = () => chain;
      chain.limit = () => chain;
      chain.in = (_col: string, ids: string[]) => {
        seeded.strategyLookups.push(ids);
        return Promise.resolve({
          data: seeded.strategiesError
            ? null
            : seeded.strategies.filter((s) => ids.includes(s.id)),
          error: seeded.strategiesError,
        });
      };
      chain.single = () =>
        Promise.resolve({ data: seeded.portfolio, error: null });
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
const LIVE_ID = "3f9a1c2e-4b7d-4c11-9a00-00000000000e";
const DEPARTED_ID = "7be5d0aa-91c3-4f2e-8d10-00000000000d";
const GHOST_ID = "c0ffee00-0000-4000-8000-0000000000aa";

async function renderPdf() {
  const ui = await PortfolioPdfPage({
    params: Promise.resolve({ id: PORTFOLIO_ID }),
    searchParams: Promise.resolve({ renderToken: "stub" }),
  });
  render(ui as React.ReactElement);
}

beforeEach(() => {
  seeded.portfolio = { id: PORTFOLIO_ID, name: "Alpha Book", description: "" };
  seeded.constituents = [
    {
      strategy_id: LIVE_ID,
      current_weight: 1,
      strategies: {
        id: LIVE_ID,
        name: "Meridian",
        strategy_analytics: {
          cagr: 0.05,
          sharpe: 0.6,
          max_drawdown: -0.4,
          volatility: 0.2,
          computation_status: "complete",
        },
      },
    },
  ];
  seeded.strategies = [{ id: DEPARTED_ID, name: "Orpheus Macro" }];
  seeded.strategiesError = null;
  seeded.strategyLookups = [];
  seeded.portfolioAnalytics = {
    id: "51a10001-0000-4000-8000-0000000000f1",
    portfolio_id: PORTFOLIO_ID,
    computation_status: "complete",
    computed_at: new Date().toISOString(),
    total_aum: 4_000_000,
    correlation_matrix: {
      [LIVE_ID]: { [LIVE_ID]: 1, [DEPARTED_ID]: 0.42 },
      [DEPARTED_ID]: { [LIVE_ID]: 0.42, [DEPARTED_ID]: 1 },
    },
  };
});

describe("CR-02 · portfolio PDF correlation matrix names", () => {
  it("names a strategy that left the portfolio from `strategies`, never an id fragment", async () => {
    await renderPdf();

    expect(seeded.strategyLookups).toEqual([[DEPARTED_ID]]);
    // Header cell + row label both carry the real name.
    expect(screen.getAllByText("Orpheus Macro").length).toBe(2);
    const text = document.body.textContent ?? "";
    expect(text).not.toContain(DEPARTED_ID.slice(0, 8));
    expect(text).not.toContain(LIVE_ID.slice(0, 8));
  });

  it("falls back to 'Unnamed strategy' only on a true miss, still no id", async () => {
    seeded.strategies = [];
    await renderPdf();

    expect(screen.getAllByText("Unnamed strategy").length).toBe(2);
    expect(document.body.textContent ?? "").not.toContain(
      DEPARTED_ID.slice(0, 8),
    );
  });

  it("does not read `strategies` when every matrix key is a current member", async () => {
    seeded.portfolioAnalytics = {
      ...(seeded.portfolioAnalytics as object),
      correlation_matrix: { [LIVE_ID]: { [LIVE_ID]: 1 } },
    };
    await renderPdf();

    expect(seeded.strategyLookups).toEqual([]);
  });

  it("fails loud when the name lookup errors, rather than printing wrong labels", async () => {
    seeded.strategiesError = { message: "boom" };
    await expect(renderPdf()).rejects.toThrow("boom");
  });

  it("the lookup failure names the operation and the portfolio, so the error page is traceable", async () => {
    seeded.strategiesError = { message: "boom" };
    await expect(renderPdf()).rejects.toThrow(
      `correlation names read failed for portfolio ${PORTFOLIO_ID}: boom`,
    );
  });

  it("numbers the unresolved strategies when more than one is unresolved, so headers stay distinct", async () => {
    seeded.strategies = [];
    seeded.portfolioAnalytics = {
      ...(seeded.portfolioAnalytics as object),
      correlation_matrix: {
        [DEPARTED_ID]: { [DEPARTED_ID]: 1, [GHOST_ID]: 0.1 },
        [GHOST_ID]: { [DEPARTED_ID]: 0.1, [GHOST_ID]: 1 },
      },
    };
    await renderPdf();

    expect(screen.getAllByText("Unnamed strategy 1").length).toBe(2);
    expect(screen.getAllByText("Unnamed strategy 2").length).toBe(2);
    expect(screen.queryByText("Unnamed strategy")).toBeNull();
  });

  it("a member row whose strategy embed is missing reads 'Unnamed strategy', not 'Unknown'", async () => {
    seeded.constituents = [
      { strategy_id: GHOST_ID, current_weight: 1, strategies: null },
    ];
    seeded.portfolioAnalytics = {
      ...(seeded.portfolioAnalytics as object),
      correlation_matrix: null,
    };
    await renderPdf();

    expect(screen.getByText("Unnamed strategy")).toBeTruthy();
    expect(screen.queryByText("Unknown")).toBeNull();
  });
});
