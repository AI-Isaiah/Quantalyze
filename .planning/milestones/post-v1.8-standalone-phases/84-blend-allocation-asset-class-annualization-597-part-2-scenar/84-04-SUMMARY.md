---
phase: 84-blend-allocation-asset-class-annualization
plan: 04
subsystem: analytics
tags: [blend-annualization, asset-class, scenario-compare, scenario-share, periodsPerYear, blendPeriodsPerYear]

# Dependency graph
requires:
  - phase: 84-01
    provides: "blendPeriodsPerYear(legs) helper; scenario-adapter Pick widened with asset_class (per-key units tagged 'crypto', added legs carry meta.asset_class)"
  - phase: 84-02
    provides: "ScenarioBenchmarkSection optional periodsPerYear prop (default 252)"
provides:
  - "Blend-basis threading through the saved-draft compare engine (computeMetricsForDraft)"
  - "Blend-basis threading through the public share page (share-resolve + zero-DDL asset_class read)"
  - "ResolvedOk.periodsPerYear so the share page rides the projection's own basis"
affects: [84-05, 84-06, blend-annualization, scenario-compare, scenario-share]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Caller-side blend basis: blendPeriodsPerYear over SELECTED legs only (activeStrategies gate), passed as the engine's 4th periodsPerYear arg"
    - "Zero-DDL asset_class enrichment on a public page via a published-only, ids-bounded service-role sibling read (no RPC/migration widening; phase-29 exit gate honored)"

key-files:
  created: []
  modified:
    - "src/app/(dashboard)/allocations/lib/scenario-compare.ts"
    - "src/app/(dashboard)/allocations/components/ScenarioComparePanel.tsx"
    - "src/app/scenario-share/[token]/share-resolve.ts"
    - "src/app/scenario-share/[token]/page.tsx"

key-decisions:
  - "Blend basis derived over SELECTED legs only — a toggled-off crypto leg cannot flip a tradfi blend to 365"
  - "Share page reads asset_class via a caller-side published-only strategies read (id, asset_class), NOT an RPC widening — the phase-29 FORBIDDEN_MIGRATION_RE gate forbids scenario/share DDL"
  - "Kept the EXPLICIT .eq('status','published') at the call site under a B10 sanctioned-exception (defence-in-depth mirroring the RPC's own rule) rather than routing through withPublishedOnly"
  - "Re-baselined the Atlas-class per-key golden Sharpe 10.45 (252) -> 12.576 (365) — the intended blend-rule behavior; twr unchanged (basis-invariant)"

patterns-established:
  - "Byte-identical engine-reference oracle for basis tests (the engine rounds vol/sharpe, so √-ratio tolerances are wrong; compare against computeScenario at the exact basis instead)"
  - "cagr destructured out of every basis deep-equal (84-06 moves scenario.ts CAGR to the calendar clock this phase)"

requirements-completed: [BLEND-01]

# Metrics
duration: 20min
completed: 2026-07-10
---

# Phase 84 Plan 04: Non-composer computeScenario blend-basis threading Summary

**Saved-draft compare columns and public shared scenarios now annualize on the same blend rule as the live composer (√365 if any selected leg is crypto, else √252), with the share page deriving asset_class via a zero-DDL published-only strategies read — no scenarios/share migration.**

## Performance

- **Duration:** ~20 min
- **Started:** 2026-07-10T01:33:00Z
- **Completed:** 2026-07-10T01:52:00Z
- **Tasks:** 2 (both TDD)
- **Files modified:** 7 (3 source + 4 test)

## Accomplishments
- `computeMetricsForDraft` derives `blendPeriodsPerYear` over the SELECTED adapter units and threads it as the 4th `computeScenario` arg (compare engine, both the per-key and added-only branches).
- The public share page (`share-resolve.ts`) gained an optional `assetClassById` param, carries each added leg's `asset_class`, threads the basis, and exposes `ResolvedOk.periodsPerYear`; `page.tsx` sources asset_class via a published-only, ids-bounded service-role `strategies` read and threads the identical basis into `ScenarioBenchmarkSection`.
- Zero SQL migrations — the phase-29 frozen-spine exit gate stays green (proven in-plan).

## Task Commits

1. **Task 1: Compare path — lookup widening + basis threading** — `5cf234e4` (feat, TDD)
2. **Task 2: Share page — zero-DDL asset_class lookup + basis threading** — `4ccadf49` (feat, TDD)

_Both tasks: failing test written first (RED confirmed), then implementation._

## Files Created/Modified
- `src/app/(dashboard)/allocations/lib/scenario-compare.ts` — widened `addedStrategyMetadataLookup` Pick with `asset_class`; derive `blendPeriodsPerYear` over selected legs; 4th `computeScenario` arg. Import from `@/lib/closed-sets`.
- `src/app/(dashboard)/allocations/lib/scenario-compare.test.ts` — 4 BLEND-01 behaviors pinned; Atlas golden Sharpe re-baselined to the 365 value.
- `src/app/(dashboard)/allocations/components/ScenarioComparePanel.tsx` — `ComparePayloadStrategy.strategy.asset_class`; thread `asset_class ?? null` into the compare inputs.
- `src/app/scenario-share/[token]/share-resolve.ts` — optional `assetClassById`; `asset_class` on the unit literal; basis derivation + 4th arg; `ResolvedOk.periodsPerYear`.
- `src/app/scenario-share/[token]/share-resolve.test.ts` — 365 case, empty-lookup byte-identity + `periodsPerYear` default, honest-absence-not-resurrected.
- `src/app/scenario-share/[token]/page.tsx` — published-only ids-bounded strategies read (id, asset_class only); degrade-to-252 on failure; `periodsPerYear` into `ScenarioBenchmarkSection`.
- `src/app/scenario-share/[token]/page.test.tsx` — extended the admin mock with the strategies read; pinned the published-only ids-bounded query, end-to-end 365 basis threading, and the failed-read 252 degrade.

## Decisions Made
- **Selected-only basis:** the blend basis reads only legs where `state.selected[id]` is truthy (the engine's activeStrategies gate), so an excluded crypto leg cannot flip a tradfi blend. Pinned by a dedicated test.
- **Zero-DDL share-page enrichment:** asset_class comes from a caller-side `strategies` read (`id, asset_class`, `status='published'`, ids ∈ RPC series) on the same admin transport — never an RPC/migration widening (phase-29 gate). Failed/empty read degrades to the 252 default, never throwing on the public page.
- **cagr excluded from basis deep-equals:** `scenario.ts` still computes CAGR on the count clock (`years = n/periodsPerYear`), so it shifts with the basis until 84-06 (this phase) converts it to the calendar clock. Every basis deep-equal destructures `cagr` out of both sides.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Test correctness] Basis tests use a byte-identical engine reference, not a √(365/252) ratio tolerance**
- **Found during:** Task 1 (initial RED design)
- **Issue:** The plan's behavior description implies asserting the crypto/tradfi vol ratio ≈ √(365/252). `scenario.ts` ROUNDS its outputs (`volatility` toFixed(5), `sharpe` toFixed(3)), so a ratio of two rounded metrics drifts from the exact √ at ~1e-5 (vol) to ~1e-3 (sharpe) — a tight ratio tolerance is mathematically wrong.
- **Fix:** Assert the crypto/per-key metrics are BYTE-IDENTICAL (cagr stripped) to a direct `computeScenario` at basis 365, and distinct from the 252 reference — identical rounding on both sides, rounding-robust and exact.
- **Files modified:** `scenario-compare.test.ts`, `share-resolve.test.ts` (assertion strategy only)
- **Verification:** all four compare behaviors + the share 365/252 cases pass; RED confirmed pre-implementation.
- **Committed in:** `5cf234e4`, `4ccadf49`

**2. [Rule 3 - Blocking / codebase convention] B10 lint gate on `.eq("status","published")`**
- **Found during:** Task 2 (`npm run lint`)
- **Issue:** The `quantalyze/no-raw-published-predicate` (B10/B25 capstone) lint rule bans a raw `.eq("status","published")` on a `strategies` query and mandates `withPublishedOnly()`. The plan requires BOTH `npm run lint` clean AND the explicit `.eq("status","published")` at the call site — an inherent conflict.
- **Fix:** Added a `B10 sanctioned-exception:` marker comment (the codebase's own allowlist mechanism, cf. `src/lib/notes/ownership.ts:86`) justifying the deliberate explicit predicate as defence-in-depth mirroring the RPC's own published-only rule on a public route. Satisfies both the lint gate and the plan's explicit-filter security intent.
- **Files modified:** `src/app/scenario-share/[token]/page.tsx`
- **Verification:** `npx eslint` on all touched files → exit 0.
- **Committed in:** `4ccadf49`

**3. [Rule 1 - Intended re-baseline] Atlas-class per-key golden Sharpe 10.45 → 12.576**
- **Found during:** Task 1 (after threading the basis)
- **Issue:** The pre-existing "Atlas-class book-only 40-day blend" golden pinned Sharpe at 10.45 — the pre-84 √252 value. Per-key units carry `asset_class: 'crypto'` (84-01), so a real book blend now correctly rides √365, moving Sharpe to 10.45·√(365/252) = 12.576. This is the phase's intended behavior, not a regression.
- **Fix:** Re-baselined the Sharpe pin to 12.576 (√365) with an explanatory comment; `twr` (basis-invariant) unchanged. The plan's "pre-existing oracles pass unchanged" acceptance conflicts with its own behavior spec here — the behavior spec (per-key → 365) is authoritative.
- **Files modified:** `scenario-compare.test.ts`
- **Verification:** all 27 compare tests green.
- **Committed in:** `5cf234e4`

---

**Total deviations:** 3 (1 test-correctness, 1 blocking/convention, 1 intended re-baseline)
**Impact on plan:** No scope creep. All three are faithfulness fixes — correct oracle design, a required CI lint gate, and re-baselining a golden to the shipped blend rule. Security contract fully preserved (id+asset_class only, published-only, ids-bounded).

## Issues Encountered
- The engine's output rounding (Task 1 debug) initially made √-ratio assertions flap at 6 digits; resolved by switching to byte-identical engine references (Deviation 1).

## Verification Evidence

```
# Plan verification block
npx vitest run scenario-compare.test.ts share-resolve.test.ts phase-29-frozen-spine-guards.test.ts --no-file-parallelism
  Test Files  3 passed (3)   Tests  54 passed (54)

# Task 2 tests (share)
npx vitest run share-resolve.test.ts page.test.tsx --no-file-parallelism
  Test Files  2 passed (2)   Tests  33 passed (33)

npx tsc --noEmit            -> clean
npx eslint <7 touched files> -> exit 0 (LINT CLEAN)
git status --porcelain supabase/ -> empty (ZERO migrations; phase-29 guard 4/4 green)

# Acceptance greps
grep -c blendPeriodsPerYear scenario-compare.ts   -> 4 (>=2)
computeScenario 4th arg `basis`                    -> present (scenario-compare.ts:301)
grep -c blendPeriodsPerYear share-resolve.ts       -> 4 (>=2)
grep -c 'select("id, asset_class")' page.tsx       -> 1
grep -c '.eq("status", "published")' page.tsx      -> 1
grep -c '.in("id", seriesIds)' page.tsx            -> 1 (bounded to RPC series ids)
```

## Threat Flags

None — no new security surface beyond the plan's threat model. The only new read (T-84-04a) is mitigated exactly as designed: `.eq("status","published")` + projection limited to `id, asset_class` + ids bounded to the RPC's own published series list. No migration touched (T-84-04c mitigated; phase-29 gate green).

## Next Phase Readiness
- Compare + share are the two non-composer call sites from the locked list; both threaded.
- 84-06 (wave 3) will convert `scenario.ts` CAGR to the calendar clock — all basis deep-equals here already strip `cagr`, so they stay green when that lands.

## Self-Check: PASSED

- All 4 modified source files present on disk.
- Both task commits (`5cf234e4`, `4ccadf49`) present in git history.
- SUMMARY created at the plan's `<output>` path.

---
*Phase: 84-blend-allocation-asset-class-annualization*
*Completed: 2026-07-10*
