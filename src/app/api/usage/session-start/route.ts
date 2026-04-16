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
 * a new session. The debounce lives server-side so it can't be bypassed
 * by clearing localStorage.
 */

const DEBOUNCE_MS = 30 * 60 * 1000;

interface SessionMetadata {
  session_count?: number;
  last_session_start_at?: string;
  [key: string]: unknown;
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

  // Re-fetch the user via admin so we get the canonical user_metadata —
  // the cookie-bearing client returns a redacted view.
  const { data: adminUserRes, error: getErr } = await admin.auth.admin.getUserById(
    user.id,
  );
  if (getErr || !adminUserRes?.user) {
    return NextResponse.json(
      { error: "Failed to read user metadata" },
      { status: 500 },
    );
  }

  const meta = (adminUserRes.user.user_metadata ?? {}) as SessionMetadata;
  const currentCount =
    typeof meta.session_count === "number" && Number.isFinite(meta.session_count)
      ? meta.session_count
      : 0;
  const lastStart = meta.last_session_start_at
    ? Date.parse(meta.last_session_start_at)
    : NaN;
  const now = Date.now();

  // Debounce: within DEBOUNCE_MS of the last session_start, return the
  // existing count and DO NOT fire the PostHog event. This is the
  // primary deduplication for two-tabs-open / refresh churn.
  if (Number.isFinite(lastStart) && now - lastStart < DEBOUNCE_MS) {
    return NextResponse.json({
      session_count: currentCount,
      debounced: true,
    });
  }

  const nextCount = currentCount + 1;
  const nextMeta: SessionMetadata = {
    ...meta,
    session_count: nextCount,
    last_session_start_at: new Date(now).toISOString(),
  };

  const { error: updateErr } = await admin.auth.admin.updateUserById(user.id, {
    user_metadata: nextMeta,
  });
  if (updateErr) {
    return NextResponse.json(
      { error: "Failed to update session metadata" },
      { status: 500 },
    );
  }

  // Fire the PostHog event AFTER the DB write succeeds. If PostHog is
  // down or unconfigured this becomes a no-op — the increment already
  // landed in user_metadata, which is the source of truth.
  await trackUsageEventServer("session_start", user.id, {
    session_count: nextCount,
  });

  return NextResponse.json({
    session_count: nextCount,
    debounced: false,
  });
}
