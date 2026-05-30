/**
 * Shared rate-limit gate (B20; extracted from `useMandateAutoSave`, NEW-C05-07).
 *
 * A monotonic "blocked until" timestamp shared across concurrent requests that
 * hit the SAME rate-limited endpoint. When one request gets a 429 it calls
 * `blockUntil(now + retryAfterMs)`; every other in-flight request checks
 * `remainingMs(now)` before firing and waits out the shared window — so the
 * N-way retry herd (each request reads the same `Retry-After`, sleeps the
 * identical duration, and retries simultaneously) cannot re-trip the limiter on
 * the very next tick.
 *
 * `blockUntil` only ever moves the gate FORWARD (`Math.max`), so a stale or
 * earlier window can never shorten a later one. Callers snapshot `Date.now()`
 * once and pass it to `remainingMs` so the guard and the sleep duration use the
 * same instant (IMP-2).
 */
export class RateLimitGate {
  private untilMs = 0;

  /** Block all callers until at least `untilMs` (epoch ms). Monotonic forward. */
  blockUntil(untilMs: number): void {
    this.untilMs = Math.max(this.untilMs, untilMs);
  }

  /** Milliseconds still to wait at `nowMs` (epoch ms); `0` once the window has passed. */
  remainingMs(nowMs: number): number {
    return Math.max(0, this.untilMs - nowMs);
  }
}
