import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { withAuth } from "@/lib/api/withAuth";
import { userActionLimiter, checkLimit, isRateLimitMisconfigured } from "@/lib/ratelimit";
import { captureToSentry } from "@/lib/sentry-capture";
import { NO_STORE_HEADERS } from "@/lib/api/headers";
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
  // audit-2026-05-07 H-0253 follow-up (PR-2 2026-05-28): per-surface key.
  // Was `strategies-draft-get:${user.id}`, shared with the by-id GET — a
  // wizard mount that polls list + by-id burns one bucket. Split to :list.
  const rl = await checkLimit(userActionLimiter, `strategies-draft-get-list:${user.id}`);
  if (!rl.success) {
    if (isRateLimitMisconfigured(rl)) {
      return NextResponse.json(
        { draft: null, error: "Rate limiter unavailable" },
        { status: 503, headers: { ...NO_STORE_HEADERS, "Retry-After": String(rl.retryAfter) } },
      );
    }
    return NextResponse.json(
      { draft: null, error: "Too many requests" },
      { status: 429, headers: { ...NO_STORE_HEADERS, "Retry-After": String(rl.retryAfter) } },
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
    // PR-2 silent-failure-hunter F7 (2026-05-28): pre-fix returned the
    // same `{draft: null}` shape on both 200 (no draft) and 500 (DB
    // error). Client-side mount logic that only checks `body.draft`
    // treated DB errors as "no draft exists" — user starts fresh,
    // silently losing their resume banner. Distinct error envelope +
    // Sentry capture so the failure is observable on both surfaces.
    console.error("[strategies/draft:GET] query error:", error.message);
    captureToSentry(error, {
      tags: { area: "strategies-draft-get-list", code: error.code },
      extra: { user_id: user.id },
      level: "error",
    });
    return NextResponse.json(
      { draft: null, error: "draft_lookup_failed" },
      { status: 500, headers: NO_STORE_HEADERS },
    );
  }

  return NextResponse.json({ draft: data ?? null }, { headers: NO_STORE_HEADERS });
});
