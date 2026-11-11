/**
 * Phase 200 MANAGERKEYS gap closure (plan 13, gap 1 of the 2026-11-11
 * measurement) - the strategy edit page's one-key panel, seeded and blocking.
 *
 * ── What this spec pins ────────────────────────────────────────────────────
 * ROUTE-09 (D-03, D-05, D-07): `Change key…` opens a picker, a pick opens the
 * confirm and writes nothing, and only the dialog's `Change key` button
 * re-points the strategy. LEAN-04: the panel links to the Profile API keys tab,
 * the one place keys are added and deleted. The "nothing is written" claims are
 * checked against the DATABASE (a service-role read of `strategies.api_key_id`),
 * never against the dialog's visibility, and the confirm-writes test proves
 * that read can see a write, so the unchanged assertions are able to fail.
 *
 * ── Where it runs ──────────────────────────────────────────────────────────
 * Only in the `e2e-seeded` list of `.github/workflows/ci.yml` (the
 * `Run seed-gated specs (MA-8 / BLOCK-3)` step), which the `frontend` aggregator
 * judges. The panel tests used to live in api-key-flow.spec.ts and
 * sync-analytics-flow.spec.ts, whose only Playwright list is the advisory `e2e`
 * job, and they skipped on an env var no workflow sets. Nothing there could
 * fail a merge.
 *
 * ── No env self-skip, by decision ──────────────────────────────────────────
 * This spec deliberately carries NO HAS_SEED_ENV skip. Without the seed env the
 * seed helper throws, so every test FAILS, and it can never pass by skipping.
 * That is the second documented exception to the MA-8 place-2 rule, beside
 * full-flow. `src/__tests__/manager-keys-e2e-wiring.test.ts` pins it.
 *
 * ── Shared test DB ─────────────────────────────────────────────────────────
 * Each test seeds its own manager, strategy and two keys, asserts only on those
 * rows, and removes the strategy and keys by id afterwards. The seeded user
 * stays, the convention of every seeded spec.
 *
 * ── Auth ───────────────────────────────────────────────────────────────────
 * It signs in through the /login form only and never sets a storageState, so
 * Playwright's `request` fixture stays unauthenticated for the contract tests
 * in the unseeded specs.
 */
import { test, expect, type Page } from "./helpers/hydration-guard";
import { loginAs } from "./helpers/login";
import { assertNoReflow, assertTargetSizes } from "./helpers/reflow";
import {
  cleanupManagerKeyPanel,
  readStrategyApiKeyId,
  seedManagerKeyPanel,
  type SeededManagerKeyPanel,
} from "./helpers/seed-test-project";

/**
 * Let the page go network-idle, bounded, with the timeout swallowed (the
 * `assertNoReflow` idiom). A write the browser already sent has landed by then,
 * so a following database read cannot race ahead of it and pass vacuously.
 */
async function settle(page: Page): Promise<void> {
  await page.waitForLoadState("networkidle", { timeout: 3_000 }).catch(() => {});
}

test.describe("Phase 200 - the strategy edit page's one-key panel (seeded, blocking)", () => {
  let seeded: SeededManagerKeyPanel;
  // Set only once a seed has fully succeeded, and cleared first thing in every
  // beforeEach: a seed that throws must not leave afterEach re-cleaning the
  // PREVIOUS test's ids (SFH-G2).
  let cleanupTarget: SeededManagerKeyPanel | undefined;

  test.beforeEach(async ({ page }) => {
    cleanupTarget = undefined;
    seeded = await seedManagerKeyPanel();
    cleanupTarget = seeded;
    await loginAs(page, seeded.manager.email, seeded.manager.password, {
      landing: "/strategies",
    });
    await page.goto(`/strategies/${seeded.strategyId}/edit`);
    await expect(page).toHaveURL(new RegExp(`/strategies/${seeded.strategyId}/edit$`));
  });

  test.afterEach(async () => {
    if (cleanupTarget) await cleanupManagerKeyPanel(cleanupTarget);
  });

  test("Change key… opens the picker, a pick opens the confirm, and nothing is written before Change key", async ({
    page,
  }) => {
    await page.getByRole("button", { name: "Change key…" }).click();
    await page.getByTestId(`change-key-option-${seeded.spareKey.id}`).click();

    // The native <dialog> carries no accessible name, so match it by its title.
    const dialog = page
      .getByRole("dialog")
      .filter({ hasText: "Change this strategy's key?" });
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText(seeded.strategyName);
    await expect(dialog).toContainText(seeded.linkedKey.label);
    await expect(dialog).toContainText(seeded.spareKey.label);

    // The confirm is open and the pick has written nothing.
    await settle(page);
    expect(
      await readStrategyApiKeyId(seeded.strategyId),
      "the strategy was re-pointed by the pick itself, before the dialog's Change key button (ROUTE-09 D-03)",
    ).toBe(seeded.linkedKey.id);

    await dialog.getByRole("button", { name: "Cancel" }).click();
    await expect(dialog).toBeHidden();

    // Cancel wrote nothing either.
    await settle(page);
    expect(
      await readStrategyApiKeyId(seeded.strategyId),
      "Cancel re-pointed the strategy (ROUTE-09 D-03)",
    ).toBe(seeded.linkedKey.id);
  });

  test("the confirm dialog's controls, its Close included, measure at least 44px at 320px and 1280px", async ({
    page,
  }) => {
    // Phase 200 gap 3: the shared Modal's header Close was 20x20 in every
    // dialog, and no gate measured an open dialog. This one reads real boxes
    // (assertTargetSizes: anchor first, then measured > 0, then the 44px bar).
    // It writes nothing: it opens the confirm and presses Cancel.
    for (const viewport of [
      { width: 320, height: 800 },
      { width: 1280, height: 800 },
    ]) {
      await page.setViewportSize(viewport);
      await page.getByRole("button", { name: "Change key…" }).click();
      await page.getByTestId(`change-key-option-${seeded.spareKey.id}`).click();
      const dialog = page
        .getByRole("dialog")
        .filter({ hasText: "Change this strategy's key?" });
      await expect(dialog).toBeVisible();

      await assertTargetSizes(
        page,
        "dialog[open]",
        "dialog[open] button, dialog[open] input",
      );

      await dialog.getByRole("button", { name: "Cancel" }).click();
      await expect(dialog).toBeHidden();
    }
  });

  test("the Rename dialog's controls, its Close included, measure at least 44px at 320px (the Modal fix is shared)", async ({
    page,
  }) => {
    // A second dialog on the same shared Modal: the fix lives in the primitive,
    // not in one dialog. It writes nothing: it opens Rename and presses Cancel.
    await page.setViewportSize({ width: 320, height: 800 });
    await page.getByRole("button", { name: "Rename…" }).click();
    const dialog = page
      .getByRole("dialog")
      .filter({ hasText: "Rename strategy" });
    await expect(dialog).toBeVisible();

    await assertTargetSizes(
      page,
      "dialog[open]",
      "dialog[open] button, dialog[open] input",
    );

    await dialog.getByRole("button", { name: "Cancel" }).click();
    await expect(dialog).toBeHidden();
  });

  test("pressing the dialog's Change key re-points the strategy to the picked key", async ({
    page,
  }) => {
    // Stub the sync the confirm starts after the write, so the test measures
    // the re-point and not an analytics service this lane does not run. This
    // arm is what makes the "nothing is written" assertions able to fail: it
    // proves the database read can see a write.
    await page.route("**/api/keys/sync", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ trades_fetched: 10, analytics_status: "complete" }),
      });
    });

    await page.getByRole("button", { name: "Change key…" }).click();
    await page.getByTestId(`change-key-option-${seeded.spareKey.id}`).click();
    const dialog = page
      .getByRole("dialog")
      .filter({ hasText: "Change this strategy's key?" });
    await expect(dialog).toBeVisible();

    await dialog.getByRole("button", { name: "Change key", exact: true }).click();

    await expect
      .poll(() => readStrategyApiKeyId(seeded.strategyId), {
        message:
          "pressing Change key in the confirm did not re-point the strategy to the picked key (ROUTE-09 D-03)",
        timeout: 15_000,
      })
      .toBe(seeded.spareKey.id);
  });

  test("edit page renders the panel heading and the Profile link", async ({ page }) => {
    await expect(
      page.getByRole("heading", { name: /Exchange API Keys/i }),
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: "Add or remove keys" }),
    ).toHaveAttribute("href", "/profile?tab=exchanges");
  });

  test("edit page no longer offers Add Key or Delete", async ({ page }) => {
    const heading = page.getByRole("heading", { name: /Exchange API Keys/i });
    await expect(heading).toBeVisible();
    // The panel root: the heading's row sits inside the panel's `space-y-4` div.
    const panel = heading.locator("xpath=../..");
    // The key cards load on the client after the heading paints. Wait for one
    // (the linked key always renders Resync) so the absence checks below cannot
    // pass against a panel that has no cards yet (WR-09).
    await expect(panel.getByRole("button", { name: /Resync/i })).toBeVisible();

    await expect(panel.getByRole("button", { name: /Add Key/i })).toHaveCount(0);
    await expect(panel.getByRole("button", { name: /Delete/i })).toHaveCount(0);
    await expect(panel.getByText(/No API keys connected/i)).toHaveCount(0);
  });

  test("Add or remove keys opens the Profile API keys tab", async ({ page }) => {
    await page.getByRole("link", { name: "Add or remove keys" }).click();

    await expect(page).toHaveURL(/\/profile\?tab=exchanges/);
  });

  test("Resync button is visible for the currently linked key", async ({ page }) => {
    // The currently linked key should show a "Resync" button
    await expect(page.getByRole("button", { name: /Resync/i })).toBeVisible();
  });

  test("clicking Resync shows syncing state", async ({ page }) => {
    // Intercept the sync API call to control timing
    let syncHits = 0;
    await page.route("**/api/keys/sync", async (route) => {
      syncHits += 1;
      // Delay response to observe the syncing state
      await new Promise((resolve) => setTimeout(resolve, 2000));
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ trades_fetched: 42, analytics_status: "complete" }),
      });
    });

    await page.getByRole("button", { name: /Resync/i }).click();

    // Button text should change to "Syncing..."
    await expect(page.getByRole("button", { name: /Syncing/i })).toBeVisible();

    // Button should be disabled during sync
    await expect(page.getByRole("button", { name: /Syncing/i })).toBeDisabled();
    // The button reads Syncing before the request reaches the stub, so poll.
    await expect
      .poll(() => syncHits, { message: "the /api/keys/sync stub was never hit" })
      .toBeGreaterThan(0);
  });

  test("an unrecognised 2xx ends the attempt, shows the unavailable copy and re-enables Resync", async ({
    page,
  }) => {
    // The stub's body carries no `ok: true`, so the panel does not treat it as an
    // enqueue: it ends the attempt as an error with the unavailable copy. Real
    // completion needs a seeded terminal compute job and is not covered here
    // (WR-08).
    let syncHits = 0;
    await page.route("**/api/keys/sync", async (route) => {
      syncHits += 1;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ trades_fetched: 10, analytics_status: "complete" }),
      });
    });

    await page.getByRole("button", { name: /Resync/i }).click();

    await expect(
      page.getByText("We couldn't start the sync. Your key is saved", { exact: false }),
    ).toBeVisible({ timeout: 10_000 });
    await expect(page.getByRole("button", { name: /Resync/i })).toBeVisible({
      timeout: 10000,
    });
    await expect(page.getByRole("button", { name: /Resync/i })).toBeEnabled();
    expect(syncHits, "the /api/keys/sync stub was never hit").toBeGreaterThan(0);
  });

  test("sync failure shows error message", async ({ page }) => {
    // Intercept sync call to simulate server error
    let syncHits = 0;
    await page.route("**/api/keys/sync", async (route) => {
      syncHits += 1;
      await route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({ error: "Exchange API rate limit exceeded" }),
      });
    });

    // The failure's own text, scoped to the panel. `.text-negative` is not
    // usable: the edit page's permissions badge already shows a red alert in
    // this lane, and the sync failure itself renders two such nodes (WR-07).
    const panel = page
      .getByRole("heading", { name: /Exchange API Keys/i })
      .locator("xpath=../..");
    await expect(panel.getByText("Exchange API rate limit exceeded")).toHaveCount(0);

    await page.getByRole("button", { name: /Resync/i }).click();

    // Error message should appear
    await expect(panel.getByText("Exchange API rate limit exceeded")).toBeVisible({
      timeout: 10000,
    });
    await expect(
      panel.getByRole("status").filter({ hasText: "Sync failed" }),
    ).toBeVisible();

    // Button should return to enabled state after failure
    await expect(page.getByRole("button", { name: /Resync/i })).toBeEnabled({
      timeout: 5000,
    });
    expect(syncHits, "the /api/keys/sync stub was never hit").toBeGreaterThan(0);
  });

  test("sync failure with non-JSON response shows service unavailable", async ({ page }) => {
    // Simulate a non-JSON error (e.g., gateway timeout returning HTML)
    let syncHits = 0;
    await page.route("**/api/keys/sync", async (route) => {
      syncHits += 1;
      await route.fulfill({
        status: 502,
        contentType: "text/html",
        body: "<html><body>Bad Gateway</body></html>",
      });
    });

    await page.getByRole("button", { name: /Resync/i }).click();

    // Should show the service unavailable fallback copy, not a JSON parse error
    await expect(
      page.getByText("We couldn't start the sync. Your key is saved", { exact: false }),
    ).toBeVisible({ timeout: 10_000 });
    expect(syncHits, "the /api/keys/sync stub was never hit").toBeGreaterThan(0);
  });
});

/** The measured boxes of one Profile key row (see `measureKeyRow`). */
interface KeyRowGeometry {
  row: { left: number; right: number; top: number; bottom: number; paddingRight: number };
  tag: { right: number };
  column: { left: number; right: number; top: number; bottom: number };
  lastSyncTop: number;
  lastSyncLeft: number;
  labelScrollWidth: number;
  labelClientWidth: number;
}

/**
 * Measure one key row on /profile?tab=exchanges from real boxes. The label is
 * found by its exact text (it must resolve to ONE element, so a wrong match
 * cannot silently measure another box); the label column is the nearest
 * `.min-w-0` ancestor (the `flex-1 min-w-0` div), the row is the column's
 * parent, the venue tag is the row's first child, and Last sync is the row's
 * `<p>` whose text is exactly "Last sync".
 */
async function measureKeyRow(page: Page, label: string): Promise<KeyRowGeometry> {
  const labelEl = page.getByText(label, { exact: true });
  await expect(
    labelEl,
    `the key label "${label}" must resolve to exactly one element on /profile?tab=exchanges`,
  ).toHaveCount(1);
  await expect(labelEl).toBeVisible();
  return labelEl.evaluate((el) => {
    const column = el.closest(".min-w-0");
    if (!column || !column.parentElement) {
      throw new Error("the key label has no .min-w-0 label column with a parent row");
    }
    const row = column.parentElement;
    const tag = row.firstElementChild;
    const lastSync = Array.from(row.querySelectorAll("p")).find(
      (p) => (p.textContent ?? "").trim() === "Last sync",
    );
    if (!tag || !lastSync) {
      throw new Error("the key row has no venue tag or no Last sync element");
    }
    const r = row.getBoundingClientRect();
    const c = column.getBoundingClientRect();
    const t = tag.getBoundingClientRect();
    const l = lastSync.getBoundingClientRect();
    return {
      row: {
        left: r.left,
        right: r.right,
        top: r.top,
        bottom: r.bottom,
        paddingRight: parseFloat(getComputedStyle(row).paddingRight),
      },
      tag: { right: t.right },
      column: { left: c.left, right: c.right, top: c.top, bottom: c.bottom },
      lastSyncTop: l.top,
      lastSyncLeft: l.left,
      labelScrollWidth: (el as HTMLElement).scrollWidth,
      labelClientWidth: (el as HTMLElement).clientWidth,
    };
  });
}

test.describe("Phase 200 - the Profile API keys rows at narrow and wide widths (seeded, blocking)", () => {
  let seeded: SeededManagerKeyPanel;
  // See the first describe: cleared before every seed, set only after one succeeds.
  let cleanupTarget: SeededManagerKeyPanel | undefined;

  test.beforeEach(async ({ page }) => {
    cleanupTarget = undefined;
    seeded = await seedManagerKeyPanel({ disconnectedLabel: "Bybit old" });
    cleanupTarget = seeded;
    await loginAs(page, seeded.manager.email, seeded.manager.password, {
      landing: "/strategies",
    });
  });

  test.afterEach(async () => {
    if (cleanupTarget) await cleanupManagerKeyPanel(cleanupTarget);
  });

  test("at 320px, 768px and 1024px each key row gives its label the full line beside the venue tag, and Last sync wraps below it", async ({
    page,
  }) => {
    // Phase 200 gap 2: at 320px the label column was squeezed to a few dozen px
    // ("UAT ...") by the Last sync block sharing the first line, with no page
    // overflow for the reflow gates to see. This reads the real boxes. 768px is
    // the R-G1 width: there the 260px sidebar narrows the row to about 392px, and
    // a basis-0 label column measured 28px wide (7 metadata lines) before the
    // wrapped layout was kept up to lg. 1024px is WR-12: the viewport-based lg
    // switch put the single-line layout there, where the row is only 648px wide
    // and an allocator MT5 row's label column measured 2.9px (10 metadata
    // lines). The layout now switches on the key list's OWN width (@container,
    // 56rem = 896px of row, i.e. a viewport of about 1272px), so 1024px stays wrapped.
    for (const width of [320, 768, 1024]) {
      await page.setViewportSize({ width, height: 800 });
      await page.goto("/profile?tab=exchanges");
      await expect(page).toHaveURL(/\/profile\?tab=exchanges/);

      for (const label of [seeded.linkedKey.label, seeded.disconnectedKey!.label]) {
        const g = await measureKeyRow(page, label);
        const numbers = `${width}px ${JSON.stringify(g)}`;
        expect(
          g.column.right,
          `"${label}": the label column must reach the row's content-box right edge (row.right - paddingRight). ${numbers}`,
        ).toBeGreaterThanOrEqual(g.row.right - g.row.paddingRight - 1);
        expect(
          g.column.left,
          `"${label}": the label column must start beside the venue tag (tag.right + 16px gap). ${numbers}`,
        ).toBeLessThanOrEqual(g.tag.right + 17);
        expect(
          g.labelScrollWidth,
          `"${label}": the key label is truncated (scrollWidth > clientWidth). ${numbers}`,
        ).toBeLessThanOrEqual(g.labelClientWidth);
        expect(
          g.lastSyncTop,
          `"${label}": Last sync must wrap below the label column. ${numbers}`,
        ).toBeGreaterThanOrEqual(g.column.bottom - 1);
      }

      await assertNoReflow(page, '[data-testid="allocator-key-row"]');
    }
  });

  test("at 1280px the key row stays on one line", async ({ page }) => {
    // The narrow fix must not leak upward: once the row itself is 56rem wide
    // (a 904px row at this viewport) the label column flexes beside Last sync,
    // as in the 2026-11-11 desktop UAT.
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto("/profile?tab=exchanges");
    await expect(page).toHaveURL(/\/profile\?tab=exchanges/);

    const g = await measureKeyRow(page, seeded.linkedKey.label);
    const numbers = JSON.stringify(g);
    expect(
      g.lastSyncTop,
      `Last sync must share a line with the label column at 1280px (it wrapped below). ${numbers}`,
    ).toBeLessThan(g.column.bottom);
    expect(
      g.lastSyncLeft,
      `Last sync must sit right of the label column at 1280px. ${numbers}`,
    ).toBeGreaterThanOrEqual(g.column.right);
    // WR-12: the label column must keep room for a label. The 1280 test used to
    // assert only the line sharing, which a 20px column would also satisfy.
    expect(
      g.column.right - g.column.left,
      `the label column is squeezed at 1280px (WR-12). ${numbers}`,
    ).toBeGreaterThanOrEqual(200);
  });
});
