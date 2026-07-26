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
// The oracle. Hand-typed literals, mirroring the PRE-PHASE deployed shape.
//
// ⚠️ Plans 140.2-06 and 140.2-07 deliberately CHANGE this shape (06 replaces the
// single global key with per-dependency keys; 07 encodes the expiry in the
// lock's value). Each of those plans owns the re-expression of the constants
// below and declares this file in its `files_modified`. Pinning the wave-1
// shape here is correct, not stale.
// ---------------------------------------------------------------------------

/** The breaker's open-lock key, as the store receives it. */
const LOCK_KEY = "breaker:railway";

/** `<limiter prefix>:<identifier>:<epoch window index>`, as the store receives it. */
const counterKeyFor = (windowIndex: number) =>
  `breaker:breaker:railway:failures:${windowIndex}`;

/** The production sliding window, in milliseconds. */
const WINDOW_MS = 30000;

/** The production trip threshold. */
const THRESHOLD = 5;

/** The production cooldown, in seconds. */
const COOLDOWN_S = 30;

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

  it("R-1 counter identity and namespace — the store receives breaker:breaker:railway:failures:<epoch window>", async () => {
    await ensureWindowHeadroom(WINDOW_MS, 5000);

    const t0 = Date.now();
    // Literal 4 — deliberately BELOW the trip threshold so the only key the
    // store should hold afterwards is the counter itself.
    for (let i = 0; i < 4; i++) {
      await recordSeamFailure();
    }
    const t1 = Date.now();

    // Headroom guard: the burst must not have straddled a bucket boundary.
    expect(Math.floor(t1 / WINDOW_MS)).toBe(Math.floor(t0 / WINDOW_MS));

    const expected = counterKeyFor(Math.floor(t0 / WINDOW_MS));
    const actual = (await probe.keys("*")).sort();

    // EXACT set, not a containment check: a mutation that writes a differently
    // namespaced key must show up as a diff rather than as a missing lookup.
    expect(actual).toEqual([expected]);
    expect(Number(await probe.get(expected))).toBe(4);

    casesExecuted++;
  });

  it("R-2 trip at exactly the threshold — a literal 4 failures leave no lock, the 5th creates it", async () => {
    await ensureWindowHeadroom(WINDOW_MS, 5000);

    // The loop bound is the hand-typed literal 4, NEVER
    // `BREAKER_FAILURE_THRESHOLD - 1`. That is the whole point: raising the
    // production threshold must not silently raise this expectation with it.
    for (let i = 0; i < 4; i++) {
      await recordSeamFailure();
    }
    expect(await probe.get(LOCK_KEY)).toBeNull();

    // The 5th.
    await recordSeamFailure();
    expect(await probe.get<string>(LOCK_KEY)).toBe("open");

    casesExecuted++;
  });

  it("R-3 nx trip idempotency — a later trip does NOT ratchet the first writer's expiry", async () => {
    await ensureWindowHeadroom(WINDOW_MS, 12000);

    for (let i = 0; i < THRESHOLD; i++) {
      await recordSeamFailure();
    }
    const ttlAtTrip = await probe.ttl(LOCK_KEY);
    expect(ttlAtTrip).toBeGreaterThanOrEqual(29);
    expect(ttlAtTrip).toBeLessThanOrEqual(30);

    // Let a hand-typed 4 seconds of the cooldown burn down, then force a second
    // trip: the counter is exhausted, so the limiter denies and the core
    // re-issues its SET. Arm the drain BEFORE the denial, not after the
    // assertions — those may not be reached.
    await sleep(4000);
    expectsDenial = true;
    await recordSeamFailure();

    const ttlAfter = await probe.ttl(LOCK_KEY);
    // With `nx: true` the FIRST writer's expiry stands, so ~4 s has elapsed off
    // a 30 s cooldown => [25, 27]. With `nx: false` the SET overwrites and the
    // TTL snaps back to the full 30, landing outside this band.
    expect(ttlAfter).toBeGreaterThanOrEqual(25);
    expect(ttlAfter).toBeLessThanOrEqual(27);

    casesExecuted++;
  });

  it("R-4 the lock TTL is the cooldown, and the caller-visible Retry-After hint agrees with it", async () => {
    await ensureWindowHeadroom(WINDOW_MS, 5000);

    for (let i = 0; i < THRESHOLD; i++) {
      await recordSeamFailure();
    }

    const ttl = await probe.ttl(LOCK_KEY);
    expect(ttl).toBeGreaterThanOrEqual(29);
    expect(ttl).toBeLessThanOrEqual(30);

    const state = await isBreakerOpen();
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
    await recordSeamFailure();
    const pttl = await probe.pttl(counterKeyFor(Math.floor(t0 / WINDOW_MS)));
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
      await recordSeamFailure();
    }
    const t1 = Date.now();
    expect(Math.floor(t1 / WINDOW_MS)).toBe(Math.floor(t0 / WINDOW_MS));

    // The deployed Lua returns {-1, limit} WITHOUT an INCRBY once the window is
    // exhausted. The in-repo double increments on denial; against it this would
    // read 8. `recordSeamFailure` reads `remaining` as well as `success`, so
    // the difference is load-bearing, not cosmetic.
    expect(Number(await probe.get(counterKeyFor(Math.floor(t0 / WINDOW_MS))))).toBe(5);

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
      await recordSeamFailure();
    }
    expect(await probe.get<string>(LOCK_KEY)).toBe("open");

    // Hand-typed 25 s — comfortably INSIDE a 30 s cooldown.
    await sleepUntil(trippedAtA + 25000);
    expect((await isBreakerOpen()).open).toBe(true);

    // Hand-typed 32 s — comfortably PAST it.
    await sleepUntil(trippedAtA + 32000);
    expect((await isBreakerOpen()).open).toBe(false);

    await recordSeamFailure();
    expect(await probe.get<string>(LOCK_KEY)).toBe("open");

    // --- Scenario B: identical 32 s wait, DIFFERENT alignment. Trip at
    //     p = 0.5; 32 s later we sit at p ~= 0.567, carrying only
    //     floor((1 - 0.567) * 5) = 2, so remaining = 5 - (1 + 2) = 2 > 0 and
    //     the same single failure does NOT re-trip.
    await clearLaneKeys();
    await landAtWindowPosition(WINDOW_MS, 0.5);
    const trippedAtB = Date.now();
    for (let i = 0; i < THRESHOLD; i++) {
      await recordSeamFailure();
    }
    expect(await probe.get<string>(LOCK_KEY)).toBe("open");

    await sleepUntil(trippedAtB + 25000);
    expect((await isBreakerOpen()).open).toBe(true);

    await sleepUntil(trippedAtB + 32000);
    expect((await isBreakerOpen()).open).toBe(false);

    await recordSeamFailure();
    expect(await probe.get(LOCK_KEY)).toBeNull();

    // Recorded so the numbers are not re-derived downstream: the lock itself is
    // COOLDOWN_S, but the observed time until the seam actually stays usable is
    // the band [COOLDOWN_S, COOLDOWN_S + WINDOW_MS/1000] = [30 s, 60 s].
    expect(COOLDOWN_S).toBe(30);
    expect(WINDOW_MS / 1000).toBe(30);

    casesExecuted++;
  });
});
