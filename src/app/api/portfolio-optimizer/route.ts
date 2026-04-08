import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { assertPortfolioOwnership } from "@/lib/queries";

const ANALYTICS_URL = process.env.ANALYTICS_SERVICE_URL ?? "http://localhost:8002";
const SERVICE_KEY = process.env.ANALYTICS_SERVICE_KEY ?? "";

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: { portfolio_id?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const portfolioId = body.portfolio_id;
  if (!portfolioId) {
    return NextResponse.json(
      { error: "portfolio_id is required" },
      { status: 400 },
    );
  }

  if (!(await assertPortfolioOwnership(portfolioId, user.id))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let res: Response;
  try {
    res = await fetch(`${ANALYTICS_URL}/api/portfolio-optimizer`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(SERVICE_KEY && { "X-Service-Key": SERVICE_KEY }),
      },
      body: JSON.stringify({ portfolio_id: portfolioId }),
      signal: AbortSignal.timeout(60000),
    });
  } catch (err) {
    const isTimeout =
      err instanceof Error &&
      (err.name === "TimeoutError" || err.name === "AbortError");
    if (isTimeout) {
      return NextResponse.json(
        { status: "failed", suggestions: null, error: "Optimizer timed out" },
        { status: 504 },
      );
    }
    return NextResponse.json(
      {
        status: "failed",
        suggestions: null,
        error: "Analytics service unreachable",
      },
      { status: 503 },
    );
  }

  if (res.status >= 500) {
    return NextResponse.json(
      {
        status: "failed",
        suggestions: null,
        error: "Analytics service unreachable",
      },
      { status: 503 },
    );
  }

  if (!res.ok) {
    let detail = `Optimizer returned ${res.status}`;
    try {
      const errBody = await res.json();
      if (errBody?.detail) detail = String(errBody.detail);
    } catch {
      /* non-JSON body */
    }
    return NextResponse.json(
      { status: "failed", suggestions: null, error: detail },
      { status: res.status },
    );
  }

  const data = (await res.json()) as {
    status?: string;
    suggestions?: unknown;
  };

  return NextResponse.json({
    status: "complete",
    suggestions: Array.isArray(data.suggestions) ? data.suggestions : [],
  });
}
