import { NextResponse, after } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { captureToSentry, shouldCaptureNow } from "@/lib/sentry-capture";
import {
  pricesToDailyReturns,
  readBenchmarkPrices,
  type BenchmarkReturnPoint,
} from "@/lib/factsheet/benchmark-source";
import {
  publicIpLimiter,
  checkLimit,
  getClientIp,
  isRateLimitMisconfigured,
} from "@/lib/ratelimit";

/**
 * Phase 24 / Plan 24-02 — GET /api/benchmark/btc
 *
 * Exposes the BTC benchmark **daily-returns** series to the scenario composer:
 * read `benchmark_prices` (symbol='BTC') server-side, sort ascending, convert
 * close_price to daily returns via pct-change, and return `[{date, value}]`.
 *
 * Phase 169.2 (SC3, D-08): the read goes through `readBenchmarkPrices`, the ONE
 * paged reader of the table. The route used to issue a single unranged,
 * ascending select; PostgREST caps that at `max_rows` (1000) with a 200 and a
 * partial body, so once the table held more than 1000 BTC days this route
 * answered the OLDEST 1000 and never the newest. The reader pages newest-first
 * until an empty page. This route serves the DB series only: it does NOT merge
 * the bundled fixture.
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
 * Honesty on failure: an empty/missing series (0 or 1 stored closes) is HTTP
 * 200 with `[]` and the normal public cache, because "no data" is a fact about
 * the table. A READ ERROR is different (169.2 SFH MD-05): it answers 503 with
 * `Cache-Control: no-store`, so one transient PostgREST error is never pinned
 * at the CDN as a cached `200 []` for the whole s-maxage/SWR window, and a
 * caller can tell "unavailable" (D-09) from "no data". Both callers
 * (`ScenarioComposer`'s mount fetch and the scenario-share page's
 * `fetchBtcDaily`) already treat any non-2xx as the neutral "Benchmark
 * comparison unavailable" empty state, never a red alert. The raw DB error is
 * logged + captured server-side, never surfaced (static body).
 *
 * Sentry volume (169.2 round-2 review WR-01, IN-03): this route is public and
 * cache-bustable, and the 503 is no-store, so during an incident (or while a
 * corrupt row sits in the table) every request reaches the function. The
 * console line stays UNCONDITIONAL on every request; only the remote capture
 * is gated by `shouldCaptureNow` (one per arm per instance per window), with a
 * stable message and a bounded `extra`. Each capture is scheduled with
 * `after()` so it survives the function freezing once the response is sent.
 *
 * Security: no query params are accepted; the symbol is hard-coded 'BTC'
 * (V5 input-validation — no user input reaches SQL; CONTEXT locks BTC-only).
 *
 * Rate limit: this route is in PUBLIC_ROUTES (proxy.ts) so the anonymous
 * scenario-share recipient page can self-fetch the benchmark overlay. Being
 * public removed the implicit session-gate that was its only request cap, so
 * it now carries publicIpLimiter (10/min/IP) like the other public DB-touching
 * GETs (demo/match, portfolio-pdf). The CDN `s-maxage` only absorbs identical
 * URLs; an attacker can bust the cache with `?x=rand` (Vercel keys on the full
 * URL) and hit the full paged read on every request, so the per-IP limiter —
 * not the cache — is the abuse defense. Cached hits never reach the function,
 * so the limiter does not throttle legitimate cached reads.
 */

// AGENTS.md: the SSR cookie client needs the Node.js runtime; Edge would skip
// the Node-only paths the cookie store relies on.
export const runtime = "nodejs";

export type { BenchmarkReturnPoint };

// Shared market data, refreshed ~daily by benchmark.py. A short s-maxage with
// stale-while-revalidate is appropriate — NOT private/no-store (the data is
// identical for every caller and leaks nothing).
const CACHE_CONTROL = "public, s-maxage=3600, stale-while-revalidate=86400";

// A read error must not be cached anywhere (SFH MD-05): the next request has
// to retry the read, not replay the failure.
const ERROR_CACHE_CONTROL = "no-store";

// How many of the newest dropped dates one capture carries. A bulk corruption
// must not ship every date on every event.
const DROPPED_EXTRA_CAP = 20;

function emptyResponse(): NextResponse {
  return NextResponse.json([] as BenchmarkReturnPoint[], {
    status: 200,
    headers: { "Cache-Control": CACHE_CONTROL },
  });
}

export async function GET(req?: Request): Promise<NextResponse> {
  // Per-IP rate limit (publicIpLimiter, 10/min). `req` is always supplied by
  // Next in production; it is optional only so existing no-arg unit-test calls
  // stay valid. Header-stripped traffic shares the `benchmark-btc:unknown`
  // bucket (documented getClientIp tradeoff — platform edge is the outer cap).
  const rl = await checkLimit(
    publicIpLimiter,
    `benchmark-btc:${getClientIp(req?.headers ?? new Headers())}`,
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

  // RLS `SELECT USING(true)` lets the anon SSR client read; it CANNOT write
  // (writes are service_role-only). The reader selects ONLY date + close_price,
  // so no other column can ever reach the response, coerces PostgREST's
  // numeric-as-string closes, and leaves out a non-finite or non-positive close,
  // reporting its date in `read.dropped`.
  const read = await readBenchmarkPrices(supabase, "BTC");

  if (!read.ok) {
    // Non-2xx and never cached (SFH MD-05). The raw Postgres error (column
    // names / SQLSTATE / schema detail) is logged + captured server-side only.
    // D-09: a read error is never replaced by the bundled fixture.
    console.error("[api/benchmark/btc] select error:", read.error);
    if (shouldCaptureNow("benchmark-btc:read-error")) {
      after(() =>
        captureToSentry(read.error, {
          tags: { route: "api/benchmark/btc", stage: "read" },
        }),
      );
    }
    return NextResponse.json(
      { error: "Benchmark temporarily unavailable" },
      { status: 503, headers: { "Cache-Control": ERROR_CACHE_CONTROL } },
    );
  }

  if (read.dropped.length > 0) {
    // A stored close that cannot price a return is corrupt data in shared
    // market prices. Make it visible instead of letting it vanish.
    // The message carries no count, so every event groups as one issue; the
    // count and the NEWEST dropped dates (capped) ride in `extra`.
    console.warn(
      "[api/benchmark/btc] dropped unusable closes:",
      read.dropped.length,
    );
    if (shouldCaptureNow("benchmark-btc:dropped-closes")) {
      const count = read.dropped.length;
      const newest = read.dropped.slice(-DROPPED_EXTRA_CAP);
      after(() =>
        captureToSentry(
          new Error("benchmark_prices holds unusable BTC closes"),
          {
            tags: { route: "api/benchmark/btc", stage: "dropped-closes" },
            level: "warning",
            extra: { count, dropped: newest },
          },
        ),
      );
    }
  }

  const prices = read.prices;
  if (prices.length < 2) {
    // 0 or 1 rows → no daily return can be derived (every return needs a prior
    // close). Honest empty series.
    return emptyResponse();
  }

  // Daily returns through the ONE shared rule, `pricesToDailyReturns`:
  // pct-change as in benchmark.py `prices_to_returns`. A MISSING stored day is
  // bridged (one return at the later stored date), so the consumers' compounded
  // BTC overlay stays on BTC's real level. A DROPPED corrupt close is NOT
  // bridged: passing `read.dropped` makes the pair spanning it yield no return
  // (169.2 review WR-04 / MD-03). Known limit: a bridged multi-day move is
  // stamped at the later date as one daily observation.
  const series = pricesToDailyReturns(prices, read.dropped);

  return NextResponse.json(series, {
    status: 200,
    headers: { "Cache-Control": CACHE_CONTROL },
  });
}
