-- Migration: strategies.returns_denominator_config — per-strategy returns override
-- =============================================================================
-- Purpose (v1.8 native-unit reconstruction)
-- ----------------------------------------------------------------------
-- Adds a NULLABLE JSONB column that, WHEN SET on a strategy, switches that
-- strategy's daily-return computation from the NAV backward-roll (chain-linked
-- TWR + §5 inception gate) to an allocated-capital denominator:
--
--     r(d) = daily_pnl_usd(d) / allocated_capital(d)
--
-- against an externally-scheduled capital base. This path DELIBERATELY bypasses
-- the NAV reconstruction and its §5 gate (the capital is scheduled, not a
-- reconstructed NAV). It exists for the Zavara-style allocated mandate whose
-- factsheet is reported on scheduled capital, not mark-to-market NAV.
--
-- Shape (validated in services/allocated_capital.py — a malformed config FAILS
-- LOUD at derive time, never a guessed base):
--
--   {
--     "denominator": "allocated_capital",
--     "pnl_basis": "cash_settlement",              -- or "mark_to_market"
--     "capital_schedule": [
--       {"effective_from": "2025-08-03", "capital_usd": 4000000},
--       {"effective_from": "2025-09-27", "capital_usd": 10000000}
--       -- ...strictly-ascending effective_from, positive capital_usd
--     ],
--     "metrics_basis": "active_day",               -- or "calendar_day"
--     "cumulative_method": "simple",               -- OPTIONAL; or "geometric"
--                                                  --   (absent ⇒ "geometric")
--     "mandate_end": "2026-03-31"                  -- OPTIONAL ISO date; caps the
--                                                  --   reporting-window END (must be
--                                                  --   strictly after the LAST
--                                                  --   tranche; absent ⇒ unbounded)
--   }
--
-- Safety
-- ----------------------------------------------------------------------
-- PURE ADDITIVE + NULLABLE. NULL for every existing row (no backfill, no default)
-- ⇒ every existing strategy stays on the unchanged NAV path, BYTE-IDENTICAL. No
-- data migration, no CHECK constraint on existing rows (NULL is always allowed).
-- Activation for any specific strategy (e.g. LTP068) is a SEPARATE, deliberate
-- data change made after review — this migration does NOT set the column on any
-- row.

ALTER TABLE public.strategies
    ADD COLUMN IF NOT EXISTS returns_denominator_config jsonb;

COMMENT ON COLUMN public.strategies.returns_denominator_config IS
    'NULLABLE per-strategy returns override. When set, daily returns = '
    'daily_pnl_usd / allocated_capital(date) (bypasses NAV/§5). Shape validated '
    'in services/allocated_capital.py:parse_returns_denominator_config. NULL '
    '(default) = normal NAV backward-roll path.';
