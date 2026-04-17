import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

// Task 7.1a added a `logAuditEvent` call to the route. audit.ts imports
// "server-only" which throws under vitest+jsdom — neuter it.
vi.mock("server-only", () => ({}));

/**
 * Tests for the GDPR Art. 17 deletion-request intake.
 *
 * The route now (PR 2 + PR 3):
 *   1. Rejects requests without a same-origin Origin/Referer header (CSRF).
 *   2. Rejects unauthenticated callers with 401.
 *   3. Applies a per-user Upstash rate limit (5/min). Falls open in tests
 *      because no UPSTASH_REDIS_REST_URL is set, so we don't have to mock
 *      the limiter directly — we exercise the real graceful-degradation
 *      path that ships to local dev.
 *   4. Dedups against `data_deletion_requests` rows from the same user in
 *      the last 24 hours where `completed_at IS NULL`. If one exists,
 *      returns 200 with the EXISTING row's id and never inserts a new row
 *      and never sends a duplicate founder email.
 *
 * The tests assert (4) by recording every `.from(...).insert(...)` call on
 * the supabase stub. Test 1 ("first POST") must call insert once. Test 2
 * ("second POST within dedup window") must call insert ZERO additional
 * times — i.e. the existing row short-circuits the insert path.
 */

function makeRequest(
  headers: Record<string, string> = { origin: "http://localhost:3000" },
): NextRequest {
  return new NextRequest("http://localhost:3000/api/account/deletion-request", {
    method: "POST",
    headers,
  });
}

const authUser = vi.hoisted(() => ({
  id: "00000000-0000-0000-0000-000000000001",
  email: "investor@example.com",
}));

type DeletionRow = {
  id: string;
  user_id: string;
  requested_at: string;
  completed_at: string | null;
};

const supabaseState = vi.hoisted(
  (): {
    rows: Array<{
      id: string;
      user_id: string;
      requested_at: string;
      completed_at: string | null;
    }>;
    insertCalls: number;
    selectCalls: number;
    rpcCalls: Array<{ name: string; args: Record<string, unknown> }>;
  } => ({
    rows: [],
    insertCalls: 0,
    selectCalls: 0,
    rpcCalls: [],
  }),
);

vi.mock("@/lib/supabase/server", () => {
  // Reset to the live state object on every fresh import. The closures below
  // read `supabaseState` so each test sees its mutations between calls.
  return {
    createClient: async () => ({
      auth: {
        getUser: async () => ({
          data: { user: authUser },
          error: null,
        }),
      },
      rpc: async (name: string, args: Record<string, unknown>) => {
        supabaseState.rpcCalls.push({ name, args });
        return { data: null, error: null };
      },
      from: () => {
        const builder = {
          // SELECT path used by the dedup probe
          _filters: {
            user_id: undefined as string | undefined,
            since: undefined as string | undefined,
          },
          select() {
            supabaseState.selectCalls += 1;
            return builder;
          },
          eq(field: string, value: string) {
            if (field === "user_id") builder._filters.user_id = value;
            return builder;
          },
          is() {
            // We only filter by completed_at IS NULL — implicit in our
            // in-memory match below.
            return builder;
          },
          gte(_field: string, value: string) {
            builder._filters.since = value;
            return builder;
          },
          order() {
            return builder;
          },
          limit() {
            return builder;
          },
          async maybeSingle() {
            const { user_id, since } = builder._filters;
            const match = supabaseState.rows
              .filter(
                (r) =>
                  r.user_id === user_id &&
                  r.completed_at === null &&
                  (!since || r.requested_at >= since),
              )
              .sort((a, b) =>
                a.requested_at < b.requested_at ? 1 : -1,
              )[0];
            return { data: match ?? null, error: null };
          },
          // INSERT path used after dedup says "go"
          insert(payload: { user_id: string }) {
            supabaseState.insertCalls += 1;
            const row: DeletionRow = {
              id: `req-${supabaseState.rows.length + 1}`,
              user_id: payload.user_id,
              requested_at: new Date().toISOString(),
              completed_at: null,
            };
            supabaseState.rows.push(row);
            return {
              select: () => ({
                single: async () => ({ data: row, error: null }),
              }),
            };
          },
        };
        return builder;
      },
    }),
  };
});

// notifyFounderGeneric is fire-and-forget — stub so tests don't try to
// actually send Resend mail.
vi.mock("@/lib/email", () => ({
  escapeHtml: (s: string) => s,
  notifyFounderGeneric: vi.fn(async () => undefined),
}));

describe("POST /api/account/deletion-request", () => {
  beforeEach(() => {
    supabaseState.rows = [];
    supabaseState.insertCalls = 0;
    supabaseState.selectCalls = 0;
    supabaseState.rpcCalls = [];
  });

  /**
   * Drain the microtask queue. logAuditEvent schedules its RPC via
   * queueMicrotask (so the caller doesn't wait), which means the RPC
   * only fires after the route handler's returned Promise settles and
   * the current task yields. Awaiting three resolved promises is enough
   * to let both the microtask AND the inner `await client.rpc(...)` land.
   */
  async function drainAuditMicrotasks() {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  }

  it("inserts on the first request and returns the new row", async () => {
    const { POST } = await import("./route");
    const res = await POST(makeRequest());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.request_id).toBe("req-1");
    expect(supabaseState.insertCalls).toBe(1);
    expect(supabaseState.rows).toHaveLength(1);
  });

  it("dedups a second POST within the 24h window without inserting again", async () => {
    const { POST } = await import("./route");

    // First call inserts.
    const firstRes = await POST(makeRequest());
    expect(firstRes.status).toBe(200);
    const firstBody = await firstRes.json();
    expect(firstBody.request_id).toBe("req-1");
    expect(supabaseState.insertCalls).toBe(1);

    // Second call must short-circuit on the existing pending row.
    const secondRes = await POST(makeRequest());
    expect(secondRes.status).toBe(200);
    const secondBody = await secondRes.json();
    expect(secondBody.ok).toBe(true);
    expect(secondBody.request_id).toBe("req-1"); // same row, not req-2
    expect(secondBody.message).toBe("Deletion request already pending");

    // No new insert; no new row.
    expect(supabaseState.insertCalls).toBe(1);
    expect(supabaseState.rows).toHaveLength(1);
  });

  it("inserts again once the previous row is marked completed", async () => {
    const { POST } = await import("./route");
    await POST(makeRequest()); // creates req-1
    expect(supabaseState.insertCalls).toBe(1);

    // Mark the existing row as completed (simulating the founder finishing
    // the manual deletion). The next POST should NOT see it as pending and
    // therefore should write a brand new row.
    supabaseState.rows[0].completed_at = new Date().toISOString();

    const res = await POST(makeRequest());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.request_id).toBe("req-2");
    expect(supabaseState.insertCalls).toBe(2);
    expect(supabaseState.rows).toHaveLength(2);
  });

  // PR 3 — CSRF Origin/Referer integration coverage. Each rejection asserts
  // that no insert call was made, proving the CSRF check fires before any
  // Supabase work. The unit tests for the helper itself live in
  // src/lib/csrf.test.ts.
  describe("CSRF Origin/Referer enforcement", () => {
    it("returns 403 when no Origin or Referer header is present", async () => {
      const { POST } = await import("./route");
      const res = await POST(makeRequest({}));
      expect(res.status).toBe(403);
      expect(supabaseState.insertCalls).toBe(0);
      expect(supabaseState.selectCalls).toBe(0);
    });

    it("returns 403 when Origin host is not in allowlist", async () => {
      const { POST } = await import("./route");
      const res = await POST(
        makeRequest({ origin: "https://evil.example.com" }),
      );
      expect(res.status).toBe(403);
      expect(supabaseState.insertCalls).toBe(0);
      expect(supabaseState.selectCalls).toBe(0);
    });

    it("proceeds past CSRF check with a valid Origin", async () => {
      const { POST } = await import("./route");
      const res = await POST(makeRequest({ origin: "http://localhost:3000" }));
      expect(res.status).toBe(200);
      expect(supabaseState.insertCalls).toBe(1);
    });
  });

  // Sprint 6 Task 7.1a — audit log pilot. The 3 pilot events are fire-and-
  // forget (queueMicrotask-scheduled) so they do NOT block the response, but
  // they MUST still fire on the happy path.
  describe("audit-log emission (Task 7.1a)", () => {
    it("emits deletion.request.create via log_audit_event RPC after insert", async () => {
      const { POST } = await import("./route");
      const res = await POST(makeRequest());
      expect(res.status).toBe(200);

      // The audit RPC is scheduled via queueMicrotask — drain so it fires
      // before we assert on supabaseState.rpcCalls.
      await drainAuditMicrotasks();

      const auditCall = supabaseState.rpcCalls.find(
        (c) => c.name === "log_audit_event",
      );
      expect(auditCall).toBeDefined();
      expect(auditCall!.args).toMatchObject({
        p_action: "deletion.request.create",
        p_entity_type: "data_deletion_request",
        p_entity_id: "req-1",
      });
      expect(auditCall!.args.p_metadata).toMatchObject({
        requested_at: expect.any(String),
      });
    });

    it("does NOT emit the audit event when the dedup path short-circuits", async () => {
      const { POST } = await import("./route");

      // First POST inserts + emits.
      const first = await POST(makeRequest());
      expect(first.status).toBe(200);
      await drainAuditMicrotasks();
      expect(
        supabaseState.rpcCalls.filter((c) => c.name === "log_audit_event"),
      ).toHaveLength(1);

      // Second POST hits the dedup branch — no new insert, no new audit.
      const second = await POST(makeRequest());
      expect(second.status).toBe(200);
      const secondBody = await second.json();
      expect(secondBody.request_id).toBe("req-1");
      await drainAuditMicrotasks();

      // Still only one audit emission.
      expect(
        supabaseState.rpcCalls.filter((c) => c.name === "log_audit_event"),
      ).toHaveLength(1);
    });
  });
});
