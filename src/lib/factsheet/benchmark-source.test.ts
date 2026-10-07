import { describe, it, expect, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

import {
  BENCHMARK_MAX_PAGES,
  mergeWithFixture,
  pricesToDailyReturns,
  readBenchmarkPrices,
  readBtcCloses,
} from "./benchmark-source";
import { BTC_DAILY } from "./benchmarks";

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
  /** Answer `{ data: null, error: null }` on this 1-based page number. */
  nullOnPage?: number;
  /** Ignore the keyset cursor (`.lt`) and the offset: always serve the first rows. */
  ignoreCursor?: boolean;
  /**
   * An endless table: every page is fabricated as fresh rows strictly older
   * than the cursor, so the server never answers an empty page.
   */
  endless?: boolean;
  /** Called after each page is answered (1-based), e.g. to insert a row. */
  afterPage?: (page: number, table: Row[]) => void;
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

/**
 * A PostgREST-shaped fake. It answers BOTH terminals a reader could use: a
 * keyset page (`.lt("date", cursor)` then `.limit(n)`) and an offset page
 * (`.range(from, to)`), each capped at `cap` rows. Supporting both is what lets
 * the insert-between-pages case prove the OFFSET reader wrong.
 */
function makeClient(table: Row[], opts: FakeOptions = {}) {
  const cap = opts.cap ?? 1000;
  const calls = {
    pages: 0,
    ranges: [] as Array<[number, number]>,
    limits: [] as number[],
    lt: [] as string[],
    gte: [] as string[],
    lte: [] as string[],
  };

  function builder() {
    const filters: Array<(r: Row) => boolean> = [];
    let ascending = true;
    let cursor: string | null = null;

    function answer(start: number, size: number) {
      calls.pages += 1;
      const page = calls.pages;
      if (opts.errorOnPage === page) {
        return { data: null, error: { message: "boom", code: "PGRST500" } };
      }
      if (opts.nullOnPage === page) return { data: null, error: null };
      let data: Array<{ date: string; close_price: number | string }>;
      if (opts.endless) {
        const oldest = cursor ?? isoDay(100_000);
        const base = Date.parse(`${oldest}T00:00:00Z`);
        data = Array.from({ length: Math.min(size, cap) }, (_, i) => ({
          date: new Date(base - (i + 1) * 86_400_000).toISOString().slice(0, 10),
          close_price: 1,
        }));
      } else {
        const sorted = table
          .filter((r) => filters.every((f) => f(r)))
          .filter((r) => opts.ignoreCursor || cursor === null || r.date < cursor)
          .sort((x, y) => (ascending ? x.date.localeCompare(y.date) : y.date.localeCompare(x.date)));
        const from = opts.ignoreCursor ? 0 : start;
        data = sorted
          .slice(from, from + Math.min(size, cap))
          .map((r) => ({ date: r.date, close_price: r.close_price }));
      }
      opts.afterPage?.(page, table);
      return { data, error: null };
    }

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
      lt: (_col: string, val: string) => {
        calls.lt.push(val);
        cursor = val;
        return b;
      },
      order: (_col: string, o: { ascending: boolean }) => {
        ascending = o.ascending;
        return b;
      },
      limit: async (n: number) => {
        calls.limits.push(n);
        return answer(0, n);
      },
      range: async (from: number, to: number) => {
        calls.ranges.push([from, to]);
        return answer(from, to - from + 1);
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
    expect(calls.limits).toEqual([1000, 1000, 1000, 1000]);
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
    // Each page after the first is keyed on the oldest date already read.
    expect(calls.lt).toEqual([table[1100].date, table[700].date, table[300].date, table[0].date]);
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

  it("coerces numeric-STRING closes, leaves out non-finite or non-positive ones, and reports their dates", async () => {
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
      // Every left-out close is REPORTED, ascending, so a consumer can refuse
      // to build a return across the hole (169.2 review WR-04).
      dropped: ["2024-01-02", "2024-01-03", "2024-01-04"],
    });
  });

  it("an empty table is ok with no prices and through = null", async () => {
    const { client } = makeClient([]);
    expect(await readBenchmarkPrices(client, "BTC")).toEqual({
      ok: true,
      prices: [],
      through: null,
      dropped: [],
    });
  });

  it("a server that never answers an empty page ends in an error at the page ceiling, not an endless loop", async () => {
    const { client, calls } = makeClient([], { endless: true });

    const res = await readBenchmarkPrices(client, "BTC");

    expect(res.ok).toBe(false);
    expect(calls.pages).toBe(BENCHMARK_MAX_PAGES);
  });

  it("a server that ignores the cursor is an error at the first repeated day, never a duplicated series", async () => {
    const { client, calls } = makeClient(btcRows(10), { ignoreCursor: true });

    const res = await readBenchmarkPrices(client, "BTC");

    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(String(res.error)).toContain("not strictly older than");
    expect(calls.pages).toBe(2);
  });

  it("a page with neither data nor an error is an ERROR, not the end of the table (SFH LW-03)", async () => {
    // 2500 rows: page 1 is full, page 2 answers { data: null, error: null }.
    // Reading that as "no more rows" would hand back 1000 of 2500 days as a
    // complete series.
    const { client } = makeClient(btcRows(2500), { nullOnPage: 2 });

    const res = await readBenchmarkPrices(client, "BTC");

    expect(res.ok).toBe(false);
    expect(res).not.toHaveProperty("prices");
  });

  it("a NEW newest day upserted between two pages neither repeats nor skips a stored day (review WR-03 / SFH MD-04)", async () => {
    // WHY: the daily refresh cron upserts a new newest BTC day, and a table of
    // more than 1000 days is always read in at least two pages. Newest-first,
    // an insert lands at the head: with OFFSET paging every row shifts down one
    // place, page 2 re-reads page 1's last row, and the route stamps a spurious
    // 0 return on a duplicated date that feeds beta / TE / IR. A keyset cursor
    // anchored on a date is immune.
    const table = btcRows(1500);
    const original = table.map((r) => r.date);
    const newest = isoDay(1500);
    const { client } = makeClient(table, {
      afterPage: (page, t) => {
        if (page === 1) t.push({ date: newest, symbol: "BTC", close_price: 99_999 });
      },
    });

    const res = await readBenchmarkPrices(client, "BTC");

    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const dates = res.prices.map((p) => p.date);
    expect(new Set(dates).size).toBe(dates.length);
    // Exactly the days that were stored when the read began; the day inserted
    // mid-read is above the cursor and is simply not part of this read.
    expect(dates).toEqual(original);
    expect(res.through).toBe(original[original.length - 1]);
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
    expect(mergeWithFixture({ prices: db, dropped: [] }, fixture)).toEqual({
      prices: [
        { date: "2024-01-01", close: 1 },
        { date: "2024-01-02", close: 2 },
        { date: "2024-01-03", close: 30 },
        { date: "2024-01-04", close: 40 },
        { date: "2024-01-05", close: 50 },
      ],
      through: "2024-01-05",
      dropped: [],
    });
  });

  it("a fixture row ON or AFTER the DB's first date never appears (DB wins, no seam day)", () => {
    const db = [{ date: "2024-01-02", close: 20 }];
    const merged = mergeWithFixture({ prices: db, dropped: [] }, fixture);
    expect(merged.prices).toEqual([
      { date: "2024-01-01", close: 1 },
      { date: "2024-01-02", close: 20 },
    ]);
    expect(merged.through).toBe("2024-01-02");
  });

  it("an empty DB leaves the fixture, with through = the fixture's last date", () => {
    expect(mergeWithFixture({ prices: [], dropped: [] }, fixture)).toEqual({
      prices: fixture,
      through: "2024-01-04",
      dropped: [],
    });
  });

  it("both empty: no prices and through = null", () => {
    expect(mergeWithFixture({ prices: [], dropped: [] }, [])).toEqual({
      prices: [],
      through: null,
      dropped: [],
    });
  });

  it("a DROPPED oldest stored row is not filled by the fixture: the cut is the first STORED date (SFH round 2 MD-R2-01)", () => {
    // The DB stored 2024-01-02 but its close was corrupt. Cutting at the first
    // VALID date (2024-01-03) would slot the fixture's 2024-01-02 into the DB
    // window: a fixture/DB seam day that D-09 forbids, and a fixture close
    // silently standing in for a stored one.
    const merged = mergeWithFixture(
      {
        prices: [
          { date: "2024-01-03", close: 30 },
          { date: "2024-01-04", close: 40 },
        ],
        dropped: ["2024-01-02"],
      },
      fixture,
    );
    expect(merged).toEqual({
      prices: [
        { date: "2024-01-01", close: 1 },
        { date: "2024-01-03", close: 30 },
        { date: "2024-01-04", close: 40 },
      ],
      through: "2024-01-04",
      dropped: ["2024-01-02"],
    });
    // And the hole a DROPPED row leaves is never bridged into a one-day return
    // once the consumer passes `merged.dropped` through.
    expect(
      pricesToDailyReturns(merged.prices, merged.dropped).map((r) => r.date),
    ).toEqual(["2024-01-04"]);
  });

  it("an all-corrupt DB still cuts the fixture at its first stored date", () => {
    const merged = mergeWithFixture(
      { prices: [], dropped: ["2024-01-03", "2024-01-04"] },
      fixture,
    );
    expect(merged).toEqual({
      prices: [
        { date: "2024-01-01", close: 1 },
        { date: "2024-01-02", close: 2 },
      ],
      through: "2024-01-02",
      dropped: ["2024-01-03", "2024-01-04"],
    });
  });
});

describe("pricesToDailyReturns", () => {
  it("emits close/prevClose − 1 at the later date for consecutive UTC days; the first close yields nothing", () => {
    const out = pricesToDailyReturns(
      [
        { date: "2024-02-28", close: 100 },
        { date: "2024-02-29", close: 110 }, // leap day: still one day apart
        { date: "2024-03-01", close: 99 },
      ],
      [],
    );
    expect(out.map((r) => r.date)).toEqual(["2024-02-29", "2024-03-01"]);
    expect(out[0].value).toBeCloseTo(0.1, 10);
    expect(out[1].value).toBeCloseTo(-0.1, 10);
  });

  it("BRIDGES a MISSING row: adjacent stored closes give one return at the later date, so a compounded overlay keeps BTC's level (review round 3 WR-01, narrowing round-2 WR-03)", () => {
    const out = pricesToDailyReturns(
      [
        { date: "2024-01-01", close: 100 },
        { date: "2024-01-02", close: 110 },
        { date: "2024-01-04", close: 121 }, // 2024-01-03 absent, not dropped
        { date: "2024-01-05", close: 133.1 },
      ],
      [],
    );
    expect(out.map((r) => r.date)).toEqual([
      "2024-01-02",
      "2024-01-04",
      "2024-01-05",
    ]);
    expect(out[1].value).toBeCloseTo(0.1, 10); // 121/110 − 1, bridged
  });

  it("does NOT bridge a DROPPED close: the pair whose span holds a dropped date yields no return (review WR-04 / MD-03)", () => {
    const prices = [
      { date: "2024-01-01", close: 100 },
      { date: "2024-01-02", close: 110 },
      // 2024-01-03 stored but corrupt → in `dropped`, not in `prices`
      { date: "2024-01-04", close: 121 },
      { date: "2024-01-05", close: 133.1 },
      // 2024-01-06 missing (not dropped) → still bridged
      { date: "2024-01-07", close: 146.41 },
    ];
    const out = pricesToDailyReturns(prices, ["2024-01-03"]);
    expect(out.map((r) => r.date)).toEqual([
      "2024-01-02",
      "2024-01-05",
      "2024-01-07",
    ]);
  });

  it("skips a ratio that overflows to a non-finite value", () => {
    const out = pricesToDailyReturns(
      [
        { date: "2024-01-01", close: Number.MIN_VALUE },
        { date: "2024-01-02", close: Number.MAX_VALUE },
      ],
      [],
    );
    expect(out).toEqual([]);
  });
});

/**
 * Phase 164.6.6.2 (D-18, D-22, D-23): the server-side BTC conversion reads ONE
 * price window, every usable close stored in `benchmark_prices`, and nothing
 * else. The Python twin (`get_btc_closes`) reads the same window, because the
 * analytics image cannot ship the bundled fixture. A reader that merged
 * `BTC_DAILY` in would price early days in TypeScript that Python leaves
 * absent, and the two runtimes would blend different numbers.
 */
describe("readBtcCloses", () => {
  it("returns the stored closes exactly as read, with NO bundled BTC_DAILY rows merged in", async () => {
    // A table that starts well after the bundled fixture's first date.
    const table: Row[] = Array.from({ length: 5 }, (_, i) => ({
      date: isoDay(2000 + i),
      symbol: "BTC",
      close_price: 30_000 + i,
    }));
    const { client } = makeClient(table);

    const res = await readBtcCloses(client);

    expect(BTC_DAILY.length).toBeGreaterThan(0);
    expect(BTC_DAILY[0].date < table[0].date).toBe(true);
    expect(res).not.toBeNull();
    expect(res!.prices.map((p) => p.date)).toEqual(table.map((r) => r.date));
    expect(res!.prices[0].date).toBe(table[0].date);
    expect(res!.dropped).toEqual([]);
    expect(res!.through).toBe(table[4].date);
  });

  it("carries the dropped dates of a corrupt close through", async () => {
    const table: Row[] = [
      { date: "2026-02-02", symbol: "BTC", close_price: 100 },
      { date: "2026-02-03", symbol: "BTC", close_price: 0 },
      { date: "2026-02-04", symbol: "BTC", close_price: "121" },
    ];
    const { client } = makeClient(table);

    const res = await readBtcCloses(client);

    expect(res!.prices).toEqual([
      { date: "2026-02-02", close: 100 },
      { date: "2026-02-04", close: 121 },
    ]);
    expect(res!.dropped).toEqual(["2026-02-03"]);
  });

  it("a read error is null and one console.error, never the bundled fixture", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const { client } = makeClient(btcRows(10), { errorOnPage: 1 });
      const res = await readBtcCloses(client);
      expect(res).toBeNull();
      expect(spy).toHaveBeenCalledTimes(1);
      expect(String(spy.mock.calls[0][0])).toContain("[benchmark-source] BTC closes read failed");
    } finally {
      spy.mockRestore();
    }
  });

  it("zero stored closes is null, not an empty series and not the fixture", async () => {
    const { client } = makeClient([]);
    expect(await readBtcCloses(client)).toBeNull();
  });

  // SFH-1 (164.6.6.2 review): null with NO read error used to be silent, so a
  // native leg that dropped out of a blend left nothing in the logs to say why.
  // A read error already logs (above); the other two nulls must too.
  describe("a null without a read error says so, with the dropped count", () => {
    const TAG = "[benchmark-source] BTC closes unusable";

    it("an empty table logs once, with dropped=0", async () => {
      const spy = vi.spyOn(console, "error").mockImplementation(() => {});
      try {
        const { client } = makeClient([]);
        expect(await readBtcCloses(client)).toBeNull();
        expect(spy).toHaveBeenCalledTimes(1);
        const line = String(spy.mock.calls[0].join(" "));
        expect(line).toContain(TAG);
        expect(line).toContain("dropped=0");
      } finally {
        spy.mockRestore();
      }
    });

    it("every close dropped logs once, carrying the dropped count", async () => {
      const spy = vi.spyOn(console, "error").mockImplementation(() => {});
      try {
        const table: Row[] = [
          { date: "2026-02-02", symbol: "BTC", close_price: 0 },
          { date: "2026-02-03", symbol: "BTC", close_price: -5 },
          { date: "2026-02-04", symbol: "BTC", close_price: "not a number" },
        ];
        const { client } = makeClient(table);
        expect(await readBtcCloses(client)).toBeNull();
        expect(spy).toHaveBeenCalledTimes(1);
        const line = String(spy.mock.calls[0].join(" "));
        expect(line).toContain(TAG);
        expect(line).toContain("dropped=3");
      } finally {
        spy.mockRestore();
      }
    });

    it("a usable read logs nothing", async () => {
      const spy = vi.spyOn(console, "error").mockImplementation(() => {});
      try {
        const { client } = makeClient(btcRows(5));
        expect(await readBtcCloses(client)).not.toBeNull();
        expect(spy).not.toHaveBeenCalled();
      } finally {
        spy.mockRestore();
      }
    });
  });
});
