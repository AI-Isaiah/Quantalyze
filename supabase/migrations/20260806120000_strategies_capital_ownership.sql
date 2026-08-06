-- OWN-03 (Phase 150, Plan 01) — the persistent capital-ownership mark on
-- `strategies`, the D-03-A allocation invariant enforced at the TABLE layer on
-- BOTH the INSERT and the mark-transition side, and the transactional mark-flip
-- RPC.
-- 2026-08-06.
--
-- rev-2 (2026-08-06, migration review): this file is amended IN PLACE — it has
-- never been merged, so PROD has never seen it, and every object in it is
-- written re-runnably (DROP-then-ADD / CREATE OR REPLACE) precisely so it can be
-- re-applied to TEST. Three findings closed:
--   F1  the flip RPC's DELETE ran BEFORE any ownership check, so a NON-OWNER
--       call deleted the CALLER's own position in the target strategy and
--       returned (1, 0) — the opposite of the "total no-op" its own comment
--       claimed. Fixed with an owner precheck (part 4).
--   F2  SC 2b was INSERT-only: a raw PostgREST PATCH of capital_ownership to
--       'team_review', which `strategies_update` permits the owner outright,
--       stranded every live position — the exact hole the flip RPC exists to
--       close, reachable without ever calling it. Fixed with a second,
--       UPDATE-scoped guard (part 3b, header (d.3)).
--   F3  the accepted narrowing of "NEVER allocatable" is now stated where a
--       reader will find it (header (g), column COMMENT) instead of being
--       implied by two DELETE predicates.
--
-- Re-base check (MEMORY `project_cross_cutting_refactor_program`): grepped ALL
-- of supabase/migrations, src/ and analytics-service/ for `capital_ownership`,
-- `own_capital`, `team_review`, `guard_allocation_requires_own_capital`,
-- `guard_team_review_mark_no_stranded_positions` and
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
--   'team_review' -> never NEWLY allocatable, under any ownership (the exact
--                    strength of that claim at the data layer is (g)). Renders
--                    the muted tag.
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
-- (d.3) THE MARK-TRANSITION GUARD — WHY SC 2b NEEDS A SECOND TRIGGER
--       (rev-2, migration review finding F2).
-- --------------------------------------------------------------------
-- The D-03-A trigger above is INSERT-scoped, so it only ever sees a position
-- being CREATED. It is blind to the OTHER way into the same stranded state: the
-- owner UPDATEing `strategies.capital_ownership` to 'team_review' while their
-- own position is already live. `strategies_update USING (user_id = auth.uid())`
-- permits exactly that write from a raw PostgREST PATCH — no route, no RPC,
-- nothing to intercept it — and the result is a live position on a team-review
-- strategy: the precise hole part 4's flip RPC exists to close. An invariant
-- that only holds when callers volunteer to use the RPC is not an invariant, it
-- is a convention. So the TRANSITION is guarded at the table layer too.
--
-- `trg_strategies_team_review_mark_guard` is BEFORE UPDATE OF capital_ownership
-- and RAISEs check_violation when the mark ENTERS 'team_review' (OLD IS
-- DISTINCT FROM 'team_review') while an OWNER-SCOPED position exists.
--
-- ORDERING PROOF — LOAD-BEARING, DO NOT REORDER PART 4's TWO STATEMENTS.
-- The flip RPC DELETEs the caller's positions FIRST and only then UPDATEs the
-- mark. Both are scoped to the same set of rows this guard counts (positions in
-- portfolios owned by the strategy's owner; after part 4's owner precheck,
-- auth.uid() IS that owner). So by the time the RPC's UPDATE fires this guard,
-- the owner-scoped count is already 0 and the guard admits it. Swap the two
-- statements and the sanctioned path becomes unrunnable — pinned by guard-test
-- case 7a, which must stay green.
--
-- SCOPE IS OWNER-SCOPED, DELIBERATELY — the SAME scope the RPC deletes. A
-- THIRD-PARTY position does not block the owner's flip, because a flip must
-- never be held hostage by (nor touch) another allocator's book. See (g).
--
-- COLUMN-TARGETED (`UPDATE OF capital_ownership`) so every other UPDATE on
-- `strategies` — rename, publish transition, metrics refresh — never evaluates
-- it at all. NULL-safe: a transition to NULL or to 'own_capital' is not a
-- transition INTO 'team_review' and passes untouched (the retro Mark path and
-- the guard test's own un-mark seed step both depend on that).
--
-- SECURITY DEFINER for the same reason as (d.2): the guard must count the
-- TRUTH. Under INVOKER the count is RLS-filtered by the updating session, so
-- any future admin or service path that marks a strategy from a context that
-- cannot see the owner's portfolios would read zero positions and strand them.
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
-- (g) ACCEPTED NARROWING — 'team_review' MEANS "NEVER *NEWLY* ALLOCATABLE"
--     (rev-2, migration review finding F3).
-- -------------------------------------------------------------------------
-- After a sanctioned flip, THIRD-PARTY positions in the now-team_review
-- strategy SURVIVE by design: part 4's DELETE is scoped to the caller's own
-- portfolios, and (d.3)'s count is scoped to the owner's. So the guarantee this
-- migration actually makes at the data layer is:
--   * no INSERT can create a position from a team_review strategy, for ANYONE
--     (D-03-A arm 1, unconditional); and
--   * the owner cannot strand their OWN book by marking a strategy while a
--     position is live (d.3);
-- it is NOT "zero portfolio_strategies rows referencing it can exist". A row
-- another allocator created BEFORE the flip is retained.
--
-- This narrowing is deliberate, not an oversight. The alternative — deleting
-- every position in the strategy — is a CROSS-TENANT DELETE in which one
-- allocator's private bookkeeping decision silently rewrites a different
-- allocator's portfolio, with no notice and no consent. That is a strictly
-- worse failure than a stale third-party position, which the third party can
-- see and remove themselves. Do NOT "fix" this into a global delete; it is
-- pinned by guard-test case 7e.
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
  'OWN-03 capital-ownership mark, STRATEGY-level (D-04). NULL = never asked: renders no tag, and is NON-ALLOCATABLE for a self-owned strategy — the remedy is the retro Mark dialog on /my-strategies (D-09/D-11), never a backfill. ''own_capital'' = the allocator''s own capital, allocatable. ''team_review'' = a trading team''s key under verification: never NEWLY allocatable by anyone (SC 2b) — no INSERT can mint a position from it, and the owner cannot mark one while their own position is live. Pre-existing THIRD-PARTY positions are RETAINED: a flip never touches another allocator''s book (see the migration header (g) for why that narrowing is accepted rather than closed with a cross-tenant delete). Deliberately nullable with no default: defaulting would fabricate a claim about pre-existing strategies.';

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
-- 3b. MARK-TRANSITION GUARD — the other half of SC 2b (header (d.3))
-- ==========================================================================
--
-- Part 3 guards the INSERT. This guards the UPDATE that reaches the identical
-- stranded state from the other side: a raw PostgREST PATCH of
-- capital_ownership to 'team_review' while the owner's position is live, which
-- `strategies_update USING (user_id = auth.uid())` permits outright. Without
-- this trigger, part 4's RPC is a convention rather than an invariant.

CREATE OR REPLACE FUNCTION public.guard_team_review_mark_no_stranded_positions()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_positions INTEGER;
BEGIN
  -- Only the TRANSITION INTO 'team_review' is guarded. IS [NOT] DISTINCT FROM
  -- rather than `=` so a mark of NULL (the retro un-mark path, and this
  -- migration's own guard-test seed step) is unambiguously not a match rather
  -- than a NULL that happens to fall through the IF.
  IF NEW.capital_ownership IS NOT DISTINCT FROM 'team_review'
     AND OLD.capital_ownership IS DISTINCT FROM 'team_review' THEN

    -- OWNER-SCOPED, and this scope is load-bearing twice over (header (d.3)):
    --   * it is EXACTLY the set part 4's RPC deletes, and the RPC deletes
    --     BEFORE it updates — so by the time the sanctioned path reaches this
    --     guard the count is 0 and the flip is admitted; and
    --   * a THIRD-PARTY position therefore does not block an owner's flip,
    --     which is the accepted narrowing in header (g). Widening this count to
    --     every position in the strategy would make a flip impossible whenever
    --     anyone else holds it — hostage-taking by an unrelated allocator.
    -- SECURITY DEFINER (header (d.3)) so this count is not RLS-filtered by the
    -- updating session. Unqualified names are deterministic: search_path is
    -- pinned on the function above.
    SELECT count(*)
      INTO v_positions
      FROM portfolio_strategies ps
      JOIN portfolios p ON p.id = ps.portfolio_id
     WHERE ps.strategy_id = NEW.id
       AND p.user_id = NEW.user_id;

    IF v_positions > 0 THEN
      RAISE EXCEPTION
        'strategy % cannot be marked team_review: % of the owner''s position(s) are still live',
        NEW.id, v_positions
        USING ERRCODE = 'check_violation',
              HINT = 'Use flip_capital_ownership_to_team_review(strategy_id), which removes your positions and sets the mark in ONE transaction.';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.guard_team_review_mark_no_stranded_positions() IS
  'OWN-03 / SC 2b, UPDATE side: blocks a transition of strategies.capital_ownership INTO ''team_review'' while a position owned by the strategy''s owner is live, closing the raw-PostgREST-PATCH route into a stranded position that the INSERT-scoped D-03-A trigger cannot see. Owner-scoped ON PURPOSE — it is the same set flip_capital_ownership_to_team_review() deletes FIRST, so the sanctioned RPC still passes, and a third-party position never holds an owner''s flip hostage (migration header (g)). SECURITY DEFINER so the count is not RLS-filtered by the updating session.';

-- COLUMN-TARGETED AND UPDATE-SCOPED. `OF capital_ownership` keeps every other
-- write to `strategies` — rename, publish transition, metrics refresh — from
-- ever evaluating this function. An INSERT arm would be wrong as well as
-- useless: a brand-new strategy cannot have a position (the FK forbids it), and
-- the wizard legitimately CREATES rows already marked team_review.
DROP TRIGGER IF EXISTS trg_strategies_team_review_mark_guard ON public.strategies;
CREATE TRIGGER trg_strategies_team_review_mark_guard
  BEFORE UPDATE OF capital_ownership ON public.strategies
  FOR EACH ROW
  EXECUTE FUNCTION public.guard_team_review_mark_no_stranded_positions();

COMMENT ON TRIGGER trg_strategies_team_review_mark_guard ON public.strategies IS
  'OWN-03 / SC 2b UPDATE side. Fires on UPDATE OF capital_ownership ONLY. Without it, an owner''s raw PostgREST PATCH to team_review strands every live position — the exact hole flip_capital_ownership_to_team_review() exists to close, reachable without ever calling it.';

REVOKE ALL ON FUNCTION public.guard_team_review_mark_no_stranded_positions() FROM PUBLIC, anon, authenticated;

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
  v_owner   UUID;
BEGIN
  -- OWNER PRECHECK — MUST COME BEFORE THE DELETE (rev-2, review finding F1).
  -- Without it, a NON-OWNER call is not a no-op at all: the DELETE below is
  -- scoped to the CALLER's portfolios, so caller B invoking flip() on owner A's
  -- strategy DELETES B's own position in it while the UPDATE no-ops — returning
  -- (1, 0) and silently destroying a position B never asked to remove. The
  -- auth.uid() predicates on the two statements make the flip safe for the
  -- VICTIM; they do nothing for the caller. Only this precheck makes the
  -- documented "total no-op returning (0, 0)" contract true.
  --
  -- SECURITY INVOKER + RLS is fine here: `strategies_read` is
  -- `status='published' OR user_id=auth.uid()`, so a caller can ALWAYS read
  -- their OWN strategy — an owner's precheck read never returns NULL. A
  -- non-owner reading a private strategy gets NULL, which lands on the same
  -- no-op arm as reading someone else's user_id. Both outcomes are correct.
  SELECT user_id INTO v_owner FROM public.strategies WHERE id = p_strategy_id;
  IF v_owner IS NULL OR v_owner IS DISTINCT FROM auth.uid() THEN
    removed_positions := 0;
    updated_strategies := 0;
    RETURN NEXT;
    RETURN;
  END IF;

  -- Remove the caller's OWN positions in this strategy first. Scoped to
  -- portfolios the caller owns: a flip must never touch another allocator's
  -- book, even though the mark itself is strategy-global (header (g)).
  --
  -- DELETE-BEFORE-UPDATE IS LOAD-BEARING, NOT STYLE: the mark-transition guard
  -- (part 3b) refuses an UPDATE into 'team_review' while an owner-scoped
  -- position is live. The precheck above has established auth.uid() = the
  -- strategy's owner, so this DELETE clears exactly the set that guard counts.
  -- Reorder these two statements and the sanctioned path starts raising 23514
  -- against itself.
  DELETE FROM public.portfolio_strategies
   WHERE strategy_id = p_strategy_id
     AND portfolio_id IN (
       SELECT id FROM portfolios WHERE user_id = auth.uid()
     );
  GET DIAGNOSTICS v_removed = ROW_COUNT;

  -- Then set the mark. The auth.uid() predicate is retained as defence in depth
  -- even though the precheck already established ownership — it is what keeps
  -- the statement correct on its own terms if this function is ever made
  -- SECURITY DEFINER or called from a service-role context, where RLS stops
  -- helping (guard-test case 7c pins all three occurrences).
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
  'OWN-03: flips a strategy''s capital_ownership mark to team_review AND removes the OWNER''s positions in it, in ONE transaction. Closes the stranded-position hole that two sequential PostgREST calls would open. SECURITY INVOKER. A non-owner call is a total no-op returning (0, 0) BECAUSE OF THE OWNER PRECHECK, not because of the statements'' auth.uid() predicates — those are scoped to the CALLER, so without the precheck a non-owner call would delete the CALLER''s own position in the target strategy and return (1, 0). Third-party positions are never touched (migration header (g)); the DELETE runs before the UPDATE so the part-3b mark-transition guard admits the sanctioned flip.';

REVOKE ALL ON FUNCTION public.flip_capital_ownership_to_team_review(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.flip_capital_ownership_to_team_review(uuid) TO authenticated;

-- ==========================================================================
-- 5. SELF-VERIFYING BLOCK — fail loud at apply if any piece did not land
-- ==========================================================================

DO $$
DECLARE
  def         TEXT;
  fn_def      TEXT;
  flip_def    TEXT;
  insert_cnt  INTEGER;
  other_cnt   INTEGER;
  update_cnt  INTEGER;
  col_cnt     INTEGER;
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

  -- 5e. The flip RPC exists, carries the OWNER PRECHECK, and still DELETEs
  --     BEFORE it UPDATEs. Both properties are load-bearing (header (d.3) and
  --     the F1 finding): without the precheck a non-owner call deletes the
  --     CALLER's own position; with the statements reordered the RPC raises
  --     23514 against the part-3b guard it was built to satisfy.
  SELECT pg_get_functiondef(p.oid) INTO flip_def
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname = 'flip_capital_ownership_to_team_review';
  IF flip_def IS NULL THEN
    RAISE EXCEPTION 'OWN-03 migration failed: flip_capital_ownership_to_team_review() not found';
  END IF;
  IF position('SELECT user_id INTO v_owner' IN flip_def) = 0 THEN
    RAISE EXCEPTION
      'OWN-03 migration failed: flip_capital_ownership_to_team_review() lost its owner precheck — a non-owner call would DELETE the caller''s own position in the target strategy and return (1, 0)';
  END IF;
  IF position('DELETE FROM public.portfolio_strategies' IN flip_def) = 0
     OR position('UPDATE public.strategies' IN flip_def) = 0
     OR position('DELETE FROM public.portfolio_strategies' IN flip_def)
        > position('UPDATE public.strategies' IN flip_def) THEN
    RAISE EXCEPTION
      'OWN-03 migration failed: flip_capital_ownership_to_team_review() must DELETE the owner''s positions BEFORE it UPDATEs the mark, or trg_strategies_team_review_mark_guard rejects the sanctioned flip';
  END IF;

  -- 5f. The mark-transition guard (part 3b) fires on EXACTLY the UPDATE event
  --     and is COLUMN-TARGETED on capital_ownership. A widened event list or a
  --     lost column target would make every write to `strategies` pay for this
  --     guard; a missing trigger reopens the raw-PATCH stranding hole (F2).
  SELECT
    count(*) FILTER (WHERE event_manipulation = 'UPDATE'),
    count(*) FILTER (WHERE event_manipulation <> 'UPDATE')
    INTO update_cnt, other_cnt
  FROM information_schema.triggers
  WHERE trigger_schema = 'public'
    AND trigger_name = 'trg_strategies_team_review_mark_guard';
  IF update_cnt < 1 THEN
    RAISE EXCEPTION
      'OWN-03 migration failed: trg_strategies_team_review_mark_guard does not fire on UPDATE — a raw PostgREST PATCH of capital_ownership to team_review would strand every live position';
  END IF;
  IF other_cnt > 0 THEN
    RAISE EXCEPTION
      'OWN-03 migration failed: trg_strategies_team_review_mark_guard fires on % non-UPDATE event(s)', other_cnt;
  END IF;

  SELECT count(*) INTO col_cnt
  FROM information_schema.triggered_update_columns
  WHERE trigger_schema = 'public'
    AND trigger_name = 'trg_strategies_team_review_mark_guard'
    AND event_object_column = 'capital_ownership';
  IF col_cnt <> 1 THEN
    RAISE EXCEPTION
      'OWN-03 migration failed: trg_strategies_team_review_mark_guard is not column-targeted on capital_ownership (matched % column(s)) — every rename, publish and metrics UPDATE on strategies would evaluate it', col_cnt;
  END IF;

  RAISE NOTICE 'OWN-03 capital_ownership migration self-check passed (column + CHECK + INSERT-scoped D-03-A trigger + UPDATE-scoped mark-transition guard + flip RPC with owner precheck and DELETE-before-UPDATE order).';
END $$;

COMMIT;
