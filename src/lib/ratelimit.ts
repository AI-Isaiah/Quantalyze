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
 * Extract a client IP from request headers for rate-limit bucketing.
 *
 * Ordering:
 *   1. `x-real-ip` — on Vercel this is the verified TCP peer and is
 *      NOT client-controllable. Trust it.
 *   2. `x-forwarded-for` as a fallback. We take the RIGHTMOST entry,
 *      not the leftmost: the leftmost is attacker-controllable (a bot
 *      can inject its own value per request), the rightmost is the
 *      last trusted proxy's write and is stable per client.
 *
 * Returns "unknown" when neither header is present. Callers should
 * treat the return value as a bucket key, not as ground truth.
 */
export function getClientIp(headers: Headers): string {
  const real = headers.get("x-real-ip");
  if (real) return real.trim();

  const forwarded = headers.get("x-forwarded-for");
  if (forwarded) {
    // Rightmost entry = last-hop proxy's write (harder to spoof).
    const parts = forwarded.split(",").map((p) => p.trim()).filter(Boolean);
    if (parts.length > 0) return parts[parts.length - 1];
  }

  return "unknown";
}

/**
 * Validate that a string is a real IPv4 or IPv6 address so it can be
 * safely stored in a Postgres `INET` column. Returns the IP if it
 * parses, `null` otherwise. A malformed `x-forwarded-for` header would
 * otherwise crash the whole insert with `invalid input syntax for type
 * inet`.
 */
export function sanitizeInetForDb(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed || trimmed === "unknown") return null;

  // Strip optional IPv6 brackets.
  const unbracketed = trimmed.replace(/^\[/, "").replace(/\]$/, "");

  // IPv4: four dot-separated octets, each 0-255.
  const ipv4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;
  const m4 = unbracketed.match(ipv4);
  if (m4) {
    if (m4.slice(1).every((o) => Number(o) >= 0 && Number(o) <= 255)) {
      return unbracketed;
    }
    return null;
  }

  // IPv6: hex + colons, optional zone id after `%`. Not a full validator
  // but catches the common malformed shapes Postgres rejects.
  const ipv6 = /^[0-9a-f:]+(%[0-9a-z]+)?$/i;
  if (ipv6.test(unbracketed) && unbracketed.includes(":")) {
    return unbracketed;
  }

  return null;
}
