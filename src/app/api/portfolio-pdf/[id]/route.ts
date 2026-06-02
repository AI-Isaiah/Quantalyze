import { NextRequest, NextResponse } from "next/server";
import type { Browser } from "puppeteer-core";
import { createClient } from "@/lib/supabase/server";
import { assertPortfolioOwnership, getPortfolioDetail } from "@/lib/queries";
import {
  launchBrowser,
  acquirePdfSlot,
  PDF_QUEUE_TIMEOUT_MESSAGE,
} from "@/lib/puppeteer";
import { publicIpLimiter, checkLimit, getClientIp, rateLimitDenyJson } from "@/lib/ratelimit";
import { signPdfRenderToken } from "@/lib/pdf-render-token";
import { sanitizeFilename } from "@/lib/sanitize-filename";
import { captureToSentry } from "@/lib/sentry-capture";

export const maxDuration = 30;

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  // Cross-lambda IP rate limit. Returns 429 BEFORE we touch the
  // acquirePdfSlot semaphore, the Supabase auth check, or any DB query —
  // so a scraper can't burn the in-memory queue or rack up auth-server cost.
  // Cache hits served from Vercel's CDN bypass this entirely, which is the
  // correct behavior for a public IP-based limiter.
  const ip = getClientIp(req.headers);
  // audit-2026-05-07 H-0253 follow-up (PR-2 2026-05-28): per-surface key
  // prefix. Was `pdf:${ip}`, shared with factsheet/[id]/pdf + tearsheet —
  // a user opening factsheet → tearsheet → portfolio PDF from the same IP
  // burned a single 10/min budget. Now each PDF surface has its own bucket.
  const rl = await checkLimit(publicIpLimiter, `portfolio-pdf:${ip}`);
  // audit-2026-05-07 PR-2 silent-failure-hunter A: rateLimitDenyJson
  // distinguishes misconfig 503 from organic 429 so an Upstash outage
  // surfaces on SRE health dashboards instead of looking like throttled
  // organic traffic. F5b (L-0018): JSON envelope (was the plain-text
  // rateLimitDenyText twin) so the 429/503 path matches this route's own
  // JSON 401/404/500 responses — clients can parse one shape unconditionally.
  if (!rl.success) return rateLimitDenyJson(rl);

  const { id } = await params;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!(await assertPortfolioOwnership(id, user.id))) {
    return NextResponse.json({ error: "Portfolio not found" }, { status: 404 });
  }

  const portfolio = await getPortfolioDetail(id);
  if (!portfolio) {
    return NextResponse.json({ error: "Portfolio not found" }, { status: 404 });
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
      timeout: 25000,
    });

    const pdfBuffer = await page.pdf({
      format: "A4",
      printBackground: true,
      margin: { top: "20mm", bottom: "20mm", left: "15mm", right: "15mm" },
    });

    return new NextResponse(Buffer.from(pdfBuffer) as unknown as BodyInit, {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="${sanitizeFilename(portfolio.name, "Portfolio")}-portfolio.pdf"`,
        // Auth-gated route with user-specific portfolio data — never cache at
        // the shared CDN. A shared cache keyed on URL would leak one user's
        // portfolio to another who hits the same URL.
        "Cache-Control": "private, no-store",
      },
    });
  } catch (err) {
    if (err instanceof Error && err.message === PDF_QUEUE_TIMEOUT_MESSAGE) {
      return NextResponse.json(
        { error: "PDF generation queue full, retry in 10 seconds" },
        { status: 503, headers: { "Retry-After": "10" } },
      );
    }
    // PR-2 silent-failure-hunter F6 (2026-05-28): PDF generation covers
    // puppeteer crashes, OOM, navigation timeouts, Chromium SIGSEGV, font-
    // loader failures — all previously invisible to Sentry.
    console.error("[portfolio-pdf] Generation failed:", err);
    captureToSentry(err, {
      tags: { area: "portfolio-pdf", step: "pdf_generation" },
      level: "error",
    });
    return NextResponse.json(
      { error: "PDF generation failed" },
      { status: 500 },
    );
  } finally {
    if (browser) {
      await browser.close().catch((closeErr) => {
        // Browser leak compounds across requests — promote to Sentry.
        // Red-team H3 (2026-05-28): wrap captureToSentry itself in
        // try/catch so a Sentry-SDK regression cannot escape the finally
        // and mask the original PDF generation error.
        console.error("[portfolio-pdf] Browser close failed:", closeErr);
        try {
          captureToSentry(closeErr, {
            tags: { area: "portfolio-pdf", step: "browser_close" },
            level: "warning",
          });
        } catch {
          /* swallow — Sentry must never escape finally */
        }
      });
    }
    if (release) release();
  }
}
