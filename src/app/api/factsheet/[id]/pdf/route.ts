import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { extractAnalytics } from "@/lib/queries";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
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

  // Dynamic import to avoid bundling puppeteer in client code
  const puppeteer = await import("puppeteer");
  let browser: Awaited<ReturnType<typeof puppeteer.default.launch>> | null = null;

  try {
    browser = await puppeteer.default.launch({
      headless: true,
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
    });

    const page = await browser.newPage();
    await page.setViewport({ width: 800, height: 1100 });

    await page.goto(`${APP_URL}/factsheet/${id}`, {
      waitUntil: "networkidle0",
      timeout: 15000,
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
        "Cache-Control": "public, max-age=86400",
      },
    });
  } catch (err) {
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
  }
}
