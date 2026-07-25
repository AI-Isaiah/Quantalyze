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
  };
  /** Config object the core passed to `Redis.fromEnv()`, captured per context. */
  const captured = { redisConfig: undefined as Record<string, unknown> | undefined };
  /** The store the CURRENT module context is bound to. */
  const ctx = { store };
  return {
    store,
    mode,
    ctx,
    captured,
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
      constructor(opts: { limiter: { tokens: number } }) {
        // Binds to whatever store beginContext() just selected.
        this.fake = fakeRatelimitFor(shared.ctx.store, opts.limiter.tokens);
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
  // Every flag resets. A leaked `throwOnLimit` silently disables the failure
  // counter for every later test, which makes "the breaker did not trip"
  // assertions pass for entirely the wrong reason.
  shared.mode.throwOnLimit = false;
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
});

describe("resilientFetch breaker short-circuit", () => {
  /** Drive `n` 5xx responses through the engine to load the failure counter. */
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
    const fetchA = okFetch(503);
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

  it("trips on HTTP 5xx", async () => {
    okFetch(503);
    const mod = await import("./resilient-fetch");
    await drive(mod, mod.BREAKER_FAILURE_THRESHOLD, false);
    expect(shared.store.get(mod.BREAKER_KEY)?.value).toBe("open");
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
    okFetch(500);
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
    okFetch(500);
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
