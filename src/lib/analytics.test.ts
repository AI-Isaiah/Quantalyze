import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// `import "server-only"` throws in jsdom (Vitest's default test env) because
// the package guards against client-bundle inclusion. Stub it out so the
// server-only module under test can still be imported.
vi.mock("server-only", () => ({}));

/**
 * Unit tests for the server-side PostHog wrapper
 * (`src/lib/analytics.ts`).
 *
 * Shape of the system under test:
 *   - Lazy singleton `getServerClient()` creates a `PostHog` instance on
 *     first capture call.
 *   - When `NEXT_PUBLIC_POSTHOG_KEY` is unset, every capture is a no-op
 *     and exactly one startup warning is logged across N capture calls.
 *   - When the key is set, capture calls forward to `posthog-node.capture`
 *     and then `flush()`.
 *   - Transient capture errors must not throw into the caller.
 *
 * We mock `posthog-node` so tests never hit the network and can inspect
 * exactly what the wrapper does on each call.
 */

const POSTHOG_MOCK = vi.hoisted(() => {
  const captureSpy = vi.fn();
  const flushSpy = vi.fn(async () => undefined);
  const ctorSpy = vi.fn();
  const MockPostHog = class {
    capture = captureSpy;
    flush = flushSpy;
    constructor(key: string, opts: Record<string, unknown>) {
      ctorSpy(key, opts);
    }
  };
  return { captureSpy, flushSpy, ctorSpy, MockPostHog };
});

vi.mock("posthog-node", () => ({
  PostHog: POSTHOG_MOCK.MockPostHog,
}));

describe("src/lib/analytics.ts — server-side wrapper", () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;
  const originalEnv = { ...process.env };

  beforeEach(async () => {
    POSTHOG_MOCK.captureSpy.mockClear();
    POSTHOG_MOCK.flushSpy.mockClear();
    POSTHOG_MOCK.ctorSpy.mockClear();
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    // Reset the module-scoped singleton between tests.
    const mod = await import("./analytics");
    mod.__resetForQuantsAnalyticsForTest();
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    warnSpy.mockRestore();
  });

  it("is a no-op when NEXT_PUBLIC_POSTHOG_KEY is not set", async () => {
    delete process.env.NEXT_PUBLIC_POSTHOG_KEY;
    const { trackForQuantsEventServer, __resetForQuantsAnalyticsForTest } =
      await import("./analytics");
    __resetForQuantsAnalyticsForTest();

    await trackForQuantsEventServer("for_quants_view", "visitor-abc");
    await trackForQuantsEventServer("for_quants_cta_click", "visitor-abc");

    expect(POSTHOG_MOCK.ctorSpy).not.toHaveBeenCalled();
    expect(POSTHOG_MOCK.captureSpy).not.toHaveBeenCalled();
    expect(POSTHOG_MOCK.flushSpy).not.toHaveBeenCalled();
  });

  it("warns exactly once across multiple no-op capture calls", async () => {
    delete process.env.NEXT_PUBLIC_POSTHOG_KEY;
    const { trackForQuantsEventServer, __resetForQuantsAnalyticsForTest } =
      await import("./analytics");
    __resetForQuantsAnalyticsForTest();

    for (let i = 0; i < 5; i++) {
      await trackForQuantsEventServer("for_quants_view", `visitor-${i}`);
    }

    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy.mock.calls[0][0]).toContain(
      "NEXT_PUBLIC_POSTHOG_KEY not set",
    );
  });

  it("initializes a PostHog client and forwards captures when the key is set", async () => {
    process.env.NEXT_PUBLIC_POSTHOG_KEY = "phc_test_key";
    process.env.NEXT_PUBLIC_POSTHOG_HOST = "https://example.posthog.com";
    const { trackForQuantsEventServer, __resetForQuantsAnalyticsForTest } =
      await import("./analytics");
    __resetForQuantsAnalyticsForTest();

    await trackForQuantsEventServer("for_quants_view", "visitor-xyz", {
      referrer: "https://t.co/abc",
    });

    expect(POSTHOG_MOCK.ctorSpy).toHaveBeenCalledTimes(1);
    expect(POSTHOG_MOCK.ctorSpy.mock.calls[0][0]).toBe("phc_test_key");
    expect(POSTHOG_MOCK.ctorSpy.mock.calls[0][1]).toMatchObject({
      host: "https://example.posthog.com",
      flushAt: 1,
      flushInterval: 0,
    });

    expect(POSTHOG_MOCK.captureSpy).toHaveBeenCalledTimes(1);
    expect(POSTHOG_MOCK.captureSpy.mock.calls[0][0]).toMatchObject({
      distinctId: "visitor-xyz",
      event: "for_quants_view",
      properties: expect.objectContaining({
        referrer: "https://t.co/abc",
        source_layer: "server",
      }),
    });

    // No explicit flush — the constructor's flushAt: 1 handles it.
    expect(POSTHOG_MOCK.flushSpy).not.toHaveBeenCalled();
  });

  it("reuses the singleton PostHog client across multiple captures", async () => {
    process.env.NEXT_PUBLIC_POSTHOG_KEY = "phc_test_key";
    const { trackForQuantsEventServer, __resetForQuantsAnalyticsForTest } =
      await import("./analytics");
    __resetForQuantsAnalyticsForTest();

    await trackForQuantsEventServer("for_quants_view", "v-1");
    await trackForQuantsEventServer("for_quants_view", "v-2");
    await trackForQuantsEventServer("for_quants_view", "v-3");

    expect(POSTHOG_MOCK.ctorSpy).toHaveBeenCalledTimes(1);
    expect(POSTHOG_MOCK.captureSpy).toHaveBeenCalledTimes(3);
  });

  it("swallows capture errors so callers never observe a throw", async () => {
    process.env.NEXT_PUBLIC_POSTHOG_KEY = "phc_test_key";
    POSTHOG_MOCK.captureSpy.mockImplementationOnce(() => {
      throw new Error("simulated capture failure");
    });
    const { trackForQuantsEventServer, __resetForQuantsAnalyticsForTest } =
      await import("./analytics");
    __resetForQuantsAnalyticsForTest();

    await expect(
      trackForQuantsEventServer("for_quants_view", "visitor-throws"),
    ).resolves.toBeUndefined();
    expect(warnSpy).toHaveBeenCalled();
  });
});
