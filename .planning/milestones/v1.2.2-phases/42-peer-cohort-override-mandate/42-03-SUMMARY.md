---
phase: 42-peer-cohort-override-mandate
plan: 03
subsystem: ui
tags: [factsheet, scenario, peer-percentile, discriminated-union, typescript, vitest, quantstats-convention]

# Dependency graph
requires:
  - phase: 39-scenario-factsheet-parity
    provides: buildScenarioFactsheetPayload — the synth FactsheetCsvPayload builder the scenarioPeer arg extends
  - phase: 40-inert-scenario-seam
    provides: MetricsColumn scenarioMode prop (inert seam) — this plan activates it
  - phase: 42-01
    provides: ADR-0025 (the additive carve-out decision) + the PeerPercentilePayload contract
provides:
  - "Additive scenarioPeer?: PeerPercentilePayload on FactsheetCsvPayload (csv-arm only; api arm + union untouched)"
  - "MetricsColumn 3-clause OR-gate activating the scenarioMode seam (api OR (scenarioMode && csv && scenarioPeer != null))"
  - "PeerPercentilePanel dual-read (peerPercentile on api OR scenarioPeer on csv) with the B6 narrow"
  - "buildScenarioFactsheetPayload optional scenarioPeer arg (conditionally spread → existing call sites byte-identical)"
  - "REPLACED audit-c20 behavioral invariant (carve-out renders, synth panels absent, ingestSource csv) + KEPT type-field invariant"
  - "Convention pin (scenario.peer-basis.test.ts): the blend's ranking basis is engine sample/252, not population"
affects: [42-04, 42-05, peer-rank-route, scenario-composer, factsheet-render-tests]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Additive discriminated-union carve-out: a csv-arm-only optional field surfaces a panel WITHOUT flipping the discriminant (never unlocks the api-only synthetic panels)"
    - "Conditional spread for byte-identity: ...(arg ? { arg } : {}) omits the key (not undefined) so existing call sites produce an unchanged object"
    - "Convention pin: drive the engine with a single-strategy w=1/L=1 scenario, assert sample-basis metrics + assert the population value diverges (a basis bleed fails the pin)"

key-files:
  created:
    - src/lib/scenario.peer-basis.test.ts
  modified:
    - src/lib/factsheet/types.ts
    - src/app/factsheet/[id]/v2/MetricsColumn.tsx
    - src/app/factsheet/[id]/v2/BatchDPanels.tsx
    - src/app/(dashboard)/allocations/widgets/performance/scenario-factsheet-payload.ts
    - src/lib/factsheet/audit-c20.test.ts

key-decisions:
  - "scenarioPeer is additive + optional on FactsheetCsvPayload ONLY; the conditional spread keeps every existing csv call site byte-identical and the 4 api-only fields structurally absent (type-field invariant preserved)"
  - "MetricsColumn gate: payload.ingestSource === 'api' || (scenarioMode && payload.ingestSource === 'csv' && payload.scenarioPeer != null) — the explicit csv narrow is required to read the csv-only field (Pitfall 3, B6 discipline)"
  - "Pinned the engine's ROUNDED contract: scenarioMetrics.sharpe/sortino are toFixed(3) (scenario.ts:464-465); the convention pin compares against round3(reference), and the sample-vs-population divergence (5.784 vs 5.883) survives the rounding"

patterns-established:
  - "Carve-out without discriminant flip: PEER-01 surfaces peer on the blend via an additive csv-arm field, never an ingestSource='api' flip"
  - "Basis-divergence pin: the convention test asserts BOTH that the engine matches the sample basis AND that the population basis is a distinct, higher value — so a future population bleed is a hard failure, not a silent inflation"

requirements-completed: [PEER-01, PEER-02]

# Metrics
duration: 36min
completed: 2026-06-26
---

# Phase 42 Plan 03: Peer carve-out contract Summary

**Additive `scenarioPeer?: PeerPercentilePayload` on the `FactsheetCsvPayload` arm + a 3-clause `MetricsColumn` OR-gate + a `PeerPercentilePanel` dual-read + an optional `buildScenarioFactsheetPayload` arg, with the audit-c20 behavioral invariant replaced (carve-out renders, synthetic panels absent, `ingestSource` stays `csv`) and a convention pin proving the blend's ranking Sharpe/Sortino come from the engine's sample/252 basis, never `compute.ts`'s population headline.**

## Performance

- **Duration:** ~36 min
- **Started:** 2026-06-26T12:03:40Z
- **Completed:** 2026-06-26T12:39:53Z
- **Tasks:** 3
- **Files modified:** 6 (4 modified + 2 test files, one new)

## Accomplishments
- Laid the additive carve-out contract: `scenarioPeer?` on the csv arm only, with the api arm + `peerPercentile` + the 4 api-only fields + the discriminated union provably untouched (diff confirms no edit to those lines).
- Activated the Phase-40 inert `scenarioMode` seam via the `MetricsColumn` 3-clause OR-gate; with `scenarioMode=false` (every existing call site) the api peer path is byte-identical (the csv disjunct is dead).
- `PeerPercentilePanel` now dual-reads `peerPercentile` (api) OR `scenarioPeer` (csv) via the B6 narrow; the "Demo cohort" badge + synthesized-cohort footnote are suppressed on the scenario path (the hypothetical disclosure copy is plan 04's render task).
- `buildScenarioFactsheetPayload` accepts an optional `scenarioPeer` arg, conditionally spread so the key is OMITTED (not undefined) when absent — every existing call site stays byte-identical.
- REPLACED the audit-c20 behavioral pin (`csv → peer NEVER renders`) with the carve-out invariant (csv+scenarioPeer carries the rank, the 4 synth fields stay structurally absent, `ingestSource` stays `csv`) while KEEPING the type-field invariant + the type-level B6 block verbatim.
- Pinned the ranking convention (`scenario.peer-basis.test.ts`): `computeScenario`'s sharpe/sortino equal a hand-derived sample (ddof=1) × √252 reference, and the population-basis Sharpe for the same series is distinct + strictly higher by exactly √(n/(n−1)) — a population bleed fails the pin (negative-probe verified).

## Task Commits

Each task was committed atomically:

1. **Task 1: scenarioPeer field + OR-gate + panel dual-read + builder arg** — `b709b6d7` (feat)
2. **Task 2: REPLACE the audit-c20 behavioral invariant (keep the type-field invariant)** — `144e75a0` (test)
3. **Task 3: Convention pin — ranking basis == engine sample/252, not population** — `4debf886` (test)

_Plan metadata / SUMMARY: NOT committed — `.planning/` is gitignored by project design; SUMMARY + deferred-items live local-only._

## Files Created/Modified
- `src/lib/factsheet/types.ts` — added `scenarioPeer?: PeerPercentilePayload` to `FactsheetCsvPayload` only (PEER-01); api arm + `peerPercentile` + the union untouched.
- `src/app/factsheet/[id]/v2/MetricsColumn.tsx` — dropped the `void scenarioMode` no-op; replaced the peer gate with the 3-clause OR (api OR (scenarioMode && csv && scenarioPeer != null)).
- `src/app/factsheet/[id]/v2/BatchDPanels.tsx` — `PeerPercentilePanel` dual-read; suppressed the Demo-cohort badge + footnote on the csv/scenario path.
- `src/app/(dashboard)/allocations/widgets/performance/scenario-factsheet-payload.ts` — optional `scenarioPeer` arg + conditional spread in the csv return; imported `PeerPercentilePayload`.
- `src/lib/factsheet/audit-c20.test.ts` — replaced the IMPORTANT-2 behavioral pin with the PEER-01 carve-out case (+ a byte-identity case); kept the absence + type-level B6 invariants.
- `src/lib/scenario.peer-basis.test.ts` (new) — the PEER-02 convention pin.

## Decisions Made
- **Pinned against the engine's ROUNDED return contract.** `scenarioMetrics.sharpe`/`.sortino` are `toFixed(3)` and `max_drawdown` is `toFixed(5)` (`scenario.ts:464-466`). The convention pin compares `m.sharpe` against `round3(sampleSharpeRef)` (exact `.toBe`) rather than a raw float `toBeCloseTo` — this is the actual contract `scenarioMetrics` exposes, and the sample-vs-population divergence (5.784 vs 5.883) survives the 3-dp rounding, so the pin stays load-bearing.
- **Single-strategy w=1/L=1 harness for the pin.** With one active strategy the engine's renormalized weight is exactly 1, so the blend's portfolio daily returns equal the fixture series verbatim — letting the test assert the engine's metric math directly against a transparent hand-derivation on the fixed series.
- **Scenario-path disclosure deferred to plan 04 (per the plan).** This plan only wires the panel READ path + suppresses the Demo-cohort badge for the scenario case; the hypothetical disclosure copy is plan 04's render task. The api/demo footnote is left intact on the api path.

## Deviations from Plan

None — plan executed exactly as written. No deviation rules (1–4) were triggered; no authentication gates; no packages installed; no architectural changes. All three tasks landed as specified, and the convention pin's comparison-against-the-rounded-engine-contract is a faithful implementation of the plan's "assert scenarioMetrics matches a sample-basis reference" instruction (the engine returns rounded values, so the reference is rounded the same way).

## Issues Encountered

- **Engine rounds Sharpe/Sortino to 3 dp.** The first draft of the convention pin used `toBeCloseTo(ref, 9)` and failed by ~2.4e-4: `scenarioMetrics.sharpe` is `Number(sharpe.toFixed(3))` (`scenario.ts:464`), so the engine's value is rounded to 5.784 while the raw reference is 5.78375966…. Resolved by comparing against `round3(reference)` with exact `.toBe`, which is the engine's real contract. Verified via a negative probe that asserting the engine matches the population leg (5.883) fails — proving the pin catches a basis bleed.
- **`scenarioPeer` referenced before `SYNTH_FIELDS` in the test file.** The new audit-c20 case (~line 333) uses `SYNTH_FIELDS` declared at ~line 364. Module-level `const` is in the TDZ until its line evaluates, but the `it()` callbacks execute after module evaluation completes — same pattern the existing RED-TEAM-M2/M3 block already relies on. Confirmed green (39/39).

### Out-of-scope discovery (logged, NOT fixed)

A full `npm run test:coverage` surfaced **4 pre-existing failures** in the milestone-v1.2 frozen-spine guards (`phase-29..32-frozen-spine-guards.test.ts`), all asserting `src/lib/scenario.ts is zero-diff vs baseline`. **Plan 42-03 did NOT touch `scenario.ts`** — the 12-line diff vs the guard baseline (`e5e4f3d2`, the v1.2.1 tag) was introduced by an EARLIER phase-41 commit (`4bcedb12`, a no-behavior-change `DEFAULT_INCLUDE_FROM` hoist) and is present at HEAD~3, before any 42-03 work. Per the executor SCOPE BOUNDARY rule these are out of scope; logged to `.planning/phases/42-peer-cohort-override-mandate/deferred-items.md` for a v1.2-milestone-lifecycle decision (re-baseline or retire the shipped-milestone frozen-spine guards). A separate set of non-deterministic vitest worker-startup timeouts in UNRELATED files is the known local CPU-contention flake (did not reproduce on serial re-run; 179/179 touched-area tests green).

## User Setup Required

None — no external service configuration required. This plan is a pure type/gate/panel/builder + test contract; the server fetch + RPC + route land in later plans (42-05).

## Next Phase Readiness
- The carve-out CONTRACT is in place and compiles: plan 04 can render the hypothetical disclosure on the scenario path (the panel already reads `scenarioPeer`) and add the MetricsColumn render test (gate mounts the panel under `scenarioMode=true`).
- Plan 05 can wire the real cohort fetch and feed the resulting `PeerPercentilePayload` into `scenarioPeer` via the `buildScenarioFactsheetPayload` arg — the ranking metrics MUST come from `scenarioMetrics` (sample basis), which the convention pin now guards.
- No blockers introduced by this plan. The pre-existing frozen-spine guard reds (deferred-items) are a v1.2-milestone bookkeeping concern, independent of this plan's correctness.

## Self-Check: PASSED

- All 6 source/test files exist on disk (4 modified + `scenario.peer-basis.test.ts` created + `audit-c20.test.ts` extended).
- All 3 task commits exist in git: `b709b6d7` (feat), `144e75a0` (test), `4debf886` (test).
- `tsc --noEmit` exit 0; `eslint` exit 0 on all touched files.
- Targeted suites green: `src/lib/factsheet/` + `scenario.peer-basis.test.ts` = 120/120; serial touched-area re-run = 179/179.
- `scenarioPeer` present in all four required files (types, MetricsColumn, BatchDPanels, scenario-factsheet-payload); `scenarioMetrics` present in the convention pin.
- The 4 full-suite reds are pre-existing out-of-scope frozen-spine guards (phase-41 `scenario.ts` edit, not 42-03) — logged to `deferred-items.md`, not fixed per the SCOPE BOUNDARY rule.

---
*Phase: 42-peer-cohort-override-mandate*
*Completed: 2026-06-26*
