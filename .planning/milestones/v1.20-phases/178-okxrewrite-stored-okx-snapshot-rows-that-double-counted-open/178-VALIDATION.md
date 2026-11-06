---
phase: "178"
slug: "okxrewrite-stored-okx-snapshot-rows-that-double-counted-open"
# status lifecycle: draft (seeded by plan-phase) → validated (set by validate-phase §6)
status: draft
nyquist_compliant: false
wave_0_complete: false
created: "2026-10-28"
---

# Phase 178 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution. Source: 178-RESEARCH.md "Finding 5 - Validation Architecture".

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | pytest (analytics-service) and vitest (root) |
| **Config file** | `analytics-service/pyproject.toml`; root `vitest.config.ts` |
| **Quick run command** | `cd analytics-service && python3 -m pytest tests/test_reconstruct_whole_account.py tests/test_allocator_history_probe.py tests/test_reconstruct_force_rebuild.py -q` |
| **Full suite command** | `cd analytics-service && python3 -m pytest -q` plus `npx vitest run src/__tests__/marksource-okx-census-sql.test.ts` |
| **mypy (CI line, verbatim)** | `mypy --strict --follow-imports=silent --config-file=pyproject.toml services/ routers/ models/ main.py main_worker.py main_worker_healthz.py sentry_init.py` (from `analytics-service/`) |
| **Estimated runtime** | ~20 seconds quick |

---

## Sampling Rate

- **After every task commit:** the quick run command (plus the census vitest file for runbook tasks)
- **After every plan wave:** full analytics pytest, the mypy line, the census vitest file
- **Before `/gsd-verify-work`:** full suite must be green
- **Max feedback latency:** 60 seconds

---

## Per-Task Verification Map

| Req | Behavior | Test Type | Automated Command | File Exists | Status |
|-----|----------|-----------|-------------------|-------------|--------|
| D-05 | working group + dead group => working selected, dead counted | unit | `pytest tests/test_reconstruct_whole_account.py -k select -x` | invert existing | ⬜ pending |
| D-05 | all groups dead => `account_key_not_working` | unit | same | add | ⬜ pending |
| D-05 | forced job with a dead sibling completes, audit carries the excluded count | integration (fake) | `pytest tests/test_reconstruct_whole_account.py -x` | add | ⬜ pending |
| D-05 | probe: OKX working + Bybit revoked => `selection ok`, excluded count 1, revoked key never decrypted | unit | `pytest tests/test_allocator_history_probe.py -x` | add | ⬜ pending |
| D-05 | refusal closed set unchanged (16) | unit | `pytest tests/test_reconstruct_force_rebuild.py -k closed_set -x` | exists | ⬜ pending |
| SC-2 / D-06 | crosswalk form and dead-key census file pass the census guard | vitest | `npx vitest run src/__tests__/marksource-okx-census-sql.test.ts` | extend | ⬜ pending |
| runbook | runbook names every refusal token in code (16, incl. `account_key_read_stalled`) | vitest | same | add (RED today) | ⬜ pending |
| SC-1..SC-3 | operator SUMMARY lines | grep chain in operator plans | per 173-03 pattern | per plan | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `node_modules` in the worktree (symlinked from the main checkout, git-ignored).
- [ ] RED proof for every new data-integrity test by a byte-backup neuter of the skip (restore from the byte backup, never `git checkout`).

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Probe per target, crosswalk, P7 dead-key census, D-02 readings | D-01, D-02, D-06 | PROD reads on the deployed worker | Operator plan 03 (orchestrator only) |
| Forced rebuild and before/after census | SC-1..SC-3 | one-way PROD write | Operator plan 04 (orchestrator only) |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 60s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
