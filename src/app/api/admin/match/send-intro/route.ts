import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isAdminUser } from "@/lib/admin";

// POST /api/admin/match/send-intro
// Calls send_intro_with_decision(...) — a single Postgres transaction that upserts
// the contact_request AND the sent_as_intro match_decision. Handles the already-sent
// case gracefully (returns was_already_sent=true).
export async function POST(req: NextRequest): Promise<NextResponse> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!(await isAdminUser(supabase, user))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  let body: {
    allocator_id?: string;
    strategy_id?: string;
    candidate_id?: string | null;
    admin_note?: string;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  if (!body.allocator_id || typeof body.allocator_id !== "string") {
    return NextResponse.json({ error: "allocator_id is required" }, { status: 400 });
  }
  if (!body.strategy_id || typeof body.strategy_id !== "string") {
    return NextResponse.json({ error: "strategy_id is required" }, { status: 400 });
  }
  if (!body.admin_note || typeof body.admin_note !== "string") {
    return NextResponse.json({ error: "admin_note is required" }, { status: 400 });
  }

  const admin = createAdminClient();
  const { data, error } = await admin.rpc("send_intro_with_decision", {
    p_allocator_id: body.allocator_id,
    p_strategy_id: body.strategy_id,
    p_candidate_id: body.candidate_id ?? null,
    p_admin_note: body.admin_note,
    p_decided_by: user!.id,
  });

  if (error) {
    console.error("[api/admin/match/send-intro] RPC error:", error);
    return NextResponse.json(
      { error: "Failed to send intro" },
      { status: 500 },
    );
  }

  // RPC returns a TABLE (row set); Supabase exposes it as an array.
  const row = Array.isArray(data) && data.length > 0 ? data[0] : data;
  return NextResponse.json({
    contact_request_id: row?.contact_request_id,
    match_decision_id: row?.match_decision_id,
    was_already_sent: row?.was_already_sent ?? false,
  });
}
