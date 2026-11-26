---
phase: "228"
slug: "keyanswers"
# status lifecycle: draft (seeded by plan-phase) → validated (set by validate-phase §6)
status: draft
nyquist_compliant: false
wave_0_complete: false
created: "2026-11-26"
---

# Phase 228 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution. Source: `228-RESEARCH.md` § Validation Architecture (the Phase Requirements → Test Map there is the authoritative per-row list, each row with its PROOF-01 neuter).

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest (TS); pytest + mypy `--strict` (Python, run from `analytics-service/`) |
| **Config file** | `vitest.config.ts`; `analytics-service/pytest.ini`, `analytics-service/pyproject.toml` |
| **Quick run command** | `npx vitest run <touched test file>`; `cd analytics-service && python3 -m pytest tests/test_mt5_rotate_secret_internal.py -q` |
| **Full suite command** | census set listed in `228-RESEARCH.md` § Validation Architecture → Test Framework, plus `npx tsc --noEmit` and mypy strict |
| **Estimated runtime** | ~120 seconds (targeted files only; full suite runs in CI) |

---

## Sampling Rate

- **After every task commit:** the single touched test file
- **After every plan wave:** the census set, `npx tsc --noEmit`, eslint on touched files, mypy strict
- **Before `/gsd-verify-work`:** CI green bound to the head SHA with the expected check count
- **Max feedback latency:** 120 seconds

---

## Per-Task Verification Map

Task ids are filled by the planner; every requirement row in `228-RESEARCH.md`'s test map must map to at least one task.

| Requirement | Behaviour | Test Type | Automated Command | File Exists | Plan / Task | Status |
|-------------|-----------|-----------|-------------------|-------------|-------------|--------|
| CONN-02 / SC-1 | working same-account holder on the exact server: rotate in place, named answer, one owner-scoped UPDATE | route unit | `npx vitest run src/app/api/strategies/create-with-key/route.test.ts` | ✅ (extend) | 228-03 T1, T2 | ⬜ pending |
| CONN-02 / SC-1 | mistyped, master or wrong-server password: named validation error, zero writes | route unit | same | ✅ (extend) | 228-03 T2 | ⬜ pending |
| CONN-02 | unchanged password: zero writes, `unchanged` answer | route unit + pytest | same; `pytest tests/test_mt5_rotate_secret_internal.py -q` | ✅ (extend) | 228-01 T1, T3; 228-03 T2 | ⬜ pending |
| CONN-02 | rotate-secret route unchanged after the helper extraction | route unit | `npx vitest run "src/app/api/keys/[id]/rotate-secret/route.test.ts"` | ✅ | 228-01 T1, T2 | ⬜ pending |
| CONN-02 / O2 | rotate leg fits the browser deadline | invariant | `npx vitest run src/lib/seam-budgets.invariant.test.ts` | ✅ (extend) | 228-04 T1, T2 | ⬜ pending |
| CONN-02 | notice and F6 strip copy | component | ConnectKeyStep.test.tsx, WizardClient.test.tsx | ✅ (extend) | 228-02 T1, T3 | ⬜ pending |
| CONN-04 / SC-2 | named Disconnect bullet, same for allocator / manager / both | route unit + formatKeyError unit | route.test.ts, wizardErrors tests | ✅ (extend) | 228-02 T2; 228-03 T3 | ⬜ pending |
| SC-3 | PROOF-01 transcript for every guard | process | recorded in plan SUMMARY | n/a | every task (each SUMMARY) | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] Extend the `create-with-key/route.test.ts` doubles (rotate mock, filter-recording admin update, label read, `profiles` read recorder)
- [ ] Enumerate the existing tests the founder ruling turns red, before editing them
- [ ] Worktree `node_modules` (`npm ci`)

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Notice and envelope reflow at 320 px, axe clean | CONN-02 | visual | the reflow-sweep row on `/strategies/new/wizard` with both rendered |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 120s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
