import { NextRequest, NextResponse } from "next/server";
import { safeCompare } from "@/lib/timing-safe-compare";

/**
 * Vercel Cron — pings the Python analytics service /health every 5 minutes
 * so the friend's forwarded /demo URL never lands on a cold-started worker.
 *
 * Vercel Cron dispatches an HTTP GET (not POST) to the configured path with
 * a `Bearer ${CRON_SECRET}` header. We accept both verbs so the route also
 * works for manual curl-based health probes during incident response.
 *
 * Why a cron AND a per-request warmup?
 *   - Cron keeps the service warm during idle hours (belt).
 *   - Per-request warmup (`src/lib/warmup-analytics.ts`) closes the gap if
 *     the cron last ran > 5 min ago (suspenders).
 *
 * Schedule + secret: see `vercel.json`.
 */

// Force dynamic. This route reads req.headers, but being explicit keeps
// Next.js from ever static-optimising a future variant and silently
// stripping the auth check.
export const dynamic = "force-dynamic";

async function handle(req: NextRequest): Promise<NextResponse> {
  const auth = req.headers.get("authorization") ?? "";
  const expected = `Bearer ${process.env.CRON_SECRET}`;
  if (!process.env.CRON_SECRET || !safeCompare(auth, expected)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = process.env.ANALYTICS_SERVICE_URL;
  if (!url) {
    // Vercel Cron only alerts on non-2xx, so a misconfig that returned
    // HTTP 200 with `{ok: false}` would produce a green cron history
    // while the warmer is completely broken. Return 500 so the cron
    // dashboard lights up red.
    return NextResponse.json(
      { ok: false, reason: "ANALYTICS_SERVICE_URL not set" },
      { status: 500 },
    );
  }

  const start = Date.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);
  try {
    const res = await fetch(`${url.replace(/\/+$/, "")}/health`, {
      method: "GET",
      cache: "no-store",
      signal: controller.signal,
    });
    // Propagate the upstream health status as the route's HTTP status.
    // If the analytics service is returning 500s, the warmup route
    // should return 500 too so Vercel Cron's built-in failure alerts
    // fire. Previously this route always returned 200 regardless of
    // upstream health, so a persistently-failing analytics service
    // produced a green cron history that masked the outage.
    return NextResponse.json(
      {
        ok: res.ok,
        status: res.status,
        elapsed_ms: Date.now() - start,
      },
      { status: res.ok ? 200 : 502 },
    );
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        reason: err instanceof Error ? err.message : "unknown",
        elapsed_ms: Date.now() - start,
      },
      { status: 504 },
    );
  } finally {
    clearTimeout(timeout);
  }
}

export const GET = handle;
export const POST = handle;
