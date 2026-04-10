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

export const maxDuration = 30;

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
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

    await page.goto(`${APP_URL}/factsheet/${id}`, {
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
        "Content-Disposition": `inline; filename="${strategy.name}-factsheet.pdf"`,
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
