---
phase: 43-edge-states-toggle-fold-guards
plan: 02
subsystem: ui
tags: [react, vitest, factsheet, byte-identity, regression-gate, cross-tab-bleed, permanent-guard]

# Dependency graph
requires:
  - phase: 40-factsheet-body-mount
    provides: the additive scenarioMode prop on FactsheetBody + the existing per-phase FactsheetBody.scenario-mode innerHTML-equality test (the GUARD-02 promotion target)
  - phase: 38-scenario-tab-hardening
    provides: FactsheetProvider persist={false} gate (factsheet-context.tsx:282 read half / :321 write half) — the RT2 runtime control GUARD-04 pins
  - phase: 43-edge-states-toggle-fold-guards
    plan: 01
    provides: the additive FactsheetFooter scenarioMode gate (default false → byte-identical) that GUARD-02 must stay green against, before and after
provides:
  - "GUARD-02: PERMANENT byte-identity gate — FactsheetBody default ≡ scenarioMode={false} innerHTML on a populated payload, marked permanent, stays through milestone close"
  - "GUARD-02 Overview-untouched assertion: the Overview EquityChartWidget module (widgets/performance/EquityChart.tsx) references neither FactsheetBody nor #factsheet-main (static import-shape scan)"
  - "GUARD-04: PERMANENT cross-tab-bleed gate — the real FactsheetBody under persist={false} writes ZERO factsheet-keyspace localStorage / view-state URL params after a real view-state interaction (RT2 class stays closed)"
affects: [milestone-v1.2.2-close, 43-03-guard-03-axe]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Permanent regression gate: a per-phase byte-identity test is PROMOTED in place (retagged describe + header note), not replaced by a parallel test"
    - "Static import-shape scan (readFileSync + literal-absence) as a render-engine-independent scope-boundary guard (mirrors composer-width.test.tsx)"
    - "Keyspace-scoped spy predicate (NOT blanket 'never called') so the legitimate composer-collapse:controls key is documented-as-allowed while the factsheet keyspace is forbidden"
    - "Falsifiability proof by momentary mutation: flip persist=true → the write fires and the keyspace predicate trips RED, then revert"

key-files:
  created:
    - "src/app/factsheet/[id]/v2/FactsheetBody.guard04-no-bleed.test.tsx"
  modified:
    - "src/app/factsheet/[id]/v2/FactsheetBody.scenario-mode.test.tsx"

key-decisions:
  - "GUARD-02 PROMOTED the existing scenario-mode test in place (research explicit: do NOT create a parallel byte-identity test). Retagged describe → 'FactsheetBody — PERMANENT byte-identity gate (GUARD-02)' + a header note 'do NOT delete at milestone close'. The innerHTML-equality core is kept verbatim."
  - "Overview-untouched assertion = a static import-shape scan (readFileSync of widgets/performance/EquityChart.tsx, the default export AllocationDashboardV2.tsx:8 mounts as EquityChartWidget) asserting NO 'FactsheetBody' and NO 'factsheet-main' literal. Lowest-coupling, render-engine-independent, permanent — the research Open-Question-2 recommendation, mirroring composer-width.test.tsx's static-source-scan pattern."
  - "GUARD-04 drives the Display 'Dark mode' toggle (a guaranteed false→true state flip in the dep array of the write effect) as the falsifiable mutation; a second case drives 'Reset view'. Both advance past the 250ms write debounce."
  - "GUARD-04 assertions filter on keyspace predicates (/^factsheet-v2|^factsheet-collapse/ for setItem, /[?&](range|cmp|dark)=/ for replaceState url) — NOT a blanket 'setItem never called'. A third pure-predicate case documents the Pitfall-5 boundary: composer-collapse:controls is ALLOWED (out of scope), only the factsheet keyspace is forbidden."

requirements-completed: [GUARD-02, GUARD-04]

# Metrics
duration: 20min
completed: 2026-06-26
---

# Phase 43 Plan 02: Edge states, toggle fold & guards (GUARD-02 + GUARD-04) Summary

**Installed the two PERMANENT milestone-closing vitest regression gates — GUARD-02 (byte-identity: FactsheetBody default ≡ scenarioMode={false} innerHTML, plus a static import-shape assertion that the Overview EquityChartWidget never mounts the factsheet body) and GUARD-04 (cross-tab-bleed: the real body under persist={false} writes ZERO factsheet-keyspace localStorage / view-state URL params after a real Dark-mode/Reset-view interaction) — both robust to 43-01's additive footer change by construction and both mutation-verified falsifiable.**

## Performance

- **Duration:** ~20 min
- **Started:** 2026-06-26T17:16:00Z
- **Completed:** 2026-06-26T17:21:00Z
- **Tasks:** 2
- **Files:** 1 created, 1 modified (both test files)

## Accomplishments

- **GUARD-02 (Task 1):** Promoted the existing per-phase `FactsheetBody.scenario-mode.test.tsx` IN PLACE into the permanent milestone-closing gate (research was explicit: promote, do NOT create a parallel byte-identity test). Retagged the describe block to `FactsheetBody — PERMANENT byte-identity gate (GUARD-02)`, added a header note ("pins the real /factsheet/[id]/v2 route byte-identical at scenarioMode default; do NOT delete at milestone close"), kept the innerHTML-equality core (`default ≡ scenarioMode={false}` on a ~300-point populated payload) verbatim, and added the **Overview-untouched assertion** — a static import-shape scan (`readFileSync` of `widgets/performance/EquityChart.tsx`, the default export `AllocationDashboardV2.tsx:8` mounts as `EquityChartWidget`) asserting the module references neither `FactsheetBody` nor `factsheet-main`. The artifact contains the literal `PERMANENT`.
- **GUARD-04 (Task 2):** New `FactsheetBody.guard04-no-bleed.test.tsx` mounts the REAL `FactsheetBody` under `<FactsheetProvider persist={false}>` on a populated payload, spies on BOTH `window.localStorage.setItem` AND `window.history.replaceState`, drives real view-state interactions (Display "Dark mode" toggle + "Reset view"), advances past the 250ms write debounce, and asserts ZERO writes scoped to the factsheet keyspace (`/^factsheet-v2|^factsheet-collapse/`) and view-state URL params (`/[?&](range|cmp|dark)=/`). The artifact contains the literal `persist={false}`.
- **Both gates are falsifiable:** GUARD-04 was mutation-verified by momentarily flipping `persist={true}` → the Dark-mode toggle fired a `factsheet-v2:scenario` localStorage write `{"range":"0-299","cmp":"none","dark":"1"}` and the keyspace predicate tripped the test RED; reverted. GUARD-02's Overview assertion is falsifiable by construction (any future `FactsheetBody`/`factsheet-main` literal entering the Overview module appears in the source and fails the `.not.toContain`).
- **Scope-boundary documented (Pitfall 5):** GUARD-04's assertions are keyspace PREDICATES, not "setItem never called" — a third pure-predicate case explicitly pins that the legitimate `composer-collapse:controls` UI-pref key is ALLOWED (out of scope) while the factsheet keyspace is forbidden.
- **Invariants held:** both new GUARD tests green; the full `src/app/factsheet/[id]/v2/` dir = 10 files / 64 tests green against current main; `tsc --noEmit` reports 0 errors in the two test files; eslint 0 errors/warnings on both.

## Task Commits

Each task was committed atomically:

1. **Task 1: Promote scenario-mode test → PERMANENT GUARD-02 byte-identity gate + Overview-untouched assertion** — `9c0523ab` (test)
2. **Task 2: GUARD-04 cross-tab-bleed spy test (keyspace-scoped)** — `4ed314d2` (test)

## Files Created/Modified

- `src/app/factsheet/[id]/v2/FactsheetBody.scenario-mode.test.tsx` (modified) — retagged describe to PERMANENT (GUARD-02); header note marks it non-disposable; kept the innerHTML-equality core verbatim; added the Overview-untouched static import-shape assertion (no `FactsheetBody` / `factsheet-main` literal in the Overview `EquityChart.tsx` module).
- `src/app/factsheet/[id]/v2/FactsheetBody.guard04-no-bleed.test.tsx` (created) — the GUARD-04 RT2-class gate: real body under `persist={false}`, dual spy on `setItem` + `replaceState`, real interactions, keyspace-scoped predicates, falsifiability + Pitfall-5 scoping documented.

## Decisions Made

- **GUARD-02 promotion, not a parallel test.** The research and plan are explicit that the existing P40 byte-identity test IS the GUARD-02 surface — promote it in place. Retag + header note + the additive Overview assertion; the innerHTML-equality proof (the gate's core) is untouched.
- **Overview-untouched = static import-shape scan.** Per research Open-Question-2: a `readFileSync` literal-absence assertion is the lowest-coupling permanent guard — render-engine-independent (no JSDOM render of the Overview dashboard needed) and falsifiable by construction. Mirrors the established `composer-width.test.tsx` static-source-scan pattern. The Overview widget module is the default export of `widgets/performance/EquityChart.tsx` (verified via `AllocationDashboardV2.tsx:8 import EquityChartWidget from "./widgets/performance/EquityChart"`).
- **GUARD-04 mutation path = Dark-mode toggle.** `darkMode` is in the write effect's dep array, so the toggle (false→true) is a guaranteed state flip that, on the real route, writes `?dark=1` + the `factsheet-v2:` blob — the cleanest falsifiable mutation. A second case drives "Reset view" (resetXRange + setComparator) for a second view-state path. Real (non-fake) timers + a 400ms wait window mirror the existing `factsheet-context.provider.test.tsx` persist-opt-out cases.
- **Keyspace predicates over blanket assertions (Pitfall 5).** The assertions filter `setItem`/`replaceState` calls through `isFactsheetKeyWrite` / `isFactsheetUrlWrite` predicates so the guard forbids ONLY the factsheet view-state keyspace, documenting that `composer-collapse:controls` would be allowed (it never fires here — only the body is mounted, not the composer — but the predicate scoping is written and a third pure-predicate case pins it).

## Deviations from Plan

None — plan executed exactly as written. Both tasks were test-only (no source change), both new tests green on first authoring, falsifiability confirmed by momentary mutation then reverted. No deviation rules triggered.

## Issues Encountered

- **Benign JSDOM canvas noise.** Mounting the full `FactsheetBody` (which includes the chart `TimeSeriesChart`/`MasterBrush`) emits `Not implemented: HTMLCanvasElement's getContext()` warnings under jsdom. These are pre-existing jsdom-without-canvas noise (the same warnings appear across the whole factsheet dir suite), not test failures — all 64 dir tests pass regardless. No action needed (the guards assert on the persist sinks, not canvas paint).

## Known Stubs

None — both artifacts are real regression gates with live assertions against the real FactsheetBody / real Overview module / real persist gate. No placeholder values, no mock-only data sources, no trivially-passing assertions (both gates mutation-verified to fail when their invariant is broken).

## User Setup Required

None — pure vitest test files; no env vars, no migrations, no endpoints, no external service config.

## Next Phase Readiness

- GUARD-02 + GUARD-04 complete and PERMANENT; the byte-identity invariant on the real `/factsheet/[id]/v2` route and the RT2 no-state-bleed invariant now fail CI loudly on any future regression.
- Remaining in Phase 43: **43-03 GUARD-03** (extend the already-CI-wired `composer-axe.spec.ts` with visible-anchor gates for `#factsheet-main` + the Diversification/Peer/Mandate sections; coverage ratchet stays green). GUARD-03 is the last guard before milestone v1.2.2 close.
- No blockers. The `composer-collapse:controls` key (the only legitimate composer-surface persisted key) is documented-as-allowed in GUARD-04's scope; GUARD-03 adds no new persisted key.

## Self-Check: PASSED

- SUMMARY file: created at .planning/phases/43-edge-states-toggle-fold-guards/43-02-SUMMARY.md
- Created file `src/app/factsheet/[id]/v2/FactsheetBody.guard04-no-bleed.test.tsx`: FOUND
- Modified file `src/app/factsheet/[id]/v2/FactsheetBody.scenario-mode.test.tsx`: FOUND
- Commit 9c0523ab (GUARD-02 promotion): FOUND
- Commit 4ed314d2 (GUARD-04): FOUND
- Artifact literal "PERMANENT" in scenario-mode test: PRESENT
- Artifact literal "persist={false}" in guard04 test: PRESENT
- Both GUARD tests green (9 tests); full factsheet/[id]/v2 dir green (10 files / 64 tests); tsc 0 errors; eslint 0 errors

---
*Phase: 43-edge-states-toggle-fold-guards*
*Completed: 2026-06-26*
