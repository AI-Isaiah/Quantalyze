-- ============================================================================
-- ROLLBACK for 20261009150000_revoke_trigger_maintain_anon_authenticated.sql
-- Phase 164.9.7.1 TRIGGERREVOKE, plan 02.
-- ============================================================================
-- Manual, off the auto-apply path. Restores the EXACT holder sets the migration
-- removed, PER VERB:
--   TRIGGER   anon 56 relations, authenticated 59
--   MAINTAIN  anon 57 relations, authenticated 61
-- plus the postgres default ACL that hands both verbs to both roles on tables
-- postgres creates later in public. The two verbs differ by exactly three grants:
--   * public.cron_runs        holds MAINTAIN for anon AND authenticated, TRIGGER for neither
--   * public.system_settings  holds MAINTAIN for authenticated, TRIGGER for neither
-- (earlier hardening migrations removed TRIGGER, one table at a time, from those two
-- tables, and nothing removed MAINTAIN because it only exists from PostgreSQL 17).
--
-- ⛔ APPLYING THIS FILE REOPENS BOTH EXPOSURES. Row-level security never evaluates
-- TRIGGER or MAINTAIN, so while these grants stand any SQL-capable path running as
-- anon or authenticated can attach a trigger to a listed table (code that later runs
-- as whichever role writes it, the service path being BYPASSRLS) and, on PostgreSQL
-- 17, run VACUUM (FULL), CLUSTER, REINDEX or REFRESH MATERIALIZED VIEW on it. Run it
-- only to undo the migration deliberately, and re-apply the migration afterwards.
--
-- ⛔ WHY TWO EXPLICIT LISTS AND NOT A BLANKET RE-GRANT. A schema-wide
-- `GRANT TRIGGER ON ALL TABLES IN SCHEMA public TO anon, authenticated` would
-- OVER-GRANT TRIGGER on three relations that were already closed before the
-- migration: cron_runs for anon, cron_runs for authenticated and system_settings for
-- authenticated. A single `GRANT TRIGGER, MAINTAIN` list per role would do the same.
-- So each verb has its own list, one line per relation that held it immediately
-- before the migration. TRUNCATE is NOT restored: migration 20261009130000 (164.9.7)
-- owns it and has its own rollback.
--
-- Where the lists came from. supabase/schema/baseline.sql at the merge base, whose
-- `GRANT ... ON TABLE "public"."<rel>" TO "anon"|"authenticated"` lines were read
-- for every relation whose privilege list names TRIGGER, and separately for every
-- relation whose list names MAINTAIN (column-level grants are not table grants and
-- were not counted). Cross-checked against the read-only PROD reading of 2026-10-08
-- recorded in this phase's RESEARCH ("PROD reading (D-04 BEFORE)"): TRIGGER anon 56 /
-- authenticated 59, MAINTAIN anon 57 / authenticated 61. The four counts agree. No
-- migration newer than the dump's carried set
-- (supabase/schema/baseline-carried-migrations.txt) creates a public relation, so no
-- post-bootstrap holder is added.
--
-- This file runs only against PostgreSQL 17 (production, shared TEST and the
-- local-stack lane), where MAINTAIN exists, so it carries no version guard. On 16 the
-- first MAINTAIN grant would fail with `unrecognized privilege type` and, being one
-- transaction, change nothing.
--
-- ⚠️ THE MIGRATION LEDGER ROW IS LEFT IN PLACE. This file does not touch
-- supabase_migrations.schema_migrations. To re-apply the migration after running
-- this rollback, delete that ledger row in the same change (or
-- `supabase migration repair --status reverted 20261009150000` against the
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
-- per-verb, per-role GRANT line counts, and unless the postgres default ACL grants
-- both verbs to both roles again.

BEGIN;
SET lock_timeout = '5s';

-- --------------------------------------------------------------------------
-- TRIGGER, anon: 56 relations
-- --------------------------------------------------------------------------
GRANT TRIGGER ON public.allocation_events TO anon;
GRANT TRIGGER ON public.allocator_equity_derived TO anon;
GRANT TRIGGER ON public.allocator_equity_snapshots TO anon;
GRANT TRIGGER ON public.allocator_holdings TO anon;
GRANT TRIGGER ON public.allocator_preferences TO anon;
GRANT TRIGGER ON public.api_keys TO anon;
GRANT TRIGGER ON public.audit_log TO anon;
GRANT TRIGGER ON public.audit_log_cold TO anon;
GRANT TRIGGER ON public.benchmark_prices TO anon;
GRANT TRIGGER ON public.bridge_outcome_dismissals TO anon;
GRANT TRIGGER ON public.bridge_outcomes TO anon;
GRANT TRIGGER ON public.compute_jobs_admin TO anon;
GRANT TRIGGER ON public.contact_requests TO anon;
GRANT TRIGGER ON public.csv_daily_returns TO anon;
GRANT TRIGGER ON public.data_deletion_requests TO anon;
GRANT TRIGGER ON public.deck_strategies TO anon;
GRANT TRIGGER ON public.decks TO anon;
GRANT TRIGGER ON public.discovery_categories TO anon;
GRANT TRIGGER ON public.feature_flags TO anon;
GRANT TRIGGER ON public.funding_fees TO anon;
GRANT TRIGGER ON public.investor_attestations TO anon;
GRANT TRIGGER ON public.key_permission_audit TO anon;
GRANT TRIGGER ON public.match_batches TO anon;
GRANT TRIGGER ON public.match_candidates TO anon;
GRANT TRIGGER ON public.match_decisions TO anon;
GRANT TRIGGER ON public.notification_dispatches TO anon;
GRANT TRIGGER ON public.organization_invites TO anon;
GRANT TRIGGER ON public.organization_members TO anon;
GRANT TRIGGER ON public.organizations TO anon;
GRANT TRIGGER ON public.phase19_soak_daily TO anon;
GRANT TRIGGER ON public.portfolio_alerts TO anon;
GRANT TRIGGER ON public.portfolio_analytics TO anon;
GRANT TRIGGER ON public.portfolio_strategies TO anon;
GRANT TRIGGER ON public.portfolios TO anon;
GRANT TRIGGER ON public.position_snapshots TO anon;
GRANT TRIGGER ON public.positions TO anon;
GRANT TRIGGER ON public.profiles TO anon;
GRANT TRIGGER ON public.public_profiles TO anon;
GRANT TRIGGER ON public.reconciliation_reports TO anon;
GRANT TRIGGER ON public.relationship_documents TO anon;
GRANT TRIGGER ON public.resend_message_correlation TO anon;
GRANT TRIGGER ON public.scenario_commit_idempotency TO anon;
GRANT TRIGGER ON public.strategies TO anon;
GRANT TRIGGER ON public.strategy_analytics TO anon;
GRANT TRIGGER ON public.strategy_analytics_series TO anon;
GRANT TRIGGER ON public.strategy_verifications TO anon;
GRANT TRIGGER ON public.system_flags TO anon;
GRANT TRIGGER ON public.token_price_history TO anon;
GRANT TRIGGER ON public.trades TO anon;
GRANT TRIGGER ON public.used_ack_tokens TO anon;
GRANT TRIGGER ON public.user_app_roles TO anon;
GRANT TRIGGER ON public.user_favorites TO anon;
GRANT TRIGGER ON public.user_notes TO anon;
GRANT TRIGGER ON public.verification_requests TO anon;
GRANT TRIGGER ON public.verification_requests_legacy TO anon;
GRANT TRIGGER ON public.weight_snapshots TO anon;

-- --------------------------------------------------------------------------
-- TRIGGER, authenticated: 59 relations
-- --------------------------------------------------------------------------
GRANT TRIGGER ON public.allocation_events TO authenticated;
GRANT TRIGGER ON public.allocator_equity_derived TO authenticated;
GRANT TRIGGER ON public.allocator_equity_snapshots TO authenticated;
GRANT TRIGGER ON public.allocator_holdings TO authenticated;
GRANT TRIGGER ON public.allocator_preferences TO authenticated;
GRANT TRIGGER ON public.api_keys TO authenticated;
GRANT TRIGGER ON public.audit_log TO authenticated;
GRANT TRIGGER ON public.audit_log_cold TO authenticated;
GRANT TRIGGER ON public.benchmark_prices TO authenticated;
GRANT TRIGGER ON public.bridge_outcome_dismissals TO authenticated;
GRANT TRIGGER ON public.bridge_outcomes TO authenticated;
GRANT TRIGGER ON public.compute_jobs_admin TO authenticated;
GRANT TRIGGER ON public.contact_requests TO authenticated;
GRANT TRIGGER ON public.csv_daily_returns TO authenticated;
GRANT TRIGGER ON public.data_deletion_requests TO authenticated;
GRANT TRIGGER ON public.deck_strategies TO authenticated;
GRANT TRIGGER ON public.decks TO authenticated;
GRANT TRIGGER ON public.discovery_categories TO authenticated;
GRANT TRIGGER ON public.feature_flags TO authenticated;
GRANT TRIGGER ON public.funding_fees TO authenticated;
GRANT TRIGGER ON public.investor_attestations TO authenticated;
GRANT TRIGGER ON public.key_permission_audit TO authenticated;
GRANT TRIGGER ON public.match_batches TO authenticated;
GRANT TRIGGER ON public.match_candidates TO authenticated;
GRANT TRIGGER ON public.match_decisions TO authenticated;
GRANT TRIGGER ON public.notification_dispatches TO authenticated;
GRANT TRIGGER ON public.organization_invites TO authenticated;
GRANT TRIGGER ON public.organization_members TO authenticated;
GRANT TRIGGER ON public.organizations TO authenticated;
GRANT TRIGGER ON public.phase19_soak_daily TO authenticated;
GRANT TRIGGER ON public.portfolio_alerts TO authenticated;
GRANT TRIGGER ON public.portfolio_analytics TO authenticated;
GRANT TRIGGER ON public.portfolio_strategies TO authenticated;
GRANT TRIGGER ON public.portfolios TO authenticated;
GRANT TRIGGER ON public.position_snapshots TO authenticated;
GRANT TRIGGER ON public.positions TO authenticated;
GRANT TRIGGER ON public.profiles TO authenticated;
GRANT TRIGGER ON public.public_profiles TO authenticated;
GRANT TRIGGER ON public.reconciliation_reports TO authenticated;
GRANT TRIGGER ON public.relationship_documents TO authenticated;
GRANT TRIGGER ON public.resend_message_correlation TO authenticated;
GRANT TRIGGER ON public.scenario_commit_idempotency TO authenticated;
GRANT TRIGGER ON public.scenario_shares TO authenticated;
GRANT TRIGGER ON public.scenarios TO authenticated;
GRANT TRIGGER ON public.strategies TO authenticated;
GRANT TRIGGER ON public.strategy_analytics TO authenticated;
GRANT TRIGGER ON public.strategy_analytics_series TO authenticated;
GRANT TRIGGER ON public.strategy_keys TO authenticated;
GRANT TRIGGER ON public.strategy_verifications TO authenticated;
GRANT TRIGGER ON public.system_flags TO authenticated;
GRANT TRIGGER ON public.token_price_history TO authenticated;
GRANT TRIGGER ON public.trades TO authenticated;
GRANT TRIGGER ON public.used_ack_tokens TO authenticated;
GRANT TRIGGER ON public.user_app_roles TO authenticated;
GRANT TRIGGER ON public.user_favorites TO authenticated;
GRANT TRIGGER ON public.user_notes TO authenticated;
GRANT TRIGGER ON public.verification_requests TO authenticated;
GRANT TRIGGER ON public.verification_requests_legacy TO authenticated;
GRANT TRIGGER ON public.weight_snapshots TO authenticated;

-- --------------------------------------------------------------------------
-- MAINTAIN, anon: 57 relations
-- --------------------------------------------------------------------------
GRANT MAINTAIN ON public.allocation_events TO anon;
GRANT MAINTAIN ON public.allocator_equity_derived TO anon;
GRANT MAINTAIN ON public.allocator_equity_snapshots TO anon;
GRANT MAINTAIN ON public.allocator_holdings TO anon;
GRANT MAINTAIN ON public.allocator_preferences TO anon;
GRANT MAINTAIN ON public.api_keys TO anon;
GRANT MAINTAIN ON public.audit_log TO anon;
GRANT MAINTAIN ON public.audit_log_cold TO anon;
GRANT MAINTAIN ON public.benchmark_prices TO anon;
GRANT MAINTAIN ON public.bridge_outcome_dismissals TO anon;
GRANT MAINTAIN ON public.bridge_outcomes TO anon;
GRANT MAINTAIN ON public.compute_jobs_admin TO anon;
GRANT MAINTAIN ON public.contact_requests TO anon;
GRANT MAINTAIN ON public.cron_runs TO anon;
GRANT MAINTAIN ON public.csv_daily_returns TO anon;
GRANT MAINTAIN ON public.data_deletion_requests TO anon;
GRANT MAINTAIN ON public.deck_strategies TO anon;
GRANT MAINTAIN ON public.decks TO anon;
GRANT MAINTAIN ON public.discovery_categories TO anon;
GRANT MAINTAIN ON public.feature_flags TO anon;
GRANT MAINTAIN ON public.funding_fees TO anon;
GRANT MAINTAIN ON public.investor_attestations TO anon;
GRANT MAINTAIN ON public.key_permission_audit TO anon;
GRANT MAINTAIN ON public.match_batches TO anon;
GRANT MAINTAIN ON public.match_candidates TO anon;
GRANT MAINTAIN ON public.match_decisions TO anon;
GRANT MAINTAIN ON public.notification_dispatches TO anon;
GRANT MAINTAIN ON public.organization_invites TO anon;
GRANT MAINTAIN ON public.organization_members TO anon;
GRANT MAINTAIN ON public.organizations TO anon;
GRANT MAINTAIN ON public.phase19_soak_daily TO anon;
GRANT MAINTAIN ON public.portfolio_alerts TO anon;
GRANT MAINTAIN ON public.portfolio_analytics TO anon;
GRANT MAINTAIN ON public.portfolio_strategies TO anon;
GRANT MAINTAIN ON public.portfolios TO anon;
GRANT MAINTAIN ON public.position_snapshots TO anon;
GRANT MAINTAIN ON public.positions TO anon;
GRANT MAINTAIN ON public.profiles TO anon;
GRANT MAINTAIN ON public.public_profiles TO anon;
GRANT MAINTAIN ON public.reconciliation_reports TO anon;
GRANT MAINTAIN ON public.relationship_documents TO anon;
GRANT MAINTAIN ON public.resend_message_correlation TO anon;
GRANT MAINTAIN ON public.scenario_commit_idempotency TO anon;
GRANT MAINTAIN ON public.strategies TO anon;
GRANT MAINTAIN ON public.strategy_analytics TO anon;
GRANT MAINTAIN ON public.strategy_analytics_series TO anon;
GRANT MAINTAIN ON public.strategy_verifications TO anon;
GRANT MAINTAIN ON public.system_flags TO anon;
GRANT MAINTAIN ON public.token_price_history TO anon;
GRANT MAINTAIN ON public.trades TO anon;
GRANT MAINTAIN ON public.used_ack_tokens TO anon;
GRANT MAINTAIN ON public.user_app_roles TO anon;
GRANT MAINTAIN ON public.user_favorites TO anon;
GRANT MAINTAIN ON public.user_notes TO anon;
GRANT MAINTAIN ON public.verification_requests TO anon;
GRANT MAINTAIN ON public.verification_requests_legacy TO anon;
GRANT MAINTAIN ON public.weight_snapshots TO anon;

-- --------------------------------------------------------------------------
-- MAINTAIN, authenticated: 61 relations
-- --------------------------------------------------------------------------
GRANT MAINTAIN ON public.allocation_events TO authenticated;
GRANT MAINTAIN ON public.allocator_equity_derived TO authenticated;
GRANT MAINTAIN ON public.allocator_equity_snapshots TO authenticated;
GRANT MAINTAIN ON public.allocator_holdings TO authenticated;
GRANT MAINTAIN ON public.allocator_preferences TO authenticated;
GRANT MAINTAIN ON public.api_keys TO authenticated;
GRANT MAINTAIN ON public.audit_log TO authenticated;
GRANT MAINTAIN ON public.audit_log_cold TO authenticated;
GRANT MAINTAIN ON public.benchmark_prices TO authenticated;
GRANT MAINTAIN ON public.bridge_outcome_dismissals TO authenticated;
GRANT MAINTAIN ON public.bridge_outcomes TO authenticated;
GRANT MAINTAIN ON public.compute_jobs_admin TO authenticated;
GRANT MAINTAIN ON public.contact_requests TO authenticated;
GRANT MAINTAIN ON public.cron_runs TO authenticated;
GRANT MAINTAIN ON public.csv_daily_returns TO authenticated;
GRANT MAINTAIN ON public.data_deletion_requests TO authenticated;
GRANT MAINTAIN ON public.deck_strategies TO authenticated;
GRANT MAINTAIN ON public.decks TO authenticated;
GRANT MAINTAIN ON public.discovery_categories TO authenticated;
GRANT MAINTAIN ON public.feature_flags TO authenticated;
GRANT MAINTAIN ON public.funding_fees TO authenticated;
GRANT MAINTAIN ON public.investor_attestations TO authenticated;
GRANT MAINTAIN ON public.key_permission_audit TO authenticated;
GRANT MAINTAIN ON public.match_batches TO authenticated;
GRANT MAINTAIN ON public.match_candidates TO authenticated;
GRANT MAINTAIN ON public.match_decisions TO authenticated;
GRANT MAINTAIN ON public.notification_dispatches TO authenticated;
GRANT MAINTAIN ON public.organization_invites TO authenticated;
GRANT MAINTAIN ON public.organization_members TO authenticated;
GRANT MAINTAIN ON public.organizations TO authenticated;
GRANT MAINTAIN ON public.phase19_soak_daily TO authenticated;
GRANT MAINTAIN ON public.portfolio_alerts TO authenticated;
GRANT MAINTAIN ON public.portfolio_analytics TO authenticated;
GRANT MAINTAIN ON public.portfolio_strategies TO authenticated;
GRANT MAINTAIN ON public.portfolios TO authenticated;
GRANT MAINTAIN ON public.position_snapshots TO authenticated;
GRANT MAINTAIN ON public.positions TO authenticated;
GRANT MAINTAIN ON public.profiles TO authenticated;
GRANT MAINTAIN ON public.public_profiles TO authenticated;
GRANT MAINTAIN ON public.reconciliation_reports TO authenticated;
GRANT MAINTAIN ON public.relationship_documents TO authenticated;
GRANT MAINTAIN ON public.resend_message_correlation TO authenticated;
GRANT MAINTAIN ON public.scenario_commit_idempotency TO authenticated;
GRANT MAINTAIN ON public.scenario_shares TO authenticated;
GRANT MAINTAIN ON public.scenarios TO authenticated;
GRANT MAINTAIN ON public.strategies TO authenticated;
GRANT MAINTAIN ON public.strategy_analytics TO authenticated;
GRANT MAINTAIN ON public.strategy_analytics_series TO authenticated;
GRANT MAINTAIN ON public.strategy_keys TO authenticated;
GRANT MAINTAIN ON public.strategy_verifications TO authenticated;
GRANT MAINTAIN ON public.system_flags TO authenticated;
GRANT MAINTAIN ON public.system_settings TO authenticated;
GRANT MAINTAIN ON public.token_price_history TO authenticated;
GRANT MAINTAIN ON public.trades TO authenticated;
GRANT MAINTAIN ON public.used_ack_tokens TO authenticated;
GRANT MAINTAIN ON public.user_app_roles TO authenticated;
GRANT MAINTAIN ON public.user_favorites TO authenticated;
GRANT MAINTAIN ON public.user_notes TO authenticated;
GRANT MAINTAIN ON public.verification_requests TO authenticated;
GRANT MAINTAIN ON public.verification_requests_legacy TO authenticated;
GRANT MAINTAIN ON public.weight_snapshots TO authenticated;

-- --------------------------------------------------------------------------
-- The postgres default ACL: tables postgres creates later in public receive
-- TRIGGER and MAINTAIN for both roles again, as before the migration.
-- --------------------------------------------------------------------------
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  GRANT TRIGGER, MAINTAIN ON TABLES TO anon, authenticated;

-- --------------------------------------------------------------------------
-- Self-check, catalogue only. The expected counts are this file's own per-verb,
-- per-role GRANT line counts, so a line added or removed without the matching count
-- change is loud, and so is a relation outside the list that holds a verb.
-- --------------------------------------------------------------------------
DO $verify$
DECLARE
  v_trig_anon_expected int := 56;
  v_trig_auth_expected int := 59;
  v_main_anon_expected int := 57;
  v_main_auth_expected int := 61;
  v_trig_anon_held     int;
  v_trig_auth_held     int;
  v_main_anon_held     int;
  v_main_auth_held     int;
  v_default            int;
BEGIN
  SELECT count(*) FILTER (WHERE has_table_privilege('anon', c.oid, 'TRIGGER')),
         count(*) FILTER (WHERE has_table_privilege('authenticated', c.oid, 'TRIGGER')),
         count(*) FILTER (WHERE has_table_privilege('anon', c.oid, 'MAINTAIN')),
         count(*) FILTER (WHERE has_table_privilege('authenticated', c.oid, 'MAINTAIN'))
    INTO v_trig_anon_held, v_trig_auth_held, v_main_anon_held, v_main_auth_held
    FROM pg_class c
   WHERE c.relnamespace = 'public'::regnamespace AND c.relkind IN ('r','p','v','m','f');
  IF v_trig_anon_held <> v_trig_anon_expected THEN
    RAISE EXCEPTION 'rollback 20261009150000 failed: anon holds TRIGGER on % public relations, expected %', v_trig_anon_held, v_trig_anon_expected;
  END IF;
  IF v_trig_auth_held <> v_trig_auth_expected THEN
    RAISE EXCEPTION 'rollback 20261009150000 failed: authenticated holds TRIGGER on % public relations, expected %', v_trig_auth_held, v_trig_auth_expected;
  END IF;
  IF v_main_anon_held <> v_main_anon_expected THEN
    RAISE EXCEPTION 'rollback 20261009150000 failed: anon holds MAINTAIN on % public relations, expected %', v_main_anon_held, v_main_anon_expected;
  END IF;
  IF v_main_auth_held <> v_main_auth_expected THEN
    RAISE EXCEPTION 'rollback 20261009150000 failed: authenticated holds MAINTAIN on % public relations, expected %', v_main_auth_held, v_main_auth_expected;
  END IF;

  SELECT count(*) INTO v_default
    FROM pg_default_acl d CROSS JOIN LATERAL aclexplode(d.defaclacl) a
   WHERE d.defaclnamespace = 'public'::regnamespace AND d.defaclobjtype = 'r'
     AND d.defaclrole = 'postgres'::regrole AND a.privilege_type IN ('TRIGGER','MAINTAIN')
     AND a.grantee IN ('anon'::regrole, 'authenticated'::regrole);
  IF v_default <> 4 THEN
    RAISE EXCEPTION 'rollback 20261009150000 failed: the postgres default ACL on public tables grants % of the 4 (role, verb) pairs, expected 4', v_default;
  END IF;
END
$verify$;

COMMIT;
