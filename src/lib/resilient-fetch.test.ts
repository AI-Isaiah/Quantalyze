import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { installFetchMock, type FetchMock } from "@/test/helpers/fetch";
import {
  FAKE_BREAKER_KEY,
  encodeFakeBreakerLock,
  seedBreakerOpen,
  type FakeUpstashEntry,
} from "@/test/helpers/upstash-breaker";

/**
 * Phase 140 / SEAM-03 — resilience core contract.
 *
 * Covers SC-2 (cross-context short-circuit), SC-2-neg (negative control),
 * SC-3a/b (fail OPEN on store error and on an unconfigured store, production
 * included), SC-3c (failure classification) and SC-4c (the budget table
 * actually reaches AbortSignal.timeout).
 *
 * ⚠️ TWO MECHANICS OF `vi.resetModules()`, MEASURED ON vitest 4.1.10 — BOTH
 * MATTER AND THE SECOND CONTRADICTS 140-RESEARCH.md §10.2:
 *
 *  1. Non-mocked modules DO re-execute. That is what makes this file a real
 *     SC-2 proof: `resilient-fetch`'s module body runs again, recreating every
 *     module-scope binding, so a `let breakerState` breaker could not survive.
 *     Only state outside the module — the fake Upstash store — can.
 *
 *  2. `vi.mock` FACTORIES DO **NOT** RE-RUN. Measured directly: a factory
 *     incrementing a hoisted counter reports 1 execution before and after
 *     `vi.resetModules()`. Research §10.2 asserts the opposite and builds the
 *     negative control on it — that shape silently produces a FALSE green
 *     (context B keeps the cached store, short-circuits, and the control never
 *     fires). The per-context hook that DOES exist is `Redis.fromEnv()`, which
 *     the core calls once per module body execution; `beginContext()` below
 *     hangs off it. Hoisting the store remains correct and is what survives the
 *     reset in shared mode.
 *
 * ⚠️ CLASS IDENTITY. After `vi.resetModules()`, a statically imported
 * `CircuitOpenError` is a DIFFERENT class object from the one the freshly
 * imported core throws, so `instanceof` against the static import fails. Assert
 * against the module namespace from the SAME registry (`b.CircuitOpenError`).
 * This is a test-harness artifact only — production has one registry, and the
 * `re-exports the leaf's class identity` test below pins the property that
 * actually ships.
 *
 * ⚠️ Leaked `vi.stubGlobal("fetch")` is this repo's known CI-only (Node 22)
 * failure cause. Every test path unstubs in `afterEach`.
 */

const shared = vi.hoisted(() => {
  /** The "shared Upstash database" — survives vi.resetModules(). */
  const store = new Map<string, { value: string; expiresAt: number }>();
  const mode = {
    /** false → every module context gets its OWN store (negative control). */
    sharedStore: true,
    /**
     * true → the breaker's READ path rejects, exercising the fail-OPEN catch arm.
     *
     * ⚠️ It must cover BOTH `get` and `mget`. Plan 140.2-06 moved the open-check
     * from a single `get` to one `mget` over the row's declared keys; a flag
     * still wired only to `get` would leave `isBreakerOpen` resolving normally,
     * so "fails OPEN when Redis errors" would pass because nothing was open
     * rather than because the store threw — a false green in the one test whose
     * whole subject is the catch arm.
     */
    throwOnGet: false,
    /** true → the failure counter rejects, exercising the swallow-and-log arm. */
    throwOnLimit: false,
    /**
     * true → the failure counter resolves `@upstash/ratelimit`'s FAIL-OPEN
     * timeout sentinel instead of a real verdict (A-09).
     *
     * The library resolves `{ success: true, limit: 0, remaining: 0, reset: 0,
     * reason: "timeout" }` when its own 5 000 ms `timeout` fires — read at
     * `node_modules/@upstash/ratelimit/dist/index.mjs` `applyTimeout`. Its
     * intent is unambiguous: `success: true` means LET TRAFFIC THROUGH. The
     * shape is reproduced here by hand rather than imported, so the double
     * cannot inherit a change to it.
     */
    sentinelOnLimit: false,
    /**
     * HI-01 / W-2 — simulate the CONCURRENT read the breaker's trip path races
     * on, deterministically.
     *
     * When set, the NEXT `get` of a key beginning `breaker:` answers
     * `staleReadOnce.value` whatever the store holds, and the hook disarms
     * itself. That is exactly the observation a second Fluid Compute instance
     * makes when its read lands before the first instance's write, and BOTH
     * shapes of the race need it:
     *   · `{ value: null }` — B sees no lock at all and takes the COLD branch,
     *     where `nx: true` is what stops it overwriting A's live lock.
     *   · `{ value: "open:a:e" }` — B sees the same expired TOMBSTONE A saw and
     *     takes the re-arm branch, where the ownership rule decides which of
     *     them may claim the transition.
     *
     * Nothing else in the repo can produce either interleaving — every existing
     * "concurrency" case returns at the still-live-lock guard BEFORE any `set`,
     * which is why `nx: true` was provably untested and why the tombstone branch
     * had no `nx` at all.
     *
     * A deterministic one-shot rather than a real race: two `Promise.all`
     * drivers would interleave at whichever await happened to be reached first,
     * which is a flake, not a falsifier.
     */
    staleReadOnce: null as { value: string | null } | null,
    /**
     * W-2 — force the store's `set` to answer `null` on a `breaker:` key.
     *
     * `written` gates `emitBreakerTransition("open", ...)`. A null reply is the
     * store saying "another instance won the race and is emitting its own
     * event"; claiming a transition here would double-count every trip across
     * the fleet, which the code's own comment forbids. Nothing asserted that,
     * because nothing could make the reply null.
     */
    nullOnBreakerSet: false,
    /**
     * SEAMRIM-04 — true → `after()` throws, as it genuinely does outside a
     * request scope (cron, prerender).
     *
     * Research assumption A6. `audit.ts` handles exactly this with a
     * `queueMicrotask` fallback, and this flag is what stops that fallback
     * being "simplified away": with it set, the capture must still be
     * attempted and nothing may propagate to the caller.
     */
    throwOnAfter: false,
  };
  /** The store the CURRENT module context is bound to. */
  const ctx = { store };
  /**
   * What the core passed to `new Ratelimit({ limiter })`, OBSERVED and never
   * CONSUMED. This is the plumbing record: it proves the core builds its
   * limiter from the table's constants. The double's own trip point comes from
   * `FAKE_THRESHOLD`, hand-typed in the helper — see the note at the factory.
   */
  const constructed: Array<{ tokens: number; window: string }> = [];
  /**
   * How many times the core ATTEMPTED to record a seam failure, counted at the
   * double's `limit()` entry.
   *
   * The store's open/closed state answers "did the breaker trip"; it cannot
   * answer "how many failures did ONE call record", which is the whole of SC1
   * ("exactly ONE") and of A-22/A-28 ("ZERO"). Counting at the boundary the
   * core crosses is the direct oracle for both, and it is not self-referential:
   * it observes production's call into the double and asserts against
   * hand-typed integers.
   */
  const counters = {
    limitCalls: 0,
    /**
     * Every command the core issued to the store, counted at the fake client's
     * entry.
     *
     * This is the ONLY oracle for "one round trip per open-check" (A-24). The
     * store's contents cannot answer it — a two-read implementation and a
     * one-read implementation leave identical state behind — and the whole point
     * of encoding the expiry in the value is that there is no second call left
     * to disagree with, or to throw after, the first.
     */
    storeCommands: 0,
  };
  /**
   * What the core passed to `Redis.fromEnv(...)`, OBSERVED and never CONSUMED.
   *
   * This is the only place the store's own bounding (SEAMCORE-03 / A-04) is
   * visible from a test: the config never reaches the fake client, it reaches
   * the SDK's HttpClient, whose retry loop and abort branch are what actually
   * spend the lambda's wall clock. Recording the argument and asserting against
   * hand-typed literals is what makes "the client is bounded" falsifiable
   * (ledger row M29).
   */
  const redisConfigs: Array<Record<string, unknown> | undefined> = [];
  /**
   * SEAMRIM-04 — what the core handed to `captureToSentry`, and what it handed
   * to `after()`.
   *
   * ⚠️ THESE ARE TWO SEPARATE RECORDS ON PURPOSE, AND THAT IS THE WHOLE POINT
   * OF LEDGER ROW M97. Replacing `after(() => p…)` with a bare `void p`
   * re-creates NEW-C10-03 while leaving the `captureToSentry` CALL untouched —
   * so `captures` still fills, and a grep for `captureToSentry` in the source
   * still reports the guard satisfied. Only `afterTasks` can tell the two
   * apart: a capture that is never scheduled is orphaned by the Fluid Compute
   * freeze during exactly the correlated incident it exists for.
   */
  const captures: Array<{
    err: unknown;
    options: {
      tags?: Record<string, string>;
      extra?: Record<string, unknown>;
      level?: string;
    };
  }> = [];
  /** Every value handed to `after()`, and the promises those tasks produced. */
  const afterTasks: unknown[] = [];
  const afterSettled: Array<Promise<unknown>> = [];
  return {
    store,
    mode,
    ctx,
    constructed,
    counters,
    redisConfigs,
    captures,
    afterTasks,
    afterSettled,
    /**
     * Called once per module context, from the mocked `Redis.fromEnv()` —
     * the core constructs its redis singleton before its limiter, so both
     * doubles land on the same store for that context.
     */
    beginContext() {
      ctx.store = mode.sharedStore
        ? store
        : new Map<string, { value: string; expiresAt: number }>();
      return ctx.store;
    },
  };
});

/**
 * SEAMRIM-04 — `after()` is the SCHEDULING SEAM, so it is the one this file
 * doubles.
 *
 * A partial mock: everything else `next/server` exports is preserved, because
 * the core's module graph must keep working. The double RUNS the task, as the
 * platform does once the response has flushed, and keeps the resulting promise
 * so a test can await the capture rather than poll for it.
 */
vi.mock("next/server", async () => {
  const actual = await vi.importActual<typeof import("next/server")>(
    "next/server",
  );
  return {
    ...actual,
    after: (task: unknown) => {
      if (shared.mode.throwOnAfter) {
        // The real failure mode, reproduced: outside a request scope `after()`
        // throws SYNCHRONOUSLY.
        throw new Error("`after()` was called outside a request scope");
      }
      shared.afterTasks.push(task);
      const produced =
        typeof task === "function" ? (task as () => unknown)() : task;
      shared.afterSettled.push(Promise.resolve(produced));
    },
  };
});

/**
 * The capture chokepoint, doubled at the module boundary.
 *
 * It RETURNS A PROMISE, exactly as the real leaf does since plan 140.4-06 task
 * 1 — a double that returned `undefined` would make `after(() => p.catch(…))`
 * throw in the test and nowhere else, i.e. a fake that cannot agree with
 * production. `sentry-capture.test.ts` owns the scrub contract; this file owns
 * only "did the sink reach the chokepoint, and was the result scheduled".
 */
vi.mock("./sentry-capture", async () => {
  // ⚠️ ORACLE-INDEPENDENCE HAZARD #7. This factory REPLACES the module, so any
  // export not listed here is `undefined` at the call site and throws from
  // inside a catch block. 140.4-16 added `shouldCaptureNow` to the leaf and
  // wired it into both breaker arms below; it is re-exported from the REAL
  // module rather than faked, because the throttle semantics are what the WR-06
  // cases assert — a fake would be testing the fake.
  const actual = await vi.importActual<typeof import("./sentry-capture")>(
    "./sentry-capture",
  );
  return {
    ...actual,
    captureToSentry: (err: unknown, options: Record<string, unknown>) => {
      shared.captures.push({
        err,
        options: options as {
          tags?: Record<string, string>;
          extra?: Record<string, unknown>;
          level?: string;
        },
      });
      return Promise.resolve();
    },
  };
});

vi.mock("@upstash/redis", async () => {
  const { fakeRedisFor } = await import("@/test/helpers/upstash-breaker");
  return {
    Redis: {
      fromEnv: (config?: Record<string, unknown>) => {
        shared.redisConfigs.push(config);
        const base = fakeRedisFor(shared.beginContext());
        // EVERY command is counted, not just the read ones: the round-trip
        // assertions are about how much wall clock the store can consume, and a
        // `ttl` or a `set` costs exactly what an `mget` does.
        return {
          get: async (key: string) => {
            shared.counters.storeCommands += 1;
            if (shared.mode.throwOnGet) {
              throw new Error("upstash: connection reset");
            }
            if (shared.mode.staleReadOnce && key.startsWith("breaker:")) {
              // One-shot: the racing instance makes exactly ONE stale
              // observation, then behaves normally.
              const stale = shared.mode.staleReadOnce.value;
              shared.mode.staleReadOnce = null;
              return stale;
            }
            return base.get(key);
          },
          mget: async (...keys: string[]) => {
            shared.counters.storeCommands += 1;
            if (shared.mode.throwOnGet) {
              throw new Error("upstash: connection reset");
            }
            return base.mget(...keys);
          },
          ttl: async (key: string) => {
            shared.counters.storeCommands += 1;
            return base.ttl(key);
          },
          set: async (
            key: string,
            value: string,
            opts?: { ex?: number; nx?: boolean },
          ) => {
            shared.counters.storeCommands += 1;
            if (shared.mode.nullOnBreakerSet && key.startsWith("breaker:")) {
              // The store refused the write. The value is deliberately NOT
              // stored, because a null reply means it was not.
              return null;
            }
            return base.set(key, value, opts);
          },
        };
      },
    },
  };
});

vi.mock("@upstash/ratelimit", async () => {
  const { fakeRatelimitFor } = await import("@/test/helpers/upstash-breaker");
  return {
    Ratelimit: class {
      static slidingWindow(tokens: number, window: string) {
        return { tokens, window };
      }
      private readonly fake: { limit: (id: string) => Promise<unknown> };
      constructor(opts: { limiter: { tokens: number; window: string } }) {
        // OBSERVE production's constructor argument; never CONSUME it.
        //
        // This double used to pass that argument straight into the fake as its
        // threshold — the fake harvesting its tuning from production's own
        // `slidingWindow(BREAKER_FAILURE_THRESHOLD, …)` call, so it inherited
        // every mutation to it and could not disagree with production by
        // construction. The fake now takes its hand-typed FAKE_THRESHOLD
        // default (see `@/test/helpers/upstash-breaker`), and what the core
        // constructed is merely RECORDED here, for the plumbing assertion in
        // the `recordSeamFailure` block below to check against literals.
        const { tokens, window } = opts.limiter;
        shared.constructed.push({ tokens, window });
        // Binds to whatever store beginContext() just selected.
        this.fake = fakeRatelimitFor(shared.ctx.store);
      }
      limit(identifier: string) {
        // Counted BEFORE the throwOnLimit branch: an attempted recording that
        // the store then refuses is still one recording the core decided to
        // make, and that decision is what the zero/one assertions are about.
        shared.counters.limitCalls += 1;
        if (shared.mode.throwOnLimit) {
          return Promise.reject(new Error("upstash: limiter unavailable"));
        }
        if (shared.mode.sentinelOnLimit) {
          // The library's FAIL-OPEN timeout sentinel, hand-typed. Never
          // imported and never derived from the fake's own counting.
          return Promise.resolve({
            success: true,
            limit: 0,
            remaining: 0,
            reset: 0,
            reason: "timeout",
          });
        }
        return this.fake.limit(identifier);
      }
    },
  };
});

const ORIGINAL_ENV = { ...process.env };

/**
 * Install a fetch mock resolving a Response-shaped stub with `status`.
 * A bare object rather than `new Response()` so a 204/304 status is
 * expressible and nothing depends on jsdom's Response implementation.
 */
function okFetch(status = 200): FetchMock {
  const mock = installFetchMock();
  mock.mockResolvedValue({ ok: status < 400, status } as Response);
  return mock;
}

/**
 * Install a fetch mock that RESOLVES its headers and then REJECTS its body.
 *
 * This is the modal Railway degradation and the whole of SC1: `fetch` settles,
 * so the transport arm never sees anything, and the failure only appears later
 * inside the caller's `res.json()`. A bare object rather than a `Response`
 * because a real `Response` cannot be constructed with a body that rejects.
 */
function bodyRejectingFetch(rejection: unknown, status = 200): FetchMock {
  const mock = installFetchMock();
  mock.mockResolvedValue({
    ok: status < 400,
    status,
    statusText: "OK",
    headers: new Headers({ "content-type": "application/json" }),
    json: () => Promise.reject(rejection),
    text: () => Promise.reject(rejection),
  } as unknown as Response);
  return mock;
}

/**
 * Install a fetch mock resolving a REAL `Response` carrying a JSON body.
 *
 * `mockImplementation`, not `mockResolvedValue`: a `Response` body is one-shot,
 * so a single shared instance would make every call after the first read from a
 * consumed stream. A real `Response` (rather than the bare stub `okFetch`
 * returns) is required wherever the core's 503 dependency peek must actually
 * run — the peek goes through `res.clone()`, which a bare object does not have.
 */
function jsonFetch(status: number, body: unknown): FetchMock {
  const mock = installFetchMock();
  mock.mockImplementation(() =>
    Promise.resolve(
      new Response(JSON.stringify(body), {
        status,
        headers: { "content-type": "application/json" },
      }),
    ),
  );
  return mock;
}

/**
 * Install a fetch mock resolving a REAL `Response` carrying a `text/plain` body.
 *
 * This is TRAP-2's shape: Starlette's `ServerErrorMiddleware` answers an
 * unhandled exception with `PlainTextResponse("Internal Server Error", 500)`,
 * which is the single most common 5xx and carries no JSON at all.
 */
function textFetch(status: number, text: string): FetchMock {
  const mock = installFetchMock();
  mock.mockImplementation(() =>
    Promise.resolve(
      new Response(text, {
        status,
        headers: { "content-type": "text/plain" },
      }),
    ),
  );
  return mock;
}

/**
 * Read a stored breaker lock with a parser typed HERE, by hand.
 *
 * ⚠️ THE VALUE FORMAT CHANGED IN PLAN 140.2-07 AND THIS IS THE RE-EXPRESSION,
 * NOT A RELAXATION. The stored value used to be the bare string `"open"`, so
 * eight assertions in this file read `entry.value === "open"`. The expiry is now
 * encoded IN the value — `open:<armedAtMs>:<expiresAtMs>` — so that
 * `isBreakerOpen` can decide OPEN/CLOSED *and* derive `retryAfterS` from ONE
 * read, which is what removes the A-24 race structurally.
 *
 * Every one of those eight sites became `expectLockArmed`, which asserts
 * STRICTLY MORE than `=== "open"` did: the value parses, its cooldown span is
 * the hand-typed 30 000 ms, and its expiry is in the future. A regression that
 * wrote a lock with the wrong cooldown was invisible to the old assertion.
 *
 * The regex is written out here rather than imported from the core or the
 * harness: a reader that took its shape from the writer could not disagree with
 * it, which is the Layer-1 defect this whole phase exists to invert.
 */
function storedLock(
  entry: FakeUpstashEntry | undefined,
): { armedAtMs: number; expiresAtMs: number } | null {
  if (!entry) return null;
  const m = /^open:(\d+):(\d+)$/.exec(entry.value);
  return m
    ? { armedAtMs: Number(m[1]), expiresAtMs: Number(m[2]) }
    : null;
}

/** Assert the key holds a LIVE lock whose cooldown span is the hand-typed 30 s. */
function expectLockArmed(entry: FakeUpstashEntry | undefined): {
  armedAtMs: number;
  expiresAtMs: number;
} {
  const lock = storedLock(entry);
  expect(
    lock,
    "The breaker key does not hold a parseable lock. Either the circuit did " +
      "not trip, or the core wrote a value shape this reader does not " +
      "recognise — and a value the core's own decoder cannot parse reads " +
      "CLOSED, so the breaker would be armed in the store and invisible in use.",
  ).not.toBeNull();
  const live = lock as { armedAtMs: number; expiresAtMs: number };
  // A hand-typed 30 000 ms, never BREAKER_COOLDOWN_S: the cooldown the lock
  // ACTUALLY carries is now a property of the stored value, so it is assertable
  // here for the first time.
  expect(live.expiresAtMs - live.armedAtMs).toBe(30_000);
  expect(live.expiresAtMs).toBeGreaterThan(Date.now());
  return live;
}

/** Configure Upstash as PRESENT (the default for most tests). */
function configureUpstash(): void {
  process.env.UPSTASH_REDIS_REST_URL = "https://fake.upstash.invalid";
  process.env.UPSTASH_REDIS_REST_TOKEN = "fake-token";
}

beforeEach(async () => {
  vi.resetModules();
  // 140.4-16 / WR-06 — the capture throttle is MODULE-LEVEL state. Without this
  // reset the first case to trip a breaker arm arms it, and every later case
  // records zero captures — turning real guards green for the wrong reason.
  // `vi.resetModules()` above does NOT clear it: `vi.mock` factories do not
  // re-run on resetModules (measured, vitest 4.1.10 — Oracle hazard #8).
  const { __resetCaptureThrottleForTests } = await import("./sentry-capture");
  __resetCaptureThrottleForTests();
  shared.store.clear();
  shared.ctx.store = shared.store;
  shared.mode.sharedStore = true;
  shared.mode.throwOnGet = false;
  // Every flag resets. A leaked `throwOnLimit` silently disables the failure
  // counter for every later test, which makes "the breaker did not trip"
  // assertions pass for entirely the wrong reason.
  shared.mode.throwOnLimit = false;
  shared.mode.sentinelOnLimit = false;
  // A leaked `staleReadOnce` would make the NEXT test's first breaker read
  // answer null, and a leaked `nullOnBreakerSet` would silently disable every
  // later trip — both produce "the breaker did not open" for the wrong reason.
  shared.mode.staleReadOnce = null;
  shared.mode.nullOnBreakerSet = false;
  // A leaked `throwOnAfter` would silently route every later test's capture
  // down the queueMicrotask fallback, so "the capture was scheduled" would
  // pass for the wrong reason.
  shared.mode.throwOnAfter = false;
  shared.captures.length = 0;
  shared.afterTasks.length = 0;
  shared.afterSettled.length = 0;
  shared.constructed.length = 0;
  shared.redisConfigs.length = 0;
  shared.counters.limitCalls = 0;
  shared.counters.storeCommands = 0;
  configureUpstash();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  process.env = { ...ORIGINAL_ENV };
});

describe("resilient-fetch breaker key", () => {
  it("pins the test double's key to the module's BREAKER_KEY constant", async () => {
    const mod = await import("./resilient-fetch");
    // The helper duplicates the literal (it cannot import the core from inside
    // a vi.mock factory). This assertion is the anti-drift fence.
    expect(mod.BREAKER_KEY).toBe(FAKE_BREAKER_KEY);
  });

  it("re-exports the leaf's CircuitOpenError class identity", async () => {
    // The production invariant behind the dependency-free leaf: the core's
    // re-export is an ALIAS, not a second class. If it ever became a distinct
    // definition, `err instanceof CircuitOpenError` in wizardErrors (which
    // imports the leaf) would be false for errors thrown by the core, and the
    // wizard would fall through to UNKNOWN/500.
    const mod = await import("./resilient-fetch");
    const leaf = await import("./seam-errors");
    expect(mod.CircuitOpenError).toBe(leaf.CircuitOpenError);

    const err = new mod.CircuitOpenError(30);
    expect(err).toBeInstanceOf(leaf.CircuitOpenError);
    expect(err.message).toBe("Analytics service circuit is open");
    expect(err.name).toBe("CircuitOpenError");
  });
});

describe("isBreakerOpen", () => {
  it("reports closed when no open-lock exists", async () => {
    const mod = await import("./resilient-fetch");
    await expect(mod.isBreakerOpen("bridge")).resolves.toEqual({ open: false });
  });

  it("reports open with the lock's remaining TTL as retryAfterS", async () => {
    // 140.2-06 per-site decision: THE GLOBAL KEY. `bridge` declares no
    // dependencies, so the global key is the whole of its check set — which is
    // what makes this ALSO the assertion that a row with an EMPTY declared set
    // still consults the residual global key at all.
    seedBreakerOpen(shared.store, "breaker:railway", 17);
    const mod = await import("./resilient-fetch");
    await expect(mod.isBreakerOpen("bridge")).resolves.toEqual({
      open: true,
      retryAfterS: 17,
    });
  });

  it.each([
    ["the PRE-140.2-07 bare string", "open"],
    ["a truncated encoding", "open:1700000000000"],
    ["a non-numeric expiry", "open:1700000000000:soon"],
    ["an unrelated value", "yes"],
    ["an empty value", ""],
  ])(
    "a lock value the encoding cannot parse (%s) reads CLOSED",
    async (_label, value) => {
      // ⚠️ THIS CASE MOVED MECHANISM IN PLAN 140.2-07 AND THE MOVE IS RECORDED
      // RATHER THAN SMOOTHED. It used to seed `value: "open"` with an INFINITE
      // store TTL and assert `isBreakerOpen` reported OPEN with
      // `DEFAULT_RETRY_AFTER_S` — the shape of a real key whose `EXPIRE` was
      // lost, where the value said open and the TTL read could not say when.
      //
      // Under the value encoding that state is UNREACHABLE: the expiry travels
      // inside the value, so a value that does not carry one is not a lock at
      // all. The honest replacement is the fail-forward direction LOCKED
      // DECISION 4 already mandates — an unparseable value reads CLOSED, and the
      // seam call proceeds.
      //
      // THE COST, STATED. During a rolling deploy an OLD instance can still
      // write the bare `"open"`, and a new instance now ignores it. That is one
      // cooldown of under-protection at a deploy boundary, in the fail-OPEN
      // direction. The alternative — treating an unparseable value as OPEN —
      // would let a single corrupt byte in the shared store deny the whole seam,
      // which is the breaker becoming the outage.
      //
      // Written DIRECTLY rather than through `seedBreakerOpen`, deliberately:
      // the helper's whole job is to produce a value the core CAN parse, so a
      // case about unparseable values must bypass it.
      shared.store.set(FAKE_BREAKER_KEY, {
        value,
        expiresAt: Date.now() + 30_000,
      } satisfies FakeUpstashEntry);
      const fetchMock = okFetch();
      const mod = await import("./resilient-fetch");

      await expect(mod.isBreakerOpen("bridge")).resolves.toEqual({
        open: false,
      });
      await expect(
        mod.resilientFetch("bridge", "/api/portfolio-bridge", {
          retriesOverride: 0,
          method: "POST",
        }),
      ).resolves.toBeDefined();
      expect(fetchMock).toHaveBeenCalledTimes(1);
    },
  );

  /**
   * Phase 141.1 / D-19 (G2) — the LO-02 / TS-39 obligation, discharged.
   *
   * The `^open:(\d+):(\d+)$` shape accepts ANY pair of digit strings, so
   * `open:0:100000000000000000` used to decode to a lock ~1e17 ms in the future.
   * `isBreakerOpen` then derived `retryAfterS ≈ 1e14`, `CircuitOpenError`'s A-15
   * guard accepted it (`Number.isInteger` is true of it), and
   * `Retry-After: 100000000000000` went ON THE WIRE — including to the anonymous
   * teaser. A reversed pair made `emitBreakerTransition`'s `cooldownS` negative.
   *
   * The value is only writable by us today, so this is bookkeeping corruption
   * rather than an attack path — but A-15 exists precisely to stop implausible
   * values reaching a header, and the decoder was the one remaining path that
   * could mint one which PASSED it.
   *
   * The rejection direction is `null`, i.e. CLOSED, which is LOCKED DECISION 4's
   * fail-forward doctrine unchanged: a corrupt byte in a store shared with
   * fifteen production limiters must not be able to deny the whole seam.
   */
  it("G2 — a lock whose span is nonsensical decodes to null and reads CLOSED (LO-02 / TS-39)", async () => {
    const mod = await import("./resilient-fetch");

    // 90 000 ms, hand-typed here: the 30 s cooldown plus the 60 s tombstone,
    // never `(BREAKER_COOLDOWN_S + BREAKER_LOCK_TOMBSTONE_S) * 1000` read back
    // out of the module under test. A legitimate lock cannot outlive the window
    // in which its own key survives.
    const ARMED_AT = 1_700_000_000_000;

    // A span at the ceiling still decodes — the bound rejects the implausible,
    // not the merely long.
    expect(
      mod.decodeBreakerLock(`open:${ARMED_AT}:${ARMED_AT + 90_000}`),
      "The span bound rejected a lock at exactly the cooldown+tombstone " +
        "ceiling. That is a REAL state (a lock armed and read at the far edge " +
        "of its own tombstone), and rejecting it would silently disarm the " +
        "breaker at exactly the moment it is doing its job.",
    ).toEqual({ armedAtMs: ARMED_AT, expiresAtMs: ARMED_AT + 90_000 });
    // And the ordinary 30 s cooldown, the case every other test in this file
    // depends on.
    expect(
      mod.decodeBreakerLock(`open:${ARMED_AT}:${ARMED_AT + 30_000}`),
    ).toEqual({ armedAtMs: ARMED_AT, expiresAtMs: ARMED_AT + 30_000 });

    // The LO-02 headline: an unbounded span.
    expect(
      mod.decodeBreakerLock("open:0:100000000000000000"),
      "A lock span of ~1e17 ms decoded to a LOCK. `isBreakerOpen` turns that " +
        "into retryAfterS ≈ 1e14, A-15's Number.isInteger guard accepts it, " +
        "and `Retry-After: 100000000000000` goes on the wire — to the " +
        "anonymous teaser among others.",
    ).toBeNull();
    // One millisecond past the ceiling — the bound is a real edge, not a
    // gesture at a large number.
    expect(
      mod.decodeBreakerLock(`open:${ARMED_AT}:${ARMED_AT + 90_001}`),
    ).toBeNull();
    // A REVERSED pair: `expiresAtMs < armedAtMs` makes the emitted
    // `cooldownS` negative.
    expect(
      mod.decodeBreakerLock(`open:${ARMED_AT}:${ARMED_AT - 30_000}`),
      "A reversed lock span decoded to a lock. `emitBreakerTransition` then " +
        "reports a NEGATIVE cooldownS to the operator reading the incident.",
    ).toBeNull();
    // A zero span is not a lock either: it is already expired at the instant it
    // was armed, and `<= 0` is the bound TODOS.md's LO-02 prescribes.
    expect(mod.decodeBreakerLock(`open:${ARMED_AT}:${ARMED_AT}`)).toBeNull();

    // END TO END — the harm LO-02 actually names. Without the bound this store
    // value makes `isBreakerOpen` report OPEN with an absurd hint; with it, the
    // corruption reads CLOSED and the seam call proceeds.
    shared.store.set(FAKE_BREAKER_KEY, {
      value: "open:0:100000000000000000",
      expiresAt: Date.now() + 30_000,
    } satisfies FakeUpstashEntry);
    const fetchMock = okFetch();

    await expect(
      mod.isBreakerOpen("bridge"),
      "A corrupt lock span minted a caller-visible Retry-After instead of " +
        "reading CLOSED.",
    ).resolves.toEqual({ open: false });
    await expect(
      mod.resilientFetch("bridge", "/api/portfolio-bridge", {
        retriesOverride: 0,
        method: "POST",
      }),
    ).resolves.toBeDefined();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("fails OPEN when Redis errors", async () => {
    // SC-3a. A store outage must never become the outage: every exit path out
    // of the check resolves, none throws, and the seam call still goes out.
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    shared.mode.throwOnGet = true;
    const fetchMock = okFetch();
    const mod = await import("./resilient-fetch");

    await expect(mod.isBreakerOpen("bridge")).resolves.toEqual({ open: false });
    expect(errorSpy).toHaveBeenCalled();

    // Even with the breaker ALREADY tripped in the store, an unreadable store
    // must not deny traffic — the real request is still attempted.
    //
    // 140.2-06 per-site decision: THE GLOBAL KEY (the helper's default, stated
    // by omission). The claim is about the store being unreadable, so the key
    // seeded is immaterial EXCEPT that it must be one the row would otherwise
    // honour — otherwise "traffic still went out" could mean "the store threw"
    // or merely "nothing was open".
    seedBreakerOpen(shared.store);
    await expect(
      mod.resilientFetch("bridge", "/api/portfolio-bridge", {
        method: "POST",
        retriesOverride: 0,
      }),
    ).resolves.toBeDefined();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("fails OPEN when Upstash is unconfigured", async () => {
    // SC-3b. This is the case CI hits on EVERY run (20+ test files delete the
    // Upstash vars) and the case SEAM-03's wording does not literally cover.
    // Production is asserted explicitly: the breaker has no environment branch,
    // deliberately diverging from ratelimit.ts's fail-CLOSED-in-prod matrix.
    delete process.env.UPSTASH_REDIS_REST_URL;
    delete process.env.UPSTASH_REDIS_REST_TOKEN;
    process.env.VERCEL_ENV = "production";
    vi.resetModules();

    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const fetchMock = okFetch();
    const mod = await import("./resilient-fetch");

    await expect(mod.isBreakerOpen("bridge")).resolves.toEqual({ open: false });
    // Exactly one unconfigured notice, at module load — not per request.
    expect(warnSpy).toHaveBeenCalledTimes(1);

    // Production is asserted above; the seam call still reaches Railway.
    await expect(
      mod.resilientFetch("bridge", "/api/portfolio-bridge", {
        method: "POST",
        retriesOverride: 0,
      }),
    ).resolves.toBeDefined();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("[SEAMCORE-05 / A-24] the breaker state is read ONCE and is self-consistent", () => {
  it("performs exactly ONE store command per open-check, open or closed", async () => {
    // THE structural proof, and the reason both A-24 defects disappear without
    // any extra branching. Before this plan the check was an `mget` for the
    // value followed by a `ttl` for the hint — two facts that could disagree:
    //   · the lock could expire BETWEEN them, so a recovered Railway was denied
    //     for another cooldown with the DEFAULT hint; and
    //   · the SECOND call could throw after the first returned open, and the
    //     catch arm then reported CLOSED — discarding a KNOWN-open state.
    // With the expiry encoded in the value there is no second call to race and
    // none to throw. That is not assertable from the store's contents — a
    // one-read and a two-read implementation leave identical state — so it is
    // asserted at the command boundary.
    seedBreakerOpen(shared.store, "breaker:supabase", 21);
    const mod = await import("./resilient-fetch");

    shared.counters.storeCommands = 0;
    await expect(mod.isBreakerOpen("match-recompute")).resolves.toEqual({
      open: true,
      retryAfterS: 21,
    });
    expect(
      shared.counters.storeCommands,
      "The open-check issued more than one store command. A second call is a " +
        "second fact that can disagree with the first (A-24): the lock can " +
        "expire between them, and a rejection on the second discards a " +
        "KNOWN-open state and reports CLOSED.",
    ).toBe(1);

    // …and the closed path is one command too, over the SAME declared key set.
    shared.store.clear();
    shared.counters.storeCommands = 0;
    await expect(mod.isBreakerOpen("match-recompute")).resolves.toEqual({
      open: false,
    });
    expect(shared.counters.storeCommands).toBe(1);
  });

  it("a HEALED circuit is reported CLOSED even while its tombstone is still stored", async () => {
    // Ledger row M30's falsifier. The key's store TTL deliberately OUTLIVES the
    // cooldown encoded in its value (that lingering tombstone is what makes the
    // A-25 guard possible at all), so "the key exists" and "the circuit is open"
    // are now DIFFERENT questions. A reader that answered the first would deny a
    // recovered Railway for another full minute.
    const now = Date.now();
    const mod = await import("./resilient-fetch");
    // Armed 40 s ago with a 30 s cooldown: expired 10 s ago, tombstone still
    // present. Every number hand-typed.
    shared.store.set("breaker:railway", {
      value: encodeFakeBreakerLock(now - 40_000, now - 10_000),
      expiresAt: now + 50_000,
    } satisfies FakeUpstashEntry);

    await expect(mod.isBreakerOpen("bridge")).resolves.toEqual({ open: false });

    // NEGATIVE CONTROL: the same tombstone shape with an expiry still ahead of
    // us DOES report open, so the green above cannot mean "the reader ignores
    // this value shape entirely".
    shared.store.set("breaker:railway", {
      value: encodeFakeBreakerLock(now - 5_000, now + 25_000),
      expiresAt: now + 85_000,
    } satisfies FakeUpstashEntry);
    await expect(mod.isBreakerOpen("bridge")).resolves.toMatchObject({
      open: true,
    });
  });
});

describe("[SEAMCORE-05 / A-25] a doomed in-flight failure cannot re-arm an expired lock", () => {
  /**
   * THE FAILURE THIS CLOSES, stated once. A call admitted at t=0 under the 60 s
   * `process-key-sync` budget fails at t≈60. The lock armed at t≈0 expired at
   * t=30, so the write succeeded and armed a FRESH 30 s window — for a request
   * that was already doomed before the first trip, and that never had a chance
   * to observe the recovery. One wave of long-budget calls therefore held the
   * breaker open 90 s+ with no new traffic attempted at all.
   *
   * The guard needs to know WHEN the failing request was admitted, and whether a
   * lock was armed after that. The second half is why the lock's store TTL
   * outlives its encoded cooldown: without that tombstone the expired lock is
   * simply gone at t=60 and the question is unanswerable.
   */
  async function exhaustCounter(
    mod: typeof import("./resilient-fetch"),
    key: string,
    admittedAtMs: number,
  ): Promise<void> {
    // A hand-typed 5 — the fake's own threshold, never production's.
    for (let i = 0; i < 5; i++) {
      await mod.recordSeamFailure(key, admittedAtMs);
    }
  }

  it("a failure admitted BEFORE the last lock was armed does NOT re-arm it", async () => {
    // ⚠️ HONEST NOTE ON THIS CASE'S RED. It is GREEN at the pre-plan tree, for a
    // coincidental reason: with no tombstone concept there, the seed simply
    // looks like a LIVE key to the fake store's `nx`, so the write is refused
    // anyway. Its falsifier is therefore ledger row M40 (delete the guard), not
    // the pre-plan tree — and the NEGATIVE CONTROL below is what proves the seed
    // is not merely frozen, since that one DOES redden both before the change
    // and under M40.
    const now = Date.now();
    const mod = await import("./resilient-fetch");
    // The tombstone of a lock armed 40 s ago, expired 10 s ago.
    const ARMED_AT = now - 40_000;
    const tombstone = encodeFakeBreakerLock(ARMED_AT, now - 10_000);
    shared.store.set("breaker:railway", {
      value: tombstone,
      expiresAt: now + 50_000,
    } satisfies FakeUpstashEntry);

    // Admitted 45 s ago — i.e. BEFORE that lock was armed, so this request was
    // in flight for the whole of the cooldown and learned nothing new.
    await exhaustCounter(mod, "breaker:railway", now - 45_000);

    expect(
      shared.store.get("breaker:railway")?.value,
      "A request that was already in flight when the previous lock was armed " +
        "re-armed the circuit. One wave of 60s-budget calls then holds the " +
        "breaker open 90s+ without a single new request ever being attempted.",
    ).toBe(tombstone);
  });

  it("NEGATIVE CONTROL: a failure admitted AFTER that lock was armed DOES re-arm it", async () => {
    // Without this the case above is indistinguishable from "the guard refuses
    // every write", which would disable the breaker entirely.
    const now = Date.now();
    const mod = await import("./resilient-fetch");
    const tombstone = encodeFakeBreakerLock(now - 40_000, now - 10_000);
    shared.store.set("breaker:railway", {
      value: tombstone,
      expiresAt: now + 50_000,
    } satisfies FakeUpstashEntry);

    // Admitted 5 s ago — after the lock expired, so this request DID get to try
    // a recovered Railway and its failure is genuinely new evidence.
    await exhaustCounter(mod, "breaker:railway", now - 5_000);

    const armed = expectLockArmed(shared.store.get("breaker:railway"));
    expect(armed.armedAtMs).toBeGreaterThan(now - 1_000);
  });

  it("resilientFetch supplies the ADMISSION instant, not the recording instant", async () => {
    // The unit cases above prove the guard; this proves the ONE production path
    // reaches it, and that it reaches it with the right NUMBER.
    //
    // ⚠️ THE TWO INSTANTS HAVE TO BE PULLED APART OR THIS PROVES NOTHING. If the
    // request completes instantly, "admitted at" and "recorded at" are the same
    // millisecond, so a `recordSeamFailure` that simply defaulted to `Date.now()`
    // would satisfy every assertion here — the false-green shape this phase
    // exists to kill. So the failing request is made to take a real 500 ms, and
    // the tombstone's armedAt is placed 250 ms into that window: BEFORE the
    // recording instant and AFTER the admission instant. Only the admission
    // instant refuses.
    //
    // ⚠️ Like the doomed case above, this is GREEN at the pre-plan tree for a
    // coincidental reason (no tombstone exists there, so the seeded key simply
    // looks live to `nx`). Its falsifier is the mutation "pass `Date.now()`
    // instead of the admission instant", observed and recorded in this plan's
    // summary alongside M40.
    vi.spyOn(console, "error").mockImplementation(() => {});
    const mod = await import("./resilient-fetch");

    // Four fast 503s load the counter to one below the fake's hand-typed 5.
    // retriesOverride:0 pins single-attempt (the bridge row is retries:1 since
    // Phase 141), so each call records exactly one — the counter arithmetic here
    // depends on it.
    okFetch(503);
    for (let i = 0; i < 4; i++) {
      await mod.resilientFetch("bridge", "/api/portfolio-bridge", {
        method: "POST",
        retriesOverride: 0,
      });
    }
    expect(storedLock(shared.store.get("breaker:railway"))).toBeNull();

    // The 5th is the one that would trip, and it is SLOW.
    vi.unstubAllGlobals();
    const slow = installFetchMock();
    slow.mockImplementation(
      () =>
        new Promise((resolve) =>
          setTimeout(() => resolve({ ok: false, status: 503 } as Response), 500),
        ),
    );

    const admittedAt = Date.now();
    const tombstone = encodeFakeBreakerLock(admittedAt + 250, admittedAt - 1_000);
    shared.store.set("breaker:railway", {
      value: tombstone,
      expiresAt: admittedAt + 85_000,
    } satisfies FakeUpstashEntry);

    await mod.resilientFetch("bridge", "/api/portfolio-bridge", {
      method: "POST",
      // Single-attempt: a retry would arm the breaker on attempt 1, then the
      // pre-attempt-2 re-check would throw, and this test proves the ADMISSION
      // instant of ONE straddling request.
      retriesOverride: 0,
    });
    // The request really did straddle the tombstone's armedAt.
    expect(Date.now()).toBeGreaterThan(admittedAt + 250);

    expect(
      shared.store.get("breaker:railway")?.value,
      "resilientFetch recorded its failure with the RECORDING instant rather " +
        "than the ADMISSION instant, so the A-25 guard can never fire in " +
        "production: by construction a request records after it was admitted, " +
        "and the guard is precisely about the gap between the two.",
    ).toBe(tombstone);
  });
});

describe("[SEAMCORE-03 / A-04] the breaker's own store is bounded", () => {
  /**
   * Every expected value below is a hand-typed literal. `seam-constants.pin.test.ts`
   * pins the same three numbers against the exported constants, so production
   * and this file are two independent statements of the same tuning — either may
   * change, but not both silently.
   *
   * WHY THIS MATTERS AT ALL. `Redis.fromEnv()` with no config takes the SDK
   * defaults: SIX fetch attempts (`i <= retry.attempts`, `attempts = 5`) with
   * `Math.exp(i) * 50` backoff, and `signal: undefined` — no deadline on any of
   * them. Fail-open covers REJECTIONS; a HANG is not a rejection, so a degraded
   * Upstash held the lambda for as long as it liked and none of that time
   * appeared in the SC-4b budget arithmetic.
   */
  it("passes an explicit retry count and a FIXED backoff, not the SDK's exponential default", async () => {
    await import("./resilient-fetch");

    expect(
      shared.redisConfigs,
      "The core did not construct exactly one Redis client for this module " +
        "context.",
    ).toHaveLength(1);
    const config = shared.redisConfigs[0];
    expect(
      config,
      "Redis.fromEnv() was called with NO configuration. That takes the SDK " +
        "defaults — six attempts, exponential backoff, and no deadline at all — " +
        "so a hung Upstash holds the lambda for an unbounded time and none of it " +
        "is in the SC-4b arithmetic.",
    ).toBeDefined();

    const retry = config?.retry as
      | { retries?: number; backoff?: (n: number) => number }
      | undefined;
    expect(retry?.retries).toBe(1);
    // FIXED, at every retry index. The SDK default is `Math.exp(i) * 50`, which
    // reads 50 at i=0 and 1004 at i=3 — so evaluating at two indices is what
    // distinguishes "a fixed backoff was configured" from "the default was left
    // in place and happens to be small at i=0".
    expect(retry?.backoff?.(0)).toBe(250);
    expect(retry?.backoff?.(3)).toBe(250);
  });

  it("supplies the deadline as a FACTORY, and each call gets a FRESH signal", async () => {
    await import("./resilient-fetch");
    const signal = shared.redisConfigs[0]?.signal;

    // A FUNCTION, for two independent reasons, both read at source in
    // `@upstash/redis/chunk-2X4SLXT7.mjs`:
    //
    //  1. The client evaluates `isSignalFunction ? signal() : signal` once per
    //     `request()`. A single AbortSignal INSTANCE is therefore already
    //     aborted on the second store command, so every command after the first
    //     would abort instantly.
    //  2. On abort the two forms behave differently. With a FUNCTION the client
    //     RETHROWS. With a plain signal it fabricates a `new Response(...)` with
    //     `status: 200` whose body is the abort reason — so an aborted `GET`
    //     would look like a SUCCESSFUL read of a value that is not a lock, and
    //     an aborted `SET` would look like a lock that was written. The first is
    //     harmlessly fail-open; the second is an UNARMED breaker reported as
    //     armed, which is the one direction this module may not take.
    expect(
      typeof signal,
      "The breaker's Redis client was given a plain AbortSignal (or none). A " +
        "single instance is already-aborted on the second command, and the " +
        "SDK's plain-signal abort branch fabricates a 200 response carrying the " +
        "abort reason — which would make a swallowed SET look like an armed lock.",
    ).toBe("function");

    const first = (signal as () => AbortSignal)();
    const second = (signal as () => AbortSignal)();
    expect(first).toBeInstanceOf(AbortSignal);
    expect(first).not.toBe(second);
    expect(first.aborted).toBe(false);
    expect(second.aborted).toBe(false);
  });
});

describe("recordSeamFailure", () => {
  it("constructs the failure counter from the table's threshold and window", async () => {
    // PLUMBING, with hand-typed expectations. The double no longer consumes
    // what the core passed it, so this is the assertion that keeps the core's
    // `Ratelimit.slidingWindow(BREAKER_FAILURE_THRESHOLD, BREAKER_WINDOW)` call
    // observable at all. Both expected values are literals typed here, so a
    // retune of either constant reddens this rather than being absorbed.
    await import("./resilient-fetch");

    expect(
      shared.constructed,
      "The core did not construct exactly one breaker limiter for this module " +
        "context. A second construction means a second counter and two breakers " +
        "that can disagree about whether Railway is up.",
    ).toHaveLength(1);
    expect(shared.constructed[0]).toEqual({ tokens: 5, window: "30 s" });
  });

  it("trips the breaker once the failure allowance is exhausted", async () => {
    // ⚠️ THE LOOP BOUND IS PRODUCTION'S DECLARED THRESHOLD, AND THAT IS THE
    // POINT (ledger row M14b). The two sides of this test now come from
    // INDEPENDENT sources: the number of failures driven is production's
    // `BREAKER_FAILURE_THRESHOLD`, while the point at which the counter
    // actually denies is the fake's hand-typed `FAKE_THRESHOLD`. Before the
    // Layer-1 fix the double harvested production's value, so the two sides
    // were the same number and raising the threshold 5 → 30 kept this GREEN.
    // Now a divergence reddens here — which is what makes this a BEHAVIOURAL
    // falsifier rather than a restatement of the number in the pin file.
    const mod = await import("./resilient-fetch");

    for (let i = 0; i < mod.BREAKER_FAILURE_THRESHOLD - 1; i++) {
      await mod.recordSeamFailure("breaker:railway");
    }
    expect(shared.store.get(mod.BREAKER_KEY)).toBeUndefined();

    await mod.recordSeamFailure("breaker:railway");
    expectLockArmed(shared.store.get(mod.BREAKER_KEY));
  });

  it("counts PER KEY — one dependency's failures never trip another's circuit", async () => {
    // OB-8 at the counter level, and the thing that makes per-dependency keying
    // real rather than cosmetic. If the counter identifier lost its
    // per-dependency component, the loop below would trip `breaker:supabase`
    // too — one MT5 gateway restart denying every Supabase-backed call site,
    // which is A-01 wearing a new name. Ledger row M20R.
    const mod = await import("./resilient-fetch");

    // A hand-typed 5 — production's threshold is NOT read here; it is the fake's
    // FAKE_THRESHOLD that decides when the counter denies, and the two are
    // pinned equal in seam-constants.pin.test.ts rather than shared.
    for (let i = 0; i < 5; i++) {
      await mod.recordSeamFailure("breaker:mt5-gateway");
    }
    expectLockArmed(shared.store.get("breaker:mt5-gateway"));

    // Neither the sibling dependency nor the residual global key moved.
    expect(
      shared.store.get("breaker:supabase"),
      "Recording five mt5-gateway failures opened the SUPABASE circuit. The " +
        "counter identifier has lost its per-dependency component, so every " +
        "dependency shares one counter and the per-dependency keys are decorative.",
    ).toBeUndefined();
    expect(shared.store.get("breaker:railway")).toBeUndefined();
  });

  it("does not extend the cooldown when a second instance trips concurrently", async () => {
    // `nx: true` makes the trip idempotent — the first writer's TTL stands, so
    // a second instance tripping moments later cannot ratchet the outage
    // window open indefinitely.
    const mod = await import("./resilient-fetch");
    for (let i = 0; i < mod.BREAKER_FAILURE_THRESHOLD; i++) {
      await mod.recordSeamFailure("breaker:railway");
    }
    const firstExpiry = shared.store.get(mod.BREAKER_KEY)?.expiresAt;
    expect(firstExpiry).toBeDefined();

    await mod.recordSeamFailure("breaker:railway");
    await mod.recordSeamFailure("breaker:railway");

    expect(shared.store.get(mod.BREAKER_KEY)?.expiresAt).toBe(firstExpiry);
  });

  it("[SEAMCORE-04 / A-09] a SLOW store does not trip the breaker", async () => {
    // A LIVE defect, not a hardening nicety. `@upstash/ratelimit`'s `timeout`
    // defaults to 5 000 ms and its sentinel resolves
    // `{ success: true, limit: 0, remaining: 0, reason: "timeout" }` — the
    // library saying LET TRAFFIC THROUGH, because it could not reach the
    // counter. The core's trip test was `if (success && remaining > 0) return;`,
    // so `remaining === 0` fell THROUGH and armed the lock. ONE recorded failure
    // plus one slow Upstash was a full trip.
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    shared.mode.sentinelOnLimit = true;
    const mod = await import("./resilient-fetch");

    // A hand-typed 5 — well past the threshold, so if the sentinel counted at
    // all the lock would certainly exist by now.
    for (let i = 0; i < 5; i++) {
      await mod.recordSeamFailure("breaker:railway");
    }

    expect(
      shared.store.get("breaker:railway"),
      "A slow Upstash tripped the breaker. The limiter's timeout sentinel means " +
        "'the counter was UNREACHABLE, let traffic through', and reading it as " +
        "'the counter is EXHAUSTED' makes the breaker's own store outage into a " +
        "seam outage — the exact inversion LOCKED DECISION 4 forbids.",
    ).toBeUndefined();

    // Logged DISTINCTLY, so an operator can tell "unreachable" from "exhausted".
    const logged = errorSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(logged).toContain("counter was unreachable");
  });

  it("[SEAMCORE-04] NEGATIVE CONTROL: genuine exhaustion still trips on the threshold-th failure", async () => {
    // Without this, a guard that returned early on EVERY result would satisfy
    // the sentinel case above while disabling the breaker completely.
    const mod = await import("./resilient-fetch");

    // Hand-typed 4, then the 5th. A sliding window of 5 ALLOWS the 5th (leaving
    // `remaining === 0`) and denies the 6th, so the breaker must open ON the
    // 5th — not one failure later.
    for (let i = 0; i < 4; i++) {
      await mod.recordSeamFailure("breaker:railway");
    }
    expect(shared.store.get("breaker:railway")).toBeUndefined();

    await mod.recordSeamFailure("breaker:railway");
    expect(shared.store.get("breaker:railway")).toBeDefined();
  });

  it("is a no-op when Upstash is unconfigured", async () => {
    delete process.env.UPSTASH_REDIS_REST_URL;
    delete process.env.UPSTASH_REDIS_REST_TOKEN;
    vi.resetModules();
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const mod = await import("./resilient-fetch");

    await expect(
      mod.recordSeamFailure("breaker:railway"),
    ).resolves.toBeUndefined();
    expect(shared.store.size).toBe(0);
  });

  it("swallows store errors instead of surfacing them to the caller", async () => {
    // A failure to RECORD a failure must not become a second failure the
    // caller has to handle — recordSeamFailure is called from inside the
    // engine's catch arms, where a throw would replace the real upstream error.
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    shared.mode.throwOnLimit = true;
    const mod = await import("./resilient-fetch");

    await expect(
      mod.recordSeamFailure("breaker:railway"),
    ).resolves.toBeUndefined();
    expect(errorSpy).toHaveBeenCalled();
    expect(shared.store.get(mod.BREAKER_KEY)).toBeUndefined();
  });
});

describe("resilientFetch breaker short-circuit", () => {
  /** Drive `n` 5xx responses through the engine to load the failure counter. */
  async function driveFailures(
    mod: typeof import("./resilient-fetch"),
    n: number,
  ): Promise<void> {
    for (let i = 0; i < n; i++) {
      // retriesOverride:0 pins the SINGLE-ATTEMPT path: since Phase 141 flipped
      // the bridge ROW to retries:1, a bare call would now retry and this
      // breaker-loading loop would trip mid-drive. The retry loop has its own
      // file (resilient-fetch.retry.test.ts); these breaker tests isolate the
      // one-attempt classification mechanics.
      await mod.resilientFetch("bridge", "/api/portfolio-bridge", {
        method: "POST",
        retriesOverride: 0,
      });
    }
  }

  it("cross-context: a second module context short-circuits without touching Railway", async () => {
    // SC-2. vi.resetModules() re-executes the module body, which is exactly
    // what recreates any module-scope `let breakerState`. An in-memory breaker
    // therefore CANNOT pass this test; only state in the shared store can.
    const fetchA = okFetch(503);
    const a = await import("./resilient-fetch");
    await driveFailures(a, a.BREAKER_FAILURE_THRESHOLD);
    expectLockArmed(shared.store.get(a.BREAKER_KEY));

    // A different Fluid Compute instance: fresh module registry, same Upstash.
    vi.resetModules();
    vi.unstubAllGlobals();
    const fetchB = okFetch();
    const b = await import("./resilient-fetch");

    await expect(
      b.resilientFetch("bridge", "/api/portfolio-bridge", {
        method: "POST",
        retriesOverride: 0,
      }),
    // Same-registry class object — see the CLASS IDENTITY note in the header.
    ).rejects.toBeInstanceOf(b.CircuitOpenError);
    // THE assertion that proves "without touching Railway".
    expect(fetchB).not.toHaveBeenCalled();
    expect(fetchA).toHaveBeenCalledTimes(a.BREAKER_FAILURE_THRESHOLD);
  });

  it("cross-context: the CircuitOpenError carries the lock TTL as retryAfterS", async () => {
    seedBreakerOpen(shared.store, "breaker:railway", 12);
    const fetchMock = okFetch();
    const mod = await import("./resilient-fetch");

    await expect(
      mod.resilientFetch("bridge", "/api/portfolio-bridge", {
        method: "POST",
        retriesOverride: 0,
      }),
    ).rejects.toMatchObject({
      name: "CircuitOpenError",
      retryAfterS: 12,
      // Static message — no URL, no header, no upstream detail (T-140-05).
      message: "Analytics service circuit is open",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("negative control: with a per-context store the second context does NOT short-circuit", async () => {
    // SC-2-neg. Without this, the passing cross-context test cannot be
    // distinguished from "the test never really created a second context".
    // Flipping the store to per-factory is the ONLY change; if the assertions
    // below hold, the green above genuinely depends on shared state.
    shared.mode.sharedStore = false;
    vi.resetModules();

    const fetchA = okFetch(503);
    const a = await import("./resilient-fetch");
    await driveFailures(a, a.BREAKER_FAILURE_THRESHOLD);
    expect(fetchA).toHaveBeenCalledTimes(a.BREAKER_FAILURE_THRESHOLD);

    vi.resetModules();
    vi.unstubAllGlobals();
    const fetchB = okFetch();
    const b = await import("./resilient-fetch");

    await expect(
      b.resilientFetch("bridge", "/api/portfolio-bridge", {
        method: "POST",
        retriesOverride: 0,
      }),
    ).resolves.toBeDefined();
    expect(fetchB).toHaveBeenCalledTimes(1);
  });
});

describe("resilientFetch failure classification", () => {
  async function drive(
    mod: typeof import("./resilient-fetch"),
    n: number,
    expectThrow: boolean,
  ): Promise<void> {
    for (let i = 0; i < n; i++) {
      // retriesOverride:0 — single-attempt path. The bridge ROW is retries:1
      // since Phase 141; without this pin these classification tests would retry
      // and trip the breaker mid-drive (retry is covered in the retry test file).
      const call = mod.resilientFetch("bridge", "/api/portfolio-bridge", {
        method: "POST",
        retriesOverride: 0,
      });
      if (expectThrow) await expect(call).rejects.toBeDefined();
      else await call;
    }
  }

  it("does not trip on HTTP 4xx, and the next call still reaches Railway", async () => {
    // A4 / Pitfall 3 regression. A handful of users fat-fingering an API key
    // must never become an outage for everyone.
    const fetchMock = okFetch(400);
    const mod = await import("./resilient-fetch");
    await drive(mod, mod.BREAKER_FAILURE_THRESHOLD + 1, false);

    expect(shared.store.get(mod.BREAKER_KEY)).toBeUndefined();

    const before = fetchMock.mock.calls.length;
    await mod.resilientFetch("bridge", "/api/portfolio-bridge", {
      retriesOverride: 0,
      method: "POST",
    });
    expect(fetchMock.mock.calls.length).toBe(before + 1);
  });

  it("trips on HTTP 5xx", async () => {
    okFetch(503);
    const mod = await import("./resilient-fetch");
    await drive(mod, mod.BREAKER_FAILURE_THRESHOLD, false);
    expectLockArmed(shared.store.get(mod.BREAKER_KEY));
  });

  it("trips on deadline (TimeoutError) rejections", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const fetchMock = installFetchMock();
    // The established in-repo simulation (analytics-client.test.ts:385) —
    // never vi.useFakeTimers().
    fetchMock.mockRejectedValue(new DOMException("aborted", "TimeoutError"));
    const mod = await import("./resilient-fetch");
    await drive(mod, mod.BREAKER_FAILURE_THRESHOLD, true);
    expectLockArmed(shared.store.get(mod.BREAKER_KEY));
  });

  it("trips on network TypeError throws", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const fetchMock = installFetchMock();
    fetchMock.mockRejectedValue(new TypeError("fetch failed"));
    const mod = await import("./resilient-fetch");
    await drive(mod, mod.BREAKER_FAILURE_THRESHOLD, true);
    expectLockArmed(shared.store.get(mod.BREAKER_KEY));
  });

  it("rethrows the ORIGINAL error unwrapped", async () => {
    // Wave 2 depends on this: both clients map err.name to their own typed
    // errors. Wrapping here would silently reclassify every timeout.
    vi.spyOn(console, "error").mockImplementation(() => {});
    const original = new DOMException("aborted", "TimeoutError");
    const fetchMock = installFetchMock();
    fetchMock.mockRejectedValue(original);
    const mod = await import("./resilient-fetch");

    await expect(
      mod.resilientFetch("bridge", "/api/portfolio-bridge", {
        method: "POST",
        retriesOverride: 0,
      }),
    ).rejects.toBe(original);
  });
});

describe("[SC1 / SEAMCORE-02] the classification window covers the body read", () => {
  it("headers arrive, the body then aborts ⇒ exactly ONE recorded failure and a typed SeamBodyReadError", async () => {
    // THE case this plan exists for. `AbortSignal.timeout` aborts the response
    // STREAM, not just the header exchange, so a Railway that answers headers
    // fast and then stalls resolves `fetch` — the try closes, the transport arm
    // sees nothing, and pre-fix the rejection surfaced later as a raw
    // DOMException that missed every `instanceof` arm and told the breaker
    // nothing at all.
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const bodyRejection = new DOMException("aborted", "TimeoutError");
    bodyRejectingFetch(bodyRejection);
    const mod = await import("./resilient-fetch");

    const res = await mod.resilientFetch("bridge", "/api/portfolio-bridge", {
      retriesOverride: 0,
      method: "POST",
    });
    // Nothing recorded yet — proof the transport arm genuinely did not fire and
    // that the recording below can only have come from the body read.
    expect(shared.counters.limitCalls).toBe(0);

    const thrown = await res.json().then(
      () => null,
      (e: unknown) => e,
    );

    expect(thrown).toBeInstanceOf(mod.SeamBodyReadError);
    // "…never a raw DOMException": the pre-fix behaviour, stated as a negative
    // so a regression that stopped wrapping cannot pass this on the first
    // assertion alone.
    expect(thrown).not.toBeInstanceOf(DOMException);
    expect(thrown).toMatchObject({
      name: "SeamBodyReadError",
      deadlineExceeded: true,
      // Static message — no URL, no header, no upstream detail (T-140-05).
      message: "Analytics service response body could not be read",
    });
    // The ORIGINAL rejection travels as `cause`, so nothing diagnostic is lost.
    expect((thrown as Error).cause).toBe(bodyRejection);

    // EXACTLY one. Not zero (the pre-fix bug) and not two (a double-record from
    // the >= 500 arm plus the body arm, or an accidental retry).
    expect(shared.counters.limitCalls).toBe(1);
    expect(errorSpy).toHaveBeenCalled();
  });

  it("body-read failures arm the breaker like any other classified failure", async () => {
    // The count assertion above proves the recording happened; this proves the
    // recording is the SAME one the breaker is built on, end to end.
    vi.spyOn(console, "error").mockImplementation(() => {});
    const mod = await import("./resilient-fetch");

    for (let i = 0; i < mod.BREAKER_FAILURE_THRESHOLD; i++) {
      vi.unstubAllGlobals();
      bodyRejectingFetch(new DOMException("aborted", "TimeoutError"));
      const res = await mod.resilientFetch("bridge", "/api/portfolio-bridge", {
        retriesOverride: 0,
        method: "POST",
      });
      await expect(res.json()).rejects.toBeInstanceOf(mod.SeamBodyReadError);
    }

    expectLockArmed(shared.store.get(mod.BREAKER_KEY));
  });

  it("a non-deadline body failure is recorded too, with deadlineExceeded false", async () => {
    // A connection dropped mid-stream ("terminated") is degradation exactly
    // like a deadline; only the flag the clients branch on differs.
    vi.spyOn(console, "error").mockImplementation(() => {});
    bodyRejectingFetch(new TypeError("terminated"));
    const mod = await import("./resilient-fetch");

    const res = await mod.resilientFetch("bridge", "/api/portfolio-bridge", {
      retriesOverride: 0,
      method: "POST",
    });
    const thrown = await res.text().then(
      () => null,
      (e: unknown) => e,
    );

    expect(thrown).toBeInstanceOf(mod.SeamBodyReadError);
    expect(thrown).toMatchObject({ deadlineExceeded: false });
    expect(shared.counters.limitCalls).toBe(1);
  });

  it("a second body read is one-shot, exactly as a Response is, and records NOTHING", async () => {
    // A caller reading the body twice is a CALLER fault, not Railway
    // degradation — recording it would be the A-22 defect in a new place. The
    // underlying Response's own "body already used" rejection is preserved.
    const mock = installFetchMock();
    mock.mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    const mod = await import("./resilient-fetch");

    const res = await mod.resilientFetch("bridge", "/api/portfolio-bridge", {
      retriesOverride: 0,
      method: "POST",
    });
    await expect(res.json()).resolves.toEqual({ ok: true });

    const second = await res.json().then(
      () => null,
      (e: unknown) => e,
    );
    expect(second).not.toBeNull();
    expect(second).not.toBeInstanceOf(mod.SeamBodyReadError);
    expect(shared.counters.limitCalls).toBe(0);
  });

  it("an UNPARSEABLE body is not a breaker failure — the parse error is rethrown raw", async () => {
    // The A-22 defect rebuilt inside the fix, if this regressed: an upstream
    // answering 503 with an empty body, or a FastAPI traceback as text/plain,
    // is Railway REPLYING — not Railway failing to reply. `json()` both reads
    // and parses, and only the reading half is the classification window's
    // business. Callers' `.catch(() => fallback)` arms depend on seeing the
    // parse error unchanged.
    const mock = installFetchMock();
    mock.mockResolvedValue(
      new Response("", {
        status: 503,
        statusText: "Service Unavailable",
        headers: { "content-type": "application/json" },
      }),
    );
    const mod = await import("./resilient-fetch");

    const res = await mod.resilientFetch("bridge", "/api/portfolio-bridge", {
      method: "POST",
      // Single-attempt (bridge row is retries:1 since Phase 141): the counter
      // assertion below pins ONE record for the 503 status arm.
      retriesOverride: 0,
    });
    const thrown = await res.json().then(
      () => null,
      (e: unknown) => e,
    );

    expect(thrown).toBeInstanceOf(SyntaxError);
    expect(thrown).not.toBeInstanceOf(mod.SeamBodyReadError);
    // The 503 status arm recorded once; the parse recorded nothing on top.
    expect(shared.counters.limitCalls).toBe(1);
  });

  it("the closed surface still delegates: ok, status, statusText and headers.get", async () => {
    const mock = installFetchMock();
    mock.mockResolvedValue(
      new Response("nope", {
        status: 503,
        statusText: "Service Unavailable",
        headers: { "content-type": "text/plain", "X-Api-Version": "1" },
      }),
    );
    const mod = await import("./resilient-fetch");

    const res = await mod.resilientFetch("bridge", "/api/portfolio-bridge", {
      retriesOverride: 0,
      method: "POST",
    });
    expect(res.ok).toBe(false);
    expect(res.status).toBe(503);
    expect(res.statusText).toBe("Service Unavailable");
    expect(res.headers.get("content-type")).toBe("text/plain");
    expect(res.headers.get("X-Api-Version")).toBe("1");
    await expect(res.text()).resolves.toBe("nope");
  });

  it("a 503 records exactly one failure; a 4xx and a 500 each record zero", async () => {
    const mod = await import("./resilient-fetch");

    okFetch(503);
    await mod.resilientFetch("bridge", "/api/portfolio-bridge", {
      method: "POST",
      // Single-attempt: the bridge row retries since Phase 141, but this arm
      // pins that ONE 503 records exactly ONE breaker failure.
      retriesOverride: 0,
    });
    expect(shared.counters.limitCalls).toBe(1);

    vi.unstubAllGlobals();
    okFetch(400);
    await mod.resilientFetch("bridge", "/api/portfolio-bridge", {
      retriesOverride: 0,
      method: "POST",
    });
    expect(shared.counters.limitCalls).toBe(1);

    // Added by 140.2-06. Under the pre-phase `>= 500` branch this arm recorded,
    // which is the A-02 defect: a deterministic fault can only be cleared by an
    // operator, so counting it guarantees a self-sustaining outage.
    vi.unstubAllGlobals();
    okFetch(500);
    await mod.resilientFetch("bridge", "/api/portfolio-bridge", {
      retriesOverride: 0,
      method: "POST",
    });
    expect(shared.counters.limitCalls).toBe(1);
  });
});

describe("[SEAMCORE-01 / ROADMAP SC2] attributability decides what counts", () => {
  /**
   * Every expectation below is a hand-typed integer or a hand-typed key string.
   * Nothing is read out of `SEAM_BUDGETS`, out of the discriminator, or out of
   * the fake — the counter is observed at the boundary the core crosses.
   */
  const CALLER_STATUSES = [400, 401, 403, 404, 422];

  it.each(CALLER_STATUSES)(
    "CALLER: a %i records ZERO, whatever its body says",
    async (status) => {
      const mod = await import("./resilient-fetch");
      jsonFetch(status, {
        detail: "Your API key was rejected",
        code: "EXCHANGE_PROBE_FAILED",
        recoverable: false,
      });

      const res = await mod.resilientFetch("bridge", "/api/portfolio-bridge", {
        retriesOverride: 0,
        method: "POST",
      });
      expect(res.status).toBe(status);
      expect(
        shared.counters.limitCalls,
        `A ${status} recorded a breaker failure. A user's bad API key is Railway ` +
          `working CORRECTLY; counting 4xx lets a handful of users fat-fingering ` +
          `credentials take key-connect down for everyone.`,
      ).toBe(0);
      expect(shared.store.size).toBe(0);
    },
  );

  it("CALLER, THROTTLED: a 429 records ZERO in all three wire shapes", async () => {
    const mod = await import("./resilient-fetch");
    // TS-23. Three shapes coexist at HEAD and the core must tolerate all three
    // without knowing which route answered.
    const SHAPES: unknown[] = [
      // (a) the flat app-global RateLimitExceeded handler
      {
        ok: false,
        code: "RATE_LIMITED",
        human_message: "Too many requests",
        detail: "Too many requests",
        correlation_id: "corr-1",
        recoverable: true,
        retry_after_seconds: 60,
      },
      // (b) the nested service_error envelope (routers/internal.py:246)
      {
        detail: {
          code: "RATE_LIMITED",
          dependency: null,
          retryable: true,
          detail: "This key is being probed too often",
        },
      },
      // (c) the bare scalar still at match.py / simulator.py / portfolio.py,
      //     which carries NO code and (at four of five sites, pre-140.1.2) no
      //     Retry-After either. A wait is never derived by parsing prose.
      { detail: "Rate limit exceeded" },
    ];

    for (const body of SHAPES) {
      vi.unstubAllGlobals();
      jsonFetch(429, body);
      await mod.resilientFetch("bridge", "/api/portfolio-bridge", {
        retriesOverride: 0,
        method: "POST",
      });
    }
    expect(shared.counters.limitCalls).toBe(0);
    expect(shared.store.size).toBe(0);
  });

  it("CALLER'S EXCHANGE: a 424 records ZERO and its venue NEVER becomes a key", async () => {
    const mod = await import("./resilient-fetch");

    for (const venue of ["binance", "deribit", "bybit"]) {
      vi.unstubAllGlobals();
      jsonFetch(424, {
        detail: {
          code: "EXCHANGE_PROBE_FAILED",
          dependency: venue,
          retryable: true,
          detail: `${venue} is not responding right now`,
        },
      });
      await mod.resilientFetch("validate-key", "/api/validate-key", {
        retriesOverride: 0,
        method: "POST",
      });
    }

    expect(
      shared.counters.limitCalls,
      "A 424 recorded a breaker failure. C-12: one dashboard render with five " +
        "keys during a Binance outage would be five recordings and a platform-" +
        "wide trip that denies Deribit users, the optimizer and CSV finalize.",
    ).toBe(0);
    // The load-bearing negative: not merely "nothing tripped" but "no key named
    // after a venue exists at all", which a count assertion alone cannot see.
    expect([...shared.store.keys()]).toEqual([]);
  });

  it("SERVICE-PERMANENT: a 500 records ZERO, including the bodyless text/plain shape", async () => {
    const mod = await import("./resilient-fetch");

    // (a) a deliberate 500 carrying retryable:false
    jsonFetch(500, {
      detail: {
        code: "KEK_NOT_CONFIGURED",
        dependency: "kek",
        retryable: false,
        detail: "Encryption is misconfigured",
      },
    });
    await mod.resilientFetch("bridge", "/api/portfolio-bridge", {
      retriesOverride: 0,
      method: "POST",
    });
    expect(shared.counters.limitCalls).toBe(0);

    // (b) TRAP-2 — Starlette's unhandled-exception reply. No JSON at all, and
    //     the verdict must still be terminal and non-counting.
    vi.unstubAllGlobals();
    textFetch(500, "Internal Server Error");
    const res = await mod.resilientFetch("bridge", "/api/portfolio-bridge", {
      retriesOverride: 0,
      method: "POST",
    });
    expect(res.status).toBe(500);
    await expect(res.text()).resolves.toBe("Internal Server Error");
    expect(
      shared.counters.limitCalls,
      "A bodyless text/plain 500 recorded a breaker failure. That is the single " +
        "most common 5xx and it is SERVICE-PERMANENT: an identical retry cannot " +
        "fix it, so counting it re-trips the breaker forever with no operator " +
        "signal, and the breaker then blocks its own recovery probe.",
    ).toBe(0);
    // Nothing named `kek` was ever written, even though a body named it.
    expect([...shared.store.keys()]).toEqual([]);
  });

  it("SERVICE-TRANSIENT: a 503 records ONE, keyed on the NAMED dependency", async () => {
    const mod = await import("./resilient-fetch");
    jsonFetch(503, {
      detail: {
        code: "DB_UNAVAILABLE",
        dependency: "supabase",
        retryable: true,
        detail: "The database blipped",
      },
    });

    // A hand-typed 5 — production's threshold is not read here.
    for (let i = 0; i < 5; i++) {
      await mod.resilientFetch("match-recompute", "/api/match/recompute", {
        retriesOverride: 0,
        method: "POST",
      });
    }

    expect(shared.counters.limitCalls).toBe(5);
    expectLockArmed(shared.store.get("breaker:supabase"));
    expect(
      shared.store.get("breaker:railway"),
      "Five supabase 503s opened the GLOBAL breaker. That is obligation O-2 " +
        "unmet — a 503 naming a dependency may only gate that dependency's " +
        "traffic (A-01).",
    ).toBeUndefined();
    expect(shared.store.get("breaker:mt5-gateway")).toBeUndefined();
  });

  it("SERVICE-TRANSIENT: a text/plain 503 still counts, on the residual global key", async () => {
    // The other half of TRAP-2, and the reason the dependency peek may only ever
    // REFINE a key: an unreadable body must never turn a counting verdict into a
    // non-counting one.
    const mod = await import("./resilient-fetch");
    textFetch(503, "Service Unavailable");

    const res = await mod.resilientFetch("bridge", "/api/portfolio-bridge", {
      method: "POST",
      // Single-attempt: pins ONE record for the text/plain 503 (bridge retries
      // since Phase 141; retry mechanics live in the retry test file).
      retriesOverride: 0,
    });
    expect(res.status).toBe(503);
    await expect(res.text()).resolves.toBe("Service Unavailable");
    expect(shared.counters.limitCalls).toBe(1);
  });

  it("a 503 naming an UNRECOGNISED dependency keys globally, never on the value", async () => {
    // T-140-01. The value arrives over the wire, so a key built from it is
    // attacker-influenceable: mint one and you trip the breaker for a cohort,
    // mint many and you shard it so it never trips at all.
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const mod = await import("./resilient-fetch");
    jsonFetch(503, {
      detail: {
        code: "WAT",
        dependency: "attacker-controlled-value",
        retryable: true,
        detail: "nope",
      },
    });

    for (let i = 0; i < 5; i++) {
      await mod.resilientFetch("bridge", "/api/portfolio-bridge", {
        method: "POST",
        // Single-attempt: five distinct 503s load the counter to the threshold;
        // a retry would trip mid-loop and the pre-attempt-2 re-check would throw.
        retriesOverride: 0,
      });
    }

    expect([...shared.store.keys()].sort()).toEqual([
      "__fake_breaker_count__:breaker:railway:failures",
      "breaker:railway",
    ]);
  });

  it("TRANSPORT: a throw records ONE on the residual global key", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const fetchMock = installFetchMock();
    fetchMock.mockRejectedValue(new TypeError("fetch failed"));
    const mod = await import("./resilient-fetch");

    await expect(
      mod.resilientFetch("match-recompute", "/api/match/recompute", {
        retriesOverride: 0,
        method: "POST",
      }),
    ).rejects.toBeInstanceOf(TypeError);

    expect(shared.counters.limitCalls).toBe(1);
    // Even from a call site that DECLARES supabase: a connection that never
    // completed names no dependency, and that is genuine Railway degradation.
    expect([...shared.store.keys()]).toEqual([
      "__fake_breaker_count__:breaker:railway:failures",
    ]);
  });

  it("a counting status whose body then aborts records EXACTLY ONE, not two", async () => {
    // The interaction wave 5 deliberately deferred to this plan. The `>= 500`
    // arm and the body-read arm are two arms observing ONE degraded request; if
    // both record, five genuinely-distinct incidents' worth of protection fires
    // after two or three, and a breaker that opens early is an outage it created
    // itself.
    vi.spyOn(console, "error").mockImplementation(() => {});
    const rejection = new DOMException("aborted", "TimeoutError");
    const mock = installFetchMock();
    mock.mockImplementation(() =>
      Promise.resolve({
        ok: false,
        status: 503,
        statusText: "Service Unavailable",
        headers: new Headers({ "content-type": "application/json" }),
        // The dependency peek clones and reads; that read aborts too, which is
        // why this request ends up on the global key rather than a named one.
        clone: () => ({ json: () => Promise.reject(rejection) }),
        json: () => Promise.reject(rejection),
        text: () => Promise.reject(rejection),
      } as unknown as Response),
    );
    const mod = await import("./resilient-fetch");

    const res = await mod.resilientFetch("bridge", "/api/portfolio-bridge", {
      method: "POST",
      // Single-attempt: this pins that ONE degraded request records ONCE (status
      // arm + body-read arm within the same attempt do not double-count).
      retriesOverride: 0,
    });
    // The status arm has already recorded once.
    expect(shared.counters.limitCalls).toBe(1);

    await expect(res.json()).rejects.toBeInstanceOf(mod.SeamBodyReadError);

    expect(
      shared.counters.limitCalls,
      "ONE request recorded TWO breaker failures. The status arm and the body-" +
        "read arm both fired for the same degraded request, so the breaker now " +
        "trips at half the declared threshold.",
    ).toBe(1);
  });
});

describe("[OB-8] one dependency's open circuit does not suppress unrelated calls", () => {
  it("with breaker:mt5-gateway open, a call declaring only supabase still reaches Railway", async () => {
    // THE acceptance criterion inherited from 140.1.2, and the falsifier for
    // ledger row M35 (replace the per-dependency check with a single global-key
    // check — option C, rejected by name). Driven from literal key names.
    seedBreakerOpen(shared.store, "breaker:mt5-gateway", 30);
    const fetchMock = okFetch();
    const mod = await import("./resilient-fetch");

    await expect(
      mod.resilientFetch("match-recompute", "/api/match/recompute", {
        retriesOverride: 0,
        method: "POST",
      }),
    ).resolves.toBeDefined();
    expect(
      fetchMock,
      "An open mt5-gateway circuit blocked /api/match/recompute, whose budget " +
        "row declares only supabase. That is A-01: one MT5 gateway restart " +
        "denying every unrelated call site.",
    ).toHaveBeenCalledTimes(1);
  });

  it("NEGATIVE CONTROL: the SAME seeded key DOES block a call site that declares it", async () => {
    // Without this, the green above is indistinguishable from "the seed never
    // opened anything at all" — the seeded-key-nobody-reads failure (TRAP-9)
    // that this plan's whole casualty list exists to prevent.
    seedBreakerOpen(shared.store, "breaker:mt5-gateway", 30);
    const fetchMock = okFetch();
    const mod = await import("./resilient-fetch");

    await expect(
      mod.resilientFetch("validate-key", "/api/validate-key", {
        retriesOverride: 0,
        method: "POST",
      }),
    ).rejects.toBeInstanceOf(mod.CircuitOpenError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("NEGATIVE CONTROL: the declared dependency's own key DOES block the call", async () => {
    seedBreakerOpen(shared.store, "breaker:supabase", 21);
    const fetchMock = okFetch();
    const mod = await import("./resilient-fetch");

    await expect(
      mod.resilientFetch("match-recompute", "/api/match/recompute", {
        retriesOverride: 0,
        method: "POST",
      }),
    ).rejects.toMatchObject({
      name: "CircuitOpenError",
      // The TTL of the key that MATCHED, not the default and not the global
      // key's — this is what proves the index-to-key mapping is right.
      retryAfterS: 21,
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("the residual global key still blocks EVERY call site, declared set or not", async () => {
    // Per-dependency keying narrows the blast radius; it must not remove the
    // Railway-wide stop. A row with an EMPTY declared set is the strictest case.
    seedBreakerOpen(shared.store, "breaker:railway", 30);
    const fetchMock = okFetch();
    const mod = await import("./resilient-fetch");

    await expect(
      mod.resilientFetch("bridge", "/api/portfolio-bridge", {
        method: "POST",
        retriesOverride: 0,
      }),
    ).rejects.toBeInstanceOf(mod.CircuitOpenError);
    await expect(
      mod.resilientFetch("match-recompute", "/api/match/recompute", {
        retriesOverride: 0,
        method: "POST",
      }),
    ).rejects.toBeInstanceOf(mod.CircuitOpenError);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("[SEAMCORE-11 / A-23] the seam refuses redirects", () => {
  it("passes redirect: \"error\" in the fetch init", async () => {
    // Across a cross-origin 302 Node strips `Authorization` but forwards
    // `X-Service-Key`, `X-Internal-Token` and `X-User-Access-Token` VERBATIM —
    // this seam carries all three. Refusing the redirect also removes the "up
    // to 20 hops silently consume the budget" problem. Pinned on the init the
    // core passes, not on a live redirect.
    const fetchMock = okFetch();
    const mod = await import("./resilient-fetch");

    await mod.resilientFetch("bridge", "/api/portfolio-bridge", {
      retriesOverride: 0,
      method: "POST",
    });

    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect(init.redirect).toBe("error");
  });

  it("a caller cannot re-enable redirect following", async () => {
    // The control is only a control if it outranks the call site. `follow` is
    // the platform DEFAULT, so a caller spreading a stored init could restore
    // today's behaviour by accident rather than by decision.
    const fetchMock = okFetch();
    const mod = await import("./resilient-fetch");

    await mod.resilientFetch("bridge", "/api/portfolio-bridge", {
      retriesOverride: 0,
      method: "POST",
      redirect: "follow",
    });

    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect(init.redirect).toBe("error");
  });
});

describe("[SEAMCORE-11 / A-22 + A-28] caller and config faults are NOT Railway degradation", () => {
  /**
   * Every shape `AbortSignal.timeout` itself rejects on, hand-typed.
   *
   * Pre-fix each of these threw INSIDE the try, so a caller fault was logged as
   * "network failure reaching the analytics service" and, five of them in a
   * 30s window, opened the global breaker — from a call-site bug, with the log
   * pointing ops at Railway.
   */
  const INVALID_OVERRIDES: Array<[string, unknown]> = [
    ["NaN", Number.NaN],
    ["negative", -1],
    ["zero", 0],
    ["absurdly large", 1e15],
    ["non-numeric", "15000"],
    ["Infinity", Number.POSITIVE_INFINITY],
  ];

  it.each(INVALID_OVERRIDES)(
    "an invalid timeoutMsOverride (%s) throws at entry and records ZERO failures",
    async (_label, value) => {
      const fetchMock = okFetch();
      const mod = await import("./resilient-fetch");

      const thrown = await mod
        .resilientFetch("bridge", "/api/portfolio-bridge", {
          retriesOverride: 0,
          method: "POST",
          timeoutMsOverride: value as number,
        })
        .then(
          () => null,
          (e: unknown) => e,
        );

      expect(thrown).toBeInstanceOf(mod.SeamConfigError);
      expect(thrown).toMatchObject({ name: "SeamConfigError" });
      // No packet left, and the breaker heard nothing.
      expect(fetchMock).not.toHaveBeenCalled();
      expect(shared.counters.limitCalls).toBe(0);
    },
  );

  it("ME-03: an EXPLICIT undefined timeoutMsOverride falls back to the row's budget", async () => {
    // ⚠️ WHY THIS MOVED OUT OF THE INVALID LIST.
    //
    // The guard was `if ("timeoutMsOverride" in init)` — PROPERTY PRESENCE, not
    // value. The declared type is `timeoutMsOverride?: number`, and under this
    // repo's tsconfig (no `exactOptionalPropertyTypes`) an explicit `undefined`
    // is type-IDENTICAL to an absent property. So the core drew a distinction
    // `tsc` cannot express: two call sites indistinguishable to the compiler,
    // one succeeding and one throwing a hard `SeamConfigError` that both clients
    // then render as a dead upstream — a 502 "could not reach the analytics
    // service" caused by nothing but a spread.
    //
    // And the shape that triggers it is the ORDINARY one:
    //   resilientFetch(key, path, { ...base, timeoutMsOverride: maybeOverride })
    // `analytics-client` dodges it with a conditional spread, but that is a
    // convention held at ONE call site, not a mechanism — nothing stops the
    // other four, or a new one, from writing the natural form.
    //
    // Falling back to the row's declared budget is what an absent property
    // already does, so this makes the two indistinguishable-to-tsc forms
    // behave the same. It is NOT a silent degradation: the deadline used is the
    // one SEAM_BUDGETS declares and SC-4b bounds.
    const fetchMock = okFetch();
    const timeoutSpy = vi.spyOn(AbortSignal, "timeout");
    const mod = await import("./resilient-fetch");

    await mod.resilientFetch("bridge", "/api/portfolio-bridge", {
      retriesOverride: 0,
      method: "POST",
      timeoutMsOverride: undefined,
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    // 15 000, hand-typed: the `bridge` row's declared timeoutMs. Reading it back
    // out of SEAM_BUDGETS would be the self-referential oracle this phase
    // exists to remove — and this literal earned its keep immediately, catching
    // a wrong first guess that a self-referential expectation would have
    // silently agreed with.
    expect(timeoutSpy).toHaveBeenCalledWith(15_000);
    timeoutSpy.mockRestore();
  });

  it("ME-01: an invalid timeoutMsOverride LOGS before it throws, like both URL branches", async () => {
    // The two URL config faults each `console.error` a line naming the fault as
    // a deployment misconfiguration before throwing. This branch threw silently,
    // so an invalid override was invisible in the operator log AND wore a
    // dead-upstream envelope downstream — the worst of both.
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const mod = await import("./resilient-fetch");

    await mod
      .resilientFetch("bridge", "/api/portfolio-bridge", {
        retriesOverride: 0,
        method: "POST",
        timeoutMsOverride: -1,
      })
      .catch(() => {});

    const logged = errorSpy.mock.calls.map((a) => String(a[0])).join("\n");
    expect(logged).toContain("CONFIG fault");
    expect(logged).toContain("timeoutMsOverride");
    // It must say whose fault it is, because the whole point of A-22/A-28 is
    // that ops stop being pointed at Railway for our own config typo.
    expect(logged).toContain("NOT an analytics-service failure");
    errorSpy.mockRestore();
  });

  it("a valid timeoutMsOverride still reaches AbortSignal.timeout", async () => {
    // The negative control for the validation above: a guard that rejected
    // everything would pass all seven cases and break the escape hatch.
    const timeoutSpy = vi.spyOn(AbortSignal, "timeout");
    okFetch();
    const mod = await import("./resilient-fetch");

    await mod.resilientFetch("bridge", "/api/portfolio-bridge", {
      retriesOverride: 0,
      method: "POST",
      timeoutMsOverride: 7_000,
    });
    expect(timeoutSpy).toHaveBeenCalledWith(7_000);
    expect(shared.counters.limitCalls).toBe(0);
  });

  it("a malformed ANALYTICS_SERVICE_URL records ZERO failures and logs CONFIG, not network", async () => {
    // The failure mode this closes: `fetch("notaurl/api/x")` REJECTS (it is not
    // a synchronous throw), so pre-fix it landed in the transport catch, was
    // logged as "network failure reaching the analytics service", and after
    // five requests opened the global breaker permanently — from a config typo,
    // with the log pointing ops at Railway.
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    process.env.ANALYTICS_SERVICE_URL = "notaurl";
    vi.resetModules();
    // The transport REJECTS exactly as Node does for an unparseable URL
    // (measured: `TypeError: Failed to parse URL from notaurl/x`). Without
    // this, removing the eager guard would simply resolve under the mock and
    // the zero-recording and log assertions below could not fail — the guard
    // would be pinned by its own existence rather than by its effect.
    const fetchMock = installFetchMock();
    fetchMock.mockRejectedValue(
      new TypeError("Failed to parse URL from notaurl/api/portfolio-bridge"),
    );
    const mod = await import("./resilient-fetch");

    const thrown = await mod
      .resilientFetch("bridge", "/api/portfolio-bridge", {
        method: "POST",
        retriesOverride: 0,
      })
      .then(
        () => null,
        (e: unknown) => e,
      );

    expect(thrown).toBeInstanceOf(mod.SeamConfigError);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(shared.counters.limitCalls).toBe(0);

    const logged = errorSpy.mock.calls.map((c) => String(c[0])).join("\n");
    // The sentence that points ops at Railway must NOT fire for a config typo.
    expect(logged).not.toContain(
      "network failure reaching the analytics service",
    );
    // …and the one that does fire must name the configuration.
    expect(logged).toContain("ANALYTICS_SERVICE_URL");
  });

  it("a base URL with an unusable protocol is the same CONFIG fault", async () => {
    // `new URL("localhost:8002/x")` PARSES — protocol "localhost:" — so a
    // parse-only guard would pass the single most likely typo straight through
    // to a fetch rejection and back into the network arm.
    vi.spyOn(console, "error").mockImplementation(() => {});
    process.env.ANALYTICS_SERVICE_URL = "localhost:8002";
    vi.resetModules();
    // Same reasoning as above: the platform rejects an unsupported protocol, so
    // the mock does too, and the zero-recording clause below is falsifiable.
    const fetchMock = installFetchMock();
    fetchMock.mockRejectedValue(new TypeError("fetch failed"));
    const mod = await import("./resilient-fetch");

    await expect(
      mod.resilientFetch("bridge", "/api/portfolio-bridge", {
        method: "POST",
        retriesOverride: 0,
      }),
    ).rejects.toBeInstanceOf(mod.SeamConfigError);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(shared.counters.limitCalls).toBe(0);
  });
});

describe("resilientFetch budget wiring", () => {
  it("budget reaches AbortSignal.timeout", async () => {
    // SC-4c. Asserted against the exported table, not a literal — the point is
    // that the TABLE is what reaches the platform primitive.
    const timeoutSpy = vi.spyOn(AbortSignal, "timeout");
    okFetch();
    const mod = await import("./resilient-fetch");

    await mod.resilientFetch("bridge", "/api/portfolio-bridge", {
      retriesOverride: 0,
      method: "POST",
    });
    expect(timeoutSpy).toHaveBeenCalledWith(mod.SEAM_BUDGETS.bridge.timeoutMs);
  });

  it("budget reaches AbortSignal.timeout for a different call site", async () => {
    const timeoutSpy = vi.spyOn(AbortSignal, "timeout");
    okFetch();
    const mod = await import("./resilient-fetch");

    await mod.resilientFetch("process-key-sync", "/process-key", {
      retriesOverride: 0,
      method: "POST",
    });
    expect(timeoutSpy).toHaveBeenCalledWith(
      mod.SEAM_BUDGETS["process-key-sync"].timeoutMs,
    );
  });

  it("honours timeoutMsOverride and never leaks it into the RequestInit", async () => {
    const timeoutSpy = vi.spyOn(AbortSignal, "timeout");
    const fetchMock = okFetch();
    const mod = await import("./resilient-fetch");

    await mod.resilientFetch("bridge", "/api/portfolio-bridge", {
      retriesOverride: 0,
      method: "POST",
      timeoutMsOverride: 7_000,
    });

    expect(timeoutSpy).toHaveBeenCalledWith(7_000);
    const init = fetchMock.mock.calls[0][1] as Record<string, unknown>;
    expect(init).not.toHaveProperty("timeoutMsOverride");
  });

  it("forwards headers byte-for-byte", async () => {
    // A dropped X-User-Id re-opens the CT-4 cross-tenant rate-limit-bucket
    // defect: every tenant would share one upstream limiter window.
    const fetchMock = okFetch();
    const mod = await import("./resilient-fetch");
    const headers = {
      Authorization: "Bearer internal-token",
      "X-User-Id": "user-123",
      "X-Correlation-Id": "corr-abc",
    };

    await mod.resilientFetch("process-key-enqueue", "/process-key", {
      retriesOverride: 0,
      method: "POST",
      headers,
      body: JSON.stringify({ flow_type: "resync" }),
      cache: "no-store",
    });

    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect(init.headers).toEqual(headers);
    expect(init.cache).toBe("no-store");
    expect(init.body).toBe(JSON.stringify({ flow_type: "resync" }));
  });

  it("targets the analytics base URL", async () => {
    const fetchMock = okFetch();
    const mod = await import("./resilient-fetch");
    await mod.resilientFetch("bridge", "/api/portfolio-bridge", {
      retriesOverride: 0,
      method: "POST",
    });
    expect(String(fetchMock.mock.calls[0][0])).toBe(
      "http://localhost:8002/api/portfolio-bridge",
    );
  });
});

/**
 * Phase 140.2 / SEAMCORE-06 — the breaker's OPEN and CLOSE transitions are
 * observable, per dependency.
 *
 * The breaker has never emitted a transition event. Store state answered "is it
 * open right now"; nothing answered "when did it open, which dependency, and how
 * many failures caused it" — which is the whole of an operator's question during
 * an incident, and the reason A-01 took months to attribute.
 *
 * ⚠️ THE EVENT'S FIELD SET IS AN UPPER BOUND, NOT A MINIMUM. `recordSeamFailure`'s
 * docblock constraint stays in force verbatim: never log a request body or a
 * header value from this module, because the seam carries raw exchange API
 * secrets and `INTERNAL_API_TOKEN`. So the payload is asserted as an EXACT key
 * set — a future field carrying the path or a correlation header would redden
 * here rather than ship.
 *
 * ⚠️ NO HALF-OPEN STATE MACHINE, AND THAT IS LOCKED DECISION 3, NOT A GAP. TTL
 * expiry IS the half-open transition. The close is therefore emitted on the
 * first OBSERVED closed-after-open read rather than by a scheduler that would
 * have to exist solely to fire it.
 */
describe("[SEAMCORE-06] the breaker emits a structured transition event", () => {
  /** The ONLY four fields the event may carry, hand-typed. */
  const PERMITTED_FIELDS = [
    "breakerKey",
    "failures",
    "cooldownS",
    "correlationId",
  ];

  type Emitted = { event: string; payload: Record<string, unknown> };

  /**
   * Collect transition events off a console.warn spy.
   *
   * The parameter is typed STRUCTURALLY rather than as `ReturnType<typeof
   * vi.spyOn<...>>`: vitest 4's `spyOn` type parameters are (object, key) and
   * spelling them for `Console` does not type-check, while the only thing this
   * helper needs is `mock.calls`.
   */
  function transitionsFrom(spy: {
    mock: { calls: unknown[][] };
  }): Emitted[] {
    return spy.mock.calls
      .filter((call) => String(call[0]).includes("seam.breaker."))
      .map((call) => ({
        event: String(call[0]),
        payload: call[1] as Record<string, unknown>,
      }));
  }

  afterEach(() => {
    // A leaked fake clock would silently expire every later test's locks.
    vi.useRealTimers();
  });

  it("emits ONE open event at the trip, carrying exactly the four permitted fields", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const mod = await import("./resilient-fetch");

    // A hand-typed 5 — the fake's threshold, pinned literal-against-literal to
    // production's in seam-constants.pin.test.ts rather than read from it.
    for (let i = 0; i < 5; i++) {
      await mod.recordSeamFailure("breaker:railway");
    }

    const events = transitionsFrom(warnSpy);
    expect(
      events.length,
      "The trip emitted no transition event (or emitted more than one). " +
        "Opening the circuit is the single most operationally significant " +
        "thing this module does and it was invisible in the logs.",
    ).toBe(1);
    expect(events[0].event).toContain("seam.breaker.open");
    expect(Object.keys(events[0].payload).sort()).toEqual(
      [...PERMITTED_FIELDS].sort(),
    );
    expect(events[0].payload.breakerKey).toBe("breaker:railway");
    expect(events[0].payload.failures).toBe(5);
    expect(events[0].payload.cooldownS).toBe(30);
    expect(String(events[0].payload.correlationId)).toMatch(
      /^breaker:railway@\d+$/,
    );
  });

  it("takes the dependency key from the VERDICT, not from a module constant", async () => {
    // The field is meaningful only because plan 140.2-06 made breaker keys
    // per-dependency. An event that reported the global key for every trip
    // would be decorative — and indistinguishable from a correct one on the
    // global-key path, which is why this case drives a NAMED dependency.
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const mod = await import("./resilient-fetch");

    for (let i = 0; i < 5; i++) {
      await mod.recordSeamFailure("breaker:supabase");
    }

    const events = transitionsFrom(warnSpy);
    expect(events).toHaveLength(1);
    expect(
      events[0].payload.breakerKey,
      "The transition event named the residual global key for a trip that " +
        "belongs to `supabase`. The field has to come from the verdict, or an " +
        "operator reading it learns nothing the pre-140.2-06 breaker did not " +
        "already tell them.",
    ).toBe("breaker:supabase");
    expect(String(events[0].payload.correlationId)).toMatch(
      /^breaker:supabase@\d+$/,
    );
  });

  it("emits NOTHING when the lock it would arm is already live", async () => {
    // ⚠️ THE MECHANISM HERE IS THE STILL-LIVE-LOCK GUARD, NOT `nx` (LO-03).
    // This case used to claim "`nx: true` refuses the write". It does not reach
    // a `set` at all: both extra calls return at `if (existing.expiresAtMs >
    // now) return;`, ahead of every write. Prose naming a mechanism the
    // assertion never exercises is what concealed HI-01 from five reviews — the
    // mirror of the comment-defeats-the-grep failure this phase hit repeatedly.
    // The `nx` and race properties have their own cases below.
    const mod = await import("./resilient-fetch");
    for (let i = 0; i < 5; i++) {
      await mod.recordSeamFailure("breaker:railway");
    }
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    await mod.recordSeamFailure("breaker:railway");
    await mod.recordSeamFailure("breaker:railway");

    expect(transitionsFrom(warnSpy)).toHaveLength(0);
  });

  // ── HI-01 / W-2 — the CONCURRENT trip, which nothing could reach ───────────
  //
  // Three properties ride on the trip write. All three were unfalsifiable:
  // deleting `nx: true` left the entire suite green, including the real-Redis
  // lane, because every case that claimed to cover concurrency returned at the
  // still-live-lock guard before any `set`.

  it("ME-04: the anonymous teaser's failures land on the key EVERY call site checks", async () => {
    // ⚠️ THIS PINS AN UNCOMFORTABLE FACT ON PURPOSE.
    //
    // `process-key-sync` declares `dependencies: []`, and its comment used to
    // say that keeps an unauthenticated caller's blast radius "at the global key
    // alone" — as if the global key were the small one. It is the LARGEST:
    // `breakerKeysFor` appends BREAKER_KEY to every call site's check. So the
    // least-authenticated path in the system records onto the widest key, and
    // the anonymous teaser can deny a logged-in user's `validate-key`.
    //
    // The exposure is ACCEPTED (fail-open is doctrine, and containment needs a
    // `breaker:teaser` member of a closed set that is mirrored in Python —
    // outside this phase's zero-Python fence; recorded for Phase 141). What is
    // NOT acceptable is a comment that reads as though it were contained, so
    // the true statement is asserted here and the comment now matches it.
    const mod = await import("./resilient-fetch");

    // Five failures on the key the anonymous `process-key-sync` row records to.
    for (let i = 0; i < 5; i++) {
      await mod.recordSeamFailure("breaker:railway");
    }

    // `validate-key` is an AUTHENTICATED, credential-bearing budget that shares
    // no dependency with the teaser. It is blocked anyway.
    const blocked = await mod.isBreakerOpen("validate-key");
    expect(
      blocked.open,
      "The global key stopped suppressing unrelated call sites. If that is a " +
        "deliberate change, ME-04's accepted exposure has changed with it and " +
        "the process-key-sync comment must be re-derived rather than left.",
    ).toBe(true);
  });

  it("HI-01: a stale-reading concurrent instance cannot RATCHET a live lock", async () => {
    // The race `nx: true` exists for: instance B's read lands before instance
    // A's write, so B sees `null` and proceeds to the trip write with a live
    // lock already in the store. `staleReadOnce` reproduces exactly that
    // observation, deterministically.
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const mod = await import("./resilient-fetch");
    for (let i = 0; i < 5; i++) {
      await mod.recordSeamFailure("breaker:railway");
    }
    const firstLock = shared.store.get("breaker:railway");
    expect(firstLock).toBeDefined();
    expect(transitionsFrom(warnSpy)).toHaveLength(1);

    shared.mode.staleReadOnce = { value: null };
    await mod.recordSeamFailure("breaker:railway");

    // The FIRST writer's lock stands, byte for byte. A blind write here re-arms
    // a fresh cooldown on behalf of an instance that never observed a recovery
    // — the R-3 ratchet, arriving through the one door the wave-7 guard cannot
    // watch.
    expect(
      shared.store.get("breaker:railway")?.value,
      "A concurrent instance whose read missed the lock OVERWROTE it. `nx: " +
        "true` is the only thing standing between that and a cooldown that " +
        "ratchets for as long as instances keep racing.",
    ).toBe(firstLock?.value);
    // ...and it claimed a transition that was not its own, double-counting one
    // trip across the fleet (W-2).
    expect(transitionsFrom(warnSpy)).toHaveLength(1);
  });

  it("W-2: emits NOTHING when the store refuses the trip write", async () => {
    // `written` gates the open event. A null reply means another instance won
    // the race and is emitting its own event, so claiming one here double-counts
    // the trip — which the code's own comment forbids and nothing asserted,
    // because nothing could make the reply null.
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const mod = await import("./resilient-fetch");
    shared.mode.nullOnBreakerSet = true;

    for (let i = 0; i < 5; i++) {
      await mod.recordSeamFailure("breaker:railway");
    }

    expect(transitionsFrom(warnSpy)).toHaveLength(0);
    expect(shared.store.get("breaker:railway")).toBeUndefined();
  });

  it("HI-01: only ONE of N instances re-arming from the SAME tombstone claims the trip", async () => {
    // ⚠️ THE BRANCH THAT ACTUALLY RACES, AND IT HAD NO EXCLUSION AT ALL.
    //
    // A lock armed at t=0 expires at t=30; the key survives to t=90 as a
    // tombstone. At t=31 Railway is still degraded, so N instances each hit the
    // trip path within a few milliseconds. Each reads the tombstone (so the
    // still-live-lock guard does not fire), each passes the A-25 admission
    // guard, and each took the `else` branch — a BLIND write returning `"OK"`
    // unconditionally. So every one of them emitted `seam.breaker.open` for ONE
    // trip: the exact double-count the code's own comment says is prevented.
    //
    // The ownership rule is "you armed this circuit iff what you DISPLACED was
    // not a live lock", answered atomically by `SET ... GET`. Here instance A
    // trips normally off the tombstone; instance B is then given the SAME stale
    // observation, so it reaches the same branch — but by the time it writes,
    // A's lock is live, so B displaces a live lock and must not claim anything.
    const mod = await import("./resilient-fetch");
    const armedAtMs = Date.now() - 60_000;
    const expiresAtMs = Date.now() - 30_000;
    const tombstone = `open:${armedAtMs}:${expiresAtMs}`;
    shared.store.set("breaker:railway", {
      value: tombstone,
      expiresAt: Date.now() + 30_000,
    });
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    // Instance A: reads the tombstone, re-arms, owns the transition.
    for (let i = 0; i < 5; i++) {
      await mod.recordSeamFailure("breaker:railway");
    }
    expect(transitionsFrom(warnSpy)).toHaveLength(1);

    // Instance B: its read raced and still sees the tombstone, so it takes the
    // same re-arm branch — but A's lock is already live underneath it.
    shared.mode.staleReadOnce = { value: tombstone };
    await mod.recordSeamFailure("breaker:railway");

    expect(
      transitionsFrom(warnSpy),
      "A second instance re-arming from a tombstone another instance had " +
        "already displaced ALSO claimed the transition. The tombstone branch " +
        "was a blind write whose reply is always truthy, so every racing " +
        "instance emits `seam.breaker.open` for one trip — which is precisely " +
        "what this call site's own comment says must not happen.",
    ).toHaveLength(1);
  });

  it("HI-01: an UNCONTESTED tombstone still re-arms — the rule is ownership, not a freeze", async () => {
    // The negative control. Without it the case above passes on an
    // implementation that simply never re-arms after a tombstone, which would
    // disable the breaker for the whole 60s tombstone window — a far worse bug
    // than the one being fixed, and invisible from the assertion above alone.
    const mod = await import("./resilient-fetch");
    const armedAtMs = Date.now() - 60_000;
    const expiresAtMs = Date.now() - 30_000;
    shared.store.set("breaker:railway", {
      value: `open:${armedAtMs}:${expiresAtMs}`,
      expiresAt: Date.now() + 30_000,
    });
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    for (let i = 0; i < 5; i++) {
      await mod.recordSeamFailure("breaker:railway");
    }

    expect(shared.store.get("breaker:railway")?.value).not.toBe(
      `open:${armedAtMs}:${expiresAtMs}`,
    );
    expect(transitionsFrom(warnSpy)).toHaveLength(1);
  });

  it("emits a close event on the first observed closed-after-open read, sharing the open event's correlation id", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const mod = await import("./resilient-fetch");
    for (let i = 0; i < 5; i++) {
      await mod.recordSeamFailure("breaker:railway");
    }
    const openEvent = transitionsFrom(warnSpy)[0];
    expect(openEvent.event).toContain("seam.breaker.open");

    // Age the CLOCK past the lock's encoded expiry rather than rewriting the
    // lock. The stored value stays byte-for-byte what the core wrote — same
    // armedAt, same 30 s span — so the close event is derived from a REAL lock
    // and the two events are correlatable for the right reason. Rewriting the
    // entry would let this case pass against a value production never produces.
    // The key itself outlives the lock by `BREAKER_LOCK_TOMBSTONE_S` (60 s), so
    // at +31 s it is still in the store: that window IS the tombstone.
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(new Date(Date.now() + 31_000));

    const state = await mod.isBreakerOpen("bridge");
    expect(state.open).toBe(false);

    const closeEvents = transitionsFrom(warnSpy).filter((e) =>
      e.event.includes("seam.breaker.close"),
    );
    expect(
      closeEvents,
      "The circuit healed and nothing said so. TTL expiry IS the half-open " +
        "transition (locked decision 3), so the first read that observes the " +
        "tombstone is the only moment the close is observable at all.",
    ).toHaveLength(1);
    expect(Object.keys(closeEvents[0].payload).sort()).toEqual(
      [...PERMITTED_FIELDS].sort(),
    );
    expect(closeEvents[0].payload.correlationId).toBe(
      openEvent.payload.correlationId,
    );
    expect(closeEvents[0].payload.cooldownS).toBe(30);
  });

  it("emits the close ONCE, not once per read through the tombstone window", async () => {
    const mod = await import("./resilient-fetch");
    // An aged lock in its tombstone window: armed 40 s ago, its 30 s cooldown
    // expired 10 s ago, the KEY still present for another 20 s.
    const armedAtMs = Date.now() - 40_000;
    shared.store.set("breaker:railway", {
      value: encodeFakeBreakerLock(armedAtMs, armedAtMs + 30_000),
      expiresAt: armedAtMs + 90_000,
    });
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    await mod.isBreakerOpen("bridge");
    await mod.isBreakerOpen("bridge");
    await mod.isBreakerOpen("bridge");

    expect(
      transitionsFrom(warnSpy).filter((e) =>
        e.event.includes("seam.breaker.close"),
      ),
      "The close fired on every read. A 60s tombstone window on a busy route " +
        "turns one recovery into thousands of identical lines, which is how an " +
        "operational signal becomes noise nobody alerts on.",
    ).toHaveLength(1);
  });

  it("carries no path, no body and no header value", async () => {
    // The constraint `recordSeamFailure`'s docblock states, asserted rather than
    // trusted: this seam carries raw exchange API secrets and INTERNAL_API_TOKEN.
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    process.env.INTERNAL_API_TOKEN = "int_9f3a1c7e5b2d84a6f0c1e3d5b7a9f2c4";
    const mod = await import("./resilient-fetch");
    for (let i = 0; i < 5; i++) {
      await mod.recordSeamFailure("breaker:railway");
    }

    const serialized = JSON.stringify(transitionsFrom(warnSpy)[0].payload);
    expect(serialized).not.toContain("int_9f3a1c7e5b2d84a6f0c1e3d5b7a9f2c4");
    expect(serialized).not.toContain("/api/");
    expect(serialized.toLowerCase()).not.toContain("authorization");
    expect(serialized.toLowerCase()).not.toContain("bearer");
  });
});

/**
 * Phase 140.2 / SEAMCORE-06 (A-10) — the network-failure line CARRIES the
 * diagnosis, scrubbed.
 *
 * Before this, `err` was DROPPED entirely on the transport arm. The line said
 * "network failure reaching the analytics service" and nothing else, so TLS
 * expiry, a DNS `EAI_AGAIN`, a refused connection and a header `TypeError` were
 * one indistinguishable sentence — an operator could see THAT the seam failed
 * and never WHY.
 *
 * ⚠️ THE TWO SIDES ARE ASSERTED ON THE SAME LOGGED LINE, for the same reason
 * `seam-redaction.test.ts` does it: the naive fix for a leak is to drop `err`
 * (which is the defect this closes) and the naive fix for A-10 is to log it raw
 * (which is the leak). Only a case that fails in BOTH directions pins the
 * behaviour that is actually wanted. Ledger row M43.
 */
describe("[SEAMCORE-06 / A-10] the network-failure line is diagnostic AND safe", () => {
  /** A 40-char internal token, the shape INTERNAL_API_TOKEN actually carries. */
  const TOKEN = "int_9f3a1c7e5b2d84a6f0c1e3d5b7a9f2c48e6d0b1a";

  /** The undici shape for a refused connection, headers inlined by the runtime. */
  function refusedConnection(): TypeError {
    const err = new TypeError(
      "fetch failed\n" +
        "  [cause]: Error: connect ECONNREFUSED 10.0.0.1:8002\n" +
        "  request: { headers: { authorization: 'Bearer " +
        TOKEN +
        "' } }",
    );
    return err;
  }

  async function loggedLines(rejection: unknown): Promise<string> {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const fetchMock = installFetchMock();
    fetchMock.mockRejectedValue(rejection);
    const mod = await import("./resilient-fetch");
    await mod
      // Single-attempt: the bridge row retries since Phase 141, but the "records
      // exactly ONE" assertion downstream pins the one-attempt transport arm.
      .resilientFetch("bridge", "/api/portfolio-bridge", {
        method: "POST",
        retriesOverride: 0,
      })
      .catch(() => undefined);
    return errorSpy.mock.calls.map((c) => String(c[0])).join("\n");
  }

  it("carries the syscall token AND drops the credential, on the same line", async () => {
    process.env.INTERNAL_API_TOKEN = TOKEN;
    vi.resetModules();

    const logged = await loggedLines(refusedConnection());

    expect(logged).toContain("network failure reaching the analytics service");
    expect(
      logged,
      "The network-failure line does not carry the syscall token. That is " +
        "A-10: TLS expiry, DNS failure and a refused connection become one " +
        "indistinguishable sentence, and the operator has to reproduce the " +
        "incident to learn what the log already knew.",
    ).toContain("ECONNREFUSED");
    expect(
      logged,
      "The network-failure line carries INTERNAL_API_TOKEN. undici inlines the " +
        "outgoing headers into the message, so logging it raw is the leak this " +
        "line's scrub exists to prevent — and dropping err instead is A-10.",
    ).not.toContain(TOKEN);
  });

  it("distinguishes a TLS failure from a refused connection", async () => {
    // The concrete thing A-10 costs: two different incidents, two different
    // remediations, one identical log line.
    vi.resetModules();
    const tlsLine = await loggedLines(
      new TypeError("fetch failed\n  [cause]: Error: CERT_HAS_EXPIRED"),
    );
    expect(tlsLine).toContain("CERT_HAS_EXPIRED");
    expect(tlsLine).not.toContain("ECONNREFUSED");
  });

  it("still records exactly ONE breaker failure — the line changed, not the classification", async () => {
    vi.resetModules();
    await loggedLines(refusedConnection());
    expect(shared.counters.limitCalls).toBe(1);
  });
});

/**
 * Phase 140.4 / SEAMRIM-04 — the breaker's three sinks reach a DELIVERING sink.
 *
 * ⚠️ WHY A `console.warn` WAS NEVER AN ALERT. `src/instrumentation.ts` calls
 * `Sentry.init` with NO `integrations`, so `captureConsoleIntegration` is not
 * enabled and nothing this module logs has ever reached Sentry. The breaker's
 * only health sink was one `console.warn` that no operator was ever paged by.
 *
 * ⚠️ THE SCHEDULING IS THE PROPERTY, NOT THE CALL. `emitBreakerTransition`'s own
 * docblock wrote the rule before the sink existed: *"If this ever gains a
 * network sink it must become an awaited call at both sites."* A capture that is
 * merely FIRED loses to the Fluid Compute freeze during the correlated incident
 * it exists for (TRAP-7), which is why every case below asserts `after()` was
 * handed the work — see `shared.afterTasks`.
 *
 * ⚠️ COVERAGE LAW (CONTEXT §2): these three sinks are a ROW 3 per-site edit and
 * therefore PARTIAL BY CONSTRUCTION. Living in one file does not make three
 * hand-enumerated call sites one artefact. It is acceptable only because the set
 * is fully enumerated — `emitBreakerTransition`, `isBreakerOpen`'s catch and
 * `recordSeamFailure`'s catch, and the file contains no fourth.
 */
describe("[SEAMRIM-04] the breaker's transitions and store failures reach the capture chokepoint", () => {
  /** Settle every task `after()` was handed, as the platform's waitUntil does. */
  async function settleScheduled(): Promise<void> {
    await Promise.all(shared.afterSettled);
  }

  it("an OPEN transition captures at `warning` AND keeps its console line", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const mod = await import("./resilient-fetch");

    // A hand-typed 5 — the fake's threshold.
    for (let i = 0; i < 5; i++) {
      await mod.recordSeamFailure("breaker:railway");
    }
    await settleScheduled();

    expect(
      shared.captures,
      "The breaker opened and nothing reached the capture chokepoint. Its only " +
        "other sink is a console.warn that Sentry.init is not configured to " +
        "capture, so the single most operationally significant thing this " +
        "module does was invisible to the people on call for it.",
    ).toHaveLength(1);
    expect(shared.captures[0].options.level).toBe("warning");
    expect(shared.captures[0].options.extra?.breakerKey).toBe("breaker:railway");
    expect(shared.captures[0].options.extra?.failures).toBe(5);
    expect(shared.captures[0].options.extra?.cooldownS).toBe(30);
    expect(
      String(shared.captures[0].options.extra?.correlationId),
    ).toMatch(/^breaker:railway@\d+$/);

    // BOTH, never one instead of the other: the console line is the operator's
    // local trace and replacing it with a capture is a regression.
    const consoleEvents = warnSpy.mock.calls.filter((c) =>
      String(c[0]).includes("seam.breaker.open"),
    );
    expect(
      consoleEvents,
      "The capture REPLACED the structured console line rather than joining it.",
    ).toHaveLength(1);
  });

  it("the OPEN capture is SCHEDULED with after(), not fired and forgotten", async () => {
    // ⚠️ LEDGER ROW M97 LIVES HERE. Under the mutation `after(p)` → `void p`
    // the capture above still lands and a grep for `captureToSentry` in the
    // source still hits — only this assertion moves.
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const mod = await import("./resilient-fetch");

    for (let i = 0; i < 5; i++) {
      await mod.recordSeamFailure("breaker:railway");
    }

    expect(
      shared.afterTasks,
      "The capture was never handed to `after()`. On Vercel that promise is " +
        "orphaned the moment the response flushes — the alert is dropped by " +
        "the freeze during precisely the incident it was raised for (TRAP-7).",
    ).toHaveLength(1);
  });

  it("a CLOSE transition captures at `warning` too — a recovery is not a fault", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const mod = await import("./resilient-fetch");

    // An EXPIRED lock is the observed close: the first read past the encoded
    // expiry is the only moment "usable again" becomes a fact.
    const armedAtMs = Date.now() - 60_000;
    const expiresAtMs = Date.now() - 30_000;
    shared.store.set("breaker:railway", {
      value: encodeFakeBreakerLock(armedAtMs, expiresAtMs),
      expiresAt: Date.now() + 60_000,
    });

    // `bridge` declares no dependencies, so its whole check set is the residual
    // global key — the one the lock above was seeded on.
    await expect(mod.isBreakerOpen("bridge")).resolves.toEqual({
      open: false,
    });
    await settleScheduled();

    expect(shared.captures).toHaveLength(1);
    expect(
      shared.captures[0].options.level,
      "A healed circuit was captured as an `error`. The OPEN half is a " +
        "mitigation working and the CLOSE half is a recovery — routing either " +
        "to `error` makes every recovery look like a fault, which is exactly " +
        "why the existing log is `warn`.",
    ).toBe("warning");
    expect(shared.afterTasks).toHaveLength(1);
  });

  it("isBreakerOpen's store rejection captures at `error` and STILL fails OPEN", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    shared.mode.throwOnGet = true;
    const mod = await import("./resilient-fetch");

    await expect(
      mod.isBreakerOpen("bridge"),
      "The fail-OPEN posture changed. A breaker that refuses traffic because " +
        "of its OWN misconfiguration is strictly worse than having no breaker " +
        "at all (SEAM-03) — this plan makes the failure observable, it does " +
        "not change what the failure does.",
    ).resolves.toEqual({ open: false });
    await settleScheduled();

    expect(shared.captures).toHaveLength(1);
    expect(shared.captures[0].options.level).toBe("error");
    expect(shared.afterTasks).toHaveLength(1);
    // The scrubbed console line survives — it is the operator's local trace.
    expect(
      errorSpy.mock.calls.map((c) => String(c[0])).join("\n"),
    ).toContain("breaker check failed");
  });

  it("[140.4-16 / WR-06] a SUSTAINED store failure captures ONCE, and logs EVERY time", async () => {
    // Same failure mode as `ratelimit.ts`' posture-2 arm: this fires once per
    // REQUEST, not once per transition, and it sits on the seam's
    // highest-volume path. During a store outage every request emits an
    // `import("@sentry/nextjs")` + `captureException` held alive by `after()`,
    // which burns the quota and drops OTHER alerts while the incident is live.
    //
    // ⚠️ KEYED ON (surface, stage), NOT ON `budgetKey`. Twelve budgets going
    // down together is ONE incident; keying per budget would restore twelve
    // times the storm, which is why the loop below walks DIFFERENT budgets.
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    shared.mode.throwOnGet = true;
    const mod = await import("./resilient-fetch");

    const budgets = ["bridge", "simulator", "portfolio-optimizer"] as const;
    for (let i = 0; i < 12; i++) {
      await mod.isBreakerOpen(budgets[i % budgets.length]);
    }
    await settleScheduled();

    expect(
      shared.captures.length,
      "12 probes across 3 budgets during one outage produced 12 captures. " +
        "An outage that hits several budgets is one incident, not several.",
    ).toBe(1);
    expect(
      errorSpy.mock.calls.filter((c) =>
        String(c[0]).includes("breaker check failed"),
      ).length,
      "the local log was throttled too — the operator can no longer see how " +
        "many requests ran with the breaker blind",
    ).toBe(12);
  });

  it("recordSeamFailure's store rejection captures at `error` and still swallows", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    shared.mode.throwOnLimit = true;
    const mod = await import("./resilient-fetch");

    await expect(
      mod.recordSeamFailure("breaker:railway"),
    ).resolves.toBeUndefined();
    await settleScheduled();

    expect(shared.captures).toHaveLength(1);
    expect(shared.captures[0].options.level).toBe("error");
    expect(shared.afterTasks).toHaveLength(1);
    expect(
      errorSpy.mock.calls.map((c) => String(c[0])).join("\n"),
    ).toContain("failed to record seam failure");
  });

  it("A6: outside a request scope the capture still goes out and NOTHING propagates", async () => {
    // `after()` throws synchronously in a cron / prerender context. `audit.ts`
    // handles that with a queueMicrotask fallback and this case is what stops
    // that fallback being "simplified away" — without it, a seam call on a
    // non-route path would throw a scheduling error from inside a catch block,
    // replacing the real upstream error with a bookkeeping one.
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    shared.mode.throwOnAfter = true;
    const mod = await import("./resilient-fetch");

    for (let i = 0; i < 5; i++) {
      await expect(
        mod.recordSeamFailure("breaker:railway"),
      ).resolves.toBeUndefined();
    }
    // Drain the microtask queue the fallback scheduled onto.
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(shared.afterTasks).toHaveLength(0);
    expect(
      shared.captures,
      "`after()` threw and the capture was abandoned. The non-request-scope " +
        "fallback is not optional (research assumption A6).",
    ).toHaveLength(1);
    // The fallback announces itself, so log aggregation can quantify the
    // non-route path rather than silently attributing its drops to Sentry.
    expect(
      warnSpy.mock.calls.map((c) => String(c[0])).join("\n"),
    ).toContain("non-request scope");
  });

  it("NEGATIVE CONTROL: a healthy breaker check captures NOTHING", async () => {
    // Without this, an implementation that captured on every call would satisfy
    // every case above while turning the seam's happy path into a Sentry flood.
    const mod = await import("./resilient-fetch");

    await expect(mod.isBreakerOpen("bridge")).resolves.toEqual({ open: false });
    await mod.recordSeamFailure("breaker:railway");
    await settleScheduled();

    expect(shared.captures).toHaveLength(0);
    expect(shared.afterTasks).toHaveLength(0);
  });
});

/**
 * [141.1 / D-08 / SC-E] THE REGISTRY-BYPASS AXIS IS CLOSED AT COMPILE TIME.
 *
 * ⚠️ THE COMPILER IS THE ASSERTION HERE — there is no runtime expectation that
 * can fail, and none is wanted. Bucket C1: while `retriesOverride` was optional
 * and `resilientFetch` fell back to `SEAM_BUDGETS[budgetKey].retries`, the call
 * below inherited `retries: 1` from the `process-key-enqueue` row — with the
 * SEAM-06 retry-safety registry never consulted — and it TYPECHECKED. The body
 * is the aggravating detail rather than decoration: `flow_type: "teaser"` is the
 * one flow deliberately excluded from `RETRY_SAFE_FLOW_TYPES` (a teaser compute
 * is not idempotent), and hand-picking a budget key beside a hand-written
 * `flow_type` is not hypothetical — `keys/validate-and-encrypt/route.ts` is a
 * live instance of that shape.
 *
 * The directive below is load-bearing in BOTH directions. Today it absorbs a
 * real TS2345 ("`retriesOverride` is missing … but required"). If anyone ever
 * makes the field optional again, or restores the row fallback in a way that
 * softens the type, the error disappears and `tsc --noEmit` fails instead with
 * "Unused '@ts-expect-error' directive". That tsc failure IS this test.
 *
 * Following the house form of `src/__tests__/seed-demo-data-types.test.ts`: all
 * type-level assertions live in a function that is NEVER invoked, so nothing
 * here issues a fetch or touches the breaker; vitest still type-checks the file.
 */
function _d08TypeAssertions(rf: typeof import("./resilient-fetch")): void {
  // The C1 shape: a budget key picked by hand, a flow_type written by hand, and
  // no retry verdict anywhere. It must not compile.
  // @ts-expect-error - retriesOverride is REQUIRED (D-08): a call site cannot acquire a retry without stating a verdict
  void rf.resilientFetch("process-key-enqueue", "/process-key", {
    method: "POST",
    body: JSON.stringify({ flow_type: "teaser" }),
  });

  // The same call WITH a verdict compiles — the negative control, without which
  // the directive above could be satisfied by any unrelated type error.
  void rf.resilientFetch("process-key-enqueue", "/process-key", {
    method: "POST",
    body: JSON.stringify({ flow_type: "teaser" }),
    retriesOverride: 0,
  });
}

describe("[141.1 / D-08 / SC-E] a call site cannot acquire a retry by inheritance", () => {
  it("compiles this file at all — the @ts-expect-error fixture above is the real assertion", () => {
    // The one runtime line: proves the fixture still references the symbol it
    // claims to (a rename of `resilientFetch` would otherwise leave the type
    // fixture asserting nothing while this file stayed green).
    expect(typeof _d08TypeAssertions).toBe("function");
  });
});
