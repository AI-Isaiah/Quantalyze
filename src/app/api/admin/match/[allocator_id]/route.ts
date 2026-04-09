import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isAdminUser } from "@/lib/admin";
import { getAllocatorMatchPayload } from "@/lib/admin/match";

// GET /api/admin/match/[allocator_id]
//
// Returns the latest match batch for the given allocator, joined to strategies,
// analytics, preferences, and recent decisions. Also returns the set of
// (strategy_id) pairs where a contact_request ALREADY EXISTS so the Send Intro
// modal can show the already-sent state before submission.
//
// The heavy lifting lives in `getAllocatorMatchPayload` — shared with the
// public `/api/demo/match/[allocator_id]` lane so the two queues can never
// drift. This route only owns auth.
//
// Payload size budget: < 500 KB at N=30 (enforced in tests).
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ allocator_id: string }> },
): Promise<NextResponse> {
  const { allocator_id } = await params;

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!(await isAdminUser(supabase, user))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  const admin = createAdminClient();

  try {
    const payload = await getAllocatorMatchPayload(admin, allocator_id);
    return NextResponse.json(payload);
  } catch (err) {
    console.error("[api/admin/match/[allocator_id]] error:", err);
    // Don't leak Postgres constraint/column names to the client.
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
