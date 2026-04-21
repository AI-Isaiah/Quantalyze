/**
 * Phase 09 / finding f2. POST /api/match/decisions/holding
 *
 * Creates a holding-sourced `match_decisions` row before AllocatedForm/RejectedForm
 * mount on the Scenario tab. Enforces holding-ownership at the app layer: the
 * match_decisions RLS alone is insufficient because an inserting client who
 * supplies the correct `allocator_id` bypasses RLS if holding-ownership
 * isn't separately verified (threat T-09-03.b).
 *
 * Reuses the existing `match.decision_record` audit kind (D-14 — no new taxonomy).
 */

import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { z } from "zod";
import { withAuth } from "@/lib/api/withAuth";
import { createClient } from "@/lib/supabase/server";
import { logAuditEvent } from "@/lib/audit";
import type { User } from "@supabase/supabase-js";

const BodySchema = z.object({
  holding_ref: z
    .string()
    .regex(
      /^holding:[A-Za-z0-9_-]+:[A-Za-z0-9_-]+:[A-Za-z0-9_-]+$/,
      "malformed holding_ref — expected holding:{venue}:{symbol}:{holding_type}",
    ),
  top_candidate_strategy_id: z.string().uuid(),
});

function parseHoldingRef(
  ref: string,
): { venue: string; symbol: string; holding_type: string } | null {
  if (!ref.startsWith("holding:")) return null;
  const parts = ref.slice("holding:".length).split(":");
  if (parts.length !== 3) return null;
  const [venue, symbol, holding_type] = parts;
  if (!venue || !symbol || !holding_type) return null;
  return { venue, symbol, holding_type };
}

export const POST = withAuth(
  async (req: NextRequest, user: User): Promise<NextResponse> => {
    const supabase = await createClient();

    // Parse body
    let rawBody: unknown;
    try {
      rawBody = await req.json();
    } catch {
      return NextResponse.json({ error: "invalid json" }, { status: 400 });
    }

    const parsed = BodySchema.safeParse(rawBody);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "invalid payload", issues: parsed.error.issues },
        { status: 400 },
      );
    }
    const { holding_ref, top_candidate_strategy_id } = parsed.data;

    // Parse holding_ref into components (belt-and-suspenders after zod regex)
    const scope = parseHoldingRef(holding_ref);
    if (!scope) {
      return NextResponse.json(
        { error: "invalid holding_ref" },
        { status: 400 },
      );
    }

    // Ownership gate (T-09-03.b): verify this holding belongs to the authenticated allocator
    const { data: ownedHolding } = await supabase
      .from("allocator_holdings")
      .select("id")
      .eq("allocator_id", user.id)
      .eq("venue", scope.venue)
      .eq("symbol", scope.symbol)
      .eq("holding_type", scope.holding_type)
      .limit(1)
      .maybeSingle();

    if (!ownedHolding) {
      // Return 403 for both "holding not found" and "belongs to another allocator"
      // — no existence leak per T-09-03.b spec.
      return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
    }

    // Strategy existence gate: only allow published strategies as candidates
    const { data: candidate } = await supabase
      .from("strategies")
      .select("id")
      .eq("id", top_candidate_strategy_id)
      .eq("status", "published")
      .maybeSingle();

    if (!candidate) {
      return NextResponse.json(
        { error: "strategy not found" },
        { status: 404 },
      );
    }

    // Insert match_decisions row (XOR satisfied: original_strategy_id=NULL, original_holding_ref set)
    // Per migration 011:138 CHECK constraint, decision='sent_as_intro' is the correct value.
    const { data: inserted, error: insertErr } = await supabase
      .from("match_decisions")
      .insert({
        allocator_id: user.id,
        strategy_id: top_candidate_strategy_id,
        candidate_id: null,
        original_strategy_id: null,
        original_holding_ref: holding_ref,
        decision: "sent_as_intro",
        decided_by: user.id,
      })
      .select("id")
      .single();

    if (insertErr || !inserted) {
      return NextResponse.json(
        { error: "failed to record decision" },
        { status: 500 },
      );
    }

    // Reuse existing match.decision_record audit kind per D-14 (no new taxonomy)
    logAuditEvent(supabase, {
      action: "match.decision_record",
      entity_type: "match_decision",
      entity_id: inserted.id,
      metadata: {
        original_holding_ref: holding_ref,
        top_candidate_strategy_id,
        source: "holding",
      },
    });

    return NextResponse.json(
      { match_decision_id: inserted.id },
      { status: 201 },
    );
  },
);
