/**
 * Phase 54-07 / VERIFY-03 — RUNTIME no-clip sweep (content cut-off guard).
 *
 * ROADMAP success criterion 3: "a no-clip CI guard fails the build on any
 * reintroduced truncation." This is a RUNTIME check, deliberately MORE truthful
 * than a static utility-class ban (`line-clamp`/`truncate` grep): a class ban
 * flags *usage*, but a runtime probe flags *actual visible cut-off* — text that
 * is genuinely clipped (`scrollWidth > clientWidth`) under a CSS
 * `text-overflow:ellipsis` clamp on a NON-EMPTY text node. So a deliberate
 * `truncate` on a container that is wide enough to show its text never fails;
 * only text the user actually cannot fully read does.
 *
 * It mirrors the reflow-sweep scaffolding exactly:
 *   - public half  ← e2e/reflow-sweep.spec.ts   (NO seed gate — provable by grep)
 *   - seeded half  ← e2e/reflow-sweep-authed.spec.ts (HAS_SEED_ENV + test.skip)
 *   - clip probe   ← e2e/helpers/reflow.ts:119-165 assertTargetSizes idiom
 *                    (a page.evaluate per-element walk that ACCUMULATES every
 *                     offender — never bails on the first — and asserts at least
 *                     one element was measured so an empty page can't false-green)
 *
 * Routes × viewports include the v1.4 ultra-wide 2560px bound (where a
 * fixed-width clamp that looks fine at 1280 can clip a longer wrapped line) as
 * well as desktop 1280 and mobile 375.
 *
 * FLOW-01 dual-wiring (the twice-/thrice-burned trap — gate added but never
 * runs): this spec is wired in BOTH required places —
 *   place 1 (ci.yml): the filename appears in the UNSEEDED Playwright list (for
 *     the public describe) AND the seeded MA-8 list (for the seeded describe);
 *   place 2 (this spec): the HAS_SEED_ENV const + the test.skip on the seeded
 *     describe below. Without either place the gate silently never runs.
 */
import { test, expect, type Page } from "@playwright/test";
import { seedTestAllocator } from "./helpers/seed-test-project";

// Routes × viewports — desktop, mobile, and the v1.4 ultra-wide 2560px bound.
const VIEWPORTS = [
  { width: 1280, height: 800, name: "desktop 1280" },
  { width: 375, height: 812, name: "mobile 375" },
  { width: 2560, height: 1440, name: "ultrawide 2560" },
] as const;

/**
 * The runtime clip-detection probe — adapts the assertTargetSizes per-element
 * walk (e2e/helpers/reflow.ts:119-165). For every `body *`:
 *   - SKIP if it (or an ancestor) matches an ALLOW selector — deliberate clamps
 *     are not failures: `.avatar` (cropped image), `[class*="line-clamp"]`
 *     (intended multi-line clamp), `[data-clamp-ok]` (explicit opt-out marker);
 *   - FLAG when CSS `text-overflow:ellipsis` is active (`overflow !== "visible"`)
 *     AND the element actually overflows (`scrollWidth > clientWidth + 1`, the
 *     same sub-pixel slop reflow.ts uses) AND it carries non-empty text.
 * Accumulates EVERY offender (never bails on the first) and the caller asserts
 * the array is empty + that at least one element was walked (false-green guard).
 *
 * Runs in the browser context, so it measures real rendered geometry — the
 * @container 2560 trap that jsdom class-string tests false-pass (54-RESEARCH
 * Pitfall 3) shows up here as a genuine clipped element.
 */
async function findClippedText(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    // Deliberate clamps — allowlisted, NOT flagged. A finding outside this set
    // is an UNINTENDED clip (the regression this gate exists to catch).
    const ALLOW = ['[data-clamp-ok]', '.avatar', '[class*="line-clamp"]'];
    const out: string[] = [];
    let measured = 0;
    for (const el of Array.from(
      document.querySelectorAll<HTMLElement>("body *"),
    )) {
      if (ALLOW.some((s) => el.matches(s) || el.closest(s))) continue;
      const r = el.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) continue; // hidden — skip
      measured += 1;
      const cs = getComputedStyle(el);
      // Scope: ellipsis-clamp truncation — the mode the app's `truncate` /
      // `text-ellipsis` Tailwind utilities produce, and the VERIFY-03 regression
      // surface. We deliberately do NOT flag `text-overflow: clip`: `clip` is the
      // CSS *default* value, so every overflow:hidden element carries it (rounded
      // cards, scroll containers) — flagging it would false-positive at scale. A
      // hard `overflow:hidden` text-cut with no ellipsis is not runtime-separable
      // from a legitimate clipped container without per-text-node analysis, so it
      // is out of this gate's scope; the ellipsis check covers the utilities in use.
      const ellipsis =
        cs.textOverflow === "ellipsis" && cs.overflow !== "visible";
      const overflowed = el.scrollWidth > el.clientWidth + 1;
      if (ellipsis && overflowed && (el.textContent ?? "").trim().length > 0) {
        const idPart = el.id ? `#${el.id}` : "";
        const classPart =
          typeof el.className === "string" && el.className
            ? `.${el.className.split(" ").filter(Boolean).slice(0, 2).join(".")}`
            : "";
        out.push(`${el.tagName}${idPart}${classPart}`);
      }
    }
    // Sentinel so an empty/unhydrated page (zero elements walked) cannot
    // false-green — the visible-anchor assertion in the caller is the primary
    // guard; this is the assertTargetSizes measured>0 belt-and-suspenders.
    if (measured === 0) out.push("__NO_ELEMENTS_MEASURED__");
    return out;
  });
}

/**
 * One route × viewport probe. Sets the viewport, navigates, throws LOUD on an
 * HTTP>=400 (so a 404/500 can't false-green), asserts the route-specific
 * VISIBLE anchor (so a blank/login/unhydrated page fails loud — the W-02
 * lesson), then asserts the clip probe found no UNINTENDED truncation.
 */
async function probeNoClip(
  page: Page,
  path: string,
  anchor: string,
  viewport: { width: number; height: number },
): Promise<void> {
  await page.setViewportSize({ width: viewport.width, height: viewport.height });
  const res = await page.goto(path);
  if (res) {
    const status = res.status();
    if (status >= 400) {
      throw new Error(
        `${path} returned HTTP ${status} — cannot run no-clip sweep`,
      );
    }
  }
  // Fail loud on empty/404/login/unhydrated — never measure against nothing.
  await expect(
    page.locator(anchor).first(),
    `no-clip anchor "${anchor}" not visible on ${path} — blank/404/login/unhydrated page would otherwise false-green`,
  ).toBeVisible({ timeout: 10_000 });
  // Best-effort settle so the measurement doesn't race a font swap / async
  // image (mirrors assertNoReflow). Swallowed: the assertion below is the gate.
  await page
    .waitForLoadState("networkidle", { timeout: 10_000 })
    .catch(() => {});

  const clipped = await findClippedText(page);
  expect(
    clipped,
    `unintended truncated/ellipsis-clipped text on ${path} @ ${viewport.width}px: ${clipped.join(", ")}`,
  ).toEqual([]);
}

// ---------------------------------------------------------------------------
// PUBLIC half — UNSEEDED, NO seed gate (matching reflow-sweep.spec.ts's
// deliberate no-seed property, provable by the absence of any seed-env token in
// this describe). FLOW-01 place 1 = the filename in the ci.yml UNSEEDED list.
// ---------------------------------------------------------------------------

// Curated public route floor — each anchor is a VISIBLE content element on that
// route (never generic chrome) so probeNoClip fails loud on a blank/404 page.
// Identical to reflow-sweep.spec.ts:41-57 so the two sweeps cover the same floor.
const PUBLIC_ROUTES: { path: string; anchor: string }[] = [
  { path: "/", anchor: "h1" },
  { path: "/security", anchor: "main h1" },
  { path: "/for-quants", anchor: "main h1" },
  { path: "/browse", anchor: "main h1" },
  { path: "/demo", anchor: "#editorial-hero-headline" },
];

test.describe("no-clip sweep (VERIFY-03) — public", () => {
  for (const r of PUBLIC_ROUTES) {
    for (const vp of VIEWPORTS) {
      test(`${r.path} no clipped text @ ${vp.name}`, async ({ page }) => {
        await probeNoClip(page, r.path, r.anchor, vp);
      });
    }
  }
});

// ---------------------------------------------------------------------------
// SEEDED authed half — HAS_SEED_ENV-gated (FLOW-01 place 2). Without the seed
// env the authed routes redirect to /login; the test.skip prevents a
// false-green against that login chrome (W-02). With the env set in CI the
// MA-8 gate resolves true and these run for real. FLOW-01 place 1 for this half
// = the filename in the ci.yml seeded MA-8 list.
// ---------------------------------------------------------------------------

const HAS_SEED_ENV =
  !!process.env.TEST_SUPABASE_URL &&
  !!process.env.TEST_SUPABASE_SERVICE_ROLE_KEY;

async function loginViaForm(
  page: Page,
  email: string,
  password: string,
): Promise<void> {
  await page.goto("/login");
  await page.fill('input[name="email"], input[placeholder*="email" i]', email);
  await page.fill('input[type="password"]', password);
  await page.click('button:has-text("Sign in")');
  await page.waitForURL(/\/(discovery|strategies|allocations|dashboard)/, {
    timeout: 10000,
  });
}

// Curated authed route floor — each anchor is a route-specific VISIBLE content
// node the freshly-seeded user reliably renders (never generic chrome). The
// "My Allocation" <h1> sits above the tab-panel switch (AllocationsTabs.tsx) so
// it is present on every ?tab= value. This sweep spans BOTH the allocator
// surfaces AND the standalone /strategies/new/wizard route, which is
// manager-gated (Phase 109 ROLE-04, strategies/layout.tsx — allocators
// contribute via the inline ContributionWizardOverlay, Phase 110 CONTRIB). A
// pure allocator would be redirected off the wizard, so the beforeAll seeds
// role='both' to own both surfaces in one user without redirect. NB /admin is
// deliberately EXCLUDED: 'both' is still a non-admin and /admin redirects a
// non-admin → a false-green (reflow-sweep-authed.spec.ts:26-31). Admin clip
// coverage rides the public routes + the static admin-width test (Plan 54-03).
const AUTHED_ROUTES: { path: string; anchor: string; label: string }[] = [
  { path: "/allocations", anchor: 'h1:has-text("My Allocation")', label: "allocations (default)" },
  { path: "/allocations?tab=overview", anchor: 'h1:has-text("My Allocation")', label: "allocations Overview" },
  { path: "/allocations?tab=holdings", anchor: 'h1:has-text("My Allocation")', label: "allocations Holdings" },
  { path: "/allocations?tab=outcomes", anchor: 'h1:has-text("My Allocation")', label: "allocations Outcomes" },
  { path: "/allocations?tab=mandate", anchor: 'h1:has-text("My Allocation")', label: "allocations Mandate" },
  { path: "/allocations?tab=risk", anchor: 'h1:has-text("My Allocation")', label: "allocations Risk" },
  { path: "/allocations?tab=scenario", anchor: 'h1:has-text("My Allocation")', label: "allocations Scenario composer" },
  { path: "/strategies/new/wizard", anchor: "#wizard-connect-key-heading", label: "onboarding wizard API entry" },
  { path: "/strategies/new/wizard?source=csv", anchor: "#wizard-csv-upload-heading", label: "onboarding wizard CSV entry" },
  { path: "/security", anchor: "main h1", label: "security (authed)" },
];

test.describe("no-clip sweep (VERIFY-03) — authed", () => {
  test.skip(
    !HAS_SEED_ENV,
    "no-clip-sweep: seed env not wired (W-02) — " +
      "set TEST_SUPABASE_URL / TEST_SUPABASE_SERVICE_ROLE_KEY. " +
      "Skipping prevents a false-green against an empty/404/login page; " +
      "the live authed no-clip proof runs in CI once seed env is present.",
  );

  // One seeded role='both' user + login for the whole sweep (mirrors reflow-
  // sweep-authed.spec.ts). role='both' owns the allocator surfaces AND the
  // manager-gated /strategies/new/wizard route (see the AUTHED_ROUTES note),
  // so a single user sweeps both without redirect. The session cookie carries
  // across page.goto navigations.
  let allocator: Awaited<ReturnType<typeof seedTestAllocator>>;

  test.beforeAll(async () => {
    allocator = await seedTestAllocator({ role: "both" });
  });

  test.beforeEach(async ({ page }) => {
    await loginViaForm(page, allocator.email, allocator.password);
  });

  for (const r of AUTHED_ROUTES) {
    for (const vp of VIEWPORTS) {
      test(`${r.label} no clipped text @ ${vp.name}`, async ({ page }) => {
        await probeNoClip(page, r.path, r.anchor, vp);
      });
    }
  }
});
