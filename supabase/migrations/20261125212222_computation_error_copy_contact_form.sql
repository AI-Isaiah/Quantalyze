-- ============================================================================
-- computation_error_copy: the channel-offering arms name the contact form
-- (2026-11-27, Phase 222 ALERTTRUTH, ERRC-01; founder ruling 2026-11-25)
-- ============================================================================
--
-- What this is for
-- ----------------
-- computation_error_copy(kind) is the ONLY value the status bridge
-- (sync_strategy_analytics_status) writes into strategy_analytics.computation_error,
-- the column the strategy's owner reads on the sync card. Four of its five
-- sentences (permanent, transient, unknown and the ELSE arm) pointed the reader at
-- a support channel that does not exist. The contact form is the channel that does,
-- so each of those four now says "contact form" in the founder's wording. The
-- orphaned arm offers no channel and is BYTE-IDENTICAL to what it was.
--
-- Arms after this migration:
--   permanent : Analytics could not complete for this strategy, and retrying alone
--               will not resolve it. Use the contact form if you need this strategy
--               computed.
--   transient : Analytics could not complete after several automatic retries. Retry
--               the sync, or use the contact form if it keeps failing.
--   unknown   : same sentence as transient (they share one true statement).
--   orphaned  : UNCHANGED.
--   ELSE      : Analytics could not complete for this strategy. Retry the sync, or
--               use the contact form if this persists. This is byte-equal to
--               ENQUEUE_LOST_RACE_USER_COPY in src/app/api/strategies/csv-finalize/
--               route.ts, and that route's test reads this arm out of the generated
--               snapshot to prove it.
--
-- Reaches TEST and then PROD only through Supabase Migrate on merge (apply-test,
-- then the PROD apply, which runs with no human gate). Nothing here is applied by
-- hand. The self-verify at the end is therefore the last automated stop: it asserts
-- every arm's literal and the ACL, and aborts the apply on TEST before PROD if any
-- of them is wrong.
--
-- Re-base
-- -------
-- The only prior definition of this function is
-- 20260826120000_computation_error_curated_copy.sql (measured by grepping every
-- migration for the function name; no later migration redefines it). This file
-- re-bases it: the signature, IMMUTABLE, NOT STRICT (a NULL kind resolves to the
-- ELSE arm), SET search_path = pg_catalog, the CANARY_162_F3_PROSE_ONLY comment
-- inside the body and the per-arm comments all carry over. Only the four sentences
-- named above change.
--
-- Two gates, and why one of them does NOT load this file
-- ------------------------------------------------------
-- supabase/tests/test_compute_jobs_error_kind_copy_parity.sql deliberately does NOT
-- list this file in its setup: its RED-UNDER-M arms mutate the OLD migration file,
-- and a later CREATE OR REPLACE in its apply list would overwrite those mutations
-- and stop the arms biting. It still passes on the local-stack lane, which replays
-- every migration. test_sync_status_curated_sentence_survives.sql and
-- test_sync_status_marked_refresh_protected.sql spell the permanent sentence and
-- list this file in RED-UNDER-SETUP.
--
-- No RED-UNDER-M twin mutates this file. The self-verify below therefore asserts
-- the arm TEXT, because the PROD apply is unattended. A future twin that mutates an
-- arm of this file must move those asserts in the same change.
--
-- Known limit: existing strategy_analytics.computation_error rows keep their old
-- sentence until their next failure or recompute. There is no backfill, because
-- that would be a PROD write in a second migration.
--
-- Transaction style: NO explicit transaction statements (migration-reviewer
-- invariant 14; Supabase wraps each migration). SET LOCAL lock_timeout applies to
-- that wrap. The self-verify reads the catalogue only and no application table.
--
-- VAC-04 acknowledgment: the hash below is the one VAC-04 reported for PROD's live
-- computation_error_copy/1 on this PR. It equals the body in the committed
-- supabase/schema/baseline.sql (re-dumped from PROD at v0.133.79.1), which
-- baseline-content-drift reports as the same hash on this PR, so PROD carries the
-- 20260826120000 body and no out-of-band patch. The drift is this migration's own
-- change.
--
-- prod-body-ack: 905e9d0ff1a01260c9b0c5324925dcb028860f2cf6dc4f7b7b38955ffdf2854d
--
-- Rollback (manual, off the auto-apply path; no data is touched):
-- supabase/migrations/down/20261125212222-rollback.sql.

SET LOCAL lock_timeout = '3s';

-- --------------------------------------------------------------------------
-- computation_error_copy — the ONLY value the status bridge may write to
-- strategy_analytics.computation_error.
-- --------------------------------------------------------------------------
-- Takes an ERROR KIND. Never an error, and never a string derived from one.
-- Its range is the four literals below, so no input can travel through it —
-- that is the guarantee, and it is structural rather than a convention callers
-- have to keep. See the file header for the full argument and for why the four
-- compute_jobs error kinds collapse to three honest sentences plus a cautious
-- default.
--
-- NOT STRICT, deliberately: a NULL kind must resolve to the default sentence,
-- not to NULL. A NULL here would blank the column over a live failure, which is
-- the silent-failure mode the whole surface exists to avoid. (Measured: no
-- failed_final writer at HEAD can produce a NULL kind — this is the belt for a
-- future one.)
CREATE OR REPLACE FUNCTION public.computation_error_copy(p_error_kind TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
SET search_path = pg_catalog
AS $copy$
  -- CANARY_162_F3_PROSE_ONLY — this token appears ONLY here, in a comment, and
  -- nowhere in this function's code. supabase/tests/
  -- test_compute_jobs_error_kind_copy_parity.sql strips comments out of
  -- pg_get_functiondef before matching the CASE arms below, and uses this token
  -- to prove the stripper actually ran — otherwise "the stripper worked" and
  -- "there was nothing to strip" are the same observation, and a prose mention
  -- of WHEN 'somekind' THEN could stand in for a real arm. ⛔ Do not delete it
  -- to tidy up: that gate goes RED, on purpose (the F-5 lesson from the sibling
  -- migration 20260826130000, where deleting the canary silently DISARMED the
  -- check that depended on it).
  SELECT CASE p_error_kind
    -- 'permanent' terminalises on the FIRST failure (mark_compute_job_failed:
    -- `IF p_error_kind = 'permanent' THEN v_new_status := 'failed_final'`), so
    -- no automatic retry has happened and none is coming. Promising a retry
    -- here would be the thing that is false.
    WHEN 'permanent' THEN
      'Analytics could not complete for this strategy, and retrying alone will not resolve it. Use the contact form if you need this strategy computed.'
    -- 'transient' and 'unknown' SHARE an arm, and the sameness is the honest
    -- part. Neither reaches 'failed_final' except through
    -- `v_attempts >= v_max_attempts`, so the one true statement about both is
    -- that the automatic retries were used up. Splitting them would spend two
    -- sentences implying a difference the user cannot act on.
    WHEN 'transient' THEN
      'Analytics could not complete after several automatic retries. Retry the sync, or use the contact form if it keeps failing.'
    WHEN 'unknown' THEN
      'Analytics could not complete after several automatic retries. Retry the sync, or use the contact form if it keeps failing.'
    -- 'orphaned' — the WORKER DIED holding the claim; the job itself never
    -- reached a verdict. Written ONLY by the hourly reaper
    -- (retention_compute_jobs_orphaned_running, re-registered by mig
    -- 20260826140000), never by mark_compute_job_failed, which still refuses
    -- any kind outside transient/permanent/unknown — so this arm is reachable
    -- from exactly one writer.
    --
    -- ⛔ THIS ARM IS RETRY-POSITIVE AND THAT IS THE WHOLE POINT. An orphan is
    -- retryable BY DEFINITION: nothing about the strategy failed, a process
    -- went away. Before 20260826140000 the reaper wrote 'permanent', so these
    -- users were told "retrying alone will not resolve it" — affirmatively
    -- false, and not self-healing either: the dropped-enqueue readmit sweep
    -- (20260819130500) only covers strategies with csv_daily_returns rows, so
    -- live-API strategies are outside it entirely, and once the bridge writes
    -- computation_status = 'failed' that sweep's own
    -- NOT EXISTS (... computation_status IN (...,'failed')) conjunct blocks
    -- readmit permanently. Telling the user to retry is the ONLY thing that
    -- gets the work done.
    WHEN 'orphaned' THEN
      'Analytics stopped before it finished because the process running it went away. Nothing is wrong with this strategy — retry the sync.'
    -- Anything else: NULL, or a kind added after this migration. Says only what
    -- is true of every failure and claims nothing about retries.
    ELSE
      'Analytics could not complete for this strategy. Retry the sync, or use the contact form if this persists.'
  END
$copy$;

COMMENT ON FUNCTION public.computation_error_copy(TEXT) IS
  'User-facing copy for strategy_analytics.computation_error, derived from compute_jobs.error_kind. Phase 162 / HONEST-01. Takes a KIND, never an error string: the range is four fixed literals, so nothing that goes in can come out. permanent -> will not resolve by retrying; transient/unknown -> automatic retries exhausted (they reach failed_final only via v_attempts >= v_max_attempts, so they share the one statement that is true of both); orphaned -> the worker died holding the claim, so the job never reached a verdict and the failure IS retryable (retry-positive copy, added with mig 20260826140000 which widens compute_jobs_error_kind_check and re-registers the hourly reaper to write it; before that the reaper wrote permanent and told those users that retrying would not help, which was false); anything else, including NULL -> a cautious default that claims nothing about retries. The raw diagnosis stays on compute_jobs.last_error, which is operator-only and is NOT read by sync_strategy_analytics_status. Mirrors analytics-service/services/allocator_positions.py sync_error_copy. Since Phase 222 (mig 20261125212222) every channel-offering arm names the contact form.';

-- ACL. SYMMETRIC on purpose, exactly as in 20260826120000: a REVOKE with no
-- matching GRANT cannot tell "correctly locked down" from "revoked one role too
-- far". CREATE OR REPLACE keeps the existing ACL, and it is re-asserted anyway so
-- this file stands on its own.
REVOKE ALL ON FUNCTION public.computation_error_copy(TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.computation_error_copy(TEXT) TO service_role;

-- ───────────── verify — CATALOGUE ONLY, reads no application table
DO $verify$
BEGIN
  IF to_regprocedure('public.computation_error_copy(text)') IS NULL THEN
    RAISE EXCEPTION 'Migration 20261125212222 failed: public.computation_error_copy(text) is missing';
  END IF;

  IF public.computation_error_copy('permanent') IS DISTINCT FROM 'Analytics could not complete for this strategy, and retrying alone will not resolve it. Use the contact form if you need this strategy computed.' THEN
    RAISE EXCEPTION 'Migration 20261125212222 failed: the permanent arm is wrong, got: %', public.computation_error_copy('permanent');
  END IF;

  IF public.computation_error_copy('transient') IS DISTINCT FROM 'Analytics could not complete after several automatic retries. Retry the sync, or use the contact form if it keeps failing.' THEN
    RAISE EXCEPTION 'Migration 20261125212222 failed: the transient arm is wrong, got: %', public.computation_error_copy('transient');
  END IF;

  IF public.computation_error_copy('unknown') IS DISTINCT FROM 'Analytics could not complete after several automatic retries. Retry the sync, or use the contact form if it keeps failing.' THEN
    RAISE EXCEPTION 'Migration 20261125212222 failed: the unknown arm is wrong, got: %', public.computation_error_copy('unknown');
  END IF;

  IF public.computation_error_copy('orphaned') IS DISTINCT FROM 'Analytics stopped before it finished because the process running it went away. Nothing is wrong with this strategy — retry the sync.' THEN
    RAISE EXCEPTION 'Migration 20261125212222 failed: the orphaned arm changed, got: %', public.computation_error_copy('orphaned');
  END IF;

  IF public.computation_error_copy(NULL) IS DISTINCT FROM 'Analytics could not complete for this strategy. Retry the sync, or use the contact form if this persists.' THEN
    RAISE EXCEPTION 'Migration 20261125212222 failed: the ELSE arm (NULL kind) is wrong, got: %', public.computation_error_copy(NULL);
  END IF;

  IF public.computation_error_copy('permanent') ILIKE '%contact support%'
     OR public.computation_error_copy('transient') ILIKE '%contact support%'
     OR public.computation_error_copy('unknown') ILIKE '%contact support%'
     OR public.computation_error_copy('orphaned') ILIKE '%contact support%'
     OR public.computation_error_copy(NULL) ILIKE '%contact support%' THEN
    RAISE EXCEPTION 'Migration 20261125212222 failed: an arm still carries the legacy support pointer';
  END IF;

  IF NOT has_function_privilege('service_role', 'public.computation_error_copy(text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'Migration 20261125212222 failed: service_role lost EXECUTE on public.computation_error_copy(text)';
  END IF;
  IF has_function_privilege('anon', 'public.computation_error_copy(text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'Migration 20261125212222 failed: anon can EXECUTE public.computation_error_copy(text)';
  END IF;
  IF has_function_privilege('authenticated', 'public.computation_error_copy(text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'Migration 20261125212222 failed: authenticated can EXECUTE public.computation_error_copy(text)';
  END IF;

  RAISE NOTICE 'Migration 20261125212222: computation_error_copy names the contact form in every channel-offering arm; orphaned is unchanged; the ACL is service_role only.';
END
$verify$;
