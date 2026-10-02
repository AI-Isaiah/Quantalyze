---
phase: 68
slug: boundary-wiring-key-validation
status: planned
nyquist_compliant: true
wave_0_complete: false
created: 2026-07-04
---

# Phase 68 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest (TS, @vitest/coverage-v8) + pytest (analytics-service, --cov-fail-under=80) |
| **Config file** | `vitest.config.ts` / `analytics-service` pytest config |
| **Quick run command** | `npx vitest run <touched test files> --no-file-parallelism` / `cd analytics-service && .venv/bin/python -m pytest <touched test files> -q -x` |
| **Full suite command** | CI only — `npm run test:coverage` + full pytest run in CI (local Py3.14 full-suite pytest SEGFAULTS at collection; never run the full local suite) |
| **Estimated runtime** | targeted runs < 60s |

---

## Sampling Rate

- **After every task commit:** the task's `<automated>` targeted command
- **After every plan wave:** `npx vitest run src/lib/closed-sets.test.ts src/__tests__/contracts/check-zod-db-check-parity.test.ts src/__tests__/strategy-sources-migration-parity.test.ts --no-file-parallelism` + targeted pytest file list
  - ⚠ EXPECTED RED between Wave 1 and Wave 2 (checker W1): after 68-01 widens `SUPPORTED_EXCHANGES`, the funding_fees spec in check-zod-db-check-parity.test.ts (:227, `ts: SUPPORTED_EXCHANGES`) is deterministically RED until 68-03 decouples it to `FUNDING_EXCHANGES` + `rejects: ["deribit"]`. Do NOT treat this specific red as a Wave-1 failure; all OTHER specs in the suite must stay green.
- **Before `/gsd:verify-work`:** CI green (frontend aggregator + python job are the full-suite authority)
- **Max feedback latency:** ~60 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 68-01-01 | 01 | 1 | DRB-02 | T-68-02/03 | UI + cron surfaces stay 3-exchange | unit | `npx vitest run src/lib/closed-sets.test.ts src/app/api/cron/sync-funding/route.test.ts --no-file-parallelism` | ✅ update | ⬜ pending |
| 68-01-02 | 01 | 1 | DRB-02 | T-68-01 | Literals widen; ingestion sets untouched | unit | `cd analytics-service && .venv/bin/python -m pytest tests/test_portfolio_router_audit_2026_05_07.py -q -x` | ✅ update | ⬜ pending |
| 68-01-03 | 01 | 1 | DRB-02 | T-68-04 | Named-constraint DROP/ADD + self-verify | contract | `npx vitest run src/__tests__/strategy-sources-migration-parity.test.ts src/__tests__/strategies-source-csv-constraint.test.ts` | ✅ existing | ⬜ pending |
| 68-02-01 | 02 | 1 | DRB-03 | T-68-05/07 | Fail-CLOSED probe; creds never logged | unit (mocked public/auth) | `cd analytics-service && .venv/bin/python -m pytest tests/test_deribit_scope_validation.py tests/test_deribit_ground_truth.py -q -x` | ❌ W0 (created in-task) | ⬜ pending |
| 68-02-02 | 02 | 1 | DRB-03 | T-68-06/08 | Honest scope errors; wiring guard | integration (mocked) | `cd analytics-service && .venv/bin/python -m pytest tests/test_deribit_scope_validation.py -q -x` | ❌ W0 (extended in-task) | ⬜ pending |
| 68-03-01 | 03 | 2 | DRB-02 | T-68-09/10 | TS↔SQL parity both directions | contract | `npx vitest run src/__tests__/contracts/check-zod-db-check-parity.test.ts --no-file-parallelism` | ✅ extend | ⬜ pending |
| 68-03-02 | 03 | 2 | DRB-02 | T-68-09/10 | pydantic↔SQL parity + exclusion pins | contract | `cd analytics-service && .venv/bin/python -m pytest tests/test_boundary_literals_parity.py tests/test_funding_match_key_sql_parity.py -q -x` | ❌ W0 (created in-task) | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `analytics-service/tests/test_deribit_scope_validation.py` — created inside Plan 68-02 Task 1 (tdd="true": behavior block precedes implementation)
- [ ] `analytics-service/tests/test_boundary_literals_parity.py` — created inside Plan 68-03 Task 2
- No framework install needed — both suites exist.

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Live Deribit scope-string format matches the harness-documented shape (A1) | DRB-03 | 67-03 blocked on founder key; no live key available | Re-verify when 67-03 runs; Phase 72 acceptance gates re-verify end-to-end |
| migration-reviewer agent pass on the CHECK migration | DRB-02 | Memory rule; auto-applies to prod on merge | Orchestrator runs migration-reviewer before /ship |
| Test-project (qmnijlgmdhviwzwfyzlc) migration catch-up | DRB-02 | Executor has no Supabase MCP | Orchestrator applies via Supabase MCP before any future deribit-inserting e2e (none in this phase) |

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references (both new test files created within their owning tasks)
- [x] No watch-mode flags
- [x] Feedback latency < 60s (targeted file lists — full local pytest suite is forbidden, Py3.14 segfault)
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** approved 2026-07-04 (planner)
