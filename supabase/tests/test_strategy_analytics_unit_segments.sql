-- Test: strategy_analytics.unit_segments (Phase 256 OKXUNITSWITCH, plan 02).
-- Guards migration 20261127200000_strategy_analytics_unit_segments.sql.
--
-- Background
-- ----------
-- unit_segments stores the two native segments (USD, then a coin) of a strategy
-- whose unit switched. Its writer is the analytics derive (service role) and its
-- reader is the factsheet payload, so this gate pins the SHAPE of the carrier and
-- the properties a reader and a writer depend on, and nothing about row contents:
-- workers legitimately populate values after deploy, so any assertion on data
-- would be a time bomb.
--
-- Arms (LISTED and EXECUTED in this order; the order is LOAD-BEARING because
-- arms 2, 3 and 4 share the one stand-in row that the 2-SETUP block seeds):
--   1a the column exists and is jsonb; absence is an EXCEPTION, never a skip.
--   1b it is NULLABLE. NULL is the honest value for every strategy that never
--      switched, and a NOT NULL is a 23502 timebomb against every writer that
--      upserts the row without the column.
--   1c it has no DEFAULT. A default would claim a unit history for rows nobody
--      observed.
--   2  an object, including the documented two-segment shape, is accepted.
--   3  an array, a string and a number are each refused with SQLSTATE 23514 by
--      strategy_analytics_unit_segments_object_chk.
--   4  NULL is accepted on a row that held an object (a re-derive that finds no
--      switch must be able to clear it).
--   5a the three existing RLS policies are present by name.
--   5b no policy mentions unit_segments: the migration changes no access rule.
--   6  anon and authenticated can SELECT the column, so the factsheet payload
--      can read it through the existing policies.
--
-- ⚠️ ARM 6 reads has_column_privilege, which also reads TABLE-level grants, so
-- its twin revokes at table level. The grants come from fixture 07 (Supabase's
-- default privileges) on the pg-lane and from the bootstrap on the baseline.
--
-- ANTI-GREEN-SKIP CONTRACT. Absence of the column is an EXCEPTION. A gate that
-- green-skips when the object under test is absent is not evidence, and merging
-- supabase/migrations/** applies to PRODUCTION, so nothing in the merge path
-- would make a missing column appear. Do not add a presence skip.
--
-- Every sub-identity carries a digit (`2-SETUP`, never a bare letter). The
-- runner's `sectionOfIdentity` collapses a trailing `-SUFFIX` into its parent only
-- when a digit precedes it, so `2-SETUP` is a sub-arm covered by its parent's
-- twin: a vacuity guard ("the fixture reached the state this arm is about"),
-- not a claim about the migration.
--
-- pgTAP is NOT installed (CLAUDE.md). Plain PL/pgSQL DO block, RAISE EXCEPTION on
-- failure. No psql meta-commands. The whole test rolls back.
--
-- ⭐ RED-UNDER ANNOTATIONS. Each assertion below carries a prose `RED-UNDER:`
-- and a machine-readable twin the mutation runner applies on a throwaway
-- pg-lane cluster to PROVE the arm reds on its own, then restores GREEN. Schema:
-- scripts/mutation-runner/GRAMMAR.md.
-- ⚠️ Arms 1a, 1b and 1c are `sql` twins applied AFTER the migration: the
-- migration re-asserts type, nullability and default-absence in its own
-- apply-time DO block, so mutating the shape inside the migration would abort
-- the APPLY before this gate could speak. That duplication is the point of the
-- file: a migration DO block runs once, this runs on every CI build.
-- RED-UNDER-SETUP: {"apply":["scripts/pg-lane/fixtures/01-fixture-core.sql","scripts/pg-lane/fixtures/07-fixture-supabase-default-privileges.sql","scripts/pg-lane/fixtures/02-fixture-sanitize-tables.sql","scripts/pg-lane/fixtures/03-fixture-compute-jobs.sql","scripts/pg-lane/fixtures/10-fixture-strategies-rls-baseline.sql","supabase/migrations/20260405061912_rls_policies.sql","supabase/migrations/20261127200000_strategy_analytics_unit_segments.sql"]}

BEGIN;

DO $$
DECLARE
  v_type     TEXT;
  v_null     TEXT;
  v_def      TEXT;
  v_user     UUID := gen_random_uuid();
  v_sid      UUID;
  v_kind     TEXT;
  v_val      JSONB;
  v_raised   BOOLEAN;
  v_state    TEXT;
  v_cname    TEXT;
  v_msg      TEXT;
  v_missing  TEXT;
  v_leaking  TEXT;
  v_readback JSONB;
BEGIN
  -- ===== ARM 1a — the column exists and is jsonb. ABSENCE IS A FAILURE ======
  SELECT data_type, is_nullable, column_default
    INTO v_type, v_null, v_def
    FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'strategy_analytics'
     AND column_name = 'unit_segments';

  -- RED-UNDER: replace unit_segments with a `json` column on the live lane AFTER
  --            the apply list has run, so the gate meets a column of the wrong
  --            type (and, with the old column gone, the object CHECK with it).
  --            ⚠️ A `sql` step and NOT an `edit` of the migration: the
  --            migration's own verify block asserts the type and would RAISE,
  --            aborting the apply, so no arm could be the FIRST failure and the
  --            runner would score a defect, not a bite.
  -- RED-UNDER-M: {"arm":"1a","apply":[{"kind":"sql","stmt":"ALTER TABLE public.strategy_analytics DROP COLUMN unit_segments"},{"kind":"sql","stmt":"ALTER TABLE public.strategy_analytics ADD COLUMN unit_segments json NULL"}]}
  IF v_type IS NULL OR v_type <> 'jsonb' THEN
    RAISE EXCEPTION 'TEST FAILED (1a): strategy_analytics.unit_segments must be a jsonb column, found type=%. The column migration 20261127200000 is not in force on this database; apply it and re-run (expect this once on the PR that introduces it, because this repo applies migrations on MERGE and not on PR). ⛔ Do NOT turn this into a RAISE NOTICE skip.', COALESCE(v_type, 'ABSENT');
  END IF;

  -- ===== ARM 1b — nullable ==================================================
  -- RED-UNDER: SET NOT NULL on unit_segments on the live lane (the table is
  --            empty there, so the ALTER applies). Every existing writer that
  --            upserts strategy_analytics without the column then fails 23502
  --            on a live money path, and NULL is the honest value for a
  --            strategy that never switched unit.
  -- RED-UNDER-M: {"arm":"1b","apply":[{"kind":"sql","stmt":"ALTER TABLE public.strategy_analytics ALTER COLUMN unit_segments SET NOT NULL"}]}
  IF v_null <> 'YES' THEN
    RAISE EXCEPTION 'TEST FAILED (1b): unit_segments must be NULLABLE, got is_nullable=%. A NOT NULL is a 23502 timebomb against every writer that upserts strategy_analytics without the column, and NULL is the honest value for a strategy that never switched unit', v_null;
  END IF;

  -- ===== ARM 1c — no default ================================================
  -- RED-UNDER: give unit_segments a `DEFAULT '{}'` on the live lane. Every row
  --            created afterwards would claim an empty unit history that nobody
  --            recorded, which reads as a deliberate answer where NULL reads as
  --            "no switch". The column stays nullable and jsonb, so arms 1a and
  --            1b are untouched.
  -- RED-UNDER-M: {"arm":"1c","apply":[{"kind":"sql","stmt":"ALTER TABLE public.strategy_analytics ALTER COLUMN unit_segments SET DEFAULT '{}'::jsonb"}]}
  IF v_def IS NOT NULL THEN
    RAISE EXCEPTION 'TEST FAILED (1c): unit_segments may not carry a DEFAULT, got %. A default stamps a unit history on rows nobody observed', v_def;
  END IF;

  -- ----- 2-SETUP: one strategy_analytics row, through the FK chain ----------
  -- strategy_analytics.strategy_id -> strategies.id -> profiles.id -> auth.users.id
  -- on the baseline; the pg-lane stand-in carries the chain too, so the same
  -- inserts run on both. Only computation_status is set beyond the key, so the
  -- row's unit_segments is whatever an insert that never names it receives.
  INSERT INTO auth.users (id, email)
    VALUES (v_user, 'sa-us-arms-' || v_user || '@invalid.local');
  INSERT INTO public.profiles (id, display_name)
    VALUES (v_user, 'sa-us-arms') ON CONFLICT (id) DO NOTHING;
  INSERT INTO public.strategies (user_id, name)
    VALUES (v_user, 'sa-us-arm-2') RETURNING id INTO v_sid;
  INSERT INTO public.strategy_analytics (strategy_id, computation_status)
    VALUES (v_sid, 'complete');
  SELECT unit_segments INTO v_readback FROM public.strategy_analytics WHERE strategy_id = v_sid;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'TEST FAILED (2-SETUP): the stand-in strategy_analytics row was not created, so arms 2, 3 and 4 below would be asking about a row that does not exist.';
  END IF;
  IF v_readback IS NOT NULL THEN
    RAISE EXCEPTION 'TEST FAILED (2-SETUP): an insert that never names unit_segments stored % instead of NULL, so the NULL-for-every-existing-row claim does not hold.', v_readback;
  END IF;

  -- ===== ARM 2 — an object is accepted ======================================
  -- RED-UNDER: weaken the CHECK in 20261127200000 so it admits only a JSON
  --            ARRAY (the name stays, so the verify block's by-name presence
  --            term does not move). The derive's documented object, with its
  --            version, two segments and unpriced days, is then refused and a
  --            unit-switched strategy can never store its series.
  -- RED-UNDER-M: {"arm":"2","apply":[{"kind":"edit","file":"supabase/migrations/20261127200000_strategy_analytics_unit_segments.sql","find":"CHECK (unit_segments IS NULL OR jsonb_typeof(unit_segments) = 'object');","replace":"CHECK (unit_segments IS NULL OR jsonb_typeof(unit_segments) = 'array');","occurrences":1}]}
  v_msg := NULL;
  BEGIN
    UPDATE public.strategy_analytics SET unit_segments = '{}'::jsonb WHERE strategy_id = v_sid;
    UPDATE public.strategy_analytics
       SET unit_segments = '{"version":1,"segments":[{"unit":"USD","from_day":"2026-01-01","to_day":"2026-01-03","returns":[{"date":"2026-01-02","value":0.01},{"date":"2026-01-03","value":-0.02}]},{"unit":"BTC","base_day":"2026-01-03","from_day":"2026-01-04","to_day":"2026-01-05","returns":[{"date":"2026-01-04","value":0.03},{"date":"2026-01-05","value":0.0}]}],"unpriced_days":["2026-01-04"]}'::jsonb
     WHERE strategy_id = v_sid;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_msg = MESSAGE_TEXT;
  END;
  IF v_msg IS NOT NULL THEN
    RAISE EXCEPTION 'TEST FAILED (2): an object was refused (%), so the CHECK rejects the documented shape', v_msg;
  END IF;
  SELECT unit_segments INTO v_readback FROM public.strategy_analytics WHERE strategy_id = v_sid;
  IF v_readback IS NULL OR jsonb_typeof(v_readback) <> 'object' OR jsonb_array_length(v_readback -> 'segments') <> 2 THEN
    RAISE EXCEPTION 'TEST FAILED (2): the documented object did not read back as stored (got %)', v_readback;
  END IF;

  -- ===== ARM 3 — an array, a string and a number are refused ================
  -- RED-UNDER: weaken the CHECK in 20261127200000 to `CHECK (true)` (the name
  --            stays, so the verify block's by-name presence term does not
  --            move). A writer bug then stores a JSON array or a bare number,
  --            and the reader, which expects an object with a segments array,
  --            would read a malformed value that the database had vouched for.
  -- RED-UNDER-M: {"arm":"3","apply":[{"kind":"edit","file":"supabase/migrations/20261127200000_strategy_analytics_unit_segments.sql","find":"CHECK (unit_segments IS NULL OR jsonb_typeof(unit_segments) = 'object');","replace":"CHECK (true);","occurrences":1}]}
  FOREACH v_kind IN ARRAY ARRAY['array', 'string', 'number'] LOOP
    v_val := CASE v_kind WHEN 'array' THEN '[]'::jsonb WHEN 'string' THEN '"x"'::jsonb ELSE '7'::jsonb END;
    v_raised := false; v_state := NULL; v_cname := NULL;
    BEGIN
      UPDATE public.strategy_analytics SET unit_segments = v_val WHERE strategy_id = v_sid;
    EXCEPTION WHEN check_violation THEN
      v_raised := true;
      GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE, v_cname = CONSTRAINT_NAME;
    END;
    IF NOT v_raised OR v_state IS DISTINCT FROM '23514' OR v_cname IS DISTINCT FROM 'strategy_analytics_unit_segments_object_chk' THEN
      RAISE EXCEPTION 'TEST FAILED (3): a JSON % was not refused by strategy_analytics_unit_segments_object_chk (raised=%, sqlstate=%, constraint=%)', v_kind, v_raised, COALESCE(v_state, 'none'), COALESCE(v_cname, 'none');
    END IF;
  END LOOP;

  -- ===== ARM 4 — NULL is accepted on a row that held an object ==============
  -- RED-UNDER: install a BEFORE UPDATE trigger on strategy_analytics that
  --            refuses to set unit_segments back to NULL once it holds a value.
  --            Expressed as two live `sql` steps rather than an edit because the
  --            drift being modelled is a LATER migration tightening the column;
  --            20261127200000 carries nothing to remove. A re-derive that finds
  --            no switch would then be unable to clear a stale segment pair, and
  --            the factsheet would keep showing two units for a strategy that
  --            is back in one.
  -- RED-UNDER-M: {"arm":"4","apply":[{"kind":"sql","stmt":"CREATE FUNCTION public.zz_twin_us_keep() RETURNS trigger LANGUAGE plpgsql AS $f$ BEGIN IF NEW.unit_segments IS NULL AND OLD.unit_segments IS NOT NULL THEN RAISE EXCEPTION 'zz twin refuses NULL' USING ERRCODE = '23514'; END IF; RETURN NEW; END $f$"},{"kind":"sql","stmt":"CREATE TRIGGER zz_twin_us_keep_trigger BEFORE UPDATE ON public.strategy_analytics FOR EACH ROW EXECUTE FUNCTION public.zz_twin_us_keep()"}]}
  -- The row holds the arm-2 object here: arm 3's refused updates changed nothing.
  v_msg := NULL;
  BEGIN
    UPDATE public.strategy_analytics SET unit_segments = NULL WHERE strategy_id = v_sid;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_msg = MESSAGE_TEXT;
  END;
  IF v_msg IS NOT NULL THEN
    RAISE EXCEPTION 'TEST FAILED (4): NULL was refused on a row that held an object (%), so a re-derive that finds no switch cannot clear the stored segments', v_msg;
  END IF;
  SELECT unit_segments INTO v_readback FROM public.strategy_analytics WHERE strategy_id = v_sid;
  IF v_readback IS NOT NULL THEN
    RAISE EXCEPTION 'TEST FAILED (4): the UPDATE to NULL did not read back as NULL (got %)', v_readback;
  END IF;

  -- ===== ARM 5a — the three existing RLS policies are present ===============
  -- RED-UNDER: DROP the analytics_update_deny policy on the live lane. Without
  --            it a client role holding the table-level UPDATE privilege can
  --            write unit_segments itself, which is a write path the plan says
  --            belongs to the service role alone (T-256-05).
  -- RED-UNDER-M: {"arm":"5a","apply":[{"kind":"sql","stmt":"DROP POLICY analytics_update_deny ON public.strategy_analytics"}]}
  SELECT string_agg(p, ', ') INTO v_missing
    FROM unnest(ARRAY['analytics_read', 'analytics_insert_deny', 'analytics_update_deny']) AS p
   WHERE NOT EXISTS (
     SELECT 1 FROM pg_policies
      WHERE schemaname = 'public' AND tablename = 'strategy_analytics' AND policyname = p
   );
  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION 'TEST FAILED (5a): strategy_analytics lost RLS policy(ies) %, so the new column is no longer read and written by exactly the audience of returns_series', v_missing;
  END IF;

  -- ===== ARM 5b — no policy mentions unit_segments ==========================
  -- RED-UNDER: add a SELECT policy on strategy_analytics whose predicate names
  --            unit_segments on the live lane. That is a new access rule keyed
  --            on the column, which this migration promises not to introduce
  --            (T-256-04); a rule like that belongs in its own reviewed
  --            migration.
  -- RED-UNDER-M: {"arm":"5b","apply":[{"kind":"sql","stmt":"CREATE POLICY zz_twin_us_leak ON public.strategy_analytics FOR SELECT USING (unit_segments IS NOT NULL)"}]}
  SELECT string_agg(policyname, ', ') INTO v_leaking
    FROM pg_policies
   WHERE schemaname = 'public' AND tablename = 'strategy_analytics'
     AND (COALESCE(qual, '') || ' ' || COALESCE(with_check, '')) ILIKE '%unit_segments%';
  IF v_leaking IS NOT NULL THEN
    RAISE EXCEPTION 'TEST FAILED (5b): policy(ies) % on strategy_analytics mention unit_segments, so this migration series changed an access rule it promised to leave alone', v_leaking;
  END IF;

  -- ===== ARM 6 — anon and authenticated can read the column =================
  -- RED-UNDER: REVOKE SELECT on strategy_analytics from anon (table level,
  --            because has_column_privilege also reads table-level grants). The
  --            public factsheet payload reads the column as anon and every one
  --            answers a permission error instead of the row.
  -- RED-UNDER-M: {"arm":"6","apply":[{"kind":"sql","stmt":"REVOKE SELECT ON public.strategy_analytics FROM anon"}]}
  IF NOT has_column_privilege('anon', 'public.strategy_analytics', 'unit_segments', 'SELECT')
     OR NOT has_column_privilege('authenticated', 'public.strategy_analytics', 'unit_segments', 'SELECT') THEN
    RAISE EXCEPTION 'TEST FAILED (6): anon and/or authenticated cannot SELECT unit_segments, so the factsheet payload cannot read it (anon=%, authenticated=%)',
      has_column_privilege('anon', 'public.strategy_analytics', 'unit_segments', 'SELECT'),
      has_column_privilege('authenticated', 'public.strategy_analytics', 'unit_segments', 'SELECT');
  END IF;
END $$;

ROLLBACK;
