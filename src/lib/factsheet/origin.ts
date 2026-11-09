/**
 * Factsheet back-link origin contract (Phase 196, D-01 / ROUTE-04).
 *
 * A link INTO the factsheet carries where it came from as `?from=<key>` (plus
 * `&cat=<slug>` for the two category surfaces). The back link's label and href
 * are LOOKED UP from the closed map below; the raw query value is never used
 * as an href, so a crafted link cannot steer the back control off-site (open
 * redirect, T-196-06). An unknown / repeated / hostile value is "no origin".
 *
 * No React and no server-only import: plans 06 and 07 call `buildFactsheetHref`
 * from client components, and the page calls `parseOrigin` on the server.
 */
import { DISCOVERY_CATEGORIES } from "@/lib/constants";
import { DEFAULT_AUTHENTICATED_ROUTE } from "@/lib/routing/default-route";

/**
 * The one source of back-link labels and fixed hrefs. Labels mirror the
 * sidebar names (`Sidebar.tsx`), so a Phase 201 rename changes one place.
 * `href: null` marks the two category-derived origins.
 */
export const FACTSHEET_ORIGINS = {
  discovery: { label: "Back to Discovery", href: null },
  browse: { label: "Back to Browse", href: null },
  allocations: { label: "Back to My allocation", href: "/allocations" },
  "my-strategies": { label: "Back to My Strategies", href: "/my-strategies" },
  strategies: { label: "Back to Strategies", href: "/strategies" },
  recommendations: { label: "Back to Recommendations", href: "/recommendations" },
  admin: { label: "Back to Admin", href: "/admin" },
} as const;

export type FactsheetOriginKey = keyof typeof FACTSHEET_ORIGINS;
export type FactsheetCategorySlug = (typeof DISCOVERY_CATEGORIES)[number]["slug"];

export type FactsheetOrigin = {
  key: FactsheetOriginKey;
  cat?: FactsheetCategorySlug;
};

export type BackTarget = { label: string; href: string };

/** Origins whose href is derived from a category slug. */
function isCategoryOrigin(key: FactsheetOriginKey): boolean {
  return key === "discovery" || key === "browse";
}

/**
 * Exact own-property membership. `in` and a bare truthiness lookup both accept
 * `__proto__`, `constructor` and `toString` through the prototype chain.
 */
function isOriginKey(value: string): value is FactsheetOriginKey {
  return Object.prototype.hasOwnProperty.call(FACTSHEET_ORIGINS, value);
}

function asCategorySlug(value: string): FactsheetCategorySlug | null {
  const hit = DISCOVERY_CATEGORIES.find((c) => c.slug === value);
  return hit ? hit.slug : null;
}

type SearchParamsRecord = Record<string, string | string[] | undefined>;

/** One value for `key`, or undefined when absent OR repeated (repeated = hostile). */
function readSingle(
  params: SearchParamsRecord | URLSearchParams,
  key: string,
): string | undefined {
  if (params instanceof URLSearchParams) {
    const all = params.getAll(key);
    return all.length === 1 ? all[0] : undefined;
  }
  // Own-property read: a record carrying a `from` inherited from the prototype
  // is not a viewer-supplied value.
  if (!Object.prototype.hasOwnProperty.call(params, key)) return undefined;
  const v = params[key];
  return typeof v === "string" ? v : undefined;
}

/**
 * Parse the Next page `searchParams` record (or a `URLSearchParams`) into an
 * origin, or null. `cat` is read only for discovery and browse and kept only
 * when it equals a `DISCOVERY_CATEGORIES` slug.
 */
export function parseOrigin(
  searchParams: SearchParamsRecord | URLSearchParams,
): FactsheetOrigin | null {
  const from = readSingle(searchParams, "from");
  if (from === undefined || !isOriginKey(from)) return null;
  if (!isCategoryOrigin(from)) return { key: from };
  const rawCat = readSingle(searchParams, "cat");
  const cat = rawCat === undefined ? null : asCategorySlug(rawCat);
  return cat ? { key: from, cat } : { key: from };
}

/** Label + same-origin href for an origin; null when there is no origin. */
export function backTargetFor(origin: FactsheetOrigin | null): BackTarget | null {
  if (!origin) return null;
  const { label, href } = FACTSHEET_ORIGINS[origin.key];
  if (href !== null) return { label, href };
  // Category-derived origins (discovery, browse): the slug was validated by
  // parseOrigin / buildFactsheetHref; without one, the surface's own root.
  if (origin.cat) return { label, href: `/${origin.key}/${origin.cat}` };
  return {
    label,
    href: origin.key === "discovery" ? DEFAULT_AUTHENTICATED_ROUTE : "/browse",
  };
}

/**
 * The one builder in-app links use to reach a factsheet, so every link site and
 * the redirects emit the same `from` / `cat` shape `parseOrigin` reads. The
 * origin is re-validated here: a `cat` on a non-category origin is dropped, and
 * an unknown key or slug (a cast past the types) adds nothing.
 */
export function buildFactsheetHref(
  strategyId: string,
  origin?: FactsheetOrigin | null,
): string {
  const base = `/factsheet/${encodeURIComponent(strategyId)}`;
  if (!origin || !isOriginKey(origin.key)) return base;
  const params = new URLSearchParams({ from: origin.key });
  if (isCategoryOrigin(origin.key) && origin.cat !== undefined) {
    const cat = asCategorySlug(origin.cat);
    if (cat) params.set("cat", cat);
  }
  return `${base}?${params.toString()}`;
}

/**
 * The print view of a published factsheet (Phase 196, D-09): the ControlBar's
 * "Print view" link. No origin: the print view is a leaf, and its own "Back to
 * factsheet" control returns to the bare factsheet path.
 */
export function buildTearsheetHref(strategyId: string): string {
  return `${buildFactsheetHref(strategyId)}/tearsheet`;
}
