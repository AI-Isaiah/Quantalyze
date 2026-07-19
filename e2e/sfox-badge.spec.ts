/**
 * Plan 122-04 / SFOX-09 — connected-sFOX badge + tag e2e (seed-gated).
 *
 * Proves end-to-end that a connected sFOX strategy renders BOTH provenance
 * surfaces shipped in plan 122-01:
 *   - the "SFOX" 3-letter mono exchange TAG in the ApiKeyManager key card on
 *     the owner's /strategies/[id]/edit page, and
 *   - the api_verified PROVENANCE badge — VerifiedBadge's "Verified" chip
 *     and/or TrustTierLabel's "API verified" pill — projected from the seeded
 *     strategy_verifications row onto strategy.trust_tier.
 *
 * Both surfaces are UNCONDITIONAL (independent of NEXT_PUBLIC_SFOX_ENABLED /
 * the SFOX-08 offer flag — 122-01 locked decision), so this spec needs no
 * offer-flag manipulation and works against a default (flag-OFF) build.
 *
 * Roles swept (fixtures OWNED BY the logged-in user, per the project e2e RLS
 * rule):
 *   - OWNER ("both" role): the manager /strategies/[id]/edit surface (the SFOX
 *     tag) AND the public factsheet /strategy/[id] (the badge). The "both" user
 *     owns both surfaces with no requireRolePage redirect.
 *   - ALLOCATOR (the SAME "both" user): the /browse/<slug>/<id> discovery
 *     presentation, whose VerifiedBadge is gated on strategy.api_key_id (the
 *     seed links the sfox key, so it renders).
 *   - ADMIN (a separate is_admin-elevated session): a NON-owner viewer reads the
 *     same seeded sfox strategy's api_verified tier through the public factsheet.
 *   - ANON (logged-out): the /strategy/[id] factsheet is publicly viewable and
 *     the api_verified badge is public provenance — a logged-out visitor must
 *     see it (Phase 126 FACTSHEET-01; the anti-mask regression net).
 *   - PUBLIC-DEMO: N/A. The /demo surface runs on sentinel fixtures with no
 *     sfox strategy; asserting there would require inventing data (no-invented-
 *     data rule), so it is deliberately not swept.
 *
 * Scope notes:
 *   - The live-key wizard connect flow is founder-gated on plan 121-03 and is
 *     NOT in scope here; ROADMAP SC4 is covered at the component level in plan
 *     122-02. This spec exercises only the already-rendered badge/tag surfaces.
 *   - CI wiring: the seeded playwright job in .github/workflows/ci.yml uses an
 *     EXPLICIT spec list (not a glob); this spec is registered there so it
 *     auto-runs once the seed-gated GH secrets are present.
 *
 * Gate: mirrors the wizard-axe.spec.ts test.skip-when-seed-env-absent pattern —
 * without TEST_SUPABASE_URL / TEST_SUPABASE_SERVICE_ROLE_KEY every test skips
 * cleanly (CI green pre-secrets; RUNS once the secrets are wired).
 *
 * Axe: one buildAxe() pass (the ONLY sanctioned rule-set factory — never a
 * local rule set) on the badge-bearing factsheet, zero-violations threshold.
 */
import { test, expect } from "@playwright/test";
import { buildAxe } from "./helpers/axe";
import {
  seedSfoxVerifiedStrategy,
  cleanupSfoxVerifiedStrategy,
  type SeededSfoxVerifiedStrategy,
} from "./helpers/seed-test-project";

const HAS_SEED_ENV =
  !!process.env.TEST_SUPABASE_URL &&
  !!process.env.TEST_SUPABASE_SERVICE_ROLE_KEY;

// Inline loginViaForm idiom, copied from wizard-axe.spec.ts (no shared helper
// exists yet in e2e/helpers/). The "both"/admin users both land on one of the
// dashboard routes after sign-in.
async function loginViaForm(
  page: import("@playwright/test").Page,
  email: string,
  password: string,
) {
  await page.goto("/login");
  await page.fill('input[name="email"], input[placeholder*="email" i]', email);
  await page.fill('input[type="password"]', password);
  await page.click('button:has-text("Sign in")');
  await page.waitForURL(/\/(discovery|strategies|allocations|dashboard|admin)/, {
    timeout: 10_000,
  });
}

// The api_verified badge is carried by EITHER the VerifiedBadge "Verified" chip
// OR the TrustTierLabel pill (data-trust-tier="api_verified", label "API
// verified") depending on the surface. Assert whichever the surface renders by
// OR-ing the two locators — no coupling to a single component per the plan's
// "discovered from the live DOM, not assumed" guidance.
function apiVerifiedBadge(page: import("@playwright/test").Page) {
  return page
    .getByText("Verified", { exact: true })
    .or(page.locator('[data-trust-tier="api_verified"]'));
}

test.describe("Plan 122-04 — connected-sFOX badge + tag (SFOX-09)", () => {
  test.skip(
    !HAS_SEED_ENV,
    "sfox-badge: seed-helper env vars not wired " +
      "(set TEST_SUPABASE_URL / TEST_SUPABASE_SERVICE_ROLE_KEY).",
  );

  let seeded: SeededSfoxVerifiedStrategy;

  test.beforeAll(async () => {
    if (!HAS_SEED_ENV) return;
    // The helper fails LOUD (naming the phase-119 SFOX-04 migration) if the
    // constraint-widening precondition is missing on the test project — never
    // a bare 23514.
    seeded = await seedSfoxVerifiedStrategy();
  });

  test.afterAll(async () => {
    if (!HAS_SEED_ENV || !seeded) return;
    await cleanupSfoxVerifiedStrategy(seeded);
  });

  test("owner: /strategies/[id]/edit renders the SFOX exchange tag", async ({
    page,
  }) => {
    test.skip(!HAS_SEED_ENV, "sfox-badge: seed-env not wired (visible skip, not a silent pass).");
    await loginViaForm(page, seeded.owner.email, seeded.owner.password);

    await page.goto(`/strategies/${seeded.strategyId}/edit`);
    // Pin the URL so the assertion runs on the edit surface, not a redirect
    // (ME-02 false-green guard, mirrors wizard-axe.spec.ts).
    await expect(page).toHaveURL(
      new RegExp(`/strategies/${seeded.strategyId}/edit`),
      { timeout: 10_000 },
    );

    // ApiKeyManager lists the logged-in user's api_keys; the sfox key renders
    // the "SFOX" mono tag in its card avatar (122-01). It must be the real tag,
    // never the "?" unknown-exchange fallback.
    await expect(page.getByText("SFOX", { exact: true }).first()).toBeVisible({
      timeout: 10_000,
    });
    await expect(page.getByText("?", { exact: true })).toHaveCount(0);
  });

  test("owner: the strategy factsheet shows the api_verified badge (+ axe)", async ({
    page,
  }) => {
    test.skip(!HAS_SEED_ENV, "sfox-badge: seed-env not wired (visible skip, not a silent pass).");
    await loginViaForm(page, seeded.owner.email, seeded.owner.password);

    await page.goto(`/strategy/${seeded.strategyId}`);
    await expect(page).toHaveURL(new RegExp(`/strategy/${seeded.strategyId}`), {
      timeout: 10_000,
    });

    await expect(apiVerifiedBadge(page).first()).toBeVisible({
      timeout: 10_000,
    });

    // One axe pass on the badge-bearing factsheet — zero violations.
    const results = await buildAxe(page).analyze();
    expect(results.violations).toEqual([]);
  });

  test("allocator: the browse presentation shows the api_verified badge", async ({
    page,
  }) => {
    test.skip(!HAS_SEED_ENV, "sfox-badge: seed-env not wired (visible skip, not a silent pass).");
    // Same "both" user — it owns the allocator/browse surfaces too.
    await loginViaForm(page, seeded.owner.email, seeded.owner.password);

    // The browse detail page fetches the strategy by id (getPublicStrategyDetail)
    // — category membership is not required for the direct-id route. Its
    // VerifiedBadge is gated on strategy.api_key_id, which the seed links.
    await page.goto(`/browse/crypto-sma/${seeded.strategyId}`);
    await expect(
      page.locator("h1").first(),
    ).toBeVisible({ timeout: 10_000 });

    await expect(apiVerifiedBadge(page).first()).toBeVisible({
      timeout: 10_000,
    });
  });

  test("admin: an elevated session reads the sfox strategy's api_verified tier", async ({
    page,
  }) => {
    test.skip(!HAS_SEED_ENV, "sfox-badge: seed-env not wired (visible skip, not a silent pass).");
    await loginViaForm(page, seeded.admin.email, seeded.admin.password);

    // Phase 126 (FACTSHEET-01): the admin is a NON-owner viewer. Before the fix
    // the badge was invisible to every non-owner because trust_tier was read via
    // an RLS-scoped embed on strategy_verifications (owner-only SELECT) → tier
    // null → no badge. The fix reads trust_tier via the published-gated
    // get_published_trust_signals SECURITY DEFINER RPC (queries.readPublicVerificationSignals,
    // normal client + anon EXECUTE — NOT service role), so ANY non-owner viewer
    // now sees the api_verified badge. This asserts that corrected intent.
    await page.goto(`/strategy/${seeded.strategyId}`);
    await expect(page).toHaveURL(new RegExp(`/strategy/${seeded.strategyId}`), {
      timeout: 10_000,
    });

    await expect(apiVerifiedBadge(page).first()).toBeVisible({
      timeout: 10_000,
    });
  });

  test("anon: a logged-out visitor sees the api_verified badge on the public factsheet", async ({
    page,
  }) => {
    test.skip(!HAS_SEED_ENV, "sfox-badge: seed-env not wired (visible skip, not a silent pass).");
    // NO login — the /strategy/[id] factsheet of a PUBLISHED strategy is
    // publicly viewable, and the api_verified badge is public provenance. This
    // is the core FACTSHEET-01 requirement (badge visible to EVERYONE incl.
    // logged-out) AND the anti-mask net: it fails RED on the pre-126 code where
    // the RLS-scoped verification embed returned zero rows for anon → tier null
    // → the badge silently vanished. Do NOT log in here.
    await page.goto(`/strategy/${seeded.strategyId}`);
    await expect(page).toHaveURL(new RegExp(`/strategy/${seeded.strategyId}`), {
      timeout: 10_000,
    });

    await expect(apiVerifiedBadge(page).first()).toBeVisible({
      timeout: 10_000,
    });
  });

  // PUBLIC-DEMO: intentionally NOT swept — see the file header. The /demo
  // surface runs on sentinel fixtures with no sfox strategy; asserting the
  // badge there would require inventing data (no-invented-data rule).
});
