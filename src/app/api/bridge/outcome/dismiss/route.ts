import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { assertSameOrigin } from "@/lib/csrf";
import { userActionLimiter, checkLimit } from "@/lib/ratelimit";
import { logAuditEvent } from "@/lib/audit";

/**
 * POST /api/bridge/outcome/dismiss
 *
 * Records a 24-hour snooze for a Bridge outcome banner. Upserts into
 * `bridge_outcome_dismissals` with `expires_at = now() + 24h` on the
 * unique (allocator_id, strategy_id) index — re-dismissing a strategy
 * just bumps the expiry.
 *
 * No eligibility check here: if the strategy has an existing outcome,
 * the banner won't render anyway (eligible_for_outcome=false from
 * getMyAllocationDashboard). Dismissing a non-eligible strategy is a
 * harmless no-op.
 *
 * Pipeline: CSRF → auth → rate-limit → Zod → upsert → audit
 *
 * Sprint 8 Phase 1 — Plan 01-02
 */

const BODY_SCHEMA = z.object({
  strategy_id: z.string().uuid(),
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

  const rl = await checkLimit(
    userActionLimiter,
    `bridge_outcome_dismiss:${user.id}`,
  );
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

  // D-07: 24-hour TTL snooze. Upsert on unique (allocator_id, strategy_id)
  // bumps expires_at on repeat dismissals without violating the unique constraint.
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

  const { data: inserted, error } = await supabase
    .from("bridge_outcome_dismissals")
    .upsert(
      {
        allocator_id: user.id,
        strategy_id: parsed.data.strategy_id,
        expires_at: expiresAt,
      },
      { onConflict: "allocator_id,strategy_id" },
    )
    .select("id, expires_at")
    .single();

  if (error || !inserted) {
    console.error("[api/bridge/outcome/dismiss] upsert error:", error);
    return NextResponse.json({ error: "Failed to dismiss" }, { status: 500 });
  }

  // Audit emission inline within 60 lines of the mutation so
  // audit-coverage.test.ts sentinel can detect it.
  logAuditEvent(supabase, {
    action: "bridge_outcome.dismiss",
    entity_type: "bridge_outcome_dismissal",
    entity_id: inserted.id as string,
    metadata: {
      strategy_id: parsed.data.strategy_id,
      expires_at: inserted.expires_at,
    },
  });

  return NextResponse.json({ success: true, dismissal: inserted });
}
