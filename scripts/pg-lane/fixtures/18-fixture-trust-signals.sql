-- Additive stand-ins for the Phase 126 / FACTSHEET-01 public trust-signal
-- primitive (20260719140000_get_published_trust_signals.sql). Apply AFTER
-- 13-fixture-csv-finalize-fold.sql, which creates `strategy_verifications`
-- with exactly the columns the csv fold's INSERT names. Never a second base:
-- 01-fixture-core.sql remains the only destructive fixture.
--
-- WHAT IS UNDER TEST AND WHAT IS SCAFFOLD. The object under test is the REAL
-- `get_published_trust_signals(uuid[])` SECURITY DEFINER function from
-- 20260719140000 — its `WHERE s.status = 'published'` gate, its DISTINCT ON
-- recency pick, its RETURNS TABLE allow-list and its anon GRANT. This file adds
-- only `strategy_verifications.created_at`, which the function's
-- `ORDER BY sv.strategy_id, sv.created_at DESC` names as the RECENCY axis of
-- that pick. It is scaffold: the gate seeds exactly one verification per
-- strategy, so no arm in test_get_published_trust_signals.sql can be decided by
-- the ordering — but without the column the function cannot be CREATEd at all.
ALTER TABLE public.strategy_verifications
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT now();
