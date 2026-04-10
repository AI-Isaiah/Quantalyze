import { NextRequest, NextResponse } from "next/server";
import type { Browser } from "puppeteer-core";
import { createClient } from "@/lib/supabase/server";
import { assertPortfolioOwnership, getPortfolioDetail } from "@/lib/queries";
import {
  launchBrowser,
  acquirePdfSlot,
  PDF_QUEUE_TIMEOUT_MESSAGE,
} from "@/lib/puppeteer";
import { publicIpLimiter, checkLimit, getClientIp } from "@/lib/ratelimit";
import { signPdfRenderToken } from "@/lib/pdf-render-token";

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
  const rl = await checkLimit(publicIpLimiter, `pdf:${ip}`);
  if (!rl.success) {
    return new NextResponse("Rate limit exceeded", {
      status: 429,
      headers: { "Retry-After": String(rl.retryAfter) },
    });
  }

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
        "Content-Disposition": `inline; filename="${portfolio.name}-portfolio.pdf"`,
        // Semi-public share surface — allow shared-CDN caching of the rendered
        // PDF for an hour, but keep stale-while-revalidate short since
        // portfolio contents can drift under the owner's feet.
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
    console.error("[portfolio-pdf] Generation failed:", err);
    return NextResponse.json(
      { error: "PDF generation failed" },
      { status: 500 },
    );
  } finally {
    if (browser) {
      await browser.close().catch((closeErr) => {
        console.error("[portfolio-pdf] Browser close failed:", closeErr);
      });
    }
    if (release) release();
  }
}
