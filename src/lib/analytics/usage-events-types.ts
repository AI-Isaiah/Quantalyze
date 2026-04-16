/**
 * Shared types for the allocator usage funnel. Lives in its own file (no
 * `server-only` guard) so both the server wrapper (`./usage-events`) and
 * the client wrapper (`./usage-events-client`) can import the same union
 * without forcing `server-only` into the browser bundle.
 *
 * Per Sprint 5 plan v3, feedback_card_shown / feedback_card_dismissed /
 * feedback_submitted are CUT — feedback is deferred to Sprint 7.
 */

export const USAGE_EVENTS = [
  "session_start",
  "widget_viewed",
  "intro_submitted",
  "bridge_click",
  "alert_acknowledged",
] as const;

export type UsageEvent = (typeof USAGE_EVENTS)[number];
