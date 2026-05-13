-- Migration 129: cutover_strategy_metrics_keys_atomic (P2046 + P2047)
-- audit-2026-05-07 Round 2 Block E Task E.2
--
-- Slot note (2026-05-13)
-- ----------------------
-- The Round-2 plan (`.planning/audit-2026-05-07/PLAN-ROUND-2-CRITICAL.md`)
-- pre-allocated this work to slot 090. Slot 090 was already claimed by
-- `090_claim_dedupe_partition_keys.sql` (Phase 12 claim dedupe) by the
-- time Block E was authored. Slot 129 is the next-available slot (slot
-- 128 carries Block E Task E.1). Audit-ID anchors (P2046 / P2047) and
-- function name (`cutover_strategy_metrics_keys_atomic`) preserved
-- verbatim so Block B.3's Python caller in
-- `analytics-service/phase12_kill_switch.py` continues to point at the
-- right RPC name.
--
-- Replaces the migration-088 RPC `cutover_strategy_metrics_keys(uuid, jsonb)`
-- with `cutover_strategy_metrics_keys_atomic(uuid)`. Two CRITICAL audit
-- findings drive the replacement:
--
-- P2046 (CRITICAL, S15g.RT.1) — caller-supplied key set.
-- --------------------------------------------------------
-- Migration 088 accepted a JSONB `p_kinds` argument and stripped ALL keys
-- supplied by the caller from metrics_json. A misbehaving (or compromised)
-- service_role caller could pass arbitrary keys — e.g. `{sharpe: 1.5}` —
-- and the function would happily upsert sharpe into strategy_analytics_series
-- AND strip it from metrics_json, breaking the path-extract reader path
-- for non-heavy kinds. The fix bakes a SERVER-SIDE allowlist of the 12
-- HEAVY_KINDS into the function body (`v_allowlist` text[]); callers no
-- longer choose what gets moved.
--
-- P2047 (CRITICAL, S15g.RT.2) — read/write race.
-- ----------------------------------------------
-- Migration 088 took the snapshot OUTSIDE the function (the Python caller
-- read metrics_json, then called the RPC with the projection). If
-- analytics_runner re-wrote metrics_json between the read and the
-- subsequent strip, the strip could remove a key whose payload was the
-- runner's freshly-computed value, leaving sibling_table with a stale
-- payload. The fix reads metrics_json INSIDE the function under
-- `SELECT ... FOR UPDATE`, projecting the allowlist against the row lock
-- the same transaction will use to strip.
--
-- Defense-in-depth additions:
--   * `GET DIAGNOSTICS v_row_count = ROW_COUNT` after the UPDATE — fail
--     loud on missing strategy_id (raises P0001 if rowcount <> 1).
--   * Returns `jsonb_build_object('moved', v_moved)` so the caller can
--     log "moved 0" vs "moved N" cases — visible signal for nothing-to-do
--     vs. successful cutover.
--   * `DROP FUNCTION IF EXISTS cutover_strategy_metrics_keys(uuid, jsonb)`
--     at the end — the unsafe predecessor must not survive (Block B.3
--     stops calling it in the same PR / immediately after).
--   * H-B hardening: SECURITY DEFINER + SET search_path = public, pg_temp
--     (mirrors migration 088).
--   * service_role only (REVOKE all + GRANT EXECUTE).
--
-- Pattern: this migration mirrors migration 088's structure (BEGIN;
-- CREATE OR REPLACE FUNCTION; COMMENT; REVOKE/GRANT; DROP-of-predecessor;
-- self-verifying DO block; COMMIT). The DROP lands AFTER the new function
-- is created — there is never a window where strategy has zero cutover
-- function installed.
--
-- Application path: applied LIVE via Supabase Management API alongside
-- the source-of-truth file commit. Self-verifying DO block raises
-- EXCEPTION on any invariant failure → automatic rollback.

BEGIN;
SET lock_timeout = '3s';

-- --------------------------------------------------------------------------
-- STEP 1: Create the new atomic cutover RPC. Order matters: this CREATE
--         OR REPLACE lands BEFORE the DROP of the unsafe predecessor so
--         there is no gap where the schema has zero cutover function.
-- --------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.cutover_strategy_metrics_keys_atomic(
  p_strategy_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $func$
DECLARE
  v_snapshot         JSONB;
  v_payload          JSONB := '{}'::jsonb;
  v_kind             text;
  v_moved            int := 0;
  v_row_count        int;
  -- P2046 allowlist — matches Python HEAVY_KINDS verbatim. Keep in sync.
  -- The list is INTERNAL to the function body; callers cannot widen it.
  v_allowlist        text[] := ARRAY[
    'daily_returns_grid',
    'rolling_sortino_3m','rolling_sortino_6m','rolling_sortino_12m',
    'rolling_volatility_3m','rolling_volatility_6m','rolling_volatility_12m',
    'rolling_alpha','rolling_beta',
    'exposure_series','turnover_series','log_returns_series'
  ];
BEGIN
  -- P2047 — read metrics_json INSIDE the function body under FOR UPDATE so
  -- analytics_runner's concurrent write cannot land between the snapshot and
  -- the strip step. The row lock acquired here is held until COMMIT.
  SELECT metrics_json INTO v_snapshot
    FROM strategy_analytics
   WHERE strategy_id = p_strategy_id
   FOR UPDATE;
  IF v_snapshot IS NULL THEN
    RAISE EXCEPTION 'cutover_strategy_metrics_keys_atomic: strategy_id % not found', p_strategy_id
      USING ERRCODE = 'P0002';
  END IF;

  -- P2046 — project only the allowlisted heavy keys present in the snapshot.
  -- Any caller-side compromise that injected non-heavy keys would have
  -- failed at the function boundary because the new signature has no
  -- caller-supplied key set; defense-in-depth keeps the projection step
  -- here too so the body alone enforces the invariant.
  FOREACH v_kind IN ARRAY v_allowlist LOOP
    IF v_snapshot ? v_kind THEN
      v_payload := v_payload || jsonb_build_object(v_kind, v_snapshot -> v_kind);
      v_moved := v_moved + 1;
    END IF;
  END LOOP;

  IF v_moved = 0 THEN
    -- No heavy kinds present — nothing to do. Return a visible signal so
    -- the caller can log "nothing-to-do" distinctly from "moved N".
    RETURN jsonb_build_object('moved', 0);
  END IF;

  -- Sibling upsert. Same shape as migration 087's
  -- upsert_strategy_analytics_series_batch.
  INSERT INTO strategy_analytics_series (strategy_id, kind, payload, computed_at)
  SELECT p_strategy_id, key, value, now()
    FROM jsonb_each(v_payload)
   ON CONFLICT (strategy_id, kind) DO UPDATE
      SET payload     = EXCLUDED.payload,
          computed_at = EXCLUDED.computed_at;

  -- Strip — ONLY the allowlist-intersect of the snapshot (v_payload).
  -- ARBITRARY keys in metrics_json (sharpe, cagr, etc.) are preserved
  -- because they are NOT in v_payload. This is defense-in-depth: even
  -- if a non-allowlist key were somehow injected during the projection
  -- step (impossible given the FOREACH ... IF v_snapshot ? v_kind guard
  -- above), it could not survive past this UPDATE because we strip the
  -- keys of v_payload, not the keys of p_kinds.
  UPDATE strategy_analytics
     SET metrics_json = metrics_json - ARRAY(SELECT jsonb_object_keys(v_payload))
   WHERE strategy_id = p_strategy_id;
  GET DIAGNOSTICS v_row_count = ROW_COUNT;
  IF v_row_count <> 1 THEN
    RAISE EXCEPTION 'cutover_strategy_metrics_keys_atomic: UPDATE affected % rows (expected 1)', v_row_count
      USING ERRCODE = 'P0001';
  END IF;

  RETURN jsonb_build_object('moved', v_moved);
END;
$func$;

COMMENT ON FUNCTION public.cutover_strategy_metrics_keys_atomic(uuid) IS
  'P2046 P2047 audit-2026-05-07 round 2 (migration 129). SECURITY DEFINER '
  'atomic cutover RPC. Replaces migration 088''s '
  'cutover_strategy_metrics_keys(uuid, jsonb), whose caller-supplied key set '
  '(P2046) and read-outside-function snapshot (P2047) were both unsafe. '
  'Reads metrics_json INSIDE the function body under SELECT ... FOR UPDATE, '
  'projects against an INTERNAL allowlist of the 12 HEAVY_KINDS (callers '
  'cannot widen), upserts sibling-table rows + strips the same keys from '
  'metrics_json in one transaction, asserts rowcount=1 via GET DIAGNOSTICS. '
  'service_role only. Returns { moved: N } where N is the count of '
  'allowlist keys that were present in the snapshot.';

REVOKE ALL ON FUNCTION public.cutover_strategy_metrics_keys_atomic(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cutover_strategy_metrics_keys_atomic(uuid) TO service_role;

-- --------------------------------------------------------------------------
-- STEP 2: Drop the unsafe predecessor. Order: AFTER the new function is
--         created (STEP 1) so there is NO gap during which the schema
--         has zero cutover function. Block B.3 retargets the Python
--         caller at the new signature in the same PR / immediately after,
--         so the brief overlap window inside this transaction is the
--         only time both functions coexist.
-- --------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.cutover_strategy_metrics_keys(uuid, jsonb);

-- --------------------------------------------------------------------------
-- STEP 3: Self-verifying DO block. Four assertions (a-d), all of which
--         raise EXCEPTION on failure (rolls back the wrapping transaction).
-- --------------------------------------------------------------------------
DO $$
DECLARE
  v_prosrc text;
BEGIN
  -- (a) cutover_strategy_metrics_keys_atomic exists in pg_proc, public schema.
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p
      JOIN pg_namespace n ON p.pronamespace = n.oid
     WHERE n.nspname = 'public'
       AND p.proname = 'cutover_strategy_metrics_keys_atomic'
  ) THEN
    RAISE EXCEPTION 'Migration 129: cutover_strategy_metrics_keys_atomic missing';
  END IF;

  -- (b) Unsafe predecessor `cutover_strategy_metrics_keys(uuid, jsonb)`
  --     does NOT exist (was dropped at STEP 2).
  IF EXISTS (
    SELECT 1 FROM pg_proc p
      JOIN pg_namespace n ON p.pronamespace = n.oid
     WHERE n.nspname = 'public'
       AND p.proname = 'cutover_strategy_metrics_keys'
  ) THEN
    RAISE EXCEPTION 'Migration 129: unsafe cutover_strategy_metrics_keys(uuid,jsonb) still present';
  END IF;

  -- (c) prosrc contains both `v_allowlist` (P2046 allowlist guard) AND
  --     `FOR UPDATE` (P2047 atomic-read guard).
  SELECT p.prosrc INTO v_prosrc
    FROM pg_proc p
    JOIN pg_namespace n ON p.pronamespace = n.oid
   WHERE n.nspname = 'public'
     AND p.proname = 'cutover_strategy_metrics_keys_atomic';
  IF v_prosrc IS NULL OR v_prosrc NOT LIKE '%v_allowlist%' OR v_prosrc NOT LIKE '%FOR UPDATE%' THEN
    RAISE EXCEPTION 'Migration 129: allowlist + FOR UPDATE guards missing from prosrc';
  END IF;

  -- (d) prosrc contains `GET DIAGNOSTICS` — rowcount check landed.
  IF v_prosrc NOT LIKE '%GET DIAGNOSTICS%' THEN
    RAISE EXCEPTION 'Migration 129: GET DIAGNOSTICS rowcount check missing from prosrc';
  END IF;

  -- (e) H-B hardening: SET search_path = public, pg_temp on the new function.
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p
      JOIN pg_namespace n ON p.pronamespace = n.oid
     WHERE n.nspname = 'public'
       AND p.proname = 'cutover_strategy_metrics_keys_atomic'
       AND 'search_path=public, pg_temp' = ANY(p.proconfig)
  ) THEN
    RAISE EXCEPTION 'Migration 129: cutover_strategy_metrics_keys_atomic missing SET search_path = public, pg_temp (H-B hardening)';
  END IF;

  RAISE NOTICE 'Migration 129: atomic cutover RPC installed (P2046 + P2047)';
END $$;

COMMIT;
