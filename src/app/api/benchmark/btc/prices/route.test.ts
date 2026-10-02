import { describe, it, expect, vi, beforeEach } from "vitest";

import {
  pairScenarioWithBtc,
  parseBtcCloses,
} from "@/app/(dashboard)/allocations/lib/scenario-benchmark";

/**
 * Phase 169.4 ALLOCTRUTH / plan 169.4-03 (D-67) — GET /api/benchmark/btc/prices.
 *
 * Pins the BTC CLOSES contract the Scenario surfaces read:
 *   - the body is `{ prices, dropped, through }`, read by `readBenchmarkPrices`
 *     (unbounded) and merged with the bundled fixture ONLY strictly before the
 *     database's first STORED date, a dropped row included (D-09);
 *   - a read error is a 503 with `Cache-Control: no-store` and a static body,
 *     never the fixture (D-09, 169.2 SFH MD-05);
 *   - the per-IP limiter denies before the database is touched.
 * The last case runs the route's JSON through `parseBtcCloses` and
 * `pairScenarioWithBtc`, end to end (SC11): a BTC return that bridges a missing
 * stored day is never paired as one day's move.
 *
 * The supabase server client is mocked the way the returns route's test does
 * (a keyset-paged `.from().select().eq()[.lt()].order().limit()` chain over a
 * per-test table). The bundled fixture is replaced by a tiny contiguous series
 * whose dates straddle the mocked database's first date, so the fixture seam
 * is sharp: a fixture close dated exactly the first stored date must NOT appear.
 */

const { table, mockEq, mockFrom } = vi.hoisted(() => {
  type Row = { date: string; close_price: unknown };
  const table: { rows: Row[] | null; error: unknown } = { rows: [], error: null };

  function answer(ascending: boolean, cursor: string | null, n: number) {
    if (table.error) return { data: null, error: table.error };
    if (table.rows === null) return { data: null, error: null };
    const sorted = table.rows
      .filter((r) => cursor === null || r.date < cursor)
      .sort((a, b) =>
        ascending ? a.date.localeCompare(b.date) : b.date.localeCompare(a.date),
      );
    return { data: sorted.slice(0, n), error: null };
  }

  const mockEq = vi.fn();
  const mockFrom = vi.fn(() => {
    let cursor: string | null = null;
    const b = {
      select: () => b,
      eq: (col: string, val: unknown) => {
        mockEq(col, val);
        return b;
      },
      lt: (_col: string, val: string) => {
        cursor = val;
        return b;
      },
      order: (_col: string, o: { ascending: boolean }) => ({
        limit: (n: number) =>
          Promise.resolve(answer(o?.ascending !== false, cursor, n)),
      }),
    };
    return b;
  });
  return { table, mockEq, mockFrom };
});

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ from: mockFrom }),
}));

// A tiny bundled fixture: 2026-05-29 .. 2026-06-02. The mocked database starts
// at 2026-06-01 (F), so only 05-29, 05-30 and 05-31 may survive the merge; the
// fixture's 06-01 and 06-02 closes carry values no database row uses, so their
// presence in the body would be visible.
vi.mock("@/lib/factsheet/benchmarks", () => ({
  BTC_DAILY: [
    { date: "2026-05-29", close: 90 },
    { date: "2026-05-30", close: 91 },
    { date: "2026-05-31", close: 92 },
    { date: "2026-06-01", close: 7777 },
    { date: "2026-06-02", close: 8888 },
  ],
}));

vi.mock("@/lib/sentry-capture", async (importActual) => ({
  ...(await importActual<typeof import("@/lib/sentry-capture")>()),
  captureToSentry: vi.fn(async () => undefined),
}));

// `after()` needs a Next request scope vitest does not provide; run it at once.
vi.mock("next/server", async (importActual) => ({
  ...(await importActual<typeof import("next/server")>()),
  after: vi.fn((cb: () => unknown) => {
    void cb();
  }),
}));

const { rlResult, checkLimitSpy } = vi.hoisted(() => ({
  rlResult: { value: { success: true } as Record<string, unknown> },
  checkLimitSpy: vi.fn(),
}));
vi.mock("@/lib/ratelimit", () => ({
  publicIpLimiter: {},
  checkLimit: vi.fn(async (_l: unknown, key: string) => {
    checkLimitSpy(key);
    return rlResult.value;
  }),
  getClientIp: vi.fn(() => "test-ip"),
  isRateLimitMisconfigured: (r: { reason?: string }) =>
    r?.reason === "ratelimit_misconfigured",
}));

const URL_ = "https://x/api/benchmark/btc/prices";

type Body = {
  prices: Array<{ date: string; close: number }>;
  dropped: string[];
  through: string | null;
};

function setRows(rows: Array<{ date: string; close_price: unknown }>) {
  table.rows = rows;
  table.error = null;
}

describe("GET /api/benchmark/btc/prices", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    const { __resetCaptureThrottleForTests } = await import(
      "@/lib/sentry-capture"
    );
    __resetCaptureThrottleForTests();
    table.rows = [];
    table.error = null;
    rlResult.value = { success: true };
  });

  it("rate-limits with 429 on its own per-IP key and never touches the database", async () => {
    rlResult.value = { success: false, retryAfter: 30 };
    const { GET } = await import("./route");
    const res = await GET(new Request(URL_));
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBe("30");
    expect(res.headers.get("Cache-Control") ?? "").not.toContain("s-maxage");
    expect(mockFrom).not.toHaveBeenCalled();
    // Its own bucket: a shared prefix would let one route's traffic spend the
    // other's allowance.
    expect(checkLimitSpy).toHaveBeenCalledWith("benchmark-btc-prices:test-ip");
  });

  it("answers 503 (fail-closed) when the limiter is misconfigured", async () => {
    rlResult.value = {
      success: false,
      retryAfter: 60,
      reason: "ratelimit_misconfigured",
    };
    const { GET } = await import("./route");
    const res = await GET(new Request(URL_));
    expect(res.status).toBe(503);
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it("answers { prices, dropped, through }: fixture only before the first stored date, a dropped close reported and absent", async () => {
    setRows([
      { date: "2026-06-01", close_price: 100 },
      { date: "2026-06-02", close_price: 101 },
      { date: "2026-06-03", close_price: 0 }, // corrupt: dropped
      { date: "2026-06-04", close_price: "103.5" }, // PostgREST numeric-as-string
      { date: "2026-06-05", close_price: 104 },
    ]);
    const { GET } = await import("./route");
    const res = await GET(new Request(URL_));
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe(
      "public, s-maxage=3600, stale-while-revalidate=86400",
    );
    const body = (await res.json()) as Body;
    expect(Object.keys(body).sort()).toEqual(["dropped", "prices", "through"]);

    // D-09: the fixture fills 05-29..05-31 and nothing on or after 06-01.
    expect(body.prices).toEqual([
      { date: "2026-05-29", close: 90 },
      { date: "2026-05-30", close: 91 },
      { date: "2026-05-31", close: 92 },
      { date: "2026-06-01", close: 100 },
      { date: "2026-06-02", close: 101 },
      { date: "2026-06-04", close: 103.5 },
      { date: "2026-06-05", close: 104 },
    ]);
    expect(body.prices.some((p) => p.close === 7777 || p.close === 8888)).toBe(
      false,
    );
    expect(body.dropped).toEqual(["2026-06-03"]);
    expect(body.prices.some((p) => p.date === "2026-06-03")).toBe(false);
    expect(body.through).toBe("2026-06-05");
    expect(mockEq).toHaveBeenCalledWith("symbol", "BTC");
  });

  it("cuts the fixture at a DROPPED first stored row, not at the first valid close (169.2 MD-R2-01)", async () => {
    setRows([
      { date: "2026-05-31", close_price: -1 }, // first STORED row, corrupt
      { date: "2026-06-01", close_price: 100 },
      { date: "2026-06-02", close_price: 101 },
    ]);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { GET } = await import("./route");
    const res = await GET(new Request(URL_));
    const body = (await res.json()) as Body;
    warn.mockRestore();
    // The fixture's 05-31 close (92) must not fill the dropped stored date.
    expect(body.prices.map((p) => p.date)).toEqual([
      "2026-05-29",
      "2026-05-30",
      "2026-06-01",
      "2026-06-02",
    ]);
    expect(body.dropped).toEqual(["2026-05-31"]);
    // The corrupt row is reported server-side, not silently dropped.
    const { captureToSentry } = await import("@/lib/sentry-capture");
    expect(captureToSentry).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({
        tags: { route: "api/benchmark/btc/prices", stage: "dropped-closes" },
      }),
    );
  });

  it("answers a read error with a static 503 + no-store, never the fixture, and captures it", async () => {
    table.rows = null;
    table.error = { message: "boom", code: "PGRST500" };
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const { GET } = await import("./route");
    const res = await GET(new Request(URL_));
    err.mockRestore();
    expect(res.status).toBe(503);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    const body = await res.json();
    expect(body).toEqual({ error: "Benchmark temporarily unavailable" });
    const { captureToSentry } = await import("@/lib/sentry-capture");
    expect(captureToSentry).toHaveBeenCalledWith(
      table.error,
      expect.objectContaining({
        tags: { route: "api/benchmark/btc/prices", stage: "read" },
      }),
    );
  });

  it("serves the whole fixture when the table holds no row at all (nothing stored to cut at)", async () => {
    setRows([]);
    const { GET } = await import("./route");
    const res = await GET(new Request(URL_));
    expect(res.status).toBe(200);
    const body = (await res.json()) as Body;
    expect(body.prices.map((p) => p.date)).toEqual([
      "2026-05-29",
      "2026-05-30",
      "2026-05-31",
      "2026-06-01",
      "2026-06-02",
    ]);
    expect(body.dropped).toEqual([]);
    expect(body.through).toBe("2026-06-02");
  });

  it("end to end (SC11): the route's closes, parsed and paired, never pair the move that bridges a missing stored day", async () => {
    // Stored closes 06-01..06-12 with 06-07 MISSING (not dropped: simply absent).
    const closes: Record<string, number> = {
      "2026-06-01": 100,
      "2026-06-02": 102,
      "2026-06-03": 101,
      "2026-06-04": 105,
      "2026-06-05": 104,
      "2026-06-06": 108,
      // 2026-06-07 missing
      "2026-06-08": 111,
      "2026-06-09": 109,
      "2026-06-10": 112,
      "2026-06-11": 113,
      "2026-06-12": 115,
    };
    setRows(
      Object.entries(closes).map(([date, close_price]) => ({ date, close_price })),
    );
    const { GET } = await import("./route");
    const res = await GET(new Request(URL_));
    expect(res.status).toBe(200);
    const parsed = parseBtcCloses(await res.json());
    expect(parsed).not.toBeNull();

    // A 7-day portfolio whose range spans the missing BTC date.
    const portfolio = [
      "2026-06-04",
      "2026-06-05",
      "2026-06-06",
      "2026-06-07",
      "2026-06-08",
      "2026-06-09",
      "2026-06-10",
    ].map((date, i) => ({ date, value: 0.001 * (i + 1) }));

    const out = pairScenarioWithBtc(portfolio, parsed!);
    // 06-07 has no close; 06-08's BTC point is the bridged 06-06 -> 06-08 move,
    // two days stamped as one. Neither is paired.
    expect(out.dates).toEqual([
      "2026-06-04",
      "2026-06-05",
      "2026-06-06",
      "2026-06-09",
      "2026-06-10",
    ]);
    const prevStored: Record<string, string> = {
      "2026-06-04": "2026-06-03",
      "2026-06-05": "2026-06-04",
      "2026-06-06": "2026-06-05",
      "2026-06-09": "2026-06-08",
      "2026-06-10": "2026-06-09",
    };
    out.dates.forEach((d, i) => {
      expect(out.b[i]).toBe(closes[d] / closes[prevStored[d]] - 1);
      expect(out.p[i]).toBe(portfolio.find((x) => x.date === d)!.value);
    });
  });
});
