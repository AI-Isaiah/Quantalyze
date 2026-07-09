-- Migration: strategies.asset_class — annualization basis (crypto √365 vs traditional √252)
-- =============================================================================
-- Purpose (#597, follow-up to v1.8)
-- ----------------------------------------------------------------------
-- Annualization of Sharpe/Sortino/volatility depends on how many days per year
-- the market trades, which is an ASSET-CLASS property, not an ingestion detail:
--   * crypto      → 7-day markets → √365
--   * traditional → weekday markets (equities/FX) → √252
--
-- Before this, the analytics path proxied "crypto" as "has an api_key_id"
-- (broker-sourced). That wrongly left a CSV-uploaded crypto strategy at √252 and
-- diverged the Python factsheet from three frontend surfaces that hardcode √252
-- (OG card, ScenarioComposer, allocator portfolio). This column is the explicit
-- signal every surface reads.
--
-- Safety
-- ----------------------------------------------------------------------
-- Additive column with a constant DEFAULT ⇒ metadata-only on PG11+ (no table
-- rewrite). Backfill sets crypto for api_key-sourced strategies (every supported
-- exchange — binance/okx/bybit/deribit — trades 7 days/week), so the fleet √365
-- already shipped in v1.8 (which keyed on api_key_id) is byte-identical after this
-- swap. CSV/paper strategies default to 'traditional' and are user-reclassifiable
-- via the CSV-upload asset-class picker.

ALTER TABLE public.strategies
    ADD COLUMN IF NOT EXISTS asset_class text NOT NULL DEFAULT 'traditional'
        CHECK (asset_class IN ('crypto', 'traditional'));

-- Backfill: broker/API-key strategies are crypto (all supported exchanges are crypto).
UPDATE public.strategies
    SET asset_class = 'crypto'
    WHERE api_key_id IS NOT NULL AND asset_class <> 'crypto';

COMMENT ON COLUMN public.strategies.asset_class IS
    'Annualization basis: crypto (7-day markets, √365) vs traditional (weekday '
    'markets, √252). Backfilled crypto for api_key-sourced strategies; CSV/paper '
    'default traditional, user-settable at upload. Read by the analytics factsheet '
    'path and the OG card / ScenarioComposer / allocator portfolio frontend surfaces.';
