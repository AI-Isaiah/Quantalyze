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
  getPublicStrategyDetail,
} from "@/lib/queries";
import { renderToStaticMarkup } from "react-dom/server";
import type { ReactElement } from "react";
import CategoryPage from "./[slug]/page";
import StrategyDetailPage from "./[slug]/[strategyId]/page";

async function renderCategory(slug = "crypto-sma") {
  renderToStaticMarkup(
    (await CategoryPage({ params: Promise.resolve({ slug }) })) as ReactElement,
  );
}

async function renderStrategy(slug = "crypto-sma") {
  renderToStaticMarkup(
    (await StrategyDetailPage({
      params: Promise.resolve({ slug, strategyId: "s-1" }),
    })) as ReactElement,
  );
}

beforeEach(() => {
  crumbs.items = [];
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

  it("/browse/<cat>/<id>: one populated category -> no href on Browse, category crumb still links", async () => {
    vi.mocked(getPopulatedCategorySlugs).mockResolvedValue(["crypto-sma"]);
    await renderStrategy();
    expect(crumbs.items[0]).toEqual({ label: "Browse" });
    expect(crumbs.items[1]).toMatchObject({ href: "/browse/crypto-sma" });
  });

  it("/browse/<cat>/<id>: two populated categories -> Browse links to /browse", async () => {
    vi.mocked(getPopulatedCategorySlugs).mockResolvedValue(["crypto-sma", "cfd"]);
    await renderStrategy();
    expect(crumbs.items[0]).toEqual({ label: "Browse", href: "/browse" });
    expect(crumbs.items[1]).toMatchObject({ href: "/browse/crypto-sma" });
  });

  it("/browse/<other>: one populated category, but this slug is not it -> the link is kept", async () => {
    // /browse would bounce to crypto-sma, not to this page, so "Browse" is the
    // only way to reach the populated category.
    vi.mocked(getPopulatedCategorySlugs).mockResolvedValue(["crypto-sma"]);
    await renderCategory("cfd");
    expect(crumbs.items[0]).toEqual({ label: "Browse", href: "/browse" });
  });

  it("/browse/<other>/<id>: one populated category, but this slug is not it -> the link is kept", async () => {
    vi.mocked(getPopulatedCategorySlugs).mockResolvedValue(["crypto-sma"]);
    await renderStrategy("cfd");
    expect(crumbs.items[0]).toEqual({ label: "Browse", href: "/browse" });
  });
});
