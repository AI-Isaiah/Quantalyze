-- RED fixture for `unannotated-reader`, UNICODE-STRING spelling (WR-07).
--
-- THE SPELLING. `U&'…'` is Postgres's unicode-escape string literal. Its plain
-- characters are ordinary characters, so the argument below reads exactly like
-- the single-quoted form at runtime — but the two-character `U&` prefix moves
-- the apostrophe away from the opening parenthesis, and a detector anchored
-- there stops seeing it.
--
-- ⚠️ This is member (f) of the CONTEXT's measured nine-member bypass family,
-- which is why it is a fixture rather than a hypothetical: the same prefix was
-- measured defeating the cron-drift header rules in the same phase.
--
-- ONE SPELLING PER FIXTURE, DELIBERATELY: a neuter narrowing the detector's
-- `[EU]` character class to `[E]` must make THIS file, and only this file,
-- stop firing.
--
-- The prose above never spells the call out — a comment that did would be a
-- second site in this file and the fixture would stop being a single-site one.
--
-- MUST fire exactly one finding kind: unannotated-reader.

DO $$
DECLARE
  v_email text;
BEGIN
  v_email := current_setting(U&'app.admin_email', TRUE);
  RAISE NOTICE 'admin=%', v_email;
END $$;
