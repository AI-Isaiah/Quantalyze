---
phase: 147-scen-01-the-scenario-engine-receives-the-real-series
plan: 04
subsystem: api
tags: [typescript, queries, ssr-payload, series-resolution, vitest, tdd, scen-01]

# Dependency graph
requires:
  - "147-01 — resolveDailyReturnSeries (src/lib/factsheet/resolve-series.ts) + deriveEmptySeriesState/SeriesState (src/lib/closed-sets.ts)"
provides:
  - "getMyAllocationDashboard emits the RESOLVED differenced series under strategy_analytics.daily_returns (book path)"
  - "MyAllocationDashboardPayload strategy.series_state — three-valued derived honesty signal, sibling of is_composite"
  - "raw returns_series + computation_status stripped server-side (T-147-10)"
affects: [147-05]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Resolve-at-the-projection: emit the derived value under the SAME field name so downstream consumers are fixed at zero diff"
    - "Strip-then-project (the _dqf destructure idiom) extended to two more raw columns"
    - "Select a column ONLY to feed a server-side derivation, then destructure it out so the payload ships exactly its declared type (created_at)"

key-files:
  created: []
  modified:
    - src/lib/queries.ts
    - src/lib/queries.my-allocation.test.ts
    - src/app/(dashboard)/allocations/lib/mandate-gates.test.ts
    - src/app/(dashboard)/allocations/lib/strategies-row-adapter.test.ts
    - src/app/(dashboard)/allocations/components/HoldingsTable.strategy-rows.test.tsx
    - .planning/phases/147-scen-01-the-scenario-engine-receives-the-real-series/147-VALIDATION.md

key-decisions:
  - "P3 resolved by annotating the intermediate as Record<string, unknown> (the block's existing idiom) rather than casting an object literal or widening the client-facing Pick<> — the raw series column never reaches the payload type"
  - "strategy.created_at is selected for the 16h age bound and then STRIPPED, matching the three strips already at this site, rather than riding along as an undeclared payload passenger"
  - "series_state is required (not optional) on the payload type, mirroring is_composite; the three fixture builders that construct the type literally were updated with each file's own coalesce-after-spread idiom"

requirements-completed: [SCEN-01]

# Metrics
duration: 30min
completed: 2026-08-04
---

# Phase 147 Plan 04: Book-path series resolution Summary

**`getMyAllocationDashboard` now resolves the analytics wealth curve into the real differenced return series server-side and emits it under the same `daily_returns` field name — closing the one reader that had no lazy-fetch rescue, and carrying a derived `series_state` produced by the same single predicate the returns route uses.**

## Performance

- **Duration:** ~30 min
- **Started:** 2026-08-04T22:49Z (worktree base corrected first)
- **Completed:** 2026-08-04T23:20Z
- **Tasks:** 2, both TDD (RED → GREEN, four commits)
- **Files modified:** 6 (0 created)

## Accomplishments

- **The founder's acceptance anchor is fixed.** The scenario composer consults this payload FIRST for any strategy already in the allocator's book and deliberately skips the lazy `/returns` fetch for those rows (RESEARCH P2). The embed now selects `returns_series` + `computation_status`, and the projection emits `resolveDailyReturnSeries(daily_returns, returns_series)` under the unchanged `daily_returns` field name — so an own-portfolio analytics-only strategy stops collapsing to `[]`.
- **Six downstream consumers fixed at zero diff.** ScenarioComparePanel, strategies-row-adapter, AlphaBetaDecomposition, composite-returns, RiskDecomposition and CorrelationMatrix are byte-unchanged; they read the same field, which now carries real data.
- **Neither raw column crosses the trust boundary (T-147-10).** `returns_series` and `computation_status` are destructured out alongside the existing `data_quality_flags` strip. Asserted two ways: key-absence on the emitted analytics object, and `JSON.stringify(row)` containing neither string.
- **`series_state` is derived by ONE rule.** `deriveEmptySeriesState` has exactly one call site in `queries.ts` (`grep -c` → 1). A non-empty resolved series short-circuits to `"available"` by length; everything else defers to the shared ladder, so the book path and the route cannot disagree (UI-SPEC §3 / SC2).
- **The 16h missing-row bound reaches the book path.** A strategy whose compute job was never enqueued has `status === null` forever; at 17h old it now reports `"empty"`, at 1h `"computing"` — the permanent-spinner class stays dead here too.
- **Both falsifiability mutations ran and were reverted**, including the SC-1 mutation deliberately aimed at the SECOND class member (`queries.ts`, not the route) per the ledger's instance-fix note.

## Task Commits

1. **Task 1 (RED): failing tests for book-path series resolution** — `b62eba15` (test)
2. **Task 1 (GREEN): widen select, resolve server-side, strip raw columns** — `18cff7fb` (feat)
3. **Task 2 (RED): failing tests for derived series_state** — `ed6273fc` (test)
4. **Task 2 (GREEN): series_state on the book payload** — `9ff0fb54` (feat)

No REFACTOR commits — neither GREEN implementation needed cleanup.

## Files Created/Modified

- `src/lib/queries.ts` — embed widened with `returns_series`/`computation_status` (inside the existing parenthesised block) and `created_at` (inside the strategy join block); `resolveDailyReturnSeries` + `deriveEmptySeriesState`/`SeriesState` imported; projection resolves, strips three raw fields, and derives `series_state`; payload type gains the `series_state` sibling of `is_composite`.
- `src/lib/queries.my-allocation.test.ts` — `psProvenance` extended with five optional, defaulted inputs; new describe block `getMyAllocationDashboard — Phase 147 SCEN-01 series resolution` with 8 tests (4 resolution + 4 state).
- `src/app/(dashboard)/allocations/lib/mandate-gates.test.ts`, `.../lib/strategies-row-adapter.test.ts`, `.../components/HoldingsTable.strategy-rows.test.tsx` — one line each: the now-required `series_state` on the payload fixture builders.
- `.planning/.../147-VALIDATION.md` — SC-1 and SC-4(book) rows moved to ✅ with pasted RED evidence.

## Decisions Made

- **P3 handled at the intermediate, not the payload type.** Casting the object literal `{...analyticsRest, daily_returns: resolved}` directly to the payload's `Pick<>` failed TS2352 (the spread dropped the index signature). The plan's P3 guard prescribes widening the intermediate typing rather than admitting a raw column to the client-facing `Pick<>`; I annotated a `Record<string, unknown>` local — the same idiom `analyticsObj` already uses — which restores the overlap the pre-existing `analyticsRest as …` cast relied on. The `Pick<>` is untouched.
- **`created_at` is stripped, not shipped.** It is selected purely to feed the age bound. This projection already strips three raw fields so only declared payload fields ship; letting an undeclared `created_at` ride along in `...strategyRest` would break that local convention for no benefit. It is dropped in the same destructure.
- **The direct-first test was green before implementation.** Three of Task 1's four tests were RED; `direct-first` asserts that a populated `daily_returns` column still wins, which was already true. It is a regression guard on behavior the change could plausibly have broken (spread order), not a RED driver — recorded here rather than silently counted as a RED.
- **Oracle independence held.** The expected series `[0.05, −0.10, 0.10]` is written as hand-computed literals from the wealth curve, and the 16h bound appears in the test only as hour offsets — neither is produced by calling the code under test or importing its constants.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Three payload fixture builders missing the new required field**
- **Found during:** Task 2
- **Issue:** `series_state` is required on the payload strategy type (sibling of `is_composite`, per plan). Three test files construct that type as an object literal, so `npx tsc --noEmit` failed with TS2741 in `mandate-gates.test.ts:91`, `strategies-row-adapter.test.ts:24`, and `HoldingsTable.strategy-rows.test.tsx:77`.
- **Fix:** Added one line per builder using each file's own existing idiom — `over.strategy?.series_state ?? "empty"` for the two `??`-style builders, and the coalesce-after-spread form in `mandate-gates.test.ts` where `trust_tier`/`is_composite` already sit. `"empty"` is the honest default for a fixture carrying no series.
- **Files modified:** the three test files above
- **Verification:** `npx tsc --noEmit` exit 0; all three files green (138 tests across the 5 affected files).
- **Committed in:** `9ff0fb54` (Task 2 GREEN commit)

---

**Total deviations:** 1 auto-fixed (1 blocking). No architectural changes, no Rule 4 escalations, zero package installs.
**Impact on plan:** Mechanical type-propagation only; no behavior change in any of the three touched fixtures.

## Issues Encountered

- **Worktree base was wrong on spawn and the prompt's base hash was malformed.** HEAD sat on `origin/main` (`764038a7`), 4 commits behind wave 1 — `src/lib/factsheet/resolve-series.ts` would have been absent. The prompt's `EXPECTED_BASE` (`096245e2c177…`) is not a valid object; its short prefix `096245e2` resolves to `096245e27c128d70cdd12b52c3c6071b0b624f3b`, the wave-1 merge commit ("chore: merge executor worktree"). The branch-namespace assertion passed first, `merge-base` confirmed the reset was a pure fast-forward (no commits discarded), and the foundation file was verified present at that tree before and after `git reset --hard`. Worth flagging to the orchestrator: the corrupted-suffix hash would have hard-failed a literal, unexamined execution of the guard block.
- Pre-existing lint warning in `src/app/(dashboard)/allocations/widgets/performance/EquityChart.tsx:1119` (`react-hooks/exhaustive-deps`) — untouched by this plan, out of scope, not fixed.

## Verification Results

- `npx vitest run src/lib/queries.my-allocation.test.ts src/__tests__/phase-84-asset-class-flow.test.ts --no-file-parallelism` → **84 passed / 2 files** (the phase-84 slice pin green proves both marker literals are byte-unchanged)
- Regression sweep `npx vitest run src/lib "src/app/(dashboard)/allocations" --no-file-parallelism` → **296 files / 5096 passed, 9 skipped**
- `npx tsc --noEmit` → exit 0
- `npm run lint` → 0 errors (1 pre-existing warning in an untouched file); route-contract and admin-manifest checks OK
- `grep -v "^\s*//" src/lib/queries.ts | grep -c "deriveEmptySeriesState("` → **1** (no inlined second rule)
- `grep -c "strategy:strategies!inner (" src/lib/queries.ts` → **1** (marker not relocated or duplicated)
- `git diff --name-only <base> HEAD` → exactly the 6 files listed above
- No file deletions in any of the four commits; no untracked files left behind

### Falsifiability (147-VALIDATION.md)

| SC | Mutation | Result |
|----|----------|--------|
| SC-1 | `queries.ts` — pass `undefined` instead of `analyticsObj.returns_series` (the SECOND class member) | ✅ RED: `expected [] to have a length of 3 but got +0`; reverted, 80/80 green |
| SC-4(book) | `queries.ts` — hard-code the terminal-empty arm to `"computing"` | ✅ RED: `expected 'computing' to be 'empty'`; reverted, 84/84 green |

## TDD Gate Compliance

Both tasks followed RED → GREEN in order, each gate its own commit (`test(…)` then `feat(…)`), with the RED result recorded in the commit message. No REFACTOR gate was needed.

## Known Stubs

None — no placeholder values, TODOs, or unwired data paths introduced. `series_state` is derived from real inputs at every branch.

## Threat Flags

None. No new endpoint, no new query, and no change to the ownership gate: the widened columns sit inside an embed the `.eq("portfolio_id", portfolio.id)`-scoped read already authorized (T-147-11). The two raw columns are stripped before the payload crosses (T-147-10), asserted by test. Zero package installs (T-147-SC).

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

- **147-05 can consume `row.strategy.series_state`** on every book row; it is typed `SeriesState` and is never `undefined` (required field, derived on every row including the missing-analytics-row case).
- `strategy_analytics.daily_returns` on this payload is now ALWAYS the resolved `DailyReturn[]` (or the whole `strategy_analytics` object is `null`) — 147-05's chip derivation should branch on `series_state`, not on array emptiness.
- Any future payload-fixture builder for `MyAllocationDashboardPayload` must supply `series_state`; three existing builders now model that.

## Self-Check: PASSED

- Files claimed modified exist on disk and are in the diff: `src/lib/queries.ts`, `src/lib/queries.my-allocation.test.ts`, the three fixture files, `147-VALIDATION.md`
- Commits claimed exist in this worktree's history: `b62eba15`, `18cff7fb`, `ed6273fc`, `9ff0fb54`
- No missing items.

---
*Phase: 147-scen-01-the-scenario-engine-receives-the-real-series*
*Completed: 2026-08-04*
