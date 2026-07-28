import { describe, it, expect, vi, beforeEach, afterEach, afterAll } from "vitest";
import {
  checkLimit,
  getClientIp,
  isRateLimitMisconfigured,
  sanitizeInetForDb,
} from "./ratelimit";
import type { Ratelimit } from "@upstash/ratelimit";

/**
 * SEAMRIM-04 — the scheduling seam and the capture chokepoint, doubled.
 *
 * `after()` is partial-mocked so `NextResponse` (which `rateLimitDenyJson` and
 * `rateLimitDenyText` return) keeps working. The double RUNS the task, as the
 * platform does once the response has flushed.
 */
const seam = vi.hoisted(() => ({
  captures: [] as Array<{
    err: unknown;
    options: { tags?: Record<string, string>; level?: string; extra?: Record<string, unknown> };
  }>,
  afterTasks: [] as unknown[],
  afterSettled: [] as Array<Promise<unknown>>,
}));

vi.mock("next/server", async () => {
  const actual = await vi.importActual<typeof import("next/server")>(
    "next/server",
  );
  return {
    ...actual,
    after: (task: unknown) => {
      seam.afterTasks.push(task);
      const produced =
        typeof task === "function" ? (task as () => unknown)() : task;
      seam.afterSettled.push(Promise.resolve(produced));
    },
  };
});

vi.mock("./sentry-capture", () => ({
  // RETURNS A PROMISE, as the real leaf does since plan 140.4-06 task 1: a
  // double returning `undefined` would make the production `after(() => p…)`
  // shape throw here and nowhere else.
  captureToSentry: (err: unknown, options: Record<string, unknown>) => {
    seam.captures.push({
      err,
      options: options as {
        tags?: Record<string, string>;
        level?: string;
        extra?: Record<string, unknown>;
      },
    });
    return Promise.resolve();
  },
}));

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
  // Snapshot + restore VERCEL_ENV across the suite. The P709 tests flip
  // VERCEL_ENV to 'production' to exercise fail-CLOSED; without an explicit
  // restore the next file's tests (or the next test in this file) would
  // see the wrong env. NODE_ENV is also restored for the CI-regression
  // case below which asserts that NODE_ENV=production + VERCEL_ENV unset
  // still fails-OPEN.
  const ORIGINAL_VERCEL_ENV = process.env.VERCEL_ENV;
  const ORIGINAL_NODE_ENV = process.env.NODE_ENV;

  beforeEach(() => {
    vi.restoreAllMocks();
    seam.captures.length = 0;
    seam.afterTasks.length = 0;
    seam.afterSettled.length = 0;
  });

  afterEach(() => {
    const env = process.env as Record<string, string | undefined>;
    if (ORIGINAL_VERCEL_ENV === undefined) {
      delete env.VERCEL_ENV;
    } else {
      env.VERCEL_ENV = ORIGINAL_VERCEL_ENV;
    }
    if (ORIGINAL_NODE_ENV === undefined) {
      delete env.NODE_ENV;
    } else {
      env.NODE_ENV = ORIGINAL_NODE_ENV;
    }
  });

  it("returns success when limiter is null (no Upstash configured, non-prod)", async () => {
    // Force a non-production VERCEL_ENV so the missing-limiter branch
    // exercises the fail-OPEN dev path.
    delete (process.env as Record<string, string | undefined>).VERCEL_ENV;
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
    delete (process.env as Record<string, string | undefined>).VERCEL_ENV;
    // Suppress the expected error log so the test output stays clean.
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const mockLimiter = {
      limit: vi.fn().mockRejectedValue(new Error("Redis unavailable")),
    } as unknown as Ratelimit;
    const result = await checkLimit(mockLimiter, "user:abc");
    expect(result).toEqual({ success: true });
    // ⚠️ STRENGTHENED, NOT WEAKENED (TRAP-9). This assertion read
    //   expect(errSpy).toHaveBeenCalledWith("[ratelimit] check failed:", expect.any(Error));
    // which pinned the raw `Error` OBJECT — i.e. it pinned the leak in place.
    // The prefix is still asserted; the payload is now asserted to be the
    // SCRUBBED rendering, and the dedicated leak case below is what fails when
    // the scrub is removed.
    expect(errSpy).toHaveBeenCalledWith(
      "[ratelimit] check failed:",
      expect.stringContaining("Redis unavailable"),
    );
  });

  it("SEAMRIM-04 — the limiter's own store credential never reaches the log", async () => {
    // The store command carries `UPSTASH_REDIS_REST_TOKEN` in an Authorization
    // header and undici INLINES the outgoing request into the error it
    // produces. `resilient-fetch.ts` scrubs both of its store-rejection arms
    // for exactly this reason and names it verbatim; `checkLimit` logged the
    // raw error object, so the same store, reached through the same SDK,
    // spilled the same credential from the other module.
    delete (process.env as Record<string, string | undefined>).VERCEL_ENV;
    const TOKEN = "AX7zAAIncDEyMzQ1Njc4OTBhYmNkZWY";
    vi.stubEnv("UPSTASH_REDIS_REST_TOKEN", TOKEN);
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const mockLimiter = {
      limit: vi.fn().mockRejectedValue(
        new Error(
          "fetch failed\n  request: { headers: { authorization: 'Bearer " +
            TOKEN +
            "' } }",
        ),
      ),
    } as unknown as Ratelimit;

    await checkLimit(mockLimiter, "user:abc");

    const logged = errSpy.mock.calls.map((c) => c.map(String).join(" ")).join("\n");
    expect(
      logged,
      "The rate limiter logged its own Upstash bearer token. Anything in a " +
        "Vercel function log is readable by every operator and by log " +
        "aggregation — this is a credential disclosure, not a hygiene nit.",
    ).not.toContain(TOKEN);
    // Over-redaction is the same failure as under-redaction: the diagnosis has
    // to survive or the operator has to reproduce the outage to learn what the
    // log already knew.
    expect(logged).toContain("fetch failed");
    vi.unstubAllEnvs();
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
    (process.env as Record<string, string | undefined>).VERCEL_ENV =
      "production";
    const result = await checkLimit(null, "user:abc");
    expect(result.success).toBe(false);
    expect(isRateLimitMisconfigured(result)).toBe(true);
    if (isRateLimitMisconfigured(result)) {
      expect(result.reason).toBe("ratelimit_misconfigured");
    }
  });

  it("P709 — fails CLOSED in production when the limiter throws", async () => {
    (process.env as Record<string, string | undefined>).VERCEL_ENV =
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
    (process.env as Record<string, string | undefined>).VERCEL_ENV =
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
    (process.env as Record<string, string | undefined>).VERCEL_ENV =
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

  // ── PR #150 audit-2026-05-07 round-1 regression — CI fail-OPEN ──
  // `next start` sets NODE_ENV=production unconditionally, including in
  // the GitHub Actions e2e job where Upstash is intentionally unwired.
  // The first cut of P709 gated fail-CLOSED on NODE_ENV, which converted
  // every audit-log/GDPR-export call into a 503 and broke the
  // onboarding-funnel playwright spec at the "Download CSV (last 90
  // days)" step. The gate now keys off VERCEL_ENV — set to 'production'
  // only on real Vercel prod deploys, unset in CI / local `next start`.
  // This test fails without that switch.
  it("CI regression — NODE_ENV=production + VERCEL_ENV unset fails-OPEN (limiter null)", async () => {
    const env = process.env as Record<string, string | undefined>;
    env.NODE_ENV = "production";
    delete env.VERCEL_ENV;
    const result = await checkLimit(null, "user:abc");
    expect(result).toEqual({ success: true });
  });

  it("CI regression — NODE_ENV=production + VERCEL_ENV unset fails-OPEN on limiter throw", async () => {
    const env = process.env as Record<string, string | undefined>;
    env.NODE_ENV = "production";
    delete env.VERCEL_ENV;
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const mockLimiter = {
      limit: vi.fn().mockRejectedValue(new Error("Redis unavailable")),
    } as unknown as Ratelimit;
    const result = await checkLimit(mockLimiter, "user:abc");
    expect(result).toEqual({ success: true });
    expect(errSpy).toHaveBeenCalled();
  });

  // ── SEAMRIM-04 — the THIRD posture becomes observable ────────────────
  //
  // `checkLimit` has never had two postures. `@upstash/ratelimit` 2.0.8 races a
  // 5 000 ms timeout that resolves `{ success: true, limit: 0, remaining: 0,
  // reset: 0, reason: "timeout" }` — "I could not reach the counter, let the
  // traffic through". Only `{ success, reset }` were destructured, so that
  // fail-OPEN was indistinguishable from a genuine allow: a regulatory cap
  // silently stopped being enforced and nothing anywhere recorded it.
  //
  // The posture is NOT changed by these cases. Traffic still passes.

  it("SEAMRIM-04 — the timeout sentinel still ALLOWS the request (posture unchanged)", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const mockLimiter = {
      // The library's sentinel, HAND-TYPED. Never imported, so this double
      // cannot inherit a change to the shape it is standing in for.
      limit: vi.fn().mockResolvedValue({
        success: true,
        limit: 0,
        remaining: 0,
        reset: 0,
        reason: "timeout",
      }),
    } as unknown as Ratelimit;

    const result = await checkLimit(mockLimiter, "user:abc");

    expect(
      result,
      "The timeout sentinel changed what checkLimit RETURNS. This plan makes " +
        "the third posture observable; making the limiter fail CLOSED on a " +
        "hanging store is a different decision with its own blast radius.",
    ).toEqual({ success: true });
  });

  it("SEAMRIM-04 — the timeout sentinel is RECORDED, and the capture is scheduled", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const mockLimiter = {
      limit: vi.fn().mockResolvedValue({
        success: true,
        limit: 0,
        remaining: 0,
        reset: 0,
        reason: "timeout",
      }),
    } as unknown as Ratelimit;

    await checkLimit(mockLimiter, "user:abc");
    await Promise.all(seam.afterSettled);

    expect(
      seam.captures,
      "The limiter's store timed out, the cap was NOT enforced for this " +
        "request, and nothing recorded it. A limiter whose store is missing " +
        "silently removes a regulatory cap.",
    ).toHaveLength(1);
    expect(seam.captures[0].options.level).toBe("warning");
    expect(seam.afterTasks).toHaveLength(1);
    // The operator's local trace survives alongside the capture.
    expect(
      warnSpy.mock.calls.map((c) => String(c[0])).join("\n"),
    ).toContain("[ratelimit]");
  });

  it("SEAMRIM-04 NEGATIVE CONTROL — a genuine allow records NOTHING", async () => {
    // Without this, "the sentinel is recorded" is satisfied by an
    // implementation that records on every single request.
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const mockLimiter = {
      limit: vi.fn().mockResolvedValue({
        success: true,
        limit: 10,
        remaining: 9,
        reset: Date.now() + 60_000,
      }),
    } as unknown as Ratelimit;

    const result = await checkLimit(mockLimiter, "user:abc");

    expect(result).toEqual({ success: true });
    expect(seam.captures).toHaveLength(0);
    expect(seam.afterTasks).toHaveLength(0);
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it("SEAMRIM-04 NEGATIVE CONTROL — a genuine DENY records nothing either", async () => {
    // `cacheBlock` and a plain over-limit deny are real denials, not fail-opens.
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const mockLimiter = {
      limit: vi.fn().mockResolvedValue({
        success: false,
        limit: 10,
        remaining: 0,
        reset: Date.now() + 30_000,
        reason: "cacheBlock",
      }),
    } as unknown as Ratelimit;

    const result = await checkLimit(mockLimiter, "user:abc");

    expect(result.success).toBe(false);
    expect(seam.captures).toHaveLength(0);
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it("CI regression — VERCEL_ENV=preview fails-OPEN (limiter null)", async () => {
    // Vercel preview deploys should NOT fail-CLOSED on misconfig: they
    // are routinely spun up for PRs that may legitimately ship without
    // an Upstash binding. Real prod is gated on 'production' exactly.
    (process.env as Record<string, string | undefined>).VERCEL_ENV =
      "preview";
    const result = await checkLimit(null, "user:abc");
    expect(result).toEqual({ success: true });
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
  // PR-2 (2026-05-28) code-reviewer C1: x-real-ip is now ONLY trusted when
  // process.env.VERCEL === "1" (set by Vercel build env). Outside Vercel the
  // header is freely client-set, so a malicious client rotating it per
  // request would defeat bucket isolation.
  const ORIGINAL_VERCEL = process.env.VERCEL;
  beforeEach(() => {
    delete process.env.VERCEL;
  });
  afterAll(() => {
    if (ORIGINAL_VERCEL === undefined) delete process.env.VERCEL;
    else process.env.VERCEL = ORIGINAL_VERCEL;
  });

  it("prefers x-real-ip ONLY when running on Vercel (VERCEL=1 set)", () => {
    process.env.VERCEL = "1";
    const headers = new Headers({
      "x-real-ip": "9.10.11.12",
      "x-forwarded-for": "1.2.3.4, 5.6.7.8",
    });
    expect(getClientIp(headers)).toBe("9.10.11.12");
  });

  it("IGNORES x-real-ip when VERCEL is unset (self-hosted / dev / CI)", () => {
    // The whole point of this gate: when not on Vercel, x-real-ip is freely
    // client-set, so a bot rotating it per request would otherwise defeat
    // bucket isolation. Falls through to rightmost x-forwarded-for.
    const headers = new Headers({
      "x-real-ip": "9.10.11.12",
      "x-forwarded-for": "1.2.3.4, 5.6.7.8",
    });
    expect(getClientIp(headers)).toBe("5.6.7.8");
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

  it("returns 'unknown' when no IP headers are present (route-side defends with UA salt + aggregate cap)", () => {
    // PR-2 code-reviewer C1 was initially fixed with a UUID nonce, but
    // that broke for-quants-lead's documented `unknown:_aggregate` cap
    // (the aggregate key has to be a stable literal so all unknown-IP
    // requests can be globally capped). Reverted to "unknown"; routes
    // that want per-UA fairness compose their own salt (e.g.
    // `${base}:${ip}:${uaHash}`). See for-quants-lead/route.gaps.test.ts
    // for the canonical defense shape.
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
