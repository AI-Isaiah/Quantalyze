import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { assertPortfolioOwnership } from "@/lib/queries";
import {
  runPortfolioOptimizer,
  AnalyticsTimeoutError,
} from "@/lib/analytics-client";

/** Optimizer can take 3-8s on large portfolios; 15s is generous. */
const OPTIMIZER_TIMEOUT_MS = 15_000;

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

  try {
    const data = (await runPortfolioOptimizer(
      portfolioId,
      OPTIMIZER_TIMEOUT_MS,
    )) as { status?: string; suggestions?: unknown };

    return NextResponse.json({
      status: "complete",
      suggestions: Array.isArray(data.suggestions) ? data.suggestions : [],
    });
  } catch (err) {
    if (err instanceof AnalyticsTimeoutError) {
      return NextResponse.json(
        { status: "failed", suggestions: null, error: "Optimizer timed out" },
        { status: 504 },
      );
    }
    return NextResponse.json(
      {
        status: "failed",
        suggestions: null,
        error:
          err instanceof Error ? err.message : "Analytics service unreachable",
      },
      { status: 503 },
    );
  }
}
