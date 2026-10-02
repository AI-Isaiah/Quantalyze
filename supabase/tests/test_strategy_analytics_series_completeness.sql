-- Test: strategy_analytics.series_completeness carries the MT5-12 verdict
-- (Phase 142.2). Guards migration
-- 20260803150000_strategy_analytics_series_completeness.sql.
--
-- Background
-- ----------
-- The strategy gate used to ask a hardcoded venue list whether a strategy's
-- daily series could be trusted. MT5-12 replaces that proxy with a verdict the
-- producer stamps on the series itself:
--   ledger_complete | sampled_gapped | fill_derived_unproven | user_supplied |
--   composite_stitched
-- This gate pins the SHAPE of the carrier, and nothing about row contents --
-- workers legitimately populate values after deploy, so any assertion on data
-- would be a time bomb.
--
-- Asserted invariants:
--   1. Column series_completeness exists and is text.
--   2. It is NULLABLE. Existing rows were written before any producer examined
--      their inputs; NULL is the honest verdict for them and the gate is
--      fail-closed on NULL. A NOT NULL here is a 23502 timebomb against every
--      existing writer that upserts strategy_analytics without the column.
--   3. It has NO DEFAULT. A default would stamp a trust verdict on rows whose
--      inputs nobody examined.
--   4. NEGATIVE probe: there is NO CHECK constraint referencing the column.
--      This is deliberate, not an omission. A CHECK enumerating the five values
--      would be a second hand-maintained copy of the PRODUCER value set -- the
--      exact two-registries drift class MT5-12 exists to delete -- and it would
--      fail a live money-path write with 23514 instead of reddening a build.
--      The producer registry lives in Python
--      (analytics-service/services/broker_dailies.py) and is enforced by a
--      fail-loud assert at the derive seam. TypeScript separately holds an
--      independent admissibility POLICY (a hand-typed subset in
--      src/lib/strategyGate.ts, deliberately never imported) which answers a
--      different question and is not a copy of the producer set. This assertion
--      reddens CI if someone later "helpfully" adds the constraint.
--
-- ANTI-GREEN-SKIP CONTRACT (read this before adding any presence gate)
-- -------------------------------------------------------------------
-- An earlier draft of this file green-skipped when the column was absent
-- (`RAISE NOTICE 'SKIP' ... RETURN`), on the reasoning that the shared test DB
-- lags main. That is exactly the pattern
-- test_strategy_analytics_stuck_computing_reaper.sql forbids, on this same
-- table, one migration earlier: "A gate that green-skips when the object under
-- test is absent is not evidence." It is worse here than in the general case,
-- because merging supabase/migrations/** applies the migration to PRODUCTION,
-- not to the test DB -- so nothing in the merge path would ever have made this
-- column appear here, and the gate could have stayed vacuously green forever
-- while reporting success.
--
-- Absence is therefore an EXCEPTION, not a skip. The apply-to-TEST step is a
-- BLOCKING task in plan 142.2-04 and runs BEFORE the PR exists, so this file is
-- red only in the window where the migration genuinely has not been applied --
-- which is the state it is supposed to report. Do not re-add a presence gate.
-- The migration itself also self-verifies on apply. Whole test rolls back.
--
-- ⭐ RED-UNDER ANNOTATIONS (Phase 164.4). Each assertion below carries a prose
-- `RED-UNDER:` naming the smallest production change that makes it fail, and a
-- machine-readable `RED-UNDER-M:` twin the mutation runner applies on a
-- throwaway pg-lane cluster to PROVE it reds on its own arm, then restores
-- GREEN. Schema: scripts/mutation-runner/GRAMMAR.md. The line below declares
-- what the lane applies before this gate.
-- ⚠️ THE COLUMN UNDER TEST IS THE REAL ONE. `strategy_analytics` itself is a
-- pg-lane stand-in (03-fixture-compute-jobs.sql) carrying only the columns
-- other gates' bodies name — but `series_completeness`, and every property
-- asserted about it, comes from migration 20260803150000, which is in the list.
-- ⚠️ Four twins are LAYERED: that migration re-asserts nullability, type and
-- default-absence in its own apply-time DO block, so mutating the shape aborts
-- the APPLY before this gate can speak. The extra step removes only the
-- matching term. That duplication is the point of the file — a migration DO
-- block runs once, this runs on every CI build.
-- RED-UNDER-SETUP: {"apply":["scripts/pg-lane/fixtures/01-fixture-core.sql","scripts/pg-lane/fixtures/02-fixture-sanitize-tables.sql","scripts/pg-lane/fixtures/03-fixture-compute-jobs.sql","supabase/migrations/20260803150000_strategy_analytics_series_completeness.sql"]}

BEGIN;

DO $$
DECLARE
  v_col_type     TEXT;
  v_col_nullable TEXT;
  v_col_default  TEXT;
  v_check_def    TEXT;
BEGIN
  SELECT data_type, is_nullable, column_default
    INTO v_col_type, v_col_nullable, v_col_default
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'strategy_analytics'
      AND column_name = 'series_completeness';

  -- RED-UNDER: rename the column at birth — `series_completeness` becomes
  --            `series_completeness_v2` in 20260803150000's ADD COLUMN (and in
  --            the COMMENT that names it). The carrier the whole MT5-12 verdict
  --            travels on would simply not exist under the name every reader
  --            uses, and this arm is the one that says so instead of skipping.
  --            LAYERED: the migration's own absence check fires first, so the
  --            third step removes THAT term only.
  -- RED-UNDER-M: {"arm":"0","apply":[{"kind":"edit","file":"supabase/migrations/20260803150000_strategy_analytics_series_completeness.sql","find":"ALTER TABLE public.strategy_analytics\n  ADD COLUMN IF NOT EXISTS series_completeness text;","replace":"ALTER TABLE public.strategy_analytics\n  ADD COLUMN IF NOT EXISTS series_completeness_v2 text;","occurrences":1},{"kind":"edit","file":"supabase/migrations/20260803150000_strategy_analytics_series_completeness.sql","find":"COMMENT ON COLUMN public.strategy_analytics.series_completeness IS","replace":"COMMENT ON COLUMN public.strategy_analytics.series_completeness_v2 IS","occurrences":1},{"kind":"edit","file":"supabase/migrations/20260803150000_strategy_analytics_series_completeness.sql","find":"  IF v_is_nullable IS NULL THEN","replace":"  IF FALSE THEN","occurrences":1}]}
  IF v_col_type IS NULL THEN
    RAISE EXCEPTION 'TEST FAILED (0): strategy_analytics.series_completeness is absent — apply migration 20260803150000 to this project before merging (TEST is qmnijlgmdhviwzwfyzlc; plan 142.2-04 owns the apply). This is deliberately an EXCEPTION and not a skip: merging supabase/migrations/** applies to PRODUCTION, never to the test DB, so a presence gate here would stay vacuously green forever. See the ANTI-GREEN-SKIP CONTRACT above.';
  END IF;

  -- ---- (1) column type -------------------------------------------------------
  -- RED-UNDER: narrow the type — `series_completeness text` becomes
  --            `varchar(64)` in 20260803150000. The producer registry in
  --            broker_dailies.py is the only thing that bounds this value set,
  --            so a length cap here is a SECOND, silent bound that truncates or
  --            rejects a verdict nobody widened it for.
  --            LAYERED: the migration checks the same data_type, and it does so
  --            BECAUSE `ADD COLUMN IF NOT EXISTS` no-ops on a pre-existing
  --            column of any type.
  -- RED-UNDER-M: {"arm":"1","apply":[{"kind":"edit","file":"supabase/migrations/20260803150000_strategy_analytics_series_completeness.sql","find":"ALTER TABLE public.strategy_analytics\n  ADD COLUMN IF NOT EXISTS series_completeness text;","replace":"ALTER TABLE public.strategy_analytics\n  ADD COLUMN IF NOT EXISTS series_completeness varchar(64);","occurrences":1},{"kind":"edit","file":"supabase/migrations/20260803150000_strategy_analytics_series_completeness.sql","find":"  IF v_data_type <> 'text' THEN","replace":"  IF FALSE THEN","occurrences":1}]}
  IF v_col_type <> 'text' THEN
    RAISE EXCEPTION 'TEST FAILED (1): series_completeness must be text, got %', v_col_type;
  END IF;
  RAISE NOTICE 'Assertion 1 OK: series_completeness is text.';

  -- ---- (2) nullable ----------------------------------------------------------
  -- RED-UNDER: add `NOT NULL` to the column in 20260803150000. Every existing
  --            writer that upserts strategy_analytics WITHOUT this column then
  --            fails 23502 on a live money path — and NULL is the honest verdict
  --            for rows whose inputs no producer ever examined.
  --            LAYERED: the migration asserts nullability too. Note the mutation
  --            adds NO default, deliberately, so assertion 3 stays green and this
  --            arm is the only one that moves.
  -- RED-UNDER-M: {"arm":"2","apply":[{"kind":"edit","file":"supabase/migrations/20260803150000_strategy_analytics_series_completeness.sql","find":"ALTER TABLE public.strategy_analytics\n  ADD COLUMN IF NOT EXISTS series_completeness text;","replace":"ALTER TABLE public.strategy_analytics\n  ADD COLUMN IF NOT EXISTS series_completeness text NOT NULL;","occurrences":1},{"kind":"edit","file":"supabase/migrations/20260803150000_strategy_analytics_series_completeness.sql","find":"  IF v_is_nullable <> 'YES' THEN","replace":"  IF FALSE THEN","occurrences":1}]}
  IF v_col_nullable <> 'YES' THEN
    RAISE EXCEPTION 'TEST FAILED (2): series_completeness must be NULLABLE, got is_nullable=%. A NOT NULL here is a 23502 timebomb against every existing writer that upserts strategy_analytics without the column, and NULL is the honest verdict for rows whose inputs were never examined', v_col_nullable;
  END IF;
  RAISE NOTICE 'Assertion 2 OK: series_completeness is nullable.';

  -- ---- (3) no default --------------------------------------------------------
  -- RED-UNDER: give the column a DEFAULT — `text DEFAULT 'ledger_complete'` in
  --            20260803150000. That stamps the STRONGEST trust verdict in the
  --            value set onto every row whose inputs nobody examined, which is
  --            worse than a wrong value: it is a wrong value that reads as
  --            deliberate. The column stays text and nullable, so assertions 1
  --            and 2 are untouched.
  --            LAYERED: the migration asserts default-absence too.
  -- RED-UNDER-M: {"arm":"3","apply":[{"kind":"edit","file":"supabase/migrations/20260803150000_strategy_analytics_series_completeness.sql","find":"ALTER TABLE public.strategy_analytics\n  ADD COLUMN IF NOT EXISTS series_completeness text;","replace":"ALTER TABLE public.strategy_analytics\n  ADD COLUMN IF NOT EXISTS series_completeness text DEFAULT 'ledger_complete';","occurrences":1},{"kind":"edit","file":"supabase/migrations/20260803150000_strategy_analytics_series_completeness.sql","find":"  IF v_default IS NOT NULL THEN","replace":"  IF FALSE THEN","occurrences":1}]}
  IF v_col_default IS NOT NULL THEN
    RAISE EXCEPTION 'TEST FAILED (3): series_completeness must have NO DEFAULT, got %. A DEFAULT stamps a trust verdict on rows whose inputs nobody examined', v_col_default;
  END IF;
  RAISE NOTICE 'Assertion 3 OK: series_completeness has no default.';

  -- ---- (4) negative probe: no CHECK constraint on the value set ---------------
  -- RED-UNDER: add the CHECK the header spends a paragraph refusing. Expressed
  --            as a live `sql` step rather than an edit because the drift being
  --            modelled is a LATER migration "helpfully" pinning the value set —
  --            20260803150000 does not carry the constraint to remove.
  --            A CHECK here is a second hand-maintained copy of the PRODUCER set
  --            in broker_dailies.py, and it fails a live money-path write with
  --            23514 instead of reddening a build.
  -- RED-UNDER-M: {"arm":"4","apply":[{"kind":"sql","stmt":"ALTER TABLE public.strategy_analytics ADD CONSTRAINT strategy_analytics_series_completeness_values CHECK (series_completeness IS NULL OR series_completeness IN ('ledger_complete','sampled_gapped','fill_derived_unproven','user_supplied','composite_stitched'))"}]}
  SELECT pg_get_constraintdef(oid) INTO v_check_def
    FROM pg_constraint
    WHERE conrelid = 'public.strategy_analytics'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) ILIKE '%series_completeness%'
    LIMIT 1;

  IF v_check_def IS NOT NULL THEN
    RAISE EXCEPTION 'TEST FAILED (4): a CHECK constraint now pins series_completeness (%). That is a second hand-maintained copy of the PRODUCER value set -- the drift class MT5-12 deletes -- and it fails a live money-path write instead of reddening a build. The producer registry is broker_dailies.py, enforced by a fail-loud assert at the derive seam; TypeScript''s hand-typed subset in strategyGate.ts is an independent admissibility policy, not a copy. Remove the constraint', v_check_def;
  END IF;
  RAISE NOTICE 'Assertion 4 OK: no CHECK constraint references series_completeness (value set stays single-producer, enforced in Python).';
END $$;

ROLLBACK;
