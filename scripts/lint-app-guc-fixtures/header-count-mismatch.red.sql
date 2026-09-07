-- APP-GUC-LINEAGE: retired 2026-09-07; occurrences: 1; successor: none; reason: deliberately UNDER-counts - the file below holds two sites, so the ratchet must catch the second.
--
-- RED fixture for `header-count-mismatch`.
--
-- The header is well-formed and its FIXTURE_ALLOWLIST entry agrees with it
-- exactly (occurrences 1, successor none), so nothing else can fire. What is
-- wrong is the WORLD, not the paperwork: the file holds TWO app-GUC reads.
--
-- This is the shape the exact-count ratchet exists for. An annotation that said
-- only "this file is historical" would absorb every future reader written into
-- it; an annotation that pins a NUMBER cannot. The ratchet tightens in both
-- directions - one MORE read is a smuggled reader, one FEWER is a stale
-- annotation, and both are findings.
--
-- The second site below is written with irregular spacing so the detector's
-- `\s*` arms are exercised rather than assumed.
--
-- MUST fire exactly one finding kind: header-count-mismatch.

DO $$
DECLARE
  v_url text;
  v_key text;
BEGIN
  v_url := current_setting('app.analytics_service_url', TRUE);
  v_key := current_setting ( 'app.analytics_service_key', TRUE);
  RAISE NOTICE 'url=% key_present=%', v_url, v_key IS NOT NULL;
END $$;
