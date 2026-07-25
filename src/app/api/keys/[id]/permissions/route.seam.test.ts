import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";
import { seedBreakerOpen } from "@/test/helpers/upstash-breaker";

/**
 * HOST GLOBAL: `globalThis.AsyncLocalStorage` is installed by `src/test-setup.ts`.
 *
 * `next/dist/server/app-render/async-local-storage.js` reads it ONCE, at module
 * evaluation, and otherwise substitutes a stub whose `run()` throws the E504
 * invariant. jsdom does not expose it, and `unstable_cache` (exercised for real
 * below) is built on that storage — so the global must exist before the first
 * `next/*` module in the worker is evaluated.
 *
 * This file originally installed it here, from an ASYNC `vi.hoisted` block. That
 * is a RACE rather than a fix: the block is hoisted above the imports, but its
 * `await import("node:async_hooks")` resolves on a later microtask, so under
 * full-suite worker contention this file's own imports could evaluate first and
 * capture `undefined`. It failed roughly one full-suite run in three, and it
 * failed SILENTLY — the invariant surfaced as a generic upstream 502 that the
 * route's catch classified plausibly, so all three cases here reported a wrong
 * status rather than an obvious harness error. Setup files are fully awaited
 * before any test module loads, which makes the install deterministic; see the
 * comment on the static import in `src/test-setup.ts`.
 */

/**
 * Phase 140 / SEAM-01 + T-140-32 — route-level SEAM proof for
 * GET /api/keys/[id]/permissions, run against the REAL Next cache boundary.
 *
 * WHY THIS FILE EXISTS, given `route.test.ts` already covers this handler.
 * ----------------------------------------------------------------------
 * `route.test.ts` replaces `next/cache` with a hand-written double, because it
 * needs to drive hit / miss / stale-revalidate deterministically. That double is
 * an ASSERTION ABOUT the fork, not a reading of it — and the whole risk in this
 * plan is that the seam's typed `CircuitOpenError` has to survive a boundary
 * this repo does not own. Two questions cannot be answered by a mock:
 *
 *   1. Does a throw from inside the cached callback reach the outer handler
 *      with its PROTOTYPE intact, so `err instanceof CircuitOpenError` holds?
 *      (If the boundary wrapped or structurally cloned it, the route's 503 arm
 *      would silently fall through to the generic 502 — the breaker would be
 *      invisible in production and green in every test.)
 *   2. Does a throw leave NO cache entry? The Next layer caches for 60s, DOUBLE
 *      the 30s breaker cooldown. A cached breaker error would keep answering
 *      503 for half a minute after Railway recovered: the mitigation would have
 *      become the outage (T-140-32).
 *
 * So this file runs the REAL `next/cache`, the REAL `@/lib/resilient-fetch` and
 * the REAL `unstable_cache` boundary, faking only what genuinely leaves the
 * process: `fetch` (the Railway round-trip), `@upstash/*` (the breaker store),
 * Supabase, and the incremental-cache backing store the App Router would
 * normally supply. `next/cache` must therefore never be replaced here.
 *
 * Two host details the fork requires, and why they are set up rather than
 * mocked away:
 *   - `globalThis.AsyncLocalStorage` — installed in the `vi.hoisted` block
 *     below; see its comment for the ordering hazard.
 *   - `globalThis.__incrementalCache` — outside a render, `unstable_cache`
 *     throws an invariant without one. The fake is a Map with the exact
 *     `generateSimpleCacheKey` / `get` / `set` surface the fork calls.
 */

vi.mock("server-only", () => ({}));

const USER = { id: "00000000-0000-0000-0000-000000000001" };
const KEY_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ANALYTICS_BASE = "http://analytics.invalid";

/** Static copy the route is allowed to emit. Duplicated deliberately: a test
 *  that imported the constant from the route could not detect it changing. */
const CIRCUIT_OPEN_COPY =
  "The analytics service is temporarily unavailable. Please try again in a moment.";

const supaState = vi.hoisted(() => ({
  keyRow: null as { id: string; user_id: string } | null,
  rpcCalls: [] as string[],
}));

/**
 * The "shared Upstash database", plus a READ COUNTER.
 *
 * MUST be hoisted: `vi.resetModules()` re-evaluates the resilience core, and
 * only state living outside the module graph survives that. `reads` is what
 * makes "a cache HIT never consults the breaker" observable — without it, a
 * regression that moved the breaker check outside the cached callback would
 * still return 200 on a hit and pass every status assertion.
 */
const shared = vi.hoisted(() => ({
  store: new Map<string, { value: string; expiresAt: number }>(),
  reads: 0,
}));

vi.mock("@upstash/redis", async () => {
  const { fakeRedisFor } = await import("@/test/helpers/upstash-breaker");
  return {
    Redis: {
      fromEnv: () => {
        const real = fakeRedisFor(shared.store);
        return {
          ...real,
          get: async <T = string>(key: string) => {
            shared.reads += 1;
            return real.get<T>(key);
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
      private readonly fake: ReturnType<typeof fakeRatelimitFor>;
      constructor(opts: { limiter: { tokens: number } }) {
        this.fake = fakeRatelimitFor(shared.store, opts.limiter.tokens);
      }
      limit(identifier: string) {
        return this.fake.limit(identifier);
      }
    },
  };
});

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: {
      getUser: async () => ({ data: { user: USER }, error: null }),
    },
    rpc: async (name: string) => {
      supaState.rpcCalls.push(name);
      return { data: null, error: null };
    },
    from: (table: string) => {
      if (table !== "api_keys") throw new Error(`unexpected from(${table})`);
      return {
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({ data: supaState.keyRow, error: null }),
          }),
        }),
      };
    },
  }),
}));

// The per-user route limiter is orthogonal to the seam under test; the breaker
// has its own dedicated Upstash client (mocked above) and never routes here.
vi.mock("@/lib/ratelimit", () => ({
  userActionLimiter: null,
  checkLimit: async () => ({ success: true, retryAfter: 0 }),
}));

/** The Map the fork's `unstable_cache` reads and writes through our fake. */
type IncrementalEntry = {
  value: { kind: string; data: { body?: string } };
  isStale: boolean;
};
let incrementalStore: Map<string, IncrementalEntry>;

function installFakeIncrementalCache(): Map<string, IncrementalEntry> {
  const store = new Map<string, IncrementalEntry>();
  (globalThis as unknown as { __incrementalCache: unknown }).__incrementalCache =
    {
      isOnDemandRevalidate: false,
      async generateSimpleCacheKey(invocationKey: string) {
        return invocationKey;
      },
      async get(key: string) {
        return store.get(key) ?? null;
      },
      async set(key: string, data: IncrementalEntry["value"]) {
        store.set(key, { value: data, isStale: false });
      },
    };
  return store;
}

const ORIGINAL_ENV = { ...process.env };
let fetchMock: ReturnType<typeof vi.fn>;

function okProbeResponse() {
  return new Response(
    JSON.stringify({
      read: true,
      trade: false,
      withdraw: false,
      probe_error: false,
      detected_at: "2026-07-25T00:00:00Z",
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}

function makeRequest(): NextRequest {
  return new NextRequest(
    `http://localhost:3000/api/keys/${KEY_ID}/permissions`,
    { method: "GET" },
  );
}

describe("GET /api/keys/[id]/permissions — REAL unstable_cache boundary (SEAM-01 / T-140-32)", () => {
  beforeEach(() => {
    // ENV BEFORE IMPORT. The core captures ANALYTICS_SERVICE_URL and decides
    // whether the breaker exists at all (UPSTASH_* → Redis.fromEnv()) in its
    // MODULE BODY. Setting these after the dynamic import would leave the
    // breaker permanently inert and the cases below would pass for entirely the
    // wrong reason.
    process.env.UPSTASH_REDIS_REST_URL = "https://fake.upstash.invalid";
    process.env.UPSTASH_REDIS_REST_TOKEN = "fake-token";
    process.env.ANALYTICS_SERVICE_URL = ANALYTICS_BASE;
    process.env.INTERNAL_API_TOKEN = "test-internal-token";
    incrementalStore = installFakeIncrementalCache();
    vi.resetModules();

    shared.store.clear();
    shared.reads = 0;
    supaState.keyRow = { id: KEY_ID, user_id: USER.id };
    supaState.rpcCalls = [];

    fetchMock = vi.fn(async () => okProbeResponse());
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    // A leaked `vi.stubGlobal("fetch")` is this repo's known CI-only (Node 22)
    // failure cause. Unstub unconditionally, not just on the happy path.
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    delete (globalThis as unknown as { __incrementalCache?: unknown })
      .__incrementalCache;
    process.env = { ...ORIGINAL_ENV };
  });

  it("cache MISS + breaker open → 503 CIRCUIT_OPEN through the real boundary, and NOTHING is cached", async () => {
    seedBreakerOpen(shared.store, 19);
    const { GET } = await import("./route");

    const res = await GET(makeRequest());

    // The typed error crossed the real cache boundary with its prototype
    // intact — otherwise the route's `instanceof` arm would have missed and
    // this would be the generic 502.
    expect(res.status).toBe(503);
    expect(res.headers.get("Retry-After")).toBe("19");
    const raw = await res.text();
    expect(JSON.parse(raw).code).toBe("CIRCUIT_OPEN");
    expect(JSON.parse(raw).error).toBe(CIRCUIT_OPEN_COPY);
    expect(raw).not.toMatch(/breaker|upstash|railway|analytics service circuit/i);

    // The seam was not crossed.
    expect(fetchMock).not.toHaveBeenCalled();

    // ── T-140-32: the fork wrote NO cache entry for the failed callback ─────
    expect(incrementalStore.size).toBe(0);

    // ...so once the cooldown lapses the very next call re-attempts for real,
    // rather than replaying a 60s-lived failure that outlives the 30s breaker.
    shared.store.clear();
    const res2 = await GET(makeRequest());
    expect(res2.status).toBe(200);
    expect((await res2.json()).read).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(incrementalStore.size).toBe(1);
  });

  it("cache HIT replays without running the callback — the breaker is never consulted", async () => {
    const { GET } = await import("./route");

    const first = await GET(makeRequest());
    expect(first.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const readsAfterMiss = shared.reads;
    // The miss DID consult the breaker (that is the seam check).
    expect(readsAfterMiss).toBeGreaterThan(0);

    // Open the breaker. A hit must be completely indifferent to it.
    seedBreakerOpen(shared.store, 30);

    const second = await GET(makeRequest());
    expect(second.status).toBe(200);
    expect((await second.json()).read).toBe(true);
    // No second round-trip: the fork replayed the entry.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    // And no Redis read at all — the breaker check lives INSIDE the cached
    // callback, which did not run. A regression that hoisted it out would turn
    // this hit into a 503 and redden here.
    expect(shared.reads).toBe(readsAfterMiss);
  });

  it("Railway hangs → the core's deadline fires and the route maps it to 502 PROBE_TIMEOUT", async () => {
    // The exact rejection shape `AbortSignal.timeout()` produces when the
    // core's 15s `keys-permissions` budget fires.
    fetchMock.mockRejectedValue(new DOMException("aborted", "TimeoutError"));
    const { GET } = await import("./route");

    const startedAt = Date.now();
    const res = await GET(makeRequest());
    const elapsedMs = Date.now() - startedAt;

    expect(res.status).toBe(502);
    const raw = await res.text();
    expect(JSON.parse(raw).code).toBe("PROBE_TIMEOUT");
    // Upstream detail is logged server-side, never echoed.
    expect(raw).not.toContain("aborted");

    // The REAL core ran: core-owned base URL, the route's path, a deadline
    // signal. None of this is observable under a mocked transport.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(
      `${ANALYTICS_BASE}/internal/keys/${encodeURIComponent(KEY_ID)}/permissions`,
    );
    expect(init.signal).toBeInstanceOf(AbortSignal);

    // No lambda hold, and no poisoned cache entry for the failure.
    expect(elapsedMs).toBeLessThan(2_000);
    expect(incrementalStore.size).toBe(0);
  });
});
