/**
 * Phase 169.4 plan 02 (D-77) — the ONE read of the BTC comparator's prices,
 * moved byte-for-byte out of `fetch-and-build-payload.ts` so a module that
 * must not load `server-only` (the allocator dashboard's `src/lib/queries.ts`,
 * which 150+ tests import without mocking it) can call it.
 *
 * ⛔ SERVER-SAFE BY CONSTRUCTION. This module imports nothing that imports
 * `server-only`: the admin client is named for its TYPE only (`import type`,
 * erased at build), and every value import (`align`, `benchmark-source`,
 * `benchmarks`) is pure. Importing `fetch-and-build-payload.ts` instead pulls
 * `composite-read-path.ts` (`import "server-only"`) into every test of
 * `queries.ts`; that is why this file exists.
 *
 * ⛔ NO CACHE REACH. `fetch-and-build-payload.ts` re-exports every name below
 * and uses `readFactsheetBenchmark` from here, so this module sits inside the
 * builder's import closure that `src/__tests__/phase-148-owner-lane-cache-isolation.test.ts`
 * walks: it must never import `next/cache` or name its cache functions.
 *
 * ⛔ Do NOT write a second BTC read. The factsheet builder and the allocator
 * dashboard both call `readFactsheetBenchmark` (169.4 D-69), so the Overview's
 * BTC comparator and every factsheet's are the same read.
 */
import type { createAdminClient } from "@/lib/supabase/admin";
import type { BenchmarkPricesOpt, BuildFactsheetOpts } from "./build-payload";
import { alignCoveredReturns, COMPARATOR_CALENDARS } from "./align";
import { mergeWithFixture, readBenchmarkPrices } from "./benchmark-source";
import { BTC_DAILY } from "./benchmarks";
import type { DailyReturn } from "./types";

/** Phase 169.5 (D-54) — the one stable message of a failed BTC read. */
export const BENCHMARK_READ_FAILED_MESSAGE =
  "[factsheet] benchmark_prices read failed; BTC comparator unavailable";

/**
 * 169.5 review SFH-M-02 — the one stable message of a data-driven unavailable
 * exit (the read succeeded but leaves nothing to compare). Its `reason` tells
 * "no stored close in the window" (a stalled refresh, say) from "closes, but no
 * covered interval"; both are distinct from the read-failure line above.
 */
export const BENCHMARK_UNAVAILABLE_MESSAGE =
  "[factsheet] BTC comparator unavailable: the benchmark read left nothing to compare";

const BENCHMARK_UNAVAILABLE: BenchmarkPricesOpt = { unavailable: true };

function isoMinusOneDay(iso: string): string {
  return new Date(Date.parse(`${iso}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
}

/**
 * Phase 169.5 BENCHCOMPARE (SC3, D-09, D-52, D-54, D-64 with Decision (4) as
 * amended 2026-09-30) — the ONE read of the BTC comparator's prices for a
 * factsheet build, returning the `benchmarkPrices` build opt. Both surfaces that
 * build a strategy factsheet call THIS function with the same inputs (the cash
 * `dailyReturns` and the assembled `buildOpts`), so they cannot diverge.
 *
 * Bounds (Amendment A): `from` is the earliest date across every axis a
 * comparator is aligned on (the cash series, `mtmSeries`, `smoothedSeries`)
 * minus one day, `to` the latest; min / max over every entry, so an unsorted
 * input cannot narrow them. With no date on any axis NO query is issued:
 * `readBenchmarkPrices` drops its filters when a bound is unset and would page
 * the whole table (T-169-21).
 *
 * The lower bound is load-bearing twice: it bounds the read (RESEARCH Pitfall
 * 2), and its close is the prior close that day one's return is taken from on
 * the earliest axis (D-64, 166.4 D-05 / D-07).
 *
 * The fixture merge (Amendment B, D-09): `mergeWithFixture` takes its first
 * stored date from the rows it is handed, which under a bounded read is the
 * window's first row, so a DB hole at the window's first day would be filled
 * from the fixture, and a DB holding history but no row in the window would get
 * the whole fixture back inside it (the stale bug itself). So one single-row
 * probe learns the DB's TRUE first stored BTC date (no close filter: a corrupt
 * stored row still counts as stored) and only fixture rows strictly before it
 * are merged. The probe does not breach the ONE-paged-reader rule (169 D-08,
 * 169.2 D-08): that rule stops PostgREST `max_rows` truncation of a price read,
 * and a one-row date probe reads no price and cannot be truncated.
 *
 * A read answering `ok: false`, a probe error, or a throw from either DB call
 * is the unavailable marker, never the fixture; it is logged with one stable
 * message plus `{ id, from, to, code, message }`, and not captured to Sentry
 * (D-54), so that line is the only trace. The honest unavailable form may be
 * cached for the TTL (D-52). Only the two DB calls sit inside the `try`
 * (169.5 review SFH-M-01): a throw from the pure merge / trim / align code is a
 * code bug, not a read outage, so it propagates as a build error instead of
 * rendering "BTC prices unavailable" and being logged as a DB failure.
 *
 * `strategyId` is for the log line only; it does not change what is read.
 */
export async function readFactsheetBenchmark(
  client: ReturnType<typeof createAdminClient>,
  dailyReturns: readonly DailyReturn[],
  buildOpts: BuildFactsheetOpts | undefined,
  strategyId: string | null = null,
): Promise<BenchmarkPricesOpt> {
  const axes: Array<readonly DailyReturn[]> = [
    dailyReturns,
    buildOpts?.mtmSeries?.dailyReturns ?? [],
    buildOpts?.smoothedSeries?.dailyReturns ?? [],
  ];
  let min: string | null = null;
  let max: string | null = null;
  for (const axis of axes) {
    for (const r of axis) {
      if (!r || typeof r.date !== "string") continue;
      if (min === null || r.date < min) min = r.date;
      if (max === null || r.date > max) max = r.date;
    }
  }
  const from = min === null ? undefined : isoMinusOneDay(min);
  const to = max ?? undefined;
  if (from === undefined || to === undefined) return BENCHMARK_UNAVAILABLE;
  const ctx: BenchmarkLogContext = { id: strategyId, from, to };

  const db = await readBtcWithFirstStoredDate(client, ctx);
  if (!db.ok) return BENCHMARK_UNAVAILABLE;
  const { read, firstStored } = db;
  const fixture =
    typeof firstStored === "string" ? BTC_DAILY.filter((p) => p.date < firstStored) : BTC_DAILY;
  const merged = mergeWithFixture({ prices: read.prices, dropped: read.dropped }, fixture);
  // mergeWithFixture prepends every fixture row older than the first stored
  // date (RESEARCH Pitfall 2, T-169-21): trim back to the read's bounds.
  const prices = merged.prices.filter((p) => p.date >= from && p.date <= to);
  const dropped = merged.dropped.filter((d) => d >= from && d <= to);
  const unavailableData = (reason: "no_prices_in_window" | "no_covered_interval"): BenchmarkPricesOpt => {
    console.warn(BENCHMARK_UNAVAILABLE_MESSAGE, {
      reason,
      ...ctx,
      firstStored: typeof firstStored === "string" ? firstStored : null,
      readCount: read.prices.length,
      readThrough: read.through,
    });
    return BENCHMARK_UNAVAILABLE;
  };
  if (prices.length === 0) return unavailableData("no_prices_in_window");
  const anyCovered = axes.some((axis) => {
    const dates = [...new Set(axis.filter((r) => r && typeof r.date === "string").map((r) => r.date))].sort();
    return dates.length > 0 && alignCoveredReturns(prices, dropped, dates, COMPARATOR_CALENDARS.btc).returns.some((r) => r !== null);
  });
  if (!anyCovered) return unavailableData("no_covered_interval");
  return { prices, through: prices[prices.length - 1].date, dropped };
}

/** The context every benchmark log line carries (169.5 review SFH-M-01). */
type BenchmarkLogContext = { id: string | null; from: string; to: string };

/**
 * The two DB calls of `readFactsheetBenchmark`, and ONLY those, under one
 * `try` (169.5 review SFH-M-01). Any error or throw here is logged by
 * `benchmarkReadFailed` and answered `ok: false`.
 */
async function readBtcWithFirstStoredDate(
  client: ReturnType<typeof createAdminClient>,
  ctx: BenchmarkLogContext,
): Promise<
  | { ok: true; read: Extract<Awaited<ReturnType<typeof readBenchmarkPrices>>, { ok: true }>; firstStored: unknown }
  | { ok: false }
> {
  try {
    const read = await readBenchmarkPrices(client, "BTC", { from: ctx.from, to: ctx.to });
    if (!read.ok) return benchmarkReadFailed(read.error, ctx);
    const probe = await client
      .from("benchmark_prices")
      .select("date")
      .eq("symbol", "BTC")
      .order("date", { ascending: true })
      .limit(1);
    if (probe.error) return benchmarkReadFailed(probe.error, ctx);
    if (probe.data == null) {
      return benchmarkReadFailed(new Error("benchmark_prices first-date probe returned no data and no error"), ctx);
    }
    return { ok: true, read, firstStored: (probe.data as Array<{ date?: unknown }>)[0]?.date };
  } catch (err) {
    return benchmarkReadFailed(err, ctx);
  }
}

function benchmarkReadFailed(err: unknown, ctx: BenchmarkLogContext): { ok: false } {
  const code =
    typeof err === "object" && err !== null && "code" in err
      ? String((err as { code?: unknown }).code)
      : err instanceof Error
        ? err.name
        : "unknown";
  // Error instances and PostgREST error objects both carry `message`; keep it,
  // since it is what tells the page-cap, cursor and empty-answer guards apart.
  const message =
    typeof err === "object" && err !== null && "message" in err
      ? String((err as { message?: unknown }).message)
      : String(err);
  console.error(BENCHMARK_READ_FAILED_MESSAGE, { ...ctx, code, message });
  return { ok: false };
}
