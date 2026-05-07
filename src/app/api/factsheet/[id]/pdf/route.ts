import { NextRequest, NextResponse } from "next/server";
import type { Browser } from "puppeteer-core";
import { createAdminClient } from "@/lib/supabase/admin";
import { extractAnalytics } from "@/lib/queries";
import {
  launchBrowser,
  acquirePdfSlot,
  PDF_QUEUE_TIMEOUT_MESSAGE,
} from "@/lib/puppeteer";
import { publicIpLimiter, checkLimit, getClientIp } from "@/lib/ratelimit";
import { sanitizeFilename } from "@/lib/sanitize-filename";
import { safeCompare } from "@/lib/timing-safe-compare";

export const maxDuration = 30;

// Phase 18 / round-2 (Claude adv conf 4) — function-form (vs module-load
// const) so vi.resetModules() in tests can drop a stale value, mirroring the
// cron route's appUrl()/vercelEnv() pattern. Vercel injects the env at
// runtime so the cost of re-reading per request is negligible.
function appUrl(): string {
  return process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  // Adversarial revision 2026-05-06 (Phase 18 Plan 03 / B4) — internal cron
  // callers (e.g. /api/cron/founder-lp-report) pass `x-internal-token:
  // ${INTERNAL_API_TOKEN}` to bypass `publicIpLimiter`. This prevents the
  // monthly LP cron from contending with alert-digest fan-out on the same
  // public IP pool. Token validated via safeCompare (constant time); empty
  // or missing token falls through to the existing public rate limiter so
  // unauthenticated callers see no behavior change.
  //
  // Phase 18 / R1 — additionally gate the bypass on VERCEL_ENV='production'.
  // A preview deploy with a leaked token would otherwise let any caller skip
  // the public limiter via `x-internal-token`. Local dev (VERCEL_ENV unset)
  // still honors the bypass so the cron's smoke test works.
  const vercelEnv = process.env.VERCEL_ENV;
  const isProductionOrLocal = vercelEnv === undefined || vercelEnv === "production";
  const internalToken = req.headers.get("x-internal-token");
  const internalEnv = process.env.INTERNAL_API_TOKEN;
  const isInternalCall =
    isProductionOrLocal &&
    internalToken !== null &&
    typeof internalEnv === "string" &&
    internalEnv.length > 0 &&
    safeCompare(internalToken, internalEnv);
  // Phase 18 / R13 — the cron's `x-correlation-id` arrives on this
  // request automatically (Vercel routes it through to next/headers).
  // Downstream callers using `getCorrelationId()` from `@/lib/correlation-id`
  // will read it directly from the request-scoped store; no copy needed.
  // (An earlier fix attempted `req.headers.set(...)` here; that was a
  // no-op against `next/headers` and has been removed — the contract
  // is honored by Next.js itself.)

  if (!isInternalCall) {
    // Cross-lambda IP rate limit. Returns 429 BEFORE we touch the
    // acquirePdfSlot semaphore or any DB query — so a scraper hammering this
    // surface can't burn the in-memory queue or generate Supabase load.
    // Cache hits served from Vercel's CDN bypass this entirely, which is the
    // correct behavior for a public IP-based limiter.
    const ip = getClientIp(req.headers);
    const rl = await checkLimit(publicIpLimiter, `pdf:${ip}`);
    if (!rl.success) {
      return new NextResponse("Rate limit exceeded", {
        status: 429,
        headers: { "Retry-After": String(rl.retryAfter) },
      });
    }
  }

  const { id } = await params;

  // Verify strategy exists and is published
  const admin = createAdminClient();
  const { data: strategy, error } = await admin
    .from("strategies")
    .select("id, name, status, strategy_analytics (computation_status)")
    .eq("id", id)
    .eq("status", "published")
    .single();

  if (error || !strategy) {
    return NextResponse.json({ error: "Strategy not found" }, { status: 404 });
  }

  const analytics = extractAnalytics(strategy.strategy_analytics);
  if (!analytics || analytics.computation_status !== "complete") {
    return NextResponse.json(
      { error: "Analytics not computed" },
      { status: 400 },
    );
  }

  let browser: Browser | null = null;
  let release: (() => void) | null = null;

  try {
    release = await acquirePdfSlot();
    browser = await launchBrowser();

    const page = await browser.newPage();
    page.setDefaultNavigationTimeout(15_000);
    page.setDefaultTimeout(15_000);
    await page.setViewport({ width: 800, height: 1100 });

    await page.goto(`${appUrl()}/factsheet/${id}`, {
      waitUntil: "networkidle0",
      timeout: 25000,
    });

    // Hide the print button before generating PDF
    await page.evaluate(() => {
      const printSection = document.querySelector(".print\\:hidden");
      if (printSection) (printSection as HTMLElement).style.display = "none";
    });

    const pdfBuffer = await page.pdf({
      format: "A4",
      printBackground: true,
      margin: { top: "20mm", bottom: "20mm", left: "15mm", right: "15mm" },
    });

    return new NextResponse(Buffer.from(pdfBuffer) as unknown as BodyInit, {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="${sanitizeFilename(strategy.name, "Strategy")}-factsheet.pdf"`,
        // Auth-gated route — keep browser caching on for the same viewer but
        // do not let the shared CDN hold onto it.
        "Cache-Control": "private, max-age=86400",
      },
    });
  } catch (err) {
    if (err instanceof Error && err.message === PDF_QUEUE_TIMEOUT_MESSAGE) {
      return new NextResponse("PDF generation queue full, retry in 10 seconds", {
        status: 503,
        headers: { "Retry-After": "10" },
      });
    }
    console.error("[pdf] Generation failed:", err);
    return NextResponse.json(
      { error: "PDF generation failed" },
      { status: 500 },
    );
  } finally {
    if (browser) {
      await browser.close().catch((closeErr) => {
        console.error("[pdf] Browser close failed:", closeErr);
      });
    }
    if (release) release();
  }
}
