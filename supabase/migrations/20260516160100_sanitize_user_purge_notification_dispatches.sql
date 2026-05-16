-- audit-2026-05-07 mitigation
-- Closes: M-0796 (code-reviewer c8)
-- Source file: supabase/migrations/20260417110538_sanitize_user.sql (was 055)
-- Issue: sanitize_user matrix declares notification_dispatches PRESERVE
--   "rely on the 180d retention cron to expire PII", but GDPR Art. 17
--   requires immediate erasure of recipient PII on request — a 180d
--   delay leaves email visible to admins for up to 6 months after the
--   explicit deletion request.
-- Mitigation: extend the sanitize_user RPC body to add
--     `DELETE FROM notification_dispatches WHERE recipient_email = v_target_email;`
--   before the auth.users anonymize step. Preserves all behaviors from
--   the 20260515210100 high-hardening migration verbatim — only the
--   notification_dispatches DELETE is added.
--
-- The function signature is unchanged. CREATE OR REPLACE preserves the
-- existing REVOKE/GRANT ACL because Postgres preserves ACLs across
-- replaces of the same (name, argtypes). REVOKE/GRANT is reapplied
-- defensively at the end to match the prior migration's posture.
--
-- Idempotent: the DELETE has a WHERE filter that is empty after the
-- first run for the same user. Re-applying this migration replaces the
-- function body verbatim.
--
-- Rollback: re-apply 20260515210100_sanitize_user_high_hardening.sql
-- to restore the prior body (it does NOT include the notification_dispatches
-- DELETE).

BEGIN;
SET lock_timeout = '5s';

-- --------------------------------------------------------------------------
-- STEP 1: replace sanitize_user with the notification_dispatches purge step
-- --------------------------------------------------------------------------
-- The body below is the 20260515210100_sanitize_user_high_hardening.sql
-- body verbatim, with the new DELETE statement inserted after the
-- verification_requests DELETE and before the portfolios UPDATE. Comment
-- markers `-- audit-2026-05-07 M-0796` flag the additions.
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

    -- audit-2026-05-07 M-0796: purge notification_dispatches rows keyed to
    -- the target user's email. The retention cron's 180d wall is too slow
    -- for GDPR Art. 17 — explicit erasure must remove recipient PII
    -- immediately. Filter by recipient_email (the only PII surface on
    -- notification_dispatches) instead of user_id (the table has no
    -- user_id column per mig 20260409002118). v_target_email is captured
    -- before the profiles UPDATE that nulls profiles.email.
    DELETE FROM notification_dispatches WHERE recipient_email = v_target_email;
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
  'keyed to the target email (GDPR Art. 17 immediate erasure of recipient PII).';

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
    RAISE EXCEPTION 'audit-2026-05-07 M-0796 verification failed: sanitize_user not installed';
  END IF;

  -- Strip line-comments before live-statement probing.
  v_body_stripped := regexp_replace(v_body, '--[^\n]*', '', 'g');

  -- M-0796: live DELETE on notification_dispatches keyed to recipient_email
  IF v_body_stripped !~* 'DELETE\s+FROM\s+notification_dispatches\s+WHERE\s+recipient_email' THEN
    RAISE EXCEPTION 'audit-2026-05-07 M-0796 verification failed: sanitize_user body lacks live DELETE FROM notification_dispatches WHERE recipient_email';
  END IF;

  -- Preservation gates from 20260515210100 — re-assert all live probes.
  IF v_body_stripped NOT LIKE '%pg_advisory_xact_lock%' THEN
    RAISE EXCEPTION 'audit-2026-05-07 M-0796 verification failed: sanitize_user lost H-0900 advisory lock';
  END IF;
  IF v_body_stripped !~* 'PERFORM\s+public\.log_audit_event_service[^;]*''gdpr\.sanitize_user''' THEN
    RAISE EXCEPTION 'audit-2026-05-07 M-0796 verification failed: sanitize_user lost H-0899/H-0905 audit emission';
  END IF;
  IF v_body_stripped NOT LIKE '%organization.orphaned_by_sanitize%' THEN
    RAISE EXCEPTION 'audit-2026-05-07 M-0796 verification failed: sanitize_user lost H-0908/H-0909 sole-admin loop';
  END IF;
  IF v_body_stripped NOT LIKE '%quantalyze.sanitize_in_progress%' THEN
    RAISE EXCEPTION 'audit-2026-05-07 M-0796 verification failed: sanitize_user lost mig 120 sentinel-progress signal';
  END IF;
  IF v_body_stripped NOT LIKE '%auth.refresh_tokens%' THEN
    RAISE EXCEPTION 'audit-2026-05-07 M-0796 verification failed: sanitize_user lost mig 120 auth purge';
  END IF;

  -- Re-assert PUBLIC EXECUTE absence (mig 134 helper).
  PERFORM public._assert_no_public_execute('public.sanitize_user(uuid)');
END $$;

COMMIT;
