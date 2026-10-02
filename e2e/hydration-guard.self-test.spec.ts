/**
 * Phase 169.1.1 SC-4 — proof that `e2e/helpers/hydration-guard.ts` bites.
 *
 * A guard that cannot fail is worse than none, so this spec drives the fixture
 * in both polarities with no app server (`page.setContent` only):
 *   - a page reporting the production #418 message is RECORDED;
 *   - a page reporting the dev-mode "Hydration failed …" message is RECORDED;
 *   - a page reporting an unrelated error is NOT recorded.
 * Those three assert on `hydrationHits` directly, in the positive, so a failure
 * anywhere else (a listener that throws, an event that times out) fails them
 * instead of counting as the expected failure. The recorded hit is then cleared
 * so teardown passes.
 *
 * One case keeps `test.fail()`, the only way to cover the teardown assertion
 * itself: it leaves its hit in place, and its body first asserts the hit was
 * recorded, so the expected failure can only come from teardown. If teardown
 * stops throwing, the case PASSES and Playwright reports that as a failure.
 * It runs in CI's unseeded e2e list.
 *
 * Each case awaits the `weberror` event together with the `reportError` call,
 * so the event is delivered before fixture teardown runs. A plain sleep would
 * be a race that could let an expected failure pass for the wrong reason.
 */
import { test, expect, settleOpenPages } from "./helpers/hydration-guard";
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

const REACT_418 = "Minified React error #418; visit https://react.dev/errors/418?args[]=text";
const DEV_HYDRATION = "Hydration failed because the server rendered text didn't match the client.";

test.describe("hydration guard self-test", () => {
  test("a page reporting React #418 is recorded", async ({ page, context, hydrationHits }) => {
    await reportPageError(page, context, REACT_418);
    expect(hydrationHits).toHaveLength(1);
    expect(hydrationHits[0]).toContain("Minified React error #418");
    hydrationHits.length = 0; // expected hit: let teardown pass
  });

  test("a page reporting the dev hydration message is recorded", async ({
    page,
    context,
    hydrationHits,
  }) => {
    await reportPageError(page, context, DEV_HYDRATION);
    expect(hydrationHits).toHaveLength(1);
    expect(hydrationHits[0]).toContain("Hydration failed because the server rendered");
    hydrationHits.length = 0; // expected hit: let teardown pass
  });

  test("a page reporting an unrelated error is not recorded", async ({
    page,
    context,
    hydrationHits,
  }) => {
    await reportPageError(page, context, "unrelated probe error");
    expect(hydrationHits).toEqual([]);
  });

  test("a #418 reported after the test body is caught by the teardown drain", async ({
    page,
    context,
    hydrationHits,
  }) => {
    // A subresource held open by the test keeps the page's load event pending,
    // the way slow chunks keep React from hydrating before a spec ends. The
    // page reports #418 on load, so the error cannot arrive before release().
    let release!: () => void;
    const held = new Promise<void>((r) => (release = r));
    await page.route("http://hydration-guard.test/held.js", async (route) => {
      await held;
      await route.fulfill({ contentType: "text/javascript", body: "" });
    });
    await page.setContent(
      `<script>addEventListener("load", () => reportError(new Error(${JSON.stringify(REACT_418)})));</script>` +
        `<script src="http://hydration-guard.test/held.js" async></script><p>probe</p>`,
      { waitUntil: "domcontentloaded" },
    );
    // Where the test body would end: nothing has been reported yet.
    expect(hydrationHits).toEqual([]);
    release();
    await settleOpenPages(context);
    expect(hydrationHits).toHaveLength(1);
    expect(hydrationHits[0]).toContain("Minified React error #418");
    hydrationHits.length = 0; // expected hit: let teardown pass
  });

  test("a recorded hit left in place fails the test in teardown", async ({
    page,
    context,
    hydrationHits,
  }) => {
    test.fail();
    await reportPageError(page, context, REACT_418);
    // The body itself passes, so the expected failure can only be teardown's.
    expect(hydrationHits).toHaveLength(1);
  });
});
