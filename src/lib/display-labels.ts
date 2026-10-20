/**
 * Phase 170.1.2 LABELS (D-01) — the one home for every NEW label vocabulary.
 *
 * A raw internal value (a compute-job kind, a match decision, a role, a venue
 * code) is never shown to a user. Each vocabulary below maps the closed set of
 * values the database admits to a sentence-case label, and each wrapper returns
 * that vocabulary's own fallback on a miss, never the raw value.
 *
 * Pure module: no server-only imports, so server and client tables both import
 * it. Existing sources are imported, never copied: `ROLES` (profile role),
 * `ROLE_META` (app role), `EXCHANGE_DISPLAY` (venues, strategy-source venues).
 * `Badge`'s `statusLabelMap` and `TrustTierLabel` stay where they are.
 *
 * The compute-job kind, status, error kind and similar sets are database CHECK
 * sets with no TS tuple, so `display-labels.test.ts` parses
 * `supabase/schema/baseline.sql` and fails when a vocabulary's key set differs
 * from its CHECK set. Maps with a TS union (`StrategySource`, `AppRole`,
 * `Role`) also use `satisfies Record<…>`, so a new member is a compile error.
 *
 * If a page needs a label this module lacks, add it HERE; never a local map.
 */
import { EXCHANGE_DISPLAY } from "@/lib/closed-sets";
import { ROLES } from "@/lib/types";
import { ROLE_META, type AppRole } from "@/lib/auth-types";
import type { StrategySource } from "@/lib/strategy-sources";

/**
 * Look `value` up in `map`. Only an OWN key resolves, so `"constructor"` and
 * `"__proto__"` read the fallback rather than a prototype member. A non-string
 * (null, undefined, a number) also reads the fallback.
 */
export function labelOf(
  map: Readonly<Record<string, string>>,
  value: unknown,
  fallback: string,
): string {
  return typeof value === "string" && Object.hasOwn(map, value)
    ? map[value]
    : fallback;
}

// --- Compute jobs -----------------------------------------------------------

/** `compute_jobs_kind_check`. */
export const COMPUTE_JOB_KIND_LABELS = {
  sync_trades: "Trade sync",
  compute_analytics: "Analytics computation",
  compute_portfolio: "Portfolio computation",
  poll_positions: "Position poll",
  sync_funding: "Funding sync",
  reconcile_strategy: "Strategy reconciliation",
  compute_intro_snapshot: "Intro snapshot",
  rescore_allocator: "Allocator rescore",
  poll_allocator_positions: "Allocator position poll",
  reconstruct_allocator_history: "Allocator history rebuild",
  refresh_allocator_equity_daily: "Allocator daily equity refresh",
  process_key_long: "Key backfill",
  compute_analytics_from_csv: "Analytics from CSV",
  derive_broker_dailies: "Broker daily returns",
  stitch_composite: "Composite stitch",
  derive_allocator_equity: "Allocator equity derivation",
  okx_archive_rebuild: "OKX history rebuild",
} as const;

export function computeJobKindLabel(value: unknown): string {
  return labelOf(COMPUTE_JOB_KIND_LABELS, value, "Other job");
}

/** `compute_jobs_status_check`. */
export const COMPUTE_JOB_STATUS_LABELS = {
  pending: "Pending",
  running: "Running",
  done: "Done",
  done_pending_children: "Done, follow-up jobs pending",
  failed_retry: "Retrying",
  failed_final: "Failed",
} as const;

export function computeJobStatusLabel(value: unknown): string {
  return labelOf(COMPUTE_JOB_STATUS_LABELS, value, "Unknown status");
}

/** `compute_jobs_error_kind_check`. */
export const COMPUTE_JOB_ERROR_KIND_LABELS = {
  transient: "Temporary error",
  permanent: "Permanent error",
  unknown: "Unclassified error",
  orphaned: "Worker stopped",
} as const;

export function computeJobErrorKindLabel(value: unknown): string {
  return labelOf(COMPUTE_JOB_ERROR_KIND_LABELS, value, "Error");
}

// --- Allocations and matching -----------------------------------------------

/** `allocation_events_event_type_check`. */
export const ALLOCATION_EVENT_TYPE_LABELS = {
  deposit: "Deposit",
  withdrawal: "Withdrawal",
} as const;

export function allocationEventTypeLabel(value: unknown): string {
  return labelOf(ALLOCATION_EVENT_TYPE_LABELS, value, "Other event");
}

/** `match_decisions_decision_check`. */
export const MATCH_DECISION_LABELS = {
  thumbs_up: "Kept",
  thumbs_down: "Skipped",
  sent_as_intro: "Intro sent",
  snoozed: "Snoozed",
} as const;

export function matchDecisionLabel(value: unknown): string {
  return labelOf(MATCH_DECISION_LABELS, value, "Other decision");
}

/**
 * Mandate breach reasons from `routers/match.py` `breach_reasons`. A Python
 * string set with no CHECK, so the census cannot guard it: the TS union
 * `"max_weight" | "correlation_ceiling"` is the only other copy.
 */
export const BREACH_REASON_LABELS = {
  max_weight: "Above max weight",
  correlation_ceiling: "Above correlation ceiling",
} as const;

export function breachReasonLabel(value: unknown): string {
  return labelOf(BREACH_REASON_LABELS, value, "Other mandate breach");
}

/**
 * Why a shipped intro was missed by the match engine, from
 * `analytics-service/services/match_eval.py` (`reason` on a `missed` row). A
 * Python string set with no CHECK, so the census cannot guard it: those two
 * values are the producer's whole set.
 */
export const MATCH_MISS_REASON_LABELS = {
  not_in_top_3: "Ranked below top 3",
  no_prior_batch: "No earlier match batch",
} as const;

export function matchMissReasonLabel(value: unknown): string {
  return labelOf(MATCH_MISS_REASON_LABELS, value, "Other reason");
}

/** BridgeDrawer's label when a candidate lists no breach reasons. */
export const BREACH_REASON_EMPTY_LABEL = "Composite score above threshold";

// --- Roles ------------------------------------------------------------------

/** `organization_members_role_check`. */
export const ORG_MEMBER_ROLE_LABELS = {
  owner: "Owner",
  admin: "Admin",
  member: "Member",
} as const;

export function orgMemberRoleLabel(value: unknown): string {
  return labelOf(ORG_MEMBER_ROLE_LABELS, value, "Unknown role");
}

/** `profiles_role_check`, derived from `ROLES` so the product names never fork. */
const PROFILE_ROLE_LABELS: Readonly<Record<string, string>> =
  Object.fromEntries(ROLES.map((r) => [r.value, r.label]));

export function profileRoleLabel(value: unknown): string {
  return labelOf(PROFILE_ROLE_LABELS, value, "Unknown role");
}

/** `user_app_roles_role_check`, derived from `ROLE_META`. */
const APP_ROLE_LABELS: Readonly<Record<string, string>> = Object.fromEntries(
  (Object.keys(ROLE_META) as AppRole[]).map((r) => [r, ROLE_META[r].label]),
);

export function appRoleLabel(value: unknown): string {
  return labelOf(APP_ROLE_LABELS, value, "Unknown role");
}

// --- Statuses ---------------------------------------------------------------

/** `profiles_allocator_status_check` and `profiles_manager_status_check`. */
export const PROFILE_STATUS_LABELS = {
  newbie: "New",
  pending: "Pending",
  verified: "Verified",
} as const;

export function profileStatusLabel(value: unknown): string {
  return labelOf(PROFILE_STATUS_LABELS, value, "Unknown status");
}

/** `strategy_verifications_status_check`. */
export const VERIFICATION_STATUS_LABELS = {
  draft: "Draft",
  validated: "Validated",
  metrics_captured: "Metrics captured",
  encrypted: "Encrypted",
  report_queued: "Report queued",
  published: "Published",
} as const;

export function verificationStatusLabel(value: unknown): string {
  return labelOf(VERIFICATION_STATUS_LABELS, value, "Unknown status");
}

/** `contact_requests_snapshot_status_check`. */
export const INTRO_SNAPSHOT_STATUS_LABELS = {
  pending: "Pending",
  ready: "Ready",
  failed: "Failed",
} as const;

export function introSnapshotStatusLabel(value: unknown): string {
  return labelOf(INTRO_SNAPSHOT_STATUS_LABELS, value, "Unknown status");
}

/** `contact_requests_source_check`. */
export const INTRO_SOURCE_LABELS = {
  direct: "Direct",
  bridge: "Bridge",
} as const;

export function introSourceLabel(value: unknown): string {
  return labelOf(INTRO_SOURCE_LABELS, value, "Other source");
}

/** `portfolio_strategies_relationship_status_check`. */
export const RELATIONSHIP_STATUS_LABELS = {
  connected: "Connected",
  paused: "Paused",
  exited: "Exited",
} as const;

export function relationshipStatusLabel(value: unknown): string {
  return labelOf(RELATIONSHIP_STATUS_LABELS, value, "Unknown status");
}

/**
 * `strategy_analytics_computation_status_check`. `AdminTabs` shows this line
 * only when the status is not `complete`; the `complete` label exists so the
 * vocabulary covers every value the database admits.
 */
export const ANALYTICS_STATUS_LABELS = {
  pending: "Analytics pending",
  computing: "Analytics computing",
  complete: "Analytics complete",
  complete_with_warnings: "Analytics complete, with warnings",
  failed: "Analytics failed",
} as const;

export function analyticsStatusLabel(value: unknown): string {
  return labelOf(ANALYTICS_STATUS_LABELS, value, "Analytics status unknown");
}

/** `strategies_disclosure_tier_check`. */
export const DISCLOSURE_TIER_LABELS = {
  institutional: "Institutional",
  exploratory: "Exploratory",
} as const;

export function disclosureTierLabel(value: unknown): string {
  return labelOf(DISCLOSURE_TIER_LABELS, value, "Unknown tier");
}

// --- Sources and venues -----------------------------------------------------

/**
 * `strategies_source_check`. The six exchange sources point at
 * `EXCHANGE_DISPLAY` so a venue's name is written once.
 */
export const STRATEGY_SOURCE_LABELS = {
  legacy: "Legacy",
  wizard: "Wizard",
  admin_import: "Import",
  allocator_connected: "Connected",
  csv: "CSV",
  okx: EXCHANGE_DISPLAY.okx,
  binance: EXCHANGE_DISPLAY.binance,
  bybit: EXCHANGE_DISPLAY.bybit,
  deribit: EXCHANGE_DISPLAY.deribit,
  sfox: EXCHANGE_DISPLAY.sfox,
  mt5: EXCHANGE_DISPLAY.mt5,
} as const satisfies Record<StrategySource, string>;

export function strategySourceLabel(value: unknown): string {
  return labelOf(STRATEGY_SOURCE_LABELS, value, "Other source");
}

/** A venue code (`okx`, `OKX`) as its display name; a miss reads "Other venue". */
export function venueLabel(code: unknown): string {
  return labelOf(
    EXCHANGE_DISPLAY,
    typeof code === "string" ? code.trim().toLowerCase() : code,
    "Other venue",
  );
}

/**
 * One entry of a free-text exchange list (`strategies.supported_exchanges` is
 * `text[]`, not a closed set). A known code maps through `EXCHANGE_DISPLAY`,
 * case-insensitively. Any other non-empty value is a real venue name the closed
 * set lacks, so it is returned verbatim, trimmed, and never erased to
 * "Other venue".
 */
export function supportedExchangeLabel(value: string): string {
  const trimmed = value.trim();
  return labelOf(EXCHANGE_DISPLAY, trimmed.toLowerCase(), trimmed);
}
