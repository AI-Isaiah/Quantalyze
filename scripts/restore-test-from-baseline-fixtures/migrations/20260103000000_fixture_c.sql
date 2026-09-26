-- Self-test fixture migration; see 20260101000000_fixture_a.sql. This one has NO
-- ledger row in old-test.sql at all, so the seed must create it.
--
-- ⭐ IT ALSO CARRIES THE ONE ALLOWLISTED REFERENCE STATEMENT (Phase 164.8.1). The
-- INSERT below is the only line in this corpus the restore actually EXECUTES: it
-- is named by `../refdata-allowlist.txt`, extracted by
-- scripts/extract-reference-inserts.mjs and replayed inside the restore
-- transaction. It is UNQUALIFIED on purpose — at the replay site the session's
-- search_path is `pg_catalog`, so an unqualified target only resolves because the
-- replay is bracketed by `SET LOCAL search_path = pg_catalog, public` (RESEARCH
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

-- 164.9-07: row 1's `status` is set explicitly to 'verified' — the fixture
-- analog of a row's POST-migration value, read by ARM_WRONGSTATE_* (arms
-- 31/32) via `public.fx_keep`.`status`. Row 2 omits the column and is left at
-- the schema DEFAULT ('newbie'), the analog of a row an UPDATE-only-scoped
-- replay never revisits. Neither the ROW count nor the STATEMENT count moved,
-- so arm 23 legs (c)/(d) and arm 24 leg (a)'s pinned 2-over-3 shape are
-- unaffected — only a THIRD column on an EXISTING statement.
INSERT INTO fx_keep (id, label, status) VALUES (1, 'ref_a', 'verified'), (2, 'ref_b', DEFAULT) ON CONFLICT (id) DO NOTHING;

INSERT INTO fx_keep (id, label) VALUES (3, 'ref_c') ON CONFLICT (id) DO NOTHING;

-- 164.9.2 C5: row 3 is inserted above WITHOUT `status`, so it starts at the
-- fixture's schema DEFAULT ('newbie'). This UPDATE is the fixture analog of
-- 20260521150000_universal_signup_approval_gate.sql's sentinel UPDATE: a
-- literal top-level UPDATE of a row the replay itself just wrote. The fixture
-- allowlist names it on an `update:1` line placed ABOVE the INSERT line, so only
-- the extractor's (basename, offset) sort replays it after the row exists (arm
-- 33). It adds no row and no INSERT statement, so arm 22's counts, arm 23 legs
-- (c)/(d) and arm 24's 2-over-3 shape are unaffected.
-- CORRECTED 2026-09-25 (164.9.2 review round 1, WR-04): "only the extractor's
-- (basename, offset) sort" is false (plan 03 SUMMARY deviation 1): the emit
-- pushes INSERT blocks before C5 blocks, so without the sort this file still
-- replays INSERT, INSERT, UPDATE. Arm 38 goes RED if blocks are emitted in
-- allowlist-line order; sort removal alone is caught by the extractor self-test's `c5-update-count-drift.green` ORDER leg, not here. The sentence above is kept as lineage.
UPDATE fx_keep SET status = 'verified' WHERE id = 3;

-- 164.9.2 review SFH-06: a JOINED UPDATE of fx_keep, accounted for by the fixture
-- allowlist's decline:1 line and therefore NEVER replayed (it reaches no row: no
-- fx_keep id is 0). Arm 38 reads the restore log's note NAMING it by file, line
-- and table: the evidence that a successful restore records what it deliberately
-- did not replay. It adds no row and no INSERT, so every count above is unmoved.
UPDATE fx_keep SET label = s.label FROM fx_keep s WHERE s.id = fx_keep.id AND s.id = 0;

-- 164.9.1-05 ([164.9-TEST-ANALYTICS-URL-REARM]): the fixture analog of the
-- analytics destination seed in
-- supabase/migrations/20260907120000_analytics_service_settings_and_vault_tick.sql,
-- same statement shape (unqualified target, ON CONFLICT (key) DO NOTHING). The
-- value is the normalize self-test's SYNTHETIC stand-in for a PROD-shaped host,
-- never a real host. The restore replays it and then, inside the same
-- transaction, the normalisation fragment rewrites it to the loopback sink: arm
-- 33 reads the sink after a COMMIT, arm 34 reads this stand-in after a ROLLBACK.
-- It is added HERE, below the fx_keep statements, so the fixture ledger keeps its
-- three rows, the fx_keep statements keep their line numbers, and the replay's
-- first unqualified statement is still an fx_keep one (arm 23 leg (b) names it).
INSERT INTO system_settings (key, value) VALUES ('analytics_service_url', 'https://selftest-stand-in.up.railway.app') ON CONFLICT (key) DO NOTHING;
