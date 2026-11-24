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
--               * no compute_jobs row of ANY status names the strategy, and no
--                 compute_jobs row of a strategy-evidencing kind names its key
--                 while that row is IN FLIGHT (pending, running,
--                 done_pending_children or failed_retry: the non-terminal
--                 values of compute_jobs_status_check). A finished key-scoped
--                 job (done, failed_final) is history, not a first hop, and is
--                 not counted. Two daily crons put a key-scoped job on EVERY
--                 active connected key: `derive-allocator-key-dailies` (00:40
--                 UTC, a derive_broker_dailies job) and
--                 `poll-allocator-positions` (01:00 UTC, a poll_allocator_positions
--                 job). Done rows live for 30 days, so counting a finished one
--                 would hide every candidate whose key has seen one tick, and a
--                 tick inside a fresh key's grace would clear its observation
--                 for good. The in-flight filter is what keeps the sweep
--                 sighted; what it still guards is a key whose own derive is
--                 running, where stacking a sync would collide with it.
--                 The three allocator-book kinds (poll_allocator_positions,
--                 refresh_allocator_equity_daily, reconstruct_allocator_history)
--                 are STILL excluded from the key arm. Once the in-flight filter
--                 exists that exclusion is no longer load-bearing for the cron
--                 cohort, and it was kept on purpose, not by omission: it is a
--                 holdings poll of the key, not a sync of the strategy, so an
--                 in-flight one at a tick (which would otherwise hide a
--                 candidate and clear its unre-enqueued observation, restarting
--                 the grace) is simply ignored. Dropping it would need the H10c
--                 gate arm inverted for no gain, so the diff stays one line;
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
-- ⚠️ That 0 was read under the any-job-on-the-key predicate, which the daily
-- derive-allocator-key-dailies and poll-allocator-positions fan-outs empty on
-- their own; the runbook's census must use the in-flight key arm above, so its
-- count can differ from this one.
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
  -- The named failed state's user-visible sentence (DEC-05-E). It is DECLAREd
  -- ONCE, here, and every write below reads this constant. A fixed literal,
  -- never data: nothing a caller or a row can supply reaches computation_error.
  c_named_state_copy CONSTANT TEXT :=
    'Analytics has not started for this strategy: its first sync was never queued, and the automatic retry did not complete. Retry the sync, or contact support if this persists.';

  v_cleared   INTEGER;
  v_observed  INTEGER;
  v_reenq     INTEGER;
  v_named     INTEGER;
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
              WHERE cj.strategy_id = s.id
                 OR (cj.api_key_id = s.api_key_id
                     AND cj.status IN ('pending', 'running', 'done_pending_children', 'failed_retry')
                     AND cj.kind NOT IN ('poll_allocator_positions',
                                         'refresh_allocator_equity_daily',
                                         'reconstruct_allocator_history'))
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

  -- (4) THE NAMED STATE, only when the retry ALSO ended without a result. A
  -- re-enqueued strategy is ripe when it has at least one failed_final job and
  -- NO job in any other status (so nothing is queued, running or retrying), and
  -- its analytics row is absent or still 'pending'. A strategy with no job row
  -- at all is NOT ripe: retention pruned the retry or someone removed it, and
  -- "the retry did not complete" would be a claim nobody measured.
  --
  -- A retry that the bridge already turned into its own 'failed' row (its
  -- curated, per-kind sentence) is KEPT, by two layers that are redundant on
  -- purpose: the admission test below excludes any row not 'pending', and the
  -- DO UPDATE's WHERE clause refuses to overwrite anything but 'pending' even
  -- if a row appears between the two.
  WITH ripe AS (
    SELECT r.strategy_id
      FROM public.first_hop_enqueue_retries r
     WHERE r.reenqueued_at IS NOT NULL
       AND r.named_state_at IS NULL
       AND EXISTS (
             SELECT 1
               FROM public.compute_jobs cjf
              WHERE cjf.strategy_id = r.strategy_id
                AND cjf.status = 'failed_final'
           )
       AND NOT EXISTS (
             SELECT 1
               FROM public.compute_jobs cjn
              WHERE cjn.strategy_id = r.strategy_id
                AND cjn.status <> 'failed_final'
           )
       AND NOT EXISTS (
             SELECT 1
               FROM public.strategy_analytics san
              WHERE san.strategy_id = r.strategy_id
                AND san.computation_status <> 'pending'
           )
     ORDER BY r.reenqueued_at
     LIMIT 25
       FOR UPDATE OF r SKIP LOCKED
  ),
  named AS (
    INSERT INTO public.strategy_analytics (strategy_id, computation_status, computation_error, computing_started_at, computation_error_source, computation_error_job_id)
    SELECT p.strategy_id, 'failed', c_named_state_copy, NULL, NULL, NULL
      FROM ripe p
    ON CONFLICT (strategy_id) DO UPDATE
       SET computation_status = EXCLUDED.computation_status,
           computation_error = EXCLUDED.computation_error,
           computing_started_at = EXCLUDED.computing_started_at,
           computation_error_source = EXCLUDED.computation_error_source,
           computation_error_job_id = EXCLUDED.computation_error_job_id
     WHERE strategy_analytics.computation_status = 'pending'
    RETURNING strategy_id
  )
  UPDATE public.first_hop_enqueue_retries r
     SET named_state_at = now()
    FROM named n
   WHERE r.strategy_id = n.strategy_id;
  GET DIAGNOSTICS v_named = ROW_COUNT;

  RETURN jsonb_build_object(
    'cleared', v_cleared,
    'observed', v_observed,
    'reenqueued', v_reenq,
    'named_state', v_named
  );
END
$sweep$;

COMMENT ON FUNCTION public.first_hop_enqueue_sweep() IS
  'Phase 227 / plan 05 (HEAL-01): re-enqueues the first sync_trades job of a '
  'private strategy whose finalize-time enqueue dropped (an active connected key '
  'and no job of its own, no in-flight strategy-evidencing job on its key, no trade, daily-return, member or non-pending analytics row), once, '
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

-- --------------------------------------------------------------------------
-- STEP 4: self-verifying DO block (catalogue only)
-- --------------------------------------------------------------------------
-- House style: RAISE EXCEPTION, never a silent NOTICE-skip, one literal per
-- RAISE, each naming the CONSEQUENCE. Asserts SHAPE, never behaviour and never
-- data; behaviour is covered by supabase/tests/test_first_hop_enqueue_sweep.sql.
DO $verify$
DECLARE
  -- ⛔ Every variable is DECLAREd up front: plpgsql compiles a DO block WHOLE.
  v_tbl        REGCLASS;
  v_rls        BOOLEAN;
  v_policies   INTEGER;
  v_cnt        INTEGER;
  v_def        TEXT;
  v_tbl_acl    TEXT;
  v_overloads  INTEGER;
  v_nargs      SMALLINT;
  v_secdef     BOOLEAN;
  v_config     TEXT[];
  v_srchpath   TEXT;
  v_defowner   TEXT;
  v_bypass     BOOLEAN;
  v_super      BOOLEAN;
  v_owner      TEXT;
  v_grantees   TEXT;
  v_body       TEXT;
BEGIN
  -- ===== THE TABLE ==========================================================
  v_tbl := to_regclass('public.first_hop_enqueue_retries');
  IF v_tbl IS NULL THEN
    RAISE EXCEPTION 'Migration 20261124120400: public.first_hop_enqueue_retries does not exist after CREATE TABLE, so the sweep has no grace anchor and no once-only guard and every call would abort';
  END IF;

  -- RLS on, zero policies: the only principal that may touch the ledger is the
  -- owner (the sweep's DEFINER), which bypasses row security.
  SELECT c.relrowsecurity INTO v_rls FROM pg_class c WHERE c.oid = v_tbl;
  IF NOT COALESCE(v_rls, FALSE) THEN
    RAISE EXCEPTION 'Migration 20261124120400: row level security is OFF on public.first_hop_enqueue_retries, so any role holding a table privilege can rewrite the once-only guard and re-arm the re-enqueue for a strategy';
  END IF;
  SELECT count(*) INTO v_policies FROM pg_policy p WHERE p.polrelid = v_tbl;
  IF v_policies <> 0 THEN
    RAISE EXCEPTION 'Migration 20261124120400: public.first_hop_enqueue_retries carries % row security policy(ies), expected none; the ledger is written by the owner alone and a policy would open it to a role that must not write it', v_policies;
  END IF;

  -- The two CHECKs, by name AND by what they test.
  SELECT pg_get_constraintdef(k.oid) INTO v_def
    FROM pg_constraint k
   WHERE k.conrelid = v_tbl AND k.contype = 'c'
     AND k.conname = 'first_hop_enqueue_retries_named_implies_reenqueued_check';
  IF v_def IS NULL OR v_def !~ 'named_state_at' OR v_def !~ 'reenqueued_at' THEN
    RAISE EXCEPTION 'Migration 20261124120400: the named-state-implies-reenqueued CHECK is missing or does not test both columns (%), so a strategy could be shown the named failed state without the retry that justifies it ever having run', COALESCE(v_def, 'absent');
  END IF;
  v_def := NULL;
  SELECT pg_get_constraintdef(k.oid) INTO v_def
    FROM pg_constraint k
   WHERE k.conrelid = v_tbl AND k.contype = 'c'
     AND k.conname = 'first_hop_enqueue_retries_reenqueued_after_seen_check';
  IF v_def IS NULL OR v_def !~ 'reenqueued_at' OR v_def !~ 'first_seen_at' THEN
    RAISE EXCEPTION 'Migration 20261124120400: the reenqueued-not-before-seen CHECK is missing or does not test both columns (%), so the ledger could record a re-enqueue that precedes the observation that justified it', COALESCE(v_def, 'absent');
  END IF;

  -- The cascade: deleting a strategy must take its observation with it.
  SELECT count(*) INTO v_cnt
    FROM pg_constraint k
   WHERE k.conrelid = v_tbl AND k.contype = 'f'
     AND k.confrelid = 'public.strategies'::regclass
     AND k.confdeltype = 'c';
  IF v_cnt <> 1 THEN
    RAISE EXCEPTION 'Migration 20261124120400: strategy_id on public.first_hop_enqueue_retries is not a cascading foreign key to public.strategies (% matching), so deleting a strategy would either be blocked by its observation or leave an orphan row behind', v_cnt;
  END IF;

  -- THE TABLE ACL for the four principals the REVOKE above names (PUBLIC, anon,
  -- authenticated, service_role) is exactly service_role SELECT. aclexplode
  -- enumerates grantees instead of interrogating a guessed list; a NULL relacl
  -- means the default ACL, which is made explicit here. The owner and any
  -- platform-internal role are deliberately not enumerated: they are not what
  -- the REVOKE addresses, and naming them would make the apply depend on roles
  -- this file does not own.
  SELECT string_agg(
           (CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END) || ':' || a.privilege_type,
           ',' ORDER BY (CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END), a.privilege_type)
    INTO v_tbl_acl
    FROM pg_class c
    CROSS JOIN LATERAL aclexplode(COALESCE(c.relacl, acldefault('r', c.relowner))) a
   WHERE c.oid = v_tbl
     AND (a.grantee = 0
          OR a.grantee IN (SELECT r.oid FROM pg_roles r
                            WHERE r.rolname IN ('anon', 'authenticated', 'service_role')));
  IF v_tbl_acl IS DISTINCT FROM 'service_role:SELECT' THEN
    RAISE EXCEPTION 'Migration 20261124120400: the table ACL for PUBLIC, anon, authenticated and service_role is [%], expected exactly [service_role:SELECT]. Any write privilege held by a role other than the owner lets it re-arm or erase the once-only guard, and the sweep would then hammer one exchange key every hour', COALESCE(v_tbl_acl, 'none');
  END IF;

  -- ===== THE FUNCTION =======================================================
  -- 0. The name resolves to EXACTLY ONE function: every check after it reads
  --    (schema, name) and a SELECT INTO without STRICT takes the first of several
  --    rows in silence, while an overload created without a REVOKE carries the
  --    default ACL, which grants EXECUTE to PUBLIC.
  SELECT count(*) INTO v_overloads
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'first_hop_enqueue_sweep';
  IF v_overloads <> 1 THEN
    RAISE EXCEPTION 'Migration 20261124120400: public.first_hop_enqueue_sweep resolves to % functions, expected exactly 1; the checks below read (schema, name) with no signature, so an overload carrying the default ACL could sit in the catalogue with every check green', v_overloads;
  END IF;

  -- 1. Takes NO arguments: a caller-supplied value on a SECURITY DEFINER function
  --    that inserts jobs and writes a user-visible status is the attack surface.
  SELECT p.pronargs, p.prosecdef, p.proconfig
    INTO v_nargs, v_secdef, v_config
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'first_hop_enqueue_sweep';
  IF v_nargs <> 0 THEN
    RAISE EXCEPTION 'Migration 20261124120400: first_hop_enqueue_sweep takes % argument(s), expected 0; a caller-supplied value on a SECURITY DEFINER function that enqueues jobs and writes a user-visible status lets any caller who can EXECUTE it choose what is written', v_nargs;
  END IF;

  -- 2. SECURITY DEFINER with a pinned search_path, compared BY VALUE.
  IF NOT v_secdef THEN
    RAISE EXCEPTION 'Migration 20261124120400: first_hop_enqueue_sweep is not SECURITY DEFINER, so it reads and writes compute_jobs and strategy_analytics as the CALLER and fails for every role that is not the owner';
  END IF;
  SELECT c INTO v_srchpath
    FROM unnest(COALESCE(v_config, ARRAY[]::TEXT[])) AS c
   WHERE c LIKE 'search_path=%';
  IF v_srchpath IS NULL THEN
    RAISE EXCEPTION 'Migration 20261124120400: first_hop_enqueue_sweep does not pin search_path at all (proconfig=%); on a SECURITY DEFINER function that is a privilege-escalation route', v_config;
  END IF;
  IF regexp_replace(v_srchpath, '\s', '', 'g') <> 'search_path=public,pg_catalog' THEN
    RAISE EXCEPTION 'Migration 20261124120400: first_hop_enqueue_sweep pins search_path to "%", not to the "public, pg_catalog" its own declaration sets', v_srchpath;
  END IF;

  -- 2b. The definer role is exempt from row security: rolsuper OR rolbypassrls,
  --     NEVER rolbypassrls alone. compute_jobs carries FORCE ROW LEVEL SECURITY,
  --     under which owning the table is not an exemption, so a non-exempt owner
  --     would insert nothing and the sweep would report success forever.
  SELECT r.rolname, r.rolbypassrls, r.rolsuper
    INTO v_defowner, v_bypass, v_super
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    JOIN pg_roles r ON r.oid = p.proowner
   WHERE n.nspname = 'public' AND p.proname = 'first_hop_enqueue_sweep';
  IF v_defowner IS NULL THEN
    RAISE EXCEPTION 'Migration 20261124120400: could not resolve the owner of public.first_hop_enqueue_sweep, pg_proc.proowner has no matching pg_roles row';
  END IF;
  IF NOT (COALESCE(v_bypass, FALSE) OR COALESCE(v_super, FALSE)) THEN
    RAISE EXCEPTION 'Migration 20261124120400: public.first_hop_enqueue_sweep is owned by role "%" (rolsuper=%, rolbypassrls=%), exempt from row security by neither route; compute_jobs carries FORCE ROW LEVEL SECURITY, so the re-enqueue would insert zero rows and the sweep would report healthy forever', v_defowner, v_super, v_bypass;
  END IF;

  -- 3. THE WHOLE EXECUTE GRANTEE SET IS EXACTLY THE OWNER. Compared to the
  --    owner's NAME, never the literal 'postgres'.
  SELECT g.owner_name, string_agg(g.grantee_name, ',' ORDER BY g.grantee_name)
    INTO v_owner, v_grantees
    FROM (
      SELECT pg_get_userbyid(p.proowner) AS owner_name,
             CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END AS grantee_name
        FROM pg_proc p
        JOIN pg_namespace n ON n.oid = p.pronamespace
        CROSS JOIN LATERAL aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) a
       WHERE n.nspname = 'public'
         AND p.proname = 'first_hop_enqueue_sweep'
         AND p.pronargs = 0
         AND a.privilege_type = 'EXECUTE'
    ) g
   GROUP BY g.owner_name;
  IF v_grantees IS NULL THEN
    RAISE EXCEPTION 'Migration 20261124120400: could not read the EXECUTE grantee set of public.first_hop_enqueue_sweep, the function is missing or carries no EXECUTE aclitem at all, and an empty answer is indistinguishable from a locked-down one unless it is refused';
  END IF;
  IF v_grantees IS DISTINCT FROM v_owner THEN
    RAISE EXCEPTION 'Migration 20261124120400: EXECUTE on public.first_hop_enqueue_sweep is held by [%], expected exactly the owner [%]. The scheduler runs as the owner; a grantee beyond it can force job inserts and a user-visible failed status on demand', v_grantees, v_owner;
  END IF;

  -- 4. THE BODY, comment-stripped. cron-style bodies keep SQL comments verbatim,
  --    so an anchor over the raw text would false-pass the exact neuter it exists
  --    to catch: delete the clause from the CODE and leave its comment behind.
  SELECT regexp_replace(p.prosrc, '--[^\n]*', '', 'g')
    INTO v_body
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'first_hop_enqueue_sweep';
  IF v_body IS NULL THEN
    RAISE EXCEPTION 'Migration 20261124120400: could not read the body of public.first_hop_enqueue_sweep, so none of the clause anchors below can be checked';
  END IF;
  IF position('first-hop-sweep' IN v_body) = 0 THEN
    RAISE EXCEPTION 'Migration 20261124120400: the sweep body does not carry the first-hop-sweep source marker, so its jobs cannot be told from the finalize route''s and an operator reading compute_jobs cannot see that the sweep acted';
  END IF;
  IF position('interval ''90 minutes''' IN v_body) = 0 THEN
    RAISE EXCEPTION 'Migration 20261124120400: the sweep body does not carry the 90-minute grace; without it a strategy still inside its finalize window is re-enqueued under the user, against the founder''s ruling of a grace longer than one hour';
  END IF;
  IF position('''private''' IN v_body) = 0 THEN
    RAISE EXCEPTION 'Migration 20261124120400: the sweep body does not admit the private status; the contribution finalize sets private and takes the only arm whose first hop is a sync_trades enqueue, so the sweep would watch nothing';
  END IF;
  IF position('''pending_review''' IN v_body) > 0 THEN
    RAISE EXCEPTION 'Migration 20261124120400: the sweep body names the pending_review status; a manager strategy is first-hopped by process_key_long, and re-enqueueing sync_trades for a ledger-backed key would fail and write a misleading failed state';
  END IF;
  IF position('disconnected_at IS NULL' IN v_body) = 0 THEN
    RAISE EXCEPTION 'Migration 20261124120400: the sweep body does not require disconnected_at IS NULL on the key; a disconnected key is the user withdrawing access, and enqueueing a sync against it acts on a revoked connection';
  END IF;
  IF position('is_active' IN v_body) = 0 THEN
    RAISE EXCEPTION 'Migration 20261124120400: the sweep body does not require an active key; a deactivated key is the user turning the connection off, and enqueueing a sync against it acts on a revoked connection';
  END IF;
  IF position('computation_status = ''pending''' IN v_body) = 0 THEN
    RAISE EXCEPTION 'Migration 20261124120400: the sweep body does not restrict its analytics overwrite to a pending row; the named state would overwrite the bridge''s curated failed sentence, or a complete row, with generic copy';
  END IF;

  RAISE NOTICE 'Migration 20261124120400: first_hop_enqueue_retries and first_hop_enqueue_sweep() verified, table RLS on with no policy and service_role SELECT only, SECURITY DEFINER, search_path pinned, owner exempt from row security, EXECUTE held by the owner alone, body clauses present';
END
$verify$;
