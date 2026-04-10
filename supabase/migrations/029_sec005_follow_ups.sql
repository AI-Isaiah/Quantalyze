-- Migration 029: SEC-005 follow-up hardening.
--
-- Why this migration exists
-- -------------------------
-- After migrations 027 and 028 landed, an adversarial code review found
-- several follow-up issues that should be closed before declaring the
-- cross-tenant security class fully fixed:
--
-- 1. Explicit `WITH CHECK` on `strategies_update` and sibling policies.
--    Postgres defaults the check_expression to the USING expression when
--    WITH CHECK is omitted, so this is primarily defensive / belt-and-
--    suspenders. But an explicit clause removes ambiguity and documents
--    intent.
--
-- 2. Retro-scan for existing cross-tenant `strategies.api_key_id` rows.
--    Migration 028 installed a forward-looking trigger. It did not check
--    whether any pre-existing rows already violate the invariant. If the
--    bug was exploited before the fix, the evidence is still in the table
--    and the trigger will happily let those rows continue to misattribute
--    trades to the wrong tenant.
--
-- 3. Trigger function hardening:
--    - Short-circuit on no-op updates (NEW.api_key_id IS NOT DISTINCT FROM
--      OLD.api_key_id) to avoid unnecessary EXISTS lookups and accidental
--      DoS when a form round-trips the full row.
--    - Add `FOR SHARE` lock on the EXISTS query to prevent a race where
--      User B deletes the key between the trigger's check and the commit.
--      Today the FK `ON DELETE SET NULL` catches this race by accident,
--      but future migrations that make the FK deferrable would reopen it.
--    - Harden `search_path` to `pg_catalog, public` and schema-qualify
--      `public.api_keys` so no session-level search_path manipulation can
--      misdirect the EXISTS lookup.
--
-- 4. Swap the migration 027 self-check from `information_schema.
--    column_privileges` to `has_column_privilege('authenticated', ...)`.
--    The information_schema view reports only explicit column-level
--    grants, not effective privileges derived from table-level grants.
--    `has_column_privilege` is the ground-truth API that Postgres itself
--    uses to decide whether a SELECT is allowed. Use it here so any
--    future schema drift that accidentally re-grants SELECT cannot
--    silently bypass the check.
--
-- This migration is IDEMPOTENT — running it twice is a no-op. The policy
-- drop-and-recreate uses `DROP POLICY IF EXISTS`, the function is
-- `CREATE OR REPLACE`, and the retro-scan is read-only.

-- --------------------------------------------------------------------------
-- STEP 1: retro-scan existing strategies for cross-tenant api_key_id.
--
-- If the bug was exploited before migration 028 shipped, the violating rows
-- still exist and the trigger won't help them. Find them and FAIL the
-- migration — a human must decide whether to NULL the api_key_id, delete
-- the strategy, or re-attribute trades. There is no safe auto-remediation
-- because any action has user-visible consequences.
-- --------------------------------------------------------------------------
DO $$
DECLARE
  violations int;
  sample text;
BEGIN
  SELECT count(*)
  INTO violations
  FROM strategies s
  WHERE s.api_key_id IS NOT NULL
    AND NOT EXISTS (
      SELECT 1
      FROM api_keys k
      WHERE k.id = s.api_key_id
        AND k.user_id = s.user_id
    );

  IF violations > 0 THEN
    -- Emit a sample of offending strategy ids for remediation triage.
    SELECT string_agg(s.id::text, ', ')
    INTO sample
    FROM (
      SELECT s.id
      FROM strategies s
      WHERE s.api_key_id IS NOT NULL
        AND NOT EXISTS (
          SELECT 1 FROM api_keys k
          WHERE k.id = s.api_key_id AND k.user_id = s.user_id
        )
      LIMIT 20
    ) s;

    RAISE EXCEPTION
      'Migration 029 retro-scan: % existing strategies row(s) violate the tenant invariant (api_keys.user_id != strategies.user_id). Sample ids: %. Manual remediation required: either NULL the api_key_id, delete the strategy, or re-attribute the key ownership. Rolling back.',
      violations, sample;
  END IF;

  RAISE NOTICE 'Migration 029: retro-scan clean, 0 cross-tenant violations found.';
END
$$;

-- --------------------------------------------------------------------------
-- STEP 2: explicit WITH CHECK on strategies_update (defense in depth).
-- Postgres defaults the check_expression to USING when WITH CHECK is
-- omitted, but an explicit clause is clearer and removes any future
-- ambiguity if policy inheritance or defaults change.
-- --------------------------------------------------------------------------
DROP POLICY IF EXISTS strategies_update ON strategies;
CREATE POLICY strategies_update ON strategies
  FOR UPDATE
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- --------------------------------------------------------------------------
-- STEP 3: hardened trigger function. Replaces the migration 028 version.
--
-- Changes vs migration 028:
--   - Short-circuit on no-op api_key_id updates (IS NOT DISTINCT FROM OLD).
--   - Schema-qualified `public.api_keys` so search_path manipulation cannot
--     redirect the EXISTS lookup.
--   - Hardened search_path to `pg_catalog, public`.
--   - `FOR SHARE` lock on the EXISTS row, blocking concurrent DELETE races.
-- --------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION check_strategy_api_key_ownership()
RETURNS TRIGGER AS $$
BEGIN
  -- Skip the check when the strategy has no linked key (draft + CSV paths).
  IF NEW.api_key_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- Short-circuit when an UPDATE doesn't actually change api_key_id. Saves
  -- a round-trip to api_keys on every form round-trip write, and prevents
  -- pointless trigger fires on bulk updates that touch other columns.
  IF TG_OP = 'UPDATE'
    AND NEW.api_key_id IS NOT DISTINCT FROM OLD.api_key_id
    AND NEW.user_id IS NOT DISTINCT FROM OLD.user_id
  THEN
    RETURN NEW;
  END IF;

  -- Assert the linked key belongs to the same user as the strategy.
  -- SECURITY DEFINER bypasses RLS so the EXISTS sees the raw ownership
  -- truth. Schema-qualified `public.api_keys` + restricted search_path
  -- prevent any session-level manipulation from redirecting the lookup.
  -- `FOR SHARE` locks the api_keys row for the duration of the transaction
  -- so a concurrent DELETE cannot race between check and commit.
  IF NOT EXISTS (
    SELECT 1
    FROM public.api_keys
    WHERE id = NEW.api_key_id
      AND user_id = NEW.user_id
    FOR SHARE
  ) THEN
    RAISE EXCEPTION
      'api_key_id % does not belong to user % (cross-tenant linkage blocked by migration 028/029)',
      NEW.api_key_id, NEW.user_id
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public;

COMMENT ON FUNCTION check_strategy_api_key_ownership() IS
  'Enforces api_keys.user_id = strategies.user_id on strategies INSERT/UPDATE. Hardened in migration 029 (short-circuit, FOR SHARE, schema-qualified).';

-- Re-revoke execute — CREATE OR REPLACE preserves ACLs in most cases but
-- make it explicit.
REVOKE ALL ON FUNCTION check_strategy_api_key_ownership() FROM PUBLIC, anon, authenticated;

-- --------------------------------------------------------------------------
-- STEP 4: self-verifying meta-check — function + trigger + WITH CHECK
-- --------------------------------------------------------------------------
DO $$
DECLARE
  fn_security_definer boolean;
  fn_search_path text;
  fn_source text;
  trg_exists boolean;
  update_policy_with_check text;
BEGIN
  -- 1. Function is still SECURITY DEFINER after CREATE OR REPLACE
  SELECT p.prosecdef
  INTO fn_security_definer
  FROM pg_proc p
  JOIN pg_namespace n ON p.pronamespace = n.oid
  WHERE n.nspname = 'public'
    AND p.proname = 'check_strategy_api_key_ownership';

  IF NOT fn_security_definer THEN
    RAISE EXCEPTION 'Migration 029: check_strategy_api_key_ownership is not SECURITY DEFINER. Rolling back.';
  END IF;

  -- 2. Function has the hardened search_path
  SELECT array_to_string(p.proconfig, ',')
  INTO fn_search_path
  FROM pg_proc p
  JOIN pg_namespace n ON p.pronamespace = n.oid
  WHERE n.nspname = 'public'
    AND p.proname = 'check_strategy_api_key_ownership';

  IF fn_search_path IS NULL OR fn_search_path NOT LIKE '%search_path=pg_catalog%' THEN
    RAISE EXCEPTION 'Migration 029: check_strategy_api_key_ownership search_path not hardened (got: %). Rolling back.', fn_search_path;
  END IF;

  -- 3. Function source contains the schema-qualified public.api_keys reference
  SELECT pg_get_functiondef(p.oid)
  INTO fn_source
  FROM pg_proc p
  JOIN pg_namespace n ON p.pronamespace = n.oid
  WHERE n.nspname = 'public'
    AND p.proname = 'check_strategy_api_key_ownership';

  IF fn_source NOT LIKE '%public.api_keys%' THEN
    RAISE EXCEPTION 'Migration 029: check_strategy_api_key_ownership does not reference schema-qualified public.api_keys. Rolling back.';
  END IF;

  IF fn_source NOT LIKE '%FOR SHARE%' THEN
    RAISE EXCEPTION 'Migration 029: check_strategy_api_key_ownership missing FOR SHARE lock. Rolling back.';
  END IF;

  -- 4. Trigger still attached to strategies
  SELECT EXISTS (
    SELECT 1 FROM pg_trigger t
    JOIN pg_class c ON t.tgrelid = c.oid
    JOIN pg_namespace n ON c.relnamespace = n.oid
    WHERE n.nspname = 'public'
      AND c.relname = 'strategies'
      AND t.tgname = 'check_strategy_api_key_ownership_trigger'
      AND NOT t.tgisinternal
  ) INTO trg_exists;

  IF NOT trg_exists THEN
    RAISE EXCEPTION 'Migration 029: trigger check_strategy_api_key_ownership_trigger missing after update. Rolling back.';
  END IF;

  -- 5. strategies_update policy has explicit WITH CHECK
  -- pg_policy.polwithcheck is null when WITH CHECK is inherited from USING,
  -- so we check the qualifier expression directly.
  SELECT pg_get_expr(p.polwithcheck, p.polrelid)
  INTO update_policy_with_check
  FROM pg_policy p
  JOIN pg_class c ON p.polrelid = c.oid
  JOIN pg_namespace n ON c.relnamespace = n.oid
  WHERE n.nspname = 'public'
    AND c.relname = 'strategies'
    AND p.polname = 'strategies_update';

  IF update_policy_with_check IS NULL THEN
    RAISE EXCEPTION 'Migration 029: strategies_update policy is missing explicit WITH CHECK. Rolling back.';
  END IF;

  RAISE NOTICE 'Migration 029: all follow-up hardening verified.';
END
$$;

-- --------------------------------------------------------------------------
-- STEP 5: augment migration 027 verification with has_column_privilege.
--
-- Migration 027 used information_schema.column_privileges, which reports
-- only explicit column-level grants. Add a second, stronger check using
-- has_column_privilege() — the ground-truth API that Postgres itself uses
-- to decide whether a SELECT is allowed. If this ever flips to true for
-- any encrypted column, the guarantee from 027 is silently broken.
-- --------------------------------------------------------------------------
DO $$
DECLARE
  col text;
  role_name text;
  leaks int := 0;
BEGIN
  FOR role_name IN SELECT unnest(ARRAY['anon', 'authenticated']) LOOP
    FOR col IN SELECT unnest(ARRAY[
      'api_key_encrypted',
      'api_secret_encrypted',
      'passphrase_encrypted',
      'dek_encrypted',
      'nonce'
    ]) LOOP
      IF has_column_privilege(role_name, 'public.api_keys', col, 'SELECT') THEN
        leaks := leaks + 1;
        RAISE WARNING 'Migration 029: role % still has SELECT on api_keys.% — SEC-005 guarantee is BROKEN.', role_name, col;
      END IF;
    END LOOP;
  END LOOP;

  IF leaks > 0 THEN
    RAISE EXCEPTION 'Migration 029: % effective SELECT privileges still exist on encrypted api_keys columns (via has_column_privilege). SEC-005 is NOT enforced. Rolling back.', leaks;
  END IF;

  RAISE NOTICE 'Migration 029: has_column_privilege ground-truth check passed for all encrypted columns.';
END
$$;
