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
    const rawDbMessage = 'permission denied for table strategies';
    vi.doMock("@/lib/supabase/admin", () => ({
      createAdminClient: () => ({
        from: () => ({
          select: () => ({
            eq: () => ({
              in: () =>
                Promise.resolve({
                  data: null,
                  error: { message: rawDbMessage },
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
    // M-0916: the raw PostgREST message (schema/column/constraint names) must
    // NOT leak into the response body — only a stable code. Reverting the fix
    // (returning fetchError.message) fails this.
    expect(body.error).toBe("strategy_fetch_failed");
    expect(JSON.stringify(body)).not.toContain(rawDbMessage);
  });

  it("returns the unified envelope (enqueued/failed/total_candidates, no skipped) when there are no strategies", async () => {
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
    // M-0913/M-0915: empty path must carry the SAME flat shape as the
    // populated path, not the legacy `{enqueued:0, skipped:0}`. Reverting the
    // fix (the orphan `skipped` field / missing failed+total_candidates) fails
    // these assertions.
    expect(body.enqueued).toBe(0);
    expect(body.failed).toBe(0);
    expect(body.total_candidates).toBe(0);
    expect(body).not.toHaveProperty("skipped");
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
    // M-0916: the raw RPC error ("FK violation") must NOT leak into the
    // per-row errors array — only the strategy id + a stable code. Reverting
    // the fix (pushing result.value.error.message) fails this.
    expect(body.errors[0]).not.toContain("FK violation");
    expect(body.errors[0]).toContain("enqueue_failed");
  });

  // --- H-1091: RPC resolves {data:null, error:null} — must NOT vanish -------
  //
  // route.ts:96 increments `enqueued` only when result.value.data is truthy.
  // If enqueue_compute_job is replaced by a void/null-returning shim, the row
  // resolves with neither data nor error. The original code had no else, so
  // such a row was counted as NEITHER enqueued NOR failed — total_candidates
  // !== enqueued + failed was the only signal and nothing logged it. The fix
  // adds an explicit else that counts it failed + logs. This test asserts the
  // accounting identity holds and 500 fires on an all-null batch.
  it("H-1091: counts {data:null, error:null} as a failure, not a silent drop", async () => {
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
        // void-returning shim: resolves with neither data nor error.
        rpc: vi.fn().mockImplementation(() =>
          Promise.resolve({ data: null, error: null }),
        ),
      }),
    }));
    const handler = await getHandler(_verb);
    const res = await handler(
      makeReq({ authorization: `Bearer ${process.env.CRON_SECRET}` }),
    );
    const body = await res.json();
    // Accounting identity must hold — no row may vanish.
    expect(body.enqueued + body.failed).toBe(body.total_candidates);
    expect(body.enqueued).toBe(0);
    expect(body.failed).toBe(2);
    // The load-bearing assertions for the H-1091 fix are `failed===2` and the
    // accounting identity above: WITHOUT the else branch a {data:null,error:null}
    // row is counted as neither enqueued nor failed, so failed would be 0 and
    // enqueued+failed (0) !== total_candidates (2). The 500 below is NOT the
    // distinguishing signal — allFailed (rows>0 && enqueued===0) already fires it
    // at enqueued=0 even pre-fix — but it's asserted as a behavioral guard.
    expect(res.status).toBe(500);
    expect(Array.isArray(body.errors)).toBe(true);
    expect(body.errors[0]).toContain("strat-a");
  });

  // --- L-0050: errors[] is truncated to 5 — errors_total flags it ----------
  //
  // route.ts caps `errors` at 5 entries. With > 5 failures a consumer sees
  // errors.length===5 / failed===N and can't tell how many are missing. The
  // fix adds `errors_total` so truncation is detectable from the envelope.
  it("L-0050: exposes errors_total when the errors array is truncated", async () => {
    const strategies = Array.from({ length: 7 }, (_, i) => ({
      id: `strat-${i}`,
    }));
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
    const body = await res.json();
    expect(body.failed).toBe(7);
    // Array is capped at 5...
    expect(body.errors).toHaveLength(5);
    // ...but errors_total reveals the true count so truncation is visible.
    expect(body.errors_total).toBe(7);
    expect(body.errors_total).toBeGreaterThan(body.errors.length);
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
