import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Tests for the GDPR Art. 17 deletion-request intake.
 *
 * The route now (PR 2):
 *   1. Rejects unauthenticated callers with 401.
 *   2. Applies a per-user Upstash rate limit (5/min). Falls open in tests
 *      because no UPSTASH_REDIS_REST_URL is set, so we don't have to mock
 *      the limiter directly — we exercise the real graceful-degradation
 *      path that ships to local dev.
 *   3. Dedups against `data_deletion_requests` rows from the same user in
 *      the last 24 hours where `completed_at IS NULL`. If one exists,
 *      returns 200 with the EXISTING row's id and never inserts a new row
 *      and never sends a duplicate founder email.
 *
 * The tests assert (3) by recording every `.from(...).insert(...)` call on
 * the supabase stub. Test 1 ("first POST") must call insert once. Test 2
 * ("second POST within dedup window") must call insert ZERO additional
 * times — i.e. the existing row short-circuits the insert path.
 */

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
  } => ({
    rows: [],
    insertCalls: 0,
    selectCalls: 0,
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
  });

  it("inserts on the first request and returns the new row", async () => {
    const { POST } = await import("./route");
    const res = await POST();
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
    const firstRes = await POST();
    expect(firstRes.status).toBe(200);
    const firstBody = await firstRes.json();
    expect(firstBody.request_id).toBe("req-1");
    expect(supabaseState.insertCalls).toBe(1);

    // Second call must short-circuit on the existing pending row.
    const secondRes = await POST();
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
    await POST(); // creates req-1
    expect(supabaseState.insertCalls).toBe(1);

    // Mark the existing row as completed (simulating the founder finishing
    // the manual deletion). The next POST should NOT see it as pending and
    // therefore should write a brand new row.
    supabaseState.rows[0].completed_at = new Date().toISOString();

    const res = await POST();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.request_id).toBe("req-2");
    expect(supabaseState.insertCalls).toBe(2);
    expect(supabaseState.rows).toHaveLength(2);
  });
});
