-- Migration: sanitize_user HIGH hardening (audit-2026-05-07 H-pass on mig 055)
--
-- Audit findings addressed: H-0899, H-0900, H-0903, H-0905, H-0908, H-0909.
--
-- Why this migration exists
-- -------------------------
-- The audit-2026-05-07 H-pass on supabase/migrations/055_sanitize_user.sql
-- identified six SQL-actionable HIGH defects beyond what migrations
-- 057 / 120 closed in the prior remediation rounds:
--
--   * H-0899 (silent-failure-hunter c9) + H-0905 (security c8): the
--     GDPR Art. 17 anonymize RPC emits ZERO audit_log rows describing
--     its own action. The most forensically critical event in the
--     system is therefore unaudited — a hostile admin invoking the
--     service-role RPC against another user leaves no append-only
--     forensic record.
--   * H-0900 (code-reviewer c8): the idempotency probe and the
--     anonymize UPDATEs are not atomic at the row-lock layer. Two
--     concurrent admin-triggered sanitize calls (double-click, queued
--     retry) both observe `display_name <> '[deleted]'` and both
--     execute the full destruction sequence. The DELETEs are idempotent
--     but the audit attribution becomes ambiguous and the function
--     performs double work.
--   * H-0903 (red-team c8): migration 055 added
--     `idx_deletion_requests_pending_v2` filtered on
--     `completed_at IS NULL AND rejected_at IS NULL` but never DROPped
--     the original `idx_deletion_requests_pending` (migration 012)
--     filtered on `completed_at IS NULL` only. The two partial indexes
--     cover overlapping ranges; the planner can pick either, and admin
--     queries that SELECT pending rows risk including rejected ones
--     depending on which index the planner chose.
--   * H-0908 (red-team c7) + H-0909 (security c7): the sanitize body
--     blindly DELETEs from organization_members WHERE user_id = p_user_id
--     and sets organizations.created_by = NULL — but does NOT check
--     whether the target was the sole admin/owner of any organization.
--     The org persists as a zombie with no owner row, no admin member,
--     and (per Sprint 7 RLS policies) becomes invisible or silently
--     editable depending on default-deny inversion. The user's GDPR
--     request is honored at the cost of orphaning every org they
--     uniquely admin'd.
--
-- Items NOT in this migration
-- ---------------------------
--   * H-0895 / H-0896 / H-0904 (Vercel timeout DoS via large trades
--     UPDATE): architectural — requires moving the route handler to a
--     background job runner (compute_jobs queue is the obvious target).
--     Not a SQL-only forward migration.
--   * H-0897 / H-0898 ([deleted] sentinel poison): CLOSED by migration
--     120 (sentinel-rejection triggers on profiles / strategies /
--     portfolios).
--   * H-0901 (055 hard-fails without 057): CLOSED by migration 120 +
--     057 (organizations.created_by DROP NOT NULL + defensive predicate).
--   * H-0902 / H-0907 (CHAIN-19 / CHAIN-23 audit-trail bookkeeping):
--     partially addressed here via STEP 4 (sanitize emits its own
--     audit row). The cross-system identity-leak gaps cited by the
--     red-team are out of scope for SQL.
--   * H-0906 (schema-drift defensive INFORMATION_SCHEMA probe):
--     marginal value — every CREATE OR REPLACE already raises if any
--     referenced column is missing.
--
-- What this migration ships
-- -------------------------
-- 1. DROP the legacy `idx_deletion_requests_pending` partial index
--    (H-0903) so admin queries can only land on the v2 index that
--    correctly excludes rejected rows.
-- 2. CREATE OR REPLACE `public.sanitize_user(p_user_id UUID)` with
--    four behavioral additions, ALL preserving the migration-120 body:
--    (a) pg_advisory_xact_lock(hashtext('sanitize_user:' || p_user_id))
--        at function entry so concurrent invocations serialize on the
--        same advisory key. SET LOCAL still wires the sentinel flag.
--    (b) Sole-admin guard: a SELECT against organization_members for
--        the target user identifies any organization where the user is
--        the SOLE remaining admin/owner. Each such organization gets
--        an audit_log row marking it 'organization.orphaned_by_sanitize'
--        so a downstream operator can follow up — the org is NOT
--        force-deleted (data preservation is the GDPR default for
--        third-party data) but the orphan state is observable.
--    (c) log_audit_event_service emits one 'gdpr.sanitize_user' row
--        per successful sanitize attributed to the target user. This
--        is the audit-of-the-anonymize record P919 (mig 123) was
--        designed to support and the GDPR forensic trail demands.
--    (d) The successful-sanitize path returns the same BOOLEAN as
--        before (TRUE on first sanitize, FALSE on re-run). Signature
--        unchanged: callers in src/app/api/admin/* continue to work.
--
-- Idempotency
-- -----------
-- * DROP INDEX IF EXISTS — re-apply is a no-op once dropped.
-- * CREATE OR REPLACE FUNCTION — re-apply replaces the body verbatim.
-- * pg_advisory_xact_lock auto-releases at transaction end (commit or
--   rollback), so a function-exception path cannot leave a lock held.
-- * The audit_log emission failure is wrapped in BEGIN/EXCEPTION/END;
--   if log_audit_event_service is unreachable (e.g., during a partial
--   apply of mig 123) we RAISE NOTICE rather than re-RAISE, so a stuck
--   audit emitter never blocks GDPR compliance.
--
-- Rollback
-- --------
-- supabase/migrations/down/20260515210100-rollback.sql restores the
-- migration-120 sanitize_user body and recreates the legacy index.

BEGIN;
SET lock_timeout = '5s';

-- --------------------------------------------------------------------------
-- STEP 1: H-0903 — drop the legacy idx_deletion_requests_pending
-- --------------------------------------------------------------------------
-- Migration 012 created the v1 index `idx_deletion_requests_pending`
-- with `WHERE completed_at IS NULL`. Migration 055 added the v2 index
-- `idx_deletion_requests_pending_v2` with the correct
-- `WHERE completed_at IS NULL AND rejected_at IS NULL` predicate, but
-- never dropped the v1. The two partial indexes have overlapping
-- coverage; the planner can choose either. Drop the v1 so all admin-
-- pending COUNT(*) queries land on v2 unambiguously.
--
-- Defensive: only drop if v2 exists. If v2 went missing (manual
-- intervention / partial replay), keep v1 as the safety net rather
-- than leaving the table with no partial index for pending lookups.
DO $$
DECLARE
  v_has_v2 BOOLEAN;
BEGIN
  SELECT EXISTS(
    SELECT 1 FROM pg_indexes
     WHERE schemaname = 'public'
       AND tablename = 'data_deletion_requests'
       AND indexname = 'idx_deletion_requests_pending_v2'
  ) INTO v_has_v2;

  IF v_has_v2 THEN
    DROP INDEX IF EXISTS public.idx_deletion_requests_pending;
    RAISE NOTICE 'audit-2026-05-07 H-0903: dropped legacy idx_deletion_requests_pending (v2 partial index is the canonical pending index)';
  ELSE
    RAISE NOTICE 'audit-2026-05-07 H-0903: idx_deletion_requests_pending_v2 missing — kept legacy v1 as fallback. Run migration 055 to install v2.';
  END IF;
END $$;

-- --------------------------------------------------------------------------
-- STEP 2: sanitize_user — advisory lock + sole-admin guard + audit emission
-- --------------------------------------------------------------------------
-- Body preserved from migration 120 verbatim except for the four
-- behavioral additions noted in the header. The migration-120 sentinel-
-- progress SET LOCAL is preserved (the sentinel-rejection triggers
-- depend on it). The migration-120 partner_tag NULLing, organizations
-- defensive predicate, and auth.users anonymize are preserved verbatim.
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

  -- audit-2026-05-07 H-0900: advisory lock so concurrent admin clicks
  -- (or queued retries) serialize on the same user. hashtext() of a
  -- scoped key keeps the lock space distinct from any other advisory
  -- lock in the codebase. The lock auto-releases at transaction end
  -- regardless of which path returns.
  PERFORM pg_advisory_xact_lock(hashtext('sanitize_user:' || p_user_id::text));

  -- mig 120 P911: signal the sentinel-rejection triggers that this
  -- transaction is the sanitize path. SET LOCAL is transaction-scoped.
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

  -- audit-2026-05-07 H-0908 + H-0909: detect organizations the target
  -- user is the SOLE owner/admin of BEFORE deleting their organization_members
  -- row. Each match emits an audit_log row marking the org as orphaned
  -- so an operator can follow up (transfer ownership, archive the org,
  -- or hard-delete with consent of the remaining members). We do NOT
  -- force-delete the org — the third-party content belongs to the
  -- remaining members under GDPR data-preservation rules.
  --
  -- "Sole admin" is computed as: row in organization_members where
  -- (organization_id, user_id=p_user_id, role IN ('owner','admin')) exists AND
  -- no other (organization_id, user_id<>p_user_id, role IN ('owner','admin'))
  -- exists. Both 'owner' and 'admin' carry administrative authority per the
  -- CHECK on organization_members.role in 20260405180928_organizations.sql.
  --
  -- Fail-soft: the orphan-emission is wrapped in BEGIN/EXCEPTION so a
  -- failed audit insert never blocks the GDPR sanitize. The trap is
  -- NARROW: only the SQLSTATEs that legitimately fire from the
  -- log_audit_event_service body (role-gate rejection, audit_log shape /
  -- size violations) are swallowed. Schema-drift errors such as
  -- 42703 undefined_column or 42P01 undefined_table propagate so a
  -- future column rename surfaces loudly at apply or runtime instead
  -- of silently no-opping the orphan emission (see Q#2 / Q#3
  -- audit-A findings).
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
      -- audit-2026-05-07 SFT #8 (Phase B): mark the transaction so a
      -- caller doing post-call introspection can detect partial
      -- success without changing the BOOLEAN return contract.
      PERFORM set_config('quantalyze.sanitize_user.audit_emit_failed', 'true', true);
  END;

  -- mig 120 P914: NULL profiles.partner_tag in addition to existing columns.
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

  -- mig 120 P913: defensive predicate against the 057 ordering hazard.
  UPDATE organizations
    SET created_by = NULL
    WHERE created_by = p_user_id
      AND created_by IS NOT NULL;

  -- mig 120 P916: revoke sessions + anonymize auth.users.
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

  -- audit-2026-05-07 H-0899 + H-0905: emit the audit-of-the-sanitize.
  -- log_audit_event_service is the canonical service-role audit RPC
  -- (mig 058 + mig 123 hardening). Attributing the row to p_user_id
  -- preserves subject linkage even after the auth.users anonymize.
  -- entity_type='profile' + entity_id=p_user_id matches the convention
  -- the existing audit_log readers use.
  --
  -- Fail-soft: same pattern as the org-orphan emission above. A failed
  -- audit emission does NOT roll back the GDPR sanitize — half-
  -- anonymized is worse than missing-audit.
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
      -- Narrow trap (see Q#3 audit-A finding): swallow only audit-shape /
      -- size / role-gate failures so the GDPR sanitize completes; schema-
      -- drift errors (42703 undefined_column / 42P01 undefined_table /
      -- 42883 undefined_function) propagate so they surface loudly.
      RAISE NOTICE 'audit-2026-05-07 H-0899/H-0905: sanitize audit emission failed for user % (sqlstate=%, msg=%); sanitize succeeded',
        p_user_id, SQLSTATE, SQLERRM;
      -- audit-2026-05-07 SFT #8 (Phase B): mark the transaction so a
      -- caller doing post-call introspection can detect partial
      -- success without changing the BOOLEAN return contract.
      PERFORM set_config('quantalyze.sanitize_user.audit_emit_failed', 'true', true);
  END;

  RETURN TRUE;
END;
$$;

COMMENT ON FUNCTION public.sanitize_user(UUID) IS
  'GDPR Art. 17 anonymize-not-delete RPC. SECURITY DEFINER. Idempotent. service_role-only EXECUTE. '
  'Migration 120 added sentinel-rejection trigger signaling, partner_tag NULLing, defensive '
  'organizations predicate, auth.users anonymize + session purge. audit-2026-05-07 H-0899 / '
  'H-0900 / H-0905 / H-0908 / H-0909 additions: pg_advisory_xact_lock serializes concurrent '
  'admin invocations; sole-admin organization detection emits orphan audit_log rows; the '
  'sanitize itself emits one audit_log row per successful run. See migrations 055, 120, plus '
  'this migration (20260515210100). Partial-success observability (audit-2026-05-07 SFT #8): '
  'when an audit_log emission fails-soft the function sets '
  'quantalyze.sanitize_user.audit_emit_failed=true in the transaction-scoped GUC; the caller '
  'can SELECT current_setting(''quantalyze.sanitize_user.audit_emit_failed'', true) '
  'after invocation and trigger a manual audit replay if the value is ''true''.';

REVOKE ALL ON FUNCTION public.sanitize_user(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sanitize_user(UUID) TO service_role;

-- --------------------------------------------------------------------------
-- STEP 3: self-verifying DO block
-- --------------------------------------------------------------------------
DO $$
DECLARE
  v_body        TEXT;
  v_legacy_idx  BOOLEAN;
BEGIN
  -- H-0903: legacy index dropped (or kept as fallback if v2 missing)
  SELECT EXISTS(
    SELECT 1 FROM pg_indexes
     WHERE schemaname = 'public'
       AND tablename = 'data_deletion_requests'
       AND indexname = 'idx_deletion_requests_pending'
  ) INTO v_legacy_idx;

  -- The DROP is conditional on v2's presence (STEP 1's DO block). Only
  -- raise if v2 IS present AND v1 still exists; otherwise the kept-as-
  -- fallback path is intentional.
  IF v_legacy_idx AND EXISTS(
    SELECT 1 FROM pg_indexes
     WHERE schemaname = 'public'
       AND tablename = 'data_deletion_requests'
       AND indexname = 'idx_deletion_requests_pending_v2'
  ) THEN
    RAISE EXCEPTION 'audit-2026-05-07 H-0903 verification failed: idx_deletion_requests_pending (v1) coexists with v2';
  END IF;

  -- Body shape: advisory lock + sole-admin loop + audit emissions
  SELECT pg_get_functiondef(p.oid) INTO v_body
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'sanitize_user';

  IF v_body IS NULL THEN
    RAISE EXCEPTION 'audit-2026-05-07: sanitize_user function not found';
  END IF;
  IF v_body NOT LIKE '%pg_advisory_xact_lock%' THEN
    RAISE EXCEPTION 'audit-2026-05-07 H-0900 verification failed: sanitize_user body lacks pg_advisory_xact_lock';
  END IF;
  -- audit-2026-05-07 PTA #2 / SFT #6 (Phase B): match the LITERAL
  -- 'gdpr.sanitize_user' only when it appears inside a PERFORM call
  -- to log_audit_event_service. The earlier substring probe matched
  -- the NOTICE message and comments too, so a refactor that
  -- commented out the PERFORM would pass.
  IF v_body !~* 'PERFORM\s+public\.log_audit_event_service[^;]*''gdpr\.sanitize_user''' THEN
    RAISE EXCEPTION 'audit-2026-05-07 H-0899/H-0905 verification failed: gdpr.sanitize_user audit emission not present as a live PERFORM log_audit_event_service call';
  END IF;
  IF v_body NOT LIKE '%organization.orphaned_by_sanitize%' THEN
    RAISE EXCEPTION 'audit-2026-05-07 H-0908/H-0909 verification failed: sanitize_user body lacks sole-admin orphan detection';
  END IF;
  -- Regression gate for the Q#2 audit-A finding: the original body
  -- referenced organization_members.org_id (non-existent column),
  -- causing 42703 at runtime which the WHEN OTHERS trap swallowed and
  -- silently no-opped every orphan-emission. The substring probe above
  -- ('organization.orphaned_by_sanitize') passed because the action
  -- string was still present in the body — the probe is shape-only.
  -- Assert the loop binds to the real column name AND to the broadened
  -- role filter so a future copy-edit cannot reintroduce the silent
  -- failure.
  IF v_body NOT LIKE '%om1.organization_id%' THEN
    RAISE EXCEPTION 'audit-2026-05-07 H-0908/H-0909 verification failed: sole-admin loop does not reference organization_members.organization_id (regression to org_id?)';
  END IF;
  IF v_body NOT LIKE '%role IN (''owner'', ''admin'')%' THEN
    RAISE EXCEPTION 'audit-2026-05-07 H-0908/H-0909 verification failed: sole-admin loop role filter must include both owner AND admin';
  END IF;
  -- Pre-flight: organization_members.organization_id column must exist.
  -- Catches schema drift at apply time instead of letting it explode
  -- silently inside the loop (which is the exact failure mode the
  -- audit-A Q#2 finding identified).
  PERFORM 1 FROM information_schema.columns
   WHERE table_schema = 'public'
     AND table_name = 'organization_members'
     AND column_name = 'organization_id';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'audit-2026-05-07 sanitize_user pre-flight failed: organization_members.organization_id column missing';
  END IF;
  -- Preservation gate — mig 120 sentinel + partner_tag + auth purge
  IF v_body NOT LIKE '%quantalyze.sanitize_in_progress%' THEN
    RAISE EXCEPTION 'audit-2026-05-07: sanitize_user lost mig 120 sentinel-progress signal';
  END IF;
  IF v_body NOT LIKE '%partner_tag   = NULL%' THEN
    RAISE EXCEPTION 'audit-2026-05-07: sanitize_user lost mig 120 partner_tag NULLing';
  END IF;
  IF v_body NOT LIKE '%auth.refresh_tokens%' THEN
    RAISE EXCEPTION 'audit-2026-05-07: sanitize_user lost mig 120 auth purge';
  END IF;
  -- audit-2026-05-07 R#3: sanitize_user is SECURITY DEFINER + REVOKEd
  -- from PUBLIC/anon/authenticated above. Re-assert PUBLIC absence via
  -- the mig 134 / C-0284 helper so any future inadvertent re-grant
  -- aborts the migration.
  PERFORM public._assert_no_public_execute('public.sanitize_user(uuid)');
END $$;

COMMIT;
