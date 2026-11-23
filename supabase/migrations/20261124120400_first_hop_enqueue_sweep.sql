-- Migration: public.first_hop_enqueue_sweep() and public.first_hop_enqueue_retries
-- Phase 227 (JOBLEDGER) / plan 05 / HEAL-01.
--
-- WHAT THIS CLOSES. A strategy finalized through the wizard whose FIRST
-- `sync_trades` enqueue dropped. `finalize-wizard/route.ts` enqueues that job in
-- an `after()` side effect, and its own comment records the gap: "No backstop:
-- ... a row left pending by this throw stays pending until the user re-syncs or
-- re-finalizes." Nothing reads the strategy afterwards, so it strands.
--
-- THE FOUNDER RULING (2026-11-23, CONTEXT HEAL-01), quoted whole:
--   "Auto re-enqueue by a sweep of its own (not a second predicate on
--   reconcile_dropped_enqueue_sweep): key present, the strategy never synced and
--   no job ever, and a grace period longer than 1 hour. A named state shows only
--   if that retry also fails. A healthy new strategy must not be caught. The
--   named state's user-visible wording is decided at plan time."
-- Reversibility is costly and the ruling is made; this file implements it.
--
-- WHAT THIS SHIPS. One table (the once-only observation ledger), one SECURITY
-- DEFINER function, a COMMENT, a REVOKE and a catalogue-only self-verify.
-- ⛔ This file registers no job. It never makes the pg_cron schedule call, and
-- says so here only by that description. Registration is a marker-guarded live
-- step after merge, written down in docs/runbooks/jobledger-go-live.md (DEC-05-A).
-- ⚠️ From the merge until that runbook's Step 1 runs, the first-hop sweep does
-- not fire on PROD. Nothing invokes this function until then.
--
-- DECISIONS (plan 05):
--   DEC-05-A  Registration is a runbook step, never a migration (the Phase 164.7
--             rule; D-02 in derivecron-go-live.md, D-10 in
--             outagealert-migration-schedules-nothing.test.ts). RESEARCH
--             recommended a migration-registered job; that conflicts with the
--             rule and the rule wins.
--   DEC-05-B  THE GRACE ANCHOR IS THE SWEEP'S FIRST OBSERVATION. No finalize-time
--             column exists. `strategies.created_at` is WRONG as an anchor: a
--             draft created days ago and finalized now would be caught in the
--             seconds between finalize and its `after()` enqueue. The sweep
--             stamps `first_seen_at` the first time a strategy matches and
--             re-enqueues only once that is more than 90 minutes old, so the
--             grace is always longer than the 1 hour the founder required.
--             Consequence, stated as a range because it follows from the hourly
--             tick: a strategy is re-enqueued between 90 and about 150 minutes
--             after it first matches. Rejected: a `finalized_at` column plus a
--             re-base of `finalize_wizard_strategy`, which is a wider change to a
--             hot RPC for a guarantee the observation already gives.
--   DEC-05-C  "NEVER SYNCED AND NO JOB EVER" READS DATA ABSENCE PLUS JOB ABSENCE.
--             A strategy is a candidate only when ALL of these hold:
--               * status is the single value the contribution finalize sets
--                 (DEC-05-G);
--               * its api_key_id names a key that is active and not disconnected;
--               * no compute_jobs row names the strategy OR its key (any kind;
--                 this covers a key-scoped derive and the wizard's preview chain);
--               * no trades, csv_daily_returns or strategy_keys row exists;
--               * no strategy_analytics row exists in a status other than
--                 'pending' (a finalize whose enqueue threw leaves 'pending').
--             Job absence alone is not enough: done rows are pruned at 30 days
--             and /cron-sync keeps strategies current without job rows.
--             `api_keys.last_sync_at` is not a signal either, because the
--             finalize `after()` touches it even when the enqueue fails.
--   DEC-05-D  THE ENQUEUE IS A DIRECT INSERT mirroring the first hop's own row:
--             kind sync_trades, exchange NULL, metadata source 'first-hop-sweep'.
--             It follows the reconcile sweep's precedent. The enqueue RPC's
--             strategy path runs an owner assertion, which has no caller identity
--             under the scheduler.
--   DEC-05-E  THE NAMED STATE ADDS NO ENUM VALUE. It is computation_status
--             'failed' plus one fixed sentence (the c_named_state_copy constant in
--             the function) with NULL provenance markers. Every existing reader
--             already renders 'failed' with its computation_error. "The retry also
--             fails" means every job of the strategy is failed_final and the
--             analytics row is absent or still 'pending'. A retry the bridge
--             already turned into its own 'failed' row keeps that row.
--   DEC-05-G  ONLY 'private' STRATEGIES. The contribution finalize sets 'private'
--             and takes the legacy arm whose `after()` enqueues sync_trades. A
--             single-key manager strategy is 'pending_review', goes through the
--             unified arm, enqueues no sync_trades, and answers a failed dispatch
--             at submit time. Re-enqueueing sync_trades for it would be the wrong
--             job: deribit, sfox and mt5 keys are ledger-backed and route through
--             process_key_long, so a fill-based sync would fail and write a
--             misleading failed state. A composite is excluded because its
--             api_key_id is NULL.
--
-- ONCE ONLY. The observation row that records a re-enqueue is never deleted by
-- the sweep. A key that is bad is therefore tried against an exchange once, not
-- every hour: the bounded alternative to an unbounded retry loop.
--
-- CENSUS NOTE (RESEARCH census (a), dated and stale by construction): PROD had 0
-- keyed strategies without a compute_jobs row when this plan was written, so on
-- today's data the sweep catches nobody. It guards a failure that has not yet
-- occurred on measured data. The runbook re-reads the count before go-live.
--
-- ⛔ FORWARD MIGRATION ONLY. Nothing here edits an applied migration file, and
-- nothing here runs `supabase db push`, `db reset`, `--project-ref` or
-- `--db-url`. This checkout's Supabase CLI is linked to PRODUCTION; this
-- migration reaches PROD only by merge, then apply-test, then the automatic PROD
-- apply. There is no human stop between the merge and the PROD apply.
--
-- ⛔ CATALOGUE-ONLY VERIFY, BY DESIGN. The block at the foot never calls the
-- function and never counts rows. Shared TEST carries PROD's catalogue and EMPTY
-- tables, so a data-reading check that refuses on an empty table would block the
-- PROD apply.

-- --------------------------------------------------------------------------
-- STEP 1: public.first_hop_enqueue_retries (the observation ledger)
-- --------------------------------------------------------------------------
CREATE TABLE public.first_hop_enqueue_retries (
  strategy_id       uuid        PRIMARY KEY REFERENCES public.strategies(id) ON DELETE CASCADE,
  first_seen_at     timestamptz NOT NULL DEFAULT now(),
  reenqueued_at     timestamptz NULL,
  reenqueued_job_id uuid        NULL,
  named_state_at    timestamptz NULL,
  CONSTRAINT first_hop_enqueue_retries_named_implies_reenqueued_check
    CHECK (named_state_at IS NULL OR reenqueued_at IS NOT NULL),
  CONSTRAINT first_hop_enqueue_retries_reenqueued_after_seen_check
    CHECK (reenqueued_at IS NULL OR reenqueued_at >= first_seen_at)
);

COMMENT ON TABLE public.first_hop_enqueue_retries IS
  'Phase 227 / plan 05 (HEAL-01): one row per strategy the first-hop sweep has '
  'observed as a dropped first sync_trades enqueue. It is the sweep''s grace '
  'anchor (first_seen_at) and its once-only guard (a row with reenqueued_at set '
  'is never deleted, so a strategy is re-enqueued at most once, ever). Written '
  'only by public.first_hop_enqueue_sweep(); service_role may read it.';
COMMENT ON COLUMN public.first_hop_enqueue_retries.strategy_id IS
  'The observed strategy. Cascades with it. One row per strategy by primary key.';
COMMENT ON COLUMN public.first_hop_enqueue_retries.first_seen_at IS
  'When the sweep first saw the strategy match the candidate predicate. The '
  'grace window of 90 minutes is measured from here, never from created_at.';
COMMENT ON COLUMN public.first_hop_enqueue_retries.reenqueued_at IS
  'When the sweep inserted the retry job. NULL until then. Once set the row is '
  'permanent: it is the once-only guard.';
COMMENT ON COLUMN public.first_hop_enqueue_retries.reenqueued_job_id IS
  'The compute_jobs id of the retry. Deliberately NOT a foreign key: retention '
  'prunes job rows and must not be coupled to this ledger.';
COMMENT ON COLUMN public.first_hop_enqueue_retries.named_state_at IS
  'When the sweep wrote the named failed state because the retry also ended '
  'without a result. NULL means it did not. Implies reenqueued_at.';

ALTER TABLE public.first_hop_enqueue_retries ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.first_hop_enqueue_retries FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.first_hop_enqueue_retries TO service_role;

-- --------------------------------------------------------------------------
-- STEP 2: public.first_hop_enqueue_sweep()
-- --------------------------------------------------------------------------
CREATE FUNCTION public.first_hop_enqueue_sweep()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $sweep$
DECLARE
  v_cleared   INTEGER;
  v_observed  INTEGER;
  v_reenq     INTEGER;
BEGIN
  -- ONE statement, ONE candidate predicate. The `cand` CTE is written once and
  -- shared by the clear, the observe and the re-enqueue below, so the three can
  -- never disagree about what a candidate is. Data-modifying CTEs share a
  -- snapshot: an observation this call inserts is invisible to the re-enqueue in
  -- the same call, and the 90-minute grace could not have elapsed for it anyway.
  WITH cand AS MATERIALIZED (
    SELECT s.id
      FROM public.strategies s
     WHERE s.status = 'private'
       AND EXISTS (
             SELECT 1
               FROM public.api_keys ak
              WHERE ak.id = s.api_key_id
                AND ak.is_active
                AND ak.disconnected_at IS NULL
           )
       AND NOT EXISTS (
             SELECT 1
               FROM public.compute_jobs cj
              WHERE cj.strategy_id = s.id OR cj.api_key_id = s.api_key_id
           )
       AND NOT EXISTS (SELECT 1 FROM public.trades t WHERE t.strategy_id = s.id)
       AND NOT EXISTS (SELECT 1 FROM public.csv_daily_returns d WHERE d.strategy_id = s.id)
       AND NOT EXISTS (SELECT 1 FROM public.strategy_keys sk WHERE sk.strategy_id = s.id)
       AND NOT EXISTS (
             SELECT 1
               FROM public.strategy_analytics sa
              WHERE sa.strategy_id = s.id
                AND sa.computation_status <> 'pending'
           )
  ),
  -- (1) An observation whose first hop arrived late is healthy: forget it. Only
  -- an observation that has NOT been re-enqueued is forgotten; one that has is
  -- the once-only guard and is never deleted.
  cleared AS (
    DELETE FROM public.first_hop_enqueue_retries r
     WHERE r.reenqueued_at IS NULL
       AND NOT EXISTS (SELECT 1 FROM cand c WHERE c.id = r.strategy_id)
    RETURNING r.strategy_id
  ),
  -- (2) Observe every candidate not yet observed.
  observed AS (
    INSERT INTO public.first_hop_enqueue_retries (strategy_id)
    SELECT c.id
      FROM cand c
     WHERE NOT EXISTS (
             SELECT 1 FROM public.first_hop_enqueue_retries r0 WHERE r0.strategy_id = c.id
           )
     LIMIT 100
    ON CONFLICT (strategy_id) DO NOTHING
    RETURNING strategy_id
  ),
  -- (3) Observed for more than the grace, still a candidate, not yet re-enqueued.
  due AS (
    SELECT r.strategy_id
      FROM public.first_hop_enqueue_retries r
      JOIN cand c ON c.id = r.strategy_id
     WHERE r.reenqueued_at IS NULL
       AND r.first_seen_at < now() - interval '90 minutes'
     ORDER BY r.first_seen_at
     LIMIT 25
       FOR UPDATE OF r SKIP LOCKED
  ),
  enq AS (
    INSERT INTO public.compute_jobs (strategy_id, kind, metadata)
    SELECT d.strategy_id,
           'sync_trades',
           jsonb_build_object('source', 'first-hop-sweep', 'detected_at', now())
      FROM due d
    ON CONFLICT DO NOTHING
    RETURNING id, strategy_id
  ),
  stamped AS (
    UPDATE public.first_hop_enqueue_retries r
       SET reenqueued_at = now(),
           reenqueued_job_id = e.id
      FROM enq e
     WHERE r.strategy_id = e.strategy_id
    RETURNING r.strategy_id
  )
  SELECT (SELECT count(*) FROM cleared),
         (SELECT count(*) FROM observed),
         (SELECT count(*) FROM stamped)
    INTO v_cleared, v_observed, v_reenq;

  RETURN jsonb_build_object(
    'cleared', v_cleared,
    'observed', v_observed,
    'reenqueued', v_reenq,
    'named_state', 0
  );
END
$sweep$;

COMMENT ON FUNCTION public.first_hop_enqueue_sweep() IS
  'Phase 227 / plan 05 (HEAL-01): re-enqueues the first sync_trades job of a '
  'private strategy whose finalize-time enqueue dropped (an active connected key '
  'and no job, trade, daily-return, member or non-pending analytics row), once, '
  'after the sweep has observed it for more than 90 minutes. Returns jsonb with '
  'cleared, observed, reenqueued and named_state counts. EXECUTE is held by the '
  'owner alone. This function registers nothing: the hourly pg_cron registration '
  'is a live PROD operation owned by docs/runbooks/jobledger-go-live.md.';

-- --------------------------------------------------------------------------
-- STEP 3: grants
-- --------------------------------------------------------------------------
-- The scheduler runs as the owner and needs no grant. service_role is REVOKEd
-- alongside PUBLIC, anon and authenticated: Supabase's default ACL auto-grants
-- EXECUTE to service_role on every new public function, and this function
-- inserts compute jobs and writes a user-visible status as its DEFINER.
REVOKE ALL ON FUNCTION public.first_hop_enqueue_sweep() FROM PUBLIC, anon, authenticated, service_role;
