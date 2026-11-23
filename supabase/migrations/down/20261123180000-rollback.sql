-- ============================================================================
-- ROLLBACK for 20261123180000_api_keys_venue_server.sql
-- Phase 225 ONEACCOUNTONCE, plan 01 (CONN-03, founder ruling Q2).
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
--   1. DROPs the 13-parameter create_wizard_strategy.
--   2. Re-creates the 12-parameter function exactly as it stood before the migration
--      (the body of 20260814120000_wizard_rpcs_revoke_authenticated.sql, copied from the
--      function snapshot taken before this plan regenerated it) and re-issues its ACL
--      pair, because a fresh CREATE re-grants anon and authenticated through
--      pg_default_acl.
--
-- ⚠️ THE COLUMN IS KEPT (keep-data rule). api_keys.venue_server and its CHECK
-- api_keys_venue_server_valid stay in place: an unused nullable column is harmless,
-- every value in it is a plaintext broker server name that is kept as evidence, and
-- nothing but the owner and service_role can read it. Dropping it is a founder decision
-- and no part of this file. The 12-parameter function no longer writes it.
--
-- ⚠️ ROLL THE CODE BACK FIRST. Once any route sends p_venue_server, this rollback makes
-- every connect answer PGRST202, because the function it calls no longer has that
-- parameter. Revert the routes that send it, then run this file.
--
-- ⚠️ THE MIGRATION LEDGER ROW IS LEFT IN PLACE. This file does not touch
-- supabase_migrations.schema_migrations, so after it runs the ledger still records
-- version 20261123180000 as applied and `supabase db push` will not re-apply the
-- migration. To re-apply it, delete that ledger row in the same change (or mark it
-- reverted with `supabase migration repair --status reverted 20261123180000` against the
-- intended database, after the marker query above names that database). Re-applying also
-- needs the column dropped first, because the migration ADDs it without IF NOT EXISTS.
--
-- The DO block before the change is a catalogue-only PRECONDITION and the DO block after
-- it is a catalogue-only verify. Neither reads a row.
-- ============================================================================

SET LOCAL lock_timeout = '3s';

-- ───────────── precondition — CATALOGUE ONLY, reads no row
DO $precondition$
BEGIN
  IF to_regprocedure('public.create_wizard_strategy(uuid,text,text,text,text,text,text,text,integer,text,uuid,text,text)') IS NULL THEN
    RAISE EXCEPTION 'Rollback 20261123180000 refused: the 13-parameter create_wizard_strategy is not present, so this database does not carry 20261123180000. Nothing was changed. Run the marker query in CLAUDE.md to see which database this is.';
  END IF;
  IF to_regprocedure('public.create_wizard_strategy(uuid,text,text,text,text,text,text,text,integer,text,uuid,text)') IS NOT NULL THEN
    RAISE EXCEPTION 'Rollback 20261123180000 refused: a 12-parameter create_wizard_strategy already exists, so this rollback already ran or the database is in another state. Nothing was changed.';
  END IF;
END
$precondition$;

-- 1. Drop the 13-parameter function.
DROP FUNCTION public.create_wizard_strategy(
  uuid, text, text, text, text, text, text, text, integer, text, uuid, text, text
);

-- 2. Re-create the 12-parameter function, body as of 20260814120000.
CREATE FUNCTION public.create_wizard_strategy(
  p_user_id UUID,
  p_exchange TEXT,
  p_label TEXT,
  p_api_key_encrypted TEXT,
  p_api_secret_encrypted TEXT,
  p_passphrase_encrypted TEXT,
  p_dek_encrypted TEXT,
  p_nonce TEXT,
  p_kek_version INTEGER,
  p_placeholder_name TEXT,
  p_wizard_session_id UUID,
  p_venue_account_id TEXT DEFAULT NULL
)
RETURNS TABLE(strategy_id UUID, api_key_id UUID)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
SET lock_timeout = '3s'
AS $$
DECLARE
  v_jwt_role TEXT;
  v_key_id UUID;
  v_strategy_id UUID;
BEGIN
  -- ⭐ FINAL GATE (Phase 156 Migration B). Migration A's `authenticated` arm is
  -- DELETED. Only service_role may write a wizard draft.
  --
  -- Fail-closed wrapper carried from
  -- `20260515113753_log_audit_event_service_hardened.sql:130-160`: a malformed
  -- request.jwt.claims makes auth.role() RAISE rather than return NULL. NULL
  -- then fails the IS DISTINCT FROM test and is REFUSED.
  --
  -- ⛔ THE WIDTH OF THAT PRECEDENT IS REJECTED. log_audit_event_service admits
  -- `auth.role() IN ('authenticated','service_role')` at 20260515113753:148.
  -- `authenticated` is THE EXACT CALLER THIS PHASE EXISTS TO LOCK OUT; admitting
  -- it here would make this layer a permanent no-op, so that a future GRANT leak
  -- would pass BOTH layers. Carry that file's auth.role() choice, its fail-closed
  -- wrapper, its self-contained REVOKE/GRANT and its body canary. Reject its
  -- width. (156-PATTERNS.md §1; Rule 7 — pick one, say why, never average.)
  --
  -- ⛔ TRAP B — WHY auth.uid() IS ABSENT RATHER THAN RELAXED. `156-MEASUREMENTS.md`
  -- § A2 MEASURED auth.uid() IS NULL for a service_role client. So a "relaxed"
  -- comparison kept for safety — `IF v_auth_uid IS NOT NULL AND v_auth_uid <>
  -- p_user_id` — would be a PERMANENT SILENT NO-OP: the ownership check vanishes
  -- with no error, no 42501, and no test failure. Deleting it is HONEST; keeping
  -- a decorative one is the `_assert_owner` shape at 20260411144407:300-302 that
  -- this phase must not reproduce. Post-verify (e) below aborts the apply if the
  -- literal `auth.uid()` reappears in either body.
  --
  -- ⛔ TRAP C — NEVER current_user / session_user. Inside a SECURITY DEFINER body
  -- current_user is the OWNER, so a gate written on it ALWAYS PASSES — the bug
  -- that made `prevent_profile_role_change` a no-op (20260811210000:518-523,
  -- 20260411103316:313-321). session_user is `authenticator` for every PostgREST
  -- request. auth.role() reads the JWT claim, which is the thing we mean.
  BEGIN
    v_jwt_role := auth.role();
  EXCEPTION WHEN OTHERS THEN
    v_jwt_role := NULL;
  END;

  IF v_jwt_role IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'create_wizard_strategy: caller role (%) may not write wizard drafts',
      COALESCE(v_jwt_role, '<none>')
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- auth.uid() is NULL under service_role, so p_user_id is the ONLY carrier of
  -- the owning identity and a NULL would silently mint an ownerless draft.
  -- Refuse it explicitly rather than let the FK or a later read decide.
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'create_wizard_strategy: p_user_id must not be NULL'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  -- F6 (H-0304/H-0311/H-0186): idempotency fence. Serialize concurrent calls
  -- carrying the same wizard_session_id on a transaction-scoped advisory lock
  -- (auto-released on commit/rollback; advisory locks are not subject to
  -- lock_timeout), then return any draft already created for this
  -- (user, session) instead of minting a duplicate strategies + api_keys pair.
  PERFORM pg_advisory_xact_lock(
    hashtext('wizdraft:' || p_user_id::text || ':' || p_wizard_session_id::text)
  );

  -- Only replay a COMPLETE draft (api_key_id present). If an orphaned draft
  -- exists for this session with a NULL api_key_id (its api_keys row was deleted
  -- out from under it via the ON DELETE SET NULL FK), do NOT hand back a NULL
  -- key — fall through so the INSERT trips strategies_user_wizard_session_uniq
  -- (23505 → the route's recoverable DRAFT_ALREADY_EXISTS 409) instead of
  -- returning a NULL api_key_id the route would reject with a permanent 500
  -- (red-team MEDIUM-1: route fence requires api_key_id; the two must agree).
  SELECT s.id, s.api_key_id
    INTO v_strategy_id, v_key_id
    FROM strategies s
   WHERE s.user_id = p_user_id
     AND s.wizard_session_id = p_wizard_session_id
     AND s.api_key_id IS NOT NULL
   LIMIT 1;

  IF v_strategy_id IS NOT NULL THEN
    RETURN QUERY SELECT v_strategy_id, v_key_id;
    RETURN;
  END IF;

  -- 153.6 / PARITY-04: attested_venue is stamped HERE, inside the SECURITY
  -- DEFINER body, which is the only kind of writer whose value survives the
  -- api_keys_scrub_attested_venue trigger.
  -- ⛔ p_exchange IS STILL CALLER-SUPPLIED AND STILL NOT VALIDATED HERE. Both
  -- columns are written from that ONE parameter deliberately: the CHECK
  -- api_keys_attested_venue_matches_exchange requires it, so this INSERT cannot
  -- mint an attestation that disagrees with the routing label.
  --
  -- ⭐ CR-01 STATUS UNDER MIGRATION B: CLOSED for the browser, BOUNDED for us.
  -- `authenticated` no longer holds EXECUTE (§3), so the direct-RPC path is shut
  -- and the only callers are our two routes, which pass the venue the server
  -- observed a successful read-only authentication at. The residual that REMAINS
  -- is the service_role trust boundary itself — see header ⛔ (iii). Do not read
  -- this as "the venue cannot be forged".
  --
  -- 154 / WIZCONT-02: venue_account_id is stamped here for the same structural
  -- reason. ⛔ It is NOT coupled to p_exchange and must not be: it identifies an
  -- ACCOUNT WITHIN a venue, not the venue. It is NULL for every venue that
  -- exposes no stable non-secret account id, which is every ccxt venue today,
  -- and the partial index excludes those rows.
  -- ⛔ Do not "fix" it by adding validation here — the value has no in-database
  -- oracle to check against, and a plausible-looking check would hide the residual.
  --
  -- ⭐ NORMALISED AT THE STAMP SITE: btrim, then blank → NULL. (1) Without btrim,
  -- ' 5551234' and '5551234' are DIFFERENT index keys, so a stray space from the
  -- form makes the dedup MISS entirely. (2) Without the NULLIF, an unset field
  -- arriving as '' would be stored as a non-NULL value the partial index governs,
  -- colliding two GENUINELY DIFFERENT accounts — api_keys_venue_account_id_nonblank
  -- would REFUSE that INSERT with 23514, which the wizard route has no handler
  -- for. Keep this expression and the CHECK in agreement.
  INSERT INTO api_keys (
    user_id, exchange, label,
    api_key_encrypted, api_secret_encrypted, passphrase_encrypted,
    dek_encrypted, nonce, kek_version, is_active,
    attested_venue, venue_account_id
  )
  VALUES (
    p_user_id, p_exchange, p_label,
    p_api_key_encrypted, p_api_secret_encrypted, p_passphrase_encrypted,
    p_dek_encrypted, p_nonce, COALESCE(p_kek_version, 1), TRUE,
    p_exchange, NULLIF(btrim(p_venue_account_id), '')
  )
  RETURNING id INTO v_key_id;

  INSERT INTO strategies (
    user_id, api_key_id, name, status, source,
    strategy_types, subtypes, markets, supported_exchanges,
    wizard_session_id
  )
  VALUES (
    p_user_id, v_key_id, p_placeholder_name, 'draft', 'wizard',
    '{}', '{}', '{}', ARRAY[p_exchange],
    p_wizard_session_id
  )
  RETURNING id INTO v_strategy_id;

  RETURN QUERY SELECT v_strategy_id, v_key_id;
END;
$$;

-- 3. The ACL pair, re-issued (the CREATE above re-granted anon and authenticated).
REVOKE ALL ON FUNCTION public.create_wizard_strategy(
  uuid, text, text, text, text, text, text, text, integer, text, uuid, text
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_wizard_strategy(
  uuid, text, text, text, text, text, text, text, integer, text, uuid, text
) TO service_role;

COMMENT ON FUNCTION public.create_wizard_strategy(
  uuid, text, text, text, text, text, text, text, integer, text, uuid, text
) IS
  'Atomic, idempotent api_keys + strategies (source=wizard, status=draft) insert. SECURITY DEFINER; guard_wizard_draft_updates allows the write via the current_user shift, and both api_keys scrub triggers admit the owner. F6: a per-(user, wizard_session_id) advisory lock + select-existing fence dedups double-submits to one draft; strategies_user_wizard_session_source_uniq is the backstop. 153.6/PARITY-04: stamps attested_venue from p_exchange. 154/WIZCONT-02: stamps venue_account_id from p_venue_account_id, NORMALISED as NULLIF(btrim(...), '''') so a stray space cannot make the dedup miss and a blank field cannot become an identity. 156/Migration B (20260814120000): SERVICE_ROLE ONLY; authenticated EXECUTE is REVOKED and the in-body gate is auth.role() IS DISTINCT FROM ''service_role''. There is NO auth.uid() check and its absence is deliberate. p_venue_account_id is STILL NOT VALIDATED here; the value has no in-database oracle. EXACTLY ONE OVERLOAD OF THIS FUNCTION MAY EXIST: PostgREST resolves rpc() by named parameters and answers PGRST203 if a second candidate appears. Add parameters by DROP + CREATE WITH RE-ISSUED GRANTS, never by CREATE OR REPLACE. (Restored by the rollback of 20261123180000.)';

-- ───────────── verify — CATALOGUE ONLY, reads no row
DO $verify$
DECLARE
  v_fn_oid oid;
  v_count  int;
BEGIN
  SELECT count(*) INTO v_count
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'create_wizard_strategy';
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'Rollback 20261123180000 failed: expected exactly 1 create_wizard_strategy overload in public, found %', v_count;
  END IF;

  v_fn_oid := to_regprocedure('public.create_wizard_strategy(uuid,text,text,text,text,text,text,text,integer,text,uuid,text)');
  IF v_fn_oid IS NULL THEN
    RAISE EXCEPTION 'Rollback 20261123180000 failed: the 12-parameter create_wizard_strategy does not resolve';
  END IF;
  IF NOT has_function_privilege('service_role', v_fn_oid, 'EXECUTE') THEN
    RAISE EXCEPTION 'Rollback 20261123180000 failed: service_role holds no EXECUTE on create_wizard_strategy';
  END IF;
  IF has_function_privilege('anon', v_fn_oid, 'EXECUTE') OR has_function_privilege('authenticated', v_fn_oid, 'EXECUTE') THEN
    RAISE EXCEPTION 'Rollback 20261123180000 failed: anon or authenticated holds EXECUTE on create_wizard_strategy';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_proc p, aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) a
              WHERE p.oid = v_fn_oid AND a.grantee = 0 AND a.privilege_type = 'EXECUTE') THEN
    RAISE EXCEPTION 'Rollback 20261123180000 failed: PUBLIC holds EXECUTE on create_wizard_strategy';
  END IF;
  IF to_regclass('public.api_keys') IS NULL OR NOT EXISTS (
       SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'api_keys' AND column_name = 'venue_server') THEN
    RAISE EXCEPTION 'Rollback 20261123180000 failed: api_keys.venue_server is missing, but this file keeps the column';
  END IF;

  RAISE NOTICE 'Rollback 20261123180000: the 12-parameter create_wizard_strategy is restored, service_role-only. api_keys.venue_server is kept with every stored value. The migration ledger row is left in place (see the header).';
END
$verify$;
