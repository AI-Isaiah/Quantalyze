import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from "vitest";

import { isBreakerOpen, recordSeamFailure } from "@/lib/resilient-fetch";

/**
 * Phase 140.2 / SEAMCORE-09 — the seam breaker against a REAL Redis.
 *
 * WHAT MAKES THIS LANE DIFFERENT FROM EVERY OTHER BREAKER TEST IN THE REPO
 * -----------------------------------------------------------------------
 * There is ZERO module mocking in this file, deliberately and permanently. The
 * unmodified `@upstash/ratelimit` sliding-window Lua executes on a real Redis
 * server (reached through the SRH REST proxy — see docker-compose.redis-test.yml).
 * That matters because `src/test/helpers/upstash-breaker.ts` is a FIXED-window
 * double anchored at its first call, with NO previous bucket, NO weighted
 * carry-over, and it INCREMENTS ON DENIAL. The deployed limiter is
 * epoch-aligned, carries a weighted count over from the previous bucket, and
 * does NOT increment on denial. `recordSeamFailure()` reads BOTH `success` and
 * `remaining`, so both divergences change behaviour. Four of the seven
 * properties below are simply unobservable through the double.
 *
 * It also makes the vitest 4.1.10 finding that mock factories do not re-run on
 * `vi.resetModules()` irrelevant here: with nothing mocked, module-reset
 * semantics stop mattering at all.
 *
 * ORACLE RULE, BINDING
 * --------------------
 * Every expected value below is a HAND-TYPED LITERAL. Nothing in this file
 * reads its expectation out of `src/lib/resilient-fetch.ts` — no
 * `BREAKER_FAILURE_THRESHOLD`, no `BREAKER_WINDOW`, no `BREAKER_COOLDOWN_S`,
 * no `BREAKER_KEY`. Only the two BEHAVIOURS (`recordSeamFailure`,
 * `isBreakerOpen`) are imported. This phase exists because a test double
 * harvested its threshold from production's own `slidingWindow(...)` argument
 * and every loop bound was `mod.BREAKER_FAILURE_THRESHOLD`, so ten simultaneous
 * semantic mutations produced a byte-identical green suite. Re-introducing that
 * shape in ANY form defeats the entire lane.
 *
 * FAIL LOUD, NEVER SKIP
 * ---------------------
 * No `describe.skipIf` / `it.skipIf` anywhere. This repo already carries ~284
 * live-DB tests that never execute in CI, and the standing rule is that a test
 * which does not run is not a gate. If the store is unreachable this file
 * THROWS a named error, and `afterAll` asserts a hand-typed executed-case count
 * so the lane cannot pass vacuously.
 *
 * ⚠️ NO FAKE TIMERS. The Lua reads `now` from the client's `Date.now()` while
 * the Redis-side TTLs are real; stubbing one half produces confidently wrong
 * results. R-7 uses a real timer and is explicitly the slow case.
 *
 * ⚠️ NEVER `FLUSHALL`, NEVER `resetUsedTokens` (TRAP-6 — a full-keyspace Lua
 * SCAN on the database shared with fifteen production limiters). This lane
 * clears only the `breaker:*` namespace it owns.
 */

// ---------------------------------------------------------------------------
// The oracle. Hand-typed literals.
//
// ⚠️ RE-EXPRESSED AGAIN BY PLAN 140.2-07, AND AGAIN IT IS A RE-EXPRESSION.
// The lock's VALUE stopped being the bare string "open" and became
// `open:<armedAtMs>:<expiresAtMs>`, so that `isBreakerOpen` decides OPEN/CLOSED
// and derives `retryAfterS` from ONE read instead of a `get` racing a `ttl`.
// Two consequences reach this file, and both make the assertions STRONGER:
//
//   · R-2 and R-7 read the value back. They now decode it with the hand-typed
//     parser below, which additionally pins the COOLDOWN SPAN the lock carries —
//     a wrong cooldown was completely invisible to `=== "open"`.
//   · R-3 and R-4 read the key's TTL. That TTL is no longer the cooldown: the
//     key deliberately OUTLIVES its lock by `BREAKER_LOCK_TOMBSTONE_S`, because
//     the A-25 no-re-arm guard has to be able to see WHEN the last lock was
//     armed after it expired. So both cases now pin BOTH numbers — the cooldown
//     from the value, the tombstone from the key — where before they pinned one.
//
// The properties being asserted are unchanged: the first writer's expiry
// survives a second trip (R-3), and the cooldown sits in the literal band (R-4).
//
// ⚠️ RE-EXPRESSED BY PLAN 140.2-06, AND IT IS A RE-EXPRESSION, NOT A RELAXATION.
// Before per-dependency keying there was ONE counter identifier and R-1 pinned
// it exactly:
//     old: breaker:breaker:railway:failures:<epoch window index>
//     new: breaker:<breaker key>:failures:<epoch window index>
// where `<breaker key>` is `breaker:railway` for a failure that names no
// dependency and `breaker:<dependency>` for a counting 503 that does. The
// property being pinned is UNCHANGED — "the store received exactly the key we
// think it did" — and R-1 still asserts an EXACT key SET, never a prefix match
// and never a `contains`. That distinction is load-bearing: a substring check
// would pass a key built from a caller-influenced value, which is precisely the
// threat (T-140-01) this assertion guards.
//
// R-1 is also STRENGTHENED, because the new shape admits a failure the old one
// could not express: it now drives TWO different keys in one case and asserts
// both counter identities and both counts, so collapsing the per-dependency
// component onto a single shared counter (ledger row M20R) reddens here.
// ---------------------------------------------------------------------------

/**
 * The RESIDUAL GLOBAL breaker key, as the store receives it.
 *
 * Also what `recordSeamFailure` is handed for every failure naming no
 * dependency. Passed EXPLICITLY at every call site below rather than defaulted:
 * the core takes a required key argument, and this lane's whole discipline is
 * that its literals come from here, never from `src/lib/resilient-fetch.ts`.
 */
const LOCK_KEY = "breaker:railway";

/**
 * A per-dependency breaker key, as the store receives it. Hand-typed, and
 * deliberately one of the four members of `STATUS_CONTRACT.md` §4's closed
 * service set — never derived from the core's own vocabulary.
 */
const MT5_LOCK_KEY = "breaker:mt5-gateway";

/**
 * `<limiter prefix>:<identifier>:<epoch window index>`, as the store receives it.
 *
 * The limiter's prefix is the literal `breaker`, and the identifier the core
 * builds is `` `${breakerKey}:failures` `` — hence the doubled `breaker:` that
 * looked like a typo in the wave-1 shape and is in fact the prefix meeting the
 * key.
 */
const counterKeyFor = (breakerKey: string, windowIndex: number) =>
  `breaker:${breakerKey}:failures:${windowIndex}`;

/**
 * The budget key this lane drives `isBreakerOpen` with.
 *
 * Hand-typed, and `bridge` specifically because its `SEAM_BUDGETS` row declares
 * NO dependencies — so every assertion below about the global lock is also an
 * assertion that a row with an empty declared set still consults the residual
 * global key.
 */
const LANE_BUDGET_KEY = "bridge" as const;

/** The production sliding window, in milliseconds. */
const WINDOW_MS = 30000;

/** The production trip threshold. */
const THRESHOLD = 5;

/** The production cooldown, in seconds. */
const COOLDOWN_S = 30;

/**
 * How much longer than its cooldown the lock KEY survives, in seconds.
 *
 * 60 → 90 with Phase 153.4 / D-26, which raised the production constant in the
 * same commit as the 120 000 ms `validate-key-serialized` budget so A-25 still
 * spans it. Hand-typed here, never imported: a lane that read the core's own
 * constant could not disagree with it.
 */
const LOCK_TOMBSTONE_S = 90;

/**
 * Decode a lock value with a parser typed HERE, by hand.
 *
 * Nothing in this lane imports the core's decoder — a reader that took its shape
 * from the writer could not disagree with it, which is the exact self-referential
 * defect this whole file exists to avoid.
 */
function decodeLock(
  value: unknown,
): { armedAtMs: number; expiresAtMs: number } | null {
  if (typeof value !== "string") return null;
  const m = /^open:(\d+):(\d+)$/.exec(value);
  return m ? { armedAtMs: Number(m[1]), expiresAtMs: Number(m[2]) } : null;
}

/**
 * Assert the key holds a LIVE lock and return it.
 *
 * Strictly stronger than the `=== "open"` this replaced: it additionally pins
 * that the cooldown the lock CARRIES is the hand-typed 30 000 ms, which the bare
 * string could not express at all.
 */
async function expectLockOpen(
  key: string,
): Promise<{ armedAtMs: number; expiresAtMs: number }> {
  const raw = await probe.get<string>(key);
  const lock = decodeLock(raw);
  expect(
    lock,
    `"${key}" does not hold a parseable lock (raw: ${JSON.stringify(raw)}). ` +
      `Either the circuit did not trip, or the core wrote a value shape nothing ` +
      `can decode — and an undecodable value reads CLOSED, so the lock would be ` +
      `in the store and invisible in use.`,
  ).not.toBeNull();
  const live = lock as { armedAtMs: number; expiresAtMs: number };
  expect(live.expiresAtMs - live.armedAtMs).toBe(30000);
  expect(live.expiresAtMs).toBeGreaterThan(Date.now());
  return live;
}

// ---------------------------------------------------------------------------
// Store access — a probe client SEPARATE from the core's own client, so what we
// assert is what the store actually holds rather than what the core believes.
// ---------------------------------------------------------------------------

class SeamRedisLaneUnavailableError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "SeamRedisLaneUnavailableError";
  }
}

function requireLaneEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new SeamRedisLaneUnavailableError(
      `[seam-redis-lane] ${name} is unset. This lane is a GATE and must never skip. ` +
        `Start the store first:\n` +
        `  docker compose -f docker-compose.redis-test.yml up -d\n` +
        `then re-run with UPSTASH_REDIS_REST_URL=http://localhost:8079 ` +
        `UPSTASH_REDIS_REST_TOKEN=ci-seam-breaker-token npm run test:redis`,
    );
  }
  return value;
}

const probe = new Redis({
  url: requireLaneEnv("UPSTASH_REDIS_REST_URL"),
  token: requireLaneEnv("UPSTASH_REDIS_REST_TOKEN"),
});

// ---------------------------------------------------------------------------
// Timing helpers. Real timers only.
// ---------------------------------------------------------------------------

const sleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, Math.max(0, ms)));

/** Sleep until an absolute wall-clock instant, tightening the last few ms. */
async function sleepUntil(absoluteMs: number): Promise<void> {
  await sleep(absoluteMs - Date.now() - 5);
  while (Date.now() < absoluteMs) {
    // Deliberate tight spin over the final <5 ms: `setTimeout` resolution is
    // not good enough for the epoch-position control R-5/R-7 depend on.
  }
}

/**
 * Guarantee at least `neededMs` of headroom before the next epoch-window
 * boundary, so a burst of calls cannot straddle two buckets. Costs nothing in
 * the common case.
 */
async function ensureWindowHeadroom(
  windowMs: number,
  neededMs: number,
): Promise<void> {
  const now = Date.now();
  if (windowMs - (now % windowMs) < neededMs) {
    await sleepUntil(Math.ceil(now / windowMs) * windowMs + 50);
  }
}

/** Land at fractional `position` inside a window of `windowMs` (this one or the next). */
async function landAtWindowPosition(
  windowMs: number,
  position: number,
): Promise<void> {
  const now = Date.now();
  const windowIndex = Math.floor(now / windowMs);
  const here = windowIndex * windowMs + Math.round(position * windowMs);
  await sleepUntil(
    here > now
      ? here
      : (windowIndex + 1) * windowMs + Math.round(position * windowMs),
  );
}

/** Land at fractional `position` inside the NEXT window of `windowMs`. */
async function landInNextWindowAt(
  windowMs: number,
  position: number,
): Promise<void> {
  await sleepUntil(
    (Math.floor(Date.now() / windowMs) + 1) * windowMs +
      Math.round(position * windowMs),
  );
}

/**
 * Drain the limiter's IN-PROCESS ephemeral block.
 *
 * ⚠️ REAL PRODUCTION PROPERTY, discovered by this lane and not documented in the
 * core. `@upstash/ratelimit@2.0.8` defaults `ephemeralCache` to a live in-memory
 * `Map` when the option is omitted (`dist/index.mjs:757-761`), and
 * `src/lib/resilient-fetch.ts` omits it. On a DENIED `limit()` the limiter calls
 * `ctx.cache.blockUntil(identifier, reset)` with `reset = (currentWindow + 1) *
 * windowSize` (`:1580-1585`); every later call for that identifier then
 * short-circuits IN MEMORY with `reason: "cacheBlock"` and NEVER REACHES REDIS
 * until the bucket ends (`:1560-1569`).
 *
 * That state lives on the module-scope limiter object, so no amount of keyspace
 * clearing can reset it — a case that denies must let the bucket roll over
 * before the next case expects a Redis round trip. Without this the counter-key
 * observations go green for the wrong reason (the store is simply never
 * written), which is precisely the silent-green class this lane exists to kill.
 */
async function drainEphemeralBlock(): Promise<void> {
  await sleepUntil((Math.floor(Date.now() / WINDOW_MS) + 1) * WINDOW_MS + 100);
}

/**
 * Armed by a case BEFORE it drives the call that will be denied, and consumed by
 * `afterEach`. The flag is set ahead of the denial rather than after it so the
 * drain still happens when the case FAILS partway through — otherwise a
 * mutation that reddens a denying case leaks its in-process block into the next
 * case, which then reddens for a borrowed reason and muddies the mutation
 * receipt this lane exists to produce.
 */
let expectsDenial = false;

/** Clear ONLY the keys this lane owns. Never FLUSHALL. Never resetUsedTokens. */
async function clearLaneKeys(): Promise<void> {
  const keys = await probe.keys("breaker:*");
  if (keys.length > 0) {
    await probe.del(...keys);
  }
}

// ---------------------------------------------------------------------------
// Anti-vacuity fence: a green lane that executed nothing is the exact
// silent-green this phase exists to eliminate.
// ---------------------------------------------------------------------------

let casesExecuted = 0;

/** Hand-typed. R-1 .. R-7. Raise this ONLY when a case is genuinely added. */
const EXPECTED_CASES = 7;

describe("seam breaker against a REAL Redis (SEAMCORE-09)", () => {
  beforeAll(async () => {
    // Reachability probe. THROWS — never skips.
    try {
      await probe.set("breaker:seam-lane-preflight", "ready", { ex: 5 });
      const echoed = await probe.get<string>("breaker:seam-lane-preflight");
      if (echoed !== "ready") {
        throw new Error(`preflight read back ${JSON.stringify(echoed)}`);
      }
    } catch (err) {
      throw new SeamRedisLaneUnavailableError(
        "[seam-redis-lane] the Upstash-compatible store is unreachable or not " +
          "behaving. This lane is a GATE and must never skip. Start it with " +
          "`docker compose -f docker-compose.redis-test.yml up -d`.",
        { cause: err },
      );
    }
  });

  beforeEach(async () => {
    await clearLaneKeys();
  });

  afterEach(async () => {
    // Runs on PASS and on FAIL alike — that is the whole point.
    if (expectsDenial) {
      expectsDenial = false;
      await drainEphemeralBlock();
    }
  });

  afterAll(() => {
    // If this fires, the lane went green having run fewer cases than it claims.
    expect(casesExecuted).toBe(EXPECTED_CASES);
  });

  it("R-1 counter identity and namespace — the store receives breaker:<breaker key>:failures:<epoch window>, one counter PER KEY", async () => {
    await ensureWindowHeadroom(WINDOW_MS, 5000);

    const t0 = Date.now();
    // Literals 4 and 3 — both deliberately BELOW the trip threshold, so the only
    // keys the store should hold afterwards are the two counters themselves. The
    // two counts DIFFER on purpose: equal counts would still pass if the two
    // identifiers had collapsed into one and the reads happened to line up.
    for (let i = 0; i < 4; i++) {
      await recordSeamFailure(LOCK_KEY);
    }
    for (let i = 0; i < 3; i++) {
      await recordSeamFailure(MT5_LOCK_KEY);
    }
    const t1 = Date.now();

    // Headroom guard: the burst must not have straddled a bucket boundary.
    expect(Math.floor(t1 / WINDOW_MS)).toBe(Math.floor(t0 / WINDOW_MS));

    const windowIndex = Math.floor(t0 / WINDOW_MS);
    const expectedGlobal = counterKeyFor(LOCK_KEY, windowIndex);
    const expectedMt5 = counterKeyFor(MT5_LOCK_KEY, windowIndex);
    const actual = (await probe.keys("*")).sort();

    // EXACT set, not a containment check and not a prefix match: a mutation that
    // writes a differently namespaced key must show up as a diff rather than as
    // a missing lookup, and a substring assertion would pass a key built from a
    // caller-influenced value (T-140-01).
    expect(
      actual,
      "The store does not hold exactly the two counter keys this lane names. " +
        "Either the counter identifier changed shape, or the per-dependency " +
        "component was dropped and both call sites collapsed onto ONE counter — " +
        "which is the single global breaker wearing a per-dependency name.",
    ).toEqual([expectedGlobal, expectedMt5].sort());

    // Per-key COUNTS, not just per-key names. A shared counter would read 7 on
    // whichever single key survived.
    expect(Number(await probe.get(expectedGlobal))).toBe(4);
    expect(Number(await probe.get(expectedMt5))).toBe(3);

    casesExecuted++;
  });

  it("R-2 trip at exactly the threshold — a literal 4 failures leave no lock, the 5th creates it", async () => {
    await ensureWindowHeadroom(WINDOW_MS, 5000);

    // The loop bound is the hand-typed literal 4, NEVER
    // `BREAKER_FAILURE_THRESHOLD - 1`. That is the whole point: raising the
    // production threshold must not silently raise this expectation with it.
    for (let i = 0; i < 4; i++) {
      await recordSeamFailure(LOCK_KEY);
    }
    expect(await probe.get(LOCK_KEY)).toBeNull();

    // The 5th.
    await recordSeamFailure(LOCK_KEY);
    await expectLockOpen(LOCK_KEY);

    casesExecuted++;
  });

  it("R-3 trip idempotency — a later trip does NOT ratchet the first writer's expiry", async () => {
    await ensureWindowHeadroom(WINDOW_MS, 12000);

    for (let i = 0; i < THRESHOLD; i++) {
      await recordSeamFailure(LOCK_KEY);
    }
    // THE VALUE, byte for byte — the strongest available statement of "the first
    // writer's expiry stands", and stronger than the TTL band this replaced: a
    // TTL band tolerates any rewrite landing inside it, whereas an identical
    // string tolerates none at all.
    const raw = await probe.get<string>(LOCK_KEY);
    const lock = await expectLockOpen(LOCK_KEY);

    // The KEY outlives the LOCK by the tombstone, so the store TTL is
    // cooldown + tombstone = 120 s, all three hand-typed. This is the number the
    // A-25 guard depends on: without the tombstone an expired lock is simply
    // gone, and a request that overlapped it can re-arm the circuit on evidence
    // gathered before the previous trip.
    const ttlAtTrip = await probe.ttl(LOCK_KEY);
    expect(ttlAtTrip).toBeGreaterThanOrEqual(119);
    expect(ttlAtTrip).toBeLessThanOrEqual(120);
    expect(COOLDOWN_S + LOCK_TOMBSTONE_S).toBe(120);

    // Let a hand-typed 4 seconds of the cooldown burn down, then force a second
    // trip: the counter is exhausted, so the limiter denies and the core reaches
    // its trip path again. Arm the drain BEFORE the denial, not after the
    // assertions — those may not be reached.
    await sleep(4000);
    expectsDenial = true;
    await recordSeamFailure(LOCK_KEY);

    expect(
      await probe.get<string>(LOCK_KEY),
      "A second trip rewrote a still-live lock. The first writer's expiry must " +
        "stand, or a second instance tripping moments later ratchets the outage " +
        "window open indefinitely.",
    ).toBe(raw);
    // …stated once more as the derived fact, so the failure message names the
    // consequence rather than a string diff: ~4 s off a 30 s cooldown => [25,27].
    const remainingS = Math.ceil((lock.expiresAtMs - Date.now()) / 1000);
    expect(remainingS).toBeGreaterThanOrEqual(25);
    expect(remainingS).toBeLessThanOrEqual(27);

    casesExecuted++;
  });

  it("R-4 the ENCODED cooldown is the lock's life, the key outlives it, and Retry-After agrees", async () => {
    await ensureWindowHeadroom(WINDOW_MS, 5000);

    for (let i = 0; i < THRESHOLD; i++) {
      await recordSeamFailure(LOCK_KEY);
    }

    // The cooldown now lives in the VALUE. `expectLockOpen` already pins its
    // span at the literal 30 000 ms; this pins that the lock was armed NOW
    // rather than carrying some stale expiry forward.
    const lock = await expectLockOpen(LOCK_KEY);
    const remainingS = Math.ceil((lock.expiresAtMs - Date.now()) / 1000);
    expect(remainingS).toBeGreaterThanOrEqual(29);
    expect(remainingS).toBeLessThanOrEqual(30);

    // The KEY's own TTL is the cooldown PLUS the tombstone, and pinning it is
    // what stops the tombstone being quietly dropped back to the cooldown —
    // which would leave R-3/R-4 green and silently re-open A-25.
    const ttl = await probe.ttl(LOCK_KEY);
    expect(ttl).toBeGreaterThanOrEqual(119);
    expect(ttl).toBeLessThanOrEqual(120);

    const state = await isBreakerOpen(LANE_BUDGET_KEY);
    expect(state.open).toBe(true);
    expect(state.retryAfterS).toBeGreaterThanOrEqual(29);
    expect(state.retryAfterS).toBeLessThanOrEqual(30);

    casesExecuted++;
  });

  it("R-5 sliding-window decay and weighted carry-over, plus the production window as the store received it", async () => {
    // ---------------------------------------------------------------------
    // (a) THE ALGORITHM, proven fast. A SECOND Ratelimit built here with a
    //     hand-typed 2 s window over the SAME real Redis. The double cannot
    //     model any of this: it has no previous bucket at all.
    // ---------------------------------------------------------------------
    const R5_WINDOW_MS = 2000;
    const R5_LIMIT = 5;
    const fast = new Ratelimit({
      redis: probe,
      limiter: Ratelimit.slidingWindow(R5_LIMIT, "2 s"),
      analytics: false,
      // Inside `breaker:*` so `clearLaneKeys()` owns it.
      prefix: "breaker:r5",
    });

    // EARLY in the next bucket: p ~= 0.15, so the previous bucket's 4 requests
    // carry over weighted as floor((1 - 0.15) * 4) = 3, leaving
    // remaining = 5 - (1 + 3) = 1.
    await landAtWindowPosition(R5_WINDOW_MS, 0.05);
    for (let i = 0; i < 4; i++) {
      await fast.limit("carryover-early");
    }
    await landInNextWindowAt(R5_WINDOW_MS, 0.15);
    const early = await fast.limit("carryover-early");
    expect(early.success).toBe(true);
    expect(early.remaining).toBe(1);

    // LATE in the next bucket: the SAME prior 4 requests, now decayed to
    // floor((1 - 0.85) * 4) = 0, leaving remaining = 5 - (1 + 0) = 4.
    await landAtWindowPosition(R5_WINDOW_MS, 0.05);
    for (let i = 0; i < 4; i++) {
      await fast.limit("carryover-late");
    }
    await landInNextWindowAt(R5_WINDOW_MS, 0.85);
    const late = await fast.limit("carryover-late");
    expect(late.success).toBe(true);
    expect(late.remaining).toBe(4);

    // ---------------------------------------------------------------------
    // (b) THE PRODUCTION WINDOW, observed as the store received it. The
    //     deployed Lua sets `PEXPIRE currentKey, window * 2 + 1000`, so a 30 s
    //     window is a 61 000 ms counter TTL. Hand-typed: 30000 * 2 + 1000.
    // ---------------------------------------------------------------------
    await clearLaneKeys();
    await ensureWindowHeadroom(WINDOW_MS, 5000);

    const t0 = Date.now();
    await recordSeamFailure(LOCK_KEY);
    const pttl = await probe.pttl(counterKeyFor(LOCK_KEY, Math.floor(t0 / WINDOW_MS)));
    expect(pttl).toBeGreaterThan(59000);
    expect(pttl).toBeLessThanOrEqual(61000);

    casesExecuted++;
  });

  it("R-6 no increment on denial — the counter stops at the threshold instead of climbing", async () => {
    await ensureWindowHeadroom(WINDOW_MS, 5000);

    const t0 = Date.now();
    // Literal 8 = three failures past the literal threshold of 5, so calls 6-8
    // are denials. Arm the drain up front.
    expectsDenial = true;
    for (let i = 0; i < 8; i++) {
      await recordSeamFailure(LOCK_KEY);
    }
    const t1 = Date.now();
    expect(Math.floor(t1 / WINDOW_MS)).toBe(Math.floor(t0 / WINDOW_MS));

    // The deployed Lua returns {-1, limit} WITHOUT an INCRBY once the window is
    // exhausted. The in-repo double increments on denial; against it this would
    // read 8. `recordSeamFailure` reads `remaining` as well as `success`, so
    // the difference is load-bearing, not cosmetic.
    expect(Number(await probe.get(counterKeyFor(LOCK_KEY, Math.floor(t0 / WINDOW_MS))))).toBe(5);

    casesExecuted++;
  });

  it("R-7 [SLOW, ~2 min] recovery latency is ALIGNMENT-DEPENDENT, not the flat 30 s the docblock claims", async () => {
    // The counter key is never cleared on trip — `recordSeamFailure` writes
    // only the lock — so when the lock expires the previous bucket is still
    // carrying weight. Whether ONE failure immediately re-trips therefore
    // depends on WHERE in the epoch bucket the original trip landed. Both
    // scenarios below wait the SAME hand-typed 32 s and reach OPPOSITE
    // outcomes; that contrast IS the finding.

    // --- Scenario A: trip EARLY in a bucket (p = 0.05). 32 s later we sit at
    //     p ~= 0.117 of the next bucket, carrying floor((1 - 0.117) * 5) = 4,
    //     so ONE failure re-trips instantly.
    await clearLaneKeys();
    await landAtWindowPosition(WINDOW_MS, 0.05);
    const trippedAtA = Date.now();
    for (let i = 0; i < THRESHOLD; i++) {
      await recordSeamFailure(LOCK_KEY);
    }
    await expectLockOpen(LOCK_KEY);

    // Hand-typed 25 s — comfortably INSIDE a 30 s cooldown.
    await sleepUntil(trippedAtA + 25000);
    expect((await isBreakerOpen(LANE_BUDGET_KEY)).open).toBe(true);

    // Hand-typed 32 s — comfortably PAST it. The KEY is still there (its
    // tombstone runs to 120 s) and the circuit must nonetheless read CLOSED,
    // because the expiry that decides that lives in the VALUE. This is the
    // healed-circuit property against real Redis.
    await sleepUntil(trippedAtA + 32000);
    expect(await probe.get<string>(LOCK_KEY)).not.toBeNull();
    expect((await isBreakerOpen(LANE_BUDGET_KEY)).open).toBe(false);

    await recordSeamFailure(LOCK_KEY);
    const reArmed = await expectLockOpen(LOCK_KEY);
    // A FRESH lock, not the tombstone read back: armed within the last second.
    expect(reArmed.armedAtMs).toBeGreaterThan(Date.now() - 1000);

    // --- Scenario B: identical 32 s wait, DIFFERENT alignment. Trip at
    //     p = 0.5; 32 s later we sit at p ~= 0.567, carrying only
    //     floor((1 - 0.567) * 5) = 2, so remaining = 5 - (1 + 2) = 2 > 0 and
    //     the same single failure does NOT re-trip.
    await clearLaneKeys();
    await landAtWindowPosition(WINDOW_MS, 0.5);
    const trippedAtB = Date.now();
    for (let i = 0; i < THRESHOLD; i++) {
      await recordSeamFailure(LOCK_KEY);
    }
    const lockB = await expectLockOpen(LOCK_KEY);
    const rawB = await probe.get<string>(LOCK_KEY);

    await sleepUntil(trippedAtB + 25000);
    expect((await isBreakerOpen(LANE_BUDGET_KEY)).open).toBe(true);

    await sleepUntil(trippedAtB + 32000);
    expect((await isBreakerOpen(LANE_BUDGET_KEY)).open).toBe(false);

    await recordSeamFailure(LOCK_KEY);
    // ⚠️ RE-EXPRESSED, NOT RELAXED. This used to assert the key was NULL — the
    // only way the pre-140.2-07 shape could say "no fresh lock was armed". The
    // key is no longer deleted at the cooldown: it lingers as a tombstone until
    // 120 s. So the same claim is now made two ways, and both are STRICTER than
    // the null check, which could not distinguish "not re-armed" from "the whole
    // key vanished for some unrelated reason":
    //   · the stored value is byte-identical to the one written at the trip, so
    //     nothing was written on top of it; and
    //   · the circuit still reads CLOSED.
    expect(
      await probe.get<string>(LOCK_KEY),
      "A single failure re-armed the circuit 32 s after a trip at p = 0.5. The " +
        "weighted carry-over there is 2, leaving remaining = 2 > 0, so this " +
        "failure must NOT trip — that contrast with scenario A is the finding.",
    ).toBe(rawB);
    expect((await isBreakerOpen(LANE_BUDGET_KEY)).open).toBe(false);
    expect(lockB.expiresAtMs).toBeLessThan(Date.now());

    // Recorded so the numbers are not re-derived downstream: the lock itself is
    // COOLDOWN_S, but the observed time until the seam actually stays usable is
    // the band [COOLDOWN_S, COOLDOWN_S + WINDOW_MS/1000] = [30 s, 60 s].
    expect(COOLDOWN_S).toBe(30);
    expect(WINDOW_MS / 1000).toBe(30);

    casesExecuted++;
  });
});
