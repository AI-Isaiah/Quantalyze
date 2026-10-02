---
phase: 107-leverage-as-a-dailies-transform
plan: 03
subsystem: ui
tags: [vitest, source-scan-gate, leverage, perf, useDeferredValue, coverage, verification]

# Dependency graph
requires:
  - phase: 107-01
    provides: leverage-composed useBasisSeriesView + exported deriveSeriesBundle
  - phase: 107-02
    provides: disclosure apparatus + useLeveragedMetrics/useModeledLeverage deleted (SC-3/SC-5 kill)
provides:
  - permanent SC-3 source-scan gate (no useLeveragedMetrics/useModeledLeverage/LEVERAGE_CAVEAT in src/)
  - permanent SC-5 source-scan gate (no second compute(<series>.map(...)) leverage path outside scenario.ts) + liveness fixture
  - measured perf decision (235ms median re-derive) → useDeferredValue derive-debounce on the leverage read
  - phase verification sweep green (full suite + coverage + SC-4 snapshot unchanged + LEV-02 surface byte-untouched)
affects: [ci, factsheet-view, basis-context]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Source-scan tripwire: recursive src/ walk (readdirSync withFileTypes), comment-stripped, forbidden tokens built by string concat so the gate never self-matches; liveness fixture proves the regex matches the retired shape (a typo can't silently pass everything)"
    - "Measurement-gated perf: time the real re-derive at production scale, apply a hard decision rule (median ≥ 100ms → debounce), never accept jank on vibes"
    - "Debounce the DERIVE, not the input: useDeferredValue on the leverage read keeps the last-good bundle rendered while React re-derives in the background — input stays immediate, no skeleton flash"

key-files:
  created:
    - src/app/factsheet/[id]/v2/leverage-backbone-gates.test.ts
  modified:
    - src/app/factsheet/[id]/v2/basis-context.tsx
    - src/app/factsheet/[id]/v2/basis-context.leverage.test.tsx

key-decisions:
  - "SC-5 liveness is proven via a hard-coded retired-line fixture inside the test (not by scenario.ts matching — scenario.ts uses lev()*returns, NOT a compute(...map(...)) shape, so it is exempted defensively, not as the liveness proof)"
  - "Perf debounce implemented with useDeferredValue (not a 200ms setTimeout): act() flushes the deferred re-render synchronously so all 8 existing setLeverage-then-assert hook/component tests stay green UNCHANGED, keeping the blast radius to the plan's declared surface (basis-context.tsx + basis-context.leverage.test.tsx)"
  - "SC-3/SC-5 both comment-strip before scanning so header prose describing the deleted path cannot self-invalidate the gate (grep-gate hygiene, mirrors GUARD-04 Test 6)"

patterns-established:
  - "Permanent falsifiable structural gates for a retired code class — the phase's SC-5 'ONE transform, no second leverage compute path' claim is a CI tripwire, not a code-review observation"

requirements-completed: [LEV-BB]

# Metrics
duration: 18min
completed: 2026-07-15
---

# Phase 107 Plan 03: Backbone gates + verification sweep Summary

**Landed the two permanent falsifiable source-scan gates (SC-3: the disclosure/derived-hook symbols can never reappear in `src/`; SC-5: no second `compute(<series>.map(...))` leverage path may return outside `scenario.ts`, proven live via a retired-line fixture), then ran the phase verification sweep — full suite 8142 passed / 0 failed with coverage thresholds held, SC-4 snapshot and the LEV-02 surface (`scenario.ts`/`leverage.ts`/`joint.ts`) byte-untouched — and made the bootstrapCI performance decision on a MEASURED 235ms median re-derive: the ≥100ms rule tripped, so the derive is now debounced via `useDeferredValue` on the leverage read (input immediate, last-good bundle rendered).**

## Performance
- **Duration:** ~18 min
- **Tasks:** 2
- **Files:** 1 created, 2 modified

## Accomplishments
- **Task 1 — SC-3 + SC-5 gates (`2034c180`):** new `leverage-backbone-gates.test.ts` (node env). SC-3 recursively walks `src/` (`readdirSync` withFileTypes, `.ts`/`.tsx` only, skipping `node_modules`/`__snapshots__`/self), comment-strips, and asserts no file contains `useLeveragedMetrics`/`useModeledLeverage`/`LEVERAGE_CAVEAT` — tokens built by string concatenation so the gate never self-matches. SC-5 runs the same walk (additionally skipping `scenario.ts`), comment-strips, and asserts no line matches `/compute\(\s*[\w$.\[\]]+\.map\(/`; a third test pins the regex's **liveness** against a hard-coded sample of the retired `compute(payload.strategyReturns.map(r => appliedLeverage * r), …)` line so a regex typo can't silently pass everything. Proven live via a neuter check (re-adding `useLeveragedMetrics` to a scratch src file turned SC-3 red; reverted).
- **Task 2 — verification sweep + measured perf decision (`3918ee99`):**
  - Full gate: `npm run test` = **8142 passed / 0 failed / 287 skipped**; `npm run test:coverage` **exit 0** with thresholds held (**lines 86.69 / stmts 84.57 / funcs 81.56 / branches 78.01** vs gate 82/80/74/72); `npx tsc --noEmit` clean; `npm run lint` 0 errors (1 pre-existing EquityChart `exhaustive-deps` warning, out of scope).
  - Untouched-surface gates: `git diff --exit-code` empty for `build-payload.test.ts.snap`, `scenario.ts`, `leverage.ts`, `joint.ts`.
  - Perf: scratchpad `tsx` probe (never committed) timed `deriveSeriesBundle` on a synthetic **3000-day** levered `DailyReturn[]`, 5 runs → **median 235ms** (runs 217/230/235/268/269ms). ≥100ms → the UI-SPEC derive-debounce lands.

## Perf decision (measurement-gated)
- **Measured median:** 235ms re-derive at 3000-day production scale (decision rule threshold 100ms).
- **Decision:** DEBOUNCE — implemented per the UI-SPEC fallback. `useBasisSeriesView` now wraps the leverage read in `useDeferredValue`, so a rapid slider drag never blocks the input on the expensive `deriveSeriesBundle`; the last-good bundle stays rendered while React re-derives in the background. The DERIVE is debounced, not the input; the unity/base short-circuits read the deferred value so dropping back to L=1 restores the by-reference base as React catches up.
- **Why `useDeferredValue` over a 200ms `setTimeout`:** `act()` flushes the deferred re-render synchronously in tests, so the 8 existing `setLeverage`-then-assert hook/component tests stay green unchanged (a hard timer would have broken them and expanded the blast radius past the plan's declared surface). `useDeferredValue` is the idiomatic React mechanism for "an expensive derived view must not block input" and is listed first in the plan's fallback options.

## LOC recount vs the ~780 target
`git diff --stat b196de6c..HEAD` over the five leverage files (`build-payload.ts`, `basis-context.tsx`, `leverage-context.tsx`, `FactsheetView.tsx`, `leverage-context.test.tsx`): **242 insertions / 473 deletions** (net −231). The ~780 figure is the raw disclosure/hook apparatus removed across the phase (the amber MODELED eyebrow, `LEVERAGE_CAVEAT`, α-IR-blanking, the BASE·1× rail eyebrow, and the two derived hooks + their tests); the 473-line committed deletion column is the net after the levered-view rewire lines are folded in.

## Per-Task Verification Map (VALIDATION.md — all five SC rows → green)
| SC | Behavior | Command | Status |
|----|----------|---------|--------|
| SC-1 | charts + rail + strip re-derive levered at L≠1 | `vitest run FactsheetView.leverage.test.tsx basis-context.leverage.test.tsx` | ✅ |
| SC-2 | α→L·α, β→L·β honest, corr-invariant | `vitest run src/lib/factsheet/joint.test.ts` | ✅ |
| SC-3 | no disclosure/derived-hook symbols in src/ | `vitest run leverage-backbone-gates.test.ts` (neuter-confirmed) | ✅ |
| SC-4 | L=1 byte-identical + snapshot unchanged | `vitest run build-payload.test.ts` + Test A + `git diff --exit-code …snap` | ✅ |
| SC-5 | one transform; no second compute path | `vitest run leverage-backbone-gates.test.ts` (SC-5 gate + liveness) | ✅ |

## Deviations from Plan

### Auto-fixed / measurement-driven changes

**1. [Rule 2 / measurement-gated] The 200ms derive-debounce landed (measurement demanded it) — implemented via `useDeferredValue`**
- **Found during:** Task 2 perf measurement.
- **Trigger:** the plan's own decision rule — median re-derive 235ms ≥ 100ms → implement the UI-SPEC debounce fallback.
- **Change:** `useBasisSeriesView` reads `rawLeverage` then `const leverage = useDeferredValue(rawLeverage)`; the memo body/deps are unchanged (still keyed on `leverage`). Added a `useDeferredValue` import and updated the "Pure context + memo" doc block to "Context + a deferred leverage read + memo" (still GUARD-04-clean — scheduler-only, no I/O).
- **Test:** new `Test H` in `basis-context.leverage.test.tsx` — a source-scan pin that `useDeferredValue(rawLeverage)` is wired (falsifiable: reverting to a synchronous read turns it red) + a behavioral pin that the input value updates immediately to the set L (never blocked by the derive) while the deferred derive still lands on the ×L bundle.
- **Files modified:** `src/app/factsheet/[id]/v2/basis-context.tsx`, `src/app/factsheet/[id]/v2/basis-context.leverage.test.tsx`
- **Scope note:** exactly the surface the plan pre-authorized for this branch (basis-context.tsx + basis-context.leverage.test.tsx). No architectural change; not a Rule 4 event. The plan-01 SC-4 by-reference short-circuit, the four guards, and the honesty algebra are untouched.

**Total deviations:** 1, and it is the plan's own measurement-gated conditional (not an unplanned fix). No package installs; no architectural changes; SC-4 snapshot and the LEV-02 surface byte-untouched.

## Issues Encountered
- `npm run test` is `vitest run` **without** `--coverage`; the thresholds are enforced by the separate `npm run test:coverage` (and by CI's sharded `frontend-coverage` merge). Ran both — full suite green AND coverage-enforced green — rather than assuming the plain run proved thresholds (fail-loud).

## Known Stubs
None — the gates are real recursive source scans with a liveness fixture; the debounce re-derives real bundles.

## Threat Flags
None new. T-107-05 (re-introduction of a second leverage compute path) is now permanently mitigated by the SC-5 gate + liveness fixture. T-107-03 (client DoS via per-L full re-derive) is mitigated by the measured `useDeferredValue` debounce. No new endpoint, auth path, file access, or schema surface.

## Self-Check: PASSED
- FOUND: src/app/factsheet/[id]/v2/leverage-backbone-gates.test.ts
- FOUND: src/app/factsheet/[id]/v2/basis-context.tsx (useDeferredValue wired)
- FOUND: src/app/factsheet/[id]/v2/basis-context.leverage.test.tsx (Test H)
- FOUND commit: 2034c180 (Task 1 — SC-3/SC-5 gates)
- FOUND commit: 3918ee99 (Task 2 — measured debounce)
- Full suite 8142 passed / 0 failed; coverage exit 0 (86.69/84.57/81.56/78.01)
- Untouched-surface `git diff --exit-code` empty (snapshot + scenario.ts + leverage.ts + joint.ts)

---
*Phase: 107-leverage-as-a-dailies-transform*
*Completed: 2026-07-15*
