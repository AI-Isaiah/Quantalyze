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
  const counters = { limitCalls: 0 };
  return {
    store,
    mode,
    ctx,
    constructed,
    counters,
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
          mget: async (...keys: string[]) => {
            if (shared.mode.throwOnGet) {
              throw new Error("upstash: connection reset");
            }
            return base.mget(...keys);
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
  shared.counters.limitCalls = 0;
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

  it("falls back to DEFAULT_RETRY_AFTER_S when the lock carries no TTL", async () => {
    // 140.2-06 per-site decision: THE GLOBAL KEY, written DIRECTLY rather than
    // through the helper — deliberately, and kept that way. `seedBreakerOpen`
    // cannot express "no TTL at all": it takes a `ttlS` and always computes an
    // absolute expiry, whereas this case needs `Infinity`, which is the shape a
    // real key whose `EXPIRE` was lost would have. Routing it through the helper
    // would mean widening the helper to model a state no production path
    // produces on purpose, so the direct write stays and states its key with the
    // same literal the helper defaults to.
    shared.store.set(FAKE_BREAKER_KEY, {
      value: "open",
      expiresAt: Number.POSITIVE_INFINITY,
    } satisfies FakeUpstashEntry);
    const mod = await import("./resilient-fetch");
    await expect(mod.isBreakerOpen("bridge")).resolves.toEqual({
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

    await expect(mod.isBreakerOpen("bridge")).resolves.toEqual({ open: false });
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
      await mod.recordSeamFailure("breaker:railway");
    }
    expect(shared.store.get(mod.BREAKER_KEY)).toBeUndefined();

    await mod.recordSeamFailure("breaker:railway");
    expect(shared.store.get(mod.BREAKER_KEY)?.value).toBe("open");
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
    expect(shared.store.get("breaker:mt5-gateway")?.value).toBe("open");

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
    seedBreakerOpen(shared.store, "breaker:railway", 12);
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
        method: "POST",
      });
      await expect(res.json()).rejects.toBeInstanceOf(mod.SeamBodyReadError);
    }

    expect(shared.store.get(mod.BREAKER_KEY)?.value).toBe("open");
  });

  it("a non-deadline body failure is recorded too, with deadlineExceeded false", async () => {
    // A connection dropped mid-stream ("terminated") is degradation exactly
    // like a deadline; only the flag the clients branch on differs.
    vi.spyOn(console, "error").mockImplementation(() => {});
    bodyRejectingFetch(new TypeError("terminated"));
    const mod = await import("./resilient-fetch");

    const res = await mod.resilientFetch("bridge", "/api/portfolio-bridge", {
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
    });
    expect(shared.counters.limitCalls).toBe(1);

    vi.unstubAllGlobals();
    okFetch(400);
    await mod.resilientFetch("bridge", "/api/portfolio-bridge", {
      method: "POST",
    });
    expect(shared.counters.limitCalls).toBe(1);

    // Added by 140.2-06. Under the pre-phase `>= 500` branch this arm recorded,
    // which is the A-02 defect: a deterministic fault can only be cleared by an
    // operator, so counting it guarantees a self-sustaining outage.
    vi.unstubAllGlobals();
    okFetch(500);
    await mod.resilientFetch("bridge", "/api/portfolio-bridge", {
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
      method: "POST",
    });
    expect(shared.counters.limitCalls).toBe(0);

    // (b) TRAP-2 — Starlette's unhandled-exception reply. No JSON at all, and
    //     the verdict must still be terminal and non-counting.
    vi.unstubAllGlobals();
    textFetch(500, "Internal Server Error");
    const res = await mod.resilientFetch("bridge", "/api/portfolio-bridge", {
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
        method: "POST",
      });
    }

    expect(shared.counters.limitCalls).toBe(5);
    expect(shared.store.get("breaker:supabase")?.value).toBe("open");
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
      mod.resilientFetch("bridge", "/api/portfolio-bridge", { method: "POST" }),
    ).rejects.toBeInstanceOf(mod.CircuitOpenError);
    await expect(
      mod.resilientFetch("match-recompute", "/api/match/recompute", {
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
    ["undefined as a value", undefined],
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

  it("a valid timeoutMsOverride still reaches AbortSignal.timeout", async () => {
    // The negative control for the validation above: a guard that rejected
    // everything would pass all seven cases and break the escape hatch.
    const timeoutSpy = vi.spyOn(AbortSignal, "timeout");
    okFetch();
    const mod = await import("./resilient-fetch");

    await mod.resilientFetch("bridge", "/api/portfolio-bridge", {
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
      .resilientFetch("bridge", "/api/portfolio-bridge", { method: "POST" })
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
      mod.resilientFetch("bridge", "/api/portfolio-bridge", { method: "POST" }),
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
