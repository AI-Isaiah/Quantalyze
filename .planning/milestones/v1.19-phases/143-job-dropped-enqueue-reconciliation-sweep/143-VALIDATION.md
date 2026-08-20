---
phase: 143
slug: job-dropped-enqueue-reconciliation-sweep
# status lifecycle: draft (seeded by plan-phase) → validated (set by validate-phase §6)
# audit-milestone §5.5 distinguishes NOT-VALIDATED (draft) from PARTIAL (validated + nyquist_compliant: false) (#2117)
status: draft
nyquist_compliant: true
wave_0_complete: false
created: 2026-08-16
---

# Phase 143 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | pytest (analytics-service, asyncio_mode=auto) + vitest (sharded, coverage-gated 82/80/74/72) + plain-PL/pgSQL SQL gates under `psql -v ON_ERROR_STOP=1` (CI `sql-tests` job; pgTAP NOT installed) |
| **Config file** | `analytics-service/pytest.ini` · `vitest.config.ts` · `.github/workflows/ci.yml:833` (sql-tests discovery of `supabase/tests/test_*.sql`) |
| **Quick run command** | `cd analytics-service && python3 -m pytest tests/test_main_worker.py -k "SentryBootstrap or ReconcileSweep" -x -q` · `npx vitest run src/__tests__/reconcile-dropped-enqueue-sweep.test.ts` |
| **Full suite command** | `cd analytics-service && python3 -m pytest` · `npm test` · SQL gate runs in CI only (no local psql harness — RESEARCH Environment Availability); local proxy = throwaway harness (`143-throwaway-harness.sql`) |
| **Estimated runtime** | pytest quick ~10 s; vitest single file ~15 s; full pytest ~5 min; full vitest ~10 min; throwaway-harness cycle ~2 min |

⚠️ pytest MUST run from `analytics-service/` with `python3` (repo-root runs miss VCR cassettes and make live broker calls). Worktree spawns have no node_modules (`npm ci` first) — measured, not hypothetical.

---

## Sampling Rate

- **After every task commit:** the two quick-run commands above (as applicable to the touched runtime)
- **After every plan wave:** `cd analytics-service && python3 -m pytest -q` + `npm test` + `python3 -m mypy --strict --follow-imports=silent main_worker.py` (from analytics-service/)
- **Before `/gsd-verify-work`:** full suites green + sql-tests GREEN on the PR post-TEST-apply (Plan 04 Task 1)
- **Max feedback latency:** ~600 s (full vitest); quick loops < 30 s

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 143-01-01 | 01 | 1 | JOB-04 | T-143-05 | main() must call init_sentry (capture-only test stays green when init removed — the separate assertion is load-bearing) | pytest (RED first) | `cd analytics-service && python3 -m pytest tests/test_main_worker.py -k "SentryBootstrap or ReconcileSweepAlert" -x -q` | ❌ W0 (this task creates them) | ⬜ pending |
| 143-01-02 | 01 | 1 | JOB-04 | T-143-05 / T-143-06 / T-143-11 | marker capture, no-PII payload, transport failure never fails a job | pytest + mypy | `cd analytics-service && python3 -m pytest tests/test_main_worker.py -q && python3 -m mypy --strict --follow-imports=silent main_worker.py` | ✅ after 143-01-01 | ⬜ pending |
| 143-02-01 | 02 | 1 | JOB-04 | T-143-07 / T-143-12 | census artifact carries zero secret material; STOP rules evaluated | artifact + grep | `test -s .planning/phases/143-job-dropped-enqueue-reconciliation-sweep/143-CENSUS.md && ! grep -riE "service_role\|eyJ\|postgres(ql)?://" .planning/phases/143-job-dropped-enqueue-reconciliation-sweep/143-CENSUS.md` | ✅ (grep) | ⬜ pending |
| 143-02-02 | 02 | 1 | JOB-04 | T-143-01 / T-143-03 / T-143-04 | inline body only (no SECDEF surface); enumerated terminal-status exclusion; composite conjunct | throwaway-Postgres end-to-end (tracer) | psql tracer query: healed=1, marker=reconcile-sweep (see 143-02-PLAN Task 2 verify) | ❌ W0 (harness built in-task) | ⬜ pending |
| 143-02-03 | 02 | 1 | JOB-04 | T-143-03 / T-143-08 | all never-touch arms untouched; bound holds; 3 body-neuter signatures observed | throwaway-Postgres arms table | psql arm-inventory query (see 143-02-PLAN Task 3 verify) | ✅ after 143-02-02 | ⬜ pending |
| 143-03-01 | 03 | 2 | JOB-04 | T-143-03 / T-143-13 / T-143-14 | deployed-body oracle; identity-scoped seeds; no meta-commands | SQL gate (CI) — designed RED until Plan 04 applies | CI `sql-tests` on the PR (local structural proxy in task verify) | ❌ W0 (this task creates it) | ⬜ pending |
| 143-03-02 | 03 | 2 | JOB-04 | T-143-10 / T-143-15 | body-scoped anchors with anti-vacuity; cross-language marker pin | vitest + pytest | `npx vitest run src/__tests__/reconcile-dropped-enqueue-sweep.test.ts && cd analytics-service && python3 -m pytest tests/test_main_worker.py -k MarkerContract -x -q` | ❌ W0 (this task creates them) | ⬜ pending |
| 143-03-03 | 03 | 2 | JOB-04 | T-143-15 | nine neuter REDs OBSERVED, all restored, tree clean | harness-driven neuter cycle | final green: vitest file + full test_main_worker.py + `git status --porcelain` empty | ✅ after 143-03-01/02 | ⬜ pending |
| 143-04-01 | 04 | 3 | JOB-04 | T-143-02 / T-143-01 | apply to TEST via MCP only (never db push); role/slot evidence | MCP + CI RED→GREEN | `gh run list` conclusion == success post-apply | ✅ (CI) | ⬜ pending |
| 143-04-02 | 04 | 3 | JOB-04 | T-143-02 / T-143-13 | REAL tick writes compute_jobs under FORCE RLS; probe cleaned to zero residue | live TEST observation | header inspection query + row select via MCP (semi-automated; wall-clock ≤ ~65 min) | ✅ (MCP) | ⬜ pending |
| 143-04-03 | 04 | 3 | JOB-04 | T-143-05 / T-143-16 | DSN verified-or-escalated; deferrals filed; human approves ship | checkpoint:human-verify | — (blocking human gate) | — | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

Wave 0 artifacts are created BY the phase's own tasks (test-first where marked):

- [ ] `analytics-service/tests/test_main_worker.py` — `TestMainWorkerSentryBootstrap` + `TestReconcileSweepAlert` (143-01-01, RED before implementation) and `TestReconcileSweepMarkerContract` + `_sweep_cron_body()` helpers (143-03-02)
- [ ] `supabase/tests/test_reconcile_dropped_enqueue_sweep.sql` — Parts 1-4 (143-03-01; Part 1's RED = first sql-tests run pre-apply)
- [ ] `src/__tests__/reconcile-dropped-enqueue-sweep.test.ts` (143-03-02)
- [ ] `.planning/phases/143-job-dropped-enqueue-reconciliation-sweep/143-throwaway-harness.sql` (143-02-02 — the local execution substrate for the SQL gate and neuter cycle)
- [ ] No framework installs — vitest, pytest, and the `sql-tests` job all exist.

---

## Neutering Table (founder rule: a test that CANNOT FAIL is worse than none)

Every row must reach **Observed** during execution; asserted-only rows are not evidence.

| Gate | Neuter | Expected RED | Owner task | Observed |
|------|--------|--------------|------------|----------|
| main()-calls-init pytest | remove `init_sentry()` from `main()` | bootstrap test RED while capture test stays GREEN (the load-bearing separation) | 143-01-02 | ⬜ |
| marker-capture pytest | change metadata key `source` in the test seed | capture assertion RED | 143-01-01/02 | ⬜ |
| SQL gate Part 1 | migration unapplied (cron job row absent) | Part 1 RAISEs — anti-green-skip | 143-03-03 (harness) + 143-04-01 (real CI RED) | ⬜ |
| SQL gate D1 arm | drop `'complete'` from the exclusion list | D1 healed → RED naming the mass-re-enqueue incident | 143-03-03 (body preview in 143-02-03) | ⬜ |
| SQL gate C1 arm | kind-scope the compute_jobs NOT EXISTS | running-derive arm healed → RED (D-02) | 143-03-03 | ⬜ |
| SQL gate E arm | remove the strategy_keys conjunct | composite healed → RED (money surface, D-09) | 143-03-03 | ⬜ |
| SQL gate B arm | delete the grace conjunct | in-grace arm healed → RED | 143-03-03 | ⬜ |
| SQL gate Part 3 | bare INSERT (conflict clause removed) | unique_violation / count RED (D-10) | 143-03-03 | ⬜ |
| SQL gate Part 4 | remove `MATERIALIZED` | 26/26 healed on tick 1 — the D-19 signature | 143-03-03 | ⬜ |
| TS content gate | flip one excluded-status literal in a copy | vitest RED naming the missing status | 143-03-03 | ⬜ |
| pytest marker contract | `source` → `src` in a copy | contract test RED | 143-03-03 | ⬜ |
| TS body-scoping proof | rejected-anchor token in HEADER prose only | stays GREEN (proves scoping; a RED here means the gate greps prose) | 143-03-02 | ⬜ |

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| The cron ROLE can write `compute_jobs` under FORCE ROW LEVEL SECURITY | JOB-04 / SC#1 | The `sql-tests` gate EXECUTEs the body as the psql user, never the cron role — NO CI gate can prove this (RESEARCH L-2/A2: failure mode is silent zero-insert forever with all gates green) | Plan 04 Task 2: seed a committed orphan on TEST, wait for the :35 tick, inspect `cron.job_run_details` + the healed marked row, clean up |
| `SENTRY_DSN` is set on the WORKER Railway service | JOB-04 / SC#1 (alert real in prod) | Not readable from the repo; a DSN on the web app does not imply one on the worker; UNVERIFIED at research time | Plan 04 Task 3: Railway MCP/dashboard variable check on the `python -m main_worker` service; absent → founder action item (RESEND_API_KEY precedent), recorded, never asserted |
| What `cron.job_run_details.return_message` ACTUALLY carries for the DO-block body | D-12 | The RAISE-NOTICE-surfaces-in-return_message premise is locked but empirically unverified for pg_cron on Supabase | Plan 04 Task 2 step 3: record the observed value; align the header wording with the observation |
| First PROD tick after merge | JOB-04 | Merge auto-applies to PROD; the first tick enqueues the census-headline count | Post-ship operator handoff (143-04-SUMMARY): run the header's inspection query on PROD after the first :35 tick; healed count must match the PROD census headline |

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies (143-04-03 is a deliberate blocking human gate)
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references (created by tasks 143-01-01, 143-02-02, 143-03-01, 143-03-02)
- [x] No watch-mode flags
- [x] Feedback latency < 600 s for all local loops (the ≤65-min live-tick wait in 143-04-02 is a wall-clock property of pg_cron, stated, not a test-suite latency)
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
