---
phase: 147-scen-01-the-scenario-engine-receives-the-real-series
plan: 03
subsystem: web
tags: [typescript, nextjs, rsc, supabase, scenario-share, series-resolution, vitest, tdd]

# Dependency graph
requires:
  - "147-01 — resolveDailyReturnSeries from src/lib/factsheet/resolve-series.ts (the leaf)"
provides:
  - "resolveSharedScenario(row, assetClassById?, returnsSeriesById?) — third optional caller-side lookup, conservative absent default"
  - "Phase-84-shaped sibling read of strategy_analytics(strategy_id, returns_series) on the public share page, bounded to the RPC's own series ids"
  - "page.test.tsx harness sanctioning strategy_analytics as the second (and last) non-RPC table"
affects: [147-06]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Caller-side sibling read as the zero-DDL escape hatch when a frozen SECDEF RPC cannot be widened (Phase-84 idiom, second application)"
    - "Disclosure bound by construction: .in() over the gate's OWN output, so an enrichment read cannot widen the gate's scope"
    - "Cumproduct-built fixtures as an independent oracle for differencing logic (inverse-function oracle, never the function under test)"

key-files:
  created: []
  modified:
    - src/app/scenario-share/[token]/share-resolve.ts
    - src/app/scenario-share/[token]/share-resolve.test.ts
    - src/app/scenario-share/[token]/page.tsx
    - src/app/scenario-share/[token]/page.test.tsx
    - .planning/phases/147-scen-01-the-scenario-engine-receives-the-real-series/147-VALIDATION.md

key-decisions:
  - "withPublishedOnly deliberately NOT applied to the strategy_analytics read: `status` is a strategies-table column, so wrapping it would be a type-level lie rather than a gate; the ids were already published-gated inside the SECDEF RPC that emitted them"
  - "Widened page.test.tsx's table allow-list from one table to a CLOSED two-table set rather than deleting the leak guard — a third table still throws"
  - "Updated the file's SECURITY BOUNDARY header from 'Two Supabase reads' to three; it is an enumerating security comment and a stale one is a real defect"
  - "Test oracle is a cumprod-built wealth index (the inverse of the differencing under test), never a re-derivation via equityCurveToDailyReturns"

requirements-completed: [SCEN-01]

# Metrics
duration: 28min
completed: 2026-08-04
---

# Phase 147 Plan 03: Share-page series resolution Summary

**The public scenario-share projection now resolves each leg through the ONE series mechanism — a caller-side `strategy_analytics.returns_series` sibling read, bounded to the frozen RPC's own ids, differenced into returns — so a share recipient sees the same real track the owner's composer blends instead of the silent zeros the dead `daily_returns` column produced, with zero new migrations.**

## Performance

- **Duration:** ~28 min
- **Tasks:** 2 (Task 1 TDD: RED → GREEN)
- **Files modified:** 5 (0 created, 5 modified)

## Accomplishments

- `resolveSharedScenario` takes an optional third `returnsSeriesById?: Record<string, unknown>`, mirroring the Phase-84 `assetClassById` idiom in the same file. The `seriesById` loop now calls `resolveDailyReturnSeries(s.daily_returns, returnsSeriesById?.[s.strategy_id])`. An absent id or omitted lookup falls back to `s.daily_returns` alone — byte-identical to pre-147, which is what keeps every existing share unchanged.
- The resolver is imported from the `@/lib/factsheet/resolve-series` **leaf** (147-01's extraction), so this documented-PURE module — read by the phase-63 series-space source scan — keeps a network/Next-free import graph. Importing via `allocator-portfolio-payload` would have dragged `build-payload` in.
- `page.tsx` gained a second sibling read, `strategy_analytics(strategy_id, returns_series)` bounded to `.in("strategy_id", seriesIds)`, in the exact shape of the existing Phase-84 asset_class block — both error arms (PostgREST `{data:null,error}` **and** throw) logged and degrading to an empty lookup, never a thrown public page.
- The frozen spine is untouched: **zero** files under `supabase/migrations/`, and `.select("id, asset_class")` is byte-unchanged (the phase-84 pin proves it).
- The strongest new pin is economic: an analytics-only leg (`daily_returns: null` + a cumprod wealth index) now renders **byte-identical markup** to the same track arriving via `daily_returns`. That is the SCEN-01 truth stated as an assertion rather than a description.

## Task Commits

1. **Task 1 (RED): failing tests for returns_series resolution** — `76432ff7` (test)
2. **Task 1 (GREEN): optional lookup + resolver in the pure layer** — `f5764bf2` (feat)
3. **Task 2: sibling returns_series read + harness/guard update** — `fa0a1a89` (feat)

No REFACTOR commit — the GREEN implementation needed no cleanup.

## Files Modified

- `src/app/scenario-share/[token]/share-resolve.ts` — third optional param with a JSDoc in the Phase-84 voice naming the frozen-spine gate as the reason the data arrives caller-side; loop routed through `resolveDailyReturnSeries`; `normalizeDailyReturns` import replaced by the leaf import (it became unreferenced).
- `src/app/scenario-share/[token]/share-resolve.test.ts` — +167 lines: SC1-share, SC3-share, back-compat, and precedence cases with a cumprod wealth-index fixture builder.
- `src/app/scenario-share/[token]/page.tsx` — `returnsSeriesById` declaration, the bounded sibling read with the (a)/(b) rationale comment, the third resolve argument, and a corrected SECURITY BOUNDARY header.
- `src/app/scenario-share/[token]/page.test.tsx` — harness sanctions `strategy_analytics`; allow-list assertion widened to the closed two-table set; two new SCEN-01 behavioral pins.
- `147-VALIDATION.md` — SC-3(share) row marked Observed ✅ with pasted RED evidence.

## Decisions Made

- **`withPublishedOnly` is NOT applied to the `strategy_analytics` read.** It is a `strategies`-table predicate (`status` column); `strategy_analytics` has no such column, so wrapping this read would not compile as a gate — it would be a lie in the shape of one. The disclosure argument is structural instead: the read's id universe **is** the RPC's own output, and those ids were published-gated inside the SECURITY DEFINER function (`20260622120000:205`). The rationale is stated in-source so a future reader does not "fix" the missing wrapper. Matches the plan's ⚠ constraint.
- **The leak guard was widened, not weakened.** `page.test.tsx` asserted `every(([t]) => t === "strategies")` and the mock `from()` threw for any other table — so the new read initially failed the suite. I extended it to a CLOSED allow-list of exactly `strategies` + `strategy_analytics`; a third table still throws and still reds the guard. Deleting or loosening the assertion to `.some()` would have removed a real leak tripwire on a public BYPASSRLS page.
- **The SECURITY BOUNDARY header was updated.** It enumerates ("Two Supabase reads happen here"). Leaving it at two while adding a third would make the file's own security documentation false — the exact class of drift that guard comment exists to prevent.
- **Oracle independence.** The wealth-index fixtures are built by cumulative **product** from a known return array — the mathematical inverse of the differencing under test — so no expectation is re-derived through `equityCurveToDailyReturns`. The three literals `[0.05, −0.1, 0.1]` for the curve `[1.0, 1.05, 0.945, 1.0395]` are hand-computed, per the standing project rule.
- **Fixture length raised above the plan's 4-point curve.** `computeScenario` zeroes `portfolio_daily_returns` when `n < 10` (`scenario.ts:378`), so a 4-point wealth index → 3 returns is unobservable at the resolver's output. The fixture keeps the plan's exact head `[1.0, 1.05, 0.945, 1.0395]` (asserted as a fixture-integrity check) and extends to 12 points / 11 returns so the differenced values are actually assertable. Same economics, observable.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] `page.test.tsx` harness threw on the new table**
- **Found during:** Task 2
- **Issue:** The admin-client mock threw `page read an arbitrary table: strategy_analytics`, and a leak-guard assertion required every `from()` call to be `"strategies"`. The plan's `files_modified` did not list `page.test.tsx`, but the new read cannot execute in the harness without it.
- **Fix:** Added a sanctioned `strategy_analytics` builder (terminal `.in()`, capturing cols/inCol/ids) and widened the assertion to a closed two-table allow-list.
- **Files modified:** `src/app/scenario-share/[token]/page.test.tsx`
- **Verification:** Suite green; wiring falsifiability re-checked by dropping the third arg (test reds).
- **Committed in:** `fa0a1a89`

**2. [Rule 3 - Blocking] `normalizeDailyReturns` left unreferenced in share-resolve.ts**
- **Found during:** Task 1
- **Issue:** After routing the loop through the resolver, the import was dead — lint / `noUnusedLocals` failure. (Same mechanical consequence 147-01 hit.)
- **Fix:** Replaced it with the `@/lib/factsheet/resolve-series` leaf import.
- **Files modified:** `src/app/scenario-share/[token]/share-resolve.ts`
- **Committed in:** `f5764bf2`

**3. [Rule 2 - Correctness] Stale SECURITY BOUNDARY enumeration**
- **Found during:** Task 2
- **Issue:** The file header enumerated "Two Supabase reads happen here" and described both; adding a third silently falsified it.
- **Fix:** Updated to three reads, stating the disclosure bound for reads (2) and (3).
- **Files modified:** `src/app/scenario-share/[token]/page.tsx`
- **Committed in:** `fa0a1a89`

---

**Total deviations:** 3 auto-fixed (2 blocking, 1 correctness)
**Impact on plan:** No scope creep — two are mechanical consequences of the mandated edits, one keeps a security comment truthful. One file beyond `files_modified` (`page.test.tsx`) plus the plan-mandated `147-VALIDATION.md`.

## Issues Encountered

- **Worktree base was wrong on spawn.** The worktree forked from `main` (`764038a7`), ~56 commits behind and missing wave 1's foundation entirely. The base SHA supplied in my prompt (`096245e2c17792692183c85b93bd41905cf1f81c`) did not resolve — its 8-char prefix `096245e2` is correct but the tail was garbled. I resolved the prefix to the real commit `096245e27c128d70cdd12b52c3c6071b0b624f3b`, verified it carries both wave-1 artifacts (`src/lib/factsheet/resolve-series.ts` present; `deriveEmptySeriesState` in `src/lib/closed-sets.ts` — note it is at `src/lib/`, **not** `src/lib/factsheet/` as my prompt stated), and only then `git reset --hard`. Flagging because the same garbled-SHA/stale-fork pair will hit the sibling wave-2 agents.
- `node_modules/next/dist/docs/` does not exist inside the worktree; Node resolves `node_modules` by walking up to the repo root. The AGENTS.md-mandated `06-fetching-data.md` was read from `/Users/helios-mammut/claude-projects/quantalyze/node_modules/next/dist/docs/01-app/01-getting-started/`. It confirms `await`-ing a DB client in an async Server Component is the current pattern; `cacheComponents` is not enabled in `next.config.ts` and the page is `force-dynamic`, so no `use cache`/Suspense constraint applies.
- A `PostToolUse` validator repeatedly flagged `page.test.tsx:36` as "headers() is async in Next.js 16 — add await". False positive: line 36 is the `vi.mock` **definition** (`headers: async () => …`), already async and pre-existing; the page itself correctly does `await headers()`. No change made.

## Verification Results

- `npx vitest run "src/app/scenario-share/[token]" phase-84-asset-class-flow phase-29-frozen-spine-guards phase-63-series-space-guards --no-file-parallelism` → **84 passed / 6 files**
- `npx tsc --noEmit` → exit 0
- `npx eslint` on all four touched source/test files → exit 0
- `git status --porcelain supabase/migrations/` → empty; `git diff --stat <base> HEAD -- supabase/` → empty
- `grep -c '.select("id, asset_class")' page.tsx` → 1 (pinned literal intact)
- `grep -c "normalizeDailyReturns(s.daily_returns)" share-resolve.ts` → 0
- Regression sweep `src/lib/factsheet`, `src/lib/scenario.test.ts`, `scenario-compare.test.ts` → **348 passed / 20 files**
- `git diff --name-only <base> HEAD` → exactly the 5 files above; `--diff-filter=D` → no deletions
- No untracked files left behind

## Falsifiability Evidence

Two mutations were applied **after** GREEN and reverted:

1. **SC-3(share)** (plan-mandated) — `share-resolve.ts` loop reverted to the pre-147 `normalizeDailyReturns(s.daily_returns)` with the resolver left imported: SC1-share failed (`expected [] to have a length of 11 but got +0`) and SC3-share failed. Full output pasted into `147-VALIDATION.md`; that ledger row is now `✅ Observed`. The other 28 cases stayed green — the intended back-compat signal.
2. **Page wiring** (added) — dropped the third argument at `page.tsx:resolveSharedScenario(...)`: the SCEN-01 page test failed. This proves the page-level pin tests the *wiring*, not just the helper.

## TDD Gate Compliance

Task 1 followed RED (`76432ff7`, `test(...)`) → GREEN (`f5764bf2`, `feat(...)`) in order, with RED observed and recorded in the commit message. REFACTOR not needed. Task 2 was not marked `tdd="true"` in the plan, but shipped with two new behavioral tests and a falsifiability check anyway.

## Known Stubs

None. The one empty initializer introduced (`const returnsSeriesById: Record<string, unknown> = {}`) is a conservative default with a real data source wired immediately below it, and its absent-lookup behavior is itself test-pinned.

## Threat Flags

None beyond the plan's register. The new surface is exactly T-147-07 (sibling read over-returns), mitigated as planned via `.in("strategy_id", seriesIds)` with the rationale stated in-source; T-147-08 holds (the raw index is consumed server-side in the RSC — asserted by `expect(analyticsHtml).not.toContain("returns_series")`); T-147-09 holds (zero migrations, phase-29 green). Zero package installs (T-147-SC).

One item worth a reviewer's eye, not a flag: the leak-guard allow-list in `page.test.tsx` now admits a second table. It remains closed and falsifiable, but it is the security tripwire for this public BYPASSRLS page and any future widening should be treated as a deliberate review event.

## Success Criteria

- [x] Share projection for a returns_series-only strategy carries the real differenced series
- [x] Frozen spine untouched; all three pre-existing structural gates green
- [x] Absent-lookup default proven byte-identical to pre-147 behavior

## Next Phase Readiness

- 147-06's grep-gate can pin the structural facts this plan established: `share-resolve.ts` contains `resolveDailyReturnSeries(` and imports it from `@/lib/factsheet/resolve-series`; `page.tsx` contains the literal `"strategy_id, returns_series"` and `.in("strategy_id", seriesIds)`.
- The behavioral pin lives in **both** `share-resolve.test.ts` (pure layer) and `page.test.tsx` (wiring + read contract) — the plan's fallback clause ("if the harness cannot capture the new read…") did not apply; the harness does capture it.
- STATE.md / ROADMAP.md deliberately untouched — the orchestrator owns those writes after the wave completes.

## Self-Check: PASSED

- Files claimed modified exist on disk and appear in `git diff --name-only <base> HEAD`: all 5.
- Commits claimed exist in this worktree's history: `76432ff7`, `f5764bf2`, `fa0a1a89`.
- No missing items.

---
*Phase: 147-scen-01-the-scenario-engine-receives-the-real-series*
*Completed: 2026-08-04*
