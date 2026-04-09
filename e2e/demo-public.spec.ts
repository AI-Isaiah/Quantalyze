import { test, expect } from "@playwright/test";

/**
 * E2E coverage for the public `/demo` page.
 *
 * Runs against a placeholder-env Next.js build in CI (same profile as
 * smoke.spec.ts + auth.spec.ts). Under that env the admin Supabase client
 * can't connect, so /demo falls through to the "Demo data is loading"
 * empty-state card. These specs MUST NOT assert on seeded data — only on
 * the layout chrome (brand banner, persona switcher) and on response
 * status / console cleanliness.
 */
test.describe("Public /demo page", () => {
  test("loads with brand banner and persona switcher", async ({ page }) => {
    const response = await page.goto("/demo");
    expect(response?.status()).toBeLessThan(400);

    // Brand banner from src/app/demo/layout.tsx
    await expect(page.getByText("Quantalyze", { exact: true })).toBeVisible();

    // Persona switcher from src/app/demo/page.tsx — the three persona links
    // are a nav labelled "Demo persona" so we can scope the assertion to
    // avoid matching "Active Allocator LP" elsewhere on the page.
    const personaNav = page.getByRole("navigation", { name: /demo persona/i });
    await expect(personaNav.getByRole("link", { name: "Active" })).toBeVisible();
    await expect(personaNav.getByRole("link", { name: "Cold" })).toBeVisible();
    await expect(personaNav.getByRole("link", { name: "Stalled" })).toBeVisible();
  });

  // `aria-current=page` marks the selected persona link.
  const personaCases = [
    { slug: "active", label: "Active" },
    { slug: "cold", label: "Cold" },
    { slug: "stalled", label: "Stalled" },
  ];
  for (const { slug, label } of personaCases) {
    test(`accepts ?persona=${slug} query param`, async ({ page }) => {
      const response = await page.goto(`/demo?persona=${slug}`);
      expect(response?.status()).toBeLessThan(400);
      const link = page
        .getByRole("navigation", { name: /demo persona/i })
        .getByRole("link", { name: label });
      await expect(link).toHaveAttribute("aria-current", "page");
    });
  }

  test("hostile persona input defaults silently to active", async ({ page }) => {
    // The persona resolver in src/lib/personas.ts MUST fall back to the
    // default persona for any non-allowlist value. A raw `<script>` in the
    // query string is the trust-collapse canary: if it ever reflects into
    // the DOM, fix the resolver, not the test.
    const response = await page.goto("/demo?persona=%3Cscript%3E");
    expect(response?.status()).toBeLessThan(400);

    // Hostile input never reaches the DOM — no raw <script> tag from the
    // URL should exist anywhere on the page.
    const scriptCount = await page.locator("script:has-text('<script>')").count();
    expect(scriptCount).toBe(0);

    // And the default (Active) persona is marked current.
    const activeLink = page
      .getByRole("navigation", { name: /demo persona/i })
      .getByRole("link", { name: "Active" });
    await expect(activeLink).toHaveAttribute("aria-current", "page");
  });

  test("no console errors on /demo", async ({ page }) => {
    const errors: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") errors.push(msg.text());
    });

    await page.goto("/demo");
    await page.waitForTimeout(1000);

    // Filter Next.js hydration warnings + redirect noise, same shape as
    // smoke.spec.ts.
    const realErrors = errors.filter(
      (e) => !e.includes("Hydration") && !e.includes("NEXT_REDIRECT"),
    );
    expect(realErrors).toHaveLength(0);
  });

  const viewports = [
    { width: 320, height: 568 },
    { width: 375, height: 667 },
    { width: 1280, height: 800 },
  ];
  for (const { width, height } of viewports) {
    test(`renders without horizontal overflow at ${width}x${height}`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height });
      const response = await page.goto("/demo");
      expect(response?.status()).toBeLessThan(400);
      const hasOverflow = await page.evaluate(
        () => document.documentElement.scrollWidth > window.innerWidth,
      );
      expect(hasOverflow).toBe(false);
    });
  }
});
