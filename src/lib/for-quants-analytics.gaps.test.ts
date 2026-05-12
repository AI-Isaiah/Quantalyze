/**
 * Gap-coverage tests for src/lib/for-quants-analytics.ts.
 *
 * The companion `for-quants-analytics.test.ts` covers the dynamic-import
 * REJECTION branch of G9.B.14 (`vi.doMock("posthog-js", () => { throw })`)
 * and the SSR / no-key paths. This file pins the two branches that suite
 * does not exercise:
 *
 *   1. G9.B.14 inner branch — `posthog.init()` itself throws after a
 *      successful dynamic import (corrupt local storage, ad-blocker
 *      mid-init injection). The route's catch resets `_initPromise` to
 *      `Promise.resolve(null)` so subsequent track calls cheaply no-op
 *      instead of awaiting a half-initialized instance.
 *   2. capture throw — `posthog.capture()` itself throws inside
 *      `trackForQuantsEventClient`. The inner try/catch in the source
 *      (route.ts:101-111) MUST swallow the error so the visitor's page
 *      doesn't surface a posthog runtime failure as an unhandled
 *      rejection.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const originalKey = process.env.NEXT_PUBLIC_POSTHOG_KEY;

beforeEach(() => {
  vi.resetModules();
  process.env.NEXT_PUBLIC_POSTHOG_KEY = "phc_test_key";
});

afterEach(() => {
  if (originalKey === undefined) {
    delete process.env.NEXT_PUBLIC_POSTHOG_KEY;
  } else {
    process.env.NEXT_PUBLIC_POSTHOG_KEY = originalKey;
  }
});

describe("initForQuantsClient — posthog.init throw branch (G9.B.14)", () => {
  it("resolves to null (does NOT reject) when posthog.init throws after a successful import", async () => {
    // Dynamic import succeeds, but the SDK's init() throws — e.g.
    // corrupt sessionStorage, ad-blocker injecting a stub, etc. The
    // existing analytics test stubs the import itself; this test
    // exercises the `try { posthog.init(...) } catch` path inside
    // `.then((mod) => ...)` (route.ts:38-60).
    vi.doMock("posthog-js", () => ({
      default: {
        init: vi.fn(() => {
          throw new Error("simulated init failure (corrupt storage)");
        }),
        capture: vi.fn(),
      },
    }));

    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    try {
      const { initForQuantsClient } = await import("./for-quants-analytics");

      const first = await initForQuantsClient();
      expect(first).toBeNull();

      // Second call must hit the cached null-resolution promise — NOT
      // re-attempt init or re-throw. Pre-fix this would have left the
      // half-initialized posthog instance cached and every subsequent
      // capture would have crashed.
      const second = await initForQuantsClient();
      expect(second).toBeNull();

      // The init-throw warn is the diagnostic ops looks for.
      expect(
        warnSpy.mock.calls.some((args) =>
          String(args[0]).includes("posthog.init failed"),
        ),
      ).toBe(true);
    } finally {
      warnSpy.mockRestore();
    }
  });
});

describe("trackForQuantsEventClient — capture throw branch", () => {
  it("swallows a posthog.capture() exception (no unhandled rejection, single warn)", async () => {
    // posthog initializes cleanly, but capture itself throws — e.g.
    // an ad-blocker tampering with the global, or a local-storage
    // quota error. The wrapper at for-quants-analytics.ts:101-111
    // wraps capture in try/catch precisely so this never surfaces as
    // an unhandled rejection in the visitor's tab.
    const captureSpy = vi.fn(() => {
      throw new Error("simulated capture failure");
    });
    vi.doMock("posthog-js", () => ({
      default: {
        init: vi.fn(),
        capture: captureSpy,
      },
    }));

    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    try {
      const { trackForQuantsEventClient } = await import(
        "./for-quants-analytics"
      );
      // Synchronous call — the void chain settles in the microtask queue.
      expect(() =>
        trackForQuantsEventClient("for_quants_view"),
      ).not.toThrow();

      // Drain the chain: init().then(capture) → catch → warn.
      for (let i = 0; i < 6; i += 1) {
        await new Promise((r) => setImmediate(r));
      }

      // capture WAS called — proof the chain reached the throwing arm.
      expect(captureSpy).toHaveBeenCalledTimes(1);
      // The wrapper logged the failure as a warn (NOT error) — pre-
      // throw-handling, this would have surfaced as an unhandled
      // promise rejection at the page level.
      expect(
        warnSpy.mock.calls.some((args) =>
          String(args[0]).includes("client capture failed"),
        ),
      ).toBe(true);
    } finally {
      warnSpy.mockRestore();
      errorSpy.mockRestore();
    }
  });
});
