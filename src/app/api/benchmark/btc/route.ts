import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { captureToSentry } from "@/lib/sentry-capture";

/**
 * Phase 24 / Plan 24-02 — GET /api/benchmark/btc
 *
 * Exposes the BTC benchmark **daily-returns** series to the scenario composer:
 * read `benchmark_prices` (symbol='BTC') server-side, sort ascending, convert
 * close_price to daily returns via pct-change, and return `[{date, value}]`.
 *
 * Why this is PUBLIC-cacheable (the deliberate contrast with the allocator
 * no-store routes):
 *   `benchmark_prices` is SHARED MARKET DATA — exactly three columns
 *   (date, symbol, close_price), zero tenant/user/allocator/strategy data,
 *   RLS `SELECT USING(true)`, writes restricted to service_role
 *   (20260406065011_security_hardening.sql:3-19). The series is identical for
 *   every caller, so a shared CDN/browser cache leaks nothing (threat T-24-01).
 *   This is the OPPOSITE of /api/strategies/browse, which sends a
 *   `private, no-store` header because strategy catalogs are visibility-scoped.
 *   Do NOT import the shared no-store header constant here.
 *
 * Caching model (AGENTS.md — read node_modules/next/dist/docs/.../15-route-
 * handlers.md): Route Handlers are NOT cached by default in Next 16; a DB read
 * via the SSR cookie client reads the request cookie store (await-ed inside
 * createClient) and is therefore DYNAMIC, so `force-static`/`use cache` do NOT
 * apply. Cache via a response `Cache-Control`
 * header instead. `benchmark.py` upserts on a ~daily cadence and rejects cache
 * older than 48h, so a 1h s-maxage with SWR is safely fresh.
 *
 * Honesty on failure: a read error OR an empty/missing result degrades to
 * HTTP 200 with `[]` (threat T-24-05 / Pitfall 5) so the composer renders the
 * neutral "Benchmark comparison unavailable" empty state — never a 500/red
 * alert. The raw DB error is logged + captured server-side, never surfaced.
 *
 * Security: no query params are accepted; the symbol is hard-coded 'BTC'
 * (V5 input-validation — no user input reaches SQL; CONTEXT locks BTC-only).
 */

// AGENTS.md: the SSR cookie client needs the Node.js runtime; Edge would skip
// the Node-only paths the cookie store relies on.
export const runtime = "nodejs";

export interface BenchmarkReturnPoint {
  date: string;
  value: number;
}

// Shared market data, refreshed ~daily by benchmark.py. A short s-maxage with
// stale-while-revalidate is appropriate — NOT private/no-store (the data is
// identical for every caller and leaks nothing).
const CACHE_CONTROL = "public, s-maxage=3600, stale-while-revalidate=86400";

function emptyResponse(): NextResponse {
  return NextResponse.json([] as BenchmarkReturnPoint[], {
    status: 200,
    headers: { "Cache-Control": CACHE_CONTROL },
  });
}

export async function GET(): Promise<NextResponse> {
  const supabase = await createClient();

  // RLS `SELECT USING(true)` lets the anon SSR client read; it CANNOT write
  // (writes are service_role-only). Select ONLY date + close_price so no other
  // column can ever reach the response (`symbol` is the fixed filter, not data).
  const { data, error } = await supabase
    .from("benchmark_prices")
    .select("date, close_price")
    .eq("symbol", "BTC")
    .order("date", { ascending: true });

  if (error) {
    // Degrade to the honest empty state — never a 500/red envelope. The raw
    // Postgres error (column names / SQLSTATE / schema detail) is logged +
    // captured server-side only.
    console.error("[api/benchmark/btc] select error:", error);
    captureToSentry(error, { tags: { route: "api/benchmark/btc" } });
    return emptyResponse();
  }

  const rows = (data ?? []) as Array<{ date: string; close_price: number }>;
  if (rows.length < 2) {
    // 0 or 1 rows → no daily return can be derived (every return needs a prior
    // close). Honest empty series.
    return emptyResponse();
  }

  // Daily returns via pct-change, mirroring benchmark.py `prices_to_returns`
  // (`pct_change().dropna()`): the first row is dropped (no prior close), and
  // each value = close / prevClose − 1, stamped at the current row's date.
  const series: BenchmarkReturnPoint[] = [];
  for (let i = 1; i < rows.length; i += 1) {
    // PostgREST serializes Postgres `numeric`/`DECIMAL` as JSON STRINGS to
    // preserve precision (even though database.types.ts:459 types close_price
    // as `number`), so the driver may yield either a string or a number.
    // Coerce BOTH ends with Number(...) before the finite/positive guards
    // (mirrors benchmark.py `.astype(float)` and the asNumber DB-numeric
    // contract in portfolio-analytics-adapter.ts). The existing `<= 0` /
    // non-finite guards still neutralize the empty/null cases —
    // Number("") === 0 and Number(null) === 0 are caught by `prevClose <= 0`.
    const prevClose = Number(rows[i - 1].close_price);
    const close = Number(rows[i].close_price);
    // Guard a null/zero/negative/non-finite close on EITHER end: skip the point
    // rather than emit Infinity/NaN or a finite-but-corrupt return (a non-positive
    // `close` yields value <= -1, i.e. <= -100%/day, which would silently poison
    // TE/IR/beta downstream). A non-finite return would corrupt them too.
    if (
      !Number.isFinite(prevClose) ||
      prevClose <= 0 ||
      !Number.isFinite(close) ||
      close <= 0
    ) {
      continue;
    }
    const value = close / prevClose - 1;
    if (!Number.isFinite(value)) continue;
    series.push({ date: rows[i].date, value });
  }

  return NextResponse.json(series, {
    status: 200,
    headers: { "Cache-Control": CACHE_CONTROL },
  });
}
