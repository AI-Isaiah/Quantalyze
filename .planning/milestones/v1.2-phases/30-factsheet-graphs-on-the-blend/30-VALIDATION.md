---
phase: 30
slug: factsheet-graphs-on-the-blend
status: approved
nyquist_compliant: true
wave_0_complete: true
created: 2026-06-23
---

# Phase 30 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest |
| **Config file** | vitest.config.ts |
| **Quick run command** | `npx vitest run <changed spec>` |
| **Full suite command** | `npm test` |
| **Estimated runtime** | per-spec < 30s; full suite sharded in CI |

---

## Sampling Rate

- **After every task commit:** Run the changed-file vitest spec
- **After every plan wave:** Run the full vitest suite
- **Before `/gsd:verify-work`:** Full suite green + `git diff` empty on `src/lib/scenario.ts` + `src/lib/scenario.test.ts`
- **Max feedback latency:** keep per-spec under ~30s

---

## Per-Task Verification Map

| Task | Requirement | Test Type | Automated Command | Status |
|------|-------------|-----------|-------------------|--------|
| adapter convention pins | GRAPH-02/03 | unit (non-vacuous) | `npx vitest run src/lib/scenario-blend-panels.test.ts` | ⬜ pending |
| distribution panel + degenerate-empty | GRAPH-02/04 | unit | `npx vitest run` on the composer/panel spec | ⬜ pending |
| rolling panel + per-window floor + degenerate-empty | GRAPH-03/04 | unit | `npx vitest run` on the composer/panel spec | ⬜ pending |
| equity/drawdown factsheet-stack alignment | GRAPH-01 | unit | `npx vitest run` on the composer spec | ⬜ pending |
| honesty guard extended (non-vacuous, all panels) | GRAPH-04 | unit (positive control) | `npx vitest run "src/app/(dashboard)/allocations/components/ScenarioComposer.test.tsx"` | ⬜ pending |
| frozen-engine zero-diff guard | all | guard | extend phase-29 guard / git diff --exit-code src/lib/scenario.ts | ⬜ pending |

---

## Wave 0 Requirements

- A RED `scenario-blend-panels.test.ts` pinning the conventions (sample-std×√252, Sortino ÷ total-n, Sharpe windowed mean×252÷vol, degenerate windows → `[]`, no √365) and the histogram-cumulative-series contract (cumprod of 1+r, NOT raw daily) is the failing-first scaffold.
- Existing vitest infra covers the rest; no framework install.

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Visual fidelity of the new panels to the DESIGN.md factsheet chart stack | GRAPH-01 | rendered styling needs a real browser | headed /qa render of the composer with a ≥2-strategy blend (same recipe as Phase 29 QA) |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers the adapter convention pins + histogram-series contract
- [ ] No watch-mode flags
- [ ] `nyquist_compliant: true`

**Approval:** pending
