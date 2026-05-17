-- PR #182 retroactive audit follow-up (Task #57)
-- Closes: migration-reviewer MEDIUM #8 (conf 8) — GDPR case-sensitivity gap.
--
-- Source artifact:
--   /Users/helios-mammut/claude-projects/quantalyze/.review/retro-audit-pr182.migration-reviewer.jsonl  line 8
-- Source migration (already applied, do NOT edit):
--   supabase/migrations/20260516160100_sanitize_user_purge_notification_dispatches.sql line 158
--
-- Issue:
--   The applied 160100 sanitize_user body purges notification_dispatches via
--     DELETE FROM notification_dispatches WHERE recipient_email = v_target_email;
--   profiles.email and notification_dispatches.recipient_email are both TEXT
--   with no canonicalization (no citext, no lowercasing trigger, no CHECK).
--   Per RFC 5321 the domain portion of email is always case-insensitive and
--   the local-part is case-insensitive in practice (all mainstream MTAs).
--   GDPR Art. 17 requires immediate erasure of recipient PII on explicit
--   request.
--
--   If a notification was dispatched to 'User@Example.com' while the
--   profiles row stores 'user@example.com' (or vice versa), the case-
--   sensitive DELETE silently misses rows — the GDPR Art. 17 invariant the
--   parent migration claims is breached without a loud failure mode.
--
-- Fix:
--   Replace the case-sensitive DELETE inside sanitize_user with a
--   case-insensitive LOWER(...) match. The whole sanitize_user body is
--   reproduced verbatim from 20260516160100 (which itself is the
--   20260515210100 body with the M-0796 DELETE inserted) — only the
--   M-0796 DELETE line is changed.
--
-- Why CREATE OR REPLACE (not ALTER):
--   The function has multiple preserved invariants (advisory-lock,
--   sentinel-progress signal, audit emission, sole-admin orphan detection,
--   auth purge). The cleanest pattern is the whole-body CREATE OR REPLACE
--   that 20260516160100 uses; we reproduce that pattern with one line
--   changed for parity.
--
-- Idempotent: CREATE OR REPLACE preserves the existing REVOKE/GRANT ACL
-- via Postgres's same-(name,argtypes) ACL preservation. Defensive
-- REVOKE/GRANT reapplied at the end matching 20260516160100's posture.
--
-- Rollback: re-apply 20260516160100_sanitize_user_purge_notification_dispatches.sql
-- to restore the case-sensitive body. The case-sensitive body is GDPR-
-- compliant only if profiles.email and notification_dispatches.recipient_email
-- happen to share the same casing — operationally fragile, hence this fix.

BEGIN;
SET lock_timeout = '5s';

-- --------------------------------------------------------------------------
-- STEP 1: replace sanitize_user with case-insensitive recipient_email match
-- --------------------------------------------------------------------------
-- Body identical to 20260516160100 EXCEPT line marked "M-0796 + retro fix".
CREATE OR REPLACE FUNCTION public.sanitize_user(p_user_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_already_sanitized BOOLEAN;
  v_target_email      TEXT;
  v_orphan_count      INTEGER := 0;
  v_orphan_org_id     UUID;
BEGIN
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'sanitize_user: p_user_id is required'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  -- audit-2026-05-07 H-0900 (preserved): advisory lock so concurrent admin
  -- clicks serialize on the same user.
  PERFORM pg_advisory_xact_lock(hashtext('sanitize_user:' || p_user_id::text));

  -- mig 120 P911 (preserved): signal the sentinel-rejection triggers.
  PERFORM set_config('quantalyze.sanitize_in_progress', 'on', true);

  SELECT (display_name = '[deleted]') INTO v_already_sanitized
  FROM profiles WHERE id = p_user_id;

  IF v_already_sanitized IS NULL THEN
    RETURN FALSE;
  END IF;

  IF v_already_sanitized THEN
    RETURN FALSE;
  END IF;

  SELECT email INTO v_target_email FROM profiles WHERE id = p_user_id;

  -- audit-2026-05-07 H-0908 + H-0909 (preserved): sole-admin organization
  -- detection with audit emission.
  BEGIN
    FOR v_orphan_org_id IN
      SELECT om1.organization_id
        FROM organization_members om1
       WHERE om1.user_id = p_user_id
         AND om1.role IN ('owner', 'admin')
         AND NOT EXISTS (
           SELECT 1 FROM organization_members om2
            WHERE om2.organization_id = om1.organization_id
              AND om2.user_id <> p_user_id
              AND om2.role IN ('owner', 'admin')
         )
    LOOP
      PERFORM public.log_audit_event_service(
        p_user_id,
        'organization.orphaned_by_sanitize',
        'organization',
        v_orphan_org_id,
        jsonb_build_object(
          'reason',           'sole_admin_sanitized',
          'organization_id',  v_orphan_org_id,
          'sanitized_user_id', p_user_id
        )
      );
      v_orphan_count := v_orphan_count + 1;
    END LOOP;
  EXCEPTION
    WHEN unique_violation
      OR check_violation
      OR string_data_right_truncation
      OR numeric_value_out_of_range
      OR insufficient_privilege THEN
      RAISE NOTICE 'audit-2026-05-07 H-0908/H-0909: orphan-organization audit emission failed for user % (sqlstate=%, msg=%); sanitize continues',
        p_user_id, SQLSTATE, SQLERRM;
  END;

  UPDATE profiles SET
    display_name  = '[deleted]',
    company       = NULL,
    description   = NULL,
    email         = NULL,
    telegram      = NULL,
    website       = NULL,
    linkedin      = NULL,
    avatar_url    = NULL,
    bio           = NULL,
    years_trading = NULL,
    aum_range     = NULL,
    partner_tag   = NULL
  WHERE id = p_user_id
    AND display_name IS DISTINCT FROM '[deleted]';

  DELETE FROM api_keys WHERE user_id = p_user_id;

  UPDATE strategies SET
    name                 = '[deleted strategy]',
    description          = NULL,
    codename             = NULL,
    public_contact_email = NULL,
    partner_tag          = NULL,
    review_note          = NULL
  WHERE user_id = p_user_id
    AND name IS DISTINCT FROM '[deleted strategy]';

  UPDATE trades SET
    raw_data          = NULL,
    exchange_order_id = NULL,
    exchange_fill_id  = NULL
  WHERE strategy_id IN (SELECT id FROM strategies WHERE user_id = p_user_id)
    AND (raw_data IS NOT NULL OR exchange_order_id IS NOT NULL OR exchange_fill_id IS NOT NULL);

  IF v_target_email IS NOT NULL THEN
    DELETE FROM verification_requests WHERE email = v_target_email;

    -- audit-2026-05-07 M-0796 + PR #182 retro audit (Task #57): purge
    -- notification_dispatches rows keyed to the target user's email. The
    -- retention cron's 180d wall is too slow for GDPR Art. 17 — explicit
    -- erasure must remove recipient PII immediately. Filter by
    -- recipient_email (the only PII surface on notification_dispatches)
    -- instead of user_id (the table has no user_id column per mig
    -- 20260409002118). v_target_email is captured before the profiles
    -- UPDATE that nulls profiles.email.
    --
    -- Retro fix: case-insensitive LOWER(...) match. Per RFC 5321 email
    -- domain is always case-insensitive, and the local-part is case-
    -- insensitive in mainstream MTAs. A case-sensitive match could miss
    -- rows where profiles.email and notification_dispatches.recipient_email
    -- differ only in casing — silently breaching the GDPR Art. 17
    -- invariant this DELETE upholds.
    DELETE FROM notification_dispatches
     WHERE LOWER(recipient_email) = LOWER(v_target_email);
  END IF;

  UPDATE portfolios SET
    name        = '[deleted portfolio]',
    description = NULL
  WHERE user_id = p_user_id
    AND name IS DISTINCT FROM '[deleted portfolio]';

  DELETE FROM allocator_preferences WHERE user_id = p_user_id;
  DELETE FROM user_favorites        WHERE user_id = p_user_id;
  DELETE FROM user_notes            WHERE user_id = p_user_id;
  DELETE FROM investor_attestations WHERE user_id = p_user_id;
  DELETE FROM user_app_roles        WHERE user_id = p_user_id;
  DELETE FROM organization_members  WHERE user_id = p_user_id;

  DELETE FROM match_batches WHERE allocator_id = p_user_id;
  DELETE FROM organization_invites WHERE invited_by = p_user_id;

  UPDATE organizations
    SET created_by = NULL
    WHERE created_by = p_user_id
      AND created_by IS NOT NULL;

  DELETE FROM auth.refresh_tokens WHERE user_id::text = p_user_id::text;
  DELETE FROM auth.sessions       WHERE user_id = p_user_id;

  UPDATE auth.users SET
    email               = NULL,
    encrypted_password  = NULL,
    raw_user_meta_data  = '{}'::jsonb,
    raw_app_meta_data   = '{}'::jsonb,
    banned_until        = 'infinity'::timestamptz,
    email_confirmed_at  = NULL,
    phone               = NULL,
    phone_confirmed_at  = NULL
  WHERE id = p_user_id;

  -- audit-2026-05-07 H-0899 + H-0905 (preserved): emit the audit-of-the-sanitize.
  BEGIN
    PERFORM public.log_audit_event_service(
      p_user_id,
      'gdpr.sanitize_user',
      'profile',
      p_user_id,
      jsonb_build_object(
        'orphaned_organizations', v_orphan_count,
        'sanitize_path',          'sanitize_user_rpc',
        'completed_at',           now()
      )
    );
  EXCEPTION
    WHEN unique_violation
      OR check_violation
      OR string_data_right_truncation
      OR numeric_value_out_of_range
      OR insufficient_privilege THEN
      RAISE NOTICE 'audit-2026-05-07 H-0899/H-0905: sanitize audit emission failed for user % (sqlstate=%, msg=%); sanitize succeeded',
        p_user_id, SQLSTATE, SQLERRM;
  END;

  RETURN TRUE;
END;
$$;

COMMENT ON FUNCTION public.sanitize_user(UUID) IS
  'GDPR Art. 17 anonymize-not-delete RPC. SECURITY DEFINER. Idempotent. service_role-only EXECUTE. '
  'Migration 120 added sentinel-rejection trigger signaling, partner_tag NULLing, defensive '
  'organizations predicate, auth.users anonymize + session purge. audit-2026-05-07 H-0899/H-0900/'
  'H-0905/H-0908/H-0909 additions: pg_advisory_xact_lock serializes concurrent admin invocations, '
  'sole-admin organization detection emits orphan audit_log rows, the sanitize itself emits one '
  'audit_log row per successful run. audit-2026-05-07 M-0796: purges notification_dispatches '
  'keyed to the target email (GDPR Art. 17 immediate erasure of recipient PII). PR #182 retro '
  'audit (Task #57): recipient_email match uses LOWER(...) case-insensitivity per RFC 5321 to '
  'avoid silently missing rows when profiles.email and notification_dispatches.recipient_email '
  'differ only in casing.';

REVOKE ALL ON FUNCTION public.sanitize_user(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sanitize_user(UUID) TO service_role;

-- --------------------------------------------------------------------------
-- STEP 2: self-verifying DO block
-- --------------------------------------------------------------------------
DO $$
DECLARE
  v_body          TEXT;
  v_body_stripped TEXT;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO v_body
    FROM pg_proc p
    JOIN pg_namespace n ON p.pronamespace = n.oid
   WHERE n.nspname = 'public' AND p.proname = 'sanitize_user';

  IF v_body IS NULL THEN
    RAISE EXCEPTION 'PR #182 retro audit verification failed: sanitize_user not installed';
  END IF;

  -- Strip line-comments before live-statement probing.
  v_body_stripped := regexp_replace(v_body, '--[^\n]*', '', 'g');

  -- Retro fix: live DELETE on notification_dispatches uses LOWER(...) on
  -- BOTH sides of the recipient_email comparison.
  IF v_body_stripped !~* 'DELETE\s+FROM\s+notification_dispatches\s+WHERE\s+LOWER\s*\(\s*recipient_email\s*\)\s*=\s*LOWER\s*\(\s*v_target_email\s*\)' THEN
    RAISE EXCEPTION 'PR #182 retro audit verification failed: sanitize_user body lacks case-insensitive LOWER(recipient_email) = LOWER(v_target_email) DELETE';
  END IF;

  -- Preservation gates from 20260516160100 — re-assert all live probes.
  IF v_body_stripped NOT LIKE '%pg_advisory_xact_lock%' THEN
    RAISE EXCEPTION 'PR #182 retro audit verification failed: sanitize_user lost H-0900 advisory lock';
  END IF;
  IF v_body_stripped !~* 'PERFORM\s+public\.log_audit_event_service[^;]*''gdpr\.sanitize_user''' THEN
    RAISE EXCEPTION 'PR #182 retro audit verification failed: sanitize_user lost H-0899/H-0905 audit emission';
  END IF;
  IF v_body_stripped NOT LIKE '%organization.orphaned_by_sanitize%' THEN
    RAISE EXCEPTION 'PR #182 retro audit verification failed: sanitize_user lost H-0908/H-0909 sole-admin loop';
  END IF;
  IF v_body_stripped NOT LIKE '%quantalyze.sanitize_in_progress%' THEN
    RAISE EXCEPTION 'PR #182 retro audit verification failed: sanitize_user lost mig 120 sentinel-progress signal';
  END IF;
  IF v_body_stripped NOT LIKE '%auth.refresh_tokens%' THEN
    RAISE EXCEPTION 'PR #182 retro audit verification failed: sanitize_user lost mig 120 auth purge';
  END IF;

  -- Re-assert PUBLIC EXECUTE absence (mig 134 helper).
  PERFORM public._assert_no_public_execute('public.sanitize_user(uuid)');
END $$;

COMMIT;
