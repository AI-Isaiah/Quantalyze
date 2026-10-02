---
phase: 39
slug: complete-payload-adapter
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-06-26
---

# Phase 39 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest (jsdom env, `vitest.config.ts:21`) |
| **Config file** | `vitest.config.ts` (include glob :25; setup `src/test-setup.ts`) |
| **Quick run command** | `npx vitest run "src/app/(dashboard)/allocations/widgets/performance/scenario-factsheet-payload.test.ts"` |
| **Full suite command** | `npm run test:coverage` (blocking CI gate; lines 82 / stmts 80 / fns 74 / branches 72) |
| **Estimated runtime** | quick ~5s · full ~minutes |

---

## Sampling Rate

- **After every task commit:** Run the quick command (adapter test file + `ScenarioComposer.test.tsx`).
- **After every plan wave:** Run the full suite command.
- **Before `/gsd:verify-work`:** Full suite green + `tsc` typecheck clean.
- **Max feedback latency:** ~30 seconds (quick).

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 39-01-* | 01 | 1 | PAYLOAD-01 | — | full scalar set from `compute()`, no zeroed summary | unit | quick `-t "strategyMetrics"` | ✅ extend | ⬜ pending |
| 39-01-* | 01 | 1 | PAYLOAD-02 | — | panel arrays populated from helpers (`styleDrift` honest-null) | unit | quick (new `it` per panel) | ✅ extend | ⬜ pending |
| 39-01-* | 01 | 1 | PAYLOAD-03 | — | population-std/252/365.25 golden parity; sample-std bleed fails | unit (golden) | quick (field-by-field ≡ `compute` + pinned pop-std `ann_vol`) | ✅ extend | ⬜ pending |
| 39-01-* | 01 | 1 | PAYLOAD-04 | — | `strategyMetrics.n` = true overlap count (not `dates.length`); `n<252` boundary | unit | quick (30-day caveat-on + ≥252-day caveat-off) | ✅ extend | ⬜ pending |
| 39-01-* | 01 | 1 | PAYLOAD-05 | — | empty/single/sub-floor/non-finite → safe empty, no NaN/Inf, no fabricated zeros | unit | quick (extend degenerate tests) | ✅ extend | ⬜ pending |
| 39-01-* | 01 | 1 | ingestSource invariant | — | csv arm; 4 synth panels structurally absent | unit | quick (`ingestSource==="csv"` + `in payload === false`) | ✅ extend | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] Extend `scenario-factsheet-payload.test.ts` — add a ≥252-day deterministic blend fixture (returns form) + golden-parity block + convention-drift pin (hand-computed `ann_vol = 0.0075·√252` for the 30-day fixture) + `n`-boundary + ingestSource-absence assertions.
- [ ] Update `ScenarioComposer.test.tsx` — `ScenarioFactsheetChart` mock now receives `portfolioDaily` (engine `portfolio_daily_returns`, returns form not wealth); existing prop assertions remain.
- [ ] (If `quantileSummary` extracted to `quantiles.ts`) add `quantiles.test.ts`.
- Framework install: none — vitest already configured.

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| (none) | — | Phase 39 is pure-TS payload synthesis + fixtures; fully unit-testable. Visual parity is Phase 40's concern. | — |
