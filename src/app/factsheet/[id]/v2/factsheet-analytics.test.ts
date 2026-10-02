/** @vitest-environment jsdom */
/**
 * Phase 164 / SHARE-01 — product analytics must not fire on the recipient
 * share lane.
 *
 * WHAT THIS PROTECTS. `FactsheetView` is rendered by BOTH lanes. On the
 * recipient lane the page's own URL is a live capability token, and PostHog's
 * browser SDK attaches `$current_url` to every capture — so a single toggle
 * click would ship the token to a third party. The failure is silent: the
 * factsheet renders correctly and nothing logs.
 *
 * ⛔ THE ORACLE IS THE POSTHOG IMPORT, not a boolean the module exports. The
 * assertion is that `posthog-js` is never even dynamically imported on the
 * share lane — a check that a "returns early but still initialises" regression
 * cannot pass. `capture` counts are asserted too, for the positive case.
 *
 * ⚠️ The CSP's `connect-src` omitting the PostHog host is NOT what these tests
 * are pinning. A CSP accident is not a mitigation (Pitfall 6); this gate is.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const captureMock = vi.hoisted(() => vi.fn());
const initMock = vi.hoisted(() => vi.fn());
/** Counts how many times the posthog-js MODULE was resolved at all. */
const moduleLoadMock = vi.hoisted(() => vi.fn());
vi.mock("posthog-js", () => {
  moduleLoadMock();
  return { default: { init: initMock, capture: captureMock } };
});

import { trackFactsheetEvent } from "./factsheet-analytics";

/** 43 base64url chars — the shape `deriveShareToken` emits. */
const TOKEN = "Xk3pQ9vLm2Rt7Wb1Yz4Nc6Hs8Jd0Fg5Aq3Ue7Ip9Ov";

const savedKey = process.env.NEXT_PUBLIC_POSTHOG_KEY;

/**
 * `trackFactsheetEvent` is fire-and-forget over a dynamic `import()` chain, so
 * there is nothing to await. Two macrotask turns drain the import resolution
 * AND the `.then` that captures — enough that a NEGATIVE assertion means "the
 * capture never happens", not "it has not happened yet".
 */
async function flush() {
  await new Promise((r) => setTimeout(r, 0));
  await new Promise((r) => setTimeout(r, 0));
}

function setPathname(pathname: string) {
  // jsdom's location is not writable; navigating within the same origin via
  // history keeps `window.location.pathname` honest without a full stub.
  window.history.replaceState({}, "", pathname);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.resetModules();
  process.env.NEXT_PUBLIC_POSTHOG_KEY = "phc_test_key";
});
afterEach(() => {
  if (savedKey === undefined) delete process.env.NEXT_PUBLIC_POSTHOG_KEY;
  else process.env.NEXT_PUBLIC_POSTHOG_KEY = savedKey;
});

describe("[164 SHARE-01] recipient lane fires no product analytics", () => {
  it.each([
    `/factsheet-share/${TOKEN}`,
    "/factsheet-share/gone",
    "/factsheet-share",
  ])("no-ops on %j — posthog-js is never even imported", async (pathname) => {
    setPathname(pathname);

    trackFactsheetEvent("factsheet_v2_view", { id: "abc" });
    // Drain everything the non-share path WOULD have scheduled, so "not
    // called" means "never happens", not "has not happened yet".
    await flush();

    expect(moduleLoadMock, "the PostHog bundle must not load").not.toHaveBeenCalled();
    expect(initMock).not.toHaveBeenCalled();
    expect(captureMock).not.toHaveBeenCalled();
  });
});

describe("[164 SHARE-01] every other lane still tracks", () => {
  it("fires normally on the id route", async () => {
    setPathname("/factsheet/44444444-4444-4444-8444-444444444444/v2");

    trackFactsheetEvent("factsheet_v2_toggle_dark", { on: true });
    await flush();

    expect(captureMock).toHaveBeenCalledTimes(1);
    expect(captureMock.mock.calls[0][0]).toBe("factsheet_v2_toggle_dark");
    expect(captureMock.mock.calls[0][1]).toMatchObject({
      on: true,
      source_layer: "factsheet_v2",
    });
  });

  it("fires on a prefix-ADJACENT path — the gate must not over-match", async () => {
    setPathname("/factsheet-shareholders");

    trackFactsheetEvent("factsheet_v2_view");
    await flush();

    expect(captureMock).toHaveBeenCalledTimes(1);
  });
});
