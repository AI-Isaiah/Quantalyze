---
phase: 147-scen-01-the-scenario-engine-receives-the-real-series
plan: 02
subsystem: api
tags: [typescript, nextjs-route-handler, next-og, series-resolution, vitest, tdd, scen-01]

# Dependency graph
requires:
  - "147-01 — src/lib/factsheet/resolve-series.ts (resolveDailyReturnSeries)"
  - "147-01 — deriveEmptySeriesState + SeriesState in src/lib/closed-sets.ts"
provides:
  - "ReturnsResponse.series_state — the additive 'available' | 'computing' | 'empty' wire discriminator consumed by 147-05"
  - "Returns route reads returns_series + computation_status and resolves through the ONE mechanism"
  - "OG factsheet route reads returns_series and resolves through the LEAF import (no build-payload graph)"
  - "src/app/api/og/factsheet/[id]/route.test.tsx — first-ever test file for the OG route (Wave-0 gap closed)"
affects: [147-05, 147-06]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "next/og under vitest: stub ImageResponse as a recording class exposing a real Headers — capture the element tree, never render a PNG"
    - "Spy-by-delegation: wrap the real helper (importOriginal) so inputs are captured while the ORACLE stays the true implementation"
    - "PostgREST-faithful mock: project the fixture row to the selected columns so a narrowed select starves the data and select-width mutations are falsifiable at the behaviour level"
    - "Lazy branch-scoped enrichment read: issue a second query only inside the branch that needs it, when a pinned select cannot be widened"

key-files:
  created:
    - src/app/api/og/factsheet/[id]/route.test.tsx
  modified:
    - src/app/api/strategies/[id]/returns/route.ts
    - src/app/api/strategies/[id]/returns/route.test.ts
    - src/app/api/og/factsheet/[id]/route.tsx
    - .planning/phases/147-scen-01-the-scenario-engine-receives-the-real-series/147-VALIDATION.md

key-decisions:
  - "The plan's OG Test 1 (finite metrics from a 4-point fixture) is unsatisfiable — computeOgHeadline gates Sharpe/MaxDD on >= 30 observations and CAGR on >= 0.95 calendar years. Split into O1 (wiring: the helper receives the 3 differenced rows) and O1b (outcome: finite metrics from a 400-day returns_series-only track)"
  - "The strategy_analytics test mock now PROJECTS to the selected columns. Without it the SC-1 mutation reddened only the grep-style select assertion while the behaviour test stayed green — the 'tested the helper, not the wiring' failure mode"
  - "The strategy age for the missing-row arm comes from a SEPARATE lazy read rather than a widened existence probe, because that probe's .select(\"id, asset_class\") is byte-pinned by phase-84-asset-class-flow.test.ts:42"
  - "An analytics row that EXISTS with a null/non-string computation_status maps to 'empty', not 'computing': the lazy age read fires only when the row is absent entirely"

patterns-established:
  - "Additive wire field: declare on the exported response interface with a JSDoc that states the disclosure argument (emitted only after the 404 probe), matching the asset_class / is_composite house style"
  - "Reword your own comments rather than leave prose that false-positives an acceptance grep (the 147-01 lesson, applied preemptively)"

requirements-completed: [SCEN-01]

# Metrics
duration: 45min
completed: 2026-08-04
---

# Phase 147 Plan 02: Returns route + OG card series resolution Summary

**Killed the SCEN-01 bug proper — the composer's lazy-fetch route and the public OG card both read only `daily_returns`, a column 0/27 real strategies populate, so every service-computed strategy contributed `[]` to a blend and unfurled as a blank card; both now resolve through the ONE mechanism, and the returns route emits an age-bounded `series_state` so an empty series can say which kind of empty it is.**

## Performance

- **Duration:** ~45 min
- **Started:** 2026-08-04T22:47:00+02:00
- **Completed:** 2026-08-04T23:32:00+02:00
- **Tasks:** 2 (both TDD, RED→GREEN)
- **Files modified:** 5 (1 created, 4 modified)

## Accomplishments

- **The bug proper is dead.** `src/app/api/strategies/[id]/returns/route.ts` now selects `daily_returns, returns_series, computation_status, data_quality_flags` — the same width the already-correct factsheet v2 read uses — and resolves via `resolveDailyReturnSeries`. A strategy added from the composer's Browse drawer gets its real track instead of `[]`.
- **The wealth index is never forwarded raw.** The resolver differences the cumprod curve by successive ratios, so the emitted array is N−1 points. R13 pins the economic invariant directly: a curve starting at exactly `1.0` must not produce a `+100%` day one. Under the SC-3 mutation that assertion reads `expected 1 to not be close to 1` — the bug, verbatim.
- **`series_state` is server-derived and age-bounded.** `available` when the resolved series is non-empty, otherwise `deriveEmptySeriesState` against `computation_status`. The missing-analytics-row arm is bounded at 16h, so a strategy whose job was never enqueued degrades to `No data` instead of spinning `Syncing` forever (the permanent-spinner class Phase 142 exists to kill).
- **The OG card renders real numbers.** `src/app/api/og/factsheet/[id]/route.tsx` widens its embed and resolves through the **leaf** import, so the route does not gain the factsheet `build-payload` graph on every unfurl hit (`resolve-series.ts` has exactly three import lines, none of them `build-payload`).
- **Wave-0 gap closed:** the OG route has its first-ever test file, covering the fix, the direct-first regression, the fallback card, the published-only gate, and the fail-soft throw arm — with `next/og` stubbed and no PNG rendered.
- **Both falsifiability rows are discharged with pasted evidence** (147-VALIDATION.md rows `SC-1(route)` and `SC-3`), each mutated, observed RED, and reverted.

## Task Commits

1. **Task 1 (RED): failing tests for returns-route resolution + series_state** — `f1ab0c6a` (test) — 7 failed | 17 passed
2. **Task 1 (GREEN): returns route resolves the real series + emits series_state** — `8626b3ee` (feat)
3. **Task 2 (RED): failing tests for the OG factsheet card** — `a1efeeae` (test) — 3 failed | 3 passed
4. **Task 2 (GREEN): OG card renders real metrics for service-computed strategies** — `c27f2818` (feat)

No REFACTOR commits — neither GREEN implementation needed cleanup.

## Files Created/Modified

- `src/app/api/strategies/[id]/returns/route.ts` — widened analytics select; `resolveDailyReturnSeries` replaces the bare `normalizeDailyReturns(raw)`; `series_state` derivation with a branch-scoped lazy `created_at` read; `series_state` added to the exported `ReturnsResponse` with its disclosure JSDoc.
- `src/app/api/strategies/[id]/returns/route.test.ts` — R12–R18 appended to the R-numbered matrix; `STATE.analyticsRow` widened with `returns_series` + `computation_status`; a `strategies.created_at` mock arm whose select is recorded in its **own** slot; the analytics mock now projects to the selected columns.
- `src/app/api/og/factsheet/[id]/route.tsx` — embed widened to `strategy_analytics ( daily_returns, returns_series )`; array-shape gate + hand-rolled row coercion replaced by the leaf resolver behind a `length >= 2` guard; `AnalyticsEmbed` type extracted.
- `src/app/api/og/factsheet/[id]/route.test.tsx` (new, 327 lines) — O1/O1b/O2/O3/O4/O5.
- `147-VALIDATION.md` — rows `SC-1(route)` and `SC-3` marked observed with pasted failure output.

## Decisions Made

- **The plan's OG Test 1 was unsatisfiable as written.** It asked for `computeOgHeadline` to yield finite `sharpe`/`cagr`/`maxDd` from "the same 4-point wealth-index fixture as Task 1". That fixture differences to 3 rows, and `computeOgHeadline` returns `NaN` below 30 observations (and gates CAGR on ≥ 0.95 calendar years). Rather than weaken the assertion to something that could not fail, I split it: **O1** keeps the plan's literal wiring claim (the helper receives 3 rows, with the hand-computed literals), and **O1b** proves the must-have outcome — finite metrics and a card with **zero** em-dash sentinels — using a deterministic 400-day wealth curve in `returns_series` only. O1b is the assertion that is red on the pre-147 route for the founder's actual strategies.
- **The analytics mock now projects to the selected columns.** With the fixture returned wholesale, dropping `returns_series` from the select reddened only the string assertion (R14) while the behaviour test (R12) stayed green — a select-width pin that cannot fail behaviourally is exactly the wiring-vs-helper gap. After the change the same mutation costs 3 tests including the length assertion.
- **`computeOgHeadline` is wrapped, not replaced.** The spy delegates to the real implementation via `importOriginal`, so O1b's finiteness is pinned against the true contract rather than a double that could be made to say anything (Oracle Independence, checklist item 4).
- **An existing analytics row with a null status maps to `empty`.** The lazy `created_at` read is scoped to `analyticsRow === null`, so a row that exists but carries no status is terminal absence. A row's existence means a job ran; treating that as "still computing" would be a spinner with no bound behind it.
- **Comment prose reworded so `grep -c "Array.isArray(dailyRaw)"` is literally 0.** 147-01 hit an acceptance criterion that its own verbatim-move mandate made unsatisfiable; here the collision was in text I authored, so I removed it rather than argue intent.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] `node_modules` absent in the worktree**
- **Found during:** setup, before Task 1
- **Issue:** the worktree had no `node_modules`, so `npx vitest` / `npx tsc` / the AGENTS.md-mandated read of `node_modules/next/dist/docs/…` were all impossible.
- **Fix:** symlinked the main repo's **existing** install. No package manager ran and no package was installed or resolved from a registry (the Rule 3 install exclusion is not engaged).
- **Files modified:** none tracked (`node_modules` is gitignored; `git status` stayed clean).
- **Verification:** `ls node_modules/next/dist/docs/01-app/01-getting-started/` resolved; the route-handlers guide was read before either handler was edited.

**2. [Rule 1 - Bug] The plan's OG Test 1 asserted an outcome its own fixture cannot produce**
- **Found during:** Task 2
- **Issue:** `computeOgHeadline` needs ≥ 30 finite observations; the specified 4-point fixture differences to 3 rows → all three metrics `NaN`. Written literally the test would have failed forever; softened, it would have been vacuous.
- **Fix:** split into O1 (wiring — the plan's literal claim) and O1b (outcome — finite metrics from a 400-day deterministic wealth curve). The must-have truth "the OG sparkline/headline is finite when only returns_series is populated" is now genuinely proven.
- **Files modified:** `src/app/api/og/factsheet/[id]/route.test.tsx`
- **Committed in:** `a1efeeae`

**3. [Rule 2 - Missing critical] The SC-1 mutation was unfalsifiable at the behaviour level**
- **Found during:** Task 1, running the ledger mutation
- **Issue:** the mock returned `STATE.analyticsRow` regardless of the select, so a route that stopped selecting `returns_series` still received it. Only the string assertion went red — the exact "tested the helper, not the wiring" gap.
- **Fix:** the mock projects to the selected columns as PostgREST does.
- **Files modified:** `src/app/api/strategies/[id]/returns/route.test.ts`
- **Verification:** re-ran the mutation — 3 failed including `R12 … expected [] to have a length of 3 but got +0`.
- **Committed in:** `8626b3ee`

**4. [Rule 2 - Missing critical] Added O5, a fail-soft proof beyond the plan's four OG tests**
- **Found during:** Task 2
- **Issue:** the plan's acceptance requires the outer try/catch be preserved, but its Test 3 (both columns null) never enters that catch — it proves the *fallback*, not the *fail-soft*. Nothing would have caught a future edit that let a throwing read 500 a public route.
- **Fix:** O5 makes `createClient()` throw and asserts a card is still constructed and the failure is logged.
- **Files modified:** `src/app/api/og/factsheet/[id]/route.test.tsx`
- **Committed in:** `a1efeeae`

---

**Total deviations:** 4 auto-fixed (1 blocking, 1 bug, 2 missing-critical)
**Impact on plan:** no scope creep — every change either unblocked execution or made a stated acceptance criterion actually falsifiable. Both plan tasks landed with their specified files, selects and resolver calls.

## Issues Encountered

- **The orchestrator's expected base SHA was malformed.** The prompt named `096245e2c17792692183c85b93bd41905cf1f81c`, which exists nowhere; the real wave-1 merge commit is `096245e27c128d70cdd12b52c3c6071b0b624f3b`. The 8-character prefix resolves uniquely and the commit is exactly the described "merge executor worktree" carrying the wave-1 foundation, so I reset to the real SHA rather than halt. Worth flagging to the orchestrator — a sibling agent given the same malformed value would hit the same wall.
- **I destroyed uncommitted work with `git checkout -- <file>` and recovered it.** Reverting the SC-3 mutation, I used `git checkout --` on the route, which reset it to the last commit — and the last commit was the RED test only, so the entire Task-1 implementation went with it. Recovered from a `/tmp` copy taken mid-mutation plus a one-hunk revert, then re-verified green (29/29), `tsc` and `eslint` before committing. The general lesson: revert a mutation by re-editing the mutated lines, never by a file-level checkout, unless the pre-mutation state is committed.
- **The worktree HEAD started 5 commits behind** the wave-1 base (at `764038a7`, before the phase-147 planning commits) — corrected by the mandated reset in the startup branch check before any work began.

## Verification Results

- `npx vitest run "src/app/api/og/factsheet/[id]/route.test.tsx" "src/app/api/strategies/[id]/returns/route.test.ts" src/__tests__/phase-84-asset-class-flow.test.ts src/__tests__/no-store-coverage.test.ts src/lib/factsheet/og-metrics.test.ts --no-file-parallelism` → **42 passed / 5 files**
- `npx vitest run "src/app/api/" --no-file-parallelism` → **1738 passed | 3 skipped / 91 files** (full API-route regression)
- `npx vitest run src/lib/factsheet/ src/lib/closed-sets*.test.ts --no-file-parallelism` → **300 passed / 20 files**
- `npx tsc --noEmit` → exit 0
- `npm run lint` → **0 errors**, 1 pre-existing unrelated warning (`EquityChart.tsx:1119`, `react-hooks/exhaustive-deps` — out of scope, not touched)
- Acceptance greps: `normalizeDailyReturns(raw)` → 0; the exact select string present at `route.ts:254`; `resolveDailyReturnSeries(` → 1 per route; `.select("id, asset_class")` probe intact at `route.ts:214`; `dailyRaw` → 0 in the OG route; leaf import graph = 3 lines, no `build-payload`
- `git diff -U0` on both routes shows **no hunk** touching `captureToSentry`, the `Failed to load returns` envelope, `NO_STORE_HEADERS`, `composite === true`, the pinned probe, or the OG `Cache-Control` block
- No file deletions in any of the four commits; no untracked files left behind

## Falsifiability Evidence

| Row | Mutation | Result |
|-----|----------|--------|
| SC-1(route) | dropped `returns_series` from the analytics select | **RED** — 3 failed: `R12 … expected [] to have a length of 3 but got +0`, R13, `R14 … expected 'daily_returns, computation_status, da…' to contain 'returns_series'`. Reverted → 24/24 |
| SC-3 | replaced the resolver with `normalizeDailyReturns(row?.returns_series)` (raw wealth index) | **RED** — 6 failed: `R13 … expected 1 to not be close to 1, received difference is 0` (the +100% day one) and `R12 … expected [ …(4) ] to have a length of 3 but got 4`. Blast radius wider than the ledger predicted — R4/R4b/R10/R18 also red, because raw forwarding also drops the direct-first CSV arm. Reverted → 24/24 |

## TDD Gate Compliance

Both tasks followed RED → GREEN in order, each gate its own commit with the observed counts recorded in the commit message: Task 1 `f1ab0c6a` (test) → `8626b3ee` (feat); Task 2 `a1efeeae` (test) → `c27f2818` (feat). REFACTOR was not needed in either.

## Known Stubs

None — no placeholder values, TODOs, or unwired data paths. `series_state` is emitted by the route and consumed by 147-05 (wave 3) as planned; it is a live server-derived value, not a stub.

## Threat Flags

None. Neither route gains a trust boundary: the returns route's `withPublishedOrOwner` 404 probe and per-user rate limit are untouched (`series_state` is computed strictly downstream of the probe — T-147-04), and the OG route's `withPublishedOnly` gate is untouched and now asserted by O4 (T-147-06). Both widened selects read columns already served publicly for published strategies by the factsheet v2 page, and `analytics_read` RLS is table-level with no column grants (T-147-03). Zero package installs (T-147-SC).

## User Setup Required

None — no external service configuration required.

**Operational note (P10):** OG staleness is CDN-owned. The corrected card appears on a re-unfurl within the existing 24h `s-maxage` / 7d `stale-while-revalidate` window; a stale preview in the first hours after deploy is expected behaviour, not a regression. Verify with a cache-busting query string.

## Next Phase Readiness

- 147-05 can consume `ReturnsResponse.series_state` as a **required** field of the exported interface; the literal set is `"available" | "computing" | "empty"` (`SeriesState` from `@/lib/closed-sets`). Per PATTERNS §Shared-4 the composer should still narrow it by literal match with a conservative default, never a throw, so a stale deploy that omits it degrades cleanly.
- 147-06's grep gate will find `resolveDailyReturnSeries(` in both routes and should expect **one** call site each; the returns route additionally carries `deriveEmptySeriesState(` exactly once.
- The `returns/route.test.ts` harness now projects to the selected columns — a gate author planting a bare `daily_returns` select in this file will see behaviour tests redden, not just structural ones.

## Self-Check: PASSED

- Files claimed created exist on disk: `src/app/api/og/factsheet/[id]/route.test.tsx`
- Files claimed modified exist and carry the changes: `returns/route.ts`, `returns/route.test.ts`, `og/factsheet/[id]/route.tsx`, `147-VALIDATION.md`
- Commits claimed exist in this worktree's history: `f1ab0c6a`, `8626b3ee`, `a1efeeae`, `c27f2818`
- No missing items.

---
*Phase: 147-scen-01-the-scenario-engine-receives-the-real-series*
*Completed: 2026-08-04*
