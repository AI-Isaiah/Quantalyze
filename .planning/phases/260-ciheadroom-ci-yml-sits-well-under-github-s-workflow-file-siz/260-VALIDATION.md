---
phase: "260"
slug: "ciheadroom-ci-yml-sits-well-under-github-s-workflow-file-siz"
status: draft
nyquist_compliant: true
wave_0_complete: false
created: "2026-11-27"
---

# Phase 260 — Validation Strategy

> Per-phase validation contract. Source: `260-RESEARCH.md` "## Validation Architecture".

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest (existing) + node `--self-test` |
| **Config file** | `vitest.config.ts` |
| **Quick run command** | `node scripts/check-workflow-size.mjs --self-test && npx vitest run src/__tests__/workflow-size-gate.test.ts src/__tests__/critical-regressions.test.ts` |
| **Full suite command** | the reader set: every vitest file that mentions `ci.yml` or `.github/workflows`, run serially, compared to a same-way baseline; plus the `lint-sql-gates`, `sql-gate-subset`, `classify-changed-paths`, `verify-plan-anchors` and `baseline-content-drift-check` self-tests |
| **Estimated runtime** | quick ~60 s; full ~15 min |

## Sampling Rate

- **After every task commit:** quick command
- **After every plan wave:** full suite (serially, never two vitest runs at once)
- **Before verify:** full suite green against the baseline
- **Max feedback latency:** 120 seconds for the quick command

## Per-Task Verification Map

Filled by the planner (2026-11-28) from `260-01-PLAN.md`. Every task carries `<automated>` commands, each with a `<fails_when>`.

| Task | Plan | Wave | Criterion | Threat ref | Test type | Automated command | File exists | Status |
|------|------|------|-----------|------------|-----------|-------------------|-------------|--------|
| 1 (tracer) | 01 | 1 | SC-2 | T-260-01, T-260-02, T-260-05 | node self-test | `node scripts/check-workflow-size.mjs --self-test` | Wave 0 (Task 1 creates) | pending |
| 1 (tracer) | 01 | 1 | SC-2 | T-260-01 | real-tree scan, RED expected before the move | `node scripts/check-workflow-size.mjs` exits 1 with exactly one `::error file=.github/workflows/ci.yml::` line | Wave 0 (Task 1 creates) | pending |
| 1 (tracer) | 01 | 1 | SC-2 | T-260-01, T-260-02, T-260-05 | vitest (constants, subprocess verdicts, wiring findings) + registry | `npx vitest run src/__tests__/workflow-size-gate.test.ts src/__tests__/critical-regressions.test.ts` | Wave 0 (Task 1 creates); registry exists | pending |
| 2 | 01 | 1 | SC-1, SC-4 | T-260-03 | one-off proof (scratch) | `node "${SCRATCH:?}/prove-move.mjs"` (PROOF a to f) | scratch | pending |
| 2 | 01 | 1 | SC-1, SC-2 | T-260-01 | real-tree scan, GREEN expected | `node scripts/check-workflow-size.mjs` | yes after Task 1 | pending |
| 2 | 01 | 1 | SC-1 | T-260-06 | vitest (headroom arm, pointer findings) | `npx vitest run src/__tests__/workflow-size-gate.test.ts` | yes after Task 1 | pending |
| 2 | 01 | 1 | SC-3 | T-260-03 | reader set, serial, compared by test id | `node "${SCRATCH:?}/compare-readers.mjs" "${SCRATCH:?}/readers-before.json" "${SCRATCH:?}/readers-after.json"` | scratch | pending |
| 3 | 01 | 1 | SC-3 | T-260-04, T-260-08 | lint, gitleaks, self-tests, typecheck, commit hygiene | hygiene + canonical-domain lint; `gitleaks dir docs/ci-yml-notes.md --config .gitleaks.toml`; five script self-tests + `verify-plan-anchors --pending`; eslint + typecheck; commit-message skip-token count | yes | pending |

## Wave 0 Requirements

- [ ] `scripts/check-workflow-size.mjs` with `--self-test`
- [ ] `src/__tests__/workflow-size-gate.test.ts`
- [ ] `.github/workflows/workflow-size.yml`

## Manual-Only Verifications

| Behavior | Why Manual | Test Instructions |
|----------|------------|-------------------|
| CI actually starts on the PR and the new `workflow-size` check appears | needs GitHub | count the check runs bound to the head SHA at ship |

## Validation Sign-Off

- [x] All tasks have `<automated>` verify
- [x] No watch-mode flags
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** plan-checker 2026-11-28 - Dimension 8 passes: 3 of 3 tasks carry `<automated>` commands (14 of 14 with a stated `<fails_when>`), no watch flags, Wave 0 files are created by tracer Task 1 before any command that needs them, and no 3-task window lacks automated verification. `wave_0_complete` stays false until Task 1 executes.
