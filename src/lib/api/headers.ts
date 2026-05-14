/**
 * Shared response headers for authenticated API routes.
 *
 * audit-2026-05-07 round-2 Block D / P1947 — every authenticated route's
 * error AND success responses must carry `Cache-Control: private, no-store`.
 * Allocator-scoped payloads (match decisions, profiles, scenario commits)
 * served from any shared cache would leak cross-tenant.
 *
 * Co-located with `withAuth` / `withAllocatorAuth` so any route helper that
 * needs it imports from a single source. Adding `Vary` / `Pragma: no-cache`
 * (if a future audit requires it) lands in one place.
 */
export const NO_STORE_HEADERS = {
  "Cache-Control": "private, no-store",
} as const;
