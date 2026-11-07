import { DISCOVERY_CATEGORIES } from "@/lib/constants";
import { getPopulatedCategorySlugs } from "@/lib/queries";

/**
 * The one rule behind `/browse` (Phase 195 D-08): which categories the menu
 * shows, and whether it is a one-card menu that redirects instead.
 *
 * `/browse` redirects on `onlySlug`, and the breadcrumb on its child pages
 * drops the "Browse" link on the same value, so the crumb never points at a
 * page that bounces straight back.
 *
 * `onlySlug` is gated on a NON-EMPTY read: getPopulatedCategorySlugs() returns
 * [] for both an empty result and a DB error, and that path shows the fallback
 * cards. A redirect is a claim made from data, and a failed read has none.
 * The slug comes from the fixed DISCOVERY_CATEGORIES list (no open redirect).
 */
export async function getBrowseCategories() {
  let populatedSlugs: string[] = [];
  try {
    populatedSlugs = await getPopulatedCategorySlugs();
  } catch {
    // Show all categories if query fails
  }

  const categories =
    populatedSlugs.length > 0
      ? DISCOVERY_CATEGORIES.filter((c) => populatedSlugs.includes(c.slug))
      : DISCOVERY_CATEGORIES;

  const onlySlug =
    populatedSlugs.length > 0 && categories.length === 1 ? categories[0].slug : null;

  return { categories, onlySlug };
}
