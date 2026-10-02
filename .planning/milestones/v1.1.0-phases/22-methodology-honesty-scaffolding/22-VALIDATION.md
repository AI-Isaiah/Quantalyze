---
phase: 22
slug: methodology-honesty-scaffolding
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-06-21
---

# Phase 22 — Validation Strategy

> Per-phase validation contract. Per-task map populated by the planner; see
> 22-RESEARCH.md "## Validation Architecture" for the per-requirement assertion plan.

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest (TypeScript suite) |
| **Config file** | `vitest.config.ts` |
| **Quick run command** | `npx vitest run <changed-spec>` |
| **Full suite command** | `npm test` (coverage gate: `npm run test:coverage` — BLOCKING CI gate) |
| **Estimated runtime** | single-spec sub-30s |

## Sampling Rate

- After every task commit: `npx vitest run <changed-spec>`
- Before `/gsd:verify-work`: full suite + `npm run test:coverage` green

## Per-Task Verification Map

> Populated by the planner. Per-requirement assertions (from 22-RESEARCH.md):
> - HONEST-01: the methodology line on BOTH composer + sandbox reads
>   "Historical realized · {N} overlapping days · not a forecast", keeps the
>   `scenario-coverage-caveat` testid, and does NOT regress the existing
>   "Projected from N… Shortest history: …" content.
> - HONEST-02: `src/lib/sample-floor.ts` exports a named floor constant (60) +
>   gate (`evaluateSampleFloor(n, floor?)` → ok/n/floor/reason) that treats
>   null/NaN/`n < floor` as below-floor; a below-floor input renders the shared
>   honest empty state naming N and the floor; unit + render tests.
> - Single source: a contract-guard test pins the floor constant so a future
>   Phase-26/27 hardcoded floor fails loud. Do NOT unify the correlation 10-day bar.

| Task ID | Plan | Wave | Requirement | Test Type | Status |
|---------|------|------|-------------|-----------|--------|
| (filled by planner) | — | — | — | — | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

## Wave 0 Requirements

- [ ] `src/lib/sample-floor.test.ts` — net-new (pure gate primitive)
- [ ] Confirm/create a ScenarioBuilder sandbox-caveat render test (composer's exists; sandbox's Wave-0 status per RESEARCH Open Q2)

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Methodology line reads cleanly inline under the projection | HONEST-01 | Visual copy judgment | Open composer + /scenarios; confirm one coherent line, no double caveat |

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] No watch-mode flags
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
