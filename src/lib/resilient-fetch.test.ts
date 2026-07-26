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
    /** true → the failure counter rejects, exercising the swallow-and-log arm. */
    throwOnLimit: false,
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
  return {
    store,
    mode,
    ctx,
    constructed,
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
      fromEnv: () => {
        const base = fakeRedisFor(shared.beginContext());
        return {
          ...base,
          get: async (key: string) => {
            if (shared.mode.throwOnGet) {
              throw new Error("upstash: connection reset");
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
        if (shared.mode.throwOnLimit) {
          return Promise.reject(new Error("upstash: limiter unavailable"));
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
  // Every flag resets. A leaked `throwOnLimit` silently disables the failure
  // counter for every later test, which makes "the breaker did not trip"
  // assertions pass for entirely the wrong reason.
  shared.mode.throwOnLimit = false;
  shared.constructed.length = 0;
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
