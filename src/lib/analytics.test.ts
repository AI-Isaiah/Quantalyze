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
 *   - When the key is set, capture calls forward to
 *     `posthog-node.captureImmediate` (which awaits the HTTP POST; the inert
 *     capture()+flush() pattern is NOT used — see H-0416/M-0486).
 *   - Transient capture errors must not throw into the caller.
 *
 * We mock `posthog-node` so tests never hit the network and can inspect
 * exactly what the wrapper does on each call.
 */

const POSTHOG_MOCK = vi.hoisted(() => {
  const captureImmediateSpy = vi.fn();
  const flushSpy = vi.fn(async () => undefined);
  const ctorSpy = vi.fn();
  const MockPostHog = class {
    // The wrapper uses captureImmediate (H-0416/M-0486): capture()+flush() is
    // inert in posthog-node 5.29.2 (capture defers the enqueue, returns void, so
    // a same-tick flush sees an empty queue). No `capture` method here — a
    // regression to capture() would call undefined → throw → caught → the
    // "forwards" assertions on captureImmediateSpy would fail.
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

describe("src/lib/analytics.ts — server-side wrapper", () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;
  const originalEnv = { ...process.env };

  beforeEach(async () => {
    POSTHOG_MOCK.captureImmediateSpy.mockClear();
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
    expect(POSTHOG_MOCK.captureImmediateSpy).not.toHaveBeenCalled();
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

    expect(POSTHOG_MOCK.captureImmediateSpy).toHaveBeenCalledTimes(1);
    expect(POSTHOG_MOCK.captureImmediateSpy.mock.calls[0][0]).toMatchObject({
      distinctId: "visitor-xyz",
      event: "for_quants_view",
      properties: expect.objectContaining({
        referrer: "https://t.co/abc",
        source_layer: "server",
      }),
    });

    // NOTE: the serverless-safe-primitive contract (captureImmediate, not the
    // inert capture()+flush()) is the subject of the dedicated test below
    // ("uses captureImmediate per event…"). This test only proves the event is
    // forwarded with the right payload via the immediate primitive.
  });

  it("M-0487: $host falls back to a non-prod sentinel, never the literal quantalyze.com", async () => {
    process.env.NEXT_PUBLIC_POSTHOG_KEY = "phc_test_key";
    delete process.env.NEXT_PUBLIC_SITE_URL;
    const { trackForQuantsEventServer, __resetForQuantsAnalyticsForTest } =
      await import("./analytics");
    __resetForQuantsAnalyticsForTest();

    await trackForQuantsEventServer("for_quants_view", "v-host");

    const props = POSTHOG_MOCK.captureImmediateSpy.mock.calls[0][0].properties as Record<
      string,
      unknown
    >;
    // quantalyze.com is an unrelated WP site; the prod URL is
    // quantalyze-rho.vercel.app. A missing-env event must NOT masquerade as prod.
    expect(props.$host).toBe("unknown.local");
    expect(props.$host).not.toBe("quantalyze.com");
  });

  it("M-0487: $host uses NEXT_PUBLIC_SITE_URL when it is set", async () => {
    process.env.NEXT_PUBLIC_POSTHOG_KEY = "phc_test_key";
    process.env.NEXT_PUBLIC_SITE_URL = "https://quantalyze-rho.vercel.app";
    const { trackForQuantsEventServer, __resetForQuantsAnalyticsForTest } =
      await import("./analytics");
    __resetForQuantsAnalyticsForTest();

    await trackForQuantsEventServer("for_quants_view", "v-host2");

    const props = POSTHOG_MOCK.captureImmediateSpy.mock.calls[0][0].properties as Record<
      string,
      unknown
    >;
    expect(props.$host).toBe("https://quantalyze-rho.vercel.app");
  });

  // SEC-005-class regression guard (H-0416 / M-0486).
  //
  // posthog-node 5.29.2's capture() defers the enqueue behind an async
  // prepareEventMessage and returns void, so the naive capture()+`await flush()`
  // is INERT: a same-tick flush() finds an empty queue and short-circuits, and
  // the event ships only via the background timer, which Vercel Fluid Compute can
  // suspend before. The serverless-safe primitive is captureImmediate(), which
  // builds the batch and awaits the HTTP POST in the promise it returns — so the
  // awaited wrapper resolves only once the event is on the wire.
  //
  // This test pins that contract: exactly one captureImmediate PER event, and
  // flush() is NOT used (a regression to the inert capture()+flush() pattern
  // makes the wrapper call a now-absent capture() → the captureImmediate counts
  // drop to 0 and this goes RED).
  it("uses captureImmediate per event (not the inert capture()+flush()) so suspension can't drop it", async () => {
    process.env.NEXT_PUBLIC_POSTHOG_KEY = "phc_test_key";
    const { trackForQuantsEventServer, __resetForQuantsAnalyticsForTest } =
      await import("./analytics");
    __resetForQuantsAnalyticsForTest();

    await trackForQuantsEventServer("for_quants_view", "v-flush-1");
    expect(POSTHOG_MOCK.captureImmediateSpy).toHaveBeenCalledTimes(1);

    await trackForQuantsEventServer("for_quants_cta_click", "v-flush-2");
    // Per-event: a second event produces a second immediate send.
    expect(POSTHOG_MOCK.captureImmediateSpy).toHaveBeenCalledTimes(2);

    // flush() is the inert path — the wrapper must NOT rely on it.
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
    expect(POSTHOG_MOCK.captureImmediateSpy).toHaveBeenCalledTimes(3);
  });

  it("swallows capture errors so callers never observe a throw", async () => {
    process.env.NEXT_PUBLIC_POSTHOG_KEY = "phc_test_key";
    POSTHOG_MOCK.captureImmediateSpy.mockImplementationOnce(() => {
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

  it("swallows a captureImmediate REJECTION (network/5xx) so the caller's after() never sees an unhandled rejection", async () => {
    process.env.NEXT_PUBLIC_POSTHOG_KEY = "phc_test_key";
    // captureImmediate awaits the HTTP POST, so it can REJECT (network error,
    // PostHog 5xx) — distinct from the synchronous throw above. The await sits
    // inside the try, so the rejection must be swallowed and never propagate
    // into the caller's after()-wrapped await (analytics MUST NOT crash a route).
    POSTHOG_MOCK.captureImmediateSpy.mockRejectedValueOnce(
      new Error("simulated immediate-send 5xx"),
    );
    const { trackForQuantsEventServer, __resetForQuantsAnalyticsForTest } =
      await import("./analytics");
    __resetForQuantsAnalyticsForTest();

    await expect(
      trackForQuantsEventServer("for_quants_view", "visitor-rejects"),
    ).resolves.toBeUndefined();
    expect(warnSpy).toHaveBeenCalled();
  });
});
