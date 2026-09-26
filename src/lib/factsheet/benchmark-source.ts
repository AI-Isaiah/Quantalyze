import type { SupabaseClient } from "@supabase/supabase-js";

import type { DailyPrice } from "./types";

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
 *   - `.range()` pages of BENCHMARK_PAGE_SIZE, looping until a page comes back
 *     EMPTY, advancing the offset by the rows ACTUALLY received. Stopping on a
 *     "short" page would be wrong: a server cap below the requested page size
 *     makes EVERY page short and would stop after the first one, which is the
 *     truncation this module exists to remove;
 *   - `date` alone is a total order here: the primary key is `(date, symbol)`
 *     and `symbol` is filtered, so pages can neither skip nor repeat a row;
 *   - a hard ceiling of BENCHMARK_MAX_PAGES returns an ERROR rather than
 *     looping forever against a server that never answers an empty page.
 *
 * ⛔ A read error is an ERROR (D-09). It is never replaced by the bundled
 * fixture: a stale fixture served in place of a failed read is the stale
 * benchmark bug itself, dressed as data. Callers render "unavailable".
 *
 * The reader takes an injected client and never creates one, so it carries no
 * `"use client"` directive and no request-scoped state; `mergeWithFixture` is a
 * pure function.
 */

export const BENCHMARK_PAGE_SIZE = 1000;
export const BENCHMARK_MAX_PAGES = 50;

/** The Python fetcher (`services/benchmark.py`) supports BTC only. */
export type BenchmarkSymbol = "BTC";

export type BenchmarkReadResult =
  | { ok: true; prices: DailyPrice[]; through: string | null }
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
  let offset = 0;

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

    const { data, error } = await query
      .order("date", { ascending: false })
      .range(offset, offset + BENCHMARK_PAGE_SIZE - 1);

    if (error) return { ok: false, error };

    const rows = (data ?? []) as PriceRow[];
    if (rows.length === 0) break;
    newestFirst.push(...rows);
    offset += rows.length;
  }

  const prices: DailyPrice[] = [];
  for (let i = newestFirst.length - 1; i >= 0; i -= 1) {
    const row = newestFirst[i];
    // PostgREST serializes Postgres `numeric` as a JSON STRING to keep
    // precision, so the close may arrive as a string. Coerce, then drop a
    // non-finite or non-positive close: it cannot price a return, and a zero
    // close would turn the next day's return into a division by zero.
    const close = Number(row.close_price);
    if (!Number.isFinite(close) || close <= 0) continue;
    prices.push({ date: row.date, close });
  }

  return {
    ok: true,
    prices,
    through: prices.length > 0 ? prices[prices.length - 1].date : null,
  };
}

/**
 * Merge DB closes with the bundled fixture (D-09): the fixture supplies ONLY
 * the dates strictly before the DB's first date, and every DB date wins. A
 * fixture row on or after the DB's first date never appears, so there is no
 * seam day inside the DB window. `through` is the last REAL price date: the
 * DB's last date, or the fixture's when the DB holds nothing.
 */
export function mergeWithFixture(
  dbPrices: DailyPrice[],
  fixture: DailyPrice[],
): { prices: DailyPrice[]; through: string | null } {
  if (dbPrices.length === 0) {
    return {
      prices: [...fixture],
      through: fixture.length > 0 ? fixture[fixture.length - 1].date : null,
    };
  }
  const dbFirst = dbPrices[0].date;
  const prefix = fixture.filter((p) => p.date < dbFirst);
  return {
    prices: [...prefix, ...dbPrices],
    through: dbPrices[dbPrices.length - 1].date,
  };
}
