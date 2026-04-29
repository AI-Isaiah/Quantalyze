import type { Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

/**
 * Phase 14b-07 / A11Y-02 — shared AxeBuilder factory.
 *
 * Configures the WCAG 2.0 A + AA + best-practice rule set per UI-SPEC §6.3
 * (zero-violations threshold). Used by both:
 *   - e2e/strategy-v2-axe.spec.ts  (full /strategy/{id}/v2 route)
 *   - e2e/discovery-axe.spec.ts    (full /discovery/{slug} route)
 *
 * Sharing the factory keeps the rule-set in lock-step across the two
 * specs — bumping a tag (e.g. adding wcag22aa later) is a one-line change.
 */
export function buildAxe(page: Page) {
  return new AxeBuilder({ page }).withTags([
    "wcag2a",
    "wcag2aa",
    "best-practice",
  ]);
}
