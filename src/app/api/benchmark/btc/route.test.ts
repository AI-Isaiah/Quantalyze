import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Phase 24 / Plan 24-02 — GET /api/benchmark/btc
 *
 * Wave-0 RED test (BENCH-01 read path). Pins the BTC daily-returns series
 * contract BEFORE the route exists:
 *   - [{date, value}] shape, ascending by date, pct-change of close_price,
 *     first row dropped (no prior close) — mirrors benchmark.py prices_to_returns.
 *   - PUBLIC cacheable Cache-Control (shared market data) — NOT no-store/private.
 *   - An empty table is HTTP 200 with [] (honest empty state).
 *   - A read error is 503 + no-store (Phase 169.2, SFH MD-05): never a cached 200 [].
 *   - NO tenant/user data — every object has exactly {date, value}.
 *
 * The supabase server client is mocked so the test is hermetic; the
 * `.from().select().eq()[.lt()].order().limit()` chain (keyset-paged since
 * Phase 169.2) resolves against a per-test table.
 */

// The fake client mirrors PostgREST: `.from().select().eq()`, an optional
// keyset cursor `.lt("date", d)`, then `.order().limit(n)`. EVERY page is
// capped at `table.cap` rows, the way `max_rows` caps a real read, and answers
// 200 with a partial body. That cap is what the pre-169.2 route fell to: an
// unranged ascending read of a table larger than the cap returned the OLDEST
// rows and never the newest.
const { table, mockOrder, mockEq, mockLimit, mockFrom } = vi.hoisted(() => {
  type Row = { date: string; close_price: unknown };
  const table: {
    rows: Row[] | null;
    error: unknown;
    cap: number;
  } = { rows: [], error: null, cap: 1000 };

  function answer(ascending: boolean, cursor: string | null, n: number) {
    if (table.error) return { data: null, error: table.error };
    if (table.rows === null) return { data: null, error: null };
    const sorted = table.rows
      .filter((r) => cursor === null || r.date < cursor)
      .sort((a, b) =>
        ascending ? a.date.localeCompare(b.date) : b.date.localeCompare(a.date),
      );
    return { data: sorted.slice(0, Math.min(n, table.cap)), error: null };
  }

  const mockLimit = vi.fn();
  const mockOrder = vi.fn();
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
      order: (col: string, o: { ascending: boolean }) => {
        mockOrder(col, o);
        const ascending = o?.ascending !== false;
        return {
          limit: (n: number) => {
            mockLimit(n);
            return Promise.resolve(answer(ascending, cursor, n));
          },
        };
      },
    };
    return b;
  });
  return { table, mockOrder, mockEq, mockLimit, mockFrom };
});

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ from: mockFrom }),
}));

// Silence the route's server-side error log in the error-degrade test.
vi.mock("@/lib/sentry-capture", () => ({ captureToSentry: vi.fn() }));

// Rate limit (publicIpLimiter). `rlResult` controls the mocked checkLimit;
// it defaults to success so the existing data-contract tests below are
// unaffected, and the two rate-limit tests flip it to deny (429 / 503).
const { rlResult } = vi.hoisted(() => ({
  rlResult: { value: { success: true } as Record<string, unknown> },
}));
vi.mock("@/lib/ratelimit", () => ({
  publicIpLimiter: {},
  checkLimit: vi.fn(async () => rlResult.value),
  getClientIp: vi.fn(() => "test-ip"),
  isRateLimitMisconfigured: (r: { reason?: string }) =>
    r?.reason === "ratelimit_misconfigured",
}));

function setRows(rows: Array<{ date: string; close_price: number }>) {
  table.rows = rows;
  table.error = null;
}

function setError() {
  table.rows = null;
  table.error = { message: "boom", code: "PGRST500" };
}

describe("GET /api/benchmark/btc", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    table.rows = [];
    table.error = null;
    table.cap = 1000;
    rlResult.value = { success: true };
  });

  it("rate-limits anonymous abuse with 429 (public route has no session gate left)", async () => {
    // Being in PUBLIC_ROUTES (proxy.ts) removed the implicit session-gate that
    // was this route's only request cap. The per-IP limiter is now the abuse
    // defense against cache-busted (`?x=rand`) hammering of the unbounded SELECT.
    rlResult.value = { success: false, retryAfter: 30 };
    const { GET } = await import("./route");
    const res = await GET(new Request("https://x/api/benchmark/btc"));
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBe("30");
    // A deny must NOT be cached as if it were the benchmark series.
    expect(res.headers.get("Cache-Control") ?? "").not.toContain("s-maxage");
    // It must not have touched the DB.
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it("returns 503 (fail-closed) when the limiter is misconfigured", async () => {
    rlResult.value = {
      success: false,
      retryAfter: 60,
      reason: "ratelimit_misconfigured",
    };
    const { GET } = await import("./route");
    const res = await GET(new Request("https://x/api/benchmark/btc"));
    expect(res.status).toBe(503);
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it("returns BTC daily returns as [{date,value}], ascending, pct-changed (first row dropped)", async () => {
    // closes: 100 → 110 (+10%) → 99 (−10%). First date has no prior close ⇒ dropped.
    setRows([
      { date: "2024-01-01", close_price: 100 },
      { date: "2024-01-02", close_price: 110 },
      { date: "2024-01-03", close_price: 99 },
    ]);

    const { GET } = await import("./route");
    const res = await GET();
    expect(res.status).toBe(200);

    const body = (await res.json()) as Array<{ date: string; value: number }>;
    expect(body).toHaveLength(2);
    expect(body[0].date).toBe("2024-01-02");
    expect(body[0].value).toBeCloseTo(0.1, 10); // 110/100 − 1
    expect(body[1].date).toBe("2024-01-03");
    expect(body[1].value).toBeCloseTo(-0.1, 10); // 99/110 − 1

    // dates ascending, and the first INPUT date is absent (no prior close)
    expect(body.map((r) => r.date)).toEqual([...body.map((r) => r.date)].sort());
    expect(body.some((r) => r.date === "2024-01-01")).toBe(false);
  });

  it("queries benchmark_prices for symbol BTC newest-first, in keyset .limit() pages", async () => {
    // Phase 169.2 (D-08): this case used to pin `{ ascending: true }` on an
    // unranged read, which was the defect itself — PostgREST caps that read at
    // max_rows and returns the OLDEST rows. The read is now newest-first and
    // keyset-paged; the reader hands the route an ascending series for the
    // pct-change loop.
    setRows([
      { date: "2024-01-01", close_price: 100 },
      { date: "2024-01-02", close_price: 110 },
    ]);
    const { GET } = await import("./route");
    await GET();

    expect(mockFrom).toHaveBeenCalledWith("benchmark_prices");
    expect(mockEq).toHaveBeenCalledWith("symbol", "BTC");
    expect(mockOrder).toHaveBeenCalledWith("date", { ascending: false });
    expect(mockLimit).toHaveBeenCalledWith(1000);
  });

  it("returns the NEWEST stored BTC day when the table holds more rows than one capped read", async () => {
    // 1500 stored days behind a 1000-row max_rows cap. The pre-169.2 route read
    // unranged + ascending, so its last point was the 1000th-OLDEST day and the
    // newest 500 days never reached the Scenario composer.
    const rows = Array.from({ length: 1500 }, (_, i) => ({
      date: new Date(Date.UTC(2021, 0, 1) + i * 86_400_000)
        .toISOString()
        .slice(0, 10),
      close_price: 20_000 + i,
    }));
    setRows(rows);

    const { GET } = await import("./route");
    const res = await GET();
    const body = (await res.json()) as Array<{ date: string; value: number }>;

    expect(res.status).toBe(200);
    expect(body[body.length - 1].date).toBe(rows[1499].date);
    expect(body[0].date).toBe(rows[1].date);
    expect(body).toHaveLength(1499);
  });

  it("sets a PUBLIC cacheable Cache-Control header (not no-store / private)", async () => {
    setRows([
      { date: "2024-01-01", close_price: 100 },
      { date: "2024-01-02", close_price: 110 },
    ]);
    const { GET } = await import("./route");
    const res = await GET();

    const cc = res.headers.get("Cache-Control") ?? "";
    expect(cc).toContain("public");
    expect(cc).not.toContain("no-store");
    expect(cc).not.toContain("private");
  });

  it("answers a read error with 503 + no-store (never a cached 200 []) AND captures the error", async () => {
    // Phase 169.2 SFH MD-05: this case used to pin `200 []` with the PUBLIC
    // s-maxage/SWR header, which pinned ONE transient PostgREST error at the
    // CDN as "no benchmark" for up to an hour (a day stale). Both callers
    // (ScenarioComposer, the scenario-share page) treat any non-2xx as the
    // neutral "unavailable" state, so the UI is unchanged; what changes is that
    // the next request retries the read.
    setError();
    const { GET } = await import("./route");
    const res = await GET();

    expect(res.status).toBe(503);
    const cc = res.headers.get("Cache-Control") ?? "";
    expect(cc).toContain("no-store");
    expect(cc).not.toContain("s-maxage");
    expect(cc).not.toContain("public");
    // Static body: the raw DB error never reaches the caller.
    expect(await res.json()).toEqual({ error: "Benchmark temporarily unavailable" });

    // The error path MUST stay observable — a refactor that drops the
    // server-side capture would otherwise make this a true silent failure
    // with a green suite. Pin that captureToSentry fired with the route tag.
    const { captureToSentry } = await import("@/lib/sentry-capture");
    expect(captureToSentry).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        tags: expect.objectContaining({ route: "api/benchmark/btc" }),
      }),
    );
  });

  it("returns 200 [] (cacheable) for an EMPTY benchmark_prices table", async () => {
    setRows([]);
    const { GET } = await import("./route");
    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([]);
    expect(res.headers.get("Cache-Control") ?? "").toContain("public");
  });

  it("treats a page with neither data nor an error as a READ ERROR (503), not an empty table", async () => {
    // SFH LW-03: a null page used to end the read as if the table were empty.
    table.rows = null;
    table.error = null;
    const { GET } = await import("./route");
    const res = await GET();
    expect(res.status).toBe(503);
    expect(res.headers.get("Cache-Control") ?? "").toContain("no-store");
  });

  it("exposes NO tenant data — every object has exactly {date, value}", async () => {
    setRows([
      { date: "2024-01-01", close_price: 100 },
      { date: "2024-01-02", close_price: 110 },
      { date: "2024-01-03", close_price: 121 },
    ]);
    const { GET } = await import("./route");
    const res = await GET();
    const body = (await res.json()) as Array<Record<string, unknown>>;

    expect(body.length).toBeGreaterThan(0);
    for (const row of body) {
      expect(Object.keys(row).sort()).toEqual(["date", "value"]);
      expect(row).not.toHaveProperty("symbol");
      expect(row).not.toHaveProperty("close_price");
    }
  });

  it("coerces STRING close_price (PostgREST DECIMAL-as-string) to a correct non-empty series", async () => {
    // PostgREST serializes Postgres numeric/DECIMAL columns as JSON STRINGS to
    // preserve precision (even though database.types.ts types close_price as
    // `number`). The route MUST coerce both ends with Number(...) before the
    // finite/positive guards — otherwise the per-point `typeof !== "number"`
    // guard is true for EVERY string row, every row hits `continue`, and the
    // route returns [] for valid prod data (the feature shows "unavailable").
    setRows([
      { date: "2024-01-01", close_price: "68000.00" },
      { date: "2024-01-02", close_price: "68000.50" },
      { date: "2024-01-03", close_price: "67320.495" }, // −1% from prior
    ] as unknown as Array<{ date: string; close_price: number }>);

    const { GET } = await import("./route");
    const res = await GET();
    expect(res.status).toBe(200);

    const body = (await res.json()) as Array<{ date: string; value: number }>;
    // Must be non-empty: the string rows must NOT all be dropped by the guard.
    expect(body).toHaveLength(2);
    expect(body[0].date).toBe("2024-01-02");
    expect(body[0].value).toBeCloseTo(68000.5 / 68000 - 1, 10);
    expect(body[1].date).toBe("2024-01-03");
    expect(body[1].value).toBeCloseTo(67320.495 / 68000.5 - 1, 10);
    for (const r of body) expect(Number.isFinite(r.value)).toBe(true);
  });

  it("skips a point with a non-positive prior close instead of emitting Infinity/NaN", async () => {
    // prevClose 0 would divide-by-zero; that point must be skipped, not NaN/Infinity.
    setRows([
      { date: "2024-01-01", close_price: 0 },
      { date: "2024-01-02", close_price: 100 },
      { date: "2024-01-03", close_price: 110 },
    ]);
    const { GET } = await import("./route");
    const res = await GET();
    const body = (await res.json()) as Array<{ date: string; value: number }>;

    for (const r of body) {
      expect(Number.isFinite(r.value)).toBe(true);
    }
    // the 2024-01-02 point (prevClose=0) is skipped; only 2024-01-03 survives
    expect(body).toEqual([{ date: "2024-01-03", value: expect.any(Number) }]);
    expect(body[0].value).toBeCloseTo(0.1, 10); // 110/100 − 1
  });

  it("skips a point with a non-positive CURRENT close (finite-but-corrupt return)", async () => {
    // A zero/negative `close` yields a finite return <= -1 (<= -100%/day) that
    // passes the Number.isFinite(value) check and would silently poison TE/IR/beta.
    //
    // Phase 169.2 (review WR-04 / SFH MD-03): the shared reader now leaves the
    // 0 close out of `prices` and REPORTS its date in `dropped`. The route must
    // not bridge that hole: 110/100 − 1 stamped at 2024-01-03 would be a
    // TWO-day move presented as a one-day return. So, exactly as before 169.2,
    // a bad close at D yields no return at D and none at the next stored day.
    // (This expectation was briefly rewritten to accept the bridged return; it
    // is restored here.)
    setRows([
      { date: "2024-01-01", close_price: 100 },
      { date: "2024-01-02", close_price: 0 }, // close <= 0 → left out, date reported
      { date: "2024-01-03", close_price: 110 }, // would bridge the hole → skipped
      { date: "2024-01-04", close_price: 121 },
    ]);
    const { GET } = await import("./route");
    const res = await GET();
    const body = (await res.json()) as Array<{ date: string; value: number }>;

    for (const r of body) {
      expect(Number.isFinite(r.value)).toBe(true);
      expect(r.value).toBeGreaterThan(-1); // no <= -100%/day corruption leaks through
    }
    expect(body).toEqual([{ date: "2024-01-04", value: expect.any(Number) }]);
    expect(body[0].value).toBeCloseTo(0.1, 10); // 121/110 − 1

    // The corrupt row is made visible, not silently dropped.
    const { captureToSentry } = await import("@/lib/sentry-capture");
    expect(captureToSentry).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        tags: expect.objectContaining({ stage: "dropped-closes" }),
        extra: { dropped: ["2024-01-02"] },
      }),
    );
  });
});
