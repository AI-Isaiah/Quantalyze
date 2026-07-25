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
 * // The store MUST be hoisted, so that it lives OUTSIDE any module registry
 * // that vi.resetModules() tears down — that is what lets one context observe
 * // state another context wrote, which is the whole point of the SC-2 proof.
 * //
 * // ⚠️ Do NOT justify this with "vi.mock factories re-run on resetModules()".
 * // That is FALSE on vitest 4.1.10 — measured directly in Phase 140: a factory
 * // incrementing a hoisted counter reports 1 execution both before and after
 * // resetModules(). Factories are cached; only NON-mocked module bodies re-run.
 * // Building a negative control on the false premise yields a silent FALSE
 * // GREEN (context B keeps the cached, already-tripped store and short-circuits,
 * // so the control never fires). The per-context hook that DOES exist is
 * // Redis.fromEnv(), called once per module-body execution — hang per-context
 * // setup off that. See the header of src/lib/resilient-fetch.test.ts.
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
  /**
   * The library's outcome marker. Only `"timeout"` matters here — see
   * `FAKE_LIMITER_TIMEOUT_SENTINEL`.
   */
  reason?: "timeout" | "cacheBlock" | "denyList";
}

export interface FakeRatelimit {
  limit(identifier: string): Promise<FakeRatelimitResponse>;
  /**
   * The library's public counter reset (`Ratelimit.resetUsedTokens`), which the
   * breaker calls the instant it writes the open-lock so ONE burst produces ONE
   * denial window (C5).
   *
   * The real implementation SCAN+DELs `${prefix}:${identifier}:*` — every
   * window bucket for that identifier. This fake keeps exactly one bucket per
   * identifier, so deleting it is the faithful equivalent for what the breaker
   * observes.
   */
  resetUsedTokens(identifier: string): Promise<void>;
}

/**
 * The EXACT fail-open value `@upstash/ratelimit` v2.0.8 resolves when its own
 * internal timeout expires (`dist/index.mjs` `applyTimeout`, default
 * `timeout: 5000`).
 *
 * Copied verbatim rather than described, because the whole hazard (Phase 140
 * review / F-5) is that it LOOKS like a successful answer: `success: true`
 * with `remaining: 0`. A breaker testing `!(success && remaining > 0)` reads
 * the library's "I could not reach the store, let them through" as "the
 * failure allowance is exhausted, deny everyone" — turning a fail-open into a
 * fail-closed at the worst possible moment.
 *
 * Exported so a test can drive the sentinel through the real breaker rather
 * than asserting against a paraphrase of it.
 */
export const FAKE_LIMITER_TIMEOUT_SENTINEL: FakeRatelimitResponse = {
  success: true,
  limit: 0,
  remaining: 0,
  reset: 0,
  reason: "timeout",
};

/**
 * Build a fake limiter over the SAME store, so the failure counter crosses
 * module contexts exactly like the open-lock does.
 *
 * ⚠️ THIS IS A FIXED WINDOW; THE DEPLOYED LIMITER IS A SLIDING ONE (Phase 140
 * review / F-6). The divergence is deliberate — rebuilding
 * `Ratelimit.slidingWindow` faithfully would be a second implementation of the
 * dependency, which is a worse liability than a documented approximation — but
 * it is written down here because a test author who assumes fidelity will draw
 * wrong conclusions. Three behaviours differ from `@upstash/ratelimit` v2.0.8:
 *
 *  1. NO WEIGHTED CARRY-OVER. The real `slidingWindow` counts the PREVIOUS
 *     epoch-aligned window pro-rata by how far into the current one you are, so
 *     the effective count decays continuously. This fake resets abruptly at the
 *     window edge. Any test that depends on partial decay is testing the fake.
 *  2. EPOCH-ALIGNED vs FIRST-CALL-ALIGNED. Real windows start at
 *     `floor(now / windowMs) * windowMs`; this one starts at the first call.
 *  3. IT INCREMENTS ON DENIAL. The real limiter does not count a request it
 *     rejects, so a sustained overload does not push the count arbitrarily
 *     high. This fake keeps incrementing.
 *
 * None of the three affects what the breaker actually reads (`success`,
 * `limit`, `remaining`, `reason`) on the paths under test: the threshold-th
 * call is ALLOWED with `remaining === 0` and the (threshold+1)-th is denied,
 * matching `Ratelimit.slidingWindow(threshold, …)` at the trip boundary, which
 * is the only boundary the breaker has.
 *
 * @param timeoutSentinel - when true, every call resolves the library's
 *   fail-open timeout value instead of counting (see
 *   `FAKE_LIMITER_TIMEOUT_SENTINEL`).
 */
export function fakeRatelimitFor(
  store: FakeUpstashStore,
  threshold: number,
  timeoutSentinel = false,
): FakeRatelimit {
  return {
    async limit(identifier: string): Promise<FakeRatelimitResponse> {
      if (timeoutSentinel) return { ...FAKE_LIMITER_TIMEOUT_SENTINEL };
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
    async resetUsedTokens(identifier: string): Promise<void> {
      store.delete(`${COUNTER_PREFIX}${identifier}`);
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
