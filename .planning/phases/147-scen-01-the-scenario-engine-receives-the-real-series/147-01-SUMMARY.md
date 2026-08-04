---
phase: 147-scen-01-the-scenario-engine-receives-the-real-series
plan: 01
subsystem: api
tags: [typescript, closed-sets, factsheet, series-resolution, vitest, tdd]

# Dependency graph
requires: []
provides:
  - "src/lib/factsheet/resolve-series.ts — leaf module exporting equityCurveToDailyReturns + resolveDailyReturnSeries with a 3-import graph (no build-payload)"
  - "SERIES_STATES closed set + SeriesState type in src/lib/closed-sets.ts"
  - "MISSING_ROW_COMPUTING_WINDOW_MS (16h) — one staleness threshold shared with the analytics-service reaper"
  - "deriveEmptySeriesState(status, strategyCreatedAt, nowMs?) — the single server-side empty-series discriminator"
affects: [147-02, 147-03, 147-04, 147-05]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Leaf extraction + back-compat re-export: move shared pure functions out of a heavy module, re-export from the original so importers stay at zero diff"
    - "Closed set + one shared predicate (closed-sets.ts idiom): as-const tuple, derived type, one exported function carrying the why-comment"
    - "Injected clock (nowMs default Date.now()) for deterministic threshold tests"

key-files:
  created:
    - src/lib/factsheet/resolve-series.ts
    - src/lib/closed-sets.series-state.test.ts
  modified:
    - src/lib/factsheet/allocator-portfolio-payload.ts
    - src/lib/closed-sets.ts

key-decisions:
  - "Kept the moved docstrings byte-verbatim, so the leaf still contains the word 'FactsheetPayload' in prose; the plan's literal grep-count-0 acceptance was satisfied in its intent (import graph) instead, verified by an import-line-scoped grep"
  - "allocator-portfolio-payload.ts keeps a local import of equityCurveToDailyReturns (its own builder still calls it) alongside the single-line re-export that carries both symbols"
  - "MISSING_ROW_COMPUTING_WINDOW_MS reuses the reaper's 16h STRATEGY_ANALYTICS_REAP_THRESHOLD rather than introducing a second, driftable threshold"

patterns-established:
  - "Pattern 1: pure-leaf extraction with a single-line `export { … } from './leaf'` back-compat line, so consumer import specifiers never change"
  - "Pattern 2: threshold oracles are typed as literals in the test and never imported from the module under test (oracle independence)"

requirements-completed: [SCEN-01]

# Metrics
duration: 12min
completed: 2026-08-04
---

# Phase 147 Plan 01: Series-resolution foundation Summary

**Extracted `resolveDailyReturnSeries`/`equityCurveToDailyReturns` into a 3-import leaf module (no build-payload graph) and added the `SeriesState` closed set with `deriveEmptySeriesState`, whose 16h age bound — shared with the analytics-service reaper — terminates the missing-analytics-row permanent spinner.**

## Performance

- **Duration:** ~12 min
- **Started:** 2026-08-04T22:15:30+02:00
- **Completed:** 2026-08-04T22:27:15+02:00
- **Tasks:** 2 (one TDD, RED→GREEN)
- **Files modified:** 4 (2 created, 2 modified)

## Accomplishments

- `src/lib/factsheet/resolve-series.ts` now holds the ONE series-resolution mechanism (SC2, Rule 7) with exactly three imports — `DailyPoint` + `normalizeDailyReturns` from `@/lib/portfolio-math-utils`, `DailyReturn` from `./types`. It does **not** import `./build-payload`, which is what previously dragged the heavy factsheet graph into any consumer; the OG route and public share page (Wave 2) can now import it directly.
- Both functions moved verbatim (bodies and docstrings untouched), so the existing economic-invariant tests in `allocator-portfolio-payload.test.ts` stayed byte-unchanged and green — the T-147-01 tampering mitigation.
- `allocator-portfolio-payload.ts` re-exports both symbols on a single line, so `factsheet/[id]/v2/page.tsx`, `discovery/[slug]/[strategyId]/page.tsx` and the existing test keep their import specifier at zero diff. Neither detail page appears in this plan's diff.
- `SERIES_STATES` / `SeriesState` / `MISSING_ROW_COMPUTING_WINDOW_MS` / `deriveEmptySeriesState` added to `closed-sets.ts` next to `STRATEGY_ANALYTICS_COMPUTATION_STATUSES`, mirroring that block's as-const-tuple + derived-type + one-predicate idiom.
- The 16h missing-row bound is unit-proven at the boundary in both directions (1ms past → `empty`, 1ms inside → `computing`), which is the assertion that goes red if the window is ever widened or removed.

## Task Commits

1. **Task 1: Extract resolve-series.ts leaf with back-compat re-exports** — `ac69de50` (refactor)
2. **Task 2 (RED): failing tests for the 16h age bound** — `5e5d6c2f` (test)
3. **Task 2 (GREEN): SeriesState closed set + deriveEmptySeriesState** — `0960938c` (feat)

No REFACTOR commit — the GREEN implementation needed no cleanup.

## Files Created/Modified

- `src/lib/factsheet/resolve-series.ts` (new) — leaf module: `equityCurveToDailyReturns` (wealth curve → daily returns via successive ratios) and `resolveDailyReturnSeries` (daily_returns first, else derive from the `returns_series` cumprod curve).
- `src/lib/factsheet/allocator-portfolio-payload.ts` — two function bodies removed; single-line re-export added with a Phase-147/SC2 rationale comment; now-unused `normalizeDailyReturns` and `DailyReturn` imports dropped; `equityCurveToDailyReturns` imported for its own builder's use at the payload site.
- `src/lib/closed-sets.ts` — `SERIES_STATES`, `SeriesState`, `MISSING_ROW_COMPUTING_WINDOW_MS`, `deriveEmptySeriesState` with the P5 evidence chain in the docstring.
- `src/lib/closed-sets.series-state.test.ts` (new) — 7 tests covering the six specified behaviors plus a never-returns-`available` sweep.

## Decisions Made

- **Verbatim docstrings over a literal grep count.** Task 1's acceptance asked for `grep -c "build-payload\|FactsheetPayload" resolve-series.ts == 0`, but the same task's action mandated a verbatim move including docstrings — and the moved docstring's prose says "the FactsheetPayload builder expects". These cannot both hold literally. I kept the docstrings verbatim (explicit action instruction, and the T-147-01 mitigation depends on a no-retype move) and verified the criterion's actual intent — a clean import graph — with a scoped check: `grep -nE "^(import|export) .*from"` on the leaf returns exactly the three allowed specifiers, none of them `./build-payload`. The single residual match is prose on line 7.
- **Two lines reference `./resolve-series` in the re-export file.** The re-export is exactly one line and carries both symbols (matching the plan's `key_links` pattern verbatim); a separate plain `import { equityCurveToDailyReturns }` exists because `buildAllocatorPortfolioPayload` still calls that function locally, and an `export … from` statement creates no local binding. An import line is not a re-export line.
- **`deriveEmptySeriesState` returns `SeriesState` (not a narrowed `"computing" | "empty"`).** Matches the signature in the plan's `<interfaces>` block, which downstream plans compile against; the never-returns-`available` invariant is enforced by a test rather than by the type, and the docstring states it.
- **Docstring reworded after RED** so the test file does not name `MISSING_ROW_COMPUTING_WINDOW_MS` even in a comment — the oracle-independence grep-gate (`== 0`) is now literally true, and the 16h boundary exists in the test only as the typed literal `57600000`.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Dropped two imports left dangling by the move**
- **Found during:** Task 1
- **Issue:** After removing the two function bodies, `normalizeDailyReturns` and the `DailyReturn` type were no longer referenced in `allocator-portfolio-payload.ts`; leaving them would fail lint/`noUnusedLocals`. Conversely `equityCurveToDailyReturns` is still called by `buildAllocatorPortfolioPayload`, so a bare `export … from` was insufficient.
- **Fix:** Removed the two unused imports; added `import { equityCurveToDailyReturns } from "./resolve-series"` alongside the re-export.
- **Files modified:** `src/lib/factsheet/allocator-portfolio-payload.ts`
- **Verification:** `npx tsc --noEmit` clean; `npx eslint` on all four touched files clean.
- **Committed in:** `ac69de50` (Task 1 commit)

---

**Total deviations:** 1 auto-fixed (1 blocking)
**Impact on plan:** Mechanical consequence of the extraction; no behavior change, no scope creep.

## Issues Encountered

- Worktree HEAD was forked 1 commit behind the expected base (`a79d99d3`); corrected with the mandated `git reset --hard` in the startup branch check before any work was done.
- Two acceptance criteria were written as literal `grep -c … == 0` gates that also match prose in comments. One was reconcilable (Task 2 — reworded my own docstring); one was not (Task 1 — the verbatim-move constraint owns that text). Documented above rather than silently "fixed" by rewriting moved code.

## Verification Results

- `npx vitest run src/lib/closed-sets.series-state.test.ts src/lib/closed-sets.test.ts src/lib/factsheet/allocator-portfolio-payload.test.ts --no-file-parallelism` → **42 passed / 3 files**
- `npx tsc --noEmit` → exit 0
- `npx eslint` on the four touched files → exit 0
- `git diff --name-only a79d99d3 HEAD` → exactly the four files in `files_modified`, nothing else
- Task 2 RED gate observed before implementation: 7/7 failed with `TypeError: deriveEmptySeriesState is not a function`
- `grep -c "MISSING_ROW_COMPUTING_WINDOW_MS" src/lib/closed-sets.series-state.test.ts` → 0; `grep -c "57600000\|16 \* 60 \* 60 \* 1000"` → 2
- No file deletions in either task commit; no untracked files left behind

## TDD Gate Compliance

Task 2 followed RED (`5e5d6c2f`, `test(...)`) → GREEN (`0960938c`, `feat(...)`) in order, with RED observed and recorded in the commit message. REFACTOR was not needed.

## Known Stubs

None — no placeholder values, TODOs, or unwired data paths introduced.

## Threat Flags

None — this plan is pure library code with no I/O, no request handling, and no new trust boundary. Zero package installs (T-147-SC).

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Wave 2 (147-02 … 147-05) can import `resolveDailyReturnSeries` from `@/lib/factsheet/resolve-series` without pulling the build-payload graph, and `deriveEmptySeriesState` / `SeriesState` from `@/lib/closed-sets`.
- Signatures match the plan's `<interfaces>` block exactly, including the optional `nowMs` third parameter.
- Note for 147-02: `deriveEmptySeriesState` needs the strategy's `created_at`, and PATTERNS §Pinned Literals flags that the returns-route probe `.select("id, asset_class")` is byte-pinned by `phase-84-asset-class-flow.test.ts:42` — the age input must come from a separate read or the pin must be updated deliberately.

## Self-Check: PASSED

- Files claimed created exist on disk: `src/lib/factsheet/resolve-series.ts`, `src/lib/closed-sets.series-state.test.ts`, `147-01-SUMMARY.md`
- Commits claimed exist in this worktree's history: `ac69de50`, `5e5d6c2f`, `0960938c`, `0899aea8`
- No missing items.

---
*Phase: 147-scen-01-the-scenario-engine-receives-the-real-series*
*Completed: 2026-08-04*
