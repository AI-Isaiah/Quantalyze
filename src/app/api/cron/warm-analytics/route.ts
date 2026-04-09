import { NextRequest, NextResponse } from "next/server";

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

async function handle(req: NextRequest) {
  const auth = req.headers.get("authorization");
  const expected = `Bearer ${process.env.CRON_SECRET}`;
  if (!process.env.CRON_SECRET || auth !== expected) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = process.env.ANALYTICS_SERVICE_URL;
  if (!url) {
    return NextResponse.json({ ok: false, reason: "ANALYTICS_SERVICE_URL not set" });
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
    clearTimeout(timeout);
    return NextResponse.json({
      ok: res.ok,
      status: res.status,
      elapsed_ms: Date.now() - start,
    });
  } catch (err) {
    clearTimeout(timeout);
    return NextResponse.json({
      ok: false,
      reason: err instanceof Error ? err.message : "unknown",
      elapsed_ms: Date.now() - start,
    });
  }
}

export async function GET(req: NextRequest) {
  return handle(req);
}

export async function POST(req: NextRequest) {
  return handle(req);
}
