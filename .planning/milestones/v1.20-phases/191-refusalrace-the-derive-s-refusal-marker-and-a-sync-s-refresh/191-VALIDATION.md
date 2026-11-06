---
phase: "191"
slug: "refusalrace-the-derive-s-refusal-marker-and-a-sync-s-refresh"
status: draft
nyquist_compliant: false
wave_0_complete: false
created: "2026-11-04"
---

# Phase 191 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution. Source: 191-RESEARCH.md `## Validation Architecture`.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | pytest (analytics-service), vitest (`src/**`), plain-SQL gates on the pg-lane / local-stack lane, mypy strict |
| **Config file** | `analytics-service/pyproject.toml`, `vitest.config.ts`, `scripts/mutation-floors.mjs` |
| **Quick run command** | from `analytics-service/`: `.venv/bin/python -m pytest tests/test_derive_broker_dailies_dualmode.py tests/test_ledger_refresh_reuse_collision.py -q -p no:cacheprovider`; `npx vitest run src/lib/ledger-refresh-marker.test.ts` |
| **Full suite command** | `npm test`; full pytest from `analytics-service/`; `npm run lint`; `npm run typecheck`; one full `node scripts/mutation-runner/run.mjs` |
| **Estimated runtime** | ~120 seconds (quick), ~25 minutes (full incl. mutation runner) |

---

## Sampling Rate

- **After every task commit:** the touched file's quick run, plus CI's mypy line for any Python edit (`mypy --strict --follow-imports=silent --config-file=pyproject.toml services/ routers/ models/ main.py main_worker.py main_worker_healthz.py sentry_init.py`, from `analytics-service/`)
- **After every plan wave:** the census-pinning vitest files, `node scripts/lint-sql-gates.mjs`, `npm run schema:functions:check`, the job_worker/long_fetch pytest set
- **Before `/gsd-verify-work`:** full suite green
- **Max feedback latency:** 120 seconds

---

## Per-Task Verification Map

| Req | Behavior | Test Type | Automated Command | File Exists | Status |
|-----|----------|-----------|-------------------|-------------|--------|
| SC-1 | PROD counts before code | read-only PROD query (orchestrator) | marker query alone, then counts SQL via `supabase db query --linked -f` | ❌ W0 | ⬜ pending |
| SC-2 marker | one rpc, confirmed write (D-07), failure → TRANSIENT | pytest | `pytest tests/test_derive_broker_dailies_dualmode.py -k "refusal or marker"` | ✅ convert | ⬜ pending |
| SC-2 Python retraction | one rpc, outcomes mapped, `no_row` loud (D-08) | pytest | `pytest tests/test_ledger_refresh_reuse_collision.py` | ✅ convert | ⬜ pending |
| SC-2 TS retraction | one rpc, outcomes, throw with cause | vitest | `npx vitest run src/lib/ledger-refresh-marker.test.ts` + the two route tests | ✅ convert | ⬜ pending |
| SC-2 RED-on-replace | each converted test fails against the old body | neuter / RED / restore from byte backup | the three commands above | procedure | ⬜ pending |
| SC-2 parity | marker set in 3 copies, marker key, outcome vocabulary | vitest + pytest | `npx vitest run src/lib/ledger-refresh-marker.test.ts`; new pytest | ❌ W0 | ⬜ pending |
| SC-3 | interleaving keeps every key; guards; ACL | SQL gate | pg-lane run of `supabase/tests/test_compute_job_metadata_merge.sql`; sentinel `ALL N ARMS EXECUTED` | ❌ W0 | ⬜ pending |
| SC-3 concurrency | two connections, both keys survive | pytest live probe | `pytest tests/test_<probe>_live.py` (local-stack lane) | ❌ W0 | ⬜ pending |
| SC-3 bites | each arm reds on its twin | mutation runner | `node scripts/mutation-runner/run.mjs --file ...` then one full run | ❌ W0 | ⬜ pending |
| SC-4 | migration/RLS review, ACL, verify block | agents + CI | migration-reviewer, rls-policy-auditor; `sql-function-snapshot`, `migration-policy` | at review | ⬜ pending |
| SC-5 | post-deploy PROD reading | read-only PROD query | SC-5 SQL in RESEARCH | after deploy | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `npm ci` in the worktree
- [ ] `supabase/tests/test_compute_job_metadata_merge.sql` (SC-3 gate)
- [ ] psycopg live-probe pytest (SC-3 concurrency)
- [ ] pytest for marker-set, marker-key and outcome-vocabulary pins; static migration privilege test
- [ ] SC-1 counts recorded (no ids)
- [ ] census red-state readings captured as the change lands

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| PROD counts before/after | SC-1, SC-5 | PROD is read only by the orchestrator | marker query alone first; counts only |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 120s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
