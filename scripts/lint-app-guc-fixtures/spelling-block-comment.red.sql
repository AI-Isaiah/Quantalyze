-- RED fixture for `unannotated-reader`, BLOCK-COMMENT spelling (WR-07).
--
-- THE SPELLING. Postgres treats a `/* … */` block comment as whitespace, so it
-- may sit between the function name and its opening parenthesis and the call
-- still parses and still runs. A detector whose only gap between the two is
-- `\s*` cannot span it.
--
-- ⚠️ WHY THIS ONE IS NOT MERELY THEORETICAL. It is the cheapest of the five to
-- write and the hardest to spot in review: the reader's text is completely
-- unchanged, and the inserted comment can say anything at all — including
-- something that looks like housekeeping.
--
-- ONE SPELLING PER FIXTURE, DELIBERATELY: deleting the detector's optional
-- block-comment group must make THIS file, and only this file, stop firing.
--
-- The prose above never spells the call out — a comment that did would be a
-- second site in this file and the fixture would stop being a single-site one.
--
-- MUST fire exactly one finding kind: unannotated-reader.

DO $$
DECLARE
  v_flag text;
BEGIN
  v_flag := current_setting/* retained for the 2026-04 rollout */('app.ledger_refresh_enabled', TRUE);
  RAISE NOTICE 'flag=%', v_flag;
END $$;
