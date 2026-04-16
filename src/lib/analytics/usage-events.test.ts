import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// `import "server-only"` throws in jsdom (Vitest's default test env) because
// the package guards against client-bundle inclusion. Stub it out so the
// server-only module under test can still be imported.
vi.mock("server-only", () => ({}));

/**
 * Unit tests for the server-side usage-funnel PostHog wrapper
 * (`src/lib/analytics/usage-events.ts`). Mirrors the shape of
 * `src/lib/analytics.test.ts` (the /for-quants funnel wrapper tests).
 *
 * Behavior under test:
 *   - When `NEXT_PUBLIC_POSTHOG_KEY` is unset, every capture is a no-op
 *     and exactly one startup warning is logged across N capture calls.
 *   - When the key is set, capture forwards to `posthog-node.capture`
 *     with `source_layer: "server"` and never throws.
 *   - The PostHog client is a lazy singleton — repeated capture calls
 *     reuse one constructor invocation.
 *   - Transient capture errors are swallowed so callers never see a
 *     thrown promise.
 *
 * `posthog-node` is mocked so tests never hit the network and can
 * inspect exactly what the wrapper does on each call.
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

describe("src/lib/analytics/usage-events.ts — server-side wrapper", () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;
  const originalEnv = { ...process.env };

  beforeEach(async () => {
    POSTHOG_MOCK.captureSpy.mockClear();
    POSTHOG_MOCK.flushSpy.mockClear();
    POSTHOG_MOCK.ctorSpy.mockClear();
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const mod = await import("./usage-events");
    mod.__resetUsageAnalyticsForTest();
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    warnSpy.mockRestore();
  });

  it("is a no-op and warns exactly once when NEXT_PUBLIC_POSTHOG_KEY is missing", async () => {
    delete process.env.NEXT_PUBLIC_POSTHOG_KEY;
    const { trackUsageEventServer, __resetUsageAnalyticsForTest } =
      await import("./usage-events");
    __resetUsageAnalyticsForTest();

    for (let i = 0; i < 4; i++) {
      await trackUsageEventServer("session_start", `user-${i}`, {
        session_count: i + 1,
      });
    }

    expect(POSTHOG_MOCK.ctorSpy).not.toHaveBeenCalled();
    expect(POSTHOG_MOCK.captureSpy).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy.mock.calls[0][0]).toContain(
      "NEXT_PUBLIC_POSTHOG_KEY not set",
    );
  });

  it("forwards captures with source_layer=server when the key is set", async () => {
    process.env.NEXT_PUBLIC_POSTHOG_KEY = "phc_usage_test";
    process.env.NEXT_PUBLIC_POSTHOG_HOST = "https://example.posthog.com";
    const { trackUsageEventServer, __resetUsageAnalyticsForTest } =
      await import("./usage-events");
    __resetUsageAnalyticsForTest();

    await trackUsageEventServer("intro_submitted", "user-abc", {
      strategy_id: "strat-123",
      source: "bridge",
    });

    expect(POSTHOG_MOCK.ctorSpy).toHaveBeenCalledTimes(1);
    expect(POSTHOG_MOCK.ctorSpy.mock.calls[0][0]).toBe("phc_usage_test");
    expect(POSTHOG_MOCK.ctorSpy.mock.calls[0][1]).toMatchObject({
      host: "https://example.posthog.com",
      flushAt: 1,
      flushInterval: 0,
    });

    expect(POSTHOG_MOCK.captureSpy).toHaveBeenCalledTimes(1);
    expect(POSTHOG_MOCK.captureSpy.mock.calls[0][0]).toMatchObject({
      distinctId: "user-abc",
      event: "intro_submitted",
      properties: expect.objectContaining({
        strategy_id: "strat-123",
        source: "bridge",
        source_layer: "server",
      }),
    });
  });

  it("reuses the singleton PostHog client across multiple captures", async () => {
    process.env.NEXT_PUBLIC_POSTHOG_KEY = "phc_usage_test";
    const { trackUsageEventServer, __resetUsageAnalyticsForTest } =
      await import("./usage-events");
    __resetUsageAnalyticsForTest();

    await trackUsageEventServer("session_start", "u-1", { session_count: 1 });
    await trackUsageEventServer("widget_viewed", "u-1", { widget_id: "kpi" });
    await trackUsageEventServer("alert_acknowledged", "u-1", {
      alert_id: "a-1",
    });

    expect(POSTHOG_MOCK.ctorSpy).toHaveBeenCalledTimes(1);
    expect(POSTHOG_MOCK.captureSpy).toHaveBeenCalledTimes(3);
  });

  it("swallows capture errors so callers never observe a throw", async () => {
    process.env.NEXT_PUBLIC_POSTHOG_KEY = "phc_usage_test";
    POSTHOG_MOCK.captureSpy.mockImplementationOnce(() => {
      throw new Error("simulated capture failure");
    });
    const { trackUsageEventServer, __resetUsageAnalyticsForTest } =
      await import("./usage-events");
    __resetUsageAnalyticsForTest();

    await expect(
      trackUsageEventServer("bridge_click", "user-throws", {
        strategy_id: "strat-x",
      }),
    ).resolves.toBeUndefined();
    expect(warnSpy).toHaveBeenCalled();
  });
});
