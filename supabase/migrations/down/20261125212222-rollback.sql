-- ============================================================================
-- ROLLBACK for 20261125212222_computation_error_copy_contact_form.sql
-- Phase 222 ALERTTRUTH, ERRC-01.
-- ============================================================================
-- Manual, off the auto-apply path. Run it as ONE transaction, so it either happens
-- whole or not at all (this file carries no transaction statements, like a migration):
--
--   psql --single-transaction -v ON_ERROR_STOP=1 -f <this file>
--
-- against the database the marker query in CLAUDE.md names. Run that query FIRST:
--
--   SELECT shobj_description(oid, 'pg_database') AS which_database
--     FROM pg_database WHERE datname = current_database();
--
-- current_database() is `postgres` on BOTH projects and proves nothing; if the marker is
-- NULL, re-set it before running anything here. What this file undoes:
--   1. Restores the body of public.computation_error_copy(text) to the one defined by
--      20260826120000_computation_error_curated_copy.sql, so the permanent, transient,
--      unknown and ELSE arms offer the legacy support pointer again. The orphaned arm
--      is the same in both.
--   2. Restores that migration's COMMENT ON FUNCTION text and re-asserts the ACL
--      (EXECUTE for service_role only).
--
-- ⚠️ NO DATA IS TOUCHED. Rows already written to strategy_analytics.computation_error
-- keep the sentence they carry. After this file runs, new failures write the old
-- sentences, which name a support channel that does not exist, so run it only if that
-- is the intended state. The csv-finalize route's lost-race copy would then be out of
-- byte parity with the ELSE arm again.
--
-- ⚠️ THE MIGRATION LEDGER ROW IS LEFT IN PLACE. This file does not touch
-- supabase_migrations.schema_migrations, so after it runs the ledger still records
-- version 20261125212222 as applied while the function carries the old arms, and
-- `supabase db push` will not re-apply the migration. To re-apply it, delete that
-- ledger row in the same change (or mark it reverted with
-- `supabase migration repair --status reverted 20261125212222` against the intended
-- database, after the marker query above names that database).
--
-- The DO block before the change is a catalogue-only PRECONDITION: it refuses, before
-- anything changes, on a database that has no such function. The DO block after the
-- change is catalogue-only too and aborts the whole rollback if the old arms are not
-- back or the ACL is wrong. Neither reads a row.
-- ============================================================================

SET LOCAL lock_timeout = '3s';

-- ───────────── precondition — CATALOGUE ONLY, reads no row
DO $precondition$
BEGIN
  IF to_regprocedure('public.computation_error_copy(text)') IS NULL THEN
    RAISE EXCEPTION 'Rollback 20261125212222 refused: public.computation_error_copy(text) is not present. Nothing was changed. Run the marker query in CLAUDE.md to see which database this is.';
  END IF;
END
$precondition$;

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
      'Analytics could not complete for this strategy, and retrying alone will not resolve it. Contact support if you need this strategy computed.'
    -- 'transient' and 'unknown' SHARE an arm, and the sameness is the honest
    -- part. Neither reaches 'failed_final' except through
    -- `v_attempts >= v_max_attempts`, so the one true statement about both is
    -- that the automatic retries were used up. Splitting them would spend two
    -- sentences implying a difference the user cannot act on.
    WHEN 'transient' THEN
      'Analytics could not complete after several automatic retries. Retry the sync, or contact support if it keeps failing.'
    WHEN 'unknown' THEN
      'Analytics could not complete after several automatic retries. Retry the sync, or contact support if it keeps failing.'
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
      'Analytics could not complete for this strategy. Retry the sync, or contact support if this persists.'
  END
$copy$;

COMMENT ON FUNCTION public.computation_error_copy(TEXT) IS
  'User-facing copy for strategy_analytics.computation_error, derived from compute_jobs.error_kind. Phase 162 / HONEST-01. Takes a KIND, never an error string: the range is four fixed literals, so nothing that goes in can come out. permanent -> will not resolve by retrying; transient/unknown -> automatic retries exhausted (they reach failed_final only via v_attempts >= v_max_attempts, so they share the one statement that is true of both); orphaned -> the worker died holding the claim, so the job never reached a verdict and the failure IS retryable (retry-positive copy, added with mig 20260826140000 which widens compute_jobs_error_kind_check and re-registers the hourly reaper to write it; before that the reaper wrote permanent and told those users that retrying would not help, which was false); anything else, including NULL -> a cautious default that claims nothing about retries. The raw diagnosis stays on compute_jobs.last_error, which is operator-only and is NOT read by sync_strategy_analytics_status. Mirrors analytics-service/services/allocator_positions.py sync_error_copy.';

REVOKE ALL ON FUNCTION public.computation_error_copy(TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.computation_error_copy(TEXT) TO service_role;

-- ───────────── verify — CATALOGUE ONLY, reads no row
DO $verify$
BEGIN
  IF public.computation_error_copy('permanent') IS DISTINCT FROM 'Analytics could not complete for this strategy, and retrying alone will not resolve it. Contact support if you need this strategy computed.' THEN
    RAISE EXCEPTION 'Rollback 20261125212222 failed: the permanent arm is not the 20260826120000 sentence, got: %', public.computation_error_copy('permanent');
  END IF;

  IF public.computation_error_copy(NULL) IS DISTINCT FROM 'Analytics could not complete for this strategy. Retry the sync, or contact support if this persists.' THEN
    RAISE EXCEPTION 'Rollback 20261125212222 failed: the ELSE arm is not the 20260826120000 sentence, got: %', public.computation_error_copy(NULL);
  END IF;

  IF NOT has_function_privilege('service_role', 'public.computation_error_copy(text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'Rollback 20261125212222 failed: service_role lost EXECUTE on public.computation_error_copy(text)';
  END IF;
  IF has_function_privilege('anon', 'public.computation_error_copy(text)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.computation_error_copy(text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'Rollback 20261125212222 failed: anon or authenticated can EXECUTE public.computation_error_copy(text)';
  END IF;

  RAISE NOTICE 'Rollback 20261125212222: computation_error_copy carries the 20260826120000 arms again. No data was touched. The migration ledger row is left in place (see the header).';
END
$verify$;
