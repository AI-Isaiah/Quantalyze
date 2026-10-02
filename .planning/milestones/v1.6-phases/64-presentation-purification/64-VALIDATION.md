---
phase: 64
slug: presentation-purification
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-07-03
---

# Phase 64 — Validation Strategy

> Research was deliberately skipped (two surgical, source-grounded UI deltas; the
> approved UI-SPEC carries the file:line grounding a research pass would produce).
> This validation contract is authored by the orchestrator.

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest (TS/RTL) |
| **Quick run command** | `npx vitest run <touched test files> --no-file-parallelism` |
| **Full suite command** | `npm test` |
| **Type gate** | `npx tsc --noEmit` |
| **Lint gate** | `npm run lint` |

## Sampling Rate

- After every task commit: touched test files + tsc
- Wave gate: full `npm test` + coverage ratchet check
- Max feedback latency: ~120s

## Per-Task Verification Map

| Task | Requirement | Behavior pinned | Automated Command |
|------|-------------|-----------------|-------------------|
| AUM KPI removal | PRESENT-01 | strip renders 4 return-form cells, no AUM cell, grid @lg:grid-cols-4 | KpiStrip/composer tests |
| commit-sizing guard | PRESENT-02 | commit modal weight×AUM byte-unchanged (existing tests verbatim) | commit-modal test block |
| isMixed thread + caption | PRESENT-03 | ok-resolve exposes isMixed from decoded draft; caption renders iff mixed; pre-v4 no caption; verbatim copy | share-resolve + page tests |

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Instructions |
|----------|-------------|------------|--------------|
| Live share caption on prod | PRESENT-03 (spot) | prod | Phase 65 canary (GUARD-04) |

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify
- [ ] No watch-mode flags
- **Approval:** pending
