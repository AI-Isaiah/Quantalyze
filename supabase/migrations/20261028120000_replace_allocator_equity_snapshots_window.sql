-- ============================================================================
-- replace_allocator_equity_snapshots_window: replace only the rebuilt window of
-- an allocator's equity history, refuse inside the transaction when that would
-- drop a stored day the rebuild did not reproduce, and record the seam
-- (2026-10-22, Phase 167.2.1.1.2 ACCTREBUILD, plan 01; SC-1, SC-2, SC-4,
-- D-01, D-02, D-03)
-- ============================================================================
--
-- What this is for
-- ----------------
-- A Bybit-backed account's stored allocation history was anchored on the wrong
-- reading and is being rebuilt. The rebuild can reach back only as far as the
-- venue lets it (90 days for accounts holding OKX keys, 730 days otherwise), so
-- it cannot be allowed to wipe the older days it has no way to recompute.
--
--   D-01  Only the rebuilt window is replaced. Stored days older than the window
--         keep their current values: value_usd, breakdown, source,
--         history_depth_months, reconstructed_at and pre_terminus_balance_unknown
--         exactly as stored. The existing replace_allocator_equity_snapshots
--         deletes EVERY row of the allocator, so it cannot honour this and is
--         left exactly as it is.
--   D-02  If a stored day inside the window is not reproduced by the payload, the
--         call writes nothing and says why. The check is made INSIDE this
--         transaction, on the rows the DELETE itself returned, so a day the daily
--         refresh wrote after the worker built its payload is refused and never
--         deleted unseen. That closes the race the worker's handler comment calls
--         ACCEPTED RACE (a Python pre-read followed by a separate write).
--   D-03  Where the rebuilt window meets the kept days there is a jump, and the
--         jump is left. The seam is recorded as ONE allocator_equity_derived row,
--         kind 'snapshot_rebuild_boundary', payload {"boundary_date":
--         "YYYY-MM-DD"} equal to p_window_start, written in the same transaction
--         when a row older than the window is kept and deleted when none is.
--         No value is invented.
--
-- Decision AR-1: a NEW function, a new name and never an overload (PostgREST
-- resolves an RPC by name and argument names). SECURITY DEFINER, with the same
-- advisory-lock key, search_path and lock_timeout as the latest
-- replace_allocator_equity_snapshots (20260602183000), the function it stands
-- beside. The cost of choosing DEFINER over the INVOKER choice of
-- 20261026120000 is that the write to allocator_equity_derived, a FORCE ROW LEVEL
-- SECURITY table whose only write policy is auth.role() = 'service_role', must
-- succeed on the service-role call path. The lane probe
-- analytics-service/tests/test_replace_snapshots_window_live.py proves exactly
-- that through PostgREST.
--
-- ERRCODE map
--   22023  malformed input; the message is `replace_allocator_equity_snapshots_window:
--          <token>` with token one of allocator_required, window_start_required,
--          rows_not_a_nonempty_array, row_asof_missing, row_before_window,
--          duplicate_asof.
--   P0001  the bare message `history_days_unreproduced`, DETAIL a count and
--          nothing else. The worker maps it by APIError class, code and whole
--          message, never by DETAIL.
--   Never 40001: PostgREST re-runs a transaction that raised it without bound
--   (Phase 164.9.3.2), and a refusal here is final.
--
-- ⛔ NO DATA CENSUS RUNS INSIDE THIS MIGRATION. Shared TEST holds PROD's catalogue
-- and none of its data, and a failed TEST apply blocks the PROD apply, so the
-- verify block below reads the catalogue only (pg_proc, pg_namespace,
-- has_function_privilege, to_regprocedure). It reads no table row, and the
-- function body, which does read rows, runs only when the worker calls it.
--
-- ⛔ DEPLOY ORDER. Merging supabase/migrations/** applies to TEST and then to PROD
-- with no human stop, before the worker that calls this function deploys. Only a
-- forced rebuild calls it, so an OLD worker never does, and nothing calls it until
-- a later plan of this phase wires the forced reconstruct to it.
--
-- Rollback (manual, off the auto-apply path):
-- supabase/migrations/down/20261028120000-rollback.sql
-- ============================================================================

BEGIN;

SET LOCAL lock_timeout = '3s';

-- Schema-qualified CREATE: an unqualified CREATE OR REPLACE resolves against the
-- SESSION search_path and can mint a second function with default privileges.
CREATE OR REPLACE FUNCTION public.replace_allocator_equity_snapshots_window(
  p_allocator_id uuid,
  p_rows         jsonb,     -- array of {asof, value_usd, breakdown, source, pre_terminus_balance_unknown}
  p_depth_months integer,   -- WR-05: applied only to source = 'exchange_primary' rows
  p_window_start date       -- the first day the payload replaces; older days are kept
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
SET lock_timeout = '3s'
AS $fn$
DECLARE
  v_inserted     integer;
  v_unreproduced integer;
  v_bad          integer;
BEGIN
  -- ===== 1. NULL-explicit guards. A comparison against a NULL argument is NULL,
  --          plpgsql takes the ELSE branch on a NULL condition, and a guard
  --          written as `x <> y` would silently pass; each test below is spelled
  --          IS NULL or IS DISTINCT FROM so a NULL can never get through.
  IF p_allocator_id IS NULL THEN
    RAISE EXCEPTION 'replace_allocator_equity_snapshots_window: allocator_required'
      USING ERRCODE = '22023';
  END IF;
  IF p_window_start IS NULL THEN
    RAISE EXCEPTION 'replace_allocator_equity_snapshots_window: window_start_required'
      USING ERRCODE = '22023';
  END IF;
  -- Nested on purpose: plpgsql does not promise short-circuit evaluation, and
  -- jsonb_array_length raises on a non-array.
  IF p_rows IS NULL THEN
    RAISE EXCEPTION 'replace_allocator_equity_snapshots_window: rows_not_a_nonempty_array'
      USING ERRCODE = '22023';
  END IF;
  IF jsonb_typeof(p_rows) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'replace_allocator_equity_snapshots_window: rows_not_a_nonempty_array'
      USING ERRCODE = '22023';
  END IF;
  IF jsonb_array_length(p_rows) = 0 THEN
    RAISE EXCEPTION 'replace_allocator_equity_snapshots_window: rows_not_a_nonempty_array'
      USING ERRCODE = '22023';
  END IF;

  -- An element with no asof, or a JSON null asof (an element that is not an
  -- object has no asof either: `->` on a scalar is SQL NULL).
  SELECT count(*) INTO v_bad
    FROM jsonb_array_elements(p_rows) e
   WHERE (e -> 'asof') IS NULL OR jsonb_typeof(e -> 'asof') = 'null';
  IF v_bad > 0 THEN
    RAISE EXCEPTION 'replace_allocator_equity_snapshots_window: row_asof_missing'
      USING ERRCODE = '22023';
  END IF;

  SELECT count(*) INTO v_bad
    FROM jsonb_to_recordset(p_rows) AS r(asof date)
   WHERE r.asof < p_window_start;
  IF v_bad > 0 THEN
    RAISE EXCEPTION 'replace_allocator_equity_snapshots_window: row_before_window'
      USING ERRCODE = '22023';
  END IF;

  SELECT count(*) - count(DISTINCT r.asof) INTO v_bad
    FROM jsonb_to_recordset(p_rows) AS r(asof date);
  IF v_bad > 0 THEN
    RAISE EXCEPTION 'replace_allocator_equity_snapshots_window: duplicate_asof'
      USING ERRCODE = '22023';
  END IF;

  -- ===== 2. H-1186: serialize against delete_allocator_api_key and against
  --          replace_allocator_equity_snapshots on the same per-allocator key, so
  --          a concurrent last-key cascade cannot interleave with this replace.
  PERFORM pg_advisory_xact_lock(hashtext('alloc:' || p_allocator_id::text));

  -- ===== 3. D-02. The purge of the window and the check of what it purged are
  --          ONE statement: the days compared are the days the DELETE returned,
  --          not a read taken earlier. NOT EXISTS, never NOT IN, so a NULL can
  --          never hide a day. A day the payload does not carry raises, and the
  --          raise rolls the DELETE back with everything else.
  WITH del AS (
    DELETE FROM public.allocator_equity_snapshots s
     WHERE s.allocator_id = p_allocator_id
       AND s.asof >= p_window_start
    RETURNING s.asof
  )
  SELECT count(*) INTO v_unreproduced
    FROM del d
   WHERE NOT EXISTS (
           SELECT 1
             FROM jsonb_to_recordset(p_rows) AS r(asof date)
            WHERE r.asof = d.asof);
  IF v_unreproduced > 0 THEN
    RAISE EXCEPTION 'history_days_unreproduced' USING ERRCODE = 'P0001', DETAIL = v_unreproduced::text;
  END IF;

  -- ===== 4. Insert the rebuilt window. Re-based VERBATIM on the projection of
  --          replace_allocator_equity_snapshots (20260602183000): the seven
  --          columns, the WR-05 depth rule, and CL9's pre_terminus_balance_unknown
  --          with COALESCE to false. Dropping the CL9 column would silently revert
  --          NEW-C01-11 and re-expose the OKX-terminus garbage equity curve.
  WITH ins AS (
    INSERT INTO public.allocator_equity_snapshots (
      allocator_id, asof, value_usd, breakdown, source, history_depth_months,
      pre_terminus_balance_unknown
    )
    SELECT
      p_allocator_id,
      r.asof,
      r.value_usd,
      r.breakdown,
      r.source,
      CASE WHEN r.source = 'exchange_primary' THEN p_depth_months ELSE NULL END,
      COALESCE(r.pre_terminus_balance_unknown, false)
    FROM jsonb_to_recordset(p_rows) AS r(
      asof                          DATE,
      value_usd                     NUMERIC,
      breakdown                     JSONB,
      source                        TEXT,
      pre_terminus_balance_unknown  BOOLEAN
    )
    ON CONFLICT (allocator_id, asof) DO NOTHING
    RETURNING 1
  )
  SELECT count(*) INTO v_inserted FROM ins;

  -- ===== 5. D-03. The seam. A row older than the window that is still there is
  --          a kept day, and the window start is where the rebuilt days begin.
  IF EXISTS (SELECT 1
               FROM public.allocator_equity_snapshots s
              WHERE s.allocator_id = p_allocator_id
                AND s.asof < p_window_start) THEN
    INSERT INTO public.allocator_equity_derived (allocator_id, kind, payload)
    VALUES (p_allocator_id, 'snapshot_rebuild_boundary',
            jsonb_build_object('boundary_date', to_char(p_window_start, 'YYYY-MM-DD')))
    ON CONFLICT (allocator_id, kind)
    DO UPDATE SET payload = EXCLUDED.payload, computed_at = now();
  ELSE
    DELETE FROM public.allocator_equity_derived d
     WHERE d.allocator_id = p_allocator_id
       AND d.kind = 'snapshot_rebuild_boundary';
  END IF;

  RETURN v_inserted;
END;
$fn$;

REVOKE ALL ON FUNCTION public.replace_allocator_equity_snapshots_window(uuid, jsonb, integer, date)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.replace_allocator_equity_snapshots_window(uuid, jsonb, integer, date)
  TO service_role;

COMMENT ON FUNCTION public.replace_allocator_equity_snapshots_window(uuid, jsonb, integer, date) IS
  'Phase 167.2.1.1.2 ACCTREBUILD. Replaces only the window of an allocator''s equity history, in ONE transaction under the per-allocator advisory lock (H-1186, key hashtext(''alloc:''||allocator), the same as replace_allocator_equity_snapshots): DELETE the allocator''s allocator_equity_snapshots rows with asof >= p_window_start, refuse if any DELETEd day is missing from p_rows (RAISE history_days_unreproduced, P0001, DETAIL a count; the raise rolls the DELETE back), INSERT p_rows (WR-05 depth rule, pre_terminus_balance_unknown persisted). Days older than the window are untouched. Records the seam as one allocator_equity_derived row, kind snapshot_rebuild_boundary, payload {boundary_date: YYYY-MM-DD}, when an older day is kept, and deletes that row when none is. ERRCODE map: 22023 = malformed input (allocator_required, window_start_required, rows_not_a_nonempty_array, row_asof_missing, row_before_window, duplicate_asof); P0001 = history_days_unreproduced. Never 40001. SECURITY DEFINER; EXECUTE for service_role only.';

-- ───────────── self-verify: CATALOGUE ONLY, passes on an empty database.
-- No row is read. Deliberately NOT asserted here: the COALESCE projection, the
-- boundary IF condition, the DELETE predicate and the D-02 IF. A verify block that
-- checked them would abort the apply of a mutated copy of this file, and the SQL
-- gate that mutates those lines needs that apply to succeed in order to go RED on
-- the behaviour instead.
DO $verify$
DECLARE
  v_oid    oid := to_regprocedure('public.replace_allocator_equity_snapshots_window(uuid,jsonb,integer,date)');
  v_n      integer;
  v_secdef boolean;
  v_cfg    text[];
  v_src    text;
BEGIN
  SELECT count(*) INTO v_n
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'replace_allocator_equity_snapshots_window';
  IF v_n <> 1 OR v_oid IS NULL THEN
    RAISE EXCEPTION 'Migration 20261028120000 failed: expected exactly one public.replace_allocator_equity_snapshots_window(uuid, jsonb, integer, date), found % overloads', v_n;
  END IF;

  SELECT p.prosecdef, p.proconfig, p.prosrc INTO v_secdef, v_cfg, v_src FROM pg_proc p WHERE p.oid = v_oid;
  IF NOT v_secdef THEN
    RAISE EXCEPTION 'Migration 20261028120000 failed: replace_allocator_equity_snapshots_window must be SECURITY DEFINER';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM unnest(COALESCE(v_cfg, ARRAY[]::text[])) c
                  WHERE regexp_replace(c, '\s', '', 'g') = 'search_path=public,pg_temp') THEN
    RAISE EXCEPTION 'Migration 20261028120000 failed: replace_allocator_equity_snapshots_window does not pin search_path to public, pg_temp';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM unnest(COALESCE(v_cfg, ARRAY[]::text[])) c
                  WHERE regexp_replace(c, '\s', '', 'g') = 'lock_timeout=3s') THEN
    RAISE EXCEPTION 'Migration 20261028120000 failed: replace_allocator_equity_snapshots_window does not carry lock_timeout = 3s';
  END IF;

  IF has_function_privilege('anon', v_oid, 'EXECUTE')
     OR has_function_privilege('authenticated', v_oid, 'EXECUTE') THEN
    RAISE EXCEPTION 'Migration 20261028120000 failed: anon or authenticated can EXECUTE replace_allocator_equity_snapshots_window';
  END IF;
  IF NOT has_function_privilege('service_role', v_oid, 'EXECUTE') THEN
    RAISE EXCEPTION 'Migration 20261028120000 failed: service_role cannot EXECUTE replace_allocator_equity_snapshots_window';
  END IF;

  -- H-1186: serialization only works if every writer hashes the IDENTICAL key
  -- string. A typo in the prefix would pass a "has a lock" check and silently
  -- defeat it, so the key text itself is asserted (as 20260602183000 does).
  IF position('hashtext(''alloc:'' ||' IN v_src) = 0 THEN
    RAISE EXCEPTION 'Migration 20261028120000 failed: replace_allocator_equity_snapshots_window lock key is not the alloc-scoped hashtext prefix - H-1186 serialization would not match delete_allocator_api_key';
  END IF;

  -- The function this one stands beside must still be there, unchanged in name.
  IF to_regprocedure('public.replace_allocator_equity_snapshots(uuid,jsonb,integer)') IS NULL THEN
    RAISE EXCEPTION 'Migration 20261028120000 failed: public.replace_allocator_equity_snapshots(uuid, jsonb, integer) is gone';
  END IF;

  RAISE NOTICE 'Migration 20261028120000: public.replace_allocator_equity_snapshots_window(uuid, jsonb, integer, date) is the only overload, SECURITY DEFINER, search_path and lock_timeout pinned, H-1186 lock key present, EXECUTE for service_role only; replace_allocator_equity_snapshots is still in place.';
END
$verify$;

COMMIT;
