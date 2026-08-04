---
phase: 147
slug: scen-01-the-scenario-engine-receives-the-real-series
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-08-04
---

# Phase 147 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest (TypeScript suite) |
| **Config file** | `vitest.config.ts` |
| **Quick run command** | `npx vitest run <changed test files> --no-file-parallelism` |
| **Full suite command** | `npm test` (local flakes → `--no-file-parallelism`) |
| **Estimated runtime** | ~300 seconds full; <30s targeted |

---

## Sampling Rate

- **After every task commit:** Run the targeted test files for the touched modules
- **After every plan wave:** Run the full vitest suite
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 300 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| (filled by planner) | | | SCEN-01 | | | | | | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] (filled by planner from 147-RESEARCH.md "Validation Architecture" Wave-0 gaps)

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Founder's MT5 strategy shows its real day-count in a scenario on PROD | SCEN-01 | PROD data (strategy `4eab92b0`), live composer | Add the MT5 strategy to a scenario; overlapping-days matches stored span (expect N−1 ≈ 135 vs 136 stored — differencing consumes one day); metrics non-zero |

---

## Falsifiability Ledger

> One row per success criterion. Mutation must be a semantic change to production code.

| SC | Mutation (exact edit to production source) | Must turn RED | Observed? | Evidence |
|----|-------------------------------------------|---------------|-----------|----------|
| SC-1 | (planner fills — e.g. returns route: drop `returns_series` from select) | route-level test | ⬜ pending | |
| SC-2 | (planner fills — add a bare `daily_returns` select in a second site) | grep-gate vitest | ⬜ pending | |
| SC-3 | (planner fills — forward `returns_series` raw, skip resolver) | differencing regression | ⬜ pending | |
| SC-4 | (planner fills — map terminal-empty to `computing`) | series_state test | ⬜ pending | |

*Prefer the second member of the class: mutate a reader the author did NOT have in mind (e.g. `queries.ts:3405`), not just the returns route.*

---

## Oracle Independence

- [ ] No test imports a **constant** from the module it tests — expected values are **literals** in the test
- [ ] No assertion compares a value to itself via a re-export, fixture, or table under test
- [ ] Table/registry sizes are pinned to a **literal count**, not to `len(THE_TABLE)`
- [ ] Any fake/double is pinned against the real contract it stands in for

*Standing project rule: money-math oracles pin ECONOMICS, not the impl's own formula — the SC-3 test must assert the literal expected return values from a hand-computed wealth curve, not re-run `equityCurveToDailyReturns` to produce its own expectation.*

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 300s
- [ ] **Every success criterion has a Falsifiability Ledger row**
- [ ] **Every ledger row is `Observed ✅` with pasted evidence, or explicitly marked skipped-with-reason**
- [ ] **Oracle Independence checklist complete**
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
