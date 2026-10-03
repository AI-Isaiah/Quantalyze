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
 * Two cases keep `test.fail()`, the only way to cover teardown itself. One
 * leaves a recorded hit in place, and its body first asserts the hit was
 * recorded, so the expected failure can only come from teardown's assertion.
 * The other releases a late #418 only after its body has returned, so the
 * expected failure needs teardown's drain as well. If teardown stops throwing or stops
 * draining, the case PASSES and Playwright reports that as a failure.
 * It runs as its own blocking step of CI's `e2e-seeded` job, before the lane
 * boots (since Phase 164.9.4 the job takes no shared-test-db mutex), so a red
 * result fails the `frontend` check on a push or a same-repo PR. That job skips
 * on fork PRs and on docs-only PRs and pushes, where this spec does not run. `src/__tests__/e2e-seeded-hydration-guard.test.ts` pins it there.
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

/**
 * Open a page that reports #418 on its load event, with load held back by a
 * script the caller releases. This stands in for slow chunks that keep React
 * from hydrating before a spec ends. The error cannot arrive before release(),
 * and no sleep is involved.
 */
async function openPageWithHeldLoad(page: Page): Promise<() => void> {
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
  return release;
}
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

  test("settleOpenPages catches a #418 reported after the test body", async ({
    page,
    hydrationHits,
    context,
  }) => {
    const release = await openPageWithHeldLoad(page);
    // Where the test body would end: nothing has been reported yet.
    expect(hydrationHits).toEqual([]);
    release();
    await settleOpenPages(context);
    expect(hydrationHits).toHaveLength(1);
    expect(hydrationHits[0]).toContain("Minified React error #418");
    hydrationHits.length = 0; // expected hit: let teardown pass
  });

  test("teardown drains a #418 reported after the test body and fails the test", async ({
    page,
    hydrationHits,
  }) => {
    // Proves teardown itself runs the drain: the body ends with the error not
    // yet reported and does not drain. Only teardown's drain can record it,
    // and only teardown's assertion can then fail the test. If teardown stops
    // draining, it asserts an empty list, the case passes, and Playwright
    // reports the unexpected pass as a failure.
    test.fail();
    const release = await openPageWithHeldLoad(page);
    expect(hydrationHits).toEqual([]);
    // Released only after the body has returned, so load (and the #418) comes
    // well after teardown would assert if it did not drain. The drain waits on
    // the load EVENT, not on this delay, so the delay cannot make it pass.
    setTimeout(release, 1_500);
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
