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
 * baseline. Redirect regex matches the three known post-login landing
 * routes (`/discovery`, `/strategies`, `/dashboard`).
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
  await page.waitForURL(/\/(discovery|strategies|dashboard)/, {
    timeout,
  });
}
