---
phase: 107
slug: leverage-as-a-dailies-transform
status: complete
nyquist_compliant: true
wave_0_complete: true
created: 2026-07-15
---

# Phase 107 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.
> Derived from RESEARCH.md §Validation Architecture.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest (v8 coverage), jsdom for `.tsx` component tests |
| **Config file** | `vitest.config.ts` (coverage: lines 82 / stmts 80 / fns 74 / branches 72) |
| **Quick run command** | `npx vitest run src/app/factsheet/[id]/v2/FactsheetView.leverage.test.tsx src/lib/factsheet/joint.test.ts --no-file-parallelism` |
| **Full suite command** | `npm run test` |
| **Estimated runtime** | ~5s quick / ~180s full (8000+ tests) |

---

## Sampling Rate

- **After every task commit:** Run the quick command over the touched leverage/basis/joint test files (`--no-file-parallelism`).
- **After every plan wave:** Run `npm run test` (full vitest suite).
- **Before `/gsd:verify-work`:** Full suite green + coverage thresholds hold + SC-4 snapshot (`__snapshots__/build-payload.test.ts.snap`) UNCHANGED.
- **Max feedback latency:** ~5 seconds (quick), ~180 seconds (full).

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 107-SC1 | 01/02 | 1/2 | LEV-BB | — / input-clamp | Charts + rail re-derive levered at L≠1 (not just 7 scalars) | component | `npx vitest run src/app/factsheet/[id]/v2/FactsheetView.leverage.test.tsx src/app/factsheet/[id]/v2/basis-context.leverage.test.tsx` | ✅ | ✅ green (Tests B/C/E; view drives strip+rail+charts) |
| 107-SC2 | 01 | 1 | LEV-BB | — | α→L·α, β→L·β honest; corr-invariant at L≠1 | unit + component | `npx vitest run src/lib/factsheet/joint.test.ts` | ✅ | ✅ green (LEV-BB describe, 10dp; joint.ts byte-untouched) |
| 107-SC3 | 03 | 3 | LEV-BB | — | Disclosure hooks deleted; slider state kept | source-scan + component | `npx vitest run "src/app/factsheet/[id]/v2/leverage-backbone-gates.test.ts"` + `leverage-context.test.tsx` | ✅ | ✅ green (recursive src/ walk; neuter-confirmed live) |
| 107-SC4 | 01 | 1 | LEV-BB | — | L=1 byte-identical (reference short-circuit) | snapshot/reference | `npx vitest run src/lib/factsheet/build-payload.test.ts` + basis-context.leverage Test A (by-ref) + `git diff --exit-code …/build-payload.test.ts.snap` | ✅ | ✅ green (snapshot byte-unchanged; Test A ref-identity + 2→1 round-trip) |
| 107-SC5 | 03 | 3 | LEV-BB | — | One transform; no second leverage compute path | source-scan | `npx vitest run "src/app/factsheet/[id]/v2/leverage-backbone-gates.test.ts"` (SC-5 gate + liveness fixture) | ✅ | ✅ green (no `compute(<series>.map(…))` outside scenario.ts; liveness pinned) |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky. Task IDs re-map to real plan/wave IDs at plan time.*

---

## Wave 0 Requirements

- [x] Rewrite `FactsheetView.leverage.test.tsx` — replace MODELED/α-IR-suppression/BASE·1× assertions with "charts + rail + α/β follow L" assertions; keep eligibility + clamp-message tests. _(plan 02, `11173c32`)_
- [x] Add an L-scaling case to `joint.test.ts` proving β→L·β, α→L·α, corr-invariant (falsifiable — fails if a future change re-analytic-scales). _(plan 01, `8fc83990`)_
- [x] Add SC-4 L=1 reference/byte-identity assertion (extend `build-payload.test.ts` or a new leverage-view test). _(plan 01 Test A, `50f6a01c`; snapshot byte-unchanged)_
- [x] Add SC-5 grep-gate test (no second leverage compute path outside `scenario.ts`). _(plan 03, `2034c180` — with liveness fixture)_
- [x] Prune `leverage-context.test.tsx` to the kept-state (slider/GUARD-04) surface. _(plan 02, `355b6200`)_

*Existing vitest/jsdom infrastructure covers all phase requirements — no framework install needed.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Slider interactivity does not visibly jank on rapid L changes (bootstrapCI perf) | LEV-BB (A3) | Perf/UX feel is not deterministically assertable in jsdom | **RESOLVED by measurement (107-03):** re-derive median = **235ms** at 3000-day production scale (≥100ms decision rule → debounce applied). The DERIVE is debounced via `useDeferredValue` on the leverage read (last-good bundle stays rendered, input immediate); pinned by basis-context.leverage Test H. Optional feel-check only if the deployed slider still visibly freezes. |

*All correctness behaviors have automated verification; only the interactive perf feel is manual.*

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references
- [x] No watch-mode flags
- [x] Feedback latency < 180s
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** signed off 2026-07-15 — all five SC rows green; full suite 8142 passed / 0 failed; SC-4 snapshot + scenario.ts/leverage.ts/joint.ts byte-untouched; perf decision made on the measured 235ms median.
