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
 * Test surface:
 *   (1) 401 when CRON_SECRET missing or auth header mismatch.
 *   (2) sentry_not_configured when SENTRY_ORG_SLUG / SENTRY_AUTH_TOKEN unset.
 *   (3) soak_not_started when feature_flags row is missing or value !== 'on'.
 *   (4) window_pre_flip when target date precedes the flip.
 *   (5) happy path: fetches Sentry numerator + denominator, computes rate,
 *       upserts via phase19_soak_record_day RPC.
 *   (6) rate-limit branch: 429 returns sentry_rate_limited.
 *   (7) zero-denominator (no traffic) records error_rate=0 with explanatory note.
 *   (8) backfill via ?date= uses explicit start/end timestamps.
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

  it("returns sentry_not_configured when SENTRY_ORG_SLUG missing", async () => {
    delete process.env.SENTRY_ORG_SLUG;
    const { GET } = await import("./route");
    const res = await GET(makeRequest({ auth: "Bearer test-secret" }));
    const body = await res.json();
    expect(body).toEqual({ ok: false, reason: "sentry_not_configured" });
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

  it("returns window_pre_flip when ?date= precedes the flip", async () => {
    const { GET } = await import("./route");
    const res = await GET(
      makeRequest({ auth: "Bearer test-secret", search: "?date=2026-05-20" }),
    );
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.reason).toBe("window_pre_flip");
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

  it("rate-limit branch — 429 returns sentry_rate_limited", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response("", {
        status: 429,
        headers: { "retry-after": "30", "x-sentry-rate-limit-remaining": "0" },
      }),
    );
    const { GET } = await import("./route");
    const res = await GET(makeRequest({ auth: "Bearer test-secret" }));
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.reason).toBe("sentry_rate_limited");
    expect(body.retry_after).toBe("30");
    expect(adminRecorders.rpcArgs).toHaveLength(0);
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
    adminRecorders.rpcErr = new Error("simulated RPC failure") as never;
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
});
