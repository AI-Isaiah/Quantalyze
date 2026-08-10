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
 * The literal RESIDUAL GLOBAL breaker key, duplicated from `BREAKER_KEY` in
 * `src/lib/resilient-fetch.ts` on purpose: importing the core here would
 * execute its module-load side effects (the `Redis.fromEnv()` singleton and its
 * unconfigured notice) from inside a `vi.mock` factory, i.e. before the mock it
 * is defining exists. `resilient-fetch.test.ts` asserts the two strings are
 * equal so the duplication cannot drift silently.
 *
 * ⚠️ SINCE 140.2-06 THIS IS NO LONGER "THE" BREAKER KEY. The core keys a
 * counting `503` on `breaker:<dependency>` and reserves this key for failures
 * that name no dependency (a transport throw, a deadline, a body-read abort).
 * The constant, its export and its literal↔literal pin all survive that change
 * and are all still wanted — but a test that seeds it is now asserting "the
 * GLOBAL breaker is open", which is a narrower claim than it used to be. Seed a
 * per-dependency key explicitly when that is what the case means; see
 * `seedBreakerOpen`.
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

/**
 * How much longer than its encoded cooldown a breaker lock stays IN the store —
 * the TOMBSTONE — in milliseconds. The second form of
 * `BREAKER_LOCK_TOMBSTONE_S` in `src/lib/resilient-fetch.ts`, hand-typed here
 * for the same two reasons as `FAKE_THRESHOLD`, and pinned literal-against-
 * literal in `src/lib/seam-constants.pin.test.ts`.
 *
 * A lock is OPEN until the expiry encoded in its VALUE; the key itself outlives
 * that so `recordSeamFailure` can still see WHEN the last lock was armed, which
 * is the whole of the A-25 no-re-arm guard.
 *
 * 60 000 → 90 000 with Phase 153.4 / D-26, which raised the production constant
 * to 90 s in the same commit as the 120 000 ms `validate-key-serialized`
 * budget. ⚠️ MOVED BY HAND, on purpose: the drift pin's own message forbids
 * closing this gap by reading production's value here, because a double that
 * reads its subject measures itself and stays green through a real change to
 * the seam core.
 */
export const FAKE_LOCK_TOMBSTONE_MS = 90_000;

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
  mget<T = (string | null)[]>(...keys: string[]): Promise<T>;
  set(
    key: string,
    value: string,
    opts?: { ex?: number; nx?: boolean; get?: boolean },
  ): Promise<"OK" | string | null>;
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
 * - `mget` returns one slot PER REQUESTED KEY, in request order, `null` where
 *   the key is absent or expired. Order is load-bearing: the core returns the
 *   FIRST slot holding a still-live lock, and the row's declared dependency keys
 *   come before the global one so the more specific cooldown wins the
 *   `retryAfterS` tie-break. Arity no longer is, since plan 140.2-07 stopped
 *   mapping an index back to a key — the expiry now travels inside the value —
 *   but a fake that compacted out the misses would still misreport which key
 *   matched, so both are kept.
 */
export function fakeRedisFor(store: FakeUpstashStore): FakeRedis {
  return {
    async get<T = string>(key: string): Promise<T | null> {
      const entry = readLive(store, key);
      return (entry ? (entry.value as unknown as T) : null);
    },
    async mget<T = (string | null)[]>(...keys: string[]): Promise<T> {
      return keys.map((key) => {
        const entry = readLive(store, key);
        return entry ? entry.value : null;
      }) as unknown as T;
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
      // `SET … GET` answers what it DISPLACED, not "OK" — real Redis semantics
      // (6.2+), serialised by `@upstash/redis` as `["set", key, value, "get",
      // "ex", n]`. Modelled here because HI-01's trip write depends on it: the
      // instance that displaced something OTHER than a live lock is the one that
      // armed the circuit. This is a PRIMITIVE, deliberately: the fake answers
      // "what was there before", it does not re-implement the core's ownership
      // rule. A double that encoded that rule could not disagree with
      // production, which is the defect this file's header exists to forbid.
      if (opts?.get) return existing ? existing.value : null;
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
 * Seed a breaker as already OPEN, for tests that want the short-circuit
 * behaviour without driving `threshold` failures through the engine first.
 *
 * ⚠️ `breakerKey` IS EXPLICIT AND POSITIONALLY SECOND ON PURPOSE (plan 140.2-06).
 * Before per-dependency keying this helper hardcoded the single global key, and
 * every caller wrote `seedBreakerOpen(store, 30)`. Adding the key as a THIRD
 * parameter would have left all nine existing call sites compiling unchanged
 * while the core moved underneath them — and a seed written to a key nobody
 * reads is a test that PASSES while asserting nothing (TRAP-9). Putting it
 * second makes the old shape a type error, so every site had to state, in
 * source, whether it means "the GLOBAL breaker is open" or "THIS dependency's
 * breaker is open".
 *
 * It defaults to the global key so `seedBreakerOpen(store)` still reads as the
 * former, which is genuinely what several cases mean.
 *
 * The key is typed `string` rather than a union: this helper cannot import the
 * core's `SeamServiceDependency` (see `BREAKER_KEY_LITERAL` for why importing
 * the core here is impossible), and a hand-typed literal at the call site is the
 * point. `seam-constants.pin.test.ts` pins the literals both sides use.
 */
export function seedBreakerOpen(
  store: FakeUpstashStore,
  breakerKey: string = BREAKER_KEY_LITERAL,
  ttlS = 30,
): void {
  const armedAtMs = Date.now();
  const expiresAtMs = armedAtMs + ttlS * 1000;
  store.set(breakerKey, {
    value: encodeFakeBreakerLock(armedAtMs, expiresAtMs),
    // The KEY outlives the LOCK, deliberately — see `encodeFakeBreakerLock`.
    expiresAt: expiresAtMs + FAKE_LOCK_TOMBSTONE_MS,
  });
}

/**
 * Encode a breaker lock exactly as the core does — `open:<armedAt>:<expiresAt>`,
 * both in epoch milliseconds.
 *
 * ⚠️ ONE ENCODER, USED BY THIS HELPER AND BY THE CORE'S OWN TESTS. Plan
 * 140.2-07 moved the lock's expiry INTO its value so that `isBreakerOpen` can
 * decide OPEN/CLOSED and derive `retryAfterS` from a SINGLE read (A-24: two
 * sequential reads are two facts that can disagree, and a rejection on the
 * second discarded a known-open state). The format therefore has to be produced
 * identically on both sides, and a test that hand-built it at the call site
 * would be the harness and production drifting into two encodings — a green
 * suite testing nothing, which is TRAP-9 exactly.
 *
 * The format is hand-typed HERE and NOT imported from the core, for the same two
 * reasons `FAKE_THRESHOLD` is: this file cannot import the core (that would run
 * its module-load side effects from inside a `vi.mock` factory), and a double
 * that reads its format out of production cannot ever contradict production.
 * `src/lib/seam-constants.pin.test.ts` asserts the core's decoder parses what
 * this function writes, and that this function writes what the core's encoder
 * does — two independently typed formats, asserted equal.
 *
 * ⚠️ `armedAt` IS STORED, NOT DERIVED from `expiresAt - cooldown`. It is what the
 * A-25 guard compares a failing request's admission instant against, and
 * deriving it would silently re-point that guard the moment the cooldown were
 * retuned between the write and the read.
 */
export function encodeFakeBreakerLock(
  armedAtMs: number,
  expiresAtMs: number,
): string {
  return `open:${armedAtMs}:${expiresAtMs}`;
}

/**
 * The RESIDUAL GLOBAL breaker key these doubles default to. Exported so tests
 * can pin it against `BREAKER_KEY`.
 *
 * The pin survives per-dependency keying untouched: the global key still exists
 * and is still a module constant, so `expect(mod.BREAKER_KEY).toBe(FAKE_BREAKER_KEY)`
 * remains exactly as load-bearing as it was.
 */
export const FAKE_BREAKER_KEY = BREAKER_KEY_LITERAL;
