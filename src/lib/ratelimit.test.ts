import { describe, it, expect, vi, beforeEach } from "vitest";
import { checkLimit, getClientIp, sanitizeInetForDb } from "./ratelimit";
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
  it("prefers x-real-ip because Vercel writes that header from the verified TCP peer", () => {
    const headers = new Headers({
      "x-real-ip": "9.10.11.12",
      "x-forwarded-for": "1.2.3.4, 5.6.7.8",
    });
    expect(getClientIp(headers)).toBe("9.10.11.12");
  });

  it("returns the rightmost x-forwarded-for entry when x-real-ip is missing", () => {
    // The leftmost entry is attacker-controllable; the rightmost is whatever
    // the last trusted proxy injected. Rate-limit bucketing uses the harder-
    // to-spoof value so a bot can't rotate its own XFF per request.
    const headers = new Headers({ "x-forwarded-for": "1.2.3.4, 5.6.7.8" });
    expect(getClientIp(headers)).toBe("5.6.7.8");
  });

  it("trims whitespace from x-forwarded-for entries", () => {
    const headers = new Headers({
      "x-forwarded-for": "  1.2.3.4  ,  5.6.7.8  ",
    });
    expect(getClientIp(headers)).toBe("5.6.7.8");
  });

  it("returns 'unknown' when no IP headers are present", () => {
    const headers = new Headers();
    expect(getClientIp(headers)).toBe("unknown");
  });
});

describe("sanitizeInetForDb", () => {
  it("returns null for null/undefined/empty/unknown", () => {
    expect(sanitizeInetForDb(null)).toBeNull();
    expect(sanitizeInetForDb(undefined)).toBeNull();
    expect(sanitizeInetForDb("")).toBeNull();
    expect(sanitizeInetForDb("unknown")).toBeNull();
  });

  it("accepts valid IPv4 addresses", () => {
    expect(sanitizeInetForDb("203.0.113.42")).toBe("203.0.113.42");
    expect(sanitizeInetForDb("127.0.0.1")).toBe("127.0.0.1");
  });

  it("rejects IPv4 with out-of-range octets", () => {
    expect(sanitizeInetForDb("256.0.0.1")).toBeNull();
    expect(sanitizeInetForDb("1.2.3.999")).toBeNull();
  });

  it("accepts bracketed and unbracketed IPv6", () => {
    expect(sanitizeInetForDb("::1")).toBe("::1");
    expect(sanitizeInetForDb("[::1]")).toBe("::1");
    expect(sanitizeInetForDb("2001:db8::1")).toBe("2001:db8::1");
  });

  it("rejects garbage strings that would crash the INET column", () => {
    expect(sanitizeInetForDb("not-an-ip")).toBeNull();
    expect(sanitizeInetForDb("1.2.3.4<script>")).toBeNull();
    expect(sanitizeInetForDb("1.2.3.4;DROP TABLE")).toBeNull();
  });
});
