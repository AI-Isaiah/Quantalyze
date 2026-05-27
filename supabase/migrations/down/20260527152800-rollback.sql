-- ROLLBACK for 20260527152800_phase19_soak_daily.sql
-- Restores phase19_soak_status to the original (pre-rollup-extension) body
-- and drops the new table + record RPC.
BEGIN;

DROP FUNCTION IF EXISTS public.phase19_soak_record_day(DATE, SMALLINT, NUMERIC, INTEGER, INTEGER, TEXT);

DROP TABLE IF EXISTS public.phase19_soak_daily;

-- Restore original phase19_soak_status body (no daily-rollup fields).
CREATE OR REPLACE FUNCTION public.phase19_soak_status(p_since timestamptz DEFAULT now())
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_flag          TEXT;
  v_is_view       BOOLEAN;
  v_legacy_writes BIGINT := 0;
BEGIN
  SELECT value INTO v_flag
    FROM feature_flags
   WHERE flag_key = 'process_key_unified_backbone';

  SELECT EXISTS(
    SELECT 1 FROM information_schema.views
     WHERE table_schema = 'public' AND table_name = 'verification_requests'
  ) INTO v_is_view;

  IF NOT v_is_view THEN
    SELECT count(*) INTO v_legacy_writes
      FROM verification_requests
     WHERE created_at > p_since
        OR (completed_at IS NOT NULL AND completed_at > p_since);
  END IF;

  RETURN jsonb_build_object(
    'flag_value',         COALESCE(v_flag, 'unset'),
    'vr_is_view',         v_is_view,
    'legacy_write_count', v_legacy_writes,
    'since',              p_since,
    'checked_at',         now()
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.phase19_soak_status(timestamptz) TO anon, authenticated, service_role;

COMMIT;
