import { test, expect } from "@playwright/test";

/**
 * E2E smoke tests for Sprint 5 Task 5.7 — public `/security` page +
 * downloadable security packet PDF.
 *
 * Covers:
 *   1. /security renders unauthenticated with the expected H1 and the
 *      three editorial sections (Data / Key / Compliance).
 *   2. The "Download security packet (PDF)" link targets
 *      /security-packet.pdf and the asset responds with
 *      application/pdf from Vercel's static serving.
 *   3. The existing Footer link ("Security") on a public page
 *      (homepage → LegalFooter) routes to /security.
 *   4. Wizard deep-link anchors used by `wizardErrors.ts` and
 *      `ConnectKeyStep.tsx` still exist — a regression guard so future
 *      copy edits on /security don't silently break the wizard
 *      "Read the full guide" links.
 *
 * Does NOT run an axe-core scan — the repo does not bundle
 * @axe-core/playwright. The test relies on semantic HTML landmarks
 * (article > h1 > section > h2/h3) as a structural proxy.
 */

test.describe("/security page", () => {
  test("renders unauthenticated with the three editorial sections", async ({
    page,
  }) => {
    const res = await page.goto("/security");
    expect(res?.status()).toBeLessThan(400);

    await expect(
      page.getByRole("heading", { name: /Security practices/, level: 1 }),
    ).toBeVisible();

    await expect(
      page.getByRole("heading", { name: /^Data handling$/, level: 2 }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: /^Key handling$/, level: 2 }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: /^Compliance posture$/, level: 2 }),
    ).toBeVisible();

    // Security contact surface
    await expect(
      page.locator("text=security@quantalyze.com").first(),
    ).toBeVisible();
  });

  test("PDF download link targets /security-packet.pdf and the asset serves", async ({
    page,
    request,
  }) => {
    await page.goto("/security");

    // Match the aria-label ("Download Quantalyze security packet PDF") —
    // the aria-label wins over visible text for the accessible name.
    const pdfLink = page.getByRole("link", {
      name: /Download .* security packet/i,
    });
    await expect(pdfLink).toBeVisible();
    const href = await pdfLink.getAttribute("href");
    expect(href).toBe("/security-packet.pdf");

    // Fetch the asset directly — static file served from /public.
    const assetRes = await request.get("/security-packet.pdf");
    expect(assetRes.status()).toBeLessThan(400);
    const contentType = assetRes.headers()["content-type"] ?? "";
    expect(contentType).toContain("pdf");
  });

  test("footer Security link on the homepage routes to /security", async ({
    page,
  }) => {
    const res = await page.goto("/");
    expect(res?.status()).toBeLessThan(400);

    // LegalFooter renders a single "Security" link inside a <nav>.
    const footerNav = page.locator("footer nav");
    const securityLink = footerNav.getByRole("link", { name: "Security" });
    await expect(securityLink).toBeVisible();

    await securityLink.click();
    await expect(page).toHaveURL(/\/security$/);
    await expect(
      page.getByRole("heading", { name: /Security practices/, level: 1 }),
    ).toBeVisible();
  });

  test("wizard deep-link anchors are still defined (regression guard)", async ({
    page,
  }) => {
    // Every anchor below is referenced by either
    //   - src/lib/wizardErrors.ts (docsHref values), or
    //   - src/app/(dashboard)/strategies/new/wizard/steps/ConnectKeyStep.tsx
    // If one is removed, the wizard's scripted error surface 404s the
    // "Read the full guide" link. This test asserts structural presence
    // only, not content.
    await page.goto("/security");

    const anchors = [
      "readonly-key",
      "binance-readonly",
      "okx-readonly",
      "bybit-readonly",
      "regenerate-key",
      "egress-ips",
      "sync-timing",
      "draft-resume",
      "thresholds",
    ];

    for (const id of anchors) {
      const count = await page.locator(`#${id}`).count();
      expect(count, `missing #${id} on /security`).toBeGreaterThan(0);
    }
  });
});
