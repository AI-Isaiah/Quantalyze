/**
 * Plan 138-03 / MT5UI-02 — connected-MT5 badge + tag e2e (seed-gated).
 *
 * Clone of e2e/sfox-badge.spec.ts (SFOX-09) for the MT5 seed. Proves end-to-end
 * that a connected MT5 strategy renders BOTH provenance surfaces:
 *   - the "MT5" 3-letter mono exchange TAG in the ApiKeyManager key card on the
 *     owner's /strategies/[id]/edit page (138-03 Task 1), and
 *   - the api_verified PROVENANCE badge — VerifiedBadge's "Verified" chip and/or
 *     TrustTierLabel's "API verified" pill — projected from the seeded
 *     strategy_verifications row onto strategy.trust_tier (ZERO badge-component
 *     change; the same shipped components the sfox spec exercises).
 *
 * Both surfaces are UNCONDITIONAL (independent of NEXT_PUBLIC_MT5_ENABLED — the
 * flag gates only the OFFER; the badge/tag are PROVENANCE, the user's OWN
 * already-connected key), so this spec needs no offer-flag manipulation and runs
 * against a default (flag-OFF, dark-until-139) build.
 *
 * Roles swept (fixtures OWNED BY the logged-in user, per the project e2e RLS
 * rule):
 *   - OWNER ("both" role): the manager /strategies/[id]/edit surface (the MT5
 *     tag) AND the public factsheet /strategy/[id] (the badge).
 *   - ALLOCATOR (the SAME "both" user): the /browse/<slug>/<id> discovery
 *     presentation, whose VerifiedBadge is gated on strategy.api_key_id (the
 *     seed links the mt5 key, so it renders).
 *   - ADMIN (a separate is_admin-elevated session): a NON-owner viewer reads the
 *     same seeded mt5 strategy's api_verified tier through the public factsheet.
 *   - ANON (logged-out): the /strategy/[id] factsheet is publicly viewable and
 *     the api_verified badge is public provenance (Phase 126 FACTSHEET-01; the
 *     anti-mask regression net).
 *   - PUBLIC-DEMO: N/A. The /demo surface runs on sentinel fixtures with no mt5
 *     strategy; asserting there would require inventing data (no-invented-data
 *     rule), so it is deliberately not swept.
 *
 * Scope notes:
 *   - The live-key wizard connect flow is founder-gated until Phase 139 (a live
 *     connect fails closed while MT5_ENABLED is dark) and is NOT in scope here;
 *     MT5UI-02's connect-flow error distinguishability is covered at the
 *     component level in plan 138-01. This spec exercises only the
 *     already-rendered badge/tag surfaces.
 *   - CI wiring: the seeded playwright job in .github/workflows/ci.yml uses an
 *     EXPLICIT spec list (not a glob); this spec is registered there so it
 *     auto-runs in the BLOCKING e2e-seeded gate once the seed GH secrets exist.
 *
 * Gate: mirrors sfox-badge.spec.ts — without TEST_SUPABASE_URL /
 * TEST_SUPABASE_SERVICE_ROLE_KEY every test skips cleanly (visible skip, not a
 * silent pass; CI green pre-secrets, RUNS once the secrets are wired).
 *
 * Axe: one buildAxe() pass (the ONLY sanctioned rule-set factory) on the
 * badge-bearing factsheet, zero-violations threshold.
 */
import { test, expect } from "@playwright/test";
import { buildAxe } from "./helpers/axe";
import {
  seedMt5VerifiedStrategy,
  cleanupMt5VerifiedStrategy,
  type SeededMt5VerifiedStrategy,
} from "./helpers/seed-test-project";

const HAS_SEED_ENV =
  !!process.env.TEST_SUPABASE_URL &&
  !!process.env.TEST_SUPABASE_SERVICE_ROLE_KEY;

// Inline loginViaForm idiom, copied from sfox-badge.spec.ts (no shared helper
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
// OR-ing the two locators — target stable attributes, never restyle.
function apiVerifiedBadge(page: import("@playwright/test").Page) {
  return page
    .getByText("Verified", { exact: true })
    .or(page.locator('[data-trust-tier="api_verified"]'));
}

test.describe("Plan 138-03 — connected-MT5 badge + tag (MT5UI-02)", () => {
  test.skip(
    !HAS_SEED_ENV,
    "mt5-badge: seed-helper env vars not wired " +
      "(set TEST_SUPABASE_URL / TEST_SUPABASE_SERVICE_ROLE_KEY).",
  );

  let seeded: SeededMt5VerifiedStrategy;

  test.beforeAll(async () => {
    if (!HAS_SEED_ENV) return;
    // The helper fails LOUD (naming the mt5 boundary-widen migration
    // 20260723172032) if the constraint-widening precondition is missing on the
    // test project — never a bare 23514.
    seeded = await seedMt5VerifiedStrategy();
  });

  test.afterAll(async () => {
    if (!HAS_SEED_ENV || !seeded) return;
    await cleanupMt5VerifiedStrategy(seeded);
  });

  test("owner: /strategies/[id]/edit renders the MT5 exchange tag", async ({
    page,
  }) => {
    test.skip(!HAS_SEED_ENV, "mt5-badge: seed-env not wired (visible skip, not a silent pass).");
    await loginViaForm(page, seeded.owner.email, seeded.owner.password);

    await page.goto(`/strategies/${seeded.strategyId}/edit`);
    // Pin the URL so the assertion runs on the edit surface, not a redirect
    // (ME-02 false-green guard, mirrors sfox-badge.spec.ts).
    await expect(page).toHaveURL(
      new RegExp(`/strategies/${seeded.strategyId}/edit`),
      { timeout: 10_000 },
    );

    // ApiKeyManager lists the logged-in user's api_keys; the mt5 key renders the
    // "MT5" mono tag in its card avatar (138-03 Task 1). It must be the real tag,
    // never the "?" unknown-exchange fallback.
    await expect(page.getByText("MT5", { exact: true }).first()).toBeVisible({
      timeout: 10_000,
    });
    await expect(page.getByText("?", { exact: true })).toHaveCount(0);
  });

  test("owner: the strategy factsheet shows the api_verified badge (+ axe)", async ({
    page,
  }) => {
    test.skip(!HAS_SEED_ENV, "mt5-badge: seed-env not wired (visible skip, not a silent pass).");
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
    test.skip(!HAS_SEED_ENV, "mt5-badge: seed-env not wired (visible skip, not a silent pass).");
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

  test("admin: an elevated session reads the mt5 strategy's api_verified tier", async ({
    page,
  }) => {
    test.skip(!HAS_SEED_ENV, "mt5-badge: seed-env not wired (visible skip, not a silent pass).");
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
    test.skip(!HAS_SEED_ENV, "mt5-badge: seed-env not wired (visible skip, not a silent pass).");
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
  // surface runs on sentinel fixtures with no mt5 strategy; asserting the badge
  // there would require inventing data (no-invented-data rule).
});
