-- Test: strategy_analytics.trades_fetched_at and strategy_analytics.series_provenance
-- (Phase 167.1.2.2.2 TRADESYNC, plan 02). Guards migration
-- 20261010130000_strategy_analytics_trade_fetch_provenance.sql.
--
-- Background
-- ----------
-- trades_fetched_at is the instant of the last successful trade fetch (single
-- writer: the cron tick), and series_provenance is the range-level record of
-- carried-forward points and named unrecovered gaps. Both are read by public
-- projections, so this gate pins the SHAPE of the carriers and the properties a
-- reader depends on, and nothing about row contents: workers legitimately
-- populate values after deploy, so any assertion on data would be a time bomb.
--
-- Arms (LISTED and EXECUTED in this order; the order is LOAD-BEARING because
-- arms 4 and 5 share the one stand-in row that the 4-SETUP block seeds):
--   0  both columns exist; absence is an EXCEPTION, never a skip.
--   1  types are exactly `timestamp with time zone` and `jsonb`.
--   2  both are NULLABLE. NULL is the honest value for every existing row, and
--      a NOT NULL is a 23502 timebomb against every writer that upserts the row
--      without the column.
--   3  neither has a DEFAULT. A default would stamp a fetch instant or a
--      provenance claim on rows nobody observed.
--   4  the CHECK rejects a JSON array and a JSON string, and admits an object and
--      NULL. The reader validates the arrays; the database enforces object-ness.
--   5  trigger non-interference: a single-column UPDATE of trades_fetched_at
--      leaves every OTHER column of the row equal. The cron stamps this column
--      on every tick, so a BEFORE UPDATE trigger that reacted to it (for example
--      by rewriting computation_status) would corrupt strategy state daily.
--   6  anon can SELECT both columns, so the public projections can read them.
--
-- ⚠️ WHAT ARM 5 MEASURES, per lane. On the pg-lane (scripts/pg-lane) the table
-- is the 03-fixture stand-in, which carries NO trigger: there arm 5 measures the
-- stand-in, and its twin installs the trigger the arm must catch. The two REAL
-- BEFORE UPDATE triggers on the table (strategy_analytics_drop_stale_error_provenance_trigger
-- and strategy_analytics_stamp_computing_started_trigger, supabase/schema/baseline.sql)
-- are exercised by the SAME arm when `sql-tests` runs this file on the
-- local-stack lane, which loads the baseline. The stand-in proves the arm can
-- fail; the baseline proves the real triggers stay quiet.
--
-- ⚠️ WHAT ARM 6 MEASURES. has_column_privilege also reads TABLE-level grants, so
-- its twin revokes at table level. The grants come from fixture 07 (Supabase's
-- default privileges) on the pg-lane and from the bootstrap on the baseline.
--
-- ANTI-GREEN-SKIP CONTRACT. Absence of either column is an EXCEPTION. A gate
-- that green-skips when the object under test is absent is not evidence, and
-- merging supabase/migrations/** applies to PRODUCTION, so nothing in the merge
-- path would make a missing column appear. Do not add a presence skip.
--
-- Every identity carries a digit (`4-SETUP`, never a bare letter). The runner's
-- `sectionOfIdentity` collapses a trailing `-SUFFIX` into its parent only when a
-- digit precedes it, so `4-SETUP` and `5-WROTE` are sub-arms covered by their
-- parent's twin. They are vacuity guards ("the fixture reached the state this
-- arm is about"), not claims about the migration.
--
-- pgTAP is NOT installed (CLAUDE.md). Plain PL/pgSQL DO block, RAISE EXCEPTION on
-- failure. No psql meta-commands. The whole test rolls back.
--
-- ⭐ RED-UNDER ANNOTATIONS. Each assertion below carries a prose `RED-UNDER:`
-- and a machine-readable `RED-UNDER-M:` twin the mutation runner applies on a
-- throwaway pg-lane cluster to PROVE the arm reds on its own, then restores
-- GREEN. Schema: scripts/mutation-runner/GRAMMAR.md.
-- ⚠️ Three twins (1, 2, 3) are LAYERED: the migration re-asserts type,
-- nullability and default-absence in its own apply-time DO block, so mutating
-- the shape aborts the APPLY before this gate can speak. The extra step removes
-- only the matching verify term. That duplication is the point of the file: a
-- migration DO block runs once, this runs on every CI build.
-- RED-UNDER-SETUP: {"apply":["scripts/pg-lane/fixtures/01-fixture-core.sql","scripts/pg-lane/fixtures/07-fixture-supabase-default-privileges.sql","scripts/pg-lane/fixtures/02-fixture-sanitize-tables.sql","scripts/pg-lane/fixtures/03-fixture-compute-jobs.sql","scripts/pg-lane/fixtures/10-fixture-strategies-rls-baseline.sql","supabase/migrations/20260405061912_rls_policies.sql","supabase/migrations/20261010130000_strategy_analytics_trade_fetch_provenance.sql"]}

BEGIN;

DO $$
DECLARE
  v_type_t   TEXT;
  v_type_s   TEXT;
  v_null_t   TEXT;
  v_null_s   TEXT;
  v_def_t    TEXT;
  v_def_s    TEXT;
  v_user     UUID := gen_random_uuid();
  v_sid      UUID;
  v_raised   BOOLEAN;
  v_cname    TEXT;
  v_msg      TEXT;
  v_before   JSONB;
  v_after    JSONB;
  v_diff     TEXT;
  v_stamped  TIMESTAMPTZ;
BEGIN
  -- ===== ARM 0 — both columns exist. ABSENCE IS A FAILURE, NOT A SKIP ======
  SELECT data_type, is_nullable, column_default
    INTO v_type_t, v_null_t, v_def_t
    FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'strategy_analytics'
     AND column_name = 'trades_fetched_at';
  SELECT data_type, is_nullable, column_default
    INTO v_type_s, v_null_s, v_def_s
    FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'strategy_analytics'
     AND column_name = 'series_provenance';

  -- RED-UNDER: drop trades_fetched_at on the live lane AFTER the apply list has
  --            run, so the gate meets a database on which the column migration
  --            is not in force. ⚠️ A `sql` step and NOT an `edit` that renames
  --            the column: the migration's own verify block asserts presence and
  --            would RAISE, aborting the apply, so no arm could be the FIRST
  --            failure and the runner would score a defect, not a bite.
  -- RED-UNDER-M: {"arm":"0","apply":[{"kind":"sql","stmt":"ALTER TABLE public.strategy_analytics DROP COLUMN trades_fetched_at"}]}
  IF v_type_t IS NULL OR v_type_s IS NULL THEN
    RAISE EXCEPTION 'TEST FAILED (0): strategy_analytics is missing trades_fetched_at and/or series_provenance (found: trades_fetched_at=%, series_provenance=%). The column migration 20261010130000 is not in force on this database; apply it and re-run (expect this once on the PR that introduces it, because this repo applies migrations on MERGE and not on PR). ⛔ Do NOT turn this into a RAISE NOTICE skip.', COALESCE(v_type_t, 'ABSENT'), COALESCE(v_type_s, 'ABSENT');
  END IF;

  -- ===== ARM 1 — types ======================================================
  -- RED-UNDER: narrow trades_fetched_at to `timestamp` (no zone) in the ADD
  --            COLUMN of 20261010130000. Every instant the cron stamps is then
  --            read back as a wall-clock value in the SESSION zone, and the
  --            freshness line the public pages render shifts by the offset.
  --            LAYERED: the migration reads the type back too, because
  --            `ADD COLUMN IF NOT EXISTS` no-ops on a pre-existing column of any
  --            type, so the second step removes that term only.
  -- RED-UNDER-M: {"arm":"1","apply":[{"kind":"edit","file":"supabase/migrations/20261010130000_strategy_analytics_trade_fetch_provenance.sql","find":"ADD COLUMN IF NOT EXISTS trades_fetched_at timestamptz NULL,","replace":"ADD COLUMN IF NOT EXISTS trades_fetched_at timestamp NULL,","occurrences":1},{"kind":"edit","file":"supabase/migrations/20261010130000_strategy_analytics_trade_fetch_provenance.sql","find":"AND ((c.column_name = 'trades_fetched_at' AND c.data_type <> 'timestamp with time zone')","replace":"AND ((c.column_name = 'trades_fetched_at' AND FALSE)","occurrences":1}]}
  IF v_type_t <> 'timestamp with time zone' OR v_type_s <> 'jsonb' THEN
    RAISE EXCEPTION 'TEST FAILED (1): column types must be timestamp with time zone (trades_fetched_at) and jsonb (series_provenance), got % and %', v_type_t, v_type_s;
  END IF;

  -- ===== ARM 2 — nullable ===================================================
  -- RED-UNDER: add `NOT NULL` to trades_fetched_at in 20261010130000 (with no
  --            default, so arm 3 stays green and this arm is the only one that
  --            moves). Every existing writer that upserts strategy_analytics
  --            without the column then fails 23502 on a live money path, and
  --            NULL is the honest value for a strategy that was never fetched.
  --            LAYERED: the migration asserts nullability too.
  -- RED-UNDER-M: {"arm":"2","apply":[{"kind":"edit","file":"supabase/migrations/20261010130000_strategy_analytics_trade_fetch_provenance.sql","find":"ADD COLUMN IF NOT EXISTS trades_fetched_at timestamptz NULL,","replace":"ADD COLUMN IF NOT EXISTS trades_fetched_at timestamptz NOT NULL,","occurrences":1},{"kind":"edit","file":"supabase/migrations/20261010130000_strategy_analytics_trade_fetch_provenance.sql","find":"AND c.is_nullable <> 'YES';","replace":"AND FALSE;","occurrences":1}]}
  IF v_null_t <> 'YES' OR v_null_s <> 'YES' THEN
    RAISE EXCEPTION 'TEST FAILED (2): both columns must be NULLABLE, got is_nullable trades_fetched_at=%, series_provenance=%. A NOT NULL is a 23502 timebomb against every writer that upserts strategy_analytics without the column, and NULL is the honest value for a strategy never fetched', v_null_t, v_null_s;
  END IF;

  -- ===== ARM 3 — no default =================================================
  -- RED-UNDER: give trades_fetched_at a `DEFAULT now()` in 20261010130000. Every
  --            row created afterwards would claim a trade fetch that never
  --            happened, which is worse than a wrong value: it reads as a
  --            deliberate, fresh one. The column stays nullable and timestamptz,
  --            so arms 1 and 2 are untouched.
  --            LAYERED: the migration asserts default-absence too.
  -- RED-UNDER-M: {"arm":"3","apply":[{"kind":"edit","file":"supabase/migrations/20261010130000_strategy_analytics_trade_fetch_provenance.sql","find":"ADD COLUMN IF NOT EXISTS trades_fetched_at timestamptz NULL,","replace":"ADD COLUMN IF NOT EXISTS trades_fetched_at timestamptz NULL DEFAULT now(),","occurrences":1},{"kind":"edit","file":"supabase/migrations/20261010130000_strategy_analytics_trade_fetch_provenance.sql","find":"AND c.column_default IS NOT NULL;","replace":"AND FALSE;","occurrences":1}]}
  IF v_def_t IS NOT NULL OR v_def_s IS NOT NULL THEN
    RAISE EXCEPTION 'TEST FAILED (3): neither column may carry a DEFAULT, got trades_fetched_at=%, series_provenance=%. A default stamps a fetch instant or a provenance claim on rows nobody observed', COALESCE(v_def_t, 'none'), COALESCE(v_def_s, 'none');
  END IF;

  -- ----- 4-SETUP: one strategy_analytics row, through the FK chain ----------
  -- strategy_analytics.strategy_id -> strategies.id -> profiles.id -> auth.users.id
  -- on the baseline; the pg-lane stand-in carries the chain too, so the same
  -- inserts run on both. Only computation_status is set beyond the key.
  INSERT INTO auth.users (id, email)
    VALUES (v_user, 'sa-tfp-arms-' || v_user || '@invalid.local');
  INSERT INTO public.profiles (id, display_name)
    VALUES (v_user, 'sa-tfp-arms') ON CONFLICT (id) DO NOTHING;
  INSERT INTO public.strategies (user_id, name)
    VALUES (v_user, 'sa-tfp-arm-4') RETURNING id INTO v_sid;
  INSERT INTO public.strategy_analytics (strategy_id, computation_status)
    VALUES (v_sid, 'complete');
  IF NOT EXISTS (SELECT 1 FROM public.strategy_analytics WHERE strategy_id = v_sid) THEN
    RAISE EXCEPTION 'TEST FAILED (4-SETUP): the stand-in strategy_analytics row was not created, so arms 4 and 5 below would be asking about a row that does not exist.';
  END IF;

  -- ===== ARM 4 — series_provenance must be a JSON object or NULL ============
  -- RED-UNDER: weaken the CHECK in 20261010130000 to `CHECK (true)` (the name
  --            stays, so the verify block's by-name presence term does not
  --            move). A runbook typo then stores a JSON array or string, and the
  --            reader (plan 10), which expects an object with named arrays, would
  --            read a malformed value that the database had vouched for.
  -- RED-UNDER-M: {"arm":"4","apply":[{"kind":"edit","file":"supabase/migrations/20261010130000_strategy_analytics_trade_fetch_provenance.sql","find":"CHECK (series_provenance IS NULL OR jsonb_typeof(series_provenance) = 'object');","replace":"CHECK (true);","occurrences":1}]}
  -- (a) a JSON array is refused, by the named constraint.
  v_raised := false; v_cname := NULL;
  BEGIN
    UPDATE public.strategy_analytics SET series_provenance = '[]'::jsonb WHERE strategy_id = v_sid;
  EXCEPTION WHEN check_violation THEN
    v_raised := true;
    GET STACKED DIAGNOSTICS v_cname = CONSTRAINT_NAME;
  END;
  IF NOT v_raised OR v_cname IS DISTINCT FROM 'strategy_analytics_series_provenance_is_object' THEN
    RAISE EXCEPTION 'TEST FAILED (4): a JSON array was not refused by strategy_analytics_series_provenance_is_object (raised=%, constraint=%)', v_raised, COALESCE(v_cname, 'none');
  END IF;
  -- (b) a JSON string is refused, by the named constraint.
  v_raised := false; v_cname := NULL;
  BEGIN
    UPDATE public.strategy_analytics SET series_provenance = '"x"'::jsonb WHERE strategy_id = v_sid;
  EXCEPTION WHEN check_violation THEN
    v_raised := true;
    GET STACKED DIAGNOSTICS v_cname = CONSTRAINT_NAME;
  END;
  IF NOT v_raised OR v_cname IS DISTINCT FROM 'strategy_analytics_series_provenance_is_object' THEN
    RAISE EXCEPTION 'TEST FAILED (4): a JSON string was not refused by strategy_analytics_series_provenance_is_object (raised=%, constraint=%)', v_raised, COALESCE(v_cname, 'none');
  END IF;
  -- (c) an object and NULL are admitted. Anything else would make the CHECK a
  --     refusal of the documented shape rather than a guard against a malformed one.
  v_msg := NULL;
  BEGIN
    UPDATE public.strategy_analytics SET series_provenance = '{}'::jsonb WHERE strategy_id = v_sid;
    UPDATE public.strategy_analytics
       SET series_provenance = '{"unrecovered_gaps":[{"from":"2026-01-01","to":"2026-01-03","recorded_at":"2026-10-10T00:00:00Z"}]}'::jsonb
     WHERE strategy_id = v_sid;
    UPDATE public.strategy_analytics SET series_provenance = NULL WHERE strategy_id = v_sid;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_msg = MESSAGE_TEXT;
  END;
  IF v_msg IS NOT NULL THEN
    RAISE EXCEPTION 'TEST FAILED (4): an object or NULL was refused (%), so the CHECK rejects the documented shape', v_msg;
  END IF;

  -- ===== ARM 5 — a trades_fetched_at-only UPDATE moves no other column ======
  -- RED-UNDER: install a BEFORE UPDATE trigger on strategy_analytics that
  --            rewrites computation_status whenever trades_fetched_at changes.
  --            Expressed as two live `sql` steps rather than an edit because the
  --            drift being modelled is a LATER migration adding such a trigger;
  --            20261010130000 carries none to remove. The cron stamps this
  --            column on every tick, so such a trigger would move strategy state
  --            on every tick.
  -- RED-UNDER-M: {"arm":"5","apply":[{"kind":"sql","stmt":"CREATE FUNCTION public.zz_twin_tfp_react() RETURNS trigger LANGUAGE plpgsql AS $f$ BEGIN IF NEW.trades_fetched_at IS DISTINCT FROM OLD.trades_fetched_at THEN NEW.computation_status := 'twin-moved'; END IF; RETURN NEW; END $f$"},{"kind":"sql","stmt":"CREATE TRIGGER zz_twin_tfp_react_trigger BEFORE UPDATE ON public.strategy_analytics FOR EACH ROW EXECUTE FUNCTION public.zz_twin_tfp_react()"}]}
  SELECT to_jsonb(sa) - 'trades_fetched_at' INTO v_before
    FROM public.strategy_analytics sa WHERE sa.strategy_id = v_sid;
  UPDATE public.strategy_analytics SET trades_fetched_at = now() WHERE strategy_id = v_sid;
  SELECT to_jsonb(sa) - 'trades_fetched_at', sa.trades_fetched_at INTO v_after, v_stamped
    FROM public.strategy_analytics sa WHERE sa.strategy_id = v_sid;
  IF v_stamped IS NULL THEN
    RAISE EXCEPTION 'TEST FAILED (5-WROTE): the single-column UPDATE left trades_fetched_at NULL, so arm 5 would compare two rows that were never written.';
  END IF;
  IF v_before IS DISTINCT FROM v_after THEN
    SELECT string_agg(k, ', ') INTO v_diff
      FROM jsonb_object_keys(v_before) AS k
     WHERE v_before -> k IS DISTINCT FROM v_after -> k;
    RAISE EXCEPTION 'TEST FAILED (5): an UPDATE of trades_fetched_at alone changed other column(s): %. A BEFORE UPDATE trigger reacts to the cron stamp and would move strategy state on every tick', v_diff;
  END IF;

  -- ===== ARM 6 — anon can read both columns =================================
  -- RED-UNDER: REVOKE SELECT on strategy_analytics from anon (table level,
  --            because has_column_privilege also reads table-level grants). The
  --            public projections then read the freshness and provenance columns
  --            as anon and every one answers a permission error instead of the
  --            row.
  -- RED-UNDER-M: {"arm":"6","apply":[{"kind":"sql","stmt":"REVOKE SELECT ON public.strategy_analytics FROM anon"}]}
  IF NOT has_column_privilege('anon', 'public.strategy_analytics', 'trades_fetched_at', 'SELECT')
     OR NOT has_column_privilege('anon', 'public.strategy_analytics', 'series_provenance', 'SELECT') THEN
    RAISE EXCEPTION 'TEST FAILED (6): anon cannot SELECT trades_fetched_at and/or series_provenance, so the public projections cannot read them (trades_fetched_at=%, series_provenance=%)',
      has_column_privilege('anon', 'public.strategy_analytics', 'trades_fetched_at', 'SELECT'),
      has_column_privilege('anon', 'public.strategy_analytics', 'series_provenance', 'SELECT');
  END IF;
END $$;

ROLLBACK;
