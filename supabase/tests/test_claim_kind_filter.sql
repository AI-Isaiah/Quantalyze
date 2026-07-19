-- Test: claim_compute_jobs_with_priority kind filter (FLIPRETRY-02) +
-- enqueue_derive_broker_dailies_for_allocator_keys fan-out idempotency
-- (FLIPRETRY-04, the 123-VALIDATION Wave-0 gap).
--
--   FLIPRETRY-02 — the 5-arg claim RPC gained p_kind_include / p_kind_exclude
--     (both DEFAULT NULL). A dedicated backfill worker claims ONLY the
--     backfill kinds; the interactive prod worker EXCLUDES them. Both NULL
--     must be byte-identical to the prior 3-arg behavior. This file exercises
--     the LIVE RPC against the test project (the Python-side test MOCKS the
--     RPC and cannot observe the server-side predicate).
--
--   FLIPRETRY-04 — enqueue_derive_broker_dailies_for_allocator_keys() fans out
--     one derive_broker_dailies job per eligible api_key. Re-running the cron
--     must NOT create a duplicate in-flight row per key (advisory lock +
--     per-(key,UTC-date) idempotency key + compute_jobs_one_inflight_per_kind_api_key).
--
-- pgTAP is not set up in this project (CLAUDE.md / Lane B), so assertions
-- RAISE EXCEPTION on failure; a clean run prints NOTICEs only. Run under
-- `psql -v ON_ERROR_STOP=1`. Run order: AFTER migration 20260719073701.
--
-- Every scenario seeds gen_random_uuid() ids inside an explicit BEGIN/ROLLBACK
-- so a concurrent CI run against the shared test project cannot collide and no
-- row is left behind on failure. Counts are scoped to the seeded ids so
-- committed rows from a concurrent run cannot perturb them (red-team A, the
-- pattern the sibling dedupe/fan-in SQL tests use).

-- ==========================================================================
-- Part 1 — structural: the live RPC carries the kind-filter predicate on BOTH
-- the throttle probe AND the claim SELECT. Zero side effects; fails on a
-- revert that drops either predicate.
-- ==========================================================================
DO $$
DECLARE
  v_claimp TEXT := pg_get_functiondef('claim_compute_jobs_with_priority(integer,text,boolean,text[],text[])'::regprocedure);
  v_include_hits INT;
  v_exclude_hits INT;
BEGIN
  -- The include/exclude predicates must appear at least TWICE each: once in
  -- the v_high_pending throttle probe and once in the `ranked` claim SELECT.
  SELECT count(*) INTO v_include_hits
    FROM regexp_matches(v_claimp, 'p_kind_include\s+IS\s+NULL\s+OR\s+kind\s*=\s*ANY\(p_kind_include\)', 'gi') AS m;
  SELECT count(*) INTO v_exclude_hits
    FROM regexp_matches(v_claimp, 'p_kind_exclude\s+IS\s+NULL\s+OR\s+NOT\s*\(kind\s*=\s*ANY\(p_kind_exclude\)\)', 'gi') AS m;
  IF v_include_hits < 2 THEN
    RAISE EXCEPTION 'FLIPRETRY-02: include predicate present % time(s); expected >=2 (probe + claim SELECT)', v_include_hits;
  END IF;
  IF v_exclude_hits < 2 THEN
    RAISE EXCEPTION 'FLIPRETRY-02: exclude predicate present % time(s); expected >=2 (probe + claim SELECT)', v_exclude_hits;
  END IF;
  RAISE NOTICE 'FLIPRETRY-02 OK: kind filter present on both throttle probe and claim SELECT.';
END $$;

-- ==========================================================================
-- Part 2 — functional: include / exclude / NULL-passthrough. Seed one
-- backfill-kind row and one non-backfill-kind row for a fresh api_key, then
-- claim three ways and assert the returned kinds. Rolled back.
-- ==========================================================================
BEGIN;
DO $$
DECLARE
  v_user      uuid := gen_random_uuid();
  v_key       uuid;
  v_backfill  int;
  v_other     int;
BEGIN
  -- FK chain: compute_jobs.api_key_id -> api_keys.id -> profiles.id ->
  -- auth.users.id.
  INSERT INTO auth.users (id, email)
    VALUES (v_user, 'kindfilter-' || v_user || '@invalid.local');
  INSERT INTO public.profiles (id, display_name)
    VALUES (v_user, 'kindfilter-test') ON CONFLICT (id) DO NOTHING;
  INSERT INTO public.api_keys (user_id, exchange, encrypted_api_key, encrypted_api_secret, is_active)
    VALUES (v_user, 'sfox', 'x', 'y', TRUE) RETURNING id INTO v_key;

  -- One backfill-kind job (derive_broker_dailies) and one non-backfill-kind
  -- job (compute_analytics), both DUE + normal priority, scoped to this key.
  INSERT INTO public.compute_jobs
      (id, kind, api_key_id, status, priority, attempts, next_attempt_at, claim_token)
    VALUES
      (gen_random_uuid(), 'derive_broker_dailies', v_key, 'pending', 'normal', 0,
       TIMESTAMPTZ '1970-01-01 00:00:00+00', NULL),
      (gen_random_uuid(), 'compute_analytics', v_key, 'pending', 'normal', 0,
       TIMESTAMPTZ '1970-01-01 00:00:01+00', NULL);

  -- EXCLUDE the backfill kinds: only the non-backfill row is claimable.
  SELECT count(*) FILTER (WHERE kind = 'derive_broker_dailies'),
         count(*) FILTER (WHERE kind = 'compute_analytics')
    INTO v_backfill, v_other
    FROM public.claim_compute_jobs_with_priority(
           5, 'kf-exclude-' || v_user, NULL,
           NULL, ARRAY['derive_broker_dailies','derive_allocator_equity'])
   WHERE api_key_id = v_key;
  IF v_backfill <> 0 THEN
    RAISE EXCEPTION 'FLIPRETRY-02 exclude: claimed % backfill row(s); expected 0', v_backfill;
  END IF;
  IF v_other <> 1 THEN
    RAISE EXCEPTION 'FLIPRETRY-02 exclude: claimed % non-backfill row(s); expected 1', v_other;
  END IF;
  RAISE NOTICE 'FLIPRETRY-02 OK: exclude claimed only the non-backfill kind.';
END $$;
ROLLBACK;

BEGIN;
DO $$
DECLARE
  v_user      uuid := gen_random_uuid();
  v_key       uuid;
  v_backfill  int;
  v_other     int;
BEGIN
  INSERT INTO auth.users (id, email)
    VALUES (v_user, 'kindfilter-' || v_user || '@invalid.local');
  INSERT INTO public.profiles (id, display_name)
    VALUES (v_user, 'kindfilter-test') ON CONFLICT (id) DO NOTHING;
  INSERT INTO public.api_keys (user_id, exchange, encrypted_api_key, encrypted_api_secret, is_active)
    VALUES (v_user, 'sfox', 'x', 'y', TRUE) RETURNING id INTO v_key;
  INSERT INTO public.compute_jobs
      (id, kind, api_key_id, status, priority, attempts, next_attempt_at, claim_token)
    VALUES
      (gen_random_uuid(), 'derive_broker_dailies', v_key, 'pending', 'normal', 0,
       TIMESTAMPTZ '1970-01-01 00:00:00+00', NULL),
      (gen_random_uuid(), 'compute_analytics', v_key, 'pending', 'normal', 0,
       TIMESTAMPTZ '1970-01-01 00:00:01+00', NULL);

  -- INCLUDE the backfill kinds: only the backfill row is claimable, and the
  -- unrelated non-backfill normal-priority pending row must NOT make the
  -- include-filtered worker defer (throttle scoped to includable kinds).
  SELECT count(*) FILTER (WHERE kind = 'derive_broker_dailies'),
         count(*) FILTER (WHERE kind = 'compute_analytics')
    INTO v_backfill, v_other
    FROM public.claim_compute_jobs_with_priority(
           5, 'kf-include-' || v_user, NULL,
           ARRAY['derive_broker_dailies','derive_allocator_equity'], NULL)
   WHERE api_key_id = v_key;
  IF v_backfill <> 1 THEN
    RAISE EXCEPTION 'FLIPRETRY-02 include: claimed % backfill row(s); expected 1', v_backfill;
  END IF;
  IF v_other <> 0 THEN
    RAISE EXCEPTION 'FLIPRETRY-02 include: claimed % non-backfill row(s); expected 0', v_other;
  END IF;
  RAISE NOTICE 'FLIPRETRY-02 OK: include claimed only the backfill kind.';
END $$;
ROLLBACK;

BEGIN;
DO $$
DECLARE
  v_user      uuid := gen_random_uuid();
  v_key       uuid;
  v_total     int;
BEGIN
  INSERT INTO auth.users (id, email)
    VALUES (v_user, 'kindfilter-' || v_user || '@invalid.local');
  INSERT INTO public.profiles (id, display_name)
    VALUES (v_user, 'kindfilter-test') ON CONFLICT (id) DO NOTHING;
  INSERT INTO public.api_keys (user_id, exchange, encrypted_api_key, encrypted_api_secret, is_active)
    VALUES (v_user, 'sfox', 'x', 'y', TRUE) RETURNING id INTO v_key;
  INSERT INTO public.compute_jobs
      (id, kind, api_key_id, status, priority, attempts, next_attempt_at, claim_token)
    VALUES
      (gen_random_uuid(), 'derive_broker_dailies', v_key, 'pending', 'normal', 0,
       TIMESTAMPTZ '1970-01-01 00:00:00+00', NULL),
      (gen_random_uuid(), 'compute_analytics', v_key, 'pending', 'normal', 0,
       TIMESTAMPTZ '1970-01-01 00:00:01+00', NULL);

  -- Both NULL (3-arg-equivalent call): byte-identical to prod today — BOTH
  -- kinds are claimable (different partitions), so both are claimed.
  SELECT count(*) INTO v_total
    FROM public.claim_compute_jobs_with_priority(5, 'kf-null-' || v_user, NULL)
   WHERE api_key_id = v_key;
  IF v_total <> 2 THEN
    RAISE EXCEPTION 'FLIPRETRY-02 NULL-passthrough: claimed % row(s); expected 2 (byte-identical to 3-arg)', v_total;
  END IF;
  RAISE NOTICE 'FLIPRETRY-02 OK: NULL/NULL is byte-identical (claimed both seeded kinds).';
END $$;
ROLLBACK;

-- ==========================================================================
-- Part 3 — FLIPRETRY-04: fan-out idempotency. Call
-- enqueue_derive_broker_dailies_for_allocator_keys() TWICE against a seeded
-- eligible api_key and assert exactly ONE in-flight derive_broker_dailies row
-- for that key (the unique_violation swallow + one-inflight index + advisory
-- lock). Rolled back.
-- ==========================================================================
BEGIN;
DO $$
DECLARE
  v_user     uuid := gen_random_uuid();
  v_key      uuid;
  v_inflight int;
BEGIN
  INSERT INTO auth.users (id, email)
    VALUES (v_user, 'fanout-' || v_user || '@invalid.local');
  INSERT INTO public.profiles (id, display_name)
    VALUES (v_user, 'fanout-test') ON CONFLICT (id) DO NOTHING;
  -- Eligible key: is_active AND sync_status IS DISTINCT FROM 'revoked' AND
  -- disconnected_at IS NULL.
  INSERT INTO public.api_keys (user_id, exchange, encrypted_api_key, encrypted_api_secret, is_active)
    VALUES (v_user, 'sfox', 'x', 'y', TRUE) RETURNING id INTO v_key;

  PERFORM enqueue_derive_broker_dailies_for_allocator_keys();
  PERFORM enqueue_derive_broker_dailies_for_allocator_keys();

  -- Exactly one live (pending/failed_retry/running/done_pending_children)
  -- derive_broker_dailies row for the seeded key: the second fan-out swallowed
  -- the unique_violation from the per-(key,UTC-date) idempotency key.
  SELECT count(*) INTO v_inflight
    FROM public.compute_jobs
   WHERE api_key_id = v_key
     AND kind = 'derive_broker_dailies'
     AND status IN ('pending', 'failed_retry', 'running', 'done_pending_children');
  IF v_inflight <> 1 THEN
    RAISE EXCEPTION 'FLIPRETRY-04: double fan-out left % in-flight derive_broker_dailies for the key; expected 1', v_inflight;
  END IF;
  RAISE NOTICE 'FLIPRETRY-04 OK: double fan-out is idempotent (exactly 1 in-flight per key).';
END $$;
ROLLBACK;
