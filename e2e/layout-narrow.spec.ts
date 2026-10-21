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
import fs from "node:fs";
import { test, expect, type Locator, type Page } from "./helpers/hydration-guard";
import { assertNoReflow } from "./helpers/reflow";
import {
  assertChildrenInside,
  assertEmittersMeasured,
  assertInsideViewport,
  assertSvgTextInsideSvg,
  readSvgTextLayout,
  type RequiredEmitter,
  type SvgTextEmitterDef,
  type SvgTextLayout,
  assertFitsOrScrollsInside,
  assertNotClippedByAncestors,
  assertColumnPinnedBelow3xl,
  assertNotCovered,
  assertPinnedCellsMatchHeaders,
  assertPinnedHeaderNotPaintedOver,
  assertPinnedStackDoesNotCover,
  assertScrollsInside,
  rectsIntersect,
  settleStrategyTableLayout,
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
const ALLOC_ANCHOR = 'h1:has-text("My allocation")';
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

// 2026-10-09 Phase 170.7: /strategies is the shared StrategyTable now; the card geometry these measured (CR-01 name over controls, GC-02 stacking, WR-02 overlong names) is replaced by "/strategies — MYSTRATTABLE phones" and "/strategies — MYSTRATTABLE wide"
//
// Phase 170.7 (MYSTRATTABLE) plan 07 — the manager's My Strategies page on a
// phone. The page mounts the shared StrategyTable in manager mode, so the
// guarantees are Discovery's (no page scroll, the `Strategies` region scrolls
// inside itself, nothing pinned below the container step) plus the three that
// are this page's own: every name opens its factsheet (D-02), a strategy with
// no analytics says `—` (D-03), and a strategy's note row stays in view under
// it at any scroll position (D-06).
//
// WHY LOCAL viewports: V360 and V375 are not in the shared `VIEWPORTS`, which is
// pinned by many describes and is never widened here.
const MYSTR_PHONE_VIEWPORTS: { id: string; width: number; height: number }[] = [
  { id: "V360", width: 360, height: 780 },
  { id: "V375", width: 375, height: 667 },
  { id: "V390", width: 390, height: 844 },
];
// UI-SPEC note-indent relation, below `@3xl`: the note's first line starts at the
// region's left edge + 16 px (`pl-4`). Tailwind v4 `@3xl` = 768 px of CONTAINER.
const MYSTR_NOTE_INDENT_PX = 16;
const MYSTR_AT_3XL_PX = 768;

/**
 * Mint one manager-owned fixture row of a given status and rename it. The row
 * is a wizard-draft shell (its API key is a placeholder ciphertext) moved off
 * the wizard source so the page lists it. Scoped by id, through getAdmin().
 */
async function seedManagerStrategy(opts: {
  ownerUserId: string;
  prefix: string;
  name: string;
  status: "draft" | "private" | "pending_review";
  reviewNote?: string;
}): Promise<string> {
  const draft = await seedWizardDraft({
    ownerUserId: opts.ownerUserId,
    namePrefix: opts.prefix,
  });
  await setSeededStrategyNameAndTags({
    strategyId: draft.strategyId,
    name: opts.name,
    strategyTypes: ["spot", "trend following"],
    status: opts.status,
    ...(opts.reviewNote !== undefined ? { reviewNote: opts.reviewNote } : {}),
  });
  return draft.strategyId;
}

/**
 * The manager and the four rows both MYSTRATTABLE describes seed: a published
 * row WITH computed analytics (so a `—` check is not passing on an all-empty
 * table), a private row and a pending_review row with none, and a draft carrying
 * review feedback under a long hyphenated multi-word name. One definition, so
 * the phones and wide describes cannot drift apart. Teardown is the caller's
 * `finally` (`cleanupStrategiesByNamePrefix(prefix)`).
 */
async function seedMystrManagerRows(prefix: string) {
  const manager = await seedTestAllocator({ role: "manager" });
  const publishedName = `${prefix}Published Momentum Basket`;
  const publishedId = await seedStrategyWithHistory({
    days: 200,
    name: publishedName,
    ownerUserId: manager.userId,
  });
  const privateName = `${prefix}Private Carry Sleeve`;
  const privateId = await seedManagerStrategy({
    ownerUserId: manager.userId,
    prefix,
    name: privateName,
    status: "private",
  });
  const pendingName = `${prefix}Pending Review Basis Trade`;
  const pendingId = await seedManagerStrategy({
    ownerUserId: manager.userId,
    prefix,
    name: pendingName,
    status: "pending_review",
  });
  const draftName = `${prefix}Long-Short-Momentum-Mean-Reversion-Statistical-Arbitrage Sleeve`;
  const draftId = await seedManagerStrategy({
    ownerUserId: manager.userId,
    prefix,
    name: draftName,
    status: "draft",
    reviewNote:
      "The track record covers fewer than ninety days; add a longer history and resubmit for review.",
  });
  const seeded = [
    { id: publishedId, name: publishedName, label: "published" },
    { id: privateId, name: privateName, label: "private" },
    { id: pendingId, name: pendingName, label: "pending_review" },
    { id: draftId, name: draftName, label: "draft" },
  ];
  return { manager, seeded, publishedId, privateId, pendingId, draftId };
}

/**
 * Where the draft's note block and first line sit at one scroll stop, with the
 * Strategy name text in the row above for the `@3xl` relation. `firstLeft` is the
 * left edge of the block's first element (the review-feedback block's own box);
 * `textLeft` the left edge of its first text node (a Range), which the amber
 * block pads inward by its own `px-2` (`firstPadLeft`).
 */
async function readMystrNote(region: Locator, id: string, stop: "0" | "max") {
  return region.evaluate(
    (el, args) => {
      el.scrollLeft = args.stop === "max" ? el.scrollWidth : 0;
      const rr = el.getBoundingClientRect();
      const link = el.querySelector<HTMLElement>(`a[href="/factsheet/${args.id}"]`);
      const row = link?.closest("tr");
      const footer = row?.nextElementSibling?.querySelector<HTMLElement>(
        '[data-testid="strategy-row-footer"]',
      );
      if (!link || !footer) return null;
      const firstTextLeft = (root: Element): number | null => {
        const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
        for (let n = walker.nextNode(); n; n = walker.nextNode()) {
          if ((n.textContent ?? "").trim()) {
            const range = document.createRange();
            range.selectNodeContents(n);
            return range.getBoundingClientRect().left;
          }
        }
        return null;
      };
      const fr = footer.getBoundingClientRect();
      const first = footer.firstElementChild;
      return {
        regionLeft: rr.left,
        regionRight: rr.right,
        blockLeft: fr.left,
        blockRight: fr.right,
        firstLeft: first ? first.getBoundingClientRect().left : null,
        firstPadLeft: first ? parseFloat(getComputedStyle(first).paddingLeft) : null,
        textLeft: firstTextLeft(footer),
        nameTextLeft: firstTextLeft(link),
        scrolled: el.scrollLeft,
      };
    },
    { id, stop },
  );
}

/** The data row (never the note row) whose Strategy cell links to `/factsheet/<id>`. */
function mystrRow(page: Page, id: string) {
  return page
    .getByRole("region", { name: /^Strategies:/ })
    .locator("tbody tr")
    .filter({ has: page.locator(`a[href="/factsheet/${id}"]`) });
}

test.describe("/strategies — MYSTRATTABLE phones", () => {
  test.skip(
    !HAS_SEED_ENV,
    "layout-narrow: seed-helper env vars not wired — skipping prevents false-green (W-02).",
  );

  for (const vp of MYSTR_PHONE_VIEWPORTS) {
    test(`${vp.id}: no page scroll, the table scrolls inside, the Strategy name is pinned, names open factsheets, empty metrics read —, the note stays in view`, async ({
      page,
    }) => {
      test.setTimeout(180_000);
      await page.setViewportSize({ width: vp.width, height: vp.height });
      const prefix = `${NAME_PREFIX} myst-${vp.id} `;
      const failures: string[] = [];
      const collect = async (label: string, fn: () => Promise<void>) => {
        try {
          await fn();
        } catch (e) {
          failures.push(`${label}: ${(e as Error).message.split("\n")[0]}`);
        }
      };

      try {
        const { manager, seeded, publishedId, privateId, pendingId, draftId } =
          await seedMystrManagerRows(prefix);

        await loginViaForm(page, manager.email, manager.password);
        await page.goto("/strategies");
        const frame = page.locator("[data-strategy-table]");
        await expect(frame, `${vp.id}: strategy table missing`).toBeVisible({
          timeout: 15_000,
        });
        const region = page.getByRole("region", { name: /^Strategies:/ });
        await expect(region, `${vp.id}: Strategies region missing`).toBeVisible();
        // Precondition: all four seeded rows are in the table, else every check
        // below could pass on a table that never showed them.
        for (const s of seeded) {
          await expect(
            mystrRow(page, s.id),
            `${vp.id}: precondition: the ${s.label} row is missing`,
          ).toHaveCount(1);
        }

        // 1. No horizontal page scroll (names the offender when there is one).
        await collect("page overflow", () =>
          assertNoReflow(page, "[data-strategy-table]"),
        );

        // 2. The region scrolls inside itself, right edge inside the viewport.
        await collect("region scrolls inside", () =>
          assertScrollsInside(region, `${vp.id} Strategies region`),
        );
        const right = await region.evaluate((el) => el.getBoundingClientRect().right);
        if (right > vp.width + 1) {
          failures.push(
            `region right edge ${right.toFixed(1)} is outside the ${vp.width} px viewport`,
          );
        }

        // 3. Pinned below @3xl (170.6.1 D-09, which reverses 170.7 D-04 here):
        //    at the maximum scroll the Strategy header and every Strategy body
        //    cell still sit at the region's left edge and are not covered, so
        //    every row stays identifiable. The relation is exported from
        //    geometry.ts (D-07); the guards make it fail, not pass, on a
        //    container at or above the step or a region that barely scrolled.
        await collect("pinned", async () => {
          const res = await assertColumnPinnedBelow3xl(
            region,
            `${vp.id} Strategy column`,
            { at3xl: MYSTR_AT_3XL_PX, requireBelow3xl: true, minScrolled: 40 },
          );
          console.log(
            `MYSTRATTABLE ${vp.id} pinned container=${res.container} name-col=${res.pinnedWidth.toFixed(1)} scrolled=${res.scrolled} cells=${res.cells}`,
          );
        });

        // 4. Every name opens its factsheet, whatever the status (D-02).
        for (const s of seeded) {
          await collect(`name link (${s.label})`, async () => {
            const link = region.locator(`a[href="/factsheet/${s.id}"]`);
            await expect(link).toHaveCount(1);
            await expect(link).toHaveAttribute("href", `/factsheet/${s.id}`);
            expect(
              ((await link.textContent()) ?? "").replace(/\s+/g, " ").trim(),
              `the ${s.label} name link text`,
            ).toBe(s.name);
          });
        }

        // 5. A strategy with no analytics says `—` in Return %, CAGR, Sharpe and
        //    Max DD (D-03); the published row WITH analytics shows figures there,
        //    so the dash check is not passing on an all-empty table.
        await collect("metric cells", async () => {
          const read = await region.evaluate(
            (el, ids) => {
              const heads = Array.from(el.querySelectorAll<HTMLElement>("thead th"));
              const idx = (label: string) =>
                heads.findIndex((h) => (h.textContent ?? "").trim().startsWith(label));
              const cols = ["Return %", "CAGR", "Sharpe", "Max DD"].map((label) => ({
                label,
                i: idx(label),
              }));
              const out: Record<string, Record<string, string>> = {};
              for (const [key, id] of Object.entries(ids)) {
                const row = el
                  .querySelector(`a[href="/factsheet/${id}"]`)
                  ?.closest("tr");
                const tds = row ? row.querySelectorAll<HTMLElement>(":scope > td") : [];
                out[key] = {};
                for (const c of cols) {
                  out[key][c.label] =
                    c.i < 0 || !tds[c.i] ? "<missing>" : (tds[c.i].textContent ?? "").trim();
                }
              }
              return out;
            },
            { published: publishedId, private: privateId, pending: pendingId },
          );
          const problems: string[] = [];
          for (const key of ["private", "pending"] as const) {
            for (const [label, text] of Object.entries(read[key])) {
              if (text !== "—") problems.push(`${key} row ${label} reads "${text}", not —`);
            }
          }
          for (const [label, text] of Object.entries(read.published)) {
            if (!/\d/.test(text))
              problems.push(`published row ${label} reads "${text}", expected a figure`);
          }
          if (problems.length) throw new Error(problems.join("; "));
        });

        // 6. The draft's note row (D-06): `Review feedback:`, in view at any
        //    scroll position, its first line at the region's left edge + 16 px.
        const noteRow = mystrRow(page, draftId).locator("xpath=following-sibling::tr[1]");
        await collect("note row exists", async () => {
          await expect(noteRow).toHaveAttribute("data-testid", "strategy-row-note");
          await expect(noteRow).toContainText("Review feedback:");
        });
        for (const stop of ["0", "max"] as const) {
          await collect(`note in view at scrollLeft ${stop}`, async () => {
            const g = await readMystrNote(region, draftId, stop);
            if (!g) throw new Error("the note block [data-testid=strategy-row-footer] was not found");
            console.log(
              `MYSTRATTABLE ${vp.id} note scrollLeft=${g.scrolled} region=${g.regionLeft.toFixed(1)}..${g.regionRight.toFixed(1)} block=${g.blockLeft.toFixed(1)}..${g.blockRight.toFixed(1)} first=${g.firstLeft?.toFixed(1)} text=${g.textLeft?.toFixed(1)}`,
            );
            const problems: string[] = [];
            if (stop === "max" && g.scrolled < 40)
              problems.push(`region only scrolled ${g.scrolled} px; the check would be vacuous`);
            if (Math.abs(g.blockLeft - g.regionLeft) > 1)
              problems.push(
                `block left ${g.blockLeft.toFixed(1)} is not the region's left ${g.regionLeft.toFixed(1)}`,
              );
            if (g.blockRight > g.regionRight + 1)
              problems.push(
                `block right ${g.blockRight.toFixed(1)} is past the region's right ${g.regionRight.toFixed(1)}`,
              );
            if (g.firstLeft === null) problems.push("the note block has no first element");
            else if (Math.abs(g.firstLeft - (g.regionLeft + MYSTR_NOTE_INDENT_PX)) > 1)
              problems.push(
                `first line left ${g.firstLeft.toFixed(1)} is not region left + ${MYSTR_NOTE_INDENT_PX} (${(g.regionLeft + MYSTR_NOTE_INDENT_PX).toFixed(1)})`,
              );
            if (problems.length) throw new Error(problems.join("; "));
          });
        }
      } finally {
        await cleanupStrategiesByNamePrefix(prefix);
      }

      for (const f of failures) {
        console.log(`MYSTRATTABLE ${vp.id} FAILED ${f}`);
      }
      expect(failures, `${vp.id}: MYSTRATTABLE phone contracts that failed`).toEqual([]);
    });
  }
});

// Phase 170.7 (D-01) — the private-link modal moved from a card into a `td`
// inside the table's scroll region. The behaviour is unchanged and the focus
// return is founder UAT #4: after Close, Escape and a revoke the keyboard focus
// is back on THAT row's private-link button. `Modal` keeps its native <dialog>
// mounted and calls `dialog.close()`; the browser restores focus. Unmounting an
// open dialog would drop focus to the body.
const MYSTR_FOCUS_VIEWPORTS: { id: string; width: number; height: number }[] = [
  { id: "V1280", width: 1280, height: 800 },
  { id: "V390", width: 390, height: 844 },
];

test.describe("/strategies — MYSTRATTABLE focus return", () => {
  test.skip(
    !HAS_SEED_ENV,
    "layout-narrow: seed-helper env vars not wired — skipping prevents false-green (W-02).",
  );
  // The mint copies the link; a denied clipboard would still mint, but grant it
  // so the row reads the success path.
  test.use({ permissions: ["clipboard-read", "clipboard-write"] });

  for (const vp of MYSTR_FOCUS_VIEWPORTS) {
    test(`${vp.id}: Close, Escape and revoke each return focus to the row's private-link button`, async ({
      page,
    }) => {
      test.setTimeout(180_000);
      await page.setViewportSize({ width: vp.width, height: vp.height });
      const prefix = `${NAME_PREFIX} myst-focus-${vp.id} `;
      try {
        const manager = await seedTestAllocator({ role: "manager" });
        const name = `${prefix}Private Link Sleeve`;
        const id = await seedManagerStrategy({
          ownerUserId: manager.userId,
          prefix,
          name,
          status: "private",
        });

        await loginViaForm(page, manager.email, manager.password);
        await page.goto("/strategies");
        await expect(
          page.locator("[data-strategy-table]"),
          `${vp.id}: strategy table missing`,
        ).toBeVisible({ timeout: 15_000 });

        const row = mystrRow(page, id);
        await expect(row, `${vp.id}: the seeded private row is missing`).toHaveCount(1);
        // The Actions cell is the row's last cell; the button is located inside it.
        const button = row.locator("td").last().getByRole("button", { name: /private link/ });
        const dialog = page.locator("dialog[open]");

        // The mint: "Get private link" -> (copy feedback) -> "Manage private link".
        await expect(button).toHaveAccessibleName("Get private link");
        await button.scrollIntoViewIfNeeded();
        await button.click();
        await expect(
          row.locator("td").last().getByRole("button", { name: "Manage private link" }),
          `${vp.id}: the mint did not flip the row to Manage private link`,
        ).toBeVisible({ timeout: 20_000 });

        // (a) the dialog's Close button.
        await button.click();
        await expect(dialog, `${vp.id}: (a) the dialog did not open`).toHaveCount(1);
        await dialog.getByRole("button", { name: "Close", exact: true }).click();
        await expect(dialog, `${vp.id}: (a) the dialog did not close`).toHaveCount(0);
        expect(await button.evaluate((el) => el === document.activeElement), `${vp.id}: (a) focus is not on the row's private-link button after Close`).toBe(true);

        // (b) Escape.
        await button.click();
        await expect(dialog, `${vp.id}: (b) the dialog did not reopen`).toHaveCount(1);
        await page.keyboard.press("Escape");
        await expect(dialog, `${vp.id}: (b) Escape did not close the dialog`).toHaveCount(0);
        expect(await button.evaluate((el) => el === document.activeElement), `${vp.id}: (b) focus is not on the row's private-link button after Escape`).toBe(true);

        // (c) revoke: the panel loads lazily, then Revoke link -> Revoke.
        await button.click();
        await expect(dialog, `${vp.id}: (c) the dialog did not reopen`).toHaveCount(1);
        await dialog.getByRole("button", { name: "Revoke link" }).click({ timeout: 20_000 });
        await dialog.getByRole("button", { name: "Revoke", exact: true }).click();
        await expect(dialog, `${vp.id}: (c) the revoke did not close the dialog`).toHaveCount(0);
        await expect(
          row.locator("td").last().getByRole("button", { name: "Get private link" }),
          `${vp.id}: (c) the row did not flip back to Get private link`,
        ).toBeVisible();
        expect(await button.evaluate((el) => el === document.activeElement), `${vp.id}: (c) focus is not on the row's private-link button after the revoke`).toBe(true);
      } finally {
        // strategy_shares cascades from strategies.
        await cleanupStrategiesByNamePrefix(prefix);
      }
    });
  }
});

// Phase 170.7 (MYSTRATTABLE) plan 08 — the manager's My Strategies table on a
// desktop, either side of 170.2's `@3xl` container step, with the three columns
// the manager adds (Status, Created, Actions) present.
//
// WHY: the extra columns widen the table, so the room and occlusion relations
// 170.2 proves on Discovery can behave differently here, and the note indent
// reads the runtime-measured pin offset. D-07: every pin relation below is a
// CALL to a helper exported from e2e/helpers/geometry.ts, the same functions the
// `/discovery — SC6-DISCOVERY` describes call; nothing of 170.2's is re-typed.
//
// V1080 is the table just under the step (a 754 px region, nothing pinned),
// V1100 the narrowest pinned table (774 px), V1280 the ordinary desktop. They
// are local, like Discovery's: the shared `VIEWPORTS` is never widened.
//
// The pinned stack on this page is the rank column and the Strategy column: the
// manager page passes no `userId`, so there is no star column.
const MYSTR_WIDE_VIEWPORTS: { id: string; width: number; height: number; pinned: boolean }[] = [
  { id: "V1080", width: 1080, height: 800, pinned: false },
  { id: "V1100", width: 1100, height: 800, pinned: true },
  { id: "V1280", width: 1280, height: 800, pinned: true },
];

test.describe("/strategies — MYSTRATTABLE wide", () => {
  test.skip(
    !HAS_SEED_ENV,
    "layout-narrow: seed-helper env vars not wired — skipping prevents false-green (W-02).",
  );

  for (const vp of MYSTR_WIDE_VIEWPORTS) {
    test(`${vp.id}: ${vp.pinned ? "the pinned Strategy column covers no metric nor its own header, widths agree" : "the Strategy name is pinned"}, each note lines up with its strategy`, async ({
      page,
    }) => {
      test.setTimeout(180_000);
      await page.setViewportSize({ width: vp.width, height: vp.height });
      const prefix = `${NAME_PREFIX} myst-wide-${vp.id} `;
      const failures: string[] = [];
      const collect = async (label: string, fn: () => Promise<void>) => {
        try {
          await fn();
        } catch (e) {
          failures.push(`${label}: ${(e as Error).message.split("\n")[0]}`);
        }
      };

      try {
        const { manager, seeded, draftId } = await seedMystrManagerRows(prefix);
        await loginViaForm(page, manager.email, manager.password);
        await page.goto("/strategies");
        await expect(
          page.locator("[data-strategy-table]"),
          `${vp.id}: strategy table missing`,
        ).toBeVisible({ timeout: 15_000 });
        const region = page.getByRole("region", { name: /^Strategies:/ });
        await expect(region, `${vp.id}: Strategies region missing`).toBeVisible();
        // Precondition: all four seeded rows are in the table, else every check
        // below could pass on a table that never showed them.
        for (const s of seeded) {
          await expect(
            mystrRow(page, s.id),
            `${vp.id}: precondition: the ${s.label} row is missing`,
          ).toHaveCount(1);
        }

        // Column widths keep moving after first paint; wait for them to hold still.
        await settleStrategyTableLayout(page);

        // Precondition: the three manager columns are there, the stack is rank +
        // Strategy (no star column), and the container is on the side of the
        // `@3xl` step this case expects. Without these every relation below is
        // vacuous or measures the wrong thing.
        const pre = await region.evaluate((el) => {
          const heads = Array.from(el.querySelectorAll<HTMLElement>("thead th")).map((h) =>
            (h.textContent ?? "").trim(),
          );
          return { clientWidth: el.clientWidth, scrollWidth: el.scrollWidth, heads };
        });
        console.log(
          `MYSTRATTABLE wide ${vp.id} region clientWidth=${pre.clientWidth} scrollWidth=${pre.scrollWidth} scrollable=${pre.scrollWidth - pre.clientWidth} headers=${pre.heads.map((h) => h.slice(0, 10) || "?").join("|")}`,
        );
        for (const label of ["Status", "Created", "Actions", "Return %", "CAGR", "Sharpe"]) {
          expect(
            pre.heads.some((h) => h.startsWith(label)),
            `${vp.id}: precondition: the ${label} column is missing (headers: ${pre.heads.join(" | ")})`,
          ).toBe(true);
        }
        expect(
          pre.heads[1].startsWith("Strategy"),
          `${vp.id}: precondition: the pinned stack is rank + Strategy; header 2 is "${pre.heads[1]}"`,
        ).toBe(true);
        expect(
          pre.clientWidth >= MYSTR_AT_3XL_PX,
          `${vp.id}: precondition: the container is ${pre.clientWidth} px, expected ${vp.pinned ? "at or above" : "below"} the ${MYSTR_AT_3XL_PX} px step`,
        ).toBe(vp.pinned);

        // The Strategy column, either side of the step.
        if (!vp.pinned) {
          // 170.6.1 D-09 (reverses 170.7 D-04), D-07: pinned at the region's left
          // edge, so the Strategy header and every Strategy cell stay in view
          // while the rest scrolls. Fails on a container at or above the step or
          // a region that barely scrolled.
          await collect("pinned", async () => {
            const r = await assertColumnPinnedBelow3xl(region, `${vp.id} Strategy column`, {
              at3xl: MYSTR_AT_3XL_PX,
              requireBelow3xl: true,
              minScrolled: 40,
            });
            console.log(
              `MYSTRATTABLE wide ${vp.id} pinned container=${r.container} scrolled=${r.scrolled} cells=${r.cells}`,
            );
          });
        } else {
          // X-1: the Status and Created headers (and every other later header)
          // never paint over the pinned Strategy header, at the maximum scroll and
          // at the scroll where each of them is passing under its right edge.
          await collect("X-1 header not painted over", async () => {
            const r = await assertPinnedHeaderNotPaintedOver(region, `MYSTRATTABLE wide ${vp.id}`, {
              underEveryLaterHeader: true,
            });
            console.log(`MYSTRATTABLE wide ${vp.id} X-1 probes=${r.probes}`);
          });
          // P-2 and P-3: every pinned body cell is as wide as its header and ends
          // where it ends, and nothing in the Strategy cell paints past it, at
          // scrollLeft 0 and at the maximum.
          await collect("P-2/P-3 pinned cells match their headers", async () => {
            const r = await assertPinnedCellsMatchHeaders(region, `MYSTRATTABLE wide ${vp.id}`, {
              pinned: [
                { header: 0, name: "rank" },
                { header: "Strategy", name: "Strategy" },
              ],
            });
            console.log(`MYSTRATTABLE wide ${vp.id} P-2/P-3 rows=${r.rows} stops=${r.stops.join("/")}`);
          });
          // SC-6 second half: the pinned stack covers no Return %, CAGR or Sharpe
          // cell at any scroll position.
          await collect("pinned stack covers no metric", async () => {
            const r = await assertPinnedStackDoesNotCover(
              page,
              region,
              `${vp.id} pinned stack`,
              { metrics: ["Return %", "CAGR", "Sharpe"] },
            );
            console.log(
              `MYSTRATTABLE wide ${vp.id} occlusion probes=${r.probes} stops=${r.stops.join("/")}`,
            );
          });
        }

        // D-06: each note lines up with its strategy. At V1080 (below the step) the
        // note's first line starts at the region's left edge + 16 px. Where the
        // table pins, it starts at the Strategy name text's left edge, whatever
        // the scroll position. Always: the note block lies inside the region.
        //
        // "First line" is the note block's first element, the review-feedback
        // block's own box; its text is inset by that block's own `px-2` (UI-SPEC
        // D-08 markup), which is asserted equal to the measured Range offset, so
        // the glyph is never off by anything but the block's declared padding.
        const noteRow = mystrRow(page, draftId).locator("xpath=following-sibling::tr[1]");
        await collect("note row exists", async () => {
          await expect(noteRow).toHaveAttribute("data-testid", "strategy-row-note");
          await expect(noteRow).toContainText("Review feedback:");
        });
        for (const stop of ["0", "max"] as const) {
          await collect(`note alignment at scrollLeft ${stop}`, async () => {
            const g = await readMystrNote(region, draftId, stop);
            if (!g) throw new Error("the note block [data-testid=strategy-row-footer] was not found");
            console.log(
              `MYSTRATTABLE wide ${vp.id} note scrollLeft=${g.scrolled} region=${g.regionLeft.toFixed(1)}..${g.regionRight.toFixed(1)} block=${g.blockLeft.toFixed(1)}..${g.blockRight.toFixed(1)} first=${g.firstLeft?.toFixed(1)} text=${g.textLeft?.toFixed(1)} name=${g.nameTextLeft?.toFixed(1)} pad=${g.firstPadLeft}`,
            );
            const problems: string[] = [];
            if (stop === "max" && g.scrolled < 40)
              problems.push(`region only scrolled ${g.scrolled} px; the check would be vacuous`);
            if (Math.abs(g.blockLeft - g.regionLeft) > 1)
              problems.push(
                `block left ${g.blockLeft.toFixed(1)} is not the region's left ${g.regionLeft.toFixed(1)}`,
              );
            if (g.blockRight > g.regionRight + 1)
              problems.push(
                `block right ${g.blockRight.toFixed(1)} is past the region's right ${g.regionRight.toFixed(1)}`,
              );
            if (g.firstLeft === null || g.textLeft === null || g.firstPadLeft === null) {
              problems.push("the note block has no first element or no text");
            } else {
              if (Math.abs(g.textLeft - (g.firstLeft + g.firstPadLeft)) > 1)
                problems.push(
                  `the first text starts at ${g.textLeft.toFixed(1)}, not the first block's left ${g.firstLeft.toFixed(1)} + its own padding ${g.firstPadLeft}`,
                );
              if (vp.pinned) {
                if (g.nameTextLeft === null) problems.push("the Strategy name text was not found");
                else if (Math.abs(g.firstLeft - g.nameTextLeft) > 1)
                  problems.push(
                    `first line left ${g.firstLeft.toFixed(1)} is not the Strategy name text's left ${g.nameTextLeft.toFixed(1)} (delta ${(g.firstLeft - g.nameTextLeft).toFixed(1)})`,
                  );
              } else if (Math.abs(g.firstLeft - (g.regionLeft + MYSTR_NOTE_INDENT_PX)) > 1) {
                problems.push(
                  `first line left ${g.firstLeft.toFixed(1)} is not region left + ${MYSTR_NOTE_INDENT_PX} (${(g.regionLeft + MYSTR_NOTE_INDENT_PX).toFixed(1)})`,
                );
              }
            }
            if (problems.length) throw new Error(problems.join("; "));
          });
        }
      } finally {
        await cleanupStrategiesByNamePrefix(prefix);
      }

      for (const f of failures) {
        console.log(`MYSTRATTABLE wide ${vp.id} FAILED ${f}`);
      }
      expect(failures, `${vp.id}: MYSTRATTABLE wide contracts that failed`).toEqual([]);
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
    await expect(page.locator('h1:has-text("Compare strategies")')).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByText(/checkboxes/i)).toHaveCount(0);
    await assertNoReflow(page, 'h1:has-text("Compare strategies")');
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
// viewport and the table frame on one line; below `@3xl` the rank and star scroll
// away but the Strategy name is PINNED (170.6.1 D-09, which reverses 170.2 D-05 for
// that one column), and every Return %, CAGR and Sharpe cell can still be scrolled
// into plain view (D-01).
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
    test(`${vp.id}: no page scroll, the Strategies region scrolls inside, the hint fits, the Strategy name is pinned`, async ({
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

        // 5a. Pinned below @3xl (170.6.1 D-09, which supersedes D-03 and reverses
        //     170.2 D-05 for this one column): after scrolling to the end the
        //     Strategy header and every Strategy body cell are still at the
        //     region's left edge and not covered, so every row stays identifiable
        //     at the scroll end where Simulate Impact is. The relation is
        //     assertColumnPinnedBelow3xl in geometry.ts, shared with the manager's
        //     /strategies describes. Every viewport of this block is below the
        //     step, so a container that is not is a failure, not a silent pass.
        await collect("Strategy name pinned (D-09)", async () => {
          const r = await assertColumnPinnedBelow3xl(region, `${vp.id} Strategy column`, {
            at3xl: AT_3XL_PX,
            requireBelow3xl: true,
            minScrolled: 40,
          });
          console.log(
            `SC6-DISCOVERY ${vp.id} pinned container=${r.container} name-col=${r.pinnedWidth.toFixed(1)} scrolled=${r.scrolled} cells=${r.cells}`,
          );
        });

        // 5b. Every metric cell reachable (D-01, D-05).
        await collect("metrics reachable", async () => {
          const res = await page.evaluate(() => {
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

            // Every Return %, CAGR and Sharpe cell is fully inside the region
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
          });
          console.log(
            `SC6-DISCOVERY ${vp.id} unpinned check container=${res.containerPx} problems=${res.problems.length}`,
          );
          if (res.problems.length) throw new Error(res.problems.join("; "));
        });

        // 6. Phase 170.6.1 SC-1 (D-01, D-02) — on a phone EVERY column is in the
        //    scrolling region (no `More` disclosure) and the right-edge cue shows
        //    only while there is more to scroll, so Simulate Impact is clear at
        //    the scroll end. 170.6.1 review WR-02 / D-09: the cue logic is identical
        //    at every width and the old collapse was keyed to the container, so
        //    laptop widths below @3xl show every column too. These checks run at
        //    EVERY viewport in this block, not only on phones.
        await collect("every column rendered, no disclosure (D-01)", async () => {
          const res = await region.evaluate((el) => {
            const heads = Array.from(el.querySelectorAll<HTMLElement>("thead th"));
            return {
              labels: heads.map((h) => (h.textContent ?? "").trim()),
              zeroWidth: heads
                .filter((h) => h.getBoundingClientRect().width <= 0)
                .map((h) => (h.textContent ?? "").trim() || "(unlabelled)"),
              details: el.querySelectorAll("details").length,
            };
          });
          console.log(
            `SC6-DISCOVERY ${vp.id} columns=${res.labels.length} zero-width=[${res.zeroWidth.join("|")}] details=${res.details}`,
          );
          const problems: string[] = [];
          if (res.zeroWidth.length)
            problems.push(
              `header(s) with no rendered width: ${res.zeroWidth.join(", ")}`,
            );
          if (res.details > 0)
            problems.push(`${res.details} <details> disclosure(s) in the table`);
          if (problems.length) throw new Error(problems.join("; "));
        });

        // D-02: the hint is present at scroll start ...
        await collect("hint present at scroll start (D-02)", async () => {
          await region.evaluate((el) => {
            el.scrollLeft = 0;
          });
          await expect
            .poll(() => page.getByText("Scroll for more columns").count(), {
              message: `${vp.id}: hint missing at scrollLeft 0 although the region overflows`,
              timeout: 5_000,
            })
            .toBeGreaterThan(0);
        });

        // ... and absent at the scroll end, where Simulate Impact must be
        // inside the region, the element at its own centre, and not under the
        // fade. The fade is located STRUCTURALLY (the aria-hidden ancestor div
        // of the hint text), so this can fail on markup that predates any
        // test id.
        await collect("hint absent at the scroll end (D-02)", async () => {
          await region.evaluate((el) => {
            el.scrollLeft = el.scrollWidth;
          });
          await expect
            .poll(() => page.getByText("Scroll for more columns").count(), {
              message: `${vp.id}: hint still shown at the scroll end`,
              timeout: 5_000,
            })
            .toBe(0);
        });
        // Separate collect: a lingering hint must not hide the geometry check.
        await collect("scroll end: Simulate Impact clear (D-02)", async () => {
          await region.evaluate((el) => {
            el.scrollLeft = el.scrollWidth;
          });
          const btn = region
            .getByRole("button", { name: /^Simulate impact of adding/ })
            .first();
          const res = await btn.evaluate((b) => {
            // Bring the row to mid-viewport vertically first (as 5b does), so
            // the sticky filter bar or the fold cannot be what covers it: this
            // check is about the horizontal fade, not vertical position.
            const main = document.getElementById("main-content")!;
            const r0 = b.getBoundingClientRect();
            main.scrollTop += r0.top + r0.height / 2 - window.innerHeight / 2;
            const region = b.closest<HTMLElement>(
              '[role="region"][aria-label^="Strategies:"]',
            )!;
            const rr = region.getBoundingClientRect();
            const r = b.getBoundingClientRect();
            const top = document.elementFromPoint(
              r.left + r.width / 2,
              r.top + r.height / 2,
            );
            // The fade: the closest aria-hidden div around the hint text.
            let fade: HTMLElement | null = null;
            const walker = document.createTreeWalker(
              document.body,
              NodeFilter.SHOW_TEXT,
            );
            for (let n = walker.nextNode(); n; n = walker.nextNode()) {
              if ((n.textContent ?? "").includes("Scroll for more columns")) {
                fade = n.parentElement!.closest<HTMLElement>(
                  'div[aria-hidden="true"]',
                );
                break;
              }
            }
            let fadeHit = false;
            if (fade) {
              const f = fade.getBoundingClientRect();
              fadeHit =
                r.left < f.right &&
                r.right > f.left &&
                r.top < f.bottom &&
                r.bottom > f.top;
            }
            return {
              inside: r.left >= rr.left - 1 && r.right <= rr.right + 1,
              btnRight: r.right,
              regionRight: rr.right,
              atCentre: !!top && (top === b || b.contains(top)),
              topIs: top
                ? `${top.tagName.toLowerCase()}.${String((top as HTMLElement).className).split(" ").slice(0, 3).join(".")}`
                : "null",
              fadePresent: !!fade,
              fadeHit,
            };
          });
          console.log(
            `SC6-DISCOVERY ${vp.id} scroll-end simulate inside=${res.inside} btnRight=${res.btnRight.toFixed(1)} regionRight=${res.regionRight.toFixed(1)} atCentre=${res.atCentre} fade=${res.fadePresent} fadeHit=${res.fadeHit}`,
          );
          const problems: string[] = [];
          if (!res.inside)
            problems.push(
              `Simulate Impact right ${res.btnRight.toFixed(1)} is outside the region right ${res.regionRight.toFixed(1)}`,
            );
          if (!res.atCentre)
            problems.push(
              `Simulate Impact is not the element at its own centre (it is ${res.topIs})`,
            );
          if (res.fadeHit)
            problems.push("the right-edge fade intersects Simulate Impact");
          if (problems.length) throw new Error(problems.join("; "));
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

        // The table's column widths keep moving after first paint (170.2 measured the
        // rank cell at 38.5 px and then 31.0 px on one page); wait until they hold
        // still. The wait moved to geometry.ts (170.7) so the manager describes
        // share it.
        await settleStrategyTableLayout(page);

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
          await assertPinnedHeaderNotPaintedOver(region, `SC6-DISCOVERY pinned ${vp.id}`);
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

        // 3. P-1 (edge equalities), P-4 (room for a metric), at scrollLeft 0 and at
        //    the maximum. P-2 (per-row width and right edge) and P-3 (no descendant
        //    past the pinned edge) are assertPinnedCellsMatchHeaders in geometry.ts,
        //    moved there unedited by 170.7 so the manager describes call them.
        await collect("P-2/P-3 pinned cells match their headers", async () => {
          await assertPinnedCellsMatchHeaders(region, `SC6-DISCOVERY pinned ${vp.id}`, {
            pinned: [
              { header: 0, name: "rank" },
              { header: 1, name: "star" },
              { header: "Strategy", name: "Strategy" },
            ],
          });
        });
        await collect("P-1/P-4 pinned geometry", async () => {
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

/**
 * Phase 170.1.3 NARROWCHARTS — the /allocations charts fit a 390 px phone.
 *
 * Contract-first, in the shape Phase 170's T0 used: this describe is the gate
 * the four plans share. Between plan 01 and plan 04 the whole-surface clip
 * cases ("no svg text clipped") are RED by design; the plans ship in ONE PR,
 * and `e2e-seeded` runs this file. Do not weaken an assertion to go green.
 *
 * Test titles are fixed, the plans select them with `-g`:
 *   `overview: equity …` (plan 01's gate), `overview|composer: no svg text
 *   clipped` (plan 04's gate), `overview|composer: desktop reading` (C-5).
 *
 * C-5 desktop BEFORE/AFTER: set NARROWCHARTS_DESKTOP_OUT to write the
 * 1280 x 800 reading (per surface, per svg in DOM order: width and every text
 * with its anchor and overflow) and NARROWCHARTS_DESKTOP_BEFORE to compare
 * against a committed one. Neither set: the reading cases still build the
 * reading and assert it is non-empty, and compare nothing.
 */
const NARROW_VIEWPORTS: { id: string; width: number; height: number }[] = [
  { id: "V390", width: 390, height: 844 },
  { id: "V640", width: 640, height: 800 },
  { id: "V1280", width: 1280, height: 800 },
];

// The value of COLLAPSIBLE_OPEN_ALL_EVENT in src/components/ui/CollapsibleSection.tsx.
// Written as a literal: that file is a client component and is not imported
// into the Playwright process. Every CollapsibleSection listens for it.
const COLLAPSIBLE_OPEN_ALL_EVENT_NAME = "collapsible-section:open-all";

const NARROW_FIXTURE_NAME = `${NAME_PREFIX} NARROWCHARTS`;
// Fixed so svg text strings do not drift between the BEFORE and AFTER reading.
const NARROW_ANCHOR_MS = Date.UTC(2026, 9, 20);

const EQUITY_ROOT = '[data-testid="overview-equity-curve"]';
const EQUITY_SVG = 'svg[aria-label="Equity chart"]';

// The D-03c emitters, mounted by the Overview and the composer alike. Each is selected by the
// aria-label (or the aria-describedby) its component writes, so a moved selector reads as missing.
const SHARED_EMITTERS: SvgTextEmitterDef[] = [
  { key: "eoy-legend", selector: 'svg[aria-label^="End-of-year returns by calendar year"]' },
  { key: "heatmap-months", selector: '[aria-label^="Daily-return calendar for"] svg' },
  { key: "return-quantiles", selector: 'svg[aria-label^="Return quantiles box plot"]' },
  { key: "timeseries-y", selector: 'svg[aria-describedby^="chart-help-"]' },
];

const COMPOSER_EMITTERS: SvgTextEmitterDef[] = [
  { key: "brush", selector: '[aria-label="Master timeline brush"] svg' },
  {
    key: "quantile-box",
    selector: `svg[aria-label="Quantile box plot for the strategy's daily return distribution"]`,
  },
  {
    key: "rolling-sharpe",
    selector: "details#composer-blend-detail svg.recharts-surface",
    headingText: "Rolling Sharpe",
  },
  { key: "rolling-volatility", selector: '[aria-label="Rolling volatility"] svg.recharts-surface' },
  { key: "rolling-sortino", selector: '[aria-label="Rolling Sortino"] svg.recharts-surface' },
  ...SHARED_EMITTERS,
];

const OVERVIEW_EMITTERS: SvgTextEmitterDef[] = SHARED_EMITTERS;

// Floors are the counts measured on the local-stack lane at V390, V640 and V1280 (the minimum over
// the three; they differ only for return-quantiles, which draws fewer y ticks on the mobile arm).
// The Overview does not mount ReturnQuantiles.
const OVERVIEW_REQUIRED: RequiredEmitter[] = [
  { key: "eoy-legend", minTexts: 3 },
  { key: "heatmap-months", minTexts: 16 },
  { key: "timeseries-y", minTexts: 102 },
];

const COMPOSER_REQUIRED: RequiredEmitter[] = [
  { key: "brush", minTexts: 2 },
  { key: "quantile-box" },
  { key: "rolling-sharpe", minTexts: 2, minXAxisTexts: 2 },
  { key: "rolling-volatility", minTexts: 2, minXAxisTexts: 2 },
  { key: "rolling-sortino", minTexts: 2, minXAxisTexts: 2 },
  { key: "eoy-legend", minTexts: 5 },
  { key: "heatmap-months", minTexts: 32 },
  { key: "return-quantiles", minTexts: 4 },
  { key: "timeseries-y", minTexts: 41 },
];

type Surface = "overview" | "composer";

const ROLLING_XTICKS: Record<string, string> = {
  "rolling-sharpe":
    'details#composer-blend-detail div:has(> h3:text-is("Rolling Sharpe")) .recharts-xAxis-tick-labels text',
  "rolling-volatility":
    '[aria-label="Rolling volatility"] .recharts-xAxis-tick-labels text',
  "rolling-sortino":
    '[aria-label="Rolling Sortino"] .recharts-xAxis-tick-labels text',
};

/** Wait until the element's width has not moved across two reads 200 ms apart. */
async function waitForStableWidth(page: Page, selector: string): Promise<void> {
  let prev = -1;
  await expect
    .poll(
      async () => {
        const w = await page
          .locator(selector)
          .first()
          .evaluate((el) => el.getBoundingClientRect().width);
        const stable = w === prev && w > 0;
        prev = w;
        await page.waitForTimeout(200);
        return stable;
      },
      { timeout: 15_000, message: `${selector} width never settled` },
    )
    .toBe(true);
}

async function openOverview(page: Page, vp: { width: number; height: number }): Promise<void> {
  await page.setViewportSize({ width: vp.width, height: vp.height });
  const allocator = await seedTestAllocator();
  await seedAllocatorBook({ allocatorUserId: allocator.userId, days: 120 });
  await loginViaForm(page, allocator.email, allocator.password);
  const res = await page.goto("/allocations?tab=overview");
  if (res && res.status() >= 400) {
    throw new Error(`/allocations returned HTTP ${res.status()} — cannot run NARROWCHARTS`);
  }
  await expect(
    page.locator(`${EQUITY_ROOT} ${EQUITY_SVG}`),
    "Equity chart svg not visible — EmptyState/login page would false-green",
  ).toBeVisible({ timeout: 20_000 });
  await page.waitForLoadState("networkidle");
  await page.evaluate((n) => window.dispatchEvent(new Event(n)), COLLAPSIBLE_OPEN_ALL_EVENT_NAME);
  await waitForStableWidth(page, `${EQUITY_ROOT} ${EQUITY_SVG}`);
}

/** Composer in composed mode with the FIXED fixture name and anchor. */
async function openNarrowComposer(
  page: Page,
  vp: { width: number; height: number },
  days = 400,
): Promise<void> {
  await page.setViewportSize({ width: vp.width, height: vp.height });
  await cleanupStrategiesByNamePrefix(NAME_PREFIX);
  const fixtureId = await seedStrategyWithHistory({
    days,
    name: NARROW_FIXTURE_NAME,
    codename: NARROW_FIXTURE_NAME,
    withDailyReturns: true,
    anchorMs: NARROW_ANCHOR_MS,
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
  await page.fill('input[placeholder="Search by name or codename"]', NARROW_FIXTURE_NAME);
  const fixtureAdd = page.locator(`[data-testid="browse-add-${fixtureId}"]`);
  await expect(fixtureAdd).toBeVisible({ timeout: 10_000 });
  await fixtureAdd.click();
  await page.click('[aria-label="Close drawer"]');
  await page.waitForLoadState("networkidle");
  await expect(page.locator("h2", { hasText: "Portfolio" }).first()).toBeVisible({
    timeout: 10_000,
  });
  await expect(
    page.locator('[aria-label="Master timeline brush"]'),
    "composed factsheet charts did not mount",
  ).toBeVisible({ timeout: 20_000 });
}

/**
 * Open every collapsed section BEFORE any measurement. The composer mounts the
 * three rolling charts (and the histogram and quantiles card) inside the
 * closed-by-default `details#composer-blend-detail`; closed, they are
 * display:none, measure zero width and draw no ticks.
 */
async function expandAll(page: Page, surface: Surface): Promise<void> {
  await page.evaluate((n) => window.dispatchEvent(new Event(n)), COLLAPSIBLE_OPEN_ALL_EVENT_NAME);
  if (surface === "composer") {
    await expect(
      page.locator("details#composer-blend-detail"),
      "details#composer-blend-detail did not open (event name or id changed?)",
    ).toHaveAttribute("open", "", { timeout: 10_000 });
    for (const [key, selector] of Object.entries(ROLLING_XTICKS)) {
      await expect
        .poll(() => page.locator(selector).count(), {
          timeout: 15_000,
          message: `NARROWCHARTS-EMITTER-MISSING composer ${key}: fewer than two x-axis ticks drawn`,
        })
        .toBeGreaterThanOrEqual(2);
    }
    await waitForStableWidth(page, '[aria-label="Master timeline brush"] svg');
  } else {
    await waitForStableWidth(page, `${EQUITY_ROOT} ${EQUITY_SVG}`);
  }
}

async function openSurface(
  page: Page,
  surface: Surface,
  vp: { width: number; height: number },
  composerDays?: number,
): Promise<void> {
  if (surface === "overview") await openOverview(page, vp);
  else await openNarrowComposer(page, vp, composerDays);
  await expandAll(page, surface);
}

interface ReadingText {
  text: string;
  anchor: string;
  overflowPx: number;
}
interface ReadingSvg {
  surface: Surface;
  index: number;
  label: string | null;
  emitter: string | null;
  width: number;
  texts: ReadingText[];
}

function toReading(surface: Surface, layouts: SvgTextLayout[]): ReadingSvg[] {
  return layouts.map((l) => ({
    surface,
    index: l.index,
    label: l.label,
    emitter: l.emitter,
    width: l.width,
    texts: l.texts.map((t) => ({ text: t.text, anchor: t.anchor, overflowPx: t.overflowPx })),
  }));
}

/** Merge one surface into the OUT file (sync read-modify-write, then rename). */
function writeDesktopReading(outPath: string, surface: Surface, reading: ReadingSvg[]): void {
  let doc: { viewport: string; readings: Record<string, ReadingSvg[]> } = {
    viewport: "1280x800",
    readings: {},
  };
  if (fs.existsSync(outPath)) doc = JSON.parse(fs.readFileSync(outPath, "utf8"));
  doc.readings[surface] = reading;
  const tmp = `${outPath}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(doc, null, 2)}\n`);
  fs.renameSync(tmp, outPath);
}

function compareDesktopReading(beforePath: string, surface: Surface, after: ReadingSvg[]): void {
  const doc = JSON.parse(fs.readFileSync(beforePath, "utf8")) as {
    readings: Record<string, ReadingSvg[]>;
  };
  const before = doc.readings[surface];
  if (!before) throw new Error(`NARROWCHARTS: ${beforePath} has no "${surface}" reading`);
  const problems: string[] = [];
  if (before.length !== after.length) {
    problems.push(`${surface}: svg count ${before.length} -> ${after.length}`);
  }
  for (let i = 0; i < Math.min(before.length, after.length); i++) {
    const b = before[i];
    const a = after[i];
    const who = `${surface} svg#${i} ${b.label ?? ""}`;
    if (Math.abs(b.width - a.width) > 0.5) problems.push(`${who}: width ${b.width} -> ${a.width}`);
    const bt = b.texts.map((t) => t.text);
    const at = a.texts.map((t) => t.text);
    if (JSON.stringify(bt) !== JSON.stringify(at)) {
      problems.push(`${who}: text strings differ\n  before ${JSON.stringify(bt)}\n  after  ${JSON.stringify(at)}`);
      continue;
    }
    b.texts.forEach((t, k) => {
      const u = a.texts[k];
      if (t.anchor === u.anchor) return;
      if (t.overflowPx > 0.5) {
        console.log(
          `NARROWCHARTS-DESKTOP-ANCHOR-CHANGE ${surface} "${t.text}" ${t.anchor} -> ${u.anchor} (was overflowing by ${t.overflowPx})`,
        );
      } else {
        problems.push(`${who}: "${t.text}" anchor ${t.anchor} -> ${u.anchor} but it was not overflowing (${t.overflowPx})`);
      }
    });
  }
  expect(problems, `desktop ${surface} differs from the BEFORE reading:\n${problems.join("\n")}`).toEqual([]);
}

test.describe("/allocations charts — NARROWCHARTS", () => {
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

  for (const vp of NARROW_VIEWPORTS) {
    if (vp.id !== "V1280") {
      test(`${vp.id} overview: equity chart fits its card`, async ({ page }) => {
        test.setTimeout(120_000);
        await openSurface(page, "overview", vp);
        const svg = page.locator(`${EQUITY_ROOT} ${EQUITY_SVG}`).first();
        const geo = await svg.evaluate((el) => {
          const wrap = el.closest("div.relative.w-full");
          if (!wrap) return { error: 'no ancestor matches div.relative.w-full' };
          if (wrap !== el.parentElement?.parentElement) {
            return { error: "div.relative.w-full is not the svg's grandparent — the markup moved" };
          }
          const cs = getComputedStyle(wrap);
          const w = wrap.getBoundingClientRect();
          const s = el.getBoundingClientRect();
          const px = (v: string) => Number.parseFloat(v) || 0;
          return {
            content: {
              left: w.left + px(cs.borderLeftWidth) + px(cs.paddingLeft),
              right: w.right - px(cs.borderRightWidth) - px(cs.paddingRight),
            },
            svg: { left: s.left, right: s.right, width: s.width },
          };
        });
        if ("error" in geo) throw new Error(`${vp.id}: ${geo.error}`);
        console.log(
          `NARROWCHARTS ${vp.id} equity svg ${geo.svg.left.toFixed(1)}..${geo.svg.right.toFixed(1)} (w ${geo.svg.width.toFixed(1)}) in wrapper content ${geo.content.left.toFixed(1)}..${geo.content.right.toFixed(1)}`,
        );
        expect(
          geo.svg.left,
          `${vp.id}: equity svg left ${geo.svg.left} is left of the wrapper content box ${geo.content.left}`,
        ).toBeGreaterThanOrEqual(geo.content.left - 0.5);
        expect(
          geo.svg.right,
          `${vp.id}: equity svg right ${geo.svg.right} is right of the wrapper content box ${geo.content.right} (svg width ${geo.svg.width})`,
        ).toBeLessThanOrEqual(geo.content.right + 0.5);
        await assertNotClippedByAncestors(svg, `${vp.id} equity svg`);
      });
    }

    test(`${vp.id} overview: equity text not clipped`, async ({ page }) => {
      test.setTimeout(120_000);
      await openSurface(page, "overview", vp);
      await assertSvgTextInsideSvg(page, EQUITY_ROOT, `overview-equity ${vp.id}`, EQUITY_SVG);
    });

    test(`${vp.id} overview: no svg text clipped`, async ({ page }) => {
      test.setTimeout(120_000);
      await openSurface(page, "overview", vp);
      await assertSvgTextInsideSvg(page, "#main-content", `overview ${vp.id}`, "svg", {
        emitters: OVERVIEW_EMITTERS,
        required: OVERVIEW_REQUIRED,
      });
    });

    test(`${vp.id} composer: no svg text clipped`, async ({ page }) => {
      test.setTimeout(150_000);
      await openSurface(page, "composer", vp);
      await assertSvgTextInsideSvg(page, "#main-content", `composer ${vp.id}`, "svg", {
        emitters: COMPOSER_EMITTERS,
        required: COMPOSER_REQUIRED,
      });
    });
  }

  test("V390 overview: equity x labels do not overlap", async ({ page }) => {
    test.setTimeout(120_000);
    await openSurface(page, "overview", NARROW_VIEWPORTS[0]);
    const labels = page.locator(
      `${EQUITY_ROOT} ${EQUITY_SVG} text[font-family="var(--font-sans)"]`,
    );
    const rects = await labels.evaluateAll((els) =>
      els.map((el) => {
        const r = el.getBoundingClientRect();
        return { text: (el.textContent ?? "").trim(), x: r.x, y: r.y, width: r.width, height: r.height };
      }),
    );
    expect(rects.length, "fewer than two equity x labels — nothing to compare (W-02)").toBeGreaterThanOrEqual(2);
    const overlaps: string[] = [];
    for (let i = 0; i < rects.length; i++) {
      for (let j = i + 1; j < rects.length; j++) {
        if (rectsIntersect(rects[i], rects[j])) {
          overlaps.push(`"${rects[i].text}" overlaps "${rects[j].text}"`);
        }
      }
    }
    console.log(`NARROWCHARTS V390 equity x labels: ${rects.map((r) => r.text).join(" | ")}`);
    expect(overlaps, `V390 equity x labels overlap:\n${overlaps.join("\n")}`).toEqual([]);
  });

  // WR-01: the rolling charts' end-date label must not land on the label before it. Whether the
  // penultimate label reaches the end label depends on the data window (Recharts places it by a
  // forward walk), and the default 400-day fixture happens to clear it even with the old end flip.
  // 260 days measured RED against that flip at both widths, so this case seeds 260.
  for (const vp of [NARROW_VIEWPORTS[0], NARROW_VIEWPORTS[1]]) {
    test(`${vp.id} composer: rolling x labels do not overlap`, async ({ page }) => {
      test.setTimeout(150_000);
      await openSurface(page, "composer", vp, 260);
      const overlaps: string[] = [];
      for (const [key, selector] of Object.entries(ROLLING_XTICKS)) {
        const rects = await page.locator(selector).evaluateAll((els) =>
          els.map((el) => {
            const r = el.getBoundingClientRect();
            return { text: (el.textContent ?? "").trim(), x: r.x, y: r.y, width: r.width, height: r.height };
          }),
        );
        expect(rects.length, `${key}: fewer than two x labels — nothing to compare (W-02)`).toBeGreaterThanOrEqual(2);
        for (let i = 0; i < rects.length; i++) {
          for (let j = i + 1; j < rects.length; j++) {
            if (rectsIntersect(rects[i], rects[j])) {
              overlaps.push(`${key}: "${rects[i].text}" overlaps "${rects[j].text}"`);
            }
          }
        }
        console.log(
          `NARROWCHARTS ${vp.id} ${key} x labels: ${rects.map((r) => `${r.text}@${r.x.toFixed(1)}+${r.width.toFixed(1)}`).join(" | ")}`,
        );
      }
      expect(overlaps, `${vp.id} rolling x labels overlap:\n${overlaps.join("\n")}`).toEqual([]);
    });
  }

  for (const surface of ["overview", "composer"] as const) {
    test(`V1280 ${surface}: desktop reading`, async ({ page }) => {
      test.setTimeout(150_000);
      const vp = NARROW_VIEWPORTS[2];
      await openSurface(page, surface, vp);
      const emitters = surface === "composer" ? COMPOSER_EMITTERS : OVERVIEW_EMITTERS;
      const layouts = await readSvgTextLayout(page, "#main-content", "svg", emitters);
      const reading = toReading(surface, layouts);
      const out = process.env.NARROWCHARTS_DESKTOP_OUT;
      if (out) writeDesktopReading(out, surface, reading);
      const texts = reading.reduce((n, s) => n + s.texts.length, 0);
      console.log(`NARROWCHARTS V1280 ${surface} reading: ${reading.length} svg(s), ${texts} text(s)`);
      expect(reading.length, `${surface}: no svg read (W-02)`).toBeGreaterThan(0);
      expect(texts, `${surface}: no svg text read (W-02)`).toBeGreaterThan(0);
      assertEmittersMeasured(
        layouts,
        `${surface} ${vp.id}`,
        surface === "composer" ? COMPOSER_REQUIRED : OVERVIEW_REQUIRED,
      );
      const before = process.env.NARROWCHARTS_DESKTOP_BEFORE;
      if (before) compareDesktopReading(before, surface, reading);
    });
  }
});
