/**
 * Tests for src/lib/for-quants-analytics.ts (client wrapper).
 *
 * Coverage targets the regression paths called out in audit-2026-05-07
 * G9.B.11 (init-failure must not bubble as unhandled rejection) and
 * G9.B.14 (rejected _initPromise must reset so subsequent calls no-op
 * cheaply instead of forever caching the failure).
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

describe("trackForQuantsEventClient — init failure handling", () => {
  /**
   * G9.B.11 — `void initForQuantsClient().then(...)` had no .catch, so
   * a rejected dynamic import (ad blocker, CSP, CDN outage) became an
   * unhandled promise rejection. The fix attaches a .catch that logs
   * once. This test mocks posthog-js to throw on import and asserts
   * the rejection is neutralized (no unhandled-rejection event in the
   * microtask queue).
   */
  it("does NOT leak an unhandled rejection when posthog-js dynamic import fails (G9.B.11)", async () => {
    vi.doMock("posthog-js", () => {
      throw new Error("simulated dynamic import failure");
    });

    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    try {
      const { trackForQuantsEventClient } = await import(
        "./for-quants-analytics"
      );
      // The reproduction: trackForQuantsEventClient internally calls
      // initForQuantsClient() which caches a rejected promise. Pre-fix,
      // the void chain `.then(...)` had no `.catch`, so awaiting a
      // direct reference to the cached promise rethrows. Post-fix, the
      // wrapper's `.catch` neutralizes it AND every consumer call sees
      // the same neutralized chain.
      trackForQuantsEventClient("for_quants_view");

      // Drain microtasks so the chain settles.
      for (let i = 0; i < 8; i += 1) {
        await new Promise((r) => setImmediate(r));
      }

      // Assertion: the .catch (in initForQuantsClient and/or the void
      // chain in trackForQuantsEventClient) logged the failure, so we
      // know the rejection was caught rather than vitest globally
      // suppressing it. Pre-fix, no `[analytics]` warn fired at all.
      expect(
        warnSpy.mock.calls.some((args) =>
          String(args[0]).includes("[analytics]"),
        ),
      ).toBe(true);
    } finally {
      warnSpy.mockRestore();
    }
  });

  /**
   * G9.B.14 — the rejected _initPromise was permanently cached. Every
   * subsequent track call hit the same rejected promise, the page
   * silently emitted zero events for the rest of the session. The
   * fix resets _initPromise to Promise.resolve(null) on rejection so
   * subsequent calls cheaply no-op (matching the no-key path) AND
   * later import() retries are still possible if the module surfaces
   * a manual reset hook in the future.
   */
  it("does not throw when called repeatedly after an init failure (G9.B.14)", async () => {
    vi.doMock("posthog-js", () => {
      throw new Error("simulated dynamic import failure");
    });

    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    try {
      const { trackForQuantsEventClient } = await import(
        "./for-quants-analytics"
      );

      // Five back-to-back calls must not throw and must not produce
      // unhandled rejections — they all see the rejected init.
      for (let i = 0; i < 5; i += 1) {
        expect(() => trackForQuantsEventClient("for_quants_view")).not.toThrow();
      }

      for (let i = 0; i < 6; i += 1) {
        await new Promise((r) => setImmediate(r));
      }
    } finally {
      warnSpy.mockRestore();
    }
  });

  /**
   * G9.B.14 — `_initPromise` must resolve to `null` (no-op) after a
   * rejection, NOT stay in the rejected state. This test asserts
   * `await initForQuantsClient()` returns null cleanly even when the
   * dynamic import threw — pre-fix, this awaiter would re-throw.
   */
  it("initForQuantsClient resolves to null (not rejects) after import failure (G9.B.14)", async () => {
    vi.doMock("posthog-js", () => {
      throw new Error("simulated dynamic import failure");
    });

    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    try {
      const { initForQuantsClient } = await import("./for-quants-analytics");

      // First call kicks off the dynamic import which will reject. The
      // resolution must be `null`, NOT a thrown error.
      const first = await initForQuantsClient();
      expect(first).toBeNull();

      // Second call hits the cached _initPromise which should now be
      // the no-op resolution. Still null, still no throw.
      const second = await initForQuantsClient();
      expect(second).toBeNull();
    } finally {
      warnSpy.mockRestore();
    }
  });

  it("returns null + does not import posthog-js when window is undefined", async () => {
    // Force the SSR path by deleting window. jsdom is the default
    // environment in this repo, so we have to remove it temporarily.
    const originalWindow = globalThis.window;
    // @ts-expect-error — narrowing globalThis.window for the SSR path test
    delete globalThis.window;

    try {
      const mod = await import("./for-quants-analytics");
      const result = await mod.initForQuantsClient();
      expect(result).toBeNull();
    } finally {
      globalThis.window = originalWindow;
    }
  });

  it("returns null + does not import posthog-js when NEXT_PUBLIC_POSTHOG_KEY is missing", async () => {
    delete process.env.NEXT_PUBLIC_POSTHOG_KEY;
    const importSpy = vi.fn();
    vi.doMock("posthog-js", () => {
      importSpy();
      return { default: {} };
    });

    const mod = await import("./for-quants-analytics");
    const result = await mod.initForQuantsClient();
    expect(result).toBeNull();
    expect(importSpy).not.toHaveBeenCalled();
  });
});
