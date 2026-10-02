---
phase: 108
slug: scenario-planner-onto-the-backbone
status: draft
nyquist_compliant: true
wave_0_complete: false
created: 2026-07-15
---

# Phase 108 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.
> Derived from RESEARCH.md §Validation Architecture.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest ^4.1.2 (v8 coverage), jsdom for `.tsx` component tests |
| **Config file** | `vitest.config.ts` (coverage: lines 82 / stmts 80 / fns 74 / branches 72) |
| **Quick run command** | `npx vitest run "src/app/(dashboard)/allocations/components/ScenarioComposer.test.tsx" src/lib/scenario.test.ts src/__tests__/metrics-parity.test.ts --no-file-parallelism` |
| **Full suite command** | `npm run test` |
| **Coverage command** | `npm run test:coverage` (blocking CI gate) |
| **Estimated runtime** | ~10s quick / ~180s full (8000+ tests) |

---

## Sampling Rate

- **After every task commit:** quick run over the touched files (ScenarioComposer, scenario, metrics-parity, the new gate) — `--no-file-parallelism`.
- **After every plan wave:** `npm run test` (full vitest suite; 8151 baseline green post-107).
- **Before `/gsd:verify-work`:** `npm run test:coverage` exit 0 (thresholds hold after the 211-LOC module + its 251-LOC test are removed) + tsc + lint.

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 108-SC1 | 02 | 2 | SCEN-BB | — | Blend panels derive from the backbone rolling primitives, not scenario-blend-panels.ts | unit + source-scan | `npx vitest run "src/app/(dashboard)/allocations/components/ScenarioComposer.test.tsx"` | ✅ (re-anchor positive control @:3553) | ⬜ pending |
| 108-SC2 | 02 | 2 | SCEN-BB | — | scenario-blend-panels.ts DELETED; portfolio-stats.ts/health-score.ts REMAIN | source-scan | new delete-gate test (module absent; siblings present) | ❌ Wave 0 | ⬜ pending |
| 108-SC3 | 02 | 2 | SCEN-BB | — | metrics-parity.test.ts kept + green (Python↔TS backbone identity) | unit | `npx vitest run src/__tests__/metrics-parity.test.ts` | ✅ (427 LOC untouched) | ⬜ pending |
| 108-SC4 | 01 | 1 | SCEN-BB | — | Blend panels match pre-change within parity tolerance (population-std, min/max whiskers) | unit (re-derived pin) | new parity pin mirroring PAYLOAD-03 | ❌ Wave 0 | ⬜ pending |
| 108-SC4-UI | 02 | 2 | SCEN-BB | — | 3M/6M/12M toggle + usableN empty-states preserved | component | `ScenarioComposer.test.tsx` WR-02 @:3494 stays green | ✅ | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky. Task IDs re-map at plan time.*

---

## Wave 0 Requirements

- [ ] Re-anchor the `ScenarioComposer.test.tsx:3553` positive control off `/buildBlendPanels/` to a live token (else the SC-1 guard passes vacuously after the delete).
- [ ] Add an SC-2/SC-3 source-scan gate: assert `scenario-blend-panels.ts` is ABSENT AND `portfolio-stats.ts`/`health-score.ts`/`metrics-parity.test.ts` are PRESENT (pattern: 107 `leverage-backbone-gates.test.ts`).
- [ ] Add an SC-4 re-derived parity pin on the new backbone-fed derivation (population-std value, mutation-falsifiable — mirror PAYLOAD-03 at `scenario-factsheet-payload.test.ts:207`), at each window (3M/6M/12M), min/max whiskers.
- [ ] Delete `scenario-blend-panels.test.ts` (251 LOC) with the module; confirm no orphaned import.

*Existing vitest/jsdom infrastructure covers all phase requirements — no framework install needed.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Scenario-composer blend panels render pixel-identically pre/post refactor | SCEN-BB / SC-4 | Pixel parity of an existing surface is best confirmed visually; jsdom asserts values, not pixels | Optional: open the scenario composer on a representative multi-strategy blend, toggle 3M/6M/12M, confirm whiskers (min/max) + layout + numbers are visually unchanged vs pre-change. Values may shift at the 3rd–4th sig fig (invisible at 2-decimal display). |

*All correctness behaviors have automated verification; only pixel-parity feel is manual/optional.*

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references
- [x] No watch-mode flags
- [x] Feedback latency < 180s
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
