/**
 * Phase 19 / PR-X5 — shared constants for the teaser flow.
 *
 * Sentinel strategy_id for the teaser flow's strategy_verifications rows.
 * Provisioned by supabase/migrations/132_teaser_anchor_strategy.sql.
 *
 * The teaser submission has no caller-owned strategy by design — the user
 * is probing keys against the universe of published strategies; no
 * strategy exists yet. This sentinel satisfies the
 * strategy_verifications.strategy_id NOT NULL FK constraint without the
 * documented privacy leak that the "anchor to most recent strategies row"
 * hack carried (migration 107 DM-3 commentary).
 *
 * The sentinel strategy is owned by an all-zeros system pseudo-user so
 * auth.uid() never matches. status='archived' keeps the row out of every
 * marketplace / allocator query.
 *
 * Keep in sync with analytics-service/services/teaser_anchor.py
 * (TEASER_ANCHOR_STRATEGY_ID).
 */
export const TEASER_ANCHOR_STRATEGY_ID =
  "00000000-0000-0000-0000-000000000001" as const;
