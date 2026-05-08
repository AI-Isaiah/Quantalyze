# Phase 19 — Rollback Runbook (per-stage)

**Trigger:** Auto-rollback path needs reinforcement OR manual revert required because the Supabase kill-switch row write itself fails.

## Rollback semantics differ per stage

The 4-PR VIEW-shim sequence creates **three distinct rollback regimes**. Use the section that matches the current state (M-7).

---

## Stage A — post-PR-A, pre-PR-B (verify-strategy UPDATE repointed; flag still off)

In this state, `verify-strategy/route.ts:115` writes to `strategy_verifications` instead of `verification_requests`, but the unified backbone flag is OFF — most traffic still hits legacy routes.

**Rollback:**
1. Revert PR-A on a hotfix branch (`git revert <PR-A-merge-commit>`).
2. `/ship` the revert as `phase-19-shim-step-a-revert:`.
3. No data migration needed; PR-A only repointed the write target.

---

## Stage B — post-PR-B, pre-PR-D (flag is ON; legacy table still exists; no VIEW shim)

In this state, the unified backbone routes new traffic through `/process-key`. The legacy `verification_requests` table is still a real BASE TABLE; no VIEW yet.

**Primary rollback (kill-switch flip):**
1. Verify the kill-switch row state via Supabase MCP:
   `select value, updated_at, updated_by from feature_flags where flag_key='process_key_unified_backbone';`
2. Force-flip via Supabase SQL editor:
   `update feature_flags set value='off', updated_at=now(), updated_by='manual-rollback' where flag_key='process_key_unified_backbone';`
3. Wait 30 seconds for the in-process flag cache (Vercel + Railway) to expire.
4. Verify legacy fallback is serving traffic:
   `curl -s https://quantalyze-rho.vercel.app/api/health/diag | jq '.flags.process_key_unified_backbone'` → `false`.

**Manual fallback (if Supabase itself is unreachable):**
1. Vercel: `vercel env rm PROCESS_KEY_UNIFIED_BACKBONE production` (then `vercel env add PROCESS_KEY_UNIFIED_BACKBONE production` with value `off`).
2. Railway: dashboard → service → Variables → `PROCESS_KEY_UNIFIED_BACKBONE=off`.
3. Restart Vercel + Railway:
   - Vercel: `vercel deploy --prod` (no-op deploy triggers refresh).
   - Railway: dashboard → service → Restart deployment.
4. **Note:** in this stage, the env-var-only path works because legacy `verification_requests` is still a real table — no INSTEAD OF triggers fire on direct UPDATE.

---

## Stage D — post-PR-D (legacy table renamed; VIEW + INSTEAD OF triggers active)

**This is the most dangerous stage to rollback.** PR-D ships migration 107 which renamed `verification_requests` → `verification_requests_legacy` and replaced it with a VIEW that has INSTEAD OF triggers raising SQLSTATE 42501 on writes. **A naive `vercel env rm` here produces hard 500s** because the legacy fallback path tries to UPDATE `verification_requests` and the VIEW's INSTEAD OF trigger raises.

**Primary rollback (kill-switch flip — same as Stage B):**
1. Flip the kill-switch row to `off` (Supabase SQL editor).
2. Wait 30s for cache.
3. **CAUTION:** New /process-key traffic correctly stops, BUT the legacy fallback path WILL hit the VIEW's INSTEAD OF triggers if it tries to UPDATE `verification_requests`. The kill-switch flip alone is **insufficient** if Stage D rollback requires the legacy code path to write.

**Recovery procedure for full-revert (transactional DROP VIEW + RENAME):**
If the kill-switch flip alone doesn't restore service (because the legacy code path needs to write to `verification_requests`), execute this transactional recovery in the Supabase SQL editor:

```sql
BEGIN;
DROP TRIGGER IF EXISTS verification_requests_view_readonly_insert ON verification_requests;
DROP TRIGGER IF EXISTS verification_requests_view_readonly_update ON verification_requests;
DROP TRIGGER IF EXISTS verification_requests_view_readonly_delete ON verification_requests;
DROP VIEW IF EXISTS verification_requests;
ALTER TABLE verification_requests_legacy RENAME TO verification_requests;
COMMIT;
```

Then:
4. Restart Vercel + Railway.
5. Confirm legacy traffic resumed: `curl -s ... /api/verify-strategy/<known-id>/status` returns 200.
6. File `.planning/phase-19/incident-{date}.md` post-mortem.

**Note:** This recovery is `down/107-rollback.sql` per migration-plan.md (C-8). After this rollback, the Phase 19 schema is at the post-PR-B state — re-applying migration 107 in the future requires a fresh 7-day stability window.

---

## Post-Rollback (any stage)

- Open a Sentry issue with the correlation_id chain that triggered the breach.
- File a `.planning/phase-19/incident-{date}.md` post-mortem.
- Decide: re-enable after fix, or ship full Phase 19 revert (heavy — touches 5 entry routes + worker handler + 5 migrations).
