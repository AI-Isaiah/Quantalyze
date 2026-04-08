import { describe, it, expect, vi, beforeEach } from "vitest";
import { checkLimit, getClientIp } from "./ratelimit";
import type { Ratelimit } from "@upstash/ratelimit";

/**
 * Unit tests for the Upstash rate limit helpers. These do NOT touch a real
 * Upstash database — every Ratelimit instance is mocked. The contract under
 * test is the public surface of `checkLimit` + `getClientIp`:
 *
 *   - graceful degradation when no limiter is provided (local dev path)
 *   - allow / deny passthrough when the limiter resolves
 *   - retryAfter math when the limiter blocks
 *   - fail-open behavior when the limiter throws (Upstash unavailable)
 *   - x-forwarded-for / x-real-ip parsing for the IP-based limiter key
 */

describe("checkLimit", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("returns success when limiter is null (no Upstash configured)", async () => {
    const result = await checkLimit(null, "user:abc");
    expect(result).toEqual({ success: true });
  });

  it("returns success when the limiter allows the request", async () => {
    const mockLimiter = {
      limit: vi.fn().mockResolvedValue({
        success: true,
        reset: Date.now() + 60_000,
      }),
    } as unknown as Ratelimit;
    const result = await checkLimit(mockLimiter, "user:abc");
    expect(result).toEqual({ success: true });
  });

  it("returns retryAfter when the limiter blocks the request", async () => {
    const future = Date.now() + 45_000;
    const mockLimiter = {
      limit: vi.fn().mockResolvedValue({ success: false, reset: future }),
    } as unknown as Ratelimit;
    const result = await checkLimit(mockLimiter, "user:abc");
    expect(result.success).toBe(false);
    if (!result.success) {
      // Allow a few seconds of slop so the test isn't flaky on slow CI.
      expect(result.retryAfter).toBeGreaterThanOrEqual(44);
      expect(result.retryAfter).toBeLessThanOrEqual(46);
    }
  });

  it("clamps retryAfter to a minimum of 1 second when the reset is in the past", async () => {
    const past = Date.now() - 5_000;
    const mockLimiter = {
      limit: vi.fn().mockResolvedValue({ success: false, reset: past }),
    } as unknown as Ratelimit;
    const result = await checkLimit(mockLimiter, "user:abc");
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.retryAfter).toBe(1);
    }
  });

  it("fails open if the limiter throws", async () => {
    // Suppress the expected error log so the test output stays clean.
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const mockLimiter = {
      limit: vi.fn().mockRejectedValue(new Error("Redis unavailable")),
    } as unknown as Ratelimit;
    const result = await checkLimit(mockLimiter, "user:abc");
    expect(result).toEqual({ success: true });
    expect(errSpy).toHaveBeenCalledWith(
      "[ratelimit] check failed, failing open:",
      expect.any(Error),
    );
  });
});

describe("getClientIp", () => {
  it("returns first x-forwarded-for entry", () => {
    const headers = new Headers({ "x-forwarded-for": "1.2.3.4, 5.6.7.8" });
    expect(getClientIp(headers)).toBe("1.2.3.4");
  });

  it("trims whitespace from x-forwarded-for entries", () => {
    const headers = new Headers({ "x-forwarded-for": "  1.2.3.4  , 5.6.7.8" });
    expect(getClientIp(headers)).toBe("1.2.3.4");
  });

  it("falls back to x-real-ip when x-forwarded-for is missing", () => {
    const headers = new Headers({ "x-real-ip": "9.10.11.12" });
    expect(getClientIp(headers)).toBe("9.10.11.12");
  });

  it("returns 'unknown' when no IP headers are present", () => {
    const headers = new Headers();
    expect(getClientIp(headers)).toBe("unknown");
  });
});
