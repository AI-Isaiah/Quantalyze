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
-- The two labels are exactly the values baseline-fixture.sql's `fx_keep_kind_check`
-- admits, which is what makes the registry/CHECK invariant falsifiable on the lane:
-- arm 23 leg (c) removes one of these rows inside the transaction and the invariant
-- must name it.
SELECT 1;

INSERT INTO fx_keep (id, label) VALUES (1, 'ref_a'), (2, 'ref_b') ON CONFLICT (id) DO NOTHING;
