-- Self-test fixture migration; see 20260101000000_fixture_a.sql. This one is the
-- twin of the RE-STAMPED ledger row in old-test.sql: that row carries
-- version='20260117093312', name='20260102000000_fixture_b', which is the exact
-- shape `supabase db push` reports as ErrMissingLocal. The restore REPLACES it.
SELECT 1;
