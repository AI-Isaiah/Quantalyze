import { NextRequest, NextResponse } from "next/server";

/**
 * Vercel Cron — pings the Python analytics service /health every 5 minutes
 * so the friend's forwarded /demo URL never lands on a cold-started worker.
 *
 * Why a cron AND a per-request warmup?
 *   - Cron keeps the service warm during idle hours (belt).
 *   - Per-request warmup (`src/lib/warmup-analytics.ts`) closes the gap if
 *     the cron last ran > 5 min ago (suspenders).
 *
 * Schedule + secret: see `vercel.json`.
 */

export async function POST(req: NextRequest) {
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
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
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
    return NextResponse.json({
      ok: false,
      reason: err instanceof Error ? err.message : "unknown",
      elapsed_ms: Date.now() - start,
    });
  }
}
