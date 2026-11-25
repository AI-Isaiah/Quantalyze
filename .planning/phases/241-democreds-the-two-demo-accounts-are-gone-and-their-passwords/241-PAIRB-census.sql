-- Phase 241 plan 03 - read-only pre-removal census of Pair B. ONE SELECT, no id or login out.
-- {{PAIR_B_LOGIN_SHA256}} is filled into a scratch copy at run time. B is resolved exactly as
-- the chain resolves it. Column families:
--   pair_b_ids  how many auth users carry the digest (must be 1)
--   expect_*    the chain's count tokens, one to one: expect_<name> fills {{EXPECT_<NAME>}}
--   zero_*      every cross-owner check of the chain's step (d), running jobs and clock readings;
--               ALL must be 0 or the chain will refuse
--   info_*      the rows the cascade will remove, for the record
WITH b AS (
  SELECT coalesce(array_agg(id), '{}'::uuid[]) AS ids
    FROM auth.users
   WHERE encode(sha256(convert_to(lower(email), 'UTF8')), 'hex') = '{{PAIR_B_LOGIN_SHA256}}'
),
one AS (
  SELECT CASE WHEN cardinality(ids) = 1 THEN ids[1] END AS id, cardinality(ids) AS n FROM b
),
keys AS (
  SELECT coalesce(array_agg(id), '{}'::uuid[]) AS ids FROM public.api_keys WHERE user_id = (SELECT id FROM one)
),
ports AS (
  SELECT coalesce(array_agg(id), '{}'::uuid[]) AS ids FROM public.portfolios WHERE user_id = (SELECT id FROM one)
),
batches AS (
  SELECT coalesce(array_agg(id), '{}'::uuid[]) AS ids FROM public.match_batches WHERE allocator_id = (SELECT id FROM one)
)
SELECT
  (SELECT n FROM one) AS pair_b_ids,

  (SELECT count(*) FROM public.allocator_holdings WHERE allocator_id = (SELECT id FROM one)) AS expect_holdings,
  (SELECT count(*) FROM public.bridge_outcomes WHERE allocator_id = (SELECT id FROM one)) AS expect_bridge_outcomes,
  (SELECT count(*) FROM public.match_decisions
    WHERE allocator_id = (SELECT id FROM one) OR decided_by = (SELECT id FROM one)) AS expect_match_decisions,
  (SELECT count(*) FROM public.match_candidates WHERE allocator_id = (SELECT id FROM one)) AS expect_match_candidates,
  (SELECT count(*) FROM public.match_batches WHERE allocator_id = (SELECT id FROM one)) AS expect_match_batches,
  (SELECT count(*) FROM public.allocator_preferences WHERE user_id = (SELECT id FROM one)) AS expect_allocator_preferences,
  (SELECT count(*) FROM public.api_keys WHERE user_id = (SELECT id FROM one)) AS expect_api_keys,
  (SELECT count(*) FROM public.api_keys o
    WHERE o.user_id <> (SELECT id FROM one)
      AND o.venue_account_id IS NOT NULL
      AND EXISTS (SELECT 1 FROM public.api_keys k
                   WHERE k.id = ANY (coalesce((SELECT ids FROM keys), '{}'::uuid[]))
                     AND k.exchange = o.exchange
                     AND k.venue_account_id = o.venue_account_id)) AS expect_sibling_keys,

  (SELECT count(*) FROM public.match_decisions
    WHERE decided_by = (SELECT id FROM one) AND allocator_id <> (SELECT id FROM one)) AS zero_match_decisions_decided_by,
  (SELECT count(*) FROM public.match_decisions
    WHERE allocator_id <> (SELECT id FROM one)
      AND candidate_id IN (SELECT id FROM public.match_candidates
                            WHERE allocator_id = (SELECT id FROM one)
                               OR batch_id = ANY (coalesce((SELECT ids FROM batches), '{}'::uuid[])))) AS zero_match_decisions_candidate_id,
  (SELECT count(*) FROM public.match_decisions
    WHERE allocator_id <> (SELECT id FROM one)
      AND contact_request_id IN (SELECT id FROM public.contact_requests
                                  WHERE allocator_id = (SELECT id FROM one))) AS zero_match_decisions_contact_request_id,
  (SELECT count(*) FROM public.match_candidates
    WHERE allocator_id <> (SELECT id FROM one) AND batch_id = ANY (coalesce((SELECT ids FROM batches), '{}'::uuid[]))) AS zero_match_candidates_batch_id,
  (SELECT count(*) FROM public.allocator_holdings
    WHERE allocator_id <> (SELECT id FROM one) AND api_key_id = ANY (coalesce((SELECT ids FROM keys), '{}'::uuid[]))) AS zero_allocator_holdings_api_key_id,
  (SELECT count(*) FROM public.strategies
    WHERE user_id <> (SELECT id FROM one) AND api_key_id = ANY (coalesce((SELECT ids FROM keys), '{}'::uuid[]))) AS zero_strategies_api_key_id,
  (SELECT count(*) FROM public.api_keys
    WHERE user_id <> (SELECT id FROM one)
      AND account_shared_with_api_key_id = ANY (coalesce((SELECT ids FROM keys), '{}'::uuid[]))) AS zero_api_keys_account_shared_with,
  (SELECT count(*) FROM public.allocator_preferences
    WHERE user_id <> (SELECT id FROM one) AND edited_by_user_id = (SELECT id FROM one)) AS zero_allocator_preferences_edited_by,
  (SELECT count(*) FROM public.for_quants_leads WHERE processed_by = (SELECT id FROM one)) AS zero_for_quants_leads_processed_by,
  (SELECT count(*) FROM public.organization_invites WHERE invited_by = (SELECT id FROM one)) AS zero_organization_invites_invited_by,
  (SELECT count(*) FROM public.organizations WHERE created_by = (SELECT id FROM one)) AS zero_organizations_created_by,
  (SELECT count(*) FROM public.system_flags WHERE updated_by = (SELECT id FROM one)) AS zero_system_flags_updated_by,
  (SELECT count(*) FROM public.system_settings WHERE updated_by = (SELECT id FROM one)) AS zero_system_settings_updated_by,
  (SELECT count(*) FROM public.relationship_documents WHERE uploaded_by = (SELECT id FROM one)) AS zero_relationship_documents_uploaded_by,
  (SELECT count(*) FROM public.user_app_roles
    WHERE user_id <> (SELECT id FROM one) AND granted_by = (SELECT id FROM one)) AS zero_user_app_roles_granted_by,
  (SELECT count(*) FROM public.bridge_outcomes
    WHERE allocator_id <> (SELECT id FROM one)
      AND match_decision_id IN (SELECT id FROM public.match_decisions
                                 WHERE allocator_id = (SELECT id FROM one)
                                    OR decided_by = (SELECT id FROM one))) AS zero_bridge_outcomes_match_decision_id,
  (SELECT count(*) FROM public.compute_jobs
    WHERE status = 'running'
      AND (allocator_id = (SELECT id FROM one)
           OR api_key_id = ANY (coalesce((SELECT ids FROM keys), '{}'::uuid[]))
           OR portfolio_id = ANY (coalesce((SELECT ids FROM ports), '{}'::uuid[])))) AS zero_running_jobs,
  (SELECT count(*) FROM public.mt5_server_clock_readings
    WHERE api_key_id = ANY (coalesce((SELECT ids FROM keys), '{}'::uuid[]))) AS zero_mt5_readings,

  (SELECT count(*) FROM public.allocator_holdings WHERE allocator_id = (SELECT id FROM one)) AS info_allocator_holdings,
  (SELECT count(*) FROM public.audit_log WHERE user_id = (SELECT id FROM one)) AS info_audit_rows_b,
  (SELECT count(*) FROM public.audit_log WHERE user_id IS NULL) AS info_audit_null_subject_total,
  (SELECT count(*) FROM public.csv_daily_returns
    WHERE allocator_id = (SELECT id FROM one) OR api_key_id = ANY (coalesce((SELECT ids FROM keys), '{}'::uuid[]))) AS info_csv_daily_returns,
  (SELECT count(*) FROM public.compute_jobs
    WHERE allocator_id = (SELECT id FROM one)
       OR api_key_id = ANY (coalesce((SELECT ids FROM keys), '{}'::uuid[]))
       OR portfolio_id = ANY (coalesce((SELECT ids FROM ports), '{}'::uuid[]))) AS info_compute_jobs,
  (SELECT count(*) FROM public.api_key_nav_marks
    WHERE allocator_id = (SELECT id FROM one) OR api_key_id = ANY (coalesce((SELECT ids FROM keys), '{}'::uuid[]))) AS info_api_key_nav_marks,
  (SELECT count(*) FROM public.strategies WHERE user_id = (SELECT id FROM one)) AS info_strategies,
  (SELECT count(*) FROM public.match_candidates WHERE allocator_id = (SELECT id FROM one)) AS info_match_candidates,
  (SELECT count(*) FROM public.match_batches WHERE allocator_id = (SELECT id FROM one)) AS info_match_batches,
  (SELECT count(*) FROM public.allocator_equity_derived WHERE allocator_id = (SELECT id FROM one)) AS info_allocator_equity_derived,
  (SELECT count(*) FROM public.api_keys WHERE user_id = (SELECT id FROM one)) AS info_api_keys,
  (SELECT count(*) FROM public.portfolios WHERE user_id = (SELECT id FROM one)) AS info_portfolios,
  (SELECT count(*) FROM public.portfolio_analytics WHERE portfolio_id = ANY (coalesce((SELECT ids FROM ports), '{}'::uuid[]))) AS info_portfolio_analytics,
  (SELECT count(*) FROM public.strategy_shares WHERE created_by = (SELECT id FROM one)) AS info_strategy_shares_created_by,
  (SELECT count(*) FROM public.user_app_roles WHERE user_id = (SELECT id FROM one)) AS info_user_app_roles,
  (SELECT count(*) FROM public.user_app_roles WHERE granted_by = (SELECT id FROM one)) AS info_user_app_roles_granted_by_b,
  (SELECT count(*) FROM public.contact_requests WHERE allocator_id = (SELECT id FROM one)) AS info_contact_requests,
  (SELECT count(*) FROM public.investor_attestations WHERE user_id = (SELECT id FROM one)) AS info_investor_attestations,
  (SELECT count(*) FROM public.allocator_preferences WHERE user_id = (SELECT id FROM one)) AS info_allocator_preferences,
  (SELECT count(*) FROM public.bridge_outcomes WHERE allocator_id = (SELECT id FROM one)) AS info_bridge_outcomes,
  (SELECT count(*) FROM public.match_decisions WHERE allocator_id = (SELECT id FROM one)) AS info_match_decisions_allocator_id,
  (SELECT count(*) FROM public.match_decisions WHERE decided_by = (SELECT id FROM one)) AS info_match_decisions_decided_by,
  (SELECT count(*) FROM auth.sessions WHERE user_id = (SELECT id FROM one)) AS info_auth_sessions,
  (SELECT count(*) FROM auth.identities WHERE user_id = (SELECT id FROM one)) AS info_auth_identities,
  (SELECT count(*) FROM public.profiles WHERE id = (SELECT id FROM one)) AS info_profiles;
