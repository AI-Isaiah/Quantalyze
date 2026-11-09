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
// No session: the layout and pages read it through hasBrowseSession (ROUTE-02).
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: null }, error: null }) },
  }),
}));
vi.mock("next/navigation", () => ({
  redirect: () => {
    throw new Error("__REDIRECT__");
  },
  usePathname: () => "/browse",
}));
vi.mock("@/lib/queries", () => ({
  getPopulatedCategorySlugs: vi.fn(),
  getStrategiesByCategory: vi.fn(),
  getPercentiles: vi.fn(),
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
} from "@/lib/queries";
import BrowseLayout from "./layout";
import BrowsePage from "./page";
import CategoryPage from "./[slug]/page";

const GENERAL =
  "Not financial advice. Past performance does not guarantee future results. Cryptocurrency trading involves substantial risk of loss.";

function count(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

beforeEach(() => {
  vi.mocked(getPopulatedCategorySlugs).mockResolvedValue(["crypto-sma", "cfd"]);
  vi.mocked(getStrategiesByCategory).mockResolvedValue([]);
  vi.mocked(getPercentiles).mockResolvedValue(null);
});

describe("/browse disclaimer once (D-09)", () => {
  it("the layout no longer mounts a disclaimer of its own", async () => {
    const html = renderToStaticMarkup(
      await BrowseLayout({ children: <div id="page-body" /> }),
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
});
