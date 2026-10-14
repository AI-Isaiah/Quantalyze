/**
 * Phase 170.6 gap G01 (D-03, D-04): the Max Drawdown card on /strategy/[id] takes its
 * tone from the ROUNDED drawdown, never from a constant. A drawdown that prints "0.00%"
 * or "—" must not read red, and a drawdown is never green. Expected values are typed by
 * hand: -0.12 prints -12.00%, -0.00004 rounds to 0.00% at 2 dp.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import React from "react";

vi.mock("server-only", () => ({}));
vi.mock("next/link", () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) =>
    React.createElement("a", { href }, children),
}));
vi.mock("next/navigation", () => ({ notFound: vi.fn() }));
vi.mock("@/components/charts/Sparkline", () => ({ Sparkline: () => null }));
vi.mock("@/components/ui/Disclaimer", () => ({ Disclaimer: () => null }));
vi.mock("@/components/ui/VerifiedBadge", () => ({ VerifiedBadge: () => null }));
vi.mock("@/components/notes/StrategyNoteCard", () => ({ StrategyNoteCard: () => null }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn().mockResolvedValue({
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user: null } }) },
  }),
}));
vi.mock("@/lib/queries", () => ({ getPublicStrategyDetail: vi.fn() }));

import PublicStrategyPage from "./page";
import { getPublicStrategyDetail } from "@/lib/queries";

async function renderWithMaxDd(maxDrawdown: number | null) {
  vi.mocked(getPublicStrategyDetail).mockResolvedValue({
    strategy: { id: "s-1", name: "Test Strategy", trust_tier: null, start_date: null },
    analytics: {
      cagr: 0.25,
      sharpe: 1.5,
      sortino: 2.0,
      max_drawdown: maxDrawdown,
      volatility: 0.2,
      cumulative_return: 0.3,
      computation_status: "complete",
      sparkline_returns: [],
    },
    manager: null,
    disclosureTier: "exploratory",
  } as never);
  render(await PublicStrategyPage({ params: Promise.resolve({ id: "s-1" }) }));
  // The value <p> is the label <p>'s next sibling inside the card.
  return screen.getByText("Max Drawdown").nextElementSibling as HTMLElement;
}

afterEach(cleanup);

describe("/strategy/[id] Max Drawdown card tone (D-03, D-04)", () => {
  it("-0.12 prints -12.00% and is red", async () => {
    const value = await renderWithMaxDd(-0.12);
    expect(value.textContent).toBe("-12.00%");
    expect(value.className).toContain("text-negative");
  });

  it("-0.00004 prints 0.00% and is not red", async () => {
    const value = await renderWithMaxDd(-0.00004);
    expect(value.textContent).toBe("0.00%");
    expect(value.className).not.toContain("text-negative");
  });

  it("0 prints 0.00% and is not red", async () => {
    const value = await renderWithMaxDd(0);
    expect(value.textContent).toBe("0.00%");
    expect(value.className).not.toContain("text-negative");
  });

  it("a missing drawdown prints the dash and is not red", async () => {
    const value = await renderWithMaxDd(null);
    expect(value.textContent).toBe("—");
    expect(value.className).not.toContain("text-negative");
  });

  it.each([-0.12, -0.00004, 0, null])("a drawdown of %s is never green", async (dd) => {
    const value = await renderWithMaxDd(dd);
    expect(value.className).not.toContain("text-positive");
  });
});
