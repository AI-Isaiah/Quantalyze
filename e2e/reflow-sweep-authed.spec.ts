/**
 * Phase 46-04 / REFLOW-01 + REFLOW-03 — parametrized SEEDED AUTHED reflow
 * sweep (WCAG 1.4.10 Reflow) at the 320px CSS reflow width.
 *
 * The authed half of the phase-46 verification backbone (the public half is
 * e2e/reflow-sweep.spec.ts). Proves every curated authed surface — the
 * allocations page + all six tabs (Overview / Holdings / Outcomes / Mandate /
 * Risk / Scenario-composer), the de-blocked onboarding wizard (WIZARD-01:
 * usable on a phone now that DesktopGate is gone), and the authed /security
 * page — has NO horizontal PAGE overflow at 320px (= 400% zoom on a 1280px
 * viewport; see reflow-sweep.spec.ts for the WCAG 1.4.4 equivalence note).
 *
 * REFLOW-03 degenerate-state route: a freshly-seeded allocator has a VERIFIED
 * profile but NO synced positions, so /allocations renders the honest-empty
 * AllocationDashboardV2 → EmptyState card ("No positions to analyze yet.").
 * The sweep anchors a dedicated case on that VISIBLE honest-empty <h2> — not
 * generic chrome — so a broken honest-empty layout at 320px fails LOUD
 * (Pitfall 5: a too-generic anchor would false-green against a login page).
 *
 * Each route is anchored on a route-specific VISIBLE content element (the
 * allocations "My Allocation" <h1> is rendered above the tab-panel switch on
 * every tab; the wizard's "Connect your exchange" <h2>; /security's <main h1>)
 * so assertNoReflow fails loud on a 404 / login / unseeded-chrome page rather
 * than measuring against nothing (the W-02 lesson).
 *
 * NB admin routes are deliberately EXCLUDED: seedTestAllocator stamps
 * role='allocator', and src/app/(dashboard)/admin/page.tsx redirects a
 * non-admin to /discovery/crypto-sma — anchoring an admin route would
 * false-green against that redirect (Pitfall 5). Admin-table reflow is proven
 * by the sibling all-columns guards + the ResponsiveTable wrap, not here.
 *
 * FLOW-01 dual-wiring (the twice-burned trap): this spec is wired in BOTH
 * required places — (1) the `HAS_SEED_ENV` const + `test.skip` below
 * (place 2), and (2) the ci.yml seeded MA-8 `npx playwright test` list
 * (place 1). "Proven to execute in CI (passed, not skipped) when
 * vars.E2E_TEST_DB_CONFIGURED == 'true'" is the explicit post-push must_have.
 */
import { test } from "@playwright/test";
import { seedTestAllocator } from "./helpers/seed-test-project";
import { assertNoReflow } from "./helpers/reflow";

// FLOW-01 place 2 of 2 — the spec's own seed-env self-skip guard. Without the
// seed env the authed routes redirect to /login; skipping prevents a
// false-green against that login chrome (W-02). With the env set in CI the
// MA-8 gate resolves true and these run for real.
const HAS_SEED_ENV =
  !!process.env.TEST_SUPABASE_URL &&
  !!process.env.TEST_SUPABASE_SERVICE_ROLE_KEY;

async function loginViaForm(
  page: import("@playwright/test").Page,
  email: string,
  password: string,
) {
  await page.goto("/login");
  await page.fill('input[name="email"], input[placeholder*="email" i]', email);
  await page.fill('input[type="password"]', password);
  await page.click('button:has-text("Sign in")');
  await page.waitForURL(/\/(discovery|strategies|allocations|dashboard)/, {
    timeout: 10000,
  });
}

// Curated authed route floor (SC#1). Each anchor is a route-specific VISIBLE
// content node a freshly-seeded allocator reliably renders — never generic
// chrome (Pitfall 5). `degenerate: true` marks the honest-empty route whose
// anchor is the EmptyState card itself (REFLOW-03).
const AUTHED_ROUTES: {
  path: string;
  anchor: string;
  label: string;
  degenerate?: boolean;
}[] = [
  // Allocations + every tab. The "My Allocation" <h1> sits above the tab-panel
  // switch (AllocationsTabs.tsx) so it is present on every ?tab= value — a
  // route-specific anchor that fails loud on a login/404 page.
  { path: "/allocations", anchor: 'h1:has-text("My Allocation")', label: "allocations (default)" },
  { path: "/allocations?tab=overview", anchor: 'h1:has-text("My Allocation")', label: "allocations Overview" },
  { path: "/allocations?tab=holdings", anchor: 'h1:has-text("My Allocation")', label: "allocations Holdings" },
  { path: "/allocations?tab=outcomes", anchor: 'h1:has-text("My Allocation")', label: "allocations Outcomes" },
  { path: "/allocations?tab=mandate", anchor: 'h1:has-text("My Allocation")', label: "allocations Mandate" },
  { path: "/allocations?tab=risk", anchor: 'h1:has-text("My Allocation")', label: "allocations Risk" },
  { path: "/allocations?tab=scenario", anchor: 'h1:has-text("My Allocation")', label: "allocations Scenario composer" },
  // De-blocked onboarding wizard (WIZARD-01) — the default ?source=api flow
  // renders ConnectKeyStep's "Connect your exchange" <h2 id=…>. Proving this
  // reflows at 320px is the phone-usable-wizard proof.
  { path: "/strategies/new/wizard", anchor: "#wizard-connect-key-heading", label: "onboarding wizard (de-blocked)" },
  // Authed /security — same <main h1> ("Security practices") as the public
  // page, exercised inside the authed session.
  { path: "/security", anchor: "main h1", label: "security (authed)" },
];

test.describe("reflow sweep (WCAG 1.4.10 / 1.4.4) @ 320px — authed", () => {
  test.skip(
    !HAS_SEED_ENV,
    "reflow-sweep-authed: seed-helper env vars not wired " +
      "(set TEST_SUPABASE_URL / TEST_SUPABASE_SERVICE_ROLE_KEY) — " +
      "skipping prevents false-green on empty/404/login pages (W-02). " +
      "The live authed reflow proof runs in CI / /qa once seed env is present.",
  );

  // One seeded allocator + login for the whole sweep (mirrors the seeded
  // precedents). The session cookie carries across page.goto navigations.
  let allocator: Awaited<ReturnType<typeof seedTestAllocator>>;

  test.beforeAll(async () => {
    allocator = await seedTestAllocator();
  });

  test.beforeEach(async ({ page }) => {
    await loginViaForm(page, allocator.email, allocator.password);
  });

  for (const r of AUTHED_ROUTES) {
    test(`${r.label} — no horizontal overflow at 320px`, async ({ page }) => {
      await page.setViewportSize({ width: 320, height: 800 });
      const res = await page.goto(r.path);
      if (res) {
        const status = res.status();
        if (status >= 400) {
          throw new Error(
            `${r.path} returned HTTP ${status} — cannot run authed reflow sweep`,
          );
        }
      }
      await assertNoReflow(page, r.anchor);
    });
  }

  // REFLOW-03 — the degenerate honest-empty route. A freshly-seeded allocator
  // has NO synced positions, so AllocationDashboardV2 renders the EmptyState
  // card ("No positions to analyze yet."). Anchoring on that VISIBLE
  // honest-empty <h2> proves the empty-state layout itself reflows at 320px —
  // a broken honest-empty card fails LOUD rather than passing against chrome.
  test("degenerate honest-empty (/allocations, 0 positions) — EmptyState reflows at 320px", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 320, height: 800 });
    const res = await page.goto("/allocations?tab=overview");
    if (res && res.status() >= 400) {
      throw new Error(`/allocations returned HTTP ${res.status()} — cannot run degenerate reflow case`);
    }
    // The honest-empty headline is the EmptyState card's own <h2> — a real
    // honest-empty DOM node, not generic chrome (Pitfall 5).
    await assertNoReflow(page, 'h2:has-text("No positions to analyze yet")');
  });
});
