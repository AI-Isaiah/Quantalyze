/** @vitest-environment jsdom */
/**
 * Phase 170.6 DISPLAYPOLISH plan 10 (D-03, D-04, O-9): the Max DD cell on a
 * /recommendations card is red only when the drawdown rounds below zero at the 2 dp
 * the cell prints. A drawdown that prints "0.00%" or "—" is not red, and a drawdown
 * is never green. Today the call passes a constant `negative`.
 *
 * Mock idiom copied from page.stale-analytics.test.tsx. The cell is found by its
 * "Max DD" label (the value is its sibling span), not by printed text, so the test
 * does not depend on whether `formatPercent` prints "+0.00%" or "0.00%" (plan 02).
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import React from "react";

vi.mock("server-only", () => ({}));
vi.mock("next/link", () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) =>
    React.createElement("a", { href }, children),
}));
vi.mock("next/cache", () => ({ unstable_noStore: () => {} }));
vi.mock("next/navigation", () => ({
  redirect: () => {
    throw new Error("redirect() called");
  },
}));
vi.mock("@/lib/auth/requireRolePage", () => ({
  requireRolePage: async () => {},
}));
vi.mock("@/components/ui/Disclaimer", () => ({
  Disclaimer: () => React.createElement("div", { "data-testid": "disclaimer" }),
}));
vi.mock("@/components/legal/AccreditedInvestorGate", () => ({
  AccreditedInvestorGate: () =>
    React.createElement("div", { "data-testid": "gate" }),
}));

const seeded = vi.hoisted(() => ({
  recs: [] as unknown[],
  statusRows: [] as unknown[],
  statusError: null as unknown,
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: {
      getUser: async () => ({
        data: { user: { id: "00000000-0000-4000-8000-0000000000aa" } },
        error: null,
      }),
    },
    from: (table: string) => {
      const chain: Record<string, unknown> = {};
      chain.select = () => chain;
      chain.eq = () => chain;
      chain.in = () => chain;
      chain.maybeSingle = () =>
        Promise.resolve(
          table === "investor_attestations"
            ? { data: { attested_at: "2026-01-01T00:00:00Z" }, error: null }
            : {
                // A mandate the engine reads (D-03, plan 169.3-04): max_weight.
                data: { max_weight: 0.2, preferred_strategy_types: [], target_ticket_size_usd: 1 },
                error: null,
              },
        );
      // `strategy_analytics` is read by awaiting the `.in()` builder directly.
      chain.then = (onFulfilled: (v: { data: unknown; error: unknown }) => unknown) =>
        Promise.resolve(
          table === "strategy_analytics"
            ? { data: seeded.statusRows, error: seeded.statusError }
            : { data: [], error: null },
        ).then(onFulfilled);
      return chain;
    },
    rpc: async (name: string) =>
      name === "get_allocator_recommendations"
        ? { data: seeded.recs, error: null }
        : {
            data: [
              {
                batch_id: "51a10001-0000-4000-8000-0000000000b0",
                computed_at: "2026-08-25T00:00:00.000Z",
                candidate_count: 2,
              },
            ],
            error: null,
          },
  }),
}));

import RecommendationsPage from "./page";

const LIVE_ID = "51a10001-0000-4000-8000-00000000000e";

function rec(maxDrawdown: number | null) {
  return {
    id: `cand-${LIVE_ID}`,
    strategy_id: LIVE_ID,
    rank: 1,
    score: 0.9,
    reasons: ["Strong fit for your current mandate."],
    strategy_name: "Meridian",
    strategy_description: null,
    discovery_category_slug: "crypto-sma",
    cagr: 0.05,
    sharpe: 0.6,
    max_drawdown: maxDrawdown,
    analytics_computed_at: "2026-08-25T09:15:00.000Z",
  };
}

async function maxDdValue(maxDrawdown: number | null): Promise<HTMLElement> {
  seeded.recs = [rec(maxDrawdown)];
  seeded.statusRows = [{ strategy_id: LIVE_ID, computation_status: "complete" }];
  seeded.statusError = null;
  const ui = await RecommendationsPage();
  render(ui as React.ReactElement);
  const label = screen.getByText("Max DD");
  return label.parentElement!.lastElementChild as HTMLElement;
}

describe("/recommendations Max DD cell tone", () => {
  it("a drawdown of -0.00004 (prints 0.00%) is not red", async () => {
    const cell = await maxDdValue(-0.00004);
    expect(cell.textContent).toMatch(/^[+\-\u2212]?0\.00%$/);
    expect(cell.className).not.toContain("text-negative");
    expect(cell.className).toContain("text-text-primary");
  });

  it("a null drawdown (prints a dash) is not red", async () => {
    const cell = await maxDdValue(null);
    expect(cell.textContent).toBe("—");
    expect(cell.className).not.toContain("text-negative");
  });

  it("a drawdown of -0.0342 (prints -3.42%) is red", async () => {
    const cell = await maxDdValue(-0.0342);
    expect(cell.textContent).toBe("-3.42%");
    expect(cell.className).toContain("text-negative");
  });

  it("a drawdown is never green", async () => {
    const cell = await maxDdValue(0.05);
    expect(cell.className).not.toContain("text-positive");
    expect(cell.className).not.toContain("text-negative");
  });
});
