import "server-only";

import type { SupabaseClient, User } from "@supabase/supabase-js";
import { trackUsageEventServer } from "./usage-events";
import { FUNNEL_STEP, type OnboardingMarker, type UsageEvent } from "./usage-events-types";

/**
 * Phase 11 / Plan 03 / D-13 + D-14 — single-fire onboarding funnel emitter.
 *
 * Pattern (mirrors `session_count` from migration 053):
 *   1. SOURCE side stamps `${marker}_at` on `auth.users.raw_user_meta_data`:
 *      - Postgres trigger for `first_api_key_added_at` (migration 084)
 *      - SECURITY DEFINER RPC `stamp_first_sync_success` for `first_sync_success_at`
 *        (migration 084) called by the Python worker after first persist
 *      - `stampOutcomeMarker` (this module) called by scenario-commit + match-decisions
 *        routes for `first_outcome_at`
 *      - `maybeEmitSignup` (this module) for `signup_emitted_at` (signup is special:
 *        the user's existence IS the marker)
 *      - `maybeEmitFirstBridgeSurfaced` (this module) — both stamps and emits
 *        from the reader side, since "first time flagged > 0" is computed at
 *        render time
 *   2. READER side (`maybeEmitOnboardingEvent`) checks if `${marker}_at` is set
 *      AND `${marker}_emitted_at` is absent. If so, fire PostHog and stamp
 *      `${marker}_emitted_at`. The `/allocations` server component runs all
 *      4 readers + signup in parallel via `Promise.allSettled` per request.
 *   3. SINGLE-FIRE across requests via the `*_emitted_at` sentinel.
 *
 * AT-LEAST-ONCE semantics — Pitfall 3 in RESEARCH.md: if the `*_emitted_at`
 * UPDATE fails, the next request fires again. PostHog dashboards dedupe by
 * (distinct_id + event + properties). T-11-22 in the plan's threat model
 * accepts this as the disposition.
 *
 * NON-BLOCKING: every call swallows admin-update / track failures via
 * console.warn — analytics MUST NOT crash the host request (route or page).
 */

/**
 * Source-side marker keys on `auth.users.raw_user_meta_data`.
 *
 * For 4 of the 5 markers, the key matches the event name verbatim
 * (`first_api_key_added_at`, `first_sync_success_at`,
 * `first_bridge_surfaced_at`, `signup_emitted_at`). The exception is
 * `first_outcome_recorded` whose source-side key is `first_outcome_at`
 * (per CONTEXT D-13 — the routes stamp `first_outcome_at`, the funnel
 * event is `first_outcome_recorded`). This map normalizes the difference
 * so the rest of the helper doesn't branch on naming.
 */
const MARKER_KEY: Record<Exclude<OnboardingMarker, "signup">, string> = {
  first_api_key_added: "first_api_key_added",
  first_sync_success: "first_sync_success",
  first_bridge_surfaced: "first_bridge_surfaced",
  first_outcome_recorded: "first_outcome",
};

/**
 * ISO 8601 week-of-year format: YYYY-Www (e.g. "2026-W17").
 *
 * ISO 8601 week 1 contains the first Thursday of the year. Day-of-week is
 * 1=Mon..7=Sun. The four-day shift trick puts every date at the Thursday of
 * its ISO week, which then resolves to a calendar year and day-count.
 */
export function isoWeekString(date: Date): string {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(weekNo).padStart(2, "0")}`;
}

/**
 * Fire a funnel event ONCE per (user, marker) tuple, then stamp the
 * `${marker}_emitted_at` sentinel. Used for the 4 markers whose source side
 * is NOT this module (first_api_key_added, first_sync_success,
 * first_outcome_recorded — and the signup-helper variant below).
 *
 * Returns: `true` if the event was fired this call, `false` otherwise.
 */
export async function maybeEmitOnboardingEvent(
  admin: SupabaseClient,
  user: User,
  marker: Exclude<OnboardingMarker, "signup">,
): Promise<boolean> {
  const meta = (user.user_metadata ?? {}) as Record<string, unknown>;
  const key = MARKER_KEY[marker];
  const stampedAt = meta[`${key}_at`] as string | undefined;
  const emittedAt = meta[`${key}_emitted_at`] as string | undefined;
  if (!stampedAt || emittedAt) return false;

  await trackUsageEventServer(marker satisfies UsageEvent, user.id, {
    funnel_step: FUNNEL_STEP[marker],
    funnel_event_name: marker,
    cohort_week_iso: (meta.cohort_week_iso as string | undefined) ?? null,
    stamped_at: stampedAt,
  });

  const { error } = await admin.auth.admin.updateUserById(user.id, {
    user_metadata: {
      ...meta,
      [`${key}_emitted_at`]: new Date().toISOString(),
    },
  });
  if (error) {
    console.warn(
      `[onboarding-funnel] failed to stamp ${key}_emitted_at — will re-fire next request:`,
      error.message,
    );
  }
  return true;
}

/**
 * Signup is special — the marker IS the user's existence (auth.users row).
 * On the first authenticated request per user (`signup_emitted_at` absent),
 * fire `signup` and stamp BOTH `signup_emitted_at` and `cohort_week_iso`
 * (D-14: cohort_week_iso enables cohort-comparison funnels in PostHog
 * without recomputing).
 *
 * Returns: `true` if the event was fired this call, `false` otherwise.
 */
export async function maybeEmitSignup(admin: SupabaseClient, user: User): Promise<boolean> {
  const meta = (user.user_metadata ?? {}) as Record<string, unknown>;
  if (meta.signup_emitted_at) return false;

  const cohortWeek = (meta.cohort_week_iso as string | undefined) ?? isoWeekString(new Date());

  await trackUsageEventServer("signup", user.id, {
    funnel_step: FUNNEL_STEP.signup,
    funnel_event_name: "signup",
    cohort_week_iso: cohortWeek,
  });

  const { error } = await admin.auth.admin.updateUserById(user.id, {
    user_metadata: {
      ...meta,
      signup_emitted_at: new Date().toISOString(),
      cohort_week_iso: cohortWeek,
    },
  });
  if (error) {
    console.warn(
      "[onboarding-funnel] signup stamp failed — will re-fire next request:",
      error.message,
    );
  }
  return true;
}

/**
 * Stamp `first_outcome_at` on `auth.users.raw_user_meta_data` if absent.
 * Called by `POST /api/allocator/scenario/commit` and
 * `POST /api/match/decisions/holding` after a successful outcome insert.
 * The reader (in `/allocations` page.tsx) emits the PostHog event on the
 * next request via `maybeEmitOnboardingEvent`.
 *
 * Idempotent: re-calls are a no-op once the marker is set. Uses
 * `auth.admin.getUserById` to read current metadata (the user-scoped client
 * is unavailable from this helper signature; the routes pass an admin
 * client).
 */
export async function stampOutcomeMarker(
  admin: SupabaseClient,
  userId: string,
): Promise<void> {
  const { data, error: getErr } = await admin.auth.admin.getUserById(userId);
  if (getErr || !data?.user) {
    console.warn(
      "[onboarding-funnel] stampOutcomeMarker getUserById failed:",
      getErr?.message ?? "no user returned",
    );
    return;
  }
  const meta = (data.user.user_metadata ?? {}) as Record<string, unknown>;
  if (meta.first_outcome_at) return; // idempotent

  const { error } = await admin.auth.admin.updateUserById(userId, {
    user_metadata: { ...meta, first_outcome_at: new Date().toISOString() },
  });
  if (error) {
    console.warn(
      "[onboarding-funnel] first_outcome_at stamp failed:",
      error.message,
    );
  }
}

/**
 * Fire `first_bridge_surfaced` the first time `flaggedHoldings.length > 0`
 * for a user. Reader is called by `/allocations` page.tsx on every render;
 * this helper performs both stamp + emit atomically (within at-least-once
 * semantics — same single-fire sentinel pattern as the other helpers).
 *
 * The source side and reader side ARE the same — there is no upstream
 * marker writer for "bridge first surfaced", since flagged-holdings count
 * is computed at render time. The `*_at` stamp written here is for audit
 * symmetry with the other markers.
 *
 * Returns: `true` if the event was fired this call, `false` otherwise.
 */
export async function maybeEmitFirstBridgeSurfaced(
  admin: SupabaseClient,
  user: User,
  flaggedCount: number,
): Promise<boolean> {
  if (flaggedCount <= 0) return false;
  const meta = (user.user_metadata ?? {}) as Record<string, unknown>;
  if (meta.first_bridge_surfaced_emitted_at) return false;

  const stampedAt =
    (meta.first_bridge_surfaced_at as string | undefined) ?? new Date().toISOString();

  await trackUsageEventServer("first_bridge_surfaced", user.id, {
    funnel_step: FUNNEL_STEP.first_bridge_surfaced,
    funnel_event_name: "first_bridge_surfaced",
    cohort_week_iso: (meta.cohort_week_iso as string | undefined) ?? null,
    stamped_at: stampedAt,
  });

  const { error } = await admin.auth.admin.updateUserById(user.id, {
    user_metadata: {
      ...meta,
      first_bridge_surfaced_at: stampedAt,
      first_bridge_surfaced_emitted_at: new Date().toISOString(),
    },
  });
  if (error) {
    console.warn(
      "[onboarding-funnel] first_bridge_surfaced stamp failed:",
      error.message,
    );
  }
  return true;
}
