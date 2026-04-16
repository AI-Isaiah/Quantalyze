import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { assertSameOrigin } from "@/lib/csrf";
import { trackUsageEventServer } from "@/lib/analytics/usage-events";

/**
 * POST /api/usage/session-start — increment server-side session_count.
 *
 * Source of truth for `session_count` lives in
 * `auth.users.raw_user_meta_data.session_count` (read via the Supabase
 * Auth admin API as `user_metadata.session_count`). PostHog is the
 * event sink only — never the source of truth. We use auth user_metadata
 * because the `profiles` table has no `metadata jsonb` column today.
 *
 * Debounce: 30-minute window keyed off
 * `user_metadata.last_session_start_at`. Two tabs opened back-to-back
 * count as one session; a stale tab refreshed an hour later counts as
 * a new session. The debounce + increment is performed atomically by
 * the `increment_user_session_count` RPC (migration 053) so concurrent
 * tabs can't both read the same count and write back the same N+1.
 */

const DEBOUNCE_SECONDS = 30 * 60;

interface IncrementResult {
  session_count: number;
  debounced: boolean;
}

export async function POST(req: NextRequest) {
  const csrfError = assertSameOrigin(req);
  if (csrfError) return csrfError;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = createAdminClient();

  // Atomic SELECT FOR UPDATE + UPDATE inside a SECURITY DEFINER RPC —
  // see migration 053. Returns either the bumped count (with
  // debounced=false) or the existing count untouched (debounced=true).
  const { data, error: rpcErr } = await admin.rpc(
    "increment_user_session_count",
    {
      p_user_id: user.id,
      p_debounce_seconds: DEBOUNCE_SECONDS,
    },
  );

  if (rpcErr) {
    console.error(
      "[usage/session-start] increment_user_session_count RPC failed",
      rpcErr,
    );
    return NextResponse.json(
      { error: "Failed to update session metadata" },
      { status: 500 },
    );
  }

  // The RPC returns SETOF — Supabase normalizes single-row sets to either
  // an array or the first row depending on definition. Defensively pick
  // the first element when an array.
  const result = (Array.isArray(data) ? data[0] : data) as
    | IncrementResult
    | null;

  if (!result || typeof result.session_count !== "number") {
    return NextResponse.json(
      { error: "Failed to update session metadata" },
      { status: 500 },
    );
  }

  // Fire the PostHog event only when the increment actually applied.
  // Debounced calls return the existing count and are silent.
  if (!result.debounced) {
    await trackUsageEventServer("session_start", user.id, {
      session_count: result.session_count,
    });
  }

  return NextResponse.json({
    session_count: result.session_count,
    debounced: result.debounced,
  });
}
