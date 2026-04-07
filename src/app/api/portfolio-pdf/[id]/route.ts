import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  // Auth check — only the owner can export their portfolio
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Verify ownership via admin client (RLS-safe)
  const admin = createAdminClient();
  const { data: portfolio, error } = await admin
    .from("portfolios")
    .select("id, name, user_id")
    .eq("id", id)
    .single();

  if (error || !portfolio || portfolio.user_id !== user.id) {
    return NextResponse.json({ error: "Portfolio not found" }, { status: 404 });
  }

  try {
    // Dynamic import to avoid bundling puppeteer in client code
    const puppeteer = await import("puppeteer");
    const browser = await puppeteer.default.launch({
      headless: true,
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
    });

    const page = await browser.newPage();
    await page.setViewport({ width: 800, height: 1100 });

    // The printable page reads data via the admin client, no auth required
    await page.goto(`${APP_URL}/portfolio-pdf/${id}`, {
      waitUntil: "networkidle0",
      timeout: 15000,
    });

    const pdfBuffer = await page.pdf({
      format: "A4",
      printBackground: true,
      margin: { top: "20mm", bottom: "20mm", left: "15mm", right: "15mm" },
    });

    await browser.close();

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
  }
}
