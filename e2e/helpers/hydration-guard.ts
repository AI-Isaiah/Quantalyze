export * from "@playwright/test";
import { test as base, expect } from "@playwright/test";

/**
 * Phase 169.1.1 SC-4 — React hydration-mismatch guard for the seeded e2e lane.
 *
 * Consumers: every spec in the `Run seed-gated specs (MA-8 / BLOCK-3)` list of
 * `.github/workflows/ci.yml` imports `test` from this module instead of from
 * the Playwright package. `src/__tests__/e2e-seeded-hydration-guard.test.ts`
 * reads that list and fails when a listed spec does not, so a spec added to the
 * seeded list without the guard turns vitest red. Proof that the guard bites:
 * `e2e/hydration-guard.self-test.spec.ts`, which runs in CI's unseeded list.
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
      expect(
        hits,
        "React hydration mismatch (#418) on a seeded page: the server-rendered text differs from the browser's first render. Fix the render, do not retry the test.",
      ).toEqual([]);
    },
    { auto: true },
  ],
});

export { expect };
