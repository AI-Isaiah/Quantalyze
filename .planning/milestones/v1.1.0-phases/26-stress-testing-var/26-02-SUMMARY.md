---
phase: 26-stress-testing-var
plan: 02
subsystem: allocations-ui
tags: [react, tsx, vitest, var, cvar, expected-shortfall, beta-shock, stress-test, scenario, honesty-contract, em-dash, sample-floor, "509"]

# Dependency graph
requires:
  - phase: 26-stress-testing-var (plan 01)
    provides: "computeScenarioStress(portfolioDaily, btcDaily, opts) → { varN, betaN, beta, projectedImpact, var, cvar } — the section's only math source"
  - phase: 24-scenario-benchmark
    provides: "ScenarioBenchmarkSection (the verbatim presentational template + #509 guard order) and the composer mount seam"
  - phase: 22-sample-floor
    provides: "evaluateSampleFloor + SAMPLE_FLOOR_OVERLAPPING_DAYS (the floor SoT) + SampleFloorEmptyState"
provides:
  - "StressVarSection.tsx — props-only presentational Stress & VaR section over computeScenarioStress with the 4-state #509 guard order, SegmentedControl shock affordance, em-dash discipline, monochrome losses, imported floor SoT, and two-N disclosure captions"
  - "StressVarSection.test.tsx — the state-matrix + honesty pin suite (10 tests): ok-state full-disclosure, shock interaction, scenario-side vs BTC-unavailable attribution, below-floor, em-dash-not-0, monochrome-not-red losses, two-N captions, honest absence, floor-SoT gate-flip"
  - "The own-book ScenarioComposer now renders the Stress & VaR section as a sibling Card after ScenarioBenchmarkSection (STRESS-01 + STRESS-02 surfaced to the allocator)"
affects: [27-monte-carlo, 28-optimizer]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Props-only presentational section over a golden null-safe lib: the component owns NONE of the arithmetic, only the UI contract (em-dash wrap, guard-order routing, single-sourced disclosure)"
    - "Two-N disclosure rendering: render one caption when varN === betaN, two captions when they differ (each number names its own true N) — the consumer half of the 26-01 two-N interface"
    - "Monochrome-loss honesty: a loss renders as neutral Geist Mono data (text-text-secondary), never a destructive color — the explicit divergence from the VarExpectedShortfall.tsx anti-pattern"

key-files:
  created:
    - "src/app/(dashboard)/allocations/components/StressVarSection.tsx"
    - "src/app/(dashboard)/allocations/components/StressVarSection.test.tsx"
  modified:
    - "src/app/(dashboard)/allocations/components/ScenarioComposer.tsx"

key-decisions:
  - "Single VaR/CVaR caption appends ' 95% confidence.' to methodologyLine(varN); the β-shock caption is rendered ONLY as a distinct second caption when varN !== betaN — when equal, a single combined shock-assumptions caption naming betaN is rendered, so two methodologyLine prefixes never appear with the same N (avoids a redundant duplicate-N caption while still naming betaN)"
  - "The em-dash test exercises a null PROJECTED-IMPACT cell (constant-BTC → β null → impact null) rather than a null VaR — a null VaR would require a constant portfolio series, which the relative-scale guard nulls, but that path is already pinned in the 26-01 lib matrix; the section-level test targets the cell-render discipline on a real null reaching an ok-path render"
  - "Used the existing npm run test (full suite) as Task 3's verify; the coverage gate runs in CI via test:coverage, and the two new files are additive (component + its dedicated test), so they raise—not lower—the section's covered surface"

patterns-established:
  - "Consumer half of the two-N interface: a section that holds two statistics over two overlap windows renders per-N disclosure captions, never collapsing to one N when they differ"

requirements-completed: [STRESS-01, STRESS-02]

# Metrics
duration: ~14min
completed: 2026-06-22
---

# Phase 26 Plan 02: Stress-Testing / VaR Section Summary

**Props-only `StressVarSection` over the golden null-safe `computeScenarioStress` (26-01): a `SegmentedControl` BTC-shock affordance (−10/−20/−30%, −30% default) feeding a β-propagated projected impact + historical VaR(95%)/CVaR with a mandatory single-sourced disclosure, the fixed #509 4-state guard order, em-dash-on-null and monochrome (never red) losses, the imported sample-floor SoT (no literal 60), and two-N disclosure captions — mounted as a sibling Card after `ScenarioBenchmarkSection` in the own-book composer, with a 10-test state-matrix + honesty suite that fails loud on a red loss, a fabricated 0, a bare VaR, a misattributed empty state, or a hard-coded floor.**

## Performance
- **Duration:** ~14 min
- **Started:** 2026-06-22T14:05:00Z (approx)
- **Completed:** 2026-06-22T14:10:00Z
- **Tasks:** 3
- **Files modified:** 3 (2 created + 1 surgical mount edit)

## Accomplishments
- `StressVarSection` is a `"use client"` props-only presentational component (`portfolioDaily`, `btcDaily`, `btcAvailable`, `n`, `strategyCount`) whose ONLY local state is the shock-preset `useState`; all math is delegated to `computeScenarioStress(portfolioDaily, btcDaily, { shock: Number(shockId) })` via a `useMemo` keyed on the inputs + the active shock.
- Fixed #509 guard order (scenario-side absence → BTC unavailable → below the Phase-22 sample floor → ok), copied verbatim from `ScenarioBenchmarkSection`; each empty-state heading matches its body and names its TRUE cause.
- The shock affordance is the locked `SegmentedControl` (−10/−20/−30%, −30% default-active); the selection IS the interaction (no submit CTA) — the projection recomputes from the active segment.
- Every value flows through `formatPercent` → "—" on null; losses are MONOCHROME (`text-text-secondary`, Geist Mono), never red — the explicit divergence from `VarExpectedShortfall.tsx`.
- The sample floor is the imported `SAMPLE_FLOOR_OVERLAPPING_DAYS` SoT (no re-declared literal 60); below-floor renders `SampleFloorEmptyState feature="VaR"` with the call-site `strategyCount`.
- The VaR/CVaR disclosure is single-sourced via `methodologyLine(varN)` + " 95% confidence."; the β-shock disclosure names `betaN`; two captions render when `varN !== betaN`, each naming its own true N (the two-N trap).
- Mounted in the own-book `ScenarioComposer` as a sibling `<Card className="mt-6">` after the benchmark Card and before the Pairwise correlation Card, fed entirely from existing composer scope — no new state/fetch/memo. The Strategy Sandbox / `ScenarioBuilder` is untouched.
- A 10-test Vitest suite pins the full state matrix + every honesty invariant; the full project suite (527 files / 6439 tests) is green and `tsc --noEmit` is clean.

## Task Commits

Each task was committed atomically:

1. **Task 1: Build the props-only StressVarSection (4-state guard order + em-dash + monochrome)** — `57d1f7fa` (feat)
2. **Task 2: Pin the StressVarSection state-matrix + honesty test suite** — `4a7bdd0a` (test)
3. **Task 3: Mount StressVarSection in the own-book ScenarioComposer** — `740cfa37` (feat)

_Note: Task 1 carried `tdd="true"`, but the plan splits the component (Task 1) and its dedicated test suite (Task 2) into separate tasks (the same split 26-01 used), so each task is a single commit rather than a RED/GREEN pair within one task._

## Files Created/Modified
- `src/app/(dashboard)/allocations/components/StressVarSection.tsx` (231 lines) — the props-only presentational section. `MetricRow` (monochrome `text-text-secondary` Geist Mono tokens copied verbatim from the sibling), the 4-state #509 guard-order routing, the `SegmentedControl` shock affordance, the `useMemo` over `computeScenarioStress`, and the two-N disclosure caption logic.
- `src/app/(dashboard)/allocations/components/StressVarSection.test.tsx` (374 lines) — `buildDates`/`series` helpers copied verbatim from the benchmark test; 10 tests covering ok-state full-disclosure, shock interaction, scenario-side/BTC-unavailable attribution, below-floor, em-dash-not-0, monochrome-not-red, two-N captions, honest absence, and the floor-SoT gate-flip.
- `src/app/(dashboard)/allocations/components/ScenarioComposer.tsx` (+20 lines) — the surgical mount edit: the import adjacent to `ScenarioBenchmarkSection` + the sibling `<Card>` block with the documenting comment. No new state/fetch/memo.

## Decisions Made
- **Two-N caption rendering:** when `varN === betaN` (BTC covers the full scenario window — the common case) a single VaR/CVaR caption (`methodologyLine(varN)` + " 95% confidence.") plus one shock-assumptions caption naming `betaN` inline render; when they differ, the β-shock caption becomes its own `methodologyLine(betaN)` line so each `methodologyLine` prefix names a distinct N. This satisfies the "two captions when they differ, each naming its true N" contract without printing a redundant duplicate-N line in the common equal-N case.
- **Em-dash test targets the projected-impact cell:** a constant-BTC series nulls β (and therefore `projectedImpact`) while the portfolio VaR stays finite, so the ok path renders and the impact cell is a real null reaching the formatter — the cleanest section-level proof of em-dash-not-0 on an ok-path render. A null VaR (constant-portfolio) is already pinned in the 26-01 lib matrix.
- **`formatPercent` for every metric:** all three rows (impact, VaR, CVaR) are signed returns, so `formatPercent` (signed by default) carries the sign and renders "—" on null — the single render discipline.

## Deviations from Plan
None — plan executed exactly as written. The three artifacts were built to the `<action>` specs, every `<acceptance_criteria>` grep passed, the full test suite and `tsc` are green, and the surgical mount touched nothing beyond the import + the sibling Card. No auto-fixes (Rules 1–3) were needed; no architectural decision (Rule 4) arose; no authentication gate occurred. No package was installed (the phase locks "no new dependency"; the threat register's T-26-SC accept-disposition held).

## Issues Encountered
None. The component type-checked and passed its grep acceptance criteria on first write; the test suite passed all 10 tests on first run.

## Threat Surface Scan
No new security-relevant surface. This plan adds NO server endpoint, NO migration, NO Python, NO auth, NO route, NO dependency, NO persistence (per the plan `<threat_model>` and the 26-01 precedent). The threat class is honesty/correctness only, and each mitigate-disposition register entry has a passing falsifiable test:
- T-26-07 (fabricated number) → "em-dash discipline": the null impact cell renders "—", explicitly asserted NOT "0.00".
- T-26-08 (loss painted as error) → "monochrome losses": the var/cvar cells carry no `text-negative`/`#DC2626`/`text-red`/`text-destructive`; source grep returns 0 red classes.
- T-26-09 (false precision) → "below-floor" + "uses floor SoT": the gate flips at the imported `SAMPLE_FLOOR_OVERLAPPING_DAYS` (no re-declared literal 60).
- T-26-10 (bare VaR) → "ok state … FULL VaR disclosure line": the complete `methodologyLine(N) … 95% … not a forecast` string is asserted whenever a VaR renders.
- T-26-11 (wrong attribution / wrong N) → the fixed guard order + the scenario-side/BTC-unavailable attribution tests (each asserts the other copy ABSENT) + the two-N caption test.
- T-26-12 (sandbox leak) → Task 3 mounts in the own-book composer ONLY; the diff is verified to NOT include `ScenarioBuilder.tsx`.
- T-26-13 / T-26-SC (input validation / supply chain) → accept-disposition held: the shock is a closed 3-preset domain (no free-text), and zero packages were installed.

No `threat_flag` surface introduced — no new network endpoint, auth path, file-access pattern, or schema change.

## Known Stubs
None. Both new files are complete: no placeholder values, no TODO/FIXME, no unwired data source. The section is fed live by the composer from `scenarioMetrics.portfolio_daily_returns`, the `btcDaily`/`btcAvailable` state, `scenarioMetrics.n`, and `deAliased.strategies.length` — all real, in-scope data wired at the mount.

## Next Phase Readiness
- STRESS-01 + STRESS-02 are surfaced to the allocator: the own-book Scenario composer now renders the Stress & VaR section after the benchmark section.
- Phase 27 (Monte-Carlo) can mirror this section's props-only + floor-SoT + em-dash + disclosure template, consuming its own lib the same way this section consumes `computeScenarioStress`.
- No blockers. No new dependency, no migration, no Python — consistent with the phase lock.

## Self-Check: PASSED

- `src/app/(dashboard)/allocations/components/StressVarSection.tsx` — FOUND
- `src/app/(dashboard)/allocations/components/StressVarSection.test.tsx` — FOUND
- `src/app/(dashboard)/allocations/components/ScenarioComposer.tsx` — FOUND (mount edit present: `<StressVarSection` at :1593)
- Commit `57d1f7fa` (Task 1, feat) — FOUND
- Commit `4a7bdd0a` (Task 2, test) — FOUND
- Commit `740cfa37` (Task 3, feat) — FOUND
- Tests: 10/10 in the section suite; full project suite 527 files / 6439 tests green; `tsc --noEmit` clean for StressVarSection.* + ScenarioComposer.
