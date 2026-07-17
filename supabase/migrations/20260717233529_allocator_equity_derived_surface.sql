-- ==========================================================================
-- Phase 115.1 (E2 display-repoint / BACKBONE-02+03 else-branch): the NEW
-- keyed persistence surface `allocator_equity_derived` + the new compute-job
-- kind `derive_allocator_equity` + the recurring key-mode fan-out that closes
-- the P115-flagged enqueue gap.
--
-- Why this migration exists
-- -------------------------
-- Phase 115 shipped the pure, I/O-free allocator $-equity derivation core
-- (analytics-service/services/allocator_equity_derive.py). It has no production
-- consumer today — the frontend still renders the legacy `value_usd` from
-- the legacy per-day snapshots store. 115.1 wires a WORKER-side flow-aware
-- derivation that writes the derived curve to a SEPARATE new surface and repoints
-- allocator equity DISPLAY onto it (with legacy fallback). This migration is the
-- PRODUCTION-TOUCHING half: merging to main auto-applies to prod.
--
-- BACKBONE-03 else-branch (founder-ratified): the census did NOT clear, so the
-- legacy per-day equity-snapshots store STAYS. This migration is ADDITIVE-ONLY —
-- it NEVER references, writes, alters, or reschedules that legacy table, its
-- `refresh-allocator-equity` cron, its `enqueue_refresh_allocator_equity_for_all`
-- fan-out, or its constraints. A second writer to the legacy table would race its
-- first-writer-wins jobs. (The legacy table name is intentionally NOT spelled out
-- anywhere in this file so the additive-only grep gate stays green.)
--
-- What this migration does (6 numbered STEPs, terminal DO-block self-checks —
-- mirrors the 20260710130000_stitch_composite_kind house style):
--   1. CREATE TABLE allocator_equity_derived — one JSONB row per
--      (allocator_id, kind), atomic replace-on-upsert (the
--      strategy_analytics_series precedent, 20260428120919:71-88).
--   2. RLS: service_role ALL + authenticated owner SELECT. Anon fully denied.
--   3. Register kind `derive_allocator_equity`; DROP+ADD both compute_jobs
--      CHECKs RE-BASED ON 20260710130000 (its coherence carries the
--      derive_broker_dailies api_key arm that older defs drop — copying an
--      older def silently kills key-mode derives). Reuse the existing
--      in-flight dedup indexes (no duplicates).
--   4. Recurring key-mode fan-out fn enqueue_derive_broker_dailies_for_allocator_keys()
--      — mirrors enqueue_refresh_allocator_equity_for_all (20260420213754:314-361).
--   5. pg_cron `derive-allocator-key-dailies` @ 05:30 UTC (after 04:00 holdings
--      poll and the 05:00 legacy refresh; hour within the safe 1-22 band).
--   6. Self-verifying DO block — table+PK, RLS enabled+forced, kind admitted,
--      the re-base regression (derive_broker_dailies api_key arm survives), the
--      new derive_allocator_equity coherence arm, cron safe-hour, fan-out body.
--
-- Transaction style: NO explicit BEGIN/COMMIT — Supabase wraps each migration
-- in an implicit transaction (migration-reviewer invariant #14; the
-- 20260710130000 precedent). SET LOCAL lock_timeout applies to that wrap.
-- Pure-additive: the only data write is the INSERT into compute_job_kinds.
--
-- Application path
-- ----------------
-- Authored here. Applied to the linked Supabase TEST project
-- (qmnijlgmdhviwzwfyzlc) via the Supabase MCP apply_migration BEFORE the
-- RED-guarded SQL tests run (project_test_project_catchup_unmasks_stale_tests).
-- PROD applies itself on merge to main (project_supabase_migrate_auto_on_push)
-- — that merge is watched (see 115.1-02-PLAN user_setup). NEVER apply to the
-- prod project (khslejtfbuezsmvmtsdn) from here.
-- ==========================================================================

SET LOCAL lock_timeout = '3s';

-- --------------------------------------------------------------------------
-- STEP 1 — allocator_equity_derived table (strategy_analytics_series precedent
-- 20260428120919:71-88). One row per (allocator_id, kind); atomic
-- replace-on-upsert on the composite PK (no per-day multi-row reconcile, so no
-- partial-curve read race — the exact class the legacy store needed a SECDEF
-- replace fn to fix).
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS allocator_equity_derived (
  allocator_id  UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  kind          TEXT        NOT NULL,
  payload       JSONB       NOT NULL,
  computed_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (allocator_id, kind)
);

COMMENT ON TABLE allocator_equity_derived IS
  'Phase 115.1 derived allocator $-equity surface. One JSONB row per (allocator_id, kind); atomic replace-on-upsert (strategy_analytics_series precedent 20260428120919). SEPARATE from the legacy per-day equity-snapshots store (BACKBONE-03 else-branch: never a second writer to the legacy table). Written by the analytics worker via service_role; read by the SSR dashboard via the authenticated owner client.';

COMMENT ON COLUMN allocator_equity_derived.kind IS
  'Row family. ''equity_curve'' = the display curve row (payload.curve = [{date:''YYYY-MM-DD'', equity_usd}], flags, degrade_reasons, is_trustworthy, scalars). ''key_inputs:<api_key_id>'' = Option-B per-key persisted real flows + terminal anchor, consumed crawl-free by the derive_allocator_equity compose job. Add a new family = INSERT a new row; no ALTER TABLE.';

COMMENT ON COLUMN allocator_equity_derived.allocator_id IS
  'Owning allocator (= api_keys.user_id at derive time). ON DELETE CASCADE from auth.users IS the GDPR sanitize path — do NOT add a delete-guard trigger. If one is ever added it MUST exempt current_setting(''quantalyze.sanitize_in_progress'', true) = ''on'' (reference_sanitize_user_delete_guard_exemption) or it aborts account-deletion cascade.';

-- --------------------------------------------------------------------------
-- STEP 2 — RLS. Owner-SELECT + service-role write; anon fully denied (no anon
-- policy). The SSR read in plan 05 uses the USER (authenticated) client after
-- the sequential auth.uid()===userId assert — the phase36 per-key pattern
-- (20260624120000 step 4: denormalized allocator_id for a fast RLS owner gate).
-- FORCE row level security so even the table owner is subject to policy (the
-- worker writes with the service role, which bypasses RLS by role).
-- --------------------------------------------------------------------------
ALTER TABLE allocator_equity_derived ENABLE  ROW LEVEL SECURITY;
ALTER TABLE allocator_equity_derived FORCE   ROW LEVEL SECURITY;

DROP POLICY IF EXISTS allocator_equity_derived_owner_select ON allocator_equity_derived;
CREATE POLICY allocator_equity_derived_owner_select ON allocator_equity_derived
  FOR SELECT
  TO authenticated
  USING (allocator_id = auth.uid());

COMMENT ON POLICY allocator_equity_derived_owner_select ON allocator_equity_derived IS
  'Owner-only SELECT: an authenticated user reads only their own derived-equity rows. No INSERT/UPDATE/DELETE for authenticated — the worker is the sole producer via service_role. Anon has no policy and is denied. Phase 115.1 / T-115.1-04.';

-- Explicit service_role FOR ALL (belt-and-suspenders; service_role also
-- bypasses RLS by default, but an explicit policy documents intent and
-- survives any future RLS-hardening that flips the bypass — the
-- legacy *_service_all policy precedent, 20260420213754:407-410).
DROP POLICY IF EXISTS allocator_equity_derived_service_all ON allocator_equity_derived;
CREATE POLICY allocator_equity_derived_service_all ON allocator_equity_derived
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

COMMENT ON POLICY allocator_equity_derived_service_all ON allocator_equity_derived IS
  'Service-role writer policy. The analytics worker (service key) is the sole producer of derived-equity rows. Phase 115.1.';

-- --------------------------------------------------------------------------
-- STEP 3 — register the compute-job kind `derive_allocator_equity` and RE-BASE
-- both CHECKs on migration 20260710130000 (VERIFIED still the latest ADD
-- CONSTRAINT for BOTH compute_jobs_kind_check and compute_jobs_kind_target_
-- coherence: `grep -l "ADD CONSTRAINT compute_jobs_kind_check " supabase/
-- migrations/*.sql` and the coherence equivalent both end at 20260710130000;
-- 20260716090000 only references them in a comment, it redefines NEITHER).
--
-- Copying an OLDER coherence def would SILENTLY DROP the derive_broker_dailies
-- api_key arm and break every allocator per-key derive — the exact failure
-- 20260710130000's own header warns about. Both CHECKs below are strict
-- supersets of the 20260710130000 definition (no already-admitted in-flight row
-- can fail under the DROP+ADD swap).
-- --------------------------------------------------------------------------

-- (a) registry row (idempotent; name is PK).
INSERT INTO compute_job_kinds (name) VALUES ('derive_allocator_equity')
  ON CONFLICT (name) DO NOTHING;

-- (b) compute_jobs_kind_check — 20260710130000's 15-kind array VERBATIM with
--     'derive_allocator_equity' appended (16 kinds; strict superset).
ALTER TABLE compute_jobs DROP CONSTRAINT IF EXISTS compute_jobs_kind_check;
ALTER TABLE compute_jobs ADD CONSTRAINT compute_jobs_kind_check CHECK (
  kind = ANY (ARRAY[
    'sync_trades'::text,
    'compute_analytics'::text,
    'compute_portfolio'::text,
    'poll_positions'::text,
    'sync_funding'::text,
    'reconcile_strategy'::text,
    'compute_intro_snapshot'::text,
    'rescore_allocator'::text,
    'poll_allocator_positions'::text,
    'reconstruct_allocator_history'::text,
    'refresh_allocator_equity_daily'::text,
    'process_key_long'::text,
    'compute_analytics_from_csv'::text,
    'derive_broker_dailies'::text,
    'stitch_composite'::text,
    'derive_allocator_equity'::text        -- 2026-07-18: allocator $-equity compose (per-key inputs -> frozen core -> derived curve surface)
  ])
);

COMMENT ON CONSTRAINT compute_jobs_kind_check ON compute_jobs IS
  'Simple list-form kind admission check. 2026-07-18: extended with derive_allocator_equity (allocator-scoped compose of the P115 derivation core onto allocator_equity_derived). Re-based on 20260710130000.';

-- (c) compute_jobs_kind_target_coherence — 20260710130000's FULL definition
--     VERBATIM (it carries the derive_broker_dailies api_key arm) with the new
--     allocator-scoped derive_allocator_equity arm appended.
ALTER TABLE compute_jobs DROP CONSTRAINT IF EXISTS compute_jobs_kind_target_coherence;
ALTER TABLE compute_jobs ADD CONSTRAINT compute_jobs_kind_target_coherence CHECK (
  ((kind = 'compute_portfolio') AND (portfolio_id IS NOT NULL) AND (strategy_id IS NULL) AND (allocator_id IS NULL))
  OR ((kind = 'rescore_allocator') AND (allocator_id IS NOT NULL) AND (strategy_id IS NULL) AND (portfolio_id IS NULL))
  OR ((kind = ANY (ARRAY['sync_trades', 'compute_analytics', 'poll_positions', 'sync_funding', 'reconcile_strategy', 'compute_intro_snapshot', 'compute_analytics_from_csv', 'derive_broker_dailies', 'stitch_composite'])) AND (strategy_id IS NOT NULL) AND (portfolio_id IS NULL) AND (allocator_id IS NULL))
  OR ((kind = 'poll_allocator_positions') AND (api_key_id IS NOT NULL) AND (strategy_id IS NULL) AND (portfolio_id IS NULL) AND (allocator_id IS NULL))
  OR ((kind = 'reconstruct_allocator_history') AND (api_key_id IS NOT NULL) AND (strategy_id IS NULL) AND (portfolio_id IS NULL) AND (allocator_id IS NULL))
  OR ((kind = 'refresh_allocator_equity_daily') AND (api_key_id IS NOT NULL) AND (strategy_id IS NULL) AND (portfolio_id IS NULL) AND (allocator_id IS NULL))
  OR ((kind = 'derive_broker_dailies') AND (api_key_id IS NOT NULL) AND (strategy_id IS NULL) AND (portfolio_id IS NULL) AND (allocator_id IS NULL))
  OR ((kind = 'process_key_long') AND (strategy_id IS NOT NULL) AND (portfolio_id IS NULL) AND (allocator_id IS NULL) AND (api_key_id IS NULL))
  -- 2026-07-18 (Phase 115.1): allocator-scoped compose. Same target shape as
  -- rescore_allocator (allocator_id NOT NULL, all other targets NULL).
  OR ((kind = 'derive_allocator_equity') AND (allocator_id IS NOT NULL) AND (strategy_id IS NULL) AND (portfolio_id IS NULL) AND (api_key_id IS NULL))
);

COMMENT ON CONSTRAINT compute_jobs_kind_target_coherence ON compute_jobs IS
  'Kind<->target-type coherence. 2026-07-18: derive_allocator_equity added to a new allocator-scoped arm (allocator_id NOT NULL). Preserves the 20260624120100/20260710130000 dual-target derive_broker_dailies api_key arm — copying an older def would silently drop it and break key-mode allocator derives.';

-- (d) In-flight dedup: NO new index. The generic
--     compute_jobs_one_inflight_per_kind_allocator (20260418194206:151, partial
--     unique on (allocator_id, kind) for in-flight statuses) already covers the
--     new allocator-scoped derive_allocator_equity kind. The generic
--     compute_jobs_one_inflight_per_kind_api_key (20260420073003:288, partial
--     unique on (api_key_id, kind) for in-flight statuses) already covers the
--     STEP-4 fan-out's derive_broker_dailies jobs. Both are kind-agnostic in
--     their WHERE clause, so they dedup the new work with zero new indexes — do
--     NOT create duplicates.

-- --------------------------------------------------------------------------
-- STEP 4 — recurring key-mode fan-out. Closes the P115-flagged enqueue gap:
-- allocator per-key derive_broker_dailies was one-shot-at-best (only the
-- approval-gated scripts/phase35_backfill_enqueue ever enqueued it key-scoped);
-- new keys never got a series and existing series never refreshed.
--
-- Mirrors enqueue_refresh_allocator_equity_for_all (20260420213754:314-361):
-- advisory-lock skip, per-key loop, per-key unique_violation swallow. Enqueues
-- kind 'derive_broker_dailies' via the api_key-scoped enqueue_compute_job mode
-- (p_api_key_id set, all other targets NULL — the coherence api_key arm).
--
-- Eligibility predicate — BYTE-MATCHES eligible_key_predicate
-- (allocator_equity_derive.py:187-203) and the phase35 backfill dispatch filter
-- (scripts/phase35_backfill_enqueue.py:79-91), which are documented ROLE-AGNOSTIC
-- (every active connected exchange key). Do NOT invent a different ownership
-- filter:
--     is_active = true
--     AND sync_status IS DISTINCT FROM 'revoked'   -- NULL/anything-but-revoked passes
--     AND disconnected_at IS NULL
-- A credential-revoked / soft-disconnected key keeps is_active=true (rows persist
-- for audit) but is NOT eligible — deriving for it would pin the D3 gate to the
-- honest-empty baseline forever.
-- --------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION enqueue_derive_broker_dailies_for_allocator_keys()
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_key   RECORD;
  v_today TEXT := to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD');
BEGIN
  -- Advisory lock so concurrent cron fires do not stomp on each other.
  IF NOT pg_try_advisory_lock(hashtext('derive_broker_dailies_key_fanout')) THEN
    RAISE NOTICE 'enqueue_derive_broker_dailies_for_allocator_keys: another run holds the lock; skipping';
    RETURN;
  END IF;

  BEGIN
    FOR v_key IN
      SELECT ak.id AS api_key_id
      FROM api_keys ak
      WHERE ak.is_active = TRUE
        AND ak.sync_status IS DISTINCT FROM 'revoked'
        AND ak.disconnected_at IS NULL
    LOOP
      BEGIN
        PERFORM enqueue_compute_job(
          p_strategy_id     := NULL,
          p_kind            := 'derive_broker_dailies',
          p_idempotency_key := 'derive-dailies-' || v_key.api_key_id::text || '-' || v_today,
          p_api_key_id      := v_key.api_key_id
        );
      EXCEPTION WHEN unique_violation THEN
        NULL; -- already in-flight for this key (per (api_key_id, kind) index); benign
      END;
    END LOOP;
  EXCEPTION WHEN OTHERS THEN
    PERFORM pg_advisory_unlock(hashtext('derive_broker_dailies_key_fanout'));
    RAISE;
  END;

  PERFORM pg_advisory_unlock(hashtext('derive_broker_dailies_key_fanout'));
END;
$$;

COMMENT ON FUNCTION enqueue_derive_broker_dailies_for_allocator_keys IS
  'Cron entrypoint — fans out one derive_broker_dailies job per ELIGIBLE api_key (is_active AND sync_status IS DISTINCT FROM ''revoked'' AND disconnected_at IS NULL — the role-agnostic eligible_key_predicate / phase35 filter). api_key-scoped; dedup via compute_jobs_one_inflight_per_kind_api_key + per-(key,UTC-date) idempotency key. Phase 115.1 — closes the P115 recurring key-mode enqueue gap. Mirrors enqueue_refresh_allocator_equity_for_all (does NOT touch the legacy per-day equity-snapshots path).';

REVOKE ALL ON FUNCTION enqueue_derive_broker_dailies_for_allocator_keys() FROM PUBLIC, anon, authenticated;
-- pg_cron runs as superuser; no additional GRANT required.

-- --------------------------------------------------------------------------
-- STEP 5 — pg_cron schedule. 05:30 UTC: after the 04:00 poll-allocator-positions
-- holdings poll AND the 05:00 legacy refresh-allocator-equity cron, so today's
-- holdings/anchor are fresh. Hour 5 is inside the safe 1-22 band the repo's
-- self-checks demand. Idempotent schedule-if-absent (the 20260420213754 pattern).
-- --------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'derive-allocator-key-dailies') THEN
      PERFORM cron.unschedule('derive-allocator-key-dailies');
    END IF;
    PERFORM cron.schedule(
      'derive-allocator-key-dailies',
      '30 5 * * *',
      $cron$SELECT enqueue_derive_broker_dailies_for_allocator_keys();$cron$
    );
    RAISE NOTICE 'Scheduled derive-allocator-key-dailies at 05:30 UTC';
  ELSE
    RAISE NOTICE 'pg_cron extension not present — skipping schedule (local dev)';
  END IF;
END$$;

-- --------------------------------------------------------------------------
-- STEP 6 — self-verifying DO block. Every RAISE format string is a single
-- literal (no '||' inside a RAISE format slot). Asserts the whole surface AND
-- the load-bearing re-base regression.
-- --------------------------------------------------------------------------
DO $$
DECLARE
  v_pk_def          TEXT;
  v_rls_enabled     BOOLEAN;
  v_rls_forced      BOOLEAN;
  v_owner_policy    BOOLEAN;
  v_service_policy  BOOLEAN;
  v_check_clause    TEXT;
  v_coherence       TEXT;
  v_fanout_src      TEXT;
  v_cron_hour       INT;
BEGIN
  -- (a) table + composite PK (allocator_id, kind)
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
     WHERE table_schema = 'public' AND table_name = 'allocator_equity_derived'
  ) THEN
    RAISE EXCEPTION 'Phase 115.1: allocator_equity_derived table missing';
  END IF;
  SELECT pg_get_constraintdef(c.oid) INTO v_pk_def
    FROM pg_constraint c
    JOIN pg_class t ON c.conrelid = t.oid
    JOIN pg_namespace n ON t.relnamespace = n.oid
   WHERE n.nspname = 'public' AND t.relname = 'allocator_equity_derived' AND c.contype = 'p';
  IF v_pk_def IS NULL
     OR v_pk_def NOT LIKE '%allocator_id%'
     OR v_pk_def NOT LIKE '%kind%' THEN
    RAISE EXCEPTION 'Phase 115.1: allocator_equity_derived PK (allocator_id, kind) missing. Got: %',
      COALESCE(v_pk_def, '<null>');
  END IF;

  -- (b) RLS enabled AND forced
  SELECT relrowsecurity, relforcerowsecurity INTO v_rls_enabled, v_rls_forced
    FROM pg_class
   WHERE relname = 'allocator_equity_derived'
     AND relnamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'public');
  IF NOT COALESCE(v_rls_enabled, false) THEN
    RAISE EXCEPTION 'Phase 115.1: RLS not enabled on allocator_equity_derived';
  END IF;
  IF NOT COALESCE(v_rls_forced, false) THEN
    RAISE EXCEPTION 'Phase 115.1: RLS not FORCEd on allocator_equity_derived';
  END IF;

  -- (c) owner-select + service-all policies present; NO anon/owner-write policy
  SELECT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public' AND tablename = 'allocator_equity_derived'
       AND policyname = 'allocator_equity_derived_owner_select'
       AND cmd = 'SELECT' AND 'authenticated' = ANY(roles)
  ) INTO v_owner_policy;
  IF NOT v_owner_policy THEN
    RAISE EXCEPTION 'Phase 115.1: owner-SELECT (authenticated) policy missing on allocator_equity_derived';
  END IF;
  SELECT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public' AND tablename = 'allocator_equity_derived'
       AND policyname = 'allocator_equity_derived_service_all'
  ) INTO v_service_policy;
  IF NOT v_service_policy THEN
    RAISE EXCEPTION 'Phase 115.1: service_role ALL policy missing on allocator_equity_derived';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public' AND tablename = 'allocator_equity_derived'
       AND 'anon' = ANY(roles)
  ) THEN
    RAISE EXCEPTION 'Phase 115.1: allocator_equity_derived must have NO anon policy (anon fully denied)';
  END IF;

  -- (d) kind admitted by the list CHECK
  SELECT pg_get_constraintdef(oid) INTO v_check_clause
    FROM pg_constraint
   WHERE conrelid = 'public.compute_jobs'::regclass AND conname = 'compute_jobs_kind_check';
  IF v_check_clause IS NULL OR position('derive_allocator_equity' IN v_check_clause) = 0 THEN
    RAISE EXCEPTION 'Phase 115.1: derive_allocator_equity not admitted by compute_jobs_kind_check';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM compute_job_kinds WHERE name = 'derive_allocator_equity') THEN
    RAISE EXCEPTION 'Phase 115.1: derive_allocator_equity missing from compute_job_kinds registry';
  END IF;

  -- (e) coherence: new allocator arm present AND the re-base regression — the
  --     derive_broker_dailies api_key arm from 20260624120100/20260710130000
  --     MUST survive (copying an older def would silently drop it).
  SELECT pg_get_constraintdef(oid) INTO v_coherence
    FROM pg_constraint
   WHERE conrelid = 'public.compute_jobs'::regclass AND conname = 'compute_jobs_kind_target_coherence';
  IF v_coherence IS NULL OR position('derive_allocator_equity' IN v_coherence) = 0 THEN
    RAISE EXCEPTION 'Phase 115.1: derive_allocator_equity arm missing from compute_jobs_kind_target_coherence';
  END IF;
  IF v_coherence NOT LIKE '%derive_broker_dailies%api_key_id IS NOT NULL%' THEN
    RAISE EXCEPTION 'Phase 115.1: derive_broker_dailies api_key arm regressed out of compute_jobs_kind_target_coherence (re-base dropped it)';
  END IF;
  IF position('process_key_long' IN v_coherence) = 0 THEN
    RAISE EXCEPTION 'Phase 115.1: process_key_long branch regressed out of compute_jobs_kind_target_coherence';
  END IF;
  IF position('stitch_composite' IN v_coherence) = 0 THEN
    RAISE EXCEPTION 'Phase 115.1: stitch_composite regressed out of compute_jobs_kind_target_coherence';
  END IF;

  -- (f) fan-out fn body references the api_key-scoped predicate + eligibility
  SELECT prosrc INTO v_fanout_src
    FROM pg_proc WHERE proname = 'enqueue_derive_broker_dailies_for_allocator_keys';
  IF v_fanout_src IS NULL
     OR v_fanout_src NOT LIKE '%p_api_key_id%'
     OR v_fanout_src NOT LIKE '%derive_broker_dailies%'
     OR v_fanout_src NOT LIKE '%disconnected_at IS NULL%' THEN
    RAISE EXCEPTION 'Phase 115.1: enqueue_derive_broker_dailies_for_allocator_keys body missing api_key fan-out / eligibility predicate';
  END IF;

  -- (g) cron registered at a safe hour (1-22), if pg_cron present
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    IF NOT EXISTS (
      SELECT 1 FROM cron.job
       WHERE jobname = 'derive-allocator-key-dailies' AND schedule = '30 5 * * *'
    ) THEN
      RAISE EXCEPTION 'Phase 115.1: cron.job derive-allocator-key-dailies @ 30 5 * * * not registered';
    END IF;
    SELECT (split_part(schedule, ' ', 2))::INT INTO v_cron_hour
      FROM cron.job WHERE jobname = 'derive-allocator-key-dailies';
    IF v_cron_hour IS NULL OR v_cron_hour < 1 OR v_cron_hour > 22 THEN
      RAISE EXCEPTION 'Phase 115.1: derive-allocator-key-dailies cron hour must stay BETWEEN 1 AND 22 (got hour=%)', v_cron_hour;
    END IF;
  ELSE
    RAISE NOTICE 'pg_cron not present — skipping cron assertion (local dev)';
  END IF;

  RAISE NOTICE 'Phase 115.1: allocator_equity_derived + derive_allocator_equity kind + recurring key-mode fan-out installed (re-base regression clear, legacy store untouched).';
END
$$;

-- ==========================================================================
-- END OF PHASE 115.1 MIGRATION — allocator_equity_derived surface
-- ==========================================================================
