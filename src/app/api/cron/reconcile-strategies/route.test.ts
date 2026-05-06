import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import type { NextRequest } from "next/server";

/**
 * Cron route handler tests for /api/cron/reconcile-strategies. Mirrors the
 * sibling sync-funding test file: same auth + fetch-error + empty + happy +
 * rpc-error coverage, plus the Phase 18 forensic correlation_id thread
 * (Day-2 Bug #1 follow-up) that ensures every enqueue in a nightly batch
 * shares one id in compute_jobs.metadata.
 *
 * One additional case the sync-funding suite doesn't have: this route
 * promotes an all-failed batch to 500 (so monitoring catches a fully
 * regressed cron run instead of treating it as a successful empty batch).
 */

vi.mock("server-only", () => ({}));

const TEST_CORRELATION_ID = "ccccccc2-cccc-4ccc-8ccc-cccccccccccc";
vi.mock("@/lib/correlation-id", () => ({
  getCorrelationId: vi.fn(async () => TEST_CORRELATION_ID),
  CORRELATION_HEADER: "x-correlation-id",
}));

function makeReq(headers: Record<string, string> = {}): NextRequest {
  return {
    headers: {
      get: (key: string) => headers[key.toLowerCase()] ?? null,
    },
  } as unknown as NextRequest;
}

describe.each([["GET"], ["POST"]] as const)(
  "%s /api/cron/reconcile-strategies",
  (_verb) => {
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

    // Helper: chained fetch builder for `from().select().eq().in().gt()`.
    function adminWithStrategies(
      strategies: Array<{ id: string }>,
      rpcImpl: ReturnType<typeof vi.fn>,
    ) {
      return {
        from: () => ({
          select: () => ({
            eq: () => ({
              in: () => ({
                gt: () => Promise.resolve({ data: strategies, error: null }),
              }),
            }),
          }),
        }),
        rpc: rpcImpl,
      };
    }

    it("returns 401 when CRON_SECRET is unset", async () => {
      delete process.env.CRON_SECRET;
      const handler = await getHandler(_verb);
      const res = await handler(makeReq({ authorization: "Bearer anything" }));
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
                in: () => ({
                  gt: () =>
                    Promise.resolve({
                      data: null,
                      error: { message: "DB connection failed" },
                    }),
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
    });

    it("returns {enqueued:0} when there are no strategies", async () => {
      vi.doMock("@/lib/supabase/admin", () => ({
        createAdminClient: () => adminWithStrategies([], vi.fn()),
      }));
      const handler = await getHandler(_verb);
      const res = await handler(
        makeReq({ authorization: `Bearer ${process.env.CRON_SECRET}` }),
      );
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.enqueued).toBe(0);
    });

    it("enqueues one job per strategy on the happy path with shared correlation_id", async () => {
      const strategies = [{ id: "strat-a" }, { id: "strat-b" }];
      const rpcMock = vi
        .fn()
        .mockImplementation(() =>
          Promise.resolve({ data: "job", error: null }),
        );
      vi.doMock("@/lib/supabase/admin", () => ({
        createAdminClient: () => adminWithStrategies(strategies, rpcMock),
      }));
      const handler = await getHandler(_verb);
      const res = await handler(
        makeReq({ authorization: `Bearer ${process.env.CRON_SECRET}` }),
      );
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.enqueued).toBe(2);
      expect(body.total_candidates).toBe(2);

      // Phase 18 forensic thread (Day-2 Bug #1 follow-up): every enqueue in
      // the nightly batch shares one correlation_id. Without the route's
      // getCorrelationId() thread, p_metadata would be missing entirely.
      expect(rpcMock).toHaveBeenCalledTimes(2);
      for (const call of rpcMock.mock.calls) {
        expect(call[0]).toBe("enqueue_compute_job");
        expect(call[1]).toMatchObject({
          p_kind: "reconcile_strategy",
          p_metadata: { correlation_id: TEST_CORRELATION_ID },
        });
      }
    });

    it("returns 500 when every enqueue fails (all-failed batch is a regression signal)", async () => {
      const strategies = [{ id: "strat-a" }];
      const rpcMock = vi.fn().mockImplementation(() =>
        Promise.resolve({ data: null, error: { message: "FK violation" } }),
      );
      vi.doMock("@/lib/supabase/admin", () => ({
        createAdminClient: () => adminWithStrategies(strategies, rpcMock),
      }));
      const handler = await getHandler(_verb);
      const res = await handler(
        makeReq({ authorization: `Bearer ${process.env.CRON_SECRET}` }),
      );
      expect(res.status).toBe(500);
      const body = await res.json();
      expect(body.enqueued).toBe(0);
      expect(body.failed).toBe(1);
    });
  },
);
