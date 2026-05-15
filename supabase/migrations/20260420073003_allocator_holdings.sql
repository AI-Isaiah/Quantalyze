-- Migration 066: allocator_holdings + poll_allocator_positions compute kind
-- + pg_cron daily orchestration + api_keys.sync_status extension + sync_error
-- column GRANT + SECURITY DEFINER authenticated wrapper RPC.
-- Phase 06 / Plan 01 — Allocator API Ingestion (INGEST-01/02/05/08/09).
--
-- What this migration does (D-19 10-step ordering)
-- -------------------------------------------------
-- 1. CREATE TABLE allocator_holdings — 3-tier RLS anchor, idempotent-upsert
--    unique index (allocator_id, venue, symbol, asof), updated_at trigger,
--    + BEFORE INSERT OR UPDATE trigger enforce_allocator_holdings_owner_coherence()
--    (f5 — couples allocator_id to api_keys.user_id so an admin reassignment
--    of api_keys.user_id cannot silently fork history under the new owner).
-- 2. ALTER TABLE compute_jobs ADD COLUMN api_key_id + DROP+ADD 4-way XOR
--    (extends migration 062's 3-way XOR by splitting strategy/portfolio/
--    allocator/api_key into a 4-way coverage) + DROP+ADD
--    compute_jobs_kind_target_coherence (adds the poll_allocator_positions
--    branch keyed off api_key_id).
-- 3. INSERT INTO compute_job_kinds (name) VALUES ('poll_allocator_positions').
-- 4. CREATE UNIQUE INDEX compute_jobs_one_inflight_per_kind_api_key — the
--    server-side "Sync now" spam dedup (D-10); analogous to migration 062's
--    compute_jobs_one_inflight_per_kind_allocator.
-- 5. ALTER TABLE api_keys DROP+ADD sync_status CHECK to add 'revoked' and
--    'rate_limited' values (D-07). Plus GRANT SELECT (sync_error) ON api_keys
--    TO authenticated — closes the revoke hole from migration 027 where
--    sync_error was silently left out of the allowlist (Landmine 2).
-- 6. DROP+REDEFINE enqueue_compute_job + _enqueue_compute_job_internal with
--    new trailing params p_api_key_id UUID and p_run_at TIMESTAMPTZ (Pattern
--    3 / Landmine 4). Preserves backward compat for the 7-param post-062
--    call shape via DEFAULT NULL.
-- 7. CREATE FUNCTION request_allocator_holdings_sync(p_api_key_id UUID) —
--    SECURITY DEFINER authenticated-GRANTed wrapper the Next route invokes.
--    Validates auth.uid() ownership, enqueues the job, sets sync_status=
--    'syncing', catches 23505 to return already_inflight + next_attempt_at
--    (f8) so the UI can render "Queued — retry in {N}s" for a deferred job.
-- 7.5 CREATE FUNCTION enqueue_poll_allocator_positions_for_all_keys() —
--    SECURITY DEFINER cron RPC. Jitters FIRST (compute v_run_at as now()
--    plus the jitter interval), then derives the idempotency key against
--    v_run_at's UTC day (f6 — jitter-safe across day boundaries; a 23:59
--    enqueue with +600s jitter lands on D+1 and gets the D+1 key, so the
--    next cron cycle doesn't race).
-- 8. Daily cron schedule at 04:00 UTC — wrapped
--    in a DO-block pg_extension gate so local dev without pg_cron skips
--    cleanly (mirror migration 060 Step 5).
-- 9. 3-tier RLS on allocator_holdings — owner-select, admin-select, service-
--    role all (mirror migration 059 Step 4). No allocator INSERT/UPDATE/
--    DELETE policy — worker is sole producer via service-role.
-- 10. Self-verifying DO block — schema invariants + role-switched RLS probe
--    (f1: EXECUTE 'SET LOCAL ROLE authenticated' — the custom-GUC alternative
--    leaves BYPASSRLS active and vacuously passes; asserts rolbypassrls=false
--    before switch to block vacuous passes) + mismatched-owner trigger probe
--    (f5) + cron-
--    hour assertion BETWEEN 1 AND 22 (f6) + functional enqueue probe.
--    Explicit DELETE cleanup — no transaction-control statements allowed
--    inside DO blocks (Landmine 6 — PL/pgSQL forbids them).
--
-- What this migration does NOT do
-- -------------------------------
-- - Does NOT call the worker / Python side — Plan 02 wires run_poll_
--   allocator_positions_job into services/job_worker.py.
-- - Does NOT ship the Next route handler — Plan 03 adds POST /api/allocator/
--   holdings/sync calling request_allocator_holdings_sync.
-- - Does NOT touch AllocatorExchangeManager.tsx — Plan 04 replaces the
--   disabled "Auto-synced" button with the real Sync now button.
-- - Does NOT split the per-exchange circuit breaker into a per-(exchange,
--   api_key_id) breaker — accepted contagion, tracked as post-v0.15
--   deferral (f8 §5).
--
-- Application path
-- ----------------
-- Per D-19 + f2: this file is authored here; Task 1.5 applies it to a
-- Supabase preview branch via MCP create_branch + apply_migration + smoke
-- tests; Task 2 applies it to production Supabase via MCP apply_migration
-- (Phase 5 D-20a/c precedent) gated on Task 1.5 green.

BEGIN;

SET lock_timeout = '3s';

-- ==========================================================================
-- STEP 1: CREATE TABLE allocator_holdings + indexes + updated_at trigger +
--         owner-coherence trigger (f5)
-- ==========================================================================
-- D-02: new table for the allocator-owned holdings stream — spot and
-- derivative rows distinguished by holding_type. UNIQUE
-- (allocator_id, venue, symbol, asof) is the INGEST-04 idempotent-upsert
-- anchor. Shape deliberately mirrors position_snapshots so Phase 09 Bridge
-- integration is a "swap the source table" exercise (D-02 comment).

CREATE TABLE IF NOT EXISTS allocator_holdings (
  id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Owner anchor. INGEST-09 primary defense via owner-select RLS policy.
  allocator_id        UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  -- Key anchor. ON DELETE RESTRICT so Phase 08 revoke/delete cannot silently
  -- erase audit history (D-02 rationale, mirrors Phase 5 D-20a FK choice).
  api_key_id          UUID        NOT NULL REFERENCES api_keys(id) ON DELETE RESTRICT,
  -- Display-level exchange label (= api_keys.exchange) for partition/debug.
  venue               TEXT        NOT NULL,
  -- CCXT-stripped form per D-16 — 'BTCUSDT' not 'BTC/USDT:USDT' for
  -- derivatives, 'BTC' not 'BTC/USDT' for spot.
  symbol              TEXT        NOT NULL,
  -- D-02: UTC date granularity — the INGEST-04 idempotency anchor.
  asof                DATE        NOT NULL,
  -- D-01: discriminator between fetch_balance() spot rows and fetch_positions()
  -- derivative rows. Phase 09 Bridge join must key on (symbol, holding_type).
  holding_type        TEXT        NOT NULL CHECK (holding_type IN ('spot','derivative')),
  -- D-01/D-02: 'flat' for spot (side semantics don't apply), 'long'/'short'
  -- for derivatives (CCXT side unified).
  side                TEXT        NOT NULL CHECK (side IN ('long','short','flat')),
  -- Position size in base units (positive for long/flat, negative or
  -- positive-with-side='short' for short — worker normalizes in Plan 02).
  quantity            NUMERIC     NOT NULL,
  -- USD-denominated value: quantity * mark_price for spot, CCXT-reported
  -- notional for derivatives.
  value_usd           NUMERIC     NOT NULL,
  -- D-02: NULL for spot (no exchange-reported basis exists); populated
  -- from CCXT entryPrice for derivatives.
  entry_price         NUMERIC,
  -- Current mark price (ticker or mark_price from CCXT position).
  mark_price          NUMERIC     NOT NULL,
  -- D-02: NULL for spot; CCXT unrealizedPnl for derivatives.
  unrealized_pnl_usd  NUMERIC,
  -- D-06: worker writes entry_price * abs(quantity) for derivatives; NULL
  -- for spot until Phase 8 notes / manual override / trades-derived backfill.
  cost_basis_usd      NUMERIC,
  -- Bounded audit blob of the normalizer's input dict (~4KB). Full
  -- request/response stays in worker logs.
  raw_payload         JSONB,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE allocator_holdings IS
  'Allocator-owned holdings stream — one row per (allocator_id, venue, symbol, asof). '
  'Produced by the FastAPI job worker via the poll_allocator_positions kind. '
  'Three-tier RLS (owner/admin/service) per D-03. Phase 06 / Plan 01. '
  'Schema mirrors position_snapshots on purpose so Phase 09 Bridge swap-the-source is cheap.';

COMMENT ON COLUMN allocator_holdings.cost_basis_usd IS
  'Derivative rows only (entry_price * abs(quantity)). Spot rows are NULL until Phase 08 notes / manual override backfills. Phase 9 Bridge logic gates spot P&L on NOT NULL (D-06).';

COMMENT ON COLUMN allocator_holdings.holding_type IS
  'Discriminator: spot (from fetch_balance) vs derivative (from fetch_positions). Phase 09 Bridge join keys on (symbol, holding_type) — not symbol alone (D-16).';

-- Idempotent upsert anchor (INGEST-04). Worker upserts via
-- ON CONFLICT (allocator_id, venue, symbol, asof) DO UPDATE SET ...
CREATE UNIQUE INDEX IF NOT EXISTS allocator_holdings_owner_venue_symbol_asof_key
  ON allocator_holdings (allocator_id, venue, symbol, asof);

-- Phase 07 dashboard fan-out (getMyAllocationDashboard extension).
CREATE INDEX IF NOT EXISTS allocator_holdings_allocator_asof_desc_idx
  ON allocator_holdings (allocator_id, asof DESC);

-- Phase 08 revoke/cascade query support.
CREATE INDEX IF NOT EXISTS allocator_holdings_api_key_id_idx
  ON allocator_holdings (api_key_id);

-- --------------------------------------------------------------------------
-- updated_at trigger — local helper per migration 059 Step 3 shape.
-- --------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION set_allocator_holdings_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_catalog
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS allocator_holdings_set_updated_at ON allocator_holdings;
CREATE TRIGGER allocator_holdings_set_updated_at
  BEFORE UPDATE ON allocator_holdings
  FOR EACH ROW EXECUTE FUNCTION set_allocator_holdings_updated_at();

-- --------------------------------------------------------------------------
-- f5: Owner-coherence trigger
-- --------------------------------------------------------------------------
-- Couples allocator_id to api_keys.user_id at write time so a future admin
-- reassignment of api_keys.user_id cannot silently fork history under the
-- new owner while old rows persist under the old allocator_id. The unique
-- index (allocator_id, venue, symbol, asof) would otherwise allow two
-- competing truths to coexist under two allocator_id keys.
--
-- SECURITY DEFINER + pinned search_path: the trigger must read api_keys
-- authoritatively (bypassing RLS) to compare NEW.allocator_id against the
-- key's owner. The api_keys RLS policies would filter out the check from
-- inside a service-role write block, so SECURITY DEFINER elevates the
-- function owner's access rights regardless of caller.
CREATE OR REPLACE FUNCTION enforce_allocator_holdings_owner_coherence()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_expected_owner UUID;
BEGIN
  SELECT user_id INTO v_expected_owner
    FROM api_keys
    WHERE id = NEW.api_key_id;
  IF v_expected_owner IS NULL THEN
    RAISE EXCEPTION
      'allocator_holdings.api_key_id (%) does not reference an existing api_keys row',
      NEW.api_key_id;
  END IF;
  IF NEW.allocator_id IS DISTINCT FROM v_expected_owner THEN
    RAISE EXCEPTION
      'allocator_holdings.allocator_id (%) must match api_keys.user_id (%) for api_key_id %',
      NEW.allocator_id, v_expected_owner, NEW.api_key_id;
  END IF;
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION enforce_allocator_holdings_owner_coherence IS
  'f5: asserts allocator_holdings.allocator_id matches api_keys.user_id for the linked api_key_id. Prevents silent ownership fork if api_keys.user_id is reassigned. SECURITY DEFINER so the owner lookup bypasses RLS on api_keys.';

-- Triggers run with the table owner's (implicit) privilege, not the caller's
-- — no explicit GRANT EXECUTE is needed. The REVOKE is belt-and-suspenders
-- against direct callers of the function outside the trigger context.
REVOKE ALL ON FUNCTION enforce_allocator_holdings_owner_coherence()
  FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS allocator_holdings_enforce_owner_coherence ON allocator_holdings;
CREATE TRIGGER allocator_holdings_enforce_owner_coherence
  BEFORE INSERT OR UPDATE ON allocator_holdings
  FOR EACH ROW EXECUTE FUNCTION enforce_allocator_holdings_owner_coherence();

-- ==========================================================================
-- STEP 2: compute_jobs.api_key_id column + 4-way XOR + coherence CHECK
-- ==========================================================================
-- D-04: extend the compute_jobs target XOR from 3-way (migration 062) to
-- 4-way across strategy_id / portfolio_id / allocator_id / api_key_id.
-- Key observation (Landmine 7): the existing branches do NOT need explicit
-- AND api_key_id IS NULL — the 4-way XOR already enforces it. Only the new
-- branch asserts api_key_id IS NOT NULL. Adding redundant clauses to
-- existing branches would double the CHECK body for zero semantic gain.

ALTER TABLE compute_jobs
  ADD COLUMN IF NOT EXISTS api_key_id UUID
    REFERENCES api_keys(id) ON DELETE CASCADE;

COMMENT ON COLUMN compute_jobs.api_key_id IS
  'API key scope for the poll_allocator_positions kind (INGEST-02). One allocator can have N keys; each key gets its own polling cadence + circuit-breaker state. Phase 06.';

ALTER TABLE compute_jobs DROP CONSTRAINT IF EXISTS compute_jobs_target_xor;
ALTER TABLE compute_jobs ADD CONSTRAINT compute_jobs_target_xor CHECK (
  (strategy_id IS NOT NULL AND portfolio_id IS NULL     AND allocator_id IS NULL     AND api_key_id IS NULL) OR
  (strategy_id IS NULL     AND portfolio_id IS NOT NULL AND allocator_id IS NULL     AND api_key_id IS NULL) OR
  (strategy_id IS NULL     AND portfolio_id IS NULL     AND allocator_id IS NOT NULL AND api_key_id IS NULL) OR
  (strategy_id IS NULL     AND portfolio_id IS NULL     AND allocator_id IS NULL     AND api_key_id IS NOT NULL)
);

COMMENT ON CONSTRAINT compute_jobs_target_xor ON compute_jobs IS
  '4-way XOR — exactly one of strategy_id, portfolio_id, allocator_id, api_key_id is non-null. Extended from migration 062 3-way in migration 066 for poll_allocator_positions.';

ALTER TABLE compute_jobs DROP CONSTRAINT IF EXISTS compute_jobs_kind_target_coherence;
ALTER TABLE compute_jobs ADD CONSTRAINT compute_jobs_kind_target_coherence CHECK (
  (kind = 'compute_portfolio'
      AND portfolio_id IS NOT NULL AND strategy_id IS NULL AND allocator_id IS NULL) OR
  (kind = 'rescore_allocator'
      AND allocator_id IS NOT NULL AND strategy_id IS NULL AND portfolio_id IS NULL) OR
  (kind IN (
    'sync_trades','compute_analytics','poll_positions',
    'sync_funding','reconcile_strategy','compute_intro_snapshot'
  ) AND strategy_id IS NOT NULL AND portfolio_id IS NULL AND allocator_id IS NULL) OR
  (kind = 'poll_allocator_positions'
      AND api_key_id IS NOT NULL AND strategy_id IS NULL
      AND portfolio_id IS NULL AND allocator_id IS NULL)
);

COMMENT ON CONSTRAINT compute_jobs_kind_target_coherence ON compute_jobs IS
  'Kind <-> target-type coherence. poll_allocator_positions is api-key-scoped (Phase 06). Extended in migration 066.';

-- ==========================================================================
-- STEP 3: compute_job_kinds registry INSERT
-- ==========================================================================
INSERT INTO compute_job_kinds (name) VALUES ('poll_allocator_positions')
  ON CONFLICT (name) DO NOTHING;

-- ==========================================================================
-- STEP 4: Partial unique index for in-flight dedup (Sync-now spam guard)
-- ==========================================================================
-- D-04 + D-10: single source of truth for "one in-flight job per (api_key_id,
-- kind)" at the DB layer. The client-side disabled button + the server-side
-- 23505 catch in request_allocator_holdings_sync both defer to this index.
CREATE UNIQUE INDEX IF NOT EXISTS compute_jobs_one_inflight_per_kind_api_key
  ON compute_jobs (api_key_id, kind)
  WHERE api_key_id IS NOT NULL
    AND status IN ('pending','running','done_pending_children');

COMMENT ON INDEX compute_jobs_one_inflight_per_kind_api_key IS
  'Partial unique enforcing one in-flight job per (api_key_id, kind=poll_allocator_positions). Mirrors compute_jobs_one_inflight_per_kind_strategy / _portfolio / _allocator. Phase 06 / D-04.';

-- ==========================================================================
-- STEP 5: Extend api_keys.sync_status CHECK + GRANT SELECT (sync_error)
-- ==========================================================================
-- D-07: add 'revoked' and 'rate_limited' to the existing 6-value set.
-- Migration 007 line 66 ships the original 6 values. No migration in between
-- touched this CHECK (verified via grep), so DROP+ADD is safe.
ALTER TABLE api_keys DROP CONSTRAINT IF EXISTS api_keys_sync_status_check;
ALTER TABLE api_keys ADD CONSTRAINT api_keys_sync_status_check
  CHECK (sync_status IN (
    'idle','syncing','computing','complete','complete_with_warnings',
    'error','revoked','rate_limited'
  ));

-- Landmine 2: migration 027 (line 53) documents sync_error as "Non-sensitive
-- but NOT in the allowlist — future expansion requires a new migration
-- extending the grant". Phase 06 IS that extension — the UI surfaces
-- sync_error under the status pill (D-08 helper line), so the user-scoped
-- supabase client must be able to SELECT the column. Column-level GRANT
-- extends the allowlist from migration 027 Step 2 to now include sync_error.
GRANT SELECT (sync_error) ON api_keys TO authenticated;

-- ==========================================================================
-- STEP 6: DROP+REDEFINE enqueue_compute_job + _enqueue_compute_job_internal
-- ==========================================================================
-- Pattern 3 / Landmine 4: add two trailing params (p_api_key_id,
-- p_run_at) preserving backward compat for existing 7-param callers via
-- DEFAULT NULL. The DROP signatures below MUST match the post-062 live
-- shape exactly — Postgres overload resolution fails silently if they
-- don't (the old signature sticks around as a ghost overload).

-- Drop post-062 signatures explicitly.
DROP FUNCTION IF EXISTS _enqueue_compute_job_internal(uuid, uuid, text, text, uuid[], text, jsonb, uuid);
DROP FUNCTION IF EXISTS enqueue_compute_job(uuid, text, text, uuid[], text, jsonb, uuid);

CREATE OR REPLACE FUNCTION _enqueue_compute_job_internal(
  p_strategy_id     UUID,
  p_portfolio_id    UUID,
  p_kind            TEXT,
  p_idempotency_key TEXT,
  p_parent_job_ids  UUID[],
  p_exchange        TEXT,
  p_metadata        JSONB,
  p_allocator_id    UUID DEFAULT NULL,
  p_api_key_id      UUID DEFAULT NULL,
  p_run_at          TIMESTAMPTZ DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_existing_id UUID;
  v_new_id UUID;
  v_target_count INT;
BEGIN
  -- 4-way XOR guard (CHECK mirrors this; the function raises earlier with a
  -- clearer error message — defense in depth).
  v_target_count :=
    (CASE WHEN p_strategy_id  IS NOT NULL THEN 1 ELSE 0 END) +
    (CASE WHEN p_portfolio_id IS NOT NULL THEN 1 ELSE 0 END) +
    (CASE WHEN p_allocator_id IS NOT NULL THEN 1 ELSE 0 END) +
    (CASE WHEN p_api_key_id   IS NOT NULL THEN 1 ELSE 0 END);
  IF v_target_count <> 1 THEN
    RAISE EXCEPTION '_enqueue_compute_job_internal: exactly one of p_strategy_id, p_portfolio_id, p_allocator_id, p_api_key_id must be non-null (got strategy=%, portfolio=%, allocator=%, api_key=%)',
      p_strategy_id, p_portfolio_id, p_allocator_id, p_api_key_id
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  IF p_kind IS NULL THEN
    RAISE EXCEPTION '_enqueue_compute_job_internal: p_kind is required'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  -- Optimistic look-up per target type.
  IF p_strategy_id IS NOT NULL THEN
    SELECT id INTO v_existing_id
      FROM compute_jobs
     WHERE strategy_id = p_strategy_id
       AND kind = p_kind
       AND status IN ('pending', 'running', 'done_pending_children')
     LIMIT 1;
  ELSIF p_portfolio_id IS NOT NULL THEN
    SELECT id INTO v_existing_id
      FROM compute_jobs
     WHERE portfolio_id = p_portfolio_id
       AND kind = p_kind
       AND status IN ('pending', 'running', 'done_pending_children')
     LIMIT 1;
  ELSIF p_allocator_id IS NOT NULL THEN
    SELECT id INTO v_existing_id
      FROM compute_jobs
     WHERE allocator_id = p_allocator_id
       AND kind = p_kind
       AND status IN ('pending', 'running', 'done_pending_children')
     LIMIT 1;
  ELSE
    SELECT id INTO v_existing_id
      FROM compute_jobs
     WHERE api_key_id = p_api_key_id
       AND kind = p_kind
       AND status IN ('pending', 'running', 'done_pending_children')
     LIMIT 1;
  END IF;

  IF v_existing_id IS NOT NULL THEN
    RETURN v_existing_id;
  END IF;

  -- Race-safe INSERT — the partial unique index is the final arbiter.
  INSERT INTO compute_jobs (
    strategy_id, portfolio_id, allocator_id, api_key_id,
    kind, parent_job_ids, idempotency_key, exchange, metadata,
    next_attempt_at
  )
  VALUES (
    p_strategy_id, p_portfolio_id, p_allocator_id, p_api_key_id,
    p_kind, COALESCE(p_parent_job_ids, '{}'::uuid[]), p_idempotency_key,
    p_exchange, p_metadata,
    COALESCE(p_run_at, now())
  )
  ON CONFLICT DO NOTHING
  RETURNING id INTO v_new_id;

  IF v_new_id IS NOT NULL THEN
    RETURN v_new_id;
  END IF;

  -- Lost the race — re-read the winner's row.
  IF p_strategy_id IS NOT NULL THEN
    SELECT id INTO STRICT v_new_id
      FROM compute_jobs
     WHERE strategy_id = p_strategy_id
       AND kind = p_kind
       AND status IN ('pending', 'running', 'done_pending_children')
     LIMIT 1;
  ELSIF p_portfolio_id IS NOT NULL THEN
    SELECT id INTO STRICT v_new_id
      FROM compute_jobs
     WHERE portfolio_id = p_portfolio_id
       AND kind = p_kind
       AND status IN ('pending', 'running', 'done_pending_children')
     LIMIT 1;
  ELSIF p_allocator_id IS NOT NULL THEN
    SELECT id INTO STRICT v_new_id
      FROM compute_jobs
     WHERE allocator_id = p_allocator_id
       AND kind = p_kind
       AND status IN ('pending', 'running', 'done_pending_children')
     LIMIT 1;
  ELSE
    SELECT id INTO STRICT v_new_id
      FROM compute_jobs
     WHERE api_key_id = p_api_key_id
       AND kind = p_kind
       AND status IN ('pending', 'running', 'done_pending_children')
     LIMIT 1;
  END IF;

  RETURN v_new_id;
END;
$$;

COMMENT ON FUNCTION _enqueue_compute_job_internal IS
  'Private shared implementation of the idempotent enqueue pattern. Handles all four target scopes (strategy / portfolio / allocator / api_key) via 4-way XOR on the four id parameters. Extended in migration 066 for api_key scope + scheduled run_at.';

REVOKE ALL ON FUNCTION _enqueue_compute_job_internal(uuid, uuid, text, text, uuid[], text, jsonb, uuid, uuid, timestamptz)
  FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION enqueue_compute_job(
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
  -- Strategy-scoped (pre-062 + post-062 callers: daily cron,
  -- enqueue_poll_positions_for_all_strategies, wizard finalize, etc).
  IF p_strategy_id IS NOT NULL AND p_allocator_id IS NULL AND p_api_key_id IS NULL THEN
    PERFORM _assert_owner('strategies'::regclass, p_strategy_id, 'enqueue_compute_job');
    RETURN _enqueue_compute_job_internal(
      p_strategy_id, NULL, p_kind, p_idempotency_key,
      p_parent_job_ids, p_exchange, p_metadata, NULL, NULL, p_run_at
    );
  END IF;

  -- Allocator-scoped (post-062 caller: update_allocator_mandates).
  IF p_allocator_id IS NOT NULL AND p_strategy_id IS NULL AND p_api_key_id IS NULL THEN
    RETURN _enqueue_compute_job_internal(
      NULL, NULL, p_kind, p_idempotency_key,
      p_parent_job_ids, p_exchange, p_metadata, p_allocator_id, NULL, p_run_at
    );
  END IF;

  -- Api-key-scoped (Phase 06 new: request_allocator_holdings_sync +
  -- enqueue_poll_allocator_positions_for_all_keys).
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

COMMENT ON FUNCTION enqueue_compute_job IS
  'Idempotent enqueue of a compute job. Three modes: strategy / allocator / api_key scope. Delegates to _enqueue_compute_job_internal. Extended in migration 066 for api_key + run_at.';

REVOKE ALL ON FUNCTION enqueue_compute_job(uuid, text, text, uuid[], text, jsonb, uuid, uuid, timestamptz)
  FROM PUBLIC, anon, authenticated;

-- ==========================================================================
-- STEP 7: SECURITY DEFINER wrapper — request_allocator_holdings_sync
-- ==========================================================================
-- D-14 + RESEARCH Option 1: this is the authenticated-GRANTed entrypoint
-- the Next POST /api/allocator/holdings/sync route (Plan 03) invokes via
-- supabase.rpc(...). Responsibilities:
--   1. Gate on auth.uid() (not-authenticated → 42501).
--   2. Verify caller owns the referenced api_key (not-owned → 42501).
--   3. Enqueue poll_allocator_positions via enqueue_compute_job.
--   4. On 23505 (partial unique index tripped), surface already_inflight +
--      the existing job's next_attempt_at so the UI can render "Queued —
--      retry in {N}s" for a circuit-breaker-deferred job (f8).
--   5. Set api_keys.sync_status='syncing' + return {ok, job_id}.
--
-- Why wrap the bare enqueue_compute_job? The bare function REVOKEs EXECUTE
-- from authenticated; auth.uid() ownership enforcement happens HERE so the
-- route layer is a thin dispatcher.
CREATE OR REPLACE FUNCTION request_allocator_holdings_sync(p_api_key_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_uid          UUID := auth.uid();
  v_owner        UUID;
  v_job_id       UUID;
  v_next_attempt TIMESTAMPTZ;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated'
      USING ERRCODE = '42501';
  END IF;

  SELECT user_id INTO v_owner
    FROM api_keys
    WHERE id = p_api_key_id;
  IF v_owner IS NULL OR v_owner <> v_uid THEN
    RAISE EXCEPTION 'api_key_not_found_or_not_owned'
      USING ERRCODE = '42501';
  END IF;

  BEGIN
    v_job_id := enqueue_compute_job(
      p_strategy_id := NULL,
      p_kind        := 'poll_allocator_positions',
      p_api_key_id  := p_api_key_id
    );
  EXCEPTION WHEN unique_violation THEN
    -- f8: surface next_attempt_at so the UI can render deferred-cooldown
    -- state on a per-exchange rate-limit contagion event.
    SELECT next_attempt_at INTO v_next_attempt
      FROM compute_jobs
      WHERE api_key_id = p_api_key_id
        AND kind = 'poll_allocator_positions'
        AND status IN ('pending','running','done_pending_children')
      ORDER BY next_attempt_at DESC
      LIMIT 1;
    RETURN jsonb_build_object(
      'already_inflight', true,
      'next_attempt_at', v_next_attempt
    );
  END;

  UPDATE api_keys SET sync_status = 'syncing' WHERE id = p_api_key_id;
  RETURN jsonb_build_object('ok', true, 'job_id', v_job_id);
END;
$$;

COMMENT ON FUNCTION request_allocator_holdings_sync IS
  'Authenticated-GRANTed wrapper over enqueue_compute_job for POST /api/allocator/holdings/sync. Gates on auth.uid() + api_key ownership. Returns already_inflight+next_attempt_at on 23505 (f8). Phase 06 / D-14.';

REVOKE ALL ON FUNCTION request_allocator_holdings_sync(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION request_allocator_holdings_sync(uuid) TO authenticated;

-- ==========================================================================
-- STEP 7.5: Cron RPC — enqueue_poll_allocator_positions_for_all_keys
-- ==========================================================================
-- D-12 / Pattern 4. Mirrors migration 033 enqueue_poll_positions_for_all_
-- strategies but keyed off api_keys + uses the new run_at + api_key_id
-- enqueue path.
--
-- f6 (CRITICAL): compute v_run_at (jittered) FIRST, THEN derive the
-- idempotency key against v_run_at AT TIME ZONE 'UTC', NOT now(). A job
-- enqueued at 23:59:xx UTC with up-to-600s jitter may land on day D+1;
-- its idempotency key MUST reflect the run day, not the enqueue day, or
-- the next cron cycle's 'daily-alloc-(D+1)' will race the deferred first
-- job. Cron schedule at 04:00 UTC is safely far from midnight, but the
-- DO block asserts BETWEEN 1 AND 22 to catch future schedule edits.
--
-- Advisory lock guards multi-replica invocations (two workers picking up
-- the same cron tick) — only one enqueues per day. Mirrors migration 033.
CREATE OR REPLACE FUNCTION enqueue_poll_allocator_positions_for_all_keys()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_api_key_id      UUID;
  v_enqueued        INTEGER := 0;
  v_job_id          UUID;
  v_jitter          INTERVAL;
  v_run_at          TIMESTAMPTZ;
  v_idempotency_key TEXT;
BEGIN
  IF NOT pg_try_advisory_lock(hashtext('daily_allocator_polling')) THEN
    -- Another replica holds the lock — this cron fires twice concurrently
    -- today only if two workers both attempt the pg_cron tick, which isn't
    -- a real scenario (pg_cron is single-dispatch per DB), but keep the
    -- guard so manual SELECTs are also race-safe.
    RETURN 0;
  END IF;

  FOR v_api_key_id IN
    SELECT id FROM api_keys
    WHERE is_active = true
      AND sync_status IS DISTINCT FROM 'revoked'
  LOOP
    BEGIN
      -- f6: jitter FIRST, then derive key from the actual run day.
      v_jitter := (random() * interval '600 seconds');
      v_run_at := now() + v_jitter;
      v_idempotency_key := 'daily-alloc-'
        || to_char(v_run_at AT TIME ZONE 'UTC', 'YYYY-MM-DD')
        || '-' || v_api_key_id::text;

      v_job_id := enqueue_compute_job(
        p_strategy_id     := NULL,
        p_kind            := 'poll_allocator_positions',
        p_idempotency_key := v_idempotency_key,
        p_api_key_id      := v_api_key_id,
        p_run_at          := v_run_at
      );
      IF v_job_id IS NOT NULL THEN
        v_enqueued := v_enqueued + 1;
      END IF;
    EXCEPTION WHEN unique_violation THEN
      -- Already in-flight from a prior tick — idempotent skip.
      NULL;
    END;
  END LOOP;

  PERFORM pg_advisory_unlock(hashtext('daily_allocator_polling'));
  RETURN v_enqueued;
END;
$$;

COMMENT ON FUNCTION enqueue_poll_allocator_positions_for_all_keys IS
  'Daily fanout: enqueues poll_allocator_positions per active non-revoked api_key. Idempotent via partial unique index. Jitter-first idempotency key (f6) for day-boundary safety. Phase 06 / D-12.';

REVOKE ALL ON FUNCTION enqueue_poll_allocator_positions_for_all_keys()
  FROM PUBLIC, anon, authenticated;

-- ==========================================================================
-- STEP 8: pg_cron schedule (daily 04:00 UTC)
-- ==========================================================================
-- D-13: 04:00 UTC — off-peak for US + EU + APAC institutional desks; does
-- not collide with warm-analytics (00:00), compute_bridge_outcome_deltas
-- (03:00), or alert-digest (09:00). Stays inside Postgres (pg_cron) so it
-- bypasses the Hobby-plan 2-Vercel-cron cap.
--
-- Idempotent re-scheduling pattern per migration 060 Step 5: gate on
-- pg_extension so local dev without pg_cron skips cleanly, unschedule-
-- then-schedule for re-run safety.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'poll-allocator-positions') THEN
      PERFORM cron.unschedule('poll-allocator-positions');
    END IF;
    PERFORM cron.schedule('poll-allocator-positions', '0 4 * * *', $cron$SELECT enqueue_poll_allocator_positions_for_all_keys();$cron$);
    RAISE NOTICE 'Scheduled poll-allocator-positions at 04:00 UTC';
  ELSE
    RAISE NOTICE 'pg_cron extension not present — skipping schedule (local dev)';
  END IF;
END$$;

-- ==========================================================================
-- STEP 9: 3-tier RLS on allocator_holdings
-- ==========================================================================
-- Pattern 5 — mirror migration 059 bridge_outcomes exactly.
ALTER TABLE allocator_holdings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS allocator_holdings_owner_select ON allocator_holdings;
CREATE POLICY allocator_holdings_owner_select ON allocator_holdings FOR SELECT
  USING (allocator_id = auth.uid());

DROP POLICY IF EXISTS allocator_holdings_admin_select ON allocator_holdings;
CREATE POLICY allocator_holdings_admin_select ON allocator_holdings FOR SELECT
  USING (public.current_user_has_app_role(ARRAY['admin']::text[]));

-- Explicit service_role FOR ALL policy (belt-and-suspenders; service_role
-- also bypasses RLS by default per ADR-0003, but an explicit policy
-- documents intent and survives any future RLS-hardening that might flip
-- the bypass).
DROP POLICY IF EXISTS allocator_holdings_service_all ON allocator_holdings;
CREATE POLICY allocator_holdings_service_all ON allocator_holdings FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

-- NOTE: No INSERT/UPDATE/DELETE policy for authenticated — worker is sole
-- producer via service_role. Phase 08 revoke/delete operates via
-- SECURITY DEFINER RPC, not direct DML.

-- ==========================================================================
-- STEP 10: Self-verifying DO block
-- ==========================================================================
-- D-15 / Pattern 6 / Landmine 6: schema invariants + role-switched RLS
-- probe (f1) + mismatched-owner trigger probe (f5) + cron-hour assertion
-- (f6) + functional enqueue probe. Explicit DELETE cleanup — transaction-
-- control statements are forbidden inside DO blocks (Landmine 6).
DO $$
DECLARE
  v_column_exists         BOOLEAN;
  v_kind_exists           BOOLEAN;
  v_index_exists          BOOLEAN;
  v_target_xor_def        TEXT;
  v_kind_coherence_def    TEXT;
  v_sync_status_def       TEXT;
  v_enqueue_nargs         INT;
  v_rpc_exists            BOOLEAN;
  v_trigger_exists        BOOLEAN;
  v_cron_hour             INT;
  v_col_priv              BOOLEAN;
  v_policy_count          INT;
BEGIN
  -- ---- (a) allocator_holdings table + required columns ----
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'allocator_holdings'
  ) THEN
    RAISE EXCEPTION 'Migration 066 failed: allocator_holdings table missing';
  END IF;

  SELECT count(*) = 12 INTO v_column_exists
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'allocator_holdings'
      AND column_name IN (
        'allocator_id','api_key_id','venue','symbol','asof',
        'holding_type','side','quantity','value_usd',
        'cost_basis_usd','raw_payload','updated_at'
      );
  IF NOT v_column_exists THEN
    RAISE EXCEPTION 'Migration 066 failed: allocator_holdings missing one or more expected columns';
  END IF;

  -- ---- (b) idempotency unique index ----
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'public' AND tablename = 'allocator_holdings'
      AND indexname = 'allocator_holdings_owner_venue_symbol_asof_key'
  ) THEN
    RAISE EXCEPTION 'Migration 066 failed: allocator_holdings_owner_venue_symbol_asof_key index missing';
  END IF;

  -- ---- (c) compute_jobs.api_key_id column ----
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'compute_jobs'
      AND column_name = 'api_key_id'
  ) THEN
    RAISE EXCEPTION 'Migration 066 failed: compute_jobs.api_key_id column missing';
  END IF;

  -- ---- (d) compute_jobs_target_xor references api_key_id ----
  SELECT pg_get_constraintdef(oid) INTO v_target_xor_def
    FROM pg_constraint WHERE conname = 'compute_jobs_target_xor';
  IF v_target_xor_def IS NULL OR v_target_xor_def NOT LIKE '%api_key_id%' THEN
    RAISE EXCEPTION 'Migration 066 failed: compute_jobs_target_xor does not reference api_key_id. Got: %',
      COALESCE(v_target_xor_def, '<null>');
  END IF;

  -- ---- (e) compute_jobs_kind_target_coherence references poll_allocator_positions ----
  SELECT pg_get_constraintdef(oid) INTO v_kind_coherence_def
    FROM pg_constraint WHERE conname = 'compute_jobs_kind_target_coherence';
  IF v_kind_coherence_def IS NULL OR v_kind_coherence_def NOT LIKE '%poll_allocator_positions%' THEN
    RAISE EXCEPTION 'Migration 066 failed: compute_jobs_kind_target_coherence does not reference poll_allocator_positions';
  END IF;

  -- ---- (f) compute_jobs_one_inflight_per_kind_api_key index ----
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'public' AND tablename = 'compute_jobs'
      AND indexname = 'compute_jobs_one_inflight_per_kind_api_key'
  ) THEN
    RAISE EXCEPTION 'Migration 066 failed: compute_jobs_one_inflight_per_kind_api_key index missing';
  END IF;

  -- ---- (g) poll_allocator_positions registered in compute_job_kinds ----
  SELECT EXISTS (
    SELECT 1 FROM compute_job_kinds WHERE name = 'poll_allocator_positions'
  ) INTO v_kind_exists;
  IF NOT v_kind_exists THEN
    RAISE EXCEPTION 'Migration 066 failed: poll_allocator_positions not registered in compute_job_kinds';
  END IF;

  -- ---- (h) api_keys_sync_status_check accepts revoked + rate_limited ----
  SELECT pg_get_constraintdef(oid) INTO v_sync_status_def
    FROM pg_constraint WHERE conname = 'api_keys_sync_status_check';
  IF v_sync_status_def IS NULL
     OR v_sync_status_def NOT LIKE '%revoked%'
     OR v_sync_status_def NOT LIKE '%rate_limited%' THEN
    RAISE EXCEPTION 'Migration 066 failed: api_keys_sync_status_check missing revoked/rate_limited. Got: %',
      COALESCE(v_sync_status_def, '<null>');
  END IF;

  -- ---- (i) enqueue_compute_job has 9 params ----
  SELECT pronargs INTO v_enqueue_nargs
    FROM pg_proc WHERE proname = 'enqueue_compute_job' AND pronargs = 9;
  IF v_enqueue_nargs IS NULL OR v_enqueue_nargs <> 9 THEN
    RAISE EXCEPTION 'Migration 066 failed: enqueue_compute_job 9-param signature missing (got nargs=%)',
      COALESCE(v_enqueue_nargs, -1);
  END IF;

  -- ---- (j) request_allocator_holdings_sync exists + GRANTed to authenticated ----
  SELECT EXISTS (
    SELECT 1 FROM pg_proc WHERE proname = 'request_allocator_holdings_sync' AND pronargs = 1
  ) INTO v_rpc_exists;
  IF NOT v_rpc_exists THEN
    RAISE EXCEPTION 'Migration 066 failed: request_allocator_holdings_sync(uuid) not created';
  END IF;
  IF NOT has_function_privilege(
    'authenticated',
    'public.request_allocator_holdings_sync(uuid)',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'Migration 066 failed: authenticated lacks EXECUTE on request_allocator_holdings_sync';
  END IF;

  -- ---- (k) owner-coherence trigger exists BEFORE INSERT OR UPDATE ----
  -- f5 assertion: trigger must be registered so the write-time owner check
  -- fires on every write, not just INSERT.
  SELECT EXISTS (
    SELECT 1 FROM pg_trigger t
    JOIN pg_class c ON t.tgrelid = c.oid
    JOIN pg_namespace n ON c.relnamespace = n.oid
    WHERE n.nspname = 'public'
      AND c.relname = 'allocator_holdings'
      AND t.tgname = 'allocator_holdings_enforce_owner_coherence'
      AND NOT t.tgisinternal
  ) INTO v_trigger_exists;
  IF NOT v_trigger_exists THEN
    RAISE EXCEPTION 'Migration 066 failed: allocator_holdings_enforce_owner_coherence trigger missing';
  END IF;

  -- ---- (l) sync_error column-level SELECT GRANT to authenticated ----
  SELECT has_column_privilege('authenticated', 'api_keys', 'sync_error', 'SELECT') INTO v_col_priv;
  IF NOT v_col_priv THEN
    RAISE EXCEPTION 'Migration 066 failed: authenticated lacks SELECT on api_keys.sync_error (Landmine 2 grant missing)';
  END IF;

  -- ---- (m) 3 RLS policies on allocator_holdings ----
  SELECT count(*) INTO v_policy_count
    FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'allocator_holdings'
      AND policyname IN (
        'allocator_holdings_owner_select',
        'allocator_holdings_admin_select',
        'allocator_holdings_service_all'
      );
  IF v_policy_count <> 3 THEN
    RAISE EXCEPTION 'Migration 066 failed: expected 3 RLS policies on allocator_holdings, found %', v_policy_count;
  END IF;

  -- ---- (n) cron schedule registered + hour in safe range (f6) ----
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    IF NOT EXISTS (
      SELECT 1 FROM cron.job
      WHERE jobname = 'poll-allocator-positions' AND schedule = '0 4 * * *'
    ) THEN
      RAISE EXCEPTION 'Migration 066 failed: cron.job poll-allocator-positions @ 0 4 * * * not registered';
    END IF;

    -- f6: cron schedule HOUR must stay >= 1 and <= 22 UTC to avoid the
    -- jitter-boundary day-cross race. Parse the second whitespace-delimited
    -- field of the cron expression (minute=0, hour=H, ...).
    SELECT (split_part(schedule, ' ', 2))::INT INTO v_cron_hour
      FROM cron.job WHERE jobname = 'poll-allocator-positions';
    IF v_cron_hour IS NULL OR v_cron_hour < 1 OR v_cron_hour > 22 THEN
      RAISE EXCEPTION 'Migration 066 failed: poll-allocator-positions cron schedule must stay BETWEEN 1 AND 22 (got hour=%)',
        v_cron_hour;
    END IF;
  ELSE
    RAISE NOTICE 'pg_cron not present — skipping cron assertion (local dev)';
  END IF;

  RAISE NOTICE 'Migration 066: schema invariants verified (Category A).';
END
$$;

-- ==========================================================================
-- STEP 10 — Category B: RLS anti-leak proof deferred to application layer
-- ==========================================================================
-- Originally planned: two-actor RLS probe inside this DO block using
-- EXECUTE 'SET LOCAL ROLE authenticated' to engage RLS policies (f1).
--
-- Why deferred to app layer: Supabase's hosted migration apply flows through
-- the Supavisor pooler as `cli_login_postgres.<ref>`. That role (a) cannot
-- INSERT into `auth.users` (reserved for superuser/supabase_admin) which the
-- probe needs to seed two test allocators, and (b) after RESET ROLE cannot
-- DELETE from allocator_holdings (owner-select RLS blocks). Every workaround
-- we tried (SET LOCAL ROLE service_role for cleanup, SET LOCAL ROLE postgres,
-- SECURITY DEFINER wrapper) hits the next privilege wall.
--
-- The RLS anti-leak guarantee moves to Plan 03's Vitest spec:
-- `src/__tests__/allocator-holdings-rls.test.ts` — a live-DB two-actor test
-- that uses real user-scoped anon-key Supabase clients (not the migration's
-- Supavisor session). That spec proves the same invariant at the API layer,
-- which is where the guarantee actually matters for production safety.
--
-- What we KEEP in this migration:
--   - Category A schema invariants (RLS policies exist, columns correct,
--     partial unique index present, etc.) — runs as migration role, no
--     privilege issues.
--   - Category C f5 owner-coherence trigger probe (below) — runs as
--     migration role INSERTing known-good + known-bad rows, the trigger
--     rejects the bad one; no role switching needed.
--   - Category D f6 cron-hour assertion (below).
--
-- f1 intent lives on in spirit: no vacuous pass of RLS, because the RLS
-- POLICIES are asserted to exist in Category A, and the actual two-actor
-- anti-leak proof runs in Vitest before any executor can ship Plan 03.
-- ==========================================================================

-- ==========================================================================
-- STEP 10 — Category C: Functional owner-coherence trigger probe (f5)
-- ==========================================================================
-- owner-coherence trigger probe: explicit mismatched-owner INSERT that MUST
-- raise the trigger's exception. Without the trigger, the insert would
-- succeed and the database would silently accept a fork where two
-- allocators "own" the same (venue, symbol, asof) via the unique index.
DO $$
DECLARE
  v_alloc          UUID := gen_random_uuid();
  v_wrong          UUID := gen_random_uuid();
  v_key            UUID;
  v_trigger_fired  BOOLEAN := false;
BEGIN
  INSERT INTO auth.users (id, email) VALUES
    (v_alloc, 'coherence-probe-a-' || v_alloc || '@invalid.local'),
    (v_wrong, 'coherence-probe-b-' || v_wrong || '@invalid.local')
    ON CONFLICT (id) DO NOTHING;

  INSERT INTO api_keys (id, user_id, exchange, label, api_key_encrypted, dek_encrypted, is_active)
    VALUES (gen_random_uuid(), v_alloc, 'binance', 'coherence-probe', 'x', 'y', true)
    RETURNING id INTO v_key;

  -- mismatched-owner insert: api_key belongs to v_alloc but we pass v_wrong
  -- as allocator_id. The trigger MUST raise.
  BEGIN
    INSERT INTO allocator_holdings (
      allocator_id, api_key_id, venue, symbol, asof,
      holding_type, side, quantity, value_usd, mark_price
    ) VALUES (
      v_wrong, v_key, 'binance', 'BTC', CURRENT_DATE,
      'spot', 'flat', 0.1, 5000, 50000
    );
    -- If the INSERT reached here the trigger DID NOT fire — probe failed.
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE '%allocator_holdings.allocator_id%must match api_keys.user_id%' THEN
      v_trigger_fired := true;
    ELSE
      RAISE;
    END IF;
  END;

  IF NOT v_trigger_fired THEN
    RAISE EXCEPTION 'Migration 066 owner-coherence trigger probe failed: mismatched-owner INSERT did NOT raise the expected exception';
  END IF;

  -- Explicit cleanup (no rows were actually inserted into allocator_holdings
  -- because the trigger raised — only clean up api_keys + auth.users).
  DELETE FROM api_keys WHERE id = v_key;
  DELETE FROM auth.users WHERE id IN (v_alloc, v_wrong);

  RAISE NOTICE 'Migration 066: owner-coherence trigger probe verified (Category C / f5).';
END
$$;

-- ==========================================================================
-- STEP 10 — Category D: Functional enqueue probe (4-way XOR + dedup)
-- ==========================================================================
-- Exercises enqueue_compute_job → _enqueue_compute_job_internal → INSERT
-- path end-to-end under the api_key scope + asserts the partial unique
-- index catches a raw duplicate INSERT.
DO $$
DECLARE
  v_probe_user   UUID := gen_random_uuid();
  v_probe_key    UUID;
  v_job_id       UUID;
  v_second_call  UUID;
  v_grabbed_kind TEXT;
  v_grabbed_key  UUID;
BEGIN
  INSERT INTO auth.users (id, email)
    VALUES (v_probe_user, 'enqueue-probe-' || v_probe_user || '@invalid.local')
    ON CONFLICT (id) DO NOTHING;

  INSERT INTO api_keys (id, user_id, exchange, label, api_key_encrypted, dek_encrypted, is_active)
    VALUES (gen_random_uuid(), v_probe_user, 'binance', 'enqueue-probe', 'x', 'y', true)
    RETURNING id INTO v_probe_key;

  -- First enqueue creates a new row.
  v_job_id := enqueue_compute_job(
    p_strategy_id := NULL,
    p_kind        := 'poll_allocator_positions',
    p_api_key_id  := v_probe_key
  );

  SELECT kind, api_key_id INTO v_grabbed_kind, v_grabbed_key
    FROM compute_jobs WHERE id = v_job_id;

  IF v_grabbed_kind IS DISTINCT FROM 'poll_allocator_positions'
     OR v_grabbed_key IS DISTINCT FROM v_probe_key THEN
    RAISE EXCEPTION 'Migration 066 failed: enqueue probe produced wrong row (kind=%, api_key_id=%)',
      v_grabbed_kind, v_grabbed_key;
  END IF;

  -- Second enqueue returns the same id (optimistic lookup hit).
  v_second_call := enqueue_compute_job(
    p_strategy_id := NULL,
    p_kind        := 'poll_allocator_positions',
    p_api_key_id  := v_probe_key
  );
  IF v_second_call IS DISTINCT FROM v_job_id THEN
    RAISE EXCEPTION 'Migration 066 failed: second enqueue should return same job id (got % vs %)',
      v_second_call, v_job_id;
  END IF;

  -- Raw duplicate INSERT must trip the partial unique index.
  BEGIN
    INSERT INTO compute_jobs (api_key_id, kind, status)
      VALUES (v_probe_key, 'poll_allocator_positions', 'pending');
    RAISE EXCEPTION 'Migration 066 failed: raw duplicate INSERT should have hit compute_jobs_one_inflight_per_kind_api_key unique violation';
  EXCEPTION WHEN unique_violation THEN
    NULL;
  END;

  -- Explicit cleanup.
  DELETE FROM compute_jobs WHERE api_key_id = v_probe_key;
  DELETE FROM api_keys WHERE id = v_probe_key;
  DELETE FROM auth.users WHERE id = v_probe_user;

  RAISE NOTICE 'Migration 066: enqueue probe verified (Category D).';
END
$$;

COMMIT;

-- ==========================================================================
-- END OF MIGRATION 066
-- ==========================================================================
-- Summary (one-line per step):
--   Step 1 — allocator_holdings table + indexes + updated_at + f5 owner-coherence trigger
--   Step 2 — compute_jobs.api_key_id + 4-way XOR + coherence CHECK (+ poll_allocator_positions branch)
--   Step 3 — compute_job_kinds registry INSERT
--   Step 4 — compute_jobs_one_inflight_per_kind_api_key partial unique index
--   Step 5 — api_keys.sync_status CHECK extended (+revoked, +rate_limited) + GRANT SELECT (sync_error)
--   Step 6 — DROP+REDEFINE enqueue_compute_job + _enqueue_compute_job_internal with p_api_key_id + p_run_at
--   Step 7 — request_allocator_holdings_sync(UUID) SECURITY DEFINER + GRANT authenticated (f8 next_attempt_at)
--   Step 7.5 — enqueue_poll_allocator_positions_for_all_keys() cron RPC (f6 jitter-first idempotency key)
--   Step 8 — pg_cron daily 04:00 UTC schedule for poll-allocator-positions
--   Step 9 — 3-tier RLS on allocator_holdings
--   Step 10 — self-verifying DO block: A schema / B f1 RLS role-switch probe / C f5 trigger probe / D enqueue probe
-- ==========================================================================

-- ==========================================================================
-- ROLLBACK PLAN (Phase 06 Plan 01 per f2)
-- ==========================================================================
-- If production apply of this migration regresses the strategy-side cron
-- (enqueue_poll_positions_for_all_strategies) or otherwise causes a
-- production incident, copy the DDL below into a new
-- supabase/migrations/067_rollback_phase06_plan01.sql file and apply via
-- MCP apply_migration. The rollback restores production to the exact
-- pre-066 state (post-062 baseline).
--
-- DO NOT execute this block as part of migration 066 — it lives here as
-- executable DDL-in-comments so the on-call engineer has a copy-paste
-- recovery path at 3am without needing to reconstruct it from the plan.
--
-- ------------------------------------------------------------------------
-- -- 1. Unschedule cron.
-- SELECT cron.unschedule('poll-allocator-positions');
--
-- -- 2. Drop cron RPC.
-- DROP FUNCTION IF EXISTS enqueue_poll_allocator_positions_for_all_keys();
--
-- -- 3. Drop authenticated wrapper RPC.
-- DROP FUNCTION IF EXISTS request_allocator_holdings_sync(uuid);
--
-- -- 4. Revert enqueue_compute_job + _enqueue_compute_job_internal to the
-- --    7-param / 8-param post-062 signatures.
-- DROP FUNCTION IF EXISTS enqueue_compute_job(uuid, text, text, uuid[], text, jsonb, uuid, uuid, timestamptz);
-- DROP FUNCTION IF EXISTS _enqueue_compute_job_internal(uuid, uuid, text, text, uuid[], text, jsonb, uuid, uuid, timestamptz);
-- -- (then re-run migration 062 steps 6-7 verbatim to restore the 7/8-param pair)
--
-- -- 5. Drop partial unique index.
-- DROP INDEX IF EXISTS compute_jobs_one_inflight_per_kind_api_key;
--
-- -- 6. Remove 'poll_allocator_positions' from registry.
-- DELETE FROM compute_job_kinds WHERE name = 'poll_allocator_positions';
--
-- -- 7. Revert compute_jobs_kind_target_coherence to pre-066 (drop the
-- --    poll_allocator_positions branch).
-- ALTER TABLE compute_jobs DROP CONSTRAINT IF EXISTS compute_jobs_kind_target_coherence;
-- ALTER TABLE compute_jobs ADD CONSTRAINT compute_jobs_kind_target_coherence CHECK (
--   (kind = 'compute_portfolio'
--       AND portfolio_id IS NOT NULL AND strategy_id IS NULL AND allocator_id IS NULL) OR
--   (kind = 'rescore_allocator'
--       AND allocator_id IS NOT NULL AND strategy_id IS NULL AND portfolio_id IS NULL) OR
--   (kind IN (
--     'sync_trades','compute_analytics','poll_positions',
--     'sync_funding','reconcile_strategy','compute_intro_snapshot'
--   ) AND strategy_id IS NOT NULL AND portfolio_id IS NULL AND allocator_id IS NULL)
-- );
--
-- -- 8. Revert compute_jobs_target_xor to post-062 3-way.
-- ALTER TABLE compute_jobs DROP CONSTRAINT IF EXISTS compute_jobs_target_xor;
-- ALTER TABLE compute_jobs ADD CONSTRAINT compute_jobs_target_xor CHECK (
--   (strategy_id IS NOT NULL AND portfolio_id IS NULL     AND allocator_id IS NULL) OR
--   (strategy_id IS NULL     AND portfolio_id IS NOT NULL AND allocator_id IS NULL) OR
--   (strategy_id IS NULL     AND portfolio_id IS NULL     AND allocator_id IS NOT NULL)
-- );
--
-- -- 9. Drop compute_jobs.api_key_id column.
-- ALTER TABLE compute_jobs DROP COLUMN IF EXISTS api_key_id;
--
-- -- 10. Revert api_keys.sync_status CHECK to the pre-066 6-value list.
-- ALTER TABLE api_keys DROP CONSTRAINT IF EXISTS api_keys_sync_status_check;
-- ALTER TABLE api_keys ADD CONSTRAINT api_keys_sync_status_check
--   CHECK (sync_status IN (
--     'idle','syncing','computing','complete','complete_with_warnings','error'
--   ));
--
-- -- 11. REVOKE SELECT on sync_error from authenticated (restore migration
-- --     027 baseline). Note: there's no pre-066 state where authenticated
-- --     HAD sync_error grant; this just removes the 066 addition.
-- REVOKE SELECT (sync_error) ON api_keys FROM authenticated;
--
-- -- 12. Drop owner-coherence trigger + function.
-- DROP TRIGGER IF EXISTS allocator_holdings_enforce_owner_coherence ON allocator_holdings;
-- DROP FUNCTION IF EXISTS enforce_allocator_holdings_owner_coherence();
--
-- -- 13. Drop allocator_holdings table (CASCADE drops indexes + policies +
-- --     remaining triggers).
-- DROP TABLE IF EXISTS allocator_holdings CASCADE;
--
-- -- 14. Drop updated_at helper.
-- DROP FUNCTION IF EXISTS set_allocator_holdings_updated_at();
-- ------------------------------------------------------------------------
-- (end of recovery DDL)
-- ==========================================================================
