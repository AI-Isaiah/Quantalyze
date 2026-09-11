-- APP-GUC-LINEAGE: retired 2026-09-10; occurrences: 1; successor: notes.txt; reason: points the lineage at a plain-text file, which is not a migration and cannot be where the mechanism went.
--
-- RED fixture for `successor-invalid`, TYPE arm (WR-06 / threat T-164.7-02).
--
-- The paperwork is COMPLETE and agrees with itself: the header parses, its
-- count is the true count, and FIXTURE_ALLOWLIST pins this file with the SAME
-- count and the SAME successor. So nothing else can fire, and the only defect
-- left is the one this fixture is for.
--
-- WHAT WAS WRONG BEFORE. The successor check had ONE arm a reader could
-- satisfy: the named file merely had to EXIST and to contain zero app-GUC
-- reads. 164.7-REVIEW MEASURED both `successor: notes.txt` and
-- `successor: ../out/escaped.md` PASSING. Any file that is not SQL trivially
-- contains zero app-GUC reads, so the second half of the check was free —
-- an exemption satisfied by any readable file of any type.
--
-- ⛔ WHY `notes.txt` BESIDE THIS FILE HOLDS ZERO APP-GUC READS. Because the
-- defect is that a content-CLEAN non-SQL file passed. A target carrying a
-- read-shaped line would be caught by the CONTENT arm instead, and the red
-- could not be attributed to the TYPE arm — MEASURED 2026-09-11 with exactly
-- such a draft: deleting the type arm left the self-test at exit 0, GREEN.
-- With a clean target, deleting the type arm makes THIS fixture fire nothing
-- and the self-test names it. See `notes.txt` itself for the full record.
--
-- MUST fire exactly one finding kind: successor-invalid.

DO $$
DECLARE
  v_url text;
BEGIN
  v_url := current_setting('app.analytics_service_url', TRUE);
  RAISE NOTICE 'url=%', v_url;
END $$;
