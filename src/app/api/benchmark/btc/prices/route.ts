import { NextResponse, after } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { captureToSentry, shouldCaptureNow } from "@/lib/sentry-capture";
import {
  mergeWithFixture,
  readBenchmarkPrices,
} from "@/lib/factsheet/benchmark-source";
import { BTC_DAILY } from "@/lib/factsheet/benchmarks";
import {
  publicIpLimiter,
  checkLimit,
  getClientIp,
  isRateLimitMisconfigured,
} from "@/lib/ratelimit";

/**
 * Phase 169.4 ALLOCTRUTH / plan 169.4-03 (D-67) — GET /api/benchmark/btc/prices
 *
 * Serves BTC daily CLOSES to the Scenario composer and the scenario-share page
 * as `{ prices, dropped, through }` (the available arm of `BenchmarkPricesOpt`).
 * Those surfaces need closes, not returns: the overlay is the close level
 * (D-66) and the benchmark-relative metrics pair through `alignCoveredReturns`
 * (D-68), which needs the closes and the `dropped` list.
 *
 * The read (D-67): ONE unbounded `readBenchmarkPrices(client, "BTC")`, the
 * paged 169.2 reader of `benchmark_prices`, then
 * `mergeWithFixture(read, BTC_DAILY)`, so the bundled fixture supplies only
 * dates strictly before the database's first STORED date (D-09). An unbounded
 * read's first row is the database's true first stored row, a dropped row
 * included, so no separate probe for it is needed.
 *
 * Why a NEW URL rather than a new body at the returns route's URL: that
 * route's body is cached `public, s-maxage=3600, stale-while-revalidate=86400`,
 * so a changed body at the same URL would let a new client read an old-shape
 * body for up to a day. Consumers validate the shape (`parseBtcCloses`) and
 * treat anything else as unavailable.
 *
 * Public-cacheable: `benchmark_prices` is shared market data (date, symbol,
 * close_price; RLS `SELECT USING(true)`; writes service_role only), identical
 * for every caller, so a shared CDN/browser cache leaks nothing. The route is
 * public through the `/api/benchmark/btc` entry of `PUBLIC_ROUTES` in
 * `proxy.ts`, which matches `route + "/"`.
 *
 * Honesty on failure: a READ ERROR answers 503 with `Cache-Control: no-store`
 * and a static body (169.2 SFH MD-05), never the fixture (D-09: a stale fixture
 * served in place of a failed read is the stale-benchmark bug dressed as data).
 * The raw database error is logged and captured server-side only. A stored
 * close that cannot price a return is reported in `dropped` and absent from
 * `prices`, logged on every request, and captured at most once per window per
 * instance (`shouldCaptureNow`), scheduled with `after()` so the capture
 * survives the function freezing once the response is sent.
 *
 * Security: no query parameter is read and no request body is read; the symbol
 * is fixed to 'BTC', so no caller input reaches SQL.
 *
 * Rate limit: `publicIpLimiter` per IP, taken FIRST, before the database read.
 * The CDN cache absorbs identical URLs only; a cache-busting query string
 * reaches the function on every request, so the limiter, not the cache, is the
 * abuse defense.
 */

// AGENTS.md: the SSR cookie client needs the Node.js runtime.
export const runtime = "nodejs";

// Shared market data, refreshed about daily by the analytics service.
const CACHE_CONTROL = "public, s-maxage=3600, stale-while-revalidate=86400";

// A read error must not be cached anywhere: the next request retries the read.
const ERROR_CACHE_CONTROL = "no-store";

// How many of the newest dropped dates one capture carries.
const DROPPED_EXTRA_CAP = 20;

const ROUTE_TAG = "api/benchmark/btc/prices";

export async function GET(req: Request): Promise<NextResponse> {
  const rl = await checkLimit(
    publicIpLimiter,
    `benchmark-btc-prices:${getClientIp(req.headers)}`,
  );
  if (!rl.success) {
    return NextResponse.json(
      {
        error: isRateLimitMisconfigured(rl)
          ? "Service temporarily unavailable"
          : "Too many requests",
      },
      {
        status: isRateLimitMisconfigured(rl) ? 503 : 429,
        headers: { "Retry-After": String(rl.retryAfter) },
      },
    );
  }

  const supabase = await createClient();
  const read = await readBenchmarkPrices(supabase, "BTC");

  if (!read.ok) {
    console.error("[api/benchmark/btc/prices] select error:", read.error);
    if (shouldCaptureNow("benchmark-btc-prices:read-error")) {
      after(() =>
        captureToSentry(read.error, {
          tags: { route: ROUTE_TAG, stage: "read" },
        }),
      );
    }
    return NextResponse.json(
      { error: "Benchmark temporarily unavailable" },
      { status: 503, headers: { "Cache-Control": ERROR_CACHE_CONTROL } },
    );
  }

  if (read.dropped.length > 0) {
    // The message carries no count, so every event groups as one issue; the
    // count and the newest dropped dates (capped) ride in `extra`.
    console.warn(
      "[api/benchmark/btc/prices] dropped unusable closes:",
      read.dropped.length,
    );
    if (shouldCaptureNow("benchmark-btc-prices:dropped-closes")) {
      const count = read.dropped.length;
      const newest = read.dropped.slice(-DROPPED_EXTRA_CAP);
      after(() =>
        captureToSentry(
          new Error("benchmark_prices holds unusable BTC closes"),
          {
            tags: { route: ROUTE_TAG, stage: "dropped-closes" },
            level: "warning",
            extra: { count, dropped: newest },
          },
        ),
      );
    }
  }

  const { prices, dropped, through } = mergeWithFixture(read, BTC_DAILY);

  return NextResponse.json(
    { prices, dropped, through },
    { status: 200, headers: { "Cache-Control": CACHE_CONTROL } },
  );
}
