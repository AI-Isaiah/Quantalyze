import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import type { User } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { withAuth } from "@/lib/api/withAuth";
import { userActionLimiter, checkLimit } from "@/lib/ratelimit";
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
    percent_allocated: z.number().min(0.1).max(50).optional(),
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

export const POST = withAuth(async (req: NextRequest, user: User): Promise<NextResponse> => {
  const supabase = await createClient();

  const rl = await checkLimit(userActionLimiter, `bridge_outcome:${user.id}`);
  if (!rl.success) {
    return NextResponse.json(
      { error: "Too many requests" },
      { status: 429, headers: { "Retry-After": String(rl.retryAfter) } },
    );
  }

  const parsed = BODY_SCHEMA.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid request body", issues: parsed.error.issues },
      { status: 400 },
    );
  }

  const { data: decision } = await supabase
    .from("match_decisions")
    .select("id")
    .eq("allocator_id", user.id)
    .eq("strategy_id", parsed.data.strategy_id)
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
        strategy_id: parsed.data.strategy_id,
        match_decision_id: decision.id,
        kind: parsed.data.kind,
        percent_allocated: parsed.data.percent_allocated ?? null,
        allocated_at: parsed.data.allocated_at ?? null,
        rejection_reason: parsed.data.rejection_reason ?? null,
        note: parsed.data.note ?? null,
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
      strategy_id: parsed.data.strategy_id,
      kind: parsed.data.kind,
      percent_allocated: parsed.data.percent_allocated ?? null,
      rejection_reason: parsed.data.rejection_reason ?? null,
    },
  });

  return NextResponse.json({ success: true, outcome: inserted });
});
