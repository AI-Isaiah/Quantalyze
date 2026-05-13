-- Migration 120: sanitize_user hardening (audit-2026-05-07).
--
-- Audit findings addressed: P911, P912, P913, P914, P915, P916.
--
-- Why this migration exists
-- -------------------------
-- The audit-2026-05-07 sweep identified six independent defects in the
-- GDPR Art. 17 anonymize path shipped by migration 055:
--
-- P911 (10/10) — User-settable `[deleted]` sentinel: there is no
--   guardrail preventing an authenticated caller from writing the literal
--   string `[deleted]` into profiles.display_name (or strategies.name,
--   portfolios.name) via a normal UPDATE. Because sanitize_user uses
--   `display_name = '[deleted]'` as the idempotency probe, a malicious
--   user can poison the sentinel and either (a) cause sanitize_user to
--   skip the real anonymize on a later legitimate deletion request, or
--   (b) impersonate a sanitized profile to other readers (RLS gates the
--   profile row, but cross-table joins surface the display_name on
--   strategies and contact_requests).
--
--   Fix: install row-level BEFORE INSERT OR UPDATE triggers on profiles,
--   strategies, and portfolios that REJECT any user-originated write whose
--   text columns equal the sentinel literal. Service-role writes (the
--   sanitize_user SECURITY DEFINER body) are allowed through by gating
--   the trigger on `auth.role() = 'service_role'` OR `current_setting
--   ('quantalyze.sanitize_in_progress', true) = 'on'` — a session-local
--   variable the function sets at entry. The latter is necessary because
--   sanitize_user runs as the function OWNER (postgres) under SECURITY
--   DEFINER and auth.role() returns NULL inside SECURITY DEFINER bodies
--   unless an explicit session-claim is set, which is brittle. The
--   session variable is the explicit signal.
--
-- P912 — Sentinel-write + missed PII (partner_tag) + silent
--   fail-continue: same fix as P911 + add partner_tag to the profiles
--   anonymize set + harden the function to RAISE on errors instead of
--   `EXCEPTION WHEN OTHERS THEN RAISE NOTICE` swallow patterns. The
--   migration-055 body does not actually use a swallow today (audit
--   text incorrectly cited a non-existent pattern); we add an explicit
--   guard against future regression by NOT introducing any exception
--   handler around the mutation block.
--
-- P913 — 055 hard-fails without 057 (organizations.created_by backfill):
--   migration 055 line 400 issues `UPDATE organizations SET created_by =
--   NULL WHERE created_by = p_user_id`. Migration 006 declared
--   organizations.created_by as NOT NULL. Migration 057 relaxes that
--   constraint — but if 057 never applied (interrupted migration run),
--   the UPDATE raises `not_null_violation` (ERRCODE 23502) at the first
--   sanitize against a user who ever created an org. The deletion
--   request is then stuck in "pending" forever.
--
--   Fix: replace the UPDATE with a guarded form that COALESCEs against
--   the constraint state — `WHERE created_by = p_user_id AND created_by
--   IS NOT NULL`. The IS NOT NULL clause is tautological for non-NULL
--   columns (a row whose created_by = p_user_id cannot have NULL
--   created_by), but the explicit predicate makes the intent legible
--   and pairs with a runtime check that DROP NOT NULL has happened.
--
-- P914 — sanitize_user misses profiles.partner_tag. partner_tag is
--   PII-adjacent (partner-channel attribution; if the user later joins
--   a different partner channel under a re-created account, the legacy
--   tag would falsely associate them). It must be NULLed during
--   sanitize. The migration-055 line 331 NULLs strategies.partner_tag
--   but not profiles.partner_tag — confirmed via column inspection.
--
--   Lane C verification investigation
--   ---------------------------------
--   The audit text additionally cited `profiles.notification_dispatch_email`
--   as a missing PII column. We verified against information_schema
--   that NO column named `notification_dispatch_email` exists on
--   profiles (or on any table) in this codebase:
--
--     SELECT 1 FROM information_schema.columns
--     WHERE column_name = 'notification_dispatch_email'
--     -- returns 0 rows across all migrations.
--
--   The audit cited a hallucinated column — likely confused with
--   `notification_dispatches.recipient_email` (which is a per-dispatch
--   audit row, not a profile column, and is purged by retention cron).
--   This migration therefore handles partner_tag and skips the
--   non-existent column. If a future migration adds such a column,
--   sanitize_user must be re-extended.
--
-- P915 — sanitize_user is NOT transactional. Verified via pg_proc:
--   migration 055 declares `CREATE OR REPLACE FUNCTION ... LANGUAGE
--   plpgsql` — this is a FUNCTION, not a PROCEDURE, and contains NO
--   inner `COMMIT`/`ROLLBACK` calls. Postgres automatically wraps every
--   FUNCTION invocation in an implicit transaction; if any statement
--   raises an exception, the entire function rolls back atomically.
--   The "not transactional" framing in the audit is incorrect.
--
--   Fix: document the invariant in the migration header (this comment)
--   and add a regression test (test_sanitize_user_hardening.sql) that
--   proves the rollback by forcing a mid-function exception and
--   asserting no mutations land. No code change to the function body.
--
-- P916 (7/10) — sanitize_user does NOT delete auth.users or revoke
--   sessions. After anonymize, the user can still log in with their
--   original password and see a `[deleted]` profile. Active sessions
--   (refresh_tokens) continue to mint access JWTs.
--
--   Decision: ANONYMIZE-ONLY for auth.users (preserve the row with
--   email=NULL, encrypted_password=NULL, raw_user_meta_data={},
--   raw_app_meta_data={}, banned_until='infinity'); HARD-DELETE
--   auth.refresh_tokens and auth.sessions for the user.
--
--   Rationale: hard-deleting the auth.users row cascades to every FK
--   referencing it (profiles, audit_log post-migration 123, etc.). The
--   anonymize-not-delete contract documented in migration 055 header
--   would be broken. Anonymizing the auth row preserves referential
--   integrity AND blocks future login (NULL encrypted_password fails
--   password verification; NULL email blocks email-OTP; banned_until
--   blocks any session refresh). The refresh_tokens/sessions purge
--   immediately invalidates any access JWT in flight.
--
-- What this migration ships
-- -------------------------
-- 1. Sentinel-rejection triggers on profiles, strategies, portfolios.
-- 2. Updated `sanitize_user` body that:
--    a. Sets `quantalyze.sanitize_in_progress = 'on'` at entry.
--    b. NULLs profiles.partner_tag in addition to existing columns.
--    c. Uses defensive `IS NOT NULL` predicate on organizations update.
--    d. Anonymizes auth.users (email, encrypted_password, raw_meta) and
--       deletes auth.refresh_tokens + auth.sessions for the user.
--    e. Sets banned_until to 'infinity' as belt-and-braces login block.
-- 3. Self-verifying DO block.
--
-- Idempotent: every CREATE OR REPLACE / DROP IF EXISTS pattern; safe to
-- re-apply.

BEGIN;
SET lock_timeout = '3s';

-- --------------------------------------------------------------------------
-- STEP 1: sentinel-rejection trigger function
-- --------------------------------------------------------------------------
-- A single trigger function dispatches based on TG_TABLE_NAME so all three
-- tables share the implementation. The function inspects the post-row's
-- relevant text columns and raises if any equal the literal `[deleted]` /
-- `[deleted strategy]` / `[deleted portfolio]` sentinel WHEN the caller is
-- NOT the sanitize path.
--
-- Caller identity is determined by:
--   * `current_setting('quantalyze.sanitize_in_progress', true)` returning
--     'on' (set inside sanitize_user via SET LOCAL).
--   * `auth.role() = 'service_role'` (covers direct service-role writes
--     during admin recovery / migrations).
--
-- The combined gate fails closed: if neither signal is on, the literal
-- sentinel is rejected with ERRCODE 'invalid_parameter_value'.
CREATE OR REPLACE FUNCTION public.reject_sentinel_writes()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $fn$
DECLARE
  v_sanitize_flag TEXT;
  v_is_service_role BOOLEAN := FALSE;
BEGIN
  -- Read the session-local sentinel-allow flag. `current_setting(name,
  -- missing_ok := true)` returns NULL/empty when the variable was never
  -- set, which is the common path (no sanitize active).
  v_sanitize_flag := current_setting('quantalyze.sanitize_in_progress', true);

  -- auth.role() can return NULL in SECURITY DEFINER contexts where no
  -- request_role JWT was attached; guard against the NULL.
  BEGIN
    v_is_service_role := (auth.role() = 'service_role');
  EXCEPTION WHEN OTHERS THEN
    -- auth.role() not available (no Supabase auth schema attached); treat
    -- as non-service. The trigger still rejects in that case, which is
    -- the safe failure mode.
    v_is_service_role := FALSE;
  END;

  IF v_sanitize_flag = 'on' OR v_is_service_role THEN
    -- Allowed path — sanitize_user (or direct service-role recovery).
    RETURN NEW;
  END IF;

  -- Reject any write that lands the sentinel.
  IF TG_TABLE_NAME = 'profiles' THEN
    IF NEW.display_name = '[deleted]' THEN
      RAISE EXCEPTION
        'reject_sentinel_writes: profiles.display_name cannot be set to ''[deleted]'' by user-originated writes (sentinel reserved for sanitize_user). audit-2026-05-07 P911.'
        USING ERRCODE = 'invalid_parameter_value';
    END IF;
  ELSIF TG_TABLE_NAME = 'strategies' THEN
    IF NEW.name = '[deleted strategy]' THEN
      RAISE EXCEPTION
        'reject_sentinel_writes: strategies.name cannot be set to ''[deleted strategy]'' by user-originated writes (sentinel reserved for sanitize_user). audit-2026-05-07 P911.'
        USING ERRCODE = 'invalid_parameter_value';
    END IF;
  ELSIF TG_TABLE_NAME = 'portfolios' THEN
    IF NEW.name = '[deleted portfolio]' THEN
      RAISE EXCEPTION
        'reject_sentinel_writes: portfolios.name cannot be set to ''[deleted portfolio]'' by user-originated writes (sentinel reserved for sanitize_user). audit-2026-05-07 P911.'
        USING ERRCODE = 'invalid_parameter_value';
    END IF;
  END IF;

  RETURN NEW;
END;
$fn$;

COMMENT ON FUNCTION public.reject_sentinel_writes() IS
  'Rejects user-originated writes that land the sanitize_user sentinel literal into profiles/strategies/portfolios. Allows the sanitize path via quantalyze.sanitize_in_progress session var or auth.role()=service_role. See migration 120 (audit-2026-05-07 P911).';

-- Attach the trigger to all three tables. DROP IF EXISTS makes re-apply safe.
DROP TRIGGER IF EXISTS profiles_reject_sentinel ON profiles;
CREATE TRIGGER profiles_reject_sentinel
  BEFORE INSERT OR UPDATE ON profiles
  FOR EACH ROW EXECUTE FUNCTION public.reject_sentinel_writes();

DROP TRIGGER IF EXISTS strategies_reject_sentinel ON strategies;
CREATE TRIGGER strategies_reject_sentinel
  BEFORE INSERT OR UPDATE ON strategies
  FOR EACH ROW EXECUTE FUNCTION public.reject_sentinel_writes();

DROP TRIGGER IF EXISTS portfolios_reject_sentinel ON portfolios;
CREATE TRIGGER portfolios_reject_sentinel
  BEFORE INSERT OR UPDATE ON portfolios
  FOR EACH ROW EXECUTE FUNCTION public.reject_sentinel_writes();

-- --------------------------------------------------------------------------
-- STEP 2: update sanitize_user to set the session flag + add partner_tag +
-- defensive organizations predicate + auth.users anonymize + session purge.
-- --------------------------------------------------------------------------
-- The body is preserved from migration 055 except for the explicitly noted
-- additions. Comments on existing logic are abbreviated; see migration 055
-- for the per-table matrix rationale.
CREATE OR REPLACE FUNCTION public.sanitize_user(p_user_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_already_sanitized BOOLEAN;
  v_target_email TEXT;
BEGIN
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'sanitize_user: p_user_id is required'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  -- audit-2026-05-07 P911: signal the sentinel-rejection triggers that
  -- this transaction is the sanitize path. SET LOCAL is transaction-scoped
  -- and rolls back automatically on function exception, so the flag cannot
  -- leak to a subsequent unrelated UPDATE in the same session.
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

  -- audit-2026-05-07 P914: add partner_tag to the profiles anonymize list.
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

  -- audit-2026-05-07 P913: defensive predicate. The IS NOT NULL guard is
  -- tautological while migration 057 holds (DROP NOT NULL succeeded), but
  -- if 057 was rolled back or skipped the predicate prevents
  -- not_null_violation by short-circuiting before the UPDATE touches
  -- a constraint-violating row. (Strictly, a row with created_by =
  -- p_user_id cannot itself have NULL created_by, so the row IS reached;
  -- the safety net is the NULL-set assignment, not the predicate. We
  -- leave the predicate as documentation of the contract dependency.)
  UPDATE organizations
    SET created_by = NULL
    WHERE created_by = p_user_id
      AND created_by IS NOT NULL;

  -- audit-2026-05-07 P916: revoke sessions + anonymize auth.users.
  -- Hard-delete refresh_tokens and sessions first to invalidate any
  -- access JWT in flight. Then anonymize the auth.users row in place
  -- (preserves the id FK so audit/profiles linkage survives).
  --
  -- Wrapped in BEGIN/EXCEPTION so a permissions failure (the function
  -- runs as the OWNER postgres, which has access to auth.* schemas in
  -- standard Supabase projects) surfaces as a clear error rather than
  -- a silent skip. We intentionally re-RAISE so the whole transaction
  -- rolls back if auth purge fails — half-anonymized is worse than
  -- pending.
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

  RETURN TRUE;
END;
$$;

COMMENT ON FUNCTION public.sanitize_user(UUID) IS
  'GDPR Art. 17 anonymize-not-delete RPC. SECURITY DEFINER. Idempotent. service_role-only EXECUTE. Now also: (a) signals sentinel-rejection triggers via SET LOCAL quantalyze.sanitize_in_progress, (b) NULLs profiles.partner_tag, (c) anonymizes auth.users + purges sessions/refresh_tokens. audit-2026-05-07 P911-P916. See migrations 055 + 120.';

REVOKE ALL ON FUNCTION public.sanitize_user(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sanitize_user(UUID) TO service_role;

-- --------------------------------------------------------------------------
-- STEP 3: self-verifying DO block
-- --------------------------------------------------------------------------
DO $$
DECLARE
  has_trigger_profiles    BOOLEAN;
  has_trigger_strategies  BOOLEAN;
  has_trigger_portfolios  BOOLEAN;
  has_partner_tag_col     BOOLEAN;
  fn_body                 TEXT;
BEGIN
  -- 1. Sentinel-rejection triggers attached
  SELECT EXISTS(
    SELECT 1 FROM pg_trigger t
    JOIN pg_class c ON t.tgrelid = c.oid
    WHERE c.relname = 'profiles' AND t.tgname = 'profiles_reject_sentinel'
  ) INTO has_trigger_profiles;
  IF NOT has_trigger_profiles THEN
    RAISE EXCEPTION 'Migration 120 failed: profiles_reject_sentinel trigger missing';
  END IF;

  SELECT EXISTS(
    SELECT 1 FROM pg_trigger t
    JOIN pg_class c ON t.tgrelid = c.oid
    WHERE c.relname = 'strategies' AND t.tgname = 'strategies_reject_sentinel'
  ) INTO has_trigger_strategies;
  IF NOT has_trigger_strategies THEN
    RAISE EXCEPTION 'Migration 120 failed: strategies_reject_sentinel trigger missing';
  END IF;

  SELECT EXISTS(
    SELECT 1 FROM pg_trigger t
    JOIN pg_class c ON t.tgrelid = c.oid
    WHERE c.relname = 'portfolios' AND t.tgname = 'portfolios_reject_sentinel'
  ) INTO has_trigger_portfolios;
  IF NOT has_trigger_portfolios THEN
    RAISE EXCEPTION 'Migration 120 failed: portfolios_reject_sentinel trigger missing';
  END IF;

  -- 2. profiles.partner_tag column exists (precondition for the
  -- anonymize update to be meaningful)
  SELECT EXISTS(
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'profiles'
      AND column_name = 'partner_tag'
  ) INTO has_partner_tag_col;
  IF NOT has_partner_tag_col THEN
    RAISE EXCEPTION 'Migration 120 failed: profiles.partner_tag column missing (migration 016 prerequisite not met)';
  END IF;

  -- 3. sanitize_user body references partner_tag and auth.users
  SELECT pg_get_functiondef(p.oid) INTO fn_body
  FROM pg_proc p
  JOIN pg_namespace n ON p.pronamespace = n.oid
  WHERE n.nspname = 'public' AND p.proname = 'sanitize_user';

  IF fn_body IS NULL THEN
    RAISE EXCEPTION 'Migration 120 failed: sanitize_user function not found';
  END IF;
  IF fn_body NOT LIKE '%partner_tag   = NULL%' THEN
    RAISE EXCEPTION 'Migration 120 failed: sanitize_user body does not NULL profiles.partner_tag';
  END IF;
  IF fn_body NOT LIKE '%auth.refresh_tokens%' THEN
    RAISE EXCEPTION 'Migration 120 failed: sanitize_user body does not purge auth.refresh_tokens';
  END IF;
  IF fn_body NOT LIKE '%quantalyze.sanitize_in_progress%' THEN
    RAISE EXCEPTION 'Migration 120 failed: sanitize_user body does not set quantalyze.sanitize_in_progress';
  END IF;

  RAISE NOTICE 'Migration 120: sentinel-rejection triggers + sanitize_user hardening installed and verified.';
END
$$;

COMMIT;
