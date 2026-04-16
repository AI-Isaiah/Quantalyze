import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { assertSameOrigin } from "@/lib/csrf";
import { simulateAddCandidate } from "@/lib/analytics-client";
import { simulatorLimiter, checkLimit } from "@/lib/ratelimit";
import { SimulatorRequestSchema } from "@/lib/api/simulatorSchema";

/**
 * Sprint 6 Task 6.4 — POST /api/simulator
 *
 * Mirrors the `/api/bridge` route shape: CSRF-guarded POST, user ownership
 * check, 15s analytics-service timeout (enforced inside
 * `simulateAddCandidate`), 20/hour user-scoped rate limit.
 *
 * The analytics-service endpoint does compute-heavy portfolio math on
 * every call, so rate limiting here is a protection against both
 * accidental loops (React re-render leaks) and adversarial scraping.
 */
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

  const rl = await checkLimit(simulatorLimiter, `simulator:${user.id}`);
  if (!rl.success) {
    return NextResponse.json(
      {
        error:
          "Too many simulations. The portfolio impact simulator is capped at 20 runs per hour.",
      },
      { status: 429 },
    );
  }

  let rawBody: unknown;
  try {
    rawBody = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = SimulatorRequestSchema.safeParse(rawBody);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error:
          "portfolio_id and candidate_strategy_id are required non-empty strings",
      },
      { status: 400 },
    );
  }

  const { portfolio_id, candidate_strategy_id } = parsed.data;

  // Verify the user owns this portfolio. The Python service also checks
  // this defense-in-depth — RLS is bypassed service-side — but a clean
  // 404 at this layer prevents leaking timing information about whether
  // a portfolio id exists.
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
    const result = await simulateAddCandidate(
      portfolio_id,
      candidate_strategy_id,
      user.id,
    );
    return NextResponse.json(result);
  } catch (err) {
    console.error("[simulator] Simulation failed:", err);
    const message =
      err instanceof Error ? err.message : "Portfolio impact simulation failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
