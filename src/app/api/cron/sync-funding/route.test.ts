import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import type { NextRequest } from "next/server";

// `import "server-only"` throws in jsdom (Vitest's default test env). Mock it
// so the server-route modules under test can still be imported.
vi.mock("server-only", () => ({}));

// Cron requests don't have a real Next.js header context here. Stub the
// correlation-id helper to a fixed UUID so the regression test below can
// assert exact-match propagation into compute_jobs.metadata.
const TEST_CORRELATION_ID = "ccccccc1-cccc-4ccc-8ccc-cccccccccccc";
vi.mock("@/lib/correlation-id", () => ({
  getCorrelationId: vi.fn(async () => TEST_CORRELATION_ID),
  CORRELATION_HEADER: "x-correlation-id",
}));

/**
 * Cron route handler tests for /api/cron/sync-funding.
 *
 * Tests: auth guard (missing secret, wrong bearer), fetch error → 500,
 * empty strategies → {enqueued:0}, happy N strategies → N enqueues,
 * rpc failure collects in errors array. Both GET and POST delegate to the
 * same handler, so the suite is parameterized across verbs.
 *
 * Added for review finding I1: the original PR shipped without a test file.
 */

function makeReq(headers: Record<string, string> = {}): NextRequest {
  return {
    headers: {
      get: (key: string) => headers[key.toLowerCase()] ?? null,
    },
  } as unknown as NextRequest;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe.each([
  ["GET"],
  ["POST"],
] as const)("%s /api/cron/sync-funding", (_verb) => {
  const originalSecret = process.env.CRON_SECRET;

  beforeEach(() => {
    process.env.CRON_SECRET = "cron-secret-at-least-16-chars";
    vi.resetModules();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
    if (originalSecret) process.env.CRON_SECRET = originalSecret;
    else delete process.env.CRON_SECRET;
  });

  async function getHandler(verb: string) {
    const mod = await import("./route");
    return verb === "GET" ? mod.GET : mod.POST;
  }

  it("returns 401 when CRON_SECRET is unset", async () => {
    delete process.env.CRON_SECRET;
    const handler = await getHandler(_verb);
    const res = await handler(makeReq({ authorization: "Bearer anything" }));
    expect(res.status).toBe(401);
  });

  it("returns 401 when the Authorization header is missing", async () => {
    const handler = await getHandler(_verb);
    const res = await handler(makeReq());
    expect(res.status).toBe(401);
  });

  it("returns 401 when the Authorization header is wrong", async () => {
    const handler = await getHandler(_verb);
    const res = await handler(
      makeReq({ authorization: "Bearer wrong-secret-value-here-pad" }),
    );
    expect(res.status).toBe(401);
  });

  it("returns 500 when the strategy fetch errors", async () => {
    vi.doMock("@/lib/supabase/admin", () => ({
      createAdminClient: () => ({
        from: () => ({
          select: () => ({
            eq: () => ({
              in: () =>
                Promise.resolve({
                  data: null,
                  error: { message: "DB connection failed" },
                }),
            }),
          }),
        }),
        rpc: vi.fn(),
      }),
    }));
    const handler = await getHandler(_verb);
    const res = await handler(
      makeReq({ authorization: `Bearer ${process.env.CRON_SECRET}` }),
    );
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toBeTruthy();
  });

  it("returns {enqueued:0} when there are no strategies", async () => {
    vi.doMock("@/lib/supabase/admin", () => ({
      createAdminClient: () => ({
        from: () => ({
          select: () => ({
            eq: () => ({
              in: () => Promise.resolve({ data: [], error: null }),
            }),
          }),
        }),
        rpc: vi.fn(),
      }),
    }));
    const handler = await getHandler(_verb);
    const res = await handler(
      makeReq({ authorization: `Bearer ${process.env.CRON_SECRET}` }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.enqueued).toBe(0);
  });

  it("enqueues one job per strategy on the happy path", async () => {
    const strategies = [{ id: "strat-a" }, { id: "strat-b" }];
    const rpcMock = vi.fn().mockImplementation(() =>
      Promise.resolve({ data: "job", error: null }),
    );
    vi.doMock("@/lib/supabase/admin", () => ({
      createAdminClient: () => ({
        from: () => ({
          select: () => ({
            eq: () => ({
              in: () => Promise.resolve({ data: strategies, error: null }),
            }),
          }),
        }),
        rpc: rpcMock,
      }),
    }));
    const handler = await getHandler(_verb);
    const res = await handler(
      makeReq({ authorization: `Bearer ${process.env.CRON_SECRET}` }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.enqueued).toBe(2);
    expect(body.total_candidates).toBe(2);

    // Phase 18 forensic thread (Day-2 Bug #1 follow-up): every enqueue in a
    // cron batch shares one correlation_id so compute_jobs.metadata stays
    // joinable. Without the route's getCorrelationId() thread, p_metadata
    // would be missing entirely and this assertion would fail.
    expect(rpcMock).toHaveBeenCalledTimes(2);
    for (const call of rpcMock.mock.calls) {
      expect(call[0]).toBe("enqueue_compute_job");
      expect(call[1]).toMatchObject({
        p_kind: "sync_funding",
        p_metadata: { correlation_id: TEST_CORRELATION_ID },
      });
    }
  });

  it("returns 500 when EVERY enqueue fails (G14-005 fail-loud)", async () => {
    const strategies = [{ id: "strat-a" }, { id: "strat-b" }];
    vi.doMock("@/lib/supabase/admin", () => ({
      createAdminClient: () => ({
        from: () => ({
          select: () => ({
            eq: () => ({
              in: () => Promise.resolve({ data: strategies, error: null }),
            }),
          }),
        }),
        rpc: vi.fn().mockImplementation(() =>
          Promise.resolve({ data: null, error: { message: "queue down" } }),
        ),
      }),
    }));
    const handler = await getHandler(_verb);
    const res = await handler(
      makeReq({ authorization: `Bearer ${process.env.CRON_SECRET}` }),
    );
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.enqueued).toBe(0);
    expect(body.failed).toBe(2);
    expect(body.total_candidates).toBe(2);
    expect(Array.isArray(body.errors)).toBe(true);
  });

  it("collects rpc failures in the errors array", async () => {
    const strategies = [{ id: "strat-a" }, { id: "strat-b" }];
    let rpcCall = 0;
    vi.doMock("@/lib/supabase/admin", () => ({
      createAdminClient: () => ({
        from: () => ({
          select: () => ({
            eq: () => ({
              in: () => Promise.resolve({ data: strategies, error: null }),
            }),
          }),
        }),
        rpc: vi.fn().mockImplementation(() => {
          rpcCall += 1;
          if (rpcCall === 1)
            return Promise.resolve({
              data: null,
              error: { message: "FK violation" },
            });
          return Promise.resolve({ data: "job-2", error: null });
        }),
      }),
    }));
    const handler = await getHandler(_verb);
    const res = await handler(
      makeReq({ authorization: `Bearer ${process.env.CRON_SECRET}` }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.enqueued).toBe(1);
    expect(body.failed).toBe(1);
    expect(Array.isArray(body.errors)).toBe(true);
    expect(body.errors[0]).toContain("strat-a");
  });

  // --- H-1090: Promise.allSettled rejected branch (thrown RPC promise) -----
  //
  // route.ts:87-91 handles `result.status === "rejected"` — the RPC promise
  // itself THREW (network blip), distinct from `result.value.error` (the RPC
  // resolved with a Postgres error). The existing failure tests above only
  // exercise the resolved-with-error path. This case forces the rpc mock to
  // REJECT so the route's `result.reason instanceof Error ? ... : String(...)`
  // message-extraction branch runs and the human-readable reason lands in
  // errors[] for incident response. Without that branch a thrown rejection
  // would be invisible to Vercel cron alerting.
  it("H-1090: collects thrown promise rejections in the errors array", async () => {
    const strategies = [{ id: "strat-a" }, { id: "strat-b" }];
    vi.doMock("@/lib/supabase/admin", () => ({
      createAdminClient: () => ({
        from: () => ({
          select: () => ({
            eq: () => ({
              in: () => Promise.resolve({ data: strategies, error: null }),
            }),
          }),
        }),
        // RPC promise itself rejects (e.g. fetch/network failure) — NOT a
        // resolved {data:null, error} envelope.
        rpc: vi.fn().mockImplementation(() =>
          Promise.reject(new Error("network blip")),
        ),
      }),
    }));
    const handler = await getHandler(_verb);
    const res = await handler(
      makeReq({ authorization: `Bearer ${process.env.CRON_SECRET}` }),
    );
    // All N rejected → fail-loud 500 (G14-005), failed=2, and the reason
    // string is preserved in errors[] (not swallowed / misformatted).
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.enqueued).toBe(0);
    expect(body.failed).toBe(2);
    expect(Array.isArray(body.errors)).toBe(true);
    expect(body.errors[0]).toContain("network blip");
    expect(body.errors[0]).toContain("strat-a");
  });

  // --- H-1092: is_active filter + PERP_EXCHANGES IN list + !inner join -----
  //
  // The handler pre-filters strategies via
  //   .eq("api_keys.is_active", true).in("api_keys.exchange", [...PERP])
  // on a `api_keys!inner(...)` join so revoked keys / unsupported exchanges
  // never reach the per-row enqueue loop. Each spurious enqueue spends a
  // compute job (billing-adjacent). The existing mocks ignore eq/in args, so
  // a regression dropping the is_active filter or widening the IN list would
  // pass silently. Capture the call args via mockReturnThis spies and assert
  // the exact contract, including the !inner select string.
  it("H-1092: asserts is_active filter, PERP_EXCHANGES IN list, and !inner join", async () => {
    const selectSpy = vi.fn();
    const eqSpy = vi.fn();
    const inSpy = vi.fn();
    vi.doMock("@/lib/supabase/admin", () => ({
      createAdminClient: () => {
        const builder: Record<string, unknown> = {};
        builder.select = (...args: unknown[]) => {
          selectSpy(...args);
          return builder;
        };
        builder.eq = (...args: unknown[]) => {
          eqSpy(...args);
          return builder;
        };
        builder.in = (...args: unknown[]) => {
          inSpy(...args);
          // Terminal call — resolve the query with an empty result so the
          // handler exits early before the enqueue loop.
          return Promise.resolve({ data: [], error: null });
        };
        return {
          from: () => builder,
          rpc: vi.fn(),
        };
      },
    }));
    const handler = await getHandler(_verb);
    const res = await handler(
      makeReq({ authorization: `Bearer ${process.env.CRON_SECRET}` }),
    );
    expect(res.status).toBe(200);

    // is_active filter MUST be applied — dropping it would enqueue sync for
    // revoked keys.
    expect(eqSpy).toHaveBeenCalledWith("api_keys.is_active", true);

    // IN list MUST cover the supported perp exchanges. Widening it to an
    // unsupported exchange would crash the downstream worker.
    expect(inSpy).toHaveBeenCalledWith(
      "api_keys.exchange",
      expect.arrayContaining(["binance", "okx", "bybit"]),
    );

    // The inner-join contract: a future drop of `!inner` (which would let
    // strategies without an active perp key through) must fail this.
    expect(selectSpy).toHaveBeenCalledTimes(1);
    const selectArg = String(selectSpy.mock.calls[0][0]);
    expect(selectArg).toContain("api_keys!inner");
  });
});
