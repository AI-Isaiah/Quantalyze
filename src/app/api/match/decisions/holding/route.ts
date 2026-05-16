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
import { createAdminClient } from "@/lib/supabase/admin";
import { logAuditEvent } from "@/lib/audit";
import { stampOutcomeMarker } from "@/lib/analytics/onboarding-funnel";
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
    // Uses admin client because migration 011 only grants service-role INSERT on
    // match_decisions — authed allocators cannot insert even their own rows. The
    // ownership + strategy gates above use the authed client so RLS still enforces
    // the trust boundary before the elevated insert runs.
    const admin = createAdminClient();
    // audit-2026-05-07 H-0960: kind must be set explicitly. Migration
    // 20260516160600 drops the bridge_recommended DEFAULT on
    // match_decisions.kind — the column is NOT NULL since mig 080 STEP 5,
    // so INSERTs that omit kind now raise 23502. This path inserts a
    // bridge_recommended row (strategy_id NOT NULL + original_holding_ref
    // NOT NULL, the legacy "found a holding match" shape) — same kind
    // mig 080's DEFAULT previously back-filled.
    const { data: inserted, error: insertErr } = await admin
      .from("match_decisions")
      .insert({
        allocator_id: user.id,
        strategy_id: top_candidate_strategy_id,
        candidate_id: null,
        original_strategy_id: null,
        original_holding_ref: holding_ref,
        decision: "sent_as_intro",
        decided_by: user.id,
        kind: "bridge_recommended",
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

    // Phase 11 / Plan 03 / D-13 / ONBOARD-05 — stamp first_outcome_at marker.
    // The /allocations Server Component reader emits the PostHog
    // `first_outcome_recorded` event on the next dashboard request.
    // Idempotent (helper reads metadata first, no-ops once stamp is set).
    // Non-blocking: a stamp failure does NOT affect the route response or
    // the inserted match_decisions row.
    try {
      await stampOutcomeMarker(admin, user.id);
    } catch (err) {
      // Phase 11 review fix IN-05: log err.stack ?? err.message so a
      // future ts/lint regression (e.g. an undefined.method typo inside
      // stampOutcomeMarker) surfaces in the warn output rather than
      // being swallowed by the broad catch + message-only render.
      console.warn(
        "[match-decisions/holding] first_outcome_at stamp failed:",
        err instanceof Error ? (err.stack ?? err.message) : err,
      );
    }

    return NextResponse.json(
      { match_decision_id: inserted.id },
      { status: 201 },
    );
  },
);
