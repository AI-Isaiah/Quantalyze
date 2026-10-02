-- APP-GUC-LINEAGE: retired 2026-09-07; occurrences: 1; successor: none; reason: a perfectly well-formed header on a file the script does not pin - which must not be enough.
--
-- RED fixture for `header-not-allowlisted` (threat T-164.7-01).
--
-- Everything here is RIGHT except the one thing that matters: the header parses,
-- its count is the TRUE count, its successor is `none`, and yet the file is
-- deliberately ABSENT from FIXTURE_ALLOWLIST.
--
-- WHY THAT IS A FINDING. If a header alone exempted a file, a brand-new
-- migration could exempt ITSELF by carrying one - and the whole gate would be
-- "an exemption any comment satisfies", this milestone's named defect. Making
-- the exemption require a second, count-pinned edit inside the script means it
-- lands in code review rather than inside the migration it excuses.
--
-- MUST fire exactly one finding kind: header-not-allowlisted.

DO $$
DECLARE
  v_email text;
BEGIN
  v_email := current_setting('app.admin_email', TRUE);
  RAISE NOTICE 'admin=%', v_email;
END $$;
