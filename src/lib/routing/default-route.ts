/**
 * The two fixed destinations a signed-in user is sent to, kept as two names
 * because they mean two things (Phase 199 MANAGERHOME, R-01).
 *
 * `ROLE_HOME_ROUTE` is "home": the post-sign-in landing, the proxy's signed-in
 * bounce, the marketing page's signed-in redirect and the marketing header's
 * "Go to app". `/home` is the one server route that reads the profile and
 * redirects by role (allocator, manager, admin), so every site that cannot read
 * a profile reads this one literal.
 *
 * `DISCOVERY_LANDING_ROUTE` is the Discovery landing that Discovery-labelled
 * links reach ("Go to Discovery", "Back to Discovery"). It must never follow
 * the role home: a link labelled Discovery that lands on a role page lies.
 *
 * This file is data-only - it imports nothing and runs no logic - so the
 * proxy, the landing page and the marketing header share the literals
 * without importing `src/proxy.ts`. (Mirrors `route-contract-manifest.ts`.)
 */
export const ROLE_HOME_ROUTE = "/home";
export const DISCOVERY_LANDING_ROUTE = "/discovery/crypto-sma";
