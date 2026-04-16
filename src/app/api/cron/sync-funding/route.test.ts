import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import type { NextRequest } from "next/server";

// `import "server-only"` throws in jsdom (Vitest's default test env). Mock it
// so the server-route modules under test can still be imported.
vi.mock("server-only", () => ({}));

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
          return Promise.resolve({ data: `job-${rpcCall}`, error: null });
        }),
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
});
