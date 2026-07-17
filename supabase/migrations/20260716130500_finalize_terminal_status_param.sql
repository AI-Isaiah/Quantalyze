-- CONTRIB-02 / CONTRIB-04 (Phase 110) — thread a guarded p_terminal_status
-- parameter through both finalize RPCs so the contribution wizard can terminate
-- a draft at an owner-only status='private' instead of the publish-candidate
-- 'pending_review'.
-- 2026-07-16.
--
-- Why this migration exists
-- -------------------------
-- finalize_wizard_strategy (latest def:
-- 20260521185008_wizard_finalize_inserts_verification.sql) and
-- finalize_csv_strategy (latest def: 20260501055202_strategy_verifications.sql)
-- HARDCODE the terminal write to status='pending_review'. The Phase 110
-- contribution path must diverge to status='private' (owner-only, never a
-- publish candidate — see 20260716130000_strategies_status_private.sql). Both
-- function bodies below are re-based byte-for-byte on the canonical snapshots in
-- supabase/schema/functions/ (the replayed latest defs) with exactly three
-- changes each:
--   (1) a trailing p_terminal_status TEXT DEFAULT 'pending_review' parameter;
--   (2) a FIRST-statement guard restricting it to ('pending_review','private');
--   (3) the hardcoded 'pending_review' terminal write replaced with
--       p_terminal_status.
-- Everything else — the guard gauntlet (auth.uid() present, auth.uid()=p_user_id,
-- SELECT ... FOR UPDATE, owner-match, source='wizard', status='draft'), the
-- strategy_verifications insert, SECURITY DEFINER, SET search_path, and the
-- REVOKE/GRANT footer — is preserved unchanged.
--
-- DROP FUNCTION (exact signature) THEN CREATE FUNCTION, NOT CREATE OR REPLACE:
-- appending a parameter under CREATE OR REPLACE would register a SECOND overload
-- and break PostgREST rpc dispatch (it resolves by named-argument matching; two
-- candidates with overlapping arg sets are ambiguous). Dropping the old
-- signature first guarantees exactly one overload survives.
--
-- p_terminal_status guard = the server-side enforcement of the never-published
-- invariant (T-110-02) ON THE FINALIZE PATH. Restricting the terminal status to
-- ('pending_review','private') makes 'published' unreachable via ANY finalize
-- caller — including a direct authenticated PostgREST call to these RPCs —
-- because the guard RAISEs before the strategies write. This does NOT by itself
-- close a direct authenticated write to the strategies TABLE (INSERT/PATCH with
-- status='published'), which the finalize guard never sees: RLS
-- strategies_insert/update gate only user_id=auth.uid(), not status. That
-- table-level transition is blocked separately by the
-- guard_strategies_publish_transition trigger (migration 20260716131000), so
-- 'published' can only ever be reached via the admin review promotion path
-- (service_role), never a finalize AND never a direct owner write.
--
-- The strategy_verifications insert is KEPT on BOTH terminal statuses. Trust-tier
-- provenance ('api_verified' / 'csv_uploaded') is a data-quality label the
-- OWNER's own surfaces read (the /strategy/[id] disclaimer, the composer KPI
-- panels) — it is NOT a publish signal. A private contribution still wants its
-- trust tier displayed to its owner; the admin publish queue keys on
-- strategies.status='pending_review', not on the verification row, so keeping the
-- verification row does not make a private strategy publishable.
--
-- Grants: DROP discards the function's grants, so the REVOKE FROM PUBLIC, anon +
-- GRANT EXECUTE TO authenticated footer is re-issued after each CREATE.

BEGIN;

-- ==========================================================================
-- finalize_wizard_strategy — re-based on
-- supabase/schema/functions/finalize_wizard_strategy.sql (source migration
-- 20260521185008) + p_terminal_status.
-- ==========================================================================
DROP FUNCTION IF EXISTS finalize_wizard_strategy(
  UUID, UUID, TEXT, TEXT, UUID, TEXT[], TEXT[], TEXT[], TEXT[], TEXT, NUMERIC, NUMERIC
);

CREATE FUNCTION finalize_wizard_strategy(
  p_strategy_id UUID,
  p_user_id UUID,
  p_name TEXT,
  p_description TEXT,
  p_category_id UUID,
  p_strategy_types TEXT[],
  p_subtypes TEXT[],
  p_markets TEXT[],
  p_supported_exchanges TEXT[],
  p_leverage_range TEXT,
  p_aum NUMERIC,
  p_max_capacity NUMERIC,
  p_terminal_status TEXT DEFAULT 'pending_review'
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_auth_uid UUID := auth.uid();
  v_current_status TEXT;
  v_current_source TEXT;
  v_current_owner UUID;
  v_api_key_id UUID;
  v_exchange TEXT;
BEGIN
  -- CONTRIB-02 guard (T-110-02): the terminal status is restricted to an
  -- owner-only or review-candidate value. 'published' is deliberately
  -- unreachable from any finalize caller — a strategy becomes published ONLY
  -- via the admin review promotion path. FIRST statement so it RAISEs before
  -- any strategies read/write.
  IF p_terminal_status NOT IN ('pending_review', 'private') THEN
    RAISE EXCEPTION 'finalize_wizard_strategy: p_terminal_status % is not allowed (expected pending_review or private)',
      p_terminal_status
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  IF v_auth_uid IS NULL THEN
    RAISE EXCEPTION 'finalize_wizard_strategy called without an auth session'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF v_auth_uid <> p_user_id THEN
    RAISE EXCEPTION 'finalize_wizard_strategy: p_user_id (%) does not match auth.uid (%)',
      p_user_id, v_auth_uid
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- Lock the row FOR UPDATE while we assert + promote. Matches the
  -- pattern used in migration 020 for RLS-scoped PII revokes.
  SELECT status, source, user_id, api_key_id
    INTO v_current_status, v_current_source, v_current_owner, v_api_key_id
    FROM strategies
    WHERE id = p_strategy_id
    FOR UPDATE;

  IF v_current_status IS NULL THEN
    RAISE EXCEPTION 'finalize_wizard_strategy: strategy % not found', p_strategy_id
      USING ERRCODE = 'no_data_found';
  END IF;

  IF v_current_owner <> p_user_id THEN
    RAISE EXCEPTION 'finalize_wizard_strategy: strategy % is not owned by user %',
      p_strategy_id, p_user_id
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF v_current_source <> 'wizard' THEN
    RAISE EXCEPTION 'finalize_wizard_strategy: strategy % has source=% (expected wizard)',
      p_strategy_id, v_current_source
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  IF v_current_status <> 'draft' THEN
    RAISE EXCEPTION 'finalize_wizard_strategy: strategy % has status=% (expected draft)',
      p_strategy_id, v_current_status
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  UPDATE strategies
    SET
      name = p_name,
      description = p_description,
      category_id = p_category_id,
      strategy_types = COALESCE(p_strategy_types, '{}'),
      subtypes = COALESCE(p_subtypes, '{}'),
      markets = COALESCE(p_markets, '{}'),
      supported_exchanges = COALESCE(p_supported_exchanges, '{}'),
      leverage_range = p_leverage_range,
      aum = p_aum,
      max_capacity = p_max_capacity,
      status = p_terminal_status
    WHERE id = p_strategy_id;

  -- Insert the API-tier verification row so the OWNER's /strategy/[id]
  -- disclaimer reads "Data verified from exchange API" instead of the
  -- self_reported fallback.
  --
  -- CONTRIB-02 note: this insert is KEPT on BOTH terminal statuses (including
  -- 'private'). trust_tier ('api_verified') is a data-quality label the owner's
  -- own surfaces read, NOT a publish signal — the admin publish queue keys on
  -- strategies.status='pending_review', so a 'private' row carrying a
  -- verification row is still never publishable.
  --
  -- Only insert when:
  --  (a) the strategy is API-tier (api_key_id IS NOT NULL), AND
  --  (b) the api_keys row resolves to a known exchange admitted by the
  --      strategy_verifications.source check constraint.
  -- A future wizard variant with NULL api_key_id (e.g. paper-trading
  -- onboarding) would NOT get an api_verified row — that's the desired
  -- safety property. The CSV branch is the parallel path; it stays in
  -- finalize_csv_strategy.
  IF v_api_key_id IS NOT NULL THEN
    SELECT exchange
      INTO v_exchange
      FROM api_keys
      WHERE id = v_api_key_id;

    IF v_exchange IN ('bybit', 'okx', 'binance') THEN
      INSERT INTO strategy_verifications (
        strategy_id,
        wizard_session_id,
        status,
        trust_tier,
        flow_type,
        source
      ) VALUES (
        p_strategy_id,
        gen_random_uuid(),
        'validated',
        'api_verified',
        'onboard',
        v_exchange
      );
    END IF;
  END IF;

  RETURN p_strategy_id;
END;
$$;

REVOKE ALL ON FUNCTION finalize_wizard_strategy(
  UUID, UUID, TEXT, TEXT, UUID, TEXT[], TEXT[], TEXT[], TEXT[], TEXT, NUMERIC, NUMERIC, TEXT
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION finalize_wizard_strategy(
  UUID, UUID, TEXT, TEXT, UUID, TEXT[], TEXT[], TEXT[], TEXT[], TEXT, NUMERIC, NUMERIC, TEXT
) TO authenticated;

-- ==========================================================================
-- finalize_csv_strategy — re-based on
-- supabase/schema/functions/finalize_csv_strategy.sql (source migration
-- 20260501055202) + p_terminal_status.
-- ==========================================================================
DROP FUNCTION IF EXISTS public.finalize_csv_strategy(UUID, UUID, TEXT, TEXT);

CREATE FUNCTION public.finalize_csv_strategy(
  p_user_id            UUID,
  p_wizard_session_id  UUID,
  p_fmt                TEXT,
  p_strategy_name      TEXT,
  p_terminal_status    TEXT DEFAULT 'pending_review'
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_auth_uid     UUID := auth.uid();
  v_strategy_id  UUID;
BEGIN
  -- CONTRIB-02 guard (T-110-02): restrict the terminal status; 'published' is
  -- unreachable from any finalize caller. FIRST statement so it RAISEs before
  -- the strategies INSERT.
  IF p_terminal_status NOT IN ('pending_review', 'private') THEN
    RAISE EXCEPTION 'finalize_csv_strategy: p_terminal_status % is not allowed (expected pending_review or private)',
      p_terminal_status
      USING ERRCODE = '22023';
  END IF;

  -- Caller-identity guard (mirrors create_wizard_strategy:140-153):
  -- the route layer calls with the authenticated user's id; we assert
  -- it matches the JWT so a SECURITY DEFINER RPC can't be abused via
  -- service_role to write rows under another user.
  IF v_auth_uid IS NULL THEN
    RAISE EXCEPTION 'finalize_csv_strategy called without an auth session'
      USING ERRCODE = '42501';
  END IF;

  IF v_auth_uid <> p_user_id THEN
    RAISE EXCEPTION 'finalize_csv_strategy: p_user_id (%) does not match auth.uid (%)',
      p_user_id, v_auth_uid
      USING ERRCODE = '42501';
  END IF;

  -- Format whitelist (mirrors the analytics service envelope contract).
  IF p_fmt NOT IN ('daily_returns','daily_nav','trades') THEN
    RAISE EXCEPTION 'finalize_csv_strategy: invalid fmt %', p_fmt
      USING ERRCODE = '22023';
  END IF;

  -- Strategy-name guard — the user typed it on the Upload step. We
  -- enforce 1–80 chars matching the UI-SPEC contract; the route layer
  -- also validates, but defense-in-depth lives here so a service-role
  -- caller cannot bypass the limit. Empty / oversize / NULL all reject
  -- under SQLSTATE 22023 with a distinguishing message substring so
  -- plan 15-06 tests can pin the guard separately from the fmt guard.
  IF p_strategy_name IS NULL OR length(p_strategy_name) = 0 THEN
    RAISE EXCEPTION 'finalize_csv_strategy: p_strategy_name is required'
      USING ERRCODE = '22023';
  END IF;

  IF length(p_strategy_name) > 80 THEN
    RAISE EXCEPTION 'finalize_csv_strategy: p_strategy_name exceeds 80 characters'
      USING ERRCODE = '22023';
  END IF;

  -- Insert the strategies row. source='csv' marks the row's ingestion
  -- path; status=p_terminal_status ('pending_review' for the manager flow,
  -- 'private' for the CONTRIB-02 contribution flow) matches
  -- finalize_wizard_strategy's post-promotion state so downstream queries
  -- (strategy_grid, /strategies/[id]) treat CSV strategies the same as API
  -- strategies once they reach this terminal state. supported_exchanges is
  -- empty because CSV strategies have no broker linkage. strategy_types /
  -- subtypes / markets default empty per Phase 15 v0; Phase 17 metadata
  -- step (deferred) will populate.
  INSERT INTO strategies (
    user_id, name, status, source,
    strategy_types, subtypes, markets, supported_exchanges
  )
  VALUES (
    p_user_id, p_strategy_name, p_terminal_status, 'csv',
    '{}', '{}', '{}', '{}'::text[]
  )
  RETURNING id INTO v_strategy_id;

  -- Insert the verification row at status='validated', trust_tier='csv_uploaded'.
  -- CONTRIB-02 note: KEPT on both terminal statuses — trust_tier is an
  -- owner-facing data-quality label, not a publish signal (the admin queue keys
  -- on strategies.status='pending_review').
  -- Phase 16 / OBSERV-06 will populate correlation_id; we leave NULL.
  -- FK ordering note: PostgreSQL allows the strategy_verifications.strategy_id
  -- FK to reference the just-inserted strategy because both inserts run in
  -- the same transaction (the SECURITY DEFINER function body is implicitly
  -- transactional). The FK check happens at COMMIT, not at the second INSERT.
  INSERT INTO strategy_verifications (
    strategy_id, wizard_session_id, status, trust_tier, flow_type, source,
    errors, correlation_id
  ) VALUES (
    v_strategy_id, p_wizard_session_id, 'validated', 'csv_uploaded', 'csv', 'csv',
    NULL, NULL
  );

  RETURN v_strategy_id;
END;
$$;

REVOKE ALL ON FUNCTION public.finalize_csv_strategy(UUID, UUID, TEXT, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.finalize_csv_strategy(UUID, UUID, TEXT, TEXT, TEXT) TO authenticated;

-- Self-verifying DO block: exactly one overload of each function survives, both
-- carry the p_terminal_status parameter.
DO $$
DECLARE
  n_wizard INTEGER;
  n_csv INTEGER;
BEGIN
  SELECT count(*) INTO n_wizard
  FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace
  WHERE ns.nspname = 'public' AND p.proname = 'finalize_wizard_strategy';
  IF n_wizard <> 1 THEN
    RAISE EXCEPTION 'CONTRIB-02 migration failed: expected exactly 1 finalize_wizard_strategy overload, found %', n_wizard;
  END IF;

  SELECT count(*) INTO n_csv
  FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace
  WHERE ns.nspname = 'public' AND p.proname = 'finalize_csv_strategy';
  IF n_csv <> 1 THEN
    RAISE EXCEPTION 'CONTRIB-02 migration failed: expected exactly 1 finalize_csv_strategy overload, found %', n_csv;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace
    WHERE ns.nspname = 'public' AND p.proname = 'finalize_wizard_strategy'
      AND 'p_terminal_status' = ANY(p.proargnames)
  ) THEN
    RAISE EXCEPTION 'CONTRIB-02 migration failed: finalize_wizard_strategy missing p_terminal_status param';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace
    WHERE ns.nspname = 'public' AND p.proname = 'finalize_csv_strategy'
      AND 'p_terminal_status' = ANY(p.proargnames)
  ) THEN
    RAISE EXCEPTION 'CONTRIB-02 migration failed: finalize_csv_strategy missing p_terminal_status param';
  END IF;
END $$;

COMMIT;
