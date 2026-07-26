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
 *   // NO second argument. The threshold is FAKE_THRESHOLD, hand-typed below —
 *   // never the value the core passed in. See the DOUBLE-INDEPENDENCE block.
 *   const fake = fakeRatelimitFor(shared.store);
 *   return {
 *     Ratelimit: class {
 *       static slidingWindow = (tokens: number, window: string) => ({ tokens, window });
 *       limit = (id: string) => fake.limit(id);
 *     },
 *   };
 * });
 * ```
 *
 * ⚠️ DOUBLE INDEPENDENCE — THE RULE THIS FILE EXISTS TO ENFORCE
 * ------------------------------------------------------------
 * **No tuning value in this double may be harvested from production.**
 *
 * Until plan 140.2-02 every consumer passed this function a SECOND argument
 * harvested from the mocked constructor's own options object — i.e. whatever
 * `Ratelimit.slidingWindow(BREAKER_FAILURE_THRESHOLD, BREAKER_WINDOW)` was
 * called with, production's own constructor argument read straight back out.
 * A double wired that way **cannot disagree with production, ever, by
 * construction**: raise `BREAKER_FAILURE_THRESHOLD` to 30 and the fake
 * silently raises with it, so
 * every trip-count, short-circuit and cooldown test in the repo keeps passing
 * having proved nothing. Ten simultaneous semantic mutations to the seam core
 * produced a byte-identical `8859 passed | 287 skipped` through exactly this
 * mechanism.
 *
 * So `BREAKER_KEY_LITERAL`, `FAKE_THRESHOLD` and `FAKE_WINDOW_MS` are all
 * hand-typed HERE, and `src/lib/seam-constants.pin.test.ts` asserts each one
 * equal to production's own literal. Two independently typed literals asserted
 * equal: production can change and the fake can change, but they cannot BOTH
 * change silently.
 *
 * KEEP the mocked class's `static slidingWindow` in every consumer. The fix is
 * to stop the double CONSUMING production's value, not to stop a test
 * OBSERVING it — removing the options object would delete the correct plumbing
 * assertion that the core constructs its limiter from the table.
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

/**
 * The failure threshold this double trips at, duplicated from
 * `BREAKER_FAILURE_THRESHOLD` in `src/lib/resilient-fetch.ts` — on purpose, for
 * BOTH of the reasons `BREAKER_KEY_LITERAL` carries:
 *
 * 1. Importing the core here would execute its module-load side effects (the
 *    `Redis.fromEnv()` singleton and its unconfigured notice) from inside a
 *    `vi.mock` factory, i.e. before the mock it is defining exists.
 * 2. More importantly, a double that reads its tuning from production cannot
 *    ever contradict production. That is not a fake — it is a mirror.
 *
 * `src/lib/seam-constants.pin.test.ts` asserts this literal equals
 * `BREAKER_FAILURE_THRESHOLD`, so the duplication cannot drift silently.
 */
export const FAKE_THRESHOLD = 5;

/**
 * Window (ms) the fake failure counter uses — the millisecond form of
 * `BREAKER_WINDOW` ("30 s"), hand-typed here for the same two reasons as
 * `FAKE_THRESHOLD`.
 *
 * This value was already a hand-typed literal, but its only tie to production
 * was a comment claiming it "mirrors `BREAKER_WINDOW`" with NO assertion behind
 * it — which is precisely how a 30 s → 3600 s change stays invisible to every
 * test driven through this double. It is EXPORTED so
 * `src/lib/seam-constants.pin.test.ts` can pin it literal-against-literal.
 */
export const FAKE_WINDOW_MS = 30_000;

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
 *
 * `threshold` DEFAULTS to the hand-typed `FAKE_THRESHOLD` and every consumer
 * takes that default. The parameter is deliberately KEPT rather than removed: a
 * test that legitimately wants a different threshold to prove a boundary should
 * still be able to pass one. The rule is that the value is a LITERAL — never
 * production's own `slidingWindow(...)` argument read back off the mocked
 * constructor's options object — not that it is fixed.
 */
export function fakeRatelimitFor(
  store: FakeUpstashStore,
  threshold: number = FAKE_THRESHOLD,
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
