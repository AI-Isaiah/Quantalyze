import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import type { NextRequest } from "next/server";

/**
 * Cron route handler tests for /api/cron/cleanup-ack-tokens (H-1152).
 *
 * The route had ZERO coverage. It deletes `used_ack_tokens` rows older than
 * 30 days. Without tests, a regression in the cutoff math, the `.lt('used_at',
 * cutoff)` filter, or the timing-safe auth gate ships silently — Vercel cron
 * only logs non-2xx and the handler returns 200 with {deleted:0} when the
 * filter matches nothing, so the replay-prevention table grows unbounded.
 *
 * Coverage mirrors sync-funding/route.test.ts mocking style:
 *   1. 401 when CRON_SECRET unset / missing header / wrong bearer (timing-safe).
 *   2. GET and POST both dispatch to the same handler.
 *   3. DELETE filters on used_at < (now - 30d).toISOString() — asserted with
 *      vi.setSystemTime so the cutoff is deterministic.
 *   4. {deleted: N} echoes the row count from .select('token_hash').
 *   5. 500 with the supabase error.message when .delete() raises.
 *
 * `import "server-only"` throws under jsdom; stub it so the route imports.
 */

vi.mock("server-only", () => ({}));

// ---------------------------------------------------------------------------
// Chainable supabase mock: .from(t).delete().lt(col,val).select(cols)
// `.select()` is the terminal awaited call. A recorder captures the .lt args
// and the table so each test asserts the exact filter shape.
// ---------------------------------------------------------------------------

interface Recorders {
  fromCalls: string[];
  deleteCalls: number;
  ltCalls: Array<{ col: string; val: unknown }>;
  selectCalls: string[];
  // Seeded result for the terminal .select() resolution.
  response: { data: Array<{ token_hash: string }> | null; error: { message: string } | null };
}

function makeRecorders(): Recorders {
  return {
    fromCalls: [],
    deleteCalls: 0,
    ltCalls: [],
    selectCalls: [],
    response: { data: [], error: null },
  };
}

function createSupabaseMock(recorders: Recorders) {
  return {
    from(table: string) {
      recorders.fromCalls.push(table);
      const chain: Record<string, unknown> = {};
      chain.delete = () => {
        recorders.deleteCalls += 1;
        return chain;
      };
      chain.lt = (col: string, val: unknown) => {
        recorders.ltCalls.push({ col, val });
        return chain;
      };
      chain.select = (cols: string) => {
        recorders.selectCalls.push(cols);
        return Promise.resolve(recorders.response);
      };
      return chain;
    },
  };
}

function makeReq(headers: Record<string, string> = {}): NextRequest {
  return {
    headers: {
      get: (key: string) => headers[key.toLowerCase()] ?? null,
    },
  } as unknown as NextRequest;
}

describe.each([["GET"], ["POST"]] as const)(
  "%s /api/cron/cleanup-ack-tokens",
  (verb) => {
    const originalSecret = process.env.CRON_SECRET;
    let recorders: Recorders;

    beforeEach(() => {
      process.env.CRON_SECRET = "cron-secret-at-least-16-chars";
      recorders = makeRecorders();
      vi.resetModules();
      vi.spyOn(console, "error").mockImplementation(() => {});
    });

    afterEach(() => {
      vi.restoreAllMocks();
      vi.doUnmock("@/lib/supabase/admin");
      vi.useRealTimers();
      vi.resetModules();
      if (originalSecret) process.env.CRON_SECRET = originalSecret;
      else delete process.env.CRON_SECRET;
    });

    async function getHandler(): Promise<
      (req: NextRequest) => Promise<Response>
    > {
      vi.doMock("@/lib/supabase/admin", () => ({
        createAdminClient: () => createSupabaseMock(recorders),
      }));
      const mod = await import("./route");
      return verb === "GET" ? mod.GET : mod.POST;
    }

    // --- Auth guard --------------------------------------------------------

    it("returns 401 when CRON_SECRET is unset", async () => {
      delete process.env.CRON_SECRET;
      const handler = await getHandler();
      const res = await handler(makeReq({ authorization: "Bearer anything" }));
      expect(res.status).toBe(401);
      // Auth short-circuits before any supabase call.
      expect(recorders.fromCalls).toHaveLength(0);
    });

    it("returns 401 when the Authorization header is missing", async () => {
      const handler = await getHandler();
      const res = await handler(makeReq());
      expect(res.status).toBe(401);
      expect(recorders.fromCalls).toHaveLength(0);
    });

    it("returns 401 when the Authorization header is wrong", async () => {
      const handler = await getHandler();
      const res = await handler(
        makeReq({ authorization: "Bearer wrong-secret-value-here-pad" }),
      );
      expect(res.status).toBe(401);
      expect(recorders.fromCalls).toHaveLength(0);
    });

    // --- Happy path: cutoff math + echo count ------------------------------

    it("deletes used_ack_tokens older than 30 days and echoes the row count", async () => {
      // Freeze the clock so the cutoff is exactly computable.
      const NOW = new Date("2026-05-25T12:00:00.000Z");
      vi.useFakeTimers();
      vi.setSystemTime(NOW);

      recorders.response = {
        data: [{ token_hash: "h1" }, { token_hash: "h2" }, { token_hash: "h3" }],
        error: null,
      };

      const handler = await getHandler();
      const res = await handler(
        makeReq({ authorization: `Bearer ${process.env.CRON_SECRET}` }),
      );

      expect(res.status).toBe(200);
      const body = await res.json();
      // {deleted:N} must echo .select('token_hash').length, not a fixed value.
      expect(body).toEqual({ deleted: 3 });

      // The DELETE ran against used_ack_tokens with a .lt('used_at', cutoff).
      expect(recorders.fromCalls).toEqual(["used_ack_tokens"]);
      expect(recorders.deleteCalls).toBe(1);
      expect(recorders.selectCalls).toEqual(["token_hash"]);
      expect(recorders.ltCalls).toHaveLength(1);
      const [{ col, val }] = recorders.ltCalls;
      expect(col).toBe("used_at");
      // cutoff === now - 30 days, ISO string. Exact because the clock is frozen.
      const expectedCutoff = new Date(
        NOW.getTime() - 30 * 24 * 60 * 60 * 1000,
      ).toISOString();
      expect(val).toBe(expectedCutoff);
    });

    it("returns {deleted:0} when no rows match the cutoff", async () => {
      recorders.response = { data: [], error: null };
      const handler = await getHandler();
      const res = await handler(
        makeReq({ authorization: `Bearer ${process.env.CRON_SECRET}` }),
      );
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toEqual({ deleted: 0 });
    });

    // --- Error path --------------------------------------------------------

    it("returns 500 with the supabase error.message when the delete fails", async () => {
      recorders.response = {
        data: null,
        error: { message: "deadlock detected" },
      };
      const handler = await getHandler();
      const res = await handler(
        makeReq({ authorization: `Bearer ${process.env.CRON_SECRET}` }),
      );
      expect(res.status).toBe(500);
      const body = await res.json();
      expect(body.error).toBe("deadlock detected");
    });
  },
);
