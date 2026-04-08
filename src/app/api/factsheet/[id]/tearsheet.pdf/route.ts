import { NextRequest, NextResponse } from "next/server";
import type { Browser } from "puppeteer-core";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  launchBrowser,
  acquirePdfSlot,
  PDF_QUEUE_TIMEOUT_MESSAGE,
} from "@/lib/puppeteer";
import { extractAnalytics } from "@/lib/queries";

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
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
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
        "Content-Disposition": `inline; filename="${strategy.name}-tearsheet.pdf"`,
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
