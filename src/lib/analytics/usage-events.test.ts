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
  const captureImmediateSpy = vi.fn();
  const flushSpy = vi.fn(async () => undefined);
  const ctorSpy = vi.fn();
  const MockPostHog = class {
    // The wrapper uses captureImmediate (H-0416/M-0486): capture()+flush() is
    // inert in posthog-node 5.29.2. No `capture` method here — a regression to
    // capture() would call undefined → throw → caught → the captureImmediateSpy
    // assertions fail.
    captureImmediate = captureImmediateSpy;
    flush = flushSpy;
    constructor(key: string, opts: Record<string, unknown>) {
      ctorSpy(key, opts);
    }
  };
  return { captureImmediateSpy, flushSpy, ctorSpy, MockPostHog };
});

vi.mock("posthog-node", () => ({
  PostHog: POSTHOG_MOCK.MockPostHog,
}));

describe("src/lib/analytics/usage-events.ts — server-side wrapper", () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;
  const originalEnv = { ...process.env };

  beforeEach(async () => {
    POSTHOG_MOCK.captureImmediateSpy.mockClear();
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
    expect(POSTHOG_MOCK.captureImmediateSpy).not.toHaveBeenCalled();
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
      // Bounded retry budget so an inline-awaited captureImmediate can't hang a
      // request for ~9-20s on a PostHog incident (default 3×3s → 1×500ms).
      fetchRetryCount: 1,
      fetchRetryDelay: 500,
    });

    expect(POSTHOG_MOCK.captureImmediateSpy).toHaveBeenCalledTimes(1);
    expect(POSTHOG_MOCK.captureImmediateSpy.mock.calls[0][0]).toMatchObject({
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
    expect(POSTHOG_MOCK.captureImmediateSpy).toHaveBeenCalledTimes(3);
  });

  it("swallows capture errors so callers never observe a throw", async () => {
    process.env.NEXT_PUBLIC_POSTHOG_KEY = "phc_usage_test";
    POSTHOG_MOCK.captureImmediateSpy.mockImplementationOnce(() => {
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

  it("swallows a captureImmediate REJECTION so a live caller's after() never sees an unhandled rejection", async () => {
    // Unlike the for-quants wrapper, this one has LIVE callers (usage/session-
    // start, intro, alerts/[id]/acknowledge, alerts/ack). captureImmediate awaits
    // the HTTP POST and can reject (network/5xx); the in-try await must swallow it.
    process.env.NEXT_PUBLIC_POSTHOG_KEY = "phc_usage_test";
    POSTHOG_MOCK.captureImmediateSpy.mockRejectedValueOnce(
      new Error("simulated immediate-send 5xx"),
    );
    const { trackUsageEventServer, __resetUsageAnalyticsForTest } =
      await import("./usage-events");
    __resetUsageAnalyticsForTest();

    await expect(
      trackUsageEventServer("session_start", "user-rejects", { session_count: 1 }),
    ).resolves.toBeUndefined();
    expect(warnSpy).toHaveBeenCalled();
  });

  it("M-0487: $host falls back to a non-prod sentinel, never the literal quantalyze.com", async () => {
    process.env.NEXT_PUBLIC_POSTHOG_KEY = "phc_usage_test";
    delete process.env.NEXT_PUBLIC_SITE_URL;
    const { trackUsageEventServer, __resetUsageAnalyticsForTest } =
      await import("./usage-events");
    __resetUsageAnalyticsForTest();

    await trackUsageEventServer("session_start", "u-host", { session_count: 1 });

    const props = POSTHOG_MOCK.captureImmediateSpy.mock.calls[0][0].properties as Record<
      string,
      unknown
    >;
    // These are LIVE events (session/intro/alert), so the masquerade-as-prod bug
    // was real on any deploy with NEXT_PUBLIC_SITE_URL unset.
    expect(props.$host).toBe("unknown.local");
    expect(props.$host).not.toBe("quantalyze.com");
  });

  it("M-0487: $host uses NEXT_PUBLIC_SITE_URL when it is set", async () => {
    process.env.NEXT_PUBLIC_POSTHOG_KEY = "phc_usage_test";
    process.env.NEXT_PUBLIC_SITE_URL = "https://quantalyze-rho.vercel.app";
    const { trackUsageEventServer, __resetUsageAnalyticsForTest } =
      await import("./usage-events");
    __resetUsageAnalyticsForTest();

    await trackUsageEventServer("session_start", "u-host2", { session_count: 1 });

    const props = POSTHOG_MOCK.captureImmediateSpy.mock.calls[0][0].properties as Record<
      string,
      unknown
    >;
    expect(props.$host).toBe("https://quantalyze-rho.vercel.app");
  });
});
