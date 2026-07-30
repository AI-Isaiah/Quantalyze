import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";

/**
 * Tests for GET /api/keys/[id]/permissions — the Task 7.1a `api_key.decrypt`
 * audit emission and (M-0325) its cache_hit honesty.
 *
 * The live behaviour of the route (Python proxy, unstable_cache, ownership
 * check) is covered indirectly by the staging E2E. This file's job is narrow:
 * prove the audit event fires on a real decrypt (cache MISS), is tagged
 * cache_hit on a replay (cache HIT, no decrypt), and does NOT fire on
 * ownership rejection / 404 / rate-limit / upstream-failure paths.
 *
 * M-0325 model: the route detects a decrypt via a request-local `didDecrypt`
 * closure flag set ONLY when the cached fetcher body runs. We exercise that for
 * real — the next/cache mock either runs the body (MISS, drives a stubbed
 * upstream fetch) or replays a memoized value WITHOUT running it (HIT) — rather
 * than injecting a synthetic timestamp.
 *
 * Phase 140 / SEAM-01 + T-140-32 addendum: the upstream call now goes through
 * the shared resilience core, INSIDE the cached callback. The three cases in the
 * final describe block pin the breaker's behaviour across that cache boundary
 * against the mocked cache here; the REAL `next/cache` boundary (which this file
 * necessarily replaces) is proved separately in `route.seam.test.ts`.
 */

vi.mock("server-only", () => ({}));

// ─────────────────────────────────────────────────────────────────────────────
// 140.3-13a / SEAMUX-08 — the Sentry capture, tested through the REAL helper.
//
// ⚠️ `@sentry/nextjs` is mocked here and `@/lib/sentry-capture` is DELIBERATELY
// NOT. The scrub lives INSIDE the helper (SEAMCORE-06), so mocking the helper —
// which is the house pattern elsewhere — would make every payload assertion
// below pass with the scrubber deleted. Running the real helper over a faked
// Sentry transport is what makes both halves of TRAP-1 falsifiable here.
// ─────────────────────────────────────────────────────────────────────────────
const sentryState = vi.hoisted(() => ({
  captured: [] as Array<{
    err: unknown;
    options: {
      tags?: Record<string, string>;
      extra?: Record<string, unknown>;
      level?: string;
    };
  }>,
}));

vi.mock("@sentry/nextjs", () => ({
  captureException: (err: unknown, options: Record<string, unknown>) => {
    sentryState.captured.push({
      err,
      options: options as (typeof sentryState.captured)[number]["options"],
    });
  },
}));


const USER = { id: "00000000-0000-0000-0000-000000000001" };
const KEY_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

const STATE = vi.hoisted(() => ({
  keyRow: null as { id: string; user_id: string } | null,
  rpcCalls: [] as Array<{ name: string; args: Record<string, unknown> }>,
  rateLimitOk: true as boolean,
  // 140.4-13 / SEAMRIM-05 — the THIRD limiter outcome. `undefined` is a genuine
  // throttle (429); "ratelimit_misconfigured" is OUR store being unreachable and
  // must answer 503, not a 429 that reads as the caller's fault.
  rateLimitReason: undefined as "ratelimit_misconfigured" | undefined,
  // unstable_cache simulation: when true the cache REPLAYS cachedHitPayload
  // without running the fetcher body (a hit — no decrypt). When false the body
  // runs (a miss — sets didDecrypt, drives the stubbed upstream below).
  simulateCacheHit: false as boolean,
  cachedHitPayload: {} as Record<string, unknown>,
  // Next's THIRD state (stale-while-revalidate): the body reruns in the
  // background (a real decrypt, flips didDecrypt synchronously) but a STALE
  // value is returned to the caller immediately.
  simulateStaleRevalidate: false as boolean,
  stalePayload: {} as Record<string, unknown>,
  // Stubbed upstream Python response for the cache-MISS path (the real body).
  upstreamPayload: {} as Record<string, unknown>,
  upstreamStatus: 200 as number,
  upstreamThrow: false as boolean,
  // 140.3-09 / TS-34 — extra response headers the stubbed upstream returns,
  // keyed LOWERCASE. Empty by default so every case written before this plan
  // keeps seeing `null` for everything but content-type.
  upstreamHeaders: {} as Record<string, string>,
  upstreamContentType: "application/json" as string | null,
  // Phase 140 / T-140-32: a FAITHFUL memoizing cache. When true the mock stores
  // the RESOLVED value under the keyParts and replays it on the next call —
  // and, exactly as the fork does, writes NOTHING when the body throws. This is
  // what makes "a breaker error must not be cached for 60s" a falsifiable
  // assertion rather than a tautology of the passthrough mock.
  memoize: false as boolean,
  memoStore: new Map<string, unknown>(),
}));

/**
 * Phase 140 / SEAM-01 — control surface over the shared resilience core.
 *
 * Partial mock (the 140-03 spread-`importOriginal` pattern): every export stays
 * REAL — including `resilientFetch`'s base URL, budget and `AbortSignal` — and
 * only the breaker decision is driven from the test. A full factory would
 * re-implement the transport and could not detect a regression in it.
 */
const RF = vi.hoisted(() => ({
  breakerOpen: false as boolean,
  retryAfterS: 30 as number,
  calls: 0 as number,
  lastCall: null as
    | { budgetKey: string; path: string; init: Record<string, unknown> }
    | null,
}));

vi.mock("@/lib/resilient-fetch", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/resilient-fetch")>();
  // The leaf is never mocked, so this is the SAME class identity the route's
  // `instanceof` branch tests against.
  const { CircuitOpenError } = await import("@/lib/seam-errors");
  return {
    ...actual,
    resilientFetch: async (
      budgetKey: Parameters<typeof actual.resilientFetch>[0],
      path: string,
      init: Parameters<typeof actual.resilientFetch>[2] = {},
    ) => {
      RF.calls += 1;
      RF.lastCall = { budgetKey, path, init: init as Record<string, unknown> };
      if (RF.breakerOpen) throw new CircuitOpenError(RF.retryAfterS);
      return actual.resilientFetch(budgetKey, path, init);
    },
  };
});

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: {
      getUser: async () => ({ data: { user: USER }, error: null }),
    },
    rpc: async (name: string, args: Record<string, unknown>) => {
      STATE.rpcCalls.push({ name, args });
      return { data: null, error: null };
    },
    from: (table: string) => {
      if (table !== "api_keys") throw new Error(`unexpected from(${table})`);
      return {
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({ data: STATE.keyRow, error: null }),
          }),
        }),
      };
    },
  }),
}));

// ⚠️ EXTENDED, NOT REPLACED (140.4-13 / SEAMRIM-05). See the note in
// `src/__tests__/csv-validate-route.test.ts`: the pure helpers come from
// `importActual` so this mock cannot drift from the real 503-vs-429 decision.
// `rateLimitReason` drives the misconfigured branch; unset it for a genuine
// throttle.
vi.mock("@/lib/ratelimit", async (importActual) => {
  const actual = await importActual<typeof import("@/lib/ratelimit")>();
  return {
    userActionLimiter: null,
    checkLimit: async () => ({
      success: STATE.rateLimitOk,
      retryAfter: STATE.rateLimitOk ? 0 : 60,
      ...(STATE.rateLimitReason ? { reason: STATE.rateLimitReason } : {}),
    }),
    rateLimitDenyJson: actual.rateLimitDenyJson,
    isRateLimitMisconfigured: actual.isRateLimitMisconfigured,
  };
});

// Emulate unstable_cache: a HIT returns the memoized value WITHOUT invoking the
// body (so the route's didDecrypt closure flag stays false); a MISS runs the
// body (which flips didDecrypt and calls the stubbed upstream fetch).
vi.mock("next/cache", () => ({
  unstable_cache: (fn: () => Promise<unknown>, keyParts?: string[]) => {
    return async () => {
      if (STATE.simulateCacheHit) return STATE.cachedHitPayload;
      if (STATE.simulateStaleRevalidate) {
        // Stale-while-revalidate: kick off the body (background revalidation —
        // its synchronous prefix flips didDecrypt before the first await) but
        // return the prior STALE value immediately, as Next does.
        void fn().catch(() => {});
        return STATE.stalePayload;
      }
      if (STATE.memoize) {
        const memoKey = (keyParts ?? []).join(",");
        if (STATE.memoStore.has(memoKey)) return STATE.memoStore.get(memoKey);
        // FIDELITY, and the whole point of this branch: the fork `await`s the
        // callback and writes the entry only AFTER it RESOLVES
        // (next/dist/server/web/spec-extension/unstable-cache.js — the
        // `cacheNewResult(result, ...)` call sits after `const result = await
        // ...cb(...)`). A rejection therefore leaves NO entry. Storing the
        // value before/despite a throw here would make the "not cached"
        // assertion below unfalsifiable.
        const value = await fn();
        STATE.memoStore.set(memoKey, value);
        return value;
      }
      return fn();
    };
  },
}));

function makeRequest(keyId: string): NextRequest {
  return new NextRequest(
    `http://localhost:3000/api/keys/${keyId}/permissions`,
    { method: "GET" },
  );
}

async function drainAuditMicrotasks() {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

beforeEach(() => {
  STATE.keyRow = { id: KEY_ID, user_id: USER.id };
  STATE.rpcCalls = [];
  STATE.rateLimitOk = true;
  STATE.simulateCacheHit = false;
  STATE.cachedHitPayload = {
    read: true,
    trade: false,
    withdraw: false,
    detected_at: "2026-04-16T00:00:00Z",
  };
  STATE.simulateStaleRevalidate = false;
  STATE.stalePayload = {
    read: false,
    trade: true,
    withdraw: false,
    detected_at: "2026-04-15T00:00:00Z",
  };
  STATE.upstreamPayload = {
    read: true,
    trade: false,
    withdraw: false,
    detected_at: "2026-04-16T00:00:00Z",
  };
  STATE.upstreamStatus = 200;
  STATE.upstreamThrow = false;
  STATE.upstreamHeaders = {};
  STATE.upstreamContentType = "application/json";
  STATE.memoize = false;
  STATE.memoStore.clear();
  RF.breakerOpen = false;
  RF.retryAfterS = 30;
  RF.calls = 0;
  RF.lastCall = null;
  process.env.INTERNAL_API_TOKEN = "test-internal-token";
  // Stub the upstream Python call the cache-miss body makes.
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => {
      if (STATE.upstreamThrow) throw new Error("ECONNREFUSED upstream down");
      return {
        ok: STATE.upstreamStatus >= 200 && STATE.upstreamStatus < 300,
        status: STATE.upstreamStatus,
        statusText: "stub",
        headers: {
          get: (h: string) => {
            const name = h.toLowerCase();
            if (name === "content-type") {
              return STATE.upstreamContentType;
            }
            // 140.3-09 / TS-34 — the upstream's own response headers. Defaults
            // to `{}`, so every pre-existing case sees exactly what it saw
            // before: `null` for everything but content-type.
            return STATE.upstreamHeaders[name] ?? null;
          },
        },
        json: async () => STATE.upstreamPayload,
      };
    }),
  );
});

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe("GET /api/keys/[id]/permissions — audit-log emission (Task 7.1a)", () => {
  it("emits api_key.decrypt via log_audit_event on a successful (fresh) probe", async () => {
    const { GET } = await import("./route");
    const res = await GET(makeRequest(KEY_ID));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.read).toBe(true);

    await drainAuditMicrotasks();

    const auditCall = STATE.rpcCalls.find((c) => c.name === "log_audit_event");
    expect(auditCall).toBeDefined();
    expect(auditCall!.args).toMatchObject({
      p_action: "api_key.decrypt",
      p_entity_type: "api_key",
      p_entity_id: KEY_ID,
    });
    // Fresh probe = cache miss = a real decrypt happened.
    expect(auditCall!.args.p_metadata).toMatchObject({
      route: "/api/keys/[id]/permissions",
      cache_hit: false,
    });
  });

  it("does NOT emit when the ownership check rejects (403 path)", async () => {
    STATE.keyRow = { id: KEY_ID, user_id: "99999999-9999-4999-8999-999999999999" };
    const { GET } = await import("./route");
    const res = await GET(makeRequest(KEY_ID));
    expect(res.status).toBe(403);

    await drainAuditMicrotasks();
    expect(
      STATE.rpcCalls.filter((c) => c.name === "log_audit_event"),
    ).toHaveLength(0);
  });

  it("does NOT emit when the key is not found (404 path)", async () => {
    STATE.keyRow = null;
    const { GET } = await import("./route");
    const res = await GET(makeRequest(KEY_ID));
    expect(res.status).toBe(404);

    await drainAuditMicrotasks();
    expect(
      STATE.rpcCalls.filter((c) => c.name === "log_audit_event"),
    ).toHaveLength(0);
  });

  it("does NOT emit when the Python fetcher throws (502 path)", async () => {
    STATE.upstreamThrow = true;
    const { GET } = await import("./route");

    // Silence console.error for the expected proxy-failure log.
    const consoleErr = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await GET(makeRequest(KEY_ID));
    consoleErr.mockRestore();
    expect(res.status).toBe(502);

    await drainAuditMicrotasks();
    expect(
      STATE.rpcCalls.filter((c) => c.name === "log_audit_event"),
    ).toHaveLength(0);
  });

  it("does NOT emit when rate-limited (429 path)", async () => {
    STATE.rateLimitOk = false;
    const { GET } = await import("./route");
    const res = await GET(makeRequest(KEY_ID));
    expect(res.status).toBe(429);

    await drainAuditMicrotasks();
    expect(
      STATE.rpcCalls.filter((c) => c.name === "log_audit_event"),
    ).toHaveLength(0);
  });
});

/**
 * 140.4-13 / SEAMRIM-05 — a limiter MISCONFIGURATION is not a throttle.
 *
 * This route is read-only and cheap, so a 429 here reads to the allocator as
 * "you clicked too fast". During an Upstash outage that sentence was emitted on
 * the FIRST click, for every user, and the outage never reached the canary that
 * watches 5xx.
 */
describe("[140.4-13 / SEAMRIM-05] GET /api/keys/[id]/permissions — the limiter deny arm", () => {
  afterEach(() => {
    STATE.rateLimitOk = true;
    STATE.rateLimitReason = undefined;
    vi.restoreAllMocks();
  });

  it("ratelimit_misconfigured → 503, not 429", async () => {
    STATE.rateLimitOk = false;
    STATE.rateLimitReason = "ratelimit_misconfigured";

    const { GET } = await import("./route");
    const res = await GET(makeRequest(KEY_ID));

    expect(res.status).toBe(503);
    expect(res.headers.get("Retry-After")).toBe("60");
    expect(res.headers.get("Cache-Control")).toBe("private, no-store");
    expect(await res.json()).toEqual({ error: "Rate limiter unavailable" });
  });

  it("a genuine throttle → 429 with a BYTE-IDENTICAL body and headers", async () => {
    STATE.rateLimitOk = false;
    STATE.rateLimitReason = undefined;

    const { GET } = await import("./route");
    const res = await GET(makeRequest(KEY_ID));

    expect(res.status).toBe(429);
    // Hand-typed from the pre-adoption source, not read back off the builder.
    expect(await res.json()).toEqual({ error: "Too many requests" });
    expect(res.headers.get("Retry-After")).toBe("60");
    expect(res.headers.get("Cache-Control")).toBe("private, no-store");
  });

  it("success → the deny arm does not fire", async () => {
    STATE.rateLimitOk = true;

    const { GET } = await import("./route");
    const res = await GET(makeRequest(KEY_ID));

    expect(res.status).not.toBe(429);
    expect(res.status).not.toBe(503);
  });
});

describe("GET /api/keys/[id]/permissions — probe_error pass-through", () => {
  // Regression: the TS PermissionPayload interface used to omit `probe_error`,
  // so the cached fetcher implicitly stripped the field even though the Python
  // service set it on the fail-CLOSED path. The frontend `KeyPermissionBadge`
  // then mis-rendered "key may have been revoked" whenever the exchange API was
  // just down. This test pins the forwarding contract end-to-end.
  it("forwards probe_error=true through to the response body", async () => {
    STATE.upstreamPayload = {
      read: true,
      trade: true,
      withdraw: true,
      probe_error: true,
      detected_at: "2026-04-16T00:00:00Z",
    };
    const { GET } = await import("./route");
    const res = await GET(makeRequest(KEY_ID));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.probe_error).toBe(true);
    expect(body.read).toBe(true);
    expect(body.trade).toBe(true);
    expect(body.withdraw).toBe(true);
  });

  it("forwards probe_error=false on a clean probe", async () => {
    STATE.upstreamPayload = {
      read: true,
      trade: false,
      withdraw: false,
      probe_error: false,
      detected_at: "2026-04-16T00:00:00Z",
    };
    const { GET } = await import("./route");
    const res = await GET(makeRequest(KEY_ID));
    expect(res.status).toBe(200);
    // Block D / P1947: the GET success body is the caller's live per-key
    // permission scope (read/trade/withdraw) — must be private, no-store so a
    // shared cache cannot serve one key's scope to another tenant.
    expect(res.headers.get("Cache-Control")).toBe("private, no-store");
    const body = await res.json();
    expect(body.probe_error).toBe(false);
  });
});

describe("GET /api/keys/[id]/permissions — decrypt-audit cache honesty (M-0325)", () => {
  // The audit row used to assert an unconditional decrypt on every GET, but a
  // 60s Next-layer cache hit replays the prior probe and decrypts NOTHING. The
  // route now derives cache_hit from a request-local `didDecrypt` flag set only
  // when the cached body runs — exact, no wall-clock heuristic.
  it("tags cache_hit:false when the body runs (cache miss → real decrypt)", async () => {
    STATE.simulateCacheHit = false; // body runs
    const { GET } = await import("./route");
    const res = await GET(makeRequest(KEY_ID));
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.read).toBe(true);
    // No internal field leaks into the response body.
    expect(body._fetchedAt).toBeUndefined();

    await drainAuditMicrotasks();
    const audit = STATE.rpcCalls.find((c) => c.name === "log_audit_event");
    expect(audit).toBeDefined();
    expect(audit!.args.p_metadata).toMatchObject({
      route: "/api/keys/[id]/permissions",
      cache_hit: false,
    });
  });

  it("tags cache_hit:true when the cache replays without running the body (no phantom decrypt — any timing)", async () => {
    // The deterministic flag means even a hit that lands microseconds after the
    // originating miss is correctly cache_hit:true (the sub-second-burst case
    // the old timestamp heuristic mislabeled). The fetcher body must NOT run.
    STATE.simulateCacheHit = true;
    STATE.cachedHitPayload = {
      read: true,
      trade: false,
      withdraw: false,
      detected_at: "2026-04-16T00:00:00Z",
    };
    const fetchSpy = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
    const { GET } = await import("./route");
    const res = await GET(makeRequest(KEY_ID));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.read).toBe(true);

    // Proof it was a true cache hit: the upstream Python fetch never ran.
    expect(fetchSpy).not.toHaveBeenCalled();

    await drainAuditMicrotasks();
    const audit = STATE.rpcCalls.find((c) => c.name === "log_audit_event");
    expect(audit).toBeDefined();
    expect(audit!.args.p_metadata).toMatchObject({ cache_hit: true });
  });

  it("tags cache_hit:false on a stale-revalidation — the body reruns (real decrypt) even though a STALE value is served (red-team cache-detect)", async () => {
    // Next's stale-while-revalidate path: the body reruns in the background (a
    // genuine decrypt) and `didDecrypt` flips on its first synchronous statement
    // before the first await, so even though the caller gets the STALE value the
    // request is correctly counted as a decrypt — NOT a cache hit. This pins the
    // synchronous-flag-flip guarantee the production code relies on.
    STATE.simulateStaleRevalidate = true;
    STATE.stalePayload = {
      read: false,
      trade: true,
      withdraw: false,
      detected_at: "2026-04-15T00:00:00Z",
    };
    const fetchSpy = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
    const { GET } = await import("./route");
    const res = await GET(makeRequest(KEY_ID));
    expect(res.status).toBe(200);

    const body = await res.json();
    // The STALE value is what the caller receives...
    expect(body.trade).toBe(true);
    expect(body.detected_at).toBe("2026-04-15T00:00:00Z");
    // ...and the background body actually ran (its upstream decrypt fired).
    expect(fetchSpy).toHaveBeenCalled();

    await drainAuditMicrotasks();
    const audit = STATE.rpcCalls.find((c) => c.name === "log_audit_event");
    expect(audit).toBeDefined();
    // A real decrypt happened in the background → correctly NOT a cache hit.
    expect(audit!.args.p_metadata).toMatchObject({ cache_hit: false });
  });
});

/**
 * Phase 140 / SEAM-01 + SEAM-03 — the third Railway seam, and the breaker's
 * behaviour ACROSS the cache boundary it sits behind.
 *
 * The upstream call is now `resilientFetch("keys-permissions", ...)`, issued
 * from inside the cached callback. Two consequences are load-bearing and are
 * pinned here:
 *
 *   1. T-140-32 — a breaker trip must NOT become a 60s cache entry. The Next
 *      layer's window (60s) is DOUBLE the breaker cooldown (30s), so a cached
 *      error would keep answering 503 for half a minute after Railway had
 *      already recovered: the mitigation would have become the outage. The
 *      route therefore THROWS out of the callback (never returns the error as a
 *      value), which leaves no entry — asserted by re-attempting after the
 *      breaker clears.
 *   2. A cache HIT must not consult the breaker at all. The short-circuit is
 *      for calls that would otherwise cross the seam; a hit crosses nothing.
 */
const CIRCUIT_OPEN_COPY =
  "The analytics service is temporarily unavailable. Please try again in a moment.";

describe("GET /api/keys/[id]/permissions — breaker across the unstable_cache boundary", () => {
  it("cache MISS + breaker open → 503 CIRCUIT_OPEN + Retry-After, and the error is NOT cached", async () => {
    STATE.memoize = true;
    RF.breakerOpen = true;
    // Deliberately NOT 30: 30 is simultaneously BREAKER_COOLDOWN_S and
    // DEFAULT_RETRY_AFTER_S, so a hardcoded "30" would pass a 30-valued
    // assertion while forwarding nothing.
    RF.retryAfterS = 17;
    const consoleErr = vi.spyOn(console, "error").mockImplementation(() => {});
    const fetchSpy = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;

    const { GET } = await import("./route");
    const res = await GET(makeRequest(KEY_ID));

    expect(res.status).toBe(503);
    expect(res.headers.get("Retry-After")).toBe("17");
    const raw = await res.text();
    const body = JSON.parse(raw);
    expect(body.code).toBe("CIRCUIT_OPEN");
    expect(body.error).toBe(CIRCUIT_OPEN_COPY);
    // Static copy: no infra vocabulary reaches an authed client.
    expect(raw).not.toMatch(/breaker|upstash|railway|analytics service circuit/i);
    // The seam was NOT crossed.
    expect(fetchSpy).not.toHaveBeenCalled();
    // No decrypt happened, so no decrypt audit row may claim one.
    await drainAuditMicrotasks();
    expect(
      STATE.rpcCalls.filter((c) => c.name === "log_audit_event"),
    ).toHaveLength(0);

    // ── T-140-32: the failure left NO cache entry ──────────────────────────
    expect(STATE.memoStore.size).toBe(0);
    RF.breakerOpen = false;
    const res2 = await GET(makeRequest(KEY_ID));
    expect(res2.status).toBe(200);
    expect((await res2.json()).read).toBe(true);
    // The second call genuinely re-attempted the seam rather than replaying a
    // memoized failure — this is the assertion a cached-error regression fails.
    expect(RF.calls).toBe(2);
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    consoleErr.mockRestore();
  });

  it("cache HIT → the breaker is never consulted and the seam is never touched", async () => {
    STATE.simulateCacheHit = true;
    // The breaker is OPEN, and it must make no difference whatsoever: the
    // cached callback does not run, so nothing reads Redis and nothing fetches.
    RF.breakerOpen = true;
    const fetchSpy = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;

    const { GET } = await import("./route");
    const res = await GET(makeRequest(KEY_ID));

    expect(res.status).toBe(200);
    expect((await res.json()).read).toBe(true);
    expect(RF.calls).toBe(0);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(res.headers.get("Retry-After")).toBeNull();
  });

  it("routes the probe through the core byte-for-byte (path, query-free, headers, budget key)", async () => {
    const { GET } = await import("./route");
    const res = await GET(makeRequest(KEY_ID));
    expect(res.status).toBe(200);

    expect(RF.lastCall).not.toBeNull();
    expect(RF.lastCall!.budgetKey).toBe("keys-permissions");
    // Same path the raw fetch used, id still percent-encoded.
    expect(RF.lastCall!.path).toBe(
      `/internal/keys/${encodeURIComponent(KEY_ID)}/permissions`,
    );
    expect(RF.lastCall!.init.method).toBe("POST");
    expect(RF.lastCall!.init.headers).toMatchObject({
      "Content-Type": "application/json",
      "X-Internal-Token": "test-internal-token",
    });
    // The core owns the deadline — the caller must not pass its own.
    expect(RF.lastCall!.init.signal).toBeUndefined();
  });
});

/**
 * [140.3-01 / TS-05 + TS-08] Class-5 member 2 of 3 — `keys/[id]/permissions`.
 *
 * WHAT CHANGES AND WHAT DELIBERATELY DOES NOT. The `!res.ok` JSON arm inside
 * the cached callback threw `new Error(err.detail ?? \`Upstream ${res.status}\`)`.
 * On a nested `service_error` envelope `err.detail` is an OBJECT, so the Error
 * message coerced to `"[object Object]"` — `STATUS_CONTRACT.md` §2.1 records
 * this against this exact file.
 *
 * The RESPONSE is unchanged by design: the handler's downstream classifier keys
 * on message substrings (`INTERNAL_API_TOKEN`, `Upstream 5`, `ECONNREFUSED`,
 * `not configured`, `aborted`, `timeout`) and neither the old `"[object
 * Object]"` nor the new human sentence matches any of them, so both answer
 * `PROBE_FAILED` / 502. That is stated in §2.1 as "diagnostics only". Mapping
 * `RATE_LIMITED` to a throttle state, answering 429 instead of 502 and
 * forwarding `Retry-After` is **TS-34**, and it belongs to this phase's
 * response-shape plan — two changes to one block in one pass is TRAP-8.
 *
 * So the observable this plan moves is the OPERATOR LOG, and that is what is
 * asserted. Both wire contracts are driven, because a verify exercising one
 * certifies the wrong half (TS-08).
 */
describe("[140.3-01 / TS-05] the permissions proxy reads the seam error body through the ONE discriminator", () => {
  it("CONTRACT A — a `service_error` 500 (OBJECT detail): the operator log carries `body.detail.detail`, never '[object Object]'", async () => {
    // §2 envelope, and it is the body the REAL CONSTRUCTOR RETURNS rather than a
    // hand-typed approximation of one.
    //
    // ⚠️ 140.5-06 / WP-14 — WHAT THIS FIXTURE USED TO BE AND WHY IT WAS A LIE.
    // It carried `{code:"SEAM_DEGRADED", dependency:"supabase", retryable:true}`
    // at status 500. `services/error_contract._validate` REFUSES to construct
    // that: its `>=500` arm rejects a truthy `retryable` outright, because a 500
    // is SERVICE-PERMANENT (contract rule R-1) and a permanent fault that
    // advertises retryability is the self-sustaining retry loop R-1 exists to
    // stop. So this suite was vouching for a body no raise site in the service
    // can emit — a fixture cannot certify a contract it contradicts.
    //
    // The replacement is a real, executed raise site on THIS ROUTE'S OWN
    // UPSTREAM: `routers/internal.py`'s permanent 500 for a key it cannot
    // decrypt, raised by the very handler behind
    // `/internal/keys/{id}/permissions`. Its `dependency` is one of OURS, which
    // the 500 arm permits as MEMBERSHIP (a venue name there would be a 424), and
    // its sentence says what must happen instead of promising that a retry will
    // help — consistent with `retryable:false` rather than contradicting it.
    //
    // Re-runnable oracle for every literal below:
    //   cd analytics-service && python3 -c "from services.error_contract import \
    //     service_error; print(service_error(500,'KEY_UNDECRYPTABLE', \
    //     dependency='kek', retryable=False, detail='This stored key could not \
    //     be decrypted. It must be reconnected.').detail)"
    // and the R-1 refusal itself is pinned in Python by
    // `tests/test_error_contract_r1_permanent_500.py`, so the rule this fixture
    // now obeys can fail if it is ever weakened.
    //
    // ⚠️ WHY THIS SITE AND NOT `KEK_UNAVAILABLE`, WHICH WAS TRIED FIRST. The
    // sibling 500 at `internal.py`'s missing-KEK branch reads "Credential
    // encryption is not configured. …", and the handler's substring cascade
    // below keys `PROBE_BACKEND_UNAVAILABLE` on `includes("not configured")` —
    // so that real body answers a DIFFERENT code than this case is about. That
    // collision is a genuine finding, pinned in its own case further down rather
    // than avoided silently; this case keeps testing what it exists to test (the
    // nested read), on a real body whose sentence trips none of the cascade's
    // needles.
    STATE.upstreamStatus = 500;
    STATE.upstreamPayload = {
      detail: {
        code: "KEY_UNDECRYPTABLE",
        dependency: "kek",
        retryable: false,
        detail: "This stored key could not be decrypted. It must be reconnected.",
      },
    };

    const consoleErr = vi.spyOn(console, "error").mockImplementation(() => {});
    const { GET } = await import("./route");
    const res = await GET(makeRequest(KEY_ID));

    // Unchanged by design — TS-34 owns the status, not this plan.
    expect(res.status).toBe(502);
    expect((await res.json()).code).toBe("PROBE_FAILED");

    const logged = consoleErr.mock.calls
      .map((call) => call.map((arg) => String(arg)).join(" "))
      .join("\n");
    consoleErr.mockRestore();

    expect(
      logged,
      "The nested envelope must be read through `seamHumanMessage`. A bare " +
        "`err.detail ??` read builds `new Error(<object>)`, whose message " +
        "coerces to '[object Object]' — so the operator sees THAT the probe " +
        "failed and never WHY (STATUS_CONTRACT §2.1, obligation O-5).",
    ).toContain("This stored key could not be decrypted. It must be reconnected.");
    expect(logged).not.toContain("[object Object]");
    // The machine code survives on the thrown error's `cause`, so the TS-34
    // plan can branch on it without re-extracting (and so the operator can see
    // which contract answered).
    expect(logged).toContain("KEY_UNDECRYPTABLE");
  });

  it("FINDING (140.5-06): an upstream sentence containing 'not configured' is classified as OUR config fault", async () => {
    // ⚠️ THIS CASE DOCUMENTS A DEFECT. It asserts what the route DOES today, not
    // what it SHOULD do, and it exists so the behaviour is visible and
    // falsifiable instead of resting in a SUMMARY nobody re-measures. When the
    // attribution is fixed, this case must be REWRITTEN, not deleted — its
    // failure will be the signal that the fix landed.
    //
    // HOW IT WAS FOUND. It was invisible while the sibling CONTRACT A fixture
    // carried a hand-typed body the service cannot construct. Replacing that
    // fixture with a real, executed raise site from `routers/internal.py`
    // surfaced it on the first run: the missing-KEK 500's real sentence is
    // "Credential encryption is not configured. This needs an operator, not a
    // retry.", and the handler's cascade keys
    //   isConfigError = … || rawMessage.includes("not configured")
    // → `PROBE_BACKEND_UNAVAILABLE` + "Could not reach the permissions service."
    //
    // WHY IT IS WRONG. That needle was written for the route's OWN env-var fault
    // ("INTERNAL_API_TOKEN is not configured on the Next layer."), a Next-layer
    // condition. Here the upstream WAS reached and answered precisely — a
    // permanent, operator-actionable KEK gap — and the user is told we could not
    // reach the service. The needle matches the UPSTREAM's prose, so any upstream
    // sentence that happens to contain the phrase is re-attributed to our own
    // configuration. The machine `code` on `cause` (`KEK_UNAVAILABLE`) is the
    // discriminator that would make this exact, and it is already carried — the
    // cascade simply does not consult it.
    STATE.upstreamStatus = 500;
    STATE.upstreamPayload = {
      detail: {
        code: "KEK_UNAVAILABLE",
        dependency: "kek",
        retryable: false,
        detail:
          "Credential encryption is not configured. This needs an operator, not a retry.",
      },
    };

    const consoleErr = vi.spyOn(console, "error").mockImplementation(() => {});
    const { GET } = await import("./route");
    const res = await GET(makeRequest(KEY_ID));
    const body = await res.json();
    consoleErr.mockRestore();

    expect(res.status).toBe(502);
    expect(
      body.code,
      "OBSERVED, not endorsed: a real upstream KEK fault is reported as though " +
        "OUR layer were misconfigured, because the cascade greps the upstream's " +
        "sentence instead of reading the machine code already on `cause`.",
    ).toBe("PROBE_BACKEND_UNAVAILABLE");
    expect(body.error).toBe(
      "Could not reach the permissions service. Try again shortly.",
    );
  });

  it("CONTRACT B — a 429 with a SCALAR `detail`: the scalar passes through the discriminator unchanged (TS-07 is negative)", async () => {
    // The SCALAR-`detail` shape (STATUS_CONTRACT §2.1's third 429 body:
    // `{"detail": "<string>"}`). `seamHumanMessage` returns a scalar `detail`
    // unchanged, and `route.ts` documents that as a NEGATIVE obligation beside
    // its `seamErrorCode`/`seamHumanMessage` call: this path needed no
    // TypeScript change and must not have received one.
    //
    // ⚠️ 140.5-06 / WP-14 — WHAT THIS FIXTURE USED TO BE AND WHY IT CANNOT
    // ARRIVE HERE. It carried the FLAT app-global envelope
    // (`{ok, code, human_message, detail, correlation_id, recoverable,
    // retry_after_seconds}`), described as "the app-global `RateLimitExceeded`
    // shape". That handler cannot fire for this route. **Predicate, re-runnable
    // and measured at 140.5-06 rather than assumed:** the upstream this route
    // calls is `@router.post("/keys/{key_id}/permissions")` in
    // `routers/internal.py`, which carries NO `@limiter.limit(...)` decorator,
    // and the process's single canonical `Limiter` in `services/rate_limit.py`
    // is constructed as `Limiter(key_func=default_platform_key)` with NO
    // `default_limits`. slowapi therefore never raises `RateLimitExceeded` on
    // this path, so `main.py`'s app-global 429 JSONResponse is UNREACHABLE from
    // here — and its literals never matched the fixture's either.
    //
    // Only two 429 bodies can reach this route: our own per-key throttle's
    // NESTED envelope (CONTRACT C below, which is the shape this file's old note
    // said was uncovered) and whatever a throttle imposed ABOVE our service
    // emits. This case is the latter in its JSON form, so the sentence is
    // deliberately NOT one of our service's own copy strings.
    STATE.upstreamStatus = 429;
    STATE.upstreamPayload = {
      detail: "Rate limit exceeded for this client.",
    };

    const consoleErr = vi.spyOn(console, "error").mockImplementation(() => {});
    const { GET } = await import("./route");
    const res = await GET(makeRequest(KEY_ID));

    // 140.3-09 / TS-34 — UPDATED FROM 502 BY THE PLAN THAT OWNS THIS STATUS.
    // The sibling contract-A case carries the note "Unchanged by design — TS-34
    // owns the status, not this plan"; this is that plan. A one-minute throttle
    // used to answer 502 `PROBE_FAILED`, i.e. "the upstream is broken", with
    // the upstream's wait discarded. It now answers 429 — "you are being
    // throttled" — which is a different and truthful claim about whose fault it
    // is. The assertion below was NOT weakened: it moved to the new value.
    expect(res.status).toBe(429);
    expect((await res.json()).code).toBe("PROBE_RATE_LIMITED");

    const logged = consoleErr.mock.calls
      .map((call) => call.map((arg) => String(arg)).join(" "))
      .join("\n");
    consoleErr.mockRestore();

    expect(
      logged,
      "A scalar `detail` must reach the operator log VERBATIM. If this sentence " +
        "is transformed, truncated or replaced, the scalar path was 'fixed' and " +
        "TS-07's NEGATIVE obligation was violated.",
    ).toContain("Rate limit exceeded for this client.");
    expect(logged).not.toContain("[object Object]");
  });

  it("CONTRACT C — a `service_error` 429 (OBJECT detail): the route's OWN per-key throttle, at 429 and not 500", async () => {
    // 140.5-06 / WP-14 — THE BODY NO TEST IN THIS REPO EXERCISED.
    //
    // This file used to say, in CONTRACT B's own comment, that the per-key
    // throttle "is the NESTED shape at a 429 status" and that "Contract A above
    // is what covers that body structurally". Contract A is at status **500**.
    // Structural coverage at one status is not coverage at another: the route
    // branches on the status BEFORE it reads the body (`route.ts`'s
    // `seamFailure?.status === 429` arm sits above the substring cascade), so
    // the nested read and the 429 arm had never been exercised together. That
    // hole is what this case closes.
    //
    // Every literal is the REAL constructor's output, not a hand-typed guess:
    //   cd analytics-service && python3 -c "from services.error_contract import \
    //     service_error; e = service_error(429,'RATE_LIMITED',retryable=True, \
    //     retry_after=60, detail='Too many permission probes for this key. Try \
    //     again in a moment.'); print(e.detail, e.headers)"
    // → {'code': 'RATE_LIMITED', 'dependency': None, 'retryable': True,
    //    'detail': 'Too many permission probes for this key. Try again in a
    //    moment.'}  {'Retry-After': '60'}
    // which is `routers/internal.py`'s throttle verbatim (its `retry_after` is
    // `int(_RATE_LIMIT_WINDOW_S)`, and the builder — not the raise site — stamps
    // the header). `dependency` is null BY CONTRACT: a 429 is a throttle we
    // imposed ourselves, so naming a dependency would mint a breaker key for
    // our own limiter.
    //
    // The Python side of this pairing is pinned by
    // `test_status_contract_exchange_internal.py`'s
    // `test_internal_throttle_429_carries_the_service_envelope`, whose
    // `_wire_envelope` helper asserts the envelope really is nested at
    // `body.detail`. That test is the oracle this fixture leans on, and it reds
    // if the throttle is ever flattened.
    STATE.upstreamStatus = 429;
    STATE.upstreamHeaders = { "retry-after": "60" };
    STATE.upstreamPayload = {
      detail: {
        code: "RATE_LIMITED",
        dependency: null,
        retryable: true,
        detail: "Too many permission probes for this key. Try again in a moment.",
      },
    };

    const consoleErr = vi.spyOn(console, "error").mockImplementation(() => {});
    const { GET } = await import("./route");
    const res = await GET(makeRequest(KEY_ID));

    expect(res.status).toBe(429);
    expect((await res.json()).code).toBe("PROBE_RATE_LIMITED");
    expect(
      res.headers.get("Retry-After"),
      "The throttle's own window must be re-published, so the caller waits " +
        "exactly as long as our limiter asked.",
    ).toBe("60");

    const logged = consoleErr.mock.calls
      .map((call) => call.map((arg) => String(arg)).join(" "))
      .join("\n");
    consoleErr.mockRestore();

    expect(
      logged,
      "The NESTED envelope must be read through `seamHumanMessage` at 429 too. " +
        "A bare `err.detail ??` read builds `new Error(<object>)`, whose message " +
        "coerces to '[object Object]' — so the operator sees THAT the probe was " +
        "throttled and never by WHICH limiter.",
    ).toContain("Too many permission probes for this key. Try again in a moment.");
    expect(logged).not.toContain("[object Object]");
    expect(
      logged,
      "The machine code lives at `body.detail.code` on this shape. Reading it " +
        "from the TOP level — where the unreachable flat envelope kept it — " +
        "yields nothing and the operator cannot tell OUR throttle from an " +
        "edge/WAF one.",
    ).toContain("RATE_LIMITED");
  });

  // ===========================================================================
  // 140.3-09 / TS-34 / SEAMUX-06 — a throttle answers 429 with the UPSTREAM
  // wait forwarded, instead of a hardcoded 502 with the wait discarded.
  //
  // Both production 429 producers were read at source before these fixtures
  // were written: `analytics-service/main.py`'s app-global RateLimitExceeded
  // handler (`headers={"Retry-After": str(retry_after)}`) and this route's own
  // per-key throttle at `routers/internal.py` (PYAPIFIX2-03), whose
  // `service_error(..., retry_after=...)` sets the same header. So the header
  // this route now forwards is on the wire at BOTH shapes, not a hypothetical.
  // ===========================================================================
  describe("[140.3-09 / TS-34] an upstream throttle answers 429 with the wait forwarded", () => {
    it("a /internal 429 carrying `Retry-After: 60` answers 429 with that value — not 502", async () => {
      // THE criterion. Deleting the forward, or restoring the hardcoded 502,
      // must fail this case.
      // 140.5-06: the NESTED envelope, because `Retry-After: 60` on this route
      // IS our per-key throttle's signature — `internal.py` advertises
      // `int(_RATE_LIMIT_WINDOW_S)`, which is 60. See CONTRACT C for the
      // executed-constructor oracle and for why the flat body this fixture used
      // to carry cannot arrive on this path at all.
      STATE.upstreamStatus = 429;
      STATE.upstreamHeaders = { "retry-after": "60" };
      STATE.upstreamPayload = {
        detail: {
          code: "RATE_LIMITED",
          dependency: null,
          retryable: true,
          detail:
            "Too many permission probes for this key. Try again in a moment.",
        },
      };

      const consoleErr = vi.spyOn(console, "error").mockImplementation(() => {});
      const { GET } = await import("./route");
      const res = await GET(makeRequest(KEY_ID));
      consoleErr.mockRestore();

      expect(
        res.status,
        "A throttle answering 502 tells the user our service is broken and " +
          "offers no wait. 429 says 'you are being throttled', which is both " +
          "true and actionable.",
      ).toBe(429);
      expect(
        res.headers.get("Retry-After"),
        "The UPSTREAM's own wait must be re-published verbatim, in seconds, " +
          "so the caller waits exactly as long as the upstream asked.",
      ).toBe("60");
      expect((await res.json()).code).toBe("PROBE_RATE_LIMITED");
      // Still no-store — the throttle arm must not lose the cache posture.
      expect(res.headers.get("Cache-Control")).toBe("private, no-store");
    });

    it("forwards an HTTP-DATE form `Retry-After` as a finite second count", async () => {
      // A proxy or CDN between us and Railway may legitimately rewrite the
      // header into the RFC 9110 date form. `Number(header)` is NaN for it; the
      // ONE parser resolves it against the response's own Date header.
      STATE.upstreamStatus = 429;
      STATE.upstreamHeaders = {
        date: "Wed, 21 Oct 2026 07:28:00 GMT",
        "retry-after": "Wed, 21 Oct 2026 07:30:00 GMT", // +120s
      };
      // 140.5-06: a proxy that rewrites the header sits ABOVE our service, so
      // the body is NOT our envelope — the scalar-`detail` shape, with a
      // sentence that is deliberately none of our copy strings. The flat
      // `{ok, code, human_message, …}` body this fixture used to carry belongs
      // to `main.py`'s app-global handler, which cannot fire on this route (the
      // predicate is in CONTRACT B).
      STATE.upstreamPayload = {
        detail: "Rate limit exceeded for this client.",
      };

      const consoleErr = vi.spyOn(console, "error").mockImplementation(() => {});
      const { GET } = await import("./route");
      const res = await GET(makeRequest(KEY_ID));
      consoleErr.mockRestore();

      expect(res.status).toBe(429);
      expect(res.headers.get("Retry-After")).toBe("120");
      expect(res.headers.get("Retry-After")).not.toContain("NaN");
    });

    it("TRAP-3: a 429 with NO `Retry-After` answers 429 and names NO duration", async () => {
      // Absence must never become a fabricated wait. No header in, no header
      // out — and no sentence claiming a time nobody stated.
      // 140.5-06: a 429 carrying NO wait cannot be one of OURS — both of this
      // service's 429 producers stamp the header (`main.py` passes
      // `headers={"Retry-After": …}`; `internal.py`'s throttle lets
      // `service_error` stamp it from `retry_after`). So the header-absence case
      // necessarily models a throttle above our service, and the body is the
      // scalar-`detail` shape rather than an envelope of ours with its own
      // header inexplicably missing.
      STATE.upstreamStatus = 429;
      STATE.upstreamHeaders = {};
      STATE.upstreamPayload = {
        detail: "Rate limit exceeded for this client.",
      };

      const consoleErr = vi.spyOn(console, "error").mockImplementation(() => {});
      const { GET } = await import("./route");
      const res = await GET(makeRequest(KEY_ID));
      consoleErr.mockRestore();

      expect(res.status).toBe(429);
      expect(res.headers.get("Retry-After")).toBeNull();
      const body = await res.json();
      expect(body.code).toBe("PROBE_RATE_LIMITED");
      // Hand-typed: the route's own existing 429 sentence, reused rather than
      // authored. It must not acquire a duration it cannot substantiate.
      expect(body.error).toBe("Too many requests");
      expect(body.error).not.toMatch(/\d/);
    });

    it("a 429 with a NON-JSON body (edge/WAF) still answers 429 with the wait", async () => {
      // A throttle imposed above our service carries no machine code at all.
      // The upstream STATUS is the gate precisely so this case still works —
      // a code-only gate would drop it back onto the substring cascade.
      STATE.upstreamStatus = 429;
      STATE.upstreamContentType = "text/html";
      STATE.upstreamHeaders = { "retry-after": "15" };

      const consoleErr = vi.spyOn(console, "error").mockImplementation(() => {});
      const { GET } = await import("./route");
      const res = await GET(makeRequest(KEY_ID));
      consoleErr.mockRestore();

      expect(res.status).toBe(429);
      expect(res.headers.get("Retry-After")).toBe("15");
      expect((await res.json()).code).toBe("PROBE_RATE_LIMITED");
    });

    it("the throttle arm sits ABOVE the cascade — a 429 whose sentence says 'timeout' is not our timeout", async () => {
      // Ordering proof. The cascade's `includes("timeout")` branch would claim
      // OUR probe timed out, which is a false statement about whose fault the
      // failure is, and it would lose the wait.
      // 140.5-06: the scalar-`detail` shape, because the sentence is the point of
      // this case and NONE of our service's own 429 copy contains the word
      // "timeout" — a body that does is by definition not ours. A throttle
      // imposed above our service may word its page however it likes, which is
      // exactly why the arm must gate on the STATUS and not on the prose.
      STATE.upstreamStatus = 429;
      STATE.upstreamHeaders = { "retry-after": "45" };
      STATE.upstreamPayload = {
        detail: "Throttled after a timeout storm from this client.",
      };

      const consoleErr = vi.spyOn(console, "error").mockImplementation(() => {});
      const { GET } = await import("./route");
      const res = await GET(makeRequest(KEY_ID));
      consoleErr.mockRestore();

      expect(res.status).toBe(429);
      expect((await res.json()).code).toBe("PROBE_RATE_LIMITED");
    });

    it("ANTI-REGRESSION: a 503 carrying `Retry-After` is NOT a throttle — it keeps its 502 upstream-fault answer", async () => {
      // The gate is the status 429, not "a wait arrived". A 5xx is an upstream
      // FAULT even when it advertises a cooldown, and mislabelling it as a
      // throttle would tell the user they had made too many requests.
      STATE.upstreamStatus = 503;
      STATE.upstreamHeaders = { "retry-after": "60" };
      STATE.upstreamPayload = {
        ok: false,
        code: "SEAM_DEGRADED",
        human_message: "The analytics store is not responding. Try again shortly.",
        detail: "downstream down",
        correlation_id: "cid-503",
        recoverable: true,
      };

      const consoleErr = vi.spyOn(console, "error").mockImplementation(() => {});
      const { GET } = await import("./route");
      const res = await GET(makeRequest(KEY_ID));
      consoleErr.mockRestore();

      expect(res.status).toBe(502);
      // PROBE_FAILED, not PROBE_BACKEND_UNAVAILABLE: this body HAS a readable
      // human sentence, so the thrown message is that sentence rather than the
      // `Upstream 5…` fallback the config branch keys on. Measured against the
      // untouched tree, not assumed — this route's existing
      // `PROBE_BACKEND_UNAVAILABLE` case is the one whose body is unreadable.
      expect((await res.json()).code).toBe("PROBE_FAILED");
      expect(
        res.headers.get("Retry-After"),
        "A 5xx is an upstream FAULT even when it advertises a cooldown. " +
          "Forwarding the wait here would dress a fault as a throttle.",
      ).toBeNull();
    });

    it("PRESERVE (NOT a TS-34 deliverable): a CircuitOpenError still answers 503 with Retry-After from retryAfterS", async () => {
      // This arm was ALREADY correct before this plan. The case exists only to
      // prove the throttle work did not disturb it — it counts toward nothing.
      RF.breakerOpen = true;
      RF.retryAfterS = 17;

      const consoleErr = vi.spyOn(console, "error").mockImplementation(() => {});
      const { GET } = await import("./route");
      const res = await GET(makeRequest(KEY_ID));
      consoleErr.mockRestore();

      expect(res.status).toBe(503);
      expect(res.headers.get("Retry-After")).toBe("17");
      expect((await res.json()).code).toBe("CIRCUIT_OPEN");
    });

    it("ANTI-REGRESSION: a config fault and a timeout keep their existing codes and statuses", async () => {
      // The substring cascade is deliberately KEPT as the fallback for
      // genuinely uncoded faults, and this route's private PROBE_* vocabulary
      // is deliberately NOT replaced by the shared classifier.
      const consoleErr = vi.spyOn(console, "error").mockImplementation(() => {});

      // An UNREADABLE 5xx body — the only shape that reaches the `Upstream 5…`
      // fallback the config branch keys on.
      STATE.upstreamStatus = 500;
      STATE.upstreamPayload = { unexpected: "shape" };
      const { GET } = await import("./route");
      const backendRes = await GET(makeRequest(KEY_ID));
      expect(backendRes.status).toBe(502);
      expect((await backendRes.json()).code).toBe("PROBE_BACKEND_UNAVAILABLE");

      STATE.upstreamStatus = 200;
      STATE.upstreamThrow = true;
      const throwRes = await GET(makeRequest(KEY_ID));
      expect(throwRes.status).toBe(502);
      // "ECONNREFUSED upstream down" — the config-error branch, unchanged.
      expect((await throwRes.json()).code).toBe("PROBE_BACKEND_UNAVAILABLE");

      consoleErr.mockRestore();
    });

    it("ANTI-REGRESSION: 140.3-03's 2xx fail-CLOSED still answers 502 PROBE_FAILED", async () => {
      // The security fail-closed message was deliberately engineered by
      // 140.3-03 to match NONE of this route's classifier substrings so it
      // lands on the generic PROBE_FAILED 502. Routing this route through the
      // shared classifier would have turned it into a terminal UNKNOWN 500 —
      // measured, and the reason the vocabularies stay separate.
      STATE.upstreamStatus = 200;
      STATE.upstreamPayload = {};

      const consoleErr = vi.spyOn(console, "error").mockImplementation(() => {});
      const { GET } = await import("./route");
      const res = await GET(makeRequest(KEY_ID));
      consoleErr.mockRestore();

      expect(res.status).toBe(502);
      expect((await res.json()).code).toBe("PROBE_FAILED");
    });
  });

  it("a body with no readable `detail` still throws the pre-plan `Upstream <status>` message", async () => {
    // Load-bearing: `Upstream 5…` is exactly what the downstream classifier
    // keys `PROBE_BACKEND_UNAVAILABLE` on. Losing the fallback would silently
    // re-class every unrecognised upstream body.
    STATE.upstreamStatus = 503;
    STATE.upstreamPayload = { unexpected: "shape" };

    const consoleErr = vi.spyOn(console, "error").mockImplementation(() => {});
    const { GET } = await import("./route");
    const res = await GET(makeRequest(KEY_ID));
    const body = await res.json();

    const logged = consoleErr.mock.calls
      .map((call) => call.map((arg) => String(arg)).join(" "))
      .join("\n");
    consoleErr.mockRestore();

    expect(logged).toContain("Upstream 503");
    expect(res.status).toBe(502);
    expect(body.code).toBe("PROBE_BACKEND_UNAVAILABLE");
  });
});

/**
 * [140.3-03 / SEAMUX-07] Member 2 of 2 of the unchecked-cast class — and the
 * one that CACHES its verdict.
 *
 * THE DEFECT, and why it is strictly worse here than at `finalize-wizard`. The
 * cached callback did `return (await res.json()) as PermissionPayload;` over the
 * SAME upstream endpoint the wizard's publish gate probes. A cast checks
 * nothing at runtime, so a 2xx `{}` produced `{read: undefined, trade:
 * undefined, withdraw: undefined}` — which `KeyPermissionBadge` renders as a
 * live security claim about a money-bearing key ("Trade ✗", struck through,
 * because `undefined` is falsy). And because the fork memoizes whatever the
 * callback RESOLVES to, that unvalidated verdict was then replayed for 60
 * seconds to callers that never saw the body: it survives the request that
 * produced it.
 *
 * So the no-cache property is asserted BEHAVIOURALLY, against the faithful
 * memoizing branch of the `next/cache` double (a rejection leaves NO entry, as
 * the real fork does): a second call after a rejected first must RE-HIT the
 * upstream, not replay a memoized rejection-as-success.
 *
 * The fix is the same schema and the same fail-closed posture as member 1 —
 * ONE pattern for the class. It fails closed by THROWING out of the cached
 * callback, which is the mechanism this file already relies on for the breaker
 * (T-140-32) and for a body-read abort.
 *
 * ⚠️ Deliberately NOT touched here: the `!res.ok` arm and its substring cascade
 * (TS-34 / plan 140.3-09) and `CIRCUIT_OPEN_COPY` (plan 140.3-04).
 */
describe("[140.3-03 / SEAMUX-07] the permissions proxy fails CLOSED on an unreadable 2xx", () => {
  // Hand-typed from the route's existing probe-failure arm — not imported.
  const PROBE_FAILED_ENVELOPE = {
    error: "Could not check key scopes. Try again.",
    code: "PROBE_FAILED",
  };

  it("a 2xx `{}` does not render a scope verdict", async () => {
    STATE.upstreamStatus = 200;
    STATE.upstreamPayload = {};

    const consoleErr = vi.spyOn(console, "error").mockImplementation(() => {});
    const { GET } = await import("./route");
    const res = await GET(makeRequest(KEY_ID));
    consoleErr.mockRestore();

    expect(
      res.status,
      "An empty 2xx used to reach the badge as {read: undefined, trade: " +
        "undefined, withdraw: undefined}, which renders as a confident " +
        "read-only verdict about a key whose scopes are unknown.",
    ).toBe(502);
    const body = await res.json();
    expect(body).toEqual(PROBE_FAILED_ENVELOPE);
    // No scope verdict of ANY kind reaches the caller.
    expect(body.read).toBeUndefined();
    expect(body.trade).toBeUndefined();
    expect(body.withdraw).toBeUndefined();
  });

  it("a 2xx with `trade` RENAMED does not render a scope verdict", async () => {
    STATE.upstreamStatus = 200;
    STATE.upstreamPayload = {
      read: true,
      can_trade: true,
      withdraw: false,
      detected_at: "2026-07-27T00:00:00Z",
    };

    const consoleErr = vi.spyOn(console, "error").mockImplementation(() => {});
    const { GET } = await import("./route");
    const res = await GET(makeRequest(KEY_ID));
    consoleErr.mockRestore();

    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body).toEqual(PROBE_FAILED_ENVELOPE);
    expect(body.trade).toBeUndefined();
  });

  it("NO-CACHE: a rejected body never populates the 60-second cache — the next call re-hits the upstream", async () => {
    // The property that makes this member worse than its sibling. A verdict
    // accepted once is replayed for 60s to callers that never saw the body, so
    // an unvalidated one must not be written at all. Asserted behaviourally
    // against the memoizing double, which (like the real fork) writes the entry
    // only AFTER the callback RESOLVES.
    STATE.memoize = true;
    STATE.upstreamStatus = 200;
    STATE.upstreamPayload = {};
    const fetchSpy = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;

    const consoleErr = vi.spyOn(console, "error").mockImplementation(() => {});
    const { GET } = await import("./route");
    const res = await GET(makeRequest(KEY_ID));
    expect(res.status).toBe(502);

    expect(
      STATE.memoStore.size,
      "A rejected body must leave NO cache entry. If it is memoized, every " +
        "caller for the next 60 seconds is served an unvalidated scope " +
        "verdict for a key none of them probed.",
    ).toBe(0);

    // The upstream recovers; the very next call must genuinely re-attempt.
    STATE.upstreamPayload = {
      read: true,
      trade: false,
      withdraw: false,
      probe_error: false,
      detected_at: "2026-07-27T00:00:00Z",
    };
    const res2 = await GET(makeRequest(KEY_ID));
    consoleErr.mockRestore();

    expect(res2.status).toBe(200);
    expect((await res2.json()).read).toBe(true);
    expect(RF.calls).toBe(2);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it("ANTI-REGRESSION: a well-formed 2xx still renders a verdict AND is still cached", async () => {
    // A gate that refuses everything is an outage, and a fix that disables the
    // 60s window would flood the internal endpoint on every badge render.
    STATE.memoize = true;
    STATE.upstreamStatus = 200;
    STATE.upstreamPayload = {
      read: true,
      trade: false,
      withdraw: false,
      probe_error: false,
      detected_at: "2026-07-27T00:00:00Z",
    };
    const fetchSpy = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;

    const { GET } = await import("./route");
    const res = await GET(makeRequest(KEY_ID));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.read).toBe(true);
    expect(body.trade).toBe(false);
    expect(body.withdraw).toBe(false);
    expect(body.probe_error).toBe(false);
    // The badge renders this — it must survive the parse, not be stripped.
    expect(body.detected_at).toBe("2026-07-27T00:00:00Z");

    expect(STATE.memoStore.size).toBe(1);
    const res2 = await GET(makeRequest(KEY_ID));
    expect(res2.status).toBe(200);
    expect((await res2.json()).read).toBe(true);
    // Replayed from the cache: the seam was crossed exactly once.
    expect(RF.calls).toBe(1);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });
});

/**
 * 140.3-13a / SEAMUX-08 — this route captures to Sentry, under the ONE policy
 * written out in full in `src/app/api/admin/match/eval/route.ts`.
 *
 * ⚠️ THE BASELINE WAS ZERO here too. This route is one of the nine of fifteen
 * seam routes that captured nothing while the wizard copy claimed a team had
 * been notified. It is also the route whose failures are the least visible
 * anywhere else: the scope badge fails quietly beside a money-bearing key.
 *
 * Its TWO typed arms above the terminal one capture NOTHING and both negatives
 * are pinned, each alongside a POSITIVE assertion that the arm actually ran.
 */
describe("[140.3-13a / SEAMUX-08] GET /api/keys/[id]/permissions — Sentry capture policy", () => {
  /** A 40-char internal token, the shape INTERNAL_API_TOKEN actually carries. */
  const INTERNAL_TOKEN = "int_9f3a1c7e5b2d84a6f0c1e3d5b7a9f2c48e6d0b1a";

  beforeEach(() => {
    sentryState.captured.length = 0;
    process.env.INTERNAL_API_TOKEN = INTERNAL_TOKEN;
  });

  afterEach(() => {
    process.env.INTERNAL_API_TOKEN = "test-internal-token";
  });

  async function nextCapture() {
    await vi.waitFor(() =>
      expect(
        sentryState.captured.length,
        "nothing was captured — the terminal arm is the only place this route's unclassified proxy failures are ever reported",
      ).toBeGreaterThan(0),
    );
    return sentryState.captured[sentryState.captured.length - 1];
  }

  async function expectNoCapture() {
    await new Promise((r) => setTimeout(r, 0));
    expect(sentryState.captured).toEqual([]);
  }

  /** Re-stub the upstream so it throws a transport error carrying the token. */
  function stubTransportFailure(message: string) {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error(message);
      }),
    );
  }

  it("POSITIVE: an unclassified proxy failure IS captured, tagged and carrying the key id", async () => {
    stubTransportFailure(
      `connect ECONNREFUSED 10.0.0.5:8002 (X-Internal-Token: ${INTERNAL_TOKEN})`,
    );
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { GET } = await import("./route");
    const res = await GET(makeRequest(KEY_ID));
    expect(res.status).toBe(502);

    const { options } = await nextCapture();
    expect(options.tags?.surface).toBe("keys-permissions");
    expect(options.tags?.step).toBe("upstream-proxy");
    // `keyId` is an opaque row id, deliberately kept because it is what makes
    // the failure triageable — the same reason the console line keeps it.
    expect(options.extra?.key_id).toBe(KEY_ID);
    errSpy.mockRestore();
  });

  it("TRAP-1 BOTH DIRECTIONS: the captured payload loses the token and KEEPS the syscall token", async () => {
    stubTransportFailure(
      `connect ECONNREFUSED 10.0.0.5:8002 (X-Internal-Token: ${INTERNAL_TOKEN})`,
    );
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { GET } = await import("./route");
    await GET(makeRequest(KEY_ID));

    const message = ((await nextCapture()).err as Error).message;
    expect(
      message,
      "a live INTERNAL_API_TOKEN was dispatched to Sentry — undici inlines outgoing headers into err.message (TRAP-1)",
    ).not.toContain(INTERNAL_TOKEN);
    expect(
      message,
      "the syscall token was eaten by the redactor — over-redaction replaces one incident with two",
    ).toContain("ECONNREFUSED");
    errSpy.mockRestore();
  });

  it("NEGATIVE: a breaker short-circuit is NEVER captured", async () => {
    RF.breakerOpen = true;
    RF.retryAfterS = 45;
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { GET } = await import("./route");
    const res = await GET(makeRequest(KEY_ID));
    // POSITIVE half: the breaker arm really ran.
    expect(res.status).toBe(503);
    expect(res.headers.get("Retry-After")).toBe("45");
    await expectNoCapture();
    errSpy.mockRestore();
  });

  it("NEGATIVE: an upstream 429 throttle is NEVER captured — the limiter working is not a fault", async () => {
    // 140.5-06: this case names the per-key throttle, so it now carries that
    // throttle's REAL nested envelope instead of a hybrid that put `code` at the
    // top level (where nothing reads it on this shape) beside a scalar `detail`.
    // See CONTRACT C for the executed-constructor oracle.
    STATE.upstreamStatus = 429;
    STATE.upstreamHeaders = { "retry-after": "60" };
    STATE.upstreamPayload = {
      detail: {
        code: "RATE_LIMITED",
        dependency: null,
        retryable: true,
        detail: "Too many permission probes for this key. Try again in a moment.",
      },
    };
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { GET } = await import("./route");
    const res = await GET(makeRequest(KEY_ID));
    // POSITIVE half: 140.3-09's throttle arm really ran, so the zero below is
    // about the policy rather than about the request never reaching a catch.
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBe("60");
    await expectNoCapture();
    errSpy.mockRestore();
  });

  it("NEGATIVE: a caller fault (not the caller's key) is NEVER captured", async () => {
    STATE.keyRow = { id: KEY_ID, user_id: "99999999-9999-4999-8999-999999999999" };
    const { GET } = await import("./route");
    const res = await GET(makeRequest(KEY_ID));
    expect(res.status).toBe(403);
    await expectNoCapture();
  });

  it("POSITIVE COUNTERPART: an upstream 5xx DOES reach the terminal arm and IS captured", async () => {
    STATE.upstreamStatus = 503;
    STATE.upstreamPayload = { detail: "railway is down" };
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { GET } = await import("./route");
    const res = await GET(makeRequest(KEY_ID));
    expect(res.status).toBe(502);
    expect((await nextCapture()).options.tags?.surface).toBe("keys-permissions");
    errSpy.mockRestore();
  });

  it("the capture never replaces the operator log line — both channels fire", async () => {
    stubTransportFailure("ECONNREFUSED");
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { GET } = await import("./route");
    await GET(makeRequest(KEY_ID));
    await nextCapture();
    expect(errSpy).toHaveBeenCalled();
    errSpy.mockRestore();
  });
});
