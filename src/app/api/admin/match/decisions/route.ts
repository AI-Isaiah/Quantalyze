import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isAdminUser } from "@/lib/admin";
import { assertSameOrigin } from "@/lib/csrf";

type Decision = "thumbs_up" | "thumbs_down" | "snoozed";
const VALID: Decision[] = ["thumbs_up", "thumbs_down", "snoozed"];

// POST /api/admin/match/decisions
// Records a thumbs_up / thumbs_down / snoozed decision. Uses upsert-style
// behavior via the partial unique indexes — repeated thumbs_up on the same
// (allocator, strategy) no-ops at the DB level.
export async function POST(req: NextRequest): Promise<NextResponse> {
  const csrfError = assertSameOrigin(req);
  if (csrfError) return csrfError;

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!(await isAdminUser(supabase, user))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  let body: {
    allocator_id?: string;
    strategy_id?: string;
    candidate_id?: string | null;
    decision?: string;
    founder_note?: string | null;
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
  if (!body.decision || !VALID.includes(body.decision as Decision)) {
    return NextResponse.json({ error: "decision must be thumbs_up|thumbs_down|snoozed" }, { status: 400 });
  }

  const admin = createAdminClient();
  const { error } = await admin.from("match_decisions").insert({
    allocator_id: body.allocator_id,
    strategy_id: body.strategy_id,
    candidate_id: body.candidate_id ?? null,
    decision: body.decision,
    founder_note: body.founder_note ?? null,
    decided_by: user!.id,
  });

  if (error) {
    // 23505 = unique violation; the partial indexes catch repeated thumbs_up etc.
    // Treat as success (idempotent).
    if (error.code === "23505") {
      return NextResponse.json({ success: true, idempotent: true });
    }
    console.error("[api/admin/match/decisions] error:", error);
    return NextResponse.json({ error: "Failed to save decision" }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}

// DELETE /api/admin/match/decisions?allocator_id=X&strategy_id=Y&decision=Z
// Removes a thumbs_up / thumbs_down / snoozed decision (lets the founder change
// their mind without inserting a contradicting row).
export async function DELETE(req: NextRequest): Promise<NextResponse> {
  const csrfError = assertSameOrigin(req);
  if (csrfError) return csrfError;

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!(await isAdminUser(supabase, user))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  const url = new URL(req.url);
  const allocator_id = url.searchParams.get("allocator_id");
  const strategy_id = url.searchParams.get("strategy_id");
  const decision = url.searchParams.get("decision");

  if (!allocator_id || !strategy_id || !decision) {
    return NextResponse.json({ error: "allocator_id, strategy_id, decision required" }, { status: 400 });
  }
  if (!VALID.includes(decision as Decision)) {
    return NextResponse.json({ error: "invalid decision" }, { status: 400 });
  }

  const admin = createAdminClient();
  const { error } = await admin
    .from("match_decisions")
    .delete()
    .match({ allocator_id, strategy_id, decision });

  if (error) {
    console.error("[api/admin/match/decisions] delete error:", error);
    return NextResponse.json({ error: "Failed to delete decision" }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
