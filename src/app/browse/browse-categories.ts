import { DISCOVERY_CATEGORIES } from "@/lib/constants";
import { getPopulatedCategorySlugs } from "@/lib/queries";

/** What the category read told us (Phase 208 D-03). */
export type BrowseReadState = "ok" | "empty" | "error";

/**
 * The one rule behind `/browse` (Phase 195 D-08, Phase 208 D-03/D-04): which
 * categories the menu shows, whether it is a one-card menu that redirects
 * instead, and which of three read states the page is in.
 *
 *   "ok"    - the read succeeded and at least one known category is populated:
 *             `categories` holds exactly those.
 *   "empty" - the read succeeded and nothing known is populated (D-14: a slug
 *             matching no DISCOVERY_CATEGORIES entry never invents a card).
 *   "error" - the read threw. `categories` is [] and the page shows the error
 *             block; the fallback to every category is gone, because a card is
 *             a claim made from data and a failed read has none.
 *
 * `/browse` redirects on `onlySlug`, and the breadcrumb on its child pages
 * drops the "Browse" link on the same value, so the crumb never points at a
 * page that bounces straight back. `onlySlug` is non-null ONLY on "ok" with
 * exactly one matched category, so a failed or empty read never redirects and
 * never drops the crumb. The slug comes from the fixed DISCOVERY_CATEGORIES
 * list (no open redirect).
 */
export async function getBrowseCategories() {
  let state: BrowseReadState;
  let populatedSlugs: string[] = [];
  try {
    populatedSlugs = await getPopulatedCategorySlugs();
    state = populatedSlugs.length > 0 ? "ok" : "empty";
  } catch {
    // The helper already logged and captured to Sentry at the source: capture nothing a second time.
    state = "error";
  }

  const categories =
    state === "ok"
      ? DISCOVERY_CATEGORIES.filter((c) => populatedSlugs.includes(c.slug))
      : [];

  // D-14: a successful read whose slugs match no known category is empty, not
  // an error, and never an invented card.
  if (state === "ok" && categories.length === 0) state = "empty";

  const onlySlug = state === "ok" && categories.length === 1 ? categories[0].slug : null;

  return { state, categories, onlySlug };
}
