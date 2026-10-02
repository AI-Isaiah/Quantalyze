-- RED fixture for `unannotated-reader`, DOUBLED-QUOTE spelling.
--
-- Booked as `[APPGUC-DETECT-DOUBLEQUOTE-01]` and re-found by 164.7-REVIEW
-- WR-07: the gate's detector saw ONE of the six ways Postgres accepts this
-- call, so the other five were a documented way to write a new app-GUC reader
-- that the gate waves through.
--
-- THE SPELLING. Inside an outer single-quoted literal every apostrophe is
-- doubled, so the read below is written with `''` where a free-standing
-- statement would carry `'`. This is not an exotic form: it is what every
-- `cron.schedule()` third argument in this repo looks like, which is exactly
-- where the twelve annotated sites live.
--
-- ONE SPELLING PER FIXTURE, DELIBERATELY. The five spelling fixtures are
-- separate files so a neuter can disable ONE alternation of the detector and
-- watch ONE fixture stop firing. A single combined fixture would still fire on
-- the other four and would prove nothing about the alternation removed.
--
-- The prose above never spells the call out — a comment that did would be a
-- second site in this file and the fixture would stop being a single-site one.
--
-- MUST fire exactly one finding kind: unannotated-reader.

SELECT cron.schedule(
  'example_doubled_quote',
  '* * * * *',
  'DO $$ BEGIN PERFORM current_setting(''app.analytics_service_url'', TRUE); END $$;'
);
