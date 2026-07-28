---
phase: 22-methodology-honesty-scaffolding
plan: 01
subsystem: scenario-projection-honesty
tags: [honesty, methodology-line, scenario-composer, scenario-builder, copy-upgrade]
requires:
  - "Phase-21 coverage caveat (data-testid=scenario-coverage-caveat) shipped on both projection surfaces"
  - "Frozen scenario engine ComputedMetrics.n"
provides:
  - "Canonical HONEST-01 methodology line on the own-book ScenarioComposer projection caveat"
  - "Identical HONEST-01 methodology line on the /scenarios Sandbox ScenarioBuilder projection caveat"
affects:
  - "src/app/(dashboard)/allocations/components/ScenarioComposer.tsx"
  - "src/components/scenarios/ScenarioBuilder.tsx"
tech-stack:
  added: []
  patterns:
    - "In-place caveat copy upgrade — edit contents of the existing <p>, preserve testid + token (no DOM/token change)"
    - "Method+N+horizon folded into one line, not stacked (middot · separators)"
    - "Anchored regex updated in the SAME task as the copy change it depends on"
key-files:
  created: []
  modified:
    - "src/app/(dashboard)/allocations/components/ScenarioComposer.tsx"
    - "src/components/scenarios/ScenarioBuilder.tsx"
    - "src/app/(dashboard)/allocations/components/ScenarioComposer.test.tsx"
    - "src/components/scenarios/ScenarioBuilder.honesty.test.tsx"
decisions:
  - "Method label rendered VERBATIM as 'Historical realized' (the engine computes realized statistics over the overlap window); 'bootstrap' deliberately NOT claimed — that is Phase 27."
  - "Horizon rendered as lowercase 'not a forecast' inside the canonical middot form; the prior standalone 'Not a forecast.' sentence was folded into the one line rather than kept as a separate clause."
  - "N kept inline in DM Sans (scenarioMetrics.n / metrics.n) — NOT switched to .font-metric/Geist Mono, matching the shipped Phase-21 line and its tests."
  - "Sandbox test's anchored /^Projected from …/ regex was rewritten to /^Historical realized · \\d+ overlapping days · not a forecast/ in the same task as the copy change (PLANNER ALERT honored)."
metrics:
  duration: "~3 min"
  completed: "2026-06-21"
  tasks: 1
  files: 4
---

# Phase 22 Plan 01: Methodology Line (HONEST-01) Summary

Folded the Phase-21 coverage caveat into the canonical HONEST-01 methodology line
— "Historical realized · {N} overlapping days · not a forecast" — in place on both
projection surfaces (own-book `ScenarioComposer` and the `/scenarios` Sandbox
`ScenarioBuilder`), naming the actual method and the live engine N without adding
any new DOM, token, color, or second paragraph.

## What Was Built

A surgical, copy-only in-place upgrade of the single existing
`data-testid="scenario-coverage-caveat"` paragraph on each of the two projection
surfaces:

- **Before** (Phase 21): `Projected from {N} overlapping days.{ Shortest history: {name}.} Not a forecast.`
- **After** (HONEST-01): `Historical realized · {N} overlapping days · not a forecast.{ Shortest history: {name}.}`

Both surfaces now read identically. The method label "Historical realized" leads
the line, the live engine N is middot-separated, and "not a forecast" states the
honest horizon — all folded into the one caveat slot, not stacked into a second
line.

### Per surface

| Surface | File | N source | Conditional clause key |
|---------|------|----------|------------------------|
| Own-book composer | `ScenarioComposer.tsx` (~1059-1067) | `scenarioMetrics.n` (live, read-only) | `coverageShortestName !== null` |
| /scenarios Sandbox | `ScenarioBuilder.tsx` (~296-302) | `metrics.n` (live, read-only) | `shortestName` |

The conditional "Shortest history: {name}." clause was retained verbatim on both
surfaces — it appears within the same single line only when the de-aliased set is
non-empty, and is omitted otherwise (never names a phantom strategy).

## Preserved Invariants (must_haves)

- [x] Own-book composer caveat reads "Historical realized · {N} overlapping days · not a forecast"
- [x] /scenarios Sandbox caveat reads the identical methodology line
- [x] Conditional "Shortest history: {name}." clause retained on both (kept when non-empty, omitted otherwise)
- [x] Both keep `data-testid="scenario-coverage-caveat"` and the `mt-2 text-[11px] text-text-muted` token (Phase-21 tests stay green)
- [x] N read live from the frozen engine (`scenarioMetrics.n` / `metrics.n`), never hardcoded
- [x] Engine files (`src/lib/scenario.ts` / `scenario-dealias.ts`) untouched (zero diff)
- [x] No second `<p>`, no new token/color/DOM, N inline in DM Sans (not Geist Mono)

## TDD Cycle

This task was executed RED → GREEN within a single commit:

- **RED:** Updated both test files first — composer test (`.toContain`, order-agnostic) to assert
  "Historical realized" / "not a forecast" / the middot form; sandbox test's anchored regex from
  `/^Projected from \d+ overlapping days\./` to `/^Historical realized · \d+ overlapping days · not a forecast/`
  plus a "Historical realized" `.toContain`. Confirmed both fail against the current copy
  (2 failed / 59 passed), proving the assertions are load-bearing.
- **GREEN:** Folded the methodology line into both caveat `<p>` contents. Re-ran: 61/61 passed.

The PLANNER ALERT (the `^Projected` anchor would break when "Historical realized ·" moves to the
front) was honored — the regex was updated in the same task as the copy change, so no test went
red on land.

## Verification

Task `<verify>` spec, all green:

- `npx vitest run` on both touched component tests → **Test Files 2 passed (2); Tests 61 passed (61)**
- `Historical realized` present in exactly the 2 component files → **PASS**
- `data-testid="scenario-coverage-caveat"` present on both surfaces → **1 + 1**
- Engine frozen check (`git diff` on scenario.ts / scenario-dealias.ts) → **empty (no diff)**
- `eslint` on both components → **clean**

Coverage gate: this is a copy-only edit with no net source-line additions of new branches
(only string content changed; the conditional was retained), so no coverage regression is
introduced. (Full-suite `npm run test:coverage` is the per-wave merge gate, run by the orchestrator.)

## Deviations from Plan

None — plan executed exactly as written.

The trailing standalone "Not a forecast." sentence from the Phase-21 copy was folded into the
canonical middot line as the lowercase "not a forecast" horizon (per the UI-SPEC Copywriting
Contract), so the composer test's prior `toContain("Not a forecast.")` assertion was replaced
with the canonical-form assertions rather than kept verbatim. This is the intended fold per the
plan's `<interfaces>` target form and the must_have copy, not a deviation from scope.

## Known Stubs

None.

## Threat Flags

None. No new network endpoint, auth path, file access, or schema surface introduced — this is a
copy-only edit to two existing authed client components. T-22-01 (honesty/false-precision) is
mitigated as designed: the line names the ACTUAL method ("Historical realized", not "bootstrap")
and the honest horizon ("not a forecast"), with N read live from the frozen engine.

## Self-Check: PASSED

- All 4 modified files + the SUMMARY.md verified present on disk.
- Task commit `81041c84` verified present in git log.
