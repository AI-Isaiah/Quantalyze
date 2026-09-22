-- ===========================================================================
-- Migration: api_keys_sync_status_check — add 'sign_in_failed' (D-11 arm B)
-- ===========================================================================
--
-- Phase 167 CREDTRUST. D-11 arm B — a ninth `sync_status` value, ratified at
-- the phase's `checkpoint:decision` (167-03-PLAN.md) rather than reusing
-- `revoked` (SELF-LATCHES: `enqueue_poll_allocator_positions_for_all_keys`
-- excludes `sync_status = 'revoked'`, so routing here would stop the very
-- daily poll that writes the signal this phase is about) or adding a second
-- column (forces a `src/lib/database.types.ts` hand edit with no safe
-- regeneration path from this checkout, whose Supabase CLI is linked to
-- PRODUCTION).
--
-- ⛔ THE STYLE MAP LANDS IN THE SAME COMMIT AS THIS MIGRATION.
-- `src/components/exchanges/AllocatorSyncStatus.tsx`'s `PILL_STYLES`
-- normalises an unknown `sync_status` to `idle` — a NEUTRAL pill. Without
-- the style row landing together with this constraint, a partial rollout
-- would render a BROKEN key as HEALTHY (T-167-08, mitigate, critical).
--
-- Pattern analog: `supabase/migrations/20260420073003_allocator_holdings.sql`
-- STEP 5 (the DROP+ADD widening) + its self-verifying DO block arm (h),
-- same shape.
--
-- ⛔ Re-run of the analog's own grep, recorded rather than assumed:
--   grep -rln "api_keys_sync_status_check" supabase/migrations/
-- returns exactly ONE file at HEAD — 20260420073003_allocator_holdings.sql
-- STEP 5, which shipped the 8-value list re-typed below. No migration in
-- between has touched this CHECK, so a DROP+ADD that re-types the full list
-- is safe here.
--
-- ⛔⛔ THIS DO BLOCK READS THE SCHEMA ONLY, NEVER THE DATA. A data-reading DO
-- block can apply cleanly on PROD (rows already exist there) and REFUSE on
-- shared TEST (whose `public` tables are a schema-only restore, per
-- CLAUDE.md), and a failed TEST apply blocks the PROD apply — the recorded
-- [164.8-DATA-DEPENDENT-MIGRATION-ESCAPE] class. The interim remedy for that
-- class is to REVERT THE MERGE, never to edit `supabase-migrate.yml`.
-- ===========================================================================

-- ⛔ FAIL FAST RATHER THAN QUEUE. Both statements below take ACCESS EXCLUSIVE
-- on `api_keys`, and an unbounded wait behind one long-running reader does not
-- just stall this migration — ACCESS EXCLUSIVE queues ahead of every later
-- lock request, so every subsequent `api_keys` reader piles up behind a
-- migration that is itself waiting. A 55P03 (`lock_not_available`) and a RED
-- apply is the wanted outcome; a silently stalled table is not.
-- Placement copied from the direct analog,
-- `20260811210000_api_keys_attested_venue.sql`, which sets the same 3s
-- immediately above its own `ALTER TABLE public.api_keys`.
SET lock_timeout = '3s';

ALTER TABLE public.api_keys DROP CONSTRAINT IF EXISTS api_keys_sync_status_check;
ALTER TABLE public.api_keys ADD CONSTRAINT api_keys_sync_status_check
  CHECK (sync_status IN (
    'idle','syncing','computing','complete','complete_with_warnings',
    'error','revoked','rate_limited','sign_in_failed'
  ));

-- ===========================================================================
-- Self-verifying DO block — SCHEMA-reading only, per the rule above.
-- ===========================================================================
DO $$
DECLARE
  v_sync_status_def TEXT;
BEGIN
  -- ⛔ SCOPED BY conrelid, not by conname alone. `conname` is unique only per
  -- (relation, name), so a same-named constraint on another table — in this
  -- schema or any other on `search_path` — could be the row this SELECT reads,
  -- and the whole DO block would then be verifying someone else's constraint
  -- while reporting success for ours. The sibling gate already scopes this way;
  -- this is the migration copying its predicate rather than trusting the name.
  SELECT pg_get_constraintdef(oid) INTO v_sync_status_def
    FROM pg_constraint
   WHERE conrelid = 'public.api_keys'::regclass
     AND conname = 'api_keys_sync_status_check';

  IF v_sync_status_def IS NULL THEN
    RAISE EXCEPTION 'Migration 20260922120000 failed: api_keys_sync_status_check not found';
  END IF;

  -- ⛔ EVERY probe below matches the QUOTED, DELIMITED, CAST token exactly as
  -- `pg_get_constraintdef` renders it — never a bare substring.
  --
  -- THE HOLE THIS CLOSES, and it was MEASURED on a pg-lane, not reasoned:
  -- `'complete'` is a SUBSTRING of `'complete_with_warnings'`, so the bare
  -- `NOT LIKE '%complete%'` arm that stood here was satisfied by a constraint
  -- that had LOST `'complete'` as long as it still carried
  -- `'complete_with_warnings'`. A re-typed, stale list could drop a live value
  -- and this block — the block whose entire job is "no prior value was lost" —
  -- would report success. The same hole sits under any value that is a prefix
  -- of another, so the IDIOM is fixed here, not just the one arm.
  --
  -- The rendered form, read off a lane clone of this migration (verbatim):
  --   CHECK ((sync_status = ANY (ARRAY['idle'::text, ..., 'sign_in_failed'::text])))
  -- so `'complete'::text` is unambiguous against `'complete_with_warnings'::text`
  -- and stays unambiguous if a FUTURE value becomes a prefix of another.
  --
  -- ⚠️ `position()` replaces `LIKE` deliberately: `_` is a LIKE WILDCARD, and
  -- three of these nine values contain one (`complete_with_warnings`,
  -- `rate_limited`, `sign_in_failed`), so the LIKE spelling was a second,
  -- quieter ambiguity in the same check. `position()` has no wildcards, and it
  -- is the idiom the sibling gate already uses.
  --
  -- ⚠️ The `::text` suffix couples this block to `sync_status` being declared
  -- `text` (it is: the PROD-derived baseline carries `"sync_status" "text"`).
  -- A future type change would redden this apply LOUDLY rather than pass a
  -- hollow check — the acceptable direction for a coupling to fail in.

  -- (a) the new value is admitted.
  IF position('''sign_in_failed''::text' IN v_sync_status_def) = 0 THEN
    RAISE EXCEPTION 'Migration 20260922120000 failed: api_keys_sync_status_check missing sign_in_failed. Got: %',
      v_sync_status_def;
  END IF;

  -- (b) every prior value survived the DROP+ADD — the guard against a
  -- DROP+ADD that re-types a stale list and silently removes a value added
  -- since (Pattern Assignment 8's named hazard, 167-PATTERNS.md).
  IF position('''idle''::text' IN v_sync_status_def) = 0
     OR position('''syncing''::text' IN v_sync_status_def) = 0
     OR position('''computing''::text' IN v_sync_status_def) = 0
     OR position('''complete_with_warnings''::text' IN v_sync_status_def) = 0
     OR position('''complete''::text' IN v_sync_status_def) = 0
     OR position('''error''::text' IN v_sync_status_def) = 0
     OR position('''revoked''::text' IN v_sync_status_def) = 0
     OR position('''rate_limited''::text' IN v_sync_status_def) = 0 THEN
    RAISE EXCEPTION 'Migration 20260922120000 failed: api_keys_sync_status_check lost a prior value. Got: %',
      v_sync_status_def;
  END IF;
END $$;
