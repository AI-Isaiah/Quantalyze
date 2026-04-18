import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { assertSameOrigin } from "@/lib/csrf";
import { userActionLimiter, checkLimit } from "@/lib/ratelimit";
import { logAuditEvent } from "@/lib/audit";

/**
 * POST /api/bridge/outcome
 *
 * Records or updates a bridge outcome (allocated / rejected) for a
 * strategy that the allocator received as an intro. Defense-in-depth
 * eligibility check (OUTCOME-04): route verifies a `match_decisions`
 * row with `decision='sent_as_intro'` exists before inserting, even
 * though server-side eligibility filter in getMyAllocationDashboard
 * should prevent the banner from rendering for ineligible rows.
 *
 * Pipeline: CSRF → auth → rate-limit → Zod → eligibility check → upsert → audit
 *
 * Sprint 8 Phase 1 — Plan 01-02
 */

const BODY_SCHEMA = z
  .object({
    strategy_id: z.string().uuid(),
    kind: z.enum(["allocated", "rejected"]),
    percent_allocated: z.number().min(0.1).max(50).optional(),
    allocated_at: z.string().date().optional(), // YYYY-MM-DD
    rejection_reason: z
      .enum([
        "mandate_conflict",
        "already_owned",
        "timing_wrong",
        "underperforming_peers",
        "other",
      ])
      .optional(),
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

export async function POST(req: NextRequest): Promise<NextResponse> {
  const csrfError = assertSameOrigin(req);
  if (csrfError) return csrfError;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

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

  // OUTCOME-04 defense-in-depth (D-04): belt-and-suspenders over the
  // server-side eligibility filter in getMyAllocationDashboard. RLS does
  // not enforce "must have been introduced" — that's a product rule, not
  // an ownership rule, so it lives here at the route layer.
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

  // D-17: outcomes are editable by owner. Upsert on the unique index
  // (allocator_id, strategy_id) so a second POST for the same strategy
  // updates rather than violating the unique constraint.
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

  // Discriminate insert vs. update by comparing created_at vs updated_at
  // (OQ3 default — no extra round-trip). The trigger on UPDATE flips
  // updated_at so the two values diverge on the second upsert.
  const isInsert =
    typeof inserted.created_at === "string" &&
    typeof inserted.updated_at === "string" &&
    inserted.created_at === inserted.updated_at;

  // Audit emission MUST remain inline within ~60 lines of the mutation so
  // audit-coverage.test.ts (regex: logAuditEvent\(supabase,\s*\{[\s\S]{0,400}bridge_outcome\.)
  // can find the pair.
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
}
