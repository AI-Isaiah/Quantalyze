-- Migration: remove public.create_allocator_connected_strategy(11 args) from
-- PRODUCTION.
-- Phase 164.5 / plan 06 / criterion 3 (DRIFT-04). Founder decision 2026-08-29.
--
-- ⚠️ OPS: merging supabase/migrations/** to main AUTO-APPLIES to PROD. This file
-- removes a live, `authenticated`-reachable SECURITY DEFINER function on the
-- next merge, with no separate deploy step and no flag in front of it. It is a
-- ONE-WAY production DDL event on a credential surface. Nothing in this
-- repository applies it — a human merges the PR.
--
-- ══════════════════════════════════════════════════════════════════════════
-- WHY
-- ══════════════════════════════════════════════════════════════════════════
-- public.create_allocator_connected_strategy is SECURITY DEFINER, OWNER TO
-- postgres, SET search_path TO public,pg_catalog, and it writes encrypted
-- credential material into api_keys + strategies + portfolio_strategies. Its
-- own COMMENT cites "migration 043" — a legacy numbered file that is NOT in
-- this repository. No file under supabase/migrations/ defines it. It exists in
-- production and in the committed production dump
-- (supabase/schema/baseline.sql:2618) and nowhere else.
--
-- No exploit is claimed. The issue is GOVERNANCE: an `authenticated`-reachable
-- SECURITY DEFINER function that writes credential material, that no PR ever
-- reviewed, that no migration describes, and that any future hardening of the
-- wizard RPCs silently will not cover, because nobody reading this repository
-- would know it is there. The founder's 2026-08-29 verdict is to remove it
-- rather than adopt it into a migration.
--
-- ══════════════════════════════════════════════════════════════════════════
-- BLAST RADIUS — BOTH GRANTS DIE WITH IT, NOT ONE
-- ══════════════════════════════════════════════════════════════════════════
-- Removing a function loses its ACL entries with the object
-- (20260601120000:32; the same consequence is stated at
-- 20260819120000_csv_finalize_atomic_fold.sql:344-347). This function carries
-- TWO grants, both of which die here:
--
--   supabase/schema/baseline.sql:13755   GRANT ALL … TO "authenticated"
--   supabase/schema/baseline.sql:13756   GRANT ALL … TO "service_role"
--
-- ⚠️ TODOS `[DRIFT-04]` records only the FIRST. That record is incomplete; the
-- phase CONTEXT corrects it and this header is the corrected statement. A
-- reviewer reasoning from TODOS alone would have underestimated the surface by
-- one role.
--
-- ⚠️ CORRECTED 2026-09-07 (review). This paragraph previously ended "…and
-- `service_role` is the role the analytics worker and every server-side admin
-- path authenticate as, so it is not the smaller half." That SIZING claim
-- over-states, and it is replaced by what was measured:
--
--   1. `service_role` ALREADY holds `GRANT ALL ON TABLE` for all three tables
--      this function writes — `api_keys` (baseline.sql:14349), `strategies`
--      (:14549) and `portfolio_strategies` (:14712) — and it is BYPASSRLS. It
--      needs no function-level grant to reach any of them. The function grant is
--      therefore REDUNDANT for that role.
--   2. It is also INERT. The function's own first guard raises
--      `insufficient_privilege` when `auth.uid() IS NULL`, which is precisely
--      the session-less state a `service_role` call is in. A `service_role`
--      caller cannot complete this function at all.
--
-- Naming BOTH grantees stays correct and stays here — the TODOS record IS
-- incomplete and that correction is the point of this section. What changes is
-- the SIZE of the second half: `service_role`'s grant is redundant AND inert, so
-- losing it removes an ACL entry and no capability. The `authenticated` grant is
-- the one that carries the governance weight, and it is the reason for the
-- removal.
--
-- ══════════════════════════════════════════════════════════════════════════
-- REVERSIBILITY
-- ══════════════════════════════════════════════════════════════════════════
-- The VERBATIM body, its OWNER, its search_path, its COMMENT and BOTH grants
-- are committed in supabase/schema/baseline.sql (definition at :2618, ownership
-- at :2696, comment at :2699, grants at :13754-13756). A revert migration can
-- be cut from that file without reconstructing anything.
--
-- ⛔ That is REVERSIBILITY OF THE DEFINITION, and nothing more. It is not an
-- undo. This removal is a production DDL event: a git revert does not restore
-- the object, and anything that called the function between the apply and a
-- revert failed in the interval. That is why it sits behind a founder gate.
--
-- ══════════════════════════════════════════════════════════════════════════
-- WHY STEP 1 REFUSES THE TWO MODIFIERS IT COULD HAVE CARRIED
-- ══════════════════════════════════════════════════════════════════════════
-- Two optional modifiers are conventionally added to a removal like this one.
-- Both are refused here, deliberately, and NEITHER is spelled anywhere in this
-- file — in code or in comments — because this plan's verify command greps the
-- WHOLE file for them, so a comment naming one would make its own gate
-- self-invalidating.
--
--   THE EXISTENCE-TOLERANT MODIFIER — the one that makes a removal succeed when
--   the object is not there. Its failure mode is not "the object was already
--   gone". It is a SIGNATURE MISMATCH: aimed at 11 argument types production
--   does not hold, the statement matches nothing, succeeds, removes nothing —
--   and the verification block below then finds no surviving row for the
--   signature it looked up and reports success. The whole migration passes
--   having done nothing, and every downstream claim that the function is gone
--   is a verdict over an operation that never happened. Without the modifier
--   the same mismatch is an error that stops the apply and names the function.
--
--   THE DEPENDENT-REMOVING MODIFIER — the one that also removes whatever
--   depends on the object. Its failure mode is that it removes objects nobody
--   listed, silently, in a production transaction, on a credential surface.
--   Without it, a dependent aborts the apply and names itself.
--
-- Both modifiers convert a loud failure into a quiet wrong outcome. Refusing
-- them is only SAFE if the facts they would paper over have been measured
-- first, which is what scripts/preflight-drop-allocator-fn.sh exists to do: it
-- asserts the exact 11-type signature, compares the live body against
-- supabase/schema/baseline.sql, reads pg_depend for dependents, and probes
-- pg_extension for pg_stat_statements before reading any call count — aborting,
-- with its own exit code, when that extension is absent rather than reporting
-- an absent measurement as zero calls.
--
-- ══════════════════════════════════════════════════════════════════════════
-- ⛔ WHAT THIS FILE DOES NOT DO
-- ══════════════════════════════════════════════════════════════════════════
-- 1. It defines nothing, replaces nothing and re-issues no grant. It removes
--    exactly one object and then verifies that it is gone.
-- 2. It names no object in the Vault schema and none in pg_net's, and it
--    invokes no function of this project's own. (Those two schema qualifiers
--    are not spelled here for the same reason the two modifiers are not: this
--    file is grepped for them, and a comment carrying one would make the check
--    answer about its own prose.)
-- 3. It touches no row of any application table. No allocator-connected
--    strategy, api_keys row or portfolio_strategies row is affected; only the
--    ability to make new ones THROUGH THIS FUNCTION goes away. Rows written by
--    it in the past stay exactly as they are.
-- 4. ⚠️ IT IS NOT USABLE IN A SQL GATE'S APPLY LIST, and that is structural
--    rather than an oversight. The object it removes exists only in PROD and in
--    the committed dump; no migration defines it, so on a fresh cluster (the
--    pg-lane) there is nothing here to remove and this file errors. That
--    limitation IS DRIFT-04 restated — a migration cannot replay the removal of
--    something no migration ever added. It disappears when the baseline is next
--    regenerated from PROD, at which point the function is in neither side.
--
-- ══════════════════════════════════════════════════════════════════════════
-- WHAT THIS FILE DOES NOT CLEAR
-- ══════════════════════════════════════════════════════════════════════════
-- `NAME_SET_RATCHET` in scripts/dump-sql-functions.ts carries a `baseline-only`
-- row for this function. That row is NOT deleted here. Its own `clearedBy`
-- says so: it clears when supabase/schema/baseline.sql is regenerated from
-- PROD, a separate reviewed act that also moves the sha256 recorded in
-- supabase/schema/BASELINE.md. Deleting the row now would make the gate green
-- about a baseline that still names the function.

-- ══════════════════════════════════════════════════════════════════════════
-- TRANSACTION
-- ══════════════════════════════════════════════════════════════════════════
-- Convention: BEGIN/COMMIT with a session lock_timeout, matching the repo
-- majority and the two migrations immediately preceding this one
-- (20260907120000:156-157, 20260907130000:172-173) — project Rule 11.
--
-- ⛔ IT IS ALSO LOAD-BEARING HERE, not only conventional. STEP 2 RAISEs when the
-- function survives STEP 1. Without an explicit transaction around both, a
-- RAISE would leave a COMMITTED removal behind a FAILED migration — the object
-- gone, the ledger saying it never happened, and the two halves of this file
-- disagreeing about production. Wrapped, a RAISE rolls STEP 1 back and the
-- database is exactly as it was.
--
-- `lock_timeout = '5s'` is deliberate on a live, `authenticated`-reachable
-- function: removing it needs a lock that an in-flight call holds. Without the
-- timeout this statement would QUEUE behind that call and, while queued, block
-- every new call behind itself — turning a governance cleanup into an outage.
-- With it, a contended apply fails fast and is simply re-run.
BEGIN;
SET lock_timeout = '5s';

-- ==========================================================================
-- STEP 1 — remove the function at its EXACT signature, 11 argument types in
--          order, read from supabase/schema/baseline.sql:2618 without touching
--          production. Neither of the two modifiers discussed in the header.
-- ==========================================================================
DROP FUNCTION public.create_allocator_connected_strategy(
  uuid, uuid, text, text, text, text, text, text, text, text, integer
);

-- ==========================================================================
-- STEP 2 — self-verifying block, with the assertion INVERTED for a removal:
--          a SURVIVING row is the failure. (Idiom: 20260819120000 STEP 3 and
--          20260907120000's DO $verify$ block.)
--
-- ⛔ Every variable is DECLAREd up front. plpgsql compiles a DO block WHOLE: a
--    missing DECLARE does not weaken the one check that uses it — it raises
--    42601 and NONE of the checks run (measured on 20260825130000).
--
-- ⛔ RAISE EXCEPTION, never a NOTICE. A NOTICE-and-continue here would let the
--    migration report success over a function that is still live.
--
-- ── CAN THIS BLOCK ACTUALLY FAIL? Stated, because a check that cannot fail is
--    worse than no check at all. Three ways, all reachable:
--    (i)  a future edit adds the existence-tolerant modifier to STEP 1 while
--         the live signature has drifted. STEP 1 then no-ops silently and
--         check 1 RAISEs. This block is the tripwire on that edit.
--    (ii) an overload of a DIFFERENT arity exists that STEP 1 does not name.
--         STEP 1 succeeds, the name survives, and check 2 RAISEs with the
--         surviving argument counts. The pre-flight asserts exactly one
--         overload before the merge; check 2 covers the interval between that
--         measurement and this apply.
--    (iii) STEP 1 is ever reordered after something that redefines the name.
-- ==========================================================================
DO $verify$
DECLARE
  v_exact   INTEGER;
  v_any     INTEGER;
  v_arities TEXT := '';
  v_row     RECORD;
BEGIN
  -- 1. The 11-argument overload STEP 1 named is GONE. This is the inverted
  --    assertion: zero rows is the pass.
  SELECT count(*)
    INTO v_exact
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public'
     AND p.proname = 'create_allocator_connected_strategy'
     AND p.pronargs = 11;

  IF v_exact <> 0 THEN
    RAISE EXCEPTION 'Migration 20260908120000: public.create_allocator_connected_strategy still has % overload(s) at 11 arguments after STEP 1. STEP 1 either did not run or did not match — and a removal that matched nothing is the exact vacuous pass the existence-tolerant modifier produces, which is why STEP 1 refuses it', v_exact;
  END IF;

  -- 2. NOTHING of this name survives at ANY arity. Stronger than check 1 on
  --    purpose: DRIFT-04's verdict is that this name should not exist in
  --    production at all, and an overload STEP 1 did not name would stay
  --    reachable by every role that held the two grants. Aborting here is the
  --    loud outcome; the dependent-removing modifier's alternative is to take
  --    such objects out silently.
  SELECT count(*)
    INTO v_any
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public'
     AND p.proname = 'create_allocator_connected_strategy';

  IF v_any <> 0 THEN
    FOR v_row IN
      SELECT p.pronargs AS nargs
        FROM pg_proc p
        JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname = 'public'
         AND p.proname = 'create_allocator_connected_strategy'
       ORDER BY p.pronargs
    LOOP
      v_arities := v_arities || v_row.nargs::TEXT || ' ';
    END LOOP;

    RAISE EXCEPTION 'Migration 20260908120000: the 11-argument overload is gone but % overload(s) named create_allocator_connected_strategy survive in schema public, at argument counts: %. Disposition each one under review — they carry the same reachability the removed overload did', v_any, rtrim(v_arities);
  END IF;
END;
$verify$;

COMMIT;
