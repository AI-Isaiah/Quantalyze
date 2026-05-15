-- Migration 083: race-safe M7 reuse-or-create + pg_proc qualification + 081 NULL UNIQUE defense
-- Phase 10 follow-up to migration 082 (post-review hardening pass).
--
-- Three fixes batched into a single migration (Group A of the Phase 10
-- review-pass):
--
--   (1) M7 race fix (P1) — Migration 082's bridge_recommended path runs a
--       SELECT … LIMIT 1 then a conditional INSERT for the
--       (allocator_id, original_holding_ref, strategy_id, kind='bridge_recommended')
--       tuple. Two concurrent transactions can both see "no row exists",
--       both INSERT, and one will hit unique-violation on
--       uniq_match_dec_thumbup_per_pair_holding. The fix routes through
--       INSERT … ON CONFLICT (…) DO UPDATE … RETURNING id targeting that
--       partial UNIQUE index, so two concurrent calls with the same tuple
--       collapse to ONE row, not two, and the loser does NOT raise — it
--       reads the winner's id via the UPDATE … RETURNING.
--
--       The migration-074 partial UNIQUE index is on the EXPRESSION
--       (allocator_id, strategy_id, COALESCE(original_holding_ref, ''))
--       WHERE decision = 'thumbs_up'. PostgreSQL's ON CONFLICT supports
--       index inference against partial expression indexes; the inference
--       clause must list the same expressions and the same predicate.
--
--   (2) pg_proc qualification (P1) — Migration 082's self-verifying DO
--       block queries pg_proc by `proname='commit_scenario_batch'` only.
--       Same name in another schema (e.g., a forensic snapshot or audit
--       schema) would surface multiple rows and confuse the assertion.
--       Replicate the assertion here using the regprocedure form
--       'public.commit_scenario_batch(uuid,jsonb)'::regprocedure to pin
--       schema + arg list exactly.
--
--   (3) 081 NULL UNIQUE leak (P2) — Migration 081 replaced the migration-072
--       widened (allocator_id, strategy_id, COALESCE(original_holding_ref,''))
--       UNIQUE with a (allocator_id, match_decision_id) UNIQUE. Postgres
--       UNIQUE indexes treat NULLs as distinct, so multiple bridge_outcomes
--       rows with NULL match_decision_id would no longer be blocked from
--       collision on the legacy (allocator_id, strategy_id, original_holding_ref)
--       tuple — the migration-072 invariant for strategy-sourced rows.
--       The fix adds a partial UNIQUE index covering the legacy tuple
--       WHERE match_decision_id IS NULL. Pre-applied verification
--       (Supabase Management API SELECT … HAVING COUNT(*) > 1 returned []
--       on 2026-04-26) confirmed no existing duplicates would block the
--       index creation.
--
-- ADR-0023 sync ships in the same commit (one paragraph appended to the
-- Phase 10 section).
--
-- Application path: applied LIVE via Supabase Management API alongside
-- the source-of-truth file commit. Self-verifying DO block raises
-- EXCEPTION on any invariant failure → automatic rollback.

BEGIN;
SET lock_timeout = '3s';

-- --------------------------------------------------------------------------
-- STEP 1: Replace commit_scenario_batch body with the race-safe M7 path.
--         Signature is preserved verbatim (uuid, jsonb) RETURNS jsonb so
--         Plan 07's route call site (admin.rpc('commit_scenario_batch', …))
--         is unchanged.
-- --------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.commit_scenario_batch(
  p_allocator_id uuid,
  p_diffs jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $func$
DECLARE
  v_caller            uuid := auth.uid();
  v_diff              jsonb;
  v_index             int := 0;
  v_kind              text;
  v_md_id             uuid;
  v_bo_id             uuid;
  v_recorded          jsonb := '[]'::jsonb;
  v_holding_owner_ct  int;
  v_strategy_status   text;
BEGIN
  -- (1) Defence-in-depth: caller must match the p_allocator_id arg.
  --     The auth.uid() helper returns NULL when invoked by service_role (which
  --     bypasses auth) or by anon. Either way, NULL <> p_allocator_id evaluates
  --     to NULL → the OR-NULL short-circuit handles it. Use IS NULL OR <> form
  --     to make the intent explicit and so the assertion string scan succeeds.
  IF v_caller IS NULL OR v_caller <> p_allocator_id THEN
    RAISE EXCEPTION 'commit_scenario_batch: unauthorized — auth.uid() <> p_allocator_id'
      USING ERRCODE = '42501';  -- insufficient_privilege
  END IF;

  -- (2) Validate the diffs array.
  IF jsonb_typeof(p_diffs) <> 'array' OR jsonb_array_length(p_diffs) = 0 THEN
    RAISE EXCEPTION 'commit_scenario_batch: p_diffs must be a non-empty jsonb array'
      USING ERRCODE = '22023';  -- invalid_parameter_value
  END IF;

  -- (3) Iterate diffs in a single tx scope. Any RAISE EXCEPTION rolls back
  --     the entire batch (Postgres functions in plpgsql run inside the caller's
  --     transaction; an unhandled EXCEPTION propagates and rolls back).
  FOR v_diff IN SELECT * FROM jsonb_array_elements(p_diffs) LOOP
    v_kind := v_diff->>'kind';

    -- ----------------------------------------------------------------------
    IF v_kind = 'voluntary_remove' THEN
    -- ----------------------------------------------------------------------
      SELECT COUNT(*) INTO v_holding_owner_ct
        FROM allocator_holdings ah
        JOIN LATERAL public.parse_holding_ref(v_diff->>'holding_ref') hp ON TRUE
       WHERE ah.allocator_id = p_allocator_id
         AND ah.venue = hp.venue
         AND ah.symbol = hp.symbol
         AND ah.holding_type = hp.holding_type;
      IF v_holding_owner_ct = 0 THEN
        RAISE EXCEPTION 'commit_scenario_batch[index=%]: holding_ref % not owned by allocator',
                        v_index, v_diff->>'holding_ref'
          USING ERRCODE = '42501';
      END IF;

      INSERT INTO match_decisions (
        allocator_id, strategy_id, decision, decided_by,
        original_strategy_id, original_holding_ref, kind
      )
      VALUES (
        p_allocator_id, NULL, 'snoozed', p_allocator_id,
        NULL, v_diff->>'holding_ref', 'voluntary_remove'
      )
      RETURNING id INTO v_md_id;

      INSERT INTO bridge_outcomes (
        allocator_id, match_decision_id, strategy_id,
        kind, rejection_reason
      )
      VALUES (
        p_allocator_id, v_md_id, NULL,
        'rejected', v_diff->>'rejection_reason'
      )
      RETURNING id INTO v_bo_id;

    -- ----------------------------------------------------------------------
    ELSIF v_kind = 'voluntary_add' THEN
    -- ----------------------------------------------------------------------
      SELECT status INTO v_strategy_status
        FROM strategies WHERE id = (v_diff->>'strategy_id')::uuid;
      IF v_strategy_status IS NULL OR v_strategy_status <> 'published' THEN
        RAISE EXCEPTION 'commit_scenario_batch[index=%]: strategy % not found or not published',
                        v_index, v_diff->>'strategy_id'
          USING ERRCODE = '23514';
      END IF;

      INSERT INTO match_decisions (
        allocator_id, strategy_id, decision, decided_by,
        original_strategy_id, original_holding_ref, kind
      )
      VALUES (
        p_allocator_id, (v_diff->>'strategy_id')::uuid, 'snoozed', p_allocator_id,
        NULL, NULL, 'voluntary_add'
      )
      RETURNING id INTO v_md_id;

      INSERT INTO bridge_outcomes (
        allocator_id, match_decision_id, strategy_id,
        kind, percent_allocated, allocated_at
      )
      VALUES (
        p_allocator_id, v_md_id, (v_diff->>'strategy_id')::uuid,
        'allocated',
        (v_diff->>'percent_allocated')::numeric,
        COALESCE((v_diff->>'effective_date')::date, CURRENT_DATE)
      )
      RETURNING id INTO v_bo_id;

    -- ----------------------------------------------------------------------
    ELSIF v_kind = 'voluntary_modify' THEN
    -- ----------------------------------------------------------------------
      SELECT COUNT(*) INTO v_holding_owner_ct
        FROM allocator_holdings ah
        JOIN LATERAL public.parse_holding_ref(v_diff->>'holding_ref') hp ON TRUE
       WHERE ah.allocator_id = p_allocator_id
         AND ah.venue = hp.venue
         AND ah.symbol = hp.symbol
         AND ah.holding_type = hp.holding_type;
      IF v_holding_owner_ct = 0 THEN
        RAISE EXCEPTION 'commit_scenario_batch[index=%]: holding_ref % not owned by allocator',
                        v_index, v_diff->>'holding_ref'
          USING ERRCODE = '42501';
      END IF;

      INSERT INTO match_decisions (
        allocator_id, strategy_id, decision, decided_by,
        original_strategy_id, original_holding_ref, kind
      )
      VALUES (
        p_allocator_id, NULL, 'snoozed', p_allocator_id,
        NULL, v_diff->>'holding_ref', 'voluntary_modify'
      )
      RETURNING id INTO v_md_id;

      INSERT INTO bridge_outcomes (
        allocator_id, match_decision_id, strategy_id,
        kind, percent_allocated, allocated_at
      )
      VALUES (
        p_allocator_id, v_md_id, NULL,
        'allocated',
        COALESCE((v_diff->>'percent_allocated')::numeric,
                 (v_diff->>'new_weight')::numeric * 100),
        COALESCE((v_diff->>'effective_date')::date, CURRENT_DATE)
      )
      RETURNING id INTO v_bo_id;

    -- ----------------------------------------------------------------------
    ELSIF v_kind = 'bridge_recommended' THEN
    -- ----------------------------------------------------------------------
      SELECT status INTO v_strategy_status
        FROM strategies WHERE id = (v_diff->>'strategy_id')::uuid;
      IF v_strategy_status IS NULL OR v_strategy_status <> 'published' THEN
        RAISE EXCEPTION 'commit_scenario_batch[index=%]: strategy % not found or not published',
                        v_index, v_diff->>'strategy_id'
          USING ERRCODE = '23514';
      END IF;

      SELECT COUNT(*) INTO v_holding_owner_ct
        FROM allocator_holdings ah
        JOIN LATERAL public.parse_holding_ref(v_diff->>'holding_ref') hp ON TRUE
       WHERE ah.allocator_id = p_allocator_id
         AND ah.venue = hp.venue
         AND ah.symbol = hp.symbol
         AND ah.holding_type = hp.holding_type;
      IF v_holding_owner_ct = 0 THEN
        RAISE EXCEPTION 'commit_scenario_batch[index=%]: holding_ref % not owned by allocator',
                        v_index, v_diff->>'holding_ref'
          USING ERRCODE = '42501';
      END IF;

      -- M7 race-safe reuse-or-create. The migration-074 partial UNIQUE
      -- index `uniq_match_dec_thumbup_per_pair_holding` is on
      -- (allocator_id, strategy_id, COALESCE(original_holding_ref, ''))
      -- WHERE decision = 'thumbs_up'. ON CONFLICT can infer this index
      -- via the matching expression list + predicate. DO UPDATE (not DO
      -- NOTHING) is required so the loser of the race can read the
      -- winner's id via RETURNING — DO NOTHING returns no row when the
      -- conflict was suppressed.
      --
      -- The DO UPDATE SET decided_by = EXCLUDED.decided_by is a no-op write
      -- (self-assigning the same value the winner already wrote) — Postgres
      -- still treats it as a successful row-level operation and surfaces the
      -- existing row's id via RETURNING. Two concurrent calls with the
      -- same tuple end up with exactly ONE match_decisions row; the loser
      -- of the race blocks on the row lock acquired by the winner, then
      -- proceeds with the same id once the winner commits.
      INSERT INTO match_decisions (
        allocator_id, strategy_id, decision, decided_by,
        original_strategy_id, original_holding_ref, kind
      )
      VALUES (
        p_allocator_id, (v_diff->>'strategy_id')::uuid,
        'thumbs_up', p_allocator_id,
        NULL, v_diff->>'holding_ref', 'bridge_recommended'
      )
      ON CONFLICT (allocator_id, strategy_id, COALESCE(original_holding_ref, ''))
        WHERE decision = 'thumbs_up'
        DO UPDATE SET decided_by = EXCLUDED.decided_by
      RETURNING id INTO v_md_id;

      INSERT INTO bridge_outcomes (
        allocator_id, match_decision_id, strategy_id,
        kind, percent_allocated, allocated_at
      )
      VALUES (
        p_allocator_id, v_md_id, (v_diff->>'strategy_id')::uuid,
        'allocated',
        (v_diff->>'percent_allocated')::numeric,
        COALESCE((v_diff->>'effective_date')::date, CURRENT_DATE)
      )
      RETURNING id INTO v_bo_id;

    -- ----------------------------------------------------------------------
    ELSE
    -- ----------------------------------------------------------------------
      RAISE EXCEPTION 'commit_scenario_batch[index=%]: unknown kind %',
                      v_index, v_kind
        USING ERRCODE = '22023';
    END IF;

    v_recorded := v_recorded || jsonb_build_object(
      'index', v_index,
      'match_decision_id', v_md_id,
      'bridge_outcome_id', v_bo_id,
      'kind', v_kind
    );
    v_index := v_index + 1;
  END LOOP;

  RETURN jsonb_build_object('ok', true, 'recorded', v_recorded);
END;
$func$;

-- Re-apply grants (CREATE OR REPLACE preserves them, but be explicit so
-- a future migration auditor can see the contract verbatim).
REVOKE ALL ON FUNCTION public.commit_scenario_batch(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.commit_scenario_batch(uuid, jsonb) TO authenticated;

COMMENT ON FUNCTION public.commit_scenario_batch IS
  'Phase 10 / SCENARIO-07 / H4 + M7 + race-safe (migration 083). SECURITY DEFINER '
  'RPC that commits a batch of scenario diffs (voluntary_remove / voluntary_add / '
  'voluntary_modify / bridge_recommended) in a SINGLE Postgres transaction. '
  'Plan 07''s commit route delegates here. auth.uid() = p_allocator_id guard at '
  'function entry; per-row ownership (allocator_holdings.{venue,symbol,holding_type}) '
  '+ strategy status (strategies.status=''published'') gates inside the loop. M7 '
  'reuse-or-create for bridge_recommended uses INSERT ... ON CONFLICT ... DO UPDATE '
  'targeting uniq_match_dec_thumbup_per_pair_holding so two concurrent calls with '
  'the same (allocator, strategy, holding_ref) tuple collapse to ONE row, not two, '
  'and neither racer raises. RAISE EXCEPTION on any per-row failure rolls back the '
  'entire batch. Returns { ok: true, recorded: [...] } on success.';

-- --------------------------------------------------------------------------
-- STEP 2: 081 NULL UNIQUE defense — partial UNIQUE on the legacy
--         (allocator_id, strategy_id, original_holding_ref) tuple
--         restricted to rows WHERE match_decision_id IS NULL. This
--         restores migration 072's per-strategy invariant for any
--         strategy-sourced bridge_outcomes row that lost its match_decision_id
--         link (set NULL via ON DELETE SET NULL cascade).
--
--         Pre-flight: the Supabase Management API was queried on 2026-04-26
--         and confirmed zero existing duplicates would block this index
--         (SELECT … FROM bridge_outcomes WHERE match_decision_id IS NULL
--         GROUP BY allocator_id, strategy_id, original_holding_ref HAVING
--         COUNT(*) > 1 → []). The index creation is therefore safe.
-- --------------------------------------------------------------------------
CREATE UNIQUE INDEX IF NOT EXISTS bridge_outcomes_legacy_per_strategy_holding_when_md_null
  ON bridge_outcomes (
    allocator_id,
    strategy_id,
    COALESCE(original_holding_ref, '')
  )
  WHERE match_decision_id IS NULL;

COMMENT ON INDEX bridge_outcomes_legacy_per_strategy_holding_when_md_null IS
  'Phase 10 / migration 083 (P2). Partial UNIQUE that restores the migration-072 '
  '(allocator_id, strategy_id, original_holding_ref) per-strategy invariant for any '
  'bridge_outcomes row whose match_decision_id was nulled out (e.g., via the '
  'ON DELETE SET NULL cascade when a match_decision is deleted). Migration 081 '
  'replaced 072''s unconditional unique with (allocator_id, match_decision_id), '
  'which over Postgres''s NULL-distinct semantics no longer blocks duplicate '
  'legacy-shape rows. This partial index restores that block strictly for the '
  'NULL-md case; rows with a real match_decision_id continue to use the '
  'bridge_outcomes_allocator_match_decision_unique constraint.';

-- --------------------------------------------------------------------------
-- STEP 3: Self-verifying DO block (4 assertions a-d). All assertions use
--         schema+arg-qualified pg_proc lookups via regprocedure form so
--         a same-name function in another schema cannot confuse the
--         assertion (P1 hardening).
-- --------------------------------------------------------------------------
DO $$
DECLARE
  v_secdef                 bool;
  v_search_path            text;
  v_prosrc                 text;
  v_authenticated_can      bool;
  v_partial_index_present  bool;
BEGIN
  -- (a) Function is the active SECURITY DEFINER body — pg_proc lookup
  --     pinned via regprocedure form (P1 hardening; pg_proc.proname alone
  --     is ambiguous across schemas).
  SELECT prosecdef INTO v_secdef
    FROM pg_proc
   WHERE oid = 'public.commit_scenario_batch(uuid,jsonb)'::regprocedure;
  IF v_secdef IS NULL THEN
    RAISE EXCEPTION 'Migration 083 assertion (a) failed: public.commit_scenario_batch(uuid,jsonb) not installed';
  END IF;
  IF v_secdef <> true THEN
    RAISE EXCEPTION 'Migration 083 assertion (a) failed: commit_scenario_batch is not SECURITY DEFINER';
  END IF;

  -- (b) search_path still set; auth.uid() guard still present in source;
  --     race-safe ON CONFLICT path lands in the new body.
  SELECT array_to_string(proconfig, ',') INTO v_search_path
    FROM pg_proc
   WHERE oid = 'public.commit_scenario_batch(uuid,jsonb)'::regprocedure;
  IF v_search_path IS NULL OR v_search_path NOT LIKE '%search_path=public%' THEN
    RAISE EXCEPTION 'Migration 083 assertion (b) failed: search_path not set on commit_scenario_batch (got %)', v_search_path;
  END IF;

  SELECT prosrc INTO v_prosrc
    FROM pg_proc
   WHERE oid = 'public.commit_scenario_batch(uuid,jsonb)'::regprocedure;
  IF v_prosrc IS NULL OR v_prosrc NOT LIKE '%auth.uid() <> p_allocator_id%' THEN
    RAISE EXCEPTION 'Migration 083 assertion (b) failed: auth.uid() guard string missing from prosrc';
  END IF;
  IF v_prosrc NOT LIKE '%ON CONFLICT%' THEN
    RAISE EXCEPTION 'Migration 083 assertion (b) failed: race-safe ON CONFLICT path not present in prosrc';
  END IF;

  -- (c) authenticated still has EXECUTE.
  SELECT has_function_privilege('authenticated', 'public.commit_scenario_batch(uuid, jsonb)', 'EXECUTE')
    INTO v_authenticated_can;
  IF v_authenticated_can IS NOT TRUE THEN
    RAISE EXCEPTION 'Migration 083 assertion (c) failed: authenticated lacks EXECUTE on commit_scenario_batch';
  END IF;

  -- (d) bridge_outcomes_legacy_per_strategy_holding_when_md_null partial
  --     UNIQUE index is present.
  SELECT EXISTS (
    SELECT 1
      FROM pg_indexes
     WHERE schemaname = 'public'
       AND tablename = 'bridge_outcomes'
       AND indexname = 'bridge_outcomes_legacy_per_strategy_holding_when_md_null'
  ) INTO v_partial_index_present;
  IF NOT v_partial_index_present THEN
    RAISE EXCEPTION 'Migration 083 assertion (d) failed: bridge_outcomes_legacy_per_strategy_holding_when_md_null index missing';
  END IF;

  RAISE NOTICE 'phase10: commit_scenario_batch race-safe M7 + pg_proc qualification + bridge_outcomes NULL-md partial UNIQUE installed';
  RAISE NOTICE 'Migration 083: all 4 self-verification assertions (a-d) passed.';
END
$$;

COMMIT;
