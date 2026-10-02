export * from "@playwright/test";
import { test as base, expect } from "@playwright/test";
import type { BrowserContext } from "@playwright/test";

/**
 * Phase 169.1.1 SC-4 — React hydration-mismatch guard for the seeded e2e lane.
 *
 * Consumers: every spec in the `Run seed-gated specs (MA-8 / BLOCK-3)` list of
 * `.github/workflows/ci.yml` imports `test` from this module instead of from
 * the Playwright package. `src/__tests__/e2e-seeded-hydration-guard.test.ts`
 * reads that list and fails when a listed spec does not, so a spec added to the
 * seeded list without the guard turns vitest red. Proof that the guard bites:
 * `e2e/hydration-guard.self-test.spec.ts`, which runs as its own blocking step
 * of CI's `e2e-seeded` job (a red self-test fails the `frontend` check on a
 * push or a same-repo PR; that job skips on fork and docs-only PRs).
 *
 * How a mismatch reaches this fixture: React's onRecoverableError hands the
 * hydration error to Next's reportGlobalError, which calls `reportError`, and
 * Playwright surfaces that as a context `weberror` event. In production React
 * only TEXT mismatches throw #418; attribute differences are kept from the
 * server silently and are not seen here.
 *
 * Why the assertion runs in fixture TEARDOWN, after the test body: the test's
 * own assertions run first, and a #418 that a race swallowed (the page carried
 * on, the test passed) still turns the test red. Before this guard, a #418
 * surfaced only as a downstream detached-element flake.
 *
 * Why teardown first DRAINS the open pages (`settleOpenPages`): React reports a
 * mismatch only after it hydrates the affected subtree, which is after the
 * page's scripts load. A spec that ends on a server-text assertion can finish
 * before that, so the assertion would run before the error exists. The drain
 * waits for each open page's load event and one idle callback. The load wait is
 * bounded by `SETTLE_LOAD_TIMEOUT_MS`. The idle wait is bounded in-page by
 * `SETTLE_IDLE_TIMEOUT_MS` only while the page's event loop runs; a page whose
 * main thread is wedged is bounded by the fixture timeout instead, and then
 * fails as a generic timeout, not as the named "could not let … settle" error.
 *
 * Retries: `playwright.config.ts` retries twice in CI. A #418 is deterministic
 * for a given pair of render engines, so it reproduces on every retry; retries
 * do not turn a real mismatch into a flaky pass.
 *
 * The patterns are deliberately narrower than
 * `e2e/wizard-hydration-probe.spec.ts`'s list, which also watches dev-mode
 * console warnings for a different purpose. Here: the production code (#418)
 * and the dev-mode thrown message.
 */
export const HYDRATION_ERROR_PATTERNS: readonly RegExp[] = [
  /Minified React error #418\b/,
  /Hydration failed because the server rendered/,
];

/** How long one page may take to reach its load event during the drain. */
const SETTLE_LOAD_TIMEOUT_MS = 10_000;
/** Upper bound the in-page idle wait passes to requestIdleCallback. */
const SETTLE_IDLE_TIMEOUT_MS = 2_000;
/** Settle attempts per page when a navigation replaces its document mid-drain. */
const SETTLE_ATTEMPTS = 3;

/**
 * Let every open page of `context` finish loading and go idle, so a hydration
 * error React reports after the test body has ended still reaches the
 * listener before teardown asserts.
 *
 * Only a page that is closed by the time an error is caught is skipped: the
 * test or the app closed it, so it has nothing left to report. A navigation
 * that destroys the page's document mid-drain is retried a bounded number of
 * times, because the new document may hydrate too. Every other error,
 * including a load timeout, is rethrown with the page URL, so a drain that
 * could not run never passes as a clean guard.
 */
export async function settleOpenPages(context: BrowserContext): Promise<void> {
  for (const page of context.pages()) {
    for (let attempt = 1; ; attempt++) {
      if (page.isClosed()) break;
      try {
        await page.waitForLoadState("load", { timeout: SETTLE_LOAD_TIMEOUT_MS });
        await page.evaluate(
          (timeout) =>
            new Promise<void>((resolve) => requestIdleCallback(() => resolve(), { timeout })),
          SETTLE_IDLE_TIMEOUT_MS,
        );
        break;
      } catch (err) {
        if (page.isClosed()) break;
        const message = err instanceof Error ? err.message : String(err);
        if (attempt < SETTLE_ATTEMPTS && /Execution context was destroyed/.test(message)) continue;
        throw new Error(
          `hydration guard: could not let ${page.url()} settle before checking for #418 ` +
            `(attempt ${attempt} of ${SETTLE_ATTEMPTS}): ${message}`,
          { cause: err },
        );
      }
    }
  }
}

export const test = base.extend<{ hydrationHits: string[]; hydrationGuard: void }>({
  /**
   * The hydration-mismatch messages recorded for this test. Exposed so the
   * self-test can assert on them directly; a spec that empties it after an
   * expected hit lets teardown pass.
   */
  hydrationHits: async ({}, provide) => {
    await provide([]);
  },
  hydrationGuard: [
    async ({ context, hydrationHits: hits }, use) => {
      context.on("weberror", (webError) => {
        const err = webError.error();
        const message = String(err?.message ?? err);
        if (HYDRATION_ERROR_PATTERNS.some((re) => re.test(message))) {
          hits.push(`${webError.page()?.url() ?? "(no page)"}: ${message.slice(0, 300)}`);
        }
      });
      await use();
      await settleOpenPages(context);
      expect(
        hits,
        "React hydration mismatch (#418) on a seeded page: the server-rendered text differs from the browser's first render. Fix the render, do not retry the test.",
      ).toEqual([]);
    },
    { auto: true },
  ],
});

export { expect };
