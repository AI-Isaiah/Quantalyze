-- RED fixture for `unannotated-reader`, DOLLAR-QUOTED spelling (WR-07).
--
-- THE SPELLING. A dollar-quoted literal carries no apostrophe at all, so a
-- detector anchored on one cannot see the argument. This is the spelling the
-- CONTEXT's nine-member bypass family calls "one token, no splitting": the
-- shape a developer reaches for precisely BECAUSE it needs no quote doubling,
-- which makes it the likeliest of the five to be written by accident rather
-- than in evasion.
--
-- The tag is arbitrary (`$q$` here, `$$` and `$cron$` elsewhere in this repo),
-- so the detector's second alternation accepts any `$[A-Za-z_]*$` tag rather
-- than a fixed one.
--
-- ONE SPELLING PER FIXTURE, DELIBERATELY: deleting the detector's second
-- alternation must make THIS file, and only this file, stop firing.
--
-- The prose above never spells the call out — a comment that did would be a
-- second site in this file and the fixture would stop being a single-site one.
--
-- MUST fire exactly one finding kind: unannotated-reader.

DO $$
DECLARE
  v_key text;
BEGIN
  v_key := current_setting($q$app.analytics_service_key$q$, TRUE);
  RAISE NOTICE 'key present=%', v_key IS NOT NULL;
END $$;
