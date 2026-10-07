-- ============================================================================
-- ROLLBACK for 20261009130000_revoke_truncate_anon_authenticated.sql
-- Phase 164.9.7 TRUNCATEREVOKE, plan 02.
-- ============================================================================
-- Manual, off the auto-apply path. Restores the EXACT holder set the migration
-- removed: TRUNCATE for anon on 56 public relations and for authenticated on 59
-- (53 and 56 tables plus 3 views each), and the postgres default ACL that hands
-- TRUNCATE to both roles on tables postgres creates later in public.
--
-- ⛔ APPLYING THIS FILE REOPENS THE EXPOSURE. Row-level security never evaluates
-- TRUNCATE, so while these grants stand any SQL-capable path running as anon or
-- authenticated can empty a listed table whatever its policies say. Run it only to
-- undo the migration deliberately, and re-apply the migration afterwards.
--
-- ⛔ WHY AN EXPLICIT LIST AND NOT A BLANKET RE-GRANT. A schema-wide
-- `GRANT TRUNCATE ON ALL TABLES IN SCHEMA public TO anon, authenticated` would
-- OVER-GRANT. Earlier hardening migrations removed TRUNCATE from single tables
-- one at a time, so anon never held it on 10 tables and authenticated never held
-- it on 7 (system_settings, cron_runs, strategy_shares, strategy_sync_cursors,
-- compute_jobs among them). Restoring "everything" would hand the privilege back
-- on relations that were already closed. Each line below is one relation that
-- held the privilege immediately before the migration.
--
-- Where the list came from. supabase/schema/baseline.sql at the merge base, whose
-- `GRANT ... ON TABLE "public"."<rel>" TO "anon"|"authenticated"` lines were read
-- for every relation whose privilege list is ALL or names TRUNCATE (column-level
-- grants are not TRUNCATE grants and were not counted): anon 56 relations,
-- authenticated 59. This equals the PROD reading for this metric (phase RESEARCH,
-- "PROD reading", taken 2026-10-07). No migration newer than the dump's carried set
-- (supabase/schema/baseline-carried-migrations.txt) creates a public relation, so
-- no post-bootstrap holder is added. Only the TRUNCATE verb is restored: every other
-- verb anon and authenticated hold was never touched by the migration.
--
-- ⚠️ THE MIGRATION LEDGER ROW IS LEFT IN PLACE. This file does not touch
-- supabase_migrations.schema_migrations. To re-apply the migration after running
-- this rollback, delete that ledger row in the same change (or
-- `supabase migration repair --status reverted 20261009130000` against the
-- intended database).
--
-- ⛔ WHICH DATABASE? Run the marker query FIRST, every time, before this file or
-- any `--linked` command. `current_database()` is `postgres` on both projects and
-- proves nothing:
--   SELECT shobj_description(oid, 'pg_database') AS which_database
--     FROM pg_database WHERE datname = current_database();
-- A NULL answer means the marker was lost: re-set it, do not proceed on a guess.
--
-- A listed relation that no longer exists makes its GRANT fail, which aborts the
-- whole file (one transaction) and changes nothing, so a renamed or dropped table
-- is loud and never silently skipped. The closing DO block also raises unless the
-- anon and authenticated holder counts over relkind r,p,v,m,f equal this file's own
-- per-role GRANT line counts, and unless the postgres default ACL grants TRUNCATE
-- to both roles again.

BEGIN;
SET lock_timeout = '5s';

-- --------------------------------------------------------------------------
-- anon: 56 relations
-- --------------------------------------------------------------------------
GRANT TRUNCATE ON public.allocation_events TO anon;
GRANT TRUNCATE ON public.allocator_equity_derived TO anon;
GRANT TRUNCATE ON public.allocator_equity_snapshots TO anon;
GRANT TRUNCATE ON public.allocator_holdings TO anon;
GRANT TRUNCATE ON public.allocator_preferences TO anon;
GRANT TRUNCATE ON public.api_keys TO anon;
GRANT TRUNCATE ON public.audit_log TO anon;
GRANT TRUNCATE ON public.audit_log_cold TO anon;
GRANT TRUNCATE ON public.benchmark_prices TO anon;
GRANT TRUNCATE ON public.bridge_outcome_dismissals TO anon;
GRANT TRUNCATE ON public.bridge_outcomes TO anon;
GRANT TRUNCATE ON public.compute_jobs_admin TO anon;
GRANT TRUNCATE ON public.contact_requests TO anon;
GRANT TRUNCATE ON public.csv_daily_returns TO anon;
GRANT TRUNCATE ON public.data_deletion_requests TO anon;
GRANT TRUNCATE ON public.deck_strategies TO anon;
GRANT TRUNCATE ON public.decks TO anon;
GRANT TRUNCATE ON public.discovery_categories TO anon;
GRANT TRUNCATE ON public.feature_flags TO anon;
GRANT TRUNCATE ON public.funding_fees TO anon;
GRANT TRUNCATE ON public.investor_attestations TO anon;
GRANT TRUNCATE ON public.key_permission_audit TO anon;
GRANT TRUNCATE ON public.match_batches TO anon;
GRANT TRUNCATE ON public.match_candidates TO anon;
GRANT TRUNCATE ON public.match_decisions TO anon;
GRANT TRUNCATE ON public.notification_dispatches TO anon;
GRANT TRUNCATE ON public.organization_invites TO anon;
GRANT TRUNCATE ON public.organization_members TO anon;
GRANT TRUNCATE ON public.organizations TO anon;
GRANT TRUNCATE ON public.phase19_soak_daily TO anon;
GRANT TRUNCATE ON public.portfolio_alerts TO anon;
GRANT TRUNCATE ON public.portfolio_analytics TO anon;
GRANT TRUNCATE ON public.portfolio_strategies TO anon;
GRANT TRUNCATE ON public.portfolios TO anon;
GRANT TRUNCATE ON public.position_snapshots TO anon;
GRANT TRUNCATE ON public.positions TO anon;
GRANT TRUNCATE ON public.profiles TO anon;
GRANT TRUNCATE ON public.public_profiles TO anon;
GRANT TRUNCATE ON public.reconciliation_reports TO anon;
GRANT TRUNCATE ON public.relationship_documents TO anon;
GRANT TRUNCATE ON public.resend_message_correlation TO anon;
GRANT TRUNCATE ON public.scenario_commit_idempotency TO anon;
GRANT TRUNCATE ON public.strategies TO anon;
GRANT TRUNCATE ON public.strategy_analytics TO anon;
GRANT TRUNCATE ON public.strategy_analytics_series TO anon;
GRANT TRUNCATE ON public.strategy_verifications TO anon;
GRANT TRUNCATE ON public.system_flags TO anon;
GRANT TRUNCATE ON public.token_price_history TO anon;
GRANT TRUNCATE ON public.trades TO anon;
GRANT TRUNCATE ON public.used_ack_tokens TO anon;
GRANT TRUNCATE ON public.user_app_roles TO anon;
GRANT TRUNCATE ON public.user_favorites TO anon;
GRANT TRUNCATE ON public.user_notes TO anon;
GRANT TRUNCATE ON public.verification_requests TO anon;
GRANT TRUNCATE ON public.verification_requests_legacy TO anon;
GRANT TRUNCATE ON public.weight_snapshots TO anon;

-- --------------------------------------------------------------------------
-- authenticated: 59 relations
-- --------------------------------------------------------------------------
GRANT TRUNCATE ON public.allocation_events TO authenticated;
GRANT TRUNCATE ON public.allocator_equity_derived TO authenticated;
GRANT TRUNCATE ON public.allocator_equity_snapshots TO authenticated;
GRANT TRUNCATE ON public.allocator_holdings TO authenticated;
GRANT TRUNCATE ON public.allocator_preferences TO authenticated;
GRANT TRUNCATE ON public.api_keys TO authenticated;
GRANT TRUNCATE ON public.audit_log TO authenticated;
GRANT TRUNCATE ON public.audit_log_cold TO authenticated;
GRANT TRUNCATE ON public.benchmark_prices TO authenticated;
GRANT TRUNCATE ON public.bridge_outcome_dismissals TO authenticated;
GRANT TRUNCATE ON public.bridge_outcomes TO authenticated;
GRANT TRUNCATE ON public.compute_jobs_admin TO authenticated;
GRANT TRUNCATE ON public.contact_requests TO authenticated;
GRANT TRUNCATE ON public.csv_daily_returns TO authenticated;
GRANT TRUNCATE ON public.data_deletion_requests TO authenticated;
GRANT TRUNCATE ON public.deck_strategies TO authenticated;
GRANT TRUNCATE ON public.decks TO authenticated;
GRANT TRUNCATE ON public.discovery_categories TO authenticated;
GRANT TRUNCATE ON public.feature_flags TO authenticated;
GRANT TRUNCATE ON public.funding_fees TO authenticated;
GRANT TRUNCATE ON public.investor_attestations TO authenticated;
GRANT TRUNCATE ON public.key_permission_audit TO authenticated;
GRANT TRUNCATE ON public.match_batches TO authenticated;
GRANT TRUNCATE ON public.match_candidates TO authenticated;
GRANT TRUNCATE ON public.match_decisions TO authenticated;
GRANT TRUNCATE ON public.notification_dispatches TO authenticated;
GRANT TRUNCATE ON public.organization_invites TO authenticated;
GRANT TRUNCATE ON public.organization_members TO authenticated;
GRANT TRUNCATE ON public.organizations TO authenticated;
GRANT TRUNCATE ON public.phase19_soak_daily TO authenticated;
GRANT TRUNCATE ON public.portfolio_alerts TO authenticated;
GRANT TRUNCATE ON public.portfolio_analytics TO authenticated;
GRANT TRUNCATE ON public.portfolio_strategies TO authenticated;
GRANT TRUNCATE ON public.portfolios TO authenticated;
GRANT TRUNCATE ON public.position_snapshots TO authenticated;
GRANT TRUNCATE ON public.positions TO authenticated;
GRANT TRUNCATE ON public.profiles TO authenticated;
GRANT TRUNCATE ON public.public_profiles TO authenticated;
GRANT TRUNCATE ON public.reconciliation_reports TO authenticated;
GRANT TRUNCATE ON public.relationship_documents TO authenticated;
GRANT TRUNCATE ON public.resend_message_correlation TO authenticated;
GRANT TRUNCATE ON public.scenario_commit_idempotency TO authenticated;
GRANT TRUNCATE ON public.scenario_shares TO authenticated;
GRANT TRUNCATE ON public.scenarios TO authenticated;
GRANT TRUNCATE ON public.strategies TO authenticated;
GRANT TRUNCATE ON public.strategy_analytics TO authenticated;
GRANT TRUNCATE ON public.strategy_analytics_series TO authenticated;
GRANT TRUNCATE ON public.strategy_keys TO authenticated;
GRANT TRUNCATE ON public.strategy_verifications TO authenticated;
GRANT TRUNCATE ON public.system_flags TO authenticated;
GRANT TRUNCATE ON public.token_price_history TO authenticated;
GRANT TRUNCATE ON public.trades TO authenticated;
GRANT TRUNCATE ON public.used_ack_tokens TO authenticated;
GRANT TRUNCATE ON public.user_app_roles TO authenticated;
GRANT TRUNCATE ON public.user_favorites TO authenticated;
GRANT TRUNCATE ON public.user_notes TO authenticated;
GRANT TRUNCATE ON public.verification_requests TO authenticated;
GRANT TRUNCATE ON public.verification_requests_legacy TO authenticated;
GRANT TRUNCATE ON public.weight_snapshots TO authenticated;

-- --------------------------------------------------------------------------
-- The postgres default ACL: tables postgres creates later in public receive
-- TRUNCATE for both roles again, as before the migration.
-- --------------------------------------------------------------------------
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  GRANT TRUNCATE ON TABLES TO anon, authenticated;

-- --------------------------------------------------------------------------
-- Self-check, catalogue only. The expected counts are this file's own GRANT line
-- counts, so a line added or removed without the matching count change is loud,
-- and so is a relation outside the list that holds the privilege.
-- --------------------------------------------------------------------------
DO $verify$
DECLARE
  v_anon_expected int := 56;
  v_auth_expected int := 59;
  v_anon_held     int;
  v_auth_held     int;
  v_default       int;
BEGIN
  SELECT count(*) FILTER (WHERE has_table_privilege('anon', c.oid, 'TRUNCATE')),
         count(*) FILTER (WHERE has_table_privilege('authenticated', c.oid, 'TRUNCATE'))
    INTO v_anon_held, v_auth_held
    FROM pg_class c
   WHERE c.relnamespace = 'public'::regnamespace AND c.relkind IN ('r','p','v','m','f');
  IF v_anon_held <> v_anon_expected THEN
    RAISE EXCEPTION 'rollback 20261009130000 failed: anon holds TRUNCATE on % public relations, expected %', v_anon_held, v_anon_expected;
  END IF;
  IF v_auth_held <> v_auth_expected THEN
    RAISE EXCEPTION 'rollback 20261009130000 failed: authenticated holds TRUNCATE on % public relations, expected %', v_auth_held, v_auth_expected;
  END IF;

  SELECT count(DISTINCT a.grantee) INTO v_default
    FROM pg_default_acl d CROSS JOIN LATERAL aclexplode(d.defaclacl) a
   WHERE d.defaclnamespace = 'public'::regnamespace AND d.defaclobjtype = 'r'
     AND d.defaclrole = 'postgres'::regrole AND a.privilege_type = 'TRUNCATE'
     AND a.grantee IN ('anon'::regrole, 'authenticated'::regrole);
  IF v_default <> 2 THEN
    RAISE EXCEPTION 'rollback 20261009130000 failed: the postgres default ACL on public tables grants TRUNCATE to % of the 2 roles, expected 2', v_default;
  END IF;
END
$verify$;

COMMIT;
