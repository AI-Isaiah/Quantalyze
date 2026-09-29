/**
 * Phase 167.1.2 C3 / fix F (SFH-C3R2-X1) — read EVERY row of a filtered
 * PostgREST select, however many there are.
 *
 * THE DEFECT THIS EXISTS FOR. PostgREST caps every response at `max_rows`
 * (1000 on the hosted project; `supabase/config.toml` sets the same for the
 * local stack only) whatever `.limit()` the client asks for, and it answers
 * HTTP 200 with `error: null` and a PARTIAL body. A single
 * `.order("date", asc).limit(20000)` read therefore returns the OLDEST 1000
 * rows and silently drops the newest. Measured on PROD 2026-09-29: one
 * allocator holds 2348 `csv_daily_returns` rows inside the dashboard's 730-day
 * window, so its dashboard read lost ~1348 of its most recent days.
 *
 * THE READ (the `benchmark-source.ts` keyset discipline, generalised):
 *   - KEYSET pages on the table's `id` primary key. Every page after the
 *     first asks for `id > <the largest id already read>`, ordered by `id`
 *     ascending, `.limit(pageSize)`. `id` alone is a total order.
 *   - why `id` and not the natural key (`api_key_id`, `date`): since C3 fix H
 *     the Python writers of these tables UPSERT the new payload first
 *     (ON CONFLICT DO UPDATE keeps a present day's row and its id) and only
 *     then delete the days the payload no longer carries. A day the payload
 *     adds is INSERTED with a NEW, larger id, so an id cursor still reaches it
 *     later in the same drain, where a natural-key cursor that had already
 *     passed its (key, date) would skip it. Offsets (`.range()`) are worse: a
 *     delete between two pages shifts every later row up one place and the
 *     next page skips one.
 *   - the price of the id cursor: a row read, then deleted and re-inserted
 *     before the drain ends, is read TWICE under two ids. That happens to a
 *     day one derive refused (deleted) and a later derive accepts again
 *     (inserted), and to any writer that still deletes and then re-inserts
 *     (the SQL finalize fold was not opened to check). The drain collapses
 *     every natural-key duplicate to the row with the LARGEST id, which is the
 *     newer write. No natural key is ever returned twice.
 *   - the freshness of one drain: an UPDATE in place keeps its id, so a row the
 *     cursor already passed keeps the value read before the rewrite, while a
 *     day inserted later in the drain comes back new. One drain can therefore
 *     mix two derivations, the same freshness a chunked writer already allows.
 *   - the loop stops on an EMPTY page, never on a short one. A server cap
 *     below `pageSize` makes every page short, and stopping on a short page
 *     would be the very truncation this module removes.
 *   - ids must strictly increase, across pages too. A repeat or an
 *     out-of-order id means the server ignored the cursor; that is an ERROR,
 *     never a series with a duplicated or missing row.
 *   - a page answering neither data nor an error is an ERROR, not the end of
 *     the table.
 *   - a hard ceiling of `maxPages` returns an ERROR rather than looping
 *     forever or handing back a partial read as complete.
 *
 * The result is error-AS-VALUE (`{ data, error }`), the shape a supabase-js
 * builder resolves to, so a caller's existing read-failure path (the
 * dashboard's `assertOk`: log + throw, which reaches Sentry) handles a
 * truncation exactly as it handles a PostgREST error. Nothing here logs.
 *
 * The rows come back deduplicated and sorted ascending by `naturalKey`, so a
 * caller that needs date order within a key gets it without a server ORDER BY
 * on the natural key.
 *
 * The helper takes a page factory and never creates a client, so it serves the
 * server client, the admin client and the browser client alike.
 */

/** One request's worth of rows. Matches PostgREST's own cap. */
export const DRAIN_PAGE_SIZE = 1000;

/** Ceiling on requests per drain: 100 pages of 1000 rows. */
export const DRAIN_MAX_PAGES = 100;

export type DrainPage<Row> = PromiseLike<{
  data: Row[] | null;
  error: unknown;
}>;

export interface DrainByIdOptions<Row extends { id: number }> {
  /** Names the read in an error message (e.g. the table). */
  label: string;
  /**
   * Build ONE page: the caller's filtered select, plus `.gt("id", afterId)`
   * when `afterId` is not null, then `.order("id", { ascending: true })`
   * and `.limit(pageSize)`.
   */
  fetchPage: (afterId: number | null, pageSize: number) => DrainPage<Row>;
  /**
   * The row's natural key (e.g. `${api_key_id}|${date}`). Rows sharing one
   * collapse to the largest id; the result is sorted ascending by it.
   */
  naturalKey: (row: Row) => string;
  pageSize?: number;
  maxPages?: number;
}

export type DrainResult<Row> =
  | { data: Row[]; error: null }
  | { data: null; error: { message: string; cause?: unknown } };

/** Read every row `fetchPage` can reach. See the module comment. */
export async function drainById<Row extends { id: number }>(
  opts: DrainByIdOptions<Row>,
): Promise<DrainResult<Row>> {
  const pageSize = opts.pageSize ?? DRAIN_PAGE_SIZE;
  const maxPages = opts.maxPages ?? DRAIN_MAX_PAGES;
  const fail = (message: string, cause?: unknown): DrainResult<Row> => ({
    data: null,
    error: { message: `${opts.label}: ${message}`, cause },
  });

  // Insertion into a Map keeps the LATEST value for a repeated key, and ids
  // arrive strictly increasing, so the surviving row is the largest id.
  const byKey = new Map<string, Row>();
  let afterId: number | null = null;

  for (let page = 0; ; page += 1) {
    if (page >= maxPages) {
      return fail(
        `read exceeded ${maxPages} pages of ${pageSize} rows without an empty page`,
      );
    }
    const { data, error } = await opts.fetchPage(afterId, pageSize);
    if (error) {
      const message =
        typeof error === "object" &&
        error !== null &&
        "message" in error &&
        typeof (error as { message: unknown }).message === "string"
          ? (error as { message: string }).message
          : String(error);
      return fail(`page ${page + 1} failed: ${message}`, error);
    }
    if (data == null) {
      return fail(`page ${page + 1} returned no data and no error`);
    }
    if (data.length === 0) break;

    for (const row of data) {
      const id = row.id;
      if (typeof id !== "number" || !Number.isSafeInteger(id)) {
        return fail(`page ${page + 1} returned a row without an integer id`);
      }
      if (afterId !== null && !(id > afterId)) {
        return fail(
          `page ${page + 1} returned id ${id}, not strictly after ${afterId}`,
        );
      }
      afterId = id;
      byKey.set(opts.naturalKey(row), row);
    }
  }

  const rows = Array.from(byKey.entries())
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([, row]) => row);
  return { data: rows, error: null };
}
