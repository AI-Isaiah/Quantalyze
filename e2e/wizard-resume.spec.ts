/**
 * Phase 154 / WIZCONT-01 — "re-entering continues where you left off", proved
 * in a browser at the entry point that was broken.
 *
 * ⚠️ `/strategies/new/wizard` ALREADY resumed before this phase (the SSR page
 * has read the draft since Phase 46). The defect lived on the OTHER entry
 * point: `ContributionWizardOverlay` passed `initialDraft={null}`, so opening
 * the wizard from "+ Allocation" / the My Strategies empty state always
 * started fresh. This spec therefore drives the OVERLAY, never that route —
 * asserting the route would report green against the untouched bug.
 *
 * ── Oracles ─────────────────────────────────────────────────────────────────
 * 1. A route SPY (not a stub) on `/api/strategies/wizard-draft`: the overlay
 *    must actually ASK. The spy also reads the response body, which is how the
 *    OWN-SEED invariant is enforced — the id that came back is compared to the
 *    id this spec seeded.
 * 2. A route SPY on `/api/keys/sync`: its `strategy_id` body field is the
 *    wizard's own state, so seeing THIS spec's strategy id there proves the
 *    draft reached the step machine rather than merely reaching a prop.
 * 3. The REAL resume banner (`wizard-resume` / `wizard-start-fresh`) — the
 *    explicit choice CONTEXT.md requires; a silent jump would fail this.
 *
 * ⚠️ SHARED TEST DB. Every assertion below is about THIS spec's own seeded
 * rows. There is no "no draft exists" assertion and no global row count —
 * other specs and accumulated leave-arounds make those non-deterministic
 * (project memory: e2e specs assert their OWN seed invariant).
 *
 * ── Seed-gate (two-place rule) ──────────────────────────────────────────────
 * Place 1: the HAS_SEED_ENV self-skip below. Place 2: this file is listed in
 * the `e2e-seeded` batch in `.github/workflows/ci.yml` — a NEW spec needs that
 * entry or it never runs anywhere, which is a false green, not a passing test.
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

/** The GC niche this spec owns on the shared test DB. */
const NAME_PREFIX = "e2e-wizcont-";

/**
 * Inline login — copied from composer-axe.spec.ts:59-71 / wizard-axe.spec.ts.
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

test.describe("Phase 154 — wizard continuity (WIZCONT-01)", () => {
  test.skip(
    !HAS_SEED_ENV,
    "wizard resume: seed-helper env vars not wired " +
      "(set TEST_SUPABASE_URL / TEST_SUPABASE_SERVICE_ROLE_KEY).",
  );

  test.afterAll(async () => {
    if (HAS_SEED_ENV) {
      await cleanupStrategiesByNamePrefix(NAME_PREFIX);
    }
  });

  test("an existing draft is offered — and resumed — from the overlay", async ({
    page,
  }) => {
    test.skip(!HAS_SEED_ENV, "requires seed env");

    // Owner FIRST: the draft read is RLS-bound to the logged-in user, so the
    // draft must belong to the account that walks the flow.
    const allocator = await seedTestAllocator({ role: "both" });
    const draft = await seedWizardDraft({
      ownerUserId: allocator.userId,
      namePrefix: NAME_PREFIX,
    });

    // SPY 1 — the overlay must ask, and the answer must be MY draft.
    let draftReads = 0;
    const observedDraftIds: string[] = [];
    await page.route("**/api/strategies/wizard-draft", async (route) => {
      draftReads += 1;
      const response = await route.fetch();
      const body = (await response.json().catch(() => null)) as {
        draft?: { id?: string } | null;
      } | null;
      if (body?.draft?.id) observedDraftIds.push(body.draft.id);
      await route.fulfill({ response });
    });

    // SPY 2 — the wizard's OWN state on the wire.
    const syncedStrategyIds: string[] = [];
    await page.route("**/api/keys/sync", async (route) => {
      const payload = route.request().postDataJSON() as
        | { strategy_id?: string }
        | null;
      if (payload?.strategy_id) syncedStrategyIds.push(payload.strategy_id);
      await route.continue();
    });

    await loginViaForm(page, allocator.email, allocator.password);
    await page.goto("/allocations");

    // The "+ Allocation" header button (ADDALLOC-02) — the tab-agnostic
    // onboarding-wizard mount, one of the four real overlay renderers.
    await page
      .getByRole("button", { name: /Add allocation/i })
      .click({ timeout: 15_000 });

    const dialog = page.getByRole("dialog", { name: "Add a strategy" });
    await expect(dialog).toBeVisible({ timeout: 15_000 });

    // The deferred mount resolves rather than hanging.
    await expect(page.getByTestId("overlay-draft-pending")).toBeHidden({
      timeout: 15_000,
    });

    // ⭐ The explicit choice. Before this phase the overlay hard-coded
    // initialDraft={null}, so no banner could ever render here.
    await expect(page.getByTestId("wizard-resume")).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByTestId("wizard-start-fresh")).toBeVisible();

    expect(
      draftReads,
      "The overlay must ASK for the draft on open — a resume that renders " +
        "without a read is reading something else.",
    ).toBeGreaterThanOrEqual(1);
    expect(
      observedDraftIds,
      "OWN-SEED invariant: the draft the overlay was handed must be the one " +
        "this spec seeded, not whatever the shared test DB happens to hold.",
    ).toContain(draft.strategyId);

    // Resume lands on the draft's step, holding the draft.
    await page.getByTestId("wizard-resume").click();
    await expect(page.getByTestId("wizard-resume")).toBeHidden({
      timeout: 10_000,
    });
    // `wizard-delete-draft` renders only while the wizard holds a strategyId,
    // so its presence is the wizard saying "I am working on a draft".
    await expect(page.getByTestId("wizard-delete-draft")).toBeVisible({
      timeout: 10_000,
    });

    // …and it is MY draft: the sync_preview step kicks off against the seeded
    // strategy id. This is the wizard's own state on the wire, not a prop.
    await expect
      .poll(() => syncedStrategyIds, {
        timeout: 20_000,
        message:
          "sync_preview must kick off against the RESUMED draft's strategy id.",
      })
      .toContain(draft.strategyId);
  });
});
