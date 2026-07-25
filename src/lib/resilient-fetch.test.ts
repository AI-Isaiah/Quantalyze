import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { installFetchMock, type FetchMock } from "@/test/helpers/fetch";
import {
  FAKE_BREAKER_KEY,
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
    /** true → redis.get rejects, exercising the fail-OPEN catch arm. */
    throwOnGet: false,
    /**
     * true → redis.get NEVER SETTLES. This is the CR-02 shape: a stalled
     * Upstash REST call is not a rejection, so the fail-OPEN catch arm does
     * nothing for it and only a deadline can.
     */
    hangOnGet: false,
    /** true → the failure counter never settles (the write half of CR-02). */
    hangOnLimit: false,
    /** true → the failure counter rejects, exercising the swallow-and-log arm. */
    throwOnLimit: false,
    /**
     * true → the failure counter resolves @upstash/ratelimit's FAIL-OPEN
     * timeout sentinel ({success:true, limit:0, remaining:0, reason:"timeout"})
     * instead of counting. F-5: this must NOT be read as exhaustion.
     */
    limiterTimeoutSentinel: false,
    /** true → redis.ttl rejects. Only reachable once the lock reads "open". */
    throwOnTtl: false,
  };
  /** Config object the core passed to `Redis.fromEnv()`, captured per context. */
  const captured = {
    redisConfig: undefined as Record<string, unknown> | undefined,
    limiterConfig: undefined as Record<string, unknown> | undefined,
  };
  /** The store the CURRENT module context is bound to. */
  const ctx = { store };
  /** Identifiers passed to `Ratelimit.resetUsedTokens` (C5). */
  const resetUsedTokensCalls: string[] = [];
  return {
    store,
    mode,
    ctx,
    captured,
    resetUsedTokensCalls,
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

vi.mock("@upstash/redis", async () => {
  const { fakeRedisFor } = await import("@/test/helpers/upstash-breaker");
  return {
    Redis: {
      fromEnv: (config?: Record<string, unknown>) => {
        // CR-02 — the core must now construct its client with retry disabled
        // and a per-request abort-signal FACTORY. Capture the config so a test
        // can assert the wiring rather than trusting the SDK defaults.
        shared.captured.redisConfig = config;
        const base = fakeRedisFor(shared.beginContext());
        return {
          ...base,
          get: async (key: string) => {
            if (shared.mode.throwOnGet) {
              throw new Error("upstash: connection reset");
            }
            if (shared.mode.hangOnGet) {
              // Never settles — a stalled REST call, not a rejection.
              return new Promise<never>(() => {});
            }
            return base.get(key);
          },
          ttl: async (key: string) => {
            if (shared.mode.throwOnTtl) {
              throw new Error("upstash: ttl unavailable");
            }
            return base.ttl(key);
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
      private readonly fake: {
        limit: (id: string) => Promise<unknown>;
        resetUsedTokens: (id: string) => Promise<void>;
      };
      /** Captured so a test can assert the core's limiter construction. */
      static lastConfig: Record<string, unknown> | undefined;
      constructor(opts: { limiter: { tokens: number } } & Record<string, unknown>) {
        (this.constructor as { lastConfig?: unknown }).lastConfig = opts;
        shared.captured.limiterConfig = opts;
        // Binds to whatever store beginContext() just selected.
        this.fake = fakeRatelimitFor(
          shared.ctx.store,
          opts.limiter.tokens,
          shared.mode.limiterTimeoutSentinel,
        );
      }
      limit(identifier: string) {
        if (shared.mode.throwOnLimit) {
          return Promise.reject(new Error("upstash: limiter unavailable"));
        }
        if (shared.mode.hangOnLimit) {
          return new Promise<never>(() => {});
        }
        return this.fake.limit(identifier);
      }
      /**
       * C5 — the breaker clears the failure counter the instant it writes the
       * open-lock, via the library's own public reset. Forwarded to the fake so
       * a test can observe the counter key actually disappearing.
       */
      resetUsedTokens(identifier: string) {
        shared.resetUsedTokensCalls.push(identifier);
        return this.fake.resetUsedTokens(identifier);
      }
    },
  };
});

const ORIGINAL_ENV = { ...process.env };

/**
 * Install a fetch mock resolving what the PYTHON SERVICE really sends: a
 * FastAPI `HTTPException` JSON envelope (`{"detail": …}`) under an
 * `application/json` content-type, at `status`.
 *
 * REAL `Response` objects, not bare `{ok, status}` stubs (Phase 140 review /
 * F-1). The classifier's whole job is now to read the content-type and peek at
 * the body, so a stub without those cannot exercise it — and, worse, a stub
 * that lacks them would let a broken classifier pass. A fresh Response PER
 * CALL because a body may only be consumed once.
 */
function okFetch(status = 200): FetchMock {
  const mock = installFetchMock();
  mock.mockImplementation(
    async () =>
      new Response(JSON.stringify({ detail: "handled by the application" }), {
        status,
        headers: { "content-type": "application/json" },
      }),
  );
  return mock;
}

/**
 * Install a fetch mock resolving what the RAILWAY EDGE sends when the
 * container is down or unresponsive: an HTML error page, not a FastAPI
 * envelope. This is the shape of a genuine "the analytics service is not
 * answering" 5xx on the wire, and the one that must drive the breaker.
 */
function edgeFetch(status = 502): FetchMock {
  const mock = installFetchMock();
  mock.mockImplementation(
    async () =>
      new Response(
        "<!DOCTYPE html><html><body><h1>Application failed to respond</h1></body></html>",
        { status, headers: { "content-type": "text/html; charset=utf-8" } },
      ),
  );
  return mock;
}

/** Configure Upstash as PRESENT (the default for most tests). */
function configureUpstash(): void {
  process.env.UPSTASH_REDIS_REST_URL = "https://fake.upstash.invalid";
  process.env.UPSTASH_REDIS_REST_TOKEN = "fake-token";
}

beforeEach(() => {
  vi.resetModules();
  shared.store.clear();
  shared.ctx.store = shared.store;
  shared.mode.sharedStore = true;
  shared.mode.throwOnGet = false;
  // A leaked hang flag would stall every later test at the store deadline
  // instead of failing loudly, so both reset here alongside throwOnLimit.
  shared.mode.hangOnGet = false;
  shared.mode.hangOnLimit = false;
  shared.captured.redisConfig = undefined;
  shared.captured.limiterConfig = undefined;
  shared.mode.limiterTimeoutSentinel = false;
  shared.mode.throwOnTtl = false;
  // Every flag resets. A leaked `throwOnLimit` silently disables the failure
  // counter for every later test, which makes "the breaker did not trip"
  // assertions pass for entirely the wrong reason.
  shared.mode.throwOnLimit = false;
  shared.resetUsedTokensCalls.length = 0;
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
    await expect(mod.isBreakerOpen()).resolves.toEqual({ open: false });
  });

  it("reports open with the lock's remaining TTL as retryAfterS", async () => {
    seedBreakerOpen(shared.store, 17);
    const mod = await import("./resilient-fetch");
    await expect(mod.isBreakerOpen()).resolves.toEqual({
      open: true,
      retryAfterS: 17,
    });
  });

  it("falls back to DEFAULT_RETRY_AFTER_S when the lock carries no TTL", async () => {
    shared.store.set(FAKE_BREAKER_KEY, {
      value: "open",
      expiresAt: Number.POSITIVE_INFINITY,
    } satisfies FakeUpstashEntry);
    const mod = await import("./resilient-fetch");
    await expect(mod.isBreakerOpen()).resolves.toEqual({
      open: true,
      retryAfterS: mod.DEFAULT_RETRY_AFTER_S,
    });
  });

  /**
   * Phase 140 review / G9 — `isBreakerOpen` PROMISES that every exit path
   * resolves and nothing throws (the SEAM-03 contract). Two enumerated paths
   * had no test at all, so the promise rested on inspection.
   */
  it("G9: a MALFORMED stored value resolves closed, not open", async () => {
    // Anything that is not the literal "open" means "no lock". A truthiness
    // test here would read a stray value — a half-written key, a leftover from
    // an older encoding — as an outage and deny the seam to everyone.
    shared.store.set(FAKE_BREAKER_KEY, {
      value: "OPEN",
      expiresAt: Date.now() + 30_000,
    });
    const mod = await import("./resilient-fetch");
    await expect(mod.isBreakerOpen()).resolves.toEqual({ open: false });
  });

  it("G9: a THROWING ttl resolves closed instead of propagating", async () => {
    // `ttl` is only reached once the lock reads "open", so it is the one store
    // call that runs while the breaker believes production is degraded — the
    // worst possible moment to throw out of a function the engine does not
    // guard.
    vi.spyOn(console, "error").mockImplementation(() => {});
    seedBreakerOpen(shared.store, 30);
    const mod = await import("./resilient-fetch");
    // Patch after import so the module's captured client is the one we break.
    shared.mode.throwOnTtl = true;

    await expect(mod.isBreakerOpen()).resolves.toEqual({ open: false });
  });

  it("fails OPEN when Redis errors", async () => {
    // SC-3a. A store outage must never become the outage: every exit path out
    // of the check resolves, none throws, and the seam call still goes out.
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    shared.mode.throwOnGet = true;
    const fetchMock = okFetch();
    const mod = await import("./resilient-fetch");

    await expect(mod.isBreakerOpen()).resolves.toEqual({ open: false });
    expect(errorSpy).toHaveBeenCalled();

    // Even with the breaker ALREADY tripped in the store, an unreadable store
    // must not deny traffic — the real request is still attempted.
    seedBreakerOpen(shared.store);
    await expect(
      mod.resilientFetch("bridge", "/api/portfolio-bridge", { method: "POST" }),
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

    await expect(mod.isBreakerOpen()).resolves.toEqual({ open: false });
    // Exactly one unconfigured notice, at module load — not per request.
    expect(warnSpy).toHaveBeenCalledTimes(1);

    // Production is asserted above; the seam call still reaches Railway.
    await expect(
      mod.resilientFetch("bridge", "/api/portfolio-bridge", { method: "POST" }),
    ).resolves.toBeDefined();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

/**
 * CR-02 — the breaker's own store must be a HINT, never a dependency.
 *
 * `isBreakerOpen()` runs BEFORE the seam's `AbortSignal.timeout` is
 * constructed, and the `@upstash/redis` defaults are 5 retries with
 * exponential backoff and NO signal at all. A regional Upstash incident that
 * STALLS rather than rejects would therefore hold every seam route until
 * `maxDuration = 300` — a feature added to stop Railway holding lambda slots
 * would have handed that power to a second, unrelated service. The pre-existing
 * fail-OPEN tests do nothing here: they all cover REJECTIONS, and a hang is not
 * a rejection.
 *
 * Teeth: with the deadline removed these tests do not fail on an assertion,
 * they never return — the suite times out. That is the production symptom
 * reproduced exactly.
 */
describe("breaker store is bounded (CR-02)", () => {
  it("constructs the client with retries disabled and a per-request abort factory", async () => {
    await import("./resilient-fetch");
    const mod = await import("./resilient-fetch");
    const config = shared.captured.redisConfig as
      | { retry?: { retries?: number }; signal?: () => AbortSignal }
      | undefined;

    expect(
      config,
      "Redis.fromEnv() was called with NO config — the SDK defaults (5 retries, " +
        "~4.3s of backoff sleeps, no signal) are back in front of every seam call.",
    ).toBeDefined();
    expect(config!.retry?.retries).toBeLessThanOrEqual(1);
    // A FACTORY, not a shared signal: the SDK calls it per request, so a single
    // module-lifetime signal would abort every command after the first 250ms.
    expect(typeof config!.signal).toBe("function");

    const signal = config!.signal!();
    expect(signal).toBeInstanceOf(AbortSignal);
    expect(signal.aborted).toBe(false);
    // And it is genuinely wired to the store budget rather than being some
    // arbitrary never-firing signal.
    await new Promise((r) => setTimeout(r, mod.BREAKER_STORE_TIMEOUT_MS + 100));
    expect(signal.aborted).toBe(true);
  });

  it("a HANGING breaker read does not delay the seam call", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    shared.mode.hangOnGet = true;
    const fetchMock = okFetch();
    const mod = await import("./resilient-fetch");

    const started = Date.now();
    await expect(
      mod.resilientFetch("bridge", "/api/portfolio-bridge", { method: "POST" }),
    ).resolves.toBeDefined();
    const elapsed = Date.now() - started;

    // Fail OPEN: the real request still went out.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    // Bounded, with slack for CI scheduling — the point is 250ms-ish, not 300s.
    expect(elapsed).toBeLessThan(mod.BREAKER_STORE_TIMEOUT_MS * 8);
    // Never silent: the request proceeded UNPROTECTED and that is an
    // operational fact.
    expect(errorSpy).toHaveBeenCalled();
  });

  it("a HANGING breaker read still resolves isBreakerOpen to closed", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    // Even with the breaker genuinely tripped in the store: an unreadable store
    // must never DENY traffic, or the breaker has become the outage.
    seedBreakerOpen(shared.store);
    shared.mode.hangOnGet = true;
    const mod = await import("./resilient-fetch");

    await expect(mod.isBreakerOpen()).resolves.toEqual({ open: false });
  });

  it("a HANGING failure WRITE does not extend an already-failing request", async () => {
    // recordSeamFailure runs inside the caller's catch arm — exactly when
    // Railway is already sick, which is when a shared regional Upstash is most
    // likely to be struggling too (correlated failure).
    vi.spyOn(console, "error").mockImplementation(() => {});
    shared.mode.hangOnLimit = true;
    const mod = await import("./resilient-fetch");

    const started = Date.now();
    await expect(mod.recordSeamFailure()).resolves.toBeUndefined();
    expect(Date.now() - started).toBeLessThan(
      mod.BREAKER_STORE_TIMEOUT_MS * 8,
    );
  });
});

describe("recordSeamFailure", () => {
  it("trips the breaker once the failure allowance is exhausted", async () => {
    const mod = await import("./resilient-fetch");

    for (let i = 0; i < mod.BREAKER_FAILURE_THRESHOLD - 1; i++) {
      await mod.recordSeamFailure();
    }
    expect(shared.store.get(mod.BREAKER_KEY)).toBeUndefined();

    await mod.recordSeamFailure();
    expect(shared.store.get(mod.BREAKER_KEY)?.value).toBe("open");
  });

  /**
   * Phase 140 review / D-3 — the trip must be observable.
   *
   * Every individual failure logged, but the moment they added up to "the seam
   * is now refused for everyone" logged NOTHING. In the logs, the breaker doing
   * its job was indistinguishable from the incident spontaneously resolving:
   * a burst of transport errors, then silence.
   */
  it("D-3: logs a distinct BREAKER OPEN line at the trip, with the count", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const mod = await import("./resilient-fetch");

    for (let i = 0; i < mod.BREAKER_FAILURE_THRESHOLD; i++) {
      await mod.recordSeamFailure("bridge");
    }
    expect(shared.store.get(mod.BREAKER_KEY)?.value).toBe("open");

    const tripLines = errorSpy.mock.calls
      .map((c) => String(c[0]))
      .filter((m) => m.includes("BREAKER OPEN"));

    // Exactly ONE line — gated on the `nx` write result, so instances that lose
    // the race stay quiet instead of spamming a duplicate per failure.
    expect(tripLines).toHaveLength(1);
    expect(tripLines[0]).toContain(mod.BREAKER_KEY);
    // The failure count and the cooldown are what make the line actionable.
    expect(tripLines[0]).toContain(String(mod.BREAKER_FAILURE_THRESHOLD));
    expect(tripLines[0]).toContain(String(mod.BREAKER_COOLDOWN_S));
    // And which call site was the last straw.
    expect(tripLines[0]).toContain("bridge");
  });

  it("D-3: stays silent on failures that do NOT trip", async () => {
    // A line per failure would drown the one that matters.
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const mod = await import("./resilient-fetch");

    for (let i = 0; i < mod.BREAKER_FAILURE_THRESHOLD - 1; i++) {
      await mod.recordSeamFailure("bridge");
    }

    expect(shared.store.get(mod.BREAKER_KEY)).toBeUndefined();
    expect(
      errorSpy.mock.calls.filter((c) => String(c[0]).includes("BREAKER OPEN")),
    ).toHaveLength(0);
  });

  it("D-3: the engine threads its budgetKey into the trip line", async () => {
    // The core knows which seam it was; recordSeamFailure only knows if the
    // engine passes it. A dropped argument makes the line say "some call site".
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    edgeFetch(502);
    const mod = await import("./resilient-fetch");

    for (let i = 0; i < mod.BREAKER_FAILURE_THRESHOLD; i++) {
      await mod.resilientFetch("simulator", "/api/simulator", { method: "POST" });
    }

    const tripLines = errorSpy.mock.calls
      .map((c) => String(c[0]))
      .filter((m) => m.includes("BREAKER OPEN"));
    expect(tripLines).toHaveLength(1);
    expect(tripLines[0]).toContain("simulator");
  });

  it("does not extend the cooldown when a second instance trips concurrently", async () => {
    // `nx: true` makes the trip idempotent — the first writer's TTL stands, so
    // a second instance tripping moments later cannot ratchet the outage
    // window open indefinitely.
    const mod = await import("./resilient-fetch");
    for (let i = 0; i < mod.BREAKER_FAILURE_THRESHOLD; i++) {
      await mod.recordSeamFailure();
    }
    const firstExpiry = shared.store.get(mod.BREAKER_KEY)?.expiresAt;
    expect(firstExpiry).toBeDefined();

    await mod.recordSeamFailure();
    await mod.recordSeamFailure();

    expect(shared.store.get(mod.BREAKER_KEY)?.expiresAt).toBe(firstExpiry);
  });

  /**
   * Phase 140 review / F-5 — the limiter's FAIL-OPEN must not become the
   * breaker's FAIL-CLOSED.
   *
   * `@upstash/ratelimit` v2.0.8 answers its own internal timeout by RESOLVING
   * `{success:true, limit:0, remaining:0, reason:"timeout"}` (dist/index.mjs
   * `applyTimeout`, default 5000ms) — meaning "I could not reach the store, let
   * the caller through". Read under `!(success && remaining > 0)` that value is
   * indistinguishable from real exhaustion, so a degraded Upstash would TRIP
   * the breaker and deny the whole seam to every tenant: exactly the inversion
   * locked decision 4 forbids.
   */
  it("F-5: the limiter's timeout sentinel does NOT trip the breaker", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    shared.mode.limiterTimeoutSentinel = true;
    const mod = await import("./resilient-fetch");

    // Well past the threshold: if the sentinel counted, this would be open many
    // times over.
    for (let i = 0; i < mod.BREAKER_FAILURE_THRESHOLD * 3; i++) {
      await mod.recordSeamFailure("bridge");
    }

    expect(shared.store.get(mod.BREAKER_KEY)).toBeUndefined();
    // Loud, not silent: a breaker running without a counter is an operational
    // fact, and it is why the seam is currently unprotected.
    expect(
      errorSpy.mock.calls.some((c) =>
        String(c[0]).includes("limiter fail-open"),
      ),
    ).toBe(true);
  });

  it("F-5: POSITIVE CONTROL — the same drive without the sentinel DOES trip", async () => {
    // Without this, the test above cannot be distinguished from "recordSeamFailure
    // stopped tripping at all".
    vi.spyOn(console, "error").mockImplementation(() => {});
    const mod = await import("./resilient-fetch");

    for (let i = 0; i < mod.BREAKER_FAILURE_THRESHOLD; i++) {
      await mod.recordSeamFailure("bridge");
    }

    expect(shared.store.get(mod.BREAKER_KEY)?.value).toBe("open");
  });

  it("F-5: constructs the limiter with its redundant internal timeout disabled", async () => {
    // `withStoreDeadline` owns this deadline at 250ms — an order of magnitude
    // tighter than the library's 5000ms default. Leaving both in place keeps a
    // second, hostile failure mode alive for no benefit.
    await import("./resilient-fetch");
    expect(shared.captured.limiterConfig).toMatchObject({ timeout: 0 });
  });

  it("is a no-op when Upstash is unconfigured", async () => {
    delete process.env.UPSTASH_REDIS_REST_URL;
    delete process.env.UPSTASH_REDIS_REST_TOKEN;
    vi.resetModules();
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const mod = await import("./resilient-fetch");

    await expect(mod.recordSeamFailure()).resolves.toBeUndefined();
    expect(shared.store.size).toBe(0);
  });

  it("swallows store errors instead of surfacing them to the caller", async () => {
    // A failure to RECORD a failure must not become a second failure the
    // caller has to handle — recordSeamFailure is called from inside the
    // engine's catch arms, where a throw would replace the real upstream error.
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    shared.mode.throwOnLimit = true;
    const mod = await import("./resilient-fetch");

    await expect(mod.recordSeamFailure()).resolves.toBeUndefined();
    expect(errorSpy).toHaveBeenCalled();
    expect(shared.store.get(mod.BREAKER_KEY)).toBeUndefined();
  });

  /**
   * C5 — ONE BURST, ONE DENIAL WINDOW.
   *
   * The counter and the open-lock are independent keys and nothing used to
   * clear the counter when the lock was written. Against the real
   * `slidingWindow` Lua: five failures at t≈0 trip (lock 30s); at t≈31s the
   * window has rolled and the previous one is counted pro-rata —
   * `ceil(5 × (1 − 1/30)) = 5` — so the FIRST failure after the cooldown
   * already read as exhausted and re-tripped instantly. Documented recovery
   * latency 30s, delivered ~60s.
   *
   * The fake limiter is a FIXED window (see the helper's own warning), so it
   * cannot reproduce the weighted carry-over directly. What it CAN pin — and
   * what the fix actually is — is the invariant that removes the carry-over
   * entirely: after a trip the counter key is GONE, so the next window starts
   * from zero whatever its alignment.
   */
  it("C5: the trip CLEARS the failure counter, so one burst = one denial window", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const mod = await import("./resilient-fetch");

    for (let i = 0; i < mod.BREAKER_FAILURE_THRESHOLD; i++) {
      await mod.recordSeamFailure("bridge");
    }
    expect(shared.store.get(mod.BREAKER_KEY)?.value).toBe("open");

    // The library's own public reset was invoked for the breaker's identifier —
    // not a re-derivation of its internal key layout.
    expect(shared.resetUsedTokensCalls).toEqual([`${mod.BREAKER_KEY}:failures`]);

    // The ONLY surviving key is the open-lock. Every failure-counter bucket is
    // gone, which is what makes the next window start from zero.
    expect([...shared.store.keys()]).toEqual([mod.BREAKER_KEY]);
  });

  it("C5: after the cooldown expires, ONE failure does not re-trip", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const mod = await import("./resilient-fetch");

    for (let i = 0; i < mod.BREAKER_FAILURE_THRESHOLD; i++) {
      await mod.recordSeamFailure("bridge");
    }
    expect(shared.store.get(mod.BREAKER_KEY)?.value).toBe("open");

    // Simulate the lock's TTL elapsing without touching any other key — exactly
    // what Redis does at t = BREAKER_COOLDOWN_S. The counter's fate is the
    // whole question.
    shared.store.delete(mod.BREAKER_KEY);

    await mod.recordSeamFailure("bridge");
    // Pre-C5 the carried-over count made this single failure re-trip
    // immediately, doubling the outage the user experiences from one burst.
    expect(shared.store.get(mod.BREAKER_KEY)).toBeUndefined();

    // And the breaker still works: it re-trips on a genuine fresh burst.
    for (let i = 0; i < mod.BREAKER_FAILURE_THRESHOLD - 1; i++) {
      await mod.recordSeamFailure("bridge");
    }
    expect(shared.store.get(mod.BREAKER_KEY)?.value).toBe("open");
  });
});

describe("resilientFetch breaker short-circuit", () => {
  /** Drive `n` EDGE-shaped 5xx responses through the engine to load the counter. */
  async function driveFailures(
    mod: typeof import("./resilient-fetch"),
    n: number,
  ): Promise<void> {
    for (let i = 0; i < n; i++) {
      await mod.resilientFetch("bridge", "/api/portfolio-bridge", {
        method: "POST",
      });
    }
  }

  it("cross-context: a second module context short-circuits without touching Railway", async () => {
    // SC-2. vi.resetModules() re-executes the module body, which is exactly
    // what recreates any module-scope `let breakerState`. An in-memory breaker
    // therefore CANNOT pass this test; only state in the shared store can.
    const fetchA = edgeFetch(503);
    const a = await import("./resilient-fetch");
    await driveFailures(a, a.BREAKER_FAILURE_THRESHOLD);
    expect(shared.store.get(a.BREAKER_KEY)?.value).toBe("open");

    // A different Fluid Compute instance: fresh module registry, same Upstash.
    vi.resetModules();
    vi.unstubAllGlobals();
    const fetchB = okFetch();
    const b = await import("./resilient-fetch");

    await expect(
      b.resilientFetch("bridge", "/api/portfolio-bridge", { method: "POST" }),
    // Same-registry class object — see the CLASS IDENTITY note in the header.
    ).rejects.toBeInstanceOf(b.CircuitOpenError);
    // THE assertion that proves "without touching Railway".
    expect(fetchB).not.toHaveBeenCalled();
    expect(fetchA).toHaveBeenCalledTimes(a.BREAKER_FAILURE_THRESHOLD);
  });

  it("cross-context: the CircuitOpenError carries the lock TTL as retryAfterS", async () => {
    seedBreakerOpen(shared.store, 12);
    const fetchMock = okFetch();
    const mod = await import("./resilient-fetch");

    await expect(
      mod.resilientFetch("bridge", "/api/portfolio-bridge", { method: "POST" }),
    ).rejects.toMatchObject({
      name: "CircuitOpenError",
      retryAfterS: 12,
      // Static message — no URL, no header, no upstream detail (T-140-05).
      message: "Analytics service circuit is open",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  /**
   * Phase 140 review / G3 — RECOVERY. Locked decision 3 says "TTL expiry IS the
   * half-open transition", which makes expiry the entire recovery mechanism of
   * the system — and it had no test. Both directions matter: traffic must
   * resume when the lock expires, and a still-broken upstream must be able to
   * re-trip rather than being wedged open or wedged closed.
   */
  it("G3 recovery: an EXPIRED lock passes through to Railway again", async () => {
    // Seeded already-expired: the store evicts on read, exactly as Redis does.
    shared.store.set(FAKE_BREAKER_KEY, {
      value: "open",
      expiresAt: Date.now() - 1,
    });
    const fetchMock = okFetch();
    const mod = await import("./resilient-fetch");

    await expect(
      mod.resilientFetch("bridge", "/api/portfolio-bridge", { method: "POST" }),
    ).resolves.toBeDefined();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("G3 recovery: a failure AFTER expiry re-trips the breaker", async () => {
    // The other half. If the counter did not survive to re-trip — or if the
    // expired lock could not be rewritten — a still-dead Railway would be
    // hammered at full rate for as long as the incident lasted.
    vi.spyOn(console, "error").mockImplementation(() => {});
    shared.store.set(FAKE_BREAKER_KEY, {
      value: "open",
      expiresAt: Date.now() - 1,
    });
    edgeFetch(502);
    const mod = await import("./resilient-fetch");

    for (let i = 0; i < mod.BREAKER_FAILURE_THRESHOLD; i++) {
      await mod.resilientFetch("bridge", "/api/portfolio-bridge", {
        method: "POST",
      });
    }

    const lock = shared.store.get(mod.BREAKER_KEY);
    expect(lock?.value).toBe("open");
    // A FRESH lock, not the stale one that just expired.
    expect(lock!.expiresAt).toBeGreaterThan(Date.now());
  });

  /**
   * Phase 140 review / G5 — ONE BREAKER KEY, ACROSS CALL SITES.
   *
   * Locked decision 2 is that both clients hit the same physical Railway
   * deployment, so a single `breaker:railway` key is shared by every budget —
   * two breakers could disagree about whether the service is up. Every existing
   * short-circuit test drove `bridge` on BOTH sides, which passes just as well
   * if the key were secretly per-budget. That is the shape of a false green:
   * the property under test (sharing) is the one the test cannot observe.
   *
   * Driven as a table across genuinely different call sites — different
   * clients, different budgets, different Vercel routes — so a
   * `${BREAKER_KEY}:${budgetKey}` regression (which is exactly the T-140-01
   * sharding hazard the key's docblock warns about) reddens here.
   */
  it.each([
    { tripWith: "bridge", assertOn: "process-key-sync", path: "/process-key" },
    { tripWith: "process-key-sync", assertOn: "bridge", path: "/api/portfolio-bridge" },
    { tripWith: "keys-permissions", assertOn: "validate-key", path: "/api/validate-key" },
    { tripWith: "match-eval", assertOn: "simulator", path: "/api/simulator" },
  ] as const)(
    "G5: a trip driven by '$tripWith' short-circuits '$assertOn'",
    async ({ tripWith, assertOn, path }) => {
      vi.spyOn(console, "error").mockImplementation(() => {});
      const fetchA = edgeFetch(502);
      const mod = await import("./resilient-fetch");

      for (let i = 0; i < mod.BREAKER_FAILURE_THRESHOLD; i++) {
        await mod.resilientFetch(tripWith, "/whatever", { method: "POST" });
      }
      expect(shared.store.get(mod.BREAKER_KEY)?.value).toBe("open");
      expect(fetchA).toHaveBeenCalledTimes(mod.BREAKER_FAILURE_THRESHOLD);

      // A DIFFERENT call site must now be refused without touching Railway.
      vi.unstubAllGlobals();
      const fetchB = okFetch();
      await expect(
        mod.resilientFetch(assertOn, path, { method: "POST" }),
      ).rejects.toBeInstanceOf(mod.CircuitOpenError);
      expect(fetchB).not.toHaveBeenCalled();
    },
  );

  it("negative control: with a per-context store the second context does NOT short-circuit", async () => {
    // SC-2-neg. Without this, the passing cross-context test cannot be
    // distinguished from "the test never really created a second context".
    // Flipping the store to per-factory is the ONLY change; if the assertions
    // below hold, the green above genuinely depends on shared state.
    shared.mode.sharedStore = false;
    vi.resetModules();

    const fetchA = edgeFetch(503);
    const a = await import("./resilient-fetch");
    await driveFailures(a, a.BREAKER_FAILURE_THRESHOLD);
    expect(fetchA).toHaveBeenCalledTimes(a.BREAKER_FAILURE_THRESHOLD);

    vi.resetModules();
    vi.unstubAllGlobals();
    const fetchB = okFetch();
    const b = await import("./resilient-fetch");

    await expect(
      b.resilientFetch("bridge", "/api/portfolio-bridge", { method: "POST" }),
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
      const call = mod.resilientFetch("bridge", "/api/portfolio-bridge", {
        method: "POST",
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
      method: "POST",
    });
    expect(fetchMock.mock.calls.length).toBe(before + 1);
  });

  it("trips on deadline (TimeoutError) rejections", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const fetchMock = installFetchMock();
    // The established in-repo simulation (analytics-client.test.ts:385) —
    // never vi.useFakeTimers().
    fetchMock.mockRejectedValue(new DOMException("aborted", "TimeoutError"));
    const mod = await import("./resilient-fetch");
    await drive(mod, mod.BREAKER_FAILURE_THRESHOLD, true);
    expect(shared.store.get(mod.BREAKER_KEY)?.value).toBe("open");
  });

  it("trips on network TypeError throws", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const fetchMock = installFetchMock();
    // undici's ONE network-failure shape, verified on Node 22 and Node 25 for
    // ECONNREFUSED, DNS ENOTFOUND and TLS expiry alike.
    fetchMock.mockRejectedValue(new TypeError("fetch failed"));
    const mod = await import("./resilient-fetch");
    await drive(mod, mod.BREAKER_FAILURE_THRESHOLD, true);
    expect(shared.store.get(mod.BREAKER_KEY)?.value).toBe("open");
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
      mod.resilientFetch("bridge", "/api/portfolio-bridge", { method: "POST" }),
    ).rejects.toBe(original);
  });
});

/**
 * Phase 140 review / F-1, F-2, D-9, D-10 — "5xx means Railway is degraded" is
 * FALSE for this service, and the breaker was built on it.
 *
 * Each test below pins one arm of the replacement rule against the response the
 * PYTHON SOURCE actually emits at the cited line. The arms are the reason the
 * predicate is body-shaped rather than status-shaped; a regression in any one
 * of them is a cross-tenant outage driven by a single unhealthy sub-dependency
 * or a single corrupt key row.
 */
describe("breaker records only INFRASTRUCTURE failures (F-1/F-2/D-9/D-10)", () => {
  /** Install a fetch mock with an explicit body + content-type at `status`. */
  function bodyFetch(
    status: number,
    body: string,
    contentType: string | null,
  ): FetchMock {
    const mock = installFetchMock();
    mock.mockImplementation(
      async () =>
        new Response(body, {
          status,
          ...(contentType ? { headers: { "content-type": contentType } } : {}),
        }),
    );
    return mock;
  }

  /** Drive `n` responses; assert the breaker's final state. */
  async function driveN(
    mod: typeof import("./resilient-fetch"),
    n: number,
  ): Promise<void> {
    for (let i = 0; i < n; i++) {
      await mod.resilientFetch("keys-permissions", "/internal/keys/x/permissions", {
        method: "GET",
      });
    }
  }

  it("MT5-gateway 503 does NOT trip (exchange.py:215/220/235/238)", async () => {
    // The MT5 gateway is a SEPARATE Railway service that restarts on every
    // deploy. `_validate_mt5_key` answers 503 + NETWORK_ERROR_DETAIL while it
    // is down — from a perfectly healthy analytics service. Counting these
    // denied key-connect, sync, the optimizer and admin match to every tenant
    // for the cooldown, on every unrelated gateway rollout.
    bodyFetch(
      503,
      JSON.stringify({
        detail: "Could not reach the exchange. Please try again in a moment.",
      }),
      "application/json",
    );
    const mod = await import("./resilient-fetch");
    // Twice the threshold: an off-by-one cannot mask a regression.
    await driveN(mod, mod.BREAKER_FAILURE_THRESHOLD * 2);

    expect(shared.store.get(mod.BREAKER_KEY)).toBeUndefined();
    // Not merely "the lock is unset" — the COUNTER must be untouched too, or a
    // later genuine failure trips one increment early.
    expect([...shared.store.keys()]).toEqual([]);
  });

  it("per-key decrypt 500 does NOT trip (internal.py:214)", async () => {
    // ONE corrupt key row answers 500 deterministically, forever. The badge
    // fetches on mount and the route does not cache failures, so five key
    // cards on one page were five increments.
    bodyFetch(
      500,
      JSON.stringify({ detail: "Failed to decrypt credentials" }),
      "application/json",
    );
    const mod = await import("./resilient-fetch");
    await driveN(mod, mod.BREAKER_FAILURE_THRESHOLD * 2);

    expect(shared.store.get(mod.BREAKER_KEY)).toBeUndefined();
    expect([...shared.store.keys()]).toEqual([]);
  });

  it("application-level 502 does NOT trip (internal.py:326/339)", async () => {
    // "Exchange permission probe failed" is the USER'S exchange being down.
    // This is why the rule is not "502 always records": that would have
    // reproduced F-2 one status code over.
    bodyFetch(
      502,
      JSON.stringify({ detail: "Exchange permission probe failed" }),
      "application/json",
    );
    const mod = await import("./resilient-fetch");
    await driveN(mod, mod.BREAKER_FAILURE_THRESHOLD * 2);

    expect(shared.store.get(mod.BREAKER_KEY)).toBeUndefined();
  });

  it("EDGE 502 (HTML body) DOES trip", async () => {
    // The counterpart to the test above, and the reason the discriminator is
    // the BODY: same status, opposite verdict, because the container never
    // handled this one.
    edgeFetch(502);
    const mod = await import("./resilient-fetch");
    await driveN(mod, mod.BREAKER_FAILURE_THRESHOLD);

    expect(shared.store.get(mod.BREAKER_KEY)?.value).toBe("open");
  });

  it("504 DOES trip even with a JSON body (the service never emits 504)", async () => {
    // Verified by exhaustive grep of analytics-service: zero `status_code=504`.
    // Its only possible origin is the platform reporting no answer.
    bodyFetch(504, JSON.stringify({ detail: "upstream timeout" }), "application/json");
    const mod = await import("./resilient-fetch");
    await driveN(mod, mod.BREAKER_FAILURE_THRESHOLD);

    expect(shared.store.get(mod.BREAKER_KEY)?.value).toBe("open");
  });

  it("5xx with an UNPARSEABLE body behind a JSON content-type DOES trip", async () => {
    // A proxy that truncates the response mid-flight. The content-type lies;
    // the body is the evidence.
    bodyFetch(500, '{"detail": "trunca', "application/json");
    const mod = await import("./resilient-fetch");
    await driveN(mod, mod.BREAKER_FAILURE_THRESHOLD);

    expect(shared.store.get(mod.BREAKER_KEY)?.value).toBe("open");
  });

  /**
   * C1 — the `text/plain` population. There were ZERO of these tests before
   * this block (`grep -n "text/plain" src/lib/resilient-fetch.test.ts` → no
   * hits), which is exactly why the shape slipped through: the trip predicate
   * gated on `application/json` and every fixture obliged.
   *
   * A *raised* HTTPException is JSON. An UNHANDLED Python exception never
   * reaches ExceptionMiddleware — Starlette's ServerErrorMiddleware answers
   * `PlainTextResponse("Internal Server Error", 500)` with
   * `text/plain; charset=utf-8` (starlette 0.52.1). That is a container that
   * ANSWERED, so it must not deny the seam to every tenant.
   */
  const STARLETTE_500_BODY = "Internal Server Error";
  const STARLETTE_500_CONTENT_TYPE = "text/plain; charset=utf-8";

  it("C1: Starlette's UNHANDLED-exception text/plain 500 does NOT trip", async () => {
    // The live reproduction: internal.py:183 runs its api_keys SELECT OUTSIDE
    // any try, so a Supabase blip while a page renders five KeyPermissionBadges
    // (fetch-on-mount, failures uncached) is five of these inside 30s. Under
    // the JSON-only gate that was a cross-tenant outage from one dependency
    // wobble — F-1/F-2 reopened one content-type over.
    bodyFetch(500, STARLETTE_500_BODY, STARLETTE_500_CONTENT_TYPE);
    const mod = await import("./resilient-fetch");
    await driveN(mod, mod.BREAKER_FAILURE_THRESHOLD * 2);

    expect(shared.store.get(mod.BREAKER_KEY)).toBeUndefined();
    // Not merely "the lock is unset" — the COUNTER must be untouched too, or a
    // later genuine failure trips one increment early.
    expect([...shared.store.keys()]).toEqual([]);
  });

  it("C1: a text/plain 500 with a DIFFERENT body DOES trip (the carve-out is byte-exact)", async () => {
    // A proxy's own plain-text diagnostic. Same status, same content-type,
    // opposite verdict — because the body is not the signature Starlette
    // writes, so nothing here is evidence that the container answered.
    bodyFetch(500, "upstream connect error or disconnect/reset before headers", STARLETTE_500_CONTENT_TYPE);
    const mod = await import("./resilient-fetch");
    await driveN(mod, mod.BREAKER_FAILURE_THRESHOLD);

    expect(shared.store.get(mod.BREAKER_KEY)?.value).toBe("open");
  });

  it("C1: an EMPTY text/plain 5xx DOES trip", async () => {
    // The edge answering with nothing at all is the loudest "the container did
    // not handle this" signal in the plain-text population.
    bodyFetch(502, "", STARLETTE_500_CONTENT_TYPE);
    const mod = await import("./resilient-fetch");
    await driveN(mod, mod.BREAKER_FAILURE_THRESHOLD);

    expect(shared.store.get(mod.BREAKER_KEY)?.value).toBe("open");
  });

  it("C1: Starlette's exact body at a status OTHER than 500 DOES trip", async () => {
    // Starlette emits that sentence at 500 and nowhere else, so a 503 carrying
    // it is a proxy imitating an app response. Pinning the status keeps the
    // carve-out from widening into "any plain-text 5xx saying the magic words".
    bodyFetch(503, STARLETTE_500_BODY, STARLETTE_500_CONTENT_TYPE);
    const mod = await import("./resilient-fetch");
    await driveN(mod, mod.BREAKER_FAILURE_THRESHOLD);

    expect(shared.store.get(mod.BREAKER_KEY)?.value).toBe("open");
  });

  it("C1: an HTML 500 still trips — text/html is not text/plain", async () => {
    // The carve-out must not leak into the HTML population, which is the
    // original infrastructure-fault evidence the whole predicate is built on.
    edgeFetch(500);
    const mod = await import("./resilient-fetch");
    await driveN(mod, mod.BREAKER_FAILURE_THRESHOLD);

    expect(shared.store.get(mod.BREAKER_KEY)?.value).toBe("open");
  });

  it("C1: the text/plain body is left INTACT for the caller after the peek", async () => {
    // Same clone discipline as the JSON path: reading the original would turn
    // every caller's `res.text()` into "body already consumed".
    bodyFetch(500, STARLETTE_500_BODY, STARLETTE_500_CONTENT_TYPE);
    const mod = await import("./resilient-fetch");

    const res = await mod.resilientFetch(
      "keys-permissions",
      "/internal/keys/x/permissions",
      { method: "GET" },
    );
    await expect(res.text()).resolves.toBe(STARLETTE_500_BODY);
  });

  it("D-10: a 200 carrying an HTML interstitial DOES trip", async () => {
    // A genuine outage the old predicate could not see at all: a "success" no
    // caller can parse. Scoped to text/html so a 204 can never be misread.
    edgeFetch(200);
    const mod = await import("./resilient-fetch");
    await driveN(mod, mod.BREAKER_FAILURE_THRESHOLD);

    expect(shared.store.get(mod.BREAKER_KEY)?.value).toBe("open");
  });

  it("C7: a 404 EDGE HTML page DOES trip — sub-500 records on text/html, 4xx included", async () => {
    // Pins what the code does against what its comment used to claim. The
    // comment said "4xx never records" while the line beneath it returned
    // `contentType.includes("text/html")` — which records a Railway
    // "Application not found" 404, i.e. a deployment that is gone or a domain
    // that is unrouted. That IS the proposition the breaker exists to detect,
    // so the behaviour is right and the comment was wrong.
    edgeFetch(404);
    const mod = await import("./resilient-fetch");
    await driveN(mod, mod.BREAKER_FAILURE_THRESHOLD);

    expect(shared.store.get(mod.BREAKER_KEY)?.value).toBe("open");
  });

  it("C7: the A4 carve-out's load-bearing half — an APPLICATION 4xx does NOT trip", async () => {
    // The other side of the same line, and the half that actually protects
    // tenants: a user's bad API key returning `400 {"detail": …}` is Railway
    // working CORRECTLY. This holds because a FastAPI 4xx is JSON, never HTML.
    bodyFetch(400, JSON.stringify({ detail: "Invalid API key" }), "application/json");
    const mod = await import("./resilient-fetch");
    await driveN(mod, mod.BREAKER_FAILURE_THRESHOLD * 2);

    expect(shared.store.get(mod.BREAKER_KEY)).toBeUndefined();
    expect([...shared.store.keys()]).toEqual([]);
  });

  it("a 204 No Content (no content-type) does NOT trip", async () => {
    // The guard on scoping the 2xx arm to text/html rather than "not JSON".
    const mock = installFetchMock();
    mock.mockImplementation(async () => new Response(null, { status: 204 }));
    const mod = await import("./resilient-fetch");
    await driveN(mod, mod.BREAKER_FAILURE_THRESHOLD * 2);

    expect(shared.store.get(mod.BREAKER_KEY)).toBeUndefined();
  });

  it("D-9: a caller-fault TypeError does NOT trip", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const fetchMock = installFetchMock();
    // A header we built wrong. Verified real undici message shape; it carries
    // NO information about Railway's health, and under the old classification
    // it drove the shared breaker on every single request.
    fetchMock.mockRejectedValue(
      new TypeError('Headers.append: "a\nb" is an invalid header value.'),
    );
    const mod = await import("./resilient-fetch");
    for (let i = 0; i < mod.BREAKER_FAILURE_THRESHOLD * 2; i++) {
      await expect(
        mod.resilientFetch("bridge", "/api/portfolio-bridge", { method: "POST" }),
      ).rejects.toBeInstanceOf(TypeError);
    }

    expect(shared.store.get(mod.BREAKER_KEY)).toBeUndefined();
    expect([...shared.store.keys()]).toEqual([]);
  });

  it("D-1: the transport log carries the error OBJECT, not just a sentence", async () => {
    // Four different incidents (ECONNREFUSED, TLS expiry, DNS EAI_AGAIN, a
    // header TypeError) produced four byte-identical log lines because `err`
    // was dropped. undici puts the diagnosis on `.cause`; a static sentence
    // discards it.
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const transport = new TypeError("fetch failed", {
      cause: Object.assign(new Error("getaddrinfo EAI_AGAIN"), {
        code: "EAI_AGAIN",
      }),
    });
    const fetchMock = installFetchMock();
    fetchMock.mockRejectedValue(transport);
    const mod = await import("./resilient-fetch");

    await expect(
      mod.resilientFetch("bridge", "/api/portfolio-bridge", { method: "POST" }),
    ).rejects.toBe(transport);

    // The DIAGNOSIS must survive — name, message and the syscall code undici
    // hides on `.cause` — even though the value logged is a redacted string
    // rather than the raw object (see the H-0328 test below).
    const logged = errorSpy.mock.calls.flat().map(String).join("\n");
    expect(logged).toContain("EAI_AGAIN");
    expect(logged).toContain("fetch failed");
  });

  /**
   * H-0328 regression, re-armed for D-1.
   *
   * Logging the raw error object is the OBVIOUS way to satisfy D-1 and it is
   * unsafe here: some undici / fetch / retry-wrapper errors embed the OUTGOING
   * REQUEST HEADERS in the message, and in the shape H-0328 was filed for, in
   * the error NAME too. On this seam those headers carry a live
   * INTERNAL_API_TOKEN and ANALYTICS_SERVICE_KEY. The core logs BEFORE any
   * route sees the error, so the route-level scrubber cannot cover it.
   */
  it("D-1/H-0328: never logs a live seam secret from the transport error", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    process.env.INTERNAL_API_TOKEN = "super-secret-internal-token";
    process.env.ANALYTICS_SERVICE_KEY = "super-secret-service-key";

    const leaky = new Error(
      "fetch failed sending X-Internal-Token: super-secret-internal-token, X-Service-Key: super-secret-service-key",
    );
    leaky.name = "LeakyWrapper(super-secret-internal-token)";
    const fetchMock = installFetchMock();
    fetchMock.mockRejectedValue(leaky);
    const mod = await import("./resilient-fetch");

    await expect(
      mod.resilientFetch("bridge", "/api/portfolio-bridge", { method: "POST" }),
    ).rejects.toBe(leaky);

    const logged = errorSpy.mock.calls.flat().map(String).join("\n");
    expect(logged).not.toContain("super-secret-internal-token");
    expect(logged).not.toContain("super-secret-service-key");
    // Redacted, not dropped: the line is still diagnostically useful.
    expect(logged).toContain("<redacted>");
  });

  /**
   * C4 — the SAME premise, applied to the secrets the scrub did not cover.
   *
   * `redactSeamSecrets` enumerated exactly two ENV values. But this seam also
   * carries per-REQUEST credentials that are strictly more sensitive than the
   * deployment token, because they are the user's own:
   *
   *   `X-User-Access-Token`  the end user's live Supabase JWT
   *                          (process-key-client.ts:188-190)
   *   `api_key`/`api_secret` raw exchange credentials in the BODY of
   *                          /api/validate-key and /api/encrypt-key
   *
   * Under this module's own stated premise — undici can embed the outgoing
   * request in the error, even in its NAME — a transport error on those calls
   * wrote a usable session token or exchange credential to Vercel logs.
   */
  it("C4: never logs the caller's per-request secrets (header + body)", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    // Deliberately NOT set: this test must pass on the per-request path alone,
    // so a stray env match cannot make it green for the wrong reason.
    delete process.env.INTERNAL_API_TOKEN;
    delete process.env.ANALYTICS_SERVICE_KEY;

    const userJwt = "eyJhbGciOiJIUzI1NiJ9.live-supabase-session-jwt.sig";
    const exchangeKey = "AK-live-exchange-api-key-0001";
    const exchangeSecret = "SK-live-exchange-api-secret-0001";
    const bearerToken = "internal-bearer-token-value";

    const leaky = new Error(
      `fetch failed sending Authorization: Bearer ${bearerToken}, ` +
        `X-Correlation-Id: corr-1234-abcd, ` +
        `X-User-Access-Token: ${userJwt} with body ` +
        `{"api_key":"${exchangeKey}","api_secret":"${exchangeSecret}"}`,
    );
    leaky.name = `LeakyWrapper(${userJwt})`;
    const fetchMock = installFetchMock();
    fetchMock.mockRejectedValue(leaky);
    const mod = await import("./resilient-fetch");

    await expect(
      mod.resilientFetch("validate-key", "/api/validate-key", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${bearerToken}`,
          "X-User-Access-Token": userJwt,
          // A NON-secret header must survive — the log has to stay useful.
          "X-Correlation-Id": "corr-1234-abcd",
        },
        body: JSON.stringify({
          exchange: "binance",
          credentials: { api_key: exchangeKey, api_secret: exchangeSecret },
        }),
      }),
    ).rejects.toBe(leaky);

    const logged = errorSpy.mock.calls.flat().map(String).join("\n");
    expect(logged).not.toContain(userJwt);
    expect(logged).not.toContain(exchangeKey);
    expect(logged).not.toContain(exchangeSecret);
    expect(logged).not.toContain(bearerToken);
    // Redacted, not dropped — and the non-secret correlation id survives, which
    // is what keeps this a redaction rather than a blanket suppression.
    expect(logged).toContain("<redacted>");
    expect(logged).toContain("corr-1234-abcd");
  });

  it("the response body is left INTACT for the caller after the peek", async () => {
    // The classifier clones. If it ever read the original instead, every
    // caller's `res.json()` would throw "body already consumed" — turning the
    // fix into a far worse outage than the bug.
    bodyFetch(500, JSON.stringify({ detail: "Failed to decrypt credentials" }), "application/json");
    const mod = await import("./resilient-fetch");

    const res = await mod.resilientFetch(
      "keys-permissions",
      "/internal/keys/x/permissions",
      { method: "GET" },
    );
    await expect(res.json()).resolves.toEqual({
      detail: "Failed to decrypt credentials",
    });
  });

  it("C6: a STALLED body peek logs that it RECORDS, never 'failing OPEN'", async () => {
    // A proxy that flushes headers and then stalls the body. The peek's timeout
    // arm returns `false` = no readable envelope = RECORD (see
    // BREAKER_BODY_PEEK_TIMEOUT_MS). The shared deadline helper used to
    // hardcode "failing OPEN", which is the two STORE callers' direction and
    // the exact OPPOSITE of this one: an operator reading that line during a
    // stalled-proxy incident concludes the breaker was bypassed at the very
    // moment it was being driven toward tripping.
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const mock = installFetchMock();
    mock.mockImplementation(
      async () =>
        new Response(
          // Never enqueues, never closes — `.text()` never settles.
          new ReadableStream({ start() {} }),
          { status: 500, headers: { "content-type": "application/json" } },
        ),
    );
    const mod = await import("./resilient-fetch");
    await driveN(mod, mod.BREAKER_FAILURE_THRESHOLD);

    // BEHAVIOUR: the stall drove the breaker OPEN (the peek fails toward
    // recording). This is what makes the log-direction claim checkable.
    expect(shared.store.get(mod.BREAKER_KEY)?.value).toBe("open");

    const peekLines = errorSpy.mock.calls
      .flat()
      .map(String)
      .filter((line) => line.includes("response envelope peek"));
    expect(peekLines.length).toBeGreaterThan(0);
    for (const line of peekLines) {
      expect(line).not.toContain("failing OPEN");
      expect(line).toContain("counted against the breaker");
    }
  });
});

/**
 * CR-04 — `recordFailures: false`, the anonymous-surface opt-out.
 *
 * ONE breaker key is shared by every tenant and every budget key, and the
 * public teaser (`verify-strategy` → `postProcessKey({flow_type:"teaser"})`)
 * reaches it with no auth gate whatsoever. Five input-triggered upstream 500s
 * inside the window would therefore deny the WHOLE seam — key connect, sync,
 * optimizer, admin match — to every tenant, from an anonymous caller, for the
 * cooldown, repeatably.
 *
 * The opt-out governs WRITES only: an opted-out call must still be BLOCKED by
 * an already-open breaker. Both halves are pinned below, because a fix that
 * skipped the read as well would silently hand the public route an exemption
 * from the very protection the breaker exists to provide.
 */
describe("resilientFetch — recordFailures opt-out (CR-04)", () => {
  async function drive5xx(
    mod: typeof import("./resilient-fetch"),
    n: number,
    init: Record<string, unknown>,
  ): Promise<void> {
    for (let i = 0; i < n; i++) {
      await mod.resilientFetch("process-key-sync", "/process-key", {
        method: "POST",
        ...init,
      });
    }
  }

  it("recordFailures:false — upstream 5xx does NOT increment the breaker counter", async () => {
    edgeFetch(500);
    const mod = await import("./resilient-fetch");

    // Twice the threshold, so an off-by-one in the counter cannot mask it.
    await drive5xx(mod, mod.BREAKER_FAILURE_THRESHOLD * 2, {
      recordFailures: false,
    });

    expect(shared.store.get(mod.BREAKER_KEY)).toBeUndefined();
    // And nothing was written to the counter either — not merely "the lock was
    // not set". A counter loaded to threshold-minus-one would let ONE later
    // authenticated failure trip the seam, which is the same DoS one request
    // further out.
    expect([...shared.store.keys()]).toEqual([]);
  });

  it("POSITIVE CONTROL: the identical drive WITH the default does trip", async () => {
    // Without this, the test above cannot be distinguished from "the 5xx arm
    // stopped recording for everyone".
    edgeFetch(500);
    const mod = await import("./resilient-fetch");

    await drive5xx(mod, mod.BREAKER_FAILURE_THRESHOLD, {});

    expect(shared.store.get(mod.BREAKER_KEY)?.value).toBe("open");
  });

  it("recordFailures:false — a network/deadline THROW does not increment it either", async () => {
    // The 5xx arm is not the only writer: the catch arm records too, and an
    // anonymous payload can drive a slow upstream to the deadline just as
    // easily as it can drive a 500.
    vi.spyOn(console, "error").mockImplementation(() => {});
    const fetchMock = installFetchMock();
    fetchMock.mockRejectedValue(new DOMException("aborted", "TimeoutError"));
    const mod = await import("./resilient-fetch");

    for (let i = 0; i < mod.BREAKER_FAILURE_THRESHOLD * 2; i++) {
      await expect(
        mod.resilientFetch("process-key-sync", "/process-key", {
          method: "POST",
          recordFailures: false,
        }),
      ).rejects.toBeDefined();
    }

    expect(shared.store.get(mod.BREAKER_KEY)).toBeUndefined();
    expect([...shared.store.keys()]).toEqual([]);
  });

  it("READ, NOT EXEMPT: an opted-out call is still blocked by an open breaker", async () => {
    // The opt-out must not become a bypass. Sparing a dying Railway is the
    // whole point, and the public teaser is the loudest single seam caller.
    seedBreakerOpen(shared.store, 21);
    const fetchMock = okFetch();
    const mod = await import("./resilient-fetch");

    await expect(
      mod.resilientFetch("process-key-sync", "/process-key", {
        method: "POST",
        recordFailures: false,
      }),
    ).rejects.toBeInstanceOf(mod.CircuitOpenError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("never leaks recordFailures into the RequestInit", async () => {
    const fetchMock = okFetch();
    const mod = await import("./resilient-fetch");

    await mod.resilientFetch("process-key-sync", "/process-key", {
      method: "POST",
      recordFailures: false,
    });

    const init = fetchMock.mock.calls[0][1] as Record<string, unknown>;
    expect(init).not.toHaveProperty("recordFailures");
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
      method: "POST",
    });
    expect(timeoutSpy).toHaveBeenCalledWith(mod.SEAM_BUDGETS.bridge.timeoutMs);
  });

  it("budget reaches AbortSignal.timeout for a different call site", async () => {
    const timeoutSpy = vi.spyOn(AbortSignal, "timeout");
    okFetch();
    const mod = await import("./resilient-fetch");

    await mod.resilientFetch("process-key-sync", "/process-key", {
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
      method: "POST",
    });
    expect(String(fetchMock.mock.calls[0][0])).toBe(
      "http://localhost:8002/api/portfolio-bridge",
    );
  });
});
