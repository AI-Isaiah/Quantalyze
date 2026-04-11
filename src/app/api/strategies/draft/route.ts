import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { withAuth } from "@/lib/api/withAuth";
import { userActionLimiter, checkLimit } from "@/lib/ratelimit";
import type { User } from "@supabase/supabase-js";

/**
 * GET /api/strategies/draft — returns the most recent wizard draft for
 * the current user, if one exists.
 *
 * Used by `WizardClient.tsx` on mount to decide whether to show the
 * "Resume draft" banner or start fresh. The shape matches what
 * `loadStepPosition` in `src/lib/wizard/localStorage.ts` expects, so
 * the client can restore the form without another round trip.
 *
 * Why server-side not client-side
 * -------------------------------
 * sessionStorage is per-tab. Closing the tab wipes the wizard session
 * id. The canonical "do I have a draft?" answer lives in Postgres —
 * discriminated via `source='wizard'` + `status='draft'`. The client
 * polls this endpoint on mount and renders the Resume banner if a
 * row comes back. See Phase 3.5 DX review in the plan file.
 *
 * Rate limited via `userActionLimiter` under a dedicated bucket so a
 * runaway wizard mount loop cannot starve the write path.
 */
export const GET = withAuth(async (_req: NextRequest, user: User) => {
  const rl = await checkLimit(userActionLimiter, `strategies-draft-get:${user.id}`);
  if (!rl.success) {
    return NextResponse.json(
      { draft: null, error: "Too many requests" },
      { status: 429, headers: { "Retry-After": String(rl.retryAfter) } },
    );
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("strategies")
    .select(
      "id, name, description, category_id, strategy_types, subtypes, markets, supported_exchanges, leverage_range, aum, max_capacity, api_key_id, created_at",
    )
    .eq("user_id", user.id)
    .eq("source", "wizard")
    .eq("status", "draft")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error("[strategies/draft:GET] query error:", error.message);
    return NextResponse.json({ draft: null }, { status: 500 });
  }

  return NextResponse.json({ draft: data ?? null });
});
