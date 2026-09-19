-- Phase 164.5.1.4 SYNCCURSOR — a per-STRATEGY trade-sync resume cursor.
--
-- Background.
--   `routers/cron.py::_sync_single_key` fans a single api_key out over every
--   strategy attached to it. It STORES per STRATEGY (`per_strategy_stored[sid]`)
--   but it RESUMES per KEY: the fetch window comes from
--   `parse_since_ms(key_row.get("last_sync_at"))`, and the epilogue advances
--   that one key-level column whenever the aggregate
--   `should_advance_cursor = (not trades) or synced_count > 0` holds, with
--   `synced_count = sum(per_strategy_stored.values())`.
--
--   The aggregation IS the defect. On a two-strategy key where strategy A
--   stores and strategy B raises, the key cursor still advances — past the very
--   window B failed on. B's trades for that window are never fetched again by
--   any later tick, so B is stranded permanently rather than transiently. The
--   same shape strands the recompute tail: a strategy whose
--   `derive_broker_dailies` enqueue failed is never re-driven, because the
--   cursor it would have been re-driven from has already moved.
--
--   No per-strategy sync state exists anywhere in the schema (measured, phase
--   164.5.1.4 CONTEXT Area 1), so the remedy needs new state. The binding
--   constraint is the KEY, not the container: it must not be per-api-key.
--   This file ships exactly that container and nothing more. It is INERT on
--   arrival: every strategy starts with NO ROW, which the read path is
--   required to treat as "fall back to the key-level cursor", i.e. today's
--   behaviour byte for byte.
--
-- Why a NEW TABLE rather than a column somewhere existing.
--   * NOT a column on `strategies`: `strategies_read`
--     (`20260405061912_rls_policies.sql`) is a PUBLIC-read policy
--     (`status = 'published' OR user_id = auth.uid()`), so any column added
--     there publishes internal sync state for every published strategy.
--   * NOT keyed on the api_key: `strategies` points at its key through a
--     mutable `ON DELETE SET NULL` foreign key, so a composite key would
--     strand this row the moment a strategy is re-pointed at another key.
--     The strategy is the stable axis; it is the whole primary key here.
--
-- WHAT THIS FILE DOES NOT DO
-- --------------------------
-- 1. It does NOT touch `api_keys.last_sync_at` or the `should_advance_cursor`
--    expression. Holding the whole key cursor on any partial failure starves
--    the SUCCEEDING strategies into permanent re-fetch — the symmetric defect,
--    and the reason C-0198 chose to advance. That expression stays as it is.
-- 2. It does NOT touch `api_keys.last_fetched_trade_timestamp` (migration 045).
--    Measured: that column is per-KEY. It splits the checkpoint by PURPOSE
--    (fetched vs stored), not by STRATEGY, so re-using it would reproduce this
--    very defect in a second column.
-- 3. It does NOT harmonise the two sync-cursor disciplines this repo runs.
--    `services/job_worker.py` advances through the fenced `advance_sync_cursor`
--    RPC under a claim token; `routers/cron.py` writes `api_keys.last_sync_at`
--    directly with no fence and never touches the fenced path at all. The
--    marker this table holds is written in the PLAIN DIRECT-WRITE style
--    `cron.py` already uses, deliberately, per CONTEXT Area 2 — harmonising the
--    two paths is a much larger change and is out of scope for this phase.
--    This item exists because a reviewer unfamiliar with the deliberate split
--    will reasonably ask why this write is not fenced; the answer belongs in
--    the file, not in the review thread.
-- 4. It registers NO scheduled job. There is no `cron.schedule(...)` here and
--    there must never be one: scheduling is a LIVE OP, never a migration
--    (CONTEXT Area 4).
--
-- Self-verify posture. Every assertion at the foot of this file reads CATALOGS
-- ONLY (`information_schema` / `pg_catalog`). It reads no pre-existing row and
-- counts nothing. Shared TEST holds PROD's catalogue and never its data, so a
-- data-dependent assertion can pass PROD and REFUSE TEST — and a refused TEST
-- apply BLOCKS the PROD apply (`[164.8-DATA-DEPENDENT-MIGRATION-ESCAPE]`).

BEGIN;

SET lock_timeout = '3s';

-- --------------------------------------------------------------------------
-- STEP 1: the container
-- --------------------------------------------------------------------------
-- Three columns and no more.
--   * `strategy_id` is the WHOLE primary key. No surrogate `id`: the primary
--     key already indexes the exact column the read path filters on and is the
--     conflict target the writer upserts against, so a secondary index would be
--     dead weight.
--   * No api-key column, as a column or as part of the key — see the header.
--   * No `updated_at` trigger. This table has exactly one writer (the cron
--     upsert), which sets the column in its own payload; installing a trigger
--     for a single-writer table buys nothing and adds a second thing to keep
--     correct. (`compute_jobs` has one because its rows mutate via many paths.)
CREATE TABLE IF NOT EXISTS strategy_sync_cursors (
  strategy_id  UUID PRIMARY KEY REFERENCES strategies(id) ON DELETE CASCADE,
  last_sync_at TIMESTAMPTZ,
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE strategy_sync_cursors IS
  'Internal cron resume state: at most one row per strategy, recording where the trade sync got to for THAT strategy rather than for its api key. Sole writer is the analytics service cron fan out, through the service role client. No user facing consumer exists or is planned, which is why RLS here is deny all with no owner tier. See phase 164.5.1.4.';

COMMENT ON COLUMN strategy_sync_cursors.strategy_id IS
  'The whole primary key. Cascades on strategy deletion, so nothing is orphaned and no cleanup job is needed. Deliberately NOT composite: the strategy is the stable axis, while the key a strategy points at is mutable and nullable, so a composite key would strand this row on a re-point. See phase 164.5.1.4.';

-- ⚠️ The column name mirrors `api_keys.last_sync_at` byte for byte, and NOT the
-- `last_synced_trade_at` an earlier draft proposed. The value stored is wall
-- clock at sync time, exactly like the key-level column it falls back to — not
-- the maximum trade timestamp in the payload. A name containing "trade" invites
-- a future reader to derive it from the payload, which would silently diverge
-- from the one column it mirrors.
COMMENT ON COLUMN strategy_sync_cursors.last_sync_at IS
  'Wall clock at the moment this strategy was last fully synced, mirroring api_keys.last_sync_at in meaning. NOT the maximum trade timestamp in the payload. THREE STATES, and the first two are DIFFERENT: (1) NO ROW for this strategy means no per strategy information, so the consumer falls back to api_keys.last_sync_at, which is what makes this migration inert the moment it lands; (2) ROW PRESENT with a NULL value means this strategy must re fetch from the start of history; (3) ROW PRESENT with a timestamp means resume from there. The consumer MUST distinguish (1) from (2) by key MEMBERSHIP, never by a dictionary lookup that returns the same None for both. See phase 164.5.1.4.';

COMMENT ON COLUMN strategy_sync_cursors.updated_at IS
  'When this cursor row was last written. Set explicitly by the single writer in its own upsert payload; there is deliberately no trigger. See phase 164.5.1.4.';

-- --------------------------------------------------------------------------
-- STEP 2: RLS — deny all, no owner tier
-- --------------------------------------------------------------------------
-- ⭐ This is the narrower of two shipped precedents and it is taken on evidence.
--   * `allocator_holdings_service_all` (`20260420073003_allocator_holdings.sql`)
--     writes an explicit `auth.role() = 'service_role'` arm — but that table HAS
--     an owner-facing SELECT tier, so its service-role arm is one of three and
--     the intent it documents is "service_role IN ADDITION TO owners".
--   * `compute_jobs_deny_all` (`20260411144407_compute_jobs_queue.sql`) has no
--     owner tier at all, which is exactly this table's posture.
--   Both forms work only because service_role bypasses RLS by default
--   (ADR-0003, quoted in the allocator_holdings comment block). `USING (false)`
--   is the strictly narrower WRITTEN grant of the two, since the `auth.role()`
--   form would also admit any non-bypassing connection presenting that role
--   claim. Narrower wins for a table with zero user-facing consumers.
--
-- ⛔ Deliberately NO `REVOKE` for anon/authenticated on top of this policy. With
--    a REVOKE in place the policy is no longer the live control, and any later
--    assertion that a non-service caller is denied would start passing for the
--    GRANT reason rather than the POLICY reason — the vacuity trap both existing
--    `supabase/tests/*_rls.sql` gates independently warn about.
ALTER TABLE strategy_sync_cursors ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS strategy_sync_cursors_deny_all ON strategy_sync_cursors;
CREATE POLICY strategy_sync_cursors_deny_all ON strategy_sync_cursors
  FOR ALL
  USING (false)
  WITH CHECK (false);

COMMENT ON POLICY strategy_sync_cursors_deny_all ON strategy_sync_cursors IS
  'Service role only. Non service callers get zero rows and can write none. This table has NO owner facing tier, so the narrower USING (false) form is used rather than an explicit auth.role() arm; service_role bypasses RLS by default per ADR 0003. See phase 164.5.1.4.';

-- --------------------------------------------------------------------------
-- STEP 3: self-verifying DO block — CATALOGS ONLY
-- --------------------------------------------------------------------------
-- ⛔ Every arm below reads `information_schema` or `pg_catalog` and nothing
--    else. No arm reads the contents of a pre-existing row, counts rows against
--    a production condition, or inserts a throwaway row.
--
-- ⛔ The dummy-row functional probe that
--    `20260602173710_advance_sync_cursor_claim_token_fence.sql` uses is
--    REJECTED here, and the reason is structural rather than stylistic:
--    satisfying this table's foreign key needs a real `strategies` row, which
--    needs a `profiles` row, which needs an `auth.users` row. That is three
--    production inserts whose triggers and constraints the disposable lane
--    cannot model — a materially larger risk than the probe buys over a catalog
--    assertion, on a file whose failure mode is "blocks the PROD apply".
DO $$
DECLARE
  v_pk_cols     TEXT;
  v_rls_enabled BOOLEAN;
  v_polcmd      "char";
BEGIN
  -- 1. the relation exists in schema public
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name = 'strategy_sync_cursors'
  ) THEN
    RAISE EXCEPTION 'Phase 164.5.1.4 failed: table public.strategy_sync_cursors was not created';
  END IF;

  -- 2. its primary key column set is exactly {strategy_id}
  SELECT string_agg(a.attname, ',' ORDER BY a.attname)
    INTO v_pk_cols
    FROM pg_constraint c
    JOIN pg_attribute a
      ON a.attrelid = c.conrelid
     AND a.attnum = ANY (c.conkey)
   WHERE c.conrelid = 'public.strategy_sync_cursors'::regclass
     AND c.contype = 'p';
  IF v_pk_cols IS DISTINCT FROM 'strategy_id' THEN
    RAISE EXCEPTION 'Phase 164.5.1.4 failed: primary key of strategy_sync_cursors is (%), expected exactly (strategy_id). A composite or surrogate key is the stranding shape this phase exists to rule out.', COALESCE(v_pk_cols, '<no primary key at all>');
  END IF;

  -- 3. a foreign key strategy_id -> strategies exists and cascades on delete
  IF NOT EXISTS (
    SELECT 1
      FROM pg_constraint c
     WHERE c.conrelid = 'public.strategy_sync_cursors'::regclass
       AND c.contype = 'f'
       AND c.confrelid = 'public.strategies'::regclass
       AND c.confdeltype = 'c'
  ) THEN
    RAISE EXCEPTION 'Phase 164.5.1.4 failed: strategy_sync_cursors has no ON DELETE CASCADE foreign key to strategies, so deleting a strategy would orphan its cursor row';
  END IF;

  -- 4. row level security is enabled on the relation
  SELECT relrowsecurity
    INTO v_rls_enabled
    FROM pg_class
   WHERE oid = 'public.strategy_sync_cursors'::regclass;
  IF NOT COALESCE(v_rls_enabled, FALSE) THEN
    RAISE EXCEPTION 'Phase 164.5.1.4 failed: row level security is not enabled on strategy_sync_cursors, so internal sync state would be reachable by browser clients';
  END IF;

  -- 5. the deny-all policy is present
  SELECT p.polcmd
    INTO v_polcmd
    FROM pg_policy p
   WHERE p.polrelid = 'public.strategy_sync_cursors'::regclass
     AND p.polname = 'strategy_sync_cursors_deny_all';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Phase 164.5.1.4 failed: policy strategy_sync_cursors_deny_all is missing from strategy_sync_cursors';
  END IF;

  -- 6. and it governs ALL commands, not merely SELECT
  --    A policy carrying this name but created FOR SELECT would satisfy arm 5
  --    while leaving INSERT/UPDATE/DELETE ungoverned, which is a real defect
  --    class rather than a hypothetical one. `polcmd` is a catalog code point
  --    ('*' = FOR ALL, MEASURED on the disposable lane), not deparsed text, so
  --    this arm cannot fail on a rendering difference between PostgreSQL major
  --    versions.
  --
  -- ⛔ Deliberately NOT asserted: that `pg_get_expr(polqual, polrelid)` renders
  --    as the string 'false'. It does render exactly that way (MEASURED on the
  --    lane, alongside polwithcheck), but the assertion would buy nothing — the
  --    qualifier cannot drift without this very file's CREATE POLICY statement
  --    being edited, which arm 5 already catches — while pinning a DEPARSED
  --    TEXT rendering that a future PostgreSQL major could legitimately change.
  --    The failure mode of that arm is "blocks the PROD apply", so the trade is
  --    plainly bad. The measurement is recorded; the assertion is not taken.
  IF v_polcmd IS DISTINCT FROM '*' THEN
    RAISE EXCEPTION 'Phase 164.5.1.4 failed: policy strategy_sync_cursors_deny_all has polcmd %, expected * (FOR ALL). A deny policy scoped to one command leaves the others ungoverned.', v_polcmd;
  END IF;
END $$;

COMMIT;
