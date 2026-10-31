-- Test: public.compute_bridge_outcome_deltas() holding branch measured on the account's
-- derived equity (Phase 176 LEGACYRETIRE, plan 02). Guards migration
-- 20261102120000_bridge_outcome_holding_branch_derived.sql.
--
-- Background
-- ----------
-- D-03 (founder 2026-10-31): a bridge outcome is measured on the ACCOUNT's derived
-- equity, no longer on one symbol's value read from the legacy per-day snapshots.
-- D-05: the +30, +90 and +180 day outcome compounds the flow-neutral daily returns of
-- the allocator's allocator_equity_derived row of kind equity_curve over the days
-- (allocated_at, allocated_at + N], so a deposit or withdrawal is never performance, and
-- a day the curve does not cover gives NULL. D-06: every stored holding outcome is reset
-- once so the next 03:00Z run recomputes it on this basis.
--
-- Arms (LISTED and EXECUTED in this order; the order is LOAD-BEARING because each twin's
-- FIRST `TEST FAILED (N)` must name its own arm, so an arm can only depend on arms listed
-- before it; every arm seeds its own allocator and reads only its own outcome ids):
--   B1  a fresh holding outcome whose allocator has a trustworthy version-2 derived row
--       with r = 0.01 on every day gets delta_30d / 90d / 180d equal to power(1.01, N) - 1
--       (the oracle is power(), independent of the helper's log-sum), deltas_computed_at
--       is set and needs_recompute is FALSE.
--   B2  flow neutral (D-05): a deposit that doubles the dollar curve on day 5 while r = 0
--       that day leaves the outcome at the compounded r, never at a ratio of dollar levels.
--   B3  a day with no returns entry is no change, and the outcome is NULL only when the
--       curve does not COVER the window (fix round 1; D-05 as first written said a missing
--       day gives NULL, and PROD curves omit about 23% of their days under benign flags).
--       3: day 45 absent, all three windows measured, over the days that ARE present. 3b: the
--       curve ends at day 100, so the 180-day window is NULL. 3c: the curve starts at day
--       11, so every window is NULL. 3d: a day with r = -1 compounds to -1, not NULL.
--   B4  an untrustworthy row (4a: is_trustworthy false) and a version-1 row (4b) each give
--       NULL deltas.
--   B5  a malformed payload never aborts the batch: returns is not an array (5a, NULL), an
--       r that is a string (5b, NULL), a date text that is not a real day (5c, that day is
--       an absent day: no change), an r so large the compounded product leaves numeric
--       range (5d, NULL). A sound row in the SAME batch call still gets its values. Fix round 2
--       (founder "At least one day"; only YYYY-MM-DD dates count toward coverage), listed after
--       5d so the 5c twin, which casts dates, is reached by its own arm first: 5e, every
--       returns date carries a time suffix, so nothing matches and nothing is well-formed:
--       all NULL; 5f, a stray malformed date entry on a 40-day curve cannot extend coverage
--       past day 40; 5g, a curve whose well-formed returns bracket the windows but hold
--       nothing inside them is NULL, not 0%.
--   B6  the strategy branch (6a, a bridge_recommended outcome with an original strategy)
--       and the voluntary_add branch (6b) still get their extract_delta values: the
--       branches the holding re-base did not touch (apart from the allocated_at window, arm G2) are not broken by it.
--   G1  the allocated_at CHECK window: a holding row aged past 365 days, with NULL deltas,
--       is not a candidate. The batch completes (no 23514) and leaves it unchanged. On the
--       base body the same call raises 23514 and aborts the whole statement.
--   G2  the same window for the STRATEGY branch (2) and the VOLUNTARY_ADD branch (2b), which
--       carried the same latent abort before fix round 1 (TODOS 176-BRIDGE-CHECK-WINDOW-ABORT).
--   H1  a holding row whose three new deltas are all NULL is not stamped computed
--       (needs_recompute stays TRUE, deltas_computed_at stays NULL) and is not counted in
--       updated_count (1); it is counted in failed_count (1b).
--   W1  a holding row keeps being picked until every matured window is filled: +30d lands
--       in run 1 with the curve covering 30 days, and run 2, with the curve now covering 90
--       days (1) or 180 days (1b), fills delta_90d / delta_180d. Fix round 2: a stored delta is
--       kept (1c: the curve is restated between the runs, delta_30d stays, delta_90d fills),
--       and a row picked again with nothing new to fill is not written or counted (1d).
--   R1  D-06: a holding row with stale non-null deltas and needs_recompute FALSE has all
--       three deltas and deltas_computed_at NULLed and needs_recompute TRUE by the reset,
--       the returned count includes it, and the next batch run measures it.
--   R2  the reset touches nothing but holding rows: matched against one holding row, a
--       strategy-sourced row, a voluntary_add row, a rejected row and a legacy
--       (match_decision_id NULL) row each differ in one attribute and are left as stored.
--   R3  the reset skips a holding row aged past the CHECK window and does not raise.
--   C1  access: the reset function is executable by no API role and not by PUBLIC (C1); the
--       helper by neither anon, authenticated nor PUBLIC and a direct call by those roles
--       is refused 42501 (C1b), and it is SECURITY INVOKER (C1c); the batch is not
--       executable by anon, authenticated or PUBLIC and is by service_role (C1d).
--
-- INTERFERENCE WALK. Rows persist across arms inside the one transaction. Measured rows
-- are computed (needs_recompute FALSE) and are never touched by a later batch call; rows
-- whose result is NULL stay candidates and are recomputed to NULL again, harmlessly, under
-- the correct body. A twin that breaks a lower arm's code path is therefore first seen by
-- THAT arm: B1's data is consistent (curve = compounded r) so B2's curve-based twin leaves
-- B1 green; B3's twin only matters where a day is missing; the malformed rows of B5 sit
-- behind the payload guards that the B5 twins remove, and each B5 twin is reached by its
-- own arm's batch call before any later arm runs; G1 and R3 seed their aged rows by
-- dropping and re-adding the CHECK, and DELETE them at the end of the arm so no later
-- reset call (R1's twin, R2's twin) can hit one and raise out of turn.
--
-- ANTI-GREEN-SKIP CONTRACT. Absence of the batch function is an EXCEPTION in B1, never a
-- skip. Merging supabase/migrations/** applies to PRODUCTION with no human stop, so
-- nothing in the merge path would make a missing object appear. Do not add a presence
-- skip.
--
-- SENTINEL. The final `ALL 14 ARMS EXECUTED (B1,...,C1)` notice at the foot of this file,
-- before ROLLBACK, joins ci.yml's `sql-tests` sentinel census; it counts arms, not the
-- sub-identities (3b-3d, 4a/4b, 5a-5g, 6a/6b, G2/G2b, H1/H1b, W1/W1b-W1d, C1/C1b-C1d) that give
-- each twin its own id.
--
-- Every identity carries a digit. Every `TEST FAILED (N)` raise sits DIRECTLY in the DO
-- body (the mutation runner reads an identity only from a single-frame `inline_code_block`
-- raise); the pg_temp helpers below return values and never raise an identity.
--
-- pgTAP is NOT installed (CLAUDE.md). Plain PL/pgSQL DO block, RAISE EXCEPTION on failure,
-- no psql meta-commands. The whole test rolls back. Seed data is synthetic: generated
-- uuids, @invalid.local emails, dates relative to CURRENT_DATE; no message names a uuid.
--
-- ⭐ RED-UNDER ANNOTATIONS. Each arm carries a prose `RED-UNDER:` and a machine-readable
-- `RED-UNDER-M:` twin the mutation runner applies on a throwaway pg-lane cluster to PROVE
-- the arm reds on its own, then restores GREEN. Schema: scripts/mutation-runner/GRAMMAR.md.
-- Every twin edits the migration that DEFINES what it mutates, 20261102120000. The
-- migration's own verify block is catalogue-only and asserts names, the SECURITY DEFINER
-- and SECURITY INVOKER split and the privilege matrix, never a formula line, so each edit
-- below leaves it standing and the mutated migration applies clean; the gate, not the
-- apply, is what speaks.
-- RED-UNDER-SETUP: {"apply":["scripts/pg-lane/fixtures/01-fixture-core.sql","scripts/pg-lane/fixtures/02-fixture-sanitize-tables.sql","scripts/pg-lane/fixtures/03-fixture-compute-jobs.sql","scripts/pg-lane/fixtures/07-fixture-supabase-default-privileges.sql","scripts/pg-lane/fixtures/11-fixture-api-keys-created-at.sql","scripts/pg-lane/fixtures/15-fixture-auth-role.sql","scripts/pg-lane/fixtures/20-fixture-app-role-helper.sql","scripts/pg-lane/fixtures/21-fixture-api-keys-credential-columns.sql","scripts/pg-lane/fixtures/23-fixture-contact-requests.sql","scripts/pg-lane/fixtures/24-fixture-enqueue-compute-job-chain.sql","scripts/pg-lane/fixtures/27-fixture-strategy-analytics-computation-error.sql","supabase/migrations/20260411144407_compute_jobs_queue.sql","scripts/pg-lane/fixtures/04-fixture-compute-jobs-targets.sql","scripts/pg-lane/fixtures/37-fixture-side-compute-job-kinds.sql","supabase/migrations/20260416125430_contact_request_metadata.sql","supabase/migrations/20260418194206_scoring_weight_overrides.sql","supabase/migrations/20260420073003_allocator_holdings.sql","supabase/migrations/20260510175507_process_key_long_compute_job_kinds_repair.sql","supabase/migrations/20260515114555_compute_jobs_claim_token_fencing.sql","supabase/migrations/20260515210300_scoring_weight_overrides_high_hardening.sql","supabase/migrations/20260522111858_compute_analytics_from_csv_kind.sql","supabase/migrations/20260525074649_compute_jobs_kind_check_extend_csv.sql","supabase/migrations/20260614120000_derive_broker_dailies_kind.sql","supabase/migrations/20260708120000_sync_status_failed_final_bounce.sql","supabase/migrations/20260710120000_strategy_keys.sql","supabase/migrations/20260710130000_stitch_composite_kind.sql","supabase/migrations/20260716090000_retire_compute_analytics_kind_rpc_guard.sql","supabase/migrations/20260717233529_allocator_equity_derived_surface.sql","supabase/migrations/20260825150000_sync_status_protect_marked_refresh.sql","supabase/migrations/20260826120000_computation_error_curated_copy.sql","supabase/migrations/20260826150000_destrict_enqueue_internal_10param.sql","supabase/migrations/20260906120000_computation_error_provenance.sql","supabase/migrations/20260924230827_fanin_initial_status_10param.sql","supabase/migrations/20261003120000_sync_status_bridge_residues.sql","supabase/migrations/20261009120000_sync_status_analytics_scope.sql","scripts/pg-lane/fixtures/40-fixture-match-decisions-bridge-outcomes.sql","supabase/migrations/20260418074935_bridge_outcome_cron.sql","supabase/migrations/20260420213754_allocator_equity_snapshots.sql","supabase/migrations/20260421154030_compute_bridge_outcome_deltas_holding_branch.sql","supabase/migrations/20261102120000_bridge_outcome_holding_branch_derived.sql"]}
-- ⚠️ The creating migrations of match_decisions and bridge_outcomes are NOT listed: they do
-- not replay on the lane, which is why fixture 40 stands in for them (lint R5/R6). The
-- three bridge migrations that ARE listed supply the helpers the batch names
-- (extract_equity_at, extract_delta, extract_estimated, parse_holding_ref) and the older
-- batch the new migration replaces; 20260421154030 also defines extract_symbol_value_at,
-- which reads allocator_equity_snapshots, hence 20260420213754. 07-fixture-supabase-
-- default-privileges.sql is what makes a later REVOKE falsifiable: functions the migration
-- creates arrive with the EXECUTE grant Supabase's bootstrap hands anon, authenticated
-- and service_role in production.

BEGIN;

-- Seeds one auth user and its allocator profile. pg_temp functions live and die with this
-- transaction and carry no arm.
CREATE FUNCTION pg_temp.bd_user() RETURNS uuid
LANGUAGE plpgsql AS $f$
DECLARE
  v_user uuid := gen_random_uuid();
BEGIN
  INSERT INTO auth.users (id, instance_id, email, created_at, updated_at)
  VALUES (v_user, '00000000-0000-0000-0000-000000000000',
          'bd-' || v_user::text || '@invalid.local', now(), now());
  INSERT INTO public.profiles (id, display_name, role)
  VALUES (v_user, 'bd', 'allocator')
  ON CONFLICT (id) DO NOTHING;
  RETURN v_user;
END
$f$;

-- One strategy owned by the user and, when p_series is given, its strategy_analytics row
-- carrying that cumulative returns_series.
CREATE FUNCTION pg_temp.bd_strategy(p_user uuid, p_series jsonb DEFAULT NULL) RETURNS uuid
LANGUAGE plpgsql AS $f$
DECLARE
  v_s uuid;
BEGIN
  INSERT INTO public.strategies (user_id, name) VALUES (p_user, 'bd strategy') RETURNING id INTO v_s;
  IF p_series IS NOT NULL THEN
    INSERT INTO public.strategy_analytics (strategy_id, returns_series) VALUES (v_s, p_series);
  END IF;
  RETURN v_s;
END
$f$;

-- A cumulative returns_series for the strategy and voluntary_add branches: 1.00 on the
-- anchor, then 1.10 / 1.20 / 1.50 at +30 / +90 / +180, so the three deltas are exactly
-- 0.1 / 0.2 / 0.5.
CREATE FUNCTION pg_temp.bd_series(p_anchor date) RETURNS jsonb
LANGUAGE sql AS $f$
  SELECT jsonb_build_array(
    jsonb_build_object('date', to_char(p_anchor, 'YYYY-MM-DD'),       'value', 1.00),
    jsonb_build_object('date', to_char(p_anchor + 30, 'YYYY-MM-DD'),  'value', 1.10),
    jsonb_build_object('date', to_char(p_anchor + 90, 'YYYY-MM-DD'),  'value', 1.20),
    jsonb_build_object('date', to_char(p_anchor + 180, 'YYYY-MM-DD'), 'value', 1.50))
$f$;

-- A decision. A bridge_recommended one names a strategy and exactly one of an original
-- strategy or a holding ref; a voluntary_add one a strategy and neither; a voluntary_modify
-- one a holding ref and no strategy.
CREATE FUNCTION pg_temp.bd_decision(p_user uuid, p_kind text, p_strategy uuid,
                                    p_orig_strategy uuid, p_ref text) RETURNS uuid
LANGUAGE plpgsql AS $f$
DECLARE
  v_md uuid;
BEGIN
  INSERT INTO public.match_decisions (allocator_id, strategy_id, decision, decided_by,
                                      original_strategy_id, original_holding_ref, kind)
  VALUES (p_user, p_strategy, 'thumbs_up', p_user, p_orig_strategy, p_ref,
          p_kind::public.match_decision_kind)
  RETURNING id INTO v_md;
  RETURN v_md;
END
$f$;

-- An allocated outcome. p_stale non-NULL seeds all three deltas with that value,
-- deltas_computed_at set and needs_recompute FALSE: an outcome already measured on the
-- old basis. NULL seeds an unmeasured outcome (needs_recompute TRUE, no deltas).
CREATE FUNCTION pg_temp.bd_outcome(p_user uuid, p_md uuid, p_strategy uuid, p_allocated date,
                                   p_stale numeric DEFAULT NULL) RETURNS uuid
LANGUAGE plpgsql AS $f$
DECLARE
  v_o uuid;
BEGIN
  INSERT INTO public.bridge_outcomes (allocator_id, strategy_id, match_decision_id, kind,
                                      percent_allocated, allocated_at, delta_30d, delta_90d,
                                      delta_180d, deltas_computed_at, needs_recompute)
  VALUES (p_user, p_strategy, p_md, 'allocated', 10, p_allocated, p_stale, p_stale, p_stale,
          CASE WHEN p_stale IS NULL THEN NULL ELSE now() END, p_stale IS NULL)
  RETURNING id INTO v_o;
  RETURN v_o;
END
$f$;

-- One holding-measuring outcome: a voluntary_modify decision on the holding ref
-- 'holding:bd:<symbol>:spot' and the allocated outcome on it. Returns the outcome id.
CREATE FUNCTION pg_temp.bd_holding(p_user uuid, p_symbol text, p_allocated date,
                                   p_stale numeric DEFAULT NULL) RETURNS uuid
LANGUAGE sql AS $f$
  SELECT pg_temp.bd_outcome(
    p_user,
    pg_temp.bd_decision(p_user, 'voluntary_modify', NULL, NULL, 'holding:bd:' || p_symbol || ':spot'),
    NULL, p_allocated, p_stale)
$f$;

-- A holding outcome whose allocated_at is p_days_ago days back, past the 365-day window
-- bridge_outcomes_allocated_at_check admits. The CHECK is dropped, the row inserted, and
-- the CHECK re-added NOT VALID: an existing row is not validated but every later UPDATE of
-- it is checked, which is the state PROD reaches when an in-window row ages out.
CREATE FUNCTION pg_temp.bd_aged(p_user uuid, p_symbol text, p_days_ago integer,
                                p_stale numeric DEFAULT NULL) RETURNS uuid
LANGUAGE plpgsql AS $f$
DECLARE
  v_o uuid;
BEGIN
  ALTER TABLE public.bridge_outcomes DROP CONSTRAINT IF EXISTS bridge_outcomes_allocated_at_check;
  v_o := pg_temp.bd_holding(p_user, p_symbol, CURRENT_DATE - p_days_ago, p_stale);
  ALTER TABLE public.bridge_outcomes ADD CONSTRAINT bridge_outcomes_allocated_at_check
    CHECK (allocated_at IS NULL OR (allocated_at <= CURRENT_DATE
           AND allocated_at >= (CURRENT_DATE - '365 days'::interval))) NOT VALID;
  RETURN v_o;
END
$f$;

-- A strategy-sourced or voluntary_add allocated outcome (decision p_md, strategy p_strategy)
-- whose allocated_at is p_days_ago days back, past the CHECK window, seeded the way bd_aged
-- seeds a holding row. NULL deltas, needs_recompute TRUE: a candidate of the strategy and
-- voluntary_add branches.
CREATE FUNCTION pg_temp.bd_aged_outcome(p_user uuid, p_md uuid, p_strategy uuid,
                                        p_days_ago integer) RETURNS uuid
LANGUAGE plpgsql AS $f$
DECLARE
  v_o uuid;
BEGIN
  ALTER TABLE public.bridge_outcomes DROP CONSTRAINT IF EXISTS bridge_outcomes_allocated_at_check;
  v_o := pg_temp.bd_outcome(p_user, p_md, p_strategy, CURRENT_DATE - p_days_ago);
  ALTER TABLE public.bridge_outcomes ADD CONSTRAINT bridge_outcomes_allocated_at_check
    CHECK (allocated_at IS NULL OR (allocated_at <= CURRENT_DATE
           AND allocated_at >= (CURRENT_DATE - '365 days'::interval))) NOT VALID;
  RETURN v_o;
END
$f$;

-- A version-2 derived payload for an anchor day: p_n days of returns after it, every day
-- p_r except the days in p_zero (r = 0 and the dollar curve DOUBLES that day: a deposit),
-- and no returns row at all on the days in p_skip. The curve starts at 1000 on the anchor.
CREATE FUNCTION pg_temp.bd_payload(p_anchor date, p_n integer, p_r numeric,
                                   p_skip integer[] DEFAULT '{}',
                                   p_zero integer[] DEFAULT '{}',
                                   p_version integer DEFAULT 2,
                                   p_trust boolean DEFAULT true) RETURNS jsonb
LANGUAGE plpgsql AS $f$
DECLARE
  v_eq      numeric := 1000;
  v_r       numeric;
  v_curve   jsonb := jsonb_build_array(jsonb_build_object(
                       'date', to_char(p_anchor, 'YYYY-MM-DD'), 'equity_usd', 1000));
  v_returns jsonb := '[]'::jsonb;
  i         integer;
BEGIN
  FOR i IN 1..p_n LOOP
    IF i = ANY (p_zero) THEN
      v_r := 0;
      v_eq := v_eq * 2;
    ELSE
      v_r := p_r;
      v_eq := v_eq * (1 + p_r);
    END IF;
    v_curve := v_curve || jsonb_build_array(jsonb_build_object(
                 'date', to_char(p_anchor + i, 'YYYY-MM-DD'), 'equity_usd', v_eq));
    IF NOT (i = ANY (p_skip)) THEN
      v_returns := v_returns || jsonb_build_array(jsonb_build_object(
                     'date', to_char(p_anchor + i, 'YYYY-MM-DD'), 'r', v_r));
    END IF;
  END LOOP;
  RETURN jsonb_build_object('curve', v_curve, 'returns', v_returns, 'version', p_version,
                            'flags', '[]'::jsonb, 'degrade_reasons', '[]'::jsonb,
                            'is_trustworthy', p_trust);
END
$f$;

-- Writes (or replaces) an allocator's equity_curve row.
CREATE FUNCTION pg_temp.bd_derive(p_user uuid, p_payload jsonb) RETURNS void
LANGUAGE sql AS $f$
  INSERT INTO public.allocator_equity_derived (allocator_id, kind, payload)
  VALUES (p_user, 'equity_curve', p_payload)
  ON CONFLICT (allocator_id, kind) DO UPDATE SET payload = EXCLUDED.payload
$f$;

-- Runs the batch as the CURRENT role. Returns 'OK' when it completed, else
-- `SQLSTATE|message`. It never raises, so the arm that called it decides what the outcome
-- means (and no assertion sits inside an EXCEPTION handler).
CREATE FUNCTION pg_temp.bd_try_compute() RETURNS text
LANGUAGE plpgsql AS $f$
BEGIN
  PERFORM * FROM public.compute_bridge_outcome_deltas();
  RETURN 'OK';
EXCEPTION WHEN OTHERS THEN
  RETURN SQLSTATE || '|' || SQLERRM;
END
$f$;

-- Runs the D-06 reset as the CURRENT role. 'OK|<count>' or `SQLSTATE|message`.
CREATE FUNCTION pg_temp.bd_try_reset() RETURNS text
LANGUAGE plpgsql AS $f$
DECLARE
  v_n integer;
BEGIN
  v_n := public.reset_holding_bridge_outcomes_to_derived_basis();
  RETURN 'OK|' || v_n;
EXCEPTION WHEN OTHERS THEN
  RETURN SQLSTATE || '|' || SQLERRM;
END
$f$;

-- Calls the helper as the CURRENT role. 'OK' or `SQLSTATE|message`.
CREATE FUNCTION pg_temp.bd_try_helper(p_user uuid, p_anchor date) RETURNS text
LANGUAGE plpgsql AS $f$
DECLARE
  v_r numeric;
BEGIN
  v_r := public.derived_account_return_over(p_user, p_anchor, 30);
  RETURN 'OK';
EXCEPTION WHEN OTHERS THEN
  RETURN SQLSTATE || '|' || SQLERRM;
END
$f$;

-- Does PUBLIC (the pseudo-role, grantee 0) hold EXECUTE on the function? A NULL proacl
-- means the default ACL, which grants PUBLIC EXECUTE.
CREATE FUNCTION pg_temp.bd_public_exec(p_oid oid) RETURNS boolean
LANGUAGE sql AS $f$
  SELECT EXISTS (
    SELECT 1
      FROM pg_proc p, aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) a
     WHERE p.oid = p_oid AND a.grantee = 0 AND a.privilege_type = 'EXECUTE')
$f$;

DO $$
DECLARE
  v_anchor date := CURRENT_DATE - 200;
  v_a      uuid;
  v_b      uuid;
  v_c      uuid;
  v_s1     uuid;
  v_s2     uuid;
  v_s3     uuid;
  v_s4     uuid;
  v_s5     uuid;
  v_md     uuid;
  v_o      uuid;
  v_o2     uuid;
  v_o3     uuid;
  v_o4     uuid;
  v_o5     uuid;
  v_upd    integer;
  v_u0     integer;
  v_u1     integer;
  v_f0     integer;
  v_f1     integer;
  v_cnt    integer;
  v_out    text;
  v_d30    numeric;
  v_d90    numeric;
  v_d180   numeric;
  v_at     timestamptz;
  v_need   boolean;
  v_e30    numeric;
  v_e90    numeric;
  v_e180   numeric;
  v_oid    oid;
  v_role   text;
  v_secdef boolean;
BEGIN
  IF to_regprocedure('public.compute_bridge_outcome_deltas()') IS NULL THEN
    RAISE EXCEPTION 'TEST FAILED (B1): public.compute_bridge_outcome_deltas() does not exist - this gate has nothing to test and must not skip';
  END IF;
  IF to_regprocedure('public.derived_account_return_over(uuid,date,integer)') IS NULL
     OR to_regprocedure('public.reset_holding_bridge_outcomes_to_derived_basis()') IS NULL THEN
    RAISE EXCEPTION 'TEST FAILED (B1): public.derived_account_return_over(uuid, date, integer) or public.reset_holding_bridge_outcomes_to_derived_basis() does not exist - migration 20261102120000 is not applied and this gate must not skip';
  END IF;

  -- ===== ARM B1 - a fresh holding outcome is measured on the account's compounded returns (D-03, D-05)
  -- One allocator, one trustworthy version-2 derived equity_curve row with r = 0.01 on
  -- every day anchor+1 .. anchor+180 (anchor = CURRENT_DATE - 200, inside the 365-day
  -- window and 20 days short of today at +180), one holding-ref decision and one allocated
  -- outcome at the anchor with no deltas. After one batch run each delta is
  -- power(1.01, N) - 1 within 1e-12; the oracle is power(), not the helper's log-sum.
  -- RED-UNDER: replace the compounding `exp(sum(lg)) - 1` in 20261102120000 with the
  --            plain sum of the simple returns `sum(exp(lg) - 1)`. 30 days at 1% then
  --            read 0.3 instead of 0.347, and 180 days 1.8 instead of 5.99.
-- RED-UNDER-M: {"arm":"B1","apply":[{"kind":"edit","file":"supabase/migrations/20261102120000_bridge_outcome_holding_branch_derived.sql","find":"exp(sum(lg)) - 1","replace":"sum(exp(lg) - 1)","occurrences":1}]}
  v_a := pg_temp.bd_user();
  PERFORM pg_temp.bd_derive(v_a, pg_temp.bd_payload(v_anchor, 180, 0.01));
  v_o := pg_temp.bd_holding(v_a, 'BTC', v_anchor);
  SELECT updated_count INTO v_upd FROM public.compute_bridge_outcome_deltas();
  SELECT delta_30d, delta_90d, delta_180d, deltas_computed_at, needs_recompute
    INTO v_d30, v_d90, v_d180, v_at, v_need
    FROM public.bridge_outcomes WHERE id = v_o;
  IF v_d30 IS NULL OR v_d90 IS NULL OR v_d180 IS NULL THEN
    RAISE EXCEPTION 'TEST FAILED (B1): a fresh holding outcome kept a NULL delta (30d %, 90d %, 180d %) although its allocator has a trustworthy version-2 derived curve covering all 180 days - the holding branch is not reading allocator_equity_derived returns (likely still reading the legacy per-symbol breakdown)', v_d30, v_d90, v_d180;
  END IF;
  IF abs(v_d30 - (power(1.01::numeric, 30) - 1)) > 1e-12
     OR abs(v_d90 - (power(1.01::numeric, 90) - 1)) > 1e-12
     OR abs(v_d180 - (power(1.01::numeric, 180) - 1)) > 1e-12 THEN
    RAISE EXCEPTION 'TEST FAILED (B1): deltas % / % / % are not the compounded daily returns power(1.01, N) - 1 for N = 30 / 90 / 180 - the outcome must compound the flow-neutral returns, not sum or ratio anything else', v_d30, v_d90, v_d180;
  END IF;
  IF v_at IS NULL OR v_need IS DISTINCT FROM false OR v_upd < 1 THEN
    RAISE EXCEPTION 'TEST FAILED (B1): the outcome was measured but deltas_computed_at is % and needs_recompute is % (updated_count %) - the UPDATE must mark it computed', v_at, v_need, v_upd;
  END IF;

  -- ===== ARM B2 - flow neutral: a deposit is not performance (D-05) =====================
  -- The curve doubles on day 5 (a deposit) while r = 0 that day. The compounded returns
  -- are 29 days at 1% in the first 30 days (89 in 90, 179 in 180); a ratio of dollar
  -- levels would read about +100% more.
  -- RED-UNDER: make the helper read the dollar curve instead of the returns: take its
  --            rows from payload.curve and derive each day's r as the day's equity over
  --            the previous day's, minus one. B1's curve is consistent with its returns,
  --            so only a deposit separates the two.
-- RED-UNDER-M: {"arm":"B2","apply":[{"kind":"edit","file":"supabase/migrations/20261102120000_bridge_outcome_holding_branch_derived.sql","find":"FROM d, jsonb_array_elements(d.payload->'returns') AS e","replace":"FROM d, jsonb_array_elements(d.payload->'curve') AS e","occurrences":1},{"kind":"edit","file":"supabase/migrations/20261102120000_bridge_outcome_holding_branch_derived.sql","find":"CASE WHEN jsonb_typeof(e->'r') = 'number' THEN (e->>'r')::numeric END AS r","replace":"(e->>'equity_usd')::numeric / lag((e->>'equity_usd')::numeric) OVER (ORDER BY e->>'date') - 1 AS r","occurrences":1}]}
  v_b := pg_temp.bd_user();
  PERFORM pg_temp.bd_derive(v_b, pg_temp.bd_payload(v_anchor, 180, 0.01, '{}', ARRAY[5]));
  v_o := pg_temp.bd_holding(v_b, 'BTC', v_anchor);
  PERFORM * FROM public.compute_bridge_outcome_deltas();
  SELECT delta_30d, delta_90d, delta_180d INTO v_d30, v_d90, v_d180
    FROM public.bridge_outcomes WHERE id = v_o;
  IF v_d30 IS NULL OR v_d90 IS NULL OR v_d180 IS NULL THEN
    RAISE EXCEPTION 'TEST FAILED (B2): the outcome of an account with a deposit kept a NULL delta (30d %, 90d %, 180d %) although every day of its returns is present', v_d30, v_d90, v_d180;
  END IF;
  IF abs(v_d30 - (power(1.01::numeric, 29) - 1)) > 1e-12
     OR abs(v_d90 - (power(1.01::numeric, 89) - 1)) > 1e-12
     OR abs(v_d180 - (power(1.01::numeric, 179) - 1)) > 1e-12 THEN
    RAISE EXCEPTION 'TEST FAILED (B2): deltas % / % / % are not the flow-neutral compounded returns power(1.01, N - 1) - 1 - the day-5 deposit that doubled the dollar curve was counted as performance (a ratio of dollar equity levels)', v_d30, v_d90, v_d180;
  END IF;

  -- ===== ARM B3 - an absent day is no change; NULL only when the curve does not cover the window (D-05) ===
  -- 3: day 45 has no returns row. The curve covers all three windows, so each is measured
  -- over the days that ARE present: 30 days, 89 days (day 45 is inside), 179 days.
  -- RED-UNDER: restore the every-day rule in the helper's final CASE (`AND count(got_day) = p_days`).
  --            The 90 and 180 day windows contain day 45 and go NULL.
-- RED-UNDER-M: {"arm":"B3","apply":[{"kind":"edit","file":"supabase/migrations/20261102120000_bridge_outcome_holding_branch_derived.sql","find":"\n            AND NOT bool_or(got_day IS NOT NULL AND r IS NULL)","replace":"\n            AND NOT bool_or(got_day IS NOT NULL AND r IS NULL)\n            AND count(got_day) = p_days","occurrences":1}]}
  v_c := pg_temp.bd_user();
  PERFORM pg_temp.bd_derive(v_c, pg_temp.bd_payload(v_anchor, 180, 0.01, ARRAY[45]));
  v_o := pg_temp.bd_holding(v_c, 'BTC', v_anchor);
  PERFORM * FROM public.compute_bridge_outcome_deltas();
  SELECT delta_30d, delta_90d, delta_180d INTO v_d30, v_d90, v_d180
    FROM public.bridge_outcomes WHERE id = v_o;
  IF v_d30 IS NULL OR v_d90 IS NULL OR v_d180 IS NULL THEN
    RAISE EXCEPTION 'TEST FAILED (B3): day 45 has no returns row and the curve covers the whole window, yet the deltas are % / % / % - an absent day is no change, so a window the curve covers must be measured over the days that are present', v_d30, v_d90, v_d180;
  END IF;
  IF abs(v_d30 - (power(1.01::numeric, 30) - 1)) > 1e-12
     OR abs(v_d90 - (power(1.01::numeric, 89) - 1)) > 1e-12
     OR abs(v_d180 - (power(1.01::numeric, 179) - 1)) > 1e-12 THEN
    RAISE EXCEPTION 'TEST FAILED (B3): deltas % / % / % are not power(1.01, N) - 1 over the days present (N = 30 / 89 / 179)', v_d30, v_d90, v_d180;
  END IF;

  -- 3b: the curve's last returns date is anchor + 100, so the 180-day window is not covered
  -- at its end and is NULL; the 30 and 90 day windows are measured.
  -- RED-UNDER: remove the helper's `last_day >= end of the window` condition.
-- RED-UNDER-M: {"arm":"B3b","apply":[{"kind":"edit","file":"supabase/migrations/20261102120000_bridge_outcome_holding_branch_derived.sql","find":"\n            AND (SELECT last_day FROM cov) >= to_char(p_anchor + p_days, 'YYYY-MM-DD')","replace":"","occurrences":1}]}
  v_c := pg_temp.bd_user();
  PERFORM pg_temp.bd_derive(v_c, pg_temp.bd_payload(v_anchor, 100, 0.01));
  v_o := pg_temp.bd_holding(v_c, 'BTC', v_anchor);
  PERFORM * FROM public.compute_bridge_outcome_deltas();
  SELECT delta_30d, delta_90d, delta_180d INTO v_d30, v_d90, v_d180
    FROM public.bridge_outcomes WHERE id = v_o;
  IF v_d30 IS NULL OR abs(v_d30 - (power(1.01::numeric, 30) - 1)) > 1e-12
     OR v_d90 IS NULL OR abs(v_d90 - (power(1.01::numeric, 90) - 1)) > 1e-12 THEN
    RAISE EXCEPTION 'TEST FAILED (B3b): the curve covers days 1-100, so delta_30d and delta_90d must be measured, got % and %', v_d30, v_d90;
  END IF;
  IF v_d180 IS NOT NULL THEN
    RAISE EXCEPTION 'TEST FAILED (B3b): the curve ends at day 100 but delta_180d is % - a window the curve does not reach the end of must be NULL', v_d180;
  END IF;

  -- 3c: the curve's first returns date is anchor + 11, after the first day of every window,
  -- so no window is covered at its start and every delta is NULL.
  -- RED-UNDER: remove the helper's `first_day <= start of the window` condition.
-- RED-UNDER-M: {"arm":"B3c","apply":[{"kind":"edit","file":"supabase/migrations/20261102120000_bridge_outcome_holding_branch_derived.sql","find":"\n            AND (SELECT first_day FROM cov) <= to_char(p_anchor + 1, 'YYYY-MM-DD')","replace":"","occurrences":1}]}
  v_c := pg_temp.bd_user();
  PERFORM pg_temp.bd_derive(v_c, pg_temp.bd_payload(v_anchor + 10, 170, 0.01));
  v_o := pg_temp.bd_holding(v_c, 'BTC', v_anchor);
  PERFORM * FROM public.compute_bridge_outcome_deltas();
  SELECT delta_30d, delta_90d, delta_180d INTO v_d30, v_d90, v_d180
    FROM public.bridge_outcomes WHERE id = v_o;
  IF v_d30 IS NOT NULL OR v_d90 IS NOT NULL OR v_d180 IS NOT NULL THEN
    RAISE EXCEPTION 'TEST FAILED (B3c): the curve starts at day 11 yet the deltas are % / % / % - a window the curve does not reach the start of must be NULL', v_d30, v_d90, v_d180;
  END IF;

  -- 3d: day 10 has r = -1 (a total loss). The product is zero, so every window that
  -- contains it compounds to -1, not NULL.
  -- RED-UNDER: remove the helper's `bool_or(r <= -1)` branch; the day is then a zero log
  --            (no change) and the windows read about +33%, +144% and +499% instead of -100%.
-- RED-UNDER-M: {"arm":"B3d","apply":[{"kind":"edit","file":"supabase/migrations/20261102120000_bridge_outcome_holding_branch_derived.sql","find":"CASE WHEN bool_or(r <= -1) THEN -1 ELSE exp(sum(lg)) - 1 END","replace":"exp(sum(lg)) - 1","occurrences":1}]}
  v_c := pg_temp.bd_user();
  PERFORM pg_temp.bd_derive(v_c, jsonb_set(pg_temp.bd_payload(v_anchor, 180, 0.01), '{returns,9,r}', '-1'::jsonb));
  v_o := pg_temp.bd_holding(v_c, 'BTC', v_anchor);
  PERFORM * FROM public.compute_bridge_outcome_deltas();
  SELECT delta_30d, delta_90d, delta_180d INTO v_d30, v_d90, v_d180
    FROM public.bridge_outcomes WHERE id = v_o;
  IF v_d30 IS DISTINCT FROM -1 OR v_d90 IS DISTINCT FROM -1 OR v_d180 IS DISTINCT FROM -1 THEN
    RAISE EXCEPTION 'TEST FAILED (B3d): a day with r = -1 gave deltas % / % / % instead of -1 / -1 / -1 - a total loss compounds to -100%%, it is not a missing value', v_d30, v_d90, v_d180;
  END IF;

  -- ===== ARM B4 - only a trustworthy version-2 row counts (D-05) =======================
  -- 4a: is_trustworthy false. 4b: payload version 1. Each has every day present, and each
  -- must give NULL deltas.
  -- RED-UNDER: remove the `payload->'is_trustworthy' = 'true'::jsonb` condition from the
  --            helper's row filter (4a).
-- RED-UNDER-M: {"arm":"B4a","apply":[{"kind":"edit","file":"supabase/migrations/20261102120000_bridge_outcome_holding_branch_derived.sql","find":"\n       AND payload->'is_trustworthy' = 'true'::jsonb","replace":"","occurrences":1}]}
  -- RED-UNDER: remove the `payload->>'version' = '2'` condition from the helper's row
  --            filter (4b).
-- RED-UNDER-M: {"arm":"B4b","apply":[{"kind":"edit","file":"supabase/migrations/20261102120000_bridge_outcome_holding_branch_derived.sql","find":"\n       AND payload->>'version' = '2'","replace":"","occurrences":1}]}
  v_a := pg_temp.bd_user();
  v_b := pg_temp.bd_user();
  PERFORM pg_temp.bd_derive(v_a, pg_temp.bd_payload(v_anchor, 180, 0.01, '{}', '{}', 2, false));
  PERFORM pg_temp.bd_derive(v_b, pg_temp.bd_payload(v_anchor, 180, 0.01, '{}', '{}', 1, true));
  v_o := pg_temp.bd_holding(v_a, 'BTC', v_anchor);
  v_o2 := pg_temp.bd_holding(v_b, 'BTC', v_anchor);
  PERFORM * FROM public.compute_bridge_outcome_deltas();
  SELECT delta_30d, delta_90d, delta_180d INTO v_d30, v_d90, v_d180
    FROM public.bridge_outcomes WHERE id = v_o;
  IF v_d30 IS NOT NULL OR v_d90 IS NOT NULL OR v_d180 IS NOT NULL THEN
    RAISE EXCEPTION 'TEST FAILED (B4a): an untrustworthy derived row (is_trustworthy false) produced deltas % / % / % - only a trustworthy row may measure an outcome', v_d30, v_d90, v_d180;
  END IF;
  SELECT delta_30d, delta_90d, delta_180d INTO v_d30, v_d90, v_d180
    FROM public.bridge_outcomes WHERE id = v_o2;
  IF v_d30 IS NOT NULL OR v_d90 IS NOT NULL OR v_d180 IS NOT NULL THEN
    RAISE EXCEPTION 'TEST FAILED (B4b): a version-1 derived row produced deltas % / % / % - only payload version 2 carries the flow-neutral returns', v_d30, v_d90, v_d180;
  END IF;

  -- ===== ARM B5 - a malformed payload gives NULL and never aborts the batch (T-176-05) ======
  -- Each sub-arm seeds a malformed allocator and a sound one, runs the batch once, and
  -- requires: the call completed, the malformed row is NULL, the sound row has its value.
  -- 5a: returns is an object, not an array.
  -- RED-UNDER: remove the `jsonb_typeof(payload->'returns') = 'array'` condition from the
  --            helper's row filter; jsonb_array_elements then raises on a non-array.
-- RED-UNDER-M: {"arm":"B5a","apply":[{"kind":"edit","file":"supabase/migrations/20261102120000_bridge_outcome_holding_branch_derived.sql","find":"\n       AND jsonb_typeof(payload->'returns') = 'array'","replace":"","occurrences":1}]}
  v_a := pg_temp.bd_user();
  v_b := pg_temp.bd_user();
  PERFORM pg_temp.bd_derive(v_a, jsonb_set(pg_temp.bd_payload(v_anchor, 180, 0.01), '{returns}', '{"x": 1}'::jsonb));
  PERFORM pg_temp.bd_derive(v_b, pg_temp.bd_payload(v_anchor, 180, 0.01));
  v_o := pg_temp.bd_holding(v_a, 'BTC', v_anchor);
  v_o2 := pg_temp.bd_holding(v_b, 'BTC', v_anchor);
  v_out := pg_temp.bd_try_compute();
  IF v_out <> 'OK' THEN
    RAISE EXCEPTION 'TEST FAILED (B5a): the batch raised % for a derived row whose returns is not an array - one malformed row must give NULL for that allocator and never abort the daily batch for the others', v_out;
  END IF;
  SELECT delta_30d, delta_90d, delta_180d INTO v_d30, v_d90, v_d180 FROM public.bridge_outcomes WHERE id = v_o;
  IF v_d30 IS NOT NULL OR v_d90 IS NOT NULL OR v_d180 IS NOT NULL THEN
    RAISE EXCEPTION 'TEST FAILED (B5a): a derived row whose returns is not an array produced deltas % / % / %', v_d30, v_d90, v_d180;
  END IF;
  SELECT delta_30d INTO v_d30 FROM public.bridge_outcomes WHERE id = v_o2;
  IF v_d30 IS NULL OR abs(v_d30 - (power(1.01::numeric, 30) - 1)) > 1e-12 THEN
    RAISE EXCEPTION 'TEST FAILED (B5a): the sound allocator in the same batch call has delta_30d % instead of power(1.01, 30) - 1 - a malformed neighbour must not cost it its value', v_d30;
  END IF;

  -- 5b: one r is a string that is not a number.
  -- RED-UNDER: drop the `jsonb_typeof(e->'r') = 'number'` guard so every r is cast; the
  --            string 'abc' then raises 22P02 out of the batch.
-- RED-UNDER-M: {"arm":"B5b","apply":[{"kind":"edit","file":"supabase/migrations/20261102120000_bridge_outcome_holding_branch_derived.sql","find":"CASE WHEN jsonb_typeof(e->'r') = 'number' THEN (e->>'r')::numeric END AS r","replace":"(e->>'r')::numeric AS r","occurrences":1}]}
  v_a := pg_temp.bd_user();
  v_b := pg_temp.bd_user();
  PERFORM pg_temp.bd_derive(v_a, jsonb_set(pg_temp.bd_payload(v_anchor, 180, 0.01), '{returns,3,r}', '"abc"'::jsonb));
  PERFORM pg_temp.bd_derive(v_b, pg_temp.bd_payload(v_anchor, 180, 0.01));
  v_o := pg_temp.bd_holding(v_a, 'BTC', v_anchor);
  v_o2 := pg_temp.bd_holding(v_b, 'BTC', v_anchor);
  v_out := pg_temp.bd_try_compute();
  IF v_out <> 'OK' THEN
    RAISE EXCEPTION 'TEST FAILED (B5b): the batch raised % for a derived row with an r that is a string - an r that is not a JSON number is a missing day, not an error', v_out;
  END IF;
  SELECT delta_30d, delta_90d, delta_180d INTO v_d30, v_d90, v_d180 FROM public.bridge_outcomes WHERE id = v_o;
  IF v_d30 IS NOT NULL OR v_d90 IS NOT NULL OR v_d180 IS NOT NULL THEN
    RAISE EXCEPTION 'TEST FAILED (B5b): a derived row with a string r produced deltas % / % / %', v_d30, v_d90, v_d180;
  END IF;
  SELECT delta_30d INTO v_d30 FROM public.bridge_outcomes WHERE id = v_o2;
  IF v_d30 IS NULL OR abs(v_d30 - (power(1.01::numeric, 30) - 1)) > 1e-12 THEN
    RAISE EXCEPTION 'TEST FAILED (B5b): the sound allocator in the same batch call has delta_30d % instead of power(1.01, 30) - 1', v_d30;
  END IF;

  -- 5c: one date text is not a real day. It matches no day of the window, so that day is an
  -- absent day (no change) and the windows are measured over the days that are present.
  -- RED-UNDER: cast the date text to a date before matching (`(e->>'date')::date::text`);
  --            2026-02-30 then raises 22008 out of the batch instead of being a day that
  --            matches nothing.
-- RED-UNDER-M: {"arm":"B5c","apply":[{"kind":"edit","file":"supabase/migrations/20261102120000_bridge_outcome_holding_branch_derived.sql","find":"e->>'date' AS day","replace":"(e->>'date')::date::text AS day","occurrences":1}]}
  v_a := pg_temp.bd_user();
  v_b := pg_temp.bd_user();
  PERFORM pg_temp.bd_derive(v_a, jsonb_set(pg_temp.bd_payload(v_anchor, 180, 0.01), '{returns,3,date}', '"2026-02-30"'::jsonb));
  PERFORM pg_temp.bd_derive(v_b, pg_temp.bd_payload(v_anchor, 180, 0.01));
  v_o := pg_temp.bd_holding(v_a, 'BTC', v_anchor);
  v_o2 := pg_temp.bd_holding(v_b, 'BTC', v_anchor);
  v_out := pg_temp.bd_try_compute();
  IF v_out <> 'OK' THEN
    RAISE EXCEPTION 'TEST FAILED (B5c): the batch raised % for a derived row with a date text that is not a real day - dates are matched as text and never cast', v_out;
  END IF;
  SELECT delta_30d, delta_90d, delta_180d INTO v_d30, v_d90, v_d180 FROM public.bridge_outcomes WHERE id = v_o;
  IF v_d30 IS NULL OR v_d90 IS NULL OR v_d180 IS NULL
     OR abs(v_d30 - (power(1.01::numeric, 29) - 1)) > 1e-12
     OR abs(v_d90 - (power(1.01::numeric, 89) - 1)) > 1e-12
     OR abs(v_d180 - (power(1.01::numeric, 179) - 1)) > 1e-12 THEN
    RAISE EXCEPTION 'TEST FAILED (B5c): a derived row with a non-day date text (day 4 absent) produced deltas % / % / % - the unreadable day must count as an absent day (no change), power(1.01, N - 1) - 1', v_d30, v_d90, v_d180;
  END IF;
  SELECT delta_30d INTO v_d30 FROM public.bridge_outcomes WHERE id = v_o2;
  IF v_d30 IS NULL OR abs(v_d30 - (power(1.01::numeric, 30) - 1)) > 1e-12 THEN
    RAISE EXCEPTION 'TEST FAILED (B5c): the sound allocator in the same batch call has delta_30d % instead of power(1.01, 30) - 1', v_d30;
  END IF;

  -- 5d: an r so large the compounded log-sum is beyond any real book (the numeric exp()
  -- raises 22003 once its argument passes about 49000).
  -- RED-UNDER: remove the `sum(lg) < 1000` condition from the helper's final CASE; exp()
  --            of the 90-day log-sum then raises 22003 out of the batch.
-- RED-UNDER-M: {"arm":"B5d","apply":[{"kind":"edit","file":"supabase/migrations/20261102120000_bridge_outcome_holding_branch_derived.sql","find":"\n            AND sum(lg) < 1000","replace":"","occurrences":1}]}
  v_a := pg_temp.bd_user();
  v_b := pg_temp.bd_user();
  PERFORM pg_temp.bd_derive(v_a, jsonb_build_object('version', 2, 'is_trustworthy', true,
    'curve', '[]'::jsonb,
    'returns', (SELECT jsonb_agg(jsonb_build_object('date', to_char(v_anchor + i, 'YYYY-MM-DD'),
                                                    'r', 1e300::numeric) ORDER BY i)
                  FROM generate_series(1, 180) AS g(i))));
  PERFORM pg_temp.bd_derive(v_b, pg_temp.bd_payload(v_anchor, 180, 0.01));
  v_o := pg_temp.bd_holding(v_a, 'BTC', v_anchor);
  v_o2 := pg_temp.bd_holding(v_b, 'BTC', v_anchor);
  v_out := pg_temp.bd_try_compute();
  IF v_out <> 'OK' THEN
    RAISE EXCEPTION 'TEST FAILED (B5d): the batch raised % for a derived row whose compounded product leaves numeric range - a malformed row must give NULL, never abort the batch', v_out;
  END IF;
  SELECT delta_30d, delta_90d, delta_180d INTO v_d30, v_d90, v_d180 FROM public.bridge_outcomes WHERE id = v_o;
  IF v_d30 IS NOT NULL OR v_d90 IS NOT NULL OR v_d180 IS NOT NULL THEN
    RAISE EXCEPTION 'TEST FAILED (B5d): a derived row with r = 1e300 on every day produced deltas % / % / % instead of NULL', v_d30, v_d90, v_d180;
  END IF;
  SELECT delta_30d INTO v_d30 FROM public.bridge_outcomes WHERE id = v_o2;
  IF v_d30 IS NULL OR abs(v_d30 - (power(1.01::numeric, 30) - 1)) > 1e-12 THEN
    RAISE EXCEPTION 'TEST FAILED (B5d): the sound allocator in the same batch call has delta_30d % instead of power(1.01, 30) - 1', v_d30;
  END IF;

  -- 5e: every returns date carries a time suffix ('YYYY-MM-DDT00:00:00Z'), the real return is
  -- 1% a day, and the curve starts 10 days before the anchor. No date matches a window day
  -- and none is a well-formed day, so there is nothing to measure: every delta is NULL. Before
  -- fix round 2 the raw text min and max spanned every window and the row stored 0%.
  -- Both guards (well-formed coverage, at least one matched day) stop this, so the twin
  -- removes both; each guard has its own arm below (5f, 5g).
  -- RED-UNDER: remove the helper's well-formed-date filter on `cov` AND its `count(got_day) > 0` condition.
-- RED-UNDER-M: {"arm":"B5e","apply":[{"kind":"edit","file":"supabase/migrations/20261102120000_bridge_outcome_holding_branch_derived.sql","find":"\n     WHERE day ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'","replace":"","occurrences":1},{"kind":"edit","file":"supabase/migrations/20261102120000_bridge_outcome_holding_branch_derived.sql","find":"\n            AND count(got_day) > 0","replace":"","occurrences":1}]}
  v_c := pg_temp.bd_user();
  PERFORM pg_temp.bd_derive(v_c, jsonb_set(pg_temp.bd_payload(v_anchor - 10, 200, 0.01), '{returns}',
    (SELECT jsonb_agg(jsonb_set(t.e, '{date}', to_jsonb((t.e->>'date') || 'T00:00:00Z')) ORDER BY t.ord)
       FROM jsonb_array_elements(pg_temp.bd_payload(v_anchor - 10, 200, 0.01)->'returns') WITH ORDINALITY AS t(e, ord))));
  v_o := pg_temp.bd_holding(v_c, 'BTC', v_anchor);
  PERFORM * FROM public.compute_bridge_outcome_deltas();
  SELECT delta_30d, delta_90d, delta_180d INTO v_d30, v_d90, v_d180
    FROM public.bridge_outcomes WHERE id = v_o;
  IF v_d30 IS NOT NULL OR v_d90 IS NOT NULL OR v_d180 IS NOT NULL THEN
    RAISE EXCEPTION 'TEST FAILED (B5e): every returns date is time-suffixed, so none is a day the windows name, yet the deltas are % / % / % - a window with no well-formed return inside it must be NULL, never an invented 0%%', v_d30, v_d90, v_d180;
  END IF;

  -- 5f: a 40-day curve plus one stray entry whose date text is 'x-bogus' (it sorts after every
  -- ISO day). Only the 30-day window is covered; the stray entry must not extend coverage to
  -- the 90 and 180 day windows.
  -- RED-UNDER: remove the helper's well-formed-date filter on `cov`; the stray text is then
  --            the last returns date and the 90-day window reads +49% over the 40 real days.
-- RED-UNDER-M: {"arm":"B5f","apply":[{"kind":"edit","file":"supabase/migrations/20261102120000_bridge_outcome_holding_branch_derived.sql","find":"\n     WHERE day ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'","replace":"","occurrences":1}]}
  v_c := pg_temp.bd_user();
  PERFORM pg_temp.bd_derive(v_c, jsonb_set(pg_temp.bd_payload(v_anchor, 40, 0.01), '{returns}',
    (pg_temp.bd_payload(v_anchor, 40, 0.01)->'returns') || '[{"date": "x-bogus", "r": 0.01}]'::jsonb));
  v_o := pg_temp.bd_holding(v_c, 'BTC', v_anchor);
  PERFORM * FROM public.compute_bridge_outcome_deltas();
  SELECT delta_30d, delta_90d, delta_180d INTO v_d30, v_d90, v_d180
    FROM public.bridge_outcomes WHERE id = v_o;
  IF v_d30 IS NULL OR abs(v_d30 - (power(1.01::numeric, 30) - 1)) > 1e-12 THEN
    RAISE EXCEPTION 'TEST FAILED (B5f): the curve covers days 1-40 and delta_30d must be measured, got %', v_d30;
  END IF;
  IF v_d90 IS NOT NULL OR v_d180 IS NOT NULL THEN
    RAISE EXCEPTION 'TEST FAILED (B5f): a stray malformed date entry extended the curve''s coverage: the 90 and 180 day deltas are % / % on a curve that ends at day 40 - only YYYY-MM-DD dates count toward coverage', v_d90, v_d180;
  END IF;

  -- 5g: the only returns entries are one on the anchor day and one at anchor + 181, both
  -- well-formed. They bracket every window (first <= start, last >= end) but none lies inside
  -- one, so there is nothing to measure: NULL (founder, "At least one day"), not 0%.
  -- RED-UNDER: remove the helper's `count(got_day) > 0` condition; the empty window then
  --            compounds to exp(0) - 1 = 0.
-- RED-UNDER-M: {"arm":"B5g","apply":[{"kind":"edit","file":"supabase/migrations/20261102120000_bridge_outcome_holding_branch_derived.sql","find":"\n            AND count(got_day) > 0","replace":"","occurrences":1}]}
  v_c := pg_temp.bd_user();
  PERFORM pg_temp.bd_derive(v_c, jsonb_build_object('version', 2, 'is_trustworthy', true,
    'curve', '[]'::jsonb,
    'returns', jsonb_build_array(
      jsonb_build_object('date', to_char(v_anchor, 'YYYY-MM-DD'), 'r', 0.01),
      jsonb_build_object('date', to_char(v_anchor + 181, 'YYYY-MM-DD'), 'r', 0.01))));
  v_o := pg_temp.bd_holding(v_c, 'BTC', v_anchor);
  PERFORM * FROM public.compute_bridge_outcome_deltas();
  SELECT delta_30d, delta_90d, delta_180d INTO v_d30, v_d90, v_d180
    FROM public.bridge_outcomes WHERE id = v_o;
  IF v_d30 IS NOT NULL OR v_d90 IS NOT NULL OR v_d180 IS NOT NULL THEN
    RAISE EXCEPTION 'TEST FAILED (B5g): the curve''s returns bracket the windows but none lies inside one, yet the deltas are % / % / % - a window with no return inside it must be NULL, never an invented 0%%', v_d30, v_d90, v_d180;
  END IF;

  -- ===== ARM B6 - the strategy and voluntary_add branches still measure on returns_series =================
  -- 6a: a bridge_recommended decision that names an original STRATEGY; 6b: a voluntary_add
  -- decision. Both read strategy_analytics.returns_series (1.00 -> 1.10 / 1.20 / 1.50 at
  -- +30 / +90 / +180), so the deltas are exactly 0.1 / 0.2 / 0.5. The holding branch's
  -- re-base must not have moved them.
  -- RED-UNDER: change the strategy branch's 30-day extract_delta to 31 days (6a).
-- RED-UNDER-M: {"arm":"B6a","apply":[{"kind":"edit","file":"supabase/migrations/20261102120000_bridge_outcome_holding_branch_derived.sql","find":"public.extract_delta(c.series, c.allocated_at, 30)","replace":"public.extract_delta(c.series, c.allocated_at, 31)","occurrences":1}]}
  -- RED-UNDER: change the voluntary_add branch's 30-day extract_delta to 31 days (6b).
-- RED-UNDER-M: {"arm":"B6b","apply":[{"kind":"edit","file":"supabase/migrations/20261102120000_bridge_outcome_holding_branch_derived.sql","find":"public.extract_delta(vc.series, vc.allocated_at, 30)","replace":"public.extract_delta(vc.series, vc.allocated_at, 31)","occurrences":1}]}
  v_a := pg_temp.bd_user();
  v_s1 := pg_temp.bd_strategy(v_a, pg_temp.bd_series(v_anchor));
  v_s2 := pg_temp.bd_strategy(v_a);
  v_s3 := pg_temp.bd_strategy(v_a, pg_temp.bd_series(v_anchor));
  v_md := pg_temp.bd_decision(v_a, 'bridge_recommended', v_s1, v_s2, NULL);
  v_o := pg_temp.bd_outcome(v_a, v_md, v_s1, v_anchor);
  v_md := pg_temp.bd_decision(v_a, 'voluntary_add', v_s3, NULL, NULL);
  v_o2 := pg_temp.bd_outcome(v_a, v_md, v_s3, v_anchor);
  PERFORM * FROM public.compute_bridge_outcome_deltas();
  SELECT delta_30d, delta_90d, delta_180d INTO v_d30, v_d90, v_d180 FROM public.bridge_outcomes WHERE id = v_o;
  IF v_d30 IS DISTINCT FROM 0.1 OR v_d90 IS DISTINCT FROM 0.2 OR v_d180 IS DISTINCT FROM 0.5 THEN
    RAISE EXCEPTION 'TEST FAILED (B6a): the strategy-sourced outcome has deltas % / % / % instead of 0.1 / 0.2 / 0.5 from strategy_analytics.returns_series - the strategy branch must still read the returns_series as 20260426131718 did', v_d30, v_d90, v_d180;
  END IF;
  SELECT delta_30d, delta_90d, delta_180d INTO v_d30, v_d90, v_d180 FROM public.bridge_outcomes WHERE id = v_o2;
  IF v_d30 IS DISTINCT FROM 0.1 OR v_d90 IS DISTINCT FROM 0.2 OR v_d180 IS DISTINCT FROM 0.5 THEN
    RAISE EXCEPTION 'TEST FAILED (B6b): the voluntary_add outcome has deltas % / % / % instead of 0.1 / 0.2 / 0.5 from strategy_analytics.returns_series - the voluntary_add branch must still read the returns_series as 20260426131718 did', v_d30, v_d90, v_d180;
  END IF;

  -- ===== ARM G1 - a holding row aged past the CHECK window cannot abort the batch (T-176-05) =
  -- bridge_outcomes_allocated_at_check admits allocated_at only inside
  -- [CURRENT_DATE - 365 days, CURRENT_DATE], and PostgreSQL checks it on EVERY update of a
  -- row. An aged holding row with NULL deltas is a candidate of the old body: its UPDATE
  -- raises 23514 and aborts the whole statement, for every allocator. The new body leaves
  -- it out. A sound row in the same call is still measured. The aged row is deleted at the
  -- end so no later call can reach it.
  -- RED-UNDER: remove the `bo.allocated_at >= (CURRENT_DATE - '365 days'::interval)`
  --            conjunct from holding_candidates in 20261102120000; the aged row becomes a
  --            candidate and its UPDATE raises 23514.
-- RED-UNDER-M: {"arm":"G1","apply":[{"kind":"edit","file":"supabase/migrations/20261102120000_bridge_outcome_holding_branch_derived.sql","find":"Such a row is not a candidate.\n      AND bo.allocated_at >= (CURRENT_DATE - '365 days'::interval)","replace":"Such a row is not a candidate.","occurrences":1}]}
  v_a := pg_temp.bd_user();
  v_b := pg_temp.bd_user();
  PERFORM pg_temp.bd_derive(v_a, pg_temp.bd_payload(CURRENT_DATE - 400, 30, 0.01));
  PERFORM pg_temp.bd_derive(v_b, pg_temp.bd_payload(v_anchor, 180, 0.01));
  v_o := pg_temp.bd_aged(v_a, 'BTC', 400);
  v_o2 := pg_temp.bd_holding(v_b, 'BTC', v_anchor);
  v_out := pg_temp.bd_try_compute();
  IF v_out <> 'OK' THEN
    RAISE EXCEPTION 'TEST FAILED (G1): the batch raised % with a holding outcome aged 400 days in the table - a row past the allocated_at CHECK window must not be a candidate, because touching it aborts the whole daily statement', v_out;
  END IF;
  SELECT delta_30d, deltas_computed_at, needs_recompute INTO v_d30, v_at, v_need FROM public.bridge_outcomes WHERE id = v_o;
  IF v_d30 IS NOT NULL OR v_at IS NOT NULL OR v_need IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'TEST FAILED (G1): the aged holding row was touched (delta_30d %, deltas_computed_at %, needs_recompute %) - it must be left exactly as stored', v_d30, v_at, v_need;
  END IF;
  SELECT delta_30d INTO v_d30 FROM public.bridge_outcomes WHERE id = v_o2;
  IF v_d30 IS NULL OR abs(v_d30 - (power(1.01::numeric, 30) - 1)) > 1e-12 THEN
    RAISE EXCEPTION 'TEST FAILED (G1): the in-window holding row in the same batch call has delta_30d % instead of power(1.01, 30) - 1', v_d30;
  END IF;
  DELETE FROM public.bridge_outcomes WHERE id = v_o;

  -- ===== ARM G2 - the strategy and voluntary_add branches take only rows inside the CHECK window (F4) =====
  -- Same abort as G1, in the two branches that carried it before fix round 1: an aged
  -- strategy-sourced row (2) and an aged voluntary_add row (2b), each with NULL deltas and a
  -- strategy_analytics row, is a candidate whose UPDATE raises 23514 and aborts the whole
  -- statement. Each sub-arm runs the batch with only its own aged row present, and deletes
  -- the row at the end so no later call can reach it.
  -- RED-UNDER: remove the `bo.allocated_at >= (CURRENT_DATE - '365 days'::interval)` conjunct
  --            from strategy_candidates in 20261102120000.
-- RED-UNDER-M: {"arm":"G2","apply":[{"kind":"edit","file":"supabase/migrations/20261102120000_bridge_outcome_holding_branch_derived.sql","find":"AND bo.allocated_at IS NOT NULL\n      AND bo.allocated_at >= (CURRENT_DATE - '365 days'::interval)\n      AND (bo.delta_30d IS NULL OR bo.needs_recompute = TRUE)\n      AND (\n        bo.match_decision_id IS NULL","replace":"AND bo.allocated_at IS NOT NULL\n      AND (bo.delta_30d IS NULL OR bo.needs_recompute = TRUE)\n      AND (\n        bo.match_decision_id IS NULL","occurrences":1}]}
  v_a := pg_temp.bd_user();
  v_s1 := pg_temp.bd_strategy(v_a, pg_temp.bd_series(CURRENT_DATE - 400));
  v_s2 := pg_temp.bd_strategy(v_a);
  v_md := pg_temp.bd_decision(v_a, 'bridge_recommended', v_s1, v_s2, NULL);
  v_o := pg_temp.bd_aged_outcome(v_a, v_md, v_s1, 400);
  v_out := pg_temp.bd_try_compute();
  IF v_out <> 'OK' THEN
    RAISE EXCEPTION 'TEST FAILED (G2): the batch raised % with a strategy-sourced outcome aged 400 days in the table - a row past the allocated_at CHECK window must not be a candidate of the strategy branch either, because touching it aborts the whole daily statement', v_out;
  END IF;
  SELECT delta_30d, deltas_computed_at, needs_recompute INTO v_d30, v_at, v_need FROM public.bridge_outcomes WHERE id = v_o;
  IF v_d30 IS NOT NULL OR v_at IS NOT NULL OR v_need IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'TEST FAILED (G2): the aged strategy-sourced row was touched (delta_30d %, deltas_computed_at %, needs_recompute %) - it must be left exactly as stored', v_d30, v_at, v_need;
  END IF;
  DELETE FROM public.bridge_outcomes WHERE id = v_o;

  -- RED-UNDER: remove the same conjunct from voluntary_add_candidates in 20261102120000.
-- RED-UNDER-M: {"arm":"G2b","apply":[{"kind":"edit","file":"supabase/migrations/20261102120000_bridge_outcome_holding_branch_derived.sql","find":"AND bo.allocated_at >= (CURRENT_DATE - '365 days'::interval)\n      AND (bo.delta_30d IS NULL OR bo.needs_recompute = TRUE)\n      AND md.kind = 'voluntary_add'","replace":"AND (bo.delta_30d IS NULL OR bo.needs_recompute = TRUE)\n      AND md.kind = 'voluntary_add'","occurrences":1}]}
  v_s3 := pg_temp.bd_strategy(v_a, pg_temp.bd_series(CURRENT_DATE - 400));
  v_md := pg_temp.bd_decision(v_a, 'voluntary_add', v_s3, NULL, NULL);
  v_o2 := pg_temp.bd_aged_outcome(v_a, v_md, v_s3, 400);
  v_out := pg_temp.bd_try_compute();
  IF v_out <> 'OK' THEN
    RAISE EXCEPTION 'TEST FAILED (G2b): the batch raised % with a voluntary_add outcome aged 400 days in the table - a row past the allocated_at CHECK window must not be a candidate of the voluntary_add branch either', v_out;
  END IF;
  SELECT delta_30d, deltas_computed_at, needs_recompute INTO v_d30, v_at, v_need FROM public.bridge_outcomes WHERE id = v_o2;
  IF v_d30 IS NOT NULL OR v_at IS NOT NULL OR v_need IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'TEST FAILED (G2b): the aged voluntary_add row was touched (delta_30d %, deltas_computed_at %, needs_recompute %) - it must be left exactly as stored', v_d30, v_at, v_need;
  END IF;
  DELETE FROM public.bridge_outcomes WHERE id = v_o2;

  -- ===== ARM H1 - a holding row that measured nothing is not stamped computed and is counted failed (F2) =====
  -- One allocator's derived row is untrustworthy, so every delta of its holding outcome is
  -- NULL; a sound allocator's row in the same call is measured. The all-NULL row must stay
  -- needs_recompute TRUE with deltas_computed_at NULL and must not count as updated (H1);
  -- failed_count must count it (H1b). Both counts are read as the difference between a call
  -- before the two rows are seeded and the call after, so rows left by earlier arms (which
  -- stay failed candidates in every call) cancel out.
  -- RED-UNDER: remove the `hc.d30 IS NOT NULL OR hc.d90 IS NOT NULL OR hc.d180 IS NOT NULL`
  --            conjunct from holding_updated; the all-NULL row is stamped computed.
-- RED-UNDER-M: {"arm":"H1","apply":[{"kind":"edit","file":"supabase/migrations/20261102120000_bridge_outcome_holding_branch_derived.sql","find":"\n      AND (hc.d30 IS NOT NULL OR hc.d90 IS NOT NULL OR hc.d180 IS NOT NULL)","replace":"","occurrences":1}]}
  SELECT updated_count, failed_count INTO v_u0, v_f0 FROM public.compute_bridge_outcome_deltas();
  v_a := pg_temp.bd_user();
  v_b := pg_temp.bd_user();
  PERFORM pg_temp.bd_derive(v_a, pg_temp.bd_payload(v_anchor, 180, 0.01, '{}', '{}', 2, false));
  PERFORM pg_temp.bd_derive(v_b, pg_temp.bd_payload(v_anchor, 180, 0.01));
  v_o := pg_temp.bd_holding(v_a, 'BTC', v_anchor);
  v_o2 := pg_temp.bd_holding(v_b, 'BTC', v_anchor);
  SELECT updated_count, failed_count INTO v_u1, v_f1 FROM public.compute_bridge_outcome_deltas();
  SELECT delta_30d, deltas_computed_at, needs_recompute INTO v_d30, v_at, v_need FROM public.bridge_outcomes WHERE id = v_o;
  IF v_d30 IS NOT NULL OR v_at IS NOT NULL OR v_need IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'TEST FAILED (H1): a holding row whose deltas all came back NULL was stamped (delta_30d %, deltas_computed_at %, needs_recompute %) - it measured nothing, so it must stay needs_recompute TRUE with no deltas_computed_at', v_d30, v_at, v_need;
  END IF;
  SELECT delta_30d INTO v_d30 FROM public.bridge_outcomes WHERE id = v_o2;
  IF v_d30 IS NULL OR v_u1 - v_u0 <> 1 THEN
    RAISE EXCEPTION 'TEST FAILED (H1): the sound row has delta_30d % and updated_count moved by % (expected a measured value and exactly +1: the all-NULL row is not an update)', v_d30, v_u1 - v_u0;
  END IF;

  -- RED-UNDER: make the failed count in the final SELECT always zero (`WHERE FALSE`).
-- RED-UNDER-M: {"arm":"H1b","apply":[{"kind":"edit","file":"supabase/migrations/20261102120000_bridge_outcome_holding_branch_derived.sql","find":"WHERE hc.d30 IS NULL AND hc.d90 IS NULL AND hc.d180 IS NULL)","replace":"WHERE FALSE)","occurrences":1}]}
  IF v_f1 - v_f0 <> 1 THEN
    RAISE EXCEPTION 'TEST FAILED (H1b): failed_count moved by % between the call before and the call after the all-NULL holding row was seeded - it must count exactly that row (+1)', v_f1 - v_f0;
  END IF;

  -- ===== ARM W1 - a holding row is picked again until every matured window is filled (F3) =====
  -- Two runs. Run 1: the derived curve covers 30 days only, so delta_30d lands and the row
  -- is stamped computed (needs_recompute FALSE). Run 2: the curve now covers 90 days (1) or
  -- 180 days (1b). Under a delta_30d-only candidate guard the row never returns and the
  -- later windows stay NULL for ever.
  -- RED-UNDER: remove the `delta_90d IS NULL AND allocated_at <= CURRENT_DATE - 91 days`
  --            disjunct from holding_candidates (the first of its two occurrences).
-- RED-UNDER-M: {"arm":"W1","apply":[{"kind":"edit","file":"supabase/migrations/20261102120000_bridge_outcome_holding_branch_derived.sql","find":"\n        OR (bo.delta_90d IS NULL AND bo.allocated_at <= (CURRENT_DATE - '91 days'::interval))","replace":"","occurrences":2,"nth":1}]}
  v_a := pg_temp.bd_user();
  PERFORM pg_temp.bd_derive(v_a, pg_temp.bd_payload(CURRENT_DATE - 100, 30, 0.01));
  v_o := pg_temp.bd_holding(v_a, 'BTC', CURRENT_DATE - 100);
  PERFORM * FROM public.compute_bridge_outcome_deltas();
  SELECT delta_30d, delta_90d, delta_180d, needs_recompute INTO v_d30, v_d90, v_d180, v_need FROM public.bridge_outcomes WHERE id = v_o;
  IF v_d30 IS NULL OR abs(v_d30 - (power(1.01::numeric, 30) - 1)) > 1e-12 OR v_d90 IS NOT NULL OR v_d180 IS NOT NULL OR v_need IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'TEST FAILED (W1): run 1 with a curve covering 30 days left delta_30d %, delta_90d %, delta_180d %, needs_recompute % - expected only the 30-day window measured and the row stamped computed', v_d30, v_d90, v_d180, v_need;
  END IF;
  PERFORM pg_temp.bd_derive(v_a, pg_temp.bd_payload(CURRENT_DATE - 100, 90, 0.01));
  PERFORM * FROM public.compute_bridge_outcome_deltas();
  SELECT delta_30d, delta_90d, delta_180d INTO v_d30, v_d90, v_d180 FROM public.bridge_outcomes WHERE id = v_o;
  IF v_d90 IS NULL OR abs(v_d90 - (power(1.01::numeric, 90) - 1)) > 1e-12
     OR abs(v_d30 - (power(1.01::numeric, 30) - 1)) > 1e-12 THEN
    RAISE EXCEPTION 'TEST FAILED (W1): run 2, after the curve grew to cover 90 days, left delta_30d % and delta_90d % - delta_90d must be filled (power(1.01, 90) - 1) and delta_30d kept; a row stamped computed after its +30d run must stay a candidate while its matured +90d is NULL', v_d30, v_d90;
  END IF;

  -- RED-UNDER: remove the `delta_180d IS NULL AND allocated_at <= CURRENT_DATE - 181 days`
  --            disjunct from holding_candidates (the first of its two occurrences).
-- RED-UNDER-M: {"arm":"W1b","apply":[{"kind":"edit","file":"supabase/migrations/20261102120000_bridge_outcome_holding_branch_derived.sql","find":"\n        OR (bo.delta_180d IS NULL AND bo.allocated_at <= (CURRENT_DATE - '181 days'::interval))","replace":"","occurrences":2,"nth":1}]}
  v_a := pg_temp.bd_user();
  PERFORM pg_temp.bd_derive(v_a, pg_temp.bd_payload(CURRENT_DATE - 190, 100, 0.01));
  v_o := pg_temp.bd_holding(v_a, 'BTC', CURRENT_DATE - 190);
  PERFORM * FROM public.compute_bridge_outcome_deltas();
  SELECT delta_30d, delta_90d, delta_180d, needs_recompute INTO v_d30, v_d90, v_d180, v_need FROM public.bridge_outcomes WHERE id = v_o;
  IF v_d30 IS NULL OR v_d90 IS NULL OR v_d180 IS NOT NULL OR v_need IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'TEST FAILED (W1b): run 1 with a curve covering 100 days left delta_30d %, delta_90d %, delta_180d %, needs_recompute % - expected the 30 and 90 day windows measured, the 180 day window NULL and the row stamped computed', v_d30, v_d90, v_d180, v_need;
  END IF;
  PERFORM pg_temp.bd_derive(v_a, pg_temp.bd_payload(CURRENT_DATE - 190, 180, 0.01));
  PERFORM * FROM public.compute_bridge_outcome_deltas();
  SELECT delta_30d, delta_90d, delta_180d INTO v_d30, v_d90, v_d180 FROM public.bridge_outcomes WHERE id = v_o;
  IF v_d180 IS NULL OR abs(v_d180 - (power(1.01::numeric, 180) - 1)) > 1e-12
     OR abs(v_d90 - (power(1.01::numeric, 90) - 1)) > 1e-12 THEN
    RAISE EXCEPTION 'TEST FAILED (W1b): run 2, after the curve grew to cover 180 days, left delta_90d % and delta_180d % - delta_180d must be filled (power(1.01, 180) - 1) and delta_90d kept', v_d90, v_d180;
  END IF;

  -- 1c: a stored delta is kept. The row is allocated 100 days back; run 1 stores delta_30d from
  -- a 30-day curve at +1% a day. Between the runs the curve is restated (NAVMTM restates
  -- history) to 90 days at -1% a day. Run 2 fills delta_90d from the restated curve and must
  -- leave the stored delta_30d as it was. needs_recompute was never set, so nothing asked for
  -- a re-measurement.
  -- RED-UNDER: swap the 30-day value order in the not-needs_recompute branch of the holding
  --            UPDATE to `COALESCE(hc.d30, bo.delta_30d)` (new wins); the stored +34.8% turns
  --            into the restated curve's -26.0%.
-- RED-UNDER-M: {"arm":"W1c","apply":[{"kind":"edit","file":"supabase/migrations/20261102120000_bridge_outcome_holding_branch_derived.sql","find":"ELSE COALESCE(bo.delta_30d,  hc.d30)  END","replace":"ELSE COALESCE(hc.d30,  bo.delta_30d)  END","occurrences":1}]}
  v_a := pg_temp.bd_user();
  PERFORM pg_temp.bd_derive(v_a, pg_temp.bd_payload(CURRENT_DATE - 100, 30, 0.01));
  v_o := pg_temp.bd_holding(v_a, 'BTC', CURRENT_DATE - 100);
  PERFORM * FROM public.compute_bridge_outcome_deltas();
  PERFORM pg_temp.bd_derive(v_a, pg_temp.bd_payload(CURRENT_DATE - 100, 90, -0.01));
  PERFORM * FROM public.compute_bridge_outcome_deltas();
  SELECT delta_30d, delta_90d INTO v_d30, v_d90 FROM public.bridge_outcomes WHERE id = v_o;
  IF v_d30 IS NULL OR abs(v_d30 - (power(1.01::numeric, 30) - 1)) > 1e-12 THEN
    RAISE EXCEPTION 'TEST FAILED (W1c): delta_30d is % after the curve was restated between the runs - it was stored as power(1.01, 30) - 1 and needs_recompute was never set, so the stored outcome must be kept', v_d30;
  END IF;
  IF v_d90 IS NULL OR abs(v_d90 - (power(0.99::numeric, 90) - 1)) > 1e-12 THEN
    RAISE EXCEPTION 'TEST FAILED (W1c): delta_90d is % - the matured window that was still NULL must fill from the restated curve, power(0.99, 90) - 1', v_d90;
  END IF;

  -- 1d: a row picked again with nothing new to fill is not written, counted or stamped. The row
  -- is allocated 150 days back and its curve stops at day 60, so +30d stores in run 1 and +90d
  -- can never fill. Run 2 re-picks it (delta_90d NULL and 91+ days back) and must change
  -- nothing; its contribution to updated_count is read as the difference between a call with the
  -- row present and a call with it deleted, so rows other arms left behind cancel out.
  -- RED-UNDER: remove the `bo.needs_recompute = TRUE OR (bo.delta_30d IS NULL AND hc.d30 IS NOT NULL) ...`
  --            conjunct from holding_updated; the idle row is rewritten and counted every run.
-- RED-UNDER-M: {"arm":"W1d","apply":[{"kind":"edit","file":"supabase/migrations/20261102120000_bridge_outcome_holding_branch_derived.sql","find":"\n      AND (\n        bo.needs_recompute = TRUE\n        OR (bo.delta_30d  IS NULL AND hc.d30  IS NOT NULL)\n        OR (bo.delta_90d  IS NULL AND hc.d90  IS NOT NULL)\n        OR (bo.delta_180d IS NULL AND hc.d180 IS NOT NULL)\n      )","replace":"","occurrences":1}]}
  v_a := pg_temp.bd_user();
  PERFORM pg_temp.bd_derive(v_a, pg_temp.bd_payload(CURRENT_DATE - 150, 60, 0.01));
  v_o := pg_temp.bd_holding(v_a, 'BTC', CURRENT_DATE - 150);
  PERFORM * FROM public.compute_bridge_outcome_deltas();
  SELECT delta_30d, delta_90d INTO v_d30, v_d90 FROM public.bridge_outcomes WHERE id = v_o;
  IF v_d30 IS NULL OR v_d90 IS NOT NULL THEN
    RAISE EXCEPTION 'TEST FAILED (W1d): run 1 with a curve covering 60 days left delta_30d % and delta_90d % - expected +30d stored and +90d NULL', v_d30, v_d90;
  END IF;
  SELECT updated_count INTO v_u0 FROM public.compute_bridge_outcome_deltas();
  DELETE FROM public.bridge_outcomes WHERE id = v_o;
  SELECT updated_count INTO v_u1 FROM public.compute_bridge_outcome_deltas();
  IF v_u0 - v_u1 <> 0 THEN
    RAISE EXCEPTION 'TEST FAILED (W1d): a holding row with nothing new to fill (+90d can never fill, +30d is stored) was counted in updated_count (% with it, % without it) - a row picked again is written only when a NULL window fills or needs_recompute is set', v_u0, v_u1;
  END IF;

  -- ===== ARM R1 - the D-06 reset puts a stored holding outcome back to "not measured" ====
  -- A holding row stored on the old basis (all three deltas 0.5, deltas_computed_at set,
  -- needs_recompute FALSE) inside the window. After the reset the three deltas and
  -- deltas_computed_at are NULL and needs_recompute is TRUE, the returned count includes
  -- the row, and the next batch run measures it on the derived returns.
  -- RED-UNDER: remove the `delta_90d = NULL` assignment from the reset function; the stale
  --            0.5 survives in the 90-day column, the half-reset the batch's
  --            COALESCE(new, old) would otherwise hide.
-- RED-UNDER-M: {"arm":"R1","apply":[{"kind":"edit","file":"supabase/migrations/20261102120000_bridge_outcome_holding_branch_derived.sql","find":"           delta_90d          = NULL,\n","replace":"","occurrences":1}]}
  v_a := pg_temp.bd_user();
  PERFORM pg_temp.bd_derive(v_a, pg_temp.bd_payload(v_anchor, 180, 0.01));
  v_o := pg_temp.bd_holding(v_a, 'BTC', v_anchor, 0.5);
  v_out := pg_temp.bd_try_reset();
  IF v_out NOT LIKE 'OK|%' THEN
    RAISE EXCEPTION 'TEST FAILED (R1): the reset function raised % on a database holding one in-window holding row', v_out;
  END IF;
  v_cnt := substring(v_out FROM 4)::integer;
  SELECT delta_30d, delta_90d, delta_180d, deltas_computed_at, needs_recompute
    INTO v_d30, v_d90, v_d180, v_at, v_need
    FROM public.bridge_outcomes WHERE id = v_o;
  IF v_d30 IS NOT NULL OR v_d90 IS NOT NULL OR v_d180 IS NOT NULL OR v_at IS NOT NULL
     OR v_need IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'TEST FAILED (R1): after the reset the holding row has deltas % / % / %, deltas_computed_at % and needs_recompute % - all three deltas and deltas_computed_at must be NULL and needs_recompute TRUE together', v_d30, v_d90, v_d180, v_at, v_need;
  END IF;
  IF v_cnt < 1 THEN
    RAISE EXCEPTION 'TEST FAILED (R1): the reset reported % rows although it reset one', v_cnt;
  END IF;
  PERFORM * FROM public.compute_bridge_outcome_deltas();
  SELECT delta_30d, delta_90d, delta_180d INTO v_d30, v_d90, v_d180 FROM public.bridge_outcomes WHERE id = v_o;
  IF v_d30 IS NULL OR v_d90 IS NULL OR v_d180 IS NULL
     OR abs(v_d30 - (power(1.01::numeric, 30) - 1)) > 1e-12
     OR abs(v_d180 - (power(1.01::numeric, 180) - 1)) > 1e-12 THEN
    RAISE EXCEPTION 'TEST FAILED (R1): the next batch run left the reset row at % / % / % instead of the compounded derived returns', v_d30, v_d90, v_d180;
  END IF;

  -- ===== ARM R2 - the reset touches nothing but holding rows (T-176-06) =================
  -- Matched against one holding row H, four rows that each differ in one attribute carry
  -- stale deltas of 0.5 and must come out of the reset exactly as stored: S (the decision
  -- names an original STRATEGY), V (a voluntary_add decision), X (kind rejected) and L (no
  -- decision at all: a legacy row).
  -- RED-UNDER: remove the parse_holding_ref EXISTS test from the reset function; the
  --            voluntary_add row, whose decision names no holding ref, is then reset.
-- RED-UNDER-M: {"arm":"R2","apply":[{"kind":"edit","file":"supabase/migrations/20261102120000_bridge_outcome_holding_branch_derived.sql","find":"\n       AND EXISTS (SELECT 1 FROM public.parse_holding_ref(md.original_holding_ref) AS hp\n                    WHERE hp.symbol IS NOT NULL)","replace":"","occurrences":1}]}
  v_a := pg_temp.bd_user();
  v_s1 := pg_temp.bd_strategy(v_a);
  v_s2 := pg_temp.bd_strategy(v_a);
  v_s3 := pg_temp.bd_strategy(v_a);
  v_s4 := pg_temp.bd_strategy(v_a);
  v_s5 := pg_temp.bd_strategy(v_a);
  v_o := pg_temp.bd_holding(v_a, 'BTC', v_anchor, 0.5);
  v_md := pg_temp.bd_decision(v_a, 'bridge_recommended', v_s1, v_s2, NULL);
  v_o2 := pg_temp.bd_outcome(v_a, v_md, v_s1, v_anchor, 0.5);
  v_md := pg_temp.bd_decision(v_a, 'voluntary_add', v_s3, NULL, NULL);
  v_o3 := pg_temp.bd_outcome(v_a, v_md, v_s3, v_anchor, 0.5);
  v_o4 := pg_temp.bd_outcome(v_a, NULL, v_s4, v_anchor, 0.5);
  INSERT INTO public.bridge_outcomes (allocator_id, strategy_id, kind, rejection_reason,
                                      delta_30d, delta_90d, delta_180d, deltas_computed_at,
                                      needs_recompute)
  VALUES (v_a, v_s5, 'rejected', 'other', 0.5, 0.5, 0.5, now(), false)
  RETURNING id INTO v_o5;
  v_out := pg_temp.bd_try_reset();
  IF v_out NOT LIKE 'OK|%' THEN
    RAISE EXCEPTION 'TEST FAILED (R2): the reset function raised % on a mixed set of outcomes', v_out;
  END IF;
  SELECT delta_30d, needs_recompute INTO v_d30, v_need FROM public.bridge_outcomes WHERE id = v_o;
  IF v_d30 IS NOT NULL OR v_need IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'TEST FAILED (R2): the holding row H was not reset (delta_30d %, needs_recompute %) - the matched pairs below only mean something if the reset ran', v_d30, v_need;
  END IF;
  SELECT delta_30d, delta_90d, delta_180d, needs_recompute, deltas_computed_at
    INTO v_d30, v_d90, v_d180, v_need, v_at FROM public.bridge_outcomes WHERE id = v_o2;
  IF v_d30 IS DISTINCT FROM 0.5 OR v_d90 IS DISTINCT FROM 0.5 OR v_d180 IS DISTINCT FROM 0.5
     OR v_need IS DISTINCT FROM false OR v_at IS NULL THEN
    RAISE EXCEPTION 'TEST FAILED (R2): the strategy-sourced row S was reset (deltas % / % / %, needs_recompute %) - a decision with an original strategy is not a holding outcome', v_d30, v_d90, v_d180, v_need;
  END IF;
  SELECT delta_30d, delta_90d, delta_180d, needs_recompute, deltas_computed_at
    INTO v_d30, v_d90, v_d180, v_need, v_at FROM public.bridge_outcomes WHERE id = v_o3;
  IF v_d30 IS DISTINCT FROM 0.5 OR v_d90 IS DISTINCT FROM 0.5 OR v_d180 IS DISTINCT FROM 0.5
     OR v_need IS DISTINCT FROM false OR v_at IS NULL THEN
    RAISE EXCEPTION 'TEST FAILED (R2): the voluntary_add row V was reset (deltas % / % / %, needs_recompute %) - a decision that names no holding ref is not a holding outcome', v_d30, v_d90, v_d180, v_need;
  END IF;
  SELECT delta_30d, delta_90d, delta_180d, needs_recompute, deltas_computed_at
    INTO v_d30, v_d90, v_d180, v_need, v_at FROM public.bridge_outcomes WHERE id = v_o4;
  IF v_d30 IS DISTINCT FROM 0.5 OR v_d90 IS DISTINCT FROM 0.5 OR v_d180 IS DISTINCT FROM 0.5
     OR v_need IS DISTINCT FROM false OR v_at IS NULL THEN
    RAISE EXCEPTION 'TEST FAILED (R2): the legacy row L (no decision) was reset (deltas % / % / %, needs_recompute %)', v_d30, v_d90, v_d180, v_need;
  END IF;
  SELECT delta_30d, delta_90d, delta_180d, needs_recompute, deltas_computed_at
    INTO v_d30, v_d90, v_d180, v_need, v_at FROM public.bridge_outcomes WHERE id = v_o5;
  IF v_d30 IS DISTINCT FROM 0.5 OR v_d90 IS DISTINCT FROM 0.5 OR v_d180 IS DISTINCT FROM 0.5
     OR v_need IS DISTINCT FROM false OR v_at IS NULL THEN
    RAISE EXCEPTION 'TEST FAILED (R2): the rejected row X was reset (deltas % / % / %, needs_recompute %)', v_d30, v_d90, v_d180, v_need;
  END IF;

  -- ===== ARM R3 - the reset skips a row aged past the CHECK window and does not raise ====
  -- Updating an aged row raises 23514, so a reset without the window test would abort the
  -- migration that carries it (and with it the PROD apply). The aged row keeps its stale
  -- deltas. It is deleted at the end of the arm.
  -- RED-UNDER: remove the `bo.allocated_at >= (CURRENT_DATE - '365 days'::interval)`
  --            conjunct from the reset function; the aged row is selected and its UPDATE
  --            raises 23514.
-- RED-UNDER-M: {"arm":"R3","apply":[{"kind":"edit","file":"supabase/migrations/20261102120000_bridge_outcome_holding_branch_derived.sql","find":"AND bo.allocated_at >= (CURRENT_DATE - '365 days'::interval)\n       AND md.original_strategy_id IS NULL","replace":"AND md.original_strategy_id IS NULL","occurrences":1}]}
  v_a := pg_temp.bd_user();
  v_o := pg_temp.bd_aged(v_a, 'BTC', 400, 0.5);
  v_out := pg_temp.bd_try_reset();
  IF v_out NOT LIKE 'OK|%' THEN
    RAISE EXCEPTION 'TEST FAILED (R3): the reset raised % with a holding row aged 400 days in the table - it must skip rows outside the allocated_at CHECK window', v_out;
  END IF;
  SELECT delta_30d, needs_recompute INTO v_d30, v_need FROM public.bridge_outcomes WHERE id = v_o;
  IF v_d30 IS DISTINCT FROM 0.5 OR v_need IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'TEST FAILED (R3): the aged holding row was touched by the reset (delta_30d %, needs_recompute %) - it must be left as stored', v_d30, v_need;
  END IF;
  DELETE FROM public.bridge_outcomes WHERE id = v_o;

  -- ===== ARM C1 - who may call what (T-176-04, T-176-06, T-176-08) ======================
  -- C1: the reset function is executable by anon, authenticated, service_role and PUBLIC
  --     by none of them. C1b: the helper is executable by neither anon, authenticated nor
  --     PUBLIC but by service_role, and a direct call as anon or authenticated is refused
  --     42501. C1c: the helper is SECURITY INVOKER. C1d: the batch is executable by
  --     neither anon, authenticated nor PUBLIC but by service_role.
  -- 07-fixture-supabase-default-privileges.sql hands anon, authenticated and service_role
  -- EXECUTE on every function the migration creates, so each REVOKE below is falsifiable.
  -- RED-UNDER: leave `authenticated` out of the reset function's REVOKE (and out of the
  --            verify block's role list, which would otherwise abort the apply).
-- RED-UNDER-M: {"arm":"C1","apply":[{"kind":"edit","file":"supabase/migrations/20261102120000_bridge_outcome_holding_branch_derived.sql","find":"REVOKE ALL ON FUNCTION public.reset_holding_bridge_outcomes_to_derived_basis() FROM PUBLIC, anon, authenticated, service_role;","replace":"REVOKE ALL ON FUNCTION public.reset_holding_bridge_outcomes_to_derived_basis() FROM PUBLIC, anon, service_role;","occurrences":1},{"kind":"edit","file":"supabase/migrations/20261102120000_bridge_outcome_holding_branch_derived.sql","find":"ARRAY['anon', 'authenticated', 'service_role']","replace":"ARRAY['anon', 'service_role']","occurrences":1}]}
  v_oid := to_regprocedure('public.reset_holding_bridge_outcomes_to_derived_basis()');
  FOREACH v_role IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
    IF has_function_privilege(v_role, v_oid, 'EXECUTE') THEN
      RAISE EXCEPTION 'TEST FAILED (C1): % can EXECUTE reset_holding_bridge_outcomes_to_derived_basis - the reset wipes stored outcomes and is owner only', v_role;
    END IF;
  END LOOP;
  IF pg_temp.bd_public_exec(v_oid) THEN
    RAISE EXCEPTION 'TEST FAILED (C1): PUBLIC can EXECUTE reset_holding_bridge_outcomes_to_derived_basis';
  END IF;

  -- RED-UNDER: leave `authenticated` out of the helper's REVOKE (and out of the verify
  --            block's role list). A direct caller then reaches the helper.
-- RED-UNDER-M: {"arm":"C1b","apply":[{"kind":"edit","file":"supabase/migrations/20261102120000_bridge_outcome_holding_branch_derived.sql","find":"REVOKE ALL ON FUNCTION public.derived_account_return_over(uuid, date, integer) FROM PUBLIC, anon, authenticated;","replace":"REVOKE ALL ON FUNCTION public.derived_account_return_over(uuid, date, integer) FROM PUBLIC, anon;","occurrences":1},{"kind":"edit","file":"supabase/migrations/20261102120000_bridge_outcome_holding_branch_derived.sql","find":"ARRAY['anon', 'authenticated']","replace":"ARRAY['anon']","occurrences":1}]}
  v_oid := to_regprocedure('public.derived_account_return_over(uuid,date,integer)');
  FOREACH v_role IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF has_function_privilege(v_role, v_oid, 'EXECUTE') THEN
      RAISE EXCEPTION 'TEST FAILED (C1b): % can EXECUTE derived_account_return_over - a direct caller could read another allocator''s returns', v_role;
    END IF;
  END LOOP;
  IF pg_temp.bd_public_exec(v_oid) THEN
    RAISE EXCEPTION 'TEST FAILED (C1b): PUBLIC can EXECUTE derived_account_return_over';
  END IF;
  IF NOT has_function_privilege('service_role', v_oid, 'EXECUTE') THEN
    RAISE EXCEPTION 'TEST FAILED (C1b): service_role cannot EXECUTE derived_account_return_over';
  END IF;
  v_a := pg_temp.bd_user();
  FOREACH v_role IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    PERFORM set_config('request.jwt.claims',
      CASE WHEN v_role = 'authenticated'
           THEN json_build_object('sub', v_a::text, 'role', 'authenticated')::text
           ELSE NULL END, true);
    EXECUTE format('SET LOCAL ROLE %I', v_role);
    v_out := pg_temp.bd_try_helper(v_a, v_anchor);
    RESET ROLE;
    IF v_out NOT LIKE '42501|%' THEN
      RAISE EXCEPTION 'TEST FAILED (C1b): a direct call of derived_account_return_over as % answered %, expected 42501 permission denied', v_role, v_out;
    END IF;
  END LOOP;
  PERFORM set_config('request.jwt.claims', NULL, true);

  -- RED-UNDER: declare the helper SECURITY DEFINER (and stand down the verify block's
  --            matching refusal). It would then read every allocator's row as the owner.
-- RED-UNDER-M: {"arm":"C1c","apply":[{"kind":"edit","file":"supabase/migrations/20261102120000_bridge_outcome_holding_branch_derived.sql","find":"STABLE\nSET search_path = public, pg_catalog\nAS $func$","replace":"STABLE\nSECURITY DEFINER\nSET search_path = public, pg_catalog\nAS $func$","occurrences":1},{"kind":"edit","file":"supabase/migrations/20261102120000_bridge_outcome_holding_branch_derived.sql","find":"IF v_secdef THEN","replace":"IF FALSE THEN","occurrences":1}]}
  SELECT p.prosecdef INTO v_secdef FROM pg_proc p
   WHERE p.oid = to_regprocedure('public.derived_account_return_over(uuid,date,integer)');
  IF v_secdef IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'TEST FAILED (C1c): derived_account_return_over is SECURITY DEFINER - it must run as its caller so the owner policy of allocator_equity_derived applies to a direct caller';
  END IF;

  -- RED-UNDER: leave `authenticated` out of the batch's REVOKE (and out of the verify
  --            block's role list).
-- RED-UNDER-M: {"arm":"C1d","apply":[{"kind":"edit","file":"supabase/migrations/20261102120000_bridge_outcome_holding_branch_derived.sql","find":"REVOKE ALL ON FUNCTION public.compute_bridge_outcome_deltas() FROM PUBLIC, anon, authenticated;","replace":"REVOKE ALL ON FUNCTION public.compute_bridge_outcome_deltas() FROM PUBLIC, anon;","occurrences":1},{"kind":"edit","file":"supabase/migrations/20261102120000_bridge_outcome_holding_branch_derived.sql","find":"ARRAY['anon', 'authenticated']","replace":"ARRAY['anon']","occurrences":1}]}
  v_oid := to_regprocedure('public.compute_bridge_outcome_deltas()');
  FOREACH v_role IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF has_function_privilege(v_role, v_oid, 'EXECUTE') THEN
      RAISE EXCEPTION 'TEST FAILED (C1d): % can EXECUTE compute_bridge_outcome_deltas - the batch is a SECURITY DEFINER writer', v_role;
    END IF;
  END LOOP;
  IF pg_temp.bd_public_exec(v_oid) THEN
    RAISE EXCEPTION 'TEST FAILED (C1d): PUBLIC can EXECUTE compute_bridge_outcome_deltas';
  END IF;
  IF NOT has_function_privilege('service_role', v_oid, 'EXECUTE') THEN
    RAISE EXCEPTION 'TEST FAILED (C1d): service_role cannot EXECUTE compute_bridge_outcome_deltas - the cron could not run it';
  END IF;

  RAISE NOTICE 'ALL 14 ARMS EXECUTED (B1,B2,B3,B4,B5,B6,G1,G2,H1,W1,R1,R2,R3,C1): a holding outcome is measured on the account''s compounded flow-neutral derived returns over the days present, NULL where the curve does not cover the window, a row that measured nothing is counted failed and not stamped, a matured window is filled by a later run, aged rows cannot abort any branch of the batch, the D-06 reset touches holding rows only, and the three functions carry the intended privileges.';
END $$;

ROLLBACK;
