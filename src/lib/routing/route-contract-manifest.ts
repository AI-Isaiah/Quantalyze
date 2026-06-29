/**
 * Route-contract manifest — single source of truth for the CLASS of every
 * page route under `src/app/**` (and the API/flow exception carve-outs),
 * plus the old→new path each route was moved FROM.
 *
 * Phase 51 NAV-03: the codebase has a flat, hand-maintained `PUBLIC_ROUTES`
 * array in `src/proxy.ts` (the proxy auth gate) and a growing page tree, with
 * NO machine-checkable link between the two. A route that moves to a new path
 * without being added to `PUBLIC_ROUTES` produces the #512 regression — an
 * anonymous recipient following the (redirected) link hits the proxy session
 * gate and gets a silent 307→login instead of the page. This manifest is the
 * audit trail: every page route MUST appear here with an explicit class, and a
 * route classified `public` MUST also live in `PUBLIC_ROUTES` (the lockstep).
 *
 * The CI check `scripts/check-route-contract.ts` (to be chained into
 * `npm run lint`, and therefore the `frontend-lint` job in
 * `.github/workflows/ci.yml`, by plan 51-02) walks the on-disk page tree,
 * parses `PUBLIC_ROUTES` out of `proxy.ts`, and cross-checks both against this
 * manifest. It FAILS if:
 *   1. a page route has no class here (unclassified — Rule 1),
 *   2. a `public` route here is absent from `PUBLIC_ROUTES` (the #512 lockstep
 *      — Rule 2),
 *   3. a `redirectFrom` here has no matching `next.config.ts` `redirects()`
 *      source (Rule 3),
 *   4. an entry here maps to no real page file (stale — Rule 4).
 * That is the closure: a route can no longer move, or be added, without an
 * explicit, cross-checked contract declaration.
 *
 * This file is data-only — it imports nothing and runs no logic — so it loads
 * from any context (tests, the CI guard, docs gen) without pulling in
 * `server-only` or the Supabase client. (Mirrors `src/lib/auth/rbac-manifest.ts`.)
 *
 * Plan 51-01 seeds this module with the type definitions and a handful of
 * REPRESENTATIVE entries (one per class) so the guard skeleton and its RED
 * unit test resolve their imports. The FULL ~57-page-route population is plan
 * 51-02's job; until then this is a partial, intentionally-incomplete seed.
 */

/**
 * The class a route is contracted to. Drives the guard's cross-checks:
 *   - `public`    — reachable anonymously; MUST be in `proxy.ts` PUBLIC_ROUTES.
 *   - `private`   — session-gated; MUST NOT be in PUBLIC_ROUTES.
 *   - `admin`     — admin-gated (mirrors the `ADMIN_ROUTE_MANIFEST` precedent
 *                   for the API surface); MUST NOT be in PUBLIC_ROUTES.
 *   - `exception` — an explicit carve-out that does not follow the
 *                   public/private rule (e.g. `/api/health`, the unauthenticated
 *                   GET probe that is reachable but deliberately NOT in
 *                   PUBLIC_ROUTES; `/auth/callback`, the OAuth flow handler).
 *                   The `notes` field MUST justify each exception.
 */
export type RouteClass = "public" | "private" | "admin" | "exception";

export type RouteEntry = {
  /** URL path (NOT file path) — e.g. "/legal", "/allocations". */
  route: string;
  /** The contracted class of this route. */
  class: RouteClass;
  /**
   * Old path this route was moved FROM, if it was moved. Drives Rule 3: a
   * present `redirectFrom` MUST have a matching `next.config.ts` `redirects()`
   * source so the old link still resolves (308) instead of 404-ing.
   */
  redirectFrom?: string;
  /**
   * Free-text note: why this class, or — for an `exception` — why it is a
   * carve-out. Empty string is allowed for an unambiguous public/private page.
   */
  notes: string;
};

/**
 * Route-contract manifest.
 *
 * Keep this list ALPHABETICAL by `route` for deterministic ordering and clear
 * code-review diffs of additions.
 *
 * CI check `scripts/check-route-contract.ts` is the enforcement mechanism.
 * Manual updates to this file are required when adding, removing, or moving a
 * page route.
 *
 * SEED ONLY (plan 51-01): one representative entry per `RouteClass`. The full
 * ~57-route inventory (51-RESEARCH §Route inventory) is populated in plan
 * 51-02, which also wires the guard into `npm run lint`.
 */
export const ROUTE_CONTRACT_MANIFEST: readonly RouteEntry[] = [
  {
    route: "/admin",
    class: "admin",
    notes:
      "Admin dashboard. Admin-gated at the page level (isAdminUser); the API surface under /api/admin is governed by ADMIN_ROUTE_MANIFEST.",
  },
  {
    route: "/allocations",
    class: "private",
    notes: "Allocator workspace — session-gated, must NOT be in PUBLIC_ROUTES.",
  },
  {
    route: "/api/health",
    class: "exception",
    notes:
      "EXCEPTION: unauthenticated GET health probe. Reachable anonymously but deliberately NOT in PUBLIC_ROUTES (returns before the session gate matters). 51-RESEARCH L139.",
  },
  {
    route: "/legal",
    class: "public",
    notes:
      "Public legal/marketing surface — reachable anonymously, present in PUBLIC_ROUTES.",
  },
];
