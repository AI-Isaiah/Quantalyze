import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import type { User } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { withAuthLimited } from "@/lib/api/withAuthLimited";
import { userActionLimiter } from "@/lib/ratelimit";
import { logAuditEvent } from "@/lib/audit";

const BODY_SCHEMA = z.object({
  strategy_id: z.string().uuid(),
});

// B15 (audit-2026-05-07): withAuthLimited enforces the canonical
// auth -> validate -> limit order, so a malformed body 400s WITHOUT burning a
// userActionLimiter token (the bucket is shared across the user's sensitive
// POSTs). Pre-B15 this route checked the limiter before BODY_SCHEMA.safeParse.
export const POST = withAuthLimited(
  {
    limiter: userActionLimiter,
    key: (user) => `bridge_outcome_dismiss:${user.id}`,
    schema: BODY_SCHEMA,
  },
  async (
    _req: NextRequest,
    user: User,
    body: z.infer<typeof BODY_SCHEMA>,
  ): Promise<NextResponse> => {
    const supabase = await createClient();

    // dismissed_at is set on every upsert so re-dismissals refresh the anchor
    // timestamp; omitting it would leave the original INSERT value intact on
    // UPDATE and analytics queries would misread "time since last snooze".
    const now = new Date();
    const expiresAt = new Date(
      now.getTime() + 24 * 60 * 60 * 1000,
    ).toISOString();

    const { data: inserted, error } = await supabase
      .from("bridge_outcome_dismissals")
      .upsert(
        {
          allocator_id: user.id,
          strategy_id: body.strategy_id,
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
        strategy_id: body.strategy_id,
        expires_at: inserted.expires_at,
      },
    });

    return NextResponse.json({ success: true, dismissal: inserted });
  },
);
