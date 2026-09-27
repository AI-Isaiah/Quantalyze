/**
 * Phase 170 T0 — seeded geometry proof for criterion 2.
 *
 * Written contract-first against 170-UI-SPEC.md. Rows that describe the
 * FIXED UI are RED at HEAD and turn GREEN only when their fix plan lands.
 * Do not weaken an assertion to make this file green today.
 *
 * FLOW-01 place 2: HAS_SEED_ENV + test.skip. Place 1 is the e2e-seeded
 * list entry in .github/workflows/ci.yml. A local run without the seed
 * env skips; it must never pass against a login page (W-02).
 *
 * Shared TEST: every seed uses this spec's own per-worker prefix and
 * cleanup deletes only that prefix. Never assert a global count.
 */
import { test, expect, type Page } from "@playwright/test";
import { assertNoReflow } from "./helpers/reflow";
import {
  assertChildrenInside,
  assertInsideViewport,
  assertNotCovered,
  assertScrollsInside,
  rectsIntersect,
  type Rect,
} from "./helpers/geometry";
import {
  cleanupStrategiesByNamePrefix,
  seedAllocatorBook,
  seedStrategyWithHistory,
  seedTestAllocator,
  seedWizardDraft,
} from "./helpers/seed-test-project";

const HAS_SEED_ENV =
  !!process.env.TEST_SUPABASE_URL &&
  !!process.env.TEST_SUPABASE_SERVICE_ROLE_KEY;

// Per worker, so one worker's afterAll cannot delete another's rows
// (my-strategies.spec.ts TEST_PARALLEL_INDEX precedent).
const NAME_PREFIX = `0 Layout Narrow Fixture ${process.env.TEST_PARALLEL_INDEX ?? 0}`;

// Founder decision 2026-09-27. Identical to the authed reflow sweep.
const VIEWPORTS: { id: string; width: number; height: number }[] = [
  { id: "V390", width: 390, height: 844 },
  { id: "V640", width: 640, height: 400 },
  { id: "V960", width: 960, height: 540 },
];

const FOOTER = '[role="region"][aria-label="Scenario draft summary and actions"]';
const COMMIT = '[data-testid="scenario-footer-commit"]';
const NAV = 'nav[aria-label="Primary mobile"]';
const ALLOC_ANCHOR = 'h1:has-text("My Allocation")';
const TABLIST = '[role="tablist"][aria-label="Allocation surfaces"]';
const TWEAKS_TOGGLE = "[data-tweaks-toggle]";
const TWEAKS_PANEL = '[role="dialog"][aria-label="Tweaks"]';
// ResponsiveTable prefixes its hint, so match the name, not the whole string.
const CONSTITUENT = { name: /^Strategies and weights/ };
// Tailwind md. Below it the bottom nav is in the layout; at and above it is not.
const MD_PX = 768;

async function boxOf(locator: import("@playwright/test").Locator, label: string): Promise<Rect> {
  const count = await locator.count();
  if (count === 0) {
    throw new Error(`${label}: locator resolved to 0 elements (W-02)`);
  }
  const box = await locator.first().boundingBox();
  if (!box) throw new Error(`${label}: element has no layout box`);
  return box;
}

async function loginViaForm(page: Page, email: string, password: string) {
  await page.goto("/login");
  await page.fill('input[name="email"], input[placeholder*="email" i]', email);
  await page.fill('input[type="password"]', password);
  await page.click('button:has-text("Sign in")');
  await page.waitForURL(/\/(discovery|strategies|allocations|dashboard)/, {
    timeout: 10_000,
  });
}

/**
 * Drive the composer into composed mode the way composer-axe does: unique
 * "0 …" fixture (sorts inside the 200-row browse cap), search by codename,
 * add by id, close the drawer, gate on the Portfolio heading.
 */
async function openComposedScenario(page: Page): Promise<void> {
  await cleanupStrategiesByNamePrefix(NAME_PREFIX);
  const fixtureName = `${NAME_PREFIX} ${Math.random().toString(36).slice(2, 8)}`;
  const fixtureId = await seedStrategyWithHistory({
    days: 400,
    name: fixtureName,
    codename: fixtureName,
    withDailyReturns: true,
  });
  const allocator = await seedTestAllocator();
  await loginViaForm(page, allocator.email, allocator.password);

  await page.goto("/allocations?tab=scenario");
  await page.waitForLoadState("networkidle");
  await expect(page.locator("h2", { hasText: "Start a portfolio" })).toBeVisible({
    timeout: 10_000,
  });

  await page.click('button:has-text("Browse strategies")');
  await expect(
    page.locator('[role="dialog"][aria-label="Browse strategies"]'),
  ).toBeVisible({ timeout: 5_000 });
  await page.fill('input[placeholder="Search by name or codename"]', fixtureName);
  const fixtureAdd = page.locator(`[data-testid="browse-add-${fixtureId}"]`);
  await expect(fixtureAdd).toBeVisible({ timeout: 10_000 });
  await fixtureAdd.click();
  await page.click('[aria-label="Close drawer"]');
  await page.waitForLoadState("networkidle");
  await expect(page.locator("h2", { hasText: "Portfolio" }).first()).toBeVisible({
    timeout: 10_000,
  });
}

test.describe("composed scenario — N-FOOT", () => {
  test.skip(
    !HAS_SEED_ENV,
    "layout-narrow: seed-helper env vars not wired " +
      "(set TEST_SUPABASE_URL / TEST_SUPABASE_SERVICE_ROLE_KEY) — " +
      "Skipping prevents false-green on empty/404/login pages (W-02). " +
      "The live geometry proof runs in CI e2e-seeded once seed env is present.",
  );

  test.afterAll(async () => {
    if (HAS_SEED_ENV) {
      await cleanupStrategiesByNamePrefix(NAME_PREFIX);
    }
  });

  // One composed session, every contracted viewport. The title names
  // each viewport id so --list proves the contracted widths (T0).
  for (const vp of VIEWPORTS) {
    test(`${vp.id}: footer children inside the footer, clear of the nav, Commit inside and uncovered`, async ({
      page,
    }) => {
      test.setTimeout(120_000);
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await openComposedScenario(page);
      await assertNoReflow(page, ALLOC_ANCHOR);

      const footer = page.locator(FOOTER);
      await expect(footer, `${vp.id}: scenario footer region missing`).toBeVisible();
      await assertChildrenInside(page, footer, `${vp.id} N-FOOT children`);

      if (vp.width < MD_PX) {
        const footerBox = await boxOf(footer, `${vp.id} footer`);
        const navBox = await boxOf(page.locator(NAV), `${vp.id} Primary mobile`);
        expect(
          footerBox.y + footerBox.height,
          `${vp.id}: footer bottom ${footerBox.y + footerBox.height} is below nav top ${navBox.y}`,
        ).toBeLessThanOrEqual(navBox.y + 1);
      }

      const commit = page.locator(COMMIT);
      await expect(commit).toBeVisible();
      const commitBox = await boxOf(commit, `${vp.id} Commit scenario`);
      expect(
        commitBox.height,
        `${vp.id}: Commit scenario height ${commitBox.height} is under 44px`,
      ).toBeGreaterThanOrEqual(44);
      await assertInsideViewport(page, commit, `${vp.id} Commit scenario`);
      await assertNotCovered(page, commit, `${vp.id} Commit scenario`);

      if (vp.id === "V640") {
        // Footer stuck over scrolled content: every footer text rect stays
        // inside the footer box (N-FOOT assertion 4).
        await page.locator("#main-content").evaluate((el) => {
          el.scrollTop = el.scrollHeight;
        });
        await assertChildrenInside(page, page.locator(FOOTER), "V640x400 N-FOOT text");
      }
    });
  }
});

test.describe("allocations tab strip — SC2-(a)", () => {
  test.skip(
    !HAS_SEED_ENV,
    "layout-narrow: seed-helper env vars not wired — skipping prevents false-green (W-02).",
  );

  for (const vp of VIEWPORTS.filter((v) => v.width < MD_PX)) {
    test(`${vp.id}: tablist scrolls inside itself and the last tab is fully visible after End`, async ({
      page,
    }) => {
      test.setTimeout(90_000);
      await page.setViewportSize({ width: vp.width, height: vp.height });
      const allocator = await seedTestAllocator();
      await loginViaForm(page, allocator.email, allocator.password);
      await page.goto("/allocations");
      await expect(page.locator(ALLOC_ANCHOR)).toBeVisible({ timeout: 15_000 });

      const tablist = page.locator(TABLIST);
      await expect(tablist, `${vp.id}: Allocation surfaces tablist missing`).toBeVisible();
      await assertScrollsInside(tablist, `${vp.id} allocations tablist`);
      await assertNoReflow(page, ALLOC_ANCHOR);

      const first = tablist.getByRole("tab").first();
      const last = tablist.getByRole("tab").last();
      await first.focus();
      await page.keyboard.press("End");
      await expect(last).toBeFocused();
      const strip = await boxOf(tablist, `${vp.id} tablist`);
      const lastBox = await boxOf(last, `${vp.id} last tab`);
      expect(
        lastBox.x >= strip.x - 1 && lastBox.x + lastBox.width <= strip.x + strip.width + 1,
        `${vp.id}: last tab ${lastBox.x}+${lastBox.width} is outside tablist ${strip.x}+${strip.width}`,
      ).toBe(true);
    });
  }

  test("V960: tablist shares the action row and does not scroll", async ({ page }) => {
    test.setTimeout(90_000);
    const wide = VIEWPORTS.find((v) => v.id === "V960")!;
    await page.setViewportSize({ width: wide.width, height: wide.height });
    const allocator = await seedTestAllocator();
    await loginViaForm(page, allocator.email, allocator.password);
    await page.goto("/allocations");
    await expect(page.locator(ALLOC_ANCHOR)).toBeVisible({ timeout: 15_000 });

    const tablist = page.locator(TABLIST);
    const exportBtn = page.getByRole("button", { name: "Export" });
    const tabBox = await boxOf(tablist, "V960 tablist");
    const exportBox = await boxOf(exportBtn, "V960 Export");
    expect(
      Math.abs(tabBox.y - exportBox.y),
      `V960: tablist top ${tabBox.y} is not on the Export row ${exportBox.y}`,
    ).toBeLessThanOrEqual(8);
    const sizes = await tablist.evaluate((el) => ({
      scrollWidth: el.scrollWidth,
      clientWidth: el.clientWidth,
    }));
    expect(
      sizes.scrollWidth <= sizes.clientWidth + 1,
      `V960: tablist still scrolls (scrollWidth=${sizes.scrollWidth} clientWidth=${sizes.clientWidth})`,
    ).toBe(true);
  });
});

test.describe("Tweaks — N-TWEAKS", () => {
  test.skip(
    !HAS_SEED_ENV,
    "layout-narrow: seed-helper env vars not wired — skipping prevents false-green (W-02).",
  );

  for (const vp of VIEWPORTS) {
    test(`${vp.id}: toggle intersects neither the nav nor the footer, and is not fixed`, async ({
      page,
    }) => {
      test.setTimeout(120_000);
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await openComposedScenario(page);

      const toggle = page.locator(TWEAKS_TOGGLE);
      await expect(toggle, `${vp.id}: Tweaks toggle missing`).toBeVisible();
      const toggleBox = await boxOf(toggle, `${vp.id} tweaks toggle`);
      const position = await toggle.evaluate((el) => getComputedStyle(el).position);
      expect(position, `${vp.id}: Tweaks toggle position is ${position}`).not.toBe("fixed");

      if (vp.width < MD_PX) {
        const navBox = await boxOf(page.locator(NAV), `${vp.id} Primary mobile`);
        expect(
          rectsIntersect(toggleBox, navBox),
          `${vp.id}: Tweaks toggle intersects Primary mobile`,
        ).toBe(false);
      }
      const footer = page.locator(FOOTER);
      if ((await footer.count()) > 0) {
        const footerBox = await footer.boundingBox();
        if (footerBox) {
          expect(
            rectsIntersect(toggleBox, footerBox),
            `${vp.id}: Tweaks toggle intersects the scenario footer`,
          ).toBe(false);
        }
      }

      if (vp.width < MD_PX) {
        await toggle.click();
        const panel = page.locator(TWEAKS_PANEL);
        await expect(panel, `${vp.id}: Tweaks panel did not open`).toBeVisible();
        const panelBox = await boxOf(panel, `${vp.id} Tweaks panel`);
        const navBox = await boxOf(page.locator(NAV), `${vp.id} Primary mobile`);
        expect(
          rectsIntersect(panelBox, navBox),
          `${vp.id}: Tweaks panel intersects Primary mobile`,
        ).toBe(false);
      }
    });
  }
});

test.describe("constituent rows — N-SCN", () => {
  test.skip(
    !HAS_SEED_ENV,
    "layout-narrow: seed-helper env vars not wired — skipping prevents false-green (W-02).",
  );

  for (const vp of VIEWPORTS.filter((v) => v.width < MD_PX)) {
    test(`${vp.id}: Strategies and weights scrolls inside itself and the page does not`, async ({
      page,
    }) => {
      test.setTimeout(120_000);
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await openComposedScenario(page);
      const region = page.getByRole("region", CONSTITUENT);
      await expect(
        region,
        `${vp.id}: Strategies and weights region missing`,
      ).toBeVisible({ timeout: 10_000 });
      await assertScrollsInside(region, `${vp.id} Strategies and weights`);
      await assertNoReflow(page, ALLOC_ANCHOR);
    });
  }

  // At V960 the natural row width may fit. Record it; do not assert it.
  test("V960: record whether Strategies and weights scrolls (not asserted)", async ({
    page,
  }) => {
    test.setTimeout(120_000);
    const wide = VIEWPORTS.find((v) => v.id === "V960")!;
    await page.setViewportSize({ width: wide.width, height: wide.height });
    await openComposedScenario(page);
    const region = page.getByRole("region", CONSTITUENT);
    if ((await region.count()) > 0) {
      const sizes = await region.evaluate((el) => ({
        scrollWidth: el.scrollWidth,
        clientWidth: el.clientWidth,
      }));
      console.log(
        `N-SCN V960 scrollWidth=${sizes.scrollWidth} clientWidth=${sizes.clientWidth} scrolls=${sizes.scrollWidth > sizes.clientWidth + 1}`,
      );
    } else {
      console.log("N-SCN V960: Strategies and weights region absent — not asserted");
    }
  });
});

test.describe("/profile — SC2-PROFILE", () => {
  test.skip(
    !HAS_SEED_ENV,
    "layout-narrow: seed-helper env vars not wired — skipping prevents false-green (W-02).",
  );

  for (const vp of VIEWPORTS.filter((v) => v.width < MD_PX)) {
    test(`${vp.id}: Disconnect is inside the viewport and the tab list scrolls`, async ({
      page,
    }) => {
      test.setTimeout(90_000);
      await page.setViewportSize({ width: vp.width, height: vp.height });
      const allocator = await seedTestAllocator();
      await seedAllocatorBook({ allocatorUserId: allocator.userId });
      await loginViaForm(page, allocator.email, allocator.password);

      await page.goto("/profile?tab=exchanges");
      const disconnect = page.getByRole("button", { name: /^Disconnect .+ key$/ }).first();
      await expect(disconnect, `${vp.id}: Disconnect key button missing`).toBeVisible({
        timeout: 15_000,
      });
      await assertNoReflow(page, '[role="tablist"]');
      const tablist = page.locator('[role="tablist"]').first();
      await assertScrollsInside(tablist, `${vp.id} profile tab list`);
      await assertInsideViewport(page, disconnect, `${vp.id} Disconnect`);
      await assertNotCovered(page, disconnect, `${vp.id} Disconnect`);

      // Every other profile tab still fits the page. Anchor on the tablist:
      // the h1 is shared with /strategies.
      for (const tab of ["personal", "mandate", "security", "organizations", "account"]) {
        await page.goto(tab === "personal" ? "/profile" : `/profile?tab=${tab}`);
        await expect(page.locator('[role="tablist"]').first()).toBeVisible({
          timeout: 15_000,
        });
        await assertNoReflow(page, '[role="tablist"]');
      }
    });
  }
});

const WRITE_CONTROLS = [
  "Recompute now",
  "Edit preferences",
  "Send intro",
  "KEEP",
  "SKIP",
] as const;

test.describe("/strategies — N-STRAT", () => {
  test.skip(
    !HAS_SEED_ENV,
    "layout-narrow: seed-helper env vars not wired — skipping prevents false-green (W-02).",
  );

  for (const vp of VIEWPORTS) {
    test(`${vp.id}: name and control group do not intersect, name is whole, tags are one line`, async ({
      page,
    }) => {
      test.setTimeout(90_000);
      await page.setViewportSize({ width: vp.width, height: vp.height });
      const manager = await seedTestAllocator({ role: "manager" });
      // Several words plus one hyphenated word. Synthetic; own prefix.
      // seedWizardDraft mints the row; the name is rewritten on THIS id only.
      const seededName = `${NAME_PREFIX} Long-Short Momentum Sleeve`;
      const draft = await seedWizardDraft({
        ownerUserId: manager.userId,
        namePrefix: NAME_PREFIX + " ",
      });
      const { createClient } = await import("@supabase/supabase-js");
      const admin = createClient(
        process.env.TEST_SUPABASE_URL!,
        process.env.TEST_SUPABASE_SERVICE_ROLE_KEY!,
        { auth: { autoRefreshToken: false, persistSession: false } },
      );
      // The page hides wizard drafts. Publishing THIS row is what makes the
      // card render; the tag is what the one-line chip assertion measures.
      const { error } = await admin
        .from("strategies")
        .update({
          name: seededName,
          strategy_types: ["spot", "trend following"],
          status: "published",
          source: "admin_import",
        })
        .eq("id", draft.strategyId);
      if (error) throw new Error(`N-STRAT row update failed: ${error.message}`);

      await loginViaForm(page, manager.email, manager.password);
      // Anchor by testid, not the h1: /my-strategies shares "My Strategies".
      await page.goto("/strategies");
      const row = page.locator('[data-testid="strategy-row"]').filter({ hasText: seededName });
      await expect(row, `${vp.id}: seeded strategy row missing`).toBeVisible({
        timeout: 15_000,
      });
      await assertNoReflow(page, '[data-testid="strategy-row"]');

      const nameLink = row.getByRole("link", { name: seededName, exact: true });
      await expect(nameLink).toHaveText(seededName);
      const controls = nameLink.locator("xpath=../following-sibling::div[1]");
      const nameBox = await boxOf(nameLink, `${vp.id} strategy name`);
      const controlBox = await boxOf(controls, `${vp.id} control group`);
      expect(
        rectsIntersect(nameBox, controlBox),
        `${vp.id}: name rect intersects the control group`,
      ).toBe(false);

      if (vp.id === "V390") {
        const chips = row.locator("span", { hasText: /^(spot|trend following)$/ });
        expect(await chips.count(), "expected a tag chip on the seeded row").toBeGreaterThan(0);
        const heights = await chips.evaluateAll((els) =>
          els.map((el) => (el as HTMLElement).getBoundingClientRect().height),
        );
        const line = Math.min(...heights);
        for (const h of heights) {
          expect(
            h,
            `${vp.id}: a tag chip is taller than one line (${h} > ${line})`,
          ).toBeLessThanOrEqual(line + 1);
        }
      } else {
        const nameBlock = nameLink.locator("xpath=..");
        const block = await boxOf(nameBlock, `${vp.id} name block`);
        expect(block.width, `${vp.id}: name block narrower than 160px`).toBeGreaterThanOrEqual(160);
      }
    });
  }
});

test.describe("/my-strategies — N-TABLE", () => {
  test.skip(
    !HAS_SEED_ENV,
    "layout-narrow: seed-helper env vars not wired — skipping prevents false-green (W-02).",
  );

  for (const vp of VIEWPORTS) {
    test(`${vp.id}: each Sort select is the hit target after the header passes the filter bar`, async ({
      page,
    }) => {
      test.setTimeout(120_000);
      await page.setViewportSize({ width: vp.width, height: vp.height });
      const owner = await seedTestAllocator({ role: "both" });
      // Enough owned rows that the table header can pass the filter bar.
      for (let i = 0; i < 12; i++) {
        await seedWizardDraft({
          ownerUserId: owner.userId,
          namePrefix: `${NAME_PREFIX} table-${i}-`,
        });
      }
      await loginViaForm(page, owner.email, owner.password);
      // Href, not the shared "My Strategies" h1 (DEF-149-B).
      await page.goto("/my-strategies");
      await expect(page.locator('a[href="/my-strategies"]').first()).toBeVisible({
        timeout: 15_000,
      });
      const table = page.locator("[data-strategy-table]");
      await expect(table, `${vp.id}: strategy table missing`).toBeVisible({ timeout: 15_000 });

      const header = table.locator("thead").first();
      const filter = page.locator(".sticky").filter({ has: page.getByLabel("Sort by") }).first();
      await page.locator("#main-content").evaluate((el) => {
        el.scrollTop = el.scrollHeight;
      });
      // Scroll until the sticky header has passed the filter bar, or the
      // scroller is exhausted. Either way the Sort selects are then checked.
      await page.locator("#main-content").evaluate((main) => {
        const headerEl = document.querySelector("[data-strategy-table] thead");
        const filterEl = document.querySelector('[aria-label="Sort by"]')?.closest(".sticky");
        if (!headerEl || !filterEl) return;
        const filterBottom = filterEl.getBoundingClientRect().bottom;
        for (let i = 0; i < 40; i++) {
          const top = headerEl.getBoundingClientRect().top;
          if (top <= filterBottom) return;
          main.scrollTop += 80;
        }
      });
      void header;
      void filter;

      for (const label of ["Sort by", "Sort direction"]) {
        const select = page.getByLabel(label);
        await expect(select, `${vp.id}: ${label} missing`).toBeVisible();
        await assertNotCovered(page, select, `${vp.id} ${label}`);
      }
    });
  }
});

test.describe("/admin/match — N-MATCH", () => {
  test.skip(
    !HAS_SEED_ENV,
    "layout-narrow: seed-helper env vars not wired — skipping prevents false-green (W-02).",
  );

  // No match-batch seed exists in this repo. The queue page for the seeded
  // allocator still renders the header action bar (Recompute now, Edit
  // preferences) from the profile card. Send intro / KEEP / SKIP render only
  // when a candidate is selected, which this seed cannot produce.
  test("V390: no write control is visible and the banner names 768px or wider", async ({
    page,
  }) => {
    test.setTimeout(90_000);
    await page.setViewportSize({ width: 390, height: 844 });
    const admin = await seedTestAllocator({ role: "both", isAdmin: true });
    const allocator = await seedTestAllocator({ role: "allocator" });
    await loginViaForm(page, admin.email, admin.password);
    await page.goto(`/admin/match/${allocator.userId}`);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible({ timeout: 15_000 });

    // Contract literal (N-MATCH). HEAD still says "1024px+", so this is RED
    // until plan 170-06. Asserting the old string would stay green forever.
    await expect(
      page.getByText(/768px or wider/),
    ).toBeVisible();
    for (const label of WRITE_CONTROLS) {
      await expect(
        page.getByRole("button", { name: label, exact: true }),
        `V390: ${label} is visible`,
      ).toHaveCount(0);
    }
  });

  test("V960: at least one write control is visible", async ({ page }) => {
    test.setTimeout(90_000);
    await page.setViewportSize({ width: 960, height: 540 });
    const admin = await seedTestAllocator({ role: "both", isAdmin: true });
    const allocator = await seedTestAllocator({ role: "allocator" });
    await loginViaForm(page, admin.email, admin.password);
    await page.goto(`/admin/match/${allocator.userId}`);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible({ timeout: 15_000 });

    let visible = 0;
    const rendered: string[] = [];
    for (const label of WRITE_CONTROLS) {
      const count = await page.getByRole("button", { name: label, exact: true }).count();
      if (count > 0) {
        visible += count;
        rendered.push(label);
      }
    }
    console.log(`N-MATCH V960 rendered write controls: ${rendered.join(", ") || "<none>"}`);
    expect(visible, "V960 positive control: no write control is visible").toBeGreaterThan(0);
  });
});

test.describe("/compare — N-CMP", () => {
  test.skip(
    !HAS_SEED_ENV,
    "layout-narrow: seed-helper env vars not wired — skipping prevents false-green (W-02).",
  );

  test("V390: empty compare has no checkboxes wording and keeps the heading", async ({
    page,
  }) => {
    test.setTimeout(90_000);
    await page.setViewportSize({ width: 390, height: 844 });
    const allocator = await seedTestAllocator();
    await loginViaForm(page, allocator.email, allocator.password);
    await page.goto("/compare");
    await expect(page.locator('h1:has-text("Compare Strategies")')).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByText(/checkboxes/i)).toHaveCount(0);
    await assertNoReflow(page, 'h1:has-text("Compare Strategies")');
  });

  test("V390: one id shows the one-strategy note", async ({ page }) => {
    test.setTimeout(90_000);
    await page.setViewportSize({ width: 390, height: 844 });
    const fixtureName = `${NAME_PREFIX} compare ${Math.random().toString(36).slice(2, 8)}`;
    const fixtureId = await seedStrategyWithHistory({
      days: 30,
      name: fixtureName,
      codename: fixtureName,
    });
    const allocator = await seedTestAllocator();
    await loginViaForm(page, allocator.email, allocator.password);
    await page.goto(`/compare?ids=${fixtureId}`);
    await expect(
      page.getByText(
        "One strategy selected. Adding a second strategy from this page is not available yet.",
      ),
    ).toBeVisible({ timeout: 15_000 });
    await assertNoReflow(page, "h1");
  });
});
