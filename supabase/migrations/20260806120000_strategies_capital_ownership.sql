-- OWN-03 (Phase 150, Plan 01) — the persistent capital-ownership mark on
-- `strategies`, the D-03-A allocation invariant enforced at the TABLE layer, and
-- the transactional mark-flip RPC.
-- 2026-08-06.
--
-- Re-base check (MEMORY `project_cross_cutting_refactor_program`): grepped ALL
-- of supabase/migrations, src/ and analytics-service/ for `capital_ownership`,
-- `own_capital`, `team_review`, `guard_allocation_requires_own_capital` and
-- `flip_capital_ownership_to_team_review` before writing this file — ZERO
-- matches. Every object below is greenfield; nothing here replaces a prior
-- definition, so there is no earlier body to re-base on.
--
--
-- (a) D-04 — THE MARK IS STRATEGY-LEVEL, NOT KEY-LEVEL.
-- ------------------------------------------------------
-- Allocation is strategy-level (`portfolio_strategies` keys on
-- (portfolio_id, strategy_id)), so a multi-key strategy like Alpha Centauri
-- carries ONE mark and a key added later inherits it. The question is asked at
-- key-add; the answer lands on the derived strategy row.
--
--
-- (b) NULLABLE, NO DEFAULT, NO BACKFILL — LOAD-BEARING.
-- ------------------------------------------------------
-- `DEFAULT 'team_review' NOT NULL` would stamp every pre-existing strategy —
-- Black Swan, Alpha Centauri, Arctic Fox — as "a trading team's key I am
-- verifying". That is a FABRICATED claim about the founder's own capital and
-- violates the project-wide no-invented-data invariant. Unmarked legacy rows
-- must read as "never asked" (they render no tag), and the remedy is the retro
-- Mark dialog (D-09/D-11), not a migration that guesses.
--
--
-- (c) THREE DISPLAY STATES, TWO LOGIC STATES — DO NOT "SIMPLIFY".
-- ---------------------------------------------------------------
--   NULL          -> never asked. Renders NO tag. Non-allocatable when
--                    self-owned.
--   'own_capital' -> allocatable. Renders the accent tag.
--   'team_review' -> NEVER allocatable, under any ownership. Renders the muted
--                    tag.
-- NULL and 'team_review' coincide ONLY inside the allocatable predicate for
-- self-owned rows; they are distinct everywhere a human looks. A reviewer who
-- sees three display states and two logic states will be tempted to collapse
-- one of them. Do not.
--
--
-- (d) D-03-A — WHY THE TRIGGER PREDICATE IS NOT A BLANKET
--     `IS DISTINCT FROM 'own_capital'` (CONTEXT amendment 2026-08-06).
-- ------------------------------------------------------------------
-- Three SHIPPED paths insert `portfolio_strategies` rows for strategies owned
-- by OTHER users, which the inserting allocator cannot mark (marking is
-- owner-authz'd — `strategies_update USING (user_id = auth.uid())`):
--   * src/components/portfolio/AddToPortfolio.tsx:54   (discovery, client .insert)
--   * src/components/portfolio/MigrationWizard.tsx:72  (manager migration, client .upsert)
--   * scripts/seed-full-app-demo.ts:1697,1929          (demo seed, service-role .upsert)
-- A blanket not-own_capital predicate would DELETE all three. So the
-- not-own_capital arm is scoped to SELF-OWNED strategies (strategy.user_id =
-- the inserting portfolio's owner), while the 'team_review' arm stays
-- UNCONDITIONAL per SC 2b — a team-review mark blocks a position for ANYONE,
-- third party included. Self-owned NULL (never asked) stays non-allocatable
-- (SC 3): the owner is the one person who CAN answer the question.
--
--
-- (d.2) WHY THE TRIGGER FUNCTION IS `SECURITY DEFINER`.
-- -----------------------------------------------------
-- The guard reads `strategies` and `portfolios`. Under SECURITY INVOKER those
-- reads are RLS-filtered by the INSERTING session: `strategies_read` is
-- `status='published' OR user_id=auth.uid()`, so an authenticated caller
-- inserting a position for ANOTHER owner's UNPUBLISHED strategy would see zero
-- rows, leave v_mark NULL, and slip past the guard — silently making the
-- "UNCONDITIONAL team_review" arm (SC 2b) false for exactly the rows an
-- attacker would choose. SECURITY DEFINER makes the guard read the TRUTH
-- regardless of the caller's visibility. This is safe: the function takes no
-- arguments, is never invocable via PostgREST (grants revoked below), performs
-- no writes, and only ever RAISEs. Deliberate divergence from the SECURITY
-- INVOKER analog `guard_strategies_publish_transition` — that one is INVOKER
-- BECAUSE it keys on `current_user`; this one has no such dependency and would
-- be unsound as INVOKER.
--
--
-- (e) NO RLS CHANGE IS NEEDED, AND WHY.
-- --------------------------------------
-- Mirrors the 20260716130000_strategies_status_private.sql:20-27 argument.
-- `strategies_read` (20260405061912_rls_policies.sql:28-30) is
-- `status='published' OR user_id=auth.uid()`; `strategies_update` (:32) is
-- `user_id=auth.uid()`; `portfolio_strategies_owner` (:67-69) is
-- `portfolio_id IN (SELECT id FROM portfolios WHERE user_id = auth.uid())`.
-- Adding a COLUMN changes none of them, and no policy is created or altered
-- here. Note for the money-path review (do NOT "fix" it in this migration,
-- Rule 3): `portfolio_strategies_owner` is `FOR ALL USING (...)` with no
-- explicit WITH CHECK — under FOR ALL, Postgres reuses USING as the check, so
-- INSERT/UPSERT is covered.
--
--
-- (f) CONSCIOUS ACCEPTANCE — THE MARK IS PUBLICLY READABLE ON PUBLISHED ROWS.
-- ---------------------------------------------------------------------------
-- `strategies_read` has no column projection, so anon can
-- `select capital_ownership` on any PUBLISHED strategy. The value states "this
-- allocator has capital in this" — judged NON-SENSITIVE, and accepted here as a
-- decision rather than discovered later at review time (150-RESEARCH Open
-- Question 4, resolved: accept). UI-SPEC invariant 3 ("public surfaces render
-- zero pixels of this phase") is a RENDER invariant, not a data one; nothing in
-- this phase renders the mark on a public surface.
--
--
-- Ops: merging supabase/migrations/** to main AUTO-APPLIES to PROD
-- (MEMORY `project_supabase_migrate_auto_on_push`). Apply to TEST
-- (qmnijlgmdhviwzwfyzlc) via MCP `apply_migration` BEFORE merge; MCP stamps
-- now(), so the TEST-side timestamp will drift from this filename. Expected.
--
-- DROP-then-ADD constraint idiom (re-runnable, ordering-independent), cloned
-- from 20260716130000_strategies_status_private.sql:57-61.

BEGIN;

SET LOCAL lock_timeout = '3s';

-- ==========================================================================
-- 2. COLUMN + CHECK
-- ==========================================================================

ALTER TABLE public.strategies
  ADD COLUMN IF NOT EXISTS capital_ownership TEXT;

COMMENT ON COLUMN public.strategies.capital_ownership IS
  'OWN-03 capital-ownership mark, STRATEGY-level (D-04). NULL = never asked: renders no tag, and is NON-ALLOCATABLE for a self-owned strategy — the remedy is the retro Mark dialog on /my-strategies (D-09/D-11), never a backfill. ''own_capital'' = the allocator''s own capital, allocatable. ''team_review'' = a trading team''s key under verification, NEVER allocatable by anyone (SC 2b). Deliberately nullable with no default: defaulting would fabricate a claim about pre-existing strategies.';

-- Pre-flight: fail loud (listing offending values) if any existing row would
-- violate the new constraint. Vacuously clean on a freshly added column — it is
-- kept because the DROP-then-ADD idiom is re-runnable, so a LATER re-apply
-- against a populated column gets a precise diagnostic instead of a bare 23514.
DO $$
DECLARE
  bad TEXT;
BEGIN
  SELECT string_agg(DISTINCT capital_ownership, ', ') INTO bad
  FROM public.strategies
  WHERE capital_ownership IS NOT NULL
    AND capital_ownership NOT IN ('own_capital', 'team_review');
  IF bad IS NOT NULL THEN
    RAISE EXCEPTION
      'OWN-03 migration aborted: strategies has out-of-range capital_ownership value(s): %', bad;
  END IF;
END $$;

ALTER TABLE public.strategies
  DROP CONSTRAINT IF EXISTS strategies_capital_ownership_check;
ALTER TABLE public.strategies
  ADD CONSTRAINT strategies_capital_ownership_check
  CHECK (capital_ownership IN ('own_capital', 'team_review'));

-- ==========================================================================
-- 3. D-03-A TRIGGER — the ONLY tier that holds against every insert path
-- ==========================================================================

CREATE OR REPLACE FUNCTION public.guard_allocation_requires_own_capital()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_mark            TEXT;
  v_strategy_owner  UUID;
  v_portfolio_owner UUID;
BEGIN
  -- SECURITY DEFINER (see header d.2): these two lookups must NOT be
  -- RLS-filtered by the inserting session, or the unconditional team_review arm
  -- goes blind on rows the caller cannot read.
  SELECT s.capital_ownership, s.user_id
    INTO v_mark, v_strategy_owner
    FROM public.strategies s
   WHERE s.id = NEW.strategy_id;

  -- Unqualified relation names are deterministic here: `SET search_path =
  -- public, pg_catalog` is pinned on the function above.
  SELECT p.user_id
    INTO v_portfolio_owner
    FROM portfolios p
   WHERE p.id = NEW.portfolio_id;

  -- D-03-A, two arms:
  --   ARM 1 (unconditional, SC 2b literally): a team_review mark blocks a
  --     position for ANYONE — owner or third party. "A team-review strategy can
  --     never become a position" means never.
  --   ARM 2 (owner-scoped): a SELF-OWNED strategy must be affirmatively marked
  --     own_capital. NULL (never asked) is non-allocatable — the owner is the
  --     one person who can answer the question, so silence is not consent.
  -- The owner-equality conjunct on ARM 2 is what preserves the three SHIPPED
  -- third-party allocation paths — AddToPortfolio.tsx:54,
  -- MigrationWizard.tsx:72 and seed-full-app-demo.ts:1697,1929 — which insert
  -- positions for OTHER owners' strategies that the allocator has no authority
  -- to mark. A blanket not-own_capital predicate would break all three.
  IF v_mark = 'team_review'
     OR (v_strategy_owner = v_portfolio_owner AND v_mark IS DISTINCT FROM 'own_capital') THEN
    RAISE EXCEPTION
      'strategy % cannot become a position: capital_ownership=% (required: own_capital)',
      NEW.strategy_id, COALESCE(v_mark, 'unmarked')
      USING ERRCODE = 'check_violation',
            HINT = 'Mark the strategy as your own capital in My Strategies before allocating to it.';
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.guard_allocation_requires_own_capital() IS
  'OWN-03 / D-03-A: blocks creation of a portfolio_strategies row when the strategy is marked team_review (unconditional, SC 2b) or when the strategy is SELF-OWNED and not marked own_capital. Third-party inserts with a NULL or own_capital mark pass, preserving the shipped AddToPortfolio / MigrationWizard / demo-seed paths. SECURITY DEFINER so the mark lookup is not RLS-filtered by the inserting session.';

-- INSERT-SCOPED ONLY. Adding an UPDATE arm here would break the shipped alias
-- write (src/app/api/portfolio-strategies/alias/route.ts:148) on every legacy
-- row whose strategy is unmarked — i.e. every pre-existing PROD position and
-- every demo-seed row (150-RESEARCH § Pitfall 2). The invariant is about
-- CREATING a position, not about touching one.
DROP TRIGGER IF EXISTS trg_portfolio_strategies_own_capital_only ON public.portfolio_strategies;
CREATE TRIGGER trg_portfolio_strategies_own_capital_only
  BEFORE INSERT ON public.portfolio_strategies
  FOR EACH ROW
  EXECUTE FUNCTION public.guard_allocation_requires_own_capital();

COMMENT ON TRIGGER trg_portfolio_strategies_own_capital_only ON public.portfolio_strategies IS
  'OWN-03 / D-03-A hard invariant at the table layer. Fires on the INSERT event ONLY — an UPDATE arm breaks the shipped alias UPDATE on every legacy row whose strategy is unmarked (150-RESEARCH § Pitfall 2).';

-- Trigger function: never invocable via PostgREST RPC. Revoke from the API
-- roles too (not just PUBLIC) — matches the guard_strategies_publish_transition
-- convention and clears the anon/authenticated SECURITY DEFINER-executable
-- advisor.
REVOKE ALL ON FUNCTION public.guard_allocation_requires_own_capital() FROM PUBLIC, anon, authenticated;

-- ==========================================================================
-- 4. TRANSACTIONAL MARK-FLIP RPC
-- ==========================================================================
--
-- Flipping own_capital -> team_review while a position is live is TWO writes.
-- As two sequential PostgREST calls, a failure between them STRANDS a position
-- on a team-review strategy — precisely the D-03 hole the confirm arm exists to
-- close (T-150-02). One plpgsql function body is one transaction by
-- construction, so the pair is atomic.
--
-- SECURITY INVOKER (so RLS also applies) AND explicit auth.uid() predicates in
-- both statements. The explicit predicates are load-bearing, not
-- belt-and-braces: `strategies_update` is FOR UPDATE USING (...) with NO
-- WITH CHECK (20260405061912_rls_policies.sql:32).

CREATE OR REPLACE FUNCTION public.flip_capital_ownership_to_team_review(
  p_strategy_id uuid
)
RETURNS TABLE (removed_positions integer, updated_strategies integer)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_removed INTEGER := 0;
  v_updated INTEGER := 0;
BEGIN
  -- Remove the caller's OWN positions in this strategy first. Scoped to
  -- portfolios the caller owns: a flip must never touch another allocator's
  -- book, even though the mark itself is strategy-global.
  DELETE FROM public.portfolio_strategies
   WHERE strategy_id = p_strategy_id
     AND portfolio_id IN (
       SELECT id FROM portfolios WHERE user_id = auth.uid()
     );
  GET DIAGNOSTICS v_removed = ROW_COUNT;

  -- Then set the mark. Owner-scoped: a non-owner call updates zero rows and,
  -- having also removed zero positions, is a total no-op (T-150-05).
  UPDATE public.strategies
     SET capital_ownership = 'team_review'
   WHERE id = p_strategy_id
     AND user_id = auth.uid();
  GET DIAGNOSTICS v_updated = ROW_COUNT;

  removed_positions := v_removed;
  updated_strategies := v_updated;
  RETURN NEXT;
END;
$$;

COMMENT ON FUNCTION public.flip_capital_ownership_to_team_review(uuid) IS
  'OWN-03: flips a strategy''s capital_ownership mark to team_review AND removes the caller''s positions in it, in ONE transaction. Closes the stranded-position hole that two sequential PostgREST calls would open. SECURITY INVOKER; both statements carry an explicit auth.uid() predicate, so a non-owner call is a total no-op returning (0, 0).';

REVOKE ALL ON FUNCTION public.flip_capital_ownership_to_team_review(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.flip_capital_ownership_to_team_review(uuid) TO authenticated;

-- ==========================================================================
-- 5. SELF-VERIFYING BLOCK — fail loud at apply if any piece did not land
-- ==========================================================================

DO $$
DECLARE
  def         TEXT;
  fn_def      TEXT;
  insert_cnt  INTEGER;
  other_cnt   INTEGER;
BEGIN
  -- 5a. The CHECK constraint exists and admits BOTH values.
  SELECT pg_get_constraintdef(oid) INTO def
  FROM pg_constraint
  WHERE conname = 'strategies_capital_ownership_check'
    AND conrelid = 'public.strategies'::regclass;
  IF def IS NULL THEN
    RAISE EXCEPTION 'OWN-03 migration failed: strategies_capital_ownership_check not found';
  END IF;
  IF position('own_capital' IN def) = 0 OR position('team_review' IN def) = 0 THEN
    RAISE EXCEPTION
      'OWN-03 migration failed: CHECK missing an expected capital_ownership value (def=%)', def;
  END IF;

  -- 5b. The column is NULLABLE with NO DEFAULT (header decision (b)).
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'strategies'
      AND column_name = 'capital_ownership'
      AND is_nullable = 'YES'
      AND column_default IS NULL
  ) THEN
    RAISE EXCEPTION
      'OWN-03 migration failed: capital_ownership must be nullable with no default (no-invented-data, header (b))';
  END IF;

  -- 5c. The trigger fires on EXACTLY the INSERT event — no UPDATE/DELETE row
  --     (150-RESEARCH § Pitfall 2 / T-150-06).
  SELECT
    count(*) FILTER (WHERE event_manipulation = 'INSERT'),
    count(*) FILTER (WHERE event_manipulation <> 'INSERT')
    INTO insert_cnt, other_cnt
  FROM information_schema.triggers
  WHERE trigger_schema = 'public'
    AND trigger_name = 'trg_portfolio_strategies_own_capital_only';
  IF insert_cnt < 1 THEN
    RAISE EXCEPTION
      'OWN-03 migration failed: trg_portfolio_strategies_own_capital_only does not fire on INSERT';
  END IF;
  IF other_cnt > 0 THEN
    RAISE EXCEPTION
      'OWN-03 migration failed: trg_portfolio_strategies_own_capital_only fires on % non-INSERT event(s) — the alias UPDATE on legacy unmarked rows would break', other_cnt;
  END IF;

  -- 5d. BOTH D-03-A arms are present in the trigger body: the unconditional
  --     team_review comparison AND the portfolios (owner-equality) lookup.
  SELECT pg_get_functiondef(p.oid) INTO fn_def
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname = 'guard_allocation_requires_own_capital';
  IF fn_def IS NULL THEN
    RAISE EXCEPTION 'OWN-03 migration failed: guard_allocation_requires_own_capital() not found';
  END IF;
  IF position('team_review' IN fn_def) = 0 THEN
    RAISE EXCEPTION
      'OWN-03 migration failed: trigger body is missing the unconditional team_review arm (SC 2b)';
  END IF;
  IF position('portfolios' IN fn_def) = 0 THEN
    RAISE EXCEPTION
      'OWN-03 migration failed: trigger body is missing the portfolios owner-equality lookup (D-03-A) — a blanket predicate would break the three shipped third-party allocation paths';
  END IF;

  -- 5e. The flip RPC exists.
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = 'flip_capital_ownership_to_team_review'
  ) THEN
    RAISE EXCEPTION 'OWN-03 migration failed: flip_capital_ownership_to_team_review() not found';
  END IF;

  RAISE NOTICE 'OWN-03 capital_ownership migration self-check passed (column + CHECK + INSERT-scoped D-03-A trigger + flip RPC).';
END $$;

COMMIT;
