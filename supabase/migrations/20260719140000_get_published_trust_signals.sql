-- Migration 135: get_published_trust_signals — correct-by-construction public
-- trust-signal primitive for published strategies.
-- Phase 126 / FACTSHEET-01 hardening (plan 126-04).
--
-- Why this migration exists
-- -------------------------
-- Phase 126-01 (founder decision "Option B") exposed the PUBLIC verification
-- signal (trust_tier + status) for the api_verified badge via an APP-LAYER
-- service-role projection (`readPublicVerificationSignals` reading
-- `strategy_verifications` through `createAdminClient()`). That works, but the
-- trust boundary lives in TypeScript: every reader must remember to select only
-- trust_tier+status, gate to published, and never widen the projection. Three
-- separate readers already re-implemented (or forgot) that contract — the two
-- allocations-subsystem members (`/api/strategies/[id]/returns` and
-- `allocations/lib/watchlist-read.ts`) still read the table via RLS-scoped
-- embeds that return ZERO rows for non-owner viewers, so a logged-in allocator
-- saw LESS trust signal than an anon visitor.
--
-- This migration replaces the app-layer trust with a DB primitive that is
-- correct BY CONSTRUCTION:
--   * The RETURNS TABLE signature is the column allow-list — only
--     (strategy_id, trust_tier, status) can ever leave the function. Verification
--     internals (wizard_session_id, flow_type, source, metrics_snapshot, errors,
--     correlation_id) are structurally unreachable.
--   * The WHERE `s.status = 'published'` predicate is the published-gate — an
--     unpublished strategy's signal is never returned to anyone, ever.
--   * SECURITY DEFINER + a hardened, PINNED search_path lets anon read the
--     signal WITHOUT any RLS widening on strategy_verifications (the table stays
--     owner-locked — see migration 093 STEP 3).
--
-- What this migration does
-- ------------------------
-- 1. CREATE OR REPLACE FUNCTION public.get_published_trust_signals(uuid[])
--    — LANGUAGE sql, SECURITY DEFINER, SET search_path = public, pg_temp
--    (H-B hardening — blocks the pg_temp/pg_catalog function-planting
--    privilege-escalation pattern), STABLE. DISTINCT ON (strategy_id) picks the
--    MOST-RECENT verification row per strategy (ORDER BY strategy_id,
--    created_at DESC) joined to `strategies` gated to status='published'.
-- 2. REVOKE ALL FROM PUBLIC; GRANT EXECUTE TO anon, authenticated, service_role
--    (least privilege — explicit grantees, no blanket PUBLIC).
-- 3. Self-verifying DO block: structural asserts (exists, SECURITY DEFINER,
--    pinned search_path, anon EXECUTE) + a behavioral published-gate proof
--    (seed a published + a non-published strategy in a rolled-back savepoint,
--    assert the published one's signal is returned and the non-published one's
--    is NOT).
--
-- What this migration does NOT do
-- -------------------------------
-- - Does NOT add any RLS policy to strategy_verifications and does NOT alter its
--   grants. The table stays owner-locked (migration 093 3-tier RLS). This
--   function is the ONLY public exposure, column-scoped by its signature.
-- - Does NOT denormalize trust_tier onto strategies (locked decision D-04).
--
-- Application path
-- ----------------
-- Authored here; applied to the linked Supabase TEST project
-- (qmnijlgmdhviwzwfyzlc) by the orchestrator AFTER the security audit
-- (rls-policy-auditor + migration-reviewer). NOT MCP-applied by the executor;
-- production is a separate /ship-time gate. The tail DO block raises EXCEPTION
-- on any invariant failure — if push returns non-zero, read the error and fix
-- the migration; do NOT skip past a failed self-verify.

BEGIN;

SET lock_timeout = '3s';

-- ==========================================================================
-- STEP 1: get_published_trust_signals — the public trust-signal primitive
-- ==========================================================================
-- Column-scoped by RETURNS TABLE: the ONLY columns that can leave the function
-- are (strategy_id, trust_tier, status). All source columns are alias-qualified
-- (sv. / s.) so the OUT-parameter names never shadow a source column.
CREATE OR REPLACE FUNCTION public.get_published_trust_signals(p_strategy_ids uuid[])
RETURNS TABLE (strategy_id uuid, trust_tier text, status text)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
STABLE
AS $$
  SELECT DISTINCT ON (sv.strategy_id)
         sv.strategy_id,
         sv.trust_tier,
         sv.status
    FROM public.strategy_verifications sv
    JOIN public.strategies s ON s.id = sv.strategy_id
   WHERE s.status = 'published'
     AND sv.strategy_id = ANY(p_strategy_ids)
   ORDER BY sv.strategy_id, sv.created_at DESC;
$$;

COMMENT ON FUNCTION public.get_published_trust_signals(uuid[]) IS
  'Phase 126 / FACTSHEET-01 (mig 135): the PUBLIC verification signal (trust_tier + status) for PUBLISHED strategies, keyed by strategy_id (most-recent verification per strategy). Correct-by-construction public exposure: SECURITY DEFINER + pinned search_path lets anon read WITHOUT widening strategy_verifications RLS (that table stays owner-locked, mig 093). RETURNS TABLE is the column allow-list — verification internals (wizard_session_id/flow_type/source/…) are structurally unreachable. WHERE strategies.status=''published'' is the published-gate. Sole reader in app code: readPublicVerificationSignals (src/lib/queries.ts).';

-- ==========================================================================
-- STEP 2: REVOKE / GRANT EXECUTE (least privilege, explicit grantees)
-- ==========================================================================
REVOKE ALL ON FUNCTION public.get_published_trust_signals(uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_published_trust_signals(uuid[]) TO anon, authenticated, service_role;

-- ==========================================================================
-- STEP 3: self-verifying DO block — structural + behavioral published-gate
-- ==========================================================================
-- Structural: function exists, is SECURITY DEFINER, search_path pinned, anon
-- can EXECUTE. Behavioral: seed one published + one non-published strategy in a
-- savepoint that is ALWAYS rolled back (sentinel SQLSTATE ZZ135), capturing the
-- signal counts into outer-scoped variables that survive the rollback; then
-- assert OUTSIDE the sub-block. The seed leaves ZERO residue.
DO $$
DECLARE
  v_secdef             BOOLEAN;
  v_has_pinned_path    BOOLEAN;
  v_anon_can_exec      BOOLEAN;
  v_fn_oid             OID;
  v_user_id            UUID;
  v_pub_id             UUID := gen_random_uuid();
  v_priv_id            UUID := gen_random_uuid();
  v_pub_signal_count   INT;
  v_priv_signal_count  INT;
BEGIN
  -- (a) function registered
  SELECT oid INTO v_fn_oid
    FROM pg_proc
    WHERE proname = 'get_published_trust_signals'
      AND pronamespace = 'public'::regnamespace;
  IF v_fn_oid IS NULL THEN
    RAISE EXCEPTION 'Migration 135: get_published_trust_signals function missing';
  END IF;

  -- (b) SECURITY DEFINER
  SELECT prosecdef INTO v_secdef FROM pg_proc WHERE oid = v_fn_oid;
  IF NOT COALESCE(v_secdef, false) THEN
    RAISE EXCEPTION 'Migration 135: get_published_trust_signals is NOT SECURITY DEFINER';
  END IF;

  -- (c) H-B: pinned search_path = public, pg_temp
  SELECT 'search_path=public, pg_temp' = ANY(proconfig) INTO v_has_pinned_path
    FROM pg_proc WHERE oid = v_fn_oid;
  IF NOT COALESCE(v_has_pinned_path, false) THEN
    RAISE EXCEPTION 'Migration 135: get_published_trust_signals missing SET search_path = public, pg_temp (H-B hardening)';
  END IF;

  -- (d) anon has EXECUTE (public readability of the PUBLIC signal)
  v_anon_can_exec := has_function_privilege('anon', v_fn_oid, 'EXECUTE');
  IF NOT v_anon_can_exec THEN
    RAISE EXCEPTION 'Migration 135: anon lacks EXECUTE on get_published_trust_signals (public signal unreadable)';
  END IF;

  -- (e) behavioral published-gate proof (seed rolled back via sentinel)
  BEGIN
    SELECT id INTO v_user_id FROM public.profiles LIMIT 1;
    IF v_user_id IS NOT NULL THEN
      INSERT INTO public.strategies
        (id, user_id, name, status, source, strategy_types, subtypes, markets, supported_exchanges)
      VALUES
        (v_pub_id,  v_user_id, '__mig135_pub__',  'published', 'csv', '{}', '{}', '{}', '{}'::text[]),
        (v_priv_id, v_user_id, '__mig135_priv__', 'private',   'csv', '{}', '{}', '{}', '{}'::text[]);

      INSERT INTO public.strategy_verifications
        (strategy_id, wizard_session_id, status, trust_tier, flow_type, source)
      VALUES
        (v_pub_id,  gen_random_uuid(), 'validated', 'api_verified', 'csv', 'csv'),
        (v_priv_id, gen_random_uuid(), 'validated', 'api_verified', 'csv', 'csv');

      SELECT count(*) INTO v_pub_signal_count
        FROM public.get_published_trust_signals(ARRAY[v_pub_id]);
      SELECT count(*) INTO v_priv_signal_count
        FROM public.get_published_trust_signals(ARRAY[v_priv_id]);
    END IF;

    -- Roll back the seed unconditionally.
    RAISE EXCEPTION USING ERRCODE = 'ZZ135', MESSAGE = 'mig135 seed rollback sentinel';
  EXCEPTION
    WHEN SQLSTATE 'ZZ135' THEN
      -- Seed rolled back to the savepoint; the captured counts survive.
      NULL;
  END;

  IF v_user_id IS NULL THEN
    RAISE NOTICE 'Migration 135: no public.profiles row available; behavioral published-gate check skipped (structural asserts passed).';
  ELSE
    IF v_pub_signal_count <> 1 THEN
      RAISE EXCEPTION 'Migration 135: published strategy signal NOT returned (expected 1, got %)', v_pub_signal_count;
    END IF;
    IF v_priv_signal_count <> 0 THEN
      RAISE EXCEPTION 'Migration 135: published-gate BREACH — non-published strategy signal returned (expected 0, got %)', v_priv_signal_count;
    END IF;
  END IF;

  RAISE NOTICE 'Migration 135: get_published_trust_signals installed + published-gate verified.';
END $$;

COMMIT;

-- ==========================================================================
-- END OF MIGRATION 135
-- ==========================================================================
-- Downstream consumers (all trust_tier PUBLIC-signal readers route here):
--   * src/lib/queries.ts readPublicVerificationSignals — the single typed
--     helper; feeds getPublicStrategyDetail, getStrategiesByCategory,
--     getStrategyDetail, and /factsheet/[id]/v2.
--   * src/app/api/strategies/[id]/returns/route.ts — scenario-drawer trust_tier.
--   * src/app/(dashboard)/allocations/lib/watchlist-read.ts — watchlist badges.
