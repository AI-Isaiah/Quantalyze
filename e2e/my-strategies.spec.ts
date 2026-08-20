/**
 * Phase 158 / OPS-03 (authoring half) — the NAV-01 surface finally gets an
 * e2e spec: /my-strategies (Phase 149) had none at HEAD (`grep -rn
 * my-strategies e2e/` → nothing before this file).
 *
 * ── What this spec pins ────────────────────────────────────────────────────
 * 1. A seeded owner sees their OWN prefixed strategy listed at /my-strategies
 *    (reached via the sidebar link — the NAV-01 navigation surface itself).
 * 2. A second seeded user's prefixed strategy is ABSENT from that page — the
 *    RLS/ownership boundary (`getMyStrategies` is owner-scoped; T-150-39
 *    family). Both names are THIS spec's own mints, so the negative assertion
 *    is still own-seed-scoped, never a global-DB claim.
 * 3. The owner's row links toward the strategy's factsheet surface (the
 *    StrategyTable name cell links `/factsheet/<id>`).
 *
 * ── Selector discipline (DEF-149-B) ────────────────────────────────────────
 * /strategies and /my-strategies BOTH render an h1 reading "My Strategies",
 * so nothing here selects by heading text. Navigation is scoped by href
 * (`a[href="/my-strategies"]`, the Sidebar precedent) and row assertions by
 * link role + accessible name + href attribute.
 *
 * ── Shared test DB (PR #654 lesson) ────────────────────────────────────────
 * The TEST project is polluted by construction. Every assertion below is
 * about rows THIS spec seeded — no counts, no empty-state, no global state.
 *
 * ── Seed-gate (MA-8 two-place rule) ────────────────────────────────────────
 * Place 1: the HAS_SEED_ENV self-skip below. Place 2: plan 158-06 wires this
 * file into the `e2e-seeded` batch list in .github/workflows/ci.yml — until
 * that entry exists the spec runs nowhere in CI, which is false coverage.
 */
import { test, expect, type Page } from "@playwright/test";
import {
  seedTestAllocator,
  seedWizardDraft,
  cleanupStrategiesByNamePrefix,
} from "./helpers/seed-test-project";

const HAS_SEED_ENV =
  !!process.env.TEST_SUPABASE_URL &&
  !!process.env.TEST_SUPABASE_SERVICE_ROLE_KEY;

/**
 * The GC niche this spec owns on the shared test DB. Owner and non-owner
 * mints use distinct sub-prefixes (so the two names can never collide in a
 * text match) under ONE cleanup root.
 */
/**
 * 158-REVIEW WR-11: scoped PER WORKER, not a fixed literal. Under
 * `fullyParallel` the `afterAll` below deletes strategies by prefix, so a
 * shared literal lets one worker's teardown delete rows another worker is
 * still asserting on. Only this file's single test creates rows under the
 * prefix today, so the race is latent rather than live — which is exactly when
 * it is cheap to close. `TEST_PARALLEL_INDEX` is set by Playwright per worker
 * process and is read at import time, before any test runs.
 */
const NAME_PREFIX = `e2e-mystrat-${process.env.TEST_PARALLEL_INDEX ?? 0}-`;
const OWN_PREFIX = `${NAME_PREFIX}own-`;
const OTHER_PREFIX = `${NAME_PREFIX}other-`;

/**
 * Inline login — copied from wizard-resume.spec.ts:52-60 / composer-axe.
 * No shared login helper exists; per the PATTERNS shared pattern the
 * duplication is intentional.
 */
async function loginViaForm(page: Page, email: string, password: string) {
  await page.goto("/login");
  await page.fill('input[name="email"], input[placeholder*="email" i]', email);
  await page.fill('input[type="password"]', password);
  await page.click('button:has-text("Sign in")');
  await page.waitForURL(/\/(discovery|strategies|allocations|dashboard)/, {
    timeout: 10_000,
  });
}

test.describe("Phase 149 — /my-strategies (NAV-01)", () => {
  test.skip(
    !HAS_SEED_ENV,
    "my-strategies: seed-helper env vars not wired " +
      "(set TEST_SUPABASE_URL / TEST_SUPABASE_SERVICE_ROLE_KEY).",
  );

  /**
   * ⚠️ 158-REVIEW WR-11 — RECORDED DECISION, not an oversight. This cleans the
   * strategies it minted but NOT the two `auth.users` rows `seedTestAllocator`
   * creates, so each CI run leaves 2 permanent users on the shared TEST
   * project — in the same phase whose OPS-04 half exists because TEST
   * artifacts accumulate without bound.
   *
   * Left as-is deliberately, for two reasons. (1) It is the ESTABLISHED
   * convention, not drift this spec invented: `composer-axe`,
   * `composite-onboarding` and `axe-app-wide` all seed users the same way and
   * none deletes them, and no `seed-test-project.ts` helper exports user
   * teardown at all (verified: the file calls `auth.admin.createUser` in four
   * places and `deleteUser` in none). Deleting users from THIS spec alone
   * would fork the convention in one file rather than fix the class.
   * (2) Doing it properly means adding user teardown to the shared helper and
   * auditing the FK cascade for every caller — its own reviewed change.
   *
   * Tracked in TODOS.md alongside the OPS-04 drain entries so the accumulation
   * is counted rather than silent. Do not "fix" this here in isolation.
   */
  test.afterAll(async () => {
    if (HAS_SEED_ENV) {
      await cleanupStrategiesByNamePrefix(NAME_PREFIX);
    }
  });

  test("owner sees their own row, not another user's, linking to its factsheet", async ({
    page,
  }) => {
    test.skip(!HAS_SEED_ENV, "requires seed env");

    // Owner FIRST: the page's reads are RLS-bound to the logged-in user.
    // role "both" lights the allocator workspace (Sidebar renders the
    // /my-strategies entry for isAllocator, and 'both' derives it — Phase
    // 109 role OR-logic) AND clears the universal approval gate via the
    // seed helper's verified stamps.
    const ownerA = await seedTestAllocator({ role: "both" });
    const ownB = await seedTestAllocator({ role: "both" });

    // One strategy each, both minted HERE. seedWizardDraft is the lightest
    // owner-specifiable strategy mint (status 'draft', which /my-strategies
    // deliberately renders — Phase 149: every own row at every non-archived
    // status). Distinct sub-prefixes keep the two names disjoint.
    const draftA = await seedWizardDraft({
      ownerUserId: ownerA.userId,
      namePrefix: OWN_PREFIX,
    });
    const draftB = await seedWizardDraft({
      ownerUserId: ownB.userId,
      namePrefix: OTHER_PREFIX,
    });

    await loginViaForm(page, ownerA.email, ownerA.password);

    // ── Case 1: navigate via the sidebar link (the NAV-01 surface), scoped
    // by href — NEVER by the "My Strategies" heading text (DEF-149-B:
    // /strategies renders the same h1).
    const navLink = page.locator('a[href="/my-strategies"]');
    await expect(navLink).toBeVisible({ timeout: 15_000 });
    await navLink.click();
    await page.waitForURL(/\/my-strategies/, { timeout: 15_000 });

    // …and the owner's OWN seeded row renders. The name cell is a link, so
    // assert it by role + accessible name (exact: the mint is unique).
    const ownRowLink = page.getByRole("link", { name: draftA.name });
    await expect(ownRowLink).toBeVisible({ timeout: 15_000 });

    // ── Case 2: the OTHER user's seeded strategy is absent — the
    // ownership/RLS boundary. Own-seed-scoped: draftB.name is this spec's
    // own mint, so its absence is deterministic, not a global-DB bet.
    await expect(page.getByText(draftB.name)).toHaveCount(0);

    // ── Case 3: the own row links toward the strategy's factsheet surface
    // (StrategyTable's name cell links /factsheet/<id>). Assert the href
    // SHAPE against the seeded id — click-through is optional per the plan
    // and skipped: a draft's factsheet render state is a different surface's
    // contract.
    await expect(ownRowLink).toHaveAttribute(
      "href",
      `/factsheet/${draftA.strategyId}`,
    );
  });
});
