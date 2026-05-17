import { NextRequest, NextResponse } from "next/server";
import type { Browser } from "puppeteer-core";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  launchBrowser,
  acquirePdfSlot,
  PDF_QUEUE_TIMEOUT_MESSAGE,
} from "@/lib/puppeteer";
import { extractAnalytics } from "@/lib/queries";
import { publicIpLimiter, checkLimit, getClientIp } from "@/lib/ratelimit";
import { sanitizeFilename } from "@/lib/sanitize-filename";

export const maxDuration = 30;

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";

/**
 * GET /api/factsheet/[id]/tearsheet.pdf
 *
 * Optional PDF wrapper around the HTML tear sheet at /factsheet/[id]/tearsheet.
 * The HTML page is the canonical surface — the founder can always
 * `window.print()` on it if the PDF generation fails. Uses the shared
 * `launchBrowser()` helper so it works on both Vercel and local dev.
 *
 * Listed in `PUBLIC_ROUTES` via /api/factsheet in src/proxy.ts so a cap-intro
 * partner can open a tear sheet URL without a login redirect.
 *
 * SECURITY INVARIANT (audit-2026-05-07 C-0189 closure, red-team
 * 2026-05-17 MED conf 8 hardening):
 *
 *   This route MUST NOT forward session cookies to the Puppeteer-launched
 *   browser. The downstream HTML page redacts institutional manager
 *   identity for unattested callers; a stateless Puppeteer (no cookies)
 *   keeps every PDF in the unattested-redacted lane, which is the
 *   invariant that lets us cache the response via `s-maxage=3600` below
 *   without per-user cache keys.
 *
 *   The invariant is "stateless render", not just "no setCookie call".
 *   Statelessness here has TWO load-bearing pieces — both must hold:
 *
 *     (a) DO NOT add `page.setCookie(...)` or `Cookie` in
 *         `page.setExtraHTTPHeaders(...)`. Either would inject session
 *         state into the rendered HTML directly.
 *
 *     (b) The `browser.close()` in the `finally` block IS load-bearing.
 *         Puppeteer's cookie jar is BROWSER-scoped, not page-scoped.
 *         If a deployer points NEXT_PUBLIC_APP_URL at a Vercel preview /
 *         protected origin, the upstream HTML server (Next.js on the
 *         same project) issues `Set-Cookie` via the supabase
 *         `cookieStore.setAll` call inside getFactsheetDetail. Puppeteer
 *         silently stores those cookies in the browser's jar. The first
 *         render is anonymous and the PDF gets cached, but if a future
 *         optimization hoists the `browser` instance to module scope or
 *         to Vercel Fluid Compute warm-instance reuse, the jar leaks
 *         across requests — the next render reuses the prior session's
 *         cookies and the cached PDF goes institutional.
 *
 *         If you need to hoist the browser for cold-start cost, switch
 *         to a per-request `BrowserContext`:
 *             const context = await browser.createBrowserContext();
 *             const page = await context.newPage();
 *             ... finally { await context.close(); }
 *         so the cookie jar is provably scoped to one render. Don't drop
 *         the per-request close without that.
 *
 *   If you need per-user PDFs (you almost certainly don't), ALSO remove
 *   the `s-maxage` Cache-Control header below or the CDN will serve one
 *   user's PDF to the next.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
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

  const { id } = await params;

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
    await page.setViewport({ width: 816, height: 1056 }); // 8.5 × 11 @ 96 DPI

    await page.goto(`${APP_URL}/factsheet/${id}/tearsheet`, {
      waitUntil: "networkidle0",
      timeout: 25000,
    });

    const pdfBuffer = await page.pdf({
      format: "Letter",
      printBackground: true,
      margin: { top: "0.75in", bottom: "0.75in", left: "0.75in", right: "0.75in" },
    });

    return new NextResponse(Buffer.from(pdfBuffer) as unknown as BodyInit, {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="${sanitizeFilename(strategy.name, "Strategy")}-tearsheet.pdf"`,
        // Public route (accessible to cap-intro partners without auth) — let
        // Vercel's CDN cache hot tearsheets so a newsletter blast doesn't
        // launch a fresh Chromium per click.
        "Cache-Control": "s-maxage=3600, stale-while-revalidate=86400",
      },
    });
  } catch (err) {
    if (err instanceof Error && err.message === PDF_QUEUE_TIMEOUT_MESSAGE) {
      return new NextResponse("PDF generation queue full, retry in 10 seconds", {
        status: 503,
        headers: { "Retry-After": "10" },
      });
    }
    console.error("[tearsheet-pdf] Generation failed:", err);
    return NextResponse.json(
      { error: "PDF generation failed" },
      { status: 500 },
    );
  } finally {
    if (browser) {
      await browser.close().catch((closeErr) => {
        console.error("[tearsheet-pdf] Browser close failed:", closeErr);
      });
    }
    if (release) release();
  }
}
