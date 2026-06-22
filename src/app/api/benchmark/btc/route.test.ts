import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Phase 24 / Plan 24-02 — GET /api/benchmark/btc
 *
 * Wave-0 RED test (BENCH-01 read path). Pins the BTC daily-returns series
 * contract BEFORE the route exists:
 *   - [{date, value}] shape, ascending by date, pct-change of close_price,
 *     first row dropped (no prior close) — mirrors benchmark.py prices_to_returns.
 *   - PUBLIC cacheable Cache-Control (shared market data) — NOT no-store/private.
 *   - Read error degrades to HTTP 200 with [] (honest empty state, never 500/red).
 *   - NO tenant/user data — every object has exactly {date, value}.
 *
 * The supabase server client is mocked so the test is hermetic; the
 * `.from().select().eq().order()` chain resolves to a per-test fixture.
 */

// The route awaits `.from("benchmark_prices").select("date, close_price")
//   .eq("symbol","BTC").order("date",{ascending:true})` → { data, error }.
// `orderResult` is what that terminal `.order(...)` resolves to; each test
// sets it before invoking GET.
const { orderResult, mockOrder, mockEq, mockFrom } = vi.hoisted(
  () => {
    const orderResult: { value: { data: unknown; error: unknown } } = {
      value: { data: [], error: null },
    };
    const mockOrder = vi.fn(async () => orderResult.value);
    const mockEq = vi.fn(() => ({ order: mockOrder }));
    const mockSelect = vi.fn(() => ({ eq: mockEq }));
    const mockFrom = vi.fn(() => ({ select: mockSelect }));
    return { orderResult, mockOrder, mockEq, mockSelect, mockFrom };
  },
);

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ from: mockFrom }),
}));

// Silence the route's server-side error log in the error-degrade test.
vi.mock("@/lib/sentry-capture", () => ({ captureToSentry: vi.fn() }));

function setRows(rows: Array<{ date: string; close_price: number }>) {
  orderResult.value = { data: rows, error: null };
}

function setError() {
  orderResult.value = {
    data: null,
    error: { message: "boom", code: "PGRST500" },
  };
}

describe("GET /api/benchmark/btc", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    orderResult.value = { data: [], error: null };
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

  it("queries benchmark_prices for symbol BTC ordered by date ascending", async () => {
    setRows([
      { date: "2024-01-01", close_price: 100 },
      { date: "2024-01-02", close_price: 110 },
    ]);
    const { GET } = await import("./route");
    await GET();

    expect(mockFrom).toHaveBeenCalledWith("benchmark_prices");
    expect(mockEq).toHaveBeenCalledWith("symbol", "BTC");
    expect(mockOrder).toHaveBeenCalledWith("date", { ascending: true });
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

  it("degrades to HTTP 200 with [] on a read error (never 500) AND captures the error", async () => {
    setError();
    const { GET } = await import("./route");
    const res = await GET();

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual([]);
    // still cacheable on the degraded path
    expect(res.headers.get("Cache-Control") ?? "").toContain("public");

    // The degrade path MUST stay observable — a refactor that drops the
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

  it("returns [] for an empty / missing benchmark_prices result (200)", async () => {
    orderResult.value = { data: null, error: null };
    const { GET } = await import("./route");
    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([]);
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
    // The numerator must be guarded for positivity, not only finiteness.
    setRows([
      { date: "2024-01-01", close_price: 100 },
      { date: "2024-01-02", close_price: 0 }, // close <= 0 → point skipped
      { date: "2024-01-03", close_price: 110 }, // prevClose=0 → also skipped
      { date: "2024-01-04", close_price: 121 },
    ]);
    const { GET } = await import("./route");
    const res = await GET();
    const body = (await res.json()) as Array<{ date: string; value: number }>;

    for (const r of body) {
      expect(Number.isFinite(r.value)).toBe(true);
      expect(r.value).toBeGreaterThan(-1); // no <= -100%/day corruption leaks through
    }
    // Only 2024-01-04 (121/110 − 1) survives; the 0-close point and its successor drop.
    expect(body).toEqual([{ date: "2024-01-04", value: expect.any(Number) }]);
    expect(body[0].value).toBeCloseTo(0.1, 10); // 121/110 − 1
  });
});
