import { describe, it, expect } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

import {
  BENCHMARK_MAX_PAGES,
  mergeWithFixture,
  readBenchmarkPrices,
} from "./benchmark-source";

/**
 * Phase 169.2 / plan 01 (SC3, D-08, D-09) — the one paged reader of
 * `benchmark_prices`.
 *
 * WHY these tests exist: PostgREST caps an unranged read at `max_rows` and
 * answers 200 with a PARTIAL body. The previous reader was unranged and
 * ascending, so it returned the OLDEST 1000 BTC days and never the current
 * ones. The fake client below enforces that cap on EVERY page (and a smaller
 * one in one case), so a reader that stops after one page, or that stops on
 * a "short" page, reads fewer rows than the table holds and goes red.
 */

type Row = { date: string; symbol: string; close_price: number | string };

interface FakeOptions {
  /** The server-side cap applied to every page, like PostgREST `max_rows`. */
  cap?: number;
  /** Answer an error on this 1-based page number. */
  errorOnPage?: number;
  /** Never answer an empty page (a server that ignores the offset). */
  neverEmpty?: boolean;
}

function isoDay(offsetDays: number): string {
  const d = new Date(Date.UTC(2019, 0, 1) + offsetDays * 86_400_000);
  return d.toISOString().slice(0, 10);
}

function btcRows(n: number): Row[] {
  return Array.from({ length: n }, (_, i) => ({
    date: isoDay(i),
    symbol: "BTC",
    close_price: 10_000 + i,
  }));
}

function makeClient(table: Row[], opts: FakeOptions = {}) {
  const cap = opts.cap ?? 1000;
  const calls = { pages: 0, ranges: [] as Array<[number, number]>, gte: [] as string[], lte: [] as string[] };

  function builder() {
    const filters: Array<(r: Row) => boolean> = [];
    let ascending = true;
    const b = {
      select: () => b,
      eq: (col: keyof Row, val: string) => {
        filters.push((r) => r[col] === val);
        return b;
      },
      gte: (col: keyof Row, val: string) => {
        calls.gte.push(val);
        filters.push((r) => String(r[col]) >= val);
        return b;
      },
      lte: (col: keyof Row, val: string) => {
        calls.lte.push(val);
        filters.push((r) => String(r[col]) <= val);
        return b;
      },
      order: (_col: string, o: { ascending: boolean }) => {
        ascending = o.ascending;
        return b;
      },
      range: async (from: number, to: number) => {
        calls.pages += 1;
        calls.ranges.push([from, to]);
        if (opts.errorOnPage === calls.pages) {
          return { data: null, error: { message: "boom", code: "PGRST500" } };
        }
        const sorted = table
          .filter((r) => filters.every((f) => f(r)))
          .sort((x, y) => (ascending ? x.date.localeCompare(y.date) : y.date.localeCompare(x.date)));
        const start = opts.neverEmpty ? 0 : from;
        const end = Math.min(to + 1, start + cap);
        return {
          data: sorted.slice(start, end).map((r) => ({ date: r.date, close_price: r.close_price })),
          error: null,
        };
      },
    };
    return b;
  }

  const client = { from: () => builder() } as unknown as SupabaseClient;
  return { client, calls };
}

describe("readBenchmarkPrices", () => {
  it("reads EVERY row of a 2500-day table through a 1000-row cap, ascending, through = newest", async () => {
    const table = btcRows(2500);
    const { client, calls } = makeClient(table);

    const res = await readBenchmarkPrices(client, "BTC");

    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.prices).toHaveLength(2500);
    expect(res.prices[0].date).toBe(table[0].date);
    expect(res.prices[2499].date).toBe(table[2499].date);
    expect(res.through).toBe(table[2499].date);
    const dates = res.prices.map((p) => p.date);
    expect(dates).toEqual([...dates].sort());
    // Three full pages, then the EMPTY page that ends the loop.
    expect(calls.pages).toBe(4);
  });

  it("advances by the rows actually received, so a server cap below the page size still reads everything", async () => {
    // A cap of 400 makes EVERY page short. A reader that stops on a short page
    // would read 400 rows; one that advances by the requested size would skip
    // 600 rows per page.
    const table = btcRows(1500);
    const { client, calls } = makeClient(table, { cap: 400 });

    const res = await readBenchmarkPrices(client, "BTC");

    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.prices).toHaveLength(1500);
    expect(new Set(res.prices.map((p) => p.date)).size).toBe(1500);
    expect(res.through).toBe(table[1499].date);
    expect(calls.ranges.map(([from]) => from)).toEqual([0, 400, 800, 1200, 1500]);
  });

  it("requests only [from, to] and reports through = the newest row inside the bound", async () => {
    const table = btcRows(100);
    const { client, calls } = makeClient(table);

    const res = await readBenchmarkPrices(client, "BTC", { from: table[10].date, to: table[20].date });

    // Every page (the data page and the empty page that ends the loop) is bounded.
    expect(calls.gte.length).toBeGreaterThan(0);
    expect(new Set(calls.gte)).toEqual(new Set([table[10].date]));
    expect(calls.lte.length).toBe(calls.gte.length);
    expect(new Set(calls.lte)).toEqual(new Set([table[20].date]));
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.prices.map((p) => p.date)).toEqual(table.slice(10, 21).map((r) => r.date));
    expect(res.through).toBe(table[20].date);
  });

  it("an error on page 2 is an error result: no partial data and no fixture", async () => {
    const { client } = makeClient(btcRows(2500), { errorOnPage: 2 });

    const res = await readBenchmarkPrices(client, "BTC");

    expect(res).toEqual({ ok: false, error: expect.objectContaining({ code: "PGRST500" }) });
    expect(res).not.toHaveProperty("prices");
  });

  it("coerces numeric-STRING closes and drops non-finite or non-positive ones", async () => {
    const table: Row[] = [
      { date: "2024-01-01", symbol: "BTC", close_price: "68000.50" },
      { date: "2024-01-02", symbol: "BTC", close_price: "0" },
      { date: "2024-01-03", symbol: "BTC", close_price: "-5" },
      { date: "2024-01-04", symbol: "BTC", close_price: "not-a-number" },
      { date: "2024-01-05", symbol: "BTC", close_price: 69000 },
    ];
    const { client } = makeClient(table);

    const res = await readBenchmarkPrices(client, "BTC");

    expect(res).toEqual({
      ok: true,
      prices: [
        { date: "2024-01-01", close: 68000.5 },
        { date: "2024-01-05", close: 69000 },
      ],
      through: "2024-01-05",
    });
  });

  it("an empty table is ok with no prices and through = null", async () => {
    const { client } = makeClient([]);
    expect(await readBenchmarkPrices(client, "BTC")).toEqual({ ok: true, prices: [], through: null });
  });

  it("a server that never answers an empty page ends in an error at the page ceiling, not an endless loop", async () => {
    const { client, calls } = makeClient(btcRows(10), { neverEmpty: true });

    const res = await readBenchmarkPrices(client, "BTC");

    expect(res.ok).toBe(false);
    expect(calls.pages).toBe(BENCHMARK_MAX_PAGES);
  });
});

describe("mergeWithFixture", () => {
  const fixture = [
    { date: "2024-01-01", close: 1 },
    { date: "2024-01-02", close: 2 },
    { date: "2024-01-03", close: 3 },
    { date: "2024-01-04", close: 4 },
  ];

  it("takes fixture rows strictly BEFORE the DB's first date, then every DB row; through = DB's last date", () => {
    const db = [
      { date: "2024-01-03", close: 30 },
      { date: "2024-01-04", close: 40 },
      { date: "2024-01-05", close: 50 },
    ];
    expect(mergeWithFixture(db, fixture)).toEqual({
      prices: [
        { date: "2024-01-01", close: 1 },
        { date: "2024-01-02", close: 2 },
        { date: "2024-01-03", close: 30 },
        { date: "2024-01-04", close: 40 },
        { date: "2024-01-05", close: 50 },
      ],
      through: "2024-01-05",
    });
  });

  it("a fixture row ON or AFTER the DB's first date never appears (DB wins, no seam day)", () => {
    const db = [{ date: "2024-01-02", close: 20 }];
    const merged = mergeWithFixture(db, fixture);
    expect(merged.prices).toEqual([
      { date: "2024-01-01", close: 1 },
      { date: "2024-01-02", close: 20 },
    ]);
    expect(merged.through).toBe("2024-01-02");
  });

  it("an empty DB leaves the fixture, with through = the fixture's last date", () => {
    expect(mergeWithFixture([], fixture)).toEqual({ prices: fixture, through: "2024-01-04" });
  });

  it("both empty: no prices and through = null", () => {
    expect(mergeWithFixture([], [])).toEqual({ prices: [], through: null });
  });
});
