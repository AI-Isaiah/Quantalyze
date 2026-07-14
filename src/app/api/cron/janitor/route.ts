import { NextRequest, NextResponse } from "next/server";
import { safeCompare } from "@/lib/timing-safe-compare";

/**
 * Vercel Cron — every 15 minutes (an every-15 schedule), the stuck-computing
 * janitor (Phase 106 / D7 / BB-03). Proxies to the FastAPI
 * `POST /api/cron-janitor` tick, which reaps `strategy_analytics` rows
 * stranded at computation_status='computing' past a stale threshold (60 min,
 * > the 40-min process_key_long watchdog ceiling) with no live compute_jobs
 * row — so no strategy stays stuck in `computing` forever when a worker/pod
 * dies between the INSERT and the terminal UPDATE.
 *
 * Auth: Authorization: Bearer ${CRON_SECRET} via timing-safe compare — the
 * same pattern as reconcile-strategies + flag-monitor. Vercel Cron dispatches
 * GET; manual POST also works for incident response. The FastAPI side is
 * additionally behind the X-Service-Key middleware (main.py) — two auth layers.
 *
 * See `vercel.json` crons array + the SUB_DAILY_ALLOWLIST in
 * `src/__tests__/vercel-cron-limits.test.ts` (the every-15 cadence mirrors
 * flag-monitor's sub-daily precedent).
 */

export const dynamic = "force-dynamic";

async function handle(req: NextRequest): Promise<NextResponse> {
  const auth = req.headers.get("authorization") ?? "";
  const expected = `Bearer ${process.env.CRON_SECRET}`;
  if (!process.env.CRON_SECRET || !safeCompare(auth, expected)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const analyticsUrl = process.env.ANALYTICS_SERVICE_URL;
  if (!analyticsUrl) {
    // Fail loud (503) rather than silently no-op — the analytics-client
    // precedent for a missing service URL. A cron that quietly does nothing
    // would let stuck rows accumulate with a green tick.
    console.error(
      "[cron/janitor] ANALYTICS_SERVICE_URL not configured — cannot reach the janitor tick",
    );
    return NextResponse.json(
      { error: "ANALYTICS_SERVICE_URL not configured" },
      { status: 503 },
    );
  }

  let res: Response;
  try {
    res = await fetch(`${analyticsUrl}/api/cron-janitor`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Service-Key": process.env.ANALYTICS_SERVICE_KEY ?? "",
      },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[cron/janitor] fetch to analytics service failed:", msg);
    return NextResponse.json(
      { error: `Analytics service unreachable: ${msg}` },
      { status: 502 },
    );
  }

  // Forward the Python JSON body + status through unchanged so a non-2xx
  // janitor tick surfaces to the Vercel cron runner's alarm.
  const body = await res.json().catch(() => ({}));
  return NextResponse.json(body, { status: res.status });
}

export const GET = handle;
export const POST = handle;
