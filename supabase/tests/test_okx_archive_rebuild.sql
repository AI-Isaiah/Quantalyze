-- Test: the okx_archive_rebuild job kind and public.apply_okx_archive_rebuild
-- (Phase 167.1.2.2.2.1 OKXHISTORY, plan 01). Guards migration
-- 20261026120000_okx_archive_rebuild.sql.
--
-- ANTI-GREEN-SKIP CONTRACT. Absence of the kind, of the function or of any
-- constraint arm is an EXCEPTION, never a skip. Merging supabase/migrations/**
-- applies to PRODUCTION with no human stop, so nothing in the merge path would
-- make a missing object appear. Do not add a presence skip.
--
-- (tracer state: arms 0 and 6 only; the rest of the roster lands with the next
-- commit of this plan.)
--
-- Every identity carries a digit. pgTAP is NOT installed (CLAUDE.md): plain
-- PL/pgSQL DO block, RAISE EXCEPTION on failure, no psql meta-commands, the whole
-- test rolls back.
--
-- ⭐ RED-UNDER ANNOTATIONS. Each assertion carries a prose `RED-UNDER:` and a
-- machine-readable `RED-UNDER-M:` twin the mutation runner applies on a throwaway
-- pg-lane cluster to PROVE the arm reds on its own. Schema:
-- scripts/mutation-runner/GRAMMAR.md.
-- RED-UNDER-SETUP: {"apply":["scripts/pg-lane/fixtures/01-fixture-core.sql","scripts/pg-lane/fixtures/07-fixture-supabase-default-privileges.sql","scripts/pg-lane/fixtures/02-fixture-sanitize-tables.sql","scripts/pg-lane/fixtures/03-fixture-compute-jobs.sql","scripts/pg-lane/fixtures/10-fixture-strategies-rls-baseline.sql","supabase/migrations/20260405061912_rls_policies.sql","scripts/pg-lane/fixtures/11-fixture-api-keys-created-at.sql","scripts/pg-lane/fixtures/15-fixture-auth-role.sql","scripts/pg-lane/fixtures/20-fixture-app-role-helper.sql","scripts/pg-lane/fixtures/21-fixture-api-keys-credential-columns.sql","scripts/pg-lane/fixtures/24-fixture-enqueue-compute-job-chain.sql","scripts/pg-lane/fixtures/12-fixture-profiles-is-admin.sql","scripts/pg-lane/fixtures/13-fixture-csv-finalize-fold.sql","supabase/migrations/20260513094906_enable_pg_cron.sql","supabase/migrations/20260411144407_compute_jobs_queue.sql","scripts/pg-lane/fixtures/04-fixture-compute-jobs-targets.sql","supabase/migrations/20260418194206_scoring_weight_overrides.sql","supabase/migrations/20260420073003_allocator_holdings.sql","supabase/migrations/20260614120000_derive_broker_dailies_kind.sql","supabase/migrations/20260717233529_allocator_equity_derived_surface.sql","supabase/migrations/20260522111839_csv_daily_returns.sql","supabase/migrations/20260624120000_csv_daily_returns_per_key_axis.sql","supabase/migrations/20261010130000_strategy_analytics_trade_fetch_provenance.sql","supabase/migrations/20261026120000_okx_archive_rebuild.sql"]}

BEGIN;

-- Seeds one strategy with a strategy_analytics row carrying the given
-- series_provenance, through the FK chain strategy_analytics.strategy_id ->
-- strategies.id -> profiles.id -> auth.users.id. A pg_temp function: it lives
-- and dies with this transaction, and it carries no arm.
CREATE FUNCTION pg_temp.okx_seed_strategy(p_prov jsonb) RETURNS uuid
LANGUAGE plpgsql AS $f$
DECLARE
  v_user uuid := gen_random_uuid();
  v_sid  uuid;
BEGIN
  INSERT INTO auth.users (id, email) VALUES (v_user, 'okx-arch-' || v_user || '@invalid.local');
  INSERT INTO public.profiles (id, display_name) VALUES (v_user, 'okx-arch') ON CONFLICT (id) DO NOTHING;
  INSERT INTO public.strategies (user_id, name) VALUES (v_user, 'okx-arch') RETURNING id INTO v_sid;
  INSERT INTO public.strategy_analytics (strategy_id, computation_status, series_provenance)
    VALUES (v_sid, 'complete', p_prov);
  RETURN v_sid;
END
$f$;

DO $$
DECLARE
  v_user       uuid := gen_random_uuid();
  v_key        uuid;
  v_sid        uuid;
  v_raised     boolean;
  v_constraint text;
  v_fk_refused boolean := false;
  v_res        jsonb;
  v_prov       jsonb;
  v_n          integer;
  v_ret        double precision;
BEGIN
  -- ----- SEED for the kind arms: one user, one api_key ----------------------
  INSERT INTO auth.users (id, instance_id, email, created_at, updated_at)
  VALUES (v_user, '00000000-0000-0000-0000-000000000000',
          'okx-arch-kind-' || v_user::text || '@invalid.local', now(), now());
  INSERT INTO public.profiles (id, display_name, email, role)
  VALUES (v_user, 'okx-arch-kind', 'okx-arch-kind-' || v_user::text || '@invalid.local', 'allocator')
  ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role;
  INSERT INTO public.api_keys (user_id, exchange, label, api_key_encrypted, is_active)
  VALUES (v_user, 'okx', 'okx-arch-kind', 'x', TRUE) RETURNING id INTO v_key;

  -- ===== ARM 0 — the kind is admitted with an api_key target ONLY ===========
  -- ⚠️ A foreign_key_violation here is NOT this arm's failure: it means the
  --    compute_job_kinds registry row is absent, which arm 4 owns. It is
  --    remembered and handed to arm 4, so a missing registry row is attributed
  --    to the arm that names it instead of to this one.
  -- RED-UNDER: re-add compute_jobs_kind_check with the previous 16-kind list on
  --            the live lane, after the apply. okx_archive_rebuild is then
  --            refused at write time with a check_violation, so the operator's
  --            enqueue of the rebuild job fails with an error naming a
  --            constraint, and no archive rebuild can ever be queued.
  --            A `sql` step and NOT an edit of the migration: the migration's own
  --            verify block asserts the kind is in the CHECK text and would
  --            ABORT the apply, so no arm could be the first failure.
  -- RED-UNDER-M: {"arm":"0","apply":[{"kind":"sql","stmt":"ALTER TABLE public.compute_jobs DROP CONSTRAINT compute_jobs_kind_check, ADD CONSTRAINT compute_jobs_kind_check CHECK (kind = ANY (ARRAY['sync_trades'::text, 'compute_analytics'::text, 'compute_portfolio'::text, 'poll_positions'::text, 'sync_funding'::text, 'reconcile_strategy'::text, 'compute_intro_snapshot'::text, 'rescore_allocator'::text, 'poll_allocator_positions'::text, 'reconstruct_allocator_history'::text, 'refresh_allocator_equity_daily'::text, 'process_key_long'::text, 'compute_analytics_from_csv'::text, 'derive_broker_dailies'::text, 'stitch_composite'::text, 'derive_allocator_equity'::text]))"}]}
  v_raised := false; v_constraint := NULL;
  BEGIN
    INSERT INTO public.compute_jobs (api_key_id, kind) VALUES (v_key, 'okx_archive_rebuild');
  EXCEPTION
    WHEN check_violation THEN
      v_raised := true;
      GET STACKED DIAGNOSTICS v_constraint = CONSTRAINT_NAME;
    WHEN foreign_key_violation THEN
      v_fk_refused := true;
  END;
  IF v_raised THEN
    RAISE EXCEPTION 'TEST FAILED (0): okx_archive_rebuild with an api_key_id-only target was REFUSED by constraint % - the kind is not admitted, so the archive rebuild job can never be enqueued', COALESCE(v_constraint, 'unknown');
  END IF;
  IF NOT v_fk_refused AND NOT EXISTS (
    SELECT 1 FROM public.compute_jobs WHERE api_key_id = v_key AND kind = 'okx_archive_rebuild'
  ) THEN
    RAISE EXCEPTION 'TEST FAILED (0): the okx_archive_rebuild job was not stored, so arm 0 would be asking about a row that does not exist';
  END IF;

  -- ===== ARM 6 — one call lands the rows AND the provenance together ========
  -- A strategy with ONE stored gap of 5 days (2026-05-07..2026-05-11) and a
  -- carried-forward legacy range. A call with THREE rows inside it, run as
  -- service_role (the one real caller: SECURITY INVOKER means the role's own
  -- table grants are what the function runs on), must return `applied`, insert
  -- exactly those three rows, narrow the gap to the two uncovered days and append
  -- ONE reconstructed range carrying the pinned source.
  -- RED-UNDER: remove the reconstructed_ranges append from the function in
  --            20261026120000. The three rows are then counted in headline
  --            metrics with NO public disclosure that they were rebuilt, which is
  --            the integrity defect this function exists to make impossible. The
  --            migration's verify block reads the catalogue only and never runs
  --            the body, so the edited function applies clean.
  -- RED-UNDER-M: {"arm":"6","apply":[{"kind":"edit","file":"supabase/migrations/20261026120000_okx_archive_rebuild.sql","find":"v_sp := jsonb_set(v_sp, '{reconstructed_ranges}', v_old_ranges || v_new_ranges, true);","replace":"NULL;","occurrences":1}]}
  v_sid := pg_temp.okx_seed_strategy('{"legacy_ranges":[{"from":"2026-02-23","to":"2026-05-06","source":"returns_grid_carry_forward","recorded_at":"2026-10-10T00:00:00Z"}],"unrecovered_gaps":[{"from":"2026-05-07","to":"2026-05-11","recorded_at":"2026-10-10T00:00:00Z"}]}'::jsonb);
  SELECT count(*) INTO v_n FROM public.csv_daily_returns WHERE strategy_id = v_sid;
  IF v_n <> 0 THEN
    RAISE EXCEPTION 'TEST FAILED (6-SETUP): the seeded strategy already carries % csv_daily_returns rows, so arm 6 would not be starting from an empty series', v_n;
  END IF;
  SET LOCAL ROLE service_role;
  v_res := public.apply_okx_archive_rebuild(
    v_sid,
    '[{"date":"2026-05-07","daily_return":0.01},{"date":"2026-05-08","daily_return":-0.02},{"date":"2026-05-09","daily_return":0.005}]'::jsonb,
    '[{"from":"2026-05-07","to":"2026-05-11"}]'::jsonb,
    '[{"from":"2026-05-10","to":"2026-05-11"}]'::jsonb);
  RESET ROLE;
  IF v_res ->> 'status' IS DISTINCT FROM 'applied'
     OR (v_res ->> 'inserted')::integer IS DISTINCT FROM 3
     OR (v_res ->> 'ranges_added')::integer IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION 'TEST FAILED (6): the call returned % instead of status applied, inserted 3, ranges_added 1', v_res::text;
  END IF;
  SELECT count(*) INTO v_n FROM public.csv_daily_returns WHERE strategy_id = v_sid;
  IF v_n <> 3 THEN
    RAISE EXCEPTION 'TEST FAILED (6): % rows were stored for the strategy, expected exactly the 3 sent', v_n;
  END IF;
  SELECT daily_return INTO v_ret FROM public.csv_daily_returns
   WHERE strategy_id = v_sid AND date = DATE '2026-05-08';
  IF v_ret IS DISTINCT FROM -0.02::double precision THEN
    RAISE EXCEPTION 'TEST FAILED (6): the stored daily_return for 2026-05-08 is %, expected -0.02', v_ret;
  END IF;
  SELECT series_provenance INTO v_prov FROM public.strategy_analytics WHERE strategy_id = v_sid;
  IF v_prov -> 'unrecovered_gaps' IS DISTINCT FROM
     '[{"from":"2026-05-10","to":"2026-05-11","recorded_at":"2026-10-10T00:00:00Z"}]'::jsonb THEN
    RAISE EXCEPTION 'TEST FAILED (6): unrecovered_gaps is % after the call, expected exactly the 2 uncovered days 2026-05-10..2026-05-11', COALESCE((v_prov -> 'unrecovered_gaps')::text, 'NULL');
  END IF;
  IF jsonb_typeof(v_prov -> 'reconstructed_ranges') IS DISTINCT FROM 'array'
     OR jsonb_array_length(v_prov -> 'reconstructed_ranges') <> 1
     OR v_prov -> 'reconstructed_ranges' -> 0 ->> 'from' IS DISTINCT FROM '2026-05-07'
     OR v_prov -> 'reconstructed_ranges' -> 0 ->> 'to' IS DISTINCT FROM '2026-05-09'
     OR v_prov -> 'reconstructed_ranges' -> 0 ->> 'source' IS DISTINCT FROM 'okx_bills_history_archive'
     OR NOT COALESCE(v_prov -> 'reconstructed_ranges' -> 0 ->> 'recorded_at' ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$', false) THEN
    RAISE EXCEPTION 'TEST FAILED (6): reconstructed_ranges is %, expected one range 2026-05-07..2026-05-09 with source okx_bills_history_archive and an ISO recorded_at', COALESCE((v_prov -> 'reconstructed_ranges')::text, 'NULL');
  END IF;
END $$;

ROLLBACK;
