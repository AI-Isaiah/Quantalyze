import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { assertSameOrigin } from "@/lib/csrf";
import { findReplacementCandidates } from "@/lib/analytics-client";
import { userActionLimiter, checkLimit } from "@/lib/ratelimit";

export async function POST(req: NextRequest) {
  const csrfError = assertSameOrigin(req);
  if (csrfError) return csrfError;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const rl = await checkLimit(userActionLimiter, `bridge:${user.id}`);
  if (!rl.success) {
    return NextResponse.json(
      { error: "Too many requests. Bridge scoring is compute-intensive." },
      { status: 429 },
    );
  }

  let body: { portfolio_id?: string; underperformer_strategy_id?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { portfolio_id, underperformer_strategy_id } = body;
  if (!portfolio_id || !underperformer_strategy_id) {
    return NextResponse.json(
      { error: "portfolio_id and underperformer_strategy_id are required" },
      { status: 400 },
    );
  }

  // Verify the user owns this portfolio
  const { data: portfolio } = await supabase
    .from("portfolios")
    .select("id")
    .eq("id", portfolio_id)
    .eq("user_id", user.id)
    .single();

  if (!portfolio) {
    return NextResponse.json({ error: "Portfolio not found" }, { status: 404 });
  }

  try {
    const result = await findReplacementCandidates(
      portfolio_id,
      underperformer_strategy_id,
      user.id,
    );
    return NextResponse.json(result);
  } catch (err) {
    console.error("[bridge] Scoring failed:", err);
    const message =
      err instanceof Error ? err.message : "Bridge scoring failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
