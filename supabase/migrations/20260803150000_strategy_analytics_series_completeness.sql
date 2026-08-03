-- MT5-12 (Phase 142.2): the series-completeness verdict carrier.
--
-- Background
-- ----------
-- The strategy gate decides whether a strategy has enough real trading history
-- by asking a hardcoded venue list ("is this exchange ledger-backed?") instead
-- of asking the daily series itself. That list drifted out of lockstep with its
-- Python counterpart, which is how a fully-computed MT5 account carrying 135
-- canonical dailies was refused. D-16 settled the shape: completeness is a
-- property of the SERIES' INPUTS, and the series' identity is the strategy --
-- so the verdict belongs on strategy_analytics, one row per strategy, and not
-- on individual csv_daily_returns rows (the superseded sketch).
--
-- The verdict values (five, exhaustive as of this migration):
--   ledger_complete       -- every input the series needs was present in the
--                            venue's own ledger; nothing was inferred.
--   sampled_gapped        -- the inputs were sampled and are known to have
--                            holes (e.g. a perp whose fills are missing, whose
--                            dailies therefore carry funding only). This is the
--                            verdict the gate must keep REFUSING -- it is the
--                            safety property, and MT5 passing is not the test.
--   fill_derived_unproven -- derived from fills with no independent balance or
--                            equity anchor proving the series closes.
--   user_supplied         -- the numbers came from a human-provided file; the
--                            underlying inputs were never observed by us.
--   composite_stitched    -- stitched from member series by the composite
--                            producer (the second csv_daily_returns writer).
--                            Without this verdict, dropping the venue-list gate
--                            term would make every composite read NULL and
--                            become un-approvable.
--
-- Registry model -- stated precisely, because the imprecise version would be
-- false the day it merges:
--   * A single PRODUCER registry decides these values, in Python:
--     analytics-service/services/broker_dailies.py. That is the only place a
--     verdict is ASSIGNED, and a fail-loud assert at the derive seam
--     (job_worker.py) refuses to persist a series whose producer omitted one.
--   * TypeScript separately holds an ADMISSIBILITY POLICY --
--     SERIES_TRUSTED_FOR_DAILY_BRANCH in src/lib/strategyGate.ts -- a
--     hand-typed SUBSET of these values that is deliberately NEVER imported
--     from anywhere. It answers a different question ("which verdicts may the
--     gate trust?") than the producer registry ("which verdicts exist?"), so it
--     is not a second copy of the producer set; its independence is the point.
--     Do not "fix" it by importing it, and do not describe this value set as
--     living in a single place overall -- the policy subset exists on purpose.
--
-- No SQL CHECK constraint pins the value set, BY DESIGN. A CHECK listing the
-- five values would be a second hand-maintained copy of the PRODUCER set --
-- precisely the two-registries drift class MT5-12 exists to delete -- and it
-- would fail a live money-path write with 23514 rather than reddening a build.
-- The Python fail-loud assert is the enforcement, and
-- supabase/tests/test_strategy_analytics_series_completeness.sql pins the
-- ABSENCE of any such constraint, so a future "helpful" one reddens CI.
--
-- Shape: additive, nullable, no default, no backfill, no RLS change, no index,
-- no scheduled job. NULL is the honest verdict for every existing row: their
-- inputs were never examined, and the gate is fail-closed on NULL. Stamping
-- them would fabricate a trust claim about series whose inputs no longer exist.
--
-- Merging this file to main auto-applies it to production.

BEGIN;
SET lock_timeout = '5s';

-- --------------------------------------------------------------------------
-- STEP 1: DDL -- the verdict column
-- --------------------------------------------------------------------------
-- Nullable, NO DEFAULT, NO SET NOT NULL. A NOT NULL here would be a 23502
-- timebomb against every existing writer that upserts strategy_analytics
-- without the column, and a DEFAULT would stamp a trust verdict on rows whose
-- inputs nobody examined.
ALTER TABLE public.strategy_analytics
  ADD COLUMN IF NOT EXISTS series_completeness text;

COMMENT ON COLUMN public.strategy_analytics.series_completeness IS
  'MT5-12 (Phase 142.2): the completeness verdict for this strategy''s daily '
  'series. Values: ledger_complete | sampled_gapped | fill_derived_unproven | '
  'user_supplied | composite_stitched. The PRODUCER decides: the verdict is '
  'assigned by the code that builds the series, from a single producer '
  'registry in Python (analytics-service/services/broker_dailies.py). '
  'TypeScript holds a SEPARATE admissibility policy -- a hand-typed subset in '
  'src/lib/strategyGate.ts, deliberately never imported -- which answers which '
  'verdicts the gate may trust, not which verdicts exist; that independence is '
  'intentional and is not a second copy of the producer set. NULL means the '
  'series'' inputs were never examined, and the gate refuses NULL '
  '(fail-closed). Deliberately NO CHECK constraint on the values: a CHECK '
  'would be a second hand-maintained copy of the producer set -- the drift '
  'class this column deletes -- and would fail a live money-path write instead '
  'of reddening a build; the fail-loud assert at the derive seam is the '
  'enforcement. Backfilling this column is FORBIDDEN: a backfill fabricates a '
  'trust claim about series whose inputs no longer exist to examine.';

-- --------------------------------------------------------------------------
-- STEP 2: self-verify -- the three properties this migration promises
-- --------------------------------------------------------------------------
DO $$
DECLARE
  v_is_nullable TEXT;
  v_default     TEXT;
BEGIN
  SELECT c.is_nullable, c.column_default
    INTO v_is_nullable, v_default
    FROM information_schema.columns c
   WHERE c.table_schema = 'public'
     AND c.table_name = 'strategy_analytics'
     AND c.column_name = 'series_completeness';

  IF v_is_nullable IS NULL THEN
    RAISE EXCEPTION 'MT5-12 verification failed: strategy_analytics.series_completeness is absent after ADD COLUMN';
  END IF;

  IF v_is_nullable <> 'YES' THEN
    RAISE EXCEPTION 'MT5-12 verification failed: strategy_analytics.series_completeness is not nullable (is_nullable=%); a NOT NULL here is a 23502 timebomb against every existing writer that upserts strategy_analytics without the column', v_is_nullable;
  END IF;

  IF v_default IS NOT NULL THEN
    RAISE EXCEPTION 'MT5-12 verification failed: strategy_analytics.series_completeness carries a DEFAULT (%); a default stamps a trust verdict on rows whose inputs nobody examined', v_default;
  END IF;

  RAISE NOTICE 'MT5-12: strategy_analytics.series_completeness shape verified (text, nullable, no default).';
END $$;

COMMIT;
