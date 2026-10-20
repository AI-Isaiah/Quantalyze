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
