import { NextRequest, NextResponse } from "next/server";
import { withAuth } from "@/lib/api/withAuth";
import { createAdminClient } from "@/lib/supabase/admin";
import type { User } from "@supabase/supabase-js";

export const POST = withAuth(async (req: NextRequest, user: User) => {
  const body = await req.json();
  const { strategy_id, trades } = body;

  if (!strategy_id || !Array.isArray(trades) || trades.length === 0) {
    return NextResponse.json({ error: "Missing strategy_id or trades" }, { status: 400 });
  }

  if (trades.length > 50000) {
    return NextResponse.json({ error: "Maximum 50,000 trades per upload" }, { status: 400 });
  }

  // Verify user owns this strategy
  const supabase = createAdminClient();
  const { data: strategy } = await supabase
    .from("strategies")
    .select("id, user_id")
    .eq("id", strategy_id)
    .eq("user_id", user.id)
    .single();

  if (!strategy) {
    return NextResponse.json({ error: "Strategy not found or not owned by you" }, { status: 403 });
  }

  // Insert trades in batches using service-role client (bypasses RLS)
  const batchSize = 500;
  let inserted = 0;

  for (let i = 0; i < trades.length; i += batchSize) {
    const batch = trades.slice(i, i + batchSize);
    const { error } = await supabase.from("trades").insert(batch);
    if (error) {
      return NextResponse.json({
        error: `Insert failed at row ${i}: ${error.message}`,
        inserted,
      }, { status: 500 });
    }
    inserted += batch.length;
  }

  return NextResponse.json({ inserted, strategy_id });
});
