import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isAdminUser } from "@/lib/admin";
import { assertSameOrigin } from "@/lib/csrf";
import { logAuditEvent } from "@/lib/audit";

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

  // P444 (audit-2026-05-07) — split 401 (unauthenticated) from 403
  // (authenticated-but-not-admin). The pre-fix single check returned 403
  // for both, conflating auth and authz per RFC 7235.
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!(await isAdminUser(supabase, user))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
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

  // C-0043 (audit-2026-05-07) — canonical error shape across src/app/api/
  // is uniformly `{ error: string }`. No route in the tree returns
  // `{ error, fields }`, so field-level validation errors are surfaced as
  // human-readable strings naming the offending field. Keep every error
  // response in this route conforming to that single shape.
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
  // audit-2026-05-07 H-0960: kind must be set explicitly. Migration
  // 20260516160600 drops the bridge_recommended DEFAULT on
  // match_decisions.kind. Set kind explicitly to preserve the prior
  // implicit DEFAULT value — same kind mig 080's DEFAULT previously
  // back-filled for INSERTs from this route.
  const { data: inserted, error } = await admin
    .from("match_decisions")
    .insert({
      allocator_id: body.allocator_id,
      strategy_id: body.strategy_id,
      candidate_id: body.candidate_id ?? null,
      decision: body.decision,
      founder_note: body.founder_note ?? null,
      decided_by: user!.id,
      kind: "bridge_recommended",
    })
    .select("id")
    .single();

  if (error) {
    // 23505 = unique violation; the partial indexes catch repeated thumbs_up etc.
    // Treat as success (idempotent).
    if (error.code === "23505") {
      return NextResponse.json({ success: true, idempotent: true });
    }
    console.error("[api/admin/match/decisions] error:", error);
    return NextResponse.json({ error: "Failed to save decision" }, { status: 500 });
  }

  // Sprint 6 Task 7.1b — audit the match decision. entity_id pins to
  // the inserted match_decisions row so the forensic trail records
  // "admin X thumbs-up/down'd allocator Y's match with strategy Z".
  if (inserted?.id) {
    logAuditEvent(supabase, {
      action: "match.decision_record",
      entity_type: "match_decision",
      entity_id: inserted.id as string,
      metadata: {
        allocator_id: body.allocator_id,
        strategy_id: body.strategy_id,
        decision: body.decision,
      },
    });
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

  // P444 (audit-2026-05-07) — split 401/403, see POST handler note.
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!(await isAdminUser(supabase, user))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const url = new URL(req.url);
  const allocator_id = url.searchParams.get("allocator_id");
  const strategy_id = url.searchParams.get("strategy_id");
  const decision = url.searchParams.get("decision");

  // C-0043 (audit-2026-05-07) — same canonical `{ error: string }` shape
  // as the POST handler. Messages are human-readable and name the
  // offending field inline (no separate `fields` map).
  if (!allocator_id) {
    return NextResponse.json({ error: "allocator_id is required" }, { status: 400 });
  }
  if (!strategy_id) {
    return NextResponse.json({ error: "strategy_id is required" }, { status: 400 });
  }
  if (!decision) {
    return NextResponse.json({ error: "decision is required" }, { status: 400 });
  }
  if (!VALID.includes(decision as Decision)) {
    return NextResponse.json({ error: "decision must be thumbs_up|thumbs_down|snoozed" }, { status: 400 });
  }

  const admin = createAdminClient();
  const { data: deleted, error } = await admin
    .from("match_decisions")
    .delete()
    .match({ allocator_id, strategy_id, decision })
    .select("id");

  if (error) {
    console.error("[api/admin/match/decisions] delete error:", error);
    return NextResponse.json({ error: "Failed to delete decision" }, { status: 500 });
  }

  // Sprint 6 Task 7.1b — audit the decision removal. entity_id pins to
  // the deleted row id so the forensic trail records what was un-done.
  // If multiple rows matched (shouldn't with the composite filter but
  // hypothetically), emit one event per row.
  const deletedRows = deleted ?? [];
  for (const row of deletedRows) {
    logAuditEvent(supabase, {
      action: "match.decision_delete",
      entity_type: "match_decision",
      entity_id: row.id as string,
      metadata: { allocator_id, strategy_id, decision },
    });
  }

  return NextResponse.json({ success: true });
}
