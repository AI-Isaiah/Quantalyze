-- Self-test fixture migration; see 20260101000000_fixture_a.sql. This one has NO
-- ledger row in old-test.sql at all, so the seed must create it.
--
-- ⭐ IT ALSO CARRIES THE ONE ALLOWLISTED REFERENCE STATEMENT (Phase 164.8.1). The
-- INSERT below is the only line in this corpus the restore actually EXECUTES: it
-- is named by `../refdata-allowlist.txt`, extracted by
-- scripts/extract-reference-inserts.mjs and replayed inside the restore
-- transaction. It is UNQUALIFIED on purpose — at the replay site the session's
-- search_path is `pg_catalog`, so an unqualified target only resolves because the
-- replay is bracketed by `SET LOCAL search_path = public, pg_catalog` (RESEARCH
-- Pitfall 1). Delete that bracket and this statement fails to find the table.
--
-- The three labels are exactly the values baseline-fixture.sql's `fx_keep_kind_check`
-- admits, which is what makes the registry/CHECK invariant falsifiable on the lane:
-- arm 23 leg (c) removes one of these rows inside the transaction and the invariant
-- must name it.
--
-- ⛔ TWO STATEMENTS, THREE ROWS — AND THE ASYMMETRY IS THE POINT (Phase 164.8.1,
-- review finding WR-01/WR-02). The in-transaction gate compares ROWS against
-- STATEMENTS (`count(*) >= expected`), so a fixture whose row count exceeds its
-- statement count by MORE than one can never reach the SHORT branch: losing a row
-- still clears the floor. Until 2026-09-09 this file carried ONE statement
-- inserting TWO rows, the allowlist pinned 1, and `2 >= 1` held even after leg (c)
-- deleted a row — the SHORT branch had no falsifier anywhere in the suite.
--
-- The split gives the two legs DIFFERENT reachable verdicts on the same table:
--   leg (c) deletes ONE row  -> 2 rows vs 2 statements, floor holds, the
--                               registry/CHECK invariant is what fires;
--   leg (d) deletes TWO rows -> 1 row  vs 2 statements, the floor BITES and the
--                               SHORT branch names this table.
-- Change the row/statement counts here and both legs must be re-derived.
SELECT 1;

INSERT INTO fx_keep (id, label) VALUES (1, 'ref_a'), (2, 'ref_b') ON CONFLICT (id) DO NOTHING;

INSERT INTO fx_keep (id, label) VALUES (3, 'ref_c') ON CONFLICT (id) DO NOTHING;
