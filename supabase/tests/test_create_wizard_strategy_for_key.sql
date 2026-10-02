-- Recurring CI regression gate for the Phase 162 / D-162-3 use-existing-key
-- writer (migration 20260826130000_create_wizard_strategy_for_key.sql).
--
-- Why this file exists
-- --------------------
-- `create_wizard_strategy_for_key` is a NEW SECURITY DEFINER writer at the
-- tenant boundary. Its two load-bearing properties are:
--   (1) it is invokable only by `service_role`, and refuses any other JWT role
--       in-body as well — the Migration-B posture for wizard writers;
--   (2) it NEVER writes `api_keys`. Re-INSERTing there is what CREATED the
--       orphan population it exists to serve (T-162-05-B), so "reuse, never
--       re-INSERT" must hold structurally rather than by anyone remembering.
-- The migration's own `DO $verify$` block asserts both — ONCE, at apply time,
-- and never again. This file is the recurring half: it re-reads the LIVE ACL
-- and the LIVE body on every PR, so a later CREATE OR REPLACE that dropped the
-- gate, or a DROP + CREATE that let Supabase's `pg_default_acl` re-grant
-- `anon`/`authenticated`, fails here instead of on production.
--
-- ⛔⛔ THE ANTI-VACUITY MECHANISM — READ THIS BEFORE EDITING ANY TOKEN.
-- `pg_get_functiondef` RETURNS THE COMMENTS. The function's own body discusses
-- every token this file asserts — `auth.role()`, `p_user_id`, `api_keys` — in
-- prose, so a gate that grepped the RAW definition would be satisfied by the
-- COMMENTARY and would keep passing with the code deleted. That is the
-- prose-satisfied-anchor trap, and it is the reason for two things here:
--   · every body assertion runs against `v_bare`, the definition with `--`
--     comments stripped, never against `v_def`; and
--   · arm D asserts that a token which exists ONLY inside those comments —
--     CANARY_162_05_PROSE_ONLY — is GONE from `v_bare`. Delete the stripper and
--     arm D reds. Delete the canary from the function and arm D reds. Neither
--     can rot silently, and neither is a claim about the stripper: it is a
--     measurement of it, taken against the live database on every run.
-- Arm H is the same idea pointed the other way: it runs G's NEGATIVE regex
-- against `create_wizard_strategy`, a function that genuinely DOES contain
-- `INSERT INTO api_keys`, and REQUIRES a hit. Without it, "no api_keys INSERT
-- here" would also be satisfied by a regex that matches nothing anywhere.
--
-- ⛔ AN UNDEPLOYED GATE IS A HARD FAILURE, NEVER A SKIP.
-- ----------------------------------------------------------------------
-- This file does NOT open with a state-adaptive notice-and-RETURN on the
-- function-absent state, and that is deliberate rather than an omission.
-- (⚠️ The skip label is described here rather than quoted: CI extracts whole-file
-- skip markers by grepping THIS FILE for that literal notice prefix, so writing
-- one out even inside a comment hands the scanner a marker to hunt for.)
-- The plan that commissioned it asked for the Phase-156 state-adaptive shape;
-- that posture was REVERSED at HEAD on 2026-08-25 by F8
-- (`test_get_verified_cohort_rank_gate.sql`) and WR-03
-- (`test_ledger_refresh_*.sql`), for reasons that were MEASURED, not argued:
--   * a whole-file skip exits 0, and the CI step reads psql's exit code — so a
--     run that proved nothing was byte-identical to one that proved everything;
--   * nothing applies migrations to the TEST project (the `sql-tests` job has
--     no apply step and `supabase-migrate.yml` targets PRODUCTION only), so a
--     skip can never re-arm itself on a later run;
--   * `.github/workflows/ci.yml` now FAILS any file that prints a whole-file
--     `SKIP:` notice, naming those three files as the shape to copy.
-- Following the plan here would have shipped a gate that CI is built to reject.
-- Recorded as a deviation in 162-05-SUMMARY.md rather than taken silently.
--
-- ⚠️ EXPECT ARM A TO FAIL EXACTLY ONCE — on the PR that introduces migration
-- 20260826130000, before that migration has been applied to the TEST project.
-- Apply the phase's migrations to TEST and re-run. That is the same one-time
-- cost F8 records for its own gate, and it is the price of never being able to
-- report a green run that asserted nothing.
--
-- Run order: AFTER 20260826130000 has been applied.
--
-- ⭐ MACHINE-EXECUTABLE TWINS (phase 164.4, VAC-01). Each prose RED-UNDER below
-- carries an adjacent `RED-UNDER-M` object that scripts/mutation-runner executes
-- on every push: it mutates COPIES, requires the FIRST `TEST FAILED (…)` to name
-- that arm, and restores GREEN. The schema is scripts/mutation-runner/GRAMMAR.md.
-- The line below declares what the lane applies before this gate. It was
-- DISCOVERED, not guessed — plan 164.4-05 iterated it over 7 lane runs (two of
-- which explored, and abandoned, a 20260814120000 branch) to `ALL 9 ARMS
-- EXECUTED`, mean 0.95 s/lane over 3 timed GREEN runs.
-- ⚠️ 20260602190000 — NOT 20260814120000 — supplies arm H's positive control
--    `create_wizard_strategy`. It is not that function's LAST definer, and that
--    is deliberate: no twin here MUTATES create_wizard_strategy (arm H's twin is
--    a `sql` DROP), so the CREATE-OR-REPLACE re-base rule does not bind, while
--    20260814120000 drags in 20260811210000, whose census/ACL post-verify cannot
--    pass on a cluster where these RPCs are created for the FIRST time.
-- ⚠️ EVERY twin below is a `sql` step or a gate-file edit, never a migration edit:
--    this migration's own post-verify (a)-(h) asserts nearly everything the gate
--    asserts, so a migration edit ABORTS THE APPLY and the gate never runs. That
--    is also the point of the gate — it re-reads the LIVE ACL and the LIVE body,
--    catching drift the migration verified once at apply time and never again.
-- RED-UNDER-SETUP: {"apply":["scripts/pg-lane/fixtures/01-fixture-core.sql","scripts/pg-lane/fixtures/02-fixture-sanitize-tables.sql","scripts/pg-lane/fixtures/03-fixture-compute-jobs.sql","scripts/pg-lane/fixtures/05-fixture-wizard-composite.sql","scripts/pg-lane/fixtures/09-fixture-migration-ledger.sql","supabase/migrations/20260602190000_f6_wizard_session_idempotency.sql","supabase/migrations/20260826130000_create_wizard_strategy_for_key.sql"]}

BEGIN;

-- The whole file runs under a forged `service_role` claim, exactly as
-- test_log_audit_event_service_ceiling.sql does and for the same reason:
-- connecting as `postgres` carries no JWT, so `auth.role()` returns NULL and
-- every in-body gate refuses — masking the assertions underneath.
-- ⚠️ Arm I DELIBERATELY overrides this to 'authenticated' and puts it back.
SELECT set_config('request.jwt.claims', '{"role":"service_role"}', true);

DO $gate$
DECLARE
  v_migration  TEXT := '20260826130000';
  v_fn         TEXT := 'create_wizard_strategy_for_key';
  v_oid        OID;
  v_twin_oid   OID;
  v_applied    BOOLEAN;
  v_def        TEXT;
  v_bare       TEXT;
  v_twin_bare  TEXT;
  v_secdef     BOOLEAN;
  v_config     TEXT[];
  v_sqlstate   TEXT;
BEGIN
  -- ══ (A) APPLIED-NESS. ABSENCE IS A FAILURE, NOT A SKIP ══════════════════
  -- RED-UNDER: DROP the function on the live lane database — cause (ii) the arm
  --            names, a later migration dropping the writer after it applied.
  -- ⚠️ A `sql` step: the ledger and the ACL are read from the LIVE database, so
  --    there is nothing in the migration text to edit that would reach this arm.
  -- RED-UNDER-M: {"arm":"A","apply":[{"kind":"sql","stmt":"DROP FUNCTION public.create_wizard_strategy_for_key(uuid, uuid, text, uuid)"}]}
  SELECT p.oid INTO v_oid
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = v_fn;

  IF to_regclass('supabase_migrations.schema_migrations') IS NULL THEN
    RAISE EXCEPTION 'TEST FAILED (A): supabase_migrations.schema_migrations does not exist, so this file cannot tell a database that never received migration % from one whose function was dropped after it applied. That ledger is this arm''s applied-ness oracle and is what lets the failure below name a cause. Run this file against the Supabase-managed TEST project (TEST_SUPABASE_DB_URL), never a bare Postgres.', v_migration;
  END IF;

  v_applied := EXISTS (
    SELECT 1 FROM supabase_migrations.schema_migrations WHERE version = v_migration
  );

  IF v_oid IS NULL THEN
    RAISE EXCEPTION 'TEST FAILED (A): public.% is ABSENT (migration % ledger row present: %). Arms B-I are all about that function, so NONE of them could be evaluated — this run proves nothing about the use-existing-key writer. THIS IS A FAILURE, NOT A SKIP. Two causes fit and this arm cannot distinguish them, so check both: (i) the TEST project has not received migration % — apply the phase''s migrations to it and re-run; expect this exactly ONCE, on the PR that introduces the migration, because NO workflow applies migrations to TEST; (ii) a later migration DROPped the function, which is a live regression — the route''s reuse arm then answers a 500 on every orphan. ⛔ Do NOT "fix" this by restoring a RAISE NOTICE/RETURN skip: it exits 0 having asserted nothing, and CI fails any file that prints one.', v_fn, v_migration, v_applied, v_migration;
  END IF;

  -- ══ FROM HERE THE FILE IS ARMED ═════════════════════════════════════════

  SELECT p.prosecdef, p.proconfig INTO v_secdef, v_config
    FROM pg_proc p WHERE p.oid = v_oid;

  -- ══ (B) SECURITY DEFINER, WITH A PINNED search_path ═════════════════════
  -- RED-UNDER: flip the deployed function to SECURITY INVOKER on the live lane
  --            database.
  -- ⚠️ A `sql` step: the migration's own post-verify asserts prosecdef, so editing
  --    the migration aborts the apply and the gate never runs.
  -- RED-UNDER-M: {"arm":"B","apply":[{"kind":"sql","stmt":"ALTER FUNCTION public.create_wizard_strategy_for_key(uuid, uuid, text, uuid) SECURITY INVOKER"}]}
  IF NOT v_secdef THEN
    RAISE EXCEPTION 'TEST FAILED (B): public.% is no longer SECURITY DEFINER. It would then run as the CALLER, so the strategies INSERT would be governed by that caller''s RLS instead of by the in-body ownership assertion — and service_role, the only role holding EXECUTE, bypasses RLS anyway, so the ownership check would be the only control left and the failure would be silent.', v_fn;
  END IF;
  IF v_config IS NULL OR NOT (v_config @> ARRAY['search_path=public, pg_catalog']) THEN
    RAISE EXCEPTION 'TEST FAILED (B): public.% lost its pinned search_path (proconfig=%). A SECURITY DEFINER function without one is a search-path hijack surface — the caller controls name resolution inside a body that runs as the owner (PostgreSQL core advisory; Cybertec, "Abusing SECURITY DEFINER functions").', v_fn, v_config;
  END IF;

  -- ══ (C) THE EXECUTE SURFACE ═════════════════════════════════════════════
  -- ⚠️ READ FROM THE LIVE ACL, never from a marker comment. Supabase's
  -- pg_default_acl for `public` functions created by `postgres` grants EXECUTE
  -- to anon AND authenticated automatically, so ANY future DROP + CREATE
  -- silently re-grants both with nothing in the diff to read (it bit
  -- 20260812083206 for anon). This arm is the durable enforcement; the REVOKE
  -- in the migration is not self-enforcing.
  -- RED-UNDER: re-GRANT EXECUTE to `authenticated` on the live lane database —
  --            exactly the pg_default_acl re-grant the comment above describes,
  --            which leaves nothing in any diff to read.
  -- RED-UNDER-M: {"arm":"C","apply":[{"kind":"sql","stmt":"GRANT EXECUTE ON FUNCTION public.create_wizard_strategy_for_key(uuid, uuid, text, uuid) TO authenticated"}]}
  IF has_function_privilege('authenticated', v_oid, 'EXECUTE') THEN
    RAISE EXCEPTION 'TEST FAILED (C): `authenticated` holds EXECUTE on public.%. PostgREST exposes every public-schema function at /rest/v1/rpc/<name>, so a browser session could POST this writer directly — bypassing the route''s ownership re-selects, its orphan verification and its refusal copy. A later migration DROPped and re-CREATEd this function without re-issuing the REVOKE (see the migration header, ⛔ (v)).', v_fn;
  END IF;
  IF has_function_privilege('anon', v_oid, 'EXECUTE') THEN
    RAISE EXCEPTION 'TEST FAILED (C): `anon` holds EXECUTE on public.% — an UNAUTHENTICATED caller can reach a tenant-boundary writer.', v_fn;
  END IF;
  IF NOT has_function_privilege('service_role', v_oid, 'EXECUTE') THEN
    RAISE EXCEPTION 'TEST FAILED (C): `service_role` does NOT hold EXECUTE on public.%. The only sanctioned caller cannot call it, so the route''s reuse arm answers 42501 → a 403 on every orphan. ⚠️ This is the arm that catches a REVOKE that went one role too far.', v_fn;
  END IF;

  v_def := pg_get_functiondef(v_oid);
  -- ⛔ EVERY BODY ASSERTION BELOW READS v_bare, NEVER v_def. See the header.
  v_bare := regexp_replace(v_def, '--[^\n]*', '', 'g');

  -- ══ (D) THE COMMENT STRIPPER ACTUALLY RAN ═══════════════════════════════
  -- The canary lives in a comment inside the function and NOWHERE else in it.
  -- If it survives stripping, the stripper is broken or gone, and arms E, F and
  -- G below are all satisfiable by prose — which is precisely how a
  -- prose-satisfied anchor ships. This arm is what makes them measurements.
  -- RED-UNDER: delete the comment stripper in THIS file — `v_bare := v_def` — so
  --            the prose-only canary survives into v_bare.
  -- ⚠️ The only twin in this batch that edits a GATE file, and it is the only place
  --    the stripper exists: it is this file's own mechanism, not the migration's.
  --    No failure branch is touched (rule 3b), only the assignment above.
  -- RED-UNDER-M: {"arm":"D","apply":[{"kind":"edit","file":"supabase/tests/test_create_wizard_strategy_for_key.sql","find":"  v_bare := regexp_replace(v_def, '--[^\\n]*', '', 'g');","replace":"  v_bare := v_def;","occurrences":1}]}
  IF position('CANARY_162_05_PROSE_ONLY' IN v_bare) = 0
     AND position('CANARY_162_05_PROSE_ONLY' IN v_def) = 0 THEN
    RAISE EXCEPTION 'TEST FAILED (D): the prose-only canary CANARY_162_05_PROSE_ONLY is absent from the RAW definition of public.% too, so this arm cannot tell "the stripper worked" from "there was nothing to strip". Restore the canary comment in the function body (migration 20260826130000, header ⛔ (vii)) — without it, arms E, F and G lose the only evidence that they are reading CODE rather than COMMENTARY.', v_fn;
  END IF;
  IF position('CANARY_162_05_PROSE_ONLY' IN v_bare) > 0 THEN
    RAISE EXCEPTION 'TEST FAILED (D): the comment stripper did not strip — the prose-only canary survived into v_bare. pg_get_functiondef returns comments, and this function''s comments discuss every token arms E-G assert, so those three arms are now satisfiable by COMMENTARY with the code deleted. Fix the regexp_replace above; do NOT weaken E-G to compensate.';
  END IF;

  -- ══ (E) THE IN-BODY ROLE GATE ═══════════════════════════════════════════
  -- ⚠️ NOT MERELY DEFENCE IN DEPTH FOR A FUTURE RE-GRANT — an ACTIVE control
  -- today. `auth.role()` reads request.jwt.claims, which is ORTHOGONAL to which
  -- database role holds EXECUTE: callers holding EXECUTE by OWNERSHIP
  -- (`postgres`, `supabase_admin`, migration sessions, this psql harness) sail
  -- straight past arm C's REVOKE and land here. Arm I proves it fires.
  -- RED-UNDER: CREATE OR REPLACE the deployed function with a stub that keeps the
  --            canary comment and the ownership predicate but has NO auth.role()
  --            call — the in-body role gate deleted, nothing else.
  -- ⚠️ A `sql` step, and it must keep arms A-D green or one of them fires first:
  --    the stub stays SECURITY DEFINER with the pinned search_path (B), REPLACE
  --    preserves the ACL (C), and the canary stays in a `--` comment (D).
  -- RED-UNDER-M: {"arm":"E","apply":[{"kind":"sql","stmt":"CREATE OR REPLACE FUNCTION public.create_wizard_strategy_for_key(\n  p_user_id UUID,\n  p_api_key_id UUID,\n  p_placeholder_name TEXT,\n  p_wizard_session_id UUID\n)\nRETURNS TABLE(strategy_id UUID, api_key_id UUID)\nLANGUAGE plpgsql\nSECURITY DEFINER\nSET search_path = public, pg_catalog\nAS $stub$\nDECLARE\n  v_jwt_role TEXT;\n  v_exchange TEXT;\nBEGIN\n  -- CANARY_162_05_PROSE_ONLY \u2014 kept so arm D still proves the stripper ran.\n  SELECT k.exchange INTO v_exchange FROM api_keys k\n   WHERE k.id = p_api_key_id\n     AND k.user_id = p_user_id\n     AND k.disconnected_at IS NULL;\n  RETURN;\nEND\n$stub$"}]}
  IF v_bare NOT LIKE '%auth.role()%' THEN
    RAISE EXCEPTION 'TEST FAILED (E): the body of public.% contains no auth.role() call once comments are stripped. The in-body role gate is gone, so any caller holding EXECUTE by ownership rather than by grant now writes wizard drafts unchallenged. ⛔ Never "restore" this with current_user or session_user: inside a SECURITY DEFINER body current_user is the OWNER, so a gate written on it ALWAYS PASSES — the bug that made prevent_profile_role_change a no-op.', v_fn;
  END IF;
  IF v_bare !~ 'insufficient_privilege' THEN
    RAISE EXCEPTION 'TEST FAILED (E): the body of public.% no longer RAISES with ERRCODE insufficient_privilege. Reading auth.role() and not refusing on it is a gate that observes and permits.', v_fn;
  END IF;

  -- ══ (F) THE IN-BODY OWNERSHIP ASSERTION ═════════════════════════════════
  -- The third layer of the T-162-05-A mitigation. The other two live in the
  -- route (the session-uid filter on the RLS-bypassing admin re-select, and the
  -- user-scoped RLS re-read) and are pinned by route.test.ts; this one is the
  -- only layer a route rewrite cannot remove.
  -- RED-UNDER: CREATE OR REPLACE the deployed function with a stub carrying the
  --            role gate but NOT the `k.user_id = p_user_id` ownership join — the
  --            T-162-05-A cross-tenant-reuse regression, in isolation.
  -- RED-UNDER-M: {"arm":"F","apply":[{"kind":"sql","stmt":"CREATE OR REPLACE FUNCTION public.create_wizard_strategy_for_key(\n  p_user_id UUID,\n  p_api_key_id UUID,\n  p_placeholder_name TEXT,\n  p_wizard_session_id UUID\n)\nRETURNS TABLE(strategy_id UUID, api_key_id UUID)\nLANGUAGE plpgsql\nSECURITY DEFINER\nSET search_path = public, pg_catalog\nAS $stub$\nDECLARE\n  v_jwt_role TEXT;\n  v_exchange TEXT;\nBEGIN\n  -- CANARY_162_05_PROSE_ONLY \u2014 kept so arm D still proves the stripper ran.\n  v_jwt_role := auth.role();\n  IF v_jwt_role IS DISTINCT FROM 'service_role' THEN\n    RAISE EXCEPTION 'stub: caller role (%) may not write wizard drafts', COALESCE(v_jwt_role, '<none>')\n      USING ERRCODE = 'insufficient_privilege';\n  END IF;\n  RETURN;\nEND\n$stub$"}]}
  IF v_bare !~* 'k\.user_id\s*=\s*p_user_id' THEN
    RAISE EXCEPTION 'TEST FAILED (F): the body of public.% no longer joins api_keys.user_id to p_user_id. The function will then mint a draft over ANY key id it is handed, which is cross-tenant reuse (T-162-05-A, high) — the one threat this writer was created with. ⚠️ A reformat produces this failure too (a renamed alias, added whitespace); if the deployed predicate is correct and merely re-spelled, re-cut this regex IN THE SAME COMMIT rather than deleting the arm.', v_fn;
  END IF;
  IF v_bare !~* 'k\.disconnected_at\s+IS\s+NULL' THEN
    RAISE EXCEPTION 'TEST FAILED (F): the body of public.% no longer requires api_keys.disconnected_at IS NULL. api_keys rows are RETAINED on disconnect (20260422101911) and every cron dispatcher deliberately SKIPS a soft-disconnected key, so a draft minted over one is a strategy that silently never syncs.', v_fn;
  END IF;

  -- ══ (G) NO api_keys INSERT — THE STRUCTURAL PROPERTY ════════════════════
  -- RED-UNDER: CREATE OR REPLACE the deployed function with a stub that keeps the
  --            role gate AND the ownership join (so E and F stay green) and adds
  --            an `INSERT INTO api_keys` — the one thing this writer may never do.
  -- ⚠️ The INSERT sits under `IF FALSE`: arm G is a STRUCTURAL claim over the body
  --    text, so reachability is beside the point and an unreachable one keeps the
  --    stub callable for the arms that follow.
  -- RED-UNDER-M: {"arm":"G","apply":[{"kind":"sql","stmt":"CREATE OR REPLACE FUNCTION public.create_wizard_strategy_for_key(\n  p_user_id UUID,\n  p_api_key_id UUID,\n  p_placeholder_name TEXT,\n  p_wizard_session_id UUID\n)\nRETURNS TABLE(strategy_id UUID, api_key_id UUID)\nLANGUAGE plpgsql\nSECURITY DEFINER\nSET search_path = public, pg_catalog\nAS $stub$\nDECLARE\n  v_jwt_role TEXT;\n  v_exchange TEXT;\nBEGIN\n  -- CANARY_162_05_PROSE_ONLY \u2014 kept so arm D still proves the stripper ran.\n  v_jwt_role := auth.role();\n  IF v_jwt_role IS DISTINCT FROM 'service_role' THEN\n    RAISE EXCEPTION 'stub: caller role (%) may not write wizard drafts', COALESCE(v_jwt_role, '<none>')\n      USING ERRCODE = 'insufficient_privilege';\n  END IF;\n  SELECT k.exchange INTO v_exchange FROM api_keys k\n   WHERE k.id = p_api_key_id\n     AND k.user_id = p_user_id\n     AND k.disconnected_at IS NULL;\n  IF FALSE THEN\n    INSERT INTO api_keys (user_id) VALUES (p_user_id);\n  END IF;\n  RETURN;\nEND\n$stub$"}]}
  IF v_bare ~* 'insert\s+into\s+(public\.)?api_keys' THEN
    RAISE EXCEPTION 'TEST FAILED (G): the body of public.% INSERTs into api_keys. That is the ONE thing this function may never do. An orphaned api_keys row with no strategy behind it is what the reuse path exists to RESOLVE; minting a second encrypted row for credentials we already hold reproduces that state and trips the venue-identity partial UNIQUE all over again (T-162-05-B). ⛔ If a reuse flow genuinely needs to write api_keys, that is a new decision and a new function — not an arm to relax here.', v_fn;
  END IF;

  -- ══ (H) POSITIVE CONTROL FOR G'S REGEX ══════════════════════════════════
  -- A negative assertion is satisfied by a regex that matches NOTHING, anywhere.
  -- So run the SAME pattern against the twin, which genuinely does INSERT INTO
  -- api_keys, and require a hit. This is what makes G a measurement rather than
  -- a spelling.
  -- RED-UNDER: DROP the twin `create_wizard_strategy` on the live lane database,
  --            removing the positive control arm G's negative regex stands on.
  -- RED-UNDER-M: {"arm":"H","apply":[{"kind":"sql","stmt":"DROP FUNCTION public.create_wizard_strategy(uuid,text,text,text,text,text,text,text,integer,text,uuid)"}]}
  SELECT p.oid INTO v_twin_oid
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'create_wizard_strategy';
  IF v_twin_oid IS NULL THEN
    RAISE EXCEPTION 'TEST FAILED (H): public.create_wizard_strategy is absent, so arm G''s negative regex has no positive control and G is satisfiable by a pattern that matches nothing anywhere. That function is the live wizard writer — its absence is a far larger regression than anything else this file checks.';
  END IF;
  v_twin_bare := regexp_replace(pg_get_functiondef(v_twin_oid), '--[^\n]*', '', 'g');
  IF v_twin_bare !~* 'insert\s+into\s+(public\.)?api_keys' THEN
    RAISE EXCEPTION 'TEST FAILED (H): arm G''s regex does NOT match public.create_wizard_strategy, which is known to INSERT INTO api_keys. The pattern is therefore broken or over-anchored, and arm G above has been passing for the wrong reason — it would keep passing with an api_keys INSERT added to the new function. Re-cut the pattern until this control hits, then re-check G.';
  END IF;

  -- ══ (I) BEHAVIOURAL: A NON-service_role CALLER IS REFUSED ═══════════════
  -- Arms C and E read the ACL and the text; this one CALLS. The uuids are
  -- random and match no row, so if the role gate were deleted the call would
  -- fall through to the ownership assertion and raise no_data_found (P0002)
  -- instead — which this arm rejects by asserting the SQLSTATE, not merely that
  -- "something raised".
  -- RED-UNDER: CREATE OR REPLACE the deployed function with a stub that CONTAINS
  --            every token arms D-G read — the canary, `auth.role()`,
  --            `insufficient_privilege`, the ownership join — but never acts on
  --            the role it read (`IF FALSE THEN RAISE …`).
  -- ⚠️ This is the whole reason arm I exists, expressed as a mutation: a body that
  --    OBSERVES AND PERMITS satisfies every text arm above and is refused only by
  --    a caller that actually invokes it. All eight preceding arms stay green.
  -- RED-UNDER-M: {"arm":"I","apply":[{"kind":"sql","stmt":"CREATE OR REPLACE FUNCTION public.create_wizard_strategy_for_key(\n  p_user_id UUID,\n  p_api_key_id UUID,\n  p_placeholder_name TEXT,\n  p_wizard_session_id UUID\n)\nRETURNS TABLE(strategy_id UUID, api_key_id UUID)\nLANGUAGE plpgsql\nSECURITY DEFINER\nSET search_path = public, pg_catalog\nAS $stub$\nDECLARE\n  v_jwt_role TEXT;\n  v_exchange TEXT;\nBEGIN\n  -- CANARY_162_05_PROSE_ONLY \u2014 kept so arm D still proves the stripper ran.\n  v_jwt_role := auth.role();\n  IF FALSE THEN\n    RAISE EXCEPTION 'stub observes the role and permits anyway'\n      USING ERRCODE = 'insufficient_privilege';\n  END IF;\n  SELECT k.exchange INTO v_exchange FROM api_keys k\n   WHERE k.id = p_api_key_id\n     AND k.user_id = p_user_id\n     AND k.disconnected_at IS NULL;\n  RETURN;\nEND\n$stub$"}]}
  PERFORM set_config('request.jwt.claims', '{"role":"authenticated"}', true);
  BEGIN
    PERFORM * FROM public.create_wizard_strategy_for_key(
      gen_random_uuid(), gen_random_uuid(), 'gate probe', gen_random_uuid()
    );
    PERFORM set_config('request.jwt.claims', '{"role":"service_role"}', true);
    RAISE EXCEPTION 'TEST FAILED (I): public.% accepted a call made under an `authenticated` JWT claim. The in-body role gate did not fire. Note this harness connects as an OWNER role, which holds EXECUTE by ownership and sails past arm C''s REVOKE — so the in-body gate is the only thing that refuses this caller, and it did not.', v_fn;
  EXCEPTION WHEN OTHERS THEN
    v_sqlstate := SQLSTATE;
    PERFORM set_config('request.jwt.claims', '{"role":"service_role"}', true);
    IF v_sqlstate = 'P0001' THEN
      -- Our own "TEST FAILED (I)" raise above, re-caught by this handler.
      RAISE;
    END IF;
    IF v_sqlstate <> '42501' THEN
      RAISE EXCEPTION 'TEST FAILED (I): the `authenticated` call to public.% raised SQLSTATE % instead of 42501 (insufficient_privilege). The call was refused, but NOT by the role gate — most likely it reached the ownership assertion (P0002) because the gate was deleted, which would mean any owner-role caller with a real key id writes drafts unchallenged.', v_fn, v_sqlstate;
    END IF;
  END;

  RAISE NOTICE 'ALL 9 ARMS EXECUTED (A, B, C, D, E, F, G, H, I) and passed — % is deployed, SECURITY DEFINER with a pinned search_path, EXECUTE-revoked from anon and authenticated and granted to service_role, its comment-stripped body carries the role gate and the api_keys.user_id = p_user_id ownership predicate, contains NO api_keys INSERT (proven by a positive control against the twin), and refuses an authenticated caller with 42501.', v_fn;
END
$gate$;

COMMIT;
