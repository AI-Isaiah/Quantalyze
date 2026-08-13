-- Test for migration 20260812083206 — Phase 154 / WIZCONT-02, the token-less
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
-- TOTAL instead of partial, or re-ordered so user_id no longer leads; THE INDEX
-- PREDICATE LOSING EITHER CONJUNCT (`venue_account_id IS NOT NULL` or
-- `disconnected_at IS NULL`); the api_keys_venue_account_id_nonblank CHECK going
-- missing or turning NOT VALID; the RPC losing its NULLIF(btrim(...)) identity
-- normalisation; EITHER wizard RPC re-based on a stale body (losing its F6 /
-- ONB-03 advisory-lock fence or the attested_venue stamp from PR #675); a SECOND
-- overload of EITHER RPC appearing; any grant polarity lost — including
-- `authenticated` REGAINING EXECUTE, whose polarity Phase 156 / CONNECT-01
-- inverted (see section 4); either body losing its auth.role() gate or
-- reintroducing auth.uid() (section 3c); the scrub trigger missing or its
-- function turned SECURITY DEFINER. Section 6 adds the BEHAVIOURAL half: it seeds real api_keys
-- rows and proves the index and the CHECK actually fire, so none of the
-- structural assertions above can pass vacuously against a constraint that
-- exists but does nothing.
--
-- Usage:
--   psql "$DATABASE_URL" -f supabase/tests/test_api_keys_venue_identity_uniq.sql

DO $$
DECLARE
  c_sig CONSTANT TEXT :=
    'create_wizard_strategy(uuid,text,text,text,text,text,text,text,integer,text,uuid,text)';
  -- ⚠️ ELEVEN types, not twelve. add_wizard_composite_key has no
  -- p_venue_account_id — the composite path stamps no venue identity. The arity
  -- asymmetry is real; has_function_privilege's text form matches the DECLARED
  -- argument list EXACTLY, so borrowing c_sig's 12 types here would raise
  -- undefined_function and report "function does not exist" instead of a verdict.
  k_sig CONSTANT TEXT :=
    'add_wizard_composite_key(uuid,text,text,text,text,text,text,text,integer,text,uuid)';

  v_col_type    TEXT;
  v_idx_def     TEXT;
  v_idx_cols    TEXT[];
  v_idx_unique  BOOLEAN;
  v_idx_partial BOOLEAN;
  v_overloads   INT;
  v_fn_src      TEXT;
  v_fn_src_k    TEXT;   -- add_wizard_composite_key, raw definition
  -- ⛔ COMMENT-STRIPPED COPIES, used ONLY by the auth.role()/auth.uid() lines
  -- below. `pg_get_functiondef` reconstructs from `prosrc`, which stores the
  -- source VERBATIM — comments included — and BOTH post-156 bodies discuss
  -- auth.uid() at length in prose explaining why it is absent. A raw
  -- `NOT ILIKE '%auth.uid()%'` would therefore red against the very body it
  -- exists to certify, on the strength of that body's own documentation. The
  -- strip is line-comment only and mirrors migration 20260814120000's own
  -- post-verify; if a `--` is ever added inside a string literal in either body,
  -- revisit these assertions rather than widening the strip blindly.
  v_fn_code     TEXT;   -- create_wizard_strategy, comments stripped
  v_fn_code_k   TEXT;   -- add_wizard_composite_key, comments stripped
  v_trg_secdef  BOOLEAN;
  v_chk_valid   BOOLEAN;
  v_chk_def     TEXT;
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

  -- ⛔ BOTH CONJUNCTS, ASSERTED SEPARATELY. An assertion on
  -- `venue_account_id IS NOT NULL` alone passes VACUOUSLY against the earlier,
  -- lifecycle-blind predicate — it is true of both versions, so it distinguishes
  -- nothing. The `disconnected_at IS NULL` conjunct is the load-bearing half:
  -- api_keys rows are RETAINED on soft-disconnect (migration 20260422101911), so
  -- without it a DEAD row squats the (user, exchange, venue_account_id) slot
  -- forever. The founder who disconnects an MT5 key and re-connects the same
  -- broker login then gets 23505, the index's "FAIL TOWARD THE EXISTING ROW"
  -- contract resolves them onto the disconnected row, and every cron dispatcher
  -- skips it (they all filter disconnected_at IS NULL) — a strategy that
  -- silently never syncs, which is worse than the duplicate the index prevents.
  IF v_idx_def NOT ILIKE '%venue_account_id IS NOT NULL%' THEN
    RAISE EXCEPTION 'TEST FAILED (2): index predicate lost (venue_account_id IS NOT NULL): %', v_idx_def;
  END IF;
  IF v_idx_def NOT ILIKE '%disconnected_at IS NULL%' THEN
    RAISE EXCEPTION 'TEST FAILED (2): index predicate is NOT scoped to live keys — it lacks (disconnected_at IS NULL): %. A soft-disconnected row would permanently squat the (user, exchange, venue_account_id) slot and a re-connecting user would be resolved onto a key every cron dispatcher skips', v_idx_def;
  END IF;

  -- ----- 2b. '' is not an identity: the non-blank CHECK ---------------------
  -- ⭐ '' IS NON-NULL, so the partial index above governs it. Without this
  -- constraint two GENUINELY DIFFERENT accounts arriving as '' collide, and
  -- "fail toward the existing row" resolves one user's connect onto a DIFFERENT
  -- account's encrypted credentials and strategy_keys membership — silent
  -- wrong-account attribution, the inverse of the defect the index exists to
  -- prevent. '' is the most likely coercion artifact from an unset form field or
  -- a `?? ''` in the route.
  --
  -- convalidated, not merely present: a NOT VALID constraint polices new writes
  -- while leaving existing rows unchecked, so "it exists" is the weaker claim.
  SELECT convalidated INTO v_chk_valid
    FROM pg_constraint
   WHERE conrelid = 'public.api_keys'::regclass
     AND conname  = 'api_keys_venue_account_id_nonblank'
     AND contype  = 'c';
  IF v_chk_valid IS NULL THEN
    RAISE EXCEPTION 'TEST FAILED (2b): the api_keys_venue_account_id_nonblank CHECK is absent — '''' is non-NULL, so the partial index would govern it and two DIFFERENT accounts could collide onto one row';
  END IF;
  IF NOT v_chk_valid THEN
    RAISE EXCEPTION 'TEST FAILED (2b): api_keys_venue_account_id_nonblank exists but is NOT VALID — rows already in the table were never checked against it';
  END IF;

  -- …and it is the constraint it claims to be, not a re-cut CHECK (true).
  -- `IS NULL` must survive: NULL is the normal value for every ccxt venue, and a
  -- constraint that lost it would refuse every ccxt key at INSERT.
  SELECT pg_get_constraintdef(oid) INTO v_chk_def
    FROM pg_constraint
   WHERE conrelid = 'public.api_keys'::regclass
     AND conname  = 'api_keys_venue_account_id_nonblank';
  IF v_chk_def NOT ILIKE '%btrim(%'
     OR v_chk_def NOT ILIKE '%<> ''''%'
     OR v_chk_def NOT ILIKE '%IS NULL%' THEN
    RAISE EXCEPTION 'TEST FAILED (2b): api_keys_venue_account_id_nonblank is not the constraint it claims to be. Expected CHECK (venue_account_id IS NULL OR btrim(venue_account_id) <> ''''), got: %', v_chk_def;
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

  -- The stamp site NORMALISES: NULLIF(btrim(p_venue_account_id), ''). Losing the
  -- btrim makes ' 5551234' and '5551234' index as DIFFERENT keys, so the dedup
  -- misses the very re-connect it exists to catch. Losing the NULLIF turns an
  -- unset form field ('' from a `?? ''`) into a 23514 against
  -- api_keys_venue_account_id_nonblank that the wizard route has no handler for.
  -- Asserted here because the expression is one "simplification" away from being
  -- the bare parameter again.
  IF v_fn_src NOT ILIKE '%nullif(btrim(p_venue_account_id)%' THEN
    RAISE EXCEPTION 'TEST FAILED (3): create_wizard_strategy stamps venue_account_id WITHOUT the NULLIF(btrim(...), '''') normalisation — whitespace would make the dedup miss, and a blank field would hit api_keys_venue_account_id_nonblank as an unhandled 23514';
  END IF;

  -- ----- 3b. add_wizard_composite_key: the SAME canary, which it never had ---
  -- ⭐ THE TWIN THIS FILE WAS MISSING. Everything in section 3 above pins
  -- create_wizard_strategy against a stale re-base. Its composite sibling — ONE
  -- CONTRACT WITH TWO ENTRY POINTS — had no such pin anywhere in supabase/tests,
  -- so a re-base that reverted only the composite body would have shipped
  -- silently. Phase 153.6 exists because a fix landed on one of these two and not
  -- the other, and the Phase 153 span verification found that class still open on
  -- 2026-08-13. Change one, pin both.
  SELECT count(*) INTO v_overloads
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'add_wizard_composite_key';
  IF v_overloads <> 1 THEN
    RAISE EXCEPTION 'TEST FAILED (3b): expected exactly 1 add_wizard_composite_key overload in public, found % — PostgREST resolves rpc() by NAMED PARAMETERS and answers PGRST203 when two candidates match, which breaks every composite key add', v_overloads;
  END IF;

  SELECT pg_get_functiondef(p.oid) INTO v_fn_src_k
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'add_wizard_composite_key';
  IF v_fn_src_k IS NULL THEN
    RAISE EXCEPTION 'TEST FAILED (3b): add_wizard_composite_key function is missing';
  END IF;

  -- Each string names a guarantee a stale re-base would silently revert, and the
  -- migration whose body it would be reverted TO.
  IF v_fn_src_k NOT ILIKE '%pg_advisory_xact_lock%' OR v_fn_src_k NOT ILIKE '%wizcomposite:%' THEN
    RAISE EXCEPTION 'TEST FAILED (3b): add_wizard_composite_key lost its wizcomposite: advisory-lock fence — a re-base took a body older than 20260710180000, and the ONB-03 per-(user, session) DRAFT fence is gone: a double-click now mints TWO composite drafts. ⛔ The lock space is DISTINCT from the single-key wizdraft: space on purpose; a body holding wizdraft: here has been re-based onto the wrong twin';
  END IF;
  IF v_fn_src_k NOT ILIKE '%attested_venue%' THEN
    RAISE EXCEPTION 'TEST FAILED (3b): add_wizard_composite_key no longer writes attested_venue — a re-base took a body older than 20260811210000 and reverted PR #675 on the COMPOSITE half only. Every composite member lands with a NULL attestation, so every MT5 finalize answers a permanent KEY_SCOPE_CHECK_UNAVAILABLE (156-RESEARCH.md Pitfall 8). The single-key assertions in section 3 above would still be GREEN — that asymmetry is exactly why this block exists';
  END IF;

  -- ----- 3c. BOTH bodies: auth.role() PRESENT, auth.uid() ABSENT ------------
  -- ⭐ THE TRAP-B STRUCTURAL GUARD, ASSERTED FROM THE OUTSIDE. Migration
  -- 20260814120000's own post-verify (e) checks this too — but a post-verify runs
  -- ONCE, at apply, inside the file that carries it. THIS copy survives that
  -- migration being edited, re-based, replayed from a stale snapshot, or reverted
  -- by a later one, because it re-runs in sql-tests on every PR forever.
  --
  -- ⛔ WHY auth.uid()'s ABSENCE IS THE ASSERTION AND NOT ITS PRESENCE — this
  -- polarity looks backwards and a future reader will be tempted to "correct" it.
  -- `156-MEASUREMENTS.md` § A2 MEASURED auth.uid() IS NULL for a service_role
  -- client, and since 20260814120000 service_role is the ONLY caller these bodies
  -- admit. So a body carrying auth.uid() under a service_role caller does not
  -- have a STRICTER ownership check — it has a PERMANENT SILENT NO-OP: the
  -- comparison never fires, raises nothing, and fails no test, exactly the
  -- `_assert_owner` shape at 20260411144407:300-302. Ownership is bound at the
  -- route (p_user_id is withAuth's getUser()-verified user.id, ADR-0022), and
  -- reintroducing a DB-tier comparison would announce a control that is not there.
  v_fn_code   := regexp_replace(v_fn_src,   '--[^\n]*', '', 'g');
  v_fn_code_k := regexp_replace(v_fn_src_k, '--[^\n]*', '', 'g');

  IF v_fn_code NOT LIKE '%auth.role()%' THEN
    RAISE EXCEPTION 'TEST FAILED (3c): create_wizard_strategy has NO auth.role() gate in its code — the caller-role check migration 20260814120000 installed is gone, so the in-body half of CONNECT-01 is absent and only the GRANT layer is left standing';
  END IF;
  IF v_fn_code_k NOT LIKE '%auth.role()%' THEN
    RAISE EXCEPTION 'TEST FAILED (3c): add_wizard_composite_key has NO auth.role() gate in its code — the caller-role check migration 20260814120000 installed is gone on the COMPOSITE half';
  END IF;
  IF v_fn_code LIKE '%auth.uid()%' THEN
    RAISE EXCEPTION 'TEST FAILED (3c): create_wizard_strategy CODE contains auth.uid(). Under the service_role caller that is now its only admitted caller, auth.uid() IS NULL (156-MEASUREMENTS.md A2), so any ownership comparison built on it is a PERMANENT SILENT NO-OP — it never fires and never fails. This is not a stricter check, it is a decorative one. Delete it; do not relax it. Ownership is bound at the route.';
  END IF;
  IF v_fn_code_k LIKE '%auth.uid()%' THEN
    RAISE EXCEPTION 'TEST FAILED (3c): add_wizard_composite_key CODE contains auth.uid(). Under a service_role caller it IS NULL (156-MEASUREMENTS.md A2), so the comparison is a PERMANENT SILENT NO-OP — a decorative ownership check, not a stricter one. Delete it; do not relax it. Ownership is bound at the route.';
  END IF;

  -- ----- 4. grants: ONLY service_role EXECUTEs; anon and authenticated do NOT
  -- ⛔ NOT A FORMALITY HERE. Migration 20260812083206 uses DROP + CREATE (a
  -- signature change cannot go through CREATE OR REPLACE), and DROP DESTROYS the
  -- ACL — a freshly created function grants EXECUTE to PUBLIC by default. The
  -- assertions below are what catch a re-issue of the function that forgot the
  -- REVOKE, i.e. a privilege escalation onto a SECURITY DEFINER function that
  -- writes api_keys and strategies.
  --
  -- ⭐ THE `authenticated` POLARITY IS INVERTED AS OF PHASE 156 / CONNECT-01
  -- (migration 20260814120000). This assertion previously required
  -- `authenticated` to HOLD EXECUTE. PostgREST publishes every public function at
  -- /rest/v1/rpc/<name>, so that grant let any browser session POST this writer
  -- directly and mint its own attested_venue — the bypass the venue-identity
  -- machinery in this very file exists to close. The grant is withdrawn, and
  -- because Supabase's pg_default_acl silently RE-GRANTS anon and authenticated
  -- on any future DROP + CREATE (`156-MEASUREMENTS.md` § A4 — it already bit
  -- 20260812083206 for anon), this line is the durable guard that reds CI rather
  -- than letting the door reopen in production.
  IF has_function_privilege('authenticated', c_sig, 'EXECUTE') THEN
    RAISE EXCEPTION 'TEST FAILED (4): authenticated HOLDS EXECUTE on create_wizard_strategy — Phase 156 / CONNECT-01 withdrew it (migration 20260814120000). A re-GRANT re-opens the direct PostgREST door and a browser session can mint an attested_venue of its choosing, which is precisely the forgery this file''s venue-identity assertions assume is impossible. If no migration did this deliberately, a DROP + CREATE re-granted it silently via pg_default_acl — re-issue the REVOKE in that same migration.';
  END IF;
  IF has_function_privilege('anon', c_sig, 'EXECUTE') THEN
    RAISE EXCEPTION 'TEST FAILED (4): anon must NOT have EXECUTE on create_wizard_strategy';
  END IF;

  -- ⛔ THE OUTAGE GUARD — and NOT the "a dropped function would green the
  -- negatives" argument, which is FALSE for the TEXT signature form used here and
  -- was MEASURED false on PostgreSQL 16: has_function_privilege RAISES
  -- undefined_function (42883) for a function that does not exist rather than
  -- returning FALSE, and under `psql -v ON_ERROR_STOP=1` that aborts this file.
  -- A dropped RPC is therefore already caught loudly by the negatives above, and
  -- by section 3/3b's `pg_get_functiondef` reads before them.
  --
  -- ⭐ WHAT NO NEGATIVE CAN SEE is a REVOKE that went ONE ROLE TOO FAR:
  -- `service_role` losing EXECUTE while anon and authenticated stay correctly
  -- shut out. Every assertion above then reads exactly as intended while every
  -- connect-a-key answers 42501 — since 20260814120000 service_role is the only
  -- role permitted to write a wizard draft, and the only role our two Next routes
  -- hold. These POSITIVES are the only lines that fail in that state, which is
  -- why they are worded as an OUTAGE rather than a privilege.
  IF NOT has_function_privilege('service_role', c_sig, 'EXECUTE') THEN
    RAISE EXCEPTION 'TEST FAILED (4): CONNECT-A-KEY IS BROKEN — service_role holds no EXECUTE on create_wizard_strategy. Since 20260814120000 it is the ONLY role that may write a wizard draft, so every connect answers 42501. A REVOKE went one role too far, or the function was dropped. The fix is to re-GRANT, not to retry.';
  END IF;
  IF NOT has_function_privilege('service_role', k_sig, 'EXECUTE') THEN
    RAISE EXCEPTION 'TEST FAILED (4): CONNECT-A-KEY IS BROKEN — service_role holds no EXECUTE on add_wizard_composite_key, so every COMPOSITE key add answers 42501. A REVOKE went one role too far, or the function was dropped. Re-GRANT; do not retry.';
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

  RAISE NOTICE 'PASS (structural): WIZCONT-02 identity invariants intact (api_keys.venue_account_id text + non-blank CHECK, validated + tenant-leading partial-UNIQUE (user_id, exchange, venue_account_id) WHERE venue_account_id IS NOT NULL AND disconnected_at IS NULL + exactly one create_wizard_strategy overload carrying the wizdraft:/attested_venue/p_venue_account_id/NULLIF(btrim()) canaries + exactly one add_wizard_composite_key overload carrying the wizcomposite:/attested_venue canaries + BOTH bodies gating on auth.role() with ZERO auth.uid() + grants service_role-only, anon and authenticated shut out + SECURITY INVOKER scrub trigger attached).';
END $$;


-- ===========================================================================
-- 6. BEHAVIOURAL: the index and the CHECK actually FIRE
-- ===========================================================================
-- ⭐ WHY THIS SECTION EXISTS. Everything above reads the catalog. A catalog read
-- proves an object is SHAPED right; it cannot prove it BITES. This repo's own
-- recurring defect is the assertion that passes against a constraint which
-- exists and does nothing (the prevent_profile_role_change no-op,
-- 20260529150000). So this section seeds real rows and drives the real writes.
--
-- The cases, and the specific regression each one would catch:
--   (6a) two LIVE rows, one identity            → 23505. The whole point.
--   (6b) a DISCONNECTED row must NOT squat      → INSERT SUCCEEDS. Fails if the
--        index predicate ever loses `disconnected_at IS NULL`, which is the
--        lifecycle-blind form that hands a re-connecting founder a dead key.
--   (6c) reconnecting a row whose live twin now exists → 23505. This PINS the
--        accepted residual of (6b) so a change to it is deliberate, and it is
--        also the strongest available proof that the predicate really reads
--        disconnected_at rather than merely mentioning it.
--   (6d) '' and '   ' are REFUSED                → 23514. Fails if the non-blank
--        CHECK is dropped, letting two DIFFERENT accounts collide onto one row.
--   (6e) a DIFFERENT user, the SAME identity     → ADMITTED. The C-08 guarantee:
--        user_id leads, so uniqueness is strictly per-tenant.
--
-- ⚠️ SHARED-DB HYGIENE. The TEST project is shared and CI runs concurrently, so
-- the fixture email is made UNIQUE PER RUN rather than fixed — a fixed email
-- plus a pre-emptive DELETE is how one run yanks another run's user out from
-- under it mid-test. Rows from a crashed run are reaped by AGE below instead.

-- Reap fixtures orphaned by a crashed earlier run. Age-scoped so it can never
-- touch a CONCURRENT run's user.
DELETE FROM auth.users
  WHERE email LIKE 'test-wizcont02-venue-%@quantalyze.test'
    AND created_at < now() - INTERVAL '1 hour';

DO $behavioural$
DECLARE
  v_run       TEXT := replace(gen_random_uuid()::text, '-', '');
  uid_a       UUID := gen_random_uuid();
  uid_b       UUID := gen_random_uuid();
  email_a     TEXT;
  email_b     TEXT;
  k_live      UUID := gen_random_uuid();  -- user A, live, identity LOGIN
  k_second    UUID := gen_random_uuid();  -- user A, live, identity LOGIN, after A is disconnected
  c_login     CONSTANT TEXT := '5551234';
  v_stamped   TEXT;
BEGIN
  email_a := 'test-wizcont02-venue-a-' || v_run || '@quantalyze.test';
  email_b := 'test-wizcont02-venue-b-' || v_run || '@quantalyze.test';

  -- ----- seed two tenants ---------------------------------------------------
  INSERT INTO auth.users (id, instance_id, email, created_at, updated_at)
  VALUES (uid_a, '00000000-0000-0000-0000-000000000000', email_a, now(), now()),
         (uid_b, '00000000-0000-0000-0000-000000000000', email_b, now(), now());
  -- The on_auth_user_created trigger pre-creates the profile row; upsert so this
  -- works whether or not that trigger is installed on the target database.
  INSERT INTO profiles (id, display_name, email)
  VALUES (uid_a, 'wizcont02 tenant A', email_a),
         (uid_b, 'wizcont02 tenant B', email_b)
  ON CONFLICT (id) DO NOTHING;

  -- ----- 0. PRIVILEGE PRECONDITION, asserted rather than assumed ------------
  -- ⛔ api_keys_scrub_venue_account_id NULLs venue_account_id for every
  -- current_user outside {postgres, service_role, supabase_admin}. If this file
  -- is run as a non-privileged role, EVERY seeded identity silently becomes
  -- NULL, the partial index never governs any of these rows, and cases 6a/6c/6d
  -- would all "pass" for entirely the wrong reason. Fail LOUD here instead of
  -- letting the whole section go vacuous.
  INSERT INTO api_keys (id, user_id, exchange, label, api_key_encrypted, is_active, venue_account_id)
  VALUES (k_live, uid_a, 'mt5', 'wizcont02 live', 'enc', true, c_login);

  SELECT venue_account_id INTO v_stamped FROM api_keys WHERE id = k_live;
  IF v_stamped IS DISTINCT FROM c_login THEN
    RAISE EXCEPTION 'TEST FAILED (6.0): seeded venue_account_id did not persist (got %, expected %). current_user is %, which the api_keys_scrub_venue_account_id trigger does not admit — this whole behavioural section would be vacuous. Run this file as postgres/service_role.',
      v_stamped, c_login, current_user;
  END IF;

  -- ----- 6a. two LIVE rows, one identity → 23505 ----------------------------
  -- ⛔ The RAISE below carries SQLSTATE P0001, NOT 23505, so the handler cannot
  -- swallow this file's own failure signal. Same trick in 6c/6d.
  BEGIN
    INSERT INTO api_keys (user_id, exchange, label, api_key_encrypted, is_active, venue_account_id)
    VALUES (uid_a, 'mt5', 'wizcont02 dup', 'enc', true, c_login);
    RAISE EXCEPTION 'TEST FAILED (6a): a SECOND LIVE api_keys row with the same (user_id, exchange, venue_account_id) was ADMITTED — api_keys_user_exchange_venue_account_uniq does not fire, so WIZCONT-02 has no DB backstop at all';
  EXCEPTION WHEN unique_violation THEN
    NULL;  -- expected
  END;

  -- ----- 6b. a DISCONNECTED row must NOT squat the slot ---------------------
  -- THE HIGH-1 REGRESSION. api_keys rows are RETAINED on soft-disconnect
  -- (20260422101911), so with a lifecycle-blind predicate this INSERT raises
  -- 23505, the index's "fail toward the existing row" contract resolves the
  -- re-connecting founder onto the DISCONNECTED key, and every cron dispatcher
  -- skips it — the strategy silently never syncs. This case FAILS against that
  -- predicate and passes only against the live-scoped one.
  UPDATE api_keys SET disconnected_at = now() WHERE id = k_live;

  BEGIN
    INSERT INTO api_keys (id, user_id, exchange, label, api_key_encrypted, is_active, venue_account_id)
    VALUES (k_second, uid_a, 'mt5', 'wizcont02 reconnected', 'enc', true, c_login);
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'TEST FAILED (6b): a SOFT-DISCONNECTED api_keys row still occupies the (user_id, exchange, venue_account_id) slot — the index predicate is lifecycle-blind. Re-connecting the same broker login raises 23505 and the caller is resolved onto a DEAD key that every cron dispatcher skips (they all filter disconnected_at IS NULL), so the new strategy would silently never sync. The predicate must be: WHERE venue_account_id IS NOT NULL AND disconnected_at IS NULL';
  END;

  -- ----- 6c. the accepted residual, PINNED ---------------------------------
  -- Reconnecting the old row now that a live twin exists must FAIL — two live
  -- rows for one account is exactly what this index forbids. It is fail-loud on
  -- a deliberate user click that already has a revert path
  -- (AllocatorExchangeManager.tsx:341), and it is strictly better than 6b's
  -- silent never-syncs-again. Pinned here so that if the reconnect surface is
  -- ever softened, it is softened in reconnect_allocator_api_key (detect the
  -- live twin, refuse with a named code) and NOT by weakening this predicate.
  BEGIN
    UPDATE api_keys SET disconnected_at = NULL WHERE id = k_live;
    RAISE EXCEPTION 'TEST FAILED (6c): reconnecting a soft-disconnected row was ADMITTED while a LIVE row holds the same (user_id, exchange, venue_account_id) — two live keys for one account, which is precisely what this index exists to forbid. Either the predicate no longer reads disconnected_at, or the index is not being enforced on UPDATE';
  EXCEPTION WHEN unique_violation THEN
    NULL;  -- expected
  END;

  -- ----- 6d. '' and '   ' are not identities → 23514 ------------------------
  -- THE HIGH-2 REGRESSION. '' is NON-NULL, so the partial index governs it:
  -- without api_keys_venue_account_id_nonblank, two GENUINELY DIFFERENT accounts
  -- that both arrive as '' collide, and "fail toward the existing row" resolves
  -- one user's connect onto a DIFFERENT account's encrypted credentials and
  -- strategy_keys membership. Silent wrong-account attribution — the inverse of
  -- the defect the index exists to prevent.
  BEGIN
    INSERT INTO api_keys (user_id, exchange, label, api_key_encrypted, is_active, venue_account_id)
    VALUES (uid_a, 'mt5', 'wizcont02 blank', 'enc', true, '');
    RAISE EXCEPTION 'TEST FAILED (6d): an EMPTY-STRING venue_account_id was ADMITTED. '''' is non-NULL, so the partial index governs it and two DIFFERENT accounts would collide onto one row, resolving one user''s connect onto another account''s credentials. api_keys_venue_account_id_nonblank must refuse it';
  EXCEPTION WHEN check_violation THEN
    NULL;  -- expected
  END;

  BEGIN
    INSERT INTO api_keys (user_id, exchange, label, api_key_encrypted, is_active, venue_account_id)
    VALUES (uid_a, 'mt5', 'wizcont02 spaces', 'enc', true, '   ');
    RAISE EXCEPTION 'TEST FAILED (6d): a WHITESPACE-ONLY venue_account_id was ADMITTED — api_keys_venue_account_id_nonblank must btrim before comparing, or '' '' becomes a distinct "identity" that collides with nothing and dedups nothing';
  EXCEPTION WHEN check_violation THEN
    NULL;  -- expected
  END;

  -- ----- 6e. user_id LEADS: a different tenant, the same identity ----------
  -- The C-08 guarantee, behaviourally. Uniqueness scoped (exchange,
  -- venue_account_id) alone would let one owner's INSERT collide with a
  -- DIFFERENT owner's row — which both leaks the existence of that row and
  -- denies service to the second owner.
  BEGIN
    INSERT INTO api_keys (user_id, exchange, label, api_key_encrypted, is_active, venue_account_id)
    VALUES (uid_b, 'mt5', 'wizcont02 other tenant', 'enc', true, c_login);
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'TEST FAILED (6e): a DIFFERENT user was REFUSED the same venue_account_id — uniqueness is not tenant-scoped. That is the C-08 cross-tenant leak: one owner''s INSERT colliding with another owner''s row leaks its existence and denies service. user_id MUST lead the index';
  END;

  -- ----- cleanup ------------------------------------------------------------
  -- Explicit, in FK order, rather than relying on the profiles→api_keys cascade.
  DELETE FROM api_keys WHERE user_id IN (uid_a, uid_b);
  DELETE FROM auth.users WHERE id IN (uid_a, uid_b);

  RAISE NOTICE 'PASS (behavioural): duplicate LIVE identity refused (23505); a soft-disconnected row does NOT squat the slot; reconnecting into an occupied slot refused (23505); '''' and ''   '' refused (23514); a different tenant admitted the same identity.';
END $behavioural$;
