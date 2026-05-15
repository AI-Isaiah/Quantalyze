-- Migration 132: Phase 19 / PR-X5 — teaser-anchor sentinel strategy.
--
-- The teaser flow (POST /api/verify-strategy from the public landing page)
-- creates a strategy_verifications row when the user submits exchange keys
-- for verification. strategy_verifications.strategy_id is NOT NULL FK to
-- strategies(id), but the teaser submitter has no caller-owned strategy by
-- design — they're probing keys against the universe of existing strategies
-- so no strategy_id exists yet. Migration 107's DM-3 commentary flagged the
-- previous "anchor to most recent strategies row" hack as a privacy leak
-- (the teaser SV row inherits the random strategy's RLS user_id).
--
-- This migration provisions a permanent singleton sentinel strategy that
-- all teaser SV rows anchor to. Owned by an all-zeros system pseudo-user
-- so auth.uid() never matches; status='archived' so the row never surfaces
-- in marketplace / allocator dashboards.
--
-- The FK chain `strategies.user_id REFERENCES profiles REFERENCES auth.users`
-- forces us to seed BOTH a sentinel auth.users row AND a sentinel profiles
-- row before the strategies INSERT. We seed the auth.users row with
-- minimal columns (id + email) following the precedent at
-- supabase/migrations/062_scoring_weight_overrides.sql:589 — except that
-- the 062 sentinel was temporary (cleaned up in the same DO block) and
-- this one is permanent. Sign-in is implicitly blocked because:
--   (a) encrypted_password is NULL (no password)
--   (b) email_confirmed_at is NULL (no email confirmation flow)
--   (c) the email host @quantalyze.internal is non-routable
-- Defense in depth: the all-zeros auth.uid() never matches a real session
-- token, so even if (a)-(c) drift, RLS policies that gate on auth.uid()
-- still exclude this row.
--
-- PR-X5 picks up the sentinel strategy by its deterministic UUID:
--   src/lib/phase-19-constants.ts                  : TEASER_ANCHOR_STRATEGY_ID
--   analytics-service/services/teaser_anchor.py    : TEASER_ANCHOR_STRATEGY_ID
-- Both refer to '00000000-0000-0000-0000-000000000001'. Keep in sync.
--
-- D6 (PR-X5 handover, 2026-05-15 session 2): the synchronous pipeline in
-- analytics-service/routers/process_key.py:647-761 is reused as the spine
-- for the teaser flow; this sentinel strategy unblocks the strategy_id FK
-- in the SV INSERT at line 583, and the pipeline gains two
-- `if flow_type != 'teaser':` guards around the fingerprint write-back
-- (line 719-721) and reconstruct_positions call (line 733).

BEGIN;
SET lock_timeout = '3s';

-- 1) Seed the sentinel auth.users row. Idempotent via ON CONFLICT DO NOTHING.
-- Minimal columns; defaults fill the rest. Sign-in is permanently disabled
-- because encrypted_password is NULL and email is non-routable.
INSERT INTO auth.users (id, email)
VALUES (
  '00000000-0000-0000-0000-000000000000'::uuid,
  'system-phase-19-sentinel@quantalyze.internal'
)
ON CONFLICT (id) DO NOTHING;

-- 2) Seed the sentinel profiles row referencing the sentinel auth.users
-- row above. Idempotent via ON CONFLICT DO NOTHING. profiles.is_admin is
-- explicitly false (mig 011 added it NOT NULL DEFAULT false; we set it
-- explicitly here so the row's intent is grep-able).
INSERT INTO public.profiles (
  id,
  display_name,
  role,
  is_admin
)
VALUES (
  '00000000-0000-0000-0000-000000000000'::uuid,
  '[phase-19 sentinel]',
  'manager',
  false
)
ON CONFLICT (id) DO NOTHING;

-- 3) Seed the sentinel strategy. Idempotent via ON CONFLICT DO NOTHING.
-- Deterministic UUID for grep-ability. status='archived' keeps the row
-- out of every marketplace / allocator query that filters on
-- status IN ('published', 'pending_review'). source defaults to 'legacy'.
INSERT INTO public.strategies (
  id,
  user_id,
  name,
  status
)
VALUES (
  '00000000-0000-0000-0000-000000000001'::uuid,
  '00000000-0000-0000-0000-000000000000'::uuid,
  'phase-19-teaser-anchor',
  'archived'
)
ON CONFLICT (id) DO NOTHING;

-- 4) Self-verify all three rows landed. Fail loudly if any are missing —
-- this catches schema drift on either auth.users / profiles / strategies
-- before the application code starts trying to write SV rows that
-- reference the sentinel.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM auth.users
     WHERE id = '00000000-0000-0000-0000-000000000000'::uuid
  ) THEN
    RAISE EXCEPTION
      'Migration 132: sentinel auth.users row missing post-INSERT.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.profiles
     WHERE id = '00000000-0000-0000-0000-000000000000'::uuid
  ) THEN
    RAISE EXCEPTION
      'Migration 132: sentinel profiles row missing post-INSERT.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.strategies
     WHERE id = '00000000-0000-0000-0000-000000000001'::uuid
       AND user_id = '00000000-0000-0000-0000-000000000000'::uuid
       AND status = 'archived'
  ) THEN
    RAISE EXCEPTION
      'Migration 132: teaser-anchor strategies row missing or malformed post-INSERT.';
  END IF;

  RAISE NOTICE
    'Migration 132: teaser-anchor sentinel provisioned (auth.users + profiles + strategies).';
END $$;

COMMIT;
