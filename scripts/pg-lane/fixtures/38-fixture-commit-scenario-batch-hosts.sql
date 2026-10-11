-- Additive stand-in that lets the pg-lane HOST `commit_scenario_batch` so a gate can
-- execute the REAL function body of the migration under test. Phase 170.4 plan 09
-- (review WR-02, TODOS 170.4-FINGERPRINT-UNPRICED-TWIN). Apply AFTER the base
-- fixtures and the migrations that create allocator_holdings, api_keys and
-- allocator_equity_derived, and BEFORE the migration under test. Never a second base.
--
-- WHY STAND-INS AND NOT THE REAL MIGRATIONS (MEASURED 2026-10-11 on this lane).
-- Seven migrations define commit_scenario_batch, and they do not replay on the lane:
--   * 20260426131721 needs bridge_outcomes, which needs the perfect_match chain, whose
--     match_batches CREATE is shadowed by 02-fixture-sanitize-tables.sql's one-column
--     stand-in (the 16-fixture-user-notes-baseline.sql defect class);
--   * 20260514045553's assertion (f) reads the installed body's prosrc for the text
--     `new_weight`, which its own comment contains, so it RAISEs on any fresh replay;
--   * 20260515205431 (the _assert_no_public_execute helper) refuses unless the 4-arg
--     commit_scenario_batch already exists.
-- The gate therefore applies the migration under test, which `CREATE OR REPLACE`s the
-- whole function, and this file supplies the three objects that migration's own
-- catalogue-only verify block and its fingerprint recompute read:
--   1. audit_log — the recompute reads user_id, action, entity_type, entity_id,
--      metadata, created_at. Shape copied from 20260407075303_portfolio_intelligence.sql;
--      RLS and the later immutability policies are not reproduced because the function
--      is SECURITY DEFINER and runs as the table owner, which bypasses RLS.
--   2. public._assert_no_public_execute(text) — copied VERBATIM from
--      20260515205431_sec_def_public_execute_guard.sql (same body, same REVOKE).
--   3. allocator_holdings_ownership_probe_idx — same definition as
--      20260515210400_commit_scenario_batch_high_hardening.sql (the verify block asserts
--      its presence).
-- What this fixture does NOT supply: match_decisions, bridge_outcomes,
-- scenario_commit_idempotency, parse_holding_ref and log_audit_event_service. A gate
-- that uses it must stay on the path before the diff loop (an unknown diff kind raises
-- 22023 there) and pass no idempotency key. Anything that reaches the inserts fails
-- 42P01 on this lane, by design and loudly.

CREATE TABLE IF NOT EXISTS public.audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id UUID NOT NULL,
  metadata JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE OR REPLACE FUNCTION public._assert_no_public_execute(p_function_signature TEXT)
RETURNS VOID
LANGUAGE plpgsql
AS $fn$
DECLARE
  v_oid   OID;
  v_leaks INTEGER;
BEGIN
  v_oid := p_function_signature::regprocedure::oid;

  SELECT COUNT(*) INTO v_leaks
    FROM pg_proc p,
         LATERAL aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) a
   WHERE p.oid = v_oid
     AND a.grantee = 0
     AND a.privilege_type = 'EXECUTE';

  IF v_leaks > 0 THEN
    RAISE EXCEPTION
      '_assert_no_public_execute: PUBLIC has EXECUTE on % — SECURITY DEFINER leak detected via pg_proc.proacl (aclexplode grantee=0). audit-2026-05-07 C-0284.',
      p_function_signature
      USING ERRCODE = 'insufficient_privilege';
  END IF;
END;
$fn$;

REVOKE ALL ON FUNCTION public._assert_no_public_execute(TEXT) FROM PUBLIC, anon, authenticated, service_role;

CREATE INDEX IF NOT EXISTS allocator_holdings_ownership_probe_idx
  ON public.allocator_holdings (allocator_id, venue, symbol, holding_type, asof DESC);
