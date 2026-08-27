-- ============================================================================
-- Migration: sanitize_user revokes the data subject's strategy share links
-- Phase 164 / Plan 164-02 — companion to
--   20260827120000_strategy_shares_generation_model.sql
-- Closes: BLOCKER B1 (review of 20260827120000, 2026-08-27). Founder ruling
--   the same day: fix it with a COMPANION migration, inside THIS phase.
-- ============================================================================
--
-- THE DEFECT
-- ---------------------------------------------------------------------------
-- 20260827120000 introduced `strategy_shares` — one row per strategy holding a
-- `generation` counter from which an anonymous capability URL to an UNPUBLISHED
-- factsheet is derived. Its header claimed `sanitize_user` needed no new arm
-- because both FKs are `ON DELETE CASCADE`. That claim was FALSE, and it was
-- verified false by reading the live body rather than inferred:
--
--   latest definition = 20260517013100_sanitize_user_recipient_email_case_insensitive.sql
--     UPDATE profiles / UPDATE strategies / UPDATE auth.users  -> anonymize
--     DELETE FROM profiles    -> 0 occurrences
--     DELETE FROM auth.users  -> 0 occurrences
--     strategy_shares         -> 0 occurrences
--
-- `sanitize_user` is an ANONYMIZE-not-DELETE RPC by design (see its own
-- COMMENT). Nothing is deleted, so NO cascade ever fires, so the share rows
-- survive untouched. After a GDPR Art. 17 erasure every link the data subject
-- ever minted keeps resolving: anonymous access to their unpublished factsheet,
-- with the returns curve, the metrics and the trade analytics all surviving the
-- anonymize (those live on `strategies` / `trades` / `strategy_analytics`, none
-- of which the anonymize empties).
--
-- ⛔ AND THE SUBJECT CANNOT SELF-REMEDY. The same function sets
-- `banned_until = 'infinity'` and deletes `auth.sessions` /
-- `auth.refresh_tokens`, so they can never log back in to press Revoke. The
-- erasure request is the LAST action they can take; it therefore has to be the
-- action that kills the links.
--
-- THE FIX — REVOKE, NEVER DELETE
-- ---------------------------------------------------------------------------
-- ONE statement added beside the other user-owned purges:
--
--   UPDATE strategy_shares
--      SET revoked_at = now(), generation = generation + 1
--    WHERE created_by = p_user_id AND revoked_at IS NULL;
--
-- ⛔ It must be a REVOKE and not a DELETE, for exactly the reason
-- 20260827120000 STEP 2 refuses to grant `authenticated` any DELETE: deleting
-- the row discards the counter, so the next `create_strategy_share()` for that
-- strategy inserts a fresh row at generation = 1 — and every token ever minted
-- at generation 1, including ones already revoked, starts working again. A hard
-- delete here would turn the erasure path into a token-RESURRECTION path. The
-- row is not PII (a uuid, an int and two timestamps — D-02 guarantees no token
-- is stored), so retaining it costs the subject nothing and protects them.
--
-- `revoked_at IS NULL` keeps the arm convergent: re-running sanitize_user (it
-- is idempotent, and the retention cron may) must not keep inflating counters
-- on rows that are already dead.
--
-- `created_by = p_user_id` scopes it to the subject. sanitize_user is SECURITY
-- DEFINER owned by the table owner, so RLS is not applied to this statement and
-- the predicate is the ONLY scope there is.
--
-- WHY CREATE OR REPLACE OF THE WHOLE BODY (the house rule)
-- ---------------------------------------------------------------------------
-- Re-base-on-latest-definition: `grep -rn "FUNCTION public.sanitize_user"
-- supabase/migrations/` returns seven definitions; the newest by filename
-- ordering is 20260517013100. The body below is reproduced VERBATIM from that
-- file with exactly ONE statement added (marked "Phase 164 / B1") and the
-- COMMENT extended. Nothing else changes — the advisory lock, the
-- sentinel-progress signal, the sole-admin orphan audit loop, the
-- case-insensitive notification_dispatches purge and the auth purge are all
-- carried forward byte-for-byte, and STEP 2 below re-asserts each one against
-- the LIVE definition so a transcription slip aborts this apply.
--
-- GDPR EXPORT-COVERAGE COUPLING (do not rename this file casually)
-- ---------------------------------------------------------------------------
-- `scanSanitizeUserCoverage()` in scripts/check-gdpr-export-coverage.ts only
-- reads migrations whose FILENAME matches /sanitize_user/i, then harvests
-- `UPDATE <table>` / `DELETE FROM <table>` statements and `-- <table> | <STRATEGY>`
-- matrix rows out of them. The `sanitize_user` substring in this filename is
-- therefore load-bearing: it is what makes `strategy_shares` count as covered
-- by the Art. 17 side of the Art. 15/17 parity gate. ⚠️ Consequence for the
-- manifest work: with this migration in place `strategy_shares` needs NO
-- `SANITIZE_PARITY_ALLOWLIST` entry — it has a real erasure policy now, which
-- is strictly better than an allowlist entry claiming it does not need one.
--
-- APPLY FLOW — identical to its companion. Applied by NOTHING at authoring
-- time; hand-applied to TEST at the 164-02 blocking checkpoint (AFTER
-- 20260827120000, which creates the table this body references), then applied
-- to PRODUCTION automatically by the Supabase Migrate workflow on merge to
-- main. ⛔ This file MUST sort after 20260827120000 — it does (130000 > 120000)
-- — or the CREATE OR REPLACE would reference a table that does not exist yet.
--
-- Rollback: re-apply
-- 20260517013100_sanitize_user_recipient_email_case_insensitive.sql to restore
-- the body without the share-revoke arm. ⚠️ Doing so re-opens B1.
-- ============================================================================

BEGIN;
SET lock_timeout = '5s';

-- --------------------------------------------------------------------------
-- STEP 1: sanitize_user + the strategy_shares revoke arm
-- --------------------------------------------------------------------------
-- sanitize_user coverage matrix row (read by scripts/check-gdpr-export-coverage.ts):
-- strategy_shares | ANONYMIZE | revoke-in-place. revoked_at stamped and generation
--   bumped for every live row the subject created, which kills every capability URL
--   derived from the old counter. The row itself is RETAINED deliberately: it holds
--   no PII (uuid + int + timestamps, D-02 guarantees no token at rest) and deleting
--   it would rewind the counter and resurrect the very links this arm just killed.
--
-- Body identical to 20260517013100 EXCEPT the block marked "Phase 164 / B1".
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

  -- Phase 164 / B1 (2026-08-27) — kill every share link the subject minted.
  -- `strategy_shares` (migration 20260827120000) holds a `generation` counter
  -- from which an anonymous capability URL to an UNPUBLISHED factsheet is
  -- derived in Node. The anonymize above does NOT empty the factsheet, and
  -- neither FK cascade fires here because this function deletes neither
  -- `profiles` nor `auth.users` — so without this statement every link the
  -- subject ever handed out keeps working forever after their Art. 17 erasure,
  -- and the `banned_until = 'infinity'` below means they can never log back in
  -- to revoke it themselves.
  --
  -- Bumping `generation` is what actually kills the links: the token is
  -- HMAC(secret, strategy_id || generation), so +1 invalidates every url ever
  -- copied, at once. Stamping `revoked_at` alone would be COSMETIC.
  --
  -- REVOKE, NEVER DELETE. A delete discards the counter; the next mint for that
  -- strategy would restart at generation 1 and RESURRECT every token minted at
  -- generation 1, including ones already revoked. The row holds no PII, so
  -- retaining it costs the subject nothing.
  UPDATE strategy_shares
     SET revoked_at = now(),
         generation = generation + 1
   WHERE created_by = p_user_id
     AND revoked_at IS NULL;

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
  'differ only in casing. Phase 164 / B1: REVOKES every live strategy_shares row the subject '
  'created (revoked_at stamped + generation bumped), because this function deletes neither '
  'profiles nor auth.users, so NO FK cascade fires and every anonymous capability URL to the '
  'subject''s unpublished factsheet would otherwise outlive the erasure — with no way for the '
  'subject to revoke it themselves, since this same body bans them and purges their sessions. '
  'The share row is retained, never deleted: it holds no token (D-02), and deleting it would '
  'rewind the generation counter and resurrect the links this arm just killed.';

REVOKE ALL ON FUNCTION public.sanitize_user(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sanitize_user(UUID) TO service_role;

-- --------------------------------------------------------------------------
-- STEP 2: self-verifying DO block
-- --------------------------------------------------------------------------
-- ⚠️ Scope, stated honestly: a DO block runs ONCE, at this apply. It guards
-- THIS apply against a transcription slip in the ~200-line body reproduced
-- above (the real risk of the whole-body CREATE OR REPLACE house pattern) and
-- against a concurrently-applied migration having redefined sanitize_user
-- first. It cannot reach forward and fail some future loosening's apply. The
-- DURABLE pin for the new arm is the SANITIZE block in
-- supabase/tests/test_strategy_shares_rls.sql, which exercises the real
-- function against the live database on every CI run.
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
    RAISE EXCEPTION 'Phase 164 / B1 verification failed: sanitize_user not installed';
  END IF;

  -- ⛔ Strip line-comments before EVERY live-statement probe. pg_get_functiondef
  -- returns in-body comments verbatim, and the block above describes the new
  -- arm in prose at length — an unstripped regex would be satisfied by the
  -- COMMENT ALONE and would stay green with the statement deleted. This repo
  -- has been bitten by exactly that; 20260517013100 STEP 2 carries the same
  -- guard, and the pre-flight comparison of the PROD vs TEST 7-param
  -- enqueue body turned on the identical distinction.
  v_body_stripped := regexp_replace(v_body, '--[^\n]*', '', 'g');

  -- Phase 164 / B1: the LIVE statement revokes the subject's share links.
  IF v_body_stripped !~* 'UPDATE\s+(?:public\.)?strategy_shares\s+SET\s+revoked_at\s*=\s*now\s*\(\s*\)\s*,\s*generation\s*=\s*generation\s*\+\s*1\s+WHERE\s+created_by\s*=\s*p_user_id\s+AND\s+revoked_at\s+IS\s+NULL' THEN
    RAISE EXCEPTION 'Phase 164 / B1 verification failed: sanitize_user lacks the live `UPDATE strategy_shares SET revoked_at = now(), generation = generation + 1 WHERE created_by = p_user_id AND revoked_at IS NULL` arm. Neither FK cascade fires here (this function deletes neither profiles nor auth.users), so every anonymous capability URL the data subject minted would survive their GDPR Art. 17 erasure — and banned_until = infinity means they can never log back in to revoke it themselves.';
  END IF;

  -- ...and it must be a REVOKE, not a DELETE. A delete rewinds the counter and
  -- the next mint at generation 1 resurrects every already-revoked token.
  IF v_body_stripped ~* '\mDELETE\s+FROM\s+(?:public\.)?strategy_shares\M' THEN
    RAISE EXCEPTION 'Phase 164 / B1 verification failed: sanitize_user DELETEs from strategy_shares. Erasure must SOFT-revoke: a delete discards the generation counter, so the next create_strategy_share() restarts at generation 1 and every token minted at generation 1 — including revoked ones — starts working again.';
  END IF;

  -- Preservation gates carried forward from 20260517013100 — re-assert every
  -- one, because the whole-body CREATE OR REPLACE above could silently drop any
  -- of them via a transcription slip.
  IF v_body_stripped !~* 'DELETE\s+FROM\s+notification_dispatches\s+WHERE\s+LOWER\s*\(\s*recipient_email\s*\)\s*=\s*LOWER\s*\(\s*v_target_email\s*\)' THEN
    RAISE EXCEPTION 'Phase 164 / B1 verification failed: sanitize_user lost the case-insensitive LOWER(recipient_email) = LOWER(v_target_email) DELETE (PR #182 retro audit / Task #57)';
  END IF;
  IF v_body_stripped NOT LIKE '%pg_advisory_xact_lock%' THEN
    RAISE EXCEPTION 'Phase 164 / B1 verification failed: sanitize_user lost H-0900 advisory lock';
  END IF;
  IF v_body_stripped !~* 'PERFORM\s+public\.log_audit_event_service[^;]*''gdpr\.sanitize_user''' THEN
    RAISE EXCEPTION 'Phase 164 / B1 verification failed: sanitize_user lost H-0899/H-0905 audit emission';
  END IF;
  IF v_body_stripped NOT LIKE '%organization.orphaned_by_sanitize%' THEN
    RAISE EXCEPTION 'Phase 164 / B1 verification failed: sanitize_user lost H-0908/H-0909 sole-admin loop';
  END IF;
  IF v_body_stripped NOT LIKE '%quantalyze.sanitize_in_progress%' THEN
    RAISE EXCEPTION 'Phase 164 / B1 verification failed: sanitize_user lost mig 120 sentinel-progress signal';
  END IF;
  IF v_body_stripped NOT LIKE '%auth.refresh_tokens%' THEN
    RAISE EXCEPTION 'Phase 164 / B1 verification failed: sanitize_user lost mig 120 auth purge';
  END IF;
  IF v_body_stripped !~* 'banned_until\s*=\s*''infinity''' THEN
    RAISE EXCEPTION 'Phase 164 / B1 verification failed: sanitize_user lost the banned_until = infinity lockout';
  END IF;

  -- Re-assert PUBLIC EXECUTE absence (mig 134 helper).
  PERFORM public._assert_no_public_execute('public.sanitize_user(uuid)');

  RAISE NOTICE 'Phase 164 / B1: sanitize_user revokes the subject''s strategy_shares links (revoke-not-delete), and every pre-existing sanitize invariant survived the whole-body replace.';
END $$;

COMMIT;
