-- Phase 95 / PROG-02 — set_compute_job_progress: a claim-token-fenced
-- JSONB-merge RPC the stitch worker calls best-effort to publish per-member
-- progress into compute_jobs.metadata (the poll route in plan 95-03 reads it).
--
-- Why this migration exists
-- -------------------------
-- The composite stitch is a long (multi-minute, multi-member) crawl. Today the
-- wizard poller sees only pending → running → done with no per-key visibility,
-- and plan 95-03's stall detector needs a heartbeat to distinguish a healthy
-- slow crawl from an interrupted worker. This RPC lets the worker merge a
-- `member_progress` array plus a server-stamped `member_progress_at` heartbeat
-- into metadata WITHOUT clobbering the pre-existing keys (`source`,
-- `correlation_id`, and the Phase-19 `unified_backbone_at_claim` snapshot).
--
-- Fence (T-95-03, watchdog-reclaim race safety)
-- ---------------------------------------------
-- Mirrors the P97 claim-token fence on mark_compute_job_done /
-- mark_compute_job_failed / defer_compute_job (migrations 117 /
-- 20260515114555, 20260529170000). The UPDATE only fires when the caller's
-- token matches the row's live token AND the token is non-NULL AND the row is
-- still 'running':
--   * a mismatched token no-ops (a watchdog reclaim + re-claim by another
--     worker rotated the token — the preempted worker must not write);
--   * a NULLed token no-ops (reset_stalled_compute_jobs NULLs claim_token on
--     reclaim — the old owner can never write after reclaim);
--   * a non-'running' row no-ops (a done / failed row is terminal).
-- Best-effort semantics: RETURN FOUND (no exception on a no-op). The worker
-- treats false as "lost ownership, stop writing progress" and NEVER fails the
-- stitch on a progress-write blip (progress is a cosmetic side-channel; the
-- stitch is authoritative).
--
-- Privilege (T-95-04, elevation)
-- ------------------------------
-- SECURITY DEFINER but REVOKE ALL FROM PUBLIC, anon, authenticated; GRANT
-- EXECUTE TO service_role only. The worker is the sole caller. Browser
-- projection of member_progress happens ONLY via get_user_compute_jobs (RLS-
-- scoped read), never by calling this RPC. The SQL gate asserts
-- has_function_privilege false for anon + authenticated.
--
-- Secrets (T-95-02, info disclosure)
-- ----------------------------------
-- This RPC merges whatever JSONB the worker sends. The secretless boundary is
-- enforced WORKER-SIDE (field-by-field {seq, exchange, label, status} entries,
-- never a key_row spread) and pinned by pytest Test 5 (recursive no-ciphertext
-- assertion). No key material is ever built into a progress payload.
--
-- Delete-guard exemption: N/A. This migration creates NO BEFORE DELETE /
-- ON DELETE RESTRICT guard, so the sanitize_in_progress GUC exemption rule
-- (account-deletion cascade) does not apply here.
--
-- Migration discipline: `grep -rn set_compute_job_progress supabase/migrations`
-- confirmed NO prior definition — this is a NEW function (nothing to re-base).
-- Timestamp 20260712130000 is after the current latest (20260712120000).
--
-- Post-land routing (user decision 4): migration-reviewer + rls-policy-auditor
-- review this migration AFTER it lands. It auto-applies to PROD on the
-- milestone merge (supabase-migrate-auto-on-push).

BEGIN;

CREATE OR REPLACE FUNCTION set_compute_job_progress(
  p_job_id      UUID,
  p_claim_token UUID,
  p_progress    JSONB
) RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
BEGIN
  -- Fenced JSONB merge: `||` replaces ONLY the member_progress /
  -- member_progress_at keys and preserves every other metadata key
  -- (source, correlation_id, unified_backbone_at_claim). member_progress_at
  -- is stamped SERVER-SIDE via now() so the 95-03 stall heartbeat cannot be
  -- back-dated by a lagging worker clock.
  UPDATE compute_jobs
     SET metadata = COALESCE(metadata, '{}'::jsonb)
                 || jsonb_build_object(
                      'member_progress',    p_progress,
                      'member_progress_at', to_jsonb(now())
                    )
   WHERE id = p_job_id
     AND claim_token IS NOT DISTINCT FROM p_claim_token
     AND claim_token IS NOT NULL
     AND status = 'running';
  RETURN FOUND;
END;
$$;

COMMENT ON FUNCTION set_compute_job_progress(UUID, UUID, JSONB) IS
  'Phase 95 / PROG-02: claim-token-fenced JSONB-merge of per-member stitch '
  'progress (member_progress array) + a server-stamped member_progress_at '
  'heartbeat into compute_jobs.metadata. Merges (||) so source / correlation_id '
  '/ unified_backbone_at_claim survive. Fence mirrors the P97 mark/defer RPCs '
  '(claim_token IS NOT DISTINCT FROM p_claim_token AND claim_token IS NOT NULL '
  'AND status=running): a stale/NULLed token or a non-running row no-ops. '
  'Best-effort — RETURN FOUND, never raises; the worker treats false as lost '
  'ownership and never fails the stitch. service_role only. See migration '
  '20260712130000 + .planning/phases/95-stitch-progress-transparency/.';

REVOKE ALL ON FUNCTION set_compute_job_progress(UUID, UUID, JSONB) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION set_compute_job_progress(UUID, UUID, JSONB) TO service_role;

COMMIT;
