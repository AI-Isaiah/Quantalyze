/** @vitest-environment jsdom */
/**
 * Phase 170.6 DISPLAYPOLISH plan 10 (D-03, D-04): the two Max DD cells on /demo (the
 * holdings list and the recommendation cards) are red only when the drawdown rounds
 * below zero at the 2 dp the cell prints. A drawdown that prints "0.00%" or "—" is not
 * red, and a drawdown is never green. Today both cells carry a constant `negative`.
 *
 * The cells are found by their "Max DD" label (first = holdings, second = the
 * recommendation card), not by printed text, so the test does not depend on whether
 * `formatPercent` prints "+0.00%" or "0.00%" (plan 02).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import React from "react";

vi.mock("next/link", () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) =>
    React.createElement("a", { href }, children),
}));

const seeded = vi.hoisted(() => ({
  holdingDd: null as number | null,
  recDd: null as number | null,
}));

type Result = { data: unknown; error: null };
const single = (): Record<string, Result> => ({
  profiles: { data: { id: "p", display_name: "Demo", company: "Demo LP" }, error: null },
  portfolios: { data: { id: "11111111-1111-4111-8111-111111111111", name: "P", description: null }, error: null },
});
const multi = (): Record<string, Result> => ({
  match_batches: { data: [], error: null },
  portfolio_strategies: {
    data: [
      {
        strategy_id: "s1",
        current_weight: 0.5,
        allocated_amount: 100000,
        strategies: {
          id: "s1",
          name: "Holding One",
          codename: null,
          disclosure_tier: "institutional",
          description: null,
          strategy_analytics: { cagr: 0.2, sharpe: 1.5, max_drawdown: seeded.holdingDd },
        },
      },
    ],
    error: null,
  },
});

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: (table: string) => {
      const c: Record<string, unknown> = {};
      for (const m of ["select", "eq", "order", "limit"]) c[m] = () => c;
      c.maybeSingle = () => Promise.resolve(single()[table] ?? { data: null, error: null });
      c.then = (res: (v: Result) => unknown, rej: (e: unknown) => unknown) =>
        Promise.resolve(multi()[table] ?? { data: null, error: null }).then(res, rej);
      return c;
    },
  }),
}));
vi.mock("@/lib/warmup-analytics", () => ({ warmupAnalytics: () => {} }));
vi.mock("@/lib/demo-recommendations", () => ({
  resolveDemoRecommendations: async () => ({
    recommendations: [
      {
        id: "r1",
        rank: 1,
        score: 80,
        reasons: ["fit"],
        strategy: {
          id: "s2",
          name: "Recommendation One",
          codename: null,
          disclosure_tier: "institutional",
          description: null,
        },
        analytics: { cagr: 0.3, sharpe: 2.1, max_drawdown: seeded.recDd },
      },
    ],
    usedBatchId: "b1",
    fellBackToPrevious: false,
  }),
}));
// Section components that are irrelevant to the Max DD cells.
vi.mock("@/components/portfolio/EditorialHero", () => ({ EditorialHero: () => null }));
vi.mock("@/components/portfolio/CounterfactualStrip", () => ({ CounterfactualStrip: () => null }));
vi.mock("@/components/portfolio/MorningBriefing", () => ({ MorningBriefing: () => null }));
vi.mock("@/components/portfolio/WinnersLosersStrip", () => ({ WinnersLosersStrip: () => null }));
vi.mock("@/components/portfolio/InsightStrip", () => ({ InsightStrip: () => null }));
vi.mock("@/components/portfolio/WhatWedDoCard", () => ({ WhatWedDoCard: () => null }));
vi.mock("@/components/portfolio/NextFiveMillionCard", () => ({ NextFiveMillionCard: () => null }));

import DemoPage from "./page";

beforeEach(() => {
  seeded.holdingDd = null;
  seeded.recDd = null;
});

async function renderPage(): Promise<{ holding: HTMLElement; rec: HTMLElement }> {
  const ui = await DemoPage({ searchParams: Promise.resolve({}) });
  render(ui);
  const labels = screen.getAllByText("Max DD");
  expect(labels).toHaveLength(2);
  const valueOf = (label: HTMLElement) => label.parentElement!.lastElementChild as HTMLElement;
  return { holding: valueOf(labels[0]), rec: valueOf(labels[1]) };
}

describe.each([
  ["holdings", "holding"],
  ["recommendation card", "rec"],
] as const)("/demo %s Max DD cell", (_name, key) => {
  const set = (v: number | null) => {
    if (key === "holding") seeded.holdingDd = v;
    else seeded.recDd = v;
  };

  it("a drawdown of -0.00004 (prints 0.00%) is not red", async () => {
    set(-0.00004);
    const cell = (await renderPage())[key];
    expect(cell.textContent).toMatch(/^[+\-−]?0\.00%$/);
    expect(cell.className).not.toContain("text-negative");
    expect(cell.className).toContain("text-text-primary");
  });

  it("a null drawdown (prints a dash) is not red", async () => {
    set(null);
    const cell = (await renderPage())[key];
    expect(cell.textContent).toBe("—");
    expect(cell.className).not.toContain("text-negative");
  });

  it("a drawdown of -0.0342 (prints -3.42%) is red", async () => {
    set(-0.0342);
    const cell = (await renderPage())[key];
    expect(cell.textContent).toBe("-3.42%");
    expect(cell.className).toContain("text-negative");
  });

  it("a drawdown is never green", async () => {
    set(0.05);
    const cell = (await renderPage())[key];
    expect(cell.className).not.toContain("text-positive");
    expect(cell.className).not.toContain("text-negative");
  });
});
