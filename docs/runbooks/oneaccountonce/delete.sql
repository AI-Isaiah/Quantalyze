BEGIN;

DO $do$
DECLARE
  c_confirmed constant text[] := ARRAY[
    'api_keys', 'strategies', 'allocator_holdings', 'csv_daily_returns', 'compute_jobs',
    'api_key_nav_marks', 'mt5_server_clock_readings', 'key_permission_audit',
    'strategy_analytics', 'strategy_analytics_series', 'trades', 'positions',
    'position_snapshots', 'funding_fees', 'match_candidates', 'reconciliation_reports',
    'strategy_verifications'
  ];
  v_inputs text[] := ARRAY[
    '{{MANIFEST_KEY_IDS}}',
    '{{MANIFEST_STRATEGY_IDS}}',
    '{{PROTECTED_KEY_IDS}}'
  ];
  v_input_names constant text[] := ARRAY['MANIFEST_KEY_IDS', 'MANIFEST_STRATEGY_IDS', 'PROTECTED_KEY_IDS'];
  v_expected_marker text := $m${{EXPECTED_MARKER}}$m$;
  v_marker text;
  v_csv text;
  v_arr uuid[];
  v_keys uuid[];
  v_strats uuid[];
  v_prot uuid[];
  v_found uuid[];
  v_found_strats uuid[];
  v_ids uuid[];
  v_owners uuid[];
  v_owner uuid;
  v_owner_keys uuid[];
  v_owner_strats uuid[];
  v_key uuid;
  v_fp_before text[];
  v_fp_after text[];
  v_base jsonb;
  v_n bigint;
  v_fk_count integer := 0;
  v_expected_strats integer;
  v_deleted_strats bigint;
  v_holdings bigint;
  v_holdings_total bigint := 0;
  v_strats_total bigint := 0;
  v_keys_total bigint := 0;
  r record;
  v_summary text;
BEGIN
  -- [A-inputs] every pasted input is filled, parses as uuids, is non-empty, has no NULL and no repeat.
  FOR i IN 1..3 LOOP
    v_csv := v_inputs[i];
    IF v_csv IS NULL OR btrim(v_csv) = '' THEN
      RAISE EXCEPTION '[A-inputs] % is empty; nothing written', v_input_names[i];
    END IF;
    IF position('{' IN v_csv) > 0 OR position('}' IN v_csv) > 0 THEN
      RAISE EXCEPTION '[A-inputs] % still holds an unfilled placeholder token; nothing written', v_input_names[i];
    END IF;
    BEGIN
      v_arr := string_to_array(regexp_replace(v_csv, '\s', '', 'g'), ',')::uuid[];
    EXCEPTION WHEN invalid_text_representation THEN
      RAISE EXCEPTION '[A-inputs] % is not a comma-separated list of uuids; nothing written', v_input_names[i];
    END;
    IF COALESCE(array_length(v_arr, 1), 0) = 0 THEN
      RAISE EXCEPTION '[A-inputs] % parsed to an empty list; nothing written', v_input_names[i];
    END IF;
    IF EXISTS (SELECT 1 FROM unnest(v_arr) AS x WHERE x IS NULL) THEN
      RAISE EXCEPTION '[A-inputs] % holds a NULL id; nothing written', v_input_names[i];
    END IF;
    IF (SELECT count(DISTINCT x) FROM unnest(v_arr) AS x) <> array_length(v_arr, 1) THEN
      RAISE EXCEPTION '[A-inputs] % repeats an id; nothing written', v_input_names[i];
    END IF;
    IF i = 1 THEN
      v_keys := v_arr;
    ELSIF i = 2 THEN
      v_strats := v_arr;
    ELSE
      v_prot := v_arr;
    END IF;
  END LOOP;

  IF v_expected_marker IS NULL OR btrim(v_expected_marker) = ''
     OR position('{' IN v_expected_marker) > 0 OR position('}' IN v_expected_marker) > 0 THEN
    RAISE EXCEPTION '[A-inputs] EXPECTED_MARKER is empty or an unfilled placeholder token; nothing written';
  END IF;
  SELECT shobj_description(d.oid, 'pg_database') INTO v_marker
    FROM pg_database d WHERE d.datname = current_database();
  IF v_marker IS DISTINCT FROM v_expected_marker THEN
    RAISE EXCEPTION '[A-marker] the database marker is NULL or is not the pasted expected marker; nothing written';
  END IF;

  -- [B-discovery] the census predicate, run again, returns exactly the pasted key set.
  SELECT COALESCE(array_agg(k.id ORDER BY k.id), '{}'::uuid[]) INTO v_found
    FROM public.api_keys k
    JOIN public.api_keys h ON h.id = k.account_shared_with_api_key_id
   WHERE k.account_share_kind = 'duplicate'
     AND h.user_id = k.user_id;
  SELECT array_agg(x ORDER BY x) INTO v_arr FROM unnest(v_keys) AS x;
  IF v_found IS DISTINCT FROM v_arr THEN
    RAISE EXCEPTION '[B-discovery] pasted % key ids, discovery found % same-owner duplicates (the sets differ); nothing written',
      array_length(v_arr, 1), COALESCE(array_length(v_found, 1), 0);
  END IF;

  -- [C-key-state] per key: disconnected, no row names it as holder, not in strategy_keys, not protected.
  IF EXISTS (SELECT 1 FROM public.api_keys k WHERE k.id = ANY(v_keys) AND k.disconnected_at IS NULL) THEN
    RAISE EXCEPTION '[C-key-state] a manifest key is live (disconnected_at is NULL); nothing written';
  END IF;
  IF EXISTS (SELECT 1 FROM public.api_keys o WHERE o.account_shared_with_api_key_id = ANY(v_keys)) THEN
    RAISE EXCEPTION '[C-key-state] a manifest key is a holder (another key names it); nothing written';
  END IF;
  IF EXISTS (SELECT 1 FROM public.strategy_keys sk WHERE sk.api_key_id = ANY(v_keys)) THEN
    RAISE EXCEPTION '[C-key-state] a manifest key is linked in strategy_keys; nothing written';
  END IF;
  IF v_keys && v_prot THEN
    RAISE EXCEPTION '[C-key-state] a protected key is in the manifest; nothing written';
  END IF;

  -- [D-protected] fingerprint the protected keys before any write.
  SELECT count(*) INTO v_n FROM public.api_keys k WHERE k.id = ANY(v_prot);
  IF v_n <> array_length(v_prot, 1) THEN
    RAISE EXCEPTION '[D-protected] % of % protected key ids exist; nothing written', v_n, array_length(v_prot, 1);
  END IF;
  SELECT array_agg(row(k.id, k.user_id, k.exchange, k.venue_account_id, k.disconnected_at, k.account_shared_with_api_key_id)::text ORDER BY k.id)
    INTO v_fp_before
    FROM public.api_keys k WHERE k.id = ANY(v_prot);

  -- [E-strategies] the strategies on the manifest keys are exactly the pasted set, each of the key's owner.
  SELECT COALESCE(array_agg(s.id ORDER BY s.id), '{}'::uuid[]) INTO v_found_strats
    FROM public.strategies s WHERE s.api_key_id = ANY(v_keys);
  SELECT array_agg(x ORDER BY x) INTO v_arr FROM unnest(v_strats) AS x;
  IF v_found_strats IS DISTINCT FROM v_arr THEN
    RAISE EXCEPTION '[E-strategies] pasted % strategy ids, % strategies sit on the manifest keys (the sets differ); nothing written',
      array_length(v_arr, 1), COALESCE(array_length(v_found_strats, 1), 0);
  END IF;
  IF EXISTS (
    SELECT 1
      FROM public.strategies s
      JOIN public.api_keys k ON k.id = s.api_key_id
     WHERE s.id = ANY(v_strats) AND s.user_id IS DISTINCT FROM k.user_id
  ) THEN
    RAISE EXCEPTION '[E-strategies] a manifest strategy belongs to a different owner than its key; nothing written';
  END IF;

  -- [F-off-manifest] every foreign key into api_keys or strategies, found from pg_constraint.
  -- A referencing table outside the confirmed list holding any row for the manifest stops the run.
  FOR r IN
    SELECT c.conname, n.nspname, cl.relname, a.attname, c.conrelid, c.confrelid,
           array_length(c.conkey, 1) AS nkeys
      FROM pg_constraint c
      JOIN pg_class cl ON cl.oid = c.conrelid
      JOIN pg_namespace n ON n.oid = cl.relnamespace
      JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = c.conkey[1]
     WHERE c.contype = 'f'
       AND c.confrelid IN ('public.api_keys'::regclass, 'public.strategies'::regclass)
     ORDER BY n.nspname, cl.relname, c.conname
  LOOP
    v_fk_count := v_fk_count + 1;
    IF r.nkeys <> 1 THEN
      RAISE EXCEPTION '[F-off-manifest] constraint % on %.% is a composite foreign key this script cannot count; nothing written',
        r.conname, r.nspname, r.relname;
    END IF;
    IF r.confrelid = 'public.api_keys'::regclass AND r.conrelid IN ('public.api_keys'::regclass, 'public.strategies'::regclass) THEN
      CONTINUE; -- api_keys self-reference is check C; strategies.api_key_id is check E
    END IF;
    v_ids := CASE WHEN r.confrelid = 'public.api_keys'::regclass THEN v_keys ELSE v_strats END;
    EXECUTE format('SELECT count(*) FROM %I.%I WHERE %I = ANY($1)', r.nspname, r.relname, r.attname)
      INTO v_n USING v_ids;
    IF v_n > 0 AND NOT (r.nspname = 'public' AND r.relname = ANY(c_confirmed)) THEN
      RAISE EXCEPTION '[F-off-manifest] table %.% (constraint %) holds % row(s) for the manifest and is outside the confirmed list; nothing written',
        r.nspname, r.relname, r.conname, v_n;
    END IF;
  END LOOP;
  IF v_fk_count = 0 THEN
    RAISE EXCEPTION '[F-off-manifest] pg_constraint returned no foreign key into api_keys or strategies; the scan would be vacuous; nothing written';
  END IF;

  -- [H-pre-write] check H reads pg_stat_xact_user_tables. With track_counts off every delta is 0 and
  -- the check would pass without measuring anything, so refuse to write unless the counters are live.
  IF current_setting('track_counts') IS DISTINCT FROM 'on' THEN
    RAISE EXCEPTION '[H-pre-write] track_counts is % (not on), so check H would read all zeros and prove nothing; nothing written',
      current_setting('track_counts');
  END IF;

  -- Everything below this line writes. Resolve the owners first, and take the transaction-local
  -- statistics baseline so check H measures only this transaction's own writes.
  SELECT array_agg(DISTINCT k.user_id ORDER BY k.user_id) INTO v_owners
    FROM public.api_keys k WHERE k.id = ANY(v_keys);
  SELECT COALESCE(jsonb_object_agg(t.schemaname || '.' || t.relname,
                                   jsonb_build_array(t.n_tup_ins, t.n_tup_upd, t.n_tup_del)), '{}'::jsonb)
    INTO v_base
    FROM pg_stat_xact_user_tables t;

  -- [G-write] per owner, in the owner's context: strategies first, then each key through the RPC.
  FOREACH v_owner IN ARRAY v_owners LOOP
    SELECT COALESCE(array_agg(k.id ORDER BY k.id), '{}'::uuid[]) INTO v_owner_keys
      FROM public.api_keys k WHERE k.id = ANY(v_keys) AND k.user_id = v_owner;
    SELECT COALESCE(array_agg(s.id ORDER BY s.id), '{}'::uuid[]) INTO v_owner_strats
      FROM public.strategies s WHERE s.id = ANY(v_strats) AND s.user_id = v_owner;
    v_expected_strats := COALESCE(array_length(v_owner_strats, 1), 0);

    PERFORM set_config('request.jwt.claims',
      json_build_object('sub', v_owner::text, 'role', 'authenticated')::text, true);
    SET LOCAL ROLE authenticated;

    IF v_expected_strats > 0 THEN
      DELETE FROM public.strategies WHERE id = ANY(v_owner_strats) AND user_id = v_owner;
      GET DIAGNOSTICS v_deleted_strats = ROW_COUNT;
      IF v_deleted_strats <> v_expected_strats THEN
        RAISE EXCEPTION '[G-write] an owner''s strategy delete removed % of % expected strategies; nothing written',
          v_deleted_strats, v_expected_strats;
      END IF;
      v_strats_total := v_strats_total + v_deleted_strats;
    END IF;

    FOREACH v_key IN ARRAY v_owner_keys LOOP
      SELECT public.delete_allocator_api_key(v_key, true) INTO v_holdings;
      v_holdings_total := v_holdings_total + COALESCE(v_holdings, 0);
      v_keys_total := v_keys_total + 1;
    END LOOP;

    RESET ROLE;
    PERFORM set_config('request.jwt.claims', '', true);
  END LOOP;

  -- [H-post-write] nothing of the manifest remains, the protected keys are unchanged,
  -- and no table outside the confirmed list was written by this transaction.
  IF EXISTS (SELECT 1 FROM public.api_keys k WHERE k.id = ANY(v_keys))
     OR EXISTS (SELECT 1 FROM public.strategies s WHERE s.id = ANY(v_strats)) THEN
    RAISE EXCEPTION '[H-post-write] a manifest key or strategy still exists after the deletes; nothing written';
  END IF;
  SELECT array_agg(row(k.id, k.user_id, k.exchange, k.venue_account_id, k.disconnected_at, k.account_shared_with_api_key_id)::text ORDER BY k.id)
    INTO v_fp_after
    FROM public.api_keys k WHERE k.id = ANY(v_prot);
  IF v_fp_after IS DISTINCT FROM v_fp_before THEN
    RAISE EXCEPTION '[H-post-write] a protected key changed during the run; nothing written';
  END IF;
  FOR r IN
    SELECT t.schemaname, t.relname,
           t.n_tup_ins - COALESCE((v_base -> (t.schemaname || '.' || t.relname) ->> 0)::bigint, 0) AS d_ins,
           t.n_tup_upd - COALESCE((v_base -> (t.schemaname || '.' || t.relname) ->> 1)::bigint, 0) AS d_upd,
           t.n_tup_del - COALESCE((v_base -> (t.schemaname || '.' || t.relname) ->> 2)::bigint, 0) AS d_del
      FROM pg_stat_xact_user_tables t
     ORDER BY t.schemaname, t.relname
  LOOP
    IF (r.d_ins <> 0 OR r.d_upd <> 0 OR r.d_del <> 0)
       AND NOT (r.schemaname = 'public' AND r.relname = ANY(c_confirmed)) THEN
      RAISE EXCEPTION '[H-post-write] table %.% outside the confirmed list was written by the deletes (inserted %, updated %, deleted %); nothing written',
        r.schemaname, r.relname, r.d_ins, r.d_upd, r.d_del;
    END IF;
  END LOOP;

  -- Positive control for the loop above: the api_keys delete counter must have moved by exactly the
  -- manifest key count. A counter that read 0 (stats off) or a delete that removed a different number
  -- of keys than the manifest holds both fail here.
  SELECT t.n_tup_del - COALESCE((v_base -> 'public.api_keys' ->> 2)::bigint, 0) INTO v_n
    FROM pg_stat_xact_user_tables t
   WHERE t.schemaname = 'public' AND t.relname = 'api_keys';
  IF v_n IS DISTINCT FROM array_length(v_keys, 1) THEN
    RAISE EXCEPTION '[H-post-write] the api_keys delete counter moved by % but the manifest holds % keys; nothing written',
      v_n, array_length(v_keys, 1);
  END IF;

  SELECT string_agg(t.relname || '=' || (t.n_tup_del - COALESCE((v_base -> (t.schemaname || '.' || t.relname) ->> 2)::bigint, 0)),
                    ', ' ORDER BY t.relname)
    INTO v_summary
    FROM pg_stat_xact_user_tables t
   WHERE t.schemaname = 'public'
     AND t.n_tup_del - COALESCE((v_base -> (t.schemaname || '.' || t.relname) ->> 2)::bigint, 0) > 0;

  -- Recompose enqueue per owner, in the owner's context (the allocator branch checks auth.uid()).
  FOREACH v_owner IN ARRAY v_owners LOOP
    PERFORM set_config('request.jwt.claims',
      json_build_object('sub', v_owner::text, 'role', 'authenticated')::text, true);
    PERFORM public.enqueue_compute_job(
      p_strategy_id => NULL, p_allocator_id => v_owner, p_kind => 'derive_allocator_equity');
    PERFORM set_config('request.jwt.claims', '', true);
  END LOOP;

  RAISE NOTICE 'oneaccountonce delete: % keys, % strategies, % holdings rows through the RPC; rows deleted per table: %',
    v_keys_total, v_strats_total, v_holdings_total, COALESCE(v_summary, '(none)');
END
$do$;

COMMIT;

SELECT (SELECT count(*) FROM public.api_keys
         WHERE id = ANY(string_to_array(regexp_replace('{{MANIFEST_KEY_IDS}}', '\s', '', 'g'), ',')::uuid[])) AS manifest_keys_remaining,
       (SELECT count(*) FROM public.strategies
         WHERE id = ANY(string_to_array(regexp_replace('{{MANIFEST_STRATEGY_IDS}}', '\s', '', 'g'), ',')::uuid[])) AS manifest_strategies_remaining;
