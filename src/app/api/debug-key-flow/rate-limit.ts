import "server-only";

// Phase 16 / OBSERV-07 — BEST-EFFORT in-memory 5/hour/admin/warm-instance rate limiter.
//
// LIMITATIONS (acknowledged and accepted for Phase 16 diagnostic tool):
//   - Counter lives in module-scope `Map` — resets on every cold start.
//   - cross-instance slip: if Vercel routes a 6th request to a freshly-spun warm
//     instance, the limit does NOT carry over. Worst-case effective rate is
//     `5 * concurrent_warm_instances` per hour per admin.
//   - With <10 admins and typical Fluid Compute fan-out (1-5 warm instances per
//     region), the absolute bound is ~25 invocations/hour/admin. Acceptable for
//     a founder-only diagnostic tool.
//
// ESCALATION PATH (deferred):
//   If abuse is observed during the v1.x stability window, swap for Upstash
//   Redis (existing `@upstash/ratelimit` dep — see src/lib/ratelimit.ts for the
//   pattern). Phase 16 explicitly opts NOT to take that dependency for a 5/hour
//   limit on a 1-3 admin user count.

const WINDOW_MS = 60 * 60 * 1000; // 1 hour
const LIMIT = 5;

interface BucketEntry {
  count: number;
  windowStart: number;
}

const buckets = new Map<string, BucketEntry>();

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retry_after_seconds?: number;
}

/**
 * Check + increment the per-userId counter. Call exactly once per invocation.
 * Returns allowed=false if the user has hit the limit in the current window.
 *
 * Time source: Date.now() — replaceable via the optional `now` parameter for tests.
 *
 * BEST-EFFORT: see top-of-file LIMITATIONS block. This is NOT a hard cap.
 */
export function checkDebugKeyFlowRateLimit(
  userId: string,
  now: number = Date.now(),
): RateLimitResult {
  const existing = buckets.get(userId);
  if (!existing || now - existing.windowStart >= WINDOW_MS) {
    buckets.set(userId, { count: 1, windowStart: now });
    return { allowed: true, remaining: LIMIT - 1 };
  }
  if (existing.count >= LIMIT) {
    const retryAt = existing.windowStart + WINDOW_MS;
    return {
      allowed: false,
      remaining: 0,
      retry_after_seconds: Math.max(1, Math.ceil((retryAt - now) / 1000)),
    };
  }
  existing.count += 1;
  return { allowed: true, remaining: LIMIT - existing.count };
}

// Test-only — DO NOT call from production code.
export function __resetRateLimitState(): void {
  buckets.clear();
}
