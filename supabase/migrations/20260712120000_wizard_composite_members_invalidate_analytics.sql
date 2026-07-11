-- Phase 94.1 / RT-FINDING-1 (v1.9.1 composite-onboarding hardening):
-- set_wizard_composite_members must INVALIDATE the stale composite analytics
-- when the member set actually CHANGES, so the wizard verify step never shows
-- the CURRENT member list beside the OLD set's metrics.
--
-- ─── The bug ──────────────────────────────────────────────────────────────
-- The prior set_wizard_composite_members (migration 20260710180000) rewrote
-- ONLY strategy_keys; it never touched strategy_analytics. So after:
--   connect {A,B} -> sync completes (strategy_analytics.computation_status
--   = 'complete', dq_flags.composite = true, csv_daily_returns stitched from
--   {A,B}) -> back-nav, add key C, Continue -> set-members persists {A,B,C},
--   analytics STILL 'complete'
-- the wizard's SyncPreviewStep durability short-circuit
-- (SyncPreviewStep.tsx: `isComplete` + `dqFlags.composite === true`) SKIPS the
-- /api/keys/sync kickoff, the poll sees 'complete' immediately, and the
-- factsheet materializes the FRESH strategy_keys {A,B,C} headline/gantt beside
-- the STALE series/metrics computed from {A,B}. The R2-4 reconciliation caption
-- is silently suppressed and submit stays enabled — the user attests numbers
-- that silently change after finalize re-stitches.
--
-- ─── The fix (invalidation is sufficient; the re-stitch path already exists) ─
-- The kickoff at /api/keys/sync already enqueues a fresh `stitch_composite` for
-- a member-bearing composite. All that is missing is invalidation so the client
-- STOPS short-circuiting on the stale-complete row. When the incoming member set
-- differs from the persisted one, reset the analytics row's
-- computation_status 'complete'/'complete_with_warnings' -> 'pending' so
-- `isComputedAnalytics()` is false, the durability block is skipped, and the
-- mount falls through to the kickoff POST -> re-stitch. The poll then never reads
-- the old 'complete' row as done (it is 'pending' until the worker flips it
-- computing -> complete on the fresh data).
--
-- ─── Writer-discipline justification (keys/sync route.ts:47-60 audit) ───────
-- On the queue path the WORKER is the sole writer of
-- strategy_analytics.computation_status DURING A COMPUTE (via the
-- sync_strategy_analytics_status bridge). This invalidation does NOT race that:
-- it is scoped `WHERE computation_status IN ('complete','complete_with_warnings')`
-- — i.e. it only ever touches a COMPLETED, IDLE row (no worker compute is in
-- flight for a completed row), and it NEVER overwrites a 'computing' row the
-- worker owns. It is an input-invalidation of a finished derive whose inputs
-- changed, immediately followed by the wizard's kickoff re-enqueue, so the row
-- is never left stuck (finalize's after() re-enqueue is the backstop). Adds
-- set_wizard_composite_members as writer (f) to that audit's enumeration.
--
-- ─── WIZ-05 no-op invariant (pinned by the a4a9feba e2e) ───────────────────
-- An IDENTICAL re-Continue (same members, same windows) must NOT re-stitch. The
-- invalidation is therefore GATED on a genuine change: an order-independent
-- signature over the stitch-determining tuple (api_key_id, window_start,
-- window_end) is compared BEFORE the wholesale delete; when the signatures
-- match, the analytics row is left untouched and the durability short-circuit
-- (and its latency win) is preserved.
--
-- PURE FUNCTION-BODY CHANGE. CREATE OR REPLACE of set_wizard_composite_members
-- ONLY (re-based on the LATEST definition, 20260710180000). add_wizard_composite_key
-- is untouched. No column / index / constraint / trigger / grant change. The
-- ownership + composite-only + owner-coherence guards and the wholesale
-- delete-then-insert (L-4 dissolution) are reproduced verbatim.

BEGIN;

SET LOCAL lock_timeout = '3s';

CREATE OR REPLACE FUNCTION public.set_wizard_composite_members(
  p_user_id UUID,
  p_strategy_id UUID,
  p_members JSONB
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
SET lock_timeout = '3s'
AS $$
DECLARE
  v_auth_uid UUID := auth.uid();
  v_api_key_id UUID;
  v_count INTEGER;
  v_existing_sig TEXT[];
  v_incoming_sig TEXT[];
BEGIN
  IF v_auth_uid IS NULL THEN
    RAISE EXCEPTION 'set_wizard_composite_members called without an auth session'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF v_auth_uid <> p_user_id THEN
    RAISE EXCEPTION 'set_wizard_composite_members: p_user_id (%) does not match auth.uid (%)',
      p_user_id, v_auth_uid
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- Ownership + composite-draft guard in ONE least-disclosure lookup: filtering
  -- by user_id means "not found" and "not owned" are indistinguishable to the
  -- caller (no existence oracle). A single-key strategy (api_key_id NOT NULL)
  -- can NEVER acquire members through this fn (protects composite-detection).
  SELECT api_key_id
    INTO v_api_key_id
    FROM strategies
   WHERE id = p_strategy_id
     AND user_id = p_user_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'set_wizard_composite_members: no composite draft for the caller'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF v_api_key_id IS NOT NULL THEN
    RAISE EXCEPTION 'set_wizard_composite_members: target is a single-key strategy, not a composite draft';
  END IF;

  -- RT-FINDING-1: capture the EXISTING member signature BEFORE the wholesale
  -- delete so a genuine change vs a no-op re-Continue can be distinguished. The
  -- signature is order-independent over the stitch-determining tuple
  -- (api_key_id, window_start, window_end) — seq is derived, not an input, so a
  -- pure reorder that yields the same tuple SET is NOT a stitch-affecting change.
  -- window_end NULL (open-ended/live) normalizes to '' on both sides.
  SELECT array_agg(sig ORDER BY sig)
    INTO v_existing_sig
    FROM (
      SELECT sk.api_key_id::text || '|' || sk.window_start::text || '|'
             || COALESCE(sk.window_end::text, '')
        FROM strategy_keys sk
       WHERE sk.strategy_id = p_strategy_id
    ) AS e(sig);

  SELECT array_agg(sig ORDER BY sig)
    INTO v_incoming_sig
    FROM (
      SELECT (elem->>'api_key_id') || '|'
             || (elem->>'window_start')::date::text || '|'
             || COALESCE((elem->>'window_end')::date::text, '')
        FROM jsonb_array_elements(p_members) AS elem
    ) AS i(sig);

  -- WHOLESALE rewrite: DELETE all members, then INSERT with seq derived from
  -- window_start ASC order (1-indexed). No in-place seq UPDATE ⇒ no transient
  -- (strategy_id, seq) 23505 on reorder (L-4 dissolved). The existing
  -- strategy_keys_owner_coherence trigger enforces cross-tenant coherence on
  -- each INSERT — no app-layer duplicate. Deterministic tiebreak on api_key_id
  -- keeps seq stable if two members share a window_start.
  DELETE FROM strategy_keys WHERE strategy_id = p_strategy_id;

  INSERT INTO strategy_keys (
    strategy_id, api_key_id, owner_id, window_start, window_end, seq
  )
  SELECT
    p_strategy_id,
    (elem->>'api_key_id')::uuid,
    p_user_id,
    (elem->>'window_start')::date,
    (elem->>'window_end')::date,
    (row_number() OVER (
       ORDER BY (elem->>'window_start')::date ASC, (elem->>'api_key_id')
     ))::int
  FROM jsonb_array_elements(p_members) AS elem;

  GET DIAGNOSTICS v_count = ROW_COUNT;

  -- RT-FINDING-1: when the member set ACTUALLY changed, invalidate a stale
  -- COMPLETED composite analytics row so the wizard re-stitches instead of
  -- short-circuiting to the old metrics. Scoped to completed/idle rows only
  -- (never a 'computing' row the worker owns) — see the writer-discipline
  -- justification in the migration header. An identical re-Continue skips this
  -- (WIZ-05 no-op latency invariant). IS DISTINCT FROM handles the NULL
  -- (no prior members) case as "changed" — harmless (no completed row to reset
  -- on a first write, and the kickoff derives it fresh anyway).
  IF v_existing_sig IS DISTINCT FROM v_incoming_sig THEN
    UPDATE strategy_analytics
       SET computation_status = 'pending',
           computation_error = NULL
     WHERE strategy_id = p_strategy_id
       AND computation_status IN ('complete', 'complete_with_warnings');
  END IF;

  RETURN v_count;
END;
$$;

COMMENT ON FUNCTION public.set_wizard_composite_members IS
  'ONB-03/L-4 + RT-FINDING-1: wholesale delete-then-insert of a composite draft''s strategy_keys members (seq derived server-side from window_start ASC). When the incoming member set DIFFERS from the persisted one (order-independent signature over api_key_id+window_start+window_end), invalidates a stale COMPLETED strategy_analytics row (computation_status complete/complete_with_warnings -> pending) so the wizard verify step re-stitches instead of short-circuiting to the old metrics; an identical re-Continue leaves analytics untouched (WIZ-05 no-op invariant). Only touches completed/idle rows, never a computing row the worker owns. Guards: auth.uid()=p_user_id, strategy owned by caller, api_key_id IS NULL. Returns the member count written.';

-- Grants are unchanged by CREATE OR REPLACE, but re-assert for clarity/idempotence.
REVOKE ALL ON FUNCTION public.set_wizard_composite_members(uuid, uuid, jsonb)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_wizard_composite_members(uuid, uuid, jsonb)
  TO authenticated;

-- --------------------------------------------------------------------------
-- Self-verify: the new invalidation logic is present, the guards survived the
-- replace, and grants are intact. A failed RAISE aborts COMMIT.
-- --------------------------------------------------------------------------
DO $$
DECLARE
  v_set_src TEXT;
BEGIN
  SELECT pg_get_functiondef(
    'public.set_wizard_composite_members(uuid,uuid,jsonb)'::regprocedure
  ) INTO v_set_src;

  -- (a) invalidation present: resets a completed analytics row to 'pending'.
  IF v_set_src NOT ILIKE '%UPDATE strategy_analytics%'
     OR v_set_src NOT ILIKE '%complete_with_warnings%' THEN
    RAISE EXCEPTION 'wizard_composite_invalidate self-verify: set_wizard_composite_members is missing the stale-analytics invalidation';
  END IF;
  -- (b) change-gating present: the signature comparison guards the invalidation
  --     (so a no-op re-Continue does not re-stitch — WIZ-05).
  IF v_set_src NOT ILIKE '%IS DISTINCT FROM%' THEN
    RAISE EXCEPTION 'wizard_composite_invalidate self-verify: the change-detection gate (signature compare) is missing — a no-op re-Continue would re-stitch (WIZ-05 violated)';
  END IF;
  -- (c) guards survived the replace.
  IF v_set_src NOT ILIKE '%search_path%'
     OR v_set_src NOT ILIKE '%single-key strategy%' THEN
    RAISE EXCEPTION 'wizard_composite_invalidate self-verify: a guard (search_path / composite-only) regressed in the replace';
  END IF;
  -- (d) grants intact.
  IF NOT has_function_privilege('authenticated',
       'public.set_wizard_composite_members(uuid,uuid,jsonb)', 'EXECUTE') THEN
    RAISE EXCEPTION 'wizard_composite_invalidate self-verify: authenticated lost EXECUTE';
  END IF;
  IF has_function_privilege('anon',
       'public.set_wizard_composite_members(uuid,uuid,jsonb)', 'EXECUTE') THEN
    RAISE EXCEPTION 'wizard_composite_invalidate self-verify: anon must NOT have EXECUTE';
  END IF;

  RAISE NOTICE 'wizard_composite_invalidate self-verify OK: stale-analytics invalidation present + change-gated (WIZ-05 preserved); guards + grants intact.';
END
$$;

COMMIT;
