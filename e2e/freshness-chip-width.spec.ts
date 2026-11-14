/**
 * Phase 214 plan 05 (SC-5, SC-7) — the FreshnessChip label stays on one line
 * inside its masthead column at 1485px, measured in a real browser.
 *
 * WHY A BROWSER: jsdom has no layout. A TODOS entry (0.12, 2026-08-26, closed and deleted by Phase 214) recorded the chip's
 * `Track record · future — check data` label as 297.9px of text in a 204.2px
 * masthead column at 1485px, and no unit test can see that.
 *
 * THAT OVERFLOW DOES NOT REPRODUCE AT HEAD. Measured with this spec's seed (a long
 * strategy name and description, series end five days ahead): the masthead fits one
 * row at 1485px (column 295.3px, label row 295.3px, one line), and a viewport sweep
 * from 1485px down to 360px showed no overflow, no wrap and no horizontal scroll.
 * SC-5 is amended to "does not reproduce at HEAD, measured at 1485px plus a
 * 1485-to-360px sweep" (founder decision, 2026-11-14).
 *
 * WHAT THIS SPEC IS NOW: a regression pin. It fails if the label overflows its
 * column, is clipped, or wraps past one line. The founder decision (CONTEXT SC-5,
 * Q3 = a) stands: wrapping is allowed and the full sentence is kept, so there is no
 * narrow-column precondition; the pin is that the label stays inside its column on
 * one line, which is what HEAD does.
 *
 * Tests:
 *   a. future tone   — `Track record · future — check data`, masthead pressure.
 *   b. baseline      — `Computed · fresh`, same pressure.
 *   c. SyncBadge     — its `future — check data` text, measured at the same
 *                      viewport (RESEARCH addendum decision 5).
 *
 * TWO-PLACE RULE — place 1 of 2: the HAS_SEED_ENV self-skip below. Place 2 is
 * the `e2e-seeded` list in `.github/workflows/ci.yml`.
 *
 * Shared TEST: every seed uses the per-worker `e2e-p214-w<n>-` prefix and cleanup
 * deletes only that prefix. This runs against the local-stack lane, never shared TEST.
 */
import "./helpers/node-websocket-polyfill"; // must precede any createClient()
import { createClient } from "@supabase/supabase-js";
import { test, expect, type Locator, type Page } from "./helpers/hydration-guard";
import {
  assertChildrenInside,
  assertNotClippedByAncestors,
} from "./helpers/geometry";
import { loginAs } from "./helpers/login";
import { cleanupTestAllocator } from "./helpers/cleanup-test-project";
import {
  cleanupStrategiesByNamePrefix,
  seedStrategyWithHistory,
  seedTestAllocator,
} from "./helpers/seed-test-project";
import {
  assertNotProductionSupabaseUrl,
  assertSupabaseServiceRoleKey,
} from "../src/lib/test-safety";

const HAS_SEED_ENV =
  !!process.env.TEST_SUPABASE_URL &&
  !!process.env.TEST_SUPABASE_SERVICE_ROLE_KEY;

const VIEWPORT = { width: 1485, height: 900 } as const;

// Per worker, so one worker's afterAll cannot delete the rows another worker's test is
// still reading (layout-narrow.spec.ts precedent). Every prefix starts `e2e-p214-`.
const PREFIX = `e2e-p214-w${process.env.TEST_PARALLEL_INDEX ?? 0}-`;

// Masthead pressure: a realistic long strategy name and a long description.
const LONG_NAME_TAIL =
  "Systematic Multi-Venue Basis Carry and Volatility Overlay Programme";
const LONG_DESCRIPTION =
  "A market-neutral programme harvesting funding and basis across perpetual and " +
  "dated futures on several venues, with a volatility overlay sized from realised " +
  "variance and a discretionary risk budget that is reviewed at each monthly " +
  "committee meeting. Capacity is limited by the depth of the dated contracts.";

/** Service-role client behind the prod-URL guard (the seed helper's own pair). */
function getGuardedAdmin() {
  const url = process.env.TEST_SUPABASE_URL!;
  const key = process.env.TEST_SUPABASE_SERVICE_ROLE_KEY!;
  assertNotProductionSupabaseUrl(url, "freshness-chip-width");
  assertSupabaseServiceRoleKey(key, "freshness-chip-width");
  return createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

/** Description write, scoped by id. */
async function setDescription(strategyId: string, description: string) {
  const admin = getGuardedAdmin();
  const { error } = await admin
    .from("strategies")
    .update({ description })
    .eq("id", strategyId);
  if (error) throw new Error(`[p214] description write failed: ${error.message}`);
}

/** A recorded trade-fetch time five days ahead, which the badge reads as `future`. */
async function setTradesFetchedInTheFuture(strategyId: string) {
  const admin = getGuardedAdmin();
  const { error, count } = await admin
    .from("strategy_analytics")
    .update(
      { trades_fetched_at: new Date(Date.now() + 5 * 86_400_000).toISOString() },
      { count: "exact" },
    )
    .eq("strategy_id", strategyId);
  if (error) throw new Error(`[p214] trades_fetched_at write failed: ${error.message}`);
  if (count !== 1) {
    throw new Error(`[p214] trades_fetched_at write touched ${count} rows, expected 1`);
  }
}

/** The target-size HTTP-status guard plus a URL pin (W-02 false-green guard). */
async function gotoFactsheet(page: Page, strategyId: string): Promise<void> {
  const res = await page.goto(`/factsheet/${strategyId}/v2`);
  if (res && res.status() >= 400) {
    throw new Error(
      `/factsheet/${strategyId}/v2 returned HTTP ${res.status()} — ` +
        "cannot run the Phase 214 chip-width assertions (W-02 false-green guard).",
    );
  }
  await expect(page).toHaveURL(new RegExp(`/factsheet/${strategyId}/v2`), {
    timeout: 10_000,
  });
}

/** The chip's label row inside the masthead (not the section eyebrows). */
function chipLabelRow(page: Page): Locator {
  return page
    .locator("header", { hasText: "Institutional Factsheet" })
    .first()
    .locator('div[class*="tracking-[0.18em]"]')
    .filter({ hasText: /^(Track record|Computed) · / });
}

/**
 * The chip's masthead column: the `sm:flex-col` wrapper in the masthead. Walk is
 * label row -> chip root -> the `<div>` that pairs the chip with the recency and
 * trade-fetch lines -> that wrapper.
 */
function chipColumn(row: Locator): Locator {
  return row.locator("xpath=../../..");
}

async function assertChipLabelFits(
  page: Page,
  expectedText: string,
  label: string,
): Promise<void> {
  const row = chipLabelRow(page);
  await expect(row, `${label}: label row`).toHaveCount(1);
  await expect(row).toHaveText(expectedText);
  // Next streams Suspense content inside a hidden template and swaps it in, so a
  // text match can land on an element that has no box yet. A zero-width row would
  // satisfy every "fits" assertion below vacuously (W-02), so wait for a real box.
  await expect(row, `${label}: label row is visible`).toBeVisible();
  await expect
    .poll(async () => (await row.boundingBox())?.width ?? 0, {
      message: `${label}: label row never got a layout box`,
    })
    .toBeGreaterThan(0);
  const column = chipColumn(row);
  await expect(column, `${label}: chip column is the sm:flex-col wrapper`).toHaveClass(
    /sm:flex-col/,
  );

  const m = await row.evaluate((el) => {
    const col = el.parentElement!.parentElement!.parentElement!;
    const cs = getComputedStyle(el);
    // `normal` has no pixel value; fall back to the usual 1.5 x fontSize.
    const lineH =
      cs.lineHeight === "normal"
        ? parseFloat(cs.fontSize) * 1.5
        : parseFloat(cs.lineHeight);
    return {
      rowScroll: el.scrollWidth,
      rowClient: el.clientWidth,
      rowRectW: el.getBoundingClientRect().width,
      rowH: el.getBoundingClientRect().height,
      lineH,
      columnW: col.getBoundingClientRect().width,
    };
  });
  test.info().annotations.push({
    type: "measured",
    description:
      `${label}: label row scrollWidth=${m.rowScroll} clientWidth=${m.rowClient} ` +
      `rect=${m.rowRectW.toFixed(1)}px h=${m.rowH.toFixed(1)}px lineH=${m.lineH.toFixed(1)}px; ` +
      `chip column=${m.columnW.toFixed(1)}px`,
  });
  console.log(
    `[p214 measured] ${label}: row scrollWidth=${m.rowScroll} clientWidth=${m.rowClient} ` +
      `rect=${m.rowRectW.toFixed(1)}px h=${m.rowH.toFixed(1)}px lineH=${m.lineH.toFixed(1)}px ` +
      `column=${m.columnW.toFixed(1)}px`,
  );

  // One line: a wrapped label is at least two line heights tall.
  expect(
    m.rowH,
    `${label}: label row height ${m.rowH.toFixed(1)}px > 1.5 x line height ${m.lineH.toFixed(1)}px (label wrapped)`,
  ).toBeLessThanOrEqual(1.5 * m.lineH);

  await assertChildrenInside(page, column, `${label}: label row inside column`);
  await row.scrollIntoViewIfNeeded();
  await assertNotClippedByAncestors(row, `${label}: label row`);
  expect(
    m.rowScroll,
    `${label}: label row scrollWidth ${m.rowScroll} > clientWidth ${m.rowClient}`,
  ).toBeLessThanOrEqual(m.rowClient);
}

test.describe("Phase 214 SC-5 — FreshnessChip label stays on one line inside its masthead column at 1485px", () => {
  test.skip(
    !HAS_SEED_ENV,
    "freshness-chip-width: seed-helper env vars not wired " +
      "(set TEST_SUPABASE_URL / TEST_SUPABASE_SERVICE_ROLE_KEY) — skipping " +
      "prevents a false-green against an empty/404 factsheet (W-02). Runs in " +
      "the seeded CI job (two-place rule, place 2).",
  );

  test.afterAll(async () => {
    if (HAS_SEED_ENV) await cleanupStrategiesByNamePrefix(PREFIX);
  });

  test("a. future tone: Track record · future — check data lies inside its column", async ({
    page,
  }) => {
    const id = await seedStrategyWithHistory({
      days: 120,
      name: `${PREFIX}future-${LONG_NAME_TAIL}`,
      anchorMs: Date.now() + 5 * 86_400_000,
    });
    await setDescription(id, LONG_DESCRIPTION);
    await page.setViewportSize({ ...VIEWPORT });
    await gotoFactsheet(page, id);
    await assertChipLabelFits(
      page,
      "Track record · future — check data",
      "future tone",
    );
  });

  test("b. baseline: Computed · fresh lies inside its column", async ({
    page,
  }) => {
    const id = await seedStrategyWithHistory({
      days: 120,
      name: `${PREFIX}fresh-${LONG_NAME_TAIL}`,
    });
    await setDescription(id, LONG_DESCRIPTION);
    await page.setViewportSize({ ...VIEWPORT });
    await gotoFactsheet(page, id);
    await assertChipLabelFits(page, "Computed · fresh", "baseline");
  });

  test("c. SyncBadge: Trades fetched · future — check data lies inside its container", async ({
    page,
  }) => {
    // SyncBadge has no factsheet page: its "future — check data" is the TRADE-fetch
    // arm, and the surface that reaches it is the discovery table's pinned name cell
    // (StrategyHeader, the other mount with this text, is mounted nowhere).
    const allocator = await seedTestAllocator();
    try {
      const id = await seedStrategyWithHistory({
        days: 120,
        name: `${PREFIX}syncbadge-future`,
        // The discovery list hides un-coded example rows by default.
        codename: "P214 SyncBadge Future",
        categorySlug: "crypto-sma",
      });
      await setTradesFetchedInTheFuture(id);
      await page.setViewportSize({ ...VIEWPORT });
      await loginAs(page, allocator.email, allocator.password);
      const res = await page.goto("/discovery/crypto-sma");
      if (res && res.status() >= 400) {
        throw new Error(`/discovery/crypto-sma returned HTTP ${res.status()} (W-02 guard)`);
      }
      await expect(page).toHaveURL(/\/discovery\/crypto-sma/, { timeout: 10_000 });

      const row = page.locator("tr", {
        hasText: new RegExp(`${PREFIX}syncbadge-future|P214 SyncBadge Future`),
      });
      await expect(row, "c: the seeded strategy's table row").toHaveCount(1);
      const badge = row
        .locator('span[class*="inline-flex"]')
        .filter({ hasText: "future — check data" });
      await expect(badge, "c: the badge's own span").toHaveCount(1);
      await expect(badge).toBeVisible();
      const m = await badge.evaluate((el) => ({
        rect: el.getBoundingClientRect().width,
        scrollWidth: el.scrollWidth,
        clientWidth: el.clientWidth,
        height: el.getBoundingClientRect().height,
      }));
      test.info().annotations.push({
        type: "measured",
        description:
          `SyncBadge: rect=${m.rect.toFixed(1)}px h=${m.height.toFixed(0)}px ` +
          `scrollWidth=${m.scrollWidth} clientWidth=${m.clientWidth}`,
      });
      console.log(
        `[p214 measured] SyncBadge: rect=${m.rect.toFixed(1)}px h=${m.height.toFixed(0)}px ` +
          `scrollWidth=${m.scrollWidth} clientWidth=${m.clientWidth}`,
      );
      await assertChildrenInside(page, badge, "c: SyncBadge text inside its badge");
      await expect(
        m.scrollWidth,
        `c: SyncBadge scrollWidth ${m.scrollWidth} > clientWidth ${m.clientWidth}`,
      ).toBeLessThanOrEqual(m.clientWidth);
    } finally {
      await cleanupTestAllocator(allocator.userId);
    }
  });
});
