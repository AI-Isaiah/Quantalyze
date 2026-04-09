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
});
