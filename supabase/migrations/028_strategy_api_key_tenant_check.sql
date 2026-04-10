-- Migration 028: cross-tenant api_key_id linkage fix.
--
-- Why this migration exists
-- -------------------------
-- During Sprint 1 planning, three independent AI engineering reviewers
-- (Claude subagent, Codex, Grok) independently identified the same CRITICAL
-- security vulnerability:
--
--   A user can link ANOTHER user's `api_keys.id` to their own strategy
--   and thereby claim that other user's verified trading track record.
--
-- Attack walkthrough
-- ------------------
--   1. User A knows (guesses, leaks, or discovers) the UUID of an api_keys
--      row owned by User B.
--   2. User A creates/updates a strategy owned by User A, setting
--      `api_key_id` = B's key.
--   3. The RLS `strategies_insert` / `strategies_update` policy checks only
--      `user_id = auth.uid()` (migration 002, line 32) — A owns the strategy,
--      so the policy passes.
--   4. The FK `api_key_id REFERENCES api_keys` (migration 001, line 51)
--      only checks existence, not ownership.
--   5. Nothing else blocks the write. A's strategy now references B's key,
--      and any downstream code that joins `strategies -> api_keys -> trades`
--      to build A's factsheet will pull B's trade history.
--
-- Realism
-- -------
-- UUID entropy is high, so a blind guess is impractical. But UUIDs DO leak
-- through:
--   - Error messages (api_key_id in stack traces / Sentry)
--   - Admin client responses (AdminTabs.tsx includes api_key_id joins)
--   - Logs (any log that serializes the strategies row)
--   - Referrers or URLs if ever embedded client-side
--
-- Any leak is a privilege escalation path. Defense-in-depth requires a
-- DB-level constraint. RLS on `strategies` cannot express this because it
-- would need to cross-join `api_keys`, and per-row policies that query
-- other tables are slow and error-prone (see migration 026's organization
-- RLS recursion fix for a similar class of bug).
--
-- Fix
-- ---
-- A BEFORE INSERT OR UPDATE trigger on `strategies` that asserts:
--   IF NEW.api_key_id IS NOT NULL
--      AND NOT EXISTS (
--        SELECT 1 FROM api_keys
--        WHERE id = NEW.api_key_id AND user_id = NEW.user_id
--      )
--   THEN RAISE insufficient_privilege;
--
-- The trigger function is SECURITY DEFINER so it can SELECT from api_keys
-- without hitting the user's RLS scope (which would otherwise hide B's
-- keys and cause the EXISTS check to falsely say "not found" for
-- legitimate self-links). We need the raw ownership truth, not the
-- RLS-filtered view.
--
-- Runtime verification
-- --------------------
-- This migration's self-verifying DO block is a META-CHECK (it asserts
-- the trigger + function exist in pg_catalog). Runtime behavior — the
-- actual cross-tenant attack being blocked — is covered by the e2e test
-- at e2e/api-key-flow.spec.ts (to be added in Task 1.2). A meta-check is
-- used here because testing the trigger behavior inside a migration
-- requires creating profiles rows, which in turn require auth.users rows,
-- which cannot be reliably created in a migration transaction.
--
-- What this migration does NOT fix
-- --------------------------------
-- - The legacy `StrategyForm.tsx:105` path which inserts an api_keys row
--   without linking it to a strategy (orphan). The new wizard in Task 1.2
--   replaces this flow.
-- - Deletion races: if an api_keys row is deleted while a strategy still
--   references it, the FK cascade is `ON DELETE SET NULL` (migration 001
--   line 51), so the strategy's api_key_id becomes NULL. The trigger does
--   not fire on the DELETE side. This is a desired behavior, not a bug.

-- --------------------------------------------------------------------------
-- STEP 1: trigger function
-- --------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION check_strategy_api_key_ownership()
RETURNS TRIGGER AS $$
BEGIN
  -- Skip the check if the strategy has no linked key. Strategies can be
  -- created without a key (e.g., CSV-upload path) and the wizard's draft
  -- step creates a row before the key is attached.
  IF NEW.api_key_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- Assert the linked key belongs to the same user as the strategy.
  -- SECURITY DEFINER bypasses RLS so the EXISTS query sees the raw
  -- ownership truth (RLS would hide other users' keys and give a false
  -- negative for legitimate self-links — we need the opposite).
  IF NOT EXISTS (
    SELECT 1
    FROM api_keys
    WHERE id = NEW.api_key_id
      AND user_id = NEW.user_id
  ) THEN
    RAISE EXCEPTION
      'api_key_id % does not belong to user % (cross-tenant linkage blocked by migration 028)',
      NEW.api_key_id, NEW.user_id
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

COMMENT ON FUNCTION check_strategy_api_key_ownership() IS
  'Enforces api_keys.user_id = strategies.user_id on strategies INSERT/UPDATE. See migration 028. SECURITY DEFINER so RLS does not hide the ownership truth.';

-- --------------------------------------------------------------------------
-- STEP 2: lock down function execution to internal use only
-- --------------------------------------------------------------------------
-- The trigger function must only be callable by the trigger itself (which
-- runs as the table owner). Revoke all direct EXECUTE privileges so no
-- user-scoped client can call it directly. Pattern matches migration 021.
REVOKE ALL ON FUNCTION check_strategy_api_key_ownership() FROM PUBLIC, anon, authenticated;

-- --------------------------------------------------------------------------
-- STEP 3: attach trigger to strategies
-- --------------------------------------------------------------------------
DROP TRIGGER IF EXISTS check_strategy_api_key_ownership_trigger ON strategies;

CREATE TRIGGER check_strategy_api_key_ownership_trigger
  BEFORE INSERT OR UPDATE OF api_key_id ON strategies
  FOR EACH ROW
  EXECUTE FUNCTION check_strategy_api_key_ownership();

COMMENT ON TRIGGER check_strategy_api_key_ownership_trigger ON strategies IS
  'Blocks cross-tenant api_key_id assignment. See migration 028.';

-- --------------------------------------------------------------------------
-- STEP 4: self-verifying meta-check
-- --------------------------------------------------------------------------
-- Assert the trigger function exists, is SECURITY DEFINER, is plpgsql,
-- and the trigger is attached to `strategies` as BEFORE INSERT OR UPDATE
-- OF api_key_id. If any assertion fails, roll back the transaction.
--
-- Why meta-check instead of behavior test: testing the cross-tenant attack
-- requires two real auth.users rows and two real profiles rows, which
-- cannot be reliably created in a migration transaction without coupling
-- to the auth schema. Runtime behavior is covered by e2e tests in
-- Task 1.2 (see e2e/api-key-flow.spec.ts).
DO $$
DECLARE
  fn_exists boolean;
  fn_security_definer boolean;
  fn_language text;
  trg_exists boolean;
  trg_timing text;
  trg_events text[];
BEGIN
  -- 1. Function exists
  SELECT EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON p.pronamespace = n.oid
    WHERE n.nspname = 'public'
      AND p.proname = 'check_strategy_api_key_ownership'
  ) INTO fn_exists;

  IF NOT fn_exists THEN
    RAISE EXCEPTION 'Migration 028 failed: check_strategy_api_key_ownership function not found. Rolling back.';
  END IF;

  -- 2. Function is SECURITY DEFINER and plpgsql
  SELECT p.prosecdef, l.lanname
  INTO fn_security_definer, fn_language
  FROM pg_proc p
  JOIN pg_namespace n ON p.pronamespace = n.oid
  JOIN pg_language l ON p.prolang = l.oid
  WHERE n.nspname = 'public'
    AND p.proname = 'check_strategy_api_key_ownership';

  IF NOT fn_security_definer THEN
    RAISE EXCEPTION 'Migration 028 failed: check_strategy_api_key_ownership is not SECURITY DEFINER. Rolling back.';
  END IF;

  IF fn_language <> 'plpgsql' THEN
    RAISE EXCEPTION 'Migration 028 failed: check_strategy_api_key_ownership is not plpgsql (got %). Rolling back.', fn_language;
  END IF;

  -- 3. Trigger exists on strategies
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
    RAISE EXCEPTION 'Migration 028 failed: check_strategy_api_key_ownership_trigger not attached to strategies. Rolling back.';
  END IF;

  -- 4. Trigger fires BEFORE INSERT OR UPDATE
  -- tgtype bitmask: bit 1 = BEFORE, bit 2 = AFTER, bit 3 = INSERT, bit 4 = DELETE, bit 5 = UPDATE
  -- So BEFORE INSERT OR UPDATE = BEFORE (1) + INSERT (4) + UPDATE (16) = 21
  -- Check: BEFORE set (bit 1 = 1) AND INSERT set (bit 2 = 4) AND UPDATE set (bit 4 = 16)
  SELECT
    CASE WHEN (t.tgtype & 2) = 2 THEN 'BEFORE' ELSE 'AFTER' END,
    ARRAY[
      CASE WHEN (t.tgtype & 4)  = 4  THEN 'INSERT' END,
      CASE WHEN (t.tgtype & 8)  = 8  THEN 'DELETE' END,
      CASE WHEN (t.tgtype & 16) = 16 THEN 'UPDATE' END
    ]
  INTO trg_timing, trg_events
  FROM pg_trigger t
  JOIN pg_class c ON t.tgrelid = c.oid
  JOIN pg_namespace n ON c.relnamespace = n.oid
  WHERE n.nspname = 'public'
    AND c.relname = 'strategies'
    AND t.tgname = 'check_strategy_api_key_ownership_trigger';

  -- Postgres stores BEFORE as bit-cleared, AFTER as bit-set — flip the check.
  -- tgtype bit 2 (value 2) = AFTER; absent = BEFORE.
  IF trg_timing = 'AFTER' THEN
    RAISE EXCEPTION 'Migration 028 failed: trigger timing is AFTER, expected BEFORE. Rolling back.';
  END IF;

  IF NOT ('INSERT' = ANY(trg_events)) THEN
    RAISE EXCEPTION 'Migration 028 failed: trigger does not fire on INSERT. Rolling back.';
  END IF;

  IF NOT ('UPDATE' = ANY(trg_events)) THEN
    RAISE EXCEPTION 'Migration 028 failed: trigger does not fire on UPDATE. Rolling back.';
  END IF;

  -- All checks passed.
  RAISE NOTICE 'Migration 028: trigger check_strategy_api_key_ownership_trigger installed and verified.';
END
$$;
