import { describe, it, expect, vi, beforeEach } from "vitest";
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
