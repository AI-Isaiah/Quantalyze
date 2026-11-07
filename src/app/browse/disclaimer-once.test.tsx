/**
 * Phase 195 / LEAN-07 (D-09, UC-18) — every /browse page renders its legal
 * disclaimer exactly ONCE.
 *
 * THE DEFECT. `/browse/<cat>/<id>` printed three blocks: a custody box under
 * the manager panel, a strategy paragraph at the bottom, and the layout's
 * footer. The layout footer was the one that could not be removed per page, so
 * it moved INTO the two pages that need only the general wording.
 *
 * WHY THE POSITIVE CONTROLS. The risk in removing a duplicate is removing the
 * wrong one: a page left with NO disclaimer is a legal statement silently gone
 * (T-195-09). So each page is asserted to carry its sentences exactly once, not
 * merely "no duplicate".
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { ReactElement } from "react";

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({
  redirect: () => {
    throw new Error("__REDIRECT__");
  },
}));
vi.mock("@/lib/queries", () => ({
  getPopulatedCategorySlugs: vi.fn(),
  getStrategiesByCategory: vi.fn(),
  getPercentiles: vi.fn(),
  getPublicStrategyDetail: vi.fn(),
}));
vi.mock("@/components/strategy/StrategyTable", () => ({ StrategyTable: () => null }));
vi.mock("@/components/charts/Sparkline", () => ({ Sparkline: () => null }));
vi.mock("@/components/strategy/ManagerIdentityPanel", () => ({
  ManagerIdentityPanel: () => null,
}));
vi.mock("@/components/layout/Breadcrumb", () => ({ Breadcrumb: () => null }));

import {
  getPopulatedCategorySlugs,
  getStrategiesByCategory,
  getPercentiles,
  getPublicStrategyDetail,
} from "@/lib/queries";
import BrowseLayout from "./layout";
import BrowsePage from "./page";
import CategoryPage from "./[slug]/page";
import StrategyDetailPage from "./[slug]/[strategyId]/page";

const GENERAL =
  "Not financial advice. Past performance does not guarantee future results. Cryptocurrency trading involves substantial risk of loss.";
const CUSTODY_SENTENCE = "Manager retains asset custody.";
const PROVENANCE_API = "Data verified from exchange API.";

function count(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

beforeEach(() => {
  vi.mocked(getPopulatedCategorySlugs).mockResolvedValue(["crypto-sma", "cfd"]);
  vi.mocked(getStrategiesByCategory).mockResolvedValue([]);
  vi.mocked(getPercentiles).mockResolvedValue(null);
  vi.mocked(getPublicStrategyDetail).mockResolvedValue({
    strategy: {
      id: "s-1",
      name: "Test Strategy",
      codename: "STRAT-001",
      trust_tier: "api_verified",
      strategy_types: [],
      description: null,
    },
    analytics: {
      cagr: 0.25,
      sharpe: 1.5,
      sortino: 2.0,
      calmar: 2.5,
      max_drawdown: -0.1,
      volatility: 0.2,
      six_month_return: 0.1,
      cumulative_return: 0.3,
      sparkline_returns: [],
    },
    manager: null,
    disclosureTier: "exploratory",
  } as never);
});

describe("/browse disclaimer once (D-09)", () => {
  it("the layout no longer mounts a disclaimer of its own", () => {
    const html = renderToStaticMarkup(
      <BrowseLayout>
        <div id="page-body" />
      </BrowseLayout>,
    );
    expect(html).toContain('id="page-body"');
    expect(html).not.toContain("Not financial advice");
  });

  it("/browse mounts exactly one general footer disclaimer", async () => {
    const html = renderToStaticMarkup((await BrowsePage()) as ReactElement);
    expect(count(html, GENERAL)).toBe(1);
  });

  it("/browse/<cat> mounts exactly one general footer disclaimer", async () => {
    const html = renderToStaticMarkup(
      (await CategoryPage({ params: Promise.resolve({ slug: "crypto-sma" }) })) as ReactElement,
    );
    expect(count(html, GENERAL)).toBe(1);
  });

  it("/browse/<cat>/<id> renders one combined block, after the sign-up CTA card", async () => {
    const html = renderToStaticMarkup(
      (await StrategyDetailPage({
        params: Promise.resolve({ slug: "crypto-sma", strategyId: "s-1" }),
      })) as ReactElement,
    );
    expect(count(html, GENERAL)).toBe(1);
    expect(count(html, CUSTODY_SENTENCE)).toBe(1);
    expect(count(html, PROVENANCE_API)).toBe(1);
    expect(html).not.toContain("is not indicative of future results");
    // One block, and it sits after the sign-up CTA card (the last content element).
    expect(html.indexOf("View factsheet")).toBeGreaterThan(-1);
    expect(html.indexOf(CUSTODY_SENTENCE)).toBeGreaterThan(html.indexOf("View factsheet"));
    // The combined block is the last element, so nothing renders after its text.
    expect(html.trimEnd().endsWith("</p>")).toBe(true);
    expect(html.lastIndexOf("<p")).toBeLessThan(html.indexOf(CUSTODY_SENTENCE));
  });
});
