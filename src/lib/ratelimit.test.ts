import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  checkLimit,
  getClientIp,
  isRateLimitMisconfigured,
  sanitizeInetForDb,
} from "./ratelimit";
import type { Ratelimit } from "@upstash/ratelimit";

/**
 * Unit tests for the Upstash rate limit helpers. These do NOT touch a real
 * Upstash database — every Ratelimit instance is mocked. The contract under
 * test is the public surface of `checkLimit` + `getClientIp`:
 *
 *   - graceful degradation when no limiter is provided (local dev path)
 *   - allow / deny passthrough when the limiter resolves
 *   - retryAfter math when the limiter blocks
 *   - fail-CLOSED behavior in production when Upstash is unconfigured
 *     OR throws (P709, audit-2026-05-07) — defaults to fail-OPEN in
 *     non-production environments to keep `npm run dev` ergonomic
 *   - x-forwarded-for / x-real-ip parsing for the IP-based limiter key
 */

describe("checkLimit", () => {
  // Snapshot + restore NODE_ENV across the suite. The P709 tests flip
  // NODE_ENV to 'production' to exercise fail-CLOSED; without an explicit
  // restore the next file's tests (or the next test in this file) would
  // see the wrong env.
  const ORIGINAL_NODE_ENV = process.env.NODE_ENV;

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    const env = process.env as Record<string, string | undefined>;
    if (ORIGINAL_NODE_ENV === undefined) {
      delete env.NODE_ENV;
    } else {
      env.NODE_ENV = ORIGINAL_NODE_ENV;
    }
  });

  it("returns success when limiter is null (no Upstash configured, non-prod)", async () => {
    // Force a non-production NODE_ENV so the missing-limiter branch
    // exercises the fail-OPEN dev path.
    (process.env as Record<string, string | undefined>).NODE_ENV = "test";
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

  it("fails open if the limiter throws in non-production", async () => {
    (process.env as Record<string, string | undefined>).NODE_ENV = "test";
    // Suppress the expected error log so the test output stays clean.
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const mockLimiter = {
      limit: vi.fn().mockRejectedValue(new Error("Redis unavailable")),
    } as unknown as Ratelimit;
    const result = await checkLimit(mockLimiter, "user:abc");
    expect(result).toEqual({ success: true });
    expect(errSpy).toHaveBeenCalledWith(
      "[ratelimit] check failed:",
      expect.any(Error),
    );
  });

  // ── P709 (audit-2026-05-07) — fail-CLOSED in production ─────────────
  // Two production failure modes are equivalent from a security
  // standpoint: missing env vars (Upstash never configured) and a
  // throwing limiter (Upstash temporarily unavailable). Both must surface
  // `reason: 'ratelimit_misconfigured'` so route handlers translate to
  // 503 Service Unavailable rather than silently allowing the request
  // through on cost-sensitive endpoints (GDPR export, CSV validate,
  // audit-log export). Pre-P709 both branches returned {success: true}.

  it("P709 — fails CLOSED in production when limiter is null (missing Upstash env)", async () => {
    (process.env as Record<string, string | undefined>).NODE_ENV =
      "production";
    const result = await checkLimit(null, "user:abc");
    expect(result.success).toBe(false);
    expect(isRateLimitMisconfigured(result)).toBe(true);
    if (isRateLimitMisconfigured(result)) {
      expect(result.reason).toBe("ratelimit_misconfigured");
    }
  });

  it("P709 — fails CLOSED in production when the limiter throws", async () => {
    (process.env as Record<string, string | undefined>).NODE_ENV =
      "production";
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const mockLimiter = {
      limit: vi.fn().mockRejectedValue(new Error("Redis unavailable")),
    } as unknown as Ratelimit;
    const result = await checkLimit(mockLimiter, "user:abc");
    expect(result.success).toBe(false);
    expect(isRateLimitMisconfigured(result)).toBe(true);
    if (isRateLimitMisconfigured(result)) {
      expect(result.reason).toBe("ratelimit_misconfigured");
    }
    expect(errSpy).toHaveBeenCalled();
  });

  it("P709 — production with a working limiter still allows successful requests", async () => {
    // Sanity check: production fail-CLOSED only fires on misconfig or
    // throw, NOT on a healthy allow path. A bug that hard-failed every
    // production request would also pass the two tests above, so this
    // companion test guards against that regression.
    (process.env as Record<string, string | undefined>).NODE_ENV =
      "production";
    const mockLimiter = {
      limit: vi.fn().mockResolvedValue({
        success: true,
        reset: Date.now() + 60_000,
      }),
    } as unknown as Ratelimit;
    const result = await checkLimit(mockLimiter, "user:abc");
    expect(result).toEqual({ success: true });
  });

  it("P709 — production with a working limiter still emits 429 on deny", async () => {
    // The other half of the production sanity check: a real over-limit
    // deny must remain a 429 (retryAfter), not get converted into a
    // 503 misconfig.
    (process.env as Record<string, string | undefined>).NODE_ENV =
      "production";
    const future = Date.now() + 30_000;
    const mockLimiter = {
      limit: vi.fn().mockResolvedValue({ success: false, reset: future }),
    } as unknown as Ratelimit;
    const result = await checkLimit(mockLimiter, "user:abc");
    expect(result.success).toBe(false);
    expect(isRateLimitMisconfigured(result)).toBe(false);
    if (!result.success && "retryAfter" in result) {
      expect(result.retryAfter).toBeGreaterThan(0);
    }
  });
});

describe("isRateLimitMisconfigured", () => {
  it("returns false for the success case", () => {
    expect(isRateLimitMisconfigured({ success: true })).toBe(false);
  });
  it("returns false for the throttled-with-retryAfter case", () => {
    expect(
      isRateLimitMisconfigured({ success: false, retryAfter: 42 }),
    ).toBe(false);
  });
  it("returns true for the misconfigured fail-CLOSED case", () => {
    expect(
      isRateLimitMisconfigured({
        success: false,
        retryAfter: 60,
        reason: "ratelimit_misconfigured",
      }),
    ).toBe(true);
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
