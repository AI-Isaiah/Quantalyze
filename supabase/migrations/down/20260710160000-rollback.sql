-- ============================================================================
-- ROLLBACK for 20260710160000_api_keys_published_composite_delete_guard.sql
-- Phase 87 / Plan 87-02 — M-3 publish-integrity delete-guard reversal.
-- ============================================================================
-- This migration created NEW objects (a BEFORE DELETE trigger + its SECDEF
-- function), so the down is drop-style (contrast a CREATE OR REPLACE re-base,
-- whose down restores the prior body). DROP the trigger first, then its function.
-- ============================================================================

DROP TRIGGER IF EXISTS api_keys_published_composite_delete_guard ON public.api_keys;

DROP FUNCTION IF EXISTS public.enforce_api_keys_published_composite_integrity();

-- Self-verifying DO block — fail loud if either object survived the rollback.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_trigger
     WHERE tgname = 'api_keys_published_composite_delete_guard'
       AND tgrelid = 'public.api_keys'::regclass
       AND NOT tgisinternal
  ) THEN
    RAISE EXCEPTION 'rollback failed: BEFORE DELETE guard trigger still present on public.api_keys';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
       AND p.proname = 'enforce_api_keys_published_composite_integrity'
  ) THEN
    RAISE EXCEPTION 'rollback failed: guard function enforce_api_keys_published_composite_integrity still present';
  END IF;
  RAISE NOTICE 'rollback OK: publish-composite delete guard (trigger + function) removed.';
END $$;
