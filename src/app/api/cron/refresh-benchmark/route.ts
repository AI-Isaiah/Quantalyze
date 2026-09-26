import { NextRequest, NextResponse } from "next/server";
import { safeCompare } from "@/lib/timing-safe-compare";
import { refreshBenchmark } from "@/lib/analytics-client";
import { adminActionLimiter, checkLimit, rateLimitDenyJson } from "@/lib/ratelimit";
import { NO_STORE_HEADERS } from "@/lib/api/headers";
// The console half of the seam's redaction rule: `console.*` has no scrubbing
// chokepoint of its own, so the caught value is wrapped here
// (`seam-log-coverage.test.ts` enforces it for every seam route).
import { scrubSeamError } from "@/lib/seam-redaction";

/**
 * Vercel Cron — refreshes the cached BTC benchmark once a day.
 *
 * Phase 169.2 / plan 02 (SC3, D-08). Before this route nothing refreshed
 * `benchmark_prices` on a schedule, so the factsheet's BTC comparison went
 * stale silently. The work is done by the analytics service's
 * `POST /api/benchmark-refresh` (plan 169.2-01) through its existing fetcher;
 * this route only triggers it, through the ONE analytics seam
 * (`refreshBenchmark` -> `analyticsRequest` -> `resilientFetch`), never a raw
 * fetch.
 *
 * NON-2XX ON EVERY FAILURE. Vercel Cron alarms only on a non-2xx, so a failed,
 * stale or unreachable refresh answers 502 here, a limiter deny 429 and a
 * misconfigured limiter 503. A 200 means the service reported a current series.
 *
 * ORDER (D-20): the `CRON_SECRET` gate first (401, the limiter is not
 * consulted), then the `adminActionLimiter` check, then the service call.
 * The limiter bounds what a leaked secret could replay against the service. No
 * cron route had a limiter before this one; the precedent is the
 * operator-triggered seam routes (`admin/match/recompute`, `admin/match/eval`),
 * both on `adminActionLimiter`, and this route uses one fixed identifier.
 *
 * Vercel Cron dispatches a GET with `Authorization: Bearer ${CRON_SECRET}`;
 * POST is accepted too, for a manual trigger during an incident. Schedule: see
 * `vercel.json`.
 */

// The auth check reads req.headers; never let a future variant be statically
// optimised with the check stripped.
export const dynamic = "force-dynamic";

// Asserted against SEAM_ROUTE_BUDGETS by seam-budgets.invariant.test: one
// `benchmark-refresh` call (60 000 ms) plus its breaker-store round fits well
// inside 120 s.
export const maxDuration = 120;

async function handle(req: NextRequest): Promise<NextResponse> {
  const auth = req.headers.get("authorization") ?? "";
  const expected = `Bearer ${process.env.CRON_SECRET}`;
  if (!process.env.CRON_SECRET || !safeCompare(auth, expected)) {
    return NextResponse.json(
      { error: "Unauthorized" },
      { status: 401, headers: NO_STORE_HEADERS },
    );
  }

  const rl = await checkLimit(adminActionLimiter, "benchmark-refresh:cron");
  if (!rl.success) {
    // The chokepoint decides 429 (throttled) vs 503 (limiter unavailable);
    // both are non-2xx, so Vercel Cron alarms on either.
    return rateLimitDenyJson(rl, { headers: NO_STORE_HEADERS });
  }

  try {
    const result = await refreshBenchmark();
    return NextResponse.json(
      { ok: true, through: result.through },
      { headers: NO_STORE_HEADERS },
    );
  } catch (err) {
    // ONE arm, no `instanceof`: a service 500 (failed or stale refresh), an
    // unreachable service, an open breaker and a contract violation all mean
    // the benchmark was not refreshed, and every one must page. The body stays
    // static; the diagnosable half goes to the server log, scrubbed.
    console.error(
      "[api/cron/refresh-benchmark] refresh failed:",
      scrubSeamError(err),
    );
    return NextResponse.json(
      { ok: false },
      { status: 502, headers: NO_STORE_HEADERS },
    );
  }
}

export const GET = handle;
export const POST = handle;
