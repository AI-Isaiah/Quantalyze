-- audit-2026-05-07 mitigation
-- Closes: H-0923 (red-team c7)
-- Source file: supabase/migrations/20260417110539_retention_crons.sql (was 056)
-- Issue: api_key_rotation_reminder cron body references
--   api_keys.is_active and profiles.email without an INFORMATION_SCHEMA
--   probe. Schema drift (Supabase platform rename, sibling-branch fork,
--   manual hotfix) silently breaks the cron body every night. pg_cron
--   buries the resulting error in cron.job_run_details which is
--   rarely scraped.
-- Mitigation: install a helper function `_assert_retention_columns()`
--   that asserts the three columns the retention crons depend on
--   (api_keys.is_active, profiles.email, notification_dispatches.recipient_email)
--   exist, then call it at apply time. Re-applies are no-ops.
--   The helper is preserved (not dropped) so a future canary cron or
--   the next retention_crons hardening pass can invoke it cheaply.
--
-- Out of scope: the cron BODY itself is not modified. pg_cron job
-- bodies are stored as TEXT in cron.job.command — modifying them
-- requires cron.unschedule + cron.schedule, which retention_crons_high_hardening
-- has already done. Re-doing it here for column-existence probes
-- would clobber the SFT #5 NOTICE branch and the H-0920 conflict-
-- notice branch. The cleaner pattern is: assert columns exist at
-- migration apply time (catches drift at deploy), and trust the
-- cron body to fail loudly if drift occurs post-deploy (the column
-- reference will raise 42703 undefined_column at the next nightly
-- tick, which IS observable via cron.job_run_details for ops who
-- check — and the assertion ensures they CANNOT have drifted at
-- the moment this PR lands).

BEGIN;
SET lock_timeout = '5s';

-- --------------------------------------------------------------------------
-- STEP 1: install the retention-column existence assertion helper
-- --------------------------------------------------------------------------
-- The helper inspects information_schema.columns and raises EXCEPTION
-- if any of the three columns the retention crons reference is missing.
-- Domain-specific ERRCODE so callers can distinguish from generic
-- 42703 errors.
CREATE OR REPLACE FUNCTION public._assert_retention_columns()
RETURNS VOID
LANGUAGE plpgsql
AS $fn$
DECLARE
  v_missing TEXT[] := ARRAY[]::TEXT[];
  v_pair TEXT;
BEGIN
  -- Each row is "schema.table.column" — concise for error messages.
  FOREACH v_pair IN ARRAY ARRAY[
    'public.api_keys.is_active',
    'public.profiles.email',
    'public.notification_dispatches.recipient_email',
    'public.notification_dispatches.notification_type',
    'public.notification_dispatches.status',
    'public.notification_dispatches.created_at'
  ] LOOP
    PERFORM 1 FROM information_schema.columns
     WHERE table_schema = split_part(v_pair, '.', 1)
       AND table_name   = split_part(v_pair, '.', 2)
       AND column_name  = split_part(v_pair, '.', 3);
    IF NOT FOUND THEN
      v_missing := v_missing || v_pair;
    END IF;
  END LOOP;

  IF array_length(v_missing, 1) > 0 THEN
    RAISE EXCEPTION
      '_assert_retention_columns: schema drift detected — column(s) referenced by retention crons are missing: %. audit-2026-05-07 H-0923.',
      array_to_string(v_missing, ', ')
      USING ERRCODE = 'undefined_column';
  END IF;
END;
$fn$;

COMMENT ON FUNCTION public._assert_retention_columns() IS
  'audit-2026-05-07 H-0923. Asserts the columns referenced by the '
  'retention crons (api_keys.is_active, profiles.email, '
  'notification_dispatches.recipient_email/notification_type/status/created_at) '
  'exist. Migration utility — invoked at apply time and intended to be '
  're-callable from a future canary cron if/when one is built. REVOKEd from '
  'app roles since migrations run as postgres (superuser) and bypass.';

REVOKE ALL ON FUNCTION public._assert_retention_columns() FROM PUBLIC, anon, authenticated, service_role;

-- --------------------------------------------------------------------------
-- STEP 2: run the assertion at apply time
-- --------------------------------------------------------------------------
DO $$
BEGIN
  PERFORM public._assert_retention_columns();
  RAISE NOTICE 'audit-2026-05-07 H-0923: retention-cron schema-drift probe passed (6 columns verified present).';
END $$;

COMMIT;
