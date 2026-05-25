import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { warmupAnalytics } from "./warmup-analytics";

describe("warmupAnalytics", () => {
  const originalUrl = process.env.ANALYTICS_SERVICE_URL;

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    if (originalUrl) {
      process.env.ANALYTICS_SERVICE_URL = originalUrl;
    } else {
      delete process.env.ANALYTICS_SERVICE_URL;
    }
  });

  it("is a no-op when ANALYTICS_SERVICE_URL is unset", () => {
    delete process.env.ANALYTICS_SERVICE_URL;
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(null, { status: 200 }));
    expect(() => warmupAnalytics()).not.toThrow();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("issues a GET to /health when env is set", () => {
    process.env.ANALYTICS_SERVICE_URL = "https://analytics.example.com";
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(null, { status: 200 }));
    warmupAnalytics();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [calledUrl, init] = fetchMock.mock.calls[0];
    expect(String(calledUrl)).toBe("https://analytics.example.com/health");
    expect(init?.method).toBe("GET");
    expect(init?.cache).toBe("no-store");
  });

  it("strips trailing slashes from the base URL", () => {
    process.env.ANALYTICS_SERVICE_URL = "https://analytics.example.com///";
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(null, { status: 200 }));
    warmupAnalytics();
    expect(String(fetchMock.mock.calls[0][0])).toBe(
      "https://analytics.example.com/health",
    );
  });

  it("never throws when fetch synchronously throws", () => {
    process.env.ANALYTICS_SERVICE_URL = "https://analytics.example.com";
    vi.spyOn(globalThis, "fetch").mockImplementation(() => {
      throw new Error("network unavailable");
    });
    expect(() => warmupAnalytics()).not.toThrow();
  });

  it("never throws when fetch returns a rejected promise", async () => {
    process.env.ANALYTICS_SERVICE_URL = "https://analytics.example.com";
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("cold"));
    expect(() => warmupAnalytics()).not.toThrow();
    // Allow the .catch to run so the rejection is fully consumed.
    await Promise.resolve();
    await Promise.resolve();
  });

  // M-0587 — the abort-after-timeout and clearTimeout-on-settle branches were
  // never exercised: the suite called vi.useFakeTimers() but never advanced
  // them. A regression replacing `setTimeout(() => controller.abort(), …)`
  // with a no-op (leaking the in-flight fetch indefinitely), or dropping the
  // `.finally(() => clearTimeout(timeout))` (leaking the timer), would not
  // fail any test. These two assert the timer wiring directly.

  it("aborts the in-flight fetch via AbortController after WARMUP_TIMEOUT_MS", async () => {
    process.env.ANALYTICS_SERVICE_URL = "https://analytics.example.com";
    // Capture the signal handed to fetch; resolve never so the abort timer
    // is the only thing that can settle the request.
    let capturedSignal: AbortSignal | undefined;
    vi.spyOn(globalThis, "fetch").mockImplementation(
      (_url, init?: RequestInit) => {
        capturedSignal = init?.signal ?? undefined;
        return new Promise<Response>(() => {
          /* never resolves — simulates a cold worker */
        });
      },
    );

    warmupAnalytics();
    expect(capturedSignal).toBeDefined();
    expect(capturedSignal?.aborted).toBe(false);

    // The 10s warmup ceiling has not elapsed yet.
    vi.advanceTimersByTime(9_999);
    expect(capturedSignal?.aborted).toBe(false);

    // Cross the ceiling — controller.abort() must fire.
    vi.advanceTimersByTime(2);
    expect(capturedSignal?.aborted).toBe(true);
  });

  it("clears the abort timer once the fetch settles (success path) so it never fires", async () => {
    process.env.ANALYTICS_SERVICE_URL = "https://analytics.example.com";
    const clearSpy = vi.spyOn(globalThis, "clearTimeout");
    let capturedSignal: AbortSignal | undefined;
    vi.spyOn(globalThis, "fetch").mockImplementation(
      (_url, init?: RequestInit) => {
        capturedSignal = init?.signal ?? undefined;
        return Promise.resolve(new Response(null, { status: 200 }));
      },
    );

    warmupAnalytics();
    // Drain microtasks so the .finally(() => clearTimeout(timeout)) runs.
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(clearSpy).toHaveBeenCalled();

    // Timer was cleared, so advancing past the ceiling must NOT abort the
    // (already-settled) request.
    vi.advanceTimersByTime(20_000);
    expect(capturedSignal?.aborted).toBe(false);
  });
});
