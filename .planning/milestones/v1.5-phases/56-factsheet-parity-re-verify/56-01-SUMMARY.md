---
phase: 56-factsheet-parity-re-verify
plan: 01
subsystem: testing
tags: [vitest, parity, coverage-window, scenario, factsheet, source-guard, readFileSync]

# Dependency graph
requires:
  - phase: 55-coverage-window-compute-core
    provides: "computeScenario present-window path emitting member-windowed portfolio_daily_returns + member_count/member_ids; scenario-window.ts (coverageSpanOf/defaultWindowFor/covers)"
  - phase: 39 (v1.2.2 factsheet parity)
    provides: "buildScenarioFactsheetPayload parity-by-construction (compute() on the engine series) + the union-path Phase 39 parity spec extended here"
provides:
  - "Structural single-source-of-truth guard (scenario-factsheet-parity-guard.test.ts): readFileSync source-guard pinning that the payload builder consumes the engine's portfolioDaily and re-derives no blend/divisor/window math — proven falsifiable via a mutation check"
  - "Runtime coverage-window parity case: factsheet body === compute()/cumEq()/drawdowns() on the engine's emitted WINDOWED series, with the windowed series strictly shorter than the union, an ended strategy excluded from the divisor, and a zero-member window collapsing to safe-empty"
  - "PARITY-01 recorded green — the anchor Phase 60's golden re-bake depends on"
affects: [60-golden-e2e-rebake, 57-window-control-state-machine, 59-saved-shared-compared-windows]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "readFileSync source-level structural guard (mirrors scenario-window.test.ts / tap-target-minimums.test.ts): comment-stripped code lines + not.toContain of banned primitives, resolved via fileURLToPath(import.meta.url)"
    - "Series-identity parity contract: assert factsheet body === compute() on the engine-emitted series (NOT raw ComputedMetrics field equality — different sample/252 vs population/365.25 conventions)"

key-files:
  created:
    - "src/app/(dashboard)/allocations/widgets/performance/scenario-factsheet-parity-guard.test.ts"
  modified:
    - "src/app/(dashboard)/allocations/widgets/performance/scenario-factsheet-payload.test.ts"

key-decisions:
  - "Parity is SERIES-IDENTITY, not field equality: do NOT assert payload metrics equal computeScenario's ComputedMetrics (sample vs population stdev; 252 vs 365.25 CAGR). Assert payload body === compute() on the engine's emitted series (honored the plan's parity_contract_clarification)."
  - "The default intersection window INCLUDES the ended strategy C (all three cover [start, C.last]) → member_count 3; a window widened PAST C's end excludes C → member_count 2. Test C exercises both so the divisor-honesty claim is grounded, not assumed."
  - "Removed backticks from comment prose in the guard file: the repo's oxc/vite transform mis-parses backtick sequences inside // comments (PARSE_ERROR). Backticks retained only inside real string-literal assertions."

patterns-established:
  - "Comment-strip before not.toContain: header/JSDoc prose that legitimately mentions blend primitives cannot self-invalidate the guard; only genuine code references fire it."
  - "Mutation-falsifiability recorded as evidence: temporarily inject the banned import, confirm RED, revert to a byte-identical builder (git diff --stat clean)."

requirements-completed: [PARITY-01]

# Metrics
duration: 13min
completed: 2026-07-01
---

# Phase 56 Plan 01: Factsheet Parity Re-Verify Summary

**Two-layer PARITY-01 guard proving the factsheet stays parity-by-construction on the v1.5 coverage-window path: a readFileSync source-guard pins that `buildScenarioFactsheetPayload` re-derives no blend, and a runtime case proves the factsheet body equals `compute()`/`cumEq()`/`drawdowns()` on the engine's identical member-windowed series (30-day window vs 90-day union), with an ended strategy dropped from the divisor and a zero-member window collapsing to safe-empty.**

## Performance

- **Duration:** ~13 min
- **Started:** 2026-07-01T15:14:48Z
- **Completed:** 2026-07-01T15:27:14Z
- **Tasks:** 2
- **Files modified:** 2 (1 created, 1 extended) — test-only, ZERO production-code change

## Accomplishments

- **Structural single-source-of-truth guard** (Task 1): a new `scenario-factsheet-parity-guard.test.ts` reads the builder source and asserts three structural facts — (a) it derives the body via `compute(rets, datesR)`; (b) it references NONE of `coverageSpanOf`/`covers(`/`member_count`/`member_ids`/`activeWeightSum`/`normWeight`/`computeScenario` on comment-stripped code lines and imports nothing from `@/lib/scenario(-window)`; (c) the mount sources `portfolioDaily` from `scenarioMetrics.portfolio_daily_returns` (regex-pinned). 11 cases green.
- **Proven falsifiable:** injecting `import { covers } from "@/lib/scenario-window"` into the builder turned the guard RED (both the `covers(` banned-token case AND the import case), and the revert restored a byte-identical builder (`git diff --stat` clean).
- **Runtime coverage-window parity** (Task 2): extended the Phase 39 spec with a `describe(… coverage-window parity (Phase 56, PARITY-01))` block that runs the REAL `computeScenario` with an explicit `defaultWindowFor` intersection window, feeds its emitted `portfolio_daily_returns` to the payload builder, and asserts:
  - **Test A** — series identity (`payload.dates`/`strategyReturns` === the engine's windowed series) + non-vacuity (windowed 30 STRICTLY SHORTER than union 90 — a stale-union render fails).
  - **Test B** — metrics field-by-field at 1e-6 vs `compute(rets,dates)` on the engine-emitted series + `strategyEquity`/`strategyDrawdowns` at 1e-12.
  - **Test C** — divisor honesty (`member_count` 2 excludes the ended strategy when the window extends past its end; 3 when the intersection includes it) + a zero-member window collapses to safe-empty (`dates: []`, `strategyEquity: []`) without throwing.
- **All gates green:** payload spec 23/23, guard spec 11/11 (34 total); `tsc --noEmit` exit 0; `npm run test:coverage` exit 0 (Statements 83.25 / Branches 75.99 / Functions 79.6 / Lines 85.35 — all above the ratchet).

## Task Commits

Each task was committed atomically (test-only, on `v1.5-coverage-window-blend`):

1. **Task 1: Structural single-source-of-truth guard** — `5674fda7` (test)
2. **Task 2: Runtime coverage-window parity case** — `62ea4552` (test)

_Note: Task 2 is marked `tdd="true"` in the plan, but it extends tests over already-shipped Phase 55 engine behavior with ZERO production-code change — the "implementation" is the existing `computeScenario` window path. The test was written and passed against the existing (already-correct-by-construction) engine, so it is a single test commit, not a RED→GREEN pair._

## Files Created/Modified

- `src/app/(dashboard)/allocations/widgets/performance/scenario-factsheet-parity-guard.test.ts` (created, 153 lines) — the structural single-source-of-truth guard.
- `src/app/(dashboard)/allocations/widgets/performance/scenario-factsheet-payload.test.ts` (modified, +213 lines) — added the coverage-window parity `describe` block + the `@/lib/scenario` / `@/lib/scenario-window` imports; every pre-existing Phase 39 / convention-pin spec left byte-untouched.

## Decisions Made

- **Series-identity, not field equality.** Honored the plan's `parity_contract_clarification`: `computeScenario.ComputedMetrics.volatility/sharpe/cagr` do NOT equal the factsheet `strategyMetrics.ann_vol/sharpe/cagr` (sample vs population stdev; 252-trading-day vs 365.25-calendar-day CAGR). The locked invariant is single-source-of-truth of the SERIES — same series → same `compute()` → parity by construction. Test B asserts the body vs `compute()` on the engine-emitted series, exactly the Phase 39 union shape on the windowed path.
- **Fixture design for the two divisor cases.** The default intersection window `[2024-01-01, 2024-01-30]` (C's early end is the earliest last) is COVERED by all three strategies → `member_count` 3, but the axis is truncated to C's 30-day span (strictly shorter than the 90-day union). A second window `[2024-01-01, 2024-03-30]` extends past C's end → A/B cover, C does not → `member_count` 2, grounding the "ended strategy excluded from the divisor" claim on a real run.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Removed backticks from comment prose in the guard file**
- **Found during:** Task 1 (first run of the new guard spec)
- **Issue:** The repo's oxc/vite transform (`vite:oxc`) raised `PARSE_ERROR: Expected a semicolon…` on a `//` comment line containing backtick sequences (e.g. `` `compute()` ``). This is an oxc quirk with backticks inside line comments; the file could not be parsed/collected at all.
- **Fix:** Rewrote all comment prose to use plain text (no backticks); backticks retained ONLY inside genuine string-literal assertions (`toContain("compute(rets, datesR)")`). No change to any assertion semantics.
- **Files modified:** `scenario-factsheet-parity-guard.test.ts` (the new file, pre-commit)
- **Verification:** Guard spec re-ran green (11/11); mutation check confirmed falsifiability.
- **Committed in:** `5674fda7` (Task 1 commit)

---

**Total deviations:** 1 auto-fixed (1 blocking, test-authoring — a toolchain parse constraint, not a code defect).
**Impact on plan:** None on scope or intent. Zero production-code change; every planned assertion preserved. No scope creep.

## Issues Encountered

- The `grep -c 'Math.random'` acceptance check returns 3 — but those are all matches in the pre-existing "NO Math.random" comment prose; `grep 'Math\.random('` (actual calls) returns NONE. All fixtures are deterministic UTC ISO. (Confirmed, not a defect.)

## Known Stubs

None. This is a test-only phase; no UI/data stubs introduced. The zero-member safe-empty path is an intentional honest empty-state (no-invented-data), asserted in Test C — not a stub.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- **PARITY-01 is recorded green** — the anchor Phase 60's golden re-bake depends on (STATE: "the anchors that MUST be recorded green before the bake"). Both the BLEND-07 numpy gate (Phase 55) and PARITY-01 (this phase) are now green.
- Phase 57 (Window Control & Auto-Toggle State Machine) can proceed: this phase asserts parity holds WHEN a window is passed, without wiring the UI that passes it.
- No blockers. Zero engine/UI/payload-builder behavior change — LOCKED invariants (no-invented-data, 252-annualization, cumulative-RETURN-vs-wealth, WCAG-AA) unregressed.

## Self-Check: PASSED

- FOUND: `scenario-factsheet-parity-guard.test.ts` (created)
- FOUND: `scenario-factsheet-payload.test.ts` (modified)
- FOUND: `56-01-SUMMARY.md`
- FOUND: commit `5674fda7` (Task 1)
- FOUND: commit `62ea4552` (Task 2)

---
*Phase: 56-factsheet-parity-re-verify*
*Completed: 2026-07-01*
