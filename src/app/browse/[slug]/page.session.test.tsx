/**
 * Phase 196 / ROUTE-02 — the category page's "Sign up free" box is for
 * visitors only.
 *
 * WHY. A signed-in reader who follows Go to Discovery's sibling links lands on
 * /browse/<cat>; a sign-up box there tells them the product does not know them.
 * The visitor arm pins that the copy and link are unchanged for everyone else.
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
}));
vi.mock("@/components/strategy/StrategyTable", () => ({ StrategyTable: () => null }));
vi.mock("@/components/layout/Breadcrumb", () => ({ Breadcrumb: () => null }));

const getUser = vi.hoisted(() => vi.fn());
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ auth: { getUser } }),
}));

import {
  getPopulatedCategorySlugs,
  getStrategiesByCategory,
  getPercentiles,
} from "@/lib/queries";
import CategoryPage from "./page";

async function render(): Promise<string> {
  return renderToStaticMarkup(
    (await CategoryPage({ params: Promise.resolve({ slug: "crypto-sma" }) })) as ReactElement,
  );
}

beforeEach(() => {
  vi.mocked(getPopulatedCategorySlugs).mockResolvedValue(["crypto-sma", "cfd"]);
  vi.mocked(getStrategiesByCategory).mockResolvedValue([]);
  vi.mocked(getPercentiles).mockResolvedValue(null);
  getUser.mockReset();
});

describe("/browse/<cat> sign-up box (ROUTE-02)", () => {
  it("is not rendered for a signed-in reader", async () => {
    getUser.mockResolvedValue({ data: { user: { id: "u-1" } }, error: null });
    const html = await render();
    expect(html).not.toContain("Sign up free");
    expect(html).not.toContain("Sign up for full analytics");
  });

  it("is rendered unchanged for a visitor", async () => {
    getUser.mockResolvedValue({ data: { user: null }, error: null });
    const html = await render();
    expect(html).toContain("Sign up free");
    expect(html).toContain('href="/signup"');
  });

  it("is rendered when the session read fails (visitor view is the safe default)", async () => {
    getUser.mockRejectedValue(new Error("auth down"));
    const html = await render();
    expect(html).toContain("Sign up free");
  });
});
