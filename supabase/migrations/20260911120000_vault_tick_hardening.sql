-- Migration: public.match_engine_cron_tick() is re-based so its Vault read is
-- single-row-safe, its empty-key guard sees WHITESPACE, and its EXECUTE grantee
-- set is asserted WHOLE — and so that the body check guarding all of it is one
-- that CAN FAIL.
-- Phase 164.8.6 / plan 01 / ROADMAP criteria 1, 2, 3, 4 (TODOS.md
-- 164.7-CR05-VACUOUS-MIGRATION-CHECK, 164.7-WR01-VAULT-NOT-STRICT,
-- VAULTTICK-EMPTYKEY-01, 164.7-WR02-SERVICE-ROLE-EXECUTE). 2026-09-11.
--
-- ⚠️ OPS: merging supabase/migrations/** to main applies to shared TEST FIRST
-- (supabase-migrate.yml `apply-test`) and then AUTO-APPLIES to PROD behind the
-- Production environment's human reviewer gate. This file redefines a LIVE
-- SECURITY DEFINER function, so the new body is live on the next merge with no
-- separate deploy step.
--
-- ⛔ IT IS A FORWARD MIGRATION AND NOT AN EDIT TO AN APPLIED ONE. 20260907120000
-- is applied on PROD; criterion 1 is satisfied by re-running its check 6 here in
-- a falsifiable form, never by rewriting a file the ledger has already recorded.
--
-- ══════════════════════════════════════════════════════════════════════════
-- TWO FILES, ONE REPAIR — recorded rather than silently satisfied
-- ══════════════════════════════════════════════════════════════════════════
-- The ROADMAP goal sentence says "One forward migration". The "one FILE"
-- reading is DISPROVEN by lane topology: the tick gate's lane applies fixtures
-- 01/02/07/12/15/32 plus 20260907120000 and NONE of the ledger stack, while the
-- two fan-out gates' lanes apply the ledger stack and no vault stand-in. One
-- file that CREATE OR REPLACEs all three SECURITY DEFINER bodies could not
-- apply on either lane. So the TICK repair ships here, the LEDGER repair ships
-- in its sibling, and both merge in ONE pull request. "One shipped repair"
-- holds; "one file" does not.
--
-- ══════════════════════════════════════════════════════════════════════════
-- VAC-04 ACKNOWLEDGEMENT — the PROD body this CREATE OR REPLACE overwrites
-- ══════════════════════════════════════════════════════════════════════════
-- The gate compares the COMMITTED SNAPSHOT (supabase/schema/functions/) against
-- PROD's live body. On any function-changing migration PR the two necessarily
-- disagree: `snapshot-drift` requires the snapshot to carry the body the
-- MIGRATIONS produce (the new one), while VAC-04 requires it to match what PROD
-- has TODAY (the old one). The pragma is the designed resolution, and it means
-- "I read PROD's body and intend to overwrite it".
--
-- MEASURED 2026-09-11, reproduced LOCALLY with the gate's own normalizer, aiming
-- its `live` argument at origin/main's snapshot rather than at PROD
-- (origin/main = 67aa1c21e775a53fc9f5f380cd8ebe4d8a5d3329):
--
--   node scripts/sql-body-normalize.mjs --diff-bodies \
--     supabase/schema/functions/match_engine_cron_tick.sql <origin/main's copy>
--
--     HEAD snapshot sha256      277f02d6d0cfdffab2269fb3a146e9dc78cb47f47c7217101748fd47d5a65bd6
--     origin/main body sha256   323330b42bdbbb8eaa797686ed80b5bf4f2a2bc9cb56f349838a72a524c943d9
--     differing lines           8
--
-- ⭐ THE ACKED HASH IS THE `live` COLUMN OF --diff-bodies, NOT `--hash` OF THE
-- SNAPSHOT FILE. scripts/prod-body-drift-check.sh reads the FIFTH TSV field of
-- --diff-bodies into `live_hash` (:1271) and greps for that token followed by
-- `live_hash` as a FIXED STRING (:1300), under its own comment "the ack must
-- carry the hash of the NORMALIZED PROD body". `--hash <file>` returns a
-- whole-FILE digest no gate ever greps: MEASURED, `--hash` of origin/main's
-- snapshot FILE is 3a3fdd65f0412ad8bce83af7c79e0e3d210ecfd6165b27fac620fa2f947d6de3,
-- which is NOT the string below. An ack carrying the file digest would read to a
-- human exactly like an ack and be invisible to the gate — the precise failure
-- this block exists to prevent, and the one this phase's RESEARCH §Q4 expected.
--
-- ⭐ AND THE METHOD IS CALIBRATED AGAINST A KNOWN-GOOD ACK. Re-run on Phase
-- 164.7's own inputs — --diff-bodies of commit 14b3b6c3's snapshot against its
-- parent's, for the two fan-outs — it reproduces 20260907130000:10-11's two
-- pragma hashes (88e6af84...ae6e36 and 7c3d33e9...4d81ac4) and their 15
-- differing lines EXACTLY. Those two were earned against REAL PROD in workflow
-- run 34138679709, so this recipe is measured against PROD once removed rather
-- than merely self-consistent.
--
-- prod-body-ack: 323330b42bdbbb8eaa797686ed80b5bf4f2a2bc9cb56f349838a72a524c943d9
--
-- ⚠️ THE ACK IS OF origin/main, WHICH STANDS IN FOR PROD (assumption A1). It is
-- EARNED only if VAC-04 on the PR reports that SAME hash for PROD. If it reports
-- a different one, PROD drifted OUT OF BAND and the correct action is to FOLD
-- the difference into this migration and re-derive — never to edit the pragma to
-- match a gate log. The ack is evidence that PROD was read, not a way to silence
-- the gate. It is EARNED, not pasted.
--
-- ══════════════════════════════════════════════════════════════════════════
-- THE DEFECT THIS FILE REPLACES (criterion 1 / 164.7-CR05)
-- ══════════════════════════════════════════════════════════════════════════
-- Check 6 of the APPLIED migration 20260907120000, quoted from :546-554:
--
--     SELECT regexp_replace(pg_get_functiondef('public.match_engine_cron_tick()'::regprocedure),
--                           '--[^\n]*', '', 'g')
--       INTO v_fn;
--     IF v_fn !~ 'vault\.decrypted_secrets' THEN
--       RAISE EXCEPTION 'Migration 20260907120000: match_engine_cron_tick does not read vault.decrypted_secrets. …';
--     END IF;
--     IF v_fn !~ 'analytics_service_url' THEN
--       RAISE EXCEPTION 'Migration 20260907120000: match_engine_cron_tick does not read analytics_service_url. …';
--     END IF;
--
-- ⭐ THE SECOND OF THOSE CANNOT FAIL. The strip removes `--` COMMENTS. It does
-- NOT remove STRING LITERALS — and the token it looks for sits inside the
-- function's OWN RAISE texts at 20260907120000:332 ('analytics_service_url
-- missing from system_settings — …') and :348 ('analytics_service_url in
-- system_settings is not an allowed destination — …'). Delete the settings read
-- at :328-330 outright, keep the two error messages, and the regex is still
-- satisfied: the check is satisfied by the prose that DOCUMENTS the rule it
-- claims to verify. That is the lint corpus' R2-functiondef-comment-strip one
-- layer over — literals rather than comments.
--
-- ⚠️ The FIRST of the two is not vacuous today (the only non-comment occurrence
-- of the vault relation is the read itself; the RAISE beside it says "missing
-- from vault", and COMMENT ON FUNCTION text is not returned by
-- pg_get_functiondef). It is re-expressed below in the sibling's form anyway,
-- because "not vacuous today" is a measurement that no future comment edit
-- re-takes.
--
-- ⚠️ RESIDUAL, RECORDED not closed, carried over from 20260907130000:880-886:
-- the comment strip does not remove `/* … */`. A block comment quoting a needle
-- would satisfy the checks below with the code gone. MEASURED on this body:
-- 0 occurrences of a block-comment opener. The other direction is safe by
-- construction — a `--` inside a string literal makes the strip eat real code,
-- which can only cause a FALSE FAILURE, and a false failure is loud.
--
-- ⚠️ SECOND RESIDUAL: this file does NOT re-run 20260907120000's check 7 (the
-- allow-list literal appearing identically in the CHECK constraint and in this
-- body). That check ran at that migration's apply and is not weakened here; the
-- body's own comment about it is kept byte-for-byte for the same reason.
--
-- ══════════════════════════════════════════════════════════════════════════
-- DISJOINTNESS — the needles this file ASSERTS vs. the strings the gate MUTATES
-- ══════════════════════════════════════════════════════════════════════════
-- A verification needle that a gate arm mutates ABORTS the apply: the gate then
-- never runs, no arm can be the first failure, and the runner scores a defect
-- that would need a waiver. WAIVED_CEILING is 0 (scripts/mutation-runner/run.mjs,
-- read it by SYMBOL) and stays 0, so an intersection here is NOT waivable — it
-- is fixed at the source. The two sets, enumerated:
--
--   MIGRATION NEEDLES (asserted present by position(needle IN v_def) below)
--     FROM vault.decrypted_secrets          — the Vault read's own statement shape
--     FROM public.system_settings           — the settings read's own statement shape
--     IF v_cnt > 1 THEN                     — the cardinality guard (shape-only; no arm)
--
--   GATE `find` STRINGS (mutated by the twins in
--   supabase/tests/test_analytics_service_settings_and_vault_tick.sql)
--     V1, V2   IF v_key IS NULL OR btrim(v_key) = '' ⟦…⟧
--     U1       IF v_url IS NULL OR v_url = '' ⟦…⟧
--     C1       WHERE s.key = 'analytics_service_url⟦…⟧
--     C2       IF v_url !~ c_url_allowed ⟦…⟧
--     C3       … read it with an admin session. Allowed: an https host under .up.railway.app⟦…⟧
--
-- ⛔ EVERY GATE `find` ABOVE IS PRINTED WITH ITS TAIL ELIDED AS ⟦…⟧ AND IS
--    THEREFORE NOT A BYTE-IDENTICAL COPY, DELIBERATELY. The mutation runner
--    measures `occurrences` over the RAW FILE TEXT, comments included
--    (countOccurrences / applyFileStep in scripts/mutation-runner/run.mjs): a
--    verbatim paste of a find string in this header would be a SECOND
--    occurrence, every one of those arms claims 1, and the run would report
--    MEASURE_FAIL / occurrence-mismatch — the mutation not applied, so the arm
--    not tested. The elided tails are, in order: THEN, THEN, ' , THEN, and ';
--    This is the same class of trap 20260907130000:776-783 records for its own
--    concatenated needle, and the reason the three needles above are ASSEMBLED
--    BY CONCATENATION in the DECLARE below rather than written whole.
--
-- ⛔ NEITHER V1's NOR V2's find is a needle, and no arm mutates the cardinality
--    guard. The two sets are disjoint by construction and stay that way: adding
--    a needle means re-reading this table, not adding a waiver.
--
-- ══════════════════════════════════════════════════════════════════════════
-- SHAPE-ONLY, AND WHY (criterion 2)
-- ══════════════════════════════════════════════════════════════════════════
-- ⚠️ THE CARDINALITY GUARD IS ASSERTED BY SHAPE AND NEVER EXERCISED, because
-- neither environment can construct the state it refuses. The pg-lane stand-in
-- declares `vault.decrypted_secrets (name TEXT PRIMARY KEY, …)`
-- (scripts/pg-lane/fixtures/32-fixture-vault-stand-in.sql:49-52), and on TEST
-- and PROD the relation is the real supabase_vault VIEW over a uniquely-named
-- secret store — there is no constraint a gate could drop to insert two rows of
-- one name. So the guard is asserted by a variable-bound needle below and by no
-- gate arm at all. Recorded, not closed.
--
-- ══════════════════════════════════════════════════════════════════════════
-- RE-BASE DISCIPLINE (DRIFT-02)
-- ══════════════════════════════════════════════════════════════════════════
-- The LEFT side of this re-base is the COMMITTED SNAPSHOT
-- supabase/schema/functions/match_engine_cron_tick.sql:9-76 — the artifact the
-- PROD-body gate compares against — and NOT the 20260907120000 migration text.
-- The two are identical today; the snapshot is canonical, and using it is what
-- makes "identical today" a measurement rather than an assumption. EVERY line
-- outside the Vault read and the key guard is copied VERBATIM: the allow-list
-- CONSTANT and its comment (including its reference to 20260907120000's STEP 3
-- check 7, which is still true of the catalogue), the settings read, the url
-- guards, the no-echo note, the async net.http_post note, the post itself and
-- its dollar-quote TAG.
--
-- ⚠️ Regenerating supabase/schema/functions/ (`npm run schema:functions`) after
-- this file lands is a SEPARATE step of this phase, not an optional tidy: the
-- snapshot is what VAC-04 and src/__tests__/prod-prober-wiring.test.ts read.

BEGIN;

-- --------------------------------------------------------------------------
-- STEP 1: the re-based body
-- --------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.match_engine_cron_tick()
RETURNS BIGINT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $tick$
DECLARE
  v_key TEXT;
  -- ⛔ DECLAREd because plpgsql compiles the body WHOLE: a missing DECLARE does
  --    not weaken the one statement that uses it, it raises 42601 and the
  --    function does not compile at all (20260907130000:750-754).
  v_cnt INTEGER;
  v_url TEXT;
  v_req BIGINT;
  -- ⛔ THE DESTINATION ALLOW-LIST, layer (b). BYTE-IDENTICAL to the CHECK
  --    constraint's expression in STEP 1b, and STEP 3 check 7 asserts that the
  --    two really are the same string by reading pg_get_constraintdef and this
  --    body back out of the catalogue. Two copies of one rule is the point: the
  --    constraint is one ALTER TABLE away from gone, and this is what still
  --    refuses the POST when it is.
  c_url_allowed CONSTANT TEXT :=
    '^(https://[a-z0-9][a-z0-9.-]*\.up\.railway\.app|http://127\.0\.0\.1:9)$';
BEGIN
  -- THE VAULT READ — ONE statement, count and value off the SAME scan.
  -- ⛔ Not `INTO STRICT`, and the choice is not a style preference. STRICT
  --    raises NO_DATA_FOUND on zero rows, which would REPLACE the by-name
  --    message the gate's arm V1 asserts with a generic P0002; recovering the
  --    name then needs `EXCEPTION WHEN NO_DATA_FOUND THEN RAISE …`, the shape
  --    20260907130000:243-245 keeps out of the source because lint rule R1
  --    flags it in the gate corpus. The count form refuses a duplicate BY NAME
  --    and leaves the absent-secret message byte-identical.
  --    count = 0 leaves v_key NULL and the existing guard fires.
  SELECT count(*), max(decrypted_secret) INTO v_cnt, v_key
    FROM vault.decrypted_secrets
   WHERE name = 'analytics_service_key';
  IF v_cnt > 1 THEN
    RAISE EXCEPTION 'analytics_service_key is not unique in vault (% rows) — refusing to pick one', v_cnt;
  END IF;
  -- ⚠️ btrim() with no character set trims SPACES ONLY. A key of tabs or
  --    newlines still passes this guard and still produces a header the
  --    analytics service answers 401 to. RECORDED, not closed: the criterion
  --    text is btrim(v_key) = '' and widening it to E' \t\r\n' is a decision
  --    with its own evidence, not a silent improvement here.
  IF v_key IS NULL OR btrim(v_key) = '' THEN
    RAISE EXCEPTION 'analytics_service_key missing from vault — refusing to send a null header';
  END IF;

  SELECT s.value INTO v_url
    FROM public.system_settings s
   WHERE s.key = 'analytics_service_url';
  IF v_url IS NULL OR v_url = '' THEN
    RAISE EXCEPTION 'analytics_service_url missing from system_settings — refusing to post to a null url';
  END IF;

  -- ⛔ AND IT MUST BE A DESTINATION THIS FILE ALLOWS (T-164.7-06, layer (b)).
  -- The CHECK constraint in STEP 1b already refuses to STORE anything else; this
  -- re-test is what stands when that constraint has been dropped, and it is the
  -- last thing between an admin-writable row and a live service key in an
  -- outbound header.
  --
  -- ⚠️ THE MESSAGE DOES NOT ECHO THE OFFENDING URL, and that is not squeamishness
  -- about PII. RAISE text lands in the cron job-run row, in the Postgres log and
  -- in whatever ships those onward; echoing an attacker-chosen string there
  -- writes their collector's hostname into every downstream reader of this
  -- project's logs, and an operator who needs the value can SELECT it. Same rule
  -- as the two RAISEs above (T-161.1-10): name the SETTING, never its value.
  IF v_url !~ c_url_allowed THEN
    RAISE EXCEPTION 'analytics_service_url in system_settings is not an allowed destination — refusing to post the analytics service key. The offending value is deliberately NOT echoed here; read it with an admin session. Allowed: an https host under .up.railway.app';
  END IF;

  -- ⚠️ net.http_post is ASYNC. The BIGINT returned here is a REQUEST ID, not an
  -- HTTP status: a request that ends in a 401 or a timeout returns a perfectly
  -- ordinary id and leaves the caller looking successful. Whether the POST
  -- actually landed is read out of net._http_response, which is what the
  -- cron-obs prober arm does (TODOS CRON-OBS-01). Do not add a success message
  -- here — there is nothing at this point that knows whether it succeeded.
  SELECT net.http_post(
           url := v_url || '/api/match/cron-recompute',
           headers := jsonb_build_object(
                        'Content-Type', 'application/json',
                        'X-Service-Key', v_key
                      ),
           body := '{}'::jsonb,
           timeout_milliseconds := 60000
         ) INTO v_req;
  RETURN v_req;
END
$tick$;

COMMENT ON FUNCTION public.match_engine_cron_tick() IS
  'Phase 164.7 / SC-2 / DRIFT-02, re-based by Phase 164.8.6: the CALLABLE half '
  'of the mechanism the live match_engine_cron job already runs. Reads the '
  'analytics service key from vault.decrypted_secrets — ONE scan, counting and '
  'taking the value together, so a duplicate secret name is REFUSED BY NAME '
  'instead of an arbitrary row being picked — and the service URL from '
  'public.system_settings, RAISES when either is absent, empty or (for the key) '
  'whitespace rather than sending a useless header, RAISES again when the url '
  'is not a destination the STEP 1b allow-list permits (T-164.7-06 — that '
  're-test is what survives the CHECK constraint being dropped, and it never '
  'echoes the offending value), and fires one ASYNC net.http_post whose '
  'returned BIGINT is a request id and NOT an HTTP success. EXECUTE is held by '
  'the owner alone; the scheduler runs as that owner.';

-- --------------------------------------------------------------------------
-- STEP 2: the EXECUTE grantee set (criterion 4 / 164.7-WR02)
-- --------------------------------------------------------------------------
-- service_role is REVOKEd alongside PUBLIC, anon and authenticated — the
-- precedent is 20260515205431:111-116, the only migration in this repo that
-- already names service_role for exactly this reason. 20260907120000:385
-- revoked three of the four, and service_role's EXECUTE survived Phase 164.7
-- precisely because the check beside it probed only anon and authenticated.
--
-- NO GRANT follows. The scheduler runs as `postgres`, which is the function's
-- OWNER (scripts/prod-prober/cron-manifest.json jobid 1), and an owner needs no
-- grant — the same statement 20260907120000:386 makes.
--
-- ⚠️ ASSUMPTION A3, stated rather than assumed away: no out-of-repo caller
-- invokes this function as service_role. MEASURED at HEAD — a repo-wide grep
-- for the function name finds only this migration, its predecessor, the
-- committed snapshot, the gate and the prober manifest. An Edge Function or a
-- dashboard SQL snippet calling it as service_role is outside what a grep of
-- this repository can see, and would begin failing on 42501 at this merge.
REVOKE ALL ON FUNCTION public.match_engine_cron_tick() FROM PUBLIC, anon, authenticated, service_role;

-- --------------------------------------------------------------------------
-- STEP 3: self-verifying DO block
-- --------------------------------------------------------------------------
-- House style: RAISE EXCEPTION, never a silent NOTICE-skip.
--
-- ⛔ THIS BLOCK MUST NEVER CALL match_engine_cron_tick(). An apply-time
-- invocation would fire a real HTTP POST at the analytics service the moment
-- this migration merges. Assert the SHAPE, never the behaviour; behaviour is
-- covered by supabase/tests/test_analytics_service_settings_and_vault_tick.sql.
--
-- ⛔ AND IT MUST NEVER NAME vault.* OR net.* AS OBJECTS. Neither exists on the
-- pg-lane, and pg_net is an extension a fresh project may not have yet. Every
-- reference to them in this file lives INSIDE the plpgsql body above, where it
-- is resolved at CALL time — which is what lets this migration apply on a
-- vanilla cluster and therefore appear in a gate's apply list at all. A
-- catalogue probe here would make the file unusable in every apply list.
--
-- ⛔ CATALOGUE READS ONLY — NEVER A ROW COUNT (criterion 7,
-- [164.8-DATA-DEPENDENT-MIGRATION-ESCAPE]). Shared TEST carries PROD's
-- CATALOGUE and EMPTY tables. A DO block that reads DATA and RAISEs on an
-- unexpected count applies cleanly to PROD and REFUSES on TEST — and because a
-- failed TEST apply BLOCKS the PROD apply, that refusal blocks a production
-- deploy. 20260907120000:534-536 reads the seed row; this file deliberately
-- does NOT re-run it. The interim remedy for such a refusal is to REVERT THE
-- MERGE; ⛔ never to edit supabase-migrate.yml.
DO $verify$
DECLARE
  -- ⛔ Every variable is DECLAREd up front: plpgsql compiles a DO block WHOLE,
  --    so a missing DECLARE raises 42601 and NONE of the checks below run.
  v_nargs     SMALLINT;
  v_secdef    BOOLEAN;
  v_config    TEXT[];
  v_owner     TEXT;
  v_bypass    BOOLEAN;
  v_super     BOOLEAN;
  v_grantees  TEXT;
  v_def_raw   TEXT;
  v_def       TEXT;
  -- THE THREE NEEDLES, each BOUND TO A STATEMENT SHAPE and held in a variable
  -- so the check states it once and names it in its own failure message
  -- (20260907130000:765-775).
  --
  -- ⛔ ASSEMBLED BY CONCATENATION, DELIBERATELY, and do NOT "tidy" them into one
  --    literal each. Written whole, a needle would be a SECOND occurrence of the
  --    very statement shape it asserts is present exactly once — which is the
  --    property the gate's `occurrences` measurements and this file's own shape
  --    checks both depend on. Same argument, same shape, as the concatenated
  --    needle at 20260907130000:776-783.
  --
  -- (1) the Vault read. Bound to the READ, not to the relation name alone: the
  --     bare relation name would also be satisfied by a comment or by a RAISE
  --     that merely mentions it.
  v_vault_needle       TEXT := 'FROM vault.' || 'decrypted_secrets';
  -- (2) the settings read.
  --     ⛔ NOT the bare token 'analytics_service_url' — that is the defect this
  --        file replaces: the token lives in the body's OWN RAISE texts
  --        (20260907120000:332, :348), so a needle on it is satisfied with the
  --        read deleted.
  --     ⛔ NOT the settings-key WHERE line either — gate arm C1 MUTATES exactly
  --        that string, so a needle on it would abort the apply under C1, the
  --        gate would never run, and no arm could be the first failure. It is
  --        the C1 row of the header's disjointness table, printed there with its
  --        tail elided and NOT reproduced here, for the reason that table gives:
  --        a second raw occurrence in this file breaks C1's measured
  --        `occurrences`. C1's mutation leaves this needle intact by
  --        construction.
  v_settings_needle    TEXT := 'FROM public.' || 'system_settings';
  -- (3) the cardinality guard. Shape-only (see the header): no gate arm mutates
  --     it, because neither environment can hold two secrets of one name.
  v_cardinality_needle TEXT := 'IF v_cnt ' || '> 1 THEN';
BEGIN
  -- 1. The function exists and takes NO arguments. A caller-supplied url or key
  --    on a SECURITY DEFINER function IS the attack surface (T-161.1-10).
  SELECT p.pronargs, p.prosecdef, p.proconfig
    INTO v_nargs, v_secdef, v_config
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'match_engine_cron_tick';
  IF v_nargs IS NULL THEN
    RAISE EXCEPTION 'Migration 20260911120000: public.match_engine_cron_tick was not created — STEP 1 did not run, or ran under a different schema';
  END IF;
  IF v_nargs <> 0 THEN
    RAISE EXCEPTION 'Migration 20260911120000: match_engine_cron_tick takes % argument(s), expected 0 — a caller-supplied url or key on a SECURITY DEFINER function lets any caller who can EXECUTE it aim the service key at a host of their choosing', v_nargs;
  END IF;

  -- 2. SECURITY DEFINER with a pinned search_path. Both halves matter: the
  --    function reads the Vault as its OWNER, and an unpinned search_path lets a
  --    caller-controlled schema shadow the settings table and feed it a url.
  IF NOT v_secdef THEN
    RAISE EXCEPTION 'Migration 20260911120000: match_engine_cron_tick is not SECURITY DEFINER, so it reads the secret store as the CALLER and the Vault read fails for every role that is not the owner';
  END IF;
  IF v_config IS NULL OR NOT EXISTS (
       SELECT 1 FROM unnest(v_config) c WHERE c LIKE 'search_path=%'
     ) THEN
    RAISE EXCEPTION 'Migration 20260911120000: match_engine_cron_tick has no pinned search_path. On a SECURITY DEFINER function that is a privilege-escalation route — a caller-created settings table earlier in the path would supply the url the service key is posted to';
  END IF;

  -- 2b. …and the DEFINER role can actually SEE the row it reads (161.1-AUDIT
  --     F-2). The predicate is `rolsuper OR rolbypassrls`, never rolbypassrls
  --     alone: pg_roles.rolbypassrls reports only the EXPLICITLY granted
  --     attribute while a SUPERUSER bypasses RLS implicitly with the flag still
  --     FALSE, so the narrow predicate is a FALSE NEGATIVE that aborts a correct
  --     apply — on the auto-apply-to-PROD route, mid-file.
  SELECT r.rolname, r.rolbypassrls, r.rolsuper
    INTO v_owner, v_bypass, v_super
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    JOIN pg_roles r ON r.oid = p.proowner
   WHERE n.nspname = 'public' AND p.proname = 'match_engine_cron_tick';
  IF v_owner IS NULL THEN
    RAISE EXCEPTION 'Migration 20260911120000: could not resolve the owner of public.match_engine_cron_tick — pg_proc.proowner has no matching pg_roles row';
  END IF;
  IF NOT (COALESCE(v_bypass, FALSE) OR COALESCE(v_super, FALSE)) THEN
    RAISE EXCEPTION 'Migration 20260911120000: match_engine_cron_tick is owned by role "%" (rolsuper=%, rolbypassrls=%), which is exempt from row security by neither route. As SECURITY DEFINER it reads the RLS-enabled settings table as that role, and RLS admits only admins and the service role — so the url read returns NO ROW and the function reports a missing-row error while the row is demonstrably present. A true-looking error about a false cause', v_owner, v_super, v_bypass;
  END IF;

  -- 3-5. THE BODY ITSELF, asserted on the EXECUTABLE text.
  --
  -- ⚠️ pg_get_functiondef returns the body WITH its comments, so a position()
  -- test over the raw definition is a test a COMMENT can satisfy. Comments are
  -- stripped first and every assertion below runs on what is left. Lint rule
  -- R2-functiondef-comment-strip mandates this idiom BY RULE for any regex or
  -- LIKE over a pg_get_functiondef result.
  SELECT pg_get_functiondef('public.match_engine_cron_tick()'::regprocedure)
    INTO v_def_raw;
  v_def := regexp_replace(v_def_raw, '--[^\n]*', '', 'g');

  IF v_def IS NULL OR length(v_def) < 500 THEN
    RAISE EXCEPTION 'Migration 20260911120000: the comment-stripped definition of public.match_engine_cron_tick is % character(s) — the strip is broken, so checks 3-5 below would pass over nothing', COALESCE(length(v_def), 0);
  END IF;

  -- 3. the key comes from the VAULT, by a read (criterion 1's falsifiable form).
  IF position(v_vault_needle IN v_def) = 0 THEN
    RAISE EXCEPTION 'Migration 20260911120000: match_engine_cron_tick does not read the secret store (looked for "%"). The key would then come from somewhere else — a literal baked into the body, a table, or nothing at all — and the first two put the secret where pg_dump and every reader of the catalogue can see it', v_vault_needle;
  END IF;

  -- 4. the url comes from the SETTINGS TABLE, by a read. Deleting that read
  --    removes this needle's only occurrence, which is exactly what the applied
  --    check 6 could not say (see the header).
  IF position(v_settings_needle IN v_def) = 0 THEN
    RAISE EXCEPTION 'Migration 20260911120000: match_engine_cron_tick does not read the service url from the settings table (looked for "%"). A hardcoded URL is what 20260907120000 exists to replace — an operator would have to ship a migration to change a hostname', v_settings_needle;
  END IF;

  -- 5. the Vault read is CARDINALITY-GUARDED (criterion 2 / 164.7-WR01).
  IF position(v_cardinality_needle IN v_def) = 0 THEN
    RAISE EXCEPTION 'Migration 20260911120000: match_engine_cron_tick does not refuse an ambiguous secret (looked for "%"). Without it a duplicate secret name makes the read pick an arbitrary row, and the wrong key is sent in a header nothing downstream reports on — net.http_post is async, so a 401 returns an ordinary request id and the scheduler records the run as succeeded', v_cardinality_needle;
  END IF;

  -- 6. THE WHOLE EXECUTE GRANTEE SET IS EXACTLY THE OWNER (criterion 4).
  --
  -- ⭐ THE SET, not a subset. 20260907120000 probed anon and authenticated with
  --    has_function_privilege and passed while service_role still held EXECUTE —
  --    a subset check is satisfied by every role it does not name. aclexplode
  --    over proacl enumerates the grantees instead of interrogating a guessed
  --    list, so a grantee nobody thought of is a FAILURE rather than a silence.
  --
  -- ⚠️ COMPARED TO THE OWNER'S NAME, NEVER TO THE LITERAL 'postgres'. The
  --    pg-lane boots as whatever role scripts/pg-lane/run.sh created, and a
  --    literal would make this check pass or fail for a reason unrelated to the
  --    file.
  --
  -- ⚠️ COALESCE(proacl, acldefault(…)) is what makes a NULL acl explicit: a
  --    function whose privileges were never touched carries NULL proacl, whose
  --    MEANING is the default ACL — and the default ACL for a function grants
  --    EXECUTE to PUBLIC. Reading NULL as "no grantees" would report the widest
  --    possible state as the tightest (20260515205431:86-90).
  --
  -- ⚠️ Falsifiable on the pg-lane only because
  --    scripts/pg-lane/fixtures/07-fixture-supabase-default-privileges.sql:21-22
  --    grants the project-bootstrap defaults (`GRANT ALL ON FUNCTIONS TO anon,
  --    authenticated, service_role`) first; on a vanilla cluster the REVOKE
  --    above would be a no-op and this check would pass for a reason unrelated
  --    to the file.
  SELECT g.owner_name, string_agg(g.grantee_name, ',' ORDER BY g.grantee_name)
    INTO v_owner, v_grantees
    FROM (
      SELECT pg_get_userbyid(p.proowner) AS owner_name,
             CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END AS grantee_name
        FROM pg_proc p
        JOIN pg_namespace n ON n.oid = p.pronamespace
        CROSS JOIN LATERAL aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) a
       WHERE n.nspname = 'public'
         AND p.proname = 'match_engine_cron_tick'
         AND p.pronargs = 0
         AND a.privilege_type = 'EXECUTE'
    ) g
   GROUP BY g.owner_name;
  IF v_grantees IS NULL THEN
    RAISE EXCEPTION 'Migration 20260911120000: could not read the EXECUTE grantee set of public.match_engine_cron_tick — the function is missing, or it carries no EXECUTE aclitem at all, and an empty answer here is indistinguishable from a locked-down one unless it is refused';
  END IF;
  IF v_grantees IS DISTINCT FROM v_owner THEN
    RAISE EXCEPTION 'Migration 20260911120000: EXECUTE on public.match_engine_cron_tick is held by [%], expected exactly the owner [%]. service_role''s grant survived Phase 164.7 precisely because only anon and authenticated were probed; a SECURITY DEFINER function that posts the analytics service key must be callable by the scheduler alone, and the scheduler IS the owner', v_grantees, v_owner;
  END IF;

  RAISE NOTICE 'Migration 20260911120000: match_engine_cron_tick re-based — one cardinality-guarded Vault read, a whitespace-aware key guard, and EXECUTE held by the owner alone';
END $verify$;

COMMIT;
