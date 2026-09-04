-- ===========================================================================
-- THE `lane-blocked` PAIR — lane-blocked-gate.sql and
-- lane-blocked-comment-only-gate.sql (164.4-03)
-- ===========================================================================
--
-- ⚠️ This header is BYTE-IDENTICAL in both members, and must stay that way —
-- the vitest arm below reconstructs one member from the other and compares
-- whole files. So it can never say "this file": a shared header cannot
-- resolve that deictically, and it read as "this file and this file" in
-- lane-blocked-gate.sql (review IN-06, 2026-09-04). Each member is named
-- explicitly instead, here and in every claim below, so the header states
-- what EACH member demonstrates no matter which one you opened.
--
-- Two idiom gates — a `TEST FAILED (…)` RAISE directly in a `DO $$` body — that
-- are BYTE-IDENTICAL except for the three `--` markers on the pg_cron guard
-- below. `lane-blocked-comment-only-gate.sql` has the guard commented out;
-- `lane-blocked-gate.sql` has it live. Nothing else differs, and the parser's
-- vitest file asserts that byte identity, so the pair cannot drift into two
-- unrelated fixtures whose classification difference has another cause.
--
-- WHAT THE PAIR PROVES. `gateNeedsPgCron` reads `pg_extension` off
-- `executableText`, which blanks comments, and `'pg_cron'` off the same
-- statement's RAW text, because the masking projection blanks literals. So the
-- commented member classifies `pending` and the live member classifies
-- `lane-blocked`: the derivation reads CODE, not prose. A `grep pg_cron` would
-- call both blocked and defer a file nothing on the lane can block.
--
-- Deliberately carries NO RED-UNDER marker, in BOTH members: `scanCorpus`
-- classifies only UNANNOTATED files, so annotating either one would make the
-- control vacuous rather than red.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    RAISE EXCEPTION 'TEST FAILED (LANEBLOCK 1): pg_cron is NOT installed on this database.';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_class WHERE relname = 'pg_class') THEN
    RAISE EXCEPTION 'TEST FAILED (LANEBLOCK 2): the catalog is missing pg_class, which cannot happen.';
  END IF;
END $$;
