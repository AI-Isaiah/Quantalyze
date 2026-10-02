---
phase: 41
slug: constituent-correlation-diversification
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-06-26
---

# Phase 41 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest (jsdom) + @testing-library/react; pure-TS unit for `diversification.ts` |
| **Config file** | `vitest.config.ts` (thresholds lines 82 / fns 74 / branches 72 / stmts 80) |
| **Quick run command** | `npx vitest run src/lib/diversification.test.ts "src/app/(dashboard)/allocations/" --no-file-parallelism` |
| **Full suite command** | `npm run test:coverage` (blocking CI gate) |
| **Estimated runtime** | quick ~15s · full ~minutes |

---

## Sampling Rate

- **Per task commit:** quick command (`diversification.test.ts` + the composer/widget dir).
- **Per wave merge:** full suite + coverage ratchet.
- **Before verify:** full suite green + coverage ratchet + `tsc --noEmit`.

---

## Per-Task Verification Map

| Task | Wave | Requirement | Test Type | Automated Command | File | Status |
|------|------|-------------|-----------|-------------------|------|--------|
| diversification.ts math | 1 | CORR-02/05/06 | unit (golden) | quick `diversification.test.ts` | ❌ W0 | ⬜ |
| consistency pin | 1 | CORR-01 | unit | rebuild ρ from lib cov+σ ≡ engine `correlation_matrix` to 3dp | ❌ W0 | ⬜ |
| panel wiring (Diversification section) | 2 | CORR-01/02/03/04 | unit (jsdom) | composer/widget render test | ✅ extend | ⬜ |
| PCR list + cluster reorder render | 2 | CORR-05/06 | unit (jsdom) | render assertions | ❌ W0 | ⬜ |
| honest empties | 2 | CORR-03 | unit | 0/1-constituent + n<10 empty-state assertions | ✅ partial | ⬜ |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `src/lib/diversification.test.ts` — golden tests on a hand-computable 3-constituent fixture: DR, risk-based ENB (=1/Σ PCRᵢ²), PCR (sum-to-1, signed), average-linkage cluster order, covariance-from-aligned-returns. Plus the **consistency pin** (rebuild ρ from the lib's own cov+σ, assert == engine `correlation_matrix` to 3 decimals — proves the re-alignment + sample convention match the engine).
- [ ] Degenerate cases: 0/1 constituent, n<10 (engine-null), a zero-variance constituent (pearson→null cell "—"), non-finite — assert no NaN/Inf, honest empties.
- [ ] Panel render tests (the Diversification CollapsibleSection): too-similar flag at ρ≥0.85, DR/ENB headline, PCR list, cluster-reordered labels, empty states.
- No framework install needed.

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Heatmap color readability across constituents | CORR-01 | CorrelationHeatmap has a CI contrast sweep; visual feel needs authed composer | covered by the existing heatmap CI contrast test + a Phase-43 / post-deploy authed canary |

---

## Critical Landmines (from RESEARCH)

1. **Re-alignment:** the aligned per-constituent returns are NOT emitted by the frozen engine (transient local at `scenario.ts:229-236`, discarded). `diversification.ts` MUST re-align the raw per-constituent `daily_returns` on the union-of-dates axis mirroring `scenario.ts:199-236`. The consistency golden test (rebuild ρ == engine matrix to 3dp) is the guard.
2. **SAMPLE convention (locked):** DR/PCR/σ use sample cov/std (÷n−1) to match the engine's `correlation_matrix` + `volatility` — NOT the factsheet body's population convention. A population bleed silently desyncs the headline from the grid; the consistency pin catches it.
3. **Placement refinement:** the `CorrelationHeatmap` is already mounted at `ScenarioComposer.tsx:2353` (below the Phase-40 body mount). Enhance in place — wrap it in a factsheet-shaped "Diversification" `CollapsibleSection` + add the DR/ENB headline, PCR list, cluster reorder, too-similar flag. Do NOT relocate to ScenarioFactsheetChart (re-threads data for no visual gain). Static-guard-safe (CorrelationHeatmap ≠ FactsheetBody literal); payload stays clean.
