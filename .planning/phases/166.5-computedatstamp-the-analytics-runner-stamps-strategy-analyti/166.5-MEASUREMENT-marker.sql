
-- ============================================================================
-- Phase 166.5 COMPUTEDATSTAMP, plan 08: the database-identity guard that runs
-- ALONE and FIRST before 166.5-MEASUREMENT.sql and 166.5-MEASUREMENT-since.sql.
-- ============================================================================
-- READ-ONLY. It reads one catalogue row and writes nothing.
--
-- Run it from the checkout whose Supabase CLI is linked to PRODUCTION:
--   supabase db query --linked -f <this file>
-- and proceed ONLY when the last line of the answer is `marker OK`. Any error
-- is a stop: the database is not the one this phase measures, or its hand-set
-- identity marker was lost (CLAUDE.md, "Which database am I on?").
--
-- WHAT IT ASSERTS. The database carries a hand-set COMMENT ON DATABASE naming
-- itself. This block requires that comment to be present, to name PRODUCTION
-- (case-insensitive `prod`), and NOT to name TEST as a whole word. The refusal
-- text is one fixed literal and never echoes the comment itself, so a lost or
-- wrong marker is reported without the marker text crossing into this public
-- repository (the comment is also never copied into any tracked file).
--
-- WHY A FILE. The inline form of the CLI breaks on a leading `--` comment, and
-- the same query must be run identically by plan 09 and by the Wave 5 recompute.
-- The first line of this file is blank on purpose.
-- ============================================================================
DO $marker$
DECLARE
  v_marker TEXT;
BEGIN
  SELECT shobj_description(d.oid, 'pg_database')
    INTO v_marker
    FROM pg_database d
   WHERE d.datname = current_database();

  IF v_marker IS NULL
     OR v_marker !~* 'prod'
     OR v_marker ~* '(^|[^[:alnum:]_])test([^[:alnum:]_]|$)' THEN
    RAISE EXCEPTION '166.5 measurement refused: the database identity marker is missing or does not name PRODUCTION. Nothing was read. Re-set or check the marker (CLAUDE.md, Which database am I on) before anything else.';
  END IF;
END
$marker$;

SELECT 'marker OK' AS which_database_check;
