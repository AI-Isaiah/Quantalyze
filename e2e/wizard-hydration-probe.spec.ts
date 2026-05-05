/**
 * Hydration regression guard for /strategies/new/wizard. Surfaces React
 * #418 (production minified) or its dev-mode unminified equivalent
 * "Hydration failed because the server rendered HTML didn't match the
 * client" by capturing every console message + page error during the
 * first hydration commit and asserting none match a hydration pattern.
 *
 * Covers four entry paths so a future SSR-unsafe pattern in any of
 * them gets caught:
 *   1. fresh API-branch load   (the default new-strategy flow)
 *   2. fresh CSV-branch load   (?source=csv)
 *   3. API-branch load with localStorage pre-seeded — the riskiest
 *      shape because WizardClient's `loaded` ref-init pattern returns
 *      null on SSR and a populated object on client first render
 *   4. post-login redirect chain that bounces through /strategies
 *      before reaching the wizard
 *
 * Origin: shipped 2026-05-05 alongside commit 9ea9d37 (savedAt deferred
 * out of useState lazy initializer). The savedAt fix was a preventive
 * action against a textbook SSR-unsafe Date.now() pattern. This spec
 * is the durable backstop — if a future change reintroduces a
 * client-only signal into a useState lazy initializer or a render-time
 * branch, the appropriate scenario above will fail.
 */
import { test, expect } from "@playwright/test";

const HYDRATION_PATTERNS = [
  /Hydration failed/i,
  /server rendered HTML didn['']t match the client/i,
  /Text content does not match server-rendered HTML/i,
  /Minified React error #418/i,
  /Minified React error #422/i,
  /Minified React error #423/i,
  /A tree hydrated but some attributes/i,
];

async function loginAsAllocator(page: import("@playwright/test").Page) {
  await page.goto("/login");
  await page.fill('input[name="email"], input[type="email"]', "demo-allocator@quantalyze.test");
  await page.fill('input[name="password"], input[type="password"]', "DemoAlpha2026!");
  await page.click('button[type="submit"]');

  // Race the form-error path against the success-redirect path. When 4
  // Playwright workers all hit `signInWithPassword` with the same demo
  // creds in parallel, Supabase's per-email rate limiter throttles some
  // of them; the form re-renders with `text-negative` error copy and
  // we never navigate. Without surfacing that, `waitForURL` times out
  // with a useless "page didn't navigate" message.
  await Promise.race([
    page
      .waitForURL((u) => !u.pathname.endsWith("/login"), { timeout: 12_000 })
      .then(() => "navigated"),
    page
      .locator(".text-negative")
      .first()
      .waitFor({ timeout: 12_000 })
      .then(async () => {
        const msg = await page.locator(".text-negative").first().textContent();
        throw new Error(`login form rejected: ${msg ?? "(no text captured)"}`);
      }),
  ]);
}

function attachConsoleCapture(page: import("@playwright/test").Page) {
  const consoleMessages: { type: string; text: string; location?: string }[] = [];
  const pageErrors: string[] = [];
  page.on("console", (msg) => {
    consoleMessages.push({
      type: msg.type(),
      text: msg.text(),
      location: JSON.stringify(msg.location()),
    });
  });
  page.on("pageerror", (err) => {
    pageErrors.push(err.message + "\n" + (err.stack ?? ""));
  });
  return { consoleMessages, pageErrors };
}

function reportAndAssert(
  label: string,
  consoleMessages: { type: string; text: string; location?: string }[],
  pageErrors: string[],
) {
  console.log(
    `\n=== HYDRATION PROBE REPORT [${label}] ===\n` +
      `consoleMessages: ${consoleMessages.length}\n` +
      `pageErrors: ${pageErrors.length}\n`,
  );
  for (const m of consoleMessages) {
    const tagged = HYDRATION_PATTERNS.some((re) => re.test(m.text))
      ? "[HYDRATION]"
      : "[CONSOLE]";
    console.log(`${tagged} ${m.type}: ${m.text}`);
    if (m.location && tagged === "[HYDRATION]") {
      console.log(`         loc: ${m.location}`);
    }
  }
  for (const e of pageErrors) {
    const tagged = HYDRATION_PATTERNS.some((re) => re.test(e))
      ? "[HYDRATION-ERR]"
      : "[PAGE-ERR]";
    console.log(`${tagged} ${e.split("\n")[0]}`);
    if (tagged === "[HYDRATION-ERR]") console.log(e);
  }
  const hits = [
    ...consoleMessages.filter((m) =>
      HYDRATION_PATTERNS.some((re) => re.test(m.text)),
    ),
    ...pageErrors.filter((e) => HYDRATION_PATTERNS.some((re) => re.test(e))),
  ];
  expect(
    hits,
    `[${label}] Hydration warnings/errors detected — see test output above for diff.`,
  ).toEqual([]);
}

// All scenarios share the demo-allocator credential. Running them in
// parallel hammers Supabase's per-email rate limiter and produces
// non-determinism unrelated to hydration. Serial mode keeps the probe
// reliable; the run takes ~30s either way because each scenario
// already loads two pages.
test.describe.configure({ mode: "serial" });

test.describe("wizard hydration probe", () => {
  test("API branch fresh load", async ({ page }) => {
    const { consoleMessages, pageErrors } = attachConsoleCapture(page);
    await loginAsAllocator(page);
    await page.goto("/strategies/new/wizard");
    await page.waitForLoadState("networkidle", { timeout: 15_000 });
    await page.waitForTimeout(2000);
    reportAndAssert("api-fresh", consoleMessages, pageErrors);
  });

  test("CSV branch fresh load", async ({ page }) => {
    const { consoleMessages, pageErrors } = attachConsoleCapture(page);
    await loginAsAllocator(page);
    await page.goto("/strategies/new/wizard?source=csv");
    await page.waitForLoadState("networkidle", { timeout: 15_000 });
    await page.waitForTimeout(2000);
    reportAndAssert("csv-fresh", consoleMessages, pageErrors);
  });

  test("API branch with localStorage draft pointer pre-set", async ({ page, context }) => {
    const { consoleMessages, pageErrors } = attachConsoleCapture(page);
    await loginAsAllocator(page);
    // Seed localStorage so the WizardClient `loaded` ref-init pattern
    // returns a non-null value on first client render — divergence with
    // SSR (which always sees null) is exactly what triggers #418 if the
    // dependent state is rendered.
    await context.addInitScript(() => {
      try {
        localStorage.setItem(
          "quantalyze:wizard:state:v2",
          JSON.stringify({
            wizardSessionId: "probe-session-id",
            strategyId: "probe-strategy-id",
            step: "metadata",
            source: "api",
            strategyName: "",
            ts: Date.now(),
          }),
        );
      } catch {
        // ignore storage errors
      }
    });
    await page.goto("/strategies/new/wizard");
    await page.waitForLoadState("networkidle", { timeout: 15_000 });
    await page.waitForTimeout(2000);
    reportAndAssert("api-with-localstorage", consoleMessages, pageErrors);
  });

  test("post-login redirect chain ends without hydration error", async ({ page }) => {
    // Some hydration mismatches are triggered by client-side router
    // redirects that race with the SSR initial paint. Simulate by
    // hitting /strategies first (which redirects) before bouncing to
    // the wizard.
    const { consoleMessages, pageErrors } = attachConsoleCapture(page);
    await loginAsAllocator(page);
    await page.goto("/strategies");
    await page.waitForLoadState("networkidle", { timeout: 15_000 });
    await page.goto("/strategies/new/wizard");
    await page.waitForLoadState("networkidle", { timeout: 15_000 });
    await page.waitForTimeout(2000);
    reportAndAssert("redirect-chain", consoleMessages, pageErrors);
  });

});
