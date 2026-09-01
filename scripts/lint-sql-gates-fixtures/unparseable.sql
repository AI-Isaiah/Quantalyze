-- MEASURE_FAIL fixture. Not a rule fixture: this file exists to prove that the
-- linter distinguishes "could not measure" from "measured zero problems".
--
-- The inner BEGIN is never closed, so the block structure cannot be resolved
-- and R1's EXCEPTION-handler regions cannot be determined. A linter that
-- reported "0 findings" here would be reporting a pass it never measured —
-- an empty result and a clean result sharing one code path is the same defect
-- class this whole phase exists to eliminate.
DO $$
BEGIN
  BEGIN
    DELETE FROM public.strategy_shares WHERE strategy_id = 1;
END $$;
