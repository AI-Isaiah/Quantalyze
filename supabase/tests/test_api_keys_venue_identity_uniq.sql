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
--
-- ⭐ MACHINE-EXECUTABLE TWINS (phase 164.4). Each prose RED-UNDER below an arm
-- carries an adjacent `RED-UNDER-M` object that scripts/mutation-runner executes:
-- it mutates COPIES on a throwaway pg-lane cluster, requires the FIRST
-- `TEST FAILED (…)` to name that arm, and restores GREEN. Schema:
-- scripts/mutation-runner/GRAMMAR.md. The line below declares what the lane
-- applies before this gate. DISCOVERED, not guessed — plan 164.4-06 iterated it
-- over 3 lane runs to `PASS (structural)` + `PASS (behavioural)`, mean 1.08 s/lane
-- over 3 timed GREEN runs (the longest apply list of that batch: 7 real
-- migrations + 6 stand-ins).
--
-- ⭐ MIGRATION B IS IN THE APPLY LIST ON PURPOSE, AND IT WAS VERIFIED INERT.
-- Sections 3c and 4 each hide behind a `RAISE NOTICE 'SKIP (…)'` when
-- 20260814120000 is not applied. An arm behind a firing SKIP is UNFALSIFIABLE and
-- must never be annotated as if it bit, so the list carries 20260814120000 and its
-- prerequisites and the baseline lane was read for the proof: ZERO `SKIP (`
-- notices, and the run prints the `PASS (structural)` variant — never
-- `PASS WITH 3 SKIPS` — which is this file's own state-aware summary saying the
-- auth.uid()-absence pair and the `authenticated` negative both RAN. Section 4's
-- twin below drives exactly the assertion the SKIP would have hidden.
--
-- ⚠️ EVERY TWIN HERE IS A `sql` STEP, and that is the point rather than a
-- workaround. 20260812083206's own post-verify re-asserts the column, the index
-- (UNIQUE, partial, both predicate conjuncts, column order), the non-blank CHECK,
-- the scrub trigger's attachment and its SECURITY INVOKER posture, and every
-- create_wizard_strategy canary — so a migration EDIT aborts the apply instead of
-- reaching the gate. The `sql` steps drift the LIVE object after apply, which is
-- what this gate exists to catch: state that was correct once and is not now.
-- RED-UNDER-SETUP: {"apply":["scripts/pg-lane/fixtures/01-fixture-core.sql","scripts/pg-lane/fixtures/02-fixture-sanitize-tables.sql","scripts/pg-lane/fixtures/03-fixture-compute-jobs.sql","scripts/pg-lane/fixtures/05-fixture-wizard-composite.sql","scripts/pg-lane/fixtures/07-fixture-supabase-default-privileges.sql","scripts/pg-lane/fixtures/11-fixture-api-keys-created-at.sql","scripts/pg-lane/fixtures/15-fixture-auth-role.sql","scripts/pg-lane/fixtures/21-fixture-api-keys-credential-columns.sql","supabase/migrations/20260602190000_f6_wizard_session_idempotency.sql","supabase/migrations/20260710120000_strategy_keys.sql","supabase/migrations/20260710180000_wizard_composite.sql","supabase/migrations/20260811210000_api_keys_attested_venue.sql","supabase/migrations/20260812083206_api_keys_venue_account_id.sql","supabase/migrations/20260813150106_wizard_rpcs_service_role_writer.sql","supabase/migrations/20260814120000_wizard_rpcs_revoke_authenticated.sql","supabase/migrations/20261123180000_api_keys_venue_server.sql","supabase/migrations/20261125132334_api_keys_venue_server_owner_read.sql","supabase/migrations/20261126102346_api_keys_venue_server_index.sql"]}

DO $$
DECLARE
  -- ⭐ THIRTEEN types as of Phase 225 / CONN-03 (migration 20261123180000 added the
  -- trailing p_venue_server TEXT DEFAULT NULL by DROP + CREATE). The 12-type form no
  -- longer resolves: has_function_privilege raises undefined_function on it.
  c_sig CONSTANT TEXT :=
    'create_wizard_strategy(uuid,text,text,text,text,text,text,text,integer,text,uuid,text,text)';
  -- ⚠️ ELEVEN types, not thirteen. add_wizard_composite_key has no
  -- p_venue_account_id or p_venue_server — the composite path stamps no venue
  -- identity. The arity asymmetry is real; has_function_privilege's text form
  -- matches the DECLARED argument list EXACTLY, so borrowing c_sig's 13 types here would raise
  -- undefined_function and report "function does not exist" instead of a verdict.
  k_sig CONSTANT TEXT :=
    'add_wizard_composite_key(uuid,text,text,text,text,text,text,text,integer,text,uuid)';

  v_col_type    TEXT;
  v_idx_def     TEXT;
  v_idx_cols    TEXT[];
  v_idx_unique  BOOLEAN;
  v_idx_partial BOOLEAN;
  v_idx_natts   INT;    -- Phase 225: indnkeyatts of the identity index
  v_idx_exprs   TEXT;   -- Phase 225: pg_get_expr(indexprs) of the identity index
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
  v_b_live      BOOLEAN;  -- 20260814120000 narrowed the SINGLE-KEY body
  v_b_live_k    BOOLEAN;  -- 20260814120000 narrowed the COMPOSITE body
  v_auth_exec   BOOLEAN;  -- authenticated holds EXECUTE on the single-key RPC
  v_auth_exec_k BOOLEAN;  -- authenticated holds EXECUTE on the composite RPC
  v_trg_secdef  BOOLEAN;
  v_chk_valid   BOOLEAN;
  v_chk_def     TEXT;
BEGIN
  -- ----- 1. api_keys.venue_account_id exists and is text --------------------
  -- RED-UNDER: retype the LIVE api_keys.venue_account_id to varchar(64) — the
  --            "it is still a string, what could it hurt" drift. A `sql` step, not
  --            a migration edit: 20260812083206's post-verify re-reads this
  --            column, so an edit aborts the apply before the gate ever runs.
  -- RED-UNDER-M: {"arm":"1","apply":[{"kind":"sql","stmt":"ALTER TABLE public.api_keys ALTER COLUMN venue_account_id TYPE varchar(64)"}]}
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

  -- ----- 2. partial-UNIQUE on (user_id, exchange, venue_account_id, COALESCE(venue_server, ''))
  -- ⭐ Phase 225 / CONN-03 (plan 10): the index carries a FOURTH key member, the
  -- expression COALESCE(venue_server, ''), so the same login on two servers is two
  -- accounts. The three plain columns below are asserted exactly as before; the member
  -- is asserted by indnkeyatts = 4 and by indexprs naming venue_server. ⛔ The member is
  -- deliberately NOT pinned to the text COALESCE: the behavioural arms 6s-* each twin a
  -- DIFFERENT wrong expression, and every such twin must pass THIS structural section so
  -- that its own arm, not this one, is the first failure. What each wrong expression
  -- does is pinned behaviourally, in section 6.
  -- RED-UNDER: rebuild the LIVE api_keys_user_exchange_venue_account_uniq as the old
  --            login-only index (user_id, exchange, venue_account_id) — the state before
  --            Phase 225: same name, UNIQUE, partial, same three columns, both predicate
  --            conjuncts, so only the key-width assertion can see it. `sql` step for the
  --            same reason as section 1: the migration re-verifies this index at apply time.
  -- RED-UNDER-M: {"arm":"2","apply":[{"kind":"sql","stmt":"DROP INDEX public.api_keys_user_exchange_venue_account_uniq; CREATE UNIQUE INDEX api_keys_user_exchange_venue_account_uniq ON public.api_keys (user_id, exchange, venue_account_id) WHERE venue_account_id IS NOT NULL AND disconnected_at IS NULL"}]}
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
    RAISE EXCEPTION 'TEST FAILED (2): index must lead with the plain columns (user_id, exchange, venue_account_id) in that order, got %', v_idx_cols;
  END IF;

  -- ⭐ THE FOURTH MEMBER. The query above joins pg_attribute, so an expression member
  -- (attnum 0) drops out of it: it returns the same three names for the old index and
  -- the new one, and proves nothing about the member. indnkeyatts counts every key
  -- attribute including the expression, and indexprs names what it is.
  SELECT i.indnkeyatts, pg_get_expr(i.indexprs, i.indrelid)
    INTO v_idx_natts, v_idx_exprs
    FROM pg_index i
    JOIN pg_class c     ON c.oid = i.indexrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public'
     AND c.relname = 'api_keys_user_exchange_venue_account_uniq';
  IF v_idx_natts IS DISTINCT FROM 4 THEN
    RAISE EXCEPTION 'TEST FAILED (2): api_keys_user_exchange_venue_account_uniq keys on % attributes, expected 4 (user_id, exchange, venue_account_id, COALESCE(venue_server, '''')). A login-only index collides the same MT5 login on two broker servers (CONN-03)', v_idx_natts;
  END IF;
  IF v_idx_exprs IS NULL OR v_idx_exprs NOT ILIKE '%venue_server%' THEN
    RAISE EXCEPTION 'TEST FAILED (2): the fourth key member of api_keys_user_exchange_venue_account_uniq is not an expression over venue_server (indexprs: %)', v_idx_exprs;
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
  -- RED-UNDER: mint a SECOND create_wizard_strategy overload on the LIVE database
  --            — exactly the sibling a `CREATE OR REPLACE` that tried to add a
  --            parameter would leave behind, and the state PostgREST answers
  --            PGRST203 to.
  -- RED-UNDER-M: {"arm":"3","apply":[{"kind":"sql","stmt":"CREATE FUNCTION public.create_wizard_strategy(p_probe uuid) RETURNS void LANGUAGE sql AS $f$ SELECT NULL::void $f$"}]}
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

  -- The stamp site NORMALISES: NULLIF(btrim(p_venue_account_id, E' \t\r\n'), ''). Losing the
  -- btrim makes ' 5551234' and '5551234' index as DIFFERENT keys, so the dedup
  -- misses the very re-connect it exists to catch. Losing the NULLIF turns an
  -- unset form field ('' from a `?? ''`) into a 23514 against
  -- api_keys_venue_account_id_nonblank that the wizard route has no handler for.
  -- Asserted here because the expression is one "simplification" away from being
  -- the bare parameter again. The pattern stops before the closing parenthesis on purpose:
  -- the btrim CHARACTER SET (tab and newline count as blank) is pinned by arm 6v-writes-ws,
  -- and a pattern that named it would make this earlier arm the first failure of that twin.
  IF v_fn_src NOT ILIKE '%nullif(btrim(p_venue_account_id%' THEN
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

  -- ----- 3d. IS MIGRATION B LIVE ON *THIS* DATABASE? ------------------------
  -- ⭐ THE MERGE-ORDER PROBLEM. Migration 20260814120000 (Migration B) cannot be
  -- applied to the shared TEST database ahead of the merge: `origin/main`'s
  -- copies of these gate files still require `authenticated` to HOLD EXECUTE, so
  -- an early apply would red `sql-tests` for main and for every concurrent PR
  -- sharing that database. The auth.uid()-absence pair below and section 4's
  -- `authenticated` negative therefore describe a state TEST does not yet have.
  -- The answer is not to weaken them — it is to arm them from the state of the
  -- database they are actually running against.
  --
  -- ⛔ THE DETECTOR IS LIVE STATE, NEVER A COMMENT MARKER, AND NEVER THE THING IT
  -- ARMS. Three candidates were measured on a local PG16 fixture and two are
  -- wrong: `auth.role()` is present in the Migration A body AND the Migration B
  -- body (it discriminates NOTHING — which is why the two assertions ABOVE stay
  -- unconditional, they are true in both states); and
  -- `has_function_privilege('authenticated', …)` is exactly what section 4
  -- asserts, so arming on it would make that assertion vacuous — it would only
  -- run in the case where the ACL is already what we want.
  --
  -- The signal is the identifier `v_auth_uid` in the COMMENT-STRIPPED body:
  -- Migration A declares AND compares it as CODE (`v_auth_uid UUID :=
  -- auth.uid();`, `IF v_auth_uid <> p_user_id`) because its `authenticated` arm
  -- needs it; Migration B deletes both and keeps the name only in prose.
  --
  -- ⛔⛔ THE STRIP IS MANDATORY AND WAS MEASURED. On a PG16 fixture carrying
  -- Migration B, the RAW pg_get_functiondef of create_wizard_strategy matches
  -- '%v_auth_uid%' — TRUE — because Migration B's Trap B comment block explains
  -- at length why the identifier is absent and thereby contains it. A raw
  -- detector reads "not live" on precisely the database it guards, leaving these
  -- assertions permanently un-armed and silently green. ⚠️ MEASURED IN THE SAME
  -- RUN: the COMPOSITE twin's raw definition reads FALSE in that same state, so a
  -- raw detector would arm one twin and not the other — the instance-not-class
  -- shape, reproduced inside its own remedy. The strip these two variables
  -- already carry (for the reason recorded at their declaration) is the same one.
  v_b_live      := v_fn_code   NOT LIKE '%v_auth_uid%';
  v_b_live_k    := v_fn_code_k NOT LIKE '%v_auth_uid%';
  v_auth_exec   := has_function_privilege('authenticated', c_sig, 'EXECUTE');
  v_auth_exec_k := has_function_privilege('authenticated', k_sig, 'EXECUTE');

  -- ----- 3e. BOTH OR NEITHER: an incoherent state REDS, it never skips -------
  -- ⭐ THIS IS WHAT KEEPS THE SKIPS BELOW HONEST. A skip is truthful only while
  -- the database is in one of the two states this file recognises; every
  -- half-state must fail loudly instead. Three are distinguishable:
  --
  --  (a) ONE TWIN NARROWED, THE OTHER NOT. Migration B rewrites both bodies in
  --      one file, so they cannot legitimately disagree — this is the
  --      instance-not-class defect caught in the schema rather than the diff.
  --  (b) BODY NARROWED, GRANT STILL STANDING — the worst state available.
  --      Migration B DELETES the auth.uid() ownership comparison rather than
  --      relaxing it, on the express premise that only service_role can reach the
  --      function. Body-without-REVOKE means `authenticated` can POST
  --      /rest/v1/rpc/create_wizard_strategy against a body that no longer checks
  --      ownership at all and mint a row owned by ANY p_user_id it names — a
  --      cross-tenant write, strictly worse than either migration alone, and it
  --      would also forge the venue_account_id identity this entire file exists
  --      to make trustworthy.
  --  (c) GRANT REVOKED, BODY STILL MIGRATION A. A partial apply, or a later
  --      migration re-based a body onto a stale source.
  IF v_b_live <> v_b_live_k THEN
    RAISE EXCEPTION 'TEST FAILED (3e-a): THE TWO WIZARD RPCs ARE IN DIFFERENT STATES. create_wizard_strategy narrowed=%, add_wizard_composite_key narrowed=% (read from each comment-stripped body''s v_auth_uid). Migration 20260814120000 rewrites BOTH bodies in one file, so they cannot legitimately disagree: a migration landed on one twin and not the other. That is the instance-not-class defect Phase 153.6 was convened to end — and this file already carries section 3b precisely because the composite twin had no canary of its own. Change one, change both, in the same migration.', v_b_live, v_b_live_k;
  END IF;
  -- ⛔ SCOPED TO THE **COMPOSITE** GRANT, AND THE SCOPE IS THE POINT. The
  -- single-key half of this state — bodies narrowed AND `authenticated` holding
  -- EXECUTE on create_wizard_strategy — is EXACTLY the condition under which
  -- section 4's own assertion fires, and that assertion is armed on v_b_live, so
  -- it is REACHABLE there. Repeating it here would be PROVABLY DEAD CODE, which
  -- in the phase whose subject is decorative controls is the worst thing to add.
  -- What section 4 CANNOT see is the composite twin's grant: it pins k_sig for
  -- `service_role` only, never for `authenticated`. That gap is what this covers,
  -- and it is the same gap section 3b exists for one layer down.
  IF v_b_live AND v_auth_exec_k THEN
    RAISE EXCEPTION 'TEST FAILED (3e-b): INCOHERENT HALF-STATE, AND IT IS THE WORST ONE. Both wizard RPC bodies carry NO v_auth_uid, so migration 20260814120000 narrowed them — but `authenticated` STILL HOLDS EXECUTE on add_wizard_composite_key. Migration B DELETES the auth.uid() ownership comparison rather than relaxing it, on the premise that only service_role can reach these functions. With the body narrowed and the grant standing, any browser session can POST /rest/v1/rpc/add_wizard_composite_key and mint an api_keys row owned by ANY p_user_id it names, carrying a venue_account_id of its choosing — a cross-tenant write that also forges the very identity this file exists to make trustworthy. ⚠️ This file pins the composite ACL for service_role only, so this line is the ONLY place it watches `authenticated` on that twin; the single-key twin is covered by section 4''s own assertion below. Re-issue REVOKE ALL ON FUNCTION public.add_wizard_composite_key(uuid,text,text,text,text,text,text,text,integer,text,uuid) FROM PUBLIC, anon, authenticated; in a migration NOW.';
  END IF;
  IF NOT v_b_live AND NOT (v_auth_exec AND v_auth_exec_k) THEN
    RAISE EXCEPTION 'TEST FAILED (3e-c): INCOHERENT HALF-STATE. `authenticated` has lost EXECUTE on at least one wizard RPC (create_wizard_strategy=%, add_wizard_composite_key=%) — so 20260814120000 §3 ran here — but the bodies still declare v_auth_uid, i.e. they are still the Migration A (20260813150106) two-arm bodies. Either §1/§2 of that migration did not apply, or a later migration re-based the bodies onto a stale source. This must not be reported as a skip.', v_auth_exec, v_auth_exec_k;
  END IF;

  -- ⚠️ ARMED, AND NOT VACUOUSLY SO. The arming reads `v_auth_uid`; the assertion
  -- reads `auth.uid()`. Those are different strings and the implication does not
  -- run backwards: a body that dropped the variable but kept an inline
  -- `IF auth.uid() <> p_user_id` — the exact "relax it rather than delete it"
  -- edit Trap B warns against, and the most likely way this regresses — arms this
  -- check and then FAILS it. That is the whole point.
  -- ⛔ On a Migration-A database the bodies carry auth.uid() BY DESIGN: the
  -- `authenticated` arm needs it, and Migration A deliberately keeps that arm so
  -- the two migrations can merge in sequence with no window in which
  -- connect-a-key is broken. Asserting its absence there would red CI for a
  -- database that is exactly where it belongs.
  IF v_b_live THEN
    IF v_fn_code LIKE '%auth.uid()%' THEN
      RAISE EXCEPTION 'TEST FAILED (3c): create_wizard_strategy CODE contains auth.uid(). Under the service_role caller that is now its only admitted caller, auth.uid() IS NULL (156-MEASUREMENTS.md A2), so any ownership comparison built on it is a PERMANENT SILENT NO-OP — it never fires and never fails. This is not a stricter check, it is a decorative one. Delete it; do not relax it. Ownership is bound at the route.';
    END IF;
    IF v_fn_code_k LIKE '%auth.uid()%' THEN
      RAISE EXCEPTION 'TEST FAILED (3c): add_wizard_composite_key CODE contains auth.uid(). Under a service_role caller it IS NULL (156-MEASUREMENTS.md A2), so the comparison is a PERMANENT SILENT NO-OP — a decorative ownership check, not a stricter one. Delete it; do not relax it. Ownership is bound at the route.';
    END IF;
  ELSE
    RAISE NOTICE 'SKIP (3c, the auth.uid()-ABSENCE pair ONLY): migration 20260814120000 (Phase 156 Migration B) is NOT applied to this database — both wizard RPC bodies still declare v_auth_uid, i.e. they are the Migration A (20260813150106) two-arm bodies, whose `authenticated` arm REQUIRES auth.uid() and whose presence is therefore CORRECT here. EXACTLY TWO assertions were skipped: "create_wizard_strategy code contains no auth.uid()" and the same for add_wizard_composite_key. Still RUN in section 3c: BOTH auth.role()-PRESENCE assertions (true under Migration A and B alike) and all three 3e both-or-neither coherence checks. Sections 1, 2, 3, 3b, 5 and 6 are untouched by this condition.';
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
  --
  -- ⚠️ ARMED ON v_b_live (section 3d), for the reason recorded there: on a
  -- database carrying Migration A ALONE, `authenticated` HOLDING EXECUTE is the
  -- CORRECT state, because Migration A deliberately does not revoke it.
  -- ⛔ THE SKIP IS NARROW: it covers this ONE assertion. The `anon` negative and
  -- BOTH `service_role` positives below stay UNCONDITIONAL — true under Migration
  -- A and Migration B alike — so section 4 can never go entirely inert, and
  -- section 3e has already reddened every incoherent state before this point.
  -- RED-UNDER: re-GRANT EXECUTE on create_wizard_strategy to `authenticated` on the
  --            LIVE database — the pg_default_acl re-grant this assertion is the
  --            durable guard against. ⭐ THIS IS THE ARM THE `SKIP (4)` NOTICE
  --            WOULD HIDE: it is reachable only while v_b_live, so its RED is
  --            also the proof that migration 20260814120000 is live on the lane
  --            and the skip is inert (see the header).
  -- RED-UNDER-M: {"arm":"4","apply":[{"kind":"sql","stmt":"GRANT EXECUTE ON FUNCTION public.create_wizard_strategy(uuid,text,text,text,text,text,text,text,integer,text,uuid,text,text) TO authenticated"}]}
  IF v_b_live THEN
    IF v_auth_exec THEN
      RAISE EXCEPTION 'TEST FAILED (4): authenticated HOLDS EXECUTE on create_wizard_strategy — Phase 156 / CONNECT-01 withdrew it (migration 20260814120000). A re-GRANT re-opens the direct PostgREST door and a browser session can mint an attested_venue of its choosing, which is precisely the forgery this file''s venue-identity assertions assume is impossible. If no migration did this deliberately, a DROP + CREATE re-granted it silently via pg_default_acl — re-issue the REVOKE in that same migration.';
    END IF;
  ELSE
    RAISE NOTICE 'SKIP (4, the `authenticated` negative ONLY): migration 20260814120000 (Phase 156 Migration B) is NOT applied to this database — both wizard RPC bodies still declare v_auth_uid, i.e. they are the Migration A (20260813150106) two-arm bodies, under which `authenticated` HOLDING EXECUTE is the CORRECT and intended state. EXACTLY ONE assertion was skipped: "authenticated must NOT hold EXECUTE on create_wizard_strategy". Still RUN in section 4: the anon negative and BOTH service_role outage positives. This assertion arms itself the moment Migration B lands; nothing needs editing to re-enable it.';
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
  -- RED-UNDER: flip the LIVE scrub trigger function to SECURITY DEFINER, which is
  --            the prevent_profile_role_change silent-no-op bug (20260529150000)
  --            reproduced here: current_user becomes the owner, the privileged
  --            allowlist always passes, and the trigger scrubs nothing.
  -- RED-UNDER-M: {"arm":"5","apply":[{"kind":"sql","stmt":"ALTER FUNCTION public.scrub_client_supplied_venue_account_id() SECURITY DEFINER"}]}
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

  -- ⛔ STATE-AWARE, AND NOT COSMETICALLY. The unconditional wording claims "ZERO
  -- auth.uid()" and "authenticated shut out" — both FALSE of a run that skipped
  -- those three assertions, and both printed as a PASS. A summary line that
  -- overstates a skipped run is the silent-green failure this phase exists to
  -- end, emitted by the file's own last statement. Say what actually ran.
  IF v_b_live THEN
    RAISE NOTICE 'PASS (structural): WIZCONT-02 identity invariants intact (api_keys.venue_account_id text + non-blank CHECK, validated + tenant-leading partial-UNIQUE (user_id, exchange, venue_account_id) WHERE venue_account_id IS NOT NULL AND disconnected_at IS NULL + exactly one create_wizard_strategy overload carrying the wizdraft:/attested_venue/p_venue_account_id/NULLIF(btrim()) canaries + exactly one add_wizard_composite_key overload carrying the wizcomposite:/attested_venue canaries + BOTH bodies gating on auth.role() with ZERO auth.uid() + grants service_role-only, anon and authenticated shut out + SECURITY INVOKER scrub trigger attached).';
  ELSE
    RAISE NOTICE 'PASS WITH 3 SKIPS (structural): WIZCONT-02 identity invariants intact (api_keys.venue_account_id text + non-blank CHECK, validated + tenant-leading partial-UNIQUE (user_id, exchange, venue_account_id) WHERE venue_account_id IS NOT NULL AND disconnected_at IS NULL + exactly one create_wizard_strategy overload carrying the wizdraft:/attested_venue/p_venue_account_id/NULLIF(btrim()) canaries + exactly one add_wizard_composite_key overload carrying the wizcomposite:/attested_venue canaries + BOTH bodies gating on auth.role() + bodies and grants coherent with each other + anon shut out + service_role holds EXECUTE on both + SECURITY INVOKER scrub trigger attached). ⚠️ NOT asserted on this run: that either body is free of auth.uid(), and that `authenticated` holds no EXECUTE — migration 20260814120000 is not applied to this database, and under the Migration A body both are false BY DESIGN. See the two SKIP notices above.';
  END IF;
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
--   (6f CCXT) a second LIVE okx row, one account id → 23505, and ADMITTED once
--        the first is disconnected. Fails if the index ever stops governing
--        ccxt venues (Phase 167.1.2 D-01 reuses this index for them).
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
  k_okx       UUID := gen_random_uuid();  -- user A, live okx, identity OKX_ACCT (6f)
  c_okx_acct  CONSTANT TEXT := 'okx-acct-7001';
  v_refused   BOOLEAN;
  v_stamped   TEXT;
  -- Phase 225 / CONN-03 (arms 6v-*). Synthetic values only: a public repo.
  c_acct225   CONSTANT TEXT := 'wizcont225-acct-1';
  c_acct225b  CONSTANT TEXT := 'wizcont225-acct-2';
  v_strat225  UUID;
  v_key225    UUID;
  v_srv225    TEXT;
  v_cname     TEXT;
  v_ws_err    TEXT;
  v_key_ws    UUID;
  -- Phase 225 / CONN-03 plan 10 (arms 6s-*). One synthetic login per arm so the rows an
  -- arm leaves live never touch another arm; servers are synthetic. A public repo.
  c_s_nn      CONSTANT TEXT := 'wizcont225-s-nn';
  c_s_two     CONSTANT TEXT := 'wizcont225-s-two';
  c_s_same    CONSTANT TEXT := 'wizcont225-s-same';
  c_s_mix     CONSTANT TEXT := 'wizcont225-s-mix';
  c_s_own     CONSTANT TEXT := 'wizcont225-s-own';
  c_idx       CONSTANT TEXT := 'api_keys_user_exchange_venue_account_uniq';
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
  -- RED-UNDER: replace the LIVE scrub body with one that drops the privileged-role
  --            allowlist and NULLs venue_account_id for EVERY writer. Scoped
  --            deliberately: the function stays attached and stays SECURITY
  --            INVOKER, so section 5 still passes and this precondition — not
  --            section 5 — is the first failure. It is the exact state that would
  --            make 6a/6c/6d vacuous, which is why it is asserted rather than
  --            assumed.
  -- RED-UNDER-M: {"arm":"6.0","apply":[{"kind":"sql","stmt":"CREATE OR REPLACE FUNCTION public.scrub_client_supplied_venue_account_id() RETURNS TRIGGER LANGUAGE plpgsql SECURITY INVOKER SET search_path = public, pg_catalog AS $f$ BEGIN NEW.venue_account_id := NULL; RETURN NEW; END $f$"}]}
  INSERT INTO api_keys (id, user_id, exchange, label, api_key_encrypted, is_active, venue_account_id)
  VALUES (k_live, uid_a, 'mt5', 'wizcont02 live', 'enc', true, c_login);

  SELECT venue_account_id INTO v_stamped FROM api_keys WHERE id = k_live;
  IF v_stamped IS DISTINCT FROM c_login THEN
    RAISE EXCEPTION 'TEST FAILED (6.0): seeded venue_account_id did not persist (got %, expected %). current_user is %, which the api_keys_scrub_venue_account_id trigger does not admit — this whole behavioural section would be vacuous. Run this file as postgres/service_role.',
      v_stamped, c_login, current_user;
  END IF;

  -- ----- 6s-null-null. two LIVE keys on one login, neither with a server, are REFUSED -----
  -- Phase 225 / CONN-03 (plan 10). COALESCE(venue_server, '') makes two null servers equal:
  -- a NULL server is NOT a wildcard at the index, so every key the backfill has not stamped
  -- yet keeps today's one-live-key-per-login guarantee. ⛔ This arm runs BEFORE 6a on purpose:
  -- 6a also inserts two null-server rows on one login, so a twin that makes nulls distinct
  -- would trip 6a first and this arm could never be the first failure.
  -- RED-UNDER: rebuild the LIVE index with the member NULLIF(venue_server, '') instead of
  --            COALESCE(venue_server, ''): still a fourth expression member naming
  --            venue_server, so section 2 passes, but two NULL servers are now DISTINCT
  --            and the second key is admitted.
  -- RED-UNDER-M: {"arm":"6s-null-null","apply":[{"kind":"sql","stmt":"DROP INDEX public.api_keys_user_exchange_venue_account_uniq; CREATE UNIQUE INDEX api_keys_user_exchange_venue_account_uniq ON public.api_keys (user_id, exchange, venue_account_id, (NULLIF(venue_server, ''))) WHERE venue_account_id IS NOT NULL AND disconnected_at IS NULL"}]}
  BEGIN
    INSERT INTO api_keys (user_id, exchange, label, api_key_encrypted, is_active, venue_account_id)
    VALUES (uid_a, 'mt5', 'wizcont225 nn first', 'enc', true, c_s_nn);
  EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION 'TEST FAILED (6s-null-null): the FIRST live key of a login with no server was refused with SQLSTATE % (%), not admitted', SQLSTATE, SQLERRM;
  END;
  v_refused := FALSE;
  v_cname := NULL;
  BEGIN
    INSERT INTO api_keys (user_id, exchange, label, api_key_encrypted, is_active, venue_account_id)
    VALUES (uid_a, 'mt5', 'wizcont225 nn second', 'enc', true, c_s_nn);
  EXCEPTION WHEN unique_violation THEN
    GET STACKED DIAGNOSTICS v_cname = CONSTRAINT_NAME;
    v_refused := TRUE;
  WHEN OTHERS THEN
    RAISE EXCEPTION 'TEST FAILED (6s-null-null): a second live key with no server on one login was refused with SQLSTATE % (%), not the 23505 of the identity index', SQLSTATE, SQLERRM;
  END;
  IF NOT v_refused THEN
    RAISE EXCEPTION 'TEST FAILED (6s-null-null): a SECOND live key with no server on one (user, exchange, login) was ADMITTED — two NULL servers are distinct at the index, so every key the backfill has not stamped yet lost its duplicate fence (CONN-03)';
  END IF;
  IF v_cname IS DISTINCT FROM c_idx THEN
    RAISE EXCEPTION 'TEST FAILED (6s-null-null): the second key was refused by % and not by %', v_cname, c_idx;
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
  -- RED-UNDER: add a SECOND unique index on the LIVE database scoped
  --            (exchange, venue_account_id) with no user_id — the C-08
  --            cross-tenant scoping error, added ALONGSIDE the correct index so
  --            sections 1-5 still read exactly as intended and only the
  --            behavioural half can see it. This arm is a positive control whose
  --            23505 IS handled (`EXCEPTION WHEN unique_violation` re-raises as
  --            TEST FAILED (6e)), so unlike an unwrapped positive control it can
  --            take the literal drift rather than a silent one.
  -- RED-UNDER-M: {"arm":"6e","apply":[{"kind":"sql","stmt":"CREATE UNIQUE INDEX api_keys_venue_account_global_uniq ON public.api_keys (exchange, venue_account_id) WHERE venue_account_id IS NOT NULL AND disconnected_at IS NULL"}]}
  BEGIN
    INSERT INTO api_keys (user_id, exchange, label, api_key_encrypted, is_active, venue_account_id)
    VALUES (uid_b, 'mt5', 'wizcont02 other tenant', 'enc', true, c_login);
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'TEST FAILED (6e): a DIFFERENT user was REFUSED the same venue_account_id — uniqueness is not tenant-scoped. That is the C-08 cross-tenant leak: one owner''s INSERT colliding with another owner''s row leaks its existence and denies service. user_id MUST lead the index';
  END;

  -- ----- 6f CCXT. a ccxt venue's account id is fenced exactly like an MT5 login
  -- Phase 167.1.2 (D-01, D-10): OKX, Bybit, Binance and Deribit keys now carry
  -- the venue's account id, and the refusal of a second live key on one
  -- account reuses THIS index — no second index is created. So the index must
  -- govern every venue, not only mt5: a second live okx row with the same
  -- (user, exchange, venue_account_id) is refused, and once the first is
  -- disconnected the slot is free again.
  -- RED-UNDER: rebuild the LIVE api_keys_user_exchange_venue_account_uniq with an
  --            extra `exchange = 'mt5'` conjunct — the "only MT5 has an account
  --            id" assumption this phase retires. Sections 1-5 still read as
  --            intended (same name, UNIQUE, partial, same columns, both
  --            predicate conjuncts present, and since Phase 225 the same four key
  --            members, which section 2 asserts) and 6a-6e are all mt5, so only
  --            this arm can see it.
  -- RED-UNDER-M: {"arm":"6f CCXT","apply":[{"kind":"sql","stmt":"DROP INDEX public.api_keys_user_exchange_venue_account_uniq; CREATE UNIQUE INDEX api_keys_user_exchange_venue_account_uniq ON public.api_keys (user_id, exchange, venue_account_id, (COALESCE(venue_server, ''))) WHERE venue_account_id IS NOT NULL AND disconnected_at IS NULL AND exchange = 'mt5'"}]}
  BEGIN
    INSERT INTO api_keys (id, user_id, exchange, label, api_key_encrypted, is_active, venue_account_id)
    VALUES (k_okx, uid_a, 'okx', 'wizcont02 okx live', 'enc', true, c_okx_acct);
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'TEST FAILED (6f CCXT): the FIRST live okx row for an account id was refused 23505 — nothing else holds that (user, exchange, venue_account_id)';
  WHEN OTHERS THEN
    RAISE EXCEPTION 'TEST FAILED (6f CCXT): the FIRST live okx row for an account id was refused with SQLSTATE % (%), not admitted', SQLSTATE, SQLERRM;
  END;

  v_refused := FALSE;
  BEGIN
    INSERT INTO api_keys (user_id, exchange, label, api_key_encrypted, is_active, venue_account_id)
    VALUES (uid_a, 'okx', 'wizcont02 okx dup', 'enc', true, c_okx_acct);
  EXCEPTION WHEN unique_violation THEN
    v_refused := TRUE;
  WHEN OTHERS THEN
    RAISE EXCEPTION 'TEST FAILED (6f CCXT): a SECOND live okx row on one account id was refused with SQLSTATE % (%), not the 23505 of api_keys_user_exchange_venue_account_uniq', SQLSTATE, SQLERRM;
  END;
  IF NOT v_refused THEN
    RAISE EXCEPTION 'TEST FAILED (6f CCXT): a SECOND LIVE okx api_keys row with the same (user_id, exchange, venue_account_id) was ADMITTED — api_keys_user_exchange_venue_account_uniq does not govern ccxt venues, so one exchange account behind two keys is counted twice (Phase 167.1.2 D-01)';
  END IF;

  UPDATE api_keys SET disconnected_at = now() WHERE id = k_okx;
  BEGIN
    INSERT INTO api_keys (user_id, exchange, label, api_key_encrypted, is_active, venue_account_id)
    VALUES (uid_a, 'okx', 'wizcont02 okx reconnected', 'enc', true, c_okx_acct);
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'TEST FAILED (6f CCXT): a SOFT-DISCONNECTED okx row still occupies the (user_id, exchange, venue_account_id) slot — the live-rows predicate does not hold for ccxt venues';
  WHEN OTHERS THEN
    RAISE EXCEPTION 'TEST FAILED (6f CCXT): a new live okx row after the first was disconnected was refused with SQLSTATE % (%), not admitted', SQLSTATE, SQLERRM;
  END;

  -- ===== Phase 225 / CONN-03 — api_keys.venue_server (migration 20261123180000) ====
  -- The column and the 13th create_wizard_strategy parameter are new, and the unique
  -- index is NOT changed by that migration (plan 10's migration owns it), so every 6v arm
  -- below reads the column, the function or the privileges, never the index. The index's
  -- own behaviour is the 6s arms at the foot of this section.
  -- The wizard RPC admits service_role only (auth.role() reads request.jwt.claims),
  -- so each call sets that claim first and clears it again right after.

  -- ----- 6v-writes. the server lands in the SAME INSERT, normalised ---------------
  -- A caller passes the server with stray spaces and upper-case letters; the stored
  -- value must be the trimmed lower-case form. venue_account_id is asserted too: it
  -- proves the call reached the INSERT as the privileged owner (the scrub trigger
  -- would NULL it for any other writer), so a NULL venue_server below is the
  -- parameter's fault and nothing else's.
  -- RED-UNDER: replace the stamp expression NULLIF(lower(btrim(p_venue_server, E' \t\r\n')), '')
  --            in the migration's INSERT with a bare NULL — the "forgot to wire the
  --            parameter" regression: the 13th parameter is accepted and ignored, so
  --            every MT5 key stays at the wildcard forever and the index change
  --            (plan 10) fences nothing.
  -- RED-UNDER-M: {"arm":"6v-writes","apply":[{"kind":"edit","file":"supabase/migrations/20261123180000_api_keys_venue_server.sql","find":"NULLIF(lower(btrim(p_venue_server, E' \\t\\r\\n')), '')","replace":"NULL","occurrences":1}]}
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', uid_a::text, 'role', 'service_role')::text, true);
  SELECT w.strategy_id, w.api_key_id INTO v_strat225, v_key225
    FROM public.create_wizard_strategy(
      p_user_id := uid_a, p_exchange := 'mt5', p_label := 'wizcont225 writes',
      p_api_key_encrypted := 'enc', p_api_secret_encrypted := 'sec',
      p_passphrase_encrypted := 'pass', p_dek_encrypted := 'dek', p_nonce := 'nonce',
      p_kek_version := 1, p_placeholder_name := 'wizcont225 writes draft',
      p_wizard_session_id := gen_random_uuid(),
      p_venue_account_id := c_acct225,
      p_venue_server := '  Synthetic-Broker-Live  ') AS w;
  PERFORM set_config('request.jwt.claims', NULL, true);

  SELECT venue_account_id, venue_server INTO v_stamped, v_srv225
    FROM api_keys WHERE id = v_key225;
  IF v_stamped IS DISTINCT FROM c_acct225 THEN
    RAISE EXCEPTION 'TEST FAILED (6v-writes): the wizard RPC did not stamp venue_account_id (got %, expected %) — the call never reached the privileged INSERT, so the server assertion below would be vacuous',
      v_stamped, c_acct225;
  END IF;
  IF v_srv225 IS DISTINCT FROM 'synthetic-broker-live' THEN
    RAISE EXCEPTION 'TEST FAILED (6v-writes): create_wizard_strategy stored venue_server % for the input ''  Synthetic-Broker-Live  '' — expected the trimmed lower-case form ''synthetic-broker-live'' written in the SAME INSERT that stamps venue_account_id (CONN-03). NULL here means the parameter is accepted and dropped', v_srv225;
  END IF;

  -- ----- 6v-writes-ws. a tab/newline-only login or server is blank, so it stores NULL ----
  -- btrim with no character set trims spaces only, so a login or server made of tabs and
  -- newlines would be stored as a real, non-wildcard identity. The call is made inside a
  -- handler that only records, so a refusal by api_keys_venue_server_valid is read as a
  -- named failure of this arm and not as a raw error.
  -- RED-UNDER: trim the login and the server stamps with a bare btrim (spaces only) in the
  --            migration's INSERT: the tab-only login is stored as an identity and the
  --            tab-and-newline server is refused by the CHECK.
  -- RED-UNDER-M: {"arm":"6v-writes-ws","apply":[{"kind":"edit","file":"supabase/migrations/20261123180000_api_keys_venue_server.sql","find":"NULLIF(btrim(p_venue_account_id, E' \\t\\r\\n'), '')","replace":"NULLIF(btrim(p_venue_account_id), '')","occurrences":1},{"kind":"edit","file":"supabase/migrations/20261123180000_api_keys_venue_server.sql","find":"NULLIF(lower(btrim(p_venue_server, E' \\t\\r\\n')), '')","replace":"NULLIF(lower(btrim(p_venue_server)), '')","occurrences":1}]}
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', uid_a::text, 'role', 'service_role')::text, true);
  v_ws_err := NULL;
  v_key_ws := NULL;
  BEGIN
    SELECT w.api_key_id INTO v_key_ws
      FROM public.create_wizard_strategy(
        p_user_id := uid_a, p_exchange := 'mt5', p_label := 'wizcont225 ws',
        p_api_key_encrypted := 'enc', p_api_secret_encrypted := 'sec',
        p_passphrase_encrypted := 'pass', p_dek_encrypted := 'dek', p_nonce := 'nonce',
        p_kek_version := 1, p_placeholder_name := 'wizcont225 ws draft',
        p_wizard_session_id := gen_random_uuid(),
        p_venue_account_id := E' \t\n ',
        p_venue_server := E' \t\r\n ') AS w;
  EXCEPTION WHEN OTHERS THEN
    v_ws_err := SQLSTATE || ' ' || SQLERRM;
  END;
  PERFORM set_config('request.jwt.claims', NULL, true);
  IF v_ws_err IS NOT NULL THEN
    RAISE EXCEPTION 'TEST FAILED (6v-writes-ws): create_wizard_strategy refused a tab/newline-only login and server (%) — they must normalise to NULL (blank), not reach the INSERT as values', v_ws_err;
  END IF;
  SELECT venue_account_id, venue_server INTO v_stamped, v_srv225
    FROM api_keys WHERE id = v_key_ws;
  IF v_stamped IS NOT NULL OR v_srv225 IS NOT NULL THEN
    RAISE EXCEPTION 'TEST FAILED (6v-writes-ws): create_wizard_strategy stored login % and server % for a tab/newline-only login and server — both must be NULL', v_stamped, v_srv225;
  END IF;

  -- ----- 6v-check-blank. a blank or over-long server is refused by NAME -----------
  -- Without api_keys_venue_server_valid a whitespace-only value is a non-NULL
  -- "server" no real broker has, and a 129-character value is unbounded user text in
  -- an identity column. Asserted by constraint NAME so a different CHECK refusing it
  -- cannot pass for this one.
  -- RED-UNDER: DROP the LIVE api_keys_venue_server_valid constraint. A `sql` step,
  --            not a migration edit: the CHECK is created by the migration, and the
  --            drift worth catching is the constraint going missing after apply.
  -- RED-UNDER-M: {"arm":"6v-check-blank","apply":[{"kind":"sql","stmt":"ALTER TABLE public.api_keys DROP CONSTRAINT api_keys_venue_server_valid"}]}
  BEGIN
    UPDATE api_keys SET venue_server = '   ' WHERE id = v_key225;
    RAISE EXCEPTION 'TEST FAILED (6v-check-blank): a WHITESPACE-ONLY venue_server was ADMITTED — api_keys_venue_server_valid does not refuse a blank server, so a blank string becomes a distinct "server" that matches nothing and every wildcard rule reads it as a real value';
  EXCEPTION WHEN check_violation THEN
    GET STACKED DIAGNOSTICS v_cname = CONSTRAINT_NAME;
    IF v_cname IS DISTINCT FROM 'api_keys_venue_server_valid' THEN
      RAISE EXCEPTION 'TEST FAILED (6v-check-blank): a whitespace-only venue_server was refused by constraint % and not by api_keys_venue_server_valid', v_cname;
    END IF;
  END;
  BEGIN
    UPDATE api_keys SET venue_server = repeat('a', 129) WHERE id = v_key225;
    RAISE EXCEPTION 'TEST FAILED (6v-check-blank): a 129-CHARACTER venue_server was ADMITTED — api_keys_venue_server_valid must cap the length at 128';
  EXCEPTION WHEN check_violation THEN
    GET STACKED DIAGNOSTICS v_cname = CONSTRAINT_NAME;
    IF v_cname IS DISTINCT FROM 'api_keys_venue_server_valid' THEN
      RAISE EXCEPTION 'TEST FAILED (6v-check-blank): a 129-character venue_server was refused by constraint % and not by api_keys_venue_server_valid', v_cname;
    END IF;
  END;

  -- ----- 6v-check-ws. a tab/newline-only server is refused by NAME ---------------------
  -- 6v-check-blank pins a spaces-only value; the CHECK's blank leg must also treat tab,
  -- carriage return and newline as blank.
  -- RED-UNDER: give the CHECK's blank leg a bare btrim (spaces only) in the migration: the
  --            tab/newline-only value is admitted.
  -- RED-UNDER-M: {"arm":"6v-check-ws","apply":[{"kind":"edit","file":"supabase/migrations/20261123180000_api_keys_venue_server.sql","find":"btrim(venue_server, E' \\t\\r\\n') <> ''","replace":"btrim(venue_server) <> ''","occurrences":1}]}
  BEGIN
    UPDATE api_keys SET venue_server = E'\t\r\n' WHERE id = v_key225;
    RAISE EXCEPTION 'TEST FAILED (6v-check-ws): a TAB/NEWLINE-ONLY venue_server was ADMITTED — api_keys_venue_server_valid trims spaces only, so a blank server is stored as a real identity';
  EXCEPTION WHEN check_violation THEN
    GET STACKED DIAGNOSTICS v_cname = CONSTRAINT_NAME;
    IF v_cname IS DISTINCT FROM 'api_keys_venue_server_valid' THEN
      RAISE EXCEPTION 'TEST FAILED (6v-check-ws): a tab/newline-only venue_server was refused by constraint % and not by api_keys_venue_server_valid', v_cname;
    END IF;
  END;

  -- ----- 6v-omitted. today's 12-argument caller keeps working ---------------------
  -- The routes that exist today omit p_venue_server. The migration must merge ahead of
  -- the code that sends it, so a call without the parameter has to resolve and store
  -- NULL (the wildcard). ⛔ NOT a typed `12 vs 13 positional` call: it is the NAMED
  -- call PostgREST makes, because that is the shape that answers PGRST202 when the
  -- parameter loses its default.
  -- RED-UNDER: strip the DEFAULT NULL from BOTH trailing parameters in the migration
  --            (p_venue_account_id and p_venue_server): the function then has thirteen
  --            required parameters, and today's twelve-named-argument call no longer
  --            resolves. Both defaults go together because PostgreSQL refuses a
  --            required parameter after one with a default, so stripping only the
  --            last would abort the apply instead of reaching this arm.
  -- RED-UNDER-M: {"arm":"6v-omitted","apply":[{"kind":"edit","file":"supabase/migrations/20261123180000_api_keys_venue_server.sql","find":"p_venue_account_id TEXT DEFAULT NULL,\n  p_venue_server TEXT DEFAULT NULL","replace":"p_venue_account_id TEXT,\n  p_venue_server TEXT","occurrences":1}]}
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', uid_a::text, 'role', 'service_role')::text, true);
  BEGIN
    SELECT w.strategy_id, w.api_key_id INTO v_strat225, v_key225
      FROM public.create_wizard_strategy(
        p_user_id := uid_a, p_exchange := 'mt5', p_label := 'wizcont225 omitted',
        p_api_key_encrypted := 'enc', p_api_secret_encrypted := 'sec',
        p_passphrase_encrypted := 'pass', p_dek_encrypted := 'dek', p_nonce := 'nonce',
        p_kek_version := 1, p_placeholder_name := 'wizcont225 omitted draft',
        p_wizard_session_id := gen_random_uuid(),
        p_venue_account_id := c_acct225b) AS w;
  EXCEPTION WHEN undefined_function THEN
    PERFORM set_config('request.jwt.claims', NULL, true);
    RAISE EXCEPTION 'TEST FAILED (6v-omitted): the twelve-named-argument create_wizard_strategy call (no p_venue_server) did not resolve (SQLSTATE %) — the new parameter has no DEFAULT, so every connect from a route that does not send it answers PGRST202', SQLSTATE;
  END;
  PERFORM set_config('request.jwt.claims', NULL, true);

  SELECT venue_account_id, venue_server INTO v_stamped, v_srv225
    FROM api_keys WHERE id = v_key225;
  IF v_stamped IS DISTINCT FROM c_acct225b THEN
    RAISE EXCEPTION 'TEST FAILED (6v-omitted): the call without p_venue_server did not stamp venue_account_id (got %, expected %)', v_stamped, c_acct225b;
  END IF;
  IF v_srv225 IS NOT NULL THEN
    RAISE EXCEPTION 'TEST FAILED (6v-omitted): a call that omitted p_venue_server stored venue_server % — the omitted parameter must store NULL, the wildcard every app fence reads', v_srv225;
  END IF;

  -- ----- 6v-owner-read. the owner may READ the column through the column grant -----
  -- Phase 225 plan 13 (CONTEXT Q6 item 1; founder answer "Owner-only read (Recommended)",
  -- 2026-11-25) REVERSES plan 01's no-grant posture: the TypeScript identity twin reads
  -- api_keys.venue_server as `authenticated`, so the column grant is now REQUIRED. Row
  -- scope stays the existing owner-only RLS on api_keys, which this arm does not touch.
  -- has_column_privilege is TRUE for a table-level grant as well as a column grant, so a
  -- future table-level grant also satisfies it; the write and anon halves live in
  -- 6v-no-grant below.
  -- RED-UNDER: REVOKE SELECT (venue_server) from `authenticated` on the LIVE database —
  --            the column is unreadable again and every TypeScript key read that selects
  --            it answers 42501.
  -- RED-UNDER-M: {"arm":"6v-owner-read","apply":[{"kind":"sql","stmt":"REVOKE SELECT (venue_server) ON public.api_keys FROM authenticated"}]}
  IF NOT has_column_privilege('authenticated', 'public.api_keys', 'venue_server', 'SELECT') THEN
    RAISE EXCEPTION 'TEST FAILED (6v-owner-read): authenticated holds no SELECT on api_keys.venue_server — the owner cannot read their key''s broker server, so the TypeScript identity twin cannot become server-aware (CONN-03, CONTEXT Q6). The column grant of migration 20261125132334 was dropped or revoked';
  END IF;

  -- ----- 6v-no-grant. no browser write, and nothing at all for anon ---------------
  -- The browser roles never WRITE the column (the analytics worker and the service-role
  -- connect writers are its only writers, CONTEXT Q2), and anon holds nothing on it.
  -- api_keys has no table-level SELECT for the browser roles, only a per-column
  -- allowlist; has_column_privilege is TRUE for a table-level grant as well, so it
  -- catches that route too. authenticated SELECT is NOT asserted false here since plan 13:
  -- it is asserted TRUE by 6v-owner-read.
  -- RED-UNDER: GRANT UPDATE (venue_server) to `authenticated` on the LIVE database —
  --            the "let the browser edit the broker server" shortcut that would let an
  --            owner spoof which server an identity token is built from.
  -- RED-UNDER-M: {"arm":"6v-no-grant","apply":[{"kind":"sql","stmt":"GRANT UPDATE (venue_server) ON public.api_keys TO authenticated"}]}
  IF has_column_privilege('authenticated', 'public.api_keys', 'venue_server', 'INSERT')
     OR has_column_privilege('authenticated', 'public.api_keys', 'venue_server', 'UPDATE') THEN
    RAISE EXCEPTION 'TEST FAILED (6v-no-grant): authenticated holds INSERT or UPDATE on api_keys.venue_server — a browser role must never write the broker server (CONN-03, CONTEXT Q2). A column grant was added, or a table-level grant returned';
  END IF;
  IF has_column_privilege('anon', 'public.api_keys', 'venue_server', 'SELECT')
     OR has_column_privilege('anon', 'public.api_keys', 'venue_server', 'INSERT')
     OR has_column_privilege('anon', 'public.api_keys', 'venue_server', 'UPDATE') THEN
    RAISE EXCEPTION 'TEST FAILED (6v-no-grant): anon holds a privilege on api_keys.venue_server';
  END IF;

  -- ----- 6s-two-servers. the same login on TWO servers: both keys are admitted ------------
  -- Phase 225 / CONN-03 (plan 10), the point of the fourth member: login 1001 on one broker
  -- and login 1001 on another are two accounts. Without the member the second insert is the
  -- 23505 of the old login-only index.
  -- RED-UNDER: rebuild the LIVE index with the member (venue_server IS NULL): still a fourth
  --            expression member naming venue_server, so section 2 passes, but two keys that
  --            both HAVE a server get the same member value and collide.
  -- RED-UNDER-M: {"arm":"6s-two-servers","apply":[{"kind":"sql","stmt":"DROP INDEX public.api_keys_user_exchange_venue_account_uniq; CREATE UNIQUE INDEX api_keys_user_exchange_venue_account_uniq ON public.api_keys (user_id, exchange, venue_account_id, (venue_server IS NULL)) WHERE venue_account_id IS NOT NULL AND disconnected_at IS NULL"}]}
  BEGIN
    INSERT INTO api_keys (user_id, exchange, label, api_key_encrypted, is_active, venue_account_id, venue_server)
    VALUES (uid_a, 'mt5', 'wizcont225 two servers a', 'enc', true, c_s_two, 'srv-a');
    INSERT INTO api_keys (user_id, exchange, label, api_key_encrypted, is_active, venue_account_id, venue_server)
    VALUES (uid_a, 'mt5', 'wizcont225 two servers b', 'enc', true, c_s_two, 'srv-b');
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'TEST FAILED (6s-two-servers): the same login on two DIFFERENT servers was refused 23505 — the identity index does not key on the server, so one MT5 login on two brokers collides (CONN-03)';
  WHEN OTHERS THEN
    RAISE EXCEPTION 'TEST FAILED (6s-two-servers): two keys on one login and two servers were refused with SQLSTATE % (%), not admitted', SQLSTATE, SQLERRM;
  END;

  -- ----- 6s-same-server. the same login on the SAME server: the second key is REFUSED by NAME ----
  -- A server in the key must not weaken the fence for the case the index exists for.
  -- RED-UNDER: rebuild the LIVE index with an extra `AND venue_server IS NULL` conjunct in
  --            its predicate: both predicate conjuncts section 2 reads are still there, but a
  --            key that carries a server is no longer indexed at all, so an equal server is
  --            admitted twice.
  -- RED-UNDER-M: {"arm":"6s-same-server","apply":[{"kind":"sql","stmt":"DROP INDEX public.api_keys_user_exchange_venue_account_uniq; CREATE UNIQUE INDEX api_keys_user_exchange_venue_account_uniq ON public.api_keys (user_id, exchange, venue_account_id, (COALESCE(venue_server, ''))) WHERE venue_account_id IS NOT NULL AND disconnected_at IS NULL AND venue_server IS NULL"}]}
  BEGIN
    INSERT INTO api_keys (user_id, exchange, label, api_key_encrypted, is_active, venue_account_id, venue_server)
    VALUES (uid_a, 'mt5', 'wizcont225 same server first', 'enc', true, c_s_same, 'srv-a');
  EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION 'TEST FAILED (6s-same-server): the FIRST live key on a login and server was refused with SQLSTATE % (%), not admitted', SQLSTATE, SQLERRM;
  END;
  v_refused := FALSE;
  v_cname := NULL;
  BEGIN
    INSERT INTO api_keys (user_id, exchange, label, api_key_encrypted, is_active, venue_account_id, venue_server)
    VALUES (uid_a, 'mt5', 'wizcont225 same server second', 'enc', true, c_s_same, 'srv-a');
  EXCEPTION WHEN unique_violation THEN
    GET STACKED DIAGNOSTICS v_cname = CONSTRAINT_NAME;
    v_refused := TRUE;
  WHEN OTHERS THEN
    RAISE EXCEPTION 'TEST FAILED (6s-same-server): a second live key on one login and server was refused with SQLSTATE % (%), not the 23505 of the identity index', SQLSTATE, SQLERRM;
  END;
  IF NOT v_refused THEN
    RAISE EXCEPTION 'TEST FAILED (6s-same-server): a SECOND live key on one (user, exchange, login, server) was ADMITTED — the identity index no longer fences the same account on the same server (CONN-03, ONCE-02)';
  END IF;
  IF v_cname IS DISTINCT FROM c_idx THEN
    RAISE EXCEPTION 'TEST FAILED (6s-same-server): the second key was refused by % and not by %', v_cname, c_idx;
  END IF;

  -- ----- 6s-null-vs-set. a key with no server beside a key WITH a server is ADMITTED ----------
  -- A NULL server is not a wildcard at the index: the wildcard that makes an unstamped key
  -- count as the same account lives in the application fences and in reconnect, which refuse
  -- before the index is reached. An index that treated NULL as a value would collide this pair.
  -- RED-UNDER: rebuild the LIVE index with the member COALESCE(venue_server, 'srv-a'): a
  --            fourth expression member naming venue_server, so section 2 passes, and the
  --            pairs the earlier 6s arms insert behave as before, but a NULL server now equals
  --            the server 'srv-a'.
  -- RED-UNDER-M: {"arm":"6s-null-vs-set","apply":[{"kind":"sql","stmt":"DROP INDEX public.api_keys_user_exchange_venue_account_uniq; CREATE UNIQUE INDEX api_keys_user_exchange_venue_account_uniq ON public.api_keys (user_id, exchange, venue_account_id, (COALESCE(venue_server, 'srv-a'))) WHERE venue_account_id IS NOT NULL AND disconnected_at IS NULL"}]}
  BEGIN
    INSERT INTO api_keys (user_id, exchange, label, api_key_encrypted, is_active, venue_account_id)
    VALUES (uid_a, 'mt5', 'wizcont225 mix null', 'enc', true, c_s_mix);
    INSERT INTO api_keys (user_id, exchange, label, api_key_encrypted, is_active, venue_account_id, venue_server)
    VALUES (uid_a, 'mt5', 'wizcont225 mix set', 'enc', true, c_s_mix, 'srv-a');
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'TEST FAILED (6s-null-vs-set): a key with a server was refused 23505 beside a live key with NO server on the same login — the index treats a NULL server as a value that can equal a real one (CONN-03)';
  WHEN OTHERS THEN
    RAISE EXCEPTION 'TEST FAILED (6s-null-vs-set): a key with a server beside a key with none was refused with SQLSTATE % (%), not admitted', SQLSTATE, SQLERRM;
  END;

  -- ----- 6s-two-owners. two OWNERS on one login and server both insert (ONCE-02, Q3) ----------
  -- The index is per tenant: the same login on the same server under two owners is allowed
  -- (founder ruling Q3). 6e pins this for null servers; this arm pins it for a real server.
  -- RED-UNDER: add a SECOND unique index on the LIVE database over (exchange, venue_account_id,
  --            COALESCE(venue_server, '')) with no user_id, scoped to keys that carry a server
  --            (so 6e, whose keys have none, is not its first failure): the cross-tenant
  --            scoping error, alongside the correct index, which only this arm can see.
  -- RED-UNDER-M: {"arm":"6s-two-owners","apply":[{"kind":"sql","stmt":"CREATE UNIQUE INDEX api_keys_venue_account_server_global_uniq ON public.api_keys (exchange, venue_account_id, (COALESCE(venue_server, ''))) WHERE venue_account_id IS NOT NULL AND disconnected_at IS NULL AND venue_server IS NOT NULL"}]}
  BEGIN
    INSERT INTO api_keys (user_id, exchange, label, api_key_encrypted, is_active, venue_account_id, venue_server)
    VALUES (uid_a, 'mt5', 'wizcont225 owners a', 'enc', true, c_s_own, 'srv-a');
    INSERT INTO api_keys (user_id, exchange, label, api_key_encrypted, is_active, venue_account_id, venue_server)
    VALUES (uid_b, 'mt5', 'wizcont225 owners b', 'enc', true, c_s_own, 'srv-a');
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'TEST FAILED (6s-two-owners): a DIFFERENT owner was refused 23505 for the same login and server — uniqueness is not tenant-scoped, one owner''s key leaks its existence to and blocks another''s (ONCE-02, founder ruling Q3)';
  WHEN OTHERS THEN
    RAISE EXCEPTION 'TEST FAILED (6s-two-owners): two owners on one login and server were refused with SQLSTATE % (%), not admitted', SQLSTATE, SQLERRM;
  END;

  -- ----- cleanup ------------------------------------------------------------
  -- Explicit, in FK order, rather than relying on the profiles→api_keys cascade.
  -- The wizard drafts the 6v arms minted hang off uid_a through strategies.
  DELETE FROM strategies WHERE user_id IN (uid_a, uid_b);
  DELETE FROM api_keys WHERE user_id IN (uid_a, uid_b);
  DELETE FROM auth.users WHERE id IN (uid_a, uid_b);

  RAISE NOTICE 'PASS (behavioural): duplicate LIVE identity refused (23505); a soft-disconnected row does NOT squat the slot; reconnecting into an occupied slot refused (23505); '''' and ''   '' refused (23514); a different tenant admitted the same identity; a second live okx row on one account refused and admitted once the first is disconnected (6f CCXT); the 13-parameter wizard RPC stores the normalised broker server in the same INSERT (6v-writes) and a tab/newline-only login or server stores NULL (6v-writes-ws), a call that omits it stores NULL (6v-omitted), api_keys_venue_server_valid refuses a blank or 129-character server by name (6v-check-blank) and a tab/newline-only one (6v-check-ws), the owner may read api_keys.venue_server through the column grant (6v-owner-read), and the browser roles may not write it nor anon read it (6v-no-grant); two null servers on one login are refused by the identity index (6s-null-null), the same login on two servers is admitted (6s-two-servers) and on one server refused by name (6s-same-server), a null server beside a set one is admitted (6s-null-vs-set), and two owners on one login and server are both admitted (6s-two-owners).';
END $behavioural$;
