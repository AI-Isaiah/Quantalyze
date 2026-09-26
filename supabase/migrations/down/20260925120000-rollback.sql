-- ============================================================================
-- ROLLBACK for 20260925120000_api_keys_account_identity.sql
-- Phase 167.1.2 ACCOUNTTRUTH, plan 03 (PR B).
-- ============================================================================
-- ⛔ ROLL THE READERS BACK FIRST. Every PR C reader of these columns (the key
-- list projection, the identity stamper, the departed-keys overview, the
-- compose) must be reverted and DEPLOYED before this runs. Dropping a column
-- under a deployed reader is the same outage the migration's DEPLOY ORDER
-- header describes, in reverse.
--
-- Manual, off the auto-apply path. What it restores, verbatim:
--   * reconnect_allocator_api_key's body and COMMENT from
--     20260422101911_api_keys_disconnected_at.sql (the refusal goes away; a
--     reconnect into an occupied slot is then refused by the index alone);
--   * COMMENT ON COLUMN api_keys.venue_account_id from
--     20260920120000_api_keys_venue_account_id_grant.sql;
--   * COMMENT ON INDEX api_keys_user_exchange_venue_account_uniq as PROD
--     carries it (supabase/schema/baseline.sql; see the note at the statement).
-- What it drops: set_departed_key_history_inclusion, the same-owner trigger and
-- its function, the holder index, the three columns and their CHECKs and FK.
--
-- ⚠️ DATA: the duplicate markers and every owner's include/exclude choice are
-- LOST with the columns. They are not recoverable from anything else.
--
-- ⚠️ THE MIGRATION LEDGER ROW IS LEFT IN PLACE. This file does not touch
-- supabase_migrations.schema_migrations, so after it runs the ledger still
-- records version 20260925120000 as applied while the schema no longer
-- carries it. `supabase db push` will therefore NOT re-apply the migration.
-- To re-apply it, delete that ledger row in the same change that re-applies
-- it (or mark it reverted with `supabase migration repair --status reverted
-- 20260925120000` against the intended database, after the marker query in
-- CLAUDE.md names that database). Until then VAC-08's ledger check reports the
-- version as present, which is true of the ledger and false of the schema.
--
-- The DO block at the top is a catalogue-only PRECONDITION: it RAISEs, before
-- any DROP runs, unless all three columns the migration added exist. Every DROP
-- below is IF EXISTS, so without it this file run against a database that
-- never had 20260925120000 would drop nothing and still report success.
--
-- The DO block at the end is catalogue-only: it RAISEs, and so aborts the
-- whole rollback, if any object the migration added survives, if the reconnect
-- body still carries the refusal or the history reset or lacks the
-- 20260422101911 ownership SELECT, if a restored COMMENT is not the restored
-- text, or if reconnect_allocator_api_key's EXECUTE is not what
-- supabase/schema/baseline.sql grants (authenticated and service_role, never
-- anon).
-- ============================================================================

BEGIN;

SET lock_timeout = '3s';

-- ───────────── precondition — CATALOGUE ONLY, reads no row
DO $precondition$
DECLARE
  v_missing text;
BEGIN
  SELECT string_agg(c, ', ') INTO v_missing
    FROM unnest(ARRAY['account_shared_with_api_key_id', 'account_share_kind', 'history_inclusion']) AS c
   WHERE NOT EXISTS (
     SELECT 1 FROM pg_attribute
      WHERE attrelid = 'public.api_keys'::regclass
        AND attname = c
        AND NOT attisdropped
   );
  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION 'Rollback 20260925120000 refused: api_keys lacks column(s) % that the migration adds, so this database does not carry 20260925120000. Nothing was dropped. Run the marker query in CLAUDE.md to see which database this is.', v_missing;
  END IF;
END
$precondition$;

DROP FUNCTION IF EXISTS public.set_departed_key_history_inclusion(uuid, text);

DROP TRIGGER IF EXISTS api_keys_account_share_same_owner ON public.api_keys;
DROP FUNCTION IF EXISTS public.enforce_api_keys_account_share_same_owner();

DROP INDEX IF EXISTS public.api_keys_account_shared_with_idx;

ALTER TABLE public.api_keys
  DROP CONSTRAINT IF EXISTS api_keys_account_share_not_self,
  DROP CONSTRAINT IF EXISTS api_keys_account_share_both_or_neither,
  DROP CONSTRAINT IF EXISTS api_keys_account_share_kind_valid,
  DROP CONSTRAINT IF EXISTS api_keys_account_shared_with_api_key_id_fkey,
  DROP CONSTRAINT IF EXISTS api_keys_history_inclusion_valid;

ALTER TABLE public.api_keys
  DROP COLUMN IF EXISTS account_shared_with_api_key_id,
  DROP COLUMN IF EXISTS account_share_kind,
  DROP COLUMN IF EXISTS history_inclusion;

-- reconnect_allocator_api_key, verbatim from 20260422101911.
CREATE OR REPLACE FUNCTION public.reconnect_allocator_api_key(
  p_api_key_id UUID
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_owner        UUID;
  v_already_disc TIMESTAMPTZ;
  v_uid          UUID := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated'
      USING ERRCODE = '42501';
  END IF;

  SELECT user_id, disconnected_at INTO v_owner, v_already_disc
    FROM api_keys WHERE id = p_api_key_id;

  IF v_owner IS NULL OR v_owner <> v_uid THEN
    RAISE EXCEPTION 'reconnect_allocator_api_key: caller does not own api_key %', p_api_key_id
      USING ERRCODE = '42501';  -- insufficient_privilege
  END IF;

  -- Idempotent: not disconnected → NO-OP.
  IF v_already_disc IS NULL THEN
    RETURN false;
  END IF;

  UPDATE api_keys
    SET disconnected_at = NULL,
        sync_error      = NULL,
        sync_status     = 'idle'
    WHERE id = p_api_key_id
      AND user_id = v_uid
      AND disconnected_at IS NOT NULL;

  RETURN true;
END;
$$;

COMMENT ON FUNCTION public.reconnect_allocator_api_key IS
  'Migration 075: reverse of disconnect_allocator_api_key. Clears disconnected_at + resets sync_error and sync_status=idle so the next cron tick picks the key up fresh. Returns false if the key was not disconnected.';

REVOKE ALL ON FUNCTION public.reconnect_allocator_api_key(uuid)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reconnect_allocator_api_key(uuid)
  TO authenticated;

-- COMMENT ON COLUMN, verbatim from 20260920120000.
COMMENT ON COLUMN public.api_keys.venue_account_id IS
  'Phase 154/WIZCONT-02, RE-STAMPED by 164.5.3/MT5CREDS (founder decision '
  'D-01-PRIME, 2026-09-20; full reasoning in 164.5.3-CONTEXT.md AMENDMENT '
  'section, not restated here). NON-SECRET account identity for the '
  'credential in this row: the MT5 broker login today, which '
  'analytics-service/services/mt5_probe.py asserts against the gateway at '
  'validation time. It is an ACCOUNT NUMBER, not a credential. The secret '
  'half lives in api_key_encrypted and never comes near this column. '
  'TRUST BOUNDARY, STATED HONESTLY: DO NOT CALL THIS VALUE '
  'VENUE-CONFIRMED. What is enforced, by FOUR independent fences (see the '
  'header of this migration file for the full argument): a direct client '
  'INSERT is scrubbed to NULL by the scrub_client_supplied_venue_account_id '
  'trigger (20260812083206); direct client INSERT and UPDATE on api_keys '
  'are both fully revoked (20260823120000, 20260810120000 respectively); '
  'and authenticated holds NO EXECUTE on either wizard RPC (20260814120000), '
  'though that REVOKE is NOT durable across a future DROP+CREATE of either '
  'RPC unless the REVOKE/GRANT pair is re-issued in the same change (see '
  'the header of that migration). What is NOT enforced: the value has no '
  'in-database oracle. The real guarantee is a login the server has '
  'authenticated credentials for. The value is persisted only after the '
  'credentials it is derived from authenticated read-only against the live '
  'broker at connect time, or by decrypting the stored ciphertext already '
  'on this same row on an update, never accepted as a fresh caller-supplied '
  'string with no server-side step behind it. A caller can choose which of '
  'their own working broker logins to connect; they cannot mint one they '
  'do not hold. Treat the value as what the server derived, not what the '
  'venue confirmed: the CR-01 provenance residual (164.5.3-CONTEXT.md '
  'AMENDMENT, D-01-PRIME) stays OPEN. '
  'NULL is the NORMAL value and means this venue exposes no stable '
  'non-secret account id at validation: every ccxt venue today, whose '
  'ValidationResult carries no account-identity field at all. That is why '
  'api_keys_user_exchange_venue_account_uniq is PARTIAL: under a total '
  'index every NULL would collide and no user could hold two ccxt keys. '
  'api_keys_venue_account_id_nonblank forbids blank and whitespace-only '
  'values, because a blank string is non-NULL and would otherwise be '
  'governed by that index as if it were a real identity, collapsing two '
  'DIFFERENT accounts onto one row. '
  'OVERRIDE, RECORDED HONESTLY (164.5.3/MT5CREDS, founder decision '
  'D-01-PRIME, 2026-09-20): the prior form of this comment said never to '
  'echo this value to the browser, and said it was not readable by anon or '
  'authenticated anyway. BOTH ARE NOW FALSE BY DESIGN. This migration '
  'GRANTs authenticated SELECT on this column so the key card can display '
  'it. That is a bounded confidentiality delta under the threat model '
  'migration 027 states: a compromised user account or an XSS-captured '
  'JWT can now also read this identifier, not just exchange/label. It is '
  'accepted because the founder demonstrably needs the identifier to tell '
  'same-venue MT5 cards apart, and because publishing discloses nothing '
  'ACROSS a tenant boundary, since RLS still scopes every row to its own '
  'owner. anon still has NO grant on this column: migration 20260410225608 '
  'REVOKE-then-allowlist governs it and anon is not on the allowlist.';

-- COMMENT ON INDEX, verbatim from supabase/schema/baseline.sql, i.e. the text
-- PROD carries today. ⚠️ MEASURED 2026-09-25: it is NOT the text migration
-- 20260812083206 writes. That migration's COMMENT ON INDEX is a longer, later
-- wording, and PROD holds a shorter one that no migration in this repository
-- produces. The rollback restores what PROD had, not what the file says.
COMMENT ON INDEX public.api_keys_user_exchange_venue_account_uniq IS
  'Phase 154 / WIZCONT-02: at most one LIVE api_keys row per (user, venue, account id). FAILS TOWARD THE EXISTING ROW — the duplicate INSERT raises 23505 and the route resolves to the row already there; never overwrite. ⭐ SCOPED TO LIVE ROWS (disconnected_at IS NULL): api_keys rows are RETAINED on soft-disconnect (20260422101911), so without that conjunct a DEAD row squats the slot forever and a re-connecting user gets a key every cron dispatcher skips — a strategy that silently never syncs. sync_status = ''revoked'' is deliberately NOT in the predicate. PARTIAL because NULL is the majority value; api_keys_venue_account_id_nonblank keeps '''' out. user_id LEADS deliberately — a non-tenant-leading unique index is the C-08 cross-tenant leak. Gate: supabase/tests/test_api_keys_venue_identity_uniq.sql.';


-- ───────────── post-verify — CATALOGUE ONLY, reads no row
DO $verify$
DECLARE
  v_left text;
  v_src  text;
BEGIN
  SELECT string_agg(attname, ', ') INTO v_left
    FROM pg_attribute
   WHERE attrelid = 'public.api_keys'::regclass
     AND NOT attisdropped
     AND attname IN ('account_shared_with_api_key_id', 'account_share_kind', 'history_inclusion');
  IF v_left IS NOT NULL THEN
    RAISE EXCEPTION 'Rollback 20260925120000 failed: api_keys still has column(s) %', v_left;
  END IF;

  SELECT string_agg(conname, ', ') INTO v_left
    FROM pg_constraint
   WHERE conrelid = 'public.api_keys'::regclass
     AND conname IN ('api_keys_account_shared_with_api_key_id_fkey',
                     'api_keys_account_share_kind_valid',
                     'api_keys_account_share_both_or_neither',
                     'api_keys_account_share_not_self',
                     'api_keys_history_inclusion_valid');
  IF v_left IS NOT NULL THEN
    RAISE EXCEPTION 'Rollback 20260925120000 failed: constraint(s) survive: %', v_left;
  END IF;

  IF EXISTS (SELECT 1 FROM pg_trigger
              WHERE tgrelid = 'public.api_keys'::regclass
                AND tgname = 'api_keys_account_share_same_owner') THEN
    RAISE EXCEPTION 'Rollback 20260925120000 failed: trigger api_keys_account_share_same_owner survives';
  END IF;

  IF to_regprocedure('public.enforce_api_keys_account_share_same_owner()') IS NOT NULL
     OR to_regprocedure('public.set_departed_key_history_inclusion(uuid, text)') IS NOT NULL THEN
    RAISE EXCEPTION 'Rollback 20260925120000 failed: enforce_api_keys_account_share_same_owner or set_departed_key_history_inclusion survives';
  END IF;

  IF to_regclass('public.api_keys_account_shared_with_idx') IS NOT NULL THEN
    RAISE EXCEPTION 'Rollback 20260925120000 failed: index api_keys_account_shared_with_idx survives';
  END IF;

  SELECT prosrc INTO v_src
    FROM pg_proc WHERE oid = 'public.reconnect_allocator_api_key(uuid)'::regprocedure;
  IF position('KEY_VENUE_ALREADY_CONNECTED' IN v_src) > 0
     OR position('history_inclusion' IN v_src) > 0 THEN
    RAISE EXCEPTION 'Rollback 20260925120000 failed: reconnect_allocator_api_key still carries the refusal or the history_inclusion reset';
  END IF;

  -- Positive: the restored body is 20260422101911's, not merely a body that
  -- lacks the two additions.
  IF position('SELECT user_id, disconnected_at INTO v_owner, v_already_disc' IN v_src) = 0 THEN
    RAISE EXCEPTION 'Rollback 20260925120000 failed: reconnect_allocator_api_key lacks the 20260422101911 ownership SELECT';
  END IF;

  IF obj_description('public.reconnect_allocator_api_key(uuid)'::regprocedure, 'pg_proc')
     IS DISTINCT FROM 'Migration 075: reverse of disconnect_allocator_api_key. Clears disconnected_at + resets sync_error and sync_status=idle so the next cron tick picks the key up fresh. Returns false if the key was not disconnected.' THEN
    RAISE EXCEPTION 'Rollback 20260925120000 failed: reconnect_allocator_api_key''s COMMENT is not the 20260422101911 text';
  END IF;

  v_src := col_description('public.api_keys'::regclass,
             (SELECT attnum FROM pg_attribute
               WHERE attrelid = 'public.api_keys'::regclass AND attname = 'venue_account_id'));
  IF v_src IS NULL
     OR position('NULL is the NORMAL value' IN v_src) = 0
     OR position('Phase 167.1.2' IN v_src) > 0 THEN
    RAISE EXCEPTION 'Rollback 20260925120000 failed: COMMENT ON COLUMN api_keys.venue_account_id is not the 20260920120000 text';
  END IF;

  v_src := obj_description('public.api_keys_user_exchange_venue_account_uniq'::regclass, 'pg_class');
  IF v_src IS NULL
     OR position('PARTIAL because NULL is the majority value' IN v_src) = 0
     OR position('Phase 167.1.2' IN v_src) > 0 THEN
    RAISE EXCEPTION 'Rollback 20260925120000 failed: COMMENT ON INDEX api_keys_user_exchange_venue_account_uniq is not the text PROD carried';
  END IF;

  -- The ACL supabase/schema/baseline.sql records for this function.
  IF NOT has_function_privilege('authenticated', 'public.reconnect_allocator_api_key(uuid)', 'EXECUTE')
     OR NOT has_function_privilege('service_role', 'public.reconnect_allocator_api_key(uuid)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.reconnect_allocator_api_key(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'Rollback 20260925120000 failed: reconnect_allocator_api_key EXECUTE is not authenticated and service_role only (anon must hold none)';
  END IF;

  RAISE NOTICE 'Rollback 20260925120000: every added column, constraint, trigger, function and index is gone; reconnect_allocator_api_key is the 20260422101911 body with its COMMENT, and EXECUTE for authenticated and service_role only; the venue_account_id and index COMMENTs are restored. The migration ledger row is left in place (see the header).';
END
$verify$;

COMMIT;
