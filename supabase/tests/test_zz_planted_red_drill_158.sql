-- ⛔ DRILL FILE — Phase 158 UAT-1 RED-polarity proof. DO NOT MERGE.
-- Purpose: prove the `frontend` aggregator REDs when sql-tests fails
-- (the falsifiability half of the both-polarity requirement). This file
-- exists only on drill/158-uat1-aggregator-red and its draft PR; the PR
-- is closed and the branch deleted once the red is captured.
DO $$
BEGIN
  RAISE EXCEPTION 'PLANTED FAILURE — Phase 158 UAT-1 aggregator red-polarity drill (expected red, not a real defect)';
END
$$;
