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
 * The CI check `scripts/check-route-contract.ts` (chained into `npm run lint`,
 * and therefore the `frontend-lint` job in `.github/workflows/ci.yml`, by plan
 * 51-02) walks the on-disk page tree, parses `PUBLIC_ROUTES` out of `proxy.ts`,
 * and cross-checks both against this manifest. It FAILS if:
 *   1. a page route has no class here (unclassified — Rule 1),
 *   2. a `public` route here is absent from `PUBLIC_ROUTES` (the #512 lockstep
 *      — Rule 2),
 *   3. a `redirectFrom` here has no matching `next.config.ts` `redirects()`
 *      source (Rule 3),
 *   4. a non-`exception` entry here maps to no real page file (stale — Rule 4).
 * That is the closure: a route can no longer move, or be added, without an
 * explicit, cross-checked contract declaration.
 *
 * This file is data-only — it imports nothing and runs no logic — so it loads
 * from any context (tests, the CI guard, docs gen) without pulling in
 * `server-only` or the Supabase client. (Mirrors `src/lib/auth/rbac-manifest.ts`.)
 *
 * The FULL inventory: every `page.tsx` route under `src/app/**` (the exact set
 * the guard's `findRouteFiles` + `pageFileToUrl` produces — the guard prints the
 * live count at runtime, so this comment carries no hard number to drift) plus
 * the flow exceptions (`/api/health`, `/auth/callback`) that are `route.ts`
 * handlers, not pages.
 */

/**
 * The class a route is contracted to. Drives the guard's cross-checks:
 *   - `public`    — reachable anonymously; MUST be in `proxy.ts` PUBLIC_ROUTES
 *                   (or be the `/` special-case the proxy gates via `path === "/"`).
 *   - `private`   — session-gated; MUST NOT be in PUBLIC_ROUTES.
 *   - `admin`     — admin-gated (mirrors the `ADMIN_ROUTE_MANIFEST` precedent
 *                   for the API surface); MUST NOT be in PUBLIC_ROUTES.
 *   - `exception` — an explicit carve-out that does not follow the
 *                   public/private rule (e.g. `/api/health`, the unauthenticated
 *                   GET probe that is reachable but deliberately NOT in
 *                   PUBLIC_ROUTES; `/auth/callback`, the OAuth/recovery flow
 *                   handler; the password-recovery pages that are reached WITH a
 *                   recovery session rather than via PUBLIC_ROUTES). The `notes`
 *                   field MUST justify each exception. `exception` entries are
 *                   skipped from the Rule-4 page-file existence check, so a
 *                   `route.ts`-backed (non-page) carve-out is not flagged STALE.
 */
export type RouteClass = "public" | "private" | "admin" | "exception";

export type RouteEntry = {
  /** URL path (NOT file path) — e.g. "/legal/privacy", "/allocations". */
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
 * Route-contract manifest — the full NAV-03 inventory.
 *
 * Keep this list ALPHABETICAL by `route` for deterministic ordering and clear
 * code-review diffs of additions.
 *
 * CI check `scripts/check-route-contract.ts` is the enforcement mechanism.
 * Manual updates to this file are required when adding, removing, or moving a
 * page route.
 *
 * The `public` set is exactly the routes the `proxy.ts` PUBLIC_ROUTES matcher
 * covers (`path === route || path.startsWith(route + "/")`) plus the `/`
 * special-case (`path === "/"`). Dynamic segments are normalised to `:seg`
 * (catch-all `[...seg]` → `:seg`) to match the guard's `pageFileToUrl`.
 */
export const ROUTE_CONTRACT_MANIFEST: readonly RouteEntry[] = [
  // ----- root / landing -----
  {
    route: "/",
    class: "public",
    notes:
      "Landing page. Public via the proxy `path === \"/\"` special-case (the isPublicRoute matcher in proxy.ts), not a PUBLIC_ROUTES array member. Authed users redirect('/discovery/crypto-sma') IN THE PAGE (page.tsx), not the proxy.",
  },

  // ----- admin (auth + admin-gated) -----
  {
    route: "/admin",
    class: "admin",
    notes:
      "Admin dashboard. Admin-gated at the page level (isAdminUser); the API surface under /api/admin is governed by ADMIN_ROUTE_MANIFEST.",
  },
  {
    route: "/admin/compute-jobs",
    class: "admin",
    notes: "Admin secondary surface — reachable via the /admin dashboard.",
  },
  {
    route: "/admin/csv-status",
    class: "admin",
    notes: "Admin secondary surface — reachable via the /admin dashboard.",
  },
  {
    route: "/admin/deletion-requests",
    class: "admin",
    notes: "Admin queue — in the admin nav.",
  },
  {
    route: "/admin/for-quants-leads",
    class: "admin",
    notes: "Admin leads view — in the admin nav.",
  },
  {
    route: "/admin/intros",
    class: "admin",
    notes: "Admin secondary surface — reachable via the /admin dashboard.",
  },
  {
    route: "/admin/match",
    class: "admin",
    notes: "Admin match queue — in the admin nav.",
  },
  {
    route: "/admin/match/:allocator_id",
    class: "admin",
    notes:
      "Admin match detail (full-bleed route, DashboardChrome). Reachable via the match queue list → back-path.",
  },
  {
    route: "/admin/match/eval",
    class: "admin",
    notes: "Admin match-eval surface — reachable via the match queue.",
  },
  {
    route: "/admin/partner-import",
    class: "admin",
    notes: "Admin secondary surface — reachable via the /admin dashboard.",
  },
  {
    route: "/admin/partner-pilot/:partner_tag",
    class: "admin",
    notes: "Admin partner-pilot detail — reachable via the partner surfaces.",
  },
  {
    route: "/admin/partner-roi",
    class: "admin",
    notes: "Admin secondary surface — reachable via the /admin dashboard.",
  },
  {
    route: "/admin/usage",
    class: "admin",
    notes: "Admin secondary surface — reachable via the /admin dashboard.",
  },
  {
    route: "/admin/users",
    class: "admin",
    notes: "Admin users list — in the admin nav.",
  },
  {
    route: "/admin/users/:id",
    class: "admin",
    notes: "Admin user detail — reachable via the users list → back-path.",
  },

  // ----- private dashboard surfaces (session-gated) -----
  {
    route: "/allocations",
    class: "private",
    notes: "Allocator workspace — session-gated, must NOT be in PUBLIC_ROUTES.",
  },
  {
    route: "/compare",
    class: "private",
    notes:
      "Allocator compare surface — session-gated, reached via curated links/breadcrumb.",
  },
  {
    route: "/decks",
    class: "private",
    notes: "Allocator decks surface — session-gated.",
  },
  {
    route: "/discovery/:slug",
    class: "private",
    notes:
      "Discovery surface — session-gated. Bare /discovery has no page (layout + [slug] only); nav targets a concrete slug.",
  },
  {
    route: "/discovery/:slug/:strategyId",
    class: "private",
    notes: "Discovery strategy detail — session-gated.",
  },
  {
    route: "/onboarding",
    class: "private",
    notes:
      "Onboarding gate flow ((auth) group) — session-gated, not a nav surface.",
  },
  {
    route: "/pending-approval",
    class: "private",
    notes:
      "Pending-approval gate flow ((auth) group) — session-gated, not a nav surface.",
  },
  {
    route: "/portfolios",
    class: "private",
    notes: "Manager/admin portfolios list — session-gated.",
  },
  {
    route: "/portfolios/:id",
    class: "private",
    notes: "Portfolio detail — session-gated.",
  },
  {
    route: "/portfolios/:id/documents",
    class: "private",
    notes: "Portfolio documents — session-gated.",
  },
  {
    route: "/portfolios/:id/manage",
    class: "private",
    notes: "Portfolio management — session-gated.",
  },
  {
    route: "/preferences",
    class: "private",
    notes:
      "Redirect-stub (the page redirect()s to /profile?tab=mandate). Session-gated; not a redirectFrom yet (51-05 may convert it).",
  },
  {
    route: "/profile",
    class: "private",
    notes:
      "Account/profile — session-gated. Hosts ?tab=mandate (preferences) + other tabs.",
  },
  {
    route: "/recommendations",
    class: "private",
    notes:
      "Allocator recommendations — session-gated, reachable via the mandate CTA.",
  },
  {
    route: "/referral",
    class: "private",
    notes: "Allocator/manager referral surface — session-gated.",
  },
  {
    route: "/scenarios",
    class: "exception",
    redirectFrom: "/scenarios",
    notes:
      "EXCEPTION: MOVED route (Phase 51 NAV-01). The in-page redirect stub is RETIRED — `/scenarios` is now a config-level 308 redirect to /allocations?tab=scenario in next.config.ts `redirects()` (runs before the filesystem, so there is NO backing page.tsx). `redirectFrom: \"/scenarios\"` makes the guard's Rule 3 require that redirects() source — the #512 lockstep. Classified `exception` (not private) precisely because it has no page file: a redirected-away route lives only in next.config, so the Rule-4 STALE page-existence check must skip it (the same carve-out as a route.ts handler). The destination /allocations stays `private`; no PUBLIC_ROUTES delta — the move does not widen the public surface.",
  },
  {
    route: "/strategies",
    class: "private",
    notes: "Manager/admin strategies list — session-gated.",
  },
  {
    route: "/strategies/:id/edit",
    class: "private",
    notes: "Strategy edit — session-gated (uses Breadcrumb).",
  },
  {
    route: "/strategies/new",
    class: "private",
    notes: "New strategy — session-gated.",
  },
  {
    route: "/strategies/new/wizard",
    class: "private",
    notes: "New-strategy wizard — session-gated.",
  },

  // ----- public marketing / auth-form surfaces (in PUBLIC_ROUTES) -----
  {
    route: "/browse",
    class: "public",
    notes:
      "Public SEO browse mirror — in PUBLIC_ROUTES + bounce-exempt. The un-gated SEO twin of /discovery, kept separate by design.",
  },
  {
    route: "/browse/:slug",
    class: "public",
    notes: "Public browse category — covered by the /browse PUBLIC_ROUTES prefix.",
  },
  {
    route: "/browse/:slug/:strategyId",
    class: "public",
    notes: "Public browse strategy detail — covered by the /browse prefix.",
  },
  {
    route: "/demo",
    class: "public",
    notes:
      "Public demo surface — in PUBLIC_ROUTES + bounce-exempt. Telegram/incognito links in the wild.",
  },
  {
    route: "/demo/founder-view",
    class: "public",
    notes:
      "Founder-side demo twin — covered by the /demo PUBLIC_ROUTES prefix + bounce-exempt.",
  },
  {
    route: "/factsheet/:id",
    class: "public",
    notes:
      "Share-token factsheet — in PUBLIC_ROUTES + bounce-exempt. In-the-wild link — NEVER MOVE.",
  },
  {
    route: "/factsheet/:id/tearsheet",
    class: "public",
    notes: "Factsheet tearsheet — covered by the /factsheet PUBLIC_ROUTES prefix.",
  },
  {
    route: "/factsheet/:id/v2",
    class: "public",
    notes: "Factsheet v2 — covered by the /factsheet PUBLIC_ROUTES prefix.",
  },
  {
    route: "/for-quants",
    class: "public",
    notes: "Public marketing surface — in PUBLIC_ROUTES + bounce-exempt.",
  },
  {
    route: "/legal/disclaimer",
    class: "public",
    notes:
      "Public legal surface — covered by the /legal PUBLIC_ROUTES prefix + bounce-exempt. Footer links in the wild.",
  },
  {
    route: "/legal/privacy",
    class: "public",
    notes:
      "Public legal surface — covered by the /legal PUBLIC_ROUTES prefix + bounce-exempt. Footer links in the wild.",
  },
  {
    route: "/legal/terms",
    class: "public",
    notes:
      "Public legal surface — covered by the /legal PUBLIC_ROUTES prefix + bounce-exempt. Footer links in the wild.",
  },
  {
    route: "/login",
    class: "public",
    notes:
      "Auth form — in PUBLIC_ROUTES. NOT bounce-exempt (authed users correctly bounce to the dashboard).",
  },
  {
    route: "/portfolio-pdf/:id",
    class: "public",
    notes:
      "Share-token PDF deep link — covered by the /portfolio-pdf PUBLIC_ROUTES prefix + bounce-exempt. NEVER MOVE.",
  },
  {
    route: "/scenario-share/:token",
    class: "public",
    notes:
      "The #512 share-recipient route — covered by the /scenario-share PUBLIC_ROUTES prefix + bounce-exempt. In-the-wild link — NEVER MOVE.",
  },
  {
    route: "/security",
    class: "public",
    notes:
      "Public security surface — in PUBLIC_ROUTES + bounce-exempt. security.txt / SOC2 packet point here.",
  },
  {
    route: "/signup",
    class: "public",
    notes:
      "Auth form — in PUBLIC_ROUTES. NOT bounce-exempt (authed users correctly bounce to the dashboard).",
  },
  {
    route: "/strategy/:id",
    class: "public",
    notes:
      "Share-token strategy deep link — covered by the /strategy PUBLIC_ROUTES prefix + bounce-exempt. In-the-wild link — NEVER MOVE.",
  },
  {
    route: "/strategy/:id/v2",
    class: "public",
    notes: "Strategy v2 deep link — covered by the /strategy PUBLIC_ROUTES prefix.",
  },

  // ----- exceptions (do not follow the public/private PUBLIC_ROUTES rule) -----
  {
    route: "/api/health",
    class: "exception",
    notes:
      "EXCEPTION (route.ts handler, no page.tsx — so Rule 4 page-existence is skipped). It IS now in PUBLIC_ROUTES (proxy.ts): 51-REVIEW corrected the prior FALSE note ('returns before the session gate matters') — the proxy session gate runs BEFORE the route handler, so an anon liveness/ops probe was 307→login until /api/health was added to PUBLIC_ROUTES. The anon-reachable behavior is pinned by proxy.test (api routes are governed by PUBLIC_ROUTES + proxy.test, not the page-walk guard).",
  },
  {
    route: "/auth/callback",
    class: "exception",
    notes:
      "EXCEPTION: Supabase OAuth / recovery callback (route.ts, not a page). Exchanges the auth code / token_hash and mints a session, then redirects. Not in PUBLIC_ROUTES by design. Skipped from the Rule-4 page-existence check. 51-RESEARCH L140.",
  },
  {
    route: "/forgot-password",
    class: "public",
    notes:
      "PUBLIC: password-recovery entry page ((auth) group). Anon users reach it via the 'Forgot password?' link on the login page (LoginForm), so it MUST be in PUBLIC_ROUTES — a 51-REVIEW fix for the #512 dead loop where it previously 307→login'd a logged-out user (password reset was unreachable). Rule 2 now enforces the lockstep; an authed user there bounces to the dashboard (NOT bounce-exempt, matching /login + /signup).",
  },
  {
    route: "/reset-password",
    class: "public",
    notes:
      "PUBLIC: password-set page ((auth) group). Normally reached WITH a recovery session (/auth/callback mints it from the email token), but listed in PUBLIC_ROUTES so a bare anon hit renders the 'request a new link' affordance instead of 307→login. It IS in proxy isAuthBounceExempt so the authed-recovery user STAYS to set the new password rather than bouncing to the dashboard (51-REVIEW).",
  },
];
