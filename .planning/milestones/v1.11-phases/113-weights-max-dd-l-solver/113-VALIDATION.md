---
phase: 113
slug: weights-max-dd-l-solver
status: approved
nyquist_compliant: true
wave_0_complete: true
created: 2026-07-17
---

# Phase 113 — Validation Strategy

> Per-phase validation contract. Derived from `113-RESEARCH.md` → Validation Architecture, CORRECTED for the founder's sleeve-level lock (target = the sleeve's OWN max-DD → MONOTONE unique-root solve; portfolio max-DD is a DISPLAY value, not solved). Engine byte-frozen (SC-3); this is a client-side solver + UI.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest 4.1.2 (+ `@vitest/coverage-v8`) |
| **Config file** | `vitest.config.ts` (thresholds: lines 82 / stmts 80 / funcs 74 / branches 72) |
| **Quick run** | `npx vitest run src/app/\(dashboard\)/allocations --no-file-parallelism` |
| **Full suite** | `npm test` (sharded in CI with `--coverage`) |

---

## Sampling Rate
- **Per task commit:** `npx vitest run <touched test file> --no-file-parallelism`
- **Per wave merge:** `npx vitest run src/app/\(dashboard\)/allocations src/lib/scenario.test.ts src/lib/leverage.test.ts`
- **Phase gate:** full suite green + `git diff --exit-code origin/main -- src/lib/scenario.ts` clean before verify.

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------------|-----------|-------------------|-------------|--------|
| 113-00-01 | 00 | 0 | WEIGHTS-03/04 | RED scaffold: monotone sleeve solve, round-trip, ruin-clamp, infeasible/degenerate honest states, portfolio-DD display | unit+component | `npx vitest run src/app/\(dashboard\)/allocations/lib/solve-leverage.test.ts` | ✅ | ❌ red (RED scaffold landed) |
| 113-01-01 | 01 | 1 | WEIGHTS-03 | Monotone bisect on the SLEEVE standalone max-DD (`computeScenario({one unit, w=1, L}).max_drawdown`) returns the unique L for an achievable target; smallest-L on any flat interval | unit | `npx vitest run src/app/\(dashboard\)/allocations/lib/solve-leverage.test.ts` | ❌ W0 | ⬜ pending |
| 113-01-02 | 01 | 1 | WEIGHTS-03 | Ruin ceiling `L_ruin` (monotone up-set) respected; domain `[0, min(MAX_LEVERAGE, L_ruin)]`; deleverage (L<1) reaches a below-base target; no scan into the ruin/null region | unit | same file | ❌ W0 | ⬜ pending |
| 113-02-01 | 02 | 2 | WEIGHTS-04 | Round-trip: solved L re-fed through `computeScenario` reproduces the SLEEVE target within tol (non-tautological — assert it fails if L is perturbed) | unit | same file | ❌ W0 | ⬜ pending |
| 113-02-02 | 02 | 2 | WEIGHTS-04 | Infeasible (target unreachable at `L_max`) / degenerate (flat / all-negative / insufficient obs) → honest reason, em-dash, NEVER a fabricated leverage or DD (RED-proof) | unit | same file | ❌ W0 | ⬜ pending |
| 113-03-01 | 03 | 3 | WEIGHTS-03 | Mode toggle renders (default **Leverage**); Target mode shows the target input + derived-L read-only; em-dash on infeasible per DESIGN.md | component | `npx vitest run src/app/\(dashboard\)/allocations/components/ScenarioComposer.test.tsx` | ✅ (extend) | ⬜ pending |
| 113-03-02 | 03 | 3 | WEIGHTS-03 | Resulting **PORTFOLIO-level** max-DD is displayed for the solved L (full-book `computeScenario`, a computed read-only value — NOT solved); em-dash on non-derivable | component | `ScenarioComposer.test.tsx` | ✅ (extend) | ⬜ pending |
| 113-03-03 | 03 | 3 | WEIGHTS-03 | Solved L survives Save→reopen (reuses the Phase-112 prune keep-signal); no `SCENARIO_SCHEMA_VERSION` bump | component | `ScenarioComposer.save.test.tsx` | ✅ (extend) | ⬜ pending |
| 113-GATE | 04 | final | SC-3 freeze | `scenario.ts` byte-frozen; backbone gates green | gate | `git diff --exit-code origin/main -- src/lib/scenario.ts` + `npx vitest run src/lib/scenario-backbone-gates.test.ts` | ✅ | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements (Plan 113-00)

- [ ] `allocations/lib/solve-leverage.test.ts` — RED solver units: monotone sleeve convergence (unique root), ruin-clamp domain, deleverage-to-below-base-target, round-trip (non-tautological — perturbing L breaks it), infeasible/degenerate honest states. Reuse the research §Monotonicity probe fixtures as vitest fixtures.
- [ ] `ScenarioComposer.test.tsx` — mode toggle default-Leverage; Target mode input + read-only derived L + resulting portfolio-DD display; em-dash on infeasible.
- [ ] `ScenarioComposer.save.test.tsx` — solved-L Save→reopen survival.
- [ ] No new framework install — Vitest present.

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Target-max-DD row copy + the "resulting portfolio max-DD" readout read honestly per DESIGN.md (derived/read-only, em-dash on infeasible, no fabricated value) | WEIGHTS-03/04 | Visual copy nuance | `/qa` on a dev server: set a sleeve target, confirm the derived L and the resulting portfolio max-DD render read-only with honest infeasible states |

---

## Validation Sign-Off
- [x] Every task has an automated verify or a Wave 0 dependency
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references
- [x] No watch-mode flags
- [x] `nyquist_compliant: true` set
- [x] `wave_0_complete: true` — Plan 113-00 RED scaffold landed 2026-07-17 (13 RED tests, all fail by assertion; pre-existing suites green; scenario.ts byte-frozen)

**Approval:** approved 2026-07-17 (pending plan-checker)
