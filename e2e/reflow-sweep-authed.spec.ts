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
 * The two wizard-spanning sweeps below (AUTHED_ROUTES, ULTRAWIDE_ROUTES) seed
 * role='both' because the standalone /strategies/new/wizard route is
 * manager-gated (Phase 109 ROLE-04, strategies/layout.tsx — allocators
 * contribute via the inline ContributionWizardOverlay, Phase 110 CONTRIB); a
 * pure allocator would be redirected off it. 'both' owns BOTH the allocator
 * surfaces AND the manager wizard route in one user without redirect.
 *
 * NB admin routes are deliberately EXCLUDED: neither 'allocator' nor 'both' is
 * an admin, and src/app/(dashboard)/admin/page.tsx redirects a non-admin to
 * /discovery/crypto-sma — anchoring an admin route would false-green against
 * that redirect (Pitfall 5). Admin-table reflow is proven by the sibling
 * all-columns guards + the ResponsiveTable wrap, not here.
 *
 * FLOW-01 dual-wiring (the twice-burned trap): this spec is wired in BOTH
 * required places — (1) the `HAS_SEED_ENV` const + `test.skip` below
 * (place 2), and (2) the ci.yml seeded MA-8 `npx playwright test` list
 * (place 1). "Proven to execute in CI (passed, not skipped) when
 * vars.E2E_TEST_DB_CONFIGURED == 'true'" is the explicit post-push must_have.
 */
import { test, expect } from "@playwright/test";
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
  // Manager-gated standalone onboarding wizard (Phase 109 ROLE-04) — reached
  // here via the seeded role='both' user. The default ?source=api flow renders
  // ConnectKeyStep's "Connect your exchange" <h2 id=…>. Proving this reflows at
  // 320px is the phone-usable-wizard proof.
  { path: "/strategies/new/wizard", anchor: "#wizard-connect-key-heading", label: "onboarding wizard API entry (manager-gated route, role=both)" },
  // The CSV branch (?source=csv) initializes WizardClient to the csv_upload step
  // (WizardClient.tsx step-init), rendering CsvUploadStep's
  // <h2 id="wizard-csv-upload-heading">. The founder-with-a-track-record-CSV
  // path must also reflow at 320px — without this the sweep only proved the API
  // branch entry.
  { path: "/strategies/new/wizard?source=csv", anchor: "#wizard-csv-upload-heading", label: "onboarding wizard CSV entry (manager-gated route, role=both)" },
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

  // One seeded role='both' user + login for the whole sweep (mirrors the seeded
  // precedents). role='both' owns the allocator surfaces AND the manager-gated
  // /strategies/new/wizard route (see the file header + AUTHED_ROUTES notes), so
  // one user sweeps both without redirect. The session cookie carries across
  // page.goto navigations.
  let allocator: Awaited<ReturnType<typeof seedTestAllocator>>;

  test.beforeAll(async () => {
    allocator = await seedTestAllocator({ role: "both" });
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

// Phase 48-05 / A11Y-03 (SC#4) — rotate-stability fold. ADDITIVE to this
// already-seeded, already-dual-wired spec (it is in the ci.yml seeded MA-8 list
// AND HAS_SEED_ENV-gated above), so NO new FLOW-01 wiring is needed (the
// composer-axe GUARD-03 fold precedent). NOT a new harness — a self-contained
// describe in the existing mobile host spec, per the A11Y-03 contract.
//
// Proves that rotating the viewport portrait -> landscape -> portrait on an
// authed route that mounts a ResizeObserver-driven chart (/allocations ->
// EquityChart's measured-width ResizeObserver, EquityChart.tsx:517-528) does
// NOT emit the "ResizeObserver loop completed with undelivered notifications"
// browser error (the classic feedback-loop symptom of a resize handler that
// writes layout-affecting state synchronously inside the observer callback) and
// does NOT grow JS heap unboundedly across the rotate cycle (a leaked
// observer / listener per rotate). The console listener is registered BEFORE
// navigation so a load-time RO loop is also caught.
test.describe("rotate-stability (SC#4) — /allocations EquityChart, authed", () => {
  test.skip(
    !HAS_SEED_ENV,
    "rotate-stability: seed-helper env vars not wired " +
      "(set TEST_SUPABASE_URL / TEST_SUPABASE_SERVICE_ROLE_KEY) — " +
      "skipping prevents a false-green against an unhydrated login page (W-02).",
  );

  let allocator: Awaited<ReturnType<typeof seedTestAllocator>>;

  test.beforeAll(async () => {
    allocator = await seedTestAllocator();
  });

  test.beforeEach(async ({ page }) => {
    await loginViaForm(page, allocator.email, allocator.password);
  });

  test("no ResizeObserver loop error + bounded heap across portrait<->landscape rotate", async ({
    page,
  }) => {
    // Register the console listener BEFORE navigation so a load-time RO loop is
    // captured too (the demo-public/wizard-hydration-probe page.on idiom).
    const consoleErrors: string[] = [];
    page.on("console", (m) => {
      if (m.type() === "error") consoleErrors.push(m.text());
    });
    // pageerror catches an uncaught RO-loop exception that some browsers throw
    // rather than logging to console.
    const pageErrors: string[] = [];
    page.on("pageerror", (err) => {
      pageErrors.push(err.message);
    });

    // Start in portrait phone size. EquityChart mounts on /allocations
    // (AllocationDashboardV2 performance widget); its ResizeObserver re-measures
    // width on every viewport change.
    await page.setViewportSize({ width: 375, height: 812 });
    const res = await page.goto("/allocations");
    if (res && res.status() >= 400) {
      throw new Error(
        `/allocations returned HTTP ${res.status()} — cannot run rotate-stability case`,
      );
    }
    // Fail loud on an unhydrated/login page (Pitfall 4) — anchor on the
    // route-specific "My Allocation" <h1> the seeded allocator always renders.
    await expect(page.locator('h1:has-text("My Allocation")')).toBeVisible({
      timeout: 10_000,
    });

    // performance.memory is a Chromium-only, opt-in heap gauge; read it if
    // present (it is under headless Chromium) and skip the memory bound
    // gracefully otherwise (SC#4 says "stable memory", a BOUNDED check — never
    // a hard byte count, which would flake on GC timing).
    const readHeap = async (): Promise<number | null> =>
      page.evaluate(() => {
        const mem = (
          performance as Performance & { memory?: { usedJSHeapSize: number } }
        ).memory;
        return mem ? mem.usedJSHeapSize : null;
      });

    const heapBefore = await readHeap();

    // Rotate portrait -> landscape -> portrait, settling between each so the
    // ResizeObserver callback + any rAF-scheduled re-measure runs to quiescence.
    const rotations = [
      { width: 812, height: 375, label: "landscape" },
      { width: 375, height: 812, label: "portrait" },
      { width: 812, height: 375, label: "landscape" },
      { width: 375, height: 812, label: "portrait" },
    ];
    for (const r of rotations) {
      await page.setViewportSize({ width: r.width, height: r.height });
      // Let layout + the ResizeObserver callback + a frame settle.
      await page.waitForTimeout(250);
      // Keep the chart in view across the cycle (it must stay mounted for the
      // ResizeObserver to keep firing — a leaked observer would compound here).
      await expect(page.locator('h1:has-text("My Allocation")')).toBeVisible();
    }

    // SC#4 core assertion: NO ResizeObserver-loop error in console OR as an
    // uncaught pageerror across the whole rotate cycle.
    const roLoopConsole = consoleErrors.filter((t) =>
      /ResizeObserver loop/i.test(t),
    );
    const roLoopPageErr = pageErrors.filter((t) =>
      /ResizeObserver loop/i.test(t),
    );
    expect(
      roLoopConsole,
      `ResizeObserver loop console errors during rotate: ${JSON.stringify(roLoopConsole)}`,
    ).toEqual([]);
    expect(
      roLoopPageErr,
      `ResizeObserver loop pageerrors during rotate: ${JSON.stringify(roLoopPageErr)}`,
    ).toEqual([]);

    // SC#4 stable-memory: a BOUNDED growth check, only when the gauge exists.
    // A leaked observer/listener per rotate would blow well past a generous 4x
    // bound; transient GC jitter stays comfortably under it. Skip cleanly if
    // performance.memory is unavailable in the runner (never a hard byte count).
    const heapAfter = await readHeap();
    if (heapBefore !== null && heapAfter !== null && heapBefore > 0) {
      const growthRatio = heapAfter / heapBefore;
      expect(
        growthRatio,
        `JS heap grew ${growthRatio.toFixed(2)}x across the rotate cycle ` +
          `(before=${heapBefore} after=${heapAfter}) — suspected leaked ` +
          `ResizeObserver/listener per rotate`,
      ).toBeLessThan(4);
    } else {
      console.log(
        "rotate-stability: performance.memory unavailable — heap-bound check skipped (RO-loop assertion still enforced).",
      );
    }
  });
});

// Phase 52-01 / APPLY-01 + TYPE-03 — 2560px ultra-wide reflow row. ADDITIVE to
// this already-seeded, already-dual-wired spec (it is in the ci.yml seeded MA-8
// list AND HAS_SEED_ENV-gated above), so NO new FLOW-01 wiring is needed — the
// rotate-stability fold above is the additive-fold precedent. NOT a new harness:
// a self-contained describe in the existing seeded host spec, reusing the same
// HAS_SEED_ENV + test.skip + seedTestAllocator + loginViaForm scaffolding.
//
// The 320px sweep above proves WCAG 1.4.10 Reflow at the lower bound; this row
// proves the v1.4 "layouts hold to ULTRA-WIDE" requirement at the upper bound
// (no horizontal overflow when the allocator viewport is 2560px). It is the
// cheap IN-SCOPE subset of the app-wide 2560 sweep that FORMALLY lands in Phase
// 54 (VERIFY-*) — here it is scoped to the allocator surfaces this milestone
// restyles, so an ultra-wide overflow on /allocations + its key tabs + /compare
// fails LOUD in the journey phase rather than waiting for the verification phase.
//
// Each anchor is a route-specific VISIBLE content node a freshly-seeded
// allocator reliably renders (Pitfall 5 / W-02 false-green guard) — never a
// bare body/main chrome anchor — so a 404 / login / unhydrated page fails loud
// instead of measuring against nothing. The "My Allocation" <h1> sits above the
// tab-panel switch (AllocationsTabs.tsx) so it is present on every ?tab= value;
// /compare with no ?ids= renders the empty-selection PageHeader <h1> ("Compare
// Strategies"), which a seeded allocator with no compare selection always hits.
// Phase 54-06 / VERIFY-01 widens this from the Phase-52 IN-SCOPE allocator
// subset (allocations + scenario/risk + /compare) to the APP-WIDE set of routes
// a FRESHLY-SEEDED role='both' user (seedTestAllocator({ role: "both" }), NO
// extra seed) reliably renders with a stable VISIBLE anchor — the same
// reachability the 320px AUTHED_ROUTES sweep above already proves. Added rows:
//   - the remaining /allocations tabs (overview/holdings/outcomes/mandate) — the
//     "My Allocation" <h1> sits above the tab-panel switch on every ?tab= value;
//   - the manager-gated onboarding wizard (API + CSV entries) — its step
//     <h2 id=…> anchors, mirroring the 320px sweep. The standalone
//     /strategies/new/wizard route is manager-gated (Phase 109 ROLE-04,
//     strategies/layout.tsx; allocators contribute via the inline
//     ContributionWizardOverlay, Phase 110 CONTRIB), so role='both' is required
//     to reach it without redirect;
//   - authed /security (same <main h1> as the public page, in-session).
// ADMIN routes are deliberately EXCLUDED (see :26-31 — neither 'allocator' nor
// 'both' is an admin; /admin redirects a non-admin → a false-green). Admin
// ultra-wide width is covered by the static admin-width.test.tsx (Plan 54-03),
// not here. /discovery/[slug] is OMITTED: without a seedBridgeCandidate the
// freshly-seeded user hits the category empty-state, not a stable
// content-bearing layout to gate on (the axe spec seeds a bridge for that).
const ULTRAWIDE_ROUTES: { path: string; anchor: string; label: string }[] = [
  { path: "/allocations", anchor: 'h1:has-text("My Allocation")', label: "allocations (default)" },
  { path: "/allocations?tab=overview", anchor: 'h1:has-text("My Allocation")', label: "allocations Overview" },
  { path: "/allocations?tab=holdings", anchor: 'h1:has-text("My Allocation")', label: "allocations Holdings" },
  { path: "/allocations?tab=outcomes", anchor: 'h1:has-text("My Allocation")', label: "allocations Outcomes" },
  { path: "/allocations?tab=mandate", anchor: 'h1:has-text("My Allocation")', label: "allocations Mandate" },
  { path: "/allocations?tab=risk", anchor: 'h1:has-text("My Allocation")', label: "allocations Risk" },
  { path: "/allocations?tab=scenario", anchor: 'h1:has-text("My Allocation")', label: "allocations Scenario composer" },
  { path: "/strategies/new/wizard", anchor: "#wizard-connect-key-heading", label: "onboarding wizard API entry (manager-gated route, role=both)" },
  { path: "/strategies/new/wizard?source=csv", anchor: "#wizard-csv-upload-heading", label: "onboarding wizard CSV entry (manager-gated route, role=both)" },
  { path: "/security", anchor: "main h1", label: "security (authed)" },
  { path: "/compare", anchor: 'h1:has-text("Compare Strategies")', label: "compare (empty-selection)" },
];

test.describe("reflow sweep @ 2560px ultra-wide — authed", () => {
  test.skip(
    !HAS_SEED_ENV,
    "reflow-sweep-authed (2560): seed-helper env vars not wired " +
      "(set TEST_SUPABASE_URL / TEST_SUPABASE_SERVICE_ROLE_KEY) — " +
      "skipping prevents a false-green against an empty/404/login page (W-02). " +
      "The live ultra-wide reflow proof runs in CI once seed env is present.",
  );

  // One seeded role='both' user + login for the whole row (mirrors the 320px
  // sweep). role='both' owns the allocator surfaces AND the manager-gated
  // /strategies/new/wizard route (see the ULTRAWIDE_ROUTES note), so one user
  // sweeps both without redirect. The session cookie carries across goto.
  let allocator: Awaited<ReturnType<typeof seedTestAllocator>>;

  test.beforeAll(async () => {
    allocator = await seedTestAllocator({ role: "both" });
  });

  test.beforeEach(async ({ page }) => {
    await loginViaForm(page, allocator.email, allocator.password);
  });

  for (const r of ULTRAWIDE_ROUTES) {
    test(`${r.label} — no horizontal overflow at 2560px`, async ({ page }) => {
      await page.setViewportSize({ width: 2560, height: 1440 });
      const res = await page.goto(r.path);
      if (res) {
        const status = res.status();
        if (status >= 400) {
          throw new Error(
            `${r.path} returned HTTP ${status} — cannot run ultra-wide reflow sweep`,
          );
        }
      }
      await assertNoReflow(page, r.anchor);
    });
  }
});
