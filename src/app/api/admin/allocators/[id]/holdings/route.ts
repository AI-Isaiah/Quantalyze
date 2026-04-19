import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isAdminUser } from "@/lib/admin";

// GET /api/admin/allocators/[id]/holdings
//
// Returns the allocator's current holdings (from portfolio_strategies on their
// real portfolio) as `{ id, name }[]` — used by the SendIntroPanel holdings
// dropdown to let the admin pick the underperformer being replaced.
//
// Phase 5 D-20c Option A (2026-04-19): the allocator's current holdings are the
// only legitimate v1 source for `original_strategy_id` on match_decisions.
// Admin-only route — never exposed to allocators.
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id: allocator_id } = await params;
  if (!allocator_id || typeof allocator_id !== "string") {
    return NextResponse.json({ error: "id required" }, { status: 400 });
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!(await isAdminUser(supabase, user))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  const admin = createAdminClient();

  // Step 1 — resolve the allocator's real portfolio (is_test=false).
  const { data: portfolio, error: portfolioErr } = await admin
    .from("portfolios")
    .select("id")
    .eq("user_id", allocator_id)
    .eq("is_test", false)
    .maybeSingle();

  if (portfolioErr) {
    console.error(
      "[api/admin/allocators/[id]/holdings] portfolio lookup error:",
      portfolioErr,
    );
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }

  if (!portfolio) {
    // No real portfolio yet — allocator has no holdings to point at.
    return NextResponse.json({ holdings: [] });
  }

  const portfolioId = (portfolio as { id: string }).id;

  // Step 2 — fetch portfolio_strategies + joined strategy names.
  const { data: rows, error: rowsErr } = await admin
    .from("portfolio_strategies")
    .select(
      `
      strategy_id,
      strategy:strategies!inner (
        id,
        name
      )
      `,
    )
    .eq("portfolio_id", portfolioId)
    .order("current_weight", { ascending: false });

  if (rowsErr) {
    console.error(
      "[api/admin/allocators/[id]/holdings] rows lookup error:",
      rowsErr,
    );
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }

  // Normalize the embedded join (Supabase returns object or array).
  type RawStrategy = { id: string; name: string | null };
  const holdings = ((rows ?? []) as Array<Record<string, unknown>>).map((row) => {
    const raw = row.strategy;
    const strat = (Array.isArray(raw) ? raw[0] : raw) as RawStrategy | null;
    return {
      id: (row.strategy_id as string) ?? strat?.id ?? "",
      name: strat?.name ?? "Unnamed strategy",
    };
  });

  return NextResponse.json({ holdings });
}
