-- Phase 241 plan 03 - the Pair B delete chain: ONE statement, atomic, order-independent.
-- Used byte-for-byte on the lane (rehearsal) and on PROD (plan 04). Tokens only; the driver
-- fills them into a scratch copy, never in place:
--   {{EXPECTED_MARKER}} {{PAIR_B_LOGIN_SHA256}} {{EXPECT_HOLDINGS}} {{EXPECT_BRIDGE_OUTCOMES}}
--   {{EXPECT_MATCH_DECISIONS}} {{EXPECT_MATCH_CANDIDATES}} {{EXPECT_MATCH_BATCHES}}
--   {{EXPECT_ALLOCATOR_PREFERENCES}} {{EXPECT_API_KEYS}} {{EXPECT_SIBLING_KEYS}}
-- An unfilled token is a syntax error, so the block fails closed before it runs. The marker
-- text goes in a dollar-quoted literal, so it must not contain the sequence dollar-m-dollar.
--
-- Nothing is written unless every check passes. Every raise starts with a fixed check name
-- and carries counts only, never an id, a login or the marker. Each delete is pinned to its
-- expected ROW_COUNT, so the block deletes exactly what the census measured and aborts on any
-- other number. The auth user is NOT deleted here: the admin API does that afterwards, and the
-- cascade then removes the profile, portfolios, sessions and identities. The published-
-- composite delete guard stays armed throughout.
DO $chain$
DECLARE
  v_marker text;
  v_digest text := '{{PAIR_B_LOGIN_SHA256}}';
  v_ids uuid[];
  b uuid;
  v_keys uuid[];
  v_ports uuid[];
  v_batches uuid[];
  v_sibs uuid[];
  v_n bigint;
  v_audit_before bigint;
  v_audit_after bigint;
  v_exp_holdings bigint := {{EXPECT_HOLDINGS}};
  v_exp_bridge bigint := {{EXPECT_BRIDGE_OUTCOMES}};
  v_exp_decisions bigint := {{EXPECT_MATCH_DECISIONS}};
  v_exp_candidates bigint := {{EXPECT_MATCH_CANDIDATES}};
  v_exp_batches bigint := {{EXPECT_MATCH_BATCHES}};
  v_exp_prefs bigint := {{EXPECT_ALLOCATOR_PREFERENCES}};
  v_exp_keys bigint := {{EXPECT_API_KEYS}};
  v_exp_sibs bigint := {{EXPECT_SIBLING_KEYS}};
BEGIN
  -- (a) which database is this
  SELECT shobj_description(oid, 'pg_database') INTO v_marker
    FROM pg_database WHERE datname = current_database();
  IF v_marker IS DISTINCT FROM $m${{EXPECTED_MARKER}}$m$ THEN
    RAISE EXCEPTION 'marker-mismatch';
  END IF;

  -- (b) the input is a digest, not a login
  IF v_digest !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'input:digest';
  END IF;

  -- (c) exactly one auth user carries that login digest
  SELECT coalesce(array_agg(id), '{}'::uuid[]) INTO v_ids
    FROM auth.users
   WHERE encode(sha256(convert_to(lower(email), 'UTF8')), 'hex') = v_digest;
  IF coalesce(cardinality(v_ids), 0) <> 1 THEN
    RAISE EXCEPTION 'pair-b-ids: expected 1 got %', coalesce(cardinality(v_ids), 0);
  END IF;
  b := v_ids[1];

  SELECT coalesce(array_agg(id), '{}'::uuid[]) INTO v_keys FROM public.api_keys WHERE user_id = b;
  SELECT coalesce(array_agg(id), '{}'::uuid[]) INTO v_ports FROM public.portfolios WHERE user_id = b;
  SELECT coalesce(array_agg(id), '{}'::uuid[]) INTO v_batches FROM public.match_batches WHERE allocator_id = b;

  -- (d) cross-owner zero checks: every NO ACTION / RESTRICT / SET NULL edge into B's rows
  SELECT count(*) INTO v_n FROM public.match_decisions WHERE decided_by = b AND allocator_id <> b;
  IF v_n <> 0 THEN RAISE EXCEPTION 'cross-owner:match_decisions.decided_by %', v_n; END IF;

  SELECT count(*) INTO v_n FROM public.match_decisions
   WHERE allocator_id <> b
     AND candidate_id IN (SELECT id FROM public.match_candidates
                           WHERE allocator_id = b OR batch_id = ANY (v_batches));
  IF v_n <> 0 THEN RAISE EXCEPTION 'cross-owner:match_decisions.candidate_id %', v_n; END IF;

  SELECT count(*) INTO v_n FROM public.match_decisions
   WHERE allocator_id <> b
     AND contact_request_id IN (SELECT id FROM public.contact_requests WHERE allocator_id = b);
  IF v_n <> 0 THEN RAISE EXCEPTION 'cross-owner:match_decisions.contact_request_id %', v_n; END IF;

  SELECT count(*) INTO v_n FROM public.match_candidates
   WHERE allocator_id <> b AND batch_id = ANY (v_batches);
  IF v_n <> 0 THEN RAISE EXCEPTION 'cross-owner:match_candidates.batch_id %', v_n; END IF;

  SELECT count(*) INTO v_n FROM public.allocator_holdings
   WHERE allocator_id <> b AND api_key_id = ANY (v_keys);
  IF v_n <> 0 THEN RAISE EXCEPTION 'cross-owner:allocator_holdings.api_key_id %', v_n; END IF;

  SELECT count(*) INTO v_n FROM public.strategies
   WHERE user_id <> b AND api_key_id = ANY (v_keys);
  IF v_n <> 0 THEN RAISE EXCEPTION 'cross-owner:strategies.api_key_id %', v_n; END IF;

  SELECT count(*) INTO v_n FROM public.api_keys
   WHERE user_id <> b AND account_shared_with_api_key_id = ANY (v_keys);
  IF v_n <> 0 THEN RAISE EXCEPTION 'cross-owner:api_keys.account_shared_with_api_key_id %', v_n; END IF;

  SELECT count(*) INTO v_n FROM public.allocator_preferences
   WHERE user_id <> b AND edited_by_user_id = b;
  IF v_n <> 0 THEN RAISE EXCEPTION 'cross-owner:allocator_preferences.edited_by_user_id %', v_n; END IF;

  SELECT count(*) INTO v_n FROM public.for_quants_leads WHERE processed_by = b;
  IF v_n <> 0 THEN RAISE EXCEPTION 'cross-owner:for_quants_leads.processed_by %', v_n; END IF;

  SELECT count(*) INTO v_n FROM public.organization_invites WHERE invited_by = b;
  IF v_n <> 0 THEN RAISE EXCEPTION 'cross-owner:organization_invites.invited_by %', v_n; END IF;

  SELECT count(*) INTO v_n FROM public.organizations WHERE created_by = b;
  IF v_n <> 0 THEN RAISE EXCEPTION 'cross-owner:organizations.created_by %', v_n; END IF;

  SELECT count(*) INTO v_n FROM public.system_flags WHERE updated_by = b;
  IF v_n <> 0 THEN RAISE EXCEPTION 'cross-owner:system_flags.updated_by %', v_n; END IF;

  SELECT count(*) INTO v_n FROM public.system_settings WHERE updated_by = b;
  IF v_n <> 0 THEN RAISE EXCEPTION 'cross-owner:system_settings.updated_by %', v_n; END IF;

  SELECT count(*) INTO v_n FROM public.relationship_documents WHERE uploaded_by = b;
  IF v_n <> 0 THEN RAISE EXCEPTION 'cross-owner:relationship_documents.uploaded_by %', v_n; END IF;

  SELECT count(*) INTO v_n FROM public.user_app_roles WHERE user_id <> b AND granted_by = b;
  IF v_n <> 0 THEN RAISE EXCEPTION 'cross-owner:user_app_roles.granted_by %', v_n; END IF;

  SELECT count(*) INTO v_n FROM public.bridge_outcomes
   WHERE allocator_id <> b
     AND match_decision_id IN (SELECT id FROM public.match_decisions
                                WHERE allocator_id = b OR decided_by = b);
  IF v_n <> 0 THEN RAISE EXCEPTION 'cross-owner:bridge_outcomes.match_decision_id %', v_n; END IF;

  -- (e) nothing in flight, no clock readings
  SELECT count(*) INTO v_n FROM public.compute_jobs
   WHERE status = 'running'
     AND (allocator_id = b OR api_key_id = ANY (v_keys) OR portfolio_id = ANY (v_ports));
  IF v_n <> 0 THEN RAISE EXCEPTION 'running-jobs %', v_n; END IF;

  SELECT count(*) INTO v_n FROM public.mt5_server_clock_readings WHERE api_key_id = ANY (v_keys);
  IF v_n <> 0 THEN RAISE EXCEPTION 'mt5-readings %', v_n; END IF;

  -- (f) sibling keys under other logins on the same venue account must survive
  SELECT coalesce(array_agg(o.id), '{}'::uuid[]) INTO v_sibs
    FROM public.api_keys o
   WHERE o.user_id <> b
     AND o.venue_account_id IS NOT NULL
     AND EXISTS (SELECT 1 FROM public.api_keys k
                  WHERE k.id = ANY (v_keys)
                    AND k.exchange = o.exchange
                    AND k.venue_account_id = o.venue_account_id);
  IF cardinality(v_sibs) <> v_exp_sibs THEN
    RAISE EXCEPTION 'sibling-keys: expected % got %', v_exp_sibs, cardinality(v_sibs);
  END IF;

  -- (g) the audit trail may only grow
  SELECT count(*) INTO v_audit_before FROM public.audit_log;

  -- (h) the deletes, leaf to root, each pinned to its expected count
  DELETE FROM public.allocator_holdings WHERE allocator_id = b;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n <> v_exp_holdings THEN
    RAISE EXCEPTION 'count-mismatch:allocator_holdings expected % got %', v_exp_holdings, v_n;
  END IF;

  DELETE FROM public.bridge_outcomes WHERE allocator_id = b;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n <> v_exp_bridge THEN
    RAISE EXCEPTION 'count-mismatch:bridge_outcomes expected % got %', v_exp_bridge, v_n;
  END IF;

  DELETE FROM public.match_decisions WHERE allocator_id = b OR decided_by = b;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n <> v_exp_decisions THEN
    RAISE EXCEPTION 'count-mismatch:match_decisions expected % got %', v_exp_decisions, v_n;
  END IF;

  DELETE FROM public.match_candidates WHERE allocator_id = b;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n <> v_exp_candidates THEN
    RAISE EXCEPTION 'count-mismatch:match_candidates expected % got %', v_exp_candidates, v_n;
  END IF;

  DELETE FROM public.match_batches WHERE allocator_id = b;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n <> v_exp_batches THEN
    RAISE EXCEPTION 'count-mismatch:match_batches expected % got %', v_exp_batches, v_n;
  END IF;

  DELETE FROM public.allocator_preferences WHERE user_id = b;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n <> v_exp_prefs THEN
    RAISE EXCEPTION 'count-mismatch:allocator_preferences expected % got %', v_exp_prefs, v_n;
  END IF;

  DELETE FROM public.api_keys WHERE user_id = b;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n <> v_exp_keys THEN
    RAISE EXCEPTION 'count-mismatch:api_keys expected % got %', v_exp_keys, v_n;
  END IF;

  -- (i) post checks
  SELECT count(*) INTO v_n FROM public.allocator_holdings WHERE allocator_id = b;
  IF v_n <> 0 THEN RAISE EXCEPTION 'post:allocator_holdings remaining %', v_n; END IF;
  SELECT count(*) INTO v_n FROM public.bridge_outcomes WHERE allocator_id = b;
  IF v_n <> 0 THEN RAISE EXCEPTION 'post:bridge_outcomes remaining %', v_n; END IF;
  SELECT count(*) INTO v_n FROM public.match_decisions WHERE allocator_id = b OR decided_by = b;
  IF v_n <> 0 THEN RAISE EXCEPTION 'post:match_decisions remaining %', v_n; END IF;
  SELECT count(*) INTO v_n FROM public.match_candidates WHERE allocator_id = b;
  IF v_n <> 0 THEN RAISE EXCEPTION 'post:match_candidates remaining %', v_n; END IF;
  SELECT count(*) INTO v_n FROM public.match_batches WHERE allocator_id = b;
  IF v_n <> 0 THEN RAISE EXCEPTION 'post:match_batches remaining %', v_n; END IF;
  SELECT count(*) INTO v_n FROM public.allocator_preferences WHERE user_id = b;
  IF v_n <> 0 THEN RAISE EXCEPTION 'post:allocator_preferences remaining %', v_n; END IF;
  SELECT count(*) INTO v_n FROM public.api_keys WHERE user_id = b;
  IF v_n <> 0 THEN RAISE EXCEPTION 'post:api_keys remaining %', v_n; END IF;

  SELECT count(*) INTO v_n FROM unnest(v_sibs) s
   WHERE NOT EXISTS (SELECT 1 FROM public.api_keys WHERE id = s);
  IF v_n <> 0 THEN RAISE EXCEPTION 'post:sibling-keys-missing %', v_n; END IF;

  SELECT count(*) INTO v_audit_after FROM public.audit_log;
  IF v_audit_after < v_audit_before THEN RAISE EXCEPTION 'post:audit-shrank'; END IF;
END
$chain$;
