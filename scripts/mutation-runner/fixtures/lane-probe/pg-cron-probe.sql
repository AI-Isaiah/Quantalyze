-- ===========================================================================
-- THE LANE PROBE — can THIS lane host pg_cron? (phase 164.4-03, T-164.4-11)
-- ===========================================================================
--
-- Driven once per lane-spawning run by scripts/mutation-runner/run.mjs as the
-- `probe` leg, through the same scripts/pg-lane/run.sh every other leg uses.
--
-- WHY IT EXISTS. `run.mjs` prints a derived `lane-blocked:` class naming the
-- idiom gate files that probe `pg_extension` for pg_cron, with the reason
-- "which the pg-lane cannot host". That reason is a fact about the LANE, and
-- nothing in the derivation measures the lane. A reason that cannot expire is
-- the control-that-cannot-fail this phase exists to remove: install pg_cron on
-- the lane tomorrow and a derived-only class would keep printing four blocked
-- files forever, with 100 sections parked behind a line that still reads true.
--
-- ⛔ `pg_available_extensions`, NOT `pg_extension`. The question is what the
-- BINARY the lane booted could install — its control files on disk — not what
-- this throwaway database happens to have created. Asking `pg_extension` here
-- would answer "no" forever on a fresh cluster even after pg_cron was
-- installed on the runner, which is the false-negative that would keep the
-- deferral alive by construction.
--
-- ⛔ AVAILABLE is an EXCEPTION and absent is a NOTICE, on purpose. The runner
-- reads the MARKER, never the exit status, so the direction is not load-bearing
-- for it — but a human reading a lane log must see the interesting case
-- loudly. Neither branch is a verdict about the corpus; run.mjs decides that.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_available_extensions WHERE name = 'pg_cron') THEN
    RAISE EXCEPTION 'LANE-PROBE: pg_cron AVAILABLE';
  END IF;
  RAISE NOTICE 'LANE-PROBE: pg_cron absent';
END $$;
