import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";
import type { WizardErrorCode } from "@/lib/wizardErrors";

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

const USER = { id: "00000000-0000-0000-0000-000000000001" };
const KEY_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

const STATE = vi.hoisted(() => ({
  keyRow: null as { id: string; user_id: string } | null,
  rpcCalls: [] as Array<{ name: string; args: Record<string, unknown> }>,
  rateLimitOk: true as boolean,
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

vi.mock("@/lib/ratelimit", () => ({
  userActionLimiter: null,
  checkLimit: async () => ({
    success: STATE.rateLimitOk,
    retryAfter: STATE.rateLimitOk ? 0 : 60,
  }),
}));

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
          get: (h: string) =>
            h.toLowerCase() === "content-type" ? "application/json" : null,
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

/**
 * Phase 140 review / D-6 — NEVER CACHE AN UNVALIDATED PAYLOAD.
 *
 * The body was taken as `(await res.json()) as PermissionPayload` — a
 * compile-time assertion with no runtime force — and then cached for 60s. On
 * field drift every property reads `undefined`, the badge's `read === true`
 * test is false, and `KeyPermissionBadge` tells the user "No read permission
 * detected — the key may have been revoked" about a perfectly healthy
 * money-bearing key. Cached, so "Re-check" repeats the libel for a minute, and
 * the manager's rational response is to revoke a key that was never broken.
 *
 * `analytics-client` has validated every response with Zod since it was
 * written; this third seam was the one that did not.
 */
describe("GET /api/keys/[id]/permissions — D-6 upstream contract validation", () => {
  it.each([
    {
      label: "a renamed field (read -> can_read)",
      payload: {
        can_read: true,
        trade: false,
        withdraw: false,
        detected_at: "2026-04-16T00:00:00Z",
      },
    },
    {
      label: "a dropped field",
      payload: { read: true, trade: false, detected_at: "2026-04-16T00:00:00Z" },
    },
    {
      label: "a retyped field (boolean -> string)",
      payload: {
        read: "true",
        trade: false,
        withdraw: false,
        detected_at: "2026-04-16T00:00:00Z",
      },
    },
    {
      label: "a null body",
      payload: null,
    },
  ])("fails loudly on $label rather than defaming the key", async ({ payload }) => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    STATE.upstreamPayload = payload as never;
    const { GET } = await import("./route");

    const res = await GET(makeRequest(KEY_ID));

    // An honest error the badge renders as an unknown state — NOT a confident
    // 200 asserting the key lost its read scope.
    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.read).toBeUndefined();

    // Loud: contract drift on a money-bearing surface is an engineering event.
    expect(
      errorSpy.mock.calls.some((c: unknown[]) =>
        String(c[0]).includes("contract violation"),
      ),
    ).toBe(true);
    errorSpy.mockRestore();
  });

  it("still accepts an UNKNOWN EXTRA field — additive drift must not break the badge", async () => {
    // The fix must not become its own outage: the Python service adding a new
    // field is routine and must keep working.
    STATE.upstreamPayload = {
      read: true,
      trade: false,
      withdraw: false,
      probe_error: false,
      detected_at: "2026-04-16T00:00:00Z",
      newly_added_field: "ignore me",
    } as never;
    const { GET } = await import("./route");

    const res = await GET(makeRequest(KEY_ID));
    expect(res.status).toBe(200);
    expect((await res.json()).read).toBe(true);
  });

  it("still accepts a payload with probe_error absent (a real Python arm)", async () => {
    STATE.upstreamPayload = {
      read: true,
      trade: false,
      withdraw: false,
      detected_at: "2026-04-16T00:00:00Z",
    } as never;
    const { GET } = await import("./route");

    const res = await GET(makeRequest(KEY_ID));
    expect(res.status).toBe(200);
    expect((await res.json()).read).toBe(true);
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
  // Phase 140 review (WR-01): the wire code is SERVICE_UNAVAILABLE_RETRY, a
  // real WizardErrorCode. It was "CIRCUIT_OPEN", which no wizard surface can
  // render, so every consumer fell through to the UNKNOWN dead end.
  it("cache MISS + breaker open → 503 SERVICE_UNAVAILABLE_RETRY + Retry-After, and the error is NOT cached", async () => {
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
    const expectedCode: WizardErrorCode = "SERVICE_UNAVAILABLE_RETRY";
    expect(body.code).toBe(expectedCode);
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
