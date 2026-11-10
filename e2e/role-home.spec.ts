/**
 * Phase 199 MANAGERHOME (ROUTE-01) - the seeded proof that each role lands on its
 * own page after a real sign-in through the /login form.
 *
 * ── What this spec pins ────────────────────────────────────────────────────
 * 1. An allocator lands on /allocations, a manager on /strategies, and an admin
 *    (role "both" plus `is_admin`) on /admin. Each asserts the final PATHNAME
 *    exactly, so a regression to "everyone lands on Discovery", or a role sent
 *    to another role's home, fails by name instead of passing on a wide URL
 *    pattern.
 * 2. A safe `?redirect=/compare` WINS over the role home (CD-02 / CD-13).
 * 3. An unsafe `?redirect=` (`//host`) never navigates off-origin: the sign-in
 *    falls back to the role home (T-199-24, CWE-601).
 *
 * The landing is decided by `src/lib/routing/role-home.ts` (`roleHomeFor`) behind
 * `/home`; this spec is the end-to-end half of the unit tests on that module.
 *
 * ── Shared test DB (PR #654 lesson) ────────────────────────────────────────
 * Every account here is this spec's own mint (`seedTestAllocator`), so nothing
 * asserts a global count or a global empty state. The seeded users are not torn
 * down, the established convention of every seeded spec (see my-strategies.spec.ts).
 *
 * ── Seed-gate (MA-8 two-place rule) ────────────────────────────────────────
 * Place 1: the e2e-seeded list entry in .github/workflows/ci.yml. Place 2: the
 * HAS_SEED_ENV self-skip below.
 */
import { test, expect } from "./helpers/hydration-guard";
import { loginAs } from "./helpers/login";
import { seedTestAllocator } from "./helpers/seed-test-project";

const HAS_SEED_ENV =
  !!process.env.TEST_SUPABASE_URL &&
  !!process.env.TEST_SUPABASE_SERVICE_ROLE_KEY;

const LANDINGS: {
  label: string;
  seed: Parameters<typeof seedTestAllocator>[0];
  landing: string;
}[] = [
  { label: "an allocator", seed: { role: "allocator" }, landing: "/allocations" },
  { label: "a manager", seed: { role: "manager" }, landing: "/strategies" },
  {
    label: "an admin (role both)",
    seed: { role: "both", isAdmin: true },
    landing: "/admin",
  },
];

test.describe("Phase 199 - each role lands on its own page (ROUTE-01)", () => {
  test.skip(
    !HAS_SEED_ENV,
    "role-home: seed-helper env vars not wired " +
      "(set TEST_SUPABASE_URL / TEST_SUPABASE_SERVICE_ROLE_KEY) - " +
      "skipping prevents a false-green against the login page (W-02).",
  );

  for (const c of LANDINGS) {
    test(`${c.label} signs in and lands on ${c.landing}`, async ({ page }) => {
      const user = await seedTestAllocator(c.seed);
      // `landing` makes loginAs wait for this exact pathname, and a wrong
      // landing times out there with the URL it did reach.
      await loginAs(page, user.email, user.password, { landing: c.landing });
      expect(new URL(page.url()).pathname).toBe(c.landing);
    });
  }

  test("a safe ?redirect= wins over the role home", async ({ page }) => {
    const allocator = await seedTestAllocator({ role: "allocator" });
    await loginAs(page, allocator.email, allocator.password, {
      redirect: "/compare",
      landing: "/compare",
    });
    expect(new URL(page.url()).pathname).toBe("/compare");
  });

  test("an off-origin ?redirect= is ignored and the role home is used", async ({
    page,
  }) => {
    const allocator = await seedTestAllocator({ role: "allocator" });
    await loginAs(page, allocator.email, allocator.password, {
      redirect: "//evil.example.test/steal",
      landing: "/allocations",
    });
    const after = new URL(page.url());
    expect(after.pathname).toBe("/allocations");
    // The sign-in never left the app: the off-origin host was not followed.
    expect(after.hostname).not.toBe("evil.example.test");
  });
});
