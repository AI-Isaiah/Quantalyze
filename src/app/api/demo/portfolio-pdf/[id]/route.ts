import { NextRequest, NextResponse } from "next/server";
import type { Browser } from "puppeteer-core";
import { createAdminClient } from "@/lib/supabase/admin";
import { isDemoPortfolioId } from "@/lib/demo";
import { verifyDemoPdfToken } from "@/lib/demo-pdf-token";
import {
  acquirePdfSlot,
  launchBrowser,
  PDF_QUEUE_TIMEOUT_MESSAGE,
} from "@/lib/puppeteer";
import { publicIpLimiter, checkLimit, getClientIp } from "@/lib/ratelimit";
import { signPdfRenderToken } from "@/lib/pdf-render-token";
import { sanitizeFilename } from "@/lib/sanitize-filename";

export const maxDuration = 30;

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";

/**
 * Public demo PDF endpoint — serves the IC-ready report for a hard-coded
 * persona portfolio (active / cold / stalled). The /demo page server
 * component generates a short-lived signed token via `signDemoPdfToken`
 * and embeds it in the `Download IC Report` button URL.
 *
 * Auth model:
 *   1. IP rate limit (existing publicIpLimiter) — DoS shield.
 *   2. Allowlist check on `id` — only the 3 persona portfolios.
 *   3. HMAC token verification — caps token TTL at 30 minutes and
 *      ties the signature to a specific portfolio ID.
 *   4. Admin Supabase client reads the portfolio (no auth header needed).
 *
 * The existing `/api/portfolio-pdf/[id]/route.ts` is UNCHANGED and stays
 * auth + ownership gated for real allocators.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const ip = getClientIp(req.headers);
  const rl = await checkLimit(publicIpLimiter, `demo-pdf:${ip}`);
  if (!rl.success) {
    return new NextResponse("Rate limit exceeded", {
      status: 429,
      headers: { "Retry-After": String(rl.retryAfter) },
    });
  }

  const { id } = await params;

  if (!isDemoPortfolioId(id)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const token = req.nextUrl.searchParams.get("token");
  if (!verifyDemoPdfToken(id, token)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = createAdminClient();
  const { data: portfolio, error: portfolioErr } = await admin
    .from("portfolios")
    .select("id, name")
    .eq("id", id)
    .single();
  if (portfolioErr) {
    // Surface transient Supabase errors (network, connection refused,
    // query timeout) as 500 rather than silently masking them as 404.
    // A 404 masks real outages from the error-monitoring dashboards.
    console.error("[demo-portfolio-pdf] portfolios fetch failed:", portfolioErr);
    return NextResponse.json({ error: "Portfolio lookup failed" }, { status: 500 });
  }
  if (!portfolio) {
    // Should be unreachable given the allowlist check above, but defensive.
    return NextResponse.json({ error: "Not found" }, { status: 404 });
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

    const renderToken = signPdfRenderToken(id);
    await page.goto(`${APP_URL}/portfolio-pdf/${id}?renderToken=${renderToken}`, {
      waitUntil: "networkidle0",
      timeout: 25_000,
    });

    const pdfBuffer = await page.pdf({
      format: "A4",
      printBackground: true,
      margin: { top: "20mm", bottom: "20mm", left: "15mm", right: "15mm" },
    });

    const rawName = (portfolio as { name?: string } | null)?.name ?? "Portfolio";
    const portfolioName = sanitizeFilename(rawName, "Portfolio");
    return new NextResponse(Buffer.from(pdfBuffer) as unknown as BodyInit, {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="${portfolioName}-portfolio.pdf"`,
        // DO NOT cache at the edge. Shared caches are keyed on the URL, not
        // the signed token's embedded expiry. A cached response could be
        // replayed after the token expires, effectively extending TTL to
        // `s-maxage + stale-while-revalidate` for anyone who can guess a
        // recent URL. Pay the per-request Puppeteer cost instead.
        "Cache-Control": "private, no-store, no-cache, must-revalidate",
      },
    });
  } catch (err) {
    if (err instanceof Error && err.message === PDF_QUEUE_TIMEOUT_MESSAGE) {
      return new NextResponse("PDF generation queue full, retry in 10 seconds", {
        status: 503,
        headers: { "Retry-After": "10" },
      });
    }
    console.error("[demo-portfolio-pdf] Generation failed:", err);
    return NextResponse.json(
      { error: "PDF generation failed" },
      { status: 500 },
    );
  } finally {
    if (browser) {
      await browser.close().catch((closeErr) => {
        console.error("[demo-portfolio-pdf] Browser close failed:", closeErr);
      });
    }
    if (release) release();
  }
}
