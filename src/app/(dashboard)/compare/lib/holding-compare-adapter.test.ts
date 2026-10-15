/**
 * Unit tests for holding-compare-adapter.ts.
 *
 * Phase 09: parseHoldingCompareId including the finding-f6 charset validation.
 * Phase 167.1.1 / D-03: the per-holding metrics are computed from the holding's
 * daily mark price (`allocator_holdings.mark_price`), never from its dollar
 * value. The describe at the bottom pins that with hand-typed oracles.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  parseHoldingCompareId,
  fetchHoldingCompareItem,
  analyzePriceSeries,
  dailyMarkPrices,
  holdingCompareHistoryState,
  HOLDING_COMPARE_MIN_PRICED_DAYS,
  HOLDING_COMPARE_MAX_PAGES,
  HoldingCompareLoadError,
  HoldingMarkContractError,
  FIXED_MARK_SET,
  holdingMarkIsFixed,
  holdingWithheldReason,
  classifySpotMarks,
  classifyDerivativeMarks,
  analyzeSignedReturns,
  HOLDING_MARK_WITHHELD_REASONS,
} from "./holding-compare-adapter";
import { HoldingsUpdatedAtError } from "@/lib/holdings-account-day";
import { CRYPTO_EXCHANGES, isCryptoExchange } from "@/lib/closed-sets";

// ---------------------------------------------------------------------------
// A filter-honouring Supabase stub for the paged `allocator_holdings` read.
// Modelled on `fakeClient` in HoldingsTabPanel.exposure-agreement.test.tsx: it
// records every table, select, eq/gte filter and range, applies the filters,
// sorts by the order calls, projects to the selected columns and slices the
// range. A stub that ended at `.limit()` could not tell a filtered read from an
// unfiltered one.
// ---------------------------------------------------------------------------
type HoldingFx = {
  allocator_id: string;
  venue: string;
  symbol: string;
  holding_type: string;
  asof: string;
  mark_price: unknown;
  value_usd: number;
  updated_at: string;
  api_key_id: string;
};

type Recorded = {
  tables: string[];
  selects: string[];
  eqs: Array<[string, unknown]>;
  gtes: Array<[string, unknown]>;
  ranges: Array<[number, number]>;
};

function newRecorded(): Recorded {
  return { tables: [], selects: [], eqs: [], gtes: [], ranges: [] };
}

function fakeSupabase(
  fixtures: HoldingFx[],
  rec: Recorded = newRecorded(),
  opts: { error?: { message: string }; alwaysFullPage?: boolean } = {},
): SupabaseClient {
  const world = fixtures.map((r, i) => ({ id: String(i).padStart(8, "0"), ...r }));
  return {
    from(table: string) {
      rec.tables.push(table);
      const eqs: Array<[string, unknown]> = [];
      const gtes: Array<[string, unknown]> = [];
      const orders: Array<{ column: string; ascending: boolean }> = [];
      let select = "";
      let range: [number, number] | null = null;
      const chain = {
        select(c: string) {
          select = c;
          rec.selects.push(c);
          return chain;
        },
        eq(c: string, v: unknown) {
          eqs.push([c, v]);
          rec.eqs.push([c, v]);
          return chain;
        },
        gte(c: string, v: unknown) {
          gtes.push([c, v]);
          rec.gtes.push([c, v]);
          return chain;
        },
        order(c: string, o: { ascending: boolean }) {
          orders.push({ column: c, ascending: o.ascending });
          return chain;
        },
        range(from: number, to: number) {
          range = [from, to];
          rec.ranges.push([from, to]);
          return chain;
        },
        then(resolve: (v: unknown) => void) {
          if (opts.error) {
            resolve({ data: null, error: opts.error });
            return;
          }
          const columns = select.split(",").map((c) => c.trim());
          const size = range ? range[1] - range[0] + 1 : world.length;
          if (opts.alwaysFullPage) {
            resolve({
              data: Array.from({ length: size }, () =>
                Object.fromEntries(columns.map((c) => [c, "x"])),
              ),
              error: null,
            });
            return;
          }
          let rows = world.filter((r) =>
            eqs.every(([c, v]) => (r as Record<string, unknown>)[c] === v),
          );
          rows = rows.filter((r) =>
            gtes.every(([c, v]) => String((r as Record<string, unknown>)[c]) >= String(v)),
          );
          rows = [...rows].sort((a, b) => {
            for (const { column, ascending } of orders) {
              const x = String((a as Record<string, unknown>)[column]);
              const y = String((b as Record<string, unknown>)[column]);
              if (x !== y) return (x < y ? -1 : 1) * (ascending ? 1 : -1);
            }
            return 0;
          });
          if (range) rows = rows.slice(range[0], range[1] + 1);
          resolve({
            data: rows.map((r) =>
              Object.fromEntries(
                columns.map((c) => [c, (r as Record<string, unknown>)[c]]),
              ),
            ),
            error: null,
          });
        },
      };
      return chain;
    },
  } as unknown as SupabaseClient;
}

const ALLOC = "alloc-1";
const REF = "holding:binance:BTC:spot";

/** Calendar day `n` (1-based) of the fixture calendar, as YYYY-MM-DD (UTC). */
function day(n: number): string {
  const d = new Date(Date.UTC(2026, 0, n)); // 2026-01-01 is day 1
  return d.toISOString().slice(0, 10);
}

/** One BTC spot row on binance for fixture day `n`. */
function row(
  n: number,
  mark: unknown,
  extra: Partial<HoldingFx> = {},
): HoldingFx {
  return {
    allocator_id: ALLOC,
    venue: "binance",
    symbol: "BTC",
    holding_type: "spot",
    asof: day(n),
    mark_price: mark,
    value_usd: typeof mark === "number" ? mark : 0,
    updated_at: `${day(n)}T10:00:00Z`,
    api_key_id: "key-a",
    ...extra,
  };
}

describe("parseHoldingCompareId (unit)", () => {
  it("parses valid holding id", () => {
    expect(parseHoldingCompareId("holding:binance:BTC:spot")).toEqual({
      venue: "binance",
      symbol: "BTC",
      holding_type: "spot",
    });
  });

  it("accepts underscores and hyphens in parts (matches Phase 08 D-08 scope_ref charset)", () => {
    expect(parseHoldingCompareId("holding:binance_us:BTC-USD:spot")).toEqual({
      venue: "binance_us",
      symbol: "BTC-USD",
      holding_type: "spot",
    });
  });

  it("returns null for UUID", () => {
    expect(
      parseHoldingCompareId("11111111-2222-3333-4444-555555555555"),
    ).toBeNull();
  });

  it("returns null for malformed prefix", () => {
    expect(parseHoldingCompareId("holding:malformed")).toBeNull();
    expect(parseHoldingCompareId("holding:a:b:c:d")).toBeNull();
    expect(parseHoldingCompareId("not-a-holding")).toBeNull();
  });

  describe("finding f6 — charset validation against [A-Za-z0-9_-]", () => {
    it("rejects holding_ref with '/' in symbol", () => {
      expect(parseHoldingCompareId("holding:binance:BTC/USDT:spot")).toBeNull();
    });

    it("rejects holding_ref with ';' (SQL-injection-style)", () => {
      expect(
        parseHoldingCompareId("holding:binance:BTC;drop:spot"),
      ).toBeNull();
    });

    it("rejects holding_ref with space in venue", () => {
      expect(
        parseHoldingCompareId("holding:bin ance:BTC:spot"),
      ).toBeNull();
    });

    it("rejects holding_ref with quote in holding_type", () => {
      expect(
        parseHoldingCompareId('holding:binance:BTC:sp"ot'),
      ).toBeNull();
    });

    it("rejects empty parts (finding f6)", () => {
      expect(parseHoldingCompareId("holding::BTC:spot")).toBeNull();
      expect(parseHoldingCompareId("holding:binance::spot")).toBeNull();
      expect(parseHoldingCompareId("holding:binance:BTC:")).toBeNull();
    });
  });
});

// The CL9 terminus-suppression, the 167.1.2 "rebuilding" switch pin and the
// plan-11 "ready" flip describes are gone: the terminus flag belongs to the
// allocator_equity_snapshots reconstruction that D-03 retires, and the global
// switch and its test seam no longer exist.

// ---------------------------------------------------------------------------
// Phase 167.1.1 / D-03 (founder, 2026-10-15): each holding's return, Sharpe,
// max drawdown and vol are computed from that holding's daily PRICE change,
// never from its dollar value. WHY it matters: the retired read took ratios of
// the holding's dollar value, so buying or selling more of an asset printed a
// gain or a loss on /compare. Every oracle below is typed by hand from the
// price series, not computed by the code under test.
// ---------------------------------------------------------------------------
describe("D-03: per-holding metrics from the daily mark price", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-01T12:00:00Z"));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("a purchase at a constant mark reads 0% (the dollar-ratio read gave +100%)", async () => {
    // 40 consecutive days, the mark never moves; the quantity doubles on day 21
    // so the dollar value goes 50000 -> 100000.
    const rows = Array.from({ length: 40 }, (_, i) =>
      row(i + 1, 50000, { value_usd: i + 1 <= 20 ? 50000 : 100000 }),
    );
    const item = await fetchHoldingCompareItem({
      allocator_id: ALLOC,
      holding_ref: REF,
      supabase: fakeSupabase(rows),
    });
    expect(item).not.toBeNull();
    expect(item!.historyState).toBe("ready");
    const a = item!.analytics!;
    expect(a.cumulative_return).toBe(0);
    expect(a.max_drawdown).toBe(0);
    expect(a.vol).toBe(0);
    expect(a.sharpe).toBeNull();
    expect(a.priced_days).toBe(40);
  });

  it("a price move is read from the price: 100 for 30 days then 110 is +10%", async () => {
    const rows = Array.from({ length: 31 }, (_, i) =>
      row(i + 1, i + 1 <= 30 ? 100 : 110),
    );
    const item = await fetchHoldingCompareItem({
      allocator_id: ALLOC,
      holding_ref: REF,
      supabase: fakeSupabase(rows),
    });
    expect(item!.historyState).toBe("ready");
    expect(item!.analytics!.cumulative_return).toBeCloseTo(0.1, 12);
    expect(item!.analytics!.max_drawdown).toBe(0);
    expect(item!.analytics!.priced_days).toBe(31);
  });

  it("reads allocator_holdings only, with exactly the four price columns and the holding's filters", async () => {
    const rec = newRecorded();
    const rows = Array.from({ length: 31 }, (_, i) => row(i + 1, 100));
    await fetchHoldingCompareItem({
      allocator_id: ALLOC,
      holding_ref: REF,
      supabase: fakeSupabase(rows, rec),
    });
    expect(rec.tables.length).toBeGreaterThan(0);
    expect(rec.tables.every((t) => t === "allocator_holdings")).toBe(true);
    for (const s of rec.selects) {
      expect(new Set(s.split(",").map((c) => c.trim()))).toEqual(
        new Set(["asof", "mark_price", "updated_at", "api_key_id"]),
      );
    }
    expect(rec.eqs).toEqual(
      expect.arrayContaining([
        ["allocator_id", ALLOC],
        ["venue", "binance"],
        ["symbol", "BTC"],
        ["holding_type", "spot"],
      ]),
    );
    expect(rec.gtes.map(([c]) => c)).toContain("asof");
  });

  it("MIN is the founder's measured unit: 30 priced days", () => {
    expect(HOLDING_COMPARE_MIN_PRICED_DAYS).toBe(30);
  });

  it("analyzePriceSeries on consecutive days: +10% with no drawdown, hand-typed", () => {
    const a = analyzePriceSeries(
      [
        { asof: "2026-01-01", price: 100 },
        { asof: "2026-01-02", price: 110 },
      ],
      365,
    );
    expect(a.cumulative_return).toBeCloseTo(0.1, 12);
    expect(a.max_drawdown).toBe(0);
  });

  // ---- Task 2: gaps, adjacency, MIN, one price per day, types and venues ----

  it("a multi-day gap is not a return: only the two adjacent-day moves feed vol and Sharpe", () => {
    // Hand-typed. Daily returns exist only Jan 1->2 (+10%) and Jan 2->3 (-10%);
    // Jan 3 -> Jan 8 spans four missing days and is NOT a return.
    //   vol    = sd{+0.10, -0.10} * sqrt(365) = 0.1 * sqrt(365)
    //   sharpe = mean 0 / sd -> 0
    //   cumulative = 108.9 / 100 - 1 = 0.089 (price levels, no adjacency needed)
    //   max drawdown = (99 - 110) / 110 = -0.1
    // Read as one return, the gap would give vol about 1.80 and Sharpe about 6.75.
    const a = analyzePriceSeries(
      [
        { asof: "2026-01-01", price: 100 },
        { asof: "2026-01-02", price: 110 },
        { asof: "2026-01-03", price: 99 },
        { asof: "2026-01-08", price: 108.9 },
      ],
      365,
    );
    expect(a.vol!).toBeCloseTo(1.9104973, 6);
    expect(a.sharpe!).toBeCloseTo(0, 6);
    expect(a.cumulative_return!).toBeCloseTo(0.089, 12);
    expect(a.max_drawdown!).toBeCloseTo(-0.1, 12);
  });

  it("fewer than two adjacent-day returns leave vol and Sharpe null on their own, while level metrics stay", () => {
    const a = analyzePriceSeries(
      [
        { asof: "2026-01-01", price: 100 },
        { asof: "2026-01-02", price: 110 },
        { asof: "2026-01-09", price: 121 },
      ],
      365,
    );
    expect(a.vol).toBeNull();
    expect(a.sharpe).toBeNull();
    expect(a.cumulative_return!).toBeCloseTo(0.21, 12);
    expect(a.max_drawdown).toBe(0);
  });

  it("fewer than two points: four nulls, never zero", () => {
    expect(analyzePriceSeries([], 365)).toEqual({
      cumulative_return: null, sharpe: null, max_drawdown: null, vol: null,
    });
    expect(analyzePriceSeries([{ asof: "2026-01-01", price: 5 }], 365)).toEqual({
      cumulative_return: null, sharpe: null, max_drawdown: null, vol: null,
    });
  });

  it("a mark of 0 (the writer's failed-ticker sentinel) is a gap, not a price and not a -100% day", async () => {
    // Days 1-16 and 18-32 are priced at 100 (31 days); day 17 only has mark 0.
    const rows = [
      ...Array.from({ length: 16 }, (_, i) => row(i + 1, 100)),
      row(17, 0),
      ...Array.from({ length: 15 }, (_, i) => row(i + 18, 100)),
    ];
    const item = await fetchHoldingCompareItem({
      allocator_id: ALLOC, holding_ref: REF, supabase: fakeSupabase(rows),
    });
    const a = item!.analytics!;
    expect(a.priced_days).toBe(31);
    expect(a.cumulative_return).toBe(0);
    expect(a.max_drawdown).toBe(0);
  });

  it("a finite mark at or below 0 is a silent gap (the failed-ticker sentinel and a negative), never a price", () => {
    const at = "2026-01-01T10:00:00Z";
    const out = dailyMarkPrices([
      { asof: "2026-01-01", mark_price: -5, updated_at: at, api_key_id: "key-a" },
      { asof: "2026-01-02", mark_price: 0, updated_at: at, api_key_id: "key-a" },
      { asof: "2026-01-06", mark_price: 7, updated_at: at, api_key_id: "key-a" },
    ]);
    expect(out).toEqual([{ asof: "2026-01-06", price: 7 }]);
  });

  // SFH-03 (167.1.1 round 1): a mark that is not a number, or an asof that is not
  // a YYYY-MM-DD day, is a CONTRACT violation (numeric NOT NULL / date column),
  // not a gap. Skipping it silently would turn a driver or schema change into a
  // plausible "not enough priced days" on every spot holding.
  it.each([
    ["a string", "100"],
    ["null", null],
    ["undefined", undefined],
    ["NaN", Number.NaN],
    ["+Infinity", Number.POSITIVE_INFINITY],
  ])("a mark that is %s is a contract violation, not a gap", (_label, bad) => {
    const at = "2026-01-01T10:00:00Z";
    expect(() =>
      dailyMarkPrices([
        { asof: "2026-01-01", mark_price: 7, updated_at: at, api_key_id: "key-a" },
        { asof: "2026-01-03", mark_price: bad, updated_at: at, api_key_id: "key-a" },
      ]),
    ).toThrow(HoldingMarkContractError);
  });

  it.each([
    ["a timestamp", "2026-01-03T00:00:00Z"],
    ["a slash date", "01/03/2026"],
    ["an empty string", ""],
    ["a number", 20260103],
    ["null", null],
  ])("an asof that is %s is a contract violation, not a gap", (_label, bad) => {
    expect(() =>
      dailyMarkPrices([
        { asof: bad as unknown as string, mark_price: 7, updated_at: "2026-01-01T10:00:00Z", api_key_id: "key-a" },
      ]),
    ).toThrow(HoldingMarkContractError);
  });

  it("a contract violation counts every offending row and carries no payload", () => {
    try {
      dailyMarkPrices([
        { asof: "2026-01-01", mark_price: "secret-looking", updated_at: "x", api_key_id: "key-a" },
        { asof: "bad-day", mark_price: 3, updated_at: "x", api_key_id: "key-a" },
        { asof: "2026-01-02", mark_price: null, updated_at: "x", api_key_id: "key-a" },
      ]);
      expect.unreachable("must throw");
    } catch (e) {
      expect(e).toBeInstanceOf(HoldingMarkContractError);
      const err = e as HoldingMarkContractError;
      expect(err.badMarks).toBe(2);
      expect(err.badDays).toBe(1);
      expect(err.message).not.toMatch(/secret-looking|bad-day/);
    }
  });

  it("a later failed poll does not eclipse a valid mark: the day's price is the valid 100", () => {
    const out = dailyMarkPrices([
      { asof: "2026-01-01", mark_price: 100, updated_at: "2026-01-01T04:00:00Z", api_key_id: "key-a" },
      { asof: "2026-01-01", mark_price: 0, updated_at: "2026-01-01T09:00:00Z", api_key_id: "key-b" },
    ]);
    expect(out).toEqual([{ asof: "2026-01-01", price: 100 }]);
  });

  it("two keys on one day give ONE price: the later written_at instant wins", () => {
    const out = dailyMarkPrices([
      { asof: "2026-01-01", mark_price: 101, updated_at: "2026-01-01T10:00:00Z", api_key_id: "key-b" },
      { asof: "2026-01-01", mark_price: 102, updated_at: "2026-01-01T11:00:00Z", api_key_id: "key-a" },
    ]);
    expect(out).toEqual([{ asof: "2026-01-01", price: 102 }]);
  });

  it("equal instants break to the smallest LOWERCASE api_key_id, whatever the row order", () => {
    // Raw comparison would pick "Key-C" (uppercase sorts before lowercase);
    // the oneKeyPerAccountDay tie-break lowercases first, so "key-b" wins.
    const rows = [
      { asof: "2026-01-01", mark_price: 111, updated_at: "2026-01-01T10:00:00Z", api_key_id: "Key-C" },
      { asof: "2026-01-01", mark_price: 222, updated_at: "2026-01-01T10:00:00.000000Z", api_key_id: "key-b" },
    ];
    expect(dailyMarkPrices(rows)).toEqual([{ asof: "2026-01-01", price: 222 }]);
    expect(dailyMarkPrices([...rows].reverse())).toEqual([{ asof: "2026-01-01", price: 222 }]);
  });

  it("two keys holding the asset on one venue count each day once in priced_days", async () => {
    const rows = Array.from({ length: 30 }, (_, i) => [
      row(i + 1, 100, { api_key_id: "key-a", updated_at: `${day(i + 1)}T10:00:00Z` }),
      row(i + 1, 100, { api_key_id: "key-b", updated_at: `${day(i + 1)}T11:00:00Z` }),
    ]).flat();
    const item = await fetchHoldingCompareItem({
      allocator_id: ALLOC, holding_ref: REF, supabase: fakeSupabase(rows),
    });
    expect(item!.analytics!.priced_days).toBe(30);
    expect(item!.analytics!.cumulative_return).toBe(0);
  });

  it("29 priced days is ready with four null metrics and priced_days 29", async () => {
    const rows = Array.from({ length: 29 }, (_, i) => row(i + 1, 100 + i));
    const item = await fetchHoldingCompareItem({
      allocator_id: ALLOC, holding_ref: REF, supabase: fakeSupabase(rows),
    });
    expect(item!.historyState).toBe("ready");
    expect(item!.analytics).toEqual({
      cumulative_return: null, sharpe: null, max_drawdown: null, vol: null, priced_days: 29,
    });
  });

  // M-R2-02 (167.1.1 round 2). WHY: the writer marks an asset with no
  // `{asset}/USDT` market at `0.0` on EVERY day (an exchange's earn or receipt
  // token in the spot balance). "Only 0 priced days so far" promises a history
  // that never arrives, and nothing was logged. Zero priced days on a holding
  // that HAS rows is withheld `no_price` and logged once; 1..MIN-1 priced days
  // is still the "so far" state, where waiting does fill the history.
  describe("M-R2-02: rows exist but no day carries a valid price", () => {
    it("every day unpriced: withheld no_price, no analytics, one warn with the ref and the row count only", async () => {
      const rows = Array.from({ length: 35 }, (_, i) => row(i + 1, 0, { api_key_id: "key-secret-id" }));
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      const error = vi.spyOn(console, "error").mockImplementation(() => {});
      try {
        const item = await fetchHoldingCompareItem({
          allocator_id: ALLOC, holding_ref: REF, supabase: fakeSupabase(rows),
        });
        expect(item).not.toBeNull();
        expect(item!.historyState).toBe("withheld");
        expect(item!.analytics).toBeNull();
        expect(item).toMatchObject({ kind: "holding", holding_ref: REF, withheld_reason: "no_price" });
        expect(warn).toHaveBeenCalledTimes(1);
        const logged = warn.mock.calls[0].join(" ");
        expect(logged).toContain(REF);
        expect(logged).toContain("35");
        // No ids, no values.
        expect(logged).not.toContain("key-secret-id");
        expect(logged).not.toContain(ALLOC);
        expect(error).not.toHaveBeenCalled();
      } finally {
        warn.mockRestore();
        error.mockRestore();
      }
    });

    it("negative marks on every day are the same case (no valid price)", async () => {
      const rows = Array.from({ length: 5 }, (_, i) => row(i + 1, -3));
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      try {
        const item = await fetchHoldingCompareItem({
          allocator_id: ALLOC, holding_ref: REF, supabase: fakeSupabase(rows),
        });
        expect(item!.historyState).toBe("withheld");
        expect(item).toMatchObject({ withheld_reason: "no_price" });
      } finally {
        warn.mockRestore();
      }
    });

    it("ONE priced day among unpriced ones is still ready with priced_days 1 (the 'so far' state), and does not warn", async () => {
      const rows = [...Array.from({ length: 34 }, (_, i) => row(i + 1, 0)), row(35, 100)];
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      try {
        const item = await fetchHoldingCompareItem({
          allocator_id: ALLOC, holding_ref: REF, supabase: fakeSupabase(rows),
        });
        expect(item!.historyState).toBe("ready");
        expect(item!.analytics).toEqual({
          cumulative_return: null, sharpe: null, max_drawdown: null, vol: null, priced_days: 1,
        });
        expect(warn).not.toHaveBeenCalled();
      } finally {
        warn.mockRestore();
      }
    });

    it("D-15 is unchanged: zero rows is null and does not warn", async () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      try {
        expect(
          await fetchHoldingCompareItem({
            allocator_id: ALLOC, holding_ref: REF, supabase: fakeSupabase([]),
          }),
        ).toBeNull();
        expect(warn).not.toHaveBeenCalled();
      } finally {
        warn.mockRestore();
      }
    });
  });

  it("a derivative with rows is rebuilding and carries no analytics", async () => {
    const rows = Array.from({ length: 40 }, (_, i) =>
      row(i + 1, 100 + i, { holding_type: "derivative" }),
    );
    const item = await fetchHoldingCompareItem({
      allocator_id: ALLOC,
      holding_ref: "holding:binance:BTC:derivative",
      supabase: fakeSupabase(rows),
    });
    expect(item!.historyState).toBe("rebuilding");
    expect(item!.analytics).toBeNull();
    expect(holdingCompareHistoryState("derivative")).toBe("rebuilding");
    expect(holdingCompareHistoryState("spot")).toBe("ready");
  });

  it("an unknown holding_type returns null, as do zero rows (D-15)", async () => {
    const margin = Array.from({ length: 40 }, (_, i) =>
      row(i + 1, 100 + i, { holding_type: "margin" }),
    );
    expect(
      await fetchHoldingCompareItem({
        allocator_id: ALLOC, holding_ref: "holding:binance:BTC:margin", supabase: fakeSupabase(margin),
      }),
    ).toBeNull();
    expect(
      await fetchHoldingCompareItem({
        allocator_id: ALLOC, holding_ref: REF, supabase: fakeSupabase([]),
      }),
    ).toBeNull();
  });

  it("a row older than the 730-day window is excluded by the asof lower bound", async () => {
    // Clock pinned to 2026-03-01, so the window starts 2024-03-01. The stale
    // row's mark of 1 would turn a flat 100 series into a +9900% gain.
    const rows = [
      row(1, 1, { asof: "2024-02-29", updated_at: "2024-02-29T10:00:00Z" }),
      ...Array.from({ length: 30 }, (_, i) => row(i + 1, 100)),
    ];
    const rec = newRecorded();
    const item = await fetchHoldingCompareItem({
      allocator_id: ALLOC, holding_ref: REF, supabase: fakeSupabase(rows, rec),
    });
    expect(rec.gtes).toContainEqual(["asof", "2024-03-01"]);
    expect(item!.analytics!.priced_days).toBe(30);
    expect(item!.analytics!.cumulative_return).toBe(0);
  });

  it("a read that never returns a short page throws HoldingCompareLoadError within the page ceiling", async () => {
    const rec = newRecorded();
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      await expect(
        fetchHoldingCompareItem({
          allocator_id: ALLOC, holding_ref: REF,
          supabase: fakeSupabase([], rec, { alwaysFullPage: true }),
        }),
      ).rejects.toBeInstanceOf(HoldingCompareLoadError);
    } finally {
      spy.mockRestore();
    }
    expect(rec.ranges.length).toBeGreaterThan(0);
    expect(rec.ranges.length).toBeLessThanOrEqual(HOLDING_COMPARE_MAX_PAGES);
  });

  it("a query error throws HoldingCompareLoadError (not the 'not available' null) and logs the message only", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const p = fetchHoldingCompareItem({
        allocator_id: ALLOC, holding_ref: REF,
        supabase: fakeSupabase([], newRecorded(), { error: { message: "boom" } }),
      });
      await expect(p).rejects.toBeInstanceOf(HoldingCompareLoadError);
      // The database's message is logged, and never rides the thrown error.
      await expect(p).rejects.not.toThrow(/boom/);
      expect(spy).toHaveBeenCalledWith(
        "[holding-compare-adapter.fetchHoldingCompareItem] supabase error:",
        "boom",
      );
    } finally {
      spy.mockRestore();
    }
  });

  it("an unusable updated_at on a priced row is a load failure, not a silent pick", async () => {
    const rows = [row(1, 100, { updated_at: "not-an-instant" })];
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      await expect(
        fetchHoldingCompareItem({
          allocator_id: ALLOC, holding_ref: REF, supabase: fakeSupabase(rows),
        }),
      ).rejects.toBeInstanceOf(HoldingCompareLoadError);
    } finally {
      spy.mockRestore();
    }
  });

  // SFH-03 at the fetch level: the item must not come back "ready, 0 priced days"
  // (a confident data-quality verdict on rows that were present and unreadable).
  it.each([
    ["a string mark", { mark_price: "100" as unknown }],
    ["a null mark", { mark_price: null as unknown }],
    ["a non-ISO asof", { asof: "2026-01-05T00:00:00Z" }],
  ])("%s on one row throws HoldingCompareLoadError, logs the ref and counts, and never the payload", async (_label, bad) => {
    const rows = Array.from({ length: 40 }, (_, i) => row(i + 1, 100));
    rows[7] = { ...rows[7], ...bad };
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      await expect(
        fetchHoldingCompareItem({
          allocator_id: ALLOC, holding_ref: REF, supabase: fakeSupabase(rows),
        }),
      ).rejects.toBeInstanceOf(HoldingCompareLoadError);
      expect(spy).toHaveBeenCalledTimes(1);
      const logged = spy.mock.calls[0].join(" ");
      expect(logged).toContain(REF);
      expect(logged).toMatch(/contract/i);
      expect(logged).not.toContain("2026-01-05T00:00:00Z");
    } finally {
      spy.mockRestore();
    }
  });

  it("every row unreadable throws too, instead of ready with priced_days 0", async () => {
    const rows = Array.from({ length: 35 }, (_, i) => row(i + 1, "1.5"));
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      await expect(
        fetchHoldingCompareItem({
          allocator_id: ALLOC, holding_ref: REF, supabase: fakeSupabase(rows),
        }),
      ).rejects.toBeInstanceOf(HoldingCompareLoadError);
    } finally {
      spy.mockRestore();
    }
  });

  it("a negative mark among valid ones stays a silent gap: no throw, no log", async () => {
    const rows = [...Array.from({ length: 30 }, (_, i) => row(i + 1, 100)), row(31, -4)];
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const item = await fetchHoldingCompareItem({
        allocator_id: ALLOC, holding_ref: REF, supabase: fakeSupabase(rows),
      });
      expect(item!.analytics!.priced_days).toBe(30);
      expect(spy).not.toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
  });

  // -------------------------------------------------------------------------
  // CR-01 + SFH-01 (167.1.1 round 1). WHY: a stablecoin row's mark_price is the
  // writer's constant 1.0, an MT5 account row's is 1.0 or a native close, and
  // every sFOX row's is 1.0. None is a market price, so a price-based read would
  // print a confident 0.00% return, drawdown and vol under a caption claiming a
  // "daily price". Those holdings get NO metrics. They must not come back as
  // null either: null is the D-15 "unowned or nonexistent" answer, the page
  // drops it silently, and an owner would watch a holding vanish from a
  // comparison they built. The rows were found, so the owner is known: return a
  // withheld item that names the cause.
  // -------------------------------------------------------------------------
  describe("CR-01 / SFH-01: a holding whose recorded price is not a market price", () => {
    const flat = (n: number, extra: Partial<HoldingFx>) =>
      Array.from({ length: n }, (_, i) => row(i + 1, 1, extra));

    it.each([
      ["USDT", "binance"],
      ["USDC", "okx"],
      ["DAI", "bybit"],
      ["BUSD", "binance"],
      ["TUSD", "binance"],
      ["FDUSD", "binance"],
      ["USD", "deribit"],
      ["usdt", "binance"], // the writer upper-cases before the set test
    ])("%s on %s with 40 priced days is withheld, not a confident 0%%", async (symbol, venue) => {
      const item = await fetchHoldingCompareItem({
        allocator_id: ALLOC,
        holding_ref: `holding:${venue}:${symbol}:spot`,
        supabase: fakeSupabase(flat(40, { venue, symbol })),
      });
      expect(item).not.toBeNull();
      expect(item!.historyState).toBe("withheld");
      expect(item!.analytics).toBeNull();
      expect(item).toMatchObject({
        kind: "holding", venue, symbol, holding_type: "spot",
        holding_ref: `holding:${venue}:${symbol}:spot`,
        withheld_reason: "fixed_price",
      });
    });

    it("every sFOX spot holding is withheld, whatever the symbol", async () => {
      const item = await fetchHoldingCompareItem({
        allocator_id: ALLOC,
        holding_ref: "holding:sfox:BTC:spot",
        supabase: fakeSupabase(
          Array.from({ length: 40 }, (_, i) => row(i + 1, 50000 + i, { venue: "sfox", symbol: "BTC" })),
        ),
      });
      expect(item!.historyState).toBe("withheld");
      expect(item!.analytics).toBeNull();
    });

    it("an MT5 account holding is withheld, not dropped as null (SFH-01)", async () => {
      const item = await fetchHoldingCompareItem({
        allocator_id: ALLOC,
        holding_ref: "holding:mt5:ACCOUNT-abc12345:spot",
        supabase: fakeSupabase(flat(40, { venue: "mt5", symbol: "ACCOUNT-abc12345" })),
      });
      expect(item).not.toBeNull();
      expect(item!.historyState).toBe("withheld");
      expect(item!.analytics).toBeNull();
      // M-R2-01: an MT5 row is an account balance, not a fixed-price asset.
      expect(item).toMatchObject({ symbol: "ACCOUNT-abc12345", withheld_reason: "account_balance" });
    });

    it("M-R2-01: an MT5 native-unit account whose mark VARIES daily is an account balance, never 'fixed_price'", async () => {
      // The writer overwrites mark_price with the unit's daily close
      // (`row["mark_price"] = native_close`), so the mark is a market price of
      // the UNIT. The reason must not claim the recorded price is fixed.
      const item = await fetchHoldingCompareItem({
        allocator_id: ALLOC,
        holding_ref: "holding:mt5:ACCOUNT-abc12345:spot",
        supabase: fakeSupabase(
          Array.from({ length: 40 }, (_, i) =>
            row(i + 1, 60000 + i * 137, { venue: "mt5", symbol: "ACCOUNT-abc12345" }),
          ),
        ),
      });
      expect(item!.historyState).toBe("withheld");
      expect(item!.analytics).toBeNull();
      expect(item).toMatchObject({ withheld_reason: "account_balance" });
      expect(item).not.toMatchObject({ withheld_reason: "fixed_price" });
    });

    it("M-R2-01: the reason follows the cause: stablecoin and sFOX stay 'fixed_price', a non-crypto venue is 'account_balance'", () => {
      expect(holdingWithheldReason("binance", "USDT")).toBe("fixed_price");
      expect(holdingWithheldReason("sfox", "BTC")).toBe("fixed_price");
      expect(holdingWithheldReason("mt5", "ACCOUNT-abc12345")).toBe("account_balance");
      // A non-crypto venue wins even for a stablecoin-looking symbol: the row is a balance.
      expect(holdingWithheldReason("mt5", "USDT")).toBe("account_balance");
      expect(holdingWithheldReason("binance", "BTC")).toBeNull();
    });

    it("D-15 is unchanged: an unowned or nonexistent stablecoin holding is null, in the same shape as any other", async () => {
      const stable = await fetchHoldingCompareItem({
        allocator_id: ALLOC, holding_ref: "holding:binance:USDT:spot", supabase: fakeSupabase([]),
      });
      const btc = await fetchHoldingCompareItem({
        allocator_id: ALLOC, holding_ref: REF, supabase: fakeSupabase([]),
      });
      const mt5 = await fetchHoldingCompareItem({
        allocator_id: ALLOC, holding_ref: "holding:mt5:ACCOUNT-abc12345:spot", supabase: fakeSupabase([]),
      });
      expect(stable).toBeNull();
      expect(btc).toBeNull();
      expect(mt5).toBeNull();
      // Another allocator's rows are not this allocator's rows (the allocator_id filter).
      const others = flat(40, { allocator_id: "someone-else", venue: "binance", symbol: "USDT" });
      expect(
        await fetchHoldingCompareItem({
          allocator_id: ALLOC, holding_ref: "holding:binance:USDT:spot", supabase: fakeSupabase(others),
        }),
      ).toBeNull();
    });

    it("a real-priced asset whose name merely contains a stablecoin stays ready (positive control)", async () => {
      // USDE is a split suffix in the writer, deliberately NOT in STABLECOINS.
      const item = await fetchHoldingCompareItem({
        allocator_id: ALLOC,
        holding_ref: "holding:binance:USDE:spot",
        supabase: fakeSupabase(
          Array.from({ length: 31 }, (_, i) => row(i + 1, 1 + i * 0.001, { symbol: "USDE" })),
        ),
      });
      expect(item!.historyState).toBe("ready");
      expect(item!.analytics!.priced_days).toBe(31);
    });

    it("the withheld branch reads no mark: a malformed mark on a stablecoin row is not a contract error", async () => {
      const item = await fetchHoldingCompareItem({
        allocator_id: ALLOC,
        holding_ref: "holding:binance:USDT:spot",
        supabase: fakeSupabase([row(1, "1", { symbol: "USDT" })]),
      });
      expect(item!.historyState).toBe("withheld");
    });
  });

  describe("fixed-mark set parity with the analytics writer", () => {
    const py = (rel: string) => readFileSync(join(process.cwd(), "analytics-service", rel), "utf8");

    it("FIXED_MARK_SET.stablecoinSymbols equals STABLECOINS in analytics-service/services/closed_sets.py, member for member", () => {
      const src = py("services/closed_sets.py");
      const m = /^STABLECOINS: frozenset\[str\] = frozenset\(\s*\{([^}]*)\}\s*\)/m.exec(src);
      expect(m, "STABLECOINS literal not found in closed_sets.py").not.toBeNull();
      const members = [...m![1].matchAll(/"([A-Z0-9]+)"/g)].map((x) => x[1]).sort();
      expect(members.length).toBeGreaterThan(0);
      expect([...FIXED_MARK_SET.stablecoinSymbols].sort()).toEqual(members);
    });

    it("the writer still stamps a constant mark_price of 1.0 on the sFOX and stablecoin paths (the premise of the venue gate)", () => {
      const src = py("services/allocator_positions.py");
      const sfox = src.slice(src.indexOf("async def _fetch_sfox_balance_rows"));
      expect(sfox).toMatch(/"mark_price":\s*1\.0/);
      expect(src).toMatch(/if asset_upper in STABLECOINS:\s*\n\s*mark_price = 1\.0/);
      expect([...FIXED_MARK_SET.venues]).toContain("sfox");
    });

    it("holdingMarkIsFixed: venue and symbol are matched case-insensitively; a crypto venue with a real asset is not fixed", () => {
      expect(holdingMarkIsFixed("binance", "usdc")).toBe(true);
      expect(holdingMarkIsFixed("SFOX", "BTC")).toBe(true);
      expect(holdingMarkIsFixed("mt5", "ACCOUNT-abc12345")).toBe(true);
      expect(holdingMarkIsFixed("binance", "BTC")).toBe(false);
      expect(holdingMarkIsFixed("okx", "USDE")).toBe(false);
    });
  });

  // SFH-02 (167.1.1 round 1): the shape the factsheet must explain. Thirty-one
  // priced days on every other calendar day clear the minimum, so return and
  // drawdown are numbers, but no two priced days are adjacent, so vol and Sharpe
  // are null. Pinned here so the card's adjacency sentence has a real producer.
  it("31 priced days on alternate calendar days: numeric return and drawdown, null vol and Sharpe", async () => {
    const rows = Array.from({ length: 31 }, (_, i) => row(2 * i + 1, 100 + i));
    const item = await fetchHoldingCompareItem({
      allocator_id: ALLOC, holding_ref: REF, supabase: fakeSupabase(rows),
    });
    expect(item!.historyState).toBe("ready");
    const a = item!.analytics!;
    expect(a.priced_days).toBe(31);
    expect(a.cumulative_return).toBeCloseTo(130 / 100 - 1, 12);
    expect(a.max_drawdown).toBe(0);
    expect(a.vol).toBeNull();
    expect(a.sharpe).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Phase 167.1.1.1 / D-03, SC3: the SPOT mark-price rule is ONE hand-typed table,
// replayed here by `classifySpotMarks` and by pytest through `classify_spot_marks`
// (analytics-service/tests/test_holding_marks_fixture.py). WHY it matters: the Bridge
// matcher and /compare must agree on which days are priced and which returns exist,
// or the same holding reads differently on the two surfaces.
// ---------------------------------------------------------------------------
type FixtureRow = {
  asof: string;
  mark_price: unknown;
  side: unknown;
  updated_at: string;
  api_key_id: string;
  value_usd: number;
  quantity: number;
};
type FixtureCase = {
  name: string;
  venue: string;
  symbol: string;
  holding_type: string;
  rows: FixtureRow[];
  expected?: { withheld: string | null; priced_days: number; returns: Array<[string, number]> };
  expect_error?: "HoldingMarkContractError" | "HoldingsUpdatedAtError";
  ts?: { historyState: "ready" | "withheld"; null_metrics?: boolean };
  /** What `analyzeSignedReturns` must give over the case's returns (derivative cases). */
  ts_nav?: { cumulative_return: number | null; max_drawdown: number | null };
};
const MARK_FIXTURE = JSON.parse(
  readFileSync(
    join(process.cwd(), "analytics-service", "tests", "fixtures", "holding_mark_returns_cases.json"),
    "utf8",
  ),
) as {
  min_priced_days: number;
  withheld_reasons: string[];
  crypto_venues: string[];
  cases: FixtureCase[];
};
const ERROR_CLASSES = { HoldingMarkContractError, HoldingsUpdatedAtError } as const;

describe("shared fixture: holding_mark_returns_cases.json", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-01T12:00:00Z"));
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  const asFx = (c: FixtureCase): HoldingFx[] =>
    c.rows.map((r) => ({
      allocator_id: ALLOC,
      venue: c.venue,
      symbol: c.symbol,
      holding_type: c.holding_type,
      asof: r.asof,
      mark_price: r.mark_price,
      value_usd: r.value_usd,
      updated_at: r.updated_at,
      api_key_id: r.api_key_id,
    }));

  it("the minimum priced days and the reason vocabulary are the fixture's", () => {
    expect(MARK_FIXTURE.min_priced_days).toBe(HOLDING_COMPARE_MIN_PRICED_DAYS);
    expect([...HOLDING_MARK_WITHHELD_REASONS].sort()).toEqual(MARK_FIXTURE.withheld_reasons);
  });

  it("venue_census: the crypto venues behind account_balance are the fixture's hand-typed list", () => {
    expect([...CRYPTO_EXCHANGES].sort()).toEqual(MARK_FIXTURE.crypto_venues);
    for (const v of MARK_FIXTURE.crypto_venues) expect(isCryptoExchange(v)).toBe(true);
    expect(isCryptoExchange("mt5")).toBe(false);
    expect(MARK_FIXTURE.cases.length).toBeGreaterThan(15);
  });

  const classify = (c: FixtureCase) =>
    c.holding_type === "derivative"
      ? classifyDerivativeMarks(c.rows, c.symbol)
      : classifySpotMarks(c.rows, c.venue, c.symbol);

  it.each(MARK_FIXTURE.cases.map((c) => [c.name, c] as const))(
    "the mark rule replays %s",
    (_name, c) => {
      expect(["spot", "derivative"]).toContain(c.holding_type);
      if (c.expect_error) {
        expect(() => classify(c)).toThrow(ERROR_CLASSES[c.expect_error]);
        return;
      }
      const got = classify(c);
      const want = c.expected!;
      expect(got.withheld_reason).toBe(want.withheld);
      expect(got.priced_days).toBe(want.priced_days);
      expect(got.returns.map(([day]) => day)).toEqual(want.returns.map(([day]) => day));
      got.returns.forEach(([, value], i) => expect(value).toBeCloseTo(want.returns[i][1], 12));
      if (c.ts_nav) {
        const nav = analyzeSignedReturns(
          got.returns.map(([, value]) => value),
          365,
        );
        for (const key of ["cumulative_return", "max_drawdown"] as const) {
          const wantValue = c.ts_nav[key];
          if (wantValue === null) expect(nav[key]).toBeNull();
          else expect(nav[key]).toBeCloseTo(wantValue, 12);
        }
      }
    },
  );

  // /compare reads spot only until plan 07 wires the derivative path.
  it.each(MARK_FIXTURE.cases.filter((c) => c.holding_type === "spot").map((c) => [c.name, c] as const))(
    "fetchHoldingCompareItem maps %s onto what /compare shows",
    async (_name, c) => {
      vi.spyOn(console, "error").mockImplementation(() => {});
      vi.spyOn(console, "warn").mockImplementation(() => {});
      const call = fetchHoldingCompareItem({
        allocator_id: ALLOC,
        holding_ref: `holding:${c.venue}:${c.symbol}:${c.holding_type}`,
        supabase: fakeSupabase(asFx(c)),
      });
      if (c.expect_error) {
        await expect(call).rejects.toBeInstanceOf(HoldingCompareLoadError);
        return;
      }
      const item = await call;
      expect(item!.historyState).toBe(c.ts!.historyState);
      if (c.ts!.historyState === "ready") {
        const a = item!.analytics!;
        expect(a.priced_days).toBe(c.expected!.priced_days);
        expect(a.cumulative_return === null).toBe(c.ts!.null_metrics);
      }
    },
  );
});
