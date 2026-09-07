-- APP-GUC-LINEAGE: retired 2026-09-07; occurrences: 1; successor: does-not-exist.sql; reason: claims the mechanism moved to a file that is not there.
--
-- RED fixture for `successor-invalid`.
--
-- The header parses, its count is the TRUE count, and FIXTURE_ALLOWLIST pins
-- this file with the SAME count and the SAME successor - so the paperwork is
-- complete and reviewed. The claim it makes is still false: there is no
-- `does-not-exist.sql` beside this file.
--
-- WHY THE CHECK EXISTS. `successor:` is the annotation's only forward-looking
-- claim - "the configuration this used to read now lives THERE". An unchecked
-- successor makes that claim free. The check has two arms, and the second
-- matters more: the successor must exist, AND it must itself contain ZERO
-- app-GUC reads, or the lineage merely points at another copy of the same
-- defect. `successor: none` opts out honestly and is not a finding.
--
-- MUST fire exactly one finding kind: successor-invalid.

DO $$
DECLARE
  v_flag text;
BEGIN
  v_flag := current_setting('app.ledger_refresh_enabled', TRUE);
  RAISE NOTICE 'flag=%', v_flag;
END $$;
