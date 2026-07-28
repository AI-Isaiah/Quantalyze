---
phase: 55-coverage-window-compute-core
plan: 02
subsystem: scenario-compute-engine
tags: [blend, coverage-window, frozen-spine, computeScenario, ADR-001]
requires:
  - "55-01: scenario-window.ts helpers (coverageSpanOf, covers, defaultWindowFor)"
provides:
  - "computeScenario coverage-window blend path (present-window) with a constant member-count divisor"
  - "preserved UNION path when state.window is absent (own-book callers untouched)"
  - "additive ComputedMetrics.member_count / member_ids"
  - "ScenarioState.window? optional field"
  - "5 frozen-spine guards re-baselined (annotated, reviewed) for the one v1.5 engine edit"
affects:
  - "src/lib/scenario.ts (the frozen engine — deliberately edited ONCE in v1.5)"
  - "the 12 scenario-tab consumers (read the same output series; no math change; re-verified green)"
  - "phase-{29,30,31,32,52} frozen-spine guards"
tech-stack:
  added: []
  patterns:
    - "additive-optional field with byte-compat doc-comment (leverage? / portfolio_daily_returns? precedent)"
    - "top-of-function degenerate guard (zero-member empty-state before the day loop)"
    - "renormalize a DERIVED copy over the member set (never mutate state.weights)"
    - "git-DELTA frozen-spine guard re-baseline via INVERTED assertion (not blind --update-snapshots)"
key-files:
  created:
    - ".planning/phases/55-coverage-window-compute-core/55-02-SUMMARY.md"
  modified:
    - "src/lib/scenario.ts"
    - "src/lib/scenario.test.ts"
    - "src/__tests__/phase-29-frozen-spine-guards.test.ts"
    - "src/__tests__/phase-30-frozen-spine-guards.test.ts"
    - "src/__tests__/phase-31-frozen-spine-guards.test.ts"
    - "src/__tests__/phase-32-frozen-spine-guards.test.ts"
    - "src/__tests__/phase-52-frozen-spine-guards.test.ts"
decisions:
  - "member_count / member_ids declared OPTIONAL (like portfolio_daily_returns?), NOT required — because the two external construction sites (liveBaselineToComputedMetrics, NULL_METRICS) are full object literals that do NOT spread, so required fields would break their compile. Engine always sets them; consumers read with ?? 0 / ?? []."
  - "Downstream loops (strategyReturns, blend, correlation) iterate `members` (== activeStrategies on the absent path) so the union path is byte-identical and the present path blends only members."
  - "Guard re-baseline = INVERT the frozen-scenario.ts/.test.ts assertion (.not.toContain → .toContain) — the guard stays LIVE and now PINS the reviewed edit; RESEARCH A3 option (b). phase-52 = remove scenario.ts from FROZEN_ISLANDS."
requirements: [BLEND-01, BLEND-02, BLEND-03, BLEND-04, BLEND-05, BLEND-06, PARITY-03]
metrics:
  duration_minutes: 26
  completed: 2026-07-01
  tasks: 2
  files_modified: 7
  commits: 2
---

# Phase 55 Plan 02: Coverage-Window Compute Core Summary

`computeScenario` now blends over an explicit `ScenarioState.window` with a
constant member-count divisor (an ended strategy no longer dilutes the mean),
while preserving the legacy UNION path byte-identically when `window` is absent
— and the five git-delta frozen-spine guards are re-baselined as an annotated
reviewed act for this one deliberate v1.5 engine edit.

## What was built

### Task 1 — engine coverage-window path (`08617471`)

- **`ScenarioState.window?: { start; end }`** — new OPTIONAL field, additive
  doc-comment mirroring `leverage?`. Positional signature
  `computeScenario(strategies, state, dateMapCache)` UNCHANGED. Byte-compat
  claim is explicitly CONDITIONAL: absent → union path, present → coverage path.
- **Membership + constant divisor (present-window):** member iff
  `coverageSpanOf(s.daily_returns) ⊇ window` via `covers()` (imported from
  `scenario-window.ts`, 55-01). An ended-tail strategy (`last < winEnd`) or a
  ragged-head one (`first > winStart`) is EXCLUDED — no longer divides toward
  zero. Divisor is the constant member count across the window.
- **Zero-member empty-state (BLEND-05):** a `members.length === 0` guard returns
  the honest empty-state shape (null metrics, `equity_curve: []`,
  `portfolio_daily_returns: []`, `member_count: 0`) BEFORE the day loop — never
  reaching the `activeWeightSum > 0 ? r/… : 0` fabrication (Pitfall 4). No ÷0,
  no fabricated flat-zero curve.
- **Interior-gap 0-fill (BLEND-03):** the axis is the union of members' dates in
  the CLOSED `[winStart, winEnd]`; a member missing an interior day 0-fills in
  the numerator only. Axis never extends outside the window, so 0-fill can never
  leak past it (no tail dilution).
- **Weighted renorm over members (BLEND-04):** `totalWeight` sums over `members`
  (not `activeStrategies`); dropped strategies leave the denominator, so
  survivors renormalize to sum-to-1. `state.weights` is NEVER mutated (pinned by
  a `frozenWeights` equality assertion in the test).
- **Additive output (BLEND-06):** `member_count` + `member_ids` added to
  `ComputedMetrics` as OPTIONAL fields; `effective_start`/`effective_end` carry
  the window bounds and `n` carries N on the present path. Both external
  construction sites compile unchanged.
- **Coverage sourced from returns only:** the `"2022-01-01"` sentinel and
  `start_date` are confined to the absent-window `else` branch of `strategyStart`
  — grep-confirmed absent from the coverage branch.
- **Preserved union path:** downstream loops iterate `members` (== the active set
  on the absent path), so the union axis + 0-fill-tail + renormalize is
  byte-identical. The union pin (`scenario.test.ts` "never shrinks to the
  overlap", `n===60`) stays green; the single-strategy `scenario-sample-ratios`
  parity pin stays green.
- **9 additive test cases** in `scenario.test.ts` covering every `<behavior>`
  bullet (window axis/bounds, ended-tail no-dilution, divisor==2, interior gap,
  weighted renorm-after-drop, narrow-back typed-weight restore, empty-state,
  single-member, absent-path member_count), named so the `-t` filters
  (`window`, `interior gap`, `renorm`, `empty`, `member_count`) resolve.

### Task 2 — frozen-spine guard re-baseline (`440a223b`)

The `phase-{29,30,31,32,52}` guards are git-DELTA guards: each asserts
`scenario.ts` (and for 30/31 `scenario.test.ts`) is NOT in the changed-file set
vs a per-phase baseline SHA, so they fire the moment the engine is touched (by
design). Re-baselined by hand (RESEARCH A3 option b) — every edit annotated
`// v1.5 coverage-window re-baseline (ADR-001)`, NO `--update-snapshots`, no
snapshot-file churn. Each guard stays LIVE.

## Frozen-spine guard re-baseline enumeration (Q4)

| Guard file | Assertion re-baselined | OLD → NEW | Untouched (verified) |
|------------|------------------------|-----------|----------------------|
| `phase-29-frozen-spine-guards.test.ts` | frozen `scenario.ts` exit gate (new L179–188) | `expect(CHANGED, "…VIOLATED…").not.toContain(FROZEN_ENGINE)` → `expect(CHANGED, "…re-baseline…").toContain(FROZEN_ENGINE)` (INVERTED — now pins the reviewed edit) | no-schema-change migration gate; the 2 RLS-sql assertions |
| `phase-30-frozen-spine-guards.test.ts` | frozen `scenario.ts` (new L154–162) AND frozen `scenario.test.ts` (new L164–173) | both `.not.toContain(FROZEN_ENGINE / FROZEN_ENGINE_TEST)` → `.toContain(…)` (both INVERTED) | baseline-ref resolution assertion |
| `phase-31-frozen-spine-guards.test.ts` | frozen `scenario.ts` (new L179–187) AND frozen `scenario.test.ts` (new L189–197) | both `.not.toContain(…)` → `.toContain(…)` (both INVERTED) | **LAYOUT-02 hide-don't-unmount CompositionList wrap + no-conditional-mount assertions UNCHANGED** (33 `CompositionList` refs intact) |
| `phase-32-frozen-spine-guards.test.ts` | frozen `scenario.ts` (new L241–249) — the ONE frozen-engine assertion | `.not.toContain(FROZEN_ENGINE)` → `.toContain(FROZEN_ENGINE)` (INVERTED) | **all FLOW-01/02/03 route / redirect / delete / self-loop / dead-reader assertions UNCHANGED** (`source: "/scenarios"`, `/discovery/crypto-sma`, etc. intact) |
| `phase-52-frozen-spine-guards.test.ts` | `FROZEN_ISLANDS` array (L157–171) | `"src/lib/scenario.ts"` REMOVED from the array (annotated in-array L158–166 + header L14–19); the per-island loop drops that one assertion | **the other 10 islands STAY FROZEN** (compute.ts, factsheet-context, useBreakpoint, montecarlo.worker, EquityChart, TouchTooltip, useTapPin, TimeSeriesChart, HistogramChart, MasterBrush — 3 refs confirmed) |

**Mechanism note:** INVERTED assertions keep each guard live and fail-loud — if a
future non-v1.5 phase reverts or re-freezes the coverage-window edit, the
`.toContain` assertion goes red, forcing the reviewer to restore the edit or
update the re-baseline in lockstep. This is stronger than deleting the assertion.

## Deviations from Plan

### Auto-fixed / clarified within plan latitude

**1. [Rule 3 — Blocking, resolved within plan's stated fallback] `member_count`/`member_ids` declared OPTIONAL, not required.**
- **Found during:** Task 1, verifying the two external `ComputedMetrics` construction sites.
- **Issue:** The plan offered "either required-with-engine-always-sets like `n`, or optional-with-default like `portfolio_daily_returns?`." `NULL_METRICS` (`ScenarioComparePanel.tsx:92`) and `liveBaselineToComputedMetrics` (`ScenarioComposer.tsx:356`) are FULL object literals that do NOT spread — required fields would break their compile.
- **Fix:** Declared both fields OPTIONAL (mirroring the existing `portfolio_daily_returns?` precedent, which those same sites also omit). Engine ALWAYS sets them on every return path; consumers read with `?? 0` / `?? []`. Confirmed `npx tsc --noEmit` clean (both sites compile unchanged).
- **Files:** `src/lib/scenario.ts`. **Commit:** `08617471`.

**2. [Rule 12 — fail-loud doc honesty] phase-52 guard HEADER prose updated alongside the array edit.**
- **Found during:** Task 2.
- **Issue:** The phase-52 header comment described `scenario.ts` as a frozen island ("eleven file paths… `src/lib/scenario.ts` — the 252-day-annualization projection engine (SCENARIO-05 zero-diff)"). Leaving it would document scenario.ts as frozen while the array no longer freezes it — a silent doc/behavior drift.
- **Fix:** Updated the header bullet + the in-array comment with the `// v1.5 coverage-window re-baseline (ADR-001)` annotation, noting the 252-annualization math itself stays LOCKED (proven by scenario.test.ts pins + the 55-03 numpy gate). LAYOUT-02/FLOW/other-island prose untouched.
- **Files:** `src/__tests__/phase-52-frozen-spine-guards.test.ts`. **Commit:** `440a223b`.

No architectural changes, no auth gates, no new dependencies (zero-new-deps locked).

## Verification results

- `npx vitest run src/lib/scenario.test.ts src/lib/scenario-window.test.ts` — **62 passed** (46 scenario incl. 9 new coverage-window cases + the preserved union pin; 16 window).
- All 5 frozen-spine guard suites — **31 passed** (were 32; −1 = the removed phase-52 scenario.ts island assertion). Green with scenario.ts edited.
- `npx tsc --noEmit` — **clean** (external construction sites compile unchanged).
- Consumer sweep (adapter, benchmark, compare, montecarlo, stress, state, apply-weights) — **134 passed**; composer/state-preservation/ComparePanel component tests — **37 passed**. No regression.
- `npm run test:coverage` (full suite + blocking gate) — **exit 0**. Statements 83.24 (≥80), Branches 75.98 (≥72), Functions 79.58 (≥74), Lines 85.34 (≥82).
- Grep acceptance: `member_count`/`member_ids` present; `state.window` gate present; `"2022-01-01"` only on the union/startDates path; annotation in all 5 guards; no `.snap` churn.

## Known Stubs

None. No placeholder / TODO / hardcoded-empty patterns introduced.

## Notes for downstream phases

- **Phase 56 (factsheet parity assertion):** this phase did not break the
  `compute.ts`-on-`computeScenario`-series contract (compute.ts stays frozen);
  the single-source-of-truth assertion guard lands in 56.
- **Phase 57 (UI window control):** the scenario tab (`ScenarioComposer.tsx`)
  will thread `state.window` (derived via `defaultWindowFor()`) into the engine.
  This phase made the engine ACCEPT it; the composer JSX was NOT touched.
- **Phase 59 (persistence / share-resolve):** `share-resolve.ts` is untouched
  (window absent → union, byte-compat); it will import the shared
  `defaultWindowFor()` when PERSIST-02 lands.
- **BLEND-07 (55-03):** the from-scratch numpy verification gate is the next
  plan — it must be green BEFORE any Phase 60 golden re-bake.

## Self-Check: PASSED

- FOUND: `src/lib/scenario.ts` (modified), `src/lib/scenario.test.ts` (modified), all 5 guard files (modified).
- FOUND: commit `08617471` (Task 1), commit `440a223b` (Task 2) in `git log`.
