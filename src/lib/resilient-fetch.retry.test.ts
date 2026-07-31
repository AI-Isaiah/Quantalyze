import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { installFetchMock, type FetchMock } from "@/test/helpers/fetch";
import { seedBreakerOpen } from "@/test/helpers/upstash-breaker";

/**
 * Phase 141 / SEAM-06 — the bounded retry loop inside `resilientFetch`.
 *
 * This file OWNS SC2's mechanics (retriesOverride drives eligibility, one retry,
 * fixed-backoff+jitter, per-attempt breaker latch) and SC4's breaker-open
 * guarantee (zero attempts when open at entry; a re-check before attempt 2 that
 * throws `CircuitOpenError` and is never swallowed). Plan 141-02.
 *
 * ⚠️ HARNESS COPIED VERBATIM from `resilient-fetch.test.ts` (the vi.hoisted
 * store, the four vi.mock factories, the beforeEach flag reset, the afterEach
 * unstub). The two mechanics differences that file documents apply here too:
 *  1. `vi.mock` factories do NOT re-run on `vi.resetModules()` (vitest 4.1.10),
 *     so per-context state hangs off `Redis.fromEnv()` via `beginContext()`.
 *  2. Global-fetch stubbing is this repo's Node-22 CI-only flake cause; it is
 *     confined to the `installFetchMock` helper and unstubbed in `afterEach`.
 *     This file installs the fetch double ONLY through that helper and never
 *     stubs the global directly (the acceptance grep for the stub call is 0).
 *
 * ORACLE INDEPENDENCE: the backoff bounds (250 floor, 500 ceiling) are LITERALS
 * typed here, never `SEAM_RETRY_BACKOFF_MS`/`SEAM_RETRY_JITTER_MAX_MS` imported
 * from the module under test. `Math.random` is spied to its extremes (0 → floor,
 * 1 → ceiling) so the interval is pinned at both ends by hand.
 */

const shared = vi.hoisted(() => {
  const store = new Map<string, { value: string; expiresAt: number }>();
  const mode = {
    sharedStore: true,
    throwOnGet: false,
    throwOnLimit: false,
    sentinelOnLimit: false,
    staleReadOnce: null as { value: string | null } | null,
    nullOnBreakerSet: false,
    throwOnAfter: false,
  };
  const ctx = { store };
  const constructed: Array<{ tokens: number; window: string }> = [];
  const counters = {
    /**
     * How many times the core ATTEMPTED to record a seam failure, counted at the
     * double's `limit()` entry. This is the direct oracle for the per-attempt
     * latch: two failing transient attempts must reach here TWICE, one attempt
     * whose status and body both fail must reach here ONCE.
     */
    limitCalls: 0,
    storeCommands: 0,
  };
  const redisConfigs: Array<Record<string, unknown> | undefined> = [];
  const captures: Array<{
    err: unknown;
    options: {
      tags?: Record<string, string>;
      extra?: Record<string, unknown>;
      level?: string;
    };
  }> = [];
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
    beginContext() {
      ctx.store = mode.sharedStore
        ? store
        : new Map<string, { value: string; expiresAt: number }>();
      return ctx.store;
    },
  };
});

// The REAL `postProcessKey` (client wiring tests below) transitively pulls in a
// `server-only`-guarded module; stub it so the client loads under vitest. The
// transport-level tests above do not reach it, so the stub is inert for them.
vi.mock("server-only", () => ({}));

vi.mock("next/server", async () => {
  const actual = await vi.importActual<typeof import("next/server")>(
    "next/server",
  );
  return {
    ...actual,
    after: (task: unknown) => {
      if (shared.mode.throwOnAfter) {
        throw new Error("`after()` was called outside a request scope");
      }
      shared.afterTasks.push(task);
      const produced =
        typeof task === "function" ? (task as () => unknown)() : task;
      shared.afterSettled.push(Promise.resolve(produced));
    },
  };
});

vi.mock("./sentry-capture", async () => {
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
        return {
          get: async (key: string) => {
            shared.counters.storeCommands += 1;
            if (shared.mode.throwOnGet) {
              throw new Error("upstash: connection reset");
            }
            if (shared.mode.staleReadOnce && key.startsWith("breaker:")) {
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
        const { tokens, window } = opts.limiter;
        shared.constructed.push({ tokens, window });
        this.fake = fakeRatelimitFor(shared.ctx.store);
      }
      limit(identifier: string) {
        shared.counters.limitCalls += 1;
        if (shared.mode.throwOnLimit) {
          return Promise.reject(new Error("upstash: limiter unavailable"));
        }
        if (shared.mode.sentinelOnLimit) {
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
const BRIDGE_PATH = "/api/portfolio-bridge";

/** A bare-stub fetch that answers a FIXED sequence of statuses (last repeats). */
function statusSequenceFetch(...statuses: number[]): FetchMock {
  const mock = installFetchMock();
  let i = 0;
  mock.mockImplementation(() => {
    const status = statuses[Math.min(i, statuses.length - 1)];
    i += 1;
    return Promise.resolve({ ok: status < 400, status } as Response);
  });
  return mock;
}

/** A fetch that REJECTS on the first call then answers 200 on every later one. */
function throwThenOkFetch(rejection: unknown): FetchMock {
  const mock = installFetchMock();
  mock
    .mockRejectedValueOnce(rejection)
    .mockResolvedValue({ ok: true, status: 200 } as Response);
  return mock;
}

/**
 * A REAL 200 `Response` carrying a JSON body — the shape the client wiring tests
 * below need. The bare `{ ok, status }` doubles above are enough for the
 * transport-level tests (they only read `.status`), but the REAL clients call
 * `res.json()` / `res.headers.get("content-type")`, so those tests must return a
 * genuine `Response`.
 */
function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/**
 * A REAL `Response` carrying a JSON body AND the upstream's own contractual
 * wait hint — the shape `error_contract.service_error` puts on the wire for every
 * SERVICE-TRANSIENT 503 (15s supabase / 30s mt5-gateway, from its
 * `RETRY_AFTER_SECONDS` table, which `_validate` refuses to let a 503 omit).
 *
 * A REAL `Response` is load-bearing here and the bare `{ ok, status }` doubles
 * above cannot stand in: D-01 reads `res.headers.get`, and the whole point of the
 * capability guard is that those doubles have no `headers` at all.
 */
function retryAfterResponse(
  status: number,
  seconds: number,
  body: unknown,
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json",
      "retry-after": String(seconds),
    },
  });
}

/**
 * A fetch that answers a FRESH `Retry-After`-bearing response of `status` on
 * EVERY call — a dependency that is still down when the retry would have fired.
 *
 * Fresh per call rather than one shared object, so a regressed loop that DOES
 * retry gets a readable second body instead of a spent stream, and the failure
 * it produces is the honest one (two attempts, two recorded failures).
 */
function retryAfterAlwaysFetch(
  status: number,
  seconds: number,
  body: unknown,
): FetchMock {
  const mock = installFetchMock();
  mock.mockImplementation(() =>
    Promise.resolve(retryAfterResponse(status, seconds, body)),
  );
  return mock;
}

/** REJECTS once, then answers a real 200 JSON `Response` on every later call. */
function throwThenJsonOk(rejection: unknown, body: unknown): FetchMock {
  const mock = installFetchMock();
  mock
    .mockRejectedValueOnce(rejection)
    .mockResolvedValue(jsonResponse(200, body));
  return mock;
}

/** REJECTS transient on EVERY call (a persistent single-blip that never clears). */
function throwAlways(rejection: unknown): FetchMock {
  const mock = installFetchMock();
  mock.mockRejectedValue(rejection);
  return mock;
}

/** Wire the env the two REAL clients read (token, service URL, service key). */
function configureSeamClients(): void {
  process.env.INTERNAL_API_TOKEN = "internal-test-token";
  process.env.ANALYTICS_SERVICE_URL = "http://analytics.test";
  process.env.ANALYTICS_SERVICE_KEY = "service-test-key";
}

function configureUpstash(): void {
  process.env.UPSTASH_REDIS_REST_URL = "https://fake.upstash.invalid";
  process.env.UPSTASH_REDIS_REST_TOKEN = "fake-token";
}

/** Drive `n` counting-503 single-attempt calls to advance the failure counter. */
async function driveFailures(
  mod: typeof import("./resilient-fetch"),
  n: number,
): Promise<void> {
  for (let i = 0; i < n; i++) {
    vi.unstubAllGlobals();
    statusSequenceFetch(503);
    // retriesOverride:0 keeps each drive call SINGLE-ATTEMPT. The bridge row is
    // retries:1 since plan 04, so a bare call would retry and load the counter
    // twice as fast — tripping the breaker mid-drive.
    await mod.resilientFetch("bridge", BRIDGE_PATH, {
      method: "POST",
      retriesOverride: 0,
    });
  }
}

beforeEach(async () => {
  vi.resetModules();
  const { __resetCaptureThrottleForTests } = await import("./sentry-capture");
  __resetCaptureThrottleForTests();
  shared.store.clear();
  shared.ctx.store = shared.store;
  shared.mode.sharedStore = true;
  shared.mode.throwOnGet = false;
  shared.mode.throwOnLimit = false;
  shared.mode.sentinelOnLimit = false;
  shared.mode.staleReadOnce = null;
  shared.mode.nullOnBreakerSet = false;
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
  vi.useRealTimers();
  process.env = { ...ORIGINAL_ENV };
});

describe("[SEAM-06 / SC2] the bounded retry loop", () => {
  it("retriesOverride:1 + a single transient rejection then 200 → exactly TWO fetch attempts, the 200 returned", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    // Fixed backoff floor, no jitter, so the real-timer wait is a deterministic
    // 250ms rather than up to 500ms.
    vi.spyOn(Math, "random").mockReturnValue(0);
    const fetchMock = throwThenOkFetch(new TypeError("fetch failed"));
    const mod = await import("./resilient-fetch");

    const res = await mod.resilientFetch("bridge", BRIDGE_PATH, {
      method: "POST",
      retriesOverride: 1,
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(res.status).toBe(200);
  });

  it("retriesOverride:1 + a counting 503 then 200 → exactly TWO fetch attempts, the 200 returned", async () => {
    // ALSO the D-01 anti-regression (SC-C′) for the CAPABILITY GUARD: this
    // double is a bare `{ ok, status }` literal with no `headers` at all, so
    // `hasContractualWait` must degrade to false — never throw inside the
    // classification window — and the 503 retry arm must stay armed. Do not
    // convert this fixture to a real `Response`; the bare shape IS the case.
    vi.spyOn(Math, "random").mockReturnValue(0);
    const fetchMock = statusSequenceFetch(503, 200);
    const mod = await import("./resilient-fetch");

    const res = await mod.resilientFetch("bridge", BRIDGE_PATH, {
      method: "POST",
      retriesOverride: 1,
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(res.status).toBe(200);
  });

  it("retriesOverride:1 + a 400 → exactly ONE fetch, the 400 returned (4xx is never retried)", async () => {
    const fetchMock = statusSequenceFetch(400);
    const mod = await import("./resilient-fetch");

    const res = await mod.resilientFetch("bridge", BRIDGE_PATH, {
      method: "POST",
      retriesOverride: 1,
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(res.status).toBe(400);
    // A 4xx does not count, so nothing was recorded either.
    expect(shared.counters.limitCalls).toBe(0);
  });

  it("retriesOverride:0 on a non-allowlisted row (validate-key) + a transient rejection → exactly ONE fetch, error thrown", async () => {
    // ⚠️ THIS CASE USED TO SAY "no override". After D-08 that sentence is not
    // expressible: `retriesOverride` is a required `0 | 1`, so a call with no
    // override does not COMPILE, and the row's `retries` no longer feeds the
    // loop at all. What "production configuration" means for this seam is now
    // "the client passes the registry's verdict" — and `validate-key` has no
    // entry in `RETRY_SAFE_ANALYTICS` (a live-exchange probe is non-idempotent),
    // so its verdict is 0. The end-to-end version of that sentence — the client
    // deriving 0 from the registry rather than a test hand-typing it — is
    // exercised through `findReplacementCandidates` in the analytics-client
    // tests; here the subject is the CORE honouring an explicit 0.
    vi.spyOn(console, "error").mockImplementation(() => {});
    const original = new TypeError("fetch failed");
    const fetchMock = installFetchMock();
    fetchMock.mockRejectedValue(original);
    const mod = await import("./resilient-fetch");

    await expect(
      mod.resilientFetch("validate-key", "/api/validate-key", {
        method: "POST",
        retriesOverride: 0,
      }),
    ).rejects.toBe(original);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    // The single attempt's transient failure still counts once.
    expect(shared.counters.limitCalls).toBe(1);
  });
});

describe("[SEAM-06 / D-01] a 503 that names its own wait FAILS FAST", () => {
  it("SC-C — a 503 carrying Retry-After → exactly ONE fetch, body intact, ONE breaker failure, and no backoff sleep", async () => {
    // The no-sleep oracle. `Math.random` is read at EXACTLY one site in the
    // core — the jitter term of the retry backoff — so "never called" is the
    // direct falsifier for "did not sleep", and it fails on the assertion
    // rather than by hanging a fake-timer clock.
    const randomSpy = vi.spyOn(Math, "random").mockReturnValue(0);
    // Still down when the retry would have fired: the honest upstream state,
    // and what makes the recorded-failure count a real oracle (a regressed
    // loop would record TWO).
    const fetchMock = retryAfterAlwaysFetch(503, 15, {
      dependency: "supabase",
      human_message: "The analytics service is briefly unavailable.",
    });
    const mod = await import("./resilient-fetch");

    const res = await mod.resilientFetch("bridge", BRIDGE_PATH, {
      method: "POST",
      retriesOverride: 1,
    });

    // Hand-typed literals, never derived from the module under test.
    expect(
      fetchMock,
      "A 503 that advertised a 15s wait was retried anyway. Retrying inside " +
        "the backoff is near-certain to fail and buys nothing but a second " +
        "breaker failure and billed lambda wall-clock.",
    ).toHaveBeenCalledTimes(1);
    expect(res.status).toBe(503);
    // Attempt 1's response is SURFACED, not discarded — the client contract
    // reads this body to name the dependency and render its own copy.
    expect(await res.json()).toMatchObject({ dependency: "supabase" });
    // ONE failure recorded, not two: the 503 happened and is counted once;
    // "does not spend a second breaker failure" is satisfied by not looping.
    expect(
      shared.counters.limitCalls,
      "The fail-fast path recorded a different number of breaker failures " +
        "than the one attempt it made.",
    ).toBe(1);
    expect(
      randomSpy,
      "The backoff jitter was read, so the loop slept before giving up — a " +
        "fail-fast must not spend wall clock it has already been told is futile.",
    ).not.toHaveBeenCalled();
  });

  it("SC-C′ — a REAL 503 Response with NO Retry-After still retries (TWO fetches)", async () => {
    // Distinct from the bare-literal case above: `headers` EXISTS here and
    // `get` answers null. A 503 from Railway's edge or Vercel's proxy never
    // passed through the Python contract, so it names no wait and the retry
    // arm must stay armed for it.
    vi.spyOn(Math, "random").mockReturnValue(0);
    const fetchMock = installFetchMock();
    fetchMock
      .mockResolvedValueOnce(jsonResponse(503, { detail: "upstream down" }))
      .mockResolvedValue(jsonResponse(200, { ok: true }));
    const mod = await import("./resilient-fetch");

    const res = await mod.resilientFetch("bridge", BRIDGE_PATH, {
      method: "POST",
      retriesOverride: 1,
    });

    expect(
      fetchMock,
      "D-01 disabled the whole 503 retry arm. It may only short-circuit a 503 " +
        "that CARRIES the upstream's wait hint.",
    ).toHaveBeenCalledTimes(2);
    expect(res.status).toBe(200);
  });

  it("a counting 502 carrying a STRAY Retry-After still retries (TWO fetches) — the rule is 503-only", async () => {
    // 502/504 come from the platform EDGE, which is outside the contract that
    // makes the header meaningful (`error_contract` mandates it on 503 and
    // nowhere else). A header arriving on one of those is not our upstream
    // telling us to wait, so it must not gate the retry.
    vi.spyOn(Math, "random").mockReturnValue(0);
    const fetchMock = installFetchMock();
    fetchMock
      .mockResolvedValueOnce(retryAfterResponse(502, 15, { detail: "bad gateway" }))
      .mockResolvedValue(jsonResponse(200, { ok: true }));
    const mod = await import("./resilient-fetch");

    const res = await mod.resilientFetch("bridge", BRIDGE_PATH, {
      method: "POST",
      retriesOverride: 1,
    });

    expect(
      fetchMock,
      "The fail-fast widened past 503. Only a 503 is contractually obliged to " +
        "carry a wait it means, so only a 503 may be believed.",
    ).toHaveBeenCalledTimes(2);
    expect(res.status).toBe(200);
  });
});

describe("[SEAM-06 / SC2] fixed backoff + jitter bounds", () => {
  it("with jitter at its floor (Math.random → 0) the retry fires at exactly 250ms, not before", async () => {
    // 250 is a LITERAL typed here, never SEAM_RETRY_BACKOFF_MS imported.
    vi.spyOn(Math, "random").mockReturnValue(0);
    const mod = await import("./resilient-fetch");
    const fetchMock = statusSequenceFetch(503, 200);

    vi.useFakeTimers();
    const p = mod.resilientFetch("bridge", BRIDGE_PATH, {
      method: "POST",
      retriesOverride: 1,
      timeoutMsOverride: 300_000,
    });

    // Attempt 1 runs and fails.
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // 1ms short of the backoff floor: still no retry.
    await vi.advanceTimersByTimeAsync(249);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // At exactly 250ms the second attempt fires.
    await vi.advanceTimersByTimeAsync(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);

    await p;
    vi.useRealTimers();
  });

  it("with jitter at its ceiling (Math.random → 1) the retry fires by 500ms, not before", async () => {
    // 500 = 250 backoff + 250 jitter-max, both LITERALS typed here.
    vi.spyOn(Math, "random").mockReturnValue(1);
    const mod = await import("./resilient-fetch");
    const fetchMock = statusSequenceFetch(503, 200);

    vi.useFakeTimers();
    const p = mod.resilientFetch("bridge", BRIDGE_PATH, {
      method: "POST",
      retriesOverride: 1,
      timeoutMsOverride: 300_000,
    });

    await vi.advanceTimersByTimeAsync(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // 1ms short of the ceiling: still no retry.
    await vi.advanceTimersByTimeAsync(499);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);

    await p;
    vi.useRealTimers();
  });
});

describe("[SEAM-06 / SC4] breaker-open guarantees", () => {
  it("SC4a — breaker seeded OPEN at entry + retriesOverride:1 → CircuitOpenError, ZERO fetch attempts", async () => {
    seedBreakerOpen(shared.store, "breaker:railway", 30);
    const fetchMock = installFetchMock();
    const mod = await import("./resilient-fetch");

    await expect(
      mod.resilientFetch("bridge", BRIDGE_PATH, {
        method: "POST",
        retriesOverride: 1,
      }),
    ).rejects.toBeInstanceOf(mod.CircuitOpenError);

    expect(fetchMock).toHaveBeenCalledTimes(0);
    expect(shared.counters.limitCalls).toBe(0);
  });

  it("SC4b — breaker CLOSED at entry, attempt 1's failure TRIPS it, the re-check throws CircuitOpenError and no second fetch fires", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(Math, "random").mockReturnValue(0);
    const mod = await import("./resilient-fetch");

    // Advance the failure counter to THRESHOLD-1 without tripping (breaker still
    // closed at entry). BREAKER_FAILURE_THRESHOLD is 5 — 4 failures leave it
    // closed; attempt 1 of the retry call below records the 5th and arms it.
    await driveFailures(mod, mod.BREAKER_FAILURE_THRESHOLD - 1);
    expect(shared.store.get(mod.BREAKER_KEY)).toBeUndefined();

    vi.unstubAllGlobals();
    const fetchMock = statusSequenceFetch(503, 200);

    const thrown = await mod
      .resilientFetch("bridge", BRIDGE_PATH, {
        method: "POST",
        retriesOverride: 1,
      })
      .then(
        () => null,
        (e: unknown) => e,
      );

    // The re-check threw — and the loop did NOT catch/swallow it.
    expect(thrown).toBeInstanceOf(mod.CircuitOpenError);
    // Exactly ONE attempt: attempt 1 fired, tripped the breaker, and the
    // pre-attempt-2 re-check aborted the retry.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    // The lock the re-check read is really armed.
    expect(shared.store.get(mod.BREAKER_KEY)).toBeDefined();
  });
});

describe("[SEAM-06] the per-attempt breaker latch", () => {
  it("both attempts fail transient → the store records EXACTLY 2 failures (latch resets per attempt)", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(Math, "random").mockReturnValue(0);
    // Both attempts answer a counting 503; threshold is 5 so neither trips.
    const fetchMock = statusSequenceFetch(503, 503);
    const mod = await import("./resilient-fetch");

    const res = await mod.resilientFetch("bridge", BRIDGE_PATH, {
      method: "POST",
      retriesOverride: 1,
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    // The last attempt's counting 503 is RETURNED, not thrown.
    expect(res.status).toBe(503);
    // One failure recorded PER attempt — the whole point of resetting the latch.
    expect(shared.counters.limitCalls).toBe(2);
  });

  it("a single attempt whose 503 is followed by a body-read failure records EXACTLY 1 (no double-count within one attempt)", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    // A REAL Response so the 503 dependency peek and the caller body read both
    // run; its body rejects on read.
    const mock = installFetchMock();
    mock.mockResolvedValue({
      ok: false,
      status: 503,
      statusText: "Service Unavailable",
      headers: new Headers({ "content-type": "application/json" }),
      json: () => Promise.reject(new DOMException("aborted", "TimeoutError")),
      text: () => Promise.reject(new DOMException("aborted", "TimeoutError")),
      clone: () => ({
        json: () => Promise.reject(new DOMException("aborted", "TimeoutError")),
      }),
    } as unknown as Response);
    const mod = await import("./resilient-fetch");

    // retriesOverride:0 → single attempt. The 503 status arm records once. (The
    // bridge row is retries:1 since plan 04, so the override is what pins the
    // one-attempt path this within-attempt-latch case depends on.)
    const res = await mod.resilientFetch("bridge", BRIDGE_PATH, {
      method: "POST",
      retriesOverride: 0,
    });
    expect(shared.counters.limitCalls).toBe(1);

    // The caller reading the body then fails — the body arm must NOT record a
    // second time within the same attempt (the within-attempt latch holds).
    await expect(res.json()).rejects.toBeInstanceOf(mod.SeamBodyReadError);
    expect(shared.counters.limitCalls).toBe(1);
  });
});

describe("[SEAM-06] retriesOverride validation (config faults raised ABOVE the classification window)", () => {
  it.each([
    ["a negative value", -1],
    ["above the one-retry cap", 2],
    ["a non-integer", 1.5],
    ["NaN", Number.NaN],
  ])(
    "%s → SeamConfigError, ZERO fetch attempts, ZERO breaker records",
    async (_label, value) => {
      vi.spyOn(console, "error").mockImplementation(() => {});
      const fetchMock = installFetchMock();
      const mod = await import("./resilient-fetch");

      await expect(
        mod.resilientFetch("bridge", BRIDGE_PATH, {
          method: "POST",
          // ⚠️ THE CAST IS THE SUBJECT, NOT A CONVENIENCE. D-08 narrowed the
          // field to `0 | 1`, which erases at runtime; this cast reproduces
          // exactly what a JS caller or an `as any` hands the core, and it is
          // the only way to reach the runtime validator from TypeScript. Delete
          // the cast and this whole describe stops testing anything — the
          // validator would be unreachable, not proven redundant.
          retriesOverride: value as 0 | 1,
        }),
      ).rejects.toBeInstanceOf(mod.SeamConfigError);

      expect(fetchMock).toHaveBeenCalledTimes(0);
      expect(shared.counters.limitCalls).toBe(0);
    },
  );

  it("retriesOverride:0 is a VALID explicit no-retry — one fetch, no SeamConfigError", async () => {
    const fetchMock = statusSequenceFetch(200);
    const mod = await import("./resilient-fetch");

    const res = await mod.resilientFetch("bridge", BRIDGE_PATH, {
      method: "POST",
      retriesOverride: 0,
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(res.status).toBe(200);
  });
});

/**
 * Phase 141 / SEAM-05+06 (plan 04) — the CLIENT WIRING.
 *
 * These tests drive the REAL `postProcessKey` and the REAL analytics wrappers
 * with only `fetch` mocked — they test the WIRING (does the client thread a
 * `retriesOverride` keyed on the registry into the shared transport?), not a
 * helper. The proof-of-necessity is ASYMMETRIC: before the wiring lands,
 * teaser/csv/validateKey already single-fetch (nothing retries) but
 * resync/onboard/bridge FAIL — one fetch where two are expected — because the
 * registry is consulted nowhere. That asymmetric RED is the wiring's reason to
 * exist.
 *
 * Grain matters (the SC3 landmine): the process-key seam is keyed on `flow_type`
 * because `budgetKeyFor` is MANY-TO-ONE (teaser+csv → process-key-sync). Keying
 * the retry on the budgetKey would retry teaser the moment csv were allowed onto
 * the sync budget. So teaser/csv (absent from the YES map) get exactly ONE fetch
 * while resync/onboard (present) get two — under the SAME budget grain.
 */
describe("[SEAM-06 / SC2+SC3] client wiring — the REAL clients thread retriesOverride", () => {
  // Math.random → 0 pins the backoff at its 250ms floor (real-timer wait).
  function pinFloorBackoff(): void {
    vi.spyOn(Math, "random").mockReturnValue(0);
  }

  it("SC3 — postProcessKey teaser + a persistent transient → exactly ONE fetch (never retried)", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    configureSeamClients();
    const fetchMock = throwAlways(new TypeError("fetch failed"));
    const { postProcessKey } = await import("./process-key-client");

    const result = await postProcessKey({
      flow_type: "teaser",
      source: "teaser",
      context: {},
      userId: "public",
      correlationId: "c-teaser",
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result.ok).toBe(false);
  });

  it("SC3 — postProcessKey csv + a persistent transient → exactly ONE fetch (shares the sync budget with teaser, still no retry)", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    configureSeamClients();
    const fetchMock = throwAlways(new TypeError("fetch failed"));
    const { postProcessKey } = await import("./process-key-client");

    const result = await postProcessKey({
      flow_type: "csv",
      source: "csv",
      context: { step: "validate" },
      userId: "u1",
      correlationId: "c-csv",
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result.ok).toBe(false);
  });

  it("SC2 — postProcessKey resync + a single transient then 200 → exactly TWO fetches, resolves ok", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    pinFloorBackoff();
    const fetchMock = throwThenJsonOk(new TypeError("fetch failed"), {
      ok: true,
      strategy_id: "s1",
    });
    configureSeamClients();
    const { postProcessKey } = await import("./process-key-client");

    const result = await postProcessKey({
      flow_type: "resync",
      source: "resync",
      context: {},
      userId: "u1",
      correlationId: "c-resync",
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.ok).toBe(true);
  });

  it("SC2 — postProcessKey onboard + a single transient then 200 → exactly TWO fetches, resolves ok", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    pinFloorBackoff();
    const fetchMock = throwThenJsonOk(new TypeError("fetch failed"), {
      ok: true,
      strategy_id: "s1",
    });
    configureSeamClients();
    const { postProcessKey } = await import("./process-key-client");

    const result = await postProcessKey({
      flow_type: "onboard",
      source: "onboard",
      context: {},
      userId: "u1",
      correlationId: "c-onboard",
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.ok).toBe(true);
  });

  it("SC2 — findReplacementCandidates (bridge) + a single transient then 200 → exactly TWO fetches, resolves", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    pinFloorBackoff();
    const fetchMock = throwThenJsonOk(new TypeError("fetch failed"), {
      candidates: [],
    });
    configureSeamClients();
    const { findReplacementCandidates } = await import("./analytics-client");

    const result = await findReplacementCandidates("p1", "under-1", "u1");

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result).toEqual({ candidates: [] });
  });

  it("validateKey + a single transient → exactly ONE fetch (registry-absent wrapper inherits no-retry through the chokepoint)", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    configureSeamClients();
    const fetchMock = throwAlways(new TypeError("fetch failed"));
    const { validateKey } = await import("./analytics-client");

    await expect(
      validateKey("deribit", "k", "s", undefined, { userId: "u1" }),
    ).rejects.toBeTruthy();

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
