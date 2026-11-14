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
 *   EMPTY — the read succeeded with no rows: the empty line renders
 *   ("No strategies published yet. Check back soon."), with no cards, and the
 *   page never redirects.
 *
 *   FAILED — Phase 208 (D-02..D-04): `getPopulatedCategorySlugs()` now THROWS
 *   on a read error and `getBrowseCategories()` reports "ok" | "empty" |
 *   "error". A failed read renders the error block (role="alert", a Try again
 *   link), no cards, no empty line, and never redirects.
 *
 *   The Phase 195 fallback-card arms ("renders the fallback cards ... when the
 *   read returns empty" / "... rejects") were REPLACED ON PURPOSE by Phase 208
 *   (D-04): a card is a claim that the category has strategies, and a failed
 *   read has no data to make that claim from.
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

  it("renders the empty line, no cards and no redirect when the read returns empty", async () => {
    populatedMock.mockResolvedValue([]);
    const html = await render();
    expect(redirectMock).not.toHaveBeenCalled();
    expect(html).toContain("No strategies published yet. Check back soon.");
    for (const c of DISCOVERY_CATEGORIES) {
      expect(html).not.toContain(`href="/browse/${c.slug}"`);
    }
    expect(html).not.toContain('role="alert"');
  });

  it("renders the error block, no cards, no empty line and no redirect when the read rejects", async () => {
    populatedMock.mockRejectedValue(new Error("db down"));
    const html = await render();
    expect(redirectMock).not.toHaveBeenCalled();
    expect(html).toContain('role="alert"');
    expect(html).toContain("We couldn&#x27;t load the strategy categories.");
    expect(html).toContain(
      "No categories are listed because the read failed, not because nothing is published.",
    );
    expect(html).toMatch(/<a[^>]*href="\/browse"[^>]*>Try again<\/a>/);
    for (const c of DISCOVERY_CATEGORIES) {
      expect(html).not.toContain(`href="/browse/${c.slug}"`);
    }
    expect(html).not.toContain("No strategies published yet. Check back soon.");
    // T-208-02: the thrown message never reaches the page.
    expect(html).not.toContain("db down");
    expect(html).toContain("Browse Verified Strategies");
    expect(html).toContain("Want full analytics and introductions?");
    expect(html).toContain("Not financial advice.");
  });

  it("a successful read whose slugs match no known category renders the empty state, never a card or the error block (D-14)", async () => {
    populatedMock.mockResolvedValue(["not-a-known-category"]);
    const html = await render();
    expect(redirectMock).not.toHaveBeenCalled();
    expect(html).toContain("No strategies published yet. Check back soon.");
    for (const c of DISCOVERY_CATEGORIES) {
      expect(html).not.toContain(`href="/browse/${c.slug}"`);
    }
    expect(html).not.toContain('role="alert"');
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
