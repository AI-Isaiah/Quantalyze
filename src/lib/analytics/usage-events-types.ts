/**
 * Shared types for the allocator usage funnel. Lives in its own file (no
 * `server-only` guard) so both the server wrapper (`./usage-events`) and
 * the client wrapper (`./usage-events-client`) can import the same union
 * without forcing `server-only` into the browser bundle.
 *
 * Per Sprint 5 plan v3, feedback_card_shown / feedback_card_dismissed /
 * feedback_submitted are CUT — feedback is deferred to Sprint 7.
 *
 * Phase 11 / Plan 03 / D-13 — extended with 5 onboarding-funnel event names
 * (signup → first_api_key_added → first_sync_success → first_bridge_surfaced
 * → first_outcome_recorded). All emit server-side via trackUsageEventServer
 * with funnel_step (1..5), funnel_event_name, cohort_week_iso properties.
 */

export const USAGE_EVENTS = [
  "session_start",
  "widget_viewed",
  "intro_submitted",
  "bridge_click",
  "alert_acknowledged",
  // Phase 11 / D-13 onboarding funnel (5 new events).
  "signup",
  "first_api_key_added",
  "first_sync_success",
  "first_bridge_surfaced",
  "first_outcome_recorded",
] as const;

export type UsageEvent = (typeof USAGE_EVENTS)[number];

/**
 * Phase 11 / D-13 — onboarding funnel markers stored on
 * `auth.users.raw_user_meta_data`. Each marker has a `${marker}_at` stamp
 * (source side — written by trigger / RPC / route) and a `${marker}_emitted_at`
 * sentinel (reader side — written by `maybeEmitOnboardingEvent` after the
 * PostHog event fires, single-fire across requests).
 */
export type OnboardingMarker =
  | "signup"
  | "first_api_key_added"
  | "first_sync_success"
  | "first_bridge_surfaced"
  | "first_outcome_recorded";

/**
 * Phase 11 / D-14 — funnel_step ordinals 1..5 attached to every onboarding
 * event property bag for cohort-funnel queries in PostHog.
 */
export const FUNNEL_STEP: Record<OnboardingMarker, 1 | 2 | 3 | 4 | 5> = {
  signup: 1,
  first_api_key_added: 2,
  first_sync_success: 3,
  first_bridge_surfaced: 4,
  first_outcome_recorded: 5,
} as const;
