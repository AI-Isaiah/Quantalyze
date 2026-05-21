-- Migration N+1: csv_daily_returns table + persist_csv_daily_returns RPC.
-- Phase 2 of the CSV → analytics pipeline. Stores the validated daily-return
-- series from CSV uploads so the worker can compute analytics from it.
--
-- Pattern: migration 093 (strategy_verifications). 7-step structure with
-- SECURITY DEFINER RPC, 3-tier RLS, self-verifying DO block.

BEGIN;

SET lock_timeout = '3s';

-- STEP 1: CREATE TABLE
CREATE TABLE IF NOT EXISTS csv_daily_returns (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  strategy_id  UUID        NOT NULL REFERENCES strategies(id) ON DELETE CASCADE,
  date         DATE        NOT NULL,
  daily_return NUMERIC     NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT csv_daily_returns_unique_per_day UNIQUE (strategy_id, date)
);

COMMENT ON TABLE csv_daily_returns IS
  'Persisted daily-return series for CSV-uploaded strategies (source=''csv'').
   Decimal fraction returns (e.g. 0.0055 for +0.55%). Populated by
   persist_csv_daily_returns SECURITY DEFINER RPC at csv-finalize time.
   Worker handler compute_analytics_from_csv reads this table to feed
   compute_all_metrics(). ON DELETE CASCADE from strategies(id).';

-- STEP 2: RLS (3-tier)
ALTER TABLE csv_daily_returns ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS csv_daily_returns_owner_select ON csv_daily_returns;
CREATE POLICY csv_daily_returns_owner_select ON csv_daily_returns FOR SELECT
  USING (
    strategy_id IN (
      SELECT id FROM strategies WHERE user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS csv_daily_returns_admin_select ON csv_daily_returns;
CREATE POLICY csv_daily_returns_admin_select ON csv_daily_returns FOR SELECT
  USING (public.current_user_has_app_role(ARRAY['admin']::text[]));

DROP POLICY IF EXISTS csv_daily_returns_service_all ON csv_daily_returns;
CREATE POLICY csv_daily_returns_service_all ON csv_daily_returns FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

-- STEP 3: persist_csv_daily_returns SECURITY DEFINER RPC
CREATE OR REPLACE FUNCTION public.persist_csv_daily_returns(
  p_user_id    UUID,
  p_strategy_id UUID,
  p_rows       JSONB
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_auth_uid UUID := auth.uid();
  v_owner_id UUID;
  v_row      JSONB;
  v_count    INTEGER := 0;
BEGIN
  IF v_auth_uid IS NULL THEN
    RAISE EXCEPTION 'persist_csv_daily_returns called without an auth session'
      USING ERRCODE = '42501';
  END IF;
  IF v_auth_uid <> p_user_id THEN
    RAISE EXCEPTION 'persist_csv_daily_returns: p_user_id (%) does not match auth.uid (%)',
      p_user_id, v_auth_uid
      USING ERRCODE = '42501';
  END IF;

  SELECT user_id INTO v_owner_id
    FROM strategies WHERE id = p_strategy_id;
  -- Collapse missing-strategy and wrong-owner into a single 42501 so
  -- authenticated callers cannot use this RPC to enumerate which strategy
  -- UUIDs exist. The two states are indistinguishable to legitimate callers
  -- (the application only ever passes its own freshly-created strategy_id).
  IF v_owner_id IS NULL OR v_owner_id <> p_user_id THEN
    RAISE EXCEPTION 'persist_csv_daily_returns: strategy % not accessible', p_strategy_id
      USING ERRCODE = '42501';
  END IF;

  IF jsonb_typeof(p_rows) <> 'array' THEN
    RAISE EXCEPTION 'persist_csv_daily_returns: p_rows must be a JSON array (got %)',
      jsonb_typeof(p_rows)
      USING ERRCODE = '22023';
  END IF;

  IF jsonb_array_length(p_rows) > 5000 THEN
    RAISE EXCEPTION 'persist_csv_daily_returns: p_rows exceeds 5000 rows (got %)',
      jsonb_array_length(p_rows)
      USING ERRCODE = '22023';
  END IF;

  FOR v_row IN SELECT * FROM jsonb_array_elements(p_rows)
  LOOP
    INSERT INTO csv_daily_returns (strategy_id, date, daily_return)
    VALUES (
      p_strategy_id,
      (v_row->>'date')::DATE,
      (v_row->>'daily_return')::NUMERIC
    )
    ON CONFLICT (strategy_id, date)
    DO UPDATE SET daily_return = EXCLUDED.daily_return;
    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.persist_csv_daily_returns(UUID, UUID, JSONB) FROM PUBLIC, anon;
-- GRANT to authenticated is intentional and matches the sibling
-- finalize_csv_strategy pattern (migration 093). The Next.js route handler
-- calls this RPC via a per-request Supabase client that runs as the
-- `authenticated` role (not service_role) so the inline auth.uid() guard at
-- the top of the function can verify caller identity. Narrowing to
-- service_role would make auth.uid() NULL and trigger the 42501 raise on
-- every legitimate call. The probe-oracle (enumerating arbitrary
-- strategy_ids) is closed by the collapsed "not accessible" branch above,
-- not by the GRANT shape.
GRANT EXECUTE ON FUNCTION public.persist_csv_daily_returns(UUID, UUID, JSONB) TO authenticated;
GRANT EXECUTE ON FUNCTION public.persist_csv_daily_returns(UUID, UUID, JSONB) TO service_role;

COMMENT ON FUNCTION public.persist_csv_daily_returns IS
  'Bulk-upserts a daily-return series into csv_daily_returns. Asserts
   auth.uid() = p_user_id AND strategy.user_id = p_user_id before
   inserting. Idempotent via ON CONFLICT DO UPDATE. Row limit 5000.';

-- STEP 4: Self-verifying DO block
DO $$
DECLARE
  v_col_count    INT;
  v_rls_enabled  BOOLEAN;
  v_policy_count INT;
  v_fn_oid       OID;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables
                 WHERE table_schema='public' AND table_name='csv_daily_returns') THEN
    RAISE EXCEPTION 'csv_daily_returns migration: table missing';
  END IF;
  SELECT count(*) INTO v_col_count FROM information_schema.columns
    WHERE table_schema='public' AND table_name='csv_daily_returns'
      AND column_name IN ('id','strategy_id','date','daily_return','created_at');
  IF v_col_count <> 5 THEN
    RAISE EXCEPTION 'csv_daily_returns migration: expected 5 columns, found %', v_col_count;
  END IF;
  SELECT relrowsecurity INTO v_rls_enabled FROM pg_class
    WHERE relname='csv_daily_returns'
      AND relnamespace=(SELECT oid FROM pg_namespace WHERE nspname='public');
  IF NOT COALESCE(v_rls_enabled, false) THEN
    RAISE EXCEPTION 'csv_daily_returns migration: RLS not enabled';
  END IF;
  SELECT count(*) INTO v_policy_count FROM pg_policies
    WHERE schemaname='public' AND tablename='csv_daily_returns'
      AND policyname IN (
        'csv_daily_returns_owner_select',
        'csv_daily_returns_admin_select',
        'csv_daily_returns_service_all'
      );
  IF v_policy_count <> 3 THEN
    RAISE EXCEPTION 'csv_daily_returns migration: expected 3 policies, found %', v_policy_count;
  END IF;
  SELECT oid INTO v_fn_oid FROM pg_proc
    WHERE proname='persist_csv_daily_returns'
      AND pronamespace=(SELECT oid FROM pg_namespace WHERE nspname='public');
  IF v_fn_oid IS NULL THEN
    RAISE EXCEPTION 'csv_daily_returns migration: RPC missing';
  END IF;
  RAISE NOTICE 'csv_daily_returns migration: all assertions passed.';
END $$;

COMMIT;
