-- Migration: compute_jobs HIGH hardening (audit-2026-05-07 H-pass on mig 032)
--
-- Audit findings addressed: H-0849, H-0851, H-0857, H-0865, H-0866.
--
-- Why this migration exists
-- -------------------------
-- The audit-2026-05-07 H-pass on supabase/migrations/032_compute_jobs_queue.sql
-- identified five SQL-actionable HIGH defects beyond what migrations
-- 109/110/111/117 closed in the CRITICAL pass:
--
--   * H-0849 (red-team c7): compute_jobs.metadata is unbounded JSONB.
--     A compromised service-role token (or a buggy worker) can write
--     megabyte-sized blobs that bloat the heap and degrade every admin
--     page load. The runbook documents intent for a 4KB ceiling but
--     ships nothing enforcing it.
--   * H-0851 (performance c8): compute_jobs_parent_lookup GIN index has
--     no WHERE clause and therefore indexes every terminal-status row.
--     Daily fan-in for ~1000 strategies × 3 kinds ⇒ ~1.1M rows/year of
--     index bloat against rows the fan-in queries never visit.
--   * H-0857 (security c7): claim_compute_jobs / claim_compute_jobs_with_priority
--     accept p_worker_id as free-form TEXT. Only validation is non-empty.
--     If the REVOKE is ever relaxed, any caller can impersonate any
--     worker_id. Defense-in-depth: regex-validate the shape against the
--     deployed Railway naming convention.
--   * H-0865 (performance c9): mark_compute_job_done's child advancement
--     loop uses `p_job_id = ANY(parent_job_ids)`, which Postgres treats
--     as a row-by-row scalar expression. The compute_jobs_parent_lookup
--     GIN index supports `@>`, `<@`, `&&` — not `= ANY`. The planner
--     silently falls back to a sequential scan of compute_jobs each
--     time any job completes. Combined with H-0851 the cost scales with
--     full-table size on every successful job.
--   * H-0866 (silent-failure-hunter c7): the child UPDATE inside the
--     advancement loop has no GET DIAGNOSTICS, no NOT FOUND check. If
--     the child has been advanced by a concurrent worker or moved to
--     failed_final by reclaim, the UPDATE silently affects 0 rows and
--     the loop continues without any operator signal.
--
-- Items NOT in this migration
-- ---------------------------
--   * H-0853 / H-0854 / H-0856 / H-0862 / H-0867 / H-0868: test-analyzer
--     findings asking for live-DB Vitest regression tests. Tests are not
--     SQL-only forward migrations.
--   * H-0861 (multi-level chain stall): migration 109 documents that the
--     audit description is misleading (chains DO propagate). The actual
--     enqueue-time fix landed in mig 109 P12.
--   * H-0864 (N+1 set-based rewrite): the LOOP shape is preserved on
--     purpose so the GET DIAGNOSTICS signal (H-0866) and the row-by-row
--     check_fan_in_ready audit log lines (mig 109 P17) keep working.
--     Collapsing into one set-based UPDATE eliminates the per-child
--     observability the operators rely on.
--
-- What this migration ships
-- -------------------------
-- 1. CHECK constraint on compute_jobs.metadata bounding pg_column_size
--    to <= 8192 bytes (8 KB). Generous ceiling above the existing
--    correlation_id + Phase 18 forensic + Phase 19 backbone metadata
--    footprint (typically <500 bytes per row) while still bounding the
--    blast radius of a metadata-poisoning attempt.
-- 2. Rebuild compute_jobs_parent_lookup with `WHERE status IN
--    ('pending','running','done_pending_children')` so the GIN indexes
--    only live rows the fan-in queries actually visit.
-- 3. CHECK constraint on compute_jobs.claimed_by bounding length and
--    enforcing a safe charset. The shape mirrors the deployed Railway
--    naming convention (`railway-*-<6..>` and similar `worker-*` ids)
--    while still permitting the local-dev `test-*` pattern.
-- 4. CREATE OR REPLACE mark_compute_job_done with two behavioral
--    additions to the child advancement loop:
--    (a) The `WHERE p_job_id = ANY(parent_job_ids)` predicate is
--        rewritten as `WHERE parent_job_ids @> ARRAY[p_job_id]::uuid[]`
--        so the GIN index can serve the lookup.
--    (b) `GET DIAGNOSTICS` after the child UPDATE captures the row count.
--        A `RAISE NOTICE` fires when a child UPDATE no-ops, so operators
--        can distinguish "fan-in advanced 5/5 children" from "0/5 because
--        all children were already advanced by a concurrent worker".
--    The mig 109 P6 idempotent-retry branch and the mig 117 P97 claim-
--    token fence are preserved verbatim.
--
-- Idempotency
-- -----------
-- * CHECK constraints use a NOT VALID + VALIDATE in same tx pattern so
--   re-applying on a database that already carries them is a no-op
--   (the IF NOT EXISTS guard skips the ADD).
-- * REINDEX would require an exclusive lock; instead we DROP + re-CREATE
--   the index with the partial predicate. DROP + CREATE is fast on the
--   existing GIN (small relative to the heap) and the function bodies
--   that query the index are simultaneously updated to use the index-
--   friendly containment operator.
-- * CREATE OR REPLACE on mark_compute_job_done preserves the mig 117
--   2-arg signature `(p_job_id UUID, p_claim_token UUID DEFAULT NULL)`.
--
-- Rollback
-- --------
-- supabase/migrations/down/20260515210000-rollback.sql restores the
-- mig 117 mark_compute_job_done body, drops the metadata + claimed_by
-- CHECKs, and rebuilds the GIN without the partial WHERE.

BEGIN;
SET lock_timeout = '5s';

-- --------------------------------------------------------------------------
-- STEP 1: H-0849 — bound compute_jobs.metadata size to 8 KB
-- --------------------------------------------------------------------------
-- Defense in depth. octet_length(metadata::text) measures the JSONB text
-- representation in bytes — IMMUTABLE, independent of TOAST/compression
-- policy, and indexable. The earlier pg_column_size variant was STABLE
-- (not IMMUTABLE) and tied to TOAST internals, which PG emits a WARNING
-- on at CHECK creation time and which drifts across PG major versions
-- (audit-A Q#5). Matches the 32 KB ceiling shape that
-- log_audit_event_service already enforces via octet_length.
-- 8 KB is comfortably above all current writers:
--   * the sync route writes { correlation_id }                   ~64 B
--   * mig 104 Phase 19 backbone metadata                         <512 B
--   * mig 109 fan-in initial-status metadata                     <128 B
-- 8 KB leaves three orders of magnitude of headroom while bounding
-- the abuse surface at one page's worth of TOAST.
--
-- Backfill: expected count in production is zero (the writers cited
-- above all stay well below the cap). audit-2026-05-07 SFT #2 (Phase
-- B): the migration FAILS LOUD on any oversized row rather than
-- silently coercing metadata → '{}'. Silent coercion would destroy
-- the very payload the audit wanted preserved for root-cause
-- analysis (compromised writer, runaway backfill, etc). If the count
-- is non-zero the operator must inspect, archive, and manually
-- coerce the rows before re-running this migration.
DO $$
DECLARE
  v_oversized INTEGER;
BEGIN
  SELECT count(*) INTO v_oversized
    FROM compute_jobs
   WHERE metadata IS NOT NULL
     AND octet_length(metadata::text) > 8192;

  IF v_oversized > 0 THEN
    RAISE EXCEPTION
      'audit-2026-05-07 H-0849: % compute_jobs rows carry metadata over the 8 KB cap. Inspect with: SELECT id, claimed_by, status, octet_length(metadata::text) FROM compute_jobs WHERE octet_length(metadata::text) > 8192 ORDER BY octet_length(metadata::text) DESC. Archive the offending payloads to forensic storage, manually coerce / DELETE the rows, then re-run this migration.',
      v_oversized
      USING ERRCODE = 'check_violation';
  END IF;
END $$;

ALTER TABLE compute_jobs
  DROP CONSTRAINT IF EXISTS compute_jobs_metadata_size_bounded;

ALTER TABLE compute_jobs
  ADD CONSTRAINT compute_jobs_metadata_size_bounded
  CHECK (metadata IS NULL OR octet_length(metadata::text) <= 8192)
  NOT VALID;

ALTER TABLE compute_jobs
  VALIDATE CONSTRAINT compute_jobs_metadata_size_bounded;

COMMENT ON CONSTRAINT compute_jobs_metadata_size_bounded ON compute_jobs IS
  'audit-2026-05-07 H-0849. Bounds compute_jobs.metadata pg_column_size at 8 KB '
  'so a compromised service-role token cannot DoS the heap by writing megabyte-'
  'sized JSONB blobs. Generous ceiling: current writers stay below 512 B.';

-- --------------------------------------------------------------------------
-- STEP 2: H-0851 + H-0865 — partial GIN index on parent_job_ids
-- --------------------------------------------------------------------------
-- The full-table GIN indexes every terminal-status row that fan-in
-- queries never visit. Convert to a partial GIN restricted to live
-- statuses (pending / running / done_pending_children). This (a) bounds
-- index growth at the live-queue working set and (b) is exactly the set
-- mark_compute_job_done's loop scans via the new `@> ARRAY[...]`
-- containment operator below — so the planner picks a Bitmap Index Scan
-- instead of the silent sequential scan the audit flagged.
--
-- DROP + CREATE is atomic inside this transaction. The index is small
-- enough on production that the recreate finishes inside the migration
-- window. If it ever grows beyond that, split into a separate migration
-- with CREATE INDEX CONCURRENTLY (which must run outside a tx).
DROP INDEX IF EXISTS compute_jobs_parent_lookup;

CREATE INDEX IF NOT EXISTS compute_jobs_parent_lookup
  ON compute_jobs USING GIN (parent_job_ids)
  WHERE status IN ('pending', 'running', 'done_pending_children');

COMMENT ON INDEX compute_jobs_parent_lookup IS
  'audit-2026-05-07 H-0851 + H-0865. Partial GIN on parent_job_ids limited to '
  'live (non-terminal) rows. Serves mark_compute_job_done''s child-advance loop '
  'via `parent_job_ids @> ARRAY[p_job_id]::uuid[]` containment. Drops index '
  'bloat across terminal rows and lifts the fan-in path off the sequential scan.';

-- --------------------------------------------------------------------------
-- STEP 3: H-0857 — bound compute_jobs.claimed_by shape
-- --------------------------------------------------------------------------
-- Defense in depth against a future REVOKE relaxation. The CHECK
-- permits the deployed Railway worker naming convention, Kubernetes-
-- style `<pod>/<container>` identifiers, and the local-dev `test-*`
-- shape. Length cap of 128 matches mig 109's idempotency_key CHECK so
-- an attacker cannot use claimed_by as a megabyte heap-poison surface
-- either.
--
-- audit-2026-05-07 Q#12 audit-A: live (non-terminal) rows whose
-- claimed_by violates the new shape are NOT silently coerced — that
-- would flag healthy workers as unclaimed and let the watchdog reclaim
-- them mid-flight. Fail loud on any live-row violation so an operator
-- updates the worker_id manually before re-running this migration.
-- Terminal-state rows (where the writing worker is no longer alive)
-- are still coerced because their claimed_by is purely historical.
DO $$
DECLARE
  v_record           RECORD;
  v_coerced          INTEGER := 0;
  v_live_violations  INTEGER;
BEGIN
  SELECT count(*) INTO v_live_violations
    FROM compute_jobs
   WHERE claimed_by IS NOT NULL
     AND (length(claimed_by) > 128
          OR claimed_by !~ '^[A-Za-z0-9_:./-]+$')
     AND status IN ('pending', 'running', 'done_pending_children');
  IF v_live_violations > 0 THEN
    RAISE EXCEPTION 'audit-2026-05-07 H-0857: % live compute_jobs rows have claimed_by outside the new CHECK shape. Update them manually before re-running this migration so the watchdog cannot reclaim a healthy worker.',
      v_live_violations
      USING ERRCODE = 'check_violation';
  END IF;

  -- audit-2026-05-07 SFT #1 (Phase B): emit a per-row NOTICE with the
  -- original claimed_by before nulling it so the migration apply log
  -- carries the forensic trail (which worker / pod / id pattern was
  -- non-conforming). The aggregate-count NOTICE alone left no
  -- artifact for incident retrospectives.
  FOR v_record IN
    SELECT id, claimed_by, status
      FROM compute_jobs
     WHERE claimed_by IS NOT NULL
       AND (length(claimed_by) > 128
            OR claimed_by !~ '^[A-Za-z0-9_:./-]+$')
       AND status NOT IN ('pending', 'running', 'done_pending_children')
  LOOP
    UPDATE compute_jobs SET claimed_by = NULL WHERE id = v_record.id;
    RAISE NOTICE 'audit-2026-05-07 H-0857: coerced compute_jobs.id=% claimed_by_before=% status=% (terminal-state).',
      v_record.id, v_record.claimed_by, v_record.status;
    v_coerced := v_coerced + 1;
  END LOOP;

  IF v_coerced > 0 THEN
    RAISE NOTICE 'audit-2026-05-07 H-0857: total % terminal-state compute_jobs.claimed_by rows coerced to NULL.', v_coerced;
  END IF;
END $$;

ALTER TABLE compute_jobs
  DROP CONSTRAINT IF EXISTS compute_jobs_claimed_by_safe;

ALTER TABLE compute_jobs
  ADD CONSTRAINT compute_jobs_claimed_by_safe
  CHECK (
    claimed_by IS NULL
    OR (length(claimed_by) <= 128
        AND claimed_by ~ '^[A-Za-z0-9_:./-]+$')
  )
  NOT VALID;

ALTER TABLE compute_jobs
  VALIDATE CONSTRAINT compute_jobs_claimed_by_safe;

COMMENT ON CONSTRAINT compute_jobs_claimed_by_safe ON compute_jobs IS
  'audit-2026-05-07 H-0857. Bound claimed_by to <=128 chars and a safe charset. '
  'Defense-in-depth against a future REVOKE relaxation that would let any '
  'caller impersonate any worker_id via claim_compute_jobs[_with_priority].';

-- --------------------------------------------------------------------------
-- STEP 4: H-0865 + H-0866 — mark_compute_job_done child-loop rewrite
-- --------------------------------------------------------------------------
-- Two surgical changes to the mig 117 mark_compute_job_done body:
--   (a) `p_job_id = ANY(parent_job_ids)` → `parent_job_ids @> ARRAY[p_job_id]::uuid[]`
--       The containment operator is in the GIN array_ops opclass and
--       benefits from the (now-partial) compute_jobs_parent_lookup
--       index. The semantics are identical: both say "rows whose
--       parent_job_ids contains p_job_id".
--   (b) GET DIAGNOSTICS after the per-child UPDATE captures ROW_COUNT.
--       RAISE NOTICE fires on a 0-row UPDATE so operators have a
--       guaranteed log line for "child was no-longer in
--       done_pending_children" — the race-loss / reclaim-collision
--       case the audit calls out.
--
-- The mig 117 P97 claim-token fence, mig 109 P6 idempotent-retry branch,
-- and mig 099 Phase-18 atomic UI status bridge are preserved verbatim.
-- Function signature unchanged: (p_job_id UUID, p_claim_token UUID
-- DEFAULT NULL).
CREATE OR REPLACE FUNCTION mark_compute_job_done(
  p_job_id      UUID,
  p_claim_token UUID DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_strategy_id      UUID;
  v_current_status   TEXT;
  v_current_token    UUID;
  v_child_id         UUID;
  v_advanced_count   INTEGER;
BEGIN
  -- Atomic flip running → done with token fence + strategy capture.
  -- p_claim_token IS NULL => fence skipped (back-compat for callers
  -- that haven't been updated to thread the token; pre-mig-117
  -- behavior).
  UPDATE compute_jobs
     SET status = 'done'
   WHERE id = p_job_id
     AND status = 'running'
     AND (p_claim_token IS NULL OR claim_token = p_claim_token)
  RETURNING strategy_id INTO v_strategy_id;

  IF NOT FOUND THEN
    -- Row may exist but isn't running, OR row missing, OR token mismatch.
    SELECT status, strategy_id, claim_token
      INTO v_current_status, v_strategy_id, v_current_token
      FROM compute_jobs
      WHERE id = p_job_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'mark_compute_job_done: job % not found', p_job_id
        USING ERRCODE = 'no_data_found';
    END IF;

    -- mig 109 P6: idempotent retry on already-done row.
    -- mig 117 fix #2: the token MUST be checked even on the already-done
    -- branch so a late mark from a stale worker raises serialization_failure.
    IF v_current_status = 'done' THEN
      IF p_claim_token IS NULL OR v_current_token IS NOT DISTINCT FROM p_claim_token THEN
        RETURN;
      END IF;
      RAISE EXCEPTION 'mark_compute_job_done: job % preempted by watchdog reclaim (late mark on already-done row, caller token=%, current token=%)',
        p_job_id, p_claim_token, v_current_token
        USING ERRCODE = 'serialization_failure';
    END IF;

    -- mig 117 P97: token mismatch on a still-running row means the
    -- watchdog reclaimed and another worker has taken over.
    IF v_current_status = 'running'
       AND p_claim_token IS NOT NULL
       AND v_current_token IS DISTINCT FROM p_claim_token THEN
      RAISE EXCEPTION 'mark_compute_job_done: job % preempted by watchdog reclaim (caller token=%, current token=%)',
        p_job_id, p_claim_token, v_current_token
        USING ERRCODE = 'serialization_failure';
    END IF;

    RAISE EXCEPTION 'mark_compute_job_done: job % in unexpected status % (expected running)',
      p_job_id, v_current_status
      USING ERRCODE = 'no_data_found';
  END IF;

  -- (H-0865) Containment operator drives the GIN index scan.
  -- (H-0866) GET DIAGNOSTICS surfaces 0-row UPDATEs so an operator can
  -- correlate "fan-in advanced K children" against the candidate set.
  FOR v_child_id IN
    SELECT id FROM compute_jobs
      WHERE parent_job_ids @> ARRAY[p_job_id]::uuid[]
        AND status = 'done_pending_children'
  LOOP
    IF check_fan_in_ready(v_child_id) THEN
      UPDATE compute_jobs
         SET status = 'pending',
             next_attempt_at = now()
       WHERE id = v_child_id
         AND status = 'done_pending_children';

      GET DIAGNOSTICS v_advanced_count = ROW_COUNT;
      IF v_advanced_count = 0 THEN
        RAISE NOTICE 'mark_compute_job_done: child % was no-longer in done_pending_children at advance time (race with concurrent worker or reclaim). audit-2026-05-07 H-0866.',
          v_child_id;
      END IF;
    END IF;
  END LOOP;

  -- Phase 18: atomic UI bridge (preserved from mig 099).
  IF v_strategy_id IS NOT NULL THEN
    PERFORM sync_strategy_analytics_status(v_strategy_id);
  END IF;
END;
$$;

COMMENT ON FUNCTION mark_compute_job_done(UUID, UUID) IS
  'Terminal success transition. Migration 117 / P97 fence preserved. audit-2026-05-07 '
  'H-0865 + H-0866: child-advance loop uses GIN-friendly `parent_job_ids @> ARRAY[...]` '
  'and emits RAISE NOTICE on 0-row child UPDATEs so race-loss with concurrent workers '
  'is observable. mig 109 P6 idempotent-retry preserved. mig 099 Phase-18 atomic UI '
  'bridge preserved.';

REVOKE ALL ON FUNCTION mark_compute_job_done(UUID, UUID) FROM PUBLIC, anon, authenticated;

-- --------------------------------------------------------------------------
-- STEP 5: self-verifying DO block
-- --------------------------------------------------------------------------
DO $$
DECLARE
  v_body  TEXT;
  v_exists BOOLEAN;
BEGIN
  -- H-0849 CHECK present + valid
  SELECT EXISTS(
    SELECT 1 FROM pg_constraint
     WHERE conname = 'compute_jobs_metadata_size_bounded'
       AND conrelid = 'public.compute_jobs'::regclass
       AND convalidated = true
  ) INTO v_exists;
  IF NOT v_exists THEN
    RAISE EXCEPTION 'audit-2026-05-07 H-0849 verification failed: compute_jobs_metadata_size_bounded missing or not VALIDATED';
  END IF;

  -- H-0857 CHECK present + valid
  SELECT EXISTS(
    SELECT 1 FROM pg_constraint
     WHERE conname = 'compute_jobs_claimed_by_safe'
       AND conrelid = 'public.compute_jobs'::regclass
       AND convalidated = true
  ) INTO v_exists;
  IF NOT v_exists THEN
    RAISE EXCEPTION 'audit-2026-05-07 H-0857 verification failed: compute_jobs_claimed_by_safe missing or not VALIDATED';
  END IF;

  -- H-0851 partial GIN with WHERE predicate present
  SELECT EXISTS(
    SELECT 1 FROM pg_indexes
     WHERE schemaname = 'public'
       AND tablename = 'compute_jobs'
       AND indexname = 'compute_jobs_parent_lookup'
       AND indexdef ILIKE '%WHERE%done_pending_children%'
  ) INTO v_exists;
  IF NOT v_exists THEN
    RAISE EXCEPTION 'audit-2026-05-07 H-0851 verification failed: compute_jobs_parent_lookup is missing or lacks the partial WHERE predicate';
  END IF;

  -- H-0865 + H-0866 body shape: containment operator + GET DIAGNOSTICS
  SELECT pg_get_functiondef(p.oid) INTO v_body
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public'
     AND p.proname = 'mark_compute_job_done'
     AND pg_get_function_identity_arguments(p.oid) = 'p_job_id uuid, p_claim_token uuid';
  IF v_body IS NULL THEN
    RAISE EXCEPTION 'audit-2026-05-07: mark_compute_job_done(uuid, uuid) not installed';
  END IF;
  IF v_body !~* 'parent_job_ids\s*@>\s*ARRAY\[p_job_id\]' THEN
    RAISE EXCEPTION 'audit-2026-05-07 H-0865 verification failed: mark_compute_job_done body does not use parent_job_ids @> ARRAY containment operator';
  END IF;
  IF v_body !~* 'GET DIAGNOSTICS\s+v_advanced_count' THEN
    RAISE EXCEPTION 'audit-2026-05-07 H-0866 verification failed: mark_compute_job_done body does not GET DIAGNOSTICS on child UPDATE';
  END IF;

  -- Preservation gates — mig 117 fence, mig 109 P6, mig 099 bridge
  IF v_body !~* 'serialization_failure' THEN
    RAISE EXCEPTION 'audit-2026-05-07: mark_compute_job_done body lost mig 117 P97 fence (no serialization_failure raise)';
  END IF;
  IF v_body !~* 'sync_strategy_analytics_status' THEN
    RAISE EXCEPTION 'audit-2026-05-07: mark_compute_job_done body lost mig 099 Phase-18 atomic UI bridge';
  END IF;

  -- audit-2026-05-07 R#3: re-assert PUBLIC EXECUTE absence on
  -- mark_compute_job_done via the mig 134 / C-0284 helper. The REVOKE
  -- above strips any leak; this PERFORM aborts the migration if a
  -- future change ever re-grants PUBLIC.
  PERFORM public._assert_no_public_execute(
    'public.mark_compute_job_done(uuid, uuid)'
  );
END $$;

COMMIT;
