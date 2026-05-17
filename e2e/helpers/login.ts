/**
 * Shared login helper for /discovery E2E specs.
 *
 * audit-2026-05-07 maintainability finding
 * (e2e/discovery-sparkline-regression.spec.ts:64:maintainability):
 * extracted from three near-identical copies that had drifted on
 * timeout (15000 in sparkline spec vs 10000 in prefs-isolation spec)
 * and lived inline in discovery-hide-examples-default. Any future
 * change to the login form selectors or post-login redirect target
 * now happens in one place.
 */
import type { Page } from "@playwright/test";

/** Single source of truth for the post-login wait timeout. */
export const LOGIN_REDIRECT_TIMEOUT_MS = 15000;

/**
 * Log in via the /login form and wait for the post-login redirect.
 *
 * Selectors mirror the StrategyFilters / discovery-prefs-isolation
 * baseline. Redirect matching is pathname-anchored (see below) so a
 * failed-login bounce to `/login?next=/discovery/...` does NOT satisfy
 * the wait.
 */
export async function loginAs(
  page: Page,
  email: string,
  password: string,
  opts?: { timeoutMs?: number },
): Promise<void> {
  const timeout = opts?.timeoutMs ?? LOGIN_REDIRECT_TIMEOUT_MS;
  await page.goto("/login");
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
  await page.waitForURL(
    (url) => /^\/(discovery|strategies|dashboard)(\/|$)/.test(url.pathname),
    { timeout },
  );
}
