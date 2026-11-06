---
phase: "176"
slug: "legacyretire-the-legacy-allocator-equity-curve-is-retired-an"
status: draft
nyquist_compliant: true
wave_0_complete: false
created: "2026-10-31"
---

# Phase 176 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution. Derived from `176-RESEARCH.md` `## Validation Architecture`; that section is the source, this file does not restate its behaviour map.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest (TS), pytest (analytics-service, run only from `analytics-service/`), SQL gates via `scripts/pg-lane/run.sh` and `scripts/mutation-runner/run.mjs` |
| **Config file** | `vitest.config.ts`; `analytics-service/pytest.ini`; `analytics-service/pyproject.toml` (mypy) |
| **Quick run command** | `npx vitest run <touched file>` or `cd analytics-service && python3 -m pytest <touched file> -q` |
| **Full suite command** | `npm test && npm run lint && npm run typecheck`; `cd analytics-service && python3 -m pytest && mypy --strict --follow-imports=silent --config-file=pyproject.toml services/ routers/ models/ main.py main_worker.py main_worker_healthz.py sentry_init.py` |
| **Estimated runtime** | quick ~2-30 seconds; full several minutes |

---

## Sampling Rate

- **After every task commit:** the single touched test file.
- **After every plan wave:** `npm run typecheck`, the touched vitest/pytest files, `node scripts/lint-migration-data-dependence.mjs`, `npx tsx scripts/dump-sql-functions.ts --check`.
- **Before `/gsd-verify-work`:** full suite green, plus the census gates in RESEARCH B-12 and a full mutation run whenever a gate file is added or removed.
- **Max feedback latency:** 60 seconds per task.

---

## Per-Task Verification Map

Filled by the planner per task (RESEARCH behaviour ids B-01..B-13 map onto plan tasks). Every behaviour test is written first and observed RED on the base.

The automated command of each row is the `<automated>` block of that task in its PLAN file; it is not restated here
so the two cannot drift. Operator tasks (plans 07, 12, 16) verify their evidence logs; their PROD readings are the
manual-only rows below.

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 176-01-T1 | 01 | 1 | D-07 (R0) | T-176-01 | renderer refuses a missing marker or placeholder | vitest static pin | 176-01 Task 1 `<automated>` | new `src/__tests__/legacyretire-runbook-forms.test.ts` | ⬜ pending |
| 176-01-T2 | 01 | 1 | D-01, D-02, D-04, D-06 (R1-R6, cron) | T-176-02, T-176-03 | write forms guarded by marker + compare-and-set | vitest static pin | 176-01 Task 2 `<automated>` | same | ⬜ pending |
| 176-02-T1 | 02 | 1 | D-03, D-05 (B-05) | T-176-04 | helper is SECURITY INVOKER, no anon/authenticated EXECUTE | SQL gate (pg-lane) | 176-02 Task 1 `<automated>` | new `supabase/tests/test_bridge_outcome_deltas_derived.sql` | ⬜ pending |
| 176-02-T2 | 02 | 1 | D-06 (B-05) | T-176-05, T-176-06 | reset limited to holding rows; aged rows cannot abort the batch | SQL gate + narrowed mutation run | 176-02 Task 2 `<automated>` | same | ⬜ pending |
| 176-02-T3 | 02 | 1 | B-12 | T-176-07, T-176-08 | catalogue-only verify | census vitest | 176-02 Task 3 `<automated>` | exists | ⬜ pending |
| 176-03-T1 | 03 | 1 | D-01 (B-04) | T-176-09 | owner-scoped reads only | vitest (mocked supabase) | 176-03 Task 1 `<automated>` | exists | ⬜ pending |
| 176-03-T2 | 03 | 1 | D-01 | T-176-10 | — | vitest | 176-03 Task 2 `<automated>` | exists | ⬜ pending |
| 176-04-T1 | 04 | 2 | D-05 (B-06) | T-176-11 | live lane only, skips counted honestly | vitest live-db | 176-04 Task 1 `<automated>` | exists | ⬜ pending |
| 176-04-T2 | 04 | 2 | D-03 | T-176-12 | — | doc grep | 176-04 Task 2 `<automated>` | exists | ⬜ pending |
| 176-05-T1 | 05 | 2 | D-02, D-07 (B-01, B-02) | T-176-13 | no legacy read | vitest (mocked supabase) | 176-05 Task 1 `<automated>` | exists | ⬜ pending |
| 176-05-T2 | 05 | 2 | D-07 (B-03) | T-176-14 | — | component vitest | 176-05 Task 2 `<automated>` | exists | ⬜ pending |
| 176-05-T3 | 05 | 2 | D-07 (B-03) | — | — | component vitest | 176-05 Task 3 `<automated>` | exists | ⬜ pending |
| 176-06-T1..T3 | 06 | 3 | D-02 (B-03) | T-176-15 | — | typecheck + full vitest + lint | 176-06 Tasks 1-3 `<automated>` | exists | ⬜ pending |
| 176-08-T1 | 08 | 5 | D-04 (B-07) | T-176-20, T-176-22 | stub writes nothing, logs no ids | pytest | 176-08 Task 1 `<automated>` | new `analytics-service/tests/test_legacy_allocator_jobs_retired.py` | ⬜ pending |
| 176-08-T2 | 08 | 5 | D-04 (B-09) | T-176-21 | — | pytest full + mypy | 176-08 Task 2 `<automated>` | same | ⬜ pending |
| 176-09-T1 | 09 | 5 | D-04 | T-176-23, T-176-24 | SECDEF pin and ACL unchanged | SQL gate (pg-lane) | 176-09 Task 1 `<automated>` | exists (rewritten) | ⬜ pending |
| 176-09-T2 | 09 | 5 | D-04 | T-176-25 | — | narrowed mutation run | 176-09 Task 2 `<automated>` | exists | ⬜ pending |
| 176-09-T3 | 09 | 5 | B-12 | T-176-26 | — | census vitest | 176-09 Task 3 `<automated>` | exists | ⬜ pending |
| 176-10-T1..T2 | 10 | 5 | D-02, D-04 | T-176-27, T-176-28 | — | vitest + doc grep | 176-10 Tasks 1-2 `<automated>` | exists | ⬜ pending |
| 176-11-T1 | 11 | 6 | D-04 (founder go/no-go) | T-176-52 | nothing deleted before the recorded answer | decision record + report files | 176-11 Task 1 `<automated>` | n/a (blocking-human checkpoint) | ⬜ pending |
| 176-11-T2 | 11 | 6 | D-02, D-04 (B-07, B-09) | T-176-29, T-176-30, T-176-51 | no Python caller of a dropped RPC; D-04 keep-list pinned | pytest + mypy | 176-11 Task 2 `<automated>` | same as 176-08 | ⬜ pending |
| 176-11-T3 | 11 | 6 | D-04 | T-176-51 | — | pytest drills + vitest + ledger grep | 176-11 Task 3 `<automated>` | exists | ⬜ pending |
| 176-17-T1 | 17 | 7 | D-02, D-04 | T-176-31 | — | pytest collect-only (RED at base) | 176-17 Task 1 `<automated>` | exists | ⬜ pending |
| 176-17-T2 | 17 | 7 | D-04 | T-176-53, T-176-54 | — | pytest full (CI flags, coverage 80) + mypy | 176-17 Task 2 `<automated>` | exists | ⬜ pending |
| 176-17-T3 | 17 | 7 | D-04 | T-176-53 | — | pytest drills + vitest | 176-17 Task 3 `<automated>` | exists | ⬜ pending |
| 176-13-T1 | 13 | 9 | D-02 (B-10) | T-176-36, T-176-37, T-176-38 | delete RPC works after the drop; RESTRICT drop | SQL gate (pg-lane) | 176-13 Task 1 `<automated>` | exists (rewritten) | ⬜ pending |
| 176-13-T2..T3 | 13 | 9 | B-12 | T-176-39 | — | function snapshots + census vitest | 176-13 Tasks 2-3 `<automated>` | exists | ⬜ pending |
| 176-14-T1 | 14 | 10 | D-02 (B-11) | T-176-41, T-176-42, T-176-43 | a re-created table is required again | vitest + coverage script | 176-14 Task 1 `<automated>` | exists | ⬜ pending |
| 176-14-T2..T3 | 14 | 10 | D-02 | — | — | vitest + typecheck + lint | 176-14 Tasks 2-3 `<automated>` | exists | ⬜ pending |
| 176-15-T1 | 15 | 9 | D-02 (B-08) | T-176-44 | — | pytest + drill | 176-15 Task 1 `<automated>` | new `analytics-service/tests/test_legacy_table_not_named.py` | ⬜ pending |
| 176-15-T2..T3 | 15 | 9 | SC-3 | T-176-45, T-176-46 | counts only in the public ledger | pytest full + ledger grep | 176-15 Tasks 2-3 `<automated>` | exists | ⬜ pending |
| 176-07, 176-12, 176-16 | 07, 12, 16 | 4, 8, 11 | D-01, D-02, D-04, D-06, D-07, SC-2, SC-3 | T-176-16..19, T-176-32..35, T-176-47..50 | marker first; counts only | operator evidence logs | each task's `<automated>` log check | n/a | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `supabase/tests/test_bridge_outcome_deltas_derived.sql` — B-05 (new gate with `RED-UNDER` annotations) — plan 02
- [ ] A Python guard that the refresh/reconstruct handlers write no legacy table — B-07 — plans 08 (DONE stub, no database access), 11 (writers gone, D-04 keep-list pinned) and 17 (tests of deleted code pruned)
- [ ] A pg-lane recipe for the PR 3 drop migration against a schema that still has the table — B-10 — plan 13 Task 1 (RED on the old body with the table dropped, GREEN with the migration)

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Readers live on PROD after PR 1; no new legacy rows after PR 2; drop applied after PR 3 | D-02 order | PROD reads are orchestrator work | RESEARCH forms R0-R6, marker query first |
| Cron unscheduled and manifest re-captured | D-02 | cron jobs are not moved by migrations | RESEARCH `## Writers, jobs and crons`; `node scripts/prod-prober/run.mjs --capture-manifest` |

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies (checked 2026-10-31 over all 17 plans: every task, checkpoints included, carries `<automated>` followed by `<fails_when>`)
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references (no task's verify is MISSING; the new test files are created RED-first by their own tasks)
- [x] No watch-mode flags (every vitest call is `vitest run`)
- [ ] Feedback latency < 60s: met by the per-task quick runs; NOT met by the full-suite verifies (plans 06, 08, 15, 17 run CI's whole Python or TS suite, minutes by design, because the coverage floor and typecheck are whole-suite properties)
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
