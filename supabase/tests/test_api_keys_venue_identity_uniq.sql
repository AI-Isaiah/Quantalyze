-- Test for migration 20260812120000 — Phase 154 / WIZCONT-02, the token-less
-- credential dedup backstop on api_keys.
--
-- ROOT CAUSE the migration fixes: re-connecting the SAME credentials from a
-- context that has LOST the `wizard_session_id` localStorage token sails past
-- the existing fence (strategies_user_wizard_session_source_uniq + the RPC's
-- 'wizdraft:' advisory lock), because that fence keys on the token. The result
-- is a duplicate strategy + a duplicate encrypted api_keys row. The migration
-- adds the second key that fence needs — the venue-confirmed, NON-SECRET account
-- identity — and a partial UNIQUE over it.
--
-- This file pins the structural invariants of that fix. pgTAP is not set up in
-- this project (CLAUDE.md / Lane B audit), so assertions RAISE EXCEPTION on
-- failure — a clean run prints a NOTICE; a failed assertion aborts with a clear
-- message.
--
-- ⚠️ supabase/tests/test_*.sql is the ONLY DB assertion form that runs in CI.
-- `*_live.py` and `skipIf` vitest never do, so nothing here may be deferred to
-- one of those.
--
-- WHAT THIS FILE WOULD REDDEN ON, stated so a future reader can check it still
-- would: the column dropped or retyped; the index dropped, made non-UNIQUE, made
-- TOTAL instead of partial, or re-ordered so user_id no longer leads; the RPC
-- re-based on a stale body (losing the F6 fence or the attested_venue stamp from
-- PR #675); a SECOND overload of the RPC appearing; either grant polarity lost;
-- the scrub trigger missing or its function turned SECURITY DEFINER.
--
-- Usage:
--   psql "$DATABASE_URL" -f supabase/tests/test_api_keys_venue_identity_uniq.sql

DO $$
DECLARE
  c_sig CONSTANT TEXT :=
    'create_wizard_strategy(uuid,text,text,text,text,text,text,text,integer,text,uuid,text)';

  v_col_type    TEXT;
  v_idx_def     TEXT;
  v_idx_cols    TEXT[];
  v_idx_unique  BOOLEAN;
  v_idx_partial BOOLEAN;
  v_overloads   INT;
  v_fn_src      TEXT;
  v_trg_secdef  BOOLEAN;
BEGIN
  -- ----- 1. api_keys.venue_account_id exists and is text --------------------
  SELECT data_type INTO v_col_type
    FROM information_schema.columns
   WHERE table_schema = 'public'
     AND table_name = 'api_keys'
     AND column_name = 'venue_account_id';
  IF v_col_type IS NULL THEN
    RAISE EXCEPTION 'TEST FAILED (1): api_keys.venue_account_id column is missing';
  END IF;
  IF v_col_type <> 'text' THEN
    RAISE EXCEPTION 'TEST FAILED (1): api_keys.venue_account_id must be text, got %', v_col_type;
  END IF;

  -- ----- 2. partial-UNIQUE on (user_id, exchange, venue_account_id) ---------
  SELECT indexdef INTO v_idx_def
    FROM pg_indexes
   WHERE schemaname = 'public'
     AND tablename = 'api_keys'
     AND indexname = 'api_keys_user_exchange_venue_account_uniq';
  IF v_idx_def IS NULL THEN
    RAISE EXCEPTION 'TEST FAILED (2): api_keys_user_exchange_venue_account_uniq index is missing — WIZCONT-02 has no DB backstop';
  END IF;
  IF v_idx_def NOT ILIKE '%UNIQUE%' THEN
    RAISE EXCEPTION 'TEST FAILED (2): api_keys_user_exchange_venue_account_uniq must be UNIQUE, it dedups nothing otherwise: %', v_idx_def;
  END IF;

  -- Assert the indexed column LIST AND ORDER from pg_index rather than
  -- substring-matching indexdef. ⛔ THE INDEX NAME CONTAINS EVERY COLUMN NAME
  -- ("user_exchange_venue_account"), and the name appears inside its own
  -- definition text, so an ILIKE for '%exchange%' would report agreement even if
  -- the column had been dropped from the key. The donor records this trap at
  -- test_wizard_session_idempotency.sql:64-68.
  --
  -- user_id MUST LEAD: uniqueness scoped on (exchange, venue_account_id) alone
  -- would let one owner's INSERT collide with a DIFFERENT owner's row — the C-08
  -- cross-tenant leak, and a denial of service on the second owner besides.
  SELECT array_agg(a.attname ORDER BY k.ord) INTO v_idx_cols
    FROM pg_index i
    JOIN pg_class c     ON c.oid = i.indexrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    CROSS JOIN LATERAL unnest(i.indkey) WITH ORDINALITY AS k(attnum, ord)
    JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = k.attnum
   WHERE n.nspname = 'public'
     AND c.relname = 'api_keys_user_exchange_venue_account_uniq';
  IF v_idx_cols IS DISTINCT FROM ARRAY['user_id', 'exchange', 'venue_account_id']::TEXT[] THEN
    RAISE EXCEPTION 'TEST FAILED (2): index must cover exactly (user_id, exchange, venue_account_id) in that order, got %', v_idx_cols;
  END IF;

  -- Must be PARTIAL. NULL is the NORMAL value here — it means "this venue
  -- exposes no stable non-secret account id", which is every ccxt venue today.
  -- Read indisunique/indpred from the catalog as well as the predicate text: a
  -- bare ILIKE on the definition is the vacuous form this file exists to avoid.
  SELECT i.indisunique, (i.indpred IS NOT NULL)
    INTO v_idx_unique, v_idx_partial
    FROM pg_index i
    JOIN pg_class c     ON c.oid = i.indexrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public'
     AND c.relname = 'api_keys_user_exchange_venue_account_uniq';
  IF NOT v_idx_unique THEN
    RAISE EXCEPTION 'TEST FAILED (2): pg_index.indisunique is false for api_keys_user_exchange_venue_account_uniq';
  END IF;
  IF NOT v_idx_partial THEN
    RAISE EXCEPTION 'TEST FAILED (2): api_keys_user_exchange_venue_account_uniq has no index predicate — it must be PARTIAL, or it governs the all-NULL majority of api_keys (every ccxt key)';
  END IF;
  IF v_idx_def NOT ILIKE '%venue_account_id IS NOT NULL%' THEN
    RAISE EXCEPTION 'TEST FAILED (2): index predicate must be (venue_account_id IS NOT NULL): %', v_idx_def;
  END IF;

  -- ----- 3. create_wizard_strategy: ONE overload, re-based on the LATEST body
  -- ⛔ EXACTLY ONE. PostgREST resolves rpc() by NAMED PARAMETERS; with two
  -- overloads a call naming the shared parameters matches both and it answers
  -- PGRST203, which breaks connect-a-key for every user. This is the assertion
  -- that catches a future `CREATE OR REPLACE` that tried to add a parameter
  -- (which cannot change a signature — it mints a sibling instead).
  SELECT count(*) INTO v_overloads
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'create_wizard_strategy';
  IF v_overloads <> 1 THEN
    RAISE EXCEPTION 'TEST FAILED (3): expected exactly 1 create_wizard_strategy overload in public, found % — PostgREST would answer PGRST203 to every connect-a-key call', v_overloads;
  END IF;

  SELECT pg_get_functiondef(p.oid) INTO v_fn_src
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'create_wizard_strategy';
  IF v_fn_src IS NULL THEN
    RAISE EXCEPTION 'TEST FAILED (3): create_wizard_strategy function is missing';
  END IF;

  -- THE STALE-RE-BASE CANARY, ASSERTED FROM THE OUTSIDE. The migration's own
  -- post-verify checks these too; this is the independent copy that survives
  -- the migration being edited. Each string names a guarantee that a body older
  -- than 20260811210000 would silently revert.
  IF v_fn_src NOT ILIKE '%pg_advisory_xact_lock%' OR v_fn_src NOT ILIKE '%wizdraft:%' THEN
    RAISE EXCEPTION 'TEST FAILED (3): create_wizard_strategy lost its wizdraft: advisory-lock fence — a re-base took a stale body and F6 double-submit idempotency is gone';
  END IF;
  IF v_fn_src NOT ILIKE '%attested_venue%' THEN
    RAISE EXCEPTION 'TEST FAILED (3): create_wizard_strategy no longer writes attested_venue — a re-base took a body older than 20260811210000 and reverted PR #675; every MT5 finalize would answer a permanent KEY_SCOPE_CHECK_UNAVAILABLE';
  END IF;
  IF v_fn_src NOT ILIKE '%p_venue_account_id%' THEN
    RAISE EXCEPTION 'TEST FAILED (3): create_wizard_strategy does not accept p_venue_account_id — the WIZCONT-02 identity is never stamped and the dedup index governs nothing';
  END IF;

  -- ----- 4. grants: authenticated EXECUTEs, anon does NOT -------------------
  -- ⛔ NOT A FORMALITY HERE. Migration 20260812120000 uses DROP + CREATE (a
  -- signature change cannot go through CREATE OR REPLACE), and DROP DESTROYS the
  -- ACL — a freshly created function grants EXECUTE to PUBLIC by default. The
  -- anon assertion below is what catches a re-issue of the function that forgot
  -- the REVOKE, i.e. a privilege escalation onto a SECURITY DEFINER function
  -- that writes api_keys and strategies.
  IF NOT has_function_privilege('authenticated', c_sig, 'EXECUTE') THEN
    RAISE EXCEPTION 'TEST FAILED (4): authenticated lost EXECUTE on create_wizard_strategy — connect-a-key is broken';
  END IF;
  IF has_function_privilege('anon', c_sig, 'EXECUTE') THEN
    RAISE EXCEPTION 'TEST FAILED (4): anon must NOT have EXECUTE on create_wizard_strategy';
  END IF;

  -- ----- 5. the scrub trigger, and that it is SECURITY INVOKER --------------
  -- Resolve the function through pg_trigger.tgfoid rather than by name, so this
  -- asserts the posture of the function ACTUALLY ATTACHED — a same-named
  -- function sitting unattached in the schema proves nothing.
  --
  -- ⛔ SECURITY INVOKER IS THE WHOLE POINT. Under SECURITY DEFINER, current_user
  -- inside the trigger resolves to the function's OWNER, the privileged-caller
  -- allowlist always passes, and the trigger becomes a SILENT NO-OP: every
  -- client-supplied venue_account_id persists, and a caller evades the dedup for
  -- free by inventing an id. That is the prevent_profile_role_change bug
  -- (20260529150000) and it must not recur here.
  SELECT p.prosecdef INTO v_trg_secdef
    FROM pg_trigger t
    JOIN pg_proc p ON p.oid = t.tgfoid
   WHERE t.tgrelid = 'public.api_keys'::regclass
     AND t.tgname = 'api_keys_scrub_venue_account_id'
     AND NOT t.tgisinternal;
  IF v_trg_secdef IS NULL THEN
    RAISE EXCEPTION 'TEST FAILED (5): the api_keys_scrub_venue_account_id BEFORE INSERT trigger is not attached to api_keys — a client could supply its own venue_account_id and evade the dedup';
  END IF;
  IF v_trg_secdef THEN
    RAISE EXCEPTION 'TEST FAILED (5): the api_keys_scrub_venue_account_id trigger function is SECURITY DEFINER, so current_user resolves to its owner, the privileged check always passes, and the trigger is a silent no-op — it must be SECURITY INVOKER';
  END IF;

  RAISE NOTICE 'PASS: WIZCONT-02 identity invariants intact (api_keys.venue_account_id text + tenant-leading partial-UNIQUE (user_id, exchange, venue_account_id) WHERE NOT NULL + exactly one create_wizard_strategy overload carrying the wizdraft:/attested_venue/p_venue_account_id canaries + grants authenticated-yes/anon-no + SECURITY INVOKER scrub trigger attached).';
END $$;
