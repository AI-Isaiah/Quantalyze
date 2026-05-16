-- Rollback for migration 20260515210300_scoring_weight_overrides_high_hardening.sql
-- audit-2026-05-07 H-0939 / H-0941 / H-0942 / H-0944 / H-0945.
--
-- Restores the pre-forward state:
--   * Drops the allocator_preferences_scoring_weight_overrides_shape CHECK
--     and the _scoring_weight_overrides_is_valid helper it depends on
--     (order: CHECK first, then helper, otherwise the DROP FUNCTION trips
--     dependent_objects_still_exist).
--   * Restores the migration-066 enqueue_compute_job body (no allocator-
--     branch ownership gate). The explicit service_role GRANT is NOT
--     revoked — restoring a known-buggy "no GRANT" state is not a
--     rollback, it is a regression.

BEGIN;
SET lock_timeout = '5s';

ALTER TABLE allocator_preferences
  DROP CONSTRAINT IF EXISTS allocator_preferences_scoring_weight_overrides_shape;

DROP FUNCTION IF EXISTS public._scoring_weight_overrides_is_valid(jsonb);

CREATE OR REPLACE FUNCTION public.enqueue_compute_job(
  p_strategy_id     UUID,
  p_kind            TEXT,
  p_idempotency_key TEXT DEFAULT NULL,
  p_parent_job_ids  UUID[] DEFAULT '{}',
  p_exchange        TEXT DEFAULT NULL,
  p_metadata        JSONB DEFAULT NULL,
  p_allocator_id    UUID DEFAULT NULL,
  p_api_key_id      UUID DEFAULT NULL,
  p_run_at          TIMESTAMPTZ DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
BEGIN
  IF p_strategy_id IS NOT NULL AND p_allocator_id IS NULL AND p_api_key_id IS NULL THEN
    PERFORM _assert_owner('strategies'::regclass, p_strategy_id, 'enqueue_compute_job');
    RETURN _enqueue_compute_job_internal(
      p_strategy_id, NULL, p_kind, p_idempotency_key,
      p_parent_job_ids, p_exchange, p_metadata, NULL, NULL, p_run_at
    );
  END IF;

  IF p_allocator_id IS NOT NULL AND p_strategy_id IS NULL AND p_api_key_id IS NULL THEN
    RETURN _enqueue_compute_job_internal(
      NULL, NULL, p_kind, p_idempotency_key,
      p_parent_job_ids, p_exchange, p_metadata, p_allocator_id, NULL, p_run_at
    );
  END IF;

  IF p_api_key_id IS NOT NULL AND p_strategy_id IS NULL AND p_allocator_id IS NULL THEN
    RETURN _enqueue_compute_job_internal(
      NULL, NULL, p_kind, p_idempotency_key,
      p_parent_job_ids, p_exchange, p_metadata, NULL, p_api_key_id, p_run_at
    );
  END IF;

  RAISE EXCEPTION 'enqueue_compute_job: exactly one of p_strategy_id, p_allocator_id, p_api_key_id must be non-null (got strategy=%, allocator=%, api_key=%)',
    p_strategy_id, p_allocator_id, p_api_key_id
    USING ERRCODE = 'invalid_parameter_value';
END;
$$;

REVOKE ALL ON FUNCTION public.enqueue_compute_job(
  uuid, text, text, uuid[], text, jsonb, uuid, uuid, timestamptz
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.enqueue_compute_job(
  uuid, text, text, uuid[], text, jsonb, uuid, uuid, timestamptz
) TO service_role;

COMMIT;
