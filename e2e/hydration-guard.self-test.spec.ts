/**
 * Phase 169.1.1 SC-4 — proof that `e2e/helpers/hydration-guard.ts` bites.
 *
 * A guard that cannot fail is worse than none, so this spec drives the fixture
 * in both polarities with no app server (`page.setContent` only):
 *   - a page reporting the production #418 message fails its test;
 *   - a page reporting the dev-mode "Hydration failed …" message fails its test;
 *   - a page reporting an unrelated error passes.
 * The two failing cases are marked expected failures. If the guard stops
 * biting they PASS, which Playwright reports as a failure, so this spec goes
 * red exactly when the guard goes blind. It runs in CI's unseeded e2e list.
 *
 * Each case awaits the `weberror` event together with the `reportError` call,
 * so the event is delivered before fixture teardown runs. A plain sleep would
 * be a race that could let an expected failure pass for the wrong reason.
 */
import { test, expect } from "./helpers/hydration-guard";
import type { BrowserContext, Page } from "./helpers/hydration-guard";

async function reportPageError(page: Page, context: BrowserContext, message: string) {
  await page.setContent("<p>probe</p>");
  const [webError] = await Promise.all([
    context.waitForEvent("weberror"),
    page.evaluate((m) => reportError(new Error(m)), message),
  ]);
  // The event under test is the one this case reported, not some other error.
  expect(webError.error().message).toBe(message);
}

test.describe("hydration guard self-test", () => {
  test("a page reporting React #418 fails the test", async ({ page, context }) => {
    test.fail();
    await reportPageError(
      page,
      context,
      "Minified React error #418; visit https://react.dev/errors/418?args[]=text",
    );
  });

  test("a page reporting the dev hydration message fails the test", async ({ page, context }) => {
    test.fail();
    await reportPageError(
      page,
      context,
      "Hydration failed because the server rendered text didn't match the client.",
    );
  });

  test("a page reporting an unrelated error passes", async ({ page, context }) => {
    await reportPageError(page, context, "unrelated probe error");
  });
});
