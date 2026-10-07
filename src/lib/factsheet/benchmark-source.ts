import type { SupabaseClient } from "@supabase/supabase-js";

import type { BenchmarkPricesOpt, DailyPrice } from "./types";

/**
 * Phase 169.2 / plan 01 (SC3, D-08, D-09) — the ONE reader of `benchmark_prices`.
 *
 * The defect this replaces. `/api/benchmark/btc` read the table with a single
 * UNRANGED select ordered ascending. PostgREST caps every unranged read at
 * `max_rows` (1000 in `supabase/config.toml`) and answers HTTP 200 with
 * `error: null` and a PARTIAL body, so once the table held more than 1000 BTC
 * days the route silently returned the OLDEST 1000 and the newest days never
 * reached a reader. Nothing about the response said it was truncated.
 *
 * The read here (D-08):
 *   - newest-first (`date` DESCENDING), so a truncation, if one ever happened,
 *     would drop the OLDEST days rather than the current ones;
 *   - KEYSET pages of BENCHMARK_PAGE_SIZE: each page after the first asks for
 *     `date < <the oldest date already read>` with `.limit()`, looping until a
 *     page comes back EMPTY. Stopping on a "short" page would be wrong: a
 *     server cap below the requested page size makes EVERY page short and
 *     would stop after the first one, which is the truncation this module
 *     exists to remove;
 *   - why keyset and not `.range()` offsets (169.2 review WR-03 / MD-04): the
 *     daily refresh upserts a NEW NEWEST day, and newest-first an insert lands
 *     at offset 0. An insert between two offset pages shifts every row down one
 *     place, so the next page re-reads the previous page's last row and the
 *     series carries the same date twice. A keyset cursor is anchored to a
 *     DATE, so a row inserted above it is simply not read by this call;
 *   - `date` alone is a total order here: the primary key is `(date, symbol)`
 *     and `symbol` is filtered. The reader still CHECKS that the dates it
 *     accumulates strictly decrease and returns an ERROR on a repeat or an
 *     out-of-order row (a server that ignored the cursor), never a series
 *     with a duplicated day;
 *   - a hard ceiling of BENCHMARK_MAX_PAGES returns an ERROR rather than
 *     looping forever against a server that never answers an empty page;
 *   - a page answering neither data nor an error is an ERROR, not the end of
 *     the table (SFH LW-03): treating it as the end would return a partial
 *     series as complete, the exact class this module exists to prevent.
 *
 * A stored close that is non-numeric, non-finite or non-positive cannot price
 * a return, so it is left out of `prices`, and its date is reported in
 * `dropped` (169.2 review WR-04 / MD-03) so the corrupt row stays visible.
 *
 * ⛔ Returns come from `pricesToDailyReturns(prices, dropped)` ONLY. Its rule
 * (169.2 round 3, narrowing round-2 WR-03):
 *   - a MISSING stored day is BRIDGED: adjacent stored closes give one return
 *     at the later date, as before 169.2 and as `benchmark.py`
 *     `prices_to_returns` (`pct_change().dropna()`) does. The cumulative BTC
 *     overlay compounds these returns, so bridging keeps it on BTC's real
 *     level across a missing row;
 *   - a DROPPED (corrupt) close is NOT bridged: a pair whose span contains a
 *     `dropped` date yields no return, so a bad close at D gives no return at
 *     the next stored day (169.2 review WR-04 / MD-03). A consumer therefore
 *     MUST pass the reader's `dropped` through.
 * Known limit: a bridged multi-day move is stamped at the later date as if it
 * were one day, so daily-return metrics see it as one observation.
 * The Python CACHE check (`_cache_miss_reason`) refuses to serve a gapped
 * cache, but Python's own `prices_to_returns` bridges any gap too; neither
 * side has a one-day rule.
 *
 * ⛔ A read error is an ERROR (D-09). It is never replaced by the bundled
 * fixture: a stale fixture served in place of a failed read is the stale
 * benchmark bug itself, dressed as data. Callers render "unavailable".
 *
 * The reader takes an injected client and never creates one, so it carries no
 * `"use client"` directive and no request-scoped state; `mergeWithFixture` is a
 * pure function.
 *
 * `mergeWithFixture` has no production caller in THIS phase (169.2 review
 * IN-01), deliberately: `/api/benchmark/btc` serves the DB series only. Its
 * planned consumers are Phase 169 FACTSHEETTRUTH plan 169-02 (the factsheet's
 * `fetchAndBuildPayload`), plan 169-03, and Phase 169.4 ALLOCTRUTH plan
 * 169.4-02, which read BTC through `readBenchmarkPrices` and merge the bundled
 * fixture strictly before the DB's first STORED date (D-09), and derive returns
 * through `pricesToDailyReturns`.
 */

export const BENCHMARK_PAGE_SIZE = 1000;
export const BENCHMARK_MAX_PAGES = 50;

/** The Python fetcher (`services/benchmark.py`) supports BTC only. */
export type BenchmarkSymbol = "BTC";

export type BenchmarkReadResult =
  | {
      ok: true;
      prices: DailyPrice[];
      through: string | null;
      /**
       * Ascending dates of stored rows whose close could not price a return
       * (non-numeric, non-finite or non-positive). They are NOT in `prices`.
       * Carried for visibility (the btc route reports them), for
       * `pricesToDailyReturns`, which must not bridge a dropped date, and for
       * `mergeWithFixture`, which must not let the fixture fill a stored date.
       */
      dropped: string[];
    }
  | { ok: false; error: unknown };

export interface BenchmarkReadOptions {
  /** Inclusive ISO lower bound (`YYYY-MM-DD`). */
  from?: string;
  /** Inclusive ISO upper bound (`YYYY-MM-DD`). */
  to?: string;
}

type PriceRow = { date: string; close_price: number | string | null };

/**
 * Read every stored close for `symbol` (optionally bounded to `[from, to]`),
 * returned ascending by date, with `through` = the newest date read.
 */
export async function readBenchmarkPrices(
  client: SupabaseClient,
  symbol: BenchmarkSymbol,
  opts: BenchmarkReadOptions = {},
): Promise<BenchmarkReadResult> {
  const newestFirst: PriceRow[] = [];
  // The keyset cursor: the oldest date read so far. The next page asks only
  // for rows strictly older than it.
  let before: string | null = null;

  for (let page = 0; ; page += 1) {
    if (page >= BENCHMARK_MAX_PAGES) {
      return {
        ok: false,
        error: new Error(
          `benchmark_prices read exceeded ${BENCHMARK_MAX_PAGES} pages without an empty page`,
        ),
      };
    }

    let query = client
      .from("benchmark_prices")
      .select("date, close_price")
      .eq("symbol", symbol);
    if (opts.from) query = query.gte("date", opts.from);
    if (opts.to) query = query.lte("date", opts.to);
    if (before !== null) query = query.lt("date", before);

    const { data, error } = await query
      .order("date", { ascending: false })
      .limit(BENCHMARK_PAGE_SIZE);

    if (error) return { ok: false, error };
    if (data == null) {
      return {
        ok: false,
        error: new Error("benchmark_prices page returned no data and no error"),
      };
    }

    const rows = data as PriceRow[];
    if (rows.length === 0) break;
    for (const row of rows) {
      // Strictly decreasing, across pages too. A repeat or an out-of-order row
      // means the server did not honour the cursor or the order; fail loud
      // rather than hand back a series with a duplicated day.
      if (before !== null && !(row.date < before)) {
        return {
          ok: false,
          error: new Error(
            `benchmark_prices page ${page + 1} returned ${row.date}, not strictly older than ${before}`,
          ),
        };
      }
      newestFirst.push(row);
      before = row.date;
    }
  }

  const prices: DailyPrice[] = [];
  const dropped: string[] = [];
  for (let i = newestFirst.length - 1; i >= 0; i -= 1) {
    const row = newestFirst[i];
    // PostgREST serializes Postgres `numeric` as a JSON STRING to keep
    // precision, so the close may arrive as a string. Coerce, then leave out a
    // non-finite or non-positive close (it cannot price a return, and a zero
    // close would turn the next day's return into a division by zero), and
    // record its date so the corrupt row stays visible.
    const close = Number(row.close_price);
    if (!Number.isFinite(close) || close <= 0) {
      dropped.push(row.date);
      continue;
    }
    prices.push({ date: row.date, close });
  }

  return {
    ok: true,
    prices,
    through: prices.length > 0 ? prices[prices.length - 1].date : null,
    dropped,
  };
}

export interface BenchmarkReturnPoint {
  date: string;
  value: number;
}

/**
 * Daily returns from ascending closes, mirroring `benchmark.py`
 * `prices_to_returns` (`pct_change().dropna()`): each value is
 * `close / prevClose - 1`, stamped at the current close's date, and the first
 * close yields nothing.
 *
 * A MISSING day is bridged: two adjacent closes give one return at the later
 * date whatever the calendar distance, so a compounded overlay keeps BTC's
 * real level. Known limit: that bridged multi-day move is stamped at the later
 * date as one observation. The same holds at a `mergeWithFixture` seam: when
 * the fixture's last date and the DB's first date are not consecutive and no
 * `dropped` date lies between them, one return is bridged from a fixture close
 * to a DB close, stamped at the DB's first date.
 *
 * A DROPPED close is not bridged (169.2 review WR-04 / MD-03): when any
 * `dropped` date d has `prev.date < d < cur.date`, the pair yields no return,
 * so a corrupt close at D gives no return at D and none at the next stored
 * day. `dropped` is the reader's ascending list (`BenchmarkReadResult.dropped`,
 * or `mergeWithFixture`'s pass-through).
 *
 * Every close is expected to be finite and positive (`readBenchmarkPrices`
 * guarantees it); the `Number.isFinite` check catches a float overflow of an
 * extreme ratio.
 */
export function pricesToDailyReturns(
  prices: DailyPrice[],
  dropped: readonly string[],
): BenchmarkReturnPoint[] {
  const out: BenchmarkReturnPoint[] = [];
  // Both lists are ascending ISO dates, so one forward pointer over `dropped`
  // finds the first dropped date after each `prev`.
  let d = 0;
  for (let i = 1; i < prices.length; i += 1) {
    const prev = prices[i - 1];
    const cur = prices[i];
    while (d < dropped.length && dropped[d] <= prev.date) d += 1;
    if (d < dropped.length && dropped[d] < cur.date) continue;
    const value = cur.close / prev.close - 1;
    if (!Number.isFinite(value)) continue;
    out.push({ date: cur.date, value });
  }
  return out;
}

/**
 * Merge DB closes with the bundled fixture (D-09): the fixture supplies ONLY
 * the dates strictly before the FIRST STORED date, and every DB date wins.
 *
 * "First stored" includes a `dropped` (corrupt) row (169.2 round-2 SFH
 * MD-R2-01): cutting at the first VALID date would let the fixture fill a
 * dropped date inside the DB window, a fixture/DB seam day the D-09 rule
 * forbids. So a fixture row on or after the first stored date never appears,
 * and a dropped date stays a hole, which `pricesToDailyReturns` then refuses
 * to bridge. `dropped` is passed through so the consumer can report it and
 * hand it to `pricesToDailyReturns(merged.prices, merged.dropped)`.
 *
 * `through` is the last date in the merged series, or null when it is empty.
 * It is NOT a DB-freshness signal: when the DB holds no valid close (empty,
 * or every stored row dropped), it is a bundled FIXTURE date.
 */
export function mergeWithFixture(
  db: { prices: DailyPrice[]; dropped: string[] },
  fixture: DailyPrice[],
): { prices: DailyPrice[]; through: string | null; dropped: string[] } {
  // Both lists are ascending, so each one's first element is its oldest.
  const firstStored = [db.prices[0]?.date, db.dropped[0]]
    .filter((d): d is string => d !== undefined)
    .sort()[0];
  const prefix =
    firstStored === undefined
      ? fixture
      : fixture.filter((p) => p.date < firstStored);
  const prices = [...prefix, ...db.prices];
  return {
    prices,
    through: prices.length > 0 ? prices[prices.length - 1].date : null,
    dropped: db.dropped,
  };
}

/**
 * Phase 164.6.6.2 (D-18, D-22, D-23): the ONE server-side source of BTC closes
 * for converting a BTC-native strategy's returns to USD
 * (`convertNativeReturnsToUsd`, plans 09 and 10).
 *
 * The conversion has ONE price window in both runtimes: every usable BTC close
 * stored in `benchmark_prices`, and nothing else. The Python twin
 * (`get_btc_closes`, plan 13) reads the same window DB-only, because the
 * analytics image cannot ship the bundled `BTC_DAILY` file. So this reader does
 * NOT call `mergeWithFixture`: a bundled prefix would price early days in
 * TypeScript that Python leaves absent, and the two runtimes would blend
 * different numbers. The shared oracle fixture pins it
 * (`closes_source: "benchmark_prices only"`).
 *
 * The public `/api/benchmark/btc/prices` route (the benchmark OVERLAY) is a
 * different contract and keeps the fixture prefix; it is unchanged.
 *
 * Returns null when the read errors (one `console.error`, never the fixture,
 * D-09) or when no usable close is stored (one `console.error` carrying the
 * dropped count, SFH-1): "no price source", which the conversion turns into an
 * empty series rather than an invented one.
 */
export async function readBtcCloses(
  client: SupabaseClient,
): Promise<Extract<BenchmarkPricesOpt, { prices: DailyPrice[] }> | null> {
  const read = await readBenchmarkPrices(client, "BTC");
  if (!read.ok) {
    console.error("[benchmark-source] BTC closes read failed", read.error);
    return null;
  }
  if (read.prices.length === 0) {
    // SFH-1 (164.6.6.2 review): this null is not an error, so it used to say
    // nothing, while every native-unit leg downstream silently left its blend.
    // Name it, with how many closes were refused as corrupt (0 = empty table).
    console.error(
      `[benchmark-source] BTC closes unusable: no usable close stored (dropped=${read.dropped.length}); native-unit legs cannot be priced`,
    );
    return null;
  }
  return { prices: read.prices, dropped: read.dropped, through: read.through };
}
