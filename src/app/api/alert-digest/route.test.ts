import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";

/**
 * audit-2026-05-07 P445 + P446 — alert-digest hardening.
 *
 * P445: route returned `error.message` from a failed Postgres query
 * directly in the JSON response body. Postgres error messages include
 * table/column/constraint detail; that's an info leak. Post-fix the
 * body is a generic "Failed to send alert digest" string and the
 * detail goes to console.error + Sentry.
 *
 * P446: route fetched unacked alerts with no LIMIT — a 10K+ row backlog
 * would OOM the cron lambda. Post-fix the query is `.limit(1000)` with
 * a warn log at the boundary.
 *
 * Both tests would FAIL against pre-fix code:
 *  - P445: pre-fix `body.error` would be the raw Postgres message
 *    ("relation portfolio_alerts does not exist"). Post-fix it's the
 *    fixed string "Failed to send alert digest".
 *  - P446: pre-fix `.limit(...)` was never called on the query builder.
 *    Post-fix the spy is called exactly once with 1000.
 */

vi.mock("server-only", () => ({}));
vi.mock("@sentry/nextjs", () => ({
  captureException: vi.fn(),
}));

// Spy on `.limit(n)` — proves P446's limit clause is applied.
const limitSpy = vi.hoisted(() => vi.fn());
const fetchErrorState = vi.hoisted<{ enabled: boolean }>(() => ({
  enabled: false,
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => {
    // Chainable builder that mirrors the route's query shape:
    //   .from(table).select(...).is(...).is(...).order(...).limit(N)
    // The terminal call is `.limit(N)` — that's what we spy on.
    const builder: Record<string, unknown> = {};
    builder.select = () => builder;
    builder.is = () => builder;
    builder.order = () => builder;
    builder.limit = (...args: unknown[]) => {
      limitSpy(...args);
      // Return a thenable so `await admin.from(...).limit(...)` resolves.
      return Promise.resolve(
        fetchErrorState.enabled
          ? {
              data: null,
              error: {
                code: "42P01",
                message:
                  // The kind of Postgres detail that MUST NOT leak: schema
                  // name, table name, column name. Tests assert the route
                  // does NOT echo this back to the caller.
                  'relation "public.portfolio_alerts" does not exist (column "user_id" referenced)',
              },
            }
          : { data: [], error: null },
      );
    };
    return {
      from: () => builder,
      auth: { admin: { getUserById: async () => ({ data: null, error: null }) } },
    };
  },
}));

vi.mock("@/lib/email", () => ({
  sendAlertDigest: async () => undefined,
}));

vi.mock("@/lib/alert-ack-token", () => ({
  signAlertAckToken: () => "fake-token",
}));

function makeReq(): NextRequest {
  return new NextRequest("http://localhost:3000/api/alert-digest", {
    method: "POST",
    headers: { authorization: "Bearer test-cron-secret" },
  });
}

describe("POST /api/alert-digest — error.message leak (P445)", () => {
  beforeEach(() => {
    process.env.CRON_SECRET = "test-cron-secret";
    fetchErrorState.enabled = true;
    limitSpy.mockClear();
    vi.resetModules();
  });

  it("does NOT leak Postgres error.message in the response body", async () => {
    const { POST } = await import("./route");
    const res = await POST(makeReq());
    expect(res.status).toBe(500);
    const body = await res.json();
    // P445: pre-fix this assertion failed — body.error WAS the raw
    // Postgres message. Post-fix it's a generic string.
    expect(body.error).toBe("Failed to send alert digest");
    // Tighter negative assertion: NONE of the leaked tokens may appear.
    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain("portfolio_alerts");
    expect(serialized).not.toContain("public.");
    expect(serialized).not.toContain("user_id");
    expect(serialized).not.toContain("relation");
    expect(serialized).not.toContain("does not exist");
  });
});

describe("POST /api/alert-digest — fetch LIMIT (P446)", () => {
  beforeEach(() => {
    process.env.CRON_SECRET = "test-cron-secret";
    fetchErrorState.enabled = false;
    limitSpy.mockClear();
    vi.resetModules();
  });

  it("applies .limit(1000) on the unacked alerts fetch", async () => {
    const { POST } = await import("./route");
    const res = await POST(makeReq());
    // Happy path returns 200 with empty groups since the mock yields [].
    expect(res.status).toBe(200);
    // P446: pre-fix `.limit(...)` was never called. Post-fix it's
    // called exactly once with the documented ceiling.
    expect(limitSpy).toHaveBeenCalledTimes(1);
    expect(limitSpy).toHaveBeenCalledWith(1000);
  });
});

describe("POST /api/alert-digest — cron auth (sanity)", () => {
  beforeEach(() => {
    process.env.CRON_SECRET = "test-cron-secret";
    fetchErrorState.enabled = false;
    limitSpy.mockClear();
    vi.resetModules();
  });

  it("returns 401 when authorization header is missing", async () => {
    const { POST } = await import("./route");
    const req = new NextRequest("http://localhost:3000/api/alert-digest", {
      method: "POST",
    });
    const res = await POST(req);
    expect(res.status).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// H-0242 — grouping / parallel email lookups / Promise.allSettled tolerance /
// emailed_at marking. The original suite only pinned P445/P446/401. The
// route's actual business logic was untested: a regression that double-sent
// emails (failure to write emailed_at), sent the wrong portfolio's alerts to
// a user, or crashed on getUserById errors would not be caught.
//
// These tests use their own self-contained mocks installed via vi.doMock so
// the static `vi.mock("@/lib/supabase/admin")` / `vi.mock("@/lib/email")` at
// the top of the file (which return empty data / no-op) are replaced per case.
// The full chain shapes the route invokes:
//   FETCH:  from("portfolio_alerts").select(...).is(...).is(...)
//           .order(...).limit(1000)   → resolves the pending rows
//   UPDATE: from("portfolio_alerts").update({emailed_at}).in("id", ids)
//   EMAIL:  admin.auth.admin.getUserById(userId)
// ---------------------------------------------------------------------------
describe("POST /api/alert-digest — grouping + marking emailed_at (H-0242)", () => {
  function makeAuthedReq(): NextRequest {
    return new NextRequest("http://localhost:3000/api/alert-digest", {
      method: "POST",
      headers: { authorization: "Bearer test-cron-secret" },
    });
  }

  // Builds a supabase admin mock whose FETCH chain returns `pendingRows`,
  // whose UPDATE chain records the `.in("id", ids)` argument into
  // `updateInArgs`, and whose auth.admin.getUserById resolves per `userEmails`
  // (or errors per `userErrors`).
  function installSupabaseMock(opts: {
    pendingRows: unknown[];
    userEmails: Record<string, string | null>;
    userErrors?: Record<string, { message: string }>;
    updateInArgs: { value: string[] | null };
    updateCallCount: { value: number };
  }) {
    vi.doMock("@/lib/supabase/admin", () => ({
      createAdminClient: () => ({
        from: (table: string) => {
          const builder: Record<string, unknown> = {};
          // FETCH chain terminal is `.limit(N)`.
          builder.select = () => builder;
          builder.is = () => builder;
          builder.order = () => builder;
          builder.limit = () =>
            Promise.resolve({ data: opts.pendingRows, error: null });
          // UPDATE chain: update(...).in("id", ids) terminal.
          builder.update = () => builder;
          builder.in = (_col: string, ids: string[]) => {
            if (table === "portfolio_alerts") {
              opts.updateCallCount.value += 1;
              opts.updateInArgs.value = ids;
            }
            return Promise.resolve({ error: null });
          };
          return builder;
        },
        auth: {
          admin: {
            getUserById: async (userId: string) => {
              const err = opts.userErrors?.[userId];
              if (err) return { data: null, error: err };
              return {
                data: { user: { email: opts.userEmails[userId] ?? null } },
                error: null,
              };
            },
          },
        },
      }),
    }));
  }

  function makeRow(over: Partial<Record<string, unknown>> = {}) {
    return {
      id: "alert-1",
      portfolio_id: "pf-1",
      alert_type: "drawdown",
      severity: "warning",
      message: "hi",
      triggered_at: "2026-05-01T00:00:00.000Z",
      portfolios: { id: "pf-1", name: "Portfolio One", user_id: "user-1" },
      ...over,
    };
  }

  beforeEach(() => {
    process.env.CRON_SECRET = "test-cron-secret";
    vi.resetModules();
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.doUnmock("@/lib/supabase/admin");
    vi.doUnmock("@/lib/email");
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it("(a) groups two alerts for the same (user, portfolio) into ONE send and marks BOTH emailed_at", async () => {
    const sendSpy =
      vi.fn<(email: string, name: string, entries: unknown[]) => Promise<void>>(
        async () => undefined,
      );
    vi.doMock("@/lib/email", () => ({ sendAlertDigest: sendSpy }));

    const updateInArgs: { value: string[] | null } = { value: null };
    const updateCallCount = { value: 0 };
    installSupabaseMock({
      pendingRows: [
        makeRow({ id: "alert-1", portfolio_id: "pf-1" }),
        makeRow({ id: "alert-2", portfolio_id: "pf-1" }),
      ],
      userEmails: { "user-1": "user1@example.com" },
      updateInArgs,
      updateCallCount,
    });

    const { POST } = await import("./route");
    const res = await POST(makeAuthedReq());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ users_notified: 1, alerts_sent: 2 });

    // ONE email for the single (user, portfolio) group, carrying BOTH entries.
    expect(sendSpy).toHaveBeenCalledTimes(1);
    const [emailArg, nameArg, entriesArg] = sendSpy.mock.calls[0];
    expect(emailArg).toBe("user1@example.com");
    expect(nameArg).toBe("Portfolio One");
    expect(entriesArg.map((e) => (e as { id: string }).id)).toEqual([
      "alert-1",
      "alert-2",
    ]);

    // emailed_at UPDATE marks BOTH alert ids exactly once — the dedup guard
    // that prevents the next cron tick from re-sending.
    expect(updateCallCount.value).toBe(1);
    expect(updateInArgs.value).toEqual(["alert-1", "alert-2"]);
  });

  it("(b) one send rejects, one fulfilled → only the fulfilled group's ids are marked emailed_at", async () => {
    // Two distinct (user, portfolio) groups. user-2's send rejects; user-1's
    // fulfills. Promise.allSettled tolerance means the cron still 200s, but
    // ONLY user-1's alert id may be written to emailed_at — otherwise the
    // failed user would never be re-emailed.
    const sendSpy =
      vi.fn<(email: string, name: string, entries: unknown[]) => Promise<void>>(
        async (email: string) => {
          if (email === "user2@example.com") throw new Error("resend 500");
          return undefined;
        },
      );
    vi.doMock("@/lib/email", () => ({ sendAlertDigest: sendSpy }));

    const updateInArgs: { value: string[] | null } = { value: null };
    const updateCallCount = { value: 0 };
    installSupabaseMock({
      pendingRows: [
        makeRow({
          id: "alert-1",
          portfolio_id: "pf-1",
          portfolios: { id: "pf-1", name: "PF One", user_id: "user-1" },
        }),
        makeRow({
          id: "alert-2",
          portfolio_id: "pf-2",
          portfolios: { id: "pf-2", name: "PF Two", user_id: "user-2" },
        }),
      ],
      userEmails: {
        "user-1": "user1@example.com",
        "user-2": "user2@example.com",
      },
      updateInArgs,
      updateCallCount,
    });

    const { POST } = await import("./route");
    const res = await POST(makeAuthedReq());
    expect(res.status).toBe(200);
    const body = await res.json();
    // Only user-1 was notified; user-2's send rejected.
    expect(body).toEqual({ users_notified: 1, alerts_sent: 1 });

    expect(updateCallCount.value).toBe(1);
    // CRITICAL: only the fulfilled alert id is marked — alert-2 must remain
    // un-emailed so the next tick retries it.
    expect(updateInArgs.value).toEqual(["alert-1"]);
    expect(updateInArgs.value).not.toContain("alert-2");
  });

  it("(c) getUserById error → that group is skipped, no send, and its id is NOT marked emailed_at", async () => {
    const sendSpy =
      vi.fn<(email: string, name: string, entries: unknown[]) => Promise<void>>(
        async () => undefined,
      );
    vi.doMock("@/lib/email", () => ({ sendAlertDigest: sendSpy }));

    const updateInArgs: { value: string[] | null } = { value: null };
    const updateCallCount = { value: 0 };
    installSupabaseMock({
      pendingRows: [
        makeRow({
          id: "alert-good",
          portfolio_id: "pf-1",
          portfolios: { id: "pf-1", name: "PF One", user_id: "user-1" },
        }),
        makeRow({
          id: "alert-bad",
          portfolio_id: "pf-2",
          portfolios: { id: "pf-2", name: "PF Two", user_id: "user-bad" },
        }),
      ],
      userEmails: { "user-1": "user1@example.com" },
      userErrors: { "user-bad": { message: "user not found" } },
      updateInArgs,
      updateCallCount,
    });

    const { POST } = await import("./route");
    const res = await POST(makeAuthedReq());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ users_notified: 1, alerts_sent: 1 });

    // Only the resolvable user got an email; the errored group was skipped.
    expect(sendSpy).toHaveBeenCalledTimes(1);
    expect(sendSpy.mock.calls[0][0]).toBe("user1@example.com");

    // The errored group's alert id must NOT be marked emailed_at — it never
    // shipped, so it must surface on the next tick.
    expect(updateCallCount.value).toBe(1);
    expect(updateInArgs.value).toEqual(["alert-good"]);
    expect(updateInArgs.value).not.toContain("alert-bad");
  });
});
