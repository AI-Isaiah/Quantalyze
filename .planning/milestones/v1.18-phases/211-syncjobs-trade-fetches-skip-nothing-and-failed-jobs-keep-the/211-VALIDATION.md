---
phase: "211"
slug: "syncjobs-trade-fetches-skip-nothing-and-failed-jobs-keep-the"
# status lifecycle: draft (seeded by plan-phase) → validated (set by validate-phase §6)
# audit-milestone §5.5 distinguishes NOT-VALIDATED (draft) from PARTIAL (validated + nyquist_compliant: false) (#2117)
status: validated
nyquist_compliant: true
wave_0_complete: true
created: "2026-11-14"
---

# Phase 211 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | pytest (analytics-service), vitest (frontend), PL/pgSQL gates on the throwaway pg-lane plus the mutation runner |
| **Config file** | `analytics-service/pyproject.toml`, `vitest.config.ts`, `scripts/mutation-runner/GRAMMAR.md` |
| **Quick run command** | the task's own `<automated>` command (a named pytest file from `analytics-service/`, one vitest file, or the pg-lane gate run) |
| **Full suite command** | `cd analytics-service && pytest -n auto --dist loadgroup --cov=services --cov=routers --cov=main_worker --cov-report=term-missing --cov-fail-under=80`; `npm test`; the subset mutation run `node scripts/mutation-runner/run.mjs --subset-from <list>` |
| **Estimated runtime** | ~211 seconds (quick); the full pytest and `npm test` take longer |

---

## Sampling Rate

- **After every task commit:** Run the task's own `<automated>` command
- **After every plan wave:** Run the full suite commands above that the wave's files touch (pytest for analytics-service, `npm test` for frontend, the subset mutation run for SQL gates)
- **Before `/gsd-verify-work`:** Full suite must be green
- **Max feedback latency:** 211 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 211-01-01 | 01 | 1 | SC-1 | T-211-01 | the route seeds from the stored high-water, never from `last_sync_at` | unit | `cd analytics-service && python3 -m pytest tests/test_fetch_trades_resume_seed.py tests/test_exchange_router_c0202.py -q` | ✅ | ✅ green |
| 211-01-02 | 01 | 1 | SC-1, SC-4 | T-211-02, T-211-03 | a failed read fails open to full reach; neuters N1, N2 RED | unit | `cd analytics-service && python3 -m pytest tests/test_fetch_trades_resume_seed.py tests/test_exchange_router_c0202.py tests/test_cron_router.py ... -q` plus CI mypy strict | ✅ | ✅ green |
| 211-02-01 | 02 | 1 | SC-3 | T-211-04 | `_stamp_failed` reads the entry snapshot, not live status | unit | `cd analytics-service && python3 -m pytest tests/test_stitch_composite_entry_snapshot.py tests/test_stitch_composite_job.py -q` | ✅ | ✅ green |
| 211-02-02 | 02 | 1 | SC-3, SC-4 | T-211-05 | transient and programming errors keep their taxonomy; neuters N1 to N3 RED | unit | plan 02 task 2 pytest set plus CI mypy strict | ✅ | ✅ green |
| 211-03-01 | 03 | 1 | SC-2, SC-4 | T-211-06, T-211-08 | SITE-A records and retracts; the migration's own verify passes on the pg-lane | sql gate | pg-lane gate run plus `--subset-from` (plan 03 task 1) | ✅ | ✅ green |
| 211-03-02 | 03 | 1 | SC-2 | T-211-07, T-211-09 | snapshots, name-set ratchet, COMPARED_FLOOR and VAC-04 pragmas current | static | `npm run schema:functions:check` | ✅ | ✅ green |
| 211-03-03 | 03 | 1 | SC-2 | T-211-10, T-211-11 | rollback restores the pre-D11 bodies; ten existing enqueue gates pass on the new body | sql gate | pg-lane recipe (plan 03 task 3) | ✅ | ✅ green |
| 211-04-01 | 04 | 2 | SC-1 | T-211-12 | the queued sync seeds both reads from the stored high-water | unit | `cd analytics-service && python3 -m pytest tests/test_sync_trades_resume_seed.py -q` | ✅ | ✅ green |
| 211-04-02 | 04 | 2 | SC-1, SC-4 | T-211-13 | the fills cursor governs the fills read only; neuters N1 to N3 RED | unit | plan 04 task 2 pytest set plus CI mypy strict | ✅ | ✅ green |
| 211-05-01 | 05 | 2 | SC-2, SC-4 | T-211-14 | a forced race reaches SITE B, which records and retracts | sql gate | pg-lane gate run plus `--subset-from` | ✅ | ✅ green |
| 211-05-02 | 05 | 2 | SC-2, SC-4 | T-211-14, T-211-15 | every predicate clause and guard has an arm biting under its twin | sql gate | pg-lane gate run plus `--subset-from` (biting 11) | ✅ | ✅ green |
| 211-05-03 | 05 | 2 | SC-2, SC-4 | T-211-14 | helper EXECUTE service_role only; side table deny-all; 7-arg body pin; 15 arms biting | sql gate | pg-lane gate run, `--subset-from` (biting 15), `node scripts/lint-sql-gates.mjs` | ✅ | ✅ green |
| 211-06-01 | 06 | 3 | SC-4 | T-211-16 | mutation floors equal the measured corpus; RATCHET STALE neuter RED | unit | `npx vitest run src/__tests__/mutation-runner-floors.test.ts src/__tests__/gate-family-meta.test.ts` | ✅ | ✅ green |
| 211-06-02 | 06 | 3 | SC-4 | T-211-16 | anti-skip floors equal the derivation table; derivation-sum neuter RED | unit | `npx vitest run src/__tests__/contracts/ci-anti-skip-gate.contract.test.ts ...` then `npm test` | ✅ | ✅ green |
| 211-07-01 | 07 | 3 | SC-2, SC-4 | T-211-17 | the helper's marker list equals both runtimes' sets; snapshot neuters N1, N2 RED | unit | `cd analytics-service && python3 -m pytest tests/test_compute_job_metadata_merge_parity.py -q`; `npx vitest run src/lib/ledger-refresh-marker.test.ts` | ✅ | ✅ green |
| 211-07-02 | 07 | 3 | SC-2 | T-211-18 | no comment calls the dedup gap open for a correlated caller | unit | full CI pytest, CI mypy strict, vitest, typecheck, lint | ✅ | ✅ green |

*Status: ✅ green · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

Existing infrastructure covers all phase requirements. Each new test file (`tests/test_fetch_trades_resume_seed.py`, `tests/test_stitch_composite_entry_snapshot.py`, `tests/test_sync_trades_resume_seed.py`, `supabase/tests/test_enqueue_dedup_record_retract.sql`) is created by the tracer task that first needs it. No separate Wave 0 is needed.

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| The migration applies to TEST, then PROD | SC-2 | This checkout's Supabase CLI is linked to PROD, so no plan runs `db push`. The merge CI (`supabase-migrate.yml`: `apply-test`, then `apply`) is the only applier. | After merge, read the `apply-test` and `apply` job logs bound to the merge SHA. |
| FULL mutation run and local-stack boot | SC-4 | Need roughly 15 GB free on the data volume; recorded as not-run when short | CI `sql-mutation` (FULL on a floors edit) and `sql-tests` on the PR head SHA |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 211s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** {pending / approved YYYY-MM-DD}

## Validation Audit 2026-11-14

| Metric | Count |
|---|---|
| Gaps found | 0 |
| Resolved | 0 |
| Escalated | 0 |
