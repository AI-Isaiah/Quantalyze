-- ==========================================================================
-- Phase 227 JOBLEDGER plan 03 (HEAL-02): renew_compute_job_claims.
--
-- WHAT IS UNDER TEST. public.renew_compute_job_claims(uuid[], uuid[]), the
-- token-fenced lease renewal that keeps a claimed-but-waiting compute job from
-- being reset by reset_stalled_compute_jobs while it sits in its worker's batch.
--
-- THE FAILURE IT CLOSES. The worker claims up to five jobs at once (every row
-- gets the same claimed_at = now() and its own claim_token) and dispatches them
-- one after another. A job waiting behind slow batch-mates keeps the claim-time
-- claimed_at, so it ages past its kind's watchdog threshold while still in the
-- worker's list; the watchdog resets it and NULLs its token, and the worker then
-- runs a job it no longer owns: the work runs twice and the terminal write is
-- refused with 55006. The renewal moves claimed_at to now() for rows still
-- running under the caller's own token.
--
-- HOW. Plain PL/pgSQL DO blocks, RAISE EXCEPTION on failure. pgTAP is NOT
-- installed. No psql meta-commands. Every arm is its own BEGIN ... ROLLBACK, so
-- nothing it seeds outlives it. Seeding runs under SET LOCAL
-- session_replication_role = replica and the role is set back to origin BEFORE
-- any function call, so every compute_jobs trigger is live for the calls under
-- test. Every id is gen_random_uuid() at run time and every assertion is scoped
-- to the arm's own job ids: claims and resets are queue-wide, and the sql-tests
-- lane carries rows other gate files commit. The calls under test sit inside
-- inner BEGIN ... EXCEPTION blocks that only capture the SQLSTATE; the arm's
-- RAISE comes AFTER the block (lint rule R1).
--
-- ARMS (file order is this order).
--   R1  A derive_allocator_equity row claimed in a batch of three, back-dated 25
--       minutes (a long wait behind batch-mates) and renewed with its own token,
--       is NOT reset by the real watchdog run with the worker's per-kind
--       overrides ('20 minutes' for that kind). The TODOS close criterion.
--   R2  A renew with a token that does not match renews nothing and leaves
--       claimed_at as it was; the SAME row IS then reset by the watchdog (the
--       control: without a valid renewal the row ages out as today).
--   R3  A pending row and a done row, each carrying a token that matches the
--       caller's, are not renewed: the renew only touches running rows.
--   R4  Arrays of unequal length, and NULL arrays, raise invalid_parameter_value.
--   R5  anon and authenticated cannot EXECUTE the function; service_role can; its
--       proconfig pins search_path to public, pg_catalog.
--
-- ⚠️ The migration's self-verify block asserts the catalogue facts R2, R3 and R5
-- also prove behaviourally. A twin that breaks one of them therefore also stands
-- down the self-verify clause that would abort the apply, so the gate (not the
-- apply) is what goes RED, with the arm named.
--
-- PG-LANE SUBSTRATE (the apply list below). The claim-pair gate's list
-- (compute_jobs base, the one-in-flight index sources, both CHECK sources, the
-- priority and claim_token fixtures, the claim pair), plus
-- 20260516104201_compute_jobs_audit_2026_05_07_residual.sql, the latest source of
-- reset_stalled_compute_jobs, then this phase's migration LAST. The residual
-- migration goes in AFTER fixture 36 (the claim_token column it re-bases on) and
-- BEFORE 20260927120000, so the claim pair that runs is still the latest body.
-- RED-UNDER-SETUP: {"apply":["scripts/pg-lane/fixtures/01-fixture-core.sql","scripts/pg-lane/fixtures/02-fixture-sanitize-tables.sql","scripts/pg-lane/fixtures/03-fixture-compute-jobs.sql","scripts/pg-lane/fixtures/07-fixture-supabase-default-privileges.sql","scripts/pg-lane/fixtures/11-fixture-api-keys-created-at.sql","scripts/pg-lane/fixtures/15-fixture-auth-role.sql","scripts/pg-lane/fixtures/20-fixture-app-role-helper.sql","scripts/pg-lane/fixtures/21-fixture-api-keys-credential-columns.sql","scripts/pg-lane/fixtures/23-fixture-contact-requests.sql","scripts/pg-lane/fixtures/24-fixture-enqueue-compute-job-chain.sql","supabase/migrations/20260411144407_compute_jobs_queue.sql","scripts/pg-lane/fixtures/04-fixture-compute-jobs-targets.sql","supabase/migrations/20260416125430_contact_request_metadata.sql","supabase/migrations/20260418194206_scoring_weight_overrides.sql","supabase/migrations/20260420073003_allocator_holdings.sql","supabase/migrations/20260510175507_process_key_long_compute_job_kinds_repair.sql","supabase/migrations/20260515210300_scoring_weight_overrides_high_hardening.sql","supabase/migrations/20260522111858_compute_analytics_from_csv_kind.sql","supabase/migrations/20260525074649_compute_jobs_kind_check_extend_csv.sql","supabase/migrations/20260614120000_derive_broker_dailies_kind.sql","supabase/migrations/20260710130000_stitch_composite_kind.sql","supabase/migrations/20260716090000_retire_compute_analytics_kind_rpc_guard.sql","supabase/migrations/20260717233529_allocator_equity_derived_surface.sql","supabase/migrations/20260826150000_destrict_enqueue_internal_10param.sql","supabase/migrations/20260924230827_fanin_initial_status_10param.sql","scripts/pg-lane/fixtures/29-fixture-compute-jobs-priority.sql","scripts/pg-lane/fixtures/36-fixture-compute-jobs-claim-token.sql","supabase/schema/functions/reset_stalled_compute_jobs.sql","supabase/migrations/20260927120000_claim_pair_pre_rank_exclusion.sql","supabase/migrations/20261124120200_compute_job_claim_renewal.sql"]}
-- ==========================================================================

-- --------------------------------------------------------------------------
-- R1 — a renewed waiting row survives the real watchdog.
-- RED-UNDER: make the renew UPDATE in 20261124120200_compute_job_claim_renewal.sql
--            set claimed_at to claimed_at instead of now(). The renew still
--            reports the id (token and status match) but the 25-minute-old
--            claimed_at is untouched, so the watchdog's 20-minute derive
--            threshold takes the row, NULLs its token and resets it to pending:
--            this arm's first raise.
-- RED-UNDER-M: {"arm":"R1","apply":[{"kind":"edit","file":"supabase/migrations/20261124120200_compute_job_claim_renewal.sql","find":"SET claimed_at = now()","replace":"SET claimed_at = claimed_at","occurrences":1}]}
-- --------------------------------------------------------------------------
BEGIN;
DO $$
DECLARE
  v_user    uuid := gen_random_uuid();
  v_key1    uuid := gen_random_uuid();
  v_key2    uuid := gen_random_uuid();
  v_bd1     uuid := gen_random_uuid();
  v_bd2     uuid := gen_random_uuid();
  v_alloc   uuid := gen_random_uuid();
  v_tok     uuid;
  v_renewed uuid[];
  v_err     text;
  v_msg     text;
  v_status  text;
  v_tok_now uuid;
BEGIN
  SET LOCAL session_replication_role = replica;
  -- Parent rows: a claimed row's UPDATE re-checks its foreign keys.
  INSERT INTO auth.users (id) VALUES (v_user);
  INSERT INTO public.api_keys (id, user_id, exchange, label, api_key_encrypted)
    VALUES (v_key1, gen_random_uuid(), 'okx', 'renewal-gate', 'enc'),
           (v_key2, gen_random_uuid(), 'okx', 'renewal-gate', 'enc');
  INSERT INTO public.compute_jobs (id, kind, api_key_id, status, attempts, next_attempt_at)
    VALUES (v_bd1, 'derive_broker_dailies', v_key1, 'pending', 0, now() - interval '3 minutes'),
           (v_bd2, 'derive_broker_dailies', v_key2, 'pending', 0, now() - interval '2 minutes');
  INSERT INTO public.compute_jobs (id, kind, allocator_id, status, attempts, next_attempt_at)
    VALUES (v_alloc, 'derive_allocator_equity', v_user, 'pending', 0, now() - interval '1 minute');
  SET LOCAL session_replication_role = origin;

  -- One batch through the real 5-arg claim (the overload the worker calls; the
  -- 2-arg form is ambiguous while both exist): all three rows get the same claimed_at and
  -- each its own token.
  PERFORM count(*) FROM public.claim_compute_jobs_with_priority(1000, 'renewal-gate', NULL::boolean, NULL::text[], NULL::text[]);
  SELECT claim_token, status INTO v_tok, v_status FROM public.compute_jobs WHERE id = v_alloc;
  IF v_status IS DISTINCT FROM 'running' OR v_tok IS NULL THEN
    RAISE EXCEPTION 'TEST FAILED (R1): setup: the real claim did not take the derive_allocator_equity row (status %, token %), so the arm measured nothing.', v_status, v_tok;
  END IF;

  -- The row waits 25 minutes behind its batch-mates.
  UPDATE public.compute_jobs SET claimed_at = now() - interval '25 minutes' WHERE id = v_alloc;

  v_err := NULL; v_msg := NULL;
  BEGIN
    SELECT array_agg(r) INTO v_renewed
      FROM public.renew_compute_job_claims(ARRAY[v_alloc], ARRAY[v_tok]) r;
    PERFORM public.reset_stalled_compute_jobs(
      interval '10 minutes',
      '{"derive_allocator_equity": "20 minutes", "derive_broker_dailies": "30 minutes"}'::jsonb);
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_err = RETURNED_SQLSTATE, v_msg = MESSAGE_TEXT;
  END;

  IF v_err IS NOT NULL THEN
    RAISE EXCEPTION 'TEST FAILED (R1): SQLSTATE % from the renew or the watchdog (%).', v_err, v_msg;
  END IF;
  IF v_renewed IS NULL OR NOT (v_alloc = ANY (v_renewed)) THEN
    RAISE EXCEPTION 'TEST FAILED (R1): renew_compute_job_claims did not return the id of a row still running under its own token (returned %); the worker would read that as "I lost this row".', v_renewed;
  END IF;
  SELECT status, claim_token INTO v_status, v_tok_now FROM public.compute_jobs WHERE id = v_alloc;
  IF v_status IS DISTINCT FROM 'running' OR v_tok_now IS DISTINCT FROM v_tok THEN
    RAISE EXCEPTION 'TEST FAILED (R1): the watchdog reset a derive_allocator_equity row that was renewed with its own token (status %, token kept: %); a waiting job is reset while still in its worker''s batch and runs twice.', v_status, (v_tok_now IS NOT DISTINCT FROM v_tok);
  END IF;
  RAISE NOTICE 'R1 OK: a renewed row 25 minutes into its wait survived the real watchdog with the 20-minute derive override.';
END $$;
ROLLBACK;

DO $$ BEGIN
  RAISE NOTICE 'ALL 1 ARMS EXECUTED (R1): a claimed row that waits past the watchdog threshold behind its batch-mates and is renewed with its own claim token is not reset by reset_stalled_compute_jobs, so it is not dispatched a second time. Phase 227 HEAL-02.';
END $$;
