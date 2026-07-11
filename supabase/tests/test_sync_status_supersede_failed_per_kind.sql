-- Test: sync_strategy_analytics_status supersedes a stale failed_final per
-- (strategy, kind) (migration 20260710150000_sync_status_supersede_failed_per_kind.sql).
--
-- Root cause it guards (Phase 86 F-3 / PUB-02, mig-038 status poison): branch
-- (b) of the shared SECURITY-DEFINER bridge counted ANY compute_jobs row at
-- status='failed_final' as poisoning the strategy → computation_status='failed',
-- unconditionally, before branch (c). Enqueue dedups on IN-FLIGHT statuses only
-- (pending/running/done_pending_children), so a resubmit AFTER a permanent
-- failure inserts a FRESH job generation while the prior failed_final row
-- PERSISTS. The worker then writes 'complete', but mark_compute_job_done's
-- in-RPC bridge re-derives 'failed' from the stale failed_final and overwrites
-- it — a successful fresh-ledger re-onboard reads 'failed' FOREVER, and the
-- recovered composite can NEVER publish. mig-038's header (lines ~46-48)
-- documented this as a deliberately-deferred hazard.
--
-- The fix (this migration) — a PER-(strategy,kind) created_at supersession in
-- branch (b): a failed_final poisons ONLY when it is NOT superseded by a
-- strictly-later 'done' job of the SAME (strategy_id, kind), keyed on the
-- IMMUTABLE created_at (updated_at is trigger-stamped now() on every touch —
-- non-deterministic generation ordering; this + cross-kind blindness is exactly
-- what killed the held PR 229d80fa). Branches (a)/(c) — including the
-- runner-owned `OR strategy_analytics.computation_warned` marker read — stay
-- byte-identical to mig-038 (dropping the marker re-opens SI-02).
--
-- Parts 2-4 drive the REAL worker RPCs mark_compute_job_done /
-- mark_compute_job_failed, not the isolated bridge. An earlier convention seeded
-- jobs already-'done' and called sync_strategy_analytics_status directly; that is
-- a vacuum — it never reproduces the worker running→done flip + in-RPC bridge and
-- stays green while production launders (the preserves-warnings test's own
-- lesson). Seed compute_jobs.created_at EXPLICITLY to force generation ordering
-- (older failed_final, newer done); NEVER seed updated_at (the
-- compute_jobs_set_updated_at trigger clobbers it).
--
-- pgTAP is not set up in this project (CLAUDE.md / Lane B), so assertions RAISE
-- EXCEPTION on failure; a clean run prints NOTICEs only. Run under
-- `psql -v ON_ERROR_STOP=1`. Run order: AFTER migration 20260710150000.
--
-- Integration parts seed gen_random_uuid() ids inside an explicit
-- BEGIN/ROLLBACK so a concurrent CI run against the shared test project cannot
-- collide and no row is left behind even on assertion failure.
--
-- Expected pre-migration state (the TDD RED proof): Part 1 FAILS — the live
-- mig-038 body has NO per-kind + created_at predicate in branch (b) — and
-- ON_ERROR_STOP aborts the whole file there. Post-migration all four Parts pass.

-- ==========================================================================
-- Part 1 — structural (revert-proof, zero side effects). The live function body
-- must carry the per-(strategy,kind) supersession predicate + immutable
-- created_at generation key in branch (b), still read the computation_warned
-- marker in branches (a)/(c), NOT re-derive from data_quality_flags, and keep
-- the SECDEF + search_path posture. Fails on any revert to the mig-038 body.
-- ==========================================================================
DO $$
DECLARE
  v_fn TEXT := pg_get_functiondef('sync_strategy_analytics_status(uuid)'::regprocedure);
BEGIN
  -- Branch (b) must scope supersession PER-KIND (fixes the cross-kind-blind
  -- migration-reviewer HIGH that killed held PR 229d80fa). This is the
  -- fail-without-fix anchor: the mig-038 body has no such predicate.
  IF v_fn !~* 'd\.kind\s*=\s*f\.kind' THEN
    RAISE EXCEPTION 'supersede-failed: branch (b) does not scope supersession per-kind (d.kind = f.kind missing — cross-kind failures could be masked)';
  END IF;
  -- Supersession must key on the IMMUTABLE created_at, strictly-greater (NOT the
  -- trigger-clobbered updated_at).
  IF v_fn !~* 'd\.created_at\s*>\s*f\.created_at' THEN
    RAISE EXCEPTION 'supersede-failed: branch (b) does not key supersession on the immutable created_at (d.created_at > f.created_at missing)';
  END IF;
  -- SI-02 (mig-038): branches (a)/(c) must STILL read the runner-owned
  -- computation_warned marker — the re-base must not drop it (Pitfall 3).
  IF v_fn !~* 'OR\s+strategy_analytics\.computation_warned' THEN
    RAISE EXCEPTION 'supersede-failed: branches (a)/(c) no longer read computation_warned marker (failed_final-bounce launder re-opened)';
  END IF;
  -- No policy fork: the bridge must NOT re-derive warned-ness from
  -- data_quality_flags in SQL.
  IF v_fn ~* 'data_quality_flags' THEN
    RAISE EXCEPTION 'supersede-failed: bridge reads data_quality_flags (policy fork — warned-ness must be runner-owned, read via computation_warned only)';
  END IF;
  -- SECDEF posture survives the full-body CREATE OR REPLACE.
  IF v_fn !~* 'SECURITY DEFINER' THEN
    RAISE EXCEPTION 'supersede-failed: function lost SECURITY DEFINER';
  END IF;
  IF v_fn !~* 'search_path' THEN
    RAISE EXCEPTION 'supersede-failed: function lost SET search_path';
  END IF;
  RAISE NOTICE 'Part 1 OK: branch (b) supersedes per-(strategy,kind) on immutable created_at; branches (a)/(c) keep computation_warned; no data_quality_flags fork; SECDEF + search_path intact.';
END $$;

-- ==========================================================================
-- Part 2 — POISON-REGRESSION (PUB-02 fresh-ledger re-onboard). One strategy: an
-- OLDER stitch_composite failed_final (the stale prior generation) whose parent
-- strategy_analytics row is stuck at 'failed' (the F-3 poison), then a NEWER
-- stitch_composite job driven done through the REAL RPC. The same-kind, strictly-
-- later 'done' supersedes the stale failed_final → the bridge stops counting it →
-- branch (c) resolves 'complete'. Pre-fix branch (b) counts ANY failed_final and
-- overwrites back to 'failed' — this block reddens against the mig-038 body.
-- Isolated in a transaction that always rolls back.
-- ==========================================================================
BEGIN;
DO $$
DECLARE
  v_user       uuid := gen_random_uuid();
  v_strat      uuid;                       -- the composite (api_key_id NULL)
  v_job_old    uuid := gen_random_uuid();  -- stale failed_final generation
  v_job_new    uuid := gen_random_uuid();  -- fresh resubmit generation
  v_token_new  uuid := gen_random_uuid();
  v_status TEXT;
BEGIN
  -- FK chain: compute_jobs/strategy_analytics.strategy_id -> strategies.id ->
  -- profiles.id -> auth.users.id.
  INSERT INTO auth.users (id, email)
    VALUES (v_user, 'sync-supersede-poison-' || v_user || '@invalid.local');
  INSERT INTO public.profiles (id, display_name)
    VALUES (v_user, 'sync-supersede-poison') ON CONFLICT (id) DO NOTHING;
  -- A composite: api_key_id NULL, members link via strategy_keys (not needed for
  -- the bridge derivation, which reads only the compute_jobs aggregate).
  INSERT INTO public.strategies (user_id, name)
    VALUES (v_user, 'sync-supersede-poison-strat') RETURNING id INTO v_strat;

  -- The F-3 poison state: the earlier failed generation left computation_status
  -- stuck at 'failed'. A legitimate resubmit must be able to clear this.
  INSERT INTO public.strategy_analytics (strategy_id, computation_status, computation_warned)
    VALUES (v_strat, 'failed', FALSE);

  -- OLDER failed_final (the stale prior generation) — explicit older created_at.
  INSERT INTO public.compute_jobs
    (id, kind, strategy_id, status, priority, attempts, next_attempt_at, claim_token, last_error, error_kind, created_at)
  VALUES
    (v_job_old, 'stitch_composite', v_strat, 'failed_final', 'normal', 3, now(), NULL, 'stale member failure', 'permanent', now() - interval '1 hour');

  -- NEWER fresh resubmit, still 'running' with a claim token — the exact state at
  -- the moment main_worker calls mark_compute_job_done. Explicit newer created_at.
  INSERT INTO public.compute_jobs
    (id, kind, strategy_id, status, priority, attempts, next_attempt_at, claim_token, created_at)
  VALUES
    (v_job_new, 'stitch_composite', v_strat, 'running', 'normal', 1, now(), v_token_new, now());

  -- Drive the REAL RPC: flip running→done, then in-RPC bridge. The same-kind,
  -- strictly-later done supersedes the stale failed_final → branch (c) → complete.
  PERFORM public.mark_compute_job_done(v_job_new, v_token_new);

  SELECT computation_status INTO v_status
    FROM public.strategy_analytics WHERE strategy_id = v_strat;
  IF v_status IS DISTINCT FROM 'complete' THEN
    RAISE EXCEPTION 'supersede-failed: a same-kind superseded failed_final still poisons a successful resubmit — computation_status = % (expected complete; F-3 re-opened)', v_status;
  END IF;

  RAISE NOTICE 'Part 2 OK: a strictly-later same-kind done superseded the stale failed_final; fresh-ledger re-onboard resolves complete (F-3 closed).';
END $$;
ROLLBACK;

-- ==========================================================================
-- Part 3 — CROSS-KIND SAFETY (the load-bearing regression). One strategy: a
-- GENUINE compute_analytics failed_final (older created_at) plus a LATER
-- poll_positions job driven done. A later done of a DIFFERENT kind must NOT mask
-- the real permanent failure — computation_status must STAY 'failed'. This is
-- the exact silently-holed-publish the held PR 229d80fa (cross-kind-blind)
-- would have caused. This block REDDENS if anyone deletes `d.kind = f.kind` from
-- the migration body (then the poll_positions done would supersede the
-- compute_analytics failure and launder it to complete).
-- Isolated in a transaction that always rolls back.
-- ==========================================================================
BEGIN;
DO $$
DECLARE
  v_user       uuid := gen_random_uuid();
  v_strat      uuid;
  v_job_fail   uuid := gen_random_uuid();  -- compute_analytics failed_final
  v_job_poll   uuid := gen_random_uuid();  -- a LATER poll_positions job (diff kind)
  v_token_poll uuid := gen_random_uuid();
  v_status TEXT;
BEGIN
  INSERT INTO auth.users (id, email)
    VALUES (v_user, 'sync-supersede-crosskind-' || v_user || '@invalid.local');
  INSERT INTO public.profiles (id, display_name)
    VALUES (v_user, 'sync-supersede-crosskind') ON CONFLICT (id) DO NOTHING;
  INSERT INTO public.strategies (user_id, name)
    VALUES (v_user, 'sync-supersede-crosskind-strat') RETURNING id INTO v_strat;

  -- A GENUINE permanent failure of the analytics kind (older created_at).
  INSERT INTO public.compute_jobs
    (id, kind, strategy_id, status, priority, attempts, next_attempt_at, claim_token, last_error, error_kind, created_at)
  VALUES
    (v_job_fail, 'compute_analytics', v_strat, 'failed_final', 'normal', 3, now(), NULL, 'real derive failure', 'permanent', now() - interval '1 hour');

  -- A LATER, DIFFERENT-kind job (poll_positions), still running with a token.
  INSERT INTO public.compute_jobs
    (id, kind, strategy_id, status, priority, attempts, next_attempt_at, claim_token, created_at)
  VALUES
    (v_job_poll, 'poll_positions', v_strat, 'running', 'normal', 1, now(), v_token_poll, now());

  -- Drive the poll_positions job done. Its later 'done' is a DIFFERENT kind, so
  -- it must NOT supersede the compute_analytics failed_final.
  PERFORM public.mark_compute_job_done(v_job_poll, v_token_poll);

  SELECT computation_status INTO v_status
    FROM public.strategy_analytics WHERE strategy_id = v_strat;
  IF v_status IS DISTINCT FROM 'failed' THEN
    RAISE EXCEPTION 'supersede-failed: CROSS-KIND SAFETY BROKEN — a later done of a DIFFERENT kind masked a real compute_analytics failure (computation_status = %, expected failed; the held-PR 229d80fa defect returned)', v_status;
  END IF;

  RAISE NOTICE 'Part 3 OK: a later done of a DIFFERENT kind did NOT mask the real compute_analytics failure (stays failed) — cross-kind SAFETY held.';
END $$;
ROLLBACK;

-- ==========================================================================
-- Part 4 — SC-4 NEUTRALITY (byte-identical success path). A never-failed
-- strategy has ZERO failed_final rows ⇒ branch (b) never fires ⇒ the output is
-- identical by algebra to the mig-038 body. (Case A) a clean single-key strategy
-- driven all-done resolves 'complete'; (Case B) a runner-warned single-key
-- strategy stays 'complete_with_warnings' (the marker read survives the re-base).
-- Models preserves-warnings Parts 2+5. Isolated in a transaction that always
-- rolls back.
-- ==========================================================================
BEGIN;
DO $$
DECLARE
  v_user       uuid := gen_random_uuid();
  v_clean      uuid;  -- never-failed clean strategy → complete
  v_warn       uuid;  -- runner-warned strategy → complete_with_warnings
  v_job_clean  uuid := gen_random_uuid();
  v_job_warn   uuid := gen_random_uuid();
  v_token_clean uuid := gen_random_uuid();
  v_token_warn  uuid := gen_random_uuid();
  v_status TEXT;
BEGIN
  INSERT INTO auth.users (id, email)
    VALUES (v_user, 'sync-supersede-sc4-' || v_user || '@invalid.local');
  INSERT INTO public.profiles (id, display_name)
    VALUES (v_user, 'sync-supersede-sc4') ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.strategies (user_id, name)
    VALUES (v_user, 'sync-supersede-sc4-clean') RETURNING id INTO v_clean;
  INSERT INTO public.strategies (user_id, name)
    VALUES (v_user, 'sync-supersede-sc4-warn') RETURNING id INTO v_warn;

  -- Clean: mid-run 'computing'; warned: the runner already wrote the marker.
  INSERT INTO public.strategy_analytics (strategy_id, computation_status, computation_warned)
    VALUES (v_clean, 'computing', FALSE);
  INSERT INTO public.strategy_analytics (strategy_id, computation_status, computation_warned)
    VALUES (v_warn, 'complete_with_warnings', TRUE);

  -- One running job each (single-key never-failed shape), claim tokens set.
  INSERT INTO public.compute_jobs
    (id, kind, strategy_id, status, priority, attempts, next_attempt_at, claim_token)
  VALUES
    (v_job_clean, 'compute_analytics_from_csv', v_clean, 'running', 'normal', 1, now(), v_token_clean),
    (v_job_warn,  'compute_analytics_from_csv', v_warn,  'running', 'normal', 1, now(), v_token_warn);

  PERFORM public.mark_compute_job_done(v_job_clean, v_token_clean);
  PERFORM public.mark_compute_job_done(v_job_warn,  v_token_warn);

  -- (A) never-failed clean → plain complete (branch (b) inert; no over-preserve).
  SELECT computation_status INTO v_status
    FROM public.strategy_analytics WHERE strategy_id = v_clean;
  IF v_status IS DISTINCT FROM 'complete' THEN
    RAISE EXCEPTION 'supersede-failed: SC-4 clean success path changed — got % (expected complete; success path must be byte-identical to mig-038)', v_status;
  END IF;

  -- (B) runner-warned → complete_with_warnings preserved (marker read survives).
  SELECT computation_status INTO v_status
    FROM public.strategy_analytics WHERE strategy_id = v_warn;
  IF v_status IS DISTINCT FROM 'complete_with_warnings' THEN
    RAISE EXCEPTION 'supersede-failed: SC-4 warned path broke — got % (expected complete_with_warnings; computation_warned marker read lost in the re-base)', v_status;
  END IF;

  RAISE NOTICE 'Part 4 OK: never-failed clean resolves complete; runner-warned stays complete_with_warnings (SC-4 success path byte-identical).';
END $$;
ROLLBACK;
