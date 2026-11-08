/**
 * Phase 194 plan 10 (D-04 as superseded by D-15, D-05) - the public browse strategy
 * page prints its five annualised figures (CAGR, Sharpe, Volatility in the hero grid;
 * Sortino, Calmar in the mini grid) only when the strategy's TOTAL record clears
 * D-15's minimum, with ONE muted line saying why or that the record is under a year.
 * Max Drawdown, 6 Month and Cumulative Return are not annualised and never gate.
 *
 * The expected sentences and verdicts are typed by hand from the UI-SPEC copy contract
 * and D-15 (crypto: 90 calendar days; non-crypto: 60 observations), not read back from
 * the gate module, so a threshold or wording drift fails here.
 */
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import React from "react";

vi.mock("server-only", () => ({}));
vi.mock("next/link", () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) =>
    React.createElement("a", { href }, children),
}));
vi.mock("@/components/charts/Sparkline", () => ({ Sparkline: () => null }));
vi.mock("@/components/ui/Disclaimer", () => ({ Disclaimer: () => null }));
vi.mock("@/components/ui/VerifiedBadge", () => ({ VerifiedBadge: () => null }));
vi.mock("@/components/strategy/ManagerIdentityPanel", () => ({ ManagerIdentityPanel: () => null }));
vi.mock("@/lib/queries", () => ({
  getPublicStrategyDetail: vi.fn(),
  getPopulatedCategorySlugs: async () => ["crypto-sma", "cfd"],
}));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn(async () => ({})) }));
vi.mock("@/lib/record-span-read", () => ({ readRecordSpan: vi.fn() }));
vi.mock("@/lib/sentry-capture", () => ({ captureToSentry: vi.fn() }));

import PublicStrategyDetailPage from "./page";
import { getPublicStrategyDetail } from "@/lib/queries";
import { createClient } from "@/lib/supabase/server";
import { readRecordSpan } from "@/lib/record-span-read";
import { captureToSentry } from "@/lib/sentry-capture";

const START = "2025-01-01";

/** The last date of a record that COVERS `days` days from START (D-20: both ends counted). */
function endAfter(days: number): string {
  const d = new Date(`${START}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days - 1);
  return d.toISOString().slice(0, 10);
}

function span(days: number, observations: number | null) {
  return {
    determined: true as const,
    seriesStart: START,
    seriesEnd: endAfter(days),
    headlineSince: null,
    observations,
  };
}

const ANALYTICS = {
  cagr: 0.25,
  sharpe: 1.5,
  sortino: 2.0,
  calmar: 2.5,
  max_drawdown: -0.12,
  volatility: 0.2,
  six_month_return: 0.1,
  cumulative_return: 0.3,
  sparkline_returns: [] as number[],
};

async function renderPage(
  read: ReturnType<typeof span> | { determined: false },
  assetClass: "crypto" | "traditional",
  analytics: Partial<typeof ANALYTICS> = {},
) {
  vi.mocked(readRecordSpan).mockResolvedValue(read);
  vi.mocked(getPublicStrategyDetail).mockResolvedValue({
    strategy: {
      id: "s-1",
      name: "Test Strategy",
      codename: "STRAT-001",
      api_key_id: null,
      trust_tier: null,
      strategy_types: [],
      description: null,
      asset_class: assetClass,
    },
    analytics: { ...ANALYTICS, ...analytics },
    manager: null,
    disclosureTier: "exploratory",
  } as never);
  render(
    await PublicStrategyDetailPage({
      params: Promise.resolve({ slug: "momentum", strategyId: "s-1" }),
    }),
  );
}

/** The value <p> is the label <p>'s next sibling inside its card. */
function value(label: string): HTMLElement {
  return screen.getByText(label).nextElementSibling as HTMLElement;
}

const FIVE = ["CAGR", "Sharpe", "Volatility", "Sortino", "Calmar"] as const;

let errorSpy: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  cleanup();
  errorSpy.mockRestore();
  vi.mocked(createClient).mockImplementation(async () => ({}) as never);
});

function expectNotAnnualizedUntouched() {
  expect(value("Max Drawdown").textContent).toBe("-12.00%");
  expect(value("6 Month Return").textContent).toBe("+10.00%");
  expect(value("Cumulative Return").textContent).toBe("+30.00%");
}

describe("/browse/[slug]/[strategyId] annualised figures (D-04 as superseded by D-15)", () => {
  it("a crypto 60-day record withholds the five figures with no tone and one reason line", async () => {
    await renderPage(span(60, 60), "crypto");
    for (const label of FIVE) expect(value(label).textContent).toBe("—");
    // Untoned: a withheld figure is neither green nor red.
    for (const label of ["CAGR", "Sharpe"]) {
      expect(value(label).className).not.toContain("text-positive");
      expect(value(label).className).not.toContain("text-negative");
    }
    const note = screen.getAllByTestId("browse-figure-gate-note");
    expect(note).toHaveLength(1);
    expect(note[0].textContent).toBe(
      "Annualized figures appear once the record reaches 90 days. This record covers 60 days.",
    );
    expectNotAnnualizedUntouched();
  });

  it("a crypto record of 89 days is withheld and 90 days shows", async () => {
    await renderPage(span(89, 89), "crypto");
    expect(value("CAGR").textContent).toBe("—");
    cleanup();
    await renderPage(span(90, 90), "crypto");
    expect(value("CAGR").textContent).toBe("+25.00%");
  });

  it("a non-crypto record of 59 stored observations is withheld and names 60 trading days", async () => {
    await renderPage(span(84, 59), "traditional");
    for (const label of FIVE) expect(value(label).textContent).toBe("—");
    expect(screen.getByTestId("browse-figure-gate-note").textContent).toBe(
      "Annualized figures appear once the record reaches 60 trading days. This record has 59 trading days.",
    );
  });

  it("a non-crypto record of 60 observations over 84 days shows the figures with one short-track line", async () => {
    await renderPage(span(84, 60), "traditional");
    expect(value("CAGR").textContent).toBe("+25.00%");
    expect(value("Sharpe").textContent).toBe("1.50");
    expect(value("Volatility").textContent).toBe("+20.00%");
    expect(value("Sortino").textContent).toBe("2.00");
    expect(value("Calmar").textContent).toBe("2.50");
    expect(screen.getByTestId("browse-figure-gate-note").textContent).toBe(
      "CAGR, volatility, Sharpe, Sortino and Calmar are annualized from 84 days of record, under one year.",
    );
  });

  it("a non-crypto record with no stored count falls back to the 90-day bound (interim)", async () => {
    await renderPage(span(89, null), "traditional");
    expect(value("CAGR").textContent).toBe("—");
    cleanup();
    await renderPage(span(90, null), "traditional");
    expect(value("CAGR").textContent).toBe("+25.00%");
  });

  it("a 200-day record shows the figures with one short-track line of 200 days", async () => {
    await renderPage(span(200, 200), "crypto");
    expect(value("CAGR").textContent).toBe("+25.00%");
    expect(screen.getByTestId("browse-figure-gate-note").textContent).toBe(
      "CAGR, volatility, Sharpe, Sortino and Calmar are annualized from 200 days of record, under one year.",
    );
  });

  it("a 400-day record shows the figures and adds nothing", async () => {
    await renderPage(span(400, 400), "crypto");
    expect(value("CAGR").textContent).toBe("+25.00%");
    expect(screen.queryByTestId("browse-figure-gate-note")).toBeNull();
    expectNotAnnualizedUntouched();
  });

  it("a span read error withholds the five figures, says they are temporarily unavailable and logs [browse] with the id", async () => {
    await renderPage({ determined: false }, "crypto");
    for (const label of FIVE) expect(value(label).textContent).toBe("—");
    expect(screen.getByTestId("browse-figure-gate-note").textContent).toBe(
      "Annualized figures are temporarily unavailable. Reload to retry.",
    );
    expect(errorSpy).toHaveBeenCalledWith("[browse] record span read failed", { strategyId: "s-1" });
    expectNotAnnualizedUntouched();
  });

  it("a request client that cannot be created fails closed, is reported to Sentry and logs the id and error", async () => {
    const boom = new Error("no cookies");
    vi.mocked(createClient).mockRejectedValueOnce(boom);
    vi.mocked(captureToSentry).mockClear();
    await renderPage(span(400, 400), "crypto");
    for (const label of FIVE) expect(value(label).textContent).toBe("—");
    expect(screen.getByTestId("browse-figure-gate-note").textContent).toBe(
      "Annualized figures are temporarily unavailable. Reload to retry.",
    );
    expect(captureToSentry).toHaveBeenCalledWith(
      boom,
      expect.objectContaining({ tags: expect.objectContaining({ strategy_id: "s-1" }) }),
    );
    expect(errorSpy).toHaveBeenCalledWith("[browse] record span read failed", {
      strategyId: "s-1",
      error: boom,
    });
  });

  it("a 13-digit cumulative return renders like any value (D-05)", async () => {
    await renderPage(span(400, 400), "crypto", { cumulative_return: 12_345_678_901.23 });
    expect(value("Cumulative Return").textContent).toBe("+1234567890123.00%");
    expect(screen.queryByTestId("browse-figure-gate-note")).toBeNull();
  });
});
