import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import type { NextRequest } from "next/server";

/**
 * Cron route handler tests for /api/cron/phase19-error-rollup.
 *
 * The route is load-bearing for the Phase 19 168h-soak go/no-go gate. It
 * runs once per day, queries Sentry for /api/process-key error envelope
 * count over the prior 24h, and upserts the result into phase19_soak_daily
 * via phase19_soak_record_day. If the gate workflow finds <7 daily rows
 * near ship time, PR-D is blocked.
 *
 * Test surface (post-review hardening 2026-05-27):
 *   (1)  401 when CRON_SECRET missing or auth header mismatch.
 *   (2)  500 sentry_not_configured when SENTRY_ORG_SLUG / SENTRY_AUTH_TOKEN
 *        unset (was 200 — bumped so Vercel cron alerts fire on prod config drift).
 *   (3)  soak_not_started when feature_flags row is missing or value !== 'on'
 *        (200, expected daily skip while flag is off).
 *   (4)  window_pre_flip when target date precedes the flip (200, expected
 *        skip while backfilling).
 *   (5)  happy path: fetches Sentry numerator + denominator, computes rate,
 *        upserts via phase19_soak_record_day RPC.
 *   (6)  429 sentry_rate_limited (was 200 — bumped so Vercel cron alerts).
 *   (7)  zero-denominator (no traffic) records error_rate=0 with explanatory note.
 *   (8)  backfill via ?date= uses explicit start/end timestamps.
 *   (9)  500 feature_flags_unreachable when admin.from().maybeSingle() errors.
 *   (10) 502 sentry_unreachable when fetch throws (DNS / TLS / network).
 *   (11) 400 bad_date_param when ?date= is unparseable.
 *   (12) 500 sentry_not_configured when SENTRY_AUTH_TOKEN missing (the other
 *        arm of the OR — symmetry-coverage with test 2).
 *   (13) window_post_soak when ?date= is >14 days past flip (was clamped to 14;
 *        now bails so the operator sees the post-soak backfill explicitly).
 *   (14) 502 sentry_unparseable when Sentry response has no data field
 *        (was silent count=0 — pre-hardening this would let a malformed
 *        response satisfy the soak gate).
 *   (15) 502 sentry_unparseable when Sentry response has non-numeric count
 *        (defensive against shape rotation #3).
 *   (16) backfill 429 returns structured 429 sentry_rate_limited (was unstructured
 *        500 — backfill path now goes through fetchSentryCount).
 */

vi.mock("server-only", () => ({}));

interface AdminRecorders {
  flagRow: { value: string; updated_at: string } | null;
  flagErr: Error | null;
  rpcArgs: Array<Record<string, unknown>>;
  rpcResult: unknown;
  rpcErr: Error | null;
}

const adminRecorders: AdminRecorders = {
  flagRow: { value: "on", updated_at: "2026-05-25T15:51:07Z" },
  flagErr: null,
  rpcArgs: [],
  rpcResult: { ok: true, date_utc: "2026-05-26", day_index: 1 },
  rpcErr: null,
};

function makeAdminMock() {
  return {
    from: vi.fn((table: string) => {
      if (table === "feature_flags") {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              maybeSingle: vi.fn(async () => ({
                data: adminRecorders.flagRow,
                error: adminRecorders.flagErr,
              })),
            })),
          })),
        };
      }
      throw new Error(`unexpected admin.from(${table})`);
    }),
    rpc: vi.fn(async (name: string, args: Record<string, unknown>) => {
      if (name !== "phase19_soak_record_day") {
        throw new Error(`unexpected admin.rpc(${name})`);
      }
      adminRecorders.rpcArgs.push(args);
      return { data: adminRecorders.rpcResult, error: adminRecorders.rpcErr };
    }),
  };
}

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => makeAdminMock(),
}));

vi.mock("@/lib/timing-safe-compare", () => ({
  safeCompare: (a: string, b: string) => a === b,
}));

function makeRequest(opts: {
  auth?: string;
  search?: string;
}): NextRequest {
  const url = `http://localhost/api/cron/phase19-error-rollup${opts.search ?? ""}`;
  return {
    url,
    headers: {
      get: (k: string) => (k.toLowerCase() === "authorization" ? opts.auth ?? "" : null),
    },
  } as unknown as NextRequest;
}

describe("/api/cron/phase19-error-rollup", () => {
  beforeEach(() => {
    vi.resetModules();
    adminRecorders.flagRow = { value: "on", updated_at: "2026-05-25T15:51:07Z" };
    adminRecorders.flagErr = null;
    adminRecorders.rpcArgs = [];
    adminRecorders.rpcResult = { ok: true, date_utc: "2026-05-26", day_index: 1 };
    adminRecorders.rpcErr = null;
    process.env.CRON_SECRET = "test-secret";
    process.env.SENTRY_ORG_SLUG = "quantalyze";
    process.env.SENTRY_AUTH_TOKEN = "sentry-token";
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.CRON_SECRET;
    delete process.env.SENTRY_ORG_SLUG;
    delete process.env.SENTRY_AUTH_TOKEN;
  });

  it("returns 401 when auth header is wrong", async () => {
    const { GET } = await import("./route");
    const res = await GET(makeRequest({ auth: "Bearer wrong" }));
    expect(res.status).toBe(401);
  });

  it("returns 500 sentry_not_configured when SENTRY_ORG_SLUG missing", async () => {
    delete process.env.SENTRY_ORG_SLUG;
    const { GET } = await import("./route");
    const res = await GET(makeRequest({ auth: "Bearer test-secret" }));
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ ok: false, reason: "sentry_not_configured" });
  });

  it("returns 500 sentry_not_configured when SENTRY_AUTH_TOKEN missing", async () => {
    delete process.env.SENTRY_AUTH_TOKEN;
    const { GET } = await import("./route");
    const res = await GET(makeRequest({ auth: "Bearer test-secret" }));
    expect(res.status).toBe(500);
    expect((await res.json()).reason).toBe("sentry_not_configured");
  });

  it("returns soak_not_started when flag value is 'off'", async () => {
    adminRecorders.flagRow = { value: "off", updated_at: "2026-05-25T15:51:07Z" };
    const { GET } = await import("./route");
    const res = await GET(makeRequest({ auth: "Bearer test-secret" }));
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.reason).toBe("soak_not_started");
    expect(body.flag_value).toBe("off");
  });

  it("returns soak_not_started when feature_flags row missing", async () => {
    adminRecorders.flagRow = null;
    const { GET } = await import("./route");
    const res = await GET(makeRequest({ auth: "Bearer test-secret" }));
    const body = await res.json();
    expect(body.reason).toBe("soak_not_started");
  });

  it("returns 500 feature_flags_unreachable when admin.from errors", async () => {
    adminRecorders.flagErr = new Error("connection refused");
    const { GET } = await import("./route");
    const res = await GET(makeRequest({ auth: "Bearer test-secret" }));
    expect(res.status).toBe(500);
    expect((await res.json()).reason).toBe("feature_flags_unreachable");
    expect(adminRecorders.rpcArgs).toHaveLength(0);
  });

  it("returns window_pre_flip when ?date= precedes the flip", async () => {
    const { GET } = await import("./route");
    const res = await GET(
      makeRequest({ auth: "Bearer test-secret", search: "?date=2026-05-20" }),
    );
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.reason).toBe("window_pre_flip");
  });

  it("returns window_post_soak when ?date= is >14 days past flip", async () => {
    const { GET } = await import("./route");
    // flip 2026-05-25 → day 15 = 2026-06-08; pick a date well past the soak window.
    const res = await GET(
      makeRequest({ auth: "Bearer test-secret", search: "?date=2026-06-20" }),
    );
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.ok).toBe(false);
    expect(body.reason).toBe("window_post_soak");
    expect(body.day_index_raw).toBeGreaterThan(14);
    expect(adminRecorders.rpcArgs).toHaveLength(0);
  });

  it("returns 400 bad_date_param when ?date= is unparseable", async () => {
    const { GET } = await import("./route");
    const res = await GET(
      makeRequest({ auth: "Bearer test-secret", search: "?date=notadate" }),
    );
    expect(res.status).toBe(400);
    expect((await res.json()).reason).toBe("bad_date_param");
    expect(adminRecorders.rpcArgs).toHaveLength(0);
  });

  it("happy path — records daily row with computed error_rate", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ data: [{ "count()": 3 }] }), { status: 200 }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ data: [{ "count()": 1000 }] }), { status: 200 }),
      );
    const { GET } = await import("./route");
    const res = await GET(makeRequest({ auth: "Bearer test-secret" }));
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.error_events).toBe(3);
    expect(body.total_events).toBe(1000);
    expect(body.error_rate).toBe(0.003);
    expect(adminRecorders.rpcArgs).toHaveLength(1);
    expect(adminRecorders.rpcArgs[0]).toMatchObject({
      p_error_rate: 0.003,
      p_error_events: 3,
      p_total_events: 1000,
    });
    fetchSpy.mockRestore();
  });

  it("returns 429 sentry_rate_limited on Sentry 429", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response("", {
        status: 429,
        headers: { "retry-after": "30", "x-sentry-rate-limit-remaining": "0" },
      }),
    );
    const { GET } = await import("./route");
    const res = await GET(makeRequest({ auth: "Bearer test-secret" }));
    expect(res.status).toBe(429);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.reason).toBe("sentry_rate_limited");
    expect(body.retry_after).toBe("30");
    expect(adminRecorders.rpcArgs).toHaveLength(0);
  });

  it("returns 502 sentry_unreachable when fetch throws (DNS / TLS / network)", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValueOnce(new Error("ENOTFOUND sentry.io"));
    const { GET } = await import("./route");
    const res = await GET(makeRequest({ auth: "Bearer test-secret" }));
    expect(res.status).toBe(502);
    expect((await res.json()).reason).toBe("sentry_unreachable");
    expect(adminRecorders.rpcArgs).toHaveLength(0);
  });

  it("returns 502 sentry_unparseable when Sentry response has no data field", async () => {
    // The previous parseSentryCount would have silently returned 0 here,
    // letting a malformed numerator + malformed denominator both = 0 record
    // a false-clean error_rate=0 row.
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({ error: "internal" }), { status: 200 }),
    );
    const { GET } = await import("./route");
    const res = await GET(makeRequest({ auth: "Bearer test-secret" }));
    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.reason).toBe("sentry_unparseable");
    expect(adminRecorders.rpcArgs).toHaveLength(0);
  });

  it("returns 502 sentry_unparseable when count is non-numeric (shape rotation defense)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({ data: [{ "count()": "1234" }] }), { status: 200 }),
    );
    const { GET } = await import("./route");
    const res = await GET(makeRequest({ auth: "Bearer test-secret" }));
    expect(res.status).toBe(502);
    expect((await res.json()).reason).toBe("sentry_unparseable");
  });

  it("zero-denominator — records 0 rate with explanatory note", async () => {
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ data: [{ "count()": 0 }] }), { status: 200 }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ data: [{ "count()": 0 }] }), { status: 200 }),
      );
    const { GET } = await import("./route");
    const res = await GET(makeRequest({ auth: "Bearer test-secret" }));
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.error_rate).toBe(0);
    expect(body.total_events).toBe(0);
    expect(body.notes).toContain("no /process-key traffic");
    expect(adminRecorders.rpcArgs[0]).toMatchObject({
      p_error_rate: 0,
      p_total_events: 0,
      p_error_events: 0,
    });
  });

  it("returns rpc_failed when phase19_soak_record_day fails", async () => {
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ data: [{ "count()": 1 }] }), { status: 200 }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ data: [{ "count()": 100 }] }), { status: 200 }),
      );
    adminRecorders.rpcErr = new Error("simulated RPC failure");
    const { GET } = await import("./route");
    const res = await GET(makeRequest({ auth: "Bearer test-secret" }));
    const body = await res.json();
    expect(res.status).toBe(500);
    expect(body.reason).toBe("rpc_failed");
  });

  it("backfill via ?date= uses explicit start/end timestamps", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ data: [{ "count()": 2 }] }), { status: 200 }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ data: [{ "count()": 800 }] }), { status: 200 }),
      );
    const { GET } = await import("./route");
    const res = await GET(
      makeRequest({ auth: "Bearer test-secret", search: "?date=2026-05-26" }),
    );
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.date_utc).toBe("2026-05-26");
    expect(body.day_index).toBe(2); // flip date 2026-05-25 = day 1; 2026-05-26 = day 2
    const firstCall = fetchSpy.mock.calls[0][0] as string;
    expect(firstCall).toContain("start=");
    expect(firstCall).toContain("end=");
    expect(firstCall).not.toContain("statsPeriod=");
    fetchSpy.mockRestore();
  });

  it("backfill 429 returns structured 429 sentry_rate_limited (unified path)", async () => {
    // Before hardening, backfill IIFE threw a bare Error → Next.js default 500
    // with no reason. Now backfill goes through fetchSentryCount.
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response("", { status: 429, headers: { "retry-after": "10" } }),
    );
    const { GET } = await import("./route");
    const res = await GET(
      makeRequest({ auth: "Bearer test-secret", search: "?date=2026-05-26" }),
    );
    expect(res.status).toBe(429);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.reason).toBe("sentry_rate_limited");
    expect(adminRecorders.rpcArgs).toHaveLength(0);
  });

  it("backfill for flip-day clamps Sentry window start to flipTs (skips pre-flip)", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ data: [{ "count()": 0 }] }), { status: 200 }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ data: [{ "count()": 0 }] }), { status: 200 }),
      );
    const { GET } = await import("./route");
    // flip = 2026-05-25T15:51:07Z. Backfill for 2026-05-25 should query Sentry
    // with start = 15:51:07Z (not 00:00Z) so it excludes pre-flip traffic.
    const res = await GET(
      makeRequest({ auth: "Bearer test-secret", search: "?date=2026-05-25" }),
    );
    expect(res.status).toBe(200);
    const firstCall = fetchSpy.mock.calls[0][0] as string;
    expect(firstCall).toContain("start=2026-05-25T15%3A51%3A07.000Z");
    fetchSpy.mockRestore();
  });
});
