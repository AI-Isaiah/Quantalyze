/**
 * Phase 195 / WR-02 (D-08) — the root "Browse" crumb on the two child pages.
 *
 * `/browse` redirects to `/browse/<slug>` when exactly one category is
 * populated, so a "Browse" crumb linking to `/browse` on that page is a link
 * that lands where the visitor already is (and resets the table's sort/page/
 * search). With two or more categories `/browse` is a real menu and the crumb
 * must link to it. Same rule as `/browse` itself: ./browse-categories.
 *
 * Breadcrumb is mocked to record the `items` the page hands it, so the
 * assertion is on the crumb's href, not on rendered markup.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { BreadcrumbItem } from "@/components/layout/Breadcrumb";

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

const crumbs = vi.hoisted(() => ({ items: [] as BreadcrumbItem[] }));
vi.mock("@/components/layout/Breadcrumb", () => ({
  Breadcrumb: ({ items }: { items: BreadcrumbItem[] }) => {
    crumbs.items = items;
    return null;
  },
}));

import {
  getPopulatedCategorySlugs,
  getStrategiesByCategory,
  getPercentiles,
} from "@/lib/queries";
import { renderToStaticMarkup } from "react-dom/server";
import type { ReactElement } from "react";
import CategoryPage from "./[slug]/page";

async function renderCategory(slug = "crypto-sma") {
  renderToStaticMarkup(
    (await CategoryPage({ params: Promise.resolve({ slug }) })) as ReactElement,
  );
}

beforeEach(() => {
  crumbs.items = [];
  vi.mocked(getStrategiesByCategory).mockResolvedValue([]);
  vi.mocked(getPercentiles).mockResolvedValue(null);
});

describe("root Browse crumb follows the /browse redirect rule (WR-02)", () => {
  it("/browse/<cat>: one populated category -> no href on the Browse crumb", async () => {
    vi.mocked(getPopulatedCategorySlugs).mockResolvedValue(["crypto-sma"]);
    await renderCategory();
    expect(crumbs.items[0]).toEqual({ label: "Browse" });
    expect(crumbs.items[0].href).toBeUndefined();
  });

  it("/browse/<cat>: two populated categories -> Browse links to /browse", async () => {
    vi.mocked(getPopulatedCategorySlugs).mockResolvedValue(["crypto-sma", "cfd"]);
    await renderCategory();
    expect(crumbs.items[0]).toEqual({ label: "Browse", href: "/browse" });
  });

  it("/browse/<cat>: a failed/empty read never drops the link (no data, no claim)", async () => {
    vi.mocked(getPopulatedCategorySlugs).mockRejectedValue(new Error("db down"));
    await renderCategory();
    expect(crumbs.items[0]).toEqual({ label: "Browse", href: "/browse" });
  });

  it("/browse/<other>: one populated category, but this slug is not it -> the link is kept", async () => {
    // /browse would bounce to crypto-sma, not to this page, so "Browse" is the
    // only way to reach the populated category.
    vi.mocked(getPopulatedCategorySlugs).mockResolvedValue(["crypto-sma"]);
    await renderCategory("cfd");
    expect(crumbs.items[0]).toEqual({ label: "Browse", href: "/browse" });
  });
});
