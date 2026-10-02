-- RED fixture for `unannotated-reader`, E-STRING spelling (164.7-REVIEW WR-07).
--
-- THE SPELLING. Postgres accepts an escape-string literal — the `E` prefix —
-- anywhere a plain literal is accepted, and the value is identical. A detector
-- anchored on the bare apostrophe misses it entirely, so prefixing one letter
-- was enough to write a new reader past the gate.
--
-- ONE SPELLING PER FIXTURE, DELIBERATELY: a neuter narrowing the detector's
-- `[EU]` character class to `[U]` must make THIS file, and only this file,
-- stop firing.
--
-- The prose above never spells the call out — a comment that did would be a
-- second site in this file and the fixture would stop being a single-site one.
--
-- MUST fire exactly one finding kind: unannotated-reader.

DO $$
DECLARE
  v_url text;
BEGIN
  v_url := current_setting(E'app.analytics_service_url', TRUE);
  RAISE NOTICE 'url=%', v_url;
END $$;
