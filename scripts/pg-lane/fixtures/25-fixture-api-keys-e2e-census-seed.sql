-- Additive stand-in for the ONE piece of DATA that migration
-- 20260823120000_revoke_api_keys_insert.sql's pre-flight census requires before
-- it will apply at all: an `api_keys` row whose label matches `e2e-%`.
--
-- ⛔ WHY A DATA SEED AND NOT A SCHEMA STUB. That migration's census refuses to
-- guess which database it is on (:139-151). It takes the lenient branch only on
-- POSITIVE evidence of a non-PROD database, and the evidence it accepts is
-- `SELECT count(*) FROM public.api_keys WHERE label LIKE 'e2e-%'` >= 1 — the
-- signature the repo's own e2e seed helper leaves on TEST/CI (its comment cites
-- 3,530 of 3,544 measured rows there, against 0 on PROD). On a virgin lane both
-- signatures are absent and the migration ABORTS with
-- `22000 … unidentified database`, which is what it is supposed to do. So the
-- lane must look like CI, and looking like CI means carrying one seed row.
--
-- ⚠️ WHAT THIS DOES AND DOES NOT MAKE TRUE. It selects the migration's non-PROD
-- BRANCH. It does not weaken anything under test: the REVOKE, the column-comment
-- marker and every structural post-verify below the census run identically on
-- both branches, and it is those objects the gate files assert on. It cannot
-- select the PROD branch either — that one needs `exchange = 'mt5'` rows created
-- on three pinned 2026-08 dates, which this row is deliberately not.
--
-- Apply AFTER 20260811210000 (which adds `attested_venue`) and BEFORE
-- 20260823120000. The row is left un-attested on purpose: the census's e2e
-- branch reports that count and enforces nothing on it, exactly as on CI.
--
-- Read by: supabase/tests/test_api_keys_exchange_not_user_writable.sql
-- (assertion 5c's post-REVOKE polarity and the `5c scrub half` block) and
-- supabase/tests/test_api_keys_insert_not_client_writable.sql (its `:349` gate).
-- Never a second base: 01-fixture-core.sql remains the only destructive fixture.
INSERT INTO public.api_keys (user_id, exchange, label, api_key_encrypted)
SELECT '00000000-0000-0000-0000-0000000000e2'::uuid, 'binance',
       'e2e-census', 'x'
 WHERE NOT EXISTS (
   -- ⚠️ Marker kept SHORT deliberately (2026-09-04): the original 28-character
   -- marker tripped gitleaks' `generic-api-key` rule on the `label = '<28 chars>'`
   -- shape beside `api_keys`, reddening secret-scan on PR #743 twice.
   -- Fixed by renaming the marker, NOT by widening .gitleaks.toml — the literal is
   -- arbitrary and self-contained here, while an allowlist entry would be a permanent
   -- blind spot. The migration census only requires LIKE 'e2e-%'.
   SELECT 1 FROM public.api_keys WHERE label = 'e2e-census'
 );
