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

One row per task of plans 01 to 11. Gate commands are taken from each plan's own `<automated>` line (the plans wrap a single-file mutation-runner call in a `test $? -eq 2` check); the full pg-lane run in plan 10 exits 0.

| Task | Name | Requirement | Gate or test | Test Type | File Exists |
|---|---|---|---|---|---|
| 01-1 | Ledger table, the mark write, a real re-claim (tracer) | MT5D-01 | `node scripts/mutation-runner/run.mjs --file supabase/tests/test_compute_job_attempt_failures.sql` (arm E1) | SQL lane + mutation | yes |
| 01-2 | Worker-lost real errors, adjacency and empty edges, survival past pruning | MT5D-01 | same gate (arms E2, E3, E3b, E4, E5, E6) | SQL lane + mutation | yes |
| 01-3 | Self-verify, ACL arm, VAC-04 ack, rollback | MT5D-01 | same gate (arms E7, E8); `node scripts/lint-migration-data-dependence.mjs && node scripts/lint-sql-gates.mjs` | SQL lane + lint | yes |
| 02-1 | Reset re-base with the bridge loop (tracer, SC-4) | HEAL-04 | `node scripts/mutation-runner/run.mjs --file supabase/tests/test_reset_stalled_bridge_provenance.sql` (arm B1) | SQL lane + mutation | yes |
| 02-2 | Reclaim parity, reset ledger arms, side-kind and multi-strategy cases | HEAL-04, MT5D-01 | same gate (B2 to B5b) and `test_compute_job_attempt_failures.sql` (arms W1 to W5) | SQL lane + mutation | yes |
| 02-3 | Self-verify, VAC-04 acks, rollback | HEAL-04 | `node scripts/lint-migration-data-dependence.mjs && node scripts/lint-sql-gates.mjs` plus the bridge gate | SQL lane + lint | yes |
| 03-1 | A renewed waiting row survives the watchdog (tracer) | HEAL-02 | `node scripts/mutation-runner/run.mjs --file supabase/tests/test_compute_job_claim_renewal.sql` (arm R1) | SQL lane + mutation | yes |
| 03-2 | Fence arms, ACL, self-verify, rollback | HEAL-02 | same gate (R2 to R5); lint pair as above | SQL lane + mutation | yes |
| 04-1 | An exhausted readmit leaves a durable row (tracer) | HEAL-03 | `node scripts/mutation-runner/run.mjs --file supabase/tests/test_reconcile_readmit_exhaustions.sql` (arm X1) | SQL lane + mutation | yes |
| 04-2 | Boundary, idempotence, generations, non-candidates, lifecycle, ACL | HEAL-03 | same gate; lint pair as above | SQL lane + mutation | yes |
| 04-3 | The detector predicate cannot drift from the predicate PROD runs | HEAL-03 | `npx vitest run src/__tests__/readmit-exhaustion-predicate-parity.test.ts` | vitest | yes |
| 05-1 | A dropped first hop is re-enqueued once after the grace (tracer) | HEAL-01 | `node scripts/mutation-runner/run.mjs --file supabase/tests/test_first_hop_enqueue_sweep.sql` (arm H1) | SQL lane + mutation | yes |
| 05-2 | Named state, healthy look-alikes, once-only; self-verify, rollback | HEAL-01 | same gate (21 arms); lint pair as above | SQL lane + mutation | yes |
| 05-3 | The go-live runbook that registers the hourly job after merge | HEAL-01 | `grep -c "FROM cron.job WHERE jobname = 'first_hop_enqueue_sweep'" docs/runbooks/jobledger-go-live.md`; PROD half is Manual-Only below | grep + manual | yes |
| 06-1 | A private cron-synced strategy gets its daily poll (tracer) | HEAL-05 | `node scripts/mutation-runner/run.mjs --file supabase/tests/test_enqueue_poll_positions_cohort.sql` (arm P1) | SQL lane + mutation | yes |
| 06-2 | The rest of the cohort, liveness of the enqueue; self-verify, rollback | HEAL-05 | same gate; lint pair as above | SQL lane + mutation | yes |
| 06-3 | The fresh PROD measurement and the worker regression | HEAL-05 | `cd analytics-service && python -m pytest tests/test_daily_enqueue_lock.py tests/test_main_worker.py -k daily -q`; measurement recorded in the plan 06 SUMMARY | pytest + PROD read | yes |
| 07-1 | A reaped orphan keeps its cause (tracer) | MT5D-01 | `node scripts/mutation-runner/run.mjs --file supabase/tests/test_orphan_reaped_attempt_record.sql` (arm O1) | SQL lane + mutation | yes |
| 07-2 | Second arm, no double record, structure; self-verify, rollback | MT5D-01 | same gate (4 arms); lint pair as above | SQL lane + mutation | yes |
| 08-1 | A job the watchdog took is skipped, not run twice (tracer) | HEAL-02 | `cd analytics-service && python -m pytest tests/test_main_worker.py -k claim_fence -q` plus mypy strict | pytest + mypy | yes |
| 08-2 | The heartbeat keeps waiting claims fresh, never the running one | HEAL-02 | `python -m pytest tests/test_main_worker.py -k "heartbeat or claim_renew or claim_fence" -q` plus mypy strict | pytest + mypy | yes |
| 08-3 | The real error survives a lost mark; a healed first hop is not silent | MT5D-01, HEAL-02 | `python -m pytest tests/test_main_worker.py -q` plus mypy strict | pytest + mypy | yes |
| 09-1 | An exhaustion row pages a human once (tracer) | HEAL-03 | `python -m pytest tests/test_readmit_ceiling_alert.py tests/test_ops_alert.py -q`; `npx vitest run src/__tests__/ops-alert-contract-parity.test.ts`; mypy strict | pytest + vitest + mypy | yes |
| 09-2 | Wire the reader into the watchdog loop without letting it hurt the loop | HEAL-03 | `python -m pytest tests/test_readmit_ceiling_alert.py tests/test_main_worker.py -q` plus mypy strict | pytest + mypy | yes |
| 10-1 | Every phase migration applies on the lane; the whole SQL corpus passes there | all | `node scripts/mutation-runner/run.mjs` on the pg-lane (979 of 979 armed, exit 0); local-stack legs owed to CI | mutation corpus + local stack | yes (local stack owed to CI) |
| 10-2 | Floors and mutation-runner censuses moved to measured values | all | `npx vitest run src/__tests__/mutation-runner-floors.test.ts src/__tests__/mutation-annotation-parser.test.ts src/__tests__/gate-family-meta.test.ts` | vitest | yes |
| 10-3 | Remaining censuses, then every suite the phase touches | all | `npm test`; `node scripts/lint-sql-gates.mjs`; `node scripts/lint-migration-data-dependence.mjs`; `npx tsx scripts/dump-sql-functions.ts --check` | vitest + lint | yes |
| 11-1 | No phase migration schedules a pg_cron job (tracer) | HEAL-01 | `npx vitest run src/__tests__/jobledger-migrations-schedule-nothing.test.ts` | vitest | yes |
| 11-2 | Operator runbook section and this map | all | `grep -c compute_job_attempt_failures docs/runbooks/compute-queue.md` | grep | yes |
| 11-3 | Hold HEAL-01's delivery marks; record the ship steps | HEAL-01 | grep against TODOS.md and REQUIREMENTS.md by content (plan 11 verify) | grep | yes |

Requirement to gate summary (corrected after the plans landed):

| Requirement | Gates |
|-------------|-------|
| MT5D-01 | `test_compute_job_attempt_failures.sql` (14 arms), `test_orphan_reaped_attempt_record.sql` (the `orphan_reaped` gate, 4 arms) |
| HEAL-02 | `test_compute_job_claim_renewal.sql` (5 arms); `analytics-service/tests/test_main_worker.py -k "heartbeat or claim_renew or claim_fence"` |
| HEAL-03 | `test_reconcile_readmit_exhaustions.sql`, `readmit-exhaustion-predicate-parity.test.ts`, `test_readmit_ceiling_alert.py` and `ops-alert-contract-parity.test.ts`. It is no longer the reconcile sweep gate (`test_reconcile_dropped_enqueue_sweep.sql`), which this phase leaves untouched. |
| HEAL-04 | `test_reset_stalled_bridge_provenance.sql` (6 arms) |
| HEAL-01 | `test_first_hop_enqueue_sweep.sql` (21 arms) on the lane; PROD registration is Manual-Only below |
| HEAL-05 | `test_enqueue_poll_positions_cohort.sql`; `analytics-service/tests/test_daily_enqueue_lock.py` |

*Status: lane-proven where the pg-lane ran (plan 10); the local-stack legs are owed to the PR's CI run.*

---

## Wave 0 Requirements

- [x] New gate files above, each with `RED-UNDER` twins and `RED-UNDER-SETUP` listing fixtures plus every migration the arm needs (seven gate files; the claim-renewal gate's setup was repaired in plan 10 after plan 02 moved the reset body)
- [x] `scripts/mutation-floors.mjs` floors raised to the measured count: `FILES_FLOOR` 92 and `ARMS_FLOOR` 979 (one full run, 979 of 979 biting, exit 0; plan 10 SUMMARY)
- [x] Censuses that count gate files or arms updated: `lint-sql-gates` scanned 119, the `sql-tests` sentinel floors 37 and 568, `COMPARED_FLOOR` 143, the annotation-parser and anti-skip census pins (plan 10 SUMMARY)

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Post-deploy PROD reading: first attempt-failure rows appear | MT5D-01 | needs real nights on PROD (230 MT5NIGHTLY consumes) | after merge, read-only marker query then count rows by `cause_class` in `compute_job_attempt_failures` |
| Post-merge go-live of `first_hop_enqueue_sweep` (OPEN, owned by the phase agent after merge) | HEAL-01 | the sweep function reaches PROD only through apply-on-merge and its hourly job is registered by a runbook step, never a migration | run `docs/runbooks/jobledger-go-live.md` in one session, each statement its own call: P0 marker query (stop unless it names PROD), P1 to P3, Step 1 registration at minute 55, Step 1b the verbatim read-only `cron.job` read (exactly one row: schedule `55 * * * *`, command `SELECT public.first_hop_enqueue_sweep();`, active true), Step 2 the same-session manifest re-capture. HEAL-01 is recorded as delivered ONLY with that read pasted beside it in the verification report; until then it is lane-proven with PROD registration pending, and REQUIREMENTS.md holds it Blocked. |
| Post-apply re-dump of `supabase/schema/baseline.sql` (OPEN) | MT5D-01, HEAL-01 to HEAL-05 | the dump must be taken after the migrations applied to PROD; it clears this phase's five `NAME_SET_RATCHET` rows and its `SNAPSHOT_MISSING` and `DRIFT` findings in `baseline-content-drift-check.mjs` | regenerate per `supabase/schema/BASELINE.md` "## Regenerating", with the carried-migrations marker in the same commit, then delete the five ratchet rows once the gate reports them ratchet-stale |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < one gate run
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
