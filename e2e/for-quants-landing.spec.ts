import { test, expect } from "@playwright/test";
import { seedTestAllocator } from "./helpers/seed-test-project";

/**
 * E2E smoke tests for /for-quants landing page (Sprint 1 Task 1.1).
 *
 * Covers the three must-pass paths from the ship criteria:
 *   1. Page loads unauthenticated, all 5 sections visible.
 *   2. Primary CTA "Start Wizard" routes to /signup?role=manager.
 *   3. "Request a Call" opens a modal, submits the form, closes cleanly.
 *
 * Audit-2026-05-07 expansion (G9.B.9 + G9.B.10):
 *   - Form-submit path with API success → success view renders.
 *   - Form-submit path with server validation error → fieldErrors render.
 *   - Logged-in CTA branching (proxy exemption + branch href / label).
 *
 * Bonus coverage:
 *   - /security page loads and has the security contact.
 *   - public/security.txt serves at the root (RFC 9116 compliance).
 */

const HAS_SEED_ENV =
  !!process.env.TEST_SUPABASE_URL &&
  !!process.env.TEST_SUPABASE_SERVICE_ROLE_KEY;

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

  /**
   * G9.B.9 — full submit flow. Pre-fix the spec only verified the
   * modal opens with the form fields visible; the actual fetch →
   * success view → echoed-email render path was uncovered. We mock
   * the API response with playwright's route() interceptor so the
   * spec runs in CI without a live DB, mirroring the ship-criteria
   * docblock at the top of the file.
   */
  test("submits the Request-a-Call form successfully (G9.B.9)", async ({
    page,
  }) => {
    await page.route("**/api/for-quants-lead", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          ok: true,
          idempotency_key: "deadbeefdeadbeefdeadbeefdeadbeef",
        }),
      });
    });

    await page.goto("/for-quants");
    await page.getByRole("button", { name: /Request a Call/ }).first().click();
    await expect(
      page.getByRole("heading", { name: /Request a Call/, level: 2 }),
    ).toBeVisible();

    await page.getByLabel("Name").fill("Jane Doe");
    await page.getByLabel("Firm").fill("Acme Quant");
    await page.getByLabel("Email").fill("jane@acme.example");

    await page.getByRole("button", { name: /Send request/ }).click();

    await expect(page.getByText(/Request received/)).toBeVisible();
    await expect(page.getByText("jane@acme.example")).toBeVisible();
  });

  test("renders inline fieldErrors when the API returns 400 (G9.B.9)", async ({
    page,
  }) => {
    await page.route("**/api/for-quants-lead", async (route) => {
      await route.fulfill({
        status: 400,
        contentType: "application/json",
        body: JSON.stringify({
          error: "Invalid submission",
          // G9.B.16: fieldErrors is now an array per field.
          fieldErrors: { email: ["Enter a valid email"] },
        }),
      });
    });

    await page.goto("/for-quants");
    await page.getByRole("button", { name: /Request a Call/ }).first().click();
    await page.getByLabel("Name").fill("Jane Doe");
    await page.getByLabel("Firm").fill("Acme Quant");
    await page.getByLabel("Email").fill("jane@acme.example");
    await page.getByRole("button", { name: /Send request/ }).click();

    await expect(page.getByText(/Enter a valid email/)).toBeVisible();
    // Submit button is re-enabled so the user can correct + retry.
    await expect(
      page.getByRole("button", { name: /Send request/ }),
    ).toBeEnabled();
  });
});

/**
 * G9.B.10 — logged-in /for-quants behavior. The proxy exemption added
 * with this PR keeps logged-in managers on /for-quants instead of
 * bouncing them to /discovery/crypto-sma, AND the page's CTA href
 * branches on isLoggedIn (logged-out → /signup?role=manager,
 * logged-in → /strategies/new/wizard). Pre-fix only the logged-out
 * path was tested.
 *
 * Skipped when seed env vars are absent — mirrors the pattern in
 * admin-csv-status-axe.spec.ts.
 */
test.describe("/for-quants logged-in behavior (G9.B.10)", () => {
  test.skip(
    !HAS_SEED_ENV,
    "logged-in /for-quants spec: seed-helper env vars not wired " +
      "(set TEST_SUPABASE_URL / TEST_SUPABASE_SERVICE_ROLE_KEY)",
  );

  test("logged-in user is NOT redirected away from /for-quants and sees the logged-in CTA label", async ({
    page,
  }) => {
    if (!HAS_SEED_ENV) return;
    const allocator = await seedTestAllocator();
    await page.goto("/login");
    await page.fill(
      'input[name="email"], input[placeholder*="email" i]',
      allocator.email,
    );
    await page.fill('input[type="password"]', allocator.password);
    await page.click('button:has-text("Sign in")');
    await page.waitForURL(
      /\/(discovery|strategies|allocations|dashboard|admin)/,
      { timeout: 10_000 },
    );

    await page.goto("/for-quants");

    // Proxy exemption: stays on /for-quants.
    await expect(page).toHaveURL(/\/for-quants$/, { timeout: 5_000 });

    // CTA branches to the logged-in copy. The browser-side auth
    // probe is async, so use a generous wait.
    await expect(
      page.getByRole("link", { name: /Connect your strategy/ }).first(),
    ).toBeVisible({ timeout: 10_000 });

    const ctaHref = await page
      .getByRole("link", { name: /Connect your strategy/ })
      .first()
      .getAttribute("href");
    expect(ctaHref).toContain("/strategies/new/wizard");
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
