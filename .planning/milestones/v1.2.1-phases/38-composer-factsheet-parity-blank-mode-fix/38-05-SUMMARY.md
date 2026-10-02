---
phase: 38-composer-factsheet-parity-blank-mode-fix
plan: 05
subsystem: allocations/composer-charts
tags: [react, parity-03, blank-slate, projection-guard, honesty-contract, mutation-falsifiable, tdd]

# Dependency graph
requires:
  - phase: 38-composer-factsheet-parity-blank-mode-fix (Plan 01)
    provides: "buildScenarioFactsheetPayload — non-degenerate strategyEquity from the scenario ALONE (empty baseline) → the blank-slate data precondition"
  - phase: 38-composer-factsheet-parity-blank-mode-fix (Plan 03)
    provides: "ScenarioFactsheetChart (the FINAL composer render path) + the data-testid=\"equity-chart-scenario-overlay\" test hook"
provides:
  - "Legacy EquityChart projection guard fixed to mirror DrawdownChart.tsx:147's `&& !hasScenario` — never bails on an empty baseline alone when a scenario exists"
  - "The LOAD-BEARING PARITY-03 proof: a mutation-falsifiable blank-slate render test on the NEW factsheet-backed path (empty baseline + scenario ⇒ a real scenario strategy line renders, NO synthetic baseline, no 'warming up' copy)"
affects: [scenario-tab, composer-blank-slate, parity-03]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Two-surface correctness: the load-bearing render proof lives on the FINAL render path (ScenarioFactsheetChart), the one-boolean guard fix keeps the still-shipped legacy path (Overview EquityChartWidget) correct too."
    - "Mutation-falsifiable honesty proof (Rule 9): the blank-slate test asserts a REAL drawn line (non-empty SVG path `d`), exactly ONE series (no fabricated baseline), and 'warming up' copy ABSENT — each turns RED under the relevant mutation."

key-files:
  created: []
  modified:
    - "src/app/(dashboard)/allocations/widgets/performance/EquityChart.tsx"
    - "src/app/(dashboard)/allocations/widgets/performance/EquityChart.scenario.test.tsx"

key-decisions:
  - "The legacy guard fix is a surgical one-boolean change — `(empty baseline) && !hasScenario`, kept on ONE line to mirror DrawdownChart.tsx:147 byte-for-byte. `hasScenario` (already defined :507) was added to the projection memo's dependency array since the guard now reads it."
  - "The load-bearing PARITY-03 proof targets the NEW path (ScenarioFactsheetChart), NOT the legacy EquityChart. The legacy overlay-render path is fundamentally gated on `visible.length > 0` (overlaySeries :623), and `visible` derives purely from `equityDailyPoints` — so the legacy path CANNOT draw the scenario overlay on an empty baseline. RESEARCH is explicit: satisfy PARITY-03 on whatever the FINAL render path is. The legacy fix is a correctness fix (it stops the dishonest 'warming up' placeholder when a scenario exists), proven by an observable copy-absence assertion on the legacy path."
  - "NO coverage deleted. The 14 pre-existing legacy scenario+toggle tests are untouched (they use populated baselines, where `hasScenario` does not alter the guard outcome — Overview behavior unchanged). The plan's 'retarget legacy assertions' instruction was satisfied by ADDING the new-path proof + a legacy-guard regression rather than gutting live legacy coverage (the legacy EquityChart still ships as the Overview EquityChartWidget — a surgical-changes constraint)."

requirements-completed: [PARITY-03]

# Metrics
duration: ~14min
completed: 2026-06-25
tasks: 1
files: 2
---

# Phase 38 Plan 05: PARITY-03 blank-slate scenario render + legacy guard fix Summary

**Blank-slate mode (empty baseline + a present scenario) now renders the scenario overlay on the composer's FINAL factsheet-backed path — proven by a mutation-falsifiable render test (a real scenario strategy line draws, NO synthetic baseline, no "Equity data warming up" copy) — and the still-shipped legacy `EquityChart` projection guard now mirrors `DrawdownChart.tsx:147`'s `&& !hasScenario` so it never bails on an empty baseline alone when a scenario exists.**

## What was built

### Task 1 — blank-slate proof on the new path + legacy guard fix (TDD, commit `ea1730c6`)

**The bug.** `EquityChart.tsx:675` short-circuited the projection memo to the "Equity data warming up" placeholder whenever `equityDailyPoints.length === 0` — BEFORE `hasScenario` was considered. So a blank-slate scenario (no live book yet, but a hypothetical built) rendered nothing.

**The legacy guard fix (one boolean, mirrors `DrawdownChart.tsx:147`).** Changed
`if (equityDailyPoints.length === 0 || composite.length === 0) return null;`
to
`if ((equityDailyPoints.length === 0 || composite.length === 0) && !hasScenario) return null;`
— short-circuit ONLY when there is neither a baseline NOR a scenario. `hasScenario` (already defined `:507`) was added to the projection memo's dependency array. The guard is kept on a single line to mirror `DrawdownChart.tsx:147` exactly. The Overview EquityChartWidget never supplies a scenario (`hasScenario=false`), so its behavior is **unchanged** — verified by two non-regression assertions (empty + no scenario still warms up; populated baseline still renders the chart).

**The load-bearing PARITY-03 proof (NEW path — `ScenarioFactsheetChart`).** After Plan 03 the composer renders through the factsheet engine, where Plan 01's adapter (`buildScenarioFactsheetPayload`) emits a non-empty `strategyEquity` from the scenario ALONE even with an empty baseline (`degenerate` is keyed on `scenario.length`, not the baseline). Three new cases in `EquityChart.scenario.test.tsx` render `<ScenarioFactsheetChart equityDailyPoints={[]} scenarioSeries={…}/>` and assert:
- the `equity-chart-scenario-overlay` panel renders a REAL strategy line — at least one `<path>` with a non-empty `d` (a degenerate-empty payload would draw nothing → RED);
- with no benchmark, EXACTLY ONE drawn series — no synthetic/fabricated live-book baseline line (honesty, **T-38-05-01**);
- the "Equity data warming up" copy is ABSENT.

A fourth case proves the legacy guard observably: legacy `EquityChart` with empty baseline + scenario no longer shows "Equity data warming up".

## Mutation check (Rule 9 — falsifiability)

Temporarily removed `&& !hasScenario` from the legacy guard. Result: the legacy-path blank-slate assertion turned RED — `queryByText(/Equity data warming up/i)` matched the re-introduced placeholder `<div>` instead of `null`. Reverted; the suite is green again (20 passed). The new-path proof's falsifiability anchor is `buildScenarioFactsheetPayload`'s non-degenerate-when-scenario-present rule (`scenario-factsheet-payload.ts:199-204`): collapsing it (or gating it on the empty baseline) empties `strategyEquity`, so the strategy line's `d` goes empty and the non-empty-`d` assertion turns RED.

## Coverage-offset decision

No coverage was deleted. The plan flagged that the deleted-projection-memo coverage from the engine swap is offset by Plan 01's adapter test — that offset is honored upstream (Plan 03 already swapped the composer call site to `ScenarioFactsheetChart`, and Plan 01 covers the adapter). This plan ADDED net coverage: 3 new-path blank-slate proofs + 3 legacy-guard cases (one falsifiable mutation target + two non-regression). The 14 pre-existing legacy scenario+toggle tests remain intact and green — the legacy `EquityChart` still ships as the Overview EquityChartWidget, so its coverage is load-bearing and was preserved (a surgical-changes constraint), not retargeted away.

## Verification

- `npx vitest run ".../EquityChart.scenario.test.tsx"` → **20 passed** (14 pre-existing + 6 new; incl. the blank-slate case: overlay renders a real line, exactly one series, PROJECTED-honest no-baseline, "warming up" absent).
- `npx vitest run ".../widgets/performance/"` → **130 passed** (DrawdownChart `:147` blank-slate guard regression intact; `scenario-shared-window.test.tsx` green; no coverage deleted).
- `npx vitest run "src/app/factsheet/" ".../ScenarioComposer.test.tsx" ".../EquityChartWidget.header.test.tsx"` → **130 passed** (factsheet engine untouched; composer + the 328-line Overview header test green — Overview behavior unchanged).
- `grep -n "&& !hasScenario" .../EquityChart.tsx` → matches the projection guard line (`:686`), mirroring `DrawdownChart.tsx:147`.
- `grep -c "warming up" .../EquityChart.scenario.test.tsx` → **10** (the blank-slate cases assert the warm-up copy is ABSENT).
- `npx tsc --noEmit` → **clean** (exit 0).
- `npx eslint` on the two touched files → **0 errors** (the single `react-hooks/exhaustive-deps` warning on `period` is PRE-EXISTING — present in the committed HEAD before this change, out of scope per the scope boundary; my change introduced zero new warnings).

## Deviations from Plan

None — plan executed as written. The legacy guard fix is the exact one-boolean mirror of `DrawdownChart.tsx:147`; the blank-slate proof lives on the new path as RESEARCH directed.

### Scope note (no code impact)

The plan's "retarget the existing overlay-presence assertions to the new path" was satisfied by ADDING the new-path proof (the load-bearing PARITY-03 surface) and a legacy-guard regression, while PRESERVING the 14 existing legacy scenario+toggle tests — because the legacy `EquityChart` still ships as the Overview EquityChartWidget and its overlay/toggle coverage is live. Deleting that coverage would have violated the surgical-changes + no-coverage-deletion constraints. The new path's overlay-presence is now covered (3 cases) AND the legacy path's overlay+toggle coverage is intact.

## Threat surface

No new security-relevant surface. Per the plan's threat register: **T-38-05-01** (data honesty — no synthetic baseline in blank mode) is asserted directly (exactly one drawn series, no fabricated live-book line); the PROJECTED honesty pill is composer-owned chrome rendered AROUND `ScenarioFactsheetChart` (Plan 03, `ScenarioComposer.tsx:1877`, unconditional). **T-38-05-02** (scenario is the allocator's own client-side hypothetical, no AUM/PII; KpiStrip not mounted) — accepted. **T-38-05-SC** — zero package installs this plan (boolean guard edit + test only).

## Known Stubs

None. The guard fix wires the real `hasScenario` boolean; the test exercises the real `ScenarioFactsheetChart` + `buildScenarioFactsheetPayload` data flow (no mock/placeholder data path introduced).

## Self-Check: PASSED

- FOUND: `src/app/(dashboard)/allocations/widgets/performance/EquityChart.tsx`
- FOUND: `src/app/(dashboard)/allocations/widgets/performance/EquityChart.scenario.test.tsx`
- FOUND commit: `ea1730c6`
- No accidental file deletions in the commit.

---
*Phase: 38-composer-factsheet-parity-blank-mode-fix*
*Completed: 2026-06-25*
