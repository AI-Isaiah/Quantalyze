-- Migration 20260821120000: get_verified_cohort_rank — add the RANK-01
-- computed-analytics cohort gate to BOTH cohort predicates.
-- Phase 159 / RANK-01 (milestone v1.20) — the SQL twin of the TS rank gate.
--
-- FULL-BODY RE-BASE of 20260626120000_get_verified_cohort_rank.sql (the ONLY
-- prior definition of this function — re-verified by a repo-wide grep of
-- supabase/migrations/ before this file was written). CREATE OR REPLACE
-- FUNCTION replaces the WHOLE body, so this file carries the entire original
-- body verbatim plus the one semantic change below. A partial/diff-style
-- re-base would silently DROP whichever guard it failed to restate — the
-- SECURITY DEFINER flag, the pinned search_path, the in-function auth guard,
-- the decile quantization, the identity strip, or v_min_n = 20.
--
-- ==========================================================================
-- THE ONE SEMANTIC CHANGE
-- ==========================================================================
-- Both cohort predicates — the count query (v_n) AND the rank query — gain:
--
--   AND a.computation_status IN ('complete', 'complete_with_warnings')
--
-- WHY: the cohort previously admitted any published+verified row whose three
-- rankable metrics were non-null. That is not the same thing as a row whose
-- computation SUCCEEDED. A failed computation can leave KPI values behind from
-- an earlier attempt, so the `IS NOT NULL` predicates cannot see the
-- difference. 159-CENSUS.md measured this against PROD on 2026-08-21: of 18
-- published strategies, 17 carried a `failed` analytics row that STILL held
-- BOTH sharpe and cagr. Dead numbers were ranking against live ones.
--
-- WHY BOTH PREDICATES, NOT ONE: this migration's own predecessor learned this
-- the hard way (see its "Nullable-metric exclusion (auditor MEDIUM)" note).
-- The count query is the min-N DENOMINATOR and the rank query is the
-- NUMERATOR population. Gating only one makes v_n count rows the percentiles
-- do not, which both understates every rank and under-enforces the min-N floor
-- — the exact defect class that fix closed. The two predicates must stay
-- character-identical; the DO block at the tail asserts both are present in
-- the deployed definition.
--
-- WHY A TWO-VALUE LIST: `complete_with_warnings` is a TERMINAL SUCCESS (a run
-- whose factsheet is valid but had a data-quality guard fire). A single-value
-- `= 'complete'` gate would silently unrank every warned-but-valid strategy —
-- the precise defect migration 20260707120000 closed elsewhere. The list
-- mirrors `isComputedAnalytics` in src/lib/closed-sets.ts member for member.
--
-- Parity-by-construction with the TS engine (D-03 lockstep)
-- ---------------------------------------------------------
-- This function's TS twin is `isRankableAnalyticsRow` (src/lib/closed-sets.ts),
-- the ONE gate both `getPercentiles` and `getOwnRowPercentiles` (src/lib/
-- queries.ts) apply before their own `< 5` floors. It delegates to
-- `isComputedAnalytics`, whose two-value semantics the list above reproduces
-- exactly. That is what keeps this migration's parity-by-construction claim a
-- TRUE sentence rather than an aspiration: change one side and you must change
-- the other. `src/lib/closed-sets.test.ts` pins the TS side across every member
-- of the status closed set; `supabase/tests/test_get_verified_cohort_rank_gate.sql`
-- pins this side on every CI run.
--
-- Expected visible effect (pre-decided, D-01 / C-D1)
-- --------------------------------------------------
-- 159-CENSUS.md Query 2 measured the RPC cohort at 3 before the gate and 1
-- after. The min-N floor is 20, so the floor was ALREADY unmet before this
-- change: the RPC returns the honest cohort_n with NULL percentiles today and
-- continues to afterwards. This migration crosses NO floor on this surface —
-- it is the one place in phase 159 where the census proves no visible change.
--
-- ==========================================================================
-- ORIGINAL HEADER (20260626120000), preserved — the rationale still governs
-- ==========================================================================
-- Phase 42 / PEER-03 (milestone v1.2.2) — the security backbone for the
-- Scenario composer's hypothetical-blend Peer-Percentile panel.
--
-- Why this function exists
-- ------------------------
-- ADR-0025 surfaces a Peer-Percentile on the Scenario composer's hypothetical
-- blend, ranked against the platform's REAL verified-strategy universe (not the
-- seed=42 demo cohort). That cohort cannot be read from a normal authed client:
--   * strategy_verifications RLS (migration 093 / 20260501055202) grants an
--     allocator SELECT only on THEIR OWN strategies' verification rows. A
--     cross-tenant verified aggregate is impossible under the tenant boundary.
--   * strategy_analytics RLS (analytics_read, migration 20260405061912) is also
--     owner/published-scoped.
-- The only safe construction is a privileged SECURITY DEFINER function that
-- returns ONLY an aggregated rank + cohort count — never any per-strategy id,
-- name, returns, or PII — suppressed below a min-N cell-size floor.
--
-- What this RPC returns (T-42-01 / T-42-02 mitigations)
-- -----------------------------------------------------
-- get_verified_cohort_rank(p_sharpe, p_sortino, p_max_dd) RETURNS TABLE
--   (cohort_n INT, sharpe_pct INT, sortino_pct INT, max_dd_pct INT)
-- — exactly four aggregate scalars. The body SELECTs ONLY count(*) /
-- count(*) FILTER aggregates; it NEVER selects or returns any strategy id /
-- name / daily_returns / metric value. The RETURNS TABLE is provably PII-free.
--
-- Cohort definition (D-02 locked, + the RANK-01 gate above)
-- ---------------------------------------------------------
-- Verified AND published strategies, restricted to rows whose three rankable
-- metrics are all non-null AND whose analytics computation reached a terminal
-- success. The explicit s.status = 'published' predicate is defense-in-depth:
-- the DEFINER fn runs as owner and bypasses RLS, so without it the caller's own
-- drafts/pending_review rows could pollute the cohort.
--
-- "Verified" = a strategy_verifications row at status='published' (the
-- verification state machine reached its terminal published state). NOT
-- `v.trust_tier IS NOT NULL`, which is a TAUTOLOGY — trust_tier is NOT NULL
-- (migration 093 CHECK), so that form matched EVERY verification row including
-- drafts.
--
-- Nullable-metric exclusion (auditor MEDIUM, original line 124/154 fix):
-- sharpe / sortino / max_drawdown are nullable DECIMAL. A NULL-metric row would
-- be counted in the v_n denominator yet excluded from every count(*) FILTER
-- (NULL <= x is UNKNOWN, not TRUE) — understating the rank AND under-enforcing
-- the min-N floor. Excluding NULL-metric rows from BOTH the count and the rank
-- query makes the denominator == the numerator population. The RANK-01 gate
-- above is added to BOTH predicates for exactly the same reason.
--
-- Min-N floor (T-42-02 — cell-size inference)
-- -------------------------------------------
-- v_min_n = 20. Below it the RPC returns a single row carrying the honest
-- cohort_n with the three percentiles NULL. With a thin cohort a percentile
-- would pin a near-individual rank (e.g. with n=3, "you beat exactly 2 of 3"
-- near-identifies a strategy).
--
-- Ranking convention (parity-by-construction with getPercentiles)
-- ---------------------------------------------------------------
-- sharpe / sortino are higher=better → percentile = % of cohort whose stored
-- value is <= the blend's. max_drawdown is stored NEGATIVE (quantstats
-- convention: -0.30 = 30% drop); the caller passes p_max_dd as the MAGNITUDE
-- (abs) of the blend's max_dd. getPercentiles counts cohort strategies whose
-- magnitude is <= the blend's then INVERTS via `100 - percentile`. The RPC
-- mirrors that EXACTLY (an earlier draft counted `>= p_max_dd` directly, which
-- diverges at ties/boundary because `>=` and `100 - (<=)` disagree on the
-- equality mass).
--
-- Probe-resistance (auditor HIGH — decile quantization):
-- the three percentiles are continuous in the caller's inputs, so without a
-- coarsening step an authed caller could binary-search an individual peer's
-- exact metric across repeated calls. DEFENCE-IN-DEPTH: the returned
-- percentiles are QUANTIZED to the nearest 10 — round(raw_pct / 10) * 10 — so
-- adjacent probe inputs collide into the same decile bucket. The LOAD-BEARING
-- probe-resistance controls are: (1) this decile quantization, and (2) the
-- strict route-layer rate-limit (withAuth + assertProfileApproved + checkLimit).
--
-- Hardening (T-42-03 — elevation of privilege)
-- --------------------------------------------
-- SECURITY DEFINER + SET search_path = public, pg_catalog (no search-path
-- hijack) + REVOKE ALL FROM PUBLIC, anon + GRANT EXECUTE TO authenticated,
-- service_role + an in-function auth.role()='anon' / auth.uid() IS NULL guard
-- raising SQLSTATE 42501.
--
-- Application path
-- ----------------
-- Supabase Migrate auto-applies this on merge to main (PROD) and the TEST
-- project receives it through the same pipeline. The self-verifying DO block at
-- the tail RAISEs EXCEPTION on any invariant failure, inside the transaction —
-- a failed assertion rolls the whole migration back rather than leaving a
-- half-gated function. No table or type DDL here (function body only), so
-- database.types.ts is unchanged.

BEGIN;

SET lock_timeout = '3s';

-- ==========================================================================
-- STEP 1: get_verified_cohort_rank SECURITY DEFINER RPC (full re-base)
-- ==========================================================================
CREATE OR REPLACE FUNCTION public.get_verified_cohort_rank(
  p_sharpe   DOUBLE PRECISION,
  p_sortino  DOUBLE PRECISION,
  p_max_dd   DOUBLE PRECISION   -- the MAGNITUDE (abs) of the blend's max_dd
)
RETURNS TABLE (
  cohort_n     INT,
  sharpe_pct   INT,
  sortino_pct  INT,
  max_dd_pct   INT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  -- Cell-size floor (T-42-02). Below this the cohort is too thin to rank a
  -- hypothetical without near-identifying an individual strategy.
  v_min_n CONSTANT INT := 20;
  v_n     INT;
BEGIN
  -- Caller-identity guard (T-42-03): the route layer (withAuth +
  -- assertProfileApproved) is the primary gate; this is defense-in-depth so
  -- the SECURITY DEFINER fn cannot be abused by an anon/unauthenticated
  -- session even though EXECUTE is also REVOKEd from anon below.
  IF auth.role() = 'anon' OR auth.uid() IS NULL THEN
    RAISE EXCEPTION 'get_verified_cohort_rank requires an authenticated session'
      USING ERRCODE = '42501';
  END IF;

  -- Cohort size = verified AND published strategies whose three rankable
  -- metrics are all non-null AND whose analytics computation reached a
  -- terminal success. The explicit status='published' predicate is
  -- defense-in-depth (D-02): the DEFINER fn bypasses RLS, so without it the
  -- caller's own drafts/pending_review rows could pollute the cohort.
  -- "Verified" = a strategy_verifications row at status='published' (terminal
  -- state). NOT `trust_tier IS NOT NULL` — that column is NOT NULL (migration
  -- 093 CHECK) so the IS NOT NULL form is a tautology matching every draft.
  --
  -- RANK-01 (phase 159): the terminal-success gate below is the SQL twin of
  -- isRankableAnalyticsRow / isComputedAnalytics in src/lib/closed-sets.ts. It
  -- MUST appear identically in the rank query further down — this is the
  -- denominator, that is the numerator, and a gate on only one of them makes
  -- min-N count rows the percentiles do not. A status gate is required because
  -- a failed computation can retain KPI values, so the IS NOT NULL predicates
  -- alone admit dead rows (159-CENSUS.md: 17 of 18 published PROD strategies).
  SELECT count(*) INTO v_n
  FROM strategies s
  JOIN strategy_analytics a ON a.strategy_id = s.id
  WHERE s.status = 'published'
    AND a.computation_status IN ('complete', 'complete_with_warnings')
    AND a.sharpe IS NOT NULL
    AND a.sortino IS NOT NULL
    AND a.max_drawdown IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM strategy_verifications v
      WHERE v.strategy_id = s.id AND v.status = 'published'
    );

  -- Min-N gate (T-42-02): below the floor, return a single honest-empty row
  -- carrying the real cohort_n but NULL percentiles. Never rank against a
  -- thin/illustrative set — prevents cell-size inference.
  IF v_n < v_min_n THEN
    RETURN QUERY SELECT v_n, NULL::INT, NULL::INT, NULL::INT;
    RETURN;
  END IF;

  -- Rank = % of cohort whose value is <= the blend's, for sharpe/sortino
  -- (higher=better). For max_dd MIRROR getPercentiles EXACTLY: count cohort
  -- strategies whose magnitude is <= the blend's (abs(a.max_drawdown) <=
  -- p_max_dd) then invert via `100 - that`. This is parity-by-construction at
  -- ties/boundary, unlike a direct `>=` count.
  --
  -- DECILE QUANTIZATION (probe-resistance, auditor HIGH): each raw percentile
  -- is coarsened to the nearest 10 — round(raw_pct / 10) * 10 — applied AFTER
  -- the max_dd `100 - (<=)` inversion. Adjacent probe inputs collide into one
  -- decile bucket, so a single percentile step reveals only a 10-point bucket,
  -- never an individual peer's value. This + the plan 42-02 route rate-limit
  -- are the load-bearing probe-resistance controls (see header).
  --
  -- IDENTITY STRIP (T-42-01): every projected expression below is an
  -- aggregate (v_n is the count from above; the three columns are
  -- count(*) FILTER ratios). No strategy id / name / returns / metric value
  -- ever appears in the SELECT list or the RETURNS TABLE.
  --
  -- RANK-01: this WHERE clause is character-identical to the count query's
  -- above, INCLUDING the terminal-success gate. They are one cohort definition
  -- written twice; keep them in lockstep.
  RETURN QUERY
  SELECT
    v_n,
    (round( round(100.0 * count(*) FILTER (WHERE a.sharpe  <= p_sharpe)  / v_n) / 10.0 ) * 10)::INT,
    (round( round(100.0 * count(*) FILTER (WHERE a.sortino <= p_sortino) / v_n) / 10.0 ) * 10)::INT,
    (round( (100 - round(100.0 * count(*) FILTER (WHERE abs(a.max_drawdown) <= p_max_dd) / v_n)) / 10.0 ) * 10)::INT
  FROM strategies s
  JOIN strategy_analytics a ON a.strategy_id = s.id
  WHERE s.status = 'published'
    AND a.computation_status IN ('complete', 'complete_with_warnings')
    AND a.sharpe IS NOT NULL
    AND a.sortino IS NOT NULL
    AND a.max_drawdown IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM strategy_verifications v
      WHERE v.strategy_id = s.id AND v.status = 'published'
    );
END;
$$;

-- ==========================================================================
-- STEP 2: REVOKE / GRANT EXECUTE (unchanged posture, restated in full)
-- ==========================================================================
-- CREATE OR REPLACE preserves existing ACLs, but these are restated verbatim so
-- the file is a complete, self-contained definition of the function's posture:
-- PUBLIC and anon get nothing; authenticated callers (the Next.js route under
-- withAuth) get EXECUTE; service_role also gets EXECUTE so worker / integration
-- tooling can call it on behalf of a user.
REVOKE ALL ON FUNCTION public.get_verified_cohort_rank(DOUBLE PRECISION, DOUBLE PRECISION, DOUBLE PRECISION) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_verified_cohort_rank(DOUBLE PRECISION, DOUBLE PRECISION, DOUBLE PRECISION) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_verified_cohort_rank(DOUBLE PRECISION, DOUBLE PRECISION, DOUBLE PRECISION) TO service_role;

COMMENT ON FUNCTION public.get_verified_cohort_rank IS
  'Phase 42 / PEER-03 (v1.2.2), re-based by phase 159 / RANK-01 (v1.20): aggregate-only rank of a hypothetical blend''s Sharpe/Sortino/max_dd against the REAL verified+published strategy universe. Cohort = strategies.status=''published'' AND a strategy_verifications row at status=''published'' (the terminal verified state — NOT trust_tier IS NOT NULL, which is a tautology since trust_tier is NOT NULL) AND all three rankable metrics non-null AND strategy_analytics.computation_status in the two-value terminal-success set. RANK-01: that computation gate is the SQL twin of isRankableAnalyticsRow -> isComputedAnalytics in src/lib/closed-sets.ts, the ONE helper getPercentiles and getOwnRowPercentiles both apply — the two-value list mirrors it member for member, which is what makes this parity-by-construction rather than a coincidence; a single-value ''complete'' gate here would unrank every warned-but-valid strategy. The gate sits in BOTH the count query and the rank query so the min-N denominator cannot diverge from the rank numerator (the same reason the nullable-metric exclusion is in both). It exists because a failed computation can RETAIN KPI values, so the IS NOT NULL predicates alone admitted dead rows — 159-CENSUS.md measured 17 of 18 published PROD strategies in exactly that state. Returns ONLY (cohort_n, sharpe_pct, sortino_pct, max_dd_pct) — never any per-strategy id/name/returns/PII. Percentiles are DECILE-QUANTIZED (nearest 10) for probe-resistance — that quantization plus the route rate-limit are the load-bearing controls against a per-peer binary-search probe oracle. Suppressed below min-N=20 (returns the cohort_n with NULL percentiles) to prevent cell-size inference. max_dd mirrors getPercentiles'' direction exactly (count abs<=p_max_dd then 100-that, before quantization). SECURITY DEFINER because strategy_verifications RLS (migration 093) forbids the cross-tenant verified read from an authed client. p_max_dd is the MAGNITUDE (abs) of the blend''s max_dd; max_drawdown is stored negative.';

-- ==========================================================================
-- STEP 3: Self-verifying DO block
-- ==========================================================================
-- Each RAISE EXCEPTION names the migration so apply-time failures are
-- unambiguous. The migration is wrapped in BEGIN ... COMMIT; if any assertion
-- fires the whole transaction rolls back — no partial migration state.
--
-- Assertions (a)-(d) are inherited from 20260626120000 and re-run here because
-- a re-base is exactly when a guard can go missing. (e) is new: it reads the
-- DEPLOYED definition back and proves the RANK-01 gate is really in BOTH
-- cohort queries — the assertion that makes this migration self-verifying
-- rather than merely well-intentioned.
DO $$
DECLARE
  v_fn_oid     OID;
  v_secdef     BOOLEAN;
  v_pub_exec   BOOLEAN;
  v_anon_exec  BOOLEAN;
  v_auth_exec  BOOLEAN;
  v_def        TEXT;
  v_gate_hits  INT;
  v_config     TEXT[];
  -- The gate predicate as it must appear in the deployed body. Dollar-quoted so
  -- the single quotes need no escaping and the literal stays byte-comparable to
  -- the source above. Deliberately the FULL predicate, not the bare status
  -- value: a loose word match would also count this file's own prose.
  v_gate_pred  CONSTANT TEXT :=
    $pred$a.computation_status IN ('complete', 'complete_with_warnings')$pred$;
BEGIN
  -- (a) the function is registered under public with the 3-arg signature
  SELECT p.oid INTO v_fn_oid
    FROM pg_proc p
    WHERE p.proname = 'get_verified_cohort_rank'
      AND p.pronamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'public')
      AND pg_get_function_identity_arguments(p.oid) =
          'p_sharpe double precision, p_sortino double precision, p_max_dd double precision';
  IF v_fn_oid IS NULL THEN
    RAISE EXCEPTION 'Migration 20260821120000 failed: get_verified_cohort_rank(double precision, double precision, double precision) not registered';
  END IF;

  -- (b) it is SECURITY DEFINER (pg_proc.prosecdef = true)
  SELECT prosecdef INTO v_secdef FROM pg_proc WHERE oid = v_fn_oid;
  IF NOT COALESCE(v_secdef, false) THEN
    RAISE EXCEPTION 'Migration 20260821120000 failed: get_verified_cohort_rank is not SECURITY DEFINER — the re-base dropped the flag';
  END IF;

  -- (c) EXECUTE is NOT granted to PUBLIC and NOT to anon
  v_pub_exec  := has_function_privilege('public', v_fn_oid, 'EXECUTE');
  v_anon_exec := has_function_privilege('anon',   v_fn_oid, 'EXECUTE');
  IF v_pub_exec THEN
    RAISE EXCEPTION 'Migration 20260821120000 failed: EXECUTE still granted to PUBLIC';
  END IF;
  IF v_anon_exec THEN
    RAISE EXCEPTION 'Migration 20260821120000 failed: EXECUTE still granted to anon';
  END IF;

  -- (d) EXECUTE IS granted to authenticated (the route caller)
  v_auth_exec := has_function_privilege('authenticated', v_fn_oid, 'EXECUTE');
  IF NOT v_auth_exec THEN
    RAISE EXCEPTION 'Migration 20260821120000 failed: EXECUTE not granted to authenticated';
  END IF;

  -- (e) RANK-01: the gate predicate is present in the DEPLOYED body, TWICE —
  -- once in the count query (the min-N denominator) and once in the rank query
  -- (the numerator). Counting occurrences (not merely testing presence) is the
  -- point: a re-base that gated only the count query would keep a presence
  -- check green while silently reintroducing the denominator/numerator
  -- divergence this migration exists to prevent.
  v_def := pg_get_functiondef(v_fn_oid);
  v_gate_hits := (length(v_def) - length(replace(v_def, v_gate_pred, '')))
                 / length(v_gate_pred);
  IF v_gate_hits < 2 THEN
    RAISE EXCEPTION 'Migration 20260821120000 failed: the RANK-01 computed-analytics gate appears % time(s) in the deployed body, expected 2 (count query AND rank query). A gate on only one predicate makes the min-N denominator diverge from the rank population.', v_gate_hits;
  END IF;

  -- (f) the search_path pin survived the re-base (SECURITY DEFINER without it
  -- is a search-path hijack surface, T-42-03).
  SELECT proconfig INTO v_config FROM pg_proc WHERE oid = v_fn_oid;
  IF v_config IS NULL OR NOT (v_config @> ARRAY['search_path=public, pg_catalog']) THEN
    RAISE EXCEPTION 'Migration 20260821120000 failed: get_verified_cohort_rank lost its pinned search_path (proconfig=%)', v_config;
  END IF;

  -- (g) the min-N floor and the auth guard survived the re-base. Both are
  -- single lines in a long body — exactly what a careless re-base drops.
  IF position('v_min_n CONSTANT INT := 20' IN v_def) = 0 THEN
    RAISE EXCEPTION 'Migration 20260821120000 failed: the min-N=20 cell-size floor is missing from the deployed body';
  END IF;
  IF position('42501' IN v_def) = 0 THEN
    RAISE EXCEPTION 'Migration 20260821120000 failed: the in-function anon/auth guard (SQLSTATE 42501) is missing from the deployed body';
  END IF;

  RAISE NOTICE 'Migration 20260821120000: all assertions passed (RANK-01 gate present in both cohort predicates, SECURITY DEFINER + search_path pinned, min-N=20 and auth guard intact, EXECUTE revoked from PUBLIC/anon and granted to authenticated).';
END
$$;

COMMIT;

-- ==========================================================================
-- END OF MIGRATION 20260821120000
-- ==========================================================================
-- Summary:
--   Step 1 — full-body re-base of get_verified_cohort_rank adding the RANK-01
--            terminal-success gate to BOTH cohort predicates; every prior
--            guard (SECURITY DEFINER, search_path pin, auth guard, min-N=20,
--            decile quantization, identity strip, max_dd direction) preserved
--            verbatim
--   Step 2 — REVOKE/GRANT posture restated; COMMENT ON FUNCTION updated to name
--            the TS twin so the parity-by-construction claim stays true
--   Step 3 — self-verifying DO block: (a)-(d) inherited, plus (e) the gate
--            appears TWICE in the deployed body, (f) search_path still pinned,
--            (g) min-N floor and auth guard still present
--
-- Recurring gate
-- --------------
-- A migration DO block runs ONCE. The recurring CI gate for this function is
-- supabase/tests/test_get_verified_cohort_rank_gate.sql (added in the same
-- plan) — the RPC's first CI-executed test.
