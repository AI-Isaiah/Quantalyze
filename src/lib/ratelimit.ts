import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";

/**
 * Upstash rate-limit helpers for sensitive routes.
 *
 * Graceful degradation: when UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN
 * are missing (e.g., local dev without an Upstash account), checkLimit()
 * returns { success: true } and logs a single startup warning. This keeps
 * `npm run dev` working without requiring every developer to create an
 * Upstash database.
 *
 * In production, the env vars are expected to be set in Vercel. If they go
 * missing in production, rate limiting silently allows everything — flagged
 * in the plan as a known prod-readiness gap that a canary job should detect.
 *
 * Complementary to the in-memory `acquirePdfSlot` semaphore in
 * `src/lib/puppeteer.ts`. The semaphore caps per-lambda Chromium concurrency
 * (OOM protection); these limiters cap cross-lambda request rate (abuse
 * protection). Both layers should stay in place.
 */

const redis =
  process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN
    ? Redis.fromEnv()
    : null;

if (!redis) {
  // Log once at module load, not per request.
  console.warn(
    "[ratelimit] UPSTASH_REDIS_REST_URL not configured — rate limiting disabled (all requests allowed through).",
  );
}

function makeLimiter(
  requests: number,
  window: `${number} s`,
): Ratelimit | null {
  if (!redis) return null;
  return new Ratelimit({
    redis,
    limiter: Ratelimit.slidingWindow(requests, window),
    analytics: true,
    prefix: "quantalyze",
  });
}

// 5 requests/minute per authenticated user — for sensitive POSTs like
// attestation and deletion requests.
export const userActionLimiter = makeLimiter(5, "60 s");

// 10 requests/minute per IP — for public GET endpoints like PDF routes
// that can be hit by crawlers or scrapers.
export const publicIpLimiter = makeLimiter(10, "60 s");

// 20 requests/minute per IP — for admin actions that burst-run during
// normal use (match queue operations, etc.). Reserved for future use.
export const adminActionLimiter = makeLimiter(20, "60 s");

export type CheckLimitResult =
  | { success: true }
  | { success: false; retryAfter: number };

/**
 * Consume one rate-limit token for the given identifier. Returns success
 * with retryAfter (seconds) when the limit is exceeded.
 */
export async function checkLimit(
  limiter: Ratelimit | null,
  identifier: string,
): Promise<CheckLimitResult> {
  if (!limiter) {
    return { success: true };
  }
  try {
    const { success, reset } = await limiter.limit(identifier);
    if (success) return { success: true };
    const retryAfter = Math.max(1, Math.ceil((reset - Date.now()) / 1000));
    return { success: false, retryAfter };
  } catch (err) {
    // If Upstash itself errors (network, rate-limit-on-ratelimit), fail open
    // rather than blocking a legitimate user.
    console.error("[ratelimit] check failed, failing open:", err);
    return { success: true };
  }
}

/**
 * Extract a client IP from Next.js request headers. Uses x-forwarded-for
 * (first entry, Vercel's standard) or x-real-ip as fallback. Returns
 * "unknown" if neither is set.
 */
export function getClientIp(headers: Headers): string {
  const forwarded = headers.get("x-forwarded-for");
  if (forwarded) {
    return forwarded.split(",")[0]?.trim() ?? "unknown";
  }
  const real = headers.get("x-real-ip");
  if (real) return real.trim();
  return "unknown";
}
