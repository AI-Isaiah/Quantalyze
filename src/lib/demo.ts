/**
 * Hard-coded demo allocator + portfolio UUIDs. Match the canonical
 * `scripts/seed-demo-data.ts` constants. Referenced by the public /demo,
 * /demo/founder-view, /api/demo/match/[allocator_id], and
 * /api/demo/portfolio-pdf/[id] routes.
 *
 * IMPORTANT: any drift between this file and the seed script breaks the
 * public /demo lane. The seed script keeps its own copy (canonical source
 * of truth); update both together when changing personas.
 */
export const ALLOCATOR_ACTIVE_ID = "aaaaaaaa-0001-4000-8000-000000000002";
export const ALLOCATOR_COLD_ID = "aaaaaaaa-0001-4000-8000-000000000001";
export const ALLOCATOR_STALLED_ID = "aaaaaaaa-0001-4000-8000-000000000003";

export const ACTIVE_PORTFOLIO_ID = "dddddddd-0001-4000-8000-000000000001";
export const COLD_PORTFOLIO_ID = "dddddddd-0001-4000-8000-000000000002";
export const STALLED_PORTFOLIO_ID = "dddddddd-0001-4000-8000-000000000003";

/**
 * Allowlist of demo portfolio IDs accessible via the public PDF endpoint.
 * Any ID not in this set returns 404 from /api/demo/portfolio-pdf to
 * prevent enumerating real allocator portfolios.
 */
export const DEMO_PORTFOLIO_ALLOWLIST: ReadonlySet<string> = new Set([
  ACTIVE_PORTFOLIO_ID,
  COLD_PORTFOLIO_ID,
  STALLED_PORTFOLIO_ID,
]);

export function isDemoPortfolioId(id: string): boolean {
  return DEMO_PORTFOLIO_ALLOWLIST.has(id);
}
