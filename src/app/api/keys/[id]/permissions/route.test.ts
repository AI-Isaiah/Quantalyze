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
}));

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
  unstable_cache: (fn: () => Promise<unknown>) => {
    return async () => {
      if (STATE.simulateCacheHit) return STATE.cachedHitPayload;
      if (STATE.simulateStaleRevalidate) {
        // Stale-while-revalidate: kick off the body (background revalidation —
        // its synchronous prefix flips didDecrypt before the first await) but
        // return the prior STALE value immediately, as Next does.
        void fn().catch(() => {});
        return STATE.stalePayload;
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
