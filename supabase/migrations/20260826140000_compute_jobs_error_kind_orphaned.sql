-- Migration: a reaped ORPHAN stops being labelled a PERMANENT failure.
-- Widens compute_jobs_error_kind_check with 'orphaned', re-registers the hourly
-- orphaned-running terminalizer to write it, and re-bases get_user_compute_jobs
-- so its synthetic user_message reads the new kind.
-- Phase 162 / plan 02 review finding F-3 (HONEST-01, D-162-4 strict). 2026-08-26.
--
-- ⚠️ OPS: merging supabase/migrations/** to main AUTO-APPLIES to PROD. There is
-- no separate deploy step and no flag in front of any of this. The moment this
-- merges, the reaper's next tick (minute 50 of the hour) writes 'orphaned'
-- instead of 'permanent', and both user-facing surfaces below start reading it.
--
-- ⛔ THE DEFECT
-- ------------
-- Two writers put a row into `compute_jobs.status = 'failed_final'`:
--
--   mark_compute_job_failed (20260529180000)   — a job that actually ran and
--                                                actually failed. error_kind is
--                                                the handler's classification.
--   retention_compute_jobs_orphaned_running    — a job whose WORKER DIED holding
--     (20260817120000)                           the claim. Arm A: a claim older
--                                                than the 4h window. Arm B: a
--                                                `running` row never claimed at
--                                                all. error_kind = 'permanent',
--                                                on BOTH arms.
--
-- The second one is the bug. Nothing about the strategy failed — a process went
-- away — so those jobs are RETRYABLE BY DEFINITION. But 'permanent' is the kind
-- that means "skip retries, go directly to failed_final", and every surface that
-- reads the pair says so out loud:
--
--   * strategy_analytics.computation_error, via computation_error_copy
--     (20260826120000): "Analytics could not complete for this strategy, and
--     retrying alone will not resolve it." Renders verbatim in the wizard
--     failure envelope and on the portfolio dashboard's stale warning.
--   * get_user_compute_jobs.user_message (20260516104201): "We hit a problem we
--     can't retry automatically."
--
-- Both are affirmatively false for a reaped orphan, and the first one is the
-- sentence that decides whether the user retries.
--
-- ⛔ AND IT DOES NOT SELF-HEAL — which is why the copy matters this much
-- ---------------------------------------------------------------------
-- The obvious objection is that some sweep readmits these jobs anyway, so the
-- copy is merely impolite. It does not. The dropped-enqueue readmit sweep
-- (20260819130500):
--
--   1. only covers strategies that HAVE `csv_daily_returns` rows, so every
--      live-API strategy — the population the reaper's 4h claim window exists
--      for — is outside its scope entirely; and
--   2. carries `NOT EXISTS (… computation_status IN (…,'failed'))`. Once the
--      status bridge's branch (b) writes 'failed' for the terminalized orphan,
--      that conjunct excludes the strategy PERMANENTLY, so even an in-scope
--      strategy is not readmitted after the first reap.
--
-- So the user retrying is the ONLY mechanism that gets the work done, and the
-- copy talks them out of it. That is the whole finding.
--
-- ⛔ WHY A NEW KIND RATHER THAN RE-WORDING THE `permanent` ARM
-- ------------------------------------------------------------
-- 'permanent' is still exactly right for a genuine permanent failure: a bad CSV
-- schema, an unsupported venue, a strategy that cannot be computed. Softening
-- its copy to accommodate orphans would make it vague for the class it fits and
-- still not tell an orphan's owner to retry. The two classes need DIFFERENT
-- sentences, so they need to be DISTINGUISHABLE at the point the copy is
-- derived — which means a distinct value in the structured column, not a
-- heuristic over the free-text one.
--
-- ⛔ It also may NOT be derived from `compute_jobs.last_error`, even though the
-- reaper stamps a fixed `orphaned_running_reaped:` literal there. That column is
-- the OPERATOR surface, and 20260826120000's anchor (H1) forbids its identifier
-- from appearing anywhere in sync_strategy_analytics_status — code or comment —
-- precisely so that no future writer can re-open the raw-text leak. Reading it
-- to classify would defeat the anchor rather than satisfy it.
--
-- ⛔ WHY mark_compute_job_failed IS DELIBERATELY *NOT* WIDENED
-- -----------------------------------------------------------
-- That RPC validates `p_error_kind IN ('transient','permanent','unknown')` and
-- RAISEs invalid_parameter_value otherwise. This migration leaves that list
-- alone, so 'orphaned' is writable ONLY by the reaper's direct UPDATE. That is a
-- containment property, not an omission: a handler must never be able to
-- classify its own failure as "my worker died", because that is precisely the
-- claim that turns a real permanent failure into a retry suggestion. The
-- self-verify block below asserts the RPC still refuses it.
--
-- THE FOUR CHANGES
-- ----------------
--   1. compute_jobs_error_kind_check — DROP + ADD, widened to four values. The
--      DROP-then-ADD idiom (rather than an inline edit of 20260411144407) is
--      what makes the named constraint the one the parity contract resolves;
--      see the note on the TS side below.
--   2. retention_compute_jobs_orphaned_running — re-registered with 'orphaned'
--      on both arms. NOTHING else about the body changes: same cadence, same
--      two arms, same windows, same LIMIT, same fixed audit literals, same
--      compare-and-set fences.
--   3. get_user_compute_jobs — a new user_message arm for the new kind, so the
--      admin/user job list stops saying "can't retry automatically" about a
--      worker death. Re-based on 20260516104201 (the LATEST definition; the
--      later 20260516131500 touches only the COMMENT, which is re-stated here).
--   4. A ONE-TIME BACKFILL of the already-reaped rows (STEP 4). ⚠️ This is new
--      in the F-3a revision; the first draft refused to backfill and justified
--      the refusal with a claim that is FALSE. See "WHY THE HISTORY IS
--      BACKFILLED" below.
--
-- ⚠️ TS SIDE, in the SAME commit: `compute_jobs.error_kind` is a PINNED pair in
-- src/__tests__/contracts/check-zod-db-check-parity.test.ts, which resolves the
-- newest named `compute_jobs_error_kind_check` and asserts set equality against
-- the Zod enum in src/lib/analytics-schemas.ts. Widening here without widening
-- there is RED, by design — that gate exists so a closed set cannot drift open
-- silently. src/lib/types.ts ErrorKind moves with it, and the migration-content
-- gate src/__tests__/retention-orphaned-running-terminalize.test.ts repoints its
-- FIX_TS / FIX_FILENAME constants at THIS file (its own arm 7 fails loud on a
-- forward-only cron re-registration that leaves the pointer behind).
--
-- ⛔ WHY THE HISTORY IS BACKFILLED (Phase 162 review, F-3a)
-- ---------------------------------------------------------
-- The first draft of this migration declined to touch the 64 'permanent' rows
-- the 2026-08-26 PROD census counted, on the grounds that "their provenance is
-- unrecoverable" and that reaped orphans are "indistinguishable in that census".
-- ⚠️ BOTH CLAIMS ARE FALSE, and the evidence is in this very file: the reaper
-- stamps FIXED audit literals — 'orphaned_running_reaped: …', one per arm, which
-- STEP 2 carries forward verbatim and STEP 5 pins at two occurrences. So
--
--   status = 'failed_final' AND last_error LIKE 'orphaned_running_reaped:%'
--
-- identifies the reaped population EXACTLY. It is not a heuristic and it is not
-- new: 20260817120000:500 already documents that same predicate as the way to
-- count what a reaper tick terminalized.
--
-- Leaving those rows at 'permanent' is not a neutral omission. Both user-facing
-- readers synthesise copy from (status, error_kind) and both render TODAY for
-- these rows — get_user_compute_jobs.user_message on the job list, and
-- computation_error_copy via the status bridge whenever the strategy's next
-- transition re-reads the latest failure. They tell those owners that retrying
-- will not help, when by this migration's own argument retrying is the ONLY
-- mechanism that computes them: the 20260819130500 readmit sweep is csv-only and
-- self-blocks once computation_status reads 'failed'. A one-time UPDATE is the
-- whole fix, so refusing it left a knowable set of users reading a false
-- sentence for no reason.
--
-- ⚠️ THE ⛔ "MAY NOT BE DERIVED FROM last_error" ANCHOR IS NOT VIOLATED. That
-- rule (mig 20260826120000) forbids the identifier inside
-- sync_strategy_analytics_status — it is a RUNTIME copy-derivation ban, and it
-- exists because deriving user-visible copy from the operator column is how a
-- raw Python exception string reached a user. A one-time migration UPDATE that
-- reads a fixed audit literal to CORRECT a structured classification is a
-- different act: nothing derived from that column is written to a user surface,
-- and the column itself is left byte-unchanged, so the audit trail that proves
-- the re-classification stays intact and the UPDATE is exactly reversible by its
-- own predicate.
--
-- NOT CHANGED, on purpose: mark_compute_job_failed's validation list (above);
-- compute_jobs.last_error (operator surface, keeps raw text — including on the
-- backfilled rows); the reaper's fixed audit literals, windows and bounds; and
-- any failed_final row that does NOT carry a reaper literal, whose provenance
-- genuinely is unrecoverable and which is therefore left alone.

BEGIN;
SET lock_timeout = '5s';

-- --------------------------------------------------------------------------
-- STEP 1: the CHECK
-- --------------------------------------------------------------------------
-- 20260411144407:127 declared this INLINE and unnamed, so Postgres auto-named it
-- `compute_jobs_error_kind_check`. DROP + ADD under that same canonical name
-- keeps the resolution order the TS parity gate documents (named-first, newest
-- wins) pointing at THIS definition rather than the stale CREATE-time one.
--
-- ⚠️ VALIDATED, not NOT VALID: this is a pure WIDENING, so every existing row
-- already satisfies it and the full-table verify pass is guaranteed to succeed.
-- The ACCESS EXCLUSIVE lock is bounded by the lock_timeout above.
ALTER TABLE compute_jobs
  DROP CONSTRAINT IF EXISTS compute_jobs_error_kind_check;

ALTER TABLE compute_jobs
  ADD CONSTRAINT compute_jobs_error_kind_check
  CHECK (error_kind IN ('transient', 'permanent', 'unknown', 'orphaned'));

COMMENT ON COLUMN compute_jobs.error_kind IS
  'Structured failure classification, and the ONLY thing user-facing copy may be derived from (the free-text diagnosis lives in last_error, which is operator-only). transient = retryable, retried automatically up to max_attempts. permanent = do not retry, terminalise immediately. unknown = unclassified; retried like transient. orphaned = the WORKER DIED holding the claim, so the job never reached a verdict — written ONLY by the retention_compute_jobs_orphaned_running reaper''s direct UPDATE, never by mark_compute_job_failed, which still refuses any kind outside the first three so a handler can never classify its own failure as a worker death. orphaned is RETRYABLE: nothing readmits these jobs on the live-API path (the 20260819130500 sweep is csv-only and is additionally blocked once computation_status reads failed), so the user retrying is the only mechanism, and both computation_error_copy and get_user_compute_jobs.user_message tell them so. Before mig 20260826140000 the reaper wrote permanent and both surfaces told those users that retrying would not help. See migrations 20260411144407 + 20260817120000 + 20260826120000 + 20260826140000.';

-- --------------------------------------------------------------------------
-- STEP 2: the reaper
-- --------------------------------------------------------------------------
-- Re-registers the cron job from 20260817120000 with ONE literal changed on each
-- arm. Everything the JOB-05 gates pin is preserved verbatim and deliberately:
-- the '50 * * * *' cadence, both arms, `public.compute_jobs` x4, the
-- single-spaced `status = 'running'` x4 (two batch predicates + two
-- compare-and-set fences), `failed_final` x2, `next_attempt_at` x2, the two
-- DISTINCT windows (4h / 48h), the per-arm LIMIT 100, FOR UPDATE SKIP LOCKED,
-- and the two fixed `orphaned_running_reaped:` audit literals.
--
-- ⚠️ status = 'running' stays SINGLE-SPACED in all four places: the shipped gate
-- anchors on that exact spelling (20260817120000:273-275).
DO $$
DECLARE
  v_has_pg_cron BOOLEAN;
BEGIN
  SELECT EXISTS(SELECT 1 FROM pg_extension WHERE extname = 'pg_cron')
    INTO v_has_pg_cron;

  -- ⚠️ RAISE, never a silent skip, and with an explicit ERRCODE (the shape
  -- 20260817120000:561-565 established; the older silent-skip convention at
  -- 20260717233529:288 would report success while scheduling nothing, leaving
  -- the PREVIOUS body deployed behind a green apply — here that means the
  -- reaper keeps writing 'permanent' while every gate reports the fix landed).
  IF NOT v_has_pg_cron THEN
    RAISE EXCEPTION
      'F-3/JOB-05: pg_cron extension is NOT installed, so the orphaned-running terminalizer cannot be re-registered. 20260817120000 RAISEs on the same condition and runs earlier, so reaching this means pg_cron was removed between the two applies. Install it via Supabase Dashboard -> Database -> Extensions and re-run.'
      USING ERRCODE = 'feature_not_supported';
  END IF;

  -- Idempotent: cron.schedule upserts by name, so the unschedule is
  -- belt-and-braces. Both together DROP the row and INSERT a new one, so pg_cron
  -- assigns a FRESH jobid on every apply — expected, and the reason the
  -- self-verify below reads back by NAME and never by a remembered jobid.
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'retention_compute_jobs_orphaned_running') THEN
    PERFORM cron.unschedule('retention_compute_jobs_orphaned_running');
  END IF;

  PERFORM cron.schedule(
    'retention_compute_jobs_orphaned_running',
    '50 * * * *',
    $cron$
    -- CANARY_162_V1_PROSE_ONLY — a prose-only token. It appears in this comment
    -- and in NO code, here or anywhere else in this body. Part 1 of
    -- supabase/tests/test_retention_orphaned_running.sql strips comments out of
    -- cron.job.command before matching, and asserts this token is present in the
    -- RAW command and ABSENT from the stripped one — which is the only way to
    -- tell "the stripper ran" from "there was nothing to strip". ⛔ Do not remove
    -- it to tidy up: that gate goes RED, on purpose (the F-5 lesson from mig
    -- 20260826130000, where removing a canary silently DISARMED the check that
    -- depended on it). ⚠️ Keep this comment free of every token Part 1 counts —
    -- it deliberately spells none of the quoted kind literals, none of the audit
    -- reason, and no removal keyword.
    DO $sweep$
    BEGIN
      WITH batch AS MATERIALIZED (
        SELECT id
          FROM public.compute_jobs
         WHERE status = 'running'
           AND claimed_at IS NOT NULL
           AND claimed_at < now() - interval '4 hours'
         ORDER BY claimed_at ASC
         LIMIT 100
         FOR UPDATE SKIP LOCKED
      )
      UPDATE public.compute_jobs cj
         SET status          = 'failed_final',
             next_attempt_at = now(),
             error_kind      = 'orphaned',
             last_error      = 'orphaned_running_reaped: no worker completed this job within the 4h claim window'
        FROM batch b
       WHERE cj.id = b.id
         AND cj.status = 'running';

      WITH batch AS MATERIALIZED (
        SELECT id
          FROM public.compute_jobs
         WHERE status = 'running'
           AND claimed_at IS NULL
           AND created_at < now() - interval '48 hours'
         ORDER BY created_at ASC
         LIMIT 100
         FOR UPDATE SKIP LOCKED
      )
      UPDATE public.compute_jobs cj
         SET status          = 'failed_final',
             next_attempt_at = now(),
             error_kind      = 'orphaned',
             last_error      = 'orphaned_running_reaped: running with no claim stamp (invariant violation) older than 48h'
        FROM batch b
       WHERE cj.id = b.id
         AND cj.status = 'running';
    END
    $sweep$;
    $cron$
  );

  RAISE NOTICE 'F-3: retention_compute_jobs_orphaned_running re-registered — both arms now classify a reaped orphan as error_kind = orphaned (was permanent), so the user-facing copy stops telling these users that retrying will not help.';
END $$;

-- --------------------------------------------------------------------------
-- STEP 3: the twin — get_user_compute_jobs.user_message
-- --------------------------------------------------------------------------
-- The same conflation ships here (20260516104201:784-786): `failed_final` +
-- 'permanent' selects "we can't retry automatically", and every reaped orphan
-- landed on it. This migration is what makes the two classes distinguishable, so
-- it closes BOTH readers rather than leaving the older one to be found again.
--
-- ⛔ ARM ORDER IS LOAD-BEARING. The new arm goes BEFORE the bare
-- `WHEN cj.status = 'failed_final'` fallback. Placed after it, an orphan would
-- match the fallback's "Tried multiple times without success" — which is ALSO
-- false (the job was never retried; its worker died), just less obviously so.
--
-- Re-based on 20260516104201 (LATEST body). Everything else is preserved
-- verbatim: the auth.uid() early return, the last_error redaction, the M-0783
-- COALESCE join contract, the ORDER BY and the LIMIT clamp.
CREATE OR REPLACE FUNCTION get_user_compute_jobs(
  p_strategy_id UUID DEFAULT NULL,
  p_limit       INTEGER DEFAULT 100
)
RETURNS TABLE(
  id              UUID,
  strategy_id     UUID,
  portfolio_id    UUID,
  kind            TEXT,
  parent_job_ids  UUID[],
  status          TEXT,
  attempts        INTEGER,
  max_attempts    INTEGER,
  next_attempt_at TIMESTAMPTZ,
  claimed_at      TIMESTAMPTZ,
  claimed_by      TEXT,
  last_error      TEXT,
  error_kind      TEXT,
  idempotency_key TEXT,
  exchange        TEXT,
  trade_count     INTEGER,
  created_at      TIMESTAMPTZ,
  updated_at      TIMESTAMPTZ,
  metadata        JSONB,
  user_message    TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
STABLE
AS $$
DECLARE
  v_auth_uid UUID := auth.uid();
BEGIN
  IF v_auth_uid IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT
    cj.id, cj.strategy_id, cj.portfolio_id, cj.kind, cj.parent_job_ids,
    cj.status, cj.attempts, cj.max_attempts, cj.next_attempt_at,
    cj.claimed_at, cj.claimed_by,
    NULL::TEXT AS last_error,   -- redacted; see mig 032 STEP 16 comment
    cj.error_kind, cj.idempotency_key, cj.exchange, cj.trade_count,
    cj.created_at, cj.updated_at, cj.metadata,
    -- mig 111 P11: synthetic user-facing message.
    CASE
      -- F-3 (mig 20260826140000). FIRST, ahead of both failed_final arms: a
      -- reaped orphan is retryable, and it is the only failed_final class that
      -- is. Below the bare fallback it would read "Tried multiple times without
      -- success", which is false in a second way — it was never retried.
      WHEN cj.status = 'failed_final' AND cj.error_kind = 'orphaned' THEN
        'This run stopped before it finished because the process running it went away. Please try again.'
      WHEN cj.status = 'failed_final' AND cj.error_kind = 'permanent' THEN
        'We hit a problem we can''t retry automatically. Please contact support.'
      WHEN cj.status = 'failed_final' THEN
        'Tried multiple times without success. Please contact support.'
      WHEN cj.status = 'failed_retry' THEN
        'Temporary issue — retrying automatically.'
      WHEN cj.status IN ('pending', 'running', 'done_pending_children') THEN
        NULL
      WHEN cj.status = 'done' THEN
        NULL
      ELSE
        NULL
    END::TEXT AS user_message
    FROM compute_jobs cj
    LEFT JOIN strategies s ON s.id = cj.strategy_id
    LEFT JOIN portfolios p ON p.id = cj.portfolio_id
   -- audit-2026-05-07 M-0783: COALESCE replaces (s.user_id=X OR p.user_id=X)
   -- so the join contract is explicit and NULL-NULL orphan rows have a
   -- well-defined disposition (still filtered for non-owners; visible to
   -- service-role direct queries).
   WHERE COALESCE(s.user_id, p.user_id) = v_auth_uid
     AND (p_strategy_id IS NULL OR cj.strategy_id = p_strategy_id)
   ORDER BY cj.created_at DESC
   LIMIT GREATEST(1, LEAST(p_limit, 1000));
END;
$$;

COMMENT ON FUNCTION get_user_compute_jobs IS
  'Returns compute_jobs rows visible to auth.uid(). last_error REDACTED; '
  'user_message TEXT (mig 111 P11) synthesised from (status, error_kind). '
  'FAILURE ARMS, in evaluation order (mig 20260826140000, Phase 162 F-3): '
  'failed_final + orphaned -> the worker died holding the claim, so the run '
  'never reached a verdict and the user is asked to TRY AGAIN; failed_final + '
  'permanent -> not automatically retryable, contact support; bare '
  'failed_final -> automatic retries exhausted. The orphaned arm must stay '
  'FIRST: below the bare fallback a worker death reads as "tried multiple '
  'times without success", which it never was. Before 20260826140000 the '
  'reaper classified orphans as permanent and this RPC told those users their '
  'failure could not be retried at all. '
  'audit-2026-05-07 M-0783: WHERE uses COALESCE(s.user_id, p.user_id) — '
  'this is a self-documenting refactor with NO observable behavior delta '
  'from the prior `(s.user_id = X OR p.user_id = X)` shape. Both forms '
  'return NULL (filtered as false) for orphan rows where both joins miss. '
  'Orphans remain invisible to ALL callers of this RPC. Admins read '
  'orphans through the service-role direct query path, never through '
  'this function (auth.uid() IS NULL returns early at the top of the '
  'body). See migrations 032, 111, audit-2026-05-07, 20260826140000.';

REVOKE ALL ON FUNCTION get_user_compute_jobs FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION get_user_compute_jobs TO authenticated;

-- --------------------------------------------------------------------------
-- STEP 4: the one-time backfill of already-reaped rows
-- --------------------------------------------------------------------------
-- Phase 162 review F-3a. STEPS 1-3 fix the FUTURE; this fixes the rows the
-- defect already produced. The header section "WHY THE HISTORY IS BACKFILLED"
-- carries the argument and the refutation of the refusal that stood here.
--
-- ⚠️ MUST run after STEP 1: 'orphaned' is not admissible until the widened CHECK
-- is in place, and this is inside the same transaction as that ALTER.
--
-- SCOPE, and why each conjunct is load-bearing:
--   status = 'failed_final'   — the only status the reaper writes. Without it a
--                               re-claimed row (claim_compute_jobs NULLs
--                               error_kind on re-claim, 20260603120000) could be
--                               matched on a stale literal.
--   error_kind = 'permanent'  — the only kind the pre-fix reaper wrote. Makes the
--                               statement IDEMPOTENT (a re-apply matches nothing)
--                               and keeps it off rows already at 'orphaned'.
--   last_error LIKE '…'       — the fixed audit literal, which is what makes the
--                               population identifiable at all.
--
-- ⛔ NOT a heuristic on message SHAPE. The prefix is a literal this migration
-- itself writes at STEP 2 and pins at STEP 5, so the match is exact. Anything
-- that does not carry it is left alone — see the header's NOT CHANGED list.
--
-- Unbounded on purpose: the census bounds this at ~64 rows, three orders of
-- magnitude under the per-tick LIMIT 100 the reaper runs with, and the
-- lock_timeout at the top of the file bounds the wait.
DO $backfill$
DECLARE
  v_rows INTEGER;
BEGIN
  UPDATE public.compute_jobs
     SET error_kind = 'orphaned'
   WHERE status = 'failed_final'
     AND error_kind = 'permanent'
     AND last_error LIKE 'orphaned_running_reaped:%';

  GET DIAGNOSTICS v_rows = ROW_COUNT;

  -- Reported, not asserted. ZERO is a legitimate outcome — on a fresh database,
  -- on TEST, and on any environment where the reaper has never fired — so this
  -- must not RAISE. The number is the one fact the refusal claimed could not be
  -- known, so it is stated out loud at apply time on every environment.
  RAISE NOTICE 'F-3a backfill: re-classified % already-reaped compute_jobs row(s) from error_kind = permanent to orphaned (matched on the reaper''s fixed orphaned_running_reaped audit literal; last_error left byte-unchanged). Those owners stop being told that retrying will not help.', v_rows;
END $backfill$;

-- --------------------------------------------------------------------------
-- STEP 5: self-verify — apply-time, fail-without-fix
-- --------------------------------------------------------------------------
-- ⚠️ A migration DO block runs ONCE. The RECURRING gates are
-- supabase/tests/test_retention_orphaned_running.sql (the deployed cron body and
-- a real tick) and supabase/tests/test_compute_jobs_error_kind_copy_parity.sql
-- (the CHECK-vs-CASE drift assertion). This block exists so a broken apply fails
-- HERE rather than on the first reaper tick.
DO $verify$
DECLARE
  v_command TEXT;
  v_condef  TEXT;
  v_probe   TEXT;
  v_msg     TEXT;
  v_count   INTEGER;
  v_kind    INTEGER;
  v_perm    INTEGER;
  v_reason  INTEGER;
  v_residue INTEGER;
  v_ok      BOOLEAN;
BEGIN
  -- (a) THE CHECK ADMITS ALL FOUR KINDS, asserted BEHAVIOURALLY. A regex over
  -- pg_get_constraintdef would be satisfied by a CHECK that admits 'orphaned'
  -- and nothing else — which would make the reaper the only writer able to
  -- record a failure at all. So each value is round-tripped through the REAL
  -- constraint expression.
  --
  -- ⚠️ Through a TEMP TABLE built FROM THE CATALOG, not by INSERTing into
  -- compute_jobs. A direct probe insert would have to satisfy that table's FK to
  -- compute_job_kinds, its target XOR and its kind/target coherence CHECK — so
  -- it would fail for reasons that have nothing to do with error_kind, and this
  -- arm would report a defect that is not there (or, with a WHEN check_violation
  -- catch-all, silently pass on the wrong constraint). The definition is READ
  -- from pg_constraint, so this still exercises the deployed expression rather
  -- than a re-typed copy of it.
  SELECT pg_get_constraintdef(c.oid) INTO v_condef
    FROM pg_constraint c
   WHERE c.conname = 'compute_jobs_error_kind_check'
     AND c.conrelid = 'public.compute_jobs'::regclass;

  IF v_condef IS NULL THEN
    RAISE EXCEPTION 'F-3 verification failed: no constraint named compute_jobs_error_kind_check exists on public.compute_jobs after this migration. The DROP ran and the ADD did not, so error_kind is now unconstrained — every arm below would pass against a table that accepts anything, and the TS parity gate resolves the STALE inline set from 20260411144407 while the live column has no closed set at all.';
  END IF;

  EXECUTE format(
    'CREATE TEMP TABLE __f3_kind_probe (error_kind TEXT, CONSTRAINT __f3_kind %s)',
    v_condef);

  FOREACH v_probe IN ARRAY ARRAY['transient', 'permanent', 'unknown', 'orphaned']
  LOOP
    BEGIN
      EXECUTE 'INSERT INTO __f3_kind_probe (error_kind) VALUES ($1)' USING v_probe;
    EXCEPTION WHEN check_violation THEN
      RAISE EXCEPTION 'F-3 verification failed: compute_jobs_error_kind_check REJECTS the kind %. The widened CHECK must admit all four. Rejecting one of the original three breaks mark_compute_job_failed on a live failure; rejecting ''orphaned'' means the reaper''s next tick dies on a check_violation — and a RAISE inside a pg_cron block ABORTS THE WHOLE TICK, so every orphan stays running forever and the poller spins on all of them.', v_probe;
    END;
  END LOOP;

  -- (b) AND IT STILL REJECTS everything else. Without this arm, (a) is fully
  -- satisfied by dropping the constraint — the cheapest way to make (a) pass.
  BEGIN
    EXECUTE 'INSERT INTO __f3_kind_probe (error_kind) VALUES ($1)'
      USING 'a_kind_added_after_20260826';
    RAISE EXCEPTION 'F-3 verification failed: compute_jobs_error_kind_check ACCEPTED an unmodelled kind, so it was widened to nothing rather than extended by one value. The closed set is what makes computation_error_copy''s CASE total over the LIVE domain and what the TS parity contract pins; without it an unmodelled kind reaches users as the cautious default and nobody finds out.';
  EXCEPTION WHEN check_violation THEN
    NULL;  -- expected
  END;

  DROP TABLE __f3_kind_probe;

  -- (c) mark_compute_job_failed STILL REFUSES 'orphaned'. This is the
  -- containment: a handler must never be able to claim its own worker died,
  -- because that claim converts a real permanent failure into a retry
  -- suggestion — the exact inverse of the defect this migration fixes. Widening
  -- the RPC's validation list is the natural-looking "consistency" edit that
  -- would quietly remove it.
  --
  -- ⛔ p_claim_token IS DELIBERATELY NON-NULL. That RPC's FIRST guard is
  -- `IF p_claim_token IS NULL THEN RAISE ... invalid_parameter_value`, which
  -- fires BEFORE the error_kind check — so probing with a NULL token would
  -- catch invalid_parameter_value from the wrong guard and pass no matter what
  -- the error_kind list says. A random token reaches the check under test, and
  -- the message is asserted so the SQLSTATE alone cannot satisfy this arm.
  BEGIN
    PERFORM mark_compute_job_failed(
      '00000000-0000-0000-0000-000000000000'::UUID,
      'f3 probe',
      'orphaned',
      gen_random_uuid());
    RAISE EXCEPTION 'F-3 verification failed: mark_compute_job_failed ACCEPTED p_error_kind = ''orphaned'' (it did not raise at all). That kind means "the worker died holding the claim" and may be written ONLY by the reaper''s direct UPDATE.';
  EXCEPTION
    WHEN invalid_parameter_value THEN
      GET STACKED DIAGNOSTICS v_msg = MESSAGE_TEXT;
      IF v_msg NOT LIKE '%error_kind%' THEN
        RAISE EXCEPTION 'F-3 verification failed: mark_compute_job_failed raised invalid_parameter_value, but from a DIFFERENT guard than the error_kind check (message: %). This arm proves nothing unless the kind check is what refused — the claim-token guard runs first and raises the same SQLSTATE.', v_msg;
      END IF;
      -- expected: the RPC's validation list is intact and it is what refused
    WHEN no_data_found THEN
      RAISE EXCEPTION 'F-3 verification failed: mark_compute_job_failed got PAST its argument validation with p_error_kind = ''orphaned'' and failed later, on the job lookup. The validation list has been widened to admit orphaned; restore it to transient/permanent/unknown so only the reaper can write that kind.';
    WHEN OTHERS THEN
      RAISE EXCEPTION 'F-3 verification failed: mark_compute_job_failed rejected p_error_kind = ''orphaned'' with %/% rather than invalid_parameter_value from its argument check. Either the validation list changed shape or an earlier guard is now failing; both need a human before this migration is trusted.', SQLSTATE, SQLERRM;
  END;

  -- (d) the DEPLOYED cron body, read back out of cron.job and never re-typed.
  SELECT count(*) INTO v_count
    FROM cron.job WHERE jobname = 'retention_compute_jobs_orphaned_running';
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'F-3/JOB-05 verification failed: expected exactly ONE cron job named retention_compute_jobs_orphaned_running, found %. Two rows double the per-tick blast radius the LIMIT exists to cap; zero means the orphaned-running population is unattended entirely.', v_count;
  END IF;

  SELECT command INTO v_command
    FROM cron.job WHERE jobname = 'retention_compute_jobs_orphaned_running';

  -- COUNTS, not presence tests. 2 = one per arm. A presence test is satisfied by
  -- either arm surviving, so converting only ONE arm would pass unnoticed — and a
  -- half-converted reaper is worse than an unconverted one, because the class of
  -- orphan that still reads 'permanent' is now invisible to everyone looking for
  -- the fix.
  v_kind := (length(v_command) - length(replace(v_command, '''orphaned''', ''))) / length('''orphaned''');
  IF v_kind <> 2 THEN
    RAISE EXCEPTION 'F-3 verification failed: the deployed reaper body classifies as ''orphaned'' % times, expected 2 (one per arm). Arm A reaps claims older than the 4h window, arm B reaps never-claimed running rows older than 48h — BOTH are worker deaths and both are retryable. One conversion means the other arm still tells its users that retrying will not help.', v_kind;
  END IF;

  v_perm := (length(v_command) - length(replace(v_command, '''permanent''', ''))) / length('''permanent''');
  IF v_perm <> 0 THEN
    RAISE EXCEPTION 'F-3 verification failed: the deployed reaper body still writes ''permanent'' % times. That is the defect: a job whose WORKER DIED is not a permanent failure, and computation_error_copy''s permanent arm tells the user that retrying alone will not resolve it. It does not self-heal — the 20260819130500 readmit sweep is csv-only and is additionally blocked once computation_status reads failed — so the user retrying is the only remaining mechanism.', v_perm;
  END IF;

  -- The audit literals must SURVIVE the re-registration. They are the operator's
  -- only record of why a row was terminalized, and they are the thing most
  -- likely to be lost when a body is retyped rather than copied.
  v_reason := (length(upper(v_command)) - length(replace(upper(v_command), 'ORPHANED_RUNNING_REAPED', ''))) / length('ORPHANED_RUNNING_REAPED');
  IF v_reason <> 2 THEN
    RAISE EXCEPTION 'F-3/JOB-05 verification failed: the re-registered body stamps the orphaned_running_reaped audit reason % times, expected 2 (one fixed literal per arm). This migration changes ONE literal per arm and nothing else; losing these means the body was retyped rather than carried forward, and an operator can no longer tell a reaped orphan from a genuine handler failure.', v_reason;
  END IF;

  -- (e) the two user-facing readers actually DISTINGUISH the new kind. Both are
  -- behavioural: the CHECK and the cron body being right is worthless if the
  -- copy still collapses.
  IF computation_error_copy('orphaned') = computation_error_copy('permanent') THEN
    RAISE EXCEPTION 'F-3 verification failed: computation_error_copy(''orphaned'') is identical to its ''permanent'' sentence, so widening the CHECK and re-registering the reaper bought nothing — the reaped orphan still reads "retrying alone will not resolve it" on the wizard failure envelope and the portfolio stale warning. Mig 20260826120000 must apply BEFORE this one; check the ordering.';
  END IF;

  SELECT pg_get_functiondef(p.oid) ~ 'error_kind\s*=\s*''orphaned'''
    INTO v_ok
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'get_user_compute_jobs'
   LIMIT 1;
  IF NOT COALESCE(v_ok, FALSE) THEN
    RAISE EXCEPTION 'F-3 verification failed: get_user_compute_jobs has no user_message arm for error_kind = ''orphaned'', so the job list still reports a worker death as "we hit a problem we can''t retry automatically". This is the twin of the computation_error defect and is closed in the same migration precisely so it is not found again later.';
  END IF;

  -- (f) THE BACKFILL LANDED (Phase 162 review F-3a). Asserted as a RESIDUE of
  -- ZERO over the identifiable population, not by re-counting what STEP 4
  -- reported — a gate that reads the writer's own row count proves only that the
  -- writer ran, and would stay green over a predicate that matches nothing.
  --
  -- ⛔ This is the arm that fails if STEP 4 is deleted or its predicate is
  -- narrowed, on any database where the reaper has ever fired. It is vacuously
  -- green where the population is empty (a fresh database, TEST), which is
  -- unavoidable and is why it is paired with STEP 4's unconditional NOTICE: the
  -- count is always stated, the residue is always asserted.
  SELECT count(*)
    INTO v_residue
    FROM public.compute_jobs
   WHERE status = 'failed_final'
     AND error_kind = 'permanent'
     AND last_error LIKE 'orphaned_running_reaped:%';
  IF v_residue <> 0 THEN
    RAISE EXCEPTION 'F-3a verification failed: % failed_final row(s) still carry error_kind = ''permanent'' while their last_error holds the reaper''s fixed orphaned_running_reaped audit literal. These are worker deaths, and both user-facing readers (get_user_compute_jobs.user_message and computation_error_copy via the status bridge) render for them TODAY and tell their owners that retrying will not help — when retrying is the only mechanism that computes them, the 20260819130500 readmit sweep being csv-only and self-blocking once computation_status reads failed. STEP 4 exists to re-classify exactly this set; it has been removed or its predicate no longer matches.', v_residue;
  END IF;

  RAISE NOTICE 'Migration 20260826140000 verified: compute_jobs_error_kind_check admits exactly {transient, permanent, unknown, orphaned}; mark_compute_job_failed still refuses orphaned; the deployed reaper writes orphaned on both arms and permanent on none, with both audit literals intact; computation_error_copy and get_user_compute_jobs.user_message both distinguish it; and no already-reaped row is left classified permanent.';
END $verify$;

COMMIT;
