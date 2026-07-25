/**
 * Phase 140 / SEAM-03 — importable fake-Upstash doubles for the seam breaker.
 *
 * WHY A HELPER AND NOT "just copy the vi.mock factory from resilient-fetch.test.ts":
 * `vi.mock` factories are per-file and hoisted; a second test file cannot
 * reference another file's factory. Plans 140-03 and 140-06 both need to drive
 * the breaker from route-level tests, so the DOUBLES have to be importable even
 * though the WIRING (vi.hoisted + vi.mock) necessarily stays per-file.
 *
 * These are plain objects with no vitest dependency. Each consuming test file
 * supplies its own wiring:
 *
 * ```ts
 * // The store MUST be hoisted. vi.mock factories RE-RUN on vi.resetModules(),
 * // so a factory-local store silently turns a shared-state breaker into an
 * // in-memory one and the cross-context test passes for the wrong reason.
 * const shared = vi.hoisted(() => ({
 *   store: new Map<string, { value: string; expiresAt: number }>(),
 * }));
 *
 * vi.mock("@upstash/redis", async () => {
 *   const { fakeRedisFor } = await import("@/test/helpers/upstash-breaker");
 *   return { Redis: { fromEnv: () => fakeRedisFor(shared.store) } };
 * });
 *
 * vi.mock("@upstash/ratelimit", async () => {
 *   const { fakeRatelimitFor } = await import("@/test/helpers/upstash-breaker");
 *   const fake = fakeRatelimitFor(shared.store, 5);
 *   return {
 *     Ratelimit: class {
 *       static slidingWindow = (tokens: number, window: string) => ({ tokens, window });
 *       limit = (id: string) => fake.limit(id);
 *     },
 *   };
 * });
 * ```
 *
 * The store is a `Map` keyed exactly like the real Redis keyspace, so a test can
 * inspect or seed breaker state directly (`seedBreakerOpen`) without driving
 * failures through the engine.
 */

/** A single fake-Redis entry. `expiresAt` is an absolute epoch ms; `Infinity` = no TTL. */
export interface FakeUpstashEntry {
  value: string;
  expiresAt: number;
}

export type FakeUpstashStore = Map<string, FakeUpstashEntry>;

/**
 * The literal breaker key, duplicated from `BREAKER_KEY` in
 * `src/lib/resilient-fetch.ts` on purpose: importing the core here would
 * execute its module-load side effects (the `Redis.fromEnv()` singleton and its
 * unconfigured notice) from inside a `vi.mock` factory, i.e. before the mock it
 * is defining exists. `resilient-fetch.test.ts` asserts the two strings are
 * equal so the duplication cannot drift silently.
 */
const BREAKER_KEY_LITERAL = "breaker:railway";

/** Window (ms) the fake failure counter uses. Mirrors `BREAKER_WINDOW` ("30 s"). */
const FAKE_WINDOW_MS = 30_000;

/** Prefix for the fake limiter's per-identifier counters inside the same store. */
const COUNTER_PREFIX = "__fake_breaker_count__:";

/** Create an empty store. One per "shared Upstash database" in a test file. */
export function createFakeUpstashStore(): FakeUpstashStore {
  return new Map<string, FakeUpstashEntry>();
}

/** Read an entry, evicting it first if its TTL has elapsed. */
function readLive(
  store: FakeUpstashStore,
  key: string,
): FakeUpstashEntry | undefined {
  const entry = store.get(key);
  if (!entry) return undefined;
  if (entry.expiresAt !== Number.POSITIVE_INFINITY && entry.expiresAt <= Date.now()) {
    store.delete(key);
    return undefined;
  }
  return entry;
}

/** The subset of the `@upstash/redis` client surface the breaker actually uses. */
export interface FakeRedis {
  get<T = string>(key: string): Promise<T | null>;
  set(
    key: string,
    value: string,
    opts?: { ex?: number; nx?: boolean },
  ): Promise<"OK" | null>;
  ttl(key: string): Promise<number>;
}

/**
 * Build a fake Redis over `store`.
 *
 * Semantics match the real client where the breaker depends on them:
 * - `set` with `{ nx: true }` is a no-op returning `null` when a LIVE value
 *   exists (this is what makes concurrent trips idempotent — first writer's TTL
 *   stands).
 * - `ttl` returns `-2` for an absent/expired key and `-1` for a key with no TTL.
 */
export function fakeRedisFor(store: FakeUpstashStore): FakeRedis {
  return {
    async get<T = string>(key: string): Promise<T | null> {
      const entry = readLive(store, key);
      return (entry ? (entry.value as unknown as T) : null);
    },
    async set(key, value, opts) {
      const existing = readLive(store, key);
      if (opts?.nx && existing) return null;
      store.set(key, {
        value,
        expiresAt:
          opts?.ex === undefined
            ? Number.POSITIVE_INFINITY
            : Date.now() + opts.ex * 1000,
      });
      return "OK";
    },
    async ttl(key) {
      const entry = readLive(store, key);
      if (!entry) return -2;
      if (entry.expiresAt === Number.POSITIVE_INFINITY) return -1;
      return Math.ceil((entry.expiresAt - Date.now()) / 1000);
    },
  };
}

/** The subset of `@upstash/ratelimit`'s response the breaker reads. */
export interface FakeRatelimitResponse {
  success: boolean;
  limit: number;
  remaining: number;
  reset: number;
}

export interface FakeRatelimit {
  limit(identifier: string): Promise<FakeRatelimitResponse>;
}

/**
 * Build a fake sliding-window limiter over the SAME store, so the failure
 * counter crosses module contexts exactly like the open-lock does.
 *
 * Counting is a fixed window rather than a true sliding one — the breaker only
 * reads `success` and `remaining`, and no test depends on sub-window decay.
 * `success` is `count <= threshold`: the threshold-th call is ALLOWED with
 * `remaining === 0`, and the (threshold+1)-th is denied, matching
 * `Ratelimit.slidingWindow(threshold, ...)`.
 */
export function fakeRatelimitFor(
  store: FakeUpstashStore,
  threshold: number,
): FakeRatelimit {
  return {
    async limit(identifier: string): Promise<FakeRatelimitResponse> {
      const key = `${COUNTER_PREFIX}${identifier}`;
      const existing = readLive(store, key);
      const count = (existing ? Number(existing.value) : 0) + 1;
      const expiresAt = existing
        ? existing.expiresAt
        : Date.now() + FAKE_WINDOW_MS;
      store.set(key, { value: String(count), expiresAt });
      return {
        success: count <= threshold,
        limit: threshold,
        remaining: Math.max(0, threshold - count),
        reset: expiresAt,
      };
    },
  };
}

/**
 * Seed the breaker as already OPEN, for tests that want the short-circuit
 * behaviour without driving `threshold` failures through the engine first.
 */
export function seedBreakerOpen(store: FakeUpstashStore, ttlS = 30): void {
  store.set(BREAKER_KEY_LITERAL, {
    value: "open",
    expiresAt: Date.now() + ttlS * 1000,
  });
}

/** The breaker key these doubles seed. Exported so tests can pin it against `BREAKER_KEY`. */
export const FAKE_BREAKER_KEY = BREAKER_KEY_LITERAL;
