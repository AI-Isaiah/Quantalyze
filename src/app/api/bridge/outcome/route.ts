import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import type { User } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { withAuthLimited } from "@/lib/api/withAuthLimited";
import { userActionLimiter } from "@/lib/ratelimit";
import { logAuditEvent } from "@/lib/audit";
import { REJECTION_REASONS } from "@/lib/bridge-outcome-schema";

/**
 * Records or updates a bridge outcome (allocated / rejected) for a
 * strategy that the allocator received as an intro. RLS does not enforce
 * "must have been introduced" — that's a product rule, not an ownership
 * rule — so the `sent_as_intro` verification lives here at the route layer
 * on top of the server-side eligibility filter in getMyAllocationDashboard.
 */

const BODY_SCHEMA = z
  .object({
    strategy_id: z.string().uuid(),
    kind: z.enum(["allocated", "rejected"]),
    // NEW-C18-02 (CL1 review, 2026-05-28): max is the canonical [.,100] that
    // bridge_outcomes.percent_allocated now enforces (the stale [0.1,50] inline
    // column CHECK was dropped by mig 20260528223200). Pre-fix this writer
    // capped at 50, silently 422-rejecting legitimate 60%/75%/100% allocations
    // — the same range-drift class as the scenario-commit path. min stays 0.1:
    // an "allocated" outcome must be strictly positive (use kind='rejected' for
    // a non-allocation), which is a per-endpoint rule, not column drift.
    percent_allocated: z.number().min(0.1).max(100).optional(),
    allocated_at: z.string().date().optional(),
    rejection_reason: z.enum(REJECTION_REASONS).optional(),
    note: z.string().max(2000).nullish(),
  })
  .superRefine((val, ctx) => {
    if (val.kind === "allocated") {
      if (val.percent_allocated === undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["percent_allocated"],
          message: "percent_allocated required when kind='allocated'",
        });
      }
      if (val.allocated_at === undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["allocated_at"],
          message: "allocated_at required when kind='allocated'",
        });
      } else {
        const today = new Date().toISOString().slice(0, 10);
        const earliest = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000)
          .toISOString()
          .slice(0, 10);
        if (val.allocated_at > today || val.allocated_at < earliest) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["allocated_at"],
            message:
              "allocated_at must be within last 365 days and not in future",
          });
        }
      }
      if (val.rejection_reason !== undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["rejection_reason"],
          message: "rejection_reason not allowed when kind='allocated'",
        });
      }
    } else if (val.kind === "rejected") {
      if (val.rejection_reason === undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["rejection_reason"],
          message: "rejection_reason required when kind='rejected'",
        });
      } else if (val.rejection_reason === "other" && !val.note) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["note"],
          message: "note required when rejection_reason='other'",
        });
      }
      if (
        val.percent_allocated !== undefined ||
        val.allocated_at !== undefined
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["kind"],
          message:
            "percent_allocated / allocated_at not allowed when kind='rejected'",
        });
      }
    }
  });

// B15 (audit-2026-05-07): withAuthLimited enforces auth -> validate -> limit,
// so an invalid outcome payload (bad uuid, superRefine failure, oversized note)
// 400s WITHOUT burning a userActionLimiter token. Pre-B15 the limiter ran
// before BODY_SCHEMA.safeParse, so a malformed body spent one of the user's
// shared 5/min sensitive-POST tokens before rejection.
export const POST = withAuthLimited(
  {
    limiter: userActionLimiter,
    key: (user) => `bridge_outcome:${user.id}`,
    schema: BODY_SCHEMA,
  },
  async (
    _req: NextRequest,
    user: User,
    parsed: z.infer<typeof BODY_SCHEMA>,
  ): Promise<NextResponse> => {
  const supabase = await createClient();

  // match_decisions has no allocator-self-SELECT RLS policy, so this check
  // runs through the admin client. The .eq("allocator_id", user.id) is the
  // ownership gate — it MUST stay inline with the query.
  const admin = createAdminClient();
  const { data: decision } = await admin
    .from("match_decisions")
    .select("id")
    .eq("allocator_id", user.id)
    .eq("strategy_id", parsed.strategy_id)
    .eq("decision", "sent_as_intro")
    .maybeSingle();
  if (!decision) {
    return NextResponse.json(
      {
        error: "NOT_ELIGIBLE",
        reason: "No sent_as_intro for this strategy",
      },
      { status: 403 },
    );
  }

  const { data: inserted, error } = await supabase
    .from("bridge_outcomes")
    .upsert(
      {
        allocator_id: user.id,
        strategy_id: parsed.strategy_id,
        match_decision_id: decision.id,
        kind: parsed.kind,
        percent_allocated: parsed.percent_allocated ?? null,
        allocated_at: parsed.allocated_at ?? null,
        rejection_reason: parsed.rejection_reason ?? null,
        note: parsed.note ?? null,
        needs_recompute: true,
      },
      { onConflict: "allocator_id,strategy_id" },
    )
    .select(
      "id, kind, percent_allocated, allocated_at, rejection_reason, note, delta_30d, delta_90d, delta_180d, estimated_delta_bps, estimated_days, needs_recompute, created_at, updated_at",
    )
    .single();

  if (error || !inserted) {
    console.error("[api/bridge/outcome] upsert error:", error);
    return NextResponse.json(
      { error: "Failed to record outcome" },
      { status: 500 },
    );
  }

  // created_at === updated_at iff this is a fresh insert (the BEFORE UPDATE
  // trigger flips updated_at on every update). Postgres now() is transaction-
  // start time — reliable only within one-statement HTTP paths, NOT batch
  // callers that issue multiple upserts per transaction.
  const isInsert =
    typeof inserted.created_at === "string" &&
    typeof inserted.updated_at === "string" &&
    inserted.created_at === inserted.updated_at;

  // Inline within ~60 lines of the mutation — audit-coverage.test.ts sentinel
  // checks logAuditEvent follows the upsert within a 400-char window.
  logAuditEvent(supabase, {
    action: isInsert ? "bridge_outcome.record" : "bridge_outcome.update",
    entity_type: "bridge_outcome",
    entity_id: inserted.id as string,
    metadata: {
      strategy_id: parsed.strategy_id,
      kind: parsed.kind,
      percent_allocated: parsed.percent_allocated ?? null,
      rejection_reason: parsed.rejection_reason ?? null,
    },
  });

  return NextResponse.json({ success: true, outcome: inserted });
});
