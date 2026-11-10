/**
 * Shared login helper for /discovery E2E specs.
 *
 * audit-2026-05-07 maintainability finding (duplicate-login-helper in
 * the discovery-* specs): extracted from three near-identical copies
 * that had drifted on timeout (15000 in sparkline spec vs 10000 in
 * prefs-isolation spec) and lived inline in
 * discovery-hide-examples-default. Any future change to the login form
 * selectors or post-login redirect target now happens in one place.
 */
import type { Page } from "@playwright/test";

/** Single source of truth for the post-login wait timeout. */
export const LOGIN_REDIRECT_TIMEOUT_MS = 15000;

/**
 * Phase 199 MANAGERHOME (ROUTE-01) - the one post-login predicate.
 *
 * A sign-in no longer lands on Discovery: an allocator lands on /allocations,
 * a manager on /strategies, an admin on /admin, and an unapproved profile on
 * /pending-approval (`src/lib/routing/role-home.ts`). Every spec that waits for
 * "signed in" asks THIS function, so no spec encodes one landing as the only
 * one. Pathname-anchored for the reason `loginAs` documents below: a failed
 * login bounces to `/login?next=/discovery/...`, whose query must not match.
 */
export function isPostLoginPath(pathname: string): boolean {
  return /^\/(discovery|strategies|allocations|admin|dashboard|pending-approval)(\/|$)/.test(
    pathname,
  );
}

/**
 * Log in via the /login form and wait for the post-login redirect.
 *
 * Selectors mirror the StrategyFilters / discovery-prefs-isolation
 * baseline. Redirect matching is pathname-anchored (see below) so a
 * failed-login bounce to `/login?next=/discovery/...` does NOT satisfy
 * the wait.
 *
 * `opts.redirect` signs in through `/login?redirect=<path>` (a deep link).
 * `opts.landing` waits for that EXACT pathname instead of any post-login path,
 * for a spec that asserts where a role lands.
 */
export async function loginAs(
  page: Page,
  email: string,
  password: string,
  opts?: { timeoutMs?: number; redirect?: string; landing?: string },
): Promise<void> {
  const timeout = opts?.timeoutMs ?? LOGIN_REDIRECT_TIMEOUT_MS;
  await page.goto(
    opts?.redirect
      ? `/login?redirect=${encodeURIComponent(opts.redirect)}`
      : "/login",
  );
  await page.fill(
    'input[name="email"], input[placeholder*="email" i]',
    email,
  );
  await page.fill('input[type="password"]', password);
  await page.click('button:has-text("Sign in")');
  // Red-team RT-J05 (MED conf 8): anchor the redirect match to PATHNAME
  // only. The previous unanchored regex `/\/(discovery|strategies|dashboard)/`
  // matched any URL containing those substrings, including the
  // failed-login bounce `/login?next=/discovery/crypto-sma` (the query
  // string contains '/discovery'). On wrong-password / MFA-challenge /
  // account-locked outcomes the wait would silently pass and downstream
  // assertions would hit confusing RLS "no rows" errors instead of a
  // direct auth-failure signal. The predicate form receives a URL object
  // (per Playwright docs) so we can test the pathname directly.
  const landing = opts?.landing;
  await page.waitForURL(
    (url) => (landing ? url.pathname === landing : isPostLoginPath(url.pathname)),
    { timeout },
  );
}
