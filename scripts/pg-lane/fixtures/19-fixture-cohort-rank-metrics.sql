-- Additive stand-ins for the three rankable metrics
-- `get_verified_cohort_rank` reads off `strategy_analytics`
-- (20260821120000:205-270). Apply AFTER 03-fixture-compute-jobs.sql, which
-- creates that table with only the columns the ledger-refresh views name. Never
-- a second base: 01-fixture-core.sql remains the only destructive fixture.
--
-- WHAT IS UNDER TEST AND WHAT IS SCAFFOLD. The object under test is the REAL
-- SECURITY DEFINER `get_verified_cohort_rank` from 20260821120000 — its RANK-01
-- computed-analytics gate in BOTH cohort predicates, its SECDEF flag, its
-- pinned search_path, its anon REVOKE and the behavioural cohort delta. This
-- file adds only the three metric columns that function's own predicates and
-- percentile arithmetic name, plus the columns the gate seeds. Their VALUES all
-- come from the gate's own seeds, so no arm can be decided by anything here.
ALTER TABLE public.strategy_analytics
  ADD COLUMN IF NOT EXISTS sharpe       DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS sortino      DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS max_drawdown DOUBLE PRECISION;
