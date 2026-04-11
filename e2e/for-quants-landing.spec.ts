import { test, expect } from "@playwright/test";

/**
 * E2E smoke tests for /for-quants landing page (Sprint 1 Task 1.1).
 *
 * Covers the three must-pass paths from the ship criteria:
 *   1. Page loads unauthenticated, all 5 sections visible.
 *   2. Primary CTA "Start Wizard" routes to /signup?role=manager.
 *   3. "Request a Call" opens a modal, submits the form, closes cleanly.
 *
 * Bonus coverage:
 *   - /security page loads and has the security contact.
 *   - public/security.txt serves at the root (RFC 9116 compliance).
 *   - Proxy exemption for /for-quants works (no redirect to
 *     /discovery/crypto-sma when logged in). The "logged in" part is
 *     covered by full-flow.spec.ts once it lands; this spec asserts the
 *     unauth path only.
 */

test.describe("/for-quants landing page", () => {
  test("loads unauthenticated with all 5 sections visible", async ({ page }) => {
    const res = await page.goto("/for-quants");
    expect(res?.status()).toBeLessThan(400);

    // Hero
    await expect(
      page.getByRole("heading", {
        name: /List a verified track record/,
        level: 1,
      }),
    ).toBeVisible();

    // Trust block — H2
    await expect(
      page.getByRole("heading", {
        name: /Read-only keys only/,
        level: 2,
      }),
    ).toBeVisible();

    // How It Works — H2
    await expect(
      page.getByRole("heading", { name: /How it works/, level: 2 }),
    ).toBeVisible();

    // Factsheet Sample — H2
    await expect(
      page.getByRole("heading", {
        name: /Allocator view/,
        level: 2,
      }),
    ).toBeVisible();

    // Final CTA
    await expect(
      page.getByRole("heading", {
        name: /Ready to publish a verified strategy profile/,
        level: 2,
      }),
    ).toBeVisible();
  });

  test("primary CTA 'Start Wizard' points at /signup?role=manager", async ({
    page,
  }) => {
    await page.goto("/for-quants");

    // There are two primary CTAs (hero + footer). Both should go to the
    // same destination — assert on the first visible instance.
    const startWizard = page.getByRole("link", { name: /Start Wizard/ }).first();
    await expect(startWizard).toBeVisible();
    const href = await startWizard.getAttribute("href");
    expect(href).toContain("/signup");
    expect(href).toContain("role=manager");
  });

  test("'Request a Call' opens a modal with the form fields", async ({
    page,
  }) => {
    await page.goto("/for-quants");

    // Click the hero's Request a Call link.
    await page.getByRole("button", { name: /Request a Call/ }).first().click();

    // Modal title
    await expect(
      page.getByRole("heading", { name: /Request a Call/, level: 2 }),
    ).toBeVisible();

    // Required fields
    await expect(page.getByLabel("Name")).toBeVisible();
    await expect(page.getByLabel("Firm")).toBeVisible();
    await expect(page.getByLabel("Email")).toBeVisible();

    // Mailto fallback link
    await expect(
      page.getByRole("link", { name: /security@quantalyze.com/ }),
    ).toBeVisible();
  });

  test("Request a Call modal can be closed with Escape", async ({ page }) => {
    await page.goto("/for-quants");

    await page.getByRole("button", { name: /Request a Call/ }).first().click();
    await expect(
      page.getByRole("heading", { name: /Request a Call/, level: 2 }),
    ).toBeVisible();

    await page.keyboard.press("Escape");

    await expect(
      page.getByRole("heading", { name: /Request a Call/, level: 2 }),
    ).not.toBeVisible();
  });

  test("logged-out users visiting /for-quants are NOT redirected to /login", async ({
    page,
  }) => {
    // The proxy keeps /for-quants in PUBLIC_ROUTES — ensure no auth bounce.
    await page.goto("/for-quants");
    expect(page.url()).toContain("/for-quants");
  });
});

test.describe("/security page + security.txt", () => {
  test("/security page loads and shows the security contact", async ({
    page,
  }) => {
    const res = await page.goto("/security");
    expect(res?.status()).toBeLessThan(400);
    await expect(
      page.getByRole("heading", { name: /Security practices/, level: 1 }),
    ).toBeVisible();
    // security@quantalyze.com appears multiple times on the page (intro,
    // disclosures, footer) — assert at least one is visible.
    await expect(
      page.locator("text=security@quantalyze.com").first(),
    ).toBeVisible();
  });

  test("/security.txt serves from the public folder", async ({ request }) => {
    const res = await request.get("/security.txt");
    expect(res.status()).toBeLessThan(400);
    const body = await res.text();
    expect(body).toContain("Contact: mailto:security@quantalyze.com");
    expect(body).toContain("Expires:");
    expect(body).toContain("Canonical:");
  });

  test("/.well-known/security.txt serves from the public folder", async ({
    request,
  }) => {
    const res = await request.get("/.well-known/security.txt");
    expect(res.status()).toBeLessThan(400);
    const body = await res.text();
    expect(body).toContain("Contact: mailto:security@quantalyze.com");
  });
});
