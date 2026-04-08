import { NextRequest, NextResponse } from "next/server";
import type { Browser } from "puppeteer-core";
import { createClient } from "@/lib/supabase/server";
import { assertPortfolioOwnership, getPortfolioDetail } from "@/lib/queries";
import { launchBrowser } from "@/lib/puppeteer";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
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

  try {
    browser = await launchBrowser();

    const page = await browser.newPage();
    await page.setViewport({ width: 800, height: 1100 });

    // The printable page reads data via the admin client, no auth required
    await page.goto(`${APP_URL}/portfolio-pdf/${id}`, {
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
        "Cache-Control": "private, max-age=0, no-store",
      },
    });
  } catch (err) {
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
  }
}
