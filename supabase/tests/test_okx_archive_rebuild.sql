-- Test: the okx_archive_rebuild job kind and public.apply_okx_archive_rebuild
-- (Phase 167.1.2.2.2.1 OKXHISTORY, plan 01). Guards migration
-- 20261026120000_okx_archive_rebuild.sql.
--
-- Background
-- ----------
-- The rebuilt OKX days COUNT in headline metrics (D-07), so a rebuilt row without
-- its public disclosure would be an integrity defect. One function inserts the
-- rows, narrows strategy_analytics.series_provenance.unrecovered_gaps and appends
-- reconstructed_ranges in ONE transaction, and the job that waits hours for the
-- archive is api_key-scoped so it never flips a published strategy to
-- `computing`. This gate pins both, and pins that each refusal can fail.
--
-- Arms (LISTED and EXECUTED in this order; the order is LOAD-BEARING because arm 5
-- reuses the job arm 0 inserted and arm 9 reuses the strategy arm 6 rebuilt):
--   0  the kind is admitted with an api_key_id-only target.
--   1  a strategy-scoped insert of the kind is refused by
--      compute_jobs_kind_target_coherence (SC-1).
--   2  derive_broker_dailies with only api_key_id still inserts (re-base regression).
--   3  derive_allocator_equity with only allocator_id still inserts (re-base regression).
--   4  the compute_job_kinds registry row exists and the compute_jobs.kind FK admits it.
--   5  a second in-flight job of the kind for one api_key is refused (unique_violation).
--   6  one call lands the rows AND the provenance together (SC-2, D-05), run as
--      service_role, the one real caller.
--   7  a row outside every stored gap raises 22023 row_outside_gap and writes
--      nothing (D-01, D-11); 7-SHAPE pins the malformed-input refusals.
--   8  a p_expected_gaps that differs from the stored gaps raises P0001
--      gaps_changed and writes nothing (compare-and-set).
--   9  repeating arm 6's call returns already_applied and inserts nothing.
--   10 legacy_ranges and an unrelated provenance key survive the call; 10-RANGES
--      pins that a malformed stored reconstructed_ranges is refused, not overwritten.
--   11 a row already present inside the gap keeps its value, its day is excluded
--      from the appended ranges and from the gap (D-12).
--   12 anon and authenticated cannot EXECUTE; service_role can; 12-INVOKER pins
--      SECURITY INVOKER with a pinned search_path.
--   13 the call changes no strategy_analytics column other than series_provenance.
--   14 a gap spanning two quarters with rows only for the later part leaves the
--      earlier part named, with no row and no 0.0 in it (SC-4); a wrong
--      p_expected_gaps_after raises P0001 gaps_after_mismatch and rolls the INSERT
--      back (D-11).
--
-- ANTI-GREEN-SKIP CONTRACT. Absence of the kind, of the function or of any
-- constraint arm is an EXCEPTION, never a skip. Merging supabase/migrations/**
-- applies to PRODUCTION with no human stop, so nothing in the merge path would
-- make a missing object appear. Do not add a presence skip.
--
-- SENTINEL. The final `ALL 15 ARMS EXECUTED (…)` notice at the foot of this file,
-- before ROLLBACK, joins ci.yml's `sql-tests` sentinel census
-- (SENTINEL_FLOOR +1, ARMS_FLOOR +15). That census is moved by plan 09 of this
-- phase, not here.
--
-- ⚠️ WHAT ARMS 6, 9-11, 13 AND 14 RUN AS. Every call to the function is made
-- under SET LOCAL ROLE service_role, the role the analytics worker really uses,
-- because the function is SECURITY INVOKER: its writes run on that role's own
-- table grants. A gate that called it as the superuser would not notice a missing
-- grant. The pg-lane gives service_role BYPASSRLS and the table grants through
-- scripts/pg-lane/fixtures/07 (which is why it precedes the table-creating
-- fixtures in the apply list); the local-stack lane gets both from the baseline.
--
-- ⚠️ ARM 13 compares to_jsonb(row) minus series_provenance, so it measures every
-- column the table has on the lane it runs on: the 03-fixture stand-in on the
-- pg-lane, the real table (with its three BEFORE UPDATE triggers) on the
-- local-stack lane. Its twin installs a trigger on the stand-in; the baseline
-- proves the real triggers stay quiet.
--
-- ⚠️ ARM 4 IS ATTRIBUTED, NOT ASSUMED. Arm 0 inserts a job of the kind, and a
-- missing registry row would fail that insert with a foreign_key_violation. A raw
-- FK error would abort psql before any arm could name itself, so arm 0 REMEMBERS
-- a foreign_key_violation and hands it to arm 4, which owns the registry.
--
-- Every identity carries a digit (`6-SETUP`, never a bare letter). The runner's
-- `sectionOfIdentity` collapses a trailing `-SUFFIX` into its parent only when a
-- digit precedes it, so `6-SETUP`, `7-SHAPE`, `10-RANGES` and `12-INVOKER` are
-- sub-arms covered by their parent's twin.
--
-- pgTAP is NOT installed (CLAUDE.md). Plain PL/pgSQL DO block, RAISE EXCEPTION on
-- failure, no psql meta-commands. The whole test rolls back. Seed data is
-- synthetic: generated uuids and invented 2026 dates.
--
-- ⭐ RED-UNDER ANNOTATIONS. Each assertion below carries a prose `RED-UNDER:` and
-- a machine-readable `RED-UNDER-M:` twin the mutation runner applies on a
-- throwaway pg-lane cluster to PROVE the arm reds on its own, then restores GREEN.
-- Schema: scripts/mutation-runner/GRAMMAR.md. Every twin that edits the migration
-- changes a function BODY (which the migration's catalogue-only verify block
-- never runs) or a conjunct the verify block checks only by position, so the
-- mutated migration applies clean and the gate, not the apply, is what speaks.
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
  v_sid6       uuid;
  v_sidb       uuid;
  v_raised     boolean;
  v_constraint text;
  v_fk_refused boolean := false;
  v_state      text;
  v_msg        text;
  v_res        jsonb;
  v_prov       jsonb;
  v_prov0      jsonb;
  v_row0       jsonb;
  v_row1       jsonb;
  v_sa0        jsonb;
  v_sa1        jsonb;
  v_n          integer;
  v_n0         integer;
  v_ret        double precision;
  v_case       RECORD;
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

  -- ===== ARM 1 — a strategy-scoped insert of the kind is refused ============
  -- SC-1: the archive wait is hours long. A strategy-scoped job would flip a
  -- PUBLISHED strategy to `computing` for all of it through the status bridge,
  -- so the coherence CHECK admits the kind api_key-scoped ONLY.
  -- RED-UNDER: drop the api_key and strategy conjuncts from the new coherence arm
  --            in 20261026120000, leaving `(kind = 'okx_archive_rebuild') AND
  --            (portfolio_id IS NULL)`. The arm then admits a strategy-scoped
  --            job, and the rebuild's multi-hour wait would show a published
  --            strategy as `computing` to every reader. Arm 0's api_key-only
  --            insert stays admitted, so this arm is the only one that moves. The
  --            migration's verify block checks the kind by position in the
  --            constraint text, which the weakened arm still satisfies.
  -- RED-UNDER-M: {"arm":"1","apply":[{"kind":"edit","file":"supabase/migrations/20261026120000_okx_archive_rebuild.sql","find":"OR ((kind = 'okx_archive_rebuild') AND (api_key_id IS NOT NULL) AND (strategy_id IS NULL) AND (portfolio_id IS NULL) AND (allocator_id IS NULL))","replace":"OR ((kind = 'okx_archive_rebuild') AND (portfolio_id IS NULL))","occurrences":1}]}
  v_sid := pg_temp.okx_seed_strategy('{}'::jsonb);
  v_raised := false; v_constraint := NULL;
  BEGIN
    INSERT INTO public.compute_jobs (strategy_id, kind) VALUES (v_sid, 'okx_archive_rebuild');
  EXCEPTION WHEN check_violation THEN
    v_raised := true;
    GET STACKED DIAGNOSTICS v_constraint = CONSTRAINT_NAME;
  END;
  IF NOT v_raised THEN
    RAISE EXCEPTION 'TEST FAILED (1): a strategy-scoped okx_archive_rebuild job was ACCEPTED - the multi-hour archive wait would flip a published strategy to computing';
  END IF;
  IF v_constraint IS DISTINCT FROM 'compute_jobs_kind_target_coherence' THEN
    RAISE EXCEPTION 'TEST FAILED (1): the strategy-scoped job was refused by constraint %, expected compute_jobs_kind_target_coherence', COALESCE(v_constraint, 'unknown');
  END IF;

  -- ===== ARM 2 — RE-BASE REGRESSION: the derive_broker_dailies api_key arm ===
  -- Copying an older coherence definition drops this arm and breaks every
  -- per-key derive. The key already holds an okx job; the kind differs, so the
  -- in-flight index does not interfere.
  -- RED-UNDER: add `AND (idempotency_key IS NOT NULL)` to the derive_broker_dailies
  --            api_key arm of the coherence CHECK in 20261026120000. Every path
  --            through enqueue_compute_job supplies a key, so the recurring
  --            fan-out keeps working and the arm LOOKS intact, while every other
  --            writer of an api_key-scoped derive_broker_dailies row is refused
  --            with a check_violation naming a constraint nobody expects. The
  --            verify block matches `%derive_broker_dailies%api_key_id IS NOT
  --            NULL%`, which an extra trailing conjunct satisfies unchanged.
  -- RED-UNDER-M: {"arm":"2","apply":[{"kind":"edit","file":"supabase/migrations/20261026120000_okx_archive_rebuild.sql","find":"OR ((kind = 'derive_broker_dailies') AND (api_key_id IS NOT NULL) AND (strategy_id IS NULL) AND (portfolio_id IS NULL) AND (allocator_id IS NULL))","replace":"OR ((kind = 'derive_broker_dailies') AND (api_key_id IS NOT NULL) AND (idempotency_key IS NOT NULL) AND (strategy_id IS NULL) AND (portfolio_id IS NULL) AND (allocator_id IS NULL))","occurrences":1}]}
  v_raised := false; v_constraint := NULL;
  BEGIN
    INSERT INTO public.compute_jobs (api_key_id, kind) VALUES (v_key, 'derive_broker_dailies');
  EXCEPTION WHEN check_violation THEN
    v_raised := true;
    GET STACKED DIAGNOSTICS v_constraint = CONSTRAINT_NAME;
  END;
  IF v_raised THEN
    RAISE EXCEPTION 'TEST FAILED (2): a derive_broker_dailies row with an api_key_id-only target was REFUSED by constraint % - the api_key arm did not survive the coherence re-base', COALESCE(v_constraint, 'unknown');
  END IF;

  -- ===== ARM 3 — RE-BASE REGRESSION: the derive_allocator_equity arm ========
  -- RED-UNDER: drop the NOT from the allocator arm of the coherence CHECK in
  --            20261026120000 (`(allocator_id IS NULL)`). Every other target in
  --            that arm is already required NULL, so the arm then admits a job
  --            with NO target and refuses the one shape the allocator compose
  --            enqueues. The verify block only asks that the kind's name appears
  --            in the constraint text, which a negated conjunct satisfies.
  -- RED-UNDER-M: {"arm":"3","apply":[{"kind":"edit","file":"supabase/migrations/20261026120000_okx_archive_rebuild.sql","find":"OR ((kind = 'derive_allocator_equity') AND (allocator_id IS NOT NULL) AND (strategy_id IS NULL) AND (portfolio_id IS NULL) AND (api_key_id IS NULL))","replace":"OR ((kind = 'derive_allocator_equity') AND (allocator_id IS NULL) AND (strategy_id IS NULL) AND (portfolio_id IS NULL) AND (api_key_id IS NULL))","occurrences":1}]}
  v_raised := false; v_constraint := NULL;
  BEGIN
    INSERT INTO public.compute_jobs (allocator_id, kind) VALUES (v_user, 'derive_allocator_equity');
  EXCEPTION WHEN check_violation THEN
    v_raised := true;
    GET STACKED DIAGNOSTICS v_constraint = CONSTRAINT_NAME;
  END;
  IF v_raised THEN
    RAISE EXCEPTION 'TEST FAILED (3): a derive_allocator_equity row with an allocator_id-only target was REFUSED by constraint % - the allocator arm did not survive the coherence re-base', COALESCE(v_constraint, 'unknown');
  END IF;

  -- ===== ARM 4 — the registry row exists and the FK admitted the kind =======
  -- RED-UNDER: remove the registry INSERT from 20261026120000. The kind is then
  --            in both CHECKs but absent from compute_job_kinds, so every enqueue
  --            of it fails on compute_jobs_kind_fkey. The migration's verify
  --            block reads the catalogue only and never compute_job_kinds rows
  --            (a data-reading raise would block a PROD deploy through an empty
  --            TEST), so the mutated migration applies clean.
  -- RED-UNDER-M: {"arm":"4","apply":[{"kind":"edit","file":"supabase/migrations/20261026120000_okx_archive_rebuild.sql","find":"INSERT INTO compute_job_kinds (name) VALUES ('okx_archive_rebuild')\n  ON CONFLICT (name) DO NOTHING;","replace":"","occurrences":1}]}
  IF v_fk_refused OR NOT EXISTS (
    SELECT 1 FROM public.compute_job_kinds WHERE name = 'okx_archive_rebuild'
  ) THEN
    RAISE EXCEPTION 'TEST FAILED (4): the compute_job_kinds registry has no okx_archive_rebuild row (the compute_jobs.kind foreign key refused the insert: %), so the kind cannot be enqueued', v_fk_refused;
  END IF;

  -- ===== ARM 5 — one job in flight per (api_key_id, kind) ===================
  -- compute_jobs_one_inflight_per_kind_api_key is kind-agnostic, so the new kind
  -- needs no index of its own; this arm pins that it is covered.
  -- RED-UNDER: exempt the kind from the partial unique index in 20260420073003
  --            (`AND kind <> 'okx_archive_rebuild'`). A double-click or a retried
  --            enqueue would then queue two rebuild jobs for one key; each would
  --            apply to OKX, and the quarterly archive endpoint is limited to 12
  --            requests per day. The index's own Category-D probe in that
  --            migration uses poll_allocator_positions, which the exemption does
  --            not touch, so the apply stays clean.
  -- RED-UNDER-M: {"arm":"5","apply":[{"kind":"edit","file":"supabase/migrations/20260420073003_allocator_holdings.sql","find":"  ON compute_jobs (api_key_id, kind)\n  WHERE api_key_id IS NOT NULL\n    AND status IN ('pending','running','done_pending_children');","replace":"  ON compute_jobs (api_key_id, kind)\n  WHERE api_key_id IS NOT NULL\n    AND kind <> 'okx_archive_rebuild'\n    AND status IN ('pending','running','done_pending_children');","occurrences":1}]}
  v_raised := false; v_constraint := NULL;
  BEGIN
    INSERT INTO public.compute_jobs (api_key_id, kind) VALUES (v_key, 'okx_archive_rebuild');
  EXCEPTION WHEN unique_violation THEN
    v_raised := true;
    GET STACKED DIAGNOSTICS v_constraint = CONSTRAINT_NAME;
  END;
  IF NOT v_raised THEN
    RAISE EXCEPTION 'TEST FAILED (5): a second in-flight okx_archive_rebuild job for one api_key was ACCEPTED - nothing stops two rebuilds being queued for one key';
  END IF;
  IF v_constraint IS DISTINCT FROM 'compute_jobs_one_inflight_per_kind_api_key' THEN
    RAISE EXCEPTION 'TEST FAILED (5): the second job was refused by %, expected compute_jobs_one_inflight_per_kind_api_key', COALESCE(v_constraint, 'unknown');
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
  v_sid6 := pg_temp.okx_seed_strategy('{"legacy_ranges":[{"from":"2026-02-23","to":"2026-05-06","source":"returns_grid_carry_forward","recorded_at":"2026-10-10T00:00:00Z"}],"unrecovered_gaps":[{"from":"2026-05-07","to":"2026-05-11","recorded_at":"2026-10-10T00:00:00Z"}]}'::jsonb);
  SELECT count(*) INTO v_n FROM public.csv_daily_returns WHERE strategy_id = v_sid6;
  IF v_n <> 0 THEN
    RAISE EXCEPTION 'TEST FAILED (6-SETUP): the seeded strategy already carries % csv_daily_returns rows, so arm 6 would not be starting from an empty series', v_n;
  END IF;
  v_state := NULL; v_msg := NULL; v_res := NULL;
  SET LOCAL ROLE service_role;
  BEGIN
    v_res := public.apply_okx_archive_rebuild(
      v_sid6,
      '[{"date":"2026-05-07","daily_return":0.01},{"date":"2026-05-08","daily_return":-0.02},{"date":"2026-05-09","daily_return":0.005}]'::jsonb,
      '[{"from":"2026-05-07","to":"2026-05-11"}]'::jsonb,
      '[{"from":"2026-05-10","to":"2026-05-11"}]'::jsonb);
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE, v_msg = MESSAGE_TEXT;
  END;
  RESET ROLE;
  IF v_state IS NOT NULL THEN
    RAISE EXCEPTION 'TEST FAILED (6): the call raised % (%) instead of applying', v_state, v_msg;
  END IF;
  IF v_res ->> 'status' IS DISTINCT FROM 'applied'
     OR (v_res ->> 'inserted')::integer IS DISTINCT FROM 3
     OR (v_res ->> 'ranges_added')::integer IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION 'TEST FAILED (6): the call returned % instead of status applied, inserted 3, ranges_added 1', v_res::text;
  END IF;
  SELECT count(*) INTO v_n FROM public.csv_daily_returns WHERE strategy_id = v_sid6;
  IF v_n <> 3 THEN
    RAISE EXCEPTION 'TEST FAILED (6): % rows were stored for the strategy, expected exactly the 3 sent', v_n;
  END IF;
  SELECT daily_return INTO v_ret FROM public.csv_daily_returns
   WHERE strategy_id = v_sid6 AND date = DATE '2026-05-08';
  IF v_ret IS DISTINCT FROM -0.02::double precision THEN
    RAISE EXCEPTION 'TEST FAILED (6): the stored daily_return for 2026-05-08 is %, expected -0.02', v_ret;
  END IF;
  SELECT series_provenance INTO v_prov FROM public.strategy_analytics WHERE strategy_id = v_sid6;
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

  -- ===== ARM 7 — a row outside every stored gap rolls the call back (D-01) ==
  -- Stored gap 2026-06-01..2026-06-05. Rows: 2026-06-02 (inside) and 2026-06-10
  -- (outside). The whole call must raise 22023 row_outside_gap and leave the
  -- series and the provenance untouched. The function can only fill days
  -- TRADESYNC named.
  -- RED-UNDER: make the containment test match nothing, `WHERE false AND NOT
  --            EXISTS (...)`, in 20261026120000. A caller bug (or a wrong
  --            quarter file) then writes a day nobody named a gap for, over a
  --            published series. The caller's narrowed gaps still match, so the
  --            call succeeds and writes both rows.
  -- RED-UNDER-M: {"arm":"7","apply":[{"kind":"edit","file":"supabase/migrations/20261026120000_okx_archive_rebuild.sql","find":"WHERE NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_stored) g","replace":"WHERE false AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_stored) g","occurrences":1}]}
  v_sid := pg_temp.okx_seed_strategy('{"unrecovered_gaps":[{"from":"2026-06-01","to":"2026-06-05","recorded_at":"2026-10-10T00:00:00Z"}]}'::jsonb);
  SELECT series_provenance INTO v_prov0 FROM public.strategy_analytics WHERE strategy_id = v_sid;
  SELECT count(*) INTO v_n0 FROM public.csv_daily_returns WHERE strategy_id = v_sid;
  IF v_n0 <> 0 THEN
    RAISE EXCEPTION 'TEST FAILED (7-SETUP): the seeded strategy already carries % csv_daily_returns rows', v_n0;
  END IF;
  v_state := NULL; v_msg := NULL;
  SET LOCAL ROLE service_role;
  BEGIN
    v_res := public.apply_okx_archive_rebuild(
      v_sid,
      '[{"date":"2026-06-02","daily_return":0.01},{"date":"2026-06-10","daily_return":0.02}]'::jsonb,
      '[{"from":"2026-06-01","to":"2026-06-05"}]'::jsonb,
      '[{"from":"2026-06-01","to":"2026-06-01"},{"from":"2026-06-03","to":"2026-06-05"}]'::jsonb);
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE, v_msg = MESSAGE_TEXT;
  END;
  RESET ROLE;
  IF v_state IS DISTINCT FROM '22023' OR v_msg IS NULL OR position('row_outside_gap' IN v_msg) = 0 THEN
    RAISE EXCEPTION 'TEST FAILED (7): a row outside every stored gap was not refused with 22023 row_outside_gap (SQLSTATE %, message %)', COALESCE(v_state, 'none - the call SUCCEEDED'), COALESCE(v_msg, 'none');
  END IF;
  SELECT count(*) INTO v_n FROM public.csv_daily_returns WHERE strategy_id = v_sid;
  IF v_n <> v_n0 THEN
    RAISE EXCEPTION 'TEST FAILED (7): the refused call left % csv_daily_returns rows behind (was %)', v_n, v_n0;
  END IF;
  SELECT series_provenance INTO v_prov FROM public.strategy_analytics WHERE strategy_id = v_sid;
  IF v_prov IS DISTINCT FROM v_prov0 THEN
    RAISE EXCEPTION 'TEST FAILED (7): the refused call changed series_provenance';
  END IF;
  -- 7-SHAPE: every malformed input is refused with 22023, none writes. One case
  -- per guard family: payload not an array, empty, an impossible calendar date,
  -- a daily_return that is a string, one outside the +/-10 fence, a duplicate
  -- date, a gap that ends before it starts, and a NULL argument.
  FOR v_case IN
    SELECT * FROM (VALUES
      ('not-an-array',   '{"date":"2026-06-02"}'::jsonb,
                         '[{"from":"2026-06-01","to":"2026-06-05"}]'::jsonb, '[]'::jsonb),
      ('empty',          '[]'::jsonb,
                         '[{"from":"2026-06-01","to":"2026-06-05"}]'::jsonb, '[]'::jsonb),
      ('impossible-day', '[{"date":"2026-02-30","daily_return":0.01}]'::jsonb,
                         '[{"from":"2026-06-01","to":"2026-06-05"}]'::jsonb, '[]'::jsonb),
      ('string-return',  '[{"date":"2026-06-02","daily_return":"0.01"}]'::jsonb,
                         '[{"from":"2026-06-01","to":"2026-06-05"}]'::jsonb, '[]'::jsonb),
      ('outside-fence',  '[{"date":"2026-06-02","daily_return":11}]'::jsonb,
                         '[{"from":"2026-06-01","to":"2026-06-05"}]'::jsonb, '[]'::jsonb),
      ('duplicate-date', '[{"date":"2026-06-02","daily_return":0.01},{"date":"2026-06-02","daily_return":0.02}]'::jsonb,
                         '[{"from":"2026-06-01","to":"2026-06-05"}]'::jsonb, '[]'::jsonb),
      ('reversed-gap',   '[{"date":"2026-06-02","daily_return":0.01}]'::jsonb,
                         '[{"from":"2026-06-05","to":"2026-06-01"}]'::jsonb, '[]'::jsonb),
      ('null-argument',  '[{"date":"2026-06-02","daily_return":0.01}]'::jsonb,
                         NULL::jsonb, '[]'::jsonb)
    ) AS t(lbl, prow, pexp, paft)
  LOOP
    v_state := NULL; v_msg := NULL;
    SET LOCAL ROLE service_role;
    BEGIN
      v_res := public.apply_okx_archive_rebuild(v_sid, v_case.prow, v_case.pexp, v_case.paft);
    EXCEPTION WHEN OTHERS THEN
      GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE, v_msg = MESSAGE_TEXT;
    END;
    RESET ROLE;
    IF v_state IS DISTINCT FROM '22023' THEN
      RAISE EXCEPTION 'TEST FAILED (7-SHAPE): the malformed input "%" was not refused with 22023 (SQLSTATE %, message %)', v_case.lbl, COALESCE(v_state, 'none - the call SUCCEEDED'), COALESCE(v_msg, 'none');
    END IF;
  END LOOP;
  SELECT count(*) INTO v_n FROM public.csv_daily_returns WHERE strategy_id = v_sid;
  SELECT series_provenance INTO v_prov FROM public.strategy_analytics WHERE strategy_id = v_sid;
  IF v_n <> v_n0 OR v_prov IS DISTINCT FROM v_prov0 THEN
    RAISE EXCEPTION 'TEST FAILED (7-SHAPE): a refused malformed call wrote (rows % -> %)', v_n0, v_n;
  END IF;

  -- ===== ARM 8 — compare-and-set on the stored gaps =========================
  -- The caller read gap 2026-06-01..2026-06-04 but the stored gap is
  -- 2026-06-01..2026-06-05: someone moved it since. The call must raise P0001
  -- gaps_changed and write nothing, so a stale read is never written over.
  -- RED-UNDER: replace the compare-and-set condition with `IF false THEN` in
  --            20261026120000. A caller that read a gap before the runbook
  --            moved it then writes rows for a range nobody confirms it still
  --            owns. The caller's narrowed gaps are set to what the unguarded
  --            call computes, so the call succeeds.
  -- RED-UNDER-M: {"arm":"8","apply":[{"kind":"edit","file":"supabase/migrations/20261026120000_okx_archive_rebuild.sql","find":"IF v_stored IS DISTINCT FROM v_expected THEN","replace":"IF false THEN","occurrences":1}]}
  v_sid := pg_temp.okx_seed_strategy('{"unrecovered_gaps":[{"from":"2026-06-01","to":"2026-06-05","recorded_at":"2026-10-10T00:00:00Z"}]}'::jsonb);
  SELECT series_provenance INTO v_prov0 FROM public.strategy_analytics WHERE strategy_id = v_sid;
  v_state := NULL; v_msg := NULL;
  SET LOCAL ROLE service_role;
  BEGIN
    v_res := public.apply_okx_archive_rebuild(
      v_sid,
      '[{"date":"2026-06-02","daily_return":0.01}]'::jsonb,
      '[{"from":"2026-06-01","to":"2026-06-04"}]'::jsonb,
      '[{"from":"2026-06-01","to":"2026-06-01"},{"from":"2026-06-03","to":"2026-06-05"}]'::jsonb);
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE, v_msg = MESSAGE_TEXT;
  END;
  RESET ROLE;
  IF v_state IS DISTINCT FROM 'P0001' OR v_msg IS NULL OR position('gaps_changed' IN v_msg) = 0 THEN
    RAISE EXCEPTION 'TEST FAILED (8): a p_expected_gaps that differs from the stored gaps was not refused with P0001 gaps_changed (SQLSTATE %, message %)', COALESCE(v_state, 'none - the call SUCCEEDED'), COALESCE(v_msg, 'none');
  END IF;
  SELECT count(*) INTO v_n FROM public.csv_daily_returns WHERE strategy_id = v_sid;
  SELECT series_provenance INTO v_prov FROM public.strategy_analytics WHERE strategy_id = v_sid;
  IF v_n <> 0 OR v_prov IS DISTINCT FROM v_prov0 THEN
    RAISE EXCEPTION 'TEST FAILED (8): the refused call wrote (rows %, provenance changed %)', v_n, v_prov IS DISTINCT FROM v_prov0;
  END IF;

  -- ===== ARM 9 — a repeated call is a distinct no-op ========================
  -- Arm 6's call, sent again with the SAME arguments (the retry after a lost
  -- response). The stored gaps have moved, so a compare-and-set would refuse it
  -- as gaps_changed; the already-applied check comes first and answers with a
  -- status that cannot be mistaken for a miss.
  -- RED-UNDER: disable the already-applied branch (`IF false THEN`) in
  --            20261026120000. A retried call then collides with the
  --            compare-and-set and reports gaps_changed, which the worker reads
  --            as a stale read and a failure although everything was written.
  -- RED-UNDER-M: {"arm":"9","apply":[{"kind":"edit","file":"supabase/migrations/20261026120000_okx_archive_rebuild.sql","find":"IF v_n = jsonb_array_length(p_rows) THEN","replace":"IF false THEN","occurrences":1}]}
  SELECT series_provenance INTO v_prov0 FROM public.strategy_analytics WHERE strategy_id = v_sid6;
  SELECT count(*) INTO v_n0 FROM public.csv_daily_returns WHERE strategy_id = v_sid6;
  v_state := NULL; v_msg := NULL; v_res := NULL;
  SET LOCAL ROLE service_role;
  BEGIN
    v_res := public.apply_okx_archive_rebuild(
      v_sid6,
      '[{"date":"2026-05-07","daily_return":0.01},{"date":"2026-05-08","daily_return":-0.02},{"date":"2026-05-09","daily_return":0.005}]'::jsonb,
      '[{"from":"2026-05-07","to":"2026-05-11"}]'::jsonb,
      '[{"from":"2026-05-10","to":"2026-05-11"}]'::jsonb);
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE, v_msg = MESSAGE_TEXT;
  END;
  RESET ROLE;
  IF v_state IS NOT NULL THEN
    RAISE EXCEPTION 'TEST FAILED (9): the repeated call raised % (%) instead of answering already_applied', v_state, v_msg;
  END IF;
  IF v_res ->> 'status' IS DISTINCT FROM 'already_applied'
     OR (v_res ->> 'inserted')::integer IS DISTINCT FROM 0
     OR (v_res ->> 'ranges_added')::integer IS DISTINCT FROM 0 THEN
    RAISE EXCEPTION 'TEST FAILED (9): the repeated call returned % instead of status already_applied, inserted 0, ranges_added 0', v_res::text;
  END IF;
  SELECT count(*) INTO v_n FROM public.csv_daily_returns WHERE strategy_id = v_sid6;
  SELECT series_provenance INTO v_prov FROM public.strategy_analytics WHERE strategy_id = v_sid6;
  IF v_n <> v_n0 OR v_prov IS DISTINCT FROM v_prov0 THEN
    RAISE EXCEPTION 'TEST FAILED (9): the repeated call wrote (rows % -> %, provenance changed %)', v_n0, v_n, v_prov IS DISTINCT FROM v_prov0;
  END IF;

  -- ===== ARM 10 — every other provenance key survives =======================
  -- RED-UNDER: rebuild series_provenance from only the narrowed gaps,
  --            `v_sp := jsonb_build_object('unrecovered_gaps', v_new_gaps)`, in
  --            20261026120000. The carried-forward legacy_ranges TRADESYNC
  --            recorded (and any other key) are then erased by the very write
  --            that discloses the rebuild.
  -- RED-UNDER-M: {"arm":"10","apply":[{"kind":"edit","file":"supabase/migrations/20261026120000_okx_archive_rebuild.sql","find":"v_sp := jsonb_set(COALESCE(v_sp, '{}'::jsonb), '{unrecovered_gaps}', v_new_gaps, true);","replace":"v_sp := jsonb_build_object('unrecovered_gaps', v_new_gaps);","occurrences":1}]}
  v_sid := pg_temp.okx_seed_strategy('{"legacy_ranges":[{"from":"2026-02-23","to":"2026-05-06","source":"returns_grid_carry_forward","recorded_at":"2026-10-10T00:00:00Z"}],"note":"kept","unrecovered_gaps":[{"from":"2026-06-01","to":"2026-06-03","recorded_at":"2026-10-10T00:00:00Z"}]}'::jsonb);
  v_state := NULL; v_msg := NULL;
  SET LOCAL ROLE service_role;
  BEGIN
    v_res := public.apply_okx_archive_rebuild(
      v_sid,
      '[{"date":"2026-06-01","daily_return":0.004}]'::jsonb,
      '[{"from":"2026-06-01","to":"2026-06-03"}]'::jsonb,
      '[{"from":"2026-06-02","to":"2026-06-03"}]'::jsonb);
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE, v_msg = MESSAGE_TEXT;
  END;
  RESET ROLE;
  IF v_state IS NOT NULL THEN
    RAISE EXCEPTION 'TEST FAILED (10-SETUP): the call raised % (%), so arm 10 would be comparing a provenance that was never rewritten', v_state, v_msg;
  END IF;
  SELECT series_provenance INTO v_prov FROM public.strategy_analytics WHERE strategy_id = v_sid;
  IF v_prov -> 'legacy_ranges' IS DISTINCT FROM
       '[{"from":"2026-02-23","to":"2026-05-06","source":"returns_grid_carry_forward","recorded_at":"2026-10-10T00:00:00Z"}]'::jsonb
     OR v_prov ->> 'note' IS DISTINCT FROM 'kept' THEN
    RAISE EXCEPTION 'TEST FAILED (10): the call did not preserve legacy_ranges and the unrelated key (provenance is now %)', v_prov::text;
  END IF;
  -- 10-RANGES: a stored reconstructed_ranges that is not an array is refused,
  -- never overwritten (appending would destroy a record the reader may need).
  v_sidb := pg_temp.okx_seed_strategy('{"reconstructed_ranges":"oops","unrecovered_gaps":[{"from":"2026-06-01","to":"2026-06-03","recorded_at":"2026-10-10T00:00:00Z"}]}'::jsonb);
  SELECT series_provenance INTO v_prov0 FROM public.strategy_analytics WHERE strategy_id = v_sidb;
  v_state := NULL; v_msg := NULL;
  SET LOCAL ROLE service_role;
  BEGIN
    v_res := public.apply_okx_archive_rebuild(
      v_sidb,
      '[{"date":"2026-06-01","daily_return":0.004}]'::jsonb,
      '[{"from":"2026-06-01","to":"2026-06-03"}]'::jsonb,
      '[{"from":"2026-06-02","to":"2026-06-03"}]'::jsonb);
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE, v_msg = MESSAGE_TEXT;
  END;
  RESET ROLE;
  IF v_state IS DISTINCT FROM '22023' OR v_msg IS NULL OR position('reconstructed_ranges' IN v_msg) = 0 THEN
    RAISE EXCEPTION 'TEST FAILED (10-RANGES): a stored reconstructed_ranges that is not an array was not refused with 22023 (SQLSTATE %, message %)', COALESCE(v_state, 'none - the call SUCCEEDED'), COALESCE(v_msg, 'none');
  END IF;
  SELECT series_provenance INTO v_prov FROM public.strategy_analytics WHERE strategy_id = v_sidb;
  SELECT count(*) INTO v_n FROM public.csv_daily_returns WHERE strategy_id = v_sidb;
  IF v_prov IS DISTINCT FROM v_prov0 OR v_n <> 0 THEN
    RAISE EXCEPTION 'TEST FAILED (10-RANGES): the refused call wrote (rows %, provenance changed %)', v_n, v_prov IS DISTINCT FROM v_prov0;
  END IF;

  -- ===== ARM 11 — a live day always wins (D-12) =============================
  -- Stored gap 2026-06-01..2026-06-05. A LIVE row already exists for 2026-06-02
  -- (0.123). The archive sends 2026-06-01, 2026-06-02 (0.99, a different value)
  -- and 2026-06-03. The live row must be byte-identical afterwards, its day must
  -- not appear in any appended range, and the gap must no longer name it.
  -- RED-UNDER: turn the INSERT's `DO NOTHING` into `DO UPDATE SET daily_return =
  --            EXCLUDED.daily_return` in 20261026120000. The archive then
  --            overwrites a live-derived day, and the rebuild silently changes
  --            numbers the live feed already published.
  -- RED-UNDER-M: {"arm":"11","apply":[{"kind":"edit","file":"supabase/migrations/20261026120000_okx_archive_rebuild.sql","find":"    ON CONFLICT (strategy_id, date) DO NOTHING\n    RETURNING date","replace":"    ON CONFLICT (strategy_id, date) DO UPDATE SET daily_return = EXCLUDED.daily_return\n    RETURNING date","occurrences":1}]}
  v_sid := pg_temp.okx_seed_strategy('{"unrecovered_gaps":[{"from":"2026-06-01","to":"2026-06-05","recorded_at":"2026-10-10T00:00:00Z"}]}'::jsonb);
  INSERT INTO public.csv_daily_returns (strategy_id, date, daily_return)
  VALUES (v_sid, DATE '2026-06-02', 0.123);
  SELECT to_jsonb(c) INTO v_row0 FROM public.csv_daily_returns c
   WHERE c.strategy_id = v_sid AND c.date = DATE '2026-06-02';
  IF v_row0 IS NULL THEN
    RAISE EXCEPTION 'TEST FAILED (11-SETUP): the live row was not created, so arm 11 would compare nothing';
  END IF;
  v_state := NULL; v_msg := NULL; v_res := NULL;
  SET LOCAL ROLE service_role;
  BEGIN
    v_res := public.apply_okx_archive_rebuild(
      v_sid,
      '[{"date":"2026-06-01","daily_return":0.011},{"date":"2026-06-02","daily_return":0.99},{"date":"2026-06-03","daily_return":0.022}]'::jsonb,
      '[{"from":"2026-06-01","to":"2026-06-05"}]'::jsonb,
      '[{"from":"2026-06-04","to":"2026-06-05"}]'::jsonb);
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE, v_msg = MESSAGE_TEXT;
  END;
  RESET ROLE;
  IF v_state IS NOT NULL THEN
    RAISE EXCEPTION 'TEST FAILED (11): the call raised % (%)', v_state, v_msg;
  END IF;
  SELECT to_jsonb(c) INTO v_row1 FROM public.csv_daily_returns c
   WHERE c.strategy_id = v_sid AND c.date = DATE '2026-06-02';
  IF v_row1 IS DISTINCT FROM v_row0 THEN
    RAISE EXCEPTION 'TEST FAILED (11): the live row for 2026-06-02 changed (was %, now %) - the archive overwrote a live-derived day', v_row0::text, v_row1::text;
  END IF;
  IF (v_res ->> 'inserted')::integer IS DISTINCT FROM 2 OR (v_res ->> 'ranges_added')::integer IS DISTINCT FROM 2 THEN
    RAISE EXCEPTION 'TEST FAILED (11): the call returned %, expected inserted 2 and ranges_added 2 (the live day splits the two inserted days into two ranges)', v_res::text;
  END IF;
  SELECT series_provenance INTO v_prov FROM public.strategy_analytics WHERE strategy_id = v_sid;
  IF v_prov -> 'reconstructed_ranges' IS NULL
     OR jsonb_array_length(v_prov -> 'reconstructed_ranges') <> 2
     OR v_prov -> 'reconstructed_ranges' -> 0 ->> 'from' IS DISTINCT FROM '2026-06-01'
     OR v_prov -> 'reconstructed_ranges' -> 0 ->> 'to' IS DISTINCT FROM '2026-06-01'
     OR v_prov -> 'reconstructed_ranges' -> 1 ->> 'from' IS DISTINCT FROM '2026-06-03'
     OR v_prov -> 'reconstructed_ranges' -> 1 ->> 'to' IS DISTINCT FROM '2026-06-03' THEN
    RAISE EXCEPTION 'TEST FAILED (11): reconstructed_ranges is %, expected the two single days 2026-06-01 and 2026-06-03 and never the live day 2026-06-02', COALESCE((v_prov -> 'reconstructed_ranges')::text, 'NULL');
  END IF;
  IF v_prov -> 'unrecovered_gaps' IS DISTINCT FROM
     '[{"from":"2026-06-04","to":"2026-06-05","recorded_at":"2026-10-10T00:00:00Z"}]'::jsonb THEN
    RAISE EXCEPTION 'TEST FAILED (11): unrecovered_gaps is %, expected 2026-06-04..2026-06-05 (the live day no longer a gap day)', COALESCE((v_prov -> 'unrecovered_gaps')::text, 'NULL');
  END IF;

  -- ===== ARM 12 — only service_role can EXECUTE =============================
  -- RED-UNDER: GRANT EXECUTE on the function to authenticated after the apply. A
  --            `sql` step and NOT a migration edit, because the migration's own
  --            verify block asserts this very grantee set and would abort the
  --            apply. A signed-in user could then call a function that writes
  --            another strategy's published series through PostgREST.
  -- RED-UNDER-M: {"arm":"12","apply":[{"kind":"sql","stmt":"GRANT EXECUTE ON FUNCTION public.apply_okx_archive_rebuild(uuid, jsonb, jsonb, jsonb) TO authenticated"}]}
  IF has_function_privilege('anon', 'public.apply_okx_archive_rebuild(uuid,jsonb,jsonb,jsonb)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.apply_okx_archive_rebuild(uuid,jsonb,jsonb,jsonb)', 'EXECUTE') THEN
    RAISE EXCEPTION 'TEST FAILED (12): anon (%) or authenticated (%) can EXECUTE apply_okx_archive_rebuild',
      has_function_privilege('anon', 'public.apply_okx_archive_rebuild(uuid,jsonb,jsonb,jsonb)', 'EXECUTE'),
      has_function_privilege('authenticated', 'public.apply_okx_archive_rebuild(uuid,jsonb,jsonb,jsonb)', 'EXECUTE');
  END IF;
  IF NOT has_function_privilege('service_role', 'public.apply_okx_archive_rebuild(uuid,jsonb,jsonb,jsonb)', 'EXECUTE') THEN
    RAISE EXCEPTION 'TEST FAILED (12): service_role cannot EXECUTE apply_okx_archive_rebuild, so the analytics worker cannot apply a rebuild';
  END IF;
  -- 12-INVOKER: SECURITY INVOKER with the search_path pinned. A DEFINER body
  -- would run with the owner's privileges and widen the blast radius from the
  -- service_role grant to the owner.
  SELECT count(*) INTO v_n
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'apply_okx_archive_rebuild'
     AND NOT p.prosecdef
     AND EXISTS (SELECT 1 FROM unnest(COALESCE(p.proconfig, ARRAY[]::text[])) c
                  WHERE regexp_replace(c, '\s', '', 'g') = 'search_path=public,pg_catalog');
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'TEST FAILED (12-INVOKER): apply_okx_archive_rebuild is not exactly one SECURITY INVOKER function with search_path pinned to public, pg_catalog (found % matching)', v_n;
  END IF;

  -- ===== ARM 13 — the call writes series_provenance and nothing else ========
  -- The status bridge, the recompute and the freshness line all read the other
  -- strategy_analytics columns; a rebuild must not move them (the Wave 5 recompute
  -- owns recomputation).
  -- RED-UNDER: install a BEFORE UPDATE trigger on strategy_analytics that rewrites
  --            computation_status whenever series_provenance changes. Two live
  --            `sql` steps rather than an edit, because the drift being modelled
  --            is a LATER migration adding such a trigger; 20261026120000 carries
  --            none to remove. The rebuild would then move strategy state on
  --            every run.
  -- RED-UNDER-M: {"arm":"13","apply":[{"kind":"sql","stmt":"CREATE FUNCTION public.zz_twin_okx_react() RETURNS trigger LANGUAGE plpgsql AS $f$ BEGIN IF NEW.series_provenance IS DISTINCT FROM OLD.series_provenance THEN NEW.computation_status := 'twin-moved'; END IF; RETURN NEW; END $f$"},{"kind":"sql","stmt":"CREATE TRIGGER zz_twin_okx_react_trigger BEFORE UPDATE ON public.strategy_analytics FOR EACH ROW EXECUTE FUNCTION public.zz_twin_okx_react()"}]}
  v_sid := pg_temp.okx_seed_strategy('{"unrecovered_gaps":[{"from":"2026-06-01","to":"2026-06-03","recorded_at":"2026-10-10T00:00:00Z"}]}'::jsonb);
  UPDATE public.strategy_analytics SET computed_at = TIMESTAMPTZ '2026-10-01 00:00:00+00' WHERE strategy_id = v_sid;
  SELECT to_jsonb(sa) - 'series_provenance' INTO v_sa0 FROM public.strategy_analytics sa WHERE sa.strategy_id = v_sid;
  v_state := NULL; v_msg := NULL;
  SET LOCAL ROLE service_role;
  BEGIN
    v_res := public.apply_okx_archive_rebuild(
      v_sid,
      '[{"date":"2026-06-01","daily_return":0.004}]'::jsonb,
      '[{"from":"2026-06-01","to":"2026-06-03"}]'::jsonb,
      '[{"from":"2026-06-02","to":"2026-06-03"}]'::jsonb);
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE, v_msg = MESSAGE_TEXT;
  END;
  RESET ROLE;
  IF v_state IS NOT NULL THEN
    RAISE EXCEPTION 'TEST FAILED (13-SETUP): the call raised % (%), so arm 13 would compare a row that was never written', v_state, v_msg;
  END IF;
  SELECT to_jsonb(sa) - 'series_provenance' INTO v_sa1 FROM public.strategy_analytics sa WHERE sa.strategy_id = v_sid;
  IF v_sa1 IS DISTINCT FROM v_sa0 THEN
    RAISE EXCEPTION 'TEST FAILED (13): the call changed a strategy_analytics column other than series_provenance (before %, after %)', v_sa0::text, v_sa1::text;
  END IF;

  -- ===== ARM 14 — a head gap stays named; a wrong narrowed gap rolls back ===
  -- Stored gap 2026-06-20..2026-07-10 spans two quarters. Rows exist only for the
  -- later part (2026-07-01..2026-07-10). The earlier part, 2026-06-20..2026-06-30,
  -- must stay in unrecovered_gaps with NO row and NO 0.0 in it (SC-4). Then a
  -- call whose p_expected_gaps_after is wrong must raise P0001 gaps_after_mismatch
  -- and roll its INSERT back (D-11).
  -- RED-UNDER: compute the narrowed gaps as "the gap days AFTER the newest row"
  --            (a high-water mark) instead of "the gap days that still have no
  --            row", in 20261026120000. The earlier part of the gap is then
  --            silently dropped from unrecovered_gaps and the factsheet stops
  --            naming 11 days that nothing covered. Arms 6, 10 and 11 leave a
  --            TAIL uncovered, where the two definitions agree, so this arm (a
  --            head gap) is the first to move.
  -- RED-UNDER-M: {"arm":"14","apply":[{"kind":"edit","file":"supabase/migrations/20261026120000_okx_archive_rebuild.sql","find":"WHERE NOT EXISTS (SELECT 1 FROM public.csv_daily_returns c\n                        WHERE c.strategy_id = p_strategy_id AND c.date = g.f + s.n)","replace":"WHERE g.f + s.n > COALESCE((SELECT max(c.date) FROM public.csv_daily_returns c WHERE c.strategy_id = p_strategy_id), DATE '1900-01-01')","occurrences":1}]}
  v_sid := pg_temp.okx_seed_strategy('{"unrecovered_gaps":[{"from":"2026-06-20","to":"2026-07-10","recorded_at":"2026-10-10T00:00:00Z"}]}'::jsonb);
  v_state := NULL; v_msg := NULL; v_res := NULL;
  SET LOCAL ROLE service_role;
  BEGIN
    v_res := public.apply_okx_archive_rebuild(
      v_sid,
      '[{"date":"2026-07-01","daily_return":0.001},{"date":"2026-07-02","daily_return":0.002},{"date":"2026-07-03","daily_return":0.003},{"date":"2026-07-04","daily_return":0.004},{"date":"2026-07-05","daily_return":0.005},{"date":"2026-07-06","daily_return":0.006},{"date":"2026-07-07","daily_return":0.007},{"date":"2026-07-08","daily_return":0.008},{"date":"2026-07-09","daily_return":0.009},{"date":"2026-07-10","daily_return":0.01}]'::jsonb,
      '[{"from":"2026-06-20","to":"2026-07-10"}]'::jsonb,
      '[{"from":"2026-06-20","to":"2026-06-30"}]'::jsonb);
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE, v_msg = MESSAGE_TEXT;
  END;
  RESET ROLE;
  IF v_state IS NOT NULL THEN
    RAISE EXCEPTION 'TEST FAILED (14): the call raised % (%) - the earlier, uncovered part of the gap was not computed as the caller expects', v_state, v_msg;
  END IF;
  IF (v_res ->> 'inserted')::integer IS DISTINCT FROM 10 THEN
    RAISE EXCEPTION 'TEST FAILED (14): the call returned %, expected inserted 10', v_res::text;
  END IF;
  SELECT series_provenance INTO v_prov FROM public.strategy_analytics WHERE strategy_id = v_sid;
  IF v_prov -> 'unrecovered_gaps' IS DISTINCT FROM
     '[{"from":"2026-06-20","to":"2026-06-30","recorded_at":"2026-10-10T00:00:00Z"}]'::jsonb THEN
    RAISE EXCEPTION 'TEST FAILED (14): unrecovered_gaps is %, expected the uncovered earlier part 2026-06-20..2026-06-30', COALESCE((v_prov -> 'unrecovered_gaps')::text, 'NULL');
  END IF;
  SELECT count(*) INTO v_n FROM public.csv_daily_returns
   WHERE strategy_id = v_sid AND date BETWEEN DATE '2026-06-20' AND DATE '2026-06-30';
  IF v_n <> 0 THEN
    RAISE EXCEPTION 'TEST FAILED (14): % rows exist inside the uncovered part of the gap (a zero-fill or an interpolation); a day nothing covers must stay MISSING', v_n;
  END IF;
  SELECT count(*) INTO v_n FROM public.csv_daily_returns WHERE strategy_id = v_sid AND daily_return = 0;
  IF v_n <> 0 THEN
    RAISE EXCEPTION 'TEST FAILED (14): % stored rows are exactly 0.0; no row of this rebuild is 0.0', v_n;
  END IF;
  IF jsonb_array_length(v_prov -> 'reconstructed_ranges') IS DISTINCT FROM 1
     OR v_prov -> 'reconstructed_ranges' -> 0 ->> 'from' IS DISTINCT FROM '2026-07-01'
     OR v_prov -> 'reconstructed_ranges' -> 0 ->> 'to' IS DISTINCT FROM '2026-07-10' THEN
    RAISE EXCEPTION 'TEST FAILED (14): reconstructed_ranges is %, expected one range 2026-07-01..2026-07-10', COALESCE((v_prov -> 'reconstructed_ranges')::text, 'NULL');
  END IF;
  -- (b) a wrong p_expected_gaps_after (claims every gap is covered) is refused and
  -- rolls the INSERT back.
  v_sidb := pg_temp.okx_seed_strategy('{"unrecovered_gaps":[{"from":"2026-06-20","to":"2026-07-10","recorded_at":"2026-10-10T00:00:00Z"}]}'::jsonb);
  SELECT series_provenance INTO v_prov0 FROM public.strategy_analytics WHERE strategy_id = v_sidb;
  v_state := NULL; v_msg := NULL;
  SET LOCAL ROLE service_role;
  BEGIN
    v_res := public.apply_okx_archive_rebuild(
      v_sidb,
      '[{"date":"2026-07-01","daily_return":0.001},{"date":"2026-07-02","daily_return":0.002},{"date":"2026-07-03","daily_return":0.003}]'::jsonb,
      '[{"from":"2026-06-20","to":"2026-07-10"}]'::jsonb,
      '[]'::jsonb);
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE, v_msg = MESSAGE_TEXT;
  END;
  RESET ROLE;
  IF v_state IS DISTINCT FROM 'P0001' OR v_msg IS NULL OR position('gaps_after_mismatch' IN v_msg) = 0 THEN
    RAISE EXCEPTION 'TEST FAILED (14): a wrong p_expected_gaps_after was not refused with P0001 gaps_after_mismatch (SQLSTATE %, message %)', COALESCE(v_state, 'none - the call SUCCEEDED'), COALESCE(v_msg, 'none');
  END IF;
  SELECT count(*) INTO v_n FROM public.csv_daily_returns WHERE strategy_id = v_sidb;
  SELECT series_provenance INTO v_prov FROM public.strategy_analytics WHERE strategy_id = v_sidb;
  IF v_n <> 0 OR v_prov IS DISTINCT FROM v_prov0 THEN
    RAISE EXCEPTION 'TEST FAILED (14): the refused call did not roll back (rows %, provenance changed %); the INSERT must die with the raise', v_n, v_prov IS DISTINCT FROM v_prov0;
  END IF;

  RAISE NOTICE 'ALL 15 ARMS EXECUTED (0,1,2,3,4,5,6,7,8,9,10,11,12,13,14): okx_archive_rebuild is admitted api_key-scoped only with the derive_broker_dailies and derive_allocator_equity arms intact (0-3), registered and one-in-flight per key (4,5); apply_okx_archive_rebuild lands rows and reconstructed_ranges together as service_role (6), refuses a row outside every stored gap and every malformed input (7), refuses a stale read (8), answers a repeat with already_applied (9), preserves every other provenance key (10), never overwrites a live day (11), is executable by service_role alone as SECURITY INVOKER (12), writes only series_provenance (13) and keeps an uncovered head gap named while rolling back a wrong narrowed gap (14).';
END $$;

ROLLBACK;
