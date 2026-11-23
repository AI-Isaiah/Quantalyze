---
phase: "227"
slug: "jobledger-a-failed-job-attempt-keeps-its-cause-and-no-strate"
# status lifecycle: draft (seeded by plan-phase) → validated (set by validate-phase §6)
status: draft
nyquist_compliant: false
wave_0_complete: false
created: "2026-11-23"
---

# Phase 227 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution. Seeded from `227-RESEARCH.md` `## Validation Architecture`.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | SQL gates (`supabase/tests/test_*.sql`, local-stack lane + pg-lane mutation runner), vitest, pytest + mypy strict |
| **Config file** | `vitest.config.ts`; `analytics-service/pyproject.toml` / `pytest.ini`; `scripts/mutation-floors.mjs` |
| **Quick run command** | `node scripts/mutation-runner/run.mjs --file supabase/tests/<gate>.sql` (diagnostic) |
| **Full suite command** | `node scripts/mutation-runner/run.mjs`; `npm test`; `cd analytics-service && python -m pytest -x && mypy --strict .` |
| **Estimated runtime** | per-gate ~10-60 s; full mutation corpus several minutes |

---

## Sampling Rate

- **After every task commit:** the touched gate via `--file`, plus `node scripts/lint-sql-gates.mjs`, `node scripts/lint-migration-data-dependence.mjs`, and `npm run schema:functions` with an empty `git diff` afterwards
- **After every plan wave:** full mutation runner, `npm test`, pytest + mypy
- **Before `/gsd-verify-work`:** full suite green; PROOF-01 transcripts (neuter, RED on named arm, byte restore with `cmp`, GREEN) in each SUMMARY
- **Max feedback latency:** one gate file run

---

## Per-Task Verification Map

Filled by the planner per task; requirement → gate mapping from research:

| Requirement | Gate | Test Type | File Exists |
|-------------|------|-----------|-------------|
| MT5D-01 | `supabase/tests/test_compute_job_attempt_failures.sql` | SQL lane | ❌ W0 |
| HEAL-02 | `supabase/tests/test_compute_job_claim_renewal.sql`; `analytics-service/tests/test_main_worker.py -k renew` | SQL lane + pytest | ❌ W0 |
| HEAL-03 | `supabase/tests/test_reconcile_dropped_enqueue_sweep.sql`; `src/__tests__/ops-alert-contract-parity.test.ts` | SQL lane + vitest + pytest | extend existing |
| HEAL-04 | `supabase/tests/test_reset_stalled_bridge_provenance.sql` | SQL lane | ❌ W0 |
| HEAL-01 | `supabase/tests/test_first_hop_enqueue_sweep.sql` | SQL lane | ❌ W0 |
| HEAL-05 | `supabase/tests/test_enqueue_poll_positions_cohort.sql`; `analytics-service/tests/test_daily_enqueue_lock.py` | SQL lane + pytest | ❌ W0 |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] New gate files above, each with `RED-UNDER` twins and `RED-UNDER-SETUP` listing fixtures plus every migration the arm needs
- [ ] `scripts/mutation-floors.mjs` floors raised to the measured count (`src/__tests__/mutation-runner-floors.test.ts` reports `RATCHET STALE` otherwise)
- [ ] Censuses that count gate files or arms updated (grep a sibling gate name across `scripts/ src/__tests__ .github/`)

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Post-deploy PROD reading: first attempt-failure rows appear | MT5D-01 | needs real nights on PROD (230 MT5NIGHTLY consumes) | after merge, read-only marker query then count rows in the new attempts table |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < one gate run
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
