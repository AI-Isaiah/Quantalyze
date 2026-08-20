---
phase: 125
slug: worker-dedicated-backfill-worker-retention-hygiene
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-07-19
---

# Phase 125 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | pytest 8.x (analytics-service) + supabase/tests SQL (pgTAP-style) |
| **Config file** | `analytics-service/pytest.ini` |
| **Quick run command** | `cd analytics-service && python -m pytest tests/ -x -q -k worker` |
| **Full suite command** | `cd analytics-service && python -m pytest -n auto` |
| **Estimated runtime** | ~120 seconds |

---

## Sampling Rate

- **After every task commit:** Run the quick worker-scoped pytest.
- **After every plan wave:** Run the full analytics-service suite.
- **Before `/gsd:verify-work`:** Full suite green + SQL retention test green.
- **Max feedback latency:** ~120 seconds.

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 125-01-xx | 01 | 1 | WORKER-04 | T-125-01 | purge cron DELETEs only `running` rows older than 2h window (>40-min max watchdog); schema-qualified `public.compute_jobs`, no GRANT widening; `retention_delete_guard` respected | sql | `supabase/tests/test_retention_orphaned_running.sql` via CI | ❌ W0 | ⬜ pending |
| 125-02-xx | 02 | 1 | WORKER-02 | — | hung crawl times out end-to-end via real seam; worker stays live; healthz 200 mid-backfill / 503 when stale | integration | `python -m pytest tests/test_worker_isolation_e2e.py` | ❌ W0 | ⬜ pending |
| 125-03-xx | 03 | 2 | WORKER-04 | — | [BLOCKING] MCP apply to TEST before guard; one-time orphan cleanup scoped; failed_final untouched | runtime | (MCP apply + guard green + fence-tests serial) | ✅ | ⬜ pending |
| 125-04-xx | 04 | 2 | WORKER-01, WORKER-03 | — | dedicated backfill worker claims ONLY BACKFILL_KINDS; reschedule is LIVE op, never a migration | runbook + human_needed | (founder LIVE cutover + reschedule checkpoint; disjointness proven in 125-02) | ✅ | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `supabase/tests/test_retention_orphaned_running.sql` — presence-gated; EXECUTEs the deployed `cron.job.command` as its oracle, asserts `running` rows older than the window are purged and younger/other-status rows survive (WORKER-04).
- [ ] `analytics-service/tests/test_worker_isolation_e2e.py` — end-to-end hung-crawl timeout via the real seam + healthz-during-backfill + claim-payload disjointness (WORKER-02).

*Existing infrastructure covers claim-role scoping (WORKER-01) — `tests/test_main_worker.py` already exercises `WORKER_CLAIM_ROLE`.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Second Railway backfill service stood up with `WORKER_CLAIM_ROLE=backfill`; interactive worker flipped to `interactive` | WORKER-01 | Founder LIVE Railway topology op — cannot be automated in CI | Runbook: create dedicated service, set env, verify each claims only its kinds via logs |
| Cron reschedule `cron.schedule('derive-allocator-key-dailies','30 5 * * *')` | WORKER-03 | Founder LIVE SQL op — NEVER a migration (auto-apply + skipped deploy re-wedges) | Runbook: run SQL against prod, confirm `cron.job` schedule = `30 5 * * *` |
| One-time test-project orphan cleanup to green CI immediately | WORKER-04 | LIVE DELETE via Supabase MCP against test project | `DELETE FROM compute_jobs WHERE status='running' AND created_at < now()-interval '1 hour'` on test |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 120s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
