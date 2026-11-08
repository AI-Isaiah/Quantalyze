/**
 * The one place the /compare URL is built and the one place its cap lives.
 *
 * Call sites: the /compare page (id parser and state rules), its "Add strategy"
 * search and per-column Remove links, and the discovery selection bar (197 plan 05).
 *
 * Next's `router.push` must never receive an untrusted URL (a `javascript:` URL
 * would run in the page). The path is fixed to `/compare` here and every id goes
 * through `encodeURIComponent`, so a caller that passes ids and nothing else
 * cannot produce any other target.
 */
export const COMPARE_MAX_ITEMS = 4;

/**
 * `/compare` for no ids, else `/compare?ids=` plus the ids, comma-joined.
 * It does not slice: callers enforce COMPARE_MAX_ITEMS, so a test can see an
 * over-long list instead of having it hidden here.
 */
export function compareHref(ids: readonly string[]): string {
  if (ids.length === 0) return "/compare";
  return `/compare?ids=${ids.map(encodeURIComponent).join(",")}`;
}
