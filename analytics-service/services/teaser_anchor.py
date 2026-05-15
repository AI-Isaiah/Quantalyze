"""Phase 19 / PR-X5 — shared constants for the teaser flow.

Mirrors src/lib/phase-19-constants.ts. Keep both in sync.

The TEASER_ANCHOR_STRATEGY_ID UUID satisfies the
strategy_verifications.strategy_id NOT NULL FK for the teaser flow,
which has no caller-owned strategy by design. Provisioned by
supabase/migrations/20260515095804_teaser_anchor_strategy.sql alongside its
sentinel auth.users + profiles rows.
"""

# Deterministic UUID — keep in sync with src/lib/phase-19-constants.ts.
TEASER_ANCHOR_STRATEGY_ID = "00000000-0000-0000-0000-000000000001"
