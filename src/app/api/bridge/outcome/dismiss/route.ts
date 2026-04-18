import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import type { User } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { withAuth } from "@/lib/api/withAuth";
import { userActionLimiter, checkLimit } from "@/lib/ratelimit";
import { logAuditEvent } from "@/lib/audit";

const BODY_SCHEMA = z.object({
  strategy_id: z.string().uuid(),
});

export const POST = withAuth(async (req: NextRequest, user: User): Promise<NextResponse> => {
  const supabase = await createClient();

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

  // dismissed_at is set on every upsert so re-dismissals refresh the anchor
  // timestamp; omitting it would leave the original INSERT value intact on
  // UPDATE and analytics queries would misread "time since last snooze".
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString();

  const { data: inserted, error } = await supabase
    .from("bridge_outcome_dismissals")
    .upsert(
      {
        allocator_id: user.id,
        strategy_id: parsed.data.strategy_id,
        dismissed_at: now.toISOString(),
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
});
