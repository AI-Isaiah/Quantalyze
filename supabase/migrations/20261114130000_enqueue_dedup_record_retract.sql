-- ==========================================================================
-- Migration 20261114130000: an enqueue that dedups onto an in-flight job records the
-- caller's metadata and retracts an inherited ledger-refresh marker.
-- Phase 211 SYNCJOBS, plan 03 (ROADMAP SC-2 and SC-4; TODOS 161.1-D11; decisions
-- D11-1 to D11-13 in 211-CONTEXT.md).
--
-- WHY THIS MIGRATION EXISTS
-- -------------------------
-- `_enqueue_compute_job_internal` dedups on (target, kind) over the in-flight statuses
-- and returns the existing job's id. On that path the caller's `p_metadata` is thrown
-- away. So a user's resync whose enqueue lands on a recurring ledger refresh's job is
-- served BY that job and inherits its protection (a `source` marker the status bridge
-- reads as "a refresh, keep the figures"), until the Python or TypeScript backstop runs
-- afterwards and drops the marker. Phase 191 named that window D-02 and left it open.
--
-- FOUNDER DECISION, 2026-11-14 (option B, "Record + drop the flag"). On every dedup hit,
-- at BOTH return sites (the optimistic look-up hit, SITE A, and the lost-race re-read,
-- SITE B) of BOTH overloads, one new SECURITY DEFINER helper does two things:
--   1. RECORDS the caller's metadata in the new side table
--      public.compute_job_dedup_events (job id, caller metadata, the marker retracted
--      in the same call, time). D11-1.
--   2. RETRACTS the inherited marker, when the existing row carries one and the caller
--      sends a correlation_id and no marker, on a marker-capable kind. It does so by
--      calling public.retract_ledger_refresh_marker, the one UPDATE that already owns
--      the marker list and the retraction shape; this file never re-writes that UPDATE
--      (D11-12). A `done` row is never rewritten: the reused function guards it.
-- Nothing else is merged into the job row (D11-3), so `updated_at` and the job list the
-- UI reads move only on a retraction.
--
-- THE D11-5 CENSUS (founder constraint: no background path may retract)
-- ---------------------------------------------------------------------
-- Re-run 2026-11-14 over src, analytics-service and supabase/schema/functions: thirteen
-- non-test files mention both the enqueue RPC and correlation_id. Exactly two BACKGROUND
-- senders of correlation_id exist, both Vercel cron routes:
-- src/app/api/cron/reconcile-strategies (kind reconcile_strategy) and
-- src/app/api/cron/sync-funding (kind sync_funding). Every other sender is user-initiated
-- (the process_key HTTP route, the process_key_long tail, keys/sync, intro) or a manual
-- lane probe. No SQL fan-out, no Python chain edge and no analytics-service cron path
-- sends one. Neither cron kind can hold a refresh marker, and the helper's retraction is
-- scoped to the three marker-capable kinds (derive_broker_dailies,
-- compute_analytics_from_csv, stitch_composite), so "no background retraction" is
-- STRUCTURAL: a future background sender of another kind cannot retract either (D11-8).
--
-- RESIDUAL, not widened (D11-9): finalize-wizard's stitch_composite enqueue (a `source`
-- of finalize-wizard, TypeScript backstop retraction exists) and csv-finalize's
-- compute_analytics_from_csv enqueue (no backstop) send no correlation_id, so the
-- retraction does not fire for them. Widening them is a TypeScript change, out of scope.
--
-- THE RULES, each pinned by the gate supabase/tests/test_enqueue_dedup_record_retract.sql
-- ---------------------------------------------------------------------------------------
-- * A parented enqueue (non-empty p_parent_job_ids) records and retracts NOTHING (D11-10),
--   and so does ANY enqueue that dedups onto a `done_pending_children` row (review WR-01).
--   Together they keep the helper off every row the Phase 164.9.3.1 ancestor-first
--   protocol locks FOR UPDATE, which is the argument, not an absolute:
--     - `_fan_in_lock_rows(v_kids, TRUE)` in mark_compute_job_done and
--       mark_compute_job_failed takes FOR UPDATE only on fan-in children, and a fan-in
--       child is a `done_pending_children` row (both functions select it by that status).
--       A row enters that status only at insert, never afterwards, so a row the helper
--       read as another status cannot become one.
--     - claim_compute_jobs, claim_compute_jobs_with_priority, reclaim_stuck_compute_jobs
--       and reset_stalled_compute_jobs lock with SKIP LOCKED, so they skip a row the
--       helper holds and never wait on it.
--     - mark_compute_job_done's own status UPDATE is a FOR NO KEY UPDATE (every unique
--       index that mentions `status` is partial, so `status` is not a key column), and
--       that does not conflict with the FOR KEY SHARE the side table's FK takes.
--   The one lock the helper CAN still wait on is the FOR UPDATE that mark_compute_job_failed
--   and defer_compute_job take on their OWN `running` row, as their first row lock. That is
--   a plain wait: neither holds anything else the helper could hold while it waits. The
--   gate is single-session, so this is an argument from the code, not a two-session proof.
--   The status is read with a plain non-locking SELECT (no FOR UPDATE, no FOR SHARE).
-- * NULL, empty and non-object caller metadata record nothing. Metadata over 8192 bytes
--   is recorded as {"oversize_bytes": n} and NEVER fails the enqueue (D11-11); the
--   table's own size CHECK is the backstop, not the policy.
-- * The Python retraction (`_retract_refresh_marker_on_reuse`) STAYS as a backstop
--   (D11-4). After this migration it answers `no_marker` on the collision it used to
--   handle, and logs nothing, so the helper itself raises a WARNING on a retraction
--   (review WR-02) and the `retracted_marker` column records it.
-- * The 7-argument overload is UNREACHABLE: the 10-argument overload has defaults, so
--   every 7-argument call is ambiguous and fails with 42725 (D11-13). It is re-based
--   anyway, as the founder constraint requires, and pinned by a body-text arm.
--
-- RE-BASE (re-grepped on this tree and on origin/main when this file was written; no
-- later CREATE or ALTER of either overload exists):
--   * public._enqueue_compute_job_internal, 10 arguments: 20261024120000 (section 3),
--     copied byte for byte, plus two helper calls (one per dedup return site).
--   * public._enqueue_compute_job_internal, 7 arguments: 20260716090000, copied byte for
--     byte, plus two helper calls. The only other byte that changes is the SCHEMA
--     QUALIFIER on its header: the source wrote an unqualified CREATE OR REPLACE, which
--     resolves against the SESSION search_path and could create a second function in
--     another schema (the 20261024120000 header explains it for the 10-argument body).
--   The fresh-insert return is NOT a dedup and gets nothing. No new lost-race re-read and
--   no strict-mode INTO is added anywhere: test_enqueue_internal_destrict.sql counts
--   exactly four form-agnostic re-reads and zero strict ones in the deployed body.
--
-- ACL. Supabase default privileges grant EXECUTE on new functions to anon and
-- authenticated directly, and a default-grant event trigger can re-open it on every
-- CREATE OR REPLACE (migration 20260515130001 records it). So the REVOKE names all three
-- grantees and is restated for all three signatures after the DDL, and the verify block
-- asserts it. The side table is reachable only through its SECURITY DEFINER writer, plus
-- a service_role SELECT for operators and the gate.
--
-- DEVIATION from the GSD schema gate, recorded as the orchestrator requires: no
-- `supabase db push` ran. This checkout's CLI is linked to PRODUCTION. A merge that
-- touches supabase/migrations applies to TEST first (`apply-test`) and then to PROD
-- automatically once TEST succeeds, with NO human gate. So this migration is proven on
-- the throwaway pg-lane and the mutation runner only, and every review it needs happens
-- BEFORE the merge. VAC-08 and baseline-content-drift go RED on the PR by construction
-- (DRIFT rows for both re-based overloads, a SNAPSHOT_MISSING row for the new helper)
-- until apply-on-merge brings TEST forward and the baseline is re-dumped.
--
-- ==========================================================================
-- VAC-04 ACKNOWLEDGEMENT -- the PROD bodies this migration overwrites
-- ==========================================================================
-- Both overloads of public._enqueue_compute_job_internal are re-based below. The last
-- re-base (20261024120000) acked the 10-argument overload only, because the 7-argument
-- one was a MATCH there. This one changes both, so each carries its own ack. The helper
-- public._record_enqueue_dedup has no PROD body and needs none.
--
-- MEASURED 2026-11-14, reproduced LOCALLY with the gate's own normalizer, aiming its
-- `live` argument at origin/main's snapshot rather than at PROD:
--
--   git show origin/main:supabase/schema/functions/_enqueue_compute_job_internal.sql > <scratch>
--   node scripts/sql-body-normalize.mjs --diff-bodies \
--     supabase/schema/functions/_enqueue_compute_job_internal.sql <scratch>
--
-- The DRIFT rows read: _enqueue_compute_job_internal (7 args) 2 differing lines and
-- _enqueue_compute_job_internal (10 args) 2 differing lines, which are the two added
-- helper calls per overload (the normalizer counts lines of the function body only).
--
-- EACH ACKED HASH IS THE `live` COLUMN OF --diff-bodies FOR THAT FUNCTION'S DRIFT ROW
-- (the fifth tab-separated field), NOT `--hash` OF THE SNAPSHOT FILE (a whole-file
-- digest no gate ever greps).
--
-- _enqueue_compute_job_internal (10 args), the DRIFT row's `live` column:
-- prod-body-ack: f048710a2e80cd971054040e274d888faa3112db19ab124155d398da5629a15e
--
-- _enqueue_compute_job_internal (7 args), the DRIFT row's `live` column:
-- prod-body-ack: 5ca84430e6c2b4bf14b6fdaf42816105c6231f10e612d5ca2c746584ab9d930c
--
-- WARNING: EACH ACK IS OF origin/main, WHICH STANDS IN FOR PROD. It is EARNED only
-- if VAC-04 on the PR reports that SAME hash for PROD for that function. If it
-- reports a different one, PROD drifted OUT OF BAND and the correct action is
-- to FOLD the difference into this migration and re-derive, never to edit the
-- pragma to match a gate log. It is EARNED, not pasted.
-- WARNING: VAC-08 (repo-vs-TEST body pairing, in `test-db-drift`) goes RED on
-- the PR by construction, one DRIFT row per function above, until apply-on-merge
-- brings TEST forward; `baseline-content-drift` carries the same rows until the
-- post-apply baseline re-dump.
--
-- Transaction style: NO explicit BEGIN or COMMIT. The migration runner wraps the file in
-- its own transaction, and the pg-lane runs these statements outside one, so nothing
-- here depends on ON COMMIT behaviour. SET LOCAL below applies to whichever transaction
-- that is. Every RAISE format string in this file is a SINGLE literal (Phase 85
-- invariant 21: no concatenation in a format slot).
--
-- The verify block at the end is CATALOGUE-ONLY (pg_proc, pg_class, pg_policy,
-- information_schema, has_*_privilege, aclexplode). It reads no compute_jobs row and
-- raises on no data-dependent condition, because TEST holds PROD's catalogue but not its
-- data ([164.8-DATA-DEPENDENT-MIGRATION-ESCAPE]). It asserts no function BODY text
-- either: the gate's twins edit the body, and a verify that asserted it would abort the
-- twin's apply instead of letting the arm bite.
--
-- Rollback: supabase/migrations/down/20261114130000-rollback.sql (manual, never
-- auto-applied). It restores both prior bodies and drops the helper; it KEEPS the side
-- table and its rows.
-- ==========================================================================

SET LOCAL lock_timeout = '3s';

-- ==========================================================================
-- STEP 1: public.compute_job_dedup_events, the side table
-- ==========================================================================
-- Plain CREATE TABLE, not IF NOT EXISTS: the name is new, so a collision must fail loud.
CREATE TABLE public.compute_job_dedup_events (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id           uuid        NOT NULL REFERENCES public.compute_jobs(id) ON DELETE CASCADE,
  caller_metadata  jsonb       NOT NULL,
  -- No CHECK on this column: a CHECK listing marker names would be a third copy of the
  -- marker list that no Python or TypeScript parity test reads.
  retracted_marker text,
  deduped_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT compute_job_dedup_events_caller_metadata_object_chk
    CHECK (jsonb_typeof(caller_metadata) = 'object'),
  -- Mirrors compute_jobs_metadata_size_bounded. A backstop only: the helper turns an
  -- oversize payload into {"oversize_bytes": n} before it reaches this CHECK.
  CONSTRAINT compute_job_dedup_events_caller_metadata_size_chk
    CHECK (octet_length(caller_metadata::text) <= 8192)
);

-- A retention delete of a job must not seq-scan the child through the FK.
CREATE INDEX compute_job_dedup_events_job_id_idx
  ON public.compute_job_dedup_events (job_id);

COMMENT ON TABLE public.compute_job_dedup_events IS
  'Phase 211 D11 (migration 20261114130000): one row per enqueue that deduped onto an in-flight compute job and carried metadata, written by public._record_enqueue_dedup. Rows die with their job through the FK (done rows after 30 days, failed rows after 90). There is NO delete-guard trigger; if one is ever added it must exempt quantalyze.sanitize_in_progress = ''on''. No user_id column, so the GDPR export does not cover it. Reachable only through the SECURITY DEFINER writer; service_role holds SELECT for operators.';
COMMENT ON COLUMN public.compute_job_dedup_events.id IS
  'Row id, generated.';
COMMENT ON COLUMN public.compute_job_dedup_events.job_id IS
  'The in-flight compute job the enqueue deduped onto (the id the enqueue returned). ON DELETE CASCADE: the event dies with its job.';
COMMENT ON COLUMN public.compute_job_dedup_events.caller_metadata IS
  'The p_metadata the deduping caller sent, as a JSON object. A payload over 8192 bytes is stored as {"oversize_bytes": n} instead. NULL, empty and non-object metadata are never recorded.';
COMMENT ON COLUMN public.compute_job_dedup_events.retracted_marker IS
  'The refresh marker (source value) the SAME call retracted from the existing job, else NULL. After this migration the Python backstop answers no_marker on that collision and logs nothing, so this column is the audit trail of a SQL retraction.';
COMMENT ON COLUMN public.compute_job_dedup_events.deduped_at IS
  'When the enqueue deduped.';

-- RLS: ENABLE, deliberately WITHOUT FORCE, and this is a DECISION. The only writer is a
-- SECURITY DEFINER function running as the table owner. FORCE ROW LEVEL SECURITY would
-- subject that owner to the deny-all policy below, turning its INSERT into a policy
-- refusal that aborts EVERY dedup-with-metadata enqueue. This table has no other
-- reader or writer for FORCE to protect, and a silent enqueue failure on PROD is the
-- cost (the strategy_sync_cursors migration, 20260919120000, reasons the same way about
-- its own SECURITY DEFINER readers).
ALTER TABLE public.compute_job_dedup_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY compute_job_dedup_events_deny_all ON public.compute_job_dedup_events
  FOR ALL
  USING (false)
  WITH CHECK (false);

COMMENT ON POLICY compute_job_dedup_events_deny_all ON public.compute_job_dedup_events IS
  'Deny every row to every non-owner role. The only writer, public._record_enqueue_dedup, runs as the table owner, which bypasses RLS because the table is ENABLEd and not FORCEd.';

-- Grants. Supabase default privileges hand new tables to anon, authenticated and
-- service_role, so everything is revoked first and the one positive grant is restated.
-- service_role keeps SELECT only: the writer runs as the table owner and needs no grant,
-- so a direct service_role writer fails loud with 42501 instead of working by accident.
REVOKE ALL ON TABLE public.compute_job_dedup_events FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE public.compute_job_dedup_events TO service_role;

-- ==========================================================================
-- STEP 2: public._record_enqueue_dedup, the helper
-- ==========================================================================
-- Plain CREATE FUNCTION, not OR REPLACE: the name is new, so a collision fails loud.
--
-- Contract:
--   (a) returns at once for a NULL job id, a PARENTED enqueue (D11-10), and NULL,
--       non-object or empty caller metadata (D11-11).
--   (a2) returns at once, recording and retracting nothing, when the existing job is
--       `done_pending_children` (review WR-01; the lock argument is in the header). Read
--       with a plain non-locking SELECT.
--   (b) retracts only for a marker-capable kind, a caller that sends a correlation_id,
--       and a caller that does not itself send a refresh marker. A caller with no
--       `source` key at all counts as "no marker" (the process_key_long tail sends
--       exactly a correlation_id), which is why the list test sits inside COALESCE: a
--       bare NOT over a NULL membership test is NULL and would skip the retraction. A
--       JSON-null correlation_id reads as absent.
--   (c) records the metadata AFTER the retraction, so retracted_marker can carry the
--       marker the retraction removed.
-- There is NO exception handler. A failure here is a defect, and a swallowed one would
-- be silent. The marker list is written once, in (b).
CREATE FUNCTION public._record_enqueue_dedup(
  p_job_id         uuid,
  p_kind           text,
  p_metadata       jsonb,
  p_parent_job_ids uuid[]
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_res    jsonb;
  v_marker text;
  v_bytes  integer;
  v_status text;
BEGIN
  IF p_job_id IS NULL
     OR COALESCE(cardinality(p_parent_job_ids), 0) > 0
     OR jsonb_typeof(p_metadata) IS DISTINCT FROM 'object'
     OR p_metadata = '{}'::jsonb THEN
    RETURN;
  END IF;

  -- Review WR-01: a `done_pending_children` row is a fan-in child, and the FOR UPDATE that
  -- mark_compute_job_done and mark_compute_job_failed take on fan-in children conflicts with
  -- the FOR KEY SHARE this helper's INSERT takes through the FK. Skip such a row, so the
  -- helper never holds or waits on a row the ancestor-first protocol locks. Plain SELECT, no
  -- lock. A row never enters this status after its insert, so the read cannot go stale into it.
  SELECT status INTO v_status FROM public.compute_jobs WHERE id = p_job_id;
  IF v_status = 'done_pending_children' THEN
    RETURN;
  END IF;

  IF p_kind IN ('derive_broker_dailies', 'compute_analytics_from_csv', 'stitch_composite')
     AND (p_metadata ->> 'correlation_id') IS NOT NULL
     AND NOT COALESCE((p_metadata ->> 'source') IN ('ledger-refresh', 'ledger-refresh-composite'), FALSE) THEN
    v_res := public.retract_ledger_refresh_marker(p_job_id, p_metadata ->> 'correlation_id');
    IF v_res ->> 'outcome' = 'retracted' THEN
      v_marker := v_res ->> 'marker';
      RAISE WARNING '_record_enqueue_dedup: retracted marker % from compute_job %', v_marker, p_job_id;
    END IF;
  END IF;

  v_bytes := octet_length(p_metadata::text);
  INSERT INTO public.compute_job_dedup_events (job_id, caller_metadata, retracted_marker)
  VALUES (
    p_job_id,
    CASE WHEN v_bytes > 8192 THEN jsonb_build_object('oversize_bytes', v_bytes) ELSE p_metadata END,
    v_marker
  );
END;
$$;

COMMENT ON FUNCTION public._record_enqueue_dedup(uuid, text, jsonb, uuid[]) IS
  'Phase 211 D11 (migration 20261114130000): called at both dedup return sites of both _enqueue_compute_job_internal overloads. Records the caller''s p_metadata in compute_job_dedup_events and, for a marker-capable kind (derive_broker_dailies, compute_analytics_from_csv, stitch_composite) whose caller sends a correlation_id and no refresh marker, retracts an inherited ledger-refresh marker through public.retract_ledger_refresh_marker in the same call. Does nothing for a parented enqueue, for an existing job that is done_pending_children, for NULL, empty or non-object metadata. Metadata over 8192 bytes is recorded as {oversize_bytes: n} and never fails the enqueue. Merges no caller key into the job row. Service-role only; no caller outside the enqueue function.';

-- ==========================================================================
-- STEP 3: the two overloads of _enqueue_compute_job_internal, re-based
-- ==========================================================================
-- --------------------------------------------------------------------------
-- 7-argument overload: verbatim from 20260716090000 (its CREATE OR REPLACE, with the
-- retired-kind guard), the header schema-qualified, plus the two helper calls. The
-- overload is unreachable (42725 on any 7-argument call, D11-13).
-- --------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._enqueue_compute_job_internal(
  p_strategy_id     UUID,
  p_portfolio_id    UUID,
  p_kind            TEXT,
  p_idempotency_key TEXT,
  p_parent_job_ids  UUID[],
  p_exchange        TEXT,
  p_metadata        JSONB
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_existing_id UUID;
  v_new_id      UUID;
  v_initial_status TEXT;
BEGIN
  IF (p_strategy_id IS NULL AND p_portfolio_id IS NULL)
     OR (p_strategy_id IS NOT NULL AND p_portfolio_id IS NOT NULL) THEN
    RAISE EXCEPTION '_enqueue_compute_job_internal: exactly one of p_strategy_id or p_portfolio_id must be non-null (got strategy=%, portfolio=%)',
      p_strategy_id, p_portfolio_id
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  IF p_kind IS NULL THEN
    RAISE EXCEPTION '_enqueue_compute_job_internal: p_kind is required'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  -- Phase 106 D3: the compute_analytics kind is retired. The registry + CHECKs
  -- still admit it (45 historical rows FK-reference it); this is an RPC-level
  -- admission reject only — no enqueue path remains.
  IF p_kind = 'compute_analytics' THEN
    RAISE EXCEPTION '_enqueue_compute_job_internal: kind compute_analytics is retired (Phase 106) — no enqueue path remains'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  -- P12: rows with unfulfilled parents start as done_pending_children
  -- so the fan-in advancement loop in mark_compute_job_done picks them
  -- up. Leaf rows (no parents) start as pending per the column DEFAULT.
  IF p_parent_job_ids IS NOT NULL
     AND array_length(p_parent_job_ids, 1) IS NOT NULL
     AND array_length(p_parent_job_ids, 1) > 0 THEN
    v_initial_status := 'done_pending_children';
  ELSE
    v_initial_status := 'pending';
  END IF;

  -- Optimistic path: existing in-flight job for this (target, kind).
  -- The optimistic SELECT covers all three in-flight statuses; the
  -- partial unique index agrees on this set so a winner inserted with
  -- done_pending_children is also caught here.
  IF p_strategy_id IS NOT NULL THEN
    SELECT id INTO v_existing_id
      FROM compute_jobs
      WHERE strategy_id = p_strategy_id
        AND kind = p_kind
        AND status IN ('pending', 'running', 'done_pending_children')
      LIMIT 1;
  ELSE
    SELECT id INTO v_existing_id
      FROM compute_jobs
      WHERE portfolio_id = p_portfolio_id
        AND kind = p_kind
        AND status IN ('pending', 'running', 'done_pending_children')
      LIMIT 1;
  END IF;

  IF v_existing_id IS NOT NULL THEN
    PERFORM public._record_enqueue_dedup(v_existing_id, p_kind, p_metadata, p_parent_job_ids);  -- Phase 211 D11, SITE A (7-arg)
    RETURN v_existing_id;
  END IF;

  -- Race-safe insert. The partial unique index catches any concurrent
  -- INSERT with the same (target, kind) and leaves v_new_id NULL.
  INSERT INTO compute_jobs (
    strategy_id, portfolio_id, kind, parent_job_ids,
    idempotency_key, exchange, metadata, status
  )
  VALUES (
    p_strategy_id, p_portfolio_id, p_kind, p_parent_job_ids,
    p_idempotency_key, p_exchange, p_metadata, v_initial_status
  )
  ON CONFLICT DO NOTHING
  RETURNING id INTO v_new_id;

  IF v_new_id IS NOT NULL THEN
    RETURN v_new_id;
  END IF;

  -- Lost the race. Re-read the winner's row. Plain SELECT INTO (NOT
  -- STRICT) because between the conflict and the re-read the winner
  -- may have advanced past the in-flight statuses (done / failed_*).
  -- That's a legitimate race outcome — the original SELECT INTO STRICT
  -- raised NO_DATA_FOUND with no domain-specific message and surfaced
  -- as an opaque 500 to the user-facing request. (P3)
  IF p_strategy_id IS NOT NULL THEN
    SELECT id INTO v_new_id
      FROM compute_jobs
      WHERE strategy_id = p_strategy_id
        AND kind = p_kind
        AND status IN ('pending', 'running', 'done_pending_children')
      LIMIT 1;
  ELSE
    SELECT id INTO v_new_id
      FROM compute_jobs
      WHERE portfolio_id = p_portfolio_id
        AND kind = p_kind
        AND status IN ('pending', 'running', 'done_pending_children')
      LIMIT 1;
  END IF;

  IF v_new_id IS NULL THEN
    -- Winner already advanced past in-flight. Tell the caller this
    -- was a race loss with a recoverable error code so the app layer
    -- can retry the enqueue without surfacing a 500. ERRCODE
    -- 'serialization_failure' is the canonical Postgres class for
    -- "MVCC race, retry safe".
    RAISE EXCEPTION '_enqueue_compute_job_internal: enqueue race lost and winner already terminal (target strategy=%, portfolio=%, kind=%)',
      p_strategy_id, p_portfolio_id, p_kind
      USING ERRCODE = 'serialization_failure';
  END IF;

  PERFORM public._record_enqueue_dedup(v_new_id, p_kind, p_metadata, p_parent_job_ids);  -- Phase 211 D11, SITE B (7-arg)
  RETURN v_new_id;
END;
$$;

-- --------------------------------------------------------------------------
-- 10-argument overload: verbatim from section (3) of 20261024120000 (the latest
-- definition), plus the two helper calls.
-- --------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._enqueue_compute_job_internal(
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
  v_initial_status TEXT;
  v_parents_found  INT;
  v_parents_failed INT;
  v_parents_open   INT;
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

  -- Phase 106 D3: the compute_analytics kind is retired. The registry + CHECKs
  -- still admit it (45 historical rows FK-reference it); this is an RPC-level
  -- admission reject only — no enqueue path remains.
  IF p_kind = 'compute_analytics' THEN
    RAISE EXCEPTION '_enqueue_compute_job_internal: kind compute_analytics is retired (Phase 106) — no enqueue path remains'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  -- Phase 164.9.1 (mig 109 P12 intent, mirrored from the 7-param overload in
  -- 20260716090000): rows with parents start as done_pending_children so the
  -- fan-in advance in mark_compute_job_done holds them until a parent
  -- completes. Leaf rows (no parents) start as pending.
  --
  -- Round-1 review (silent-failure-hunter HIGH-2): the fan-in advance releases
  -- a child only when a parent is marked done AND every listed parent is
  -- 'done'. A child whose parents cannot all reach 'done' through a later
  -- mark-done would sit in done_pending_children forever, holding its
  -- (target, kind) in-flight slot, and every later enqueue for that target
  -- and kind would be handed its id. So the parents are READ here:
  --   * a NULL element, or an id with no row   -> refused, loudly;
  --   * a parent that already ended failed_final -> refused, loudly;
  --   * every parent already 'done'           -> no mark-done will ever
  --     release the child, and nothing needs to hold it: it starts pending;
  --   * otherwise a parent is still open       -> done_pending_children.
  -- The parents are locked FOR SHARE, in id order, BEFORE they are counted.
  -- mark_compute_job_done flips its parent with an UPDATE, which waits on
  -- that lock, and runs its fan-in advance as a LATER statement, which sees
  -- this child once this transaction commits. Without the lock a parent could
  -- commit 'done' between this read and the INSERT below, and its fan-in
  -- advance would miss a child it never saw.
  IF p_parent_job_ids IS NOT NULL
     AND array_length(p_parent_job_ids, 1) IS NOT NULL
     AND array_length(p_parent_job_ids, 1) > 0 THEN
    IF array_position(p_parent_job_ids, NULL) IS NOT NULL THEN
      RAISE EXCEPTION '_enqueue_compute_job_internal: p_parent_job_ids contains a NULL element; a fan-in child must name real parent jobs'
        USING ERRCODE = 'invalid_parameter_value';
    END IF;

    -- Phase 164.9.3.1 D-06: the parents are locked through the ancestor-first
    -- helper (key: depth, then id), not by job id alone. The paragraph above
    -- that says "in id order" is the lineage this replaces: a pure id order
    -- deadlocks against mark_compute_job_done on a diamond.
    PERFORM public._fan_in_lock_rows(p_parent_job_ids, FALSE);

    SELECT count(*),
           count(*) FILTER (WHERE pj.status = 'failed_final'),
           count(*) FILTER (WHERE pj.status <> 'done')
      INTO v_parents_found, v_parents_failed, v_parents_open
      FROM compute_jobs pj
     WHERE pj.id = ANY(p_parent_job_ids);

    IF v_parents_found <> cardinality(ARRAY(SELECT DISTINCT unnest(p_parent_job_ids))) THEN
      RAISE EXCEPTION '_enqueue_compute_job_internal: p_parent_job_ids names % parent job(s) with no compute_jobs row; a child of a missing parent could never be released by the fan-in advance',
        cardinality(ARRAY(SELECT DISTINCT unnest(p_parent_job_ids))) - v_parents_found
        USING ERRCODE = 'invalid_parameter_value';
    END IF;

    IF v_parents_failed > 0 THEN
      RAISE EXCEPTION '_enqueue_compute_job_internal: % parent job(s) in p_parent_job_ids already ended failed_final; a child of a failed parent could never be released by the fan-in advance',
        v_parents_failed
        USING ERRCODE = 'invalid_parameter_value';
    END IF;

    IF v_parents_open > 0 THEN
      v_initial_status := 'done_pending_children';
    ELSE
      v_initial_status := 'pending';
    END IF;
  ELSE
    v_initial_status := 'pending';
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
    PERFORM public._record_enqueue_dedup(v_existing_id, p_kind, p_metadata, p_parent_job_ids);  -- Phase 211 D11, SITE A (10-arg)
    RETURN v_existing_id;
  END IF;

  -- Race-safe INSERT — the partial unique index is the final arbiter.
  INSERT INTO compute_jobs (
    strategy_id, portfolio_id, allocator_id, api_key_id,
    kind, parent_job_ids, idempotency_key, exchange, metadata,
    next_attempt_at, status
  )
  VALUES (
    p_strategy_id, p_portfolio_id, p_allocator_id, p_api_key_id,
    p_kind, COALESCE(p_parent_job_ids, '{}'::uuid[]), p_idempotency_key,
    p_exchange, p_metadata,
    COALESCE(p_run_at, now()), v_initial_status
  )
  ON CONFLICT DO NOTHING
  RETURNING id INTO v_new_id;

  IF v_new_id IS NOT NULL THEN
    RETURN v_new_id;
  END IF;

  -- Lost the race — re-read the winner's row. Plain SELECT INTO, because
  -- between the conflict and the re-read the winner may have advanced past
  -- the in-flight statuses (done / failed_*). That is a legitimate race
  -- outcome, but the strict re-read this replaced raised NO_DATA_FOUND with
  -- no domain-specific message and surfaced as an opaque 500 to the
  -- user-facing request. (Phase 163 OPS-08; the 7-param overload got the same
  -- treatment as mig 109 P3 — this is parity, not a new policy.)
  IF p_strategy_id IS NOT NULL THEN
    SELECT id INTO v_new_id
      FROM compute_jobs
     WHERE strategy_id = p_strategy_id
       AND kind = p_kind
       AND status IN ('pending', 'running', 'done_pending_children')
     LIMIT 1;
  ELSIF p_portfolio_id IS NOT NULL THEN
    SELECT id INTO v_new_id
      FROM compute_jobs
     WHERE portfolio_id = p_portfolio_id
       AND kind = p_kind
       AND status IN ('pending', 'running', 'done_pending_children')
     LIMIT 1;
  ELSIF p_allocator_id IS NOT NULL THEN
    SELECT id INTO v_new_id
      FROM compute_jobs
     WHERE allocator_id = p_allocator_id
       AND kind = p_kind
       AND status IN ('pending', 'running', 'done_pending_children')
     LIMIT 1;
  ELSE
    SELECT id INTO v_new_id
      FROM compute_jobs
     WHERE api_key_id = p_api_key_id
       AND kind = p_kind
       AND status IN ('pending', 'running', 'done_pending_children')
     LIMIT 1;
  END IF;

  IF v_new_id IS NULL THEN
    -- Winner already advanced past in-flight. Classify the outcome: ERRCODE
    -- serialization_failure (40001) is the canonical Postgres class for "MVCC
    -- race, retry safe", and the SQLSTATE is the WHOLE signal. A caller that
    -- wants to retry branches on the code, never on this string.
    --
    -- ⛔ THIS MESSAGE IS OPERATOR TEXT AND IT STILL REACHES A USER-VISIBLE
    -- COLUMN. An earlier version of this note said the remedy was to keep the
    -- message SHORT. That is the WRONG PROPERTY and the phase-163 review
    -- (WR-07) was right to say so: the property that matters is NOT OPERATOR
    -- JARGON, and shortness does not deliver it.
    --
    -- The path, re-measured at HEAD 2026-08-26 (the old note's :2012 was
    -- stale):
    --   src/app/api/strategies/csv-finalize/route.ts:2035 builds
    --     `compute job enqueue failed: ${enqueueErrMessage}`
    --   then writeFailedStrategyAnalyticsPlaceholder (:1868) writes it to
    --   strategy_analytics.computation_error (:1928), which renders VERBATIM
    --   to the strategy's OWNER in the wizard failure envelope.
    --
    -- ⚠️ AND THAT PREFIX IS BUILT ON THE TS SIDE, UNCONDITIONALLY, with no
    -- SQLSTATE branch in front of it. So NO message this function can raise
    -- keeps operator jargon out of that column: the user reads "compute job
    -- enqueue failed: ..." whatever follows the colon. SQL can choose WHICH
    -- jargon appears; it cannot remove jargon. Rewording this string into
    -- curated user copy would be cosmetic, and it would additionally push user
    -- copy into the operator log line for the allocator / portfolio / api_key
    -- callers, which are not user-facing at all. The fix is a TS change, and it
    -- HAS LANDED (2026-08-26): csv-finalize now branches on SQLSTATE 40001 and
    -- writes curated copy instead of prefixing this sentence. So this string
    -- stays operator-shaped ON PURPOSE and is now correct to do so — the user
    -- no longer reads it, while the allocator / portfolio / api_key callers
    -- still get the precise operator wording they need.
    --
    -- What the old note got RIGHT, and what therefore stays: naming the
    -- internal SECDEF function and the four internal UUIDs here would make the
    -- leak strictly worse, and nothing diagnostic is lost by omitting them —
    -- the caller already knows which target it asked for, and the server log's
    -- CONTEXT line still names this function for operators.
    RAISE EXCEPTION 'enqueue race lost: the winning job already advanced past the in-flight statuses'
      USING ERRCODE = 'serialization_failure';
  END IF;

  PERFORM public._record_enqueue_dedup(v_new_id, p_kind, p_metadata, p_parent_job_ids);  -- Phase 211 D11, SITE B (10-arg)
  RETURN v_new_id;
END;
$$;

-- ==========================================================================
-- STEP 4: ACL, restated for all three signatures with grantees named
-- ==========================================================================
-- A Supabase default-grant event trigger can re-open EXECUTE on this function family on
-- every CREATE OR REPLACE (migration 20260515130001 records it), and an unqualified
-- statement "silently failed under two coexisting overloads" there, so every statement
-- below carries its full argument list.
REVOKE ALL ON FUNCTION public._record_enqueue_dedup(uuid, text, jsonb, uuid[])
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._record_enqueue_dedup(uuid, text, jsonb, uuid[])
  TO service_role;

REVOKE ALL ON FUNCTION public._enqueue_compute_job_internal(
  uuid, uuid, text, text, uuid[], text, jsonb
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._enqueue_compute_job_internal(
  uuid, uuid, text, text, uuid[], text, jsonb
) TO service_role;

REVOKE ALL ON FUNCTION public._enqueue_compute_job_internal(
  uuid, uuid, text, text, uuid[], text, jsonb,
  uuid, uuid, timestamptz
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._enqueue_compute_job_internal(
  uuid, uuid, text, text, uuid[], text, jsonb,
  uuid, uuid, timestamptz
) TO service_role;

-- Catalog text of the 10-argument overload, re-issued verbatim from 20261024120000 (the
-- latest COMMENT; nothing newer exists). `Phase 163 OPS-08` stays in it:
-- test_enqueue_internal_destrict.sql greps the catalog for that phrase as its revert
-- discriminator, and the verify block below asserts it.
COMMENT ON FUNCTION public._enqueue_compute_job_internal(
  uuid, uuid, text, text, uuid[], text, jsonb,
  uuid, uuid, timestamptz
) IS
  'Private shared implementation of the idempotent enqueue pattern. Handles all '
  'four target scopes (strategy / portfolio / allocator / api_key) via 4-way XOR '
  'on the four id parameters. Extended in migration 066 for api_key scope + '
  'scheduled run_at. ACL re-asserted by migration 118. Rejects the retired '
  'compute_analytics kind with invalid_parameter_value (Phase 106 D3). '
  'Race-loser re-read uses a plain SELECT INTO on all four arms; if the winner '
  'already advanced past the in-flight statuses, raises serialization_failure so '
  'the caller can retry vs. surfacing a 500 (Phase 163 OPS-08, parity with the '
  '7-param overload''s mig 109 P3 fix). '
  'Computes the initial status and INSERTs it explicitly: done_pending_children '
  'while at least one listed parent is not yet done; a child whose parents are '
  'all done starts pending, as does a child with no parents (Phase 164.9.1). '
  'With parents, it locks them first through public._fan_in_lock_rows in '
  'ancestor-first (depth, id) order (Phase 164.9.3.1 D-06) and reads them: a NULL '
  'element, a missing parent or a failed_final parent is refused with '
  'invalid_parameter_value, so no enqueue creates a child that no mark-done can '
  'release. '
  'On a dedup hit (the optimistic look-up and the lost-race re-read) it calls '
  'public._record_enqueue_dedup, which records the caller''s metadata in '
  'compute_job_dedup_events and retracts an inherited refresh marker (Phase 211 D11).';

-- ==========================================================================
-- STEP 5: self-verify, CATALOGUE ONLY (no compute_jobs row is read, nothing raises on data)
-- ==========================================================================
DO $$
DECLARE
  v_sigs      TEXT[] := ARRAY[
    'public._record_enqueue_dedup(uuid, text, jsonb, uuid[])',
    'public._enqueue_compute_job_internal(uuid, uuid, text, text, uuid[], text, jsonb)',
    'public._enqueue_compute_job_internal(uuid, uuid, text, text, uuid[], text, jsonb, uuid, uuid, timestamptz)'
  ];
  v_sig       TEXT;
  v_fn_oid    OID;
  v_tbl_oid   OID := to_regclass('public.compute_job_dedup_events');
  v_cols      TEXT[] := ARRAY['id', 'job_id', 'caller_metadata', 'retracted_marker', 'deduped_at'];
  v_col       TEXT;
  v_role      TEXT;
  v_priv      TEXT;
BEGIN
  -- ----- the three functions ------------------------------------------------
  FOREACH v_sig IN ARRAY v_sigs LOOP
    v_fn_oid := to_regprocedure(v_sig);
    IF v_fn_oid IS NULL THEN
      RAISE EXCEPTION 'Migration 20261114130000: function % missing', v_sig;
    END IF;

    IF NOT COALESCE((SELECT p.prosecdef FROM pg_proc p WHERE p.oid = v_fn_oid), false) THEN
      RAISE EXCEPTION 'Migration 20261114130000: % is NOT SECURITY DEFINER', v_sig;
    END IF;

    IF NOT COALESCE((SELECT 'search_path=public, pg_catalog' = ANY(p.proconfig)
                       FROM pg_proc p WHERE p.oid = v_fn_oid), false) THEN
      RAISE EXCEPTION 'Migration 20261114130000: % missing SET search_path = public, pg_catalog', v_sig;
    END IF;

    IF NOT has_function_privilege('service_role', v_fn_oid, 'EXECUTE') THEN
      RAISE EXCEPTION 'Migration 20261114130000: service_role lacks EXECUTE on % (the enqueue path cannot call it)', v_sig;
    END IF;
    IF has_function_privilege('anon', v_fn_oid, 'EXECUTE') THEN
      RAISE EXCEPTION 'Migration 20261114130000: anon can EXECUTE % (a SECURITY DEFINER function exposed through PostgREST)', v_sig;
    END IF;
    IF has_function_privilege('authenticated', v_fn_oid, 'EXECUTE') THEN
      RAISE EXCEPTION 'Migration 20261114130000: authenticated can EXECUTE % (a SECURITY DEFINER function exposed through PostgREST)', v_sig;
    END IF;

    -- PUBLIC (grantee 0) must hold no EXECUTE: the grant list is explicit.
    IF EXISTS (SELECT 1
                 FROM pg_proc p, aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) a
                WHERE p.oid = v_fn_oid AND a.grantee = 0 AND a.privilege_type = 'EXECUTE') THEN
      RAISE EXCEPTION 'Migration 20261114130000: PUBLIC still holds EXECUTE on %', v_sig;
    END IF;
  END LOOP;

  -- The 10-argument overload's catalog text keeps the phrase the destrict gate reads.
  IF COALESCE(obj_description(to_regprocedure(v_sigs[3]), 'pg_proc'), '') NOT LIKE '%Phase 163 OPS-08%' THEN
    RAISE EXCEPTION 'Migration 20261114130000: the 10-argument enqueue COMMENT lost the phrase Phase 163 OPS-08';
  END IF;

  -- ----- the side table -----------------------------------------------------
  IF v_tbl_oid IS NULL THEN
    RAISE EXCEPTION 'Migration 20261114130000: public.compute_job_dedup_events missing';
  END IF;

  FOREACH v_col IN ARRAY v_cols LOOP
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns c
                    WHERE c.table_schema = 'public'
                      AND c.table_name = 'compute_job_dedup_events'
                      AND c.column_name = v_col) THEN
      RAISE EXCEPTION 'Migration 20261114130000: compute_job_dedup_events lacks column %', v_col;
    END IF;
  END LOOP;

  IF NOT COALESCE((SELECT c.relrowsecurity FROM pg_class c WHERE c.oid = v_tbl_oid), false) THEN
    RAISE EXCEPTION 'Migration 20261114130000: compute_job_dedup_events does not have row level security enabled';
  END IF;
  IF COALESCE((SELECT c.relforcerowsecurity FROM pg_class c WHERE c.oid = v_tbl_oid), true) THEN
    RAISE EXCEPTION 'Migration 20261114130000: compute_job_dedup_events has row level security forced on, which would refuse its own SECURITY DEFINER writer';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policy pol
                  WHERE pol.polrelid = v_tbl_oid
                    AND pol.polname = 'compute_job_dedup_events_deny_all'
                    AND pol.polcmd = '*') THEN
    RAISE EXCEPTION 'Migration 20261114130000: compute_job_dedup_events_deny_all FOR ALL policy missing';
  END IF;

  FOREACH v_role IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    FOREACH v_priv IN ARRAY ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE'] LOOP
      IF has_table_privilege(v_role, v_tbl_oid, v_priv) THEN
        RAISE EXCEPTION 'Migration 20261114130000: % holds % on compute_job_dedup_events', v_role, v_priv;
      END IF;
    END LOOP;
  END LOOP;

  IF NOT has_table_privilege('service_role', v_tbl_oid, 'SELECT') THEN
    RAISE EXCEPTION 'Migration 20261114130000: service_role lacks SELECT on compute_job_dedup_events';
  END IF;
  IF has_table_privilege('service_role', v_tbl_oid, 'INSERT') THEN
    RAISE EXCEPTION 'Migration 20261114130000: service_role can INSERT into compute_job_dedup_events (the only writer is the SECURITY DEFINER helper)';
  END IF;

  RAISE NOTICE 'Migration 20261114130000: compute_job_dedup_events, _record_enqueue_dedup and both _enqueue_compute_job_internal overloads installed (catalogue verified: SECDEF, pinned search_path, service_role-only EXECUTE, deny-all RLS without FORCE).';
END $$;

-- ==========================================================================
-- END OF MIGRATION 20261114130000
-- ==========================================================================
