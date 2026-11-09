/**
 * Phase 195 / LEAN-07 (D-08) — `/browse` follows the category data.
 *
 * What each case protects:
 *
 *   ONE populated category — the card grid is a one-card menu. The server
 *   redirects to that category's page so the visitor never sees the menu paint.
 *
 *   TWO OR MORE — the cards, heading and sign-up block render as before; a
 *   redirect here would hide a real choice.
 *
 *   ZERO / FAILED — `getPopulatedCategorySlugs()` returns [] for both an
 *   empty result and a DB error (they are indistinguishable at HEAD), and the
 *   page then falls back to every category. A redirect is a claim made from
 *   data, and a failed read has no data: it must NEVER redirect.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

const populatedMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/queries", () => ({
  getPopulatedCategorySlugs: populatedMock,
}));

// Session read behind hasBrowseSession (ROUTE-02); default is a visitor.
const getUser = vi.hoisted(() => vi.fn());
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ auth: { getUser } }),
}));

const redirectMock = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({
  // redirect() throws to unwind the RSC render (mirrors next/navigation).
  redirect: (path: string) => {
    redirectMock(path);
    throw new Error("__REDIRECT__");
  },
}));

import BrowsePage from "./page";
import { DISCOVERY_CATEGORIES } from "@/lib/constants";

async function render(): Promise<string> {
  return renderToStaticMarkup(await BrowsePage());
}

beforeEach(() => {
  populatedMock.mockReset();
  redirectMock.mockReset();
  getUser.mockReset();
  getUser.mockResolvedValue({ data: { user: null }, error: null });
});

describe("/browse category count (D-08)", () => {
  it("redirects to the category page when exactly one category is populated", async () => {
    populatedMock.mockResolvedValue(["crypto-sma"]);
    await expect(BrowsePage()).rejects.toThrow("__REDIRECT__");
    expect(redirectMock).toHaveBeenCalledTimes(1);
    expect(redirectMock).toHaveBeenCalledWith("/browse/crypto-sma");
  });

  it("renders the category cards, heading and sign-up block when two are populated", async () => {
    const [a, b] = DISCOVERY_CATEGORIES;
    populatedMock.mockResolvedValue([a.slug, b.slug]);
    const html = await render();
    expect(redirectMock).not.toHaveBeenCalled();
    expect(html).toContain(`href="/browse/${a.slug}"`);
    expect(html).toContain(`href="/browse/${b.slug}"`);
    expect(html).toContain("Browse Verified Strategies");
    expect(html).toContain("Want full analytics and introductions?");
  });

  it("renders the fallback cards and never redirects when the read returns empty", async () => {
    populatedMock.mockResolvedValue([]);
    const html = await render();
    expect(redirectMock).not.toHaveBeenCalled();
    for (const c of DISCOVERY_CATEGORIES) {
      expect(html).toContain(`href="/browse/${c.slug}"`);
    }
  });

  it("renders the fallback cards and never redirects when the read rejects", async () => {
    populatedMock.mockRejectedValue(new Error("db down"));
    const html = await render();
    expect(redirectMock).not.toHaveBeenCalled();
    for (const c of DISCOVERY_CATEGORIES) {
      expect(html).toContain(`href="/browse/${c.slug}"`);
    }
  });
});

describe("/browse sign-up copy (UC-13)", () => {
  it("promises an allocation model, not portfolios", async () => {
    populatedMock.mockResolvedValue([]);
    const html = await render();
    expect(html).toContain("and model an allocation.");
    expect(html).not.toContain("build portfolios");
  });
});

describe("/browse sign-up prompt with a session (ROUTE-02)", () => {
  it("hides the Get Started Free block for a signed-in reader and keeps the cards", async () => {
    const [a, b] = DISCOVERY_CATEGORIES;
    populatedMock.mockResolvedValue([a.slug, b.slug]);
    getUser.mockResolvedValue({ data: { user: { id: "u-1" } }, error: null });
    const html = await render();
    expect(html).not.toContain("Get Started Free");
    expect(html).not.toContain("Want full analytics and introductions?");
    expect(html).toContain(`href="/browse/${a.slug}"`);
  });

  it("still shows the block to a visitor", async () => {
    const [a, b] = DISCOVERY_CATEGORIES;
    populatedMock.mockResolvedValue([a.slug, b.slug]);
    const html = await render();
    expect(html).toContain("Get Started Free");
  });

  it("redirects a signed-in reader on a one-category menu exactly as a visitor", async () => {
    populatedMock.mockResolvedValue(["crypto-sma"]);
    getUser.mockResolvedValue({ data: { user: { id: "u-1" } }, error: null });
    await expect(BrowsePage()).rejects.toThrow("__REDIRECT__");
    expect(redirectMock).toHaveBeenCalledWith("/browse/crypto-sma");
  });
});
