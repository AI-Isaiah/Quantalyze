-- Phase 87 (v1.9 multi-key composite strategy) / Plan 87-02 — M-3 publish-integrity
-- delete guard. Requirement: PUB-01 (degrade-not-hole guarantee).
--
-- CLOSES M-3. strategy_keys.api_key_id ... ON DELETE CASCADE
-- (20260710120000_strategy_keys.sql:33) means deleting an api_keys row today
-- SILENTLY shrinks a PUBLISHED composite's membership — no tombstone, no analytics
-- invalidation, no audit. PUB-01's degrade-not-hole guarantee holds at publish
-- time (Plan 03) but reopens the moment a member key is deleted post-publish, and
-- composites can first publish in THIS phase. This adds a fail-loud BEFORE DELETE
-- SECURITY DEFINER trigger on api_keys that RAISEs when the key is a strategy_keys
-- member of a strategy with status='published'.
--
-- GDPR EXEMPTION: sanitize_user (Art. 17 anonymize RPC) DELETEs api_keys BEFORE
-- it archives the tenant's strategies, so without an exemption this guard would
-- abort account / data-deletion-request approval. The guard therefore allows the
-- delete when `quantalyze.sanitize_in_progress = 'on'` (the transaction-local
-- session var sanitize_user sets at entry) — the SAME convention
-- reject_sentinel_writes uses (20260513073518_sanitize_user_hardening.sql:161).
-- No live holed composite results: sanitize archives the strategies in the same
-- transaction. The exemption is scoped to that session var ONLY, NOT
-- service_role/BYPASSRLS, so ordinary service-role key-delete paths stay blocked.
--
-- SCOPE / SC-4 NEUTRALITY: single-key strategies link via strategies.api_key_id
-- (ON DELETE SET NULL — 20260405061911_initial_schema.sql:51), NEVER via
-- strategy_keys, so the EXISTS below cannot match them — their key deletes stay
-- byte-unchanged (pinned by test Part 4). Draft/pending_review/archived composite
-- members are likewise untouched (published-scoped) so the Phase 88 wizard
-- iterate-delete-retry loop is intact (pinned by test Part 3).
--
-- WHY A TRIGGER, NOT `ON DELETE RESTRICT`: RESTRICT is blunter (blocks key deletes
-- for DRAFT composites too) and mutates a live FK. The trigger is additive,
-- published-only, and — because BYPASSRLS skips RLS but NOT triggers
-- (20260710120000_strategy_keys.sql:64) — covers ALL delete callers including
-- service-role paths (delete-allocator-api-key-rpc, ApiKeyManager, account
-- export/deletion) with one DB-layer guard.
--
-- No explicit BEGIN/COMMIT — Supabase wraps each migration in an implicit
-- transaction (migration-reviewer invariant #14). SET LOCAL lock_timeout applies
-- to that implicit wrap.

SET LOCAL lock_timeout = '3s';

-- 1. The guard function (parity with enforce_strategy_keys_owner_coherence):
--    SECURITY DEFINER + baked search_path so a published-membership read is not
--    subject to search_path hijack, and fires for service-role writers too.
CREATE OR REPLACE FUNCTION public.enforce_api_keys_published_composite_integrity()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public', 'pg_catalog'
AS $function$
BEGIN
  -- GDPR / account-decommission exemption: sanitize_user (the Art. 17
  -- anonymize-not-delete RPC) DELETEs api_keys BEFORE it archives the tenant's
  -- strategies, so at key-delete time the composite is still status='published'
  -- and this guard would abort the entire sanitize transaction (account /
  -- data-deletion-request approval fails). sanitize_user signals its path via
  -- `SET LOCAL quantalyze.sanitize_in_progress = 'on'` (transaction-local); the
  -- reject_sentinel_writes trigger (20260513073518_sanitize_user_hardening.sql:161)
  -- already exempts that same session var. Mirror that convention: allow the
  -- delete when the flag is on. This does NOT leave a live holed published
  -- composite — sanitize archives the strategies in the SAME transaction, so no
  -- published composite persists past commit. Scoped to the session var ONLY
  -- (NOT service_role/BYPASSRLS): the normal user key-delete paths (ApiKeyManager,
  -- delete-allocator-api-key-rpc) also run as service_role and MUST still be
  -- blocked when they would hole a LIVE published composite — that is M-3's point.
  IF current_setting('quantalyze.sanitize_in_progress', true) = 'on' THEN
    RETURN OLD;
  END IF;

  -- M-3: a PUBLISHED composite must never be silently holed by a member-key
  -- delete. RAISE only when OLD.id is a strategy_keys member of a published
  -- strategy — draft/pending_review/archived members and single-key links (which
  -- go through strategies.api_key_id, not strategy_keys) never match.
  IF EXISTS (
    SELECT 1
      FROM public.strategy_keys sk
      JOIN public.strategies s ON s.id = sk.strategy_id
     WHERE sk.api_key_id = OLD.id
       AND s.status = 'published'
  ) THEN
    -- Least-disclosure (ADR-0020): this fn is SECURITY DEFINER and reads
    -- strategy_keys / strategies past their owner-only RLS, so the client-facing
    -- error MUST NOT echo any owner id or leak the existence of another tenant's
    -- strategy — that would turn a failed DELETE into an ownership/existence
    -- oracle. The message is a single constant literal (no interpolation); the
    -- foreign_key_violation ERRCODE gives callers a stable arm.
    RAISE EXCEPTION 'api_keys: cannot delete a key that is a member of a published composite — detach the key or archive the strategy first'
      USING ERRCODE = 'foreign_key_violation';
  END IF;
  RETURN OLD;
END;
$function$;

-- Trigger function: never invocable via PostgREST RPC. Revoke from the API roles
-- too (not just PUBLIC) — matches the SECDEF trigger-function convention
-- (enforce_strategy_keys_owner_coherence) and clears the anon/authenticated
-- SECURITY DEFINER-executable advisor.
REVOKE ALL ON FUNCTION public.enforce_api_keys_published_composite_integrity() FROM PUBLIC, anon, authenticated;

-- 2. The repo's first BEFORE DELETE trigger. BEFORE (not AFTER) so the RAISE vetoes
--    the delete before the ON DELETE CASCADE removes the strategy_keys member.
CREATE TRIGGER api_keys_published_composite_delete_guard
  BEFORE DELETE ON public.api_keys
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_api_keys_published_composite_integrity();

-- 3. Self-verifying DO block — fail loud at apply if any structural element
--    drifted. Each RAISE format string is a single literal (Phase 85 invariant #21).
DO $$
DECLARE
  v_oid    OID;
  v_secdef BOOLEAN;
  v_fn     TEXT;
  v_tgtype INT2;
BEGIN
  -- (a) the BEFORE DELETE ROW guard trigger exists on public.api_keys.
  SELECT tgtype INTO v_tgtype
    FROM pg_trigger
   WHERE tgrelid = 'public.api_keys'::regclass
     AND NOT tgisinternal
     AND tgname = 'api_keys_published_composite_delete_guard';
  IF v_tgtype IS NULL THEN
    RAISE EXCEPTION 'publish-integrity migration: BEFORE DELETE guard trigger missing on public.api_keys';
  END IF;
  -- tgtype bits: ROW=1, BEFORE=2, DELETE=8.
  IF (v_tgtype & 1) = 0 THEN
    RAISE EXCEPTION 'publish-integrity migration: guard trigger is not FOR EACH ROW';
  END IF;
  IF (v_tgtype & 2) = 0 THEN
    RAISE EXCEPTION 'publish-integrity migration: guard trigger is not BEFORE';
  END IF;
  IF (v_tgtype & 8) = 0 THEN
    RAISE EXCEPTION 'publish-integrity migration: guard trigger does not fire on DELETE';
  END IF;

  -- (b) the function is SECURITY DEFINER with a baked search_path.
  SELECT p.oid, p.prosecdef, pg_get_functiondef(p.oid)
    INTO v_oid, v_secdef, v_fn
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public'
     AND p.proname = 'enforce_api_keys_published_composite_integrity';
  IF v_oid IS NULL THEN
    RAISE EXCEPTION 'publish-integrity migration: guard function missing';
  END IF;
  IF NOT v_secdef THEN
    RAISE EXCEPTION 'publish-integrity migration: guard function is not SECURITY DEFINER';
  END IF;
  IF v_fn !~* 'search_path' THEN
    RAISE EXCEPTION 'publish-integrity migration: guard function has no baked SET search_path';
  END IF;

  -- (c) the guard is scoped to published composites (the fail-without-fix anchor
  --     for this migration: a scope regression reddens here and in test Part 3).
  IF v_fn !~* 'status\s*=\s*''published''' THEN
    RAISE EXCEPTION 'publish-integrity migration: guard body is not scoped to status = published';
  END IF;

  -- (c2) the GDPR sanitize exemption is present: the body must reference the
  --      sanitize_in_progress session var so a future edit that drops the
  --      exemption (re-breaking account deletion) reddens here at apply.
  IF v_fn !~* 'sanitize_in_progress' THEN
    RAISE EXCEPTION 'publish-integrity migration: guard body dropped the sanitize_in_progress exemption (would abort GDPR account deletion)';
  END IF;

  -- (d) least-privilege: EXECUTE not reachable by the API roles.
  IF has_function_privilege('anon', v_oid, 'EXECUTE') THEN
    RAISE EXCEPTION 'publish-integrity migration: anon can EXECUTE the guard function (REVOKE missing)';
  END IF;
  IF has_function_privilege('authenticated', v_oid, 'EXECUTE') THEN
    RAISE EXCEPTION 'publish-integrity migration: authenticated can EXECUTE the guard function (REVOKE missing)';
  END IF;

  RAISE NOTICE 'publish-integrity migration self-check passed (BEFORE DELETE ROW guard, SECDEF + search_path + published scope, sanitize exemption present, EXECUTE revoked).';
END $$;
