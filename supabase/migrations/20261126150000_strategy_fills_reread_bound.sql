-- Phase 253 BINANCECURSOR — a per-STRATEGY re-read bound for a stopped Binance fills read.
--
-- Background.
--   `run_sync_trades_job` resumes a Binance raw fills read from one PER-KEY column,
--   `api_keys.last_fetched_trade_timestamp`, written only through the fenced
--   `advance_sync_cursor` RPC and forward-only. When a read stops (deadline, page
--   cap), loses a symbol, or raises, the span below the stop is unread, yet a clean
--   run on a SIBLING strategy that shares the key moves the column forward again. The
--   stopped strategy then seeds past data it never read, and no later run re-reads it.
--   The column is shared by every strategy on the key, so it is the wrong place for a
--   bound that only the strategy that stopped may move (phase 253 CONTEXT D-01/D-02).
--
-- What this file ships.
--   * `strategy_fills_reread_bounds`: at most one row per strategy, `unread_from` is
--     the earliest instant the run was COMPLETE THROUGH when it stopped. The next run's
--     seed takes the minimum of the key column and this bound, so the column keeps
--     being the per-key resume point and this row only LOWERS one strategy's seed.
--   * `set_strategy_fills_reread_bound`: the ONE writer. Claim-token fenced exactly like
--     the cursor RPC (an orphaned worker returns FALSE and writes nothing).
--
-- The state machine, in the order the function applies it (D-05):
--   R0  no row, NULL            nothing (the read was complete and nothing is pending)
--   R1  no row, value           insert
--   R2  other key, value        replace key and instant (a re-point of the strategy)
--   R3  other key, NULL         delete (the bound named another key's history)
--   R4  same key, value, covers set the bound to the run's instant (no stall: a run that
--                               read below the stored bound and stopped LATER must move
--                               the bound FORWARD, or a repeated stop re-reads the same
--                               span for ever)
--   R5  same key, value, not    LEAST of stored and new (the bound only moves earlier)
--       covers
--   R6  same key, NULL, covers  delete (a complete run read through the stored bound)
--   R7  same key, NULL, not     keep (a complete run that did not reach the bound proves
--       covers                  nothing about it)
-- `covers` is `p_covers_from IS NOT NULL AND p_covers_from <= stored bound` (inclusive).
-- `p_covers_from` NULL means "covered nothing known" and never clears or advances.
-- A row is deleted rather than upserted to NULL because a bound has no "none" value, so
-- the function takes the row lock (FOR UPDATE) and serialises two calls on one strategy.
--
-- WHAT THIS FILE DOES NOT DO
-- --------------------------
-- 1. It leaves the per-key cursor RPC, its migration, its ACL and its function snapshot
--    byte-unchanged (D-04: OKX, Bybit, Deribit and MT5 callers do not move).
-- 2. It does NOT put the bound on `strategy_sync_cursors`: a bound row there would be read
--    as "this strategy is HELD" by the cron fan-out (RESEARCH), a different meaning.
-- 3. It registers NO scheduled job and seeds NO row.
--
-- Self-verify posture. The DO block at the foot reads CATALOGS ONLY and never calls the
-- function. Shared TEST holds PROD's catalogue and never its data, so a data-dependent
-- assertion could pass PROD and REFUSE TEST, and a refused TEST apply blocks the PROD apply.

BEGIN;

SET LOCAL lock_timeout = '3s';
SET LOCAL search_path = public, pg_catalog;

-- --------------------------------------------------------------------------
-- STEP 1: the container
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS strategy_fills_reread_bounds (
  strategy_id UUID PRIMARY KEY REFERENCES strategies(id) ON DELETE CASCADE,
  api_key_id  UUID NOT NULL REFERENCES api_keys(id) ON DELETE CASCADE,
  unread_from TIMESTAMPTZ NOT NULL,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE strategy_fills_reread_bounds IS
  'Internal sync resume state: at most one row per strategy, the earliest instant a stopped Binance fills read is complete through, so the next run re reads from there. Sole writer is the analytics worker sync_trades epilogue, through set_strategy_fills_reread_bound. api_keys.last_fetched_trade_timestamp stays the per key resume point and this row only LOWERS one strategy seed. RLS is deny all with no owner tier. See phase 253.';

COMMENT ON COLUMN strategy_fills_reread_bounds.strategy_id IS
  'The whole primary key. Cascades on strategy deletion. See phase 253.';

COMMENT ON COLUMN strategy_fills_reread_bounds.api_key_id IS
  'The api key whose history this bound names. A bound for another key is replaced or deleted by the writer, never carried across a re point. Cascades on key deletion, which is how sanitize_user erases it. See phase 253.';

COMMENT ON COLUMN strategy_fills_reread_bounds.unread_from IS
  'The earliest instant the stopped run was complete through: every symbol it stopped on is read up to here and nothing past it is promised. The next seed is the minimum of this and the key column. Never set past what the caller says the run is complete through. See phase 253.';

COMMENT ON COLUMN strategy_fills_reread_bounds.updated_at IS
  'When the bound was last written. Set by the writer on every write. See phase 253.';

-- --------------------------------------------------------------------------
-- STEP 2: RLS deny all, grants service_role only
-- --------------------------------------------------------------------------
-- Same posture as the per strategy cursor table (20260919120000): zero SECURITY DEFINER
-- readers and no owner tier, so no FORCE (the SECDEF writer below runs as the owner and
-- FORCE would degrade it closed and silent). Trigger to revisit: an owner facing policy
-- tier or a SECURITY DEFINER reader is added.
ALTER TABLE strategy_fills_reread_bounds ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS strategy_fills_reread_bounds_deny_all ON strategy_fills_reread_bounds;
CREATE POLICY strategy_fills_reread_bounds_deny_all ON strategy_fills_reread_bounds
  FOR ALL
  USING (false)
  WITH CHECK (false);

COMMENT ON POLICY strategy_fills_reread_bounds_deny_all ON strategy_fills_reread_bounds IS
  'Service role only. Non service callers get zero rows and can write none. No owner facing tier exists, so the narrower USING (false) form is used; service_role bypasses RLS by default per ADR 0003. See phase 253.';

-- The REVOKE is the only control reaching the RLS exempt verbs (TRUNCATE, TRIGGER,
-- REFERENCES) and survives a later DISABLE ROW LEVEL SECURITY. The GRANT is the positive
-- half: BYPASSRLS is a row level exemption and confers no object privilege.
REVOKE ALL ON TABLE strategy_fills_reread_bounds FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE strategy_fills_reread_bounds TO service_role;

-- --------------------------------------------------------------------------
-- STEP 3: the one fenced writer
-- --------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.set_strategy_fills_reread_bound(
  p_strategy_id  UUID,
  p_api_key_id   UUID,
  p_job_id       UUID,
  p_claim_token  UUID        DEFAULT NULL,
  p_unread_from  TIMESTAMPTZ DEFAULT NULL,
  p_covers_from  TIMESTAMPTZ DEFAULT NULL
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_found         BOOLEAN;
  v_existing_key  UUID;
  v_existing_from TIMESTAMPTZ;
  v_covers        BOOLEAN;
BEGIN
  IF p_strategy_id IS NULL OR p_api_key_id IS NULL THEN
    RAISE EXCEPTION 'set_strategy_fills_reread_bound: p_strategy_id and p_api_key_id are required'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  -- Ownership fence, the same shape the per key cursor RPC uses. Only active when a
  -- token is supplied; a NULL token is the WORKER_FENCE_V2 kill-switch arm.
  IF p_claim_token IS NOT NULL THEN
    IF p_job_id IS NULL THEN
      RAISE EXCEPTION 'set_strategy_fills_reread_bound: p_job_id is required when p_claim_token is supplied'
        USING ERRCODE = 'invalid_parameter_value';
    END IF;

    IF NOT EXISTS (
      SELECT 1
        FROM public.compute_jobs
       WHERE id = p_job_id
         AND status = 'running'
         AND claim_token = p_claim_token
    ) THEN
      -- Orphan: the watchdog reclaimed this job. Drop the write rather than race
      -- the owner; the caller reads FALSE as "not mine" and writes nothing.
      RETURN FALSE;
    END IF;
  END IF;

  SELECT b.api_key_id, b.unread_from
    INTO v_existing_key, v_existing_from
    FROM public.strategy_fills_reread_bounds b
   WHERE b.strategy_id = p_strategy_id
     FOR UPDATE;
  v_found := FOUND;

  IF NOT v_found THEN
    IF p_unread_from IS NOT NULL THEN
      -- R1. The conflict arm is the race the one in flight index and the fence make
      -- unreachable; LEAST is its safe direction (the bound only moves earlier).
      INSERT INTO public.strategy_fills_reread_bounds (strategy_id, api_key_id, unread_from, updated_at)
        VALUES (p_strategy_id, p_api_key_id, p_unread_from, now())
      ON CONFLICT (strategy_id) DO UPDATE
        SET api_key_id  = EXCLUDED.api_key_id,
            unread_from = CASE
              WHEN public.strategy_fills_reread_bounds.api_key_id = EXCLUDED.api_key_id
                THEN LEAST(public.strategy_fills_reread_bounds.unread_from, EXCLUDED.unread_from)
              ELSE EXCLUDED.unread_from
            END,
            updated_at  = now();
    END IF;
    -- R0 falls through here: no row and nothing pending.
    RETURN TRUE;
  END IF;

  IF v_existing_key IS DISTINCT FROM p_api_key_id THEN
    IF p_unread_from IS NULL THEN
      -- R3: the stored bound names another key's history and this run is complete.
      DELETE FROM public.strategy_fills_reread_bounds
       WHERE strategy_id = p_strategy_id AND api_key_id = v_existing_key;
    ELSE
      -- R2: re-point. The new key's instant replaces the old key's, never LEAST of them.
      UPDATE public.strategy_fills_reread_bounds
         SET api_key_id = p_api_key_id, unread_from = p_unread_from, updated_at = now()
       WHERE strategy_id = p_strategy_id;
    END IF;
    RETURN TRUE;
  END IF;

  v_covers := p_covers_from IS NOT NULL AND p_covers_from <= v_existing_from;

  IF p_unread_from IS NOT NULL THEN
    IF v_covers THEN
      -- R4: the run read below the stored bound, so its own instant is the new bound.
      UPDATE public.strategy_fills_reread_bounds
         SET unread_from = p_unread_from, updated_at = now()
       WHERE strategy_id = p_strategy_id;
    ELSE
      -- R5: the run did not reach the stored bound; the bound only moves earlier.
      UPDATE public.strategy_fills_reread_bounds
         SET unread_from = LEAST(v_existing_from, p_unread_from), updated_at = now()
       WHERE strategy_id = p_strategy_id;
    END IF;
  ELSIF v_covers THEN
    -- R6: a complete run read through the stored bound.
    DELETE FROM public.strategy_fills_reread_bounds
     WHERE strategy_id = p_strategy_id AND api_key_id = p_api_key_id;
  ELSE
    -- R7: a complete run that did not reach the bound proves nothing about it.
    NULL;
  END IF;

  RETURN TRUE;
END;
$$;

COMMENT ON FUNCTION public.set_strategy_fills_reread_bound(UUID, UUID, UUID, UUID, TIMESTAMPTZ, TIMESTAMPTZ) IS
  'Fenced writer of strategy_fills_reread_bounds (phase 253). With a claim token it returns FALSE and writes nothing unless the compute job is still running under that token; a NULL token skips the fence. Rules: a value with no row inserts; a value for another key replaces key and instant; NULL for another key deletes; same key with a value sets the instant when the run covered the stored bound and takes the earlier one when it did not; same key with NULL deletes when the run covered the bound and keeps it otherwise. covers means p_covers_from <= the stored bound, and -infinity means the walk started at the venue reach. The analytics worker sync_trades epilogue is the sole caller.';

REVOKE ALL ON FUNCTION public.set_strategy_fills_reread_bound(UUID, UUID, UUID, UUID, TIMESTAMPTZ, TIMESTAMPTZ)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_strategy_fills_reread_bound(UUID, UUID, UUID, UUID, TIMESTAMPTZ, TIMESTAMPTZ)
  TO service_role;

-- --------------------------------------------------------------------------
-- STEP 4: self-verifying DO block, CATALOGS ONLY
-- --------------------------------------------------------------------------
-- No SELECT from any data table and no call of the function: a probe row would need an
-- auth.users, profiles, strategies and api_keys chain the apply must not depend on.
DO $verify$
DECLARE
  v_pk_cols   TEXT;
  v_rls       BOOLEAN;
  v_polcmd    "char";
  v_secdef    BOOLEAN;
  v_config    TEXT[];
  v_oid       OID;
  v_client    TEXT;
BEGIN
  IF to_regclass('public.strategy_fills_reread_bounds') IS NULL THEN
    RAISE EXCEPTION 'Phase 253 failed: table public.strategy_fills_reread_bounds was not created';
  END IF;

  SELECT string_agg(a.attname, ',' ORDER BY a.attname)
    INTO v_pk_cols
    FROM pg_constraint c
    JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY (c.conkey)
   WHERE c.conrelid = 'public.strategy_fills_reread_bounds'::regclass
     AND c.contype = 'p';
  IF v_pk_cols IS DISTINCT FROM 'strategy_id' THEN
    RAISE EXCEPTION 'Phase 253 failed: primary key of strategy_fills_reread_bounds is (%), expected exactly (strategy_id)', COALESCE(v_pk_cols, '<none>');
  END IF;

  SELECT relrowsecurity INTO v_rls
    FROM pg_class WHERE oid = 'public.strategy_fills_reread_bounds'::regclass;
  IF NOT COALESCE(v_rls, FALSE) THEN
    RAISE EXCEPTION 'Phase 253 failed: row level security is not enabled on strategy_fills_reread_bounds';
  END IF;

  SELECT p.polcmd INTO v_polcmd
    FROM pg_policy p
   WHERE p.polrelid = 'public.strategy_fills_reread_bounds'::regclass
     AND p.polname = 'strategy_fills_reread_bounds_deny_all';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Phase 253 failed: policy strategy_fills_reread_bounds_deny_all is missing';
  END IF;
  IF v_polcmd IS DISTINCT FROM '*' THEN
    RAISE EXCEPTION 'Phase 253 failed: policy strategy_fills_reread_bounds_deny_all has polcmd %, expected * (FOR ALL)', v_polcmd;
  END IF;

  v_oid := to_regprocedure('public.set_strategy_fills_reread_bound(uuid,uuid,uuid,uuid,timestamptz,timestamptz)');
  IF v_oid IS NULL THEN
    RAISE EXCEPTION 'Phase 253 failed: function public.set_strategy_fills_reread_bound was not created';
  END IF;

  SELECT prosecdef, proconfig INTO v_secdef, v_config FROM pg_proc WHERE oid = v_oid;
  IF NOT COALESCE(v_secdef, FALSE) THEN
    RAISE EXCEPTION 'Phase 253 failed: set_strategy_fills_reread_bound is not SECURITY DEFINER';
  END IF;
  IF NOT ('search_path=public, pg_catalog' = ANY (COALESCE(v_config, ARRAY[]::TEXT[]))) THEN
    RAISE EXCEPTION 'Phase 253 failed: set_strategy_fills_reread_bound does not pin search_path to public, pg_catalog (proconfig %)', v_config;
  END IF;

  -- EXECUTE grantees: PUBLIC (grantee 0), anon and authenticated hold none; service_role holds it.
  SELECT string_agg(COALESCE(r.rolname, 'PUBLIC'), ',' ORDER BY COALESCE(r.rolname, 'PUBLIC'))
    INTO v_client
    FROM pg_proc p
    CROSS JOIN LATERAL aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) AS a
    LEFT JOIN pg_roles r ON r.oid = a.grantee
   WHERE p.oid = v_oid
     AND a.privilege_type = 'EXECUTE'
     AND (a.grantee = 0 OR r.rolname IN ('anon', 'authenticated'));
  IF v_client IS NOT NULL THEN
    RAISE EXCEPTION 'Phase 253 failed: client roles (%) can EXECUTE set_strategy_fills_reread_bound', v_client;
  END IF;
  IF NOT has_function_privilege('service_role', v_oid, 'EXECUTE') THEN
    RAISE EXCEPTION 'Phase 253 failed: service_role cannot EXECUTE set_strategy_fills_reread_bound';
  END IF;
END
$verify$;

COMMIT;
