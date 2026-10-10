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
import { test, expect, type Page } from "./helpers/hydration-guard";
import { assertNoReflow } from "./helpers/reflow";
import {
  assertChildrenInside,
  assertInsideViewport,
  assertFitsOrScrollsInside,
  assertNotClippedByAncestors,
  assertNotCovered,
  assertPinnedStackDoesNotCover,
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
  setSeededStrategyNameAndTags,
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

  // GC-01 (2026-09-30): one contract at every width. The strip never widens
  // the page and never wraps; it scrolls inside itself only when its tabs do
  // not fit, and the last tab is reachable. At V960 it shares Export's row.
  // An unconditional "must scroll" failed V640 on a strip that fit (CI run
  // 36764778803, scrollWidth=264 clientWidth=264).
  for (const vp of VIEWPORTS) {
    test(`${vp.id}: tablist stays one line, scrolls only when it must, last tab reachable`, async ({
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
      const { scrolls } = await assertFitsOrScrollsInside(
        tablist,
        `${vp.id} allocations tablist`,
      );
      console.log(`SC2-(a) ${vp.id} allocations tablist scrolls=${scrolls}`);
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

      if (vp.id === "V960") {
        // One line beside Export: the strip's vertical centre lies inside the
        // Export button's vertical span.
        const exportBox = await boxOf(
          page.getByRole("button", { name: "Export" }),
          "V960 Export",
        );
        const centre = strip.y + strip.height / 2;
        expect(
          centre >= exportBox.y - 1 && centre <= exportBox.y + exportBox.height + 1,
          `V960: tablist centre y=${centre} is outside the Export row ${exportBox.y}..${exportBox.y + exportBox.height}`,
        ).toBe(true);
      }
    });
  }
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
    test(`${vp.id}: Disconnect is inside the viewport once scrolled to, and the tab list fits or scrolls on one line`, async ({
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
      // GC-01: the profile tab list fits or scrolls inside itself, never wraps.
      const { scrolls } = await assertFitsOrScrollsInside(
        tablist,
        `${vp.id} profile tab list`,
      );
      console.log(`SC2-PROFILE ${vp.id} profile tab list scrolls=${scrolls}`);
      // Gap 7: at 640x400 Disconnect sits below the fold (y=439), which is
      // reachable, not clipped, so scroll it into view first. Then three
      // separate measures: its own box lies inside the viewport; no
      // overflow-clipping ancestor (the key list wrapper is overflow-hidden,
      // SFH-170-02) cuts any part of it off; and its centre is not covered,
      // since a fixed bottom nav over the scrolled-to button is a real defect.
      await disconnect.scrollIntoViewIfNeeded();
      await assertInsideViewport(page, disconnect, `${vp.id} Disconnect`);
      await assertNotClippedByAncestors(disconnect, `${vp.id} Disconnect`);
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
      // The helper publishes THIS id only and sets the multi-word tag the
      // one-line chip assertion measures. It goes through getAdmin().
      await setSeededStrategyNameAndTags({
        strategyId: draft.strategyId,
        name: seededName,
        strategyTypes: ["spot", "trend following"],
      });

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

      // GC-02 (2026-09-30): the row stacks below md, so at V390 and V640 the
      // control group starts below the name block; from md up (V960) it is
      // one row, so the two boxes overlap vertically.
      const nameBlock = nameLink.locator("xpath=..");
      const block = await boxOf(nameBlock, `${vp.id} name block`);
      if (vp.width < MD_PX) {
        expect(
          controlBox.y,
          `${vp.id}: control group top ${controlBox.y} is not below the name block bottom ${block.y + block.height} (GC-02 stacked row)`,
        ).toBeGreaterThanOrEqual(block.y + block.height - 1);
      } else {
        expect(
          controlBox.y < block.y + block.height && controlBox.y + controlBox.height > block.y,
          `${vp.id}: control group ${controlBox.y}+${controlBox.height} does not share a row with the name block ${block.y}+${block.height} (GC-02 one row)`,
        ).toBe(true);
      }

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
        // GC-02: the 160 px name-block floor holds at V640 (stacked, full
        // width) and at V960 (one row).
        expect(block.width, `${vp.id}: name block narrower than 160px`).toBeGreaterThanOrEqual(160);
      }
    });
  }
});

// CR-01 (170 review): a DRAFT row's control group is the widest one (about
// 400 px on one line). With the 260 px sidebar the row at 768-840 px is
// narrower than that, and before the fix the name block got 0 px and the
// name painted over the controls. V960 above is the only md+ width the
// published case covers, so the draft row gets its own widths here.
const DRAFT_ROW_VIEWPORTS: { id: string; width: number; height: number }[] = [
  { id: "V768", width: 768, height: 1024 },
  { id: "V800", width: 800, height: 600 },
];

test.describe("/strategies — N-STRAT draft row (CR-01)", () => {
  test.skip(
    !HAS_SEED_ENV,
    "layout-narrow: seed-helper env vars not wired — skipping prevents false-green (W-02).",
  );

  test.afterAll(async () => {
    if (HAS_SEED_ENV) {
      await cleanupStrategiesByNamePrefix(NAME_PREFIX);
    }
  });

  for (const vp of DRAFT_ROW_VIEWPORTS) {
    test(`${vp.id}: draft row keeps a 160px name block clear of the control group, controls inside the group`, async ({
      page,
    }) => {
      test.setTimeout(90_000);
      await page.setViewportSize({ width: vp.width, height: vp.height });
      const manager = await seedTestAllocator({ role: "manager" });
      const seededName = `${NAME_PREFIX} Draft Long-Short Sleeve`;
      const draft = await seedWizardDraft({
        ownerUserId: manager.userId,
        namePrefix: NAME_PREFIX + " ",
      });
      // Off the wizard source so the list shows it, but still a draft.
      await setSeededStrategyNameAndTags({
        strategyId: draft.strategyId,
        name: seededName,
        strategyTypes: ["spot", "trend following"],
        status: "draft",
      });

      await loginViaForm(page, manager.email, manager.password);
      await page.goto("/strategies");
      const row = page.locator('[data-testid="strategy-row"]').filter({ hasText: seededName });
      await expect(row, `${vp.id}: seeded draft row missing`).toBeVisible({
        timeout: 15_000,
      });
      // The row must carry the draft controls, or a silently published row
      // would pass here on the narrower published control group.
      await expect(
        row.getByRole("button", { name: "Submit for Review" }),
        `${vp.id}: seeded row does not show the draft controls`,
      ).toBeVisible();
      await assertNoReflow(page, '[data-testid="strategy-row"]');

      const nameLink = row.getByRole("link", { name: seededName, exact: true });
      await expect(nameLink).toHaveText(seededName);
      const nameBlock = nameLink.locator("xpath=..");
      const controls = nameLink.locator("xpath=../following-sibling::div[1]");
      const block = await boxOf(nameBlock, `${vp.id} name block`);
      const nameBox = await boxOf(nameLink, `${vp.id} strategy name`);
      const controlBox = await boxOf(controls, `${vp.id} control group`);

      expect(block.width, `${vp.id}: name block narrower than 160px`).toBeGreaterThanOrEqual(160);
      expect(
        rectsIntersect(block, controlBox),
        `${vp.id}: name block intersects the control group`,
      ).toBe(false);
      // A 0 px block intersects nothing, so the block check alone is blind to
      // CR-01. The defect was the name painting PAST that block onto the
      // controls: check the name's own box, and that it stays in its block.
      expect(
        rectsIntersect(nameBox, controlBox),
        `${vp.id}: name rect intersects the control group`,
      ).toBe(false);
      await assertChildrenInside(page, nameBlock, `${vp.id} name block`);
      // A shrinkable group must wrap its items, never let one spill out.
      await assertChildrenInside(page, controls, `${vp.id} control group`);
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
      // Not the shared "My Strategies" h1 (DEF-149-B).
      await page.goto("/my-strategies");
      // Anchor on the table itself: the href anchor resolved to the hidden
      // desktop sidebar link below md (CI run 36764778803, gap 5).
      const table = page.locator("[data-strategy-table]");
      await expect(table, `${vp.id}: strategy table missing`).toBeVisible({ timeout: 15_000 });

      // WR-04 / SFH-170-01: probe each select only once a z-indexed sticky
      // table cell sits under its centre. That cell (the z-20/z-30 header
      // row, or the z-10 sticky name column) is what paints over the z-10
      // filter bar when the table root loses `isolate`. A select probed on
      // a resting page proves nothing, so an unreached state throws.
      for (const label of ["Sort by", "Sort direction"]) {
        const reached = await page.locator("#main-content").evaluate(
          (main, selectLabel) => {
            const tableEl = document.querySelector("[data-strategy-table]");
            const selectEl = document.querySelector(`[aria-label="${selectLabel}"]`);
            const filterEl = selectEl?.closest(".sticky") ?? null;
            if (!tableEl || !selectEl || !filterEl) {
              return `missing table=${!!tableEl} select=${!!selectEl} filter=${!!filterEl}`;
            }
            const stickyCellUnder = () => {
              const r = selectEl.getBoundingClientRect();
              return document
                .elementsFromPoint(r.left + r.width / 2, r.top + r.height / 2)
                .some((e) => {
                  if (!tableEl.contains(e)) return false;
                  const cs = getComputedStyle(e);
                  return cs.position === "sticky" && cs.zIndex !== "auto";
                });
            };
            // 8 px steps: the header row is ~40 px tall and an 80 px step
            // can jump straight over it.
            main.scrollTop = 0;
            for (;;) {
              if (stickyCellUnder()) return "reached";
              const before = main.scrollTop;
              main.scrollTop = before + 8;
              if (main.scrollTop <= before) break;
            }
            const r = selectEl.getBoundingClientRect();
            const thead = tableEl.querySelector("thead")?.getBoundingClientRect();
            return (
              `not-reached scrollTop=${main.scrollTop} max=${main.scrollHeight - main.clientHeight}` +
              ` filterBottom=${filterEl.getBoundingClientRect().bottom.toFixed(1)}` +
              ` selectCentreY=${(r.top + r.height / 2).toFixed(1)}` +
              ` theadTop=${thead ? thead.top.toFixed(1) : "<none>"}`
            );
          },
          label,
        );
        expect(
          reached,
          `${vp.id}: N-TABLE precondition not reached for ${label} — no z-indexed sticky table cell ever sat under its centre`,
        ).toBe("reached");
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

// Plan 170-11, item (j). The factsheet KPI strip follows a 2 / 3 / full
// container ladder, so at V390 and V640 no label is ellipsised and no value
// breaks inside a number. Both mounts are measured: the composer's
// FactsheetBody (the ~326 px mount) and the published factsheet route.
const KPI_LABEL = '[data-testid="factsheet-kpi-label"]';
const KPI_VALUE = '[data-testid="factsheet-kpi-value"]';

async function assertKpiTilesRead(page: Page, label: string): Promise<void> {
  await expect(
    page.locator(KPI_LABEL).first(),
    `${label}: factsheet KPI strip did not render`,
  ).toBeVisible({ timeout: 15_000 });
  const m = await page.evaluate(
    ({ labelSel, valueSel }) => {
      const shown = (sel: string) =>
        Array.from(document.querySelectorAll<HTMLElement>(sel)).filter(
          (el) => el.getClientRects().length > 0,
        );
      return {
        labels: shown(labelSel).map((el) => ({
          text: (el.textContent ?? "").trim(),
          scrollWidth: el.scrollWidth,
          clientWidth: el.clientWidth,
        })),
        values: shown(valueSel).map((el) => ({
          text: (el.textContent ?? "").trim(),
          height: el.getBoundingClientRect().height,
          lineHeight: parseFloat(getComputedStyle(el).lineHeight),
        })),
      };
    },
    { labelSel: KPI_LABEL, valueSel: KPI_VALUE },
  );
  // W-02: an unmounted strip must not pass on zero tiles.
  expect(m.labels.length, `${label}: no visible KPI label measured`).toBeGreaterThan(0);
  expect(m.values.length, `${label}: KPI value count differs from label count`).toBe(
    m.labels.length,
  );
  for (const l of m.labels) {
    expect(
      l.scrollWidth <= l.clientWidth,
      `${label}: KPI label "${l.text}" is ellipsised (scrollWidth=${l.scrollWidth} clientWidth=${l.clientWidth})`,
    ).toBe(true);
  }
  for (const v of m.values) {
    expect(
      Number.isFinite(v.lineHeight),
      `${label}: KPI value "${v.text}" has no numeric line-height`,
    ).toBe(true);
    expect(
      v.height <= v.lineHeight * 1.3,
      `${label}: KPI value "${v.text}" wraps (height ${v.height} > 1.3 x line-height ${v.lineHeight})`,
    ).toBe(true);
  }
}

test.describe("factsheet KPI — N-KPI", () => {
  test.skip(
    !HAS_SEED_ENV,
    "layout-narrow: seed-helper env vars not wired — skipping prevents false-green (W-02).",
  );

  test.afterAll(async () => {
    if (HAS_SEED_ENV) {
      await cleanupStrategiesByNamePrefix(NAME_PREFIX);
    }
  });

  for (const vp of VIEWPORTS.filter((v) => v.width < MD_PX)) {
    // Tile assertions first, reflow last: a red reflow then says nothing
    // about whether the KPI tiles themselves read cleanly.
    test(`${vp.id}: composed scenario KPI labels are whole and values stay on one line`, async ({
      page,
    }) => {
      test.setTimeout(120_000);
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await openComposedScenario(page);
      await assertKpiTilesRead(page, `${vp.id} composed scenario N-KPI`);
      await assertNoReflow(page, ALLOC_ANCHOR);
    });

    test(`${vp.id}: published factsheet KPI labels are whole and values stay on one line`, async ({
      page,
    }) => {
      test.setTimeout(90_000);
      await page.setViewportSize({ width: vp.width, height: vp.height });
      const fixtureName = `${NAME_PREFIX} kpi ${Math.random().toString(36).slice(2, 8)}`;
      const strategyId = await seedStrategyWithHistory({
        days: 400,
        name: fixtureName,
        codename: fixtureName,
        withDailyReturns: true,
      });
      const res = await page.goto(`/factsheet/${strategyId}/v2`);
      if (res && res.status() >= 400) {
        throw new Error(`/factsheet/<seeded>/v2 returned HTTP ${res.status()} (W-02)`);
      }
      await assertKpiTilesRead(page, `${vp.id} published factsheet N-KPI`);
      await assertNoReflow(page, "#factsheet-main");
    });
  }
});

// Phase 170.2 (PROBEFIXES) SC-1 — the Holdings tab stops scrolling sideways.
//
// WHY a LOCAL viewport array: V735 is the width the founder's probe measured
// (885 vs 735 on PROD), and the shared `VIEWPORTS` is pinned by many describes
// above, so it is never widened here.
//
// WHY the seed is wide and the case asserts so BEFORE measuring: CI missed this
// overflow because the seeded book has one narrow BTC row, so the tables fit and
// there was nothing to overflow (RESEARCH Pitfall 1). A seeded case that passes on
// a narrow seed proves nothing, so the table widths are a precondition.
//
// The contract (UI-SPEC "The scroller contract"): #main-content and the document
// do not overflow (assertNoReflow), and each wide table scrolls INSIDE its own
// ResponsiveTable region, whose right edge is inside the viewport.
const HOLDINGS_VIEWPORTS: { id: string; width: number; height: number }[] = [
  { id: "V390", width: 390, height: 844 },
  { id: "V640", width: 640, height: 400 },
  { id: "V735", width: 735, height: 450 },
];
const WIDE_TABLE_MIN_PX = 780;

test.describe("/allocations holdings — SC1-HOLDINGS", () => {
  test.skip(
    !HAS_SEED_ENV,
    "layout-narrow: seed-helper env vars not wired — skipping prevents false-green (W-02).",
  );

  for (const vp of HOLDINGS_VIEWPORTS) {
    test(`${vp.id}: a wide book does not scroll #main-content; each wide table scrolls inside its own region`, async ({
      page,
    }) => {
      test.setTimeout(120_000);
      await page.setViewportSize({ width: vp.width, height: vp.height });
      const allocator = await seedTestAllocator();
      await seedAllocatorBook({ allocatorUserId: allocator.userId, wide: true });
      await loginViaForm(page, allocator.email, allocator.password);

      await page.goto("/allocations?tab=holdings");
      await expect(page.locator(ALLOC_ANCHOR)).toBeVisible({ timeout: 15_000 });

      const holdings = page.getByRole("region", { name: /^Holdings:/ });
      const open = page.getByRole("region", { name: /^Open positions:/ });
      // UI-SPEC H-3: the Exposure drill-down is a named ResponsiveTable region too.
      const exposure = page.getByRole("region", { name: /^Exposure by venue and symbol:/ });
      await expect(exposure.first(), `${vp.id}: Exposure by venue and symbol region missing`).toBeVisible({
        timeout: 15_000,
      });
      await expect(holdings.first(), `${vp.id}: Holdings region missing`).toBeVisible({
        timeout: 15_000,
      });
      await expect(open.first(), `${vp.id}: Open positions region missing`).toBeVisible({
        timeout: 15_000,
      });

      // Precondition: the seed must make each table wider than a phone, else
      // this case could pass on a narrow seed (the HEAD blind spot).
      const widths: Record<string, number> = {};
      for (const [label, region] of [
        ["Holdings", holdings],
        ["Open positions", open],
        ["Exposure by venue and symbol", exposure],
      ] as const) {
        // The table's INTRINSIC width (min-content), not its laid-out width: a
        // `w-full` table is stretched to whatever track it gets, so the laid-out
        // width says nothing about whether the seed is wide.
        const w = await region
          .first()
          .locator("table")
          .first()
          .evaluate((el) => {
            const t = el as HTMLElement;
            const prev = t.style.width;
            t.style.width = "min-content";
            const intrinsic = t.getBoundingClientRect().width;
            t.style.width = prev;
            return intrinsic;
          });
        widths[label] = Math.round(w);
        expect(
          w,
          `${vp.id}: precondition: the ${label} table is ${Math.round(w)} px wide at min-content, under ${WIDE_TABLE_MIN_PX}; the seed is too narrow to prove anything (RESEARCH Pitfall 1)`,
        ).toBeGreaterThanOrEqual(WIDE_TABLE_MIN_PX);
      }
      console.log(
        `SC1-HOLDINGS ${vp.id} precondition table min-content widths: ${JSON.stringify(widths)}`,
      );

      // #main-content and the document do not overflow.
      await assertNoReflow(page, ALLOC_ANCHOR);

      // Each wide table scrolls inside its own region and its right edge is
      // inside the viewport (UI-SPEC scroller contract rules 2 and 3).
      const regions: [string, import("@playwright/test").Locator][] = [
        ["Holdings", holdings.first()],
        ["Open positions", open.first()],
        ["Exposure by venue and symbol", exposure.first()],
      ];
      // The Strategies region exists only for an allocator with onboarded
      // strategies; when it is present its right edge must be inside too.
      const strategies = page.getByRole("region", { name: /^Strategies:/ });
      if ((await strategies.count()) > 0) {
        regions.push(["Strategies", strategies.first()]);
      }
      // Every region on the tab has a unique accessible name (axe landmark-unique,
      // and the screen-reader landmark rotor): Strategies, Holdings, Open
      // positions and Exposure by venue and symbol must not read alike.
      const names = await page
        .locator('[data-tab-panel="holdings"] [role="region"]')
        .evaluateAll((els) => els.map((el) => el.getAttribute("aria-label") ?? ""));
      expect(
        names.length,
        `${vp.id}: expected at least the Holdings, Open positions and Exposure regions, got ${JSON.stringify(names)}`,
      ).toBeGreaterThanOrEqual(3);
      expect(
        new Set(names).size,
        `${vp.id}: region accessible names are not unique: ${JSON.stringify(names)}`,
      ).toBe(names.length);
      for (const [label, region] of regions) {
        const box = await boxOf(region, `${vp.id} ${label} region`);
        expect(
          box.x + box.width <= vp.width + 1,
          `${vp.id}: ${label} region right edge ${Math.round(box.x + box.width)} is outside the ${vp.width} px viewport`,
        ).toBe(true);
        if (label !== "Strategies") {
          await assertScrollsInside(region, `${vp.id} ${label} region`);
        }
      }
    });
  }
});

// Phase 170.2 (PROBEFIXES) SC-6, first half — the Discovery ranking table below
// its `@3xl` container step.
//
// WHY a LOCAL viewport array: V360 and V375 are not in the shared `VIEWPORTS`,
// which is pinned by many describes above and is never widened here.
//
// WHY each check collects instead of throwing at once: the HEAD RED run must name
// EVERY failing contract per viewport (page overflow offender, hint, filter row,
// pinned stack), and a first-failure throw would hide the rest. The case still
// fails if any check failed; the aggregate is the assertion.
//
// What the contract says (UI-SPEC D-1, D-4, D-5, D-6, scroller rules): no
// horizontal page scroll; the `Strategies` region scrolls inside itself with its
// right edge in the viewport; the `Scroll for more columns` hint is inside the
// viewport and the table frame on one line; below `@3xl` NOTHING is pinned, so the
// Strategy name moves left with the row and every Return %, CAGR and Sharpe cell
// can be scrolled into plain view (D-01, D-05).
const DISCOVERY_VIEWPORTS: { id: string; width: number; height: number }[] = [
  { id: "V360", width: 360, height: 780 },
  { id: "V375", width: 375, height: 667 },
  { id: "V390", width: 390, height: 844 },
  { id: "V768", width: 768, height: 1024 },
  { id: "V1080", width: 1080, height: 800 },
];
// Tailwind v4 `@3xl` container query step: 48rem = 768 px of CONTAINER width.
const AT_3XL_PX = 768;
const PAGE_PAD_PX = 16;

test.describe("/discovery — SC6-DISCOVERY unpinned", () => {
  test.skip(
    !HAS_SEED_ENV,
    "layout-narrow: seed-helper env vars not wired — skipping prevents false-green (W-02).",
  );

  for (const vp of DISCOVERY_VIEWPORTS) {
    test(`${vp.id}: no page scroll, the Strategies region scrolls inside, the hint fits, nothing is pinned`, async ({
      page,
    }) => {
      test.setTimeout(180_000);
      await page.setViewportSize({ width: vp.width, height: vp.height });
      const prefix = `${NAME_PREFIX} disc-${vp.id} `;
      const failures: string[] = [];
      const collect = async (label: string, fn: () => Promise<void>) => {
        try {
          await fn();
        } catch (e) {
          failures.push(`${label}: ${(e as Error).message.split("\n")[0]}`);
        }
      };

      // Hermetic: the seeded rows are published and sit in crypto-sma, the one
      // category discovery-hide-examples-default.spec.ts expects empty. Deleted
      // in the finally below (axe-app-wide.spec.ts precedent).
      try {
        const names = [
          "Alpha Momentum Trend Following Basket",
          "Beta Neutral Statistical Arbitrage Fund",
          "Gamma Volatility Carry Overlay Program",
        ];
        for (const [i, n] of names.entries()) {
          await seedStrategyWithHistory({
            days: 200,
            name: `${prefix}${n}`,
            categorySlug: "crypto-sma",
            strategyTypes: i === 0 ? ["spot", "perpetuals"] : ["spot"],
            supportedExchanges:
              i === 0 ? ["binance", "okx", "bybit"] : ["binance", "okx"],
          });
        }
        const allocator = await seedTestAllocator();
        await loginViaForm(page, allocator.email, allocator.password);
        await page.goto("/discovery/crypto-sma");
        const frame = page.locator("[data-strategy-table]");
        await expect(frame, `${vp.id}: strategy table missing`).toBeVisible({
          timeout: 15_000,
        });
        const region = page.getByRole("region", { name: /^Strategies:/ });
        await expect(region, `${vp.id}: Strategies region missing`).toBeVisible();
        // Precondition: the seed must put real rows in the table, else every
        // check below could pass on an empty table.
        const rowCount = await region.locator("tbody tr").count();
        expect(
          rowCount,
          `${vp.id}: precondition: expected the 3 seeded crypto-sma rows, got ${rowCount}`,
        ).toBeGreaterThanOrEqual(3);

        // 1. No horizontal page scroll (names the offender when there is one).
        await collect("page overflow", () =>
          assertNoReflow(page, "[data-strategy-table]"),
        );

        // 2. The region scrolls inside itself, right edge inside the viewport.
        const geo = await region.evaluate((el) => {
          const r = el.getBoundingClientRect();
          return {
            left: r.left,
            right: r.right,
            scrollWidth: el.scrollWidth,
            clientWidth: el.clientWidth,
          };
        });
        console.log(
          `SC6-DISCOVERY ${vp.id} region left=${geo.left.toFixed(1)} right=${geo.right.toFixed(1)} clientWidth=${geo.clientWidth} scrollWidth=${geo.scrollWidth} container-lt-3xl=${geo.clientWidth < AT_3XL_PX}`,
        );
        await collect("region scrolls inside", () =>
          assertScrollsInside(region, `${vp.id} Strategies region`),
        );
        if (geo.right > vp.width + 1) {
          failures.push(
            `region right edge ${geo.right.toFixed(1)} is outside the ${vp.width} px viewport`,
          );
        }

        // 3. The hint is inside the viewport and the frame, on one line.
        const hint = page.getByText("Scroll for more columns");
        await collect("hint", async () => {
          expect(
            await hint.count(),
            `${vp.id}: the Scroll for more columns hint is not shown although the region overflows`,
          ).toBeGreaterThan(0);
          const h = await hint.first().evaluate((el) => {
            const r = el.getBoundingClientRect();
            const cs = getComputedStyle(el);
            const f = el.closest("[data-strategy-table]")!.getBoundingClientRect();
            const lineHeight =
              cs.lineHeight === "normal"
                ? parseFloat(cs.fontSize) * 1.2
                : parseFloat(cs.lineHeight);
            return {
              left: r.left,
              right: r.right,
              height: r.height,
              lineHeight,
              frameLeft: f.left,
              frameRight: f.right,
            };
          });
          const problems: string[] = [];
          if (h.left < -1 || h.right > vp.width + 1)
            problems.push(
              `hint x ${h.left.toFixed(1)}..${h.right.toFixed(1)} outside the ${vp.width} px viewport`,
            );
          if (h.left < h.frameLeft - 1 || h.right > h.frameRight + 1)
            problems.push(
              `hint x ${h.left.toFixed(1)}..${h.right.toFixed(1)} outside the table frame ${h.frameLeft.toFixed(1)}..${h.frameRight.toFixed(1)}`,
            );
          if (h.height > h.lineHeight * 1.5)
            problems.push(
              `hint wraps (height ${h.height.toFixed(1)} vs line height ${h.lineHeight.toFixed(1)})`,
            );
          if (problems.length) throw new Error(problems.join("; "));
        });

        // 4. Filter row, Sort group and intro callout end inside the page padding
        //    (UI-SPEC D-4, D-5), at the phone widths only.
        if (vp.width <= 390) {
          await collect("filter row / callout inside the page padding", async () => {
            const over = await page.evaluate((limit) => {
              const out: string[] = [];
              const sort = document.querySelector('[aria-label="Sort by"]');
              const bar = sort?.closest(".sticky") ?? null;
              if (!bar) return ["filter bar not found"];
              for (const c of Array.from(bar.children)) {
                const r = c.getBoundingClientRect();
                if (r.width === 0 && r.height === 0) continue;
                if (r.right > limit + 1) {
                  const cls =
                    typeof (c as HTMLElement).className === "string"
                      ? String((c as HTMLElement).className)
                          .split(" ")
                          .filter(Boolean)
                          .slice(0, 2)
                          .join(".")
                      : "";
                  out.push(`${c.tagName}.${cls} right=${r.right.toFixed(1)}`);
                }
              }
              const callout = document.querySelector("#main-content .bg-accent\\/5");
              if (!callout) out.push("intro callout not found");
              else {
                const r = callout.getBoundingClientRect();
                if (r.right > limit + 1)
                  out.push(`intro callout right=${r.right.toFixed(1)}`);
              }
              return out;
            }, vp.width - PAGE_PAD_PX);
            if (over.length)
              throw new Error(
                `ends past ${vp.width - PAGE_PAD_PX}: ${over.join("; ")}`,
              );
          });
        }

        // 5. Unpinned below @3xl, and every metric cell reachable (D-01, D-05).
        await collect("unpinned + metrics reachable", async () => {
          const res = await page.evaluate((at3xl) => {
            const region = document.querySelector<HTMLElement>(
              '[role="region"][aria-label^="Strategies:"]',
            )!;
            const main = document.getElementById("main-content")!;
            const heads = Array.from(region.querySelectorAll<HTMLElement>("thead th"));
            const idx = (label: string) =>
              heads.findIndex((h) => (h.textContent ?? "").trim().startsWith(label));
            const strategyIdx = idx("Strategy");
            const metricCols = ["Return %", "CAGR", "Sharpe"].map((l) => ({
              label: l,
              i: idx(l),
            }));
            const rows = Array.from(
              region.querySelectorAll<HTMLElement>("tbody tr"),
            ).filter((r) => r.querySelector("td"));
            const cell = (r: HTMLElement, i: number) =>
              r.querySelectorAll<HTMLElement>(":scope > td")[i];
            const problems: string[] = [];
            if (strategyIdx < 0 || metricCols.some((m) => m.i < 0))
              return {
                problems: [
                  `header lookup failed strategy=${strategyIdx} metrics=${JSON.stringify(metricCols)}`,
                ],
                containerPx: region.clientWidth,
              };

            const containerPx = region.clientWidth;
            // Pinning is only contracted below the container step.
            const below = containerPx < at3xl;

            // (a) After scrolling to the maximum, the Strategy header and every
            //     Strategy body cell have moved left with the row.
            region.scrollLeft = 0;
            const strategyCells = [
              heads[strategyIdx],
              ...rows.map((r) => cell(r, strategyIdx)),
            ];
            const before = strategyCells.map((c) => c.getBoundingClientRect().left);
            region.scrollLeft = region.scrollWidth;
            const scrolled = region.scrollLeft;
            const after = strategyCells.map((c) => c.getBoundingClientRect().left);
            if (below) {
              strategyCells.forEach((_, k) => {
                const moved = before[k] - after[k];
                if (Math.abs(moved - scrolled) > 1)
                  problems.push(
                    `Strategy ${k === 0 ? "header" : `cell ${k}`} is pinned: moved ${moved.toFixed(1)} px of ${scrolled} px scrolled`,
                  );
              });
            }

            // (b) Every Return %, CAGR and Sharpe cell is fully inside the region
            //     and not covered at some scroll position.
            const maxLeft = region.scrollWidth - region.clientWidth;
            const stops = [0, 60, 150, 300, maxLeft];
            const reached = new Map<string, boolean>();
            for (const left of stops) {
              region.scrollLeft = left;
              const rr = region.getBoundingClientRect();
              for (const m of metricCols) {
                rows.forEach((row, ri) => {
                  const key = `${m.label} row ${ri + 1}`;
                  if (reached.get(key)) return;
                  const c = cell(row, m.i);
                  // Bring the cell's row to mid-viewport vertically so a
                  // sticky bar or the viewport fold cannot hide it.
                  const r0 = c.getBoundingClientRect();
                  main.scrollTop += r0.top + r0.height / 2 - window.innerHeight / 2;
                  const r = c.getBoundingClientRect();
                  const inside = r.left >= rr.left - 1 && r.right <= rr.right + 1;
                  if (!inside) return;
                  const t = document.elementFromPoint(
                    r.left + r.width / 2,
                    r.top + r.height / 2,
                  );
                  if (t && (t === c || c.contains(t))) reached.set(key, true);
                });
              }
            }
            for (const m of metricCols) {
              rows.forEach((_, ri) => {
                const key = `${m.label} row ${ri + 1}`;
                if (!reached.get(key))
                  problems.push(
                    `${key} is never fully visible and uncovered at scrollLeft ${stops.join("/")} (container ${containerPx} px)`,
                  );
              });
            }
            return { problems, containerPx };
          }, AT_3XL_PX);
          console.log(
            `SC6-DISCOVERY ${vp.id} unpinned check container=${res.containerPx} problems=${res.problems.length}`,
          );
          if (res.problems.length) throw new Error(res.problems.join("; "));
        });
      } finally {
        await cleanupStrategiesByNamePrefix(prefix);
      }

      for (const f of failures) {
        console.log(`SC6-DISCOVERY ${vp.id} FAILED ${f}`);
      }
      expect(
        failures,
        `${vp.id}: SC-6 Discovery contracts that failed`,
      ).toEqual([]);
    });
  }
});

// Phase 170.2 (PROBEFIXES) SC-6, second half — the Discovery ranking table at and
// above its `@3xl` container step, where the rank, star and Strategy columns pin.
//
// WHY LOCAL viewports again: V1100 and V1280 are not in the shared `VIEWPORTS`.
// V1100 is the narrowest pinned table (RESEARCH: a 774 px region), V1280 the
// ordinary desktop.
//
// What the contract says (UI-SPEC P-1..P-5, X-1, D-06): the pinned Strategy header
// is never painted over; no Return %, CAGR or Sharpe cell is covered by the pinned
// stack at any scroll position; rank right edge = star left edge, star right edge =
// Strategy left edge; each pinned body cell is as wide as its header cell and
// nothing paints past it; a whole metric column fits right of the pinned edge; and
// the desktop table is unchanged (P-5).
//
// P-5 compares IN THE PAGE, not against px literals. `playwright.config.ts` notes
// font hinting shifts between macOS dev runners and Linux CI runners, and the
// Strategy column is content-sized, so a px literal measured on a developer machine
// could be red on CI for no defect. The spec instead reverts the pinned rank and
// star cells' box CSS to the plan-07 values inline, re-measures, and fails when any
// edge or width moves by more than 1 px. The tolerance is 1 px and is never widened.
const PINNED_VIEWPORTS: { id: string; width: number; height: number }[] = [
  { id: "V1100", width: 1100, height: 800 },
  { id: "V1280", width: 1280, height: 800 },
];

// Hand-typed from the plan-07 class strings of the rank and star cells
// (`w-14 px-2` and `w-11 px-2`, no `min-w-*`): width 3.5rem / 2.75rem, min-width 0,
// horizontal padding 0.5rem. Applied inline to every pinned rank and star cell to
// rebuild the plan-07 layout inside the same page, then removed.
type PinnedBoxCss = { width: string; minWidth: string; paddingLeft: string; paddingRight: string };
const PLAN_07_PINNED_BOX_CSS: { rank: PinnedBoxCss; star: PinnedBoxCss } = {
  rank: { width: "3.5rem", minWidth: "0", paddingLeft: "0.5rem", paddingRight: "0.5rem" },
  star: { width: "2.75rem", minWidth: "0", paddingLeft: "0.5rem", paddingRight: "0.5rem" },
};

test.describe("/discovery — SC6-DISCOVERY pinned", () => {
  test.skip(
    !HAS_SEED_ENV,
    "layout-narrow: seed-helper env vars not wired — skipping prevents false-green (W-02).",
  );

  for (const vp of PINNED_VIEWPORTS) {
    test(`${vp.id}: the pinned stack covers no metric nor its own header, widths agree, the desktop table is unchanged`, async ({
      page,
    }) => {
      test.setTimeout(180_000);
      await page.setViewportSize({ width: vp.width, height: vp.height });
      const prefix = `${NAME_PREFIX} disc-pinned-${vp.id} `;
      const failures: string[] = [];
      const collect = async (label: string, fn: () => Promise<void>) => {
        try {
          await fn();
        } catch (e) {
          failures.push(`${label}: ${(e as Error).message.split("\n")[0]}`);
        }
      };

      // Hermetic, same as the unpinned describe: published crypto-sma rows, deleted
      // in the finally below.
      try {
        const names = [
          "Alpha Momentum Trend Following Basket",
          "Beta Neutral Statistical Arbitrage Fund",
          "Gamma Volatility Carry Overlay Program",
        ];
        for (const [i, n] of names.entries()) {
          await seedStrategyWithHistory({
            days: 200,
            name: `${prefix}${n}`,
            categorySlug: "crypto-sma",
            strategyTypes: i === 0 ? ["spot", "perpetuals"] : ["spot"],
            supportedExchanges:
              i === 0 ? ["binance", "okx", "bybit"] : ["binance", "okx"],
          });
        }
        // Signed in, so the star column shows (the corner stack is rank + star + name).
        const allocator = await seedTestAllocator();
        await loginViaForm(page, allocator.email, allocator.password);
        await page.goto("/discovery/crypto-sma");
        const frame = page.locator("[data-strategy-table]");
        await expect(frame, `${vp.id}: strategy table missing`).toBeVisible({
          timeout: 15_000,
        });
        const region = page.getByRole("region", { name: /^Strategies:/ });
        await expect(region, `${vp.id}: Strategies region missing`).toBeVisible();
        const rowCount = await region.locator("tbody tr").count();
        expect(
          rowCount,
          `${vp.id}: precondition: expected the 3 seeded crypto-sma rows, got ${rowCount}`,
        ).toBeGreaterThanOrEqual(3);

        // The table's column widths keep moving after first paint (measured: the
        // rank cell read 38.5 px and the region scrolled 1338 px wide early on,
        // then 31.0 px and 1184 px, on the same page; web fonts and the
        // sparklines settle late). Wait until every header edge and the region's
        // scrollWidth have held still for 500 ms, then two more frames so the
        // table's ResizeObserver has applied its offsets, before reading anything.
        await page.evaluate(async () => {
          await document.fonts.ready;
          const snap = () => {
            const reg = document.querySelector<HTMLElement>('[role="region"][aria-label^="Strategies:"]');
            if (!reg) return "<no region>";
            const heads = Array.from(reg.querySelectorAll<HTMLElement>("thead th"));
            return `${reg.scrollWidth}|${heads.map((h) => h.getBoundingClientRect().width.toFixed(2)).join(",")}`;
          };
          const frame = () => new Promise<void>((r) => requestAnimationFrame(() => r()));
          let last = snap();
          let stableSince = performance.now();
          const deadline = performance.now() + 10_000;
          while (performance.now() < deadline) {
            await frame();
            const now = snap();
            if (now !== last) {
              last = now;
              stableSince = performance.now();
            } else if (performance.now() - stableSince >= 500) {
              break;
            }
          }
          await frame();
          await frame();
        });

        // Precondition: pinning is active (the container is at or above @3xl) and
        // the star column shows. Without both, every contract below is vacuous.
        const pre = await region.evaluate((el, at3xl) => {
          const heads = Array.from(el.querySelectorAll<HTMLElement>("thead th"));
          return {
            clientWidth: el.clientWidth,
            scrollWidth: el.scrollWidth,
            star: (heads[1]?.textContent ?? "").trim().startsWith("Watchlist"),
            pinned: el.clientWidth >= at3xl,
          };
        }, AT_3XL_PX);
        console.log(
          `SC6-DISCOVERY pinned ${vp.id} region clientWidth=${pre.clientWidth} scrollWidth=${pre.scrollWidth} scrollable=${pre.scrollWidth - pre.clientWidth} star=${pre.star}`,
        );
        expect(pre.pinned, `${vp.id}: precondition: the table must be at or above @3xl (clientWidth ${pre.clientWidth})`).toBe(true);
        expect(pre.star, `${vp.id}: precondition: the star column must show (signed in)`).toBe(true);

        // 0. Absolute readings for the record (nothing from them is written into code).
        const readings = await region.evaluate((el) => {
          el.scrollLeft = 0;
          const rr = el.getBoundingClientRect();
          const heads = Array.from(el.querySelectorAll<HTMLElement>("thead th"));
          return heads.map((h) => {
            const r = h.getBoundingClientRect();
            return `${(h.textContent ?? "").trim().slice(0, 10) || "?"}:${(r.left - rr.left).toFixed(1)}..${(r.right - rr.left).toFixed(1)}(w${r.width.toFixed(1)})`;
          });
        });
        console.log(`SC6-DISCOVERY pinned ${vp.id} header edges (region-relative) ${readings.join(" | ")}`);

        // 1. X-1: at maximum scroll the point just inside the Strategy th's right
        //    edge hits the th itself or a descendant, never a later header cell.
        await collect("X-1 header not painted over", async () => {
          const res = await region.evaluate((el) => {
            const main = document.getElementById("main-content");
            const heads = Array.from(el.querySelectorAll<HTMLElement>("thead th"));
            const th = heads.find((h) => (h.textContent ?? "").trim().startsWith("Strategy"));
            if (!th) return { error: "Strategy header not found" };
            el.scrollLeft = el.scrollWidth;
            const r0 = th.getBoundingClientRect();
            if (main) main.scrollTop += r0.top + r0.height / 2 - window.innerHeight / 2;
            const r = th.getBoundingClientRect();
            const hit = document.elementFromPoint(r.right - 2, r.top + r.height / 2);
            const cls =
              hit && typeof (hit as HTMLElement).className === "string"
                ? String((hit as HTMLElement).className).split(" ").filter(Boolean).slice(0, 2).join(".")
                : "";
            return {
              scrolled: el.scrollLeft,
              ok: !!hit && (hit === th || th.contains(hit)),
              hit: hit ? `${hit.tagName}.${cls} "${(hit.textContent ?? "").trim().slice(0, 20)}"` : "<null>",
              thRight: r.right,
            };
          });
          if ("error" in res) throw new Error(String(res.error));
          console.log(`SC6-DISCOVERY pinned ${vp.id} X-1 scrolled=${res.scrolled} ok=${res.ok} hit=${res.hit}`);
          if (!res.ok) {
            throw new Error(
              `at scrollLeft ${res.scrolled} the point 2 px inside the Strategy header's right edge (${res.thRight.toFixed(1)}) is covered by ${res.hit}`,
            );
          }
        });

        // 2. SC-6 second half: the pinned stack covers no Return %, CAGR or Sharpe
        //    cell at scrollLeft 0/60/150/300/max.
        await collect("pinned stack covers no metric", async () => {
          const r = await assertPinnedStackDoesNotCover(
            page,
            region,
            `${vp.id} pinned stack`,
            { metrics: ["Return %", "CAGR", "Sharpe"] },
          );
          console.log(
            `SC6-DISCOVERY pinned ${vp.id} occlusion probes=${r.probes} stops=${r.stops.join("/")}`,
          );
        });

        // 3. P-1 (edge equalities), P-2 (per-row width and right edge), P-3 (no
        //    descendant past the pinned edge), P-4 (room for a metric), at
        //    scrollLeft 0 and at the maximum.
        await collect("P-1..P-4 pinned geometry", async () => {
          const res = await region.evaluate((el) => {
            const problems: string[] = [];
            const heads = Array.from(el.querySelectorAll<HTMLElement>("thead th"));
            const idx = (t: string) =>
              heads.findIndex((h) => (h.textContent ?? "").trim().startsWith(t));
            const rankI = 0;
            const starI = 1;
            const nameI = idx("Strategy");
            const metricI = ["Return %", "CAGR", "Sharpe"].map((l) => idx(l));
            const rows = Array.from(el.querySelectorAll<HTMLElement>("tbody tr")).filter(
              (r) => r.querySelector("td"),
            );
            const tds = (r: HTMLElement) => Array.from(r.querySelectorAll<HTMLElement>(":scope > td"));
            const stops: [string, number][] = [["0", 0], ["max", el.scrollWidth]];
            let room = 0;
            let widest = 0;
            for (const [tag, left] of stops) {
              el.scrollLeft = left;
              const rr = el.getBoundingClientRect();
              const R = (n: Element) => n.getBoundingClientRect();
              const rank = R(heads[rankI]);
              const star = R(heads[starI]);
              const name = R(heads[nameI]);
              // P-1
              if (Math.abs(rank.right - star.left) > 1)
                problems.push(`P-1 @${tag}: rank right ${rank.right.toFixed(1)} != star left ${star.left.toFixed(1)} (delta ${(rank.right - star.left).toFixed(1)})`);
              if (Math.abs(star.right - name.left) > 1)
                problems.push(`P-1 @${tag}: star right ${star.right.toFixed(1)} != Strategy left ${name.left.toFixed(1)} (delta ${(star.right - name.left).toFixed(1)})`);
              // P-1b: at rest the pinned stack ends where Return % begins, so the
              // Strategy cell never covers the first pixels of the first metric.
              if (tag === "0") {
                const first = R(heads[metricI[0]]);
                if (name.right > first.left + 1)
                  problems.push(`P-1b @0: the Strategy header's right edge ${name.right.toFixed(1)} covers the first ${(name.right - first.left).toFixed(1)} px of Return % (left ${first.left.toFixed(1)})`);
              }
              // P-2 and P-3 on every row
              rows.forEach((row, ri) => {
                const cells = tds(row);
                ([[rankI, "rank"], [starI, "star"], [nameI, "Strategy"]] as [number, string][]).forEach(([i, n]) => {
                  const th = R(heads[i]);
                  const td = R(cells[i]);
                  if (Math.abs(td.width - th.width) > 1)
                    problems.push(`P-2 @${tag}: ${n} row ${ri + 1} td width ${td.width.toFixed(1)} != th width ${th.width.toFixed(1)}`);
                  if (Math.abs(td.right - th.right) > 1)
                    problems.push(`P-2 @${tag}: ${n} row ${ri + 1} td right ${td.right.toFixed(1)} != th right ${th.right.toFixed(1)}`);
                });
                const nameTd = cells[nameI];
                const nameRect = R(nameTd);
                const walker = document.createTreeWalker(nameTd, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT);
                let node: Node | null = walker.nextNode();
                while (node) {
                  let right = -Infinity;
                  let what = "";
                  if (node.nodeType === Node.ELEMENT_NODE) {
                    const b = (node as Element).getBoundingClientRect();
                    if (b.width > 0 || b.height > 0) {
                      right = b.right;
                      what = (node as Element).tagName;
                    }
                  } else if ((node.textContent ?? "").trim()) {
                    const range = document.createRange();
                    range.selectNodeContents(node);
                    right = range.getBoundingClientRect().right;
                    what = "TEXT";
                  }
                  if (right > nameRect.right + 1)
                    problems.push(`P-3 @${tag}: row ${ri + 1} ${what} paints to ${right.toFixed(1)}, past the pinned edge ${nameRect.right.toFixed(1)}`);
                  node = walker.nextNode();
                }
              });
              // P-4 (measured once, at scroll 0, where the stack and the metrics are laid out naturally)
              if (tag === "0") {
                const edge = name.right - (rr.left + el.clientLeft);
                room = el.clientWidth - edge;
                for (const i of metricI) {
                  widest = Math.max(widest, R(heads[i]).width);
                  rows.forEach((row) => { widest = Math.max(widest, R(tds(row)[i]).width); });
                }
              }
            }
            if (room < widest)
              problems.push(`P-4: room right of the pinned edge ${room.toFixed(1)} < the widest metric cell ${widest.toFixed(1)}`);
            el.scrollLeft = 0;
            return { problems, room, widest };
          });
          console.log(`SC6-DISCOVERY pinned ${vp.id} P-4 room=${res.room.toFixed(1)} widest-metric=${res.widest.toFixed(1)} problems=${res.problems.length}`);
          if (res.problems.length) throw new Error(res.problems.join("; "));
        });

        // 4. P-5 (D-06): the desktop table is unchanged. Measure every header cell,
        //    rebuild the plan-07 box CSS of the pinned rank and star cells inline,
        //    re-measure, remove the inline CSS. Non-pinned cells: left and right
        //    edge; pinned cells: width. 1 px, never widened.
        await collect("P-5 desktop unchanged", async () => {
          const res = await region.evaluate((el, css) => {
            el.scrollLeft = 0;
            const heads = Array.from(el.querySelectorAll<HTMLElement>("thead th"));
            const nameI = heads.findIndex((h) => (h.textContent ?? "").trim().startsWith("Strategy"));
            const pinnedIdx = new Set([0, 1, nameI]);
            const measure = () =>
              heads.map((h) => {
                const r = h.getBoundingClientRect();
                return { left: r.left, right: r.right, width: r.width };
              });
            const before = measure();
            const rows = Array.from(el.querySelectorAll<HTMLElement>("tbody tr")).filter(
              (r) => r.querySelector("td"),
            );
            const targets: [HTMLElement, PinnedBoxCss][] = [
              [heads[0], css.rank],
              [heads[1], css.star],
              ...rows.flatMap((row) => {
                const c = Array.from(row.querySelectorAll<HTMLElement>(":scope > td"));
                return [[c[0], css.rank], [c[1], css.star]] as [HTMLElement, PinnedBoxCss][];
              }),
            ];
            const saved = targets.map(([t]) => t.getAttribute("style"));
            for (const [t, c] of targets) {
              t.style.width = c.width;
              t.style.minWidth = c.minWidth;
              t.style.paddingLeft = c.paddingLeft;
              t.style.paddingRight = c.paddingRight;
            }
            void (el as HTMLElement).offsetWidth;
            const after = measure();
            targets.forEach(([t], k) => {
              if (saved[k] === null) t.removeAttribute("style");
              else t.setAttribute("style", saved[k] as string);
            });
            let maxDelta = 0;
            const problems: string[] = [];
            heads.forEach((h, i) => {
              const label = (h.textContent ?? "").trim().slice(0, 12) || `#${i}`;
              const deltas = pinnedIdx.has(i)
                ? [["width", Math.abs(before[i].width - after[i].width)]]
                : [
                    ["left", Math.abs(before[i].left - after[i].left)],
                    ["right", Math.abs(before[i].right - after[i].right)],
                  ];
              for (const [what, d] of deltas as [string, number][]) {
                maxDelta = Math.max(maxDelta, d);
                if (d > 1)
                  problems.push(`${label} ${what} differs from the plan-07 box CSS by ${d.toFixed(2)} px`);
              }
            });
            return { problems, maxDelta, headers: heads.length };
          }, PLAN_07_PINNED_BOX_CSS);
          console.log(
            `SC6-DISCOVERY pinned ${vp.id} P-5 max delta=${res.maxDelta.toFixed(3)} px over ${res.headers} headers problems=${res.problems.length}`,
          );
          if (res.problems.length) throw new Error(res.problems.join("; "));
        });
      } finally {
        await cleanupStrategiesByNamePrefix(prefix);
      }

      for (const f of failures) {
        console.log(`SC6-DISCOVERY pinned ${vp.id} FAILED ${f}`);
      }
      expect(
        failures,
        `${vp.id}: SC-6 pinned-stack contracts that failed`,
      ).toEqual([]);
    });
  }
});
