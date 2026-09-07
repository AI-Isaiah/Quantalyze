-- APP-GUC-LINEAGE: retired 2026-09-07; occurrences: 2; successor: successor-target.green.sql; reason: worked example - one executable site and one commented site, both retired to a settings table.
--
-- GREEN fixture: an ANNOTATED file. Two app-GUC reads are present and the
-- header pins exactly two, so the count ratchet is satisfied in both
-- directions - adding a third read or deleting one makes this file RED.
--
-- Note the header itself says "app-GUC read" in prose and never spells the call
-- out; a header that spelled it out would match the detector and count as a
-- site of its own.
--
-- MUST fire nothing (its FIXTURE_ALLOWLIST entry pins the same 2 / same successor).

DO $$
DECLARE
  v_url text;
BEGIN
  -- Site 1 (executable, retired): v_url := current_setting('app.analytics_service_url', TRUE);
  SELECT value INTO v_url FROM example_settings WHERE key = 'analytics_service_url';
  RAISE NOTICE 'url=%', v_url;
END $$;

DO $$
DECLARE
  v_key text;
BEGIN
  -- Site 2, historical, never executed again:
  v_key := current_setting('app.analytics_service_key', TRUE);
  RAISE NOTICE 'key present=%', v_key IS NOT NULL;
END $$;
