---
phase: 112-weights-leverage-rows-per-constituent-weights-leverage
plan: 01
subsystem: allocations-scenario-composer
tags: [weights, per-key, engine-unit-basis, scenario-composer, react, pure-ts-state, WEIGHTS-01]

# Dependency graph
requires:
  - phase: 112-00
    provides: Wave-0 RED test scaffold (state (a) userExplicitRefs; composer per-key weight/leverage inputs + share renormalization + exclude/re-include preserve)
  - phase: 111-CONSTIT
    provides: unified constituent rows, togglePerKeySource, scenario-constituent-perkey testid
provides:
  - "applyWeightOverrides optional 4th userExplicitRefs param (additive, back-compatible) — diffCount-honest single-ref stamping"
  - "blendShareByRef derivation (effective blend share per selected engine unit) threaded into CompositionList"
  - "engine-unit-basis per-key weight writer in handleWeightChange (WR-01 pattern) — closes Pitfall 2 for per-key edits"
  - "live per-key weight input on the unified constituent rows (id weight-<api_key_id>)"
affects: [112-02, 112-VALIDATION]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Per-key weight edits renormalize a sum-1 vector over the SELECTED ENGINE UNIT basis via applyWeightOverrides(vector, basisIds, [scopeRef]); added edits keep legacy setWeightOverride"
    - "blendShareByRef = per-unit weight / selected-weight mass; Σ≤0 → empty map (no fabricated shares, DESIGN.md Numbers Contract)"
    - "Optional trailing param keeps a pure state fn back-compatible; the composer opts into single-ref diffCount stamping"

key-files:
  created: []
  modified:
    - "src/app/(dashboard)/allocations/lib/scenario-state.ts"
    - "src/app/(dashboard)/allocations/hooks/useScenarioState.ts"
    - "src/app/(dashboard)/allocations/components/ScenarioComposer.tsx"
    - "src/app/(dashboard)/allocations/lib/scenario-state-apply-weights.test.ts"
    - "src/app/(dashboard)/allocations/components/ScenarioComposer.test.tsx"

key-decisions:
  - "Per-key edits route through the engine-unit basis; ADDED edits stay on legacy setWeightOverride. The plan's literal 'branch on usePerKeySources' was refined to 'usePerKeySources && !addedIdSet.has(scopeRef)' because routing added-row edits through the engine basis breaks the Wave-0 fixture (addAWithWeightHalf expects mass 1.5 via legacy setWeightOverride). Rule-1 correctness deviation — the Wave-0 tests are the contract."
  - "Per-key weight input value shows the EFFECTIVE blend share (blendShareByRef); excluded rows fall back to the preserved stored weightOverride so a typed weight survives exclude → re-include (Wave-0 pin (d))."
  - "Added-row weight input display left byte-identical (stored weightOverrides): after the first engine-basis edit the stored weights ARE the sum-1 shares, so no divergence the Wave-0 mixed-share test can observe (surgical rule)."
  - "Split Wave-0 composer test (a) into (a-weight) [112-01 GREEN] and (a-leverage) [112-02 RED] so this plan exits with zero unexpected reds (Wave-0 contract)."

patterns-established:
  - "Weight-sum invariant on the mixed per-key + added surface is maintained by writing a full sum-1 vector over the engine basis, never by looping the single-ref rebalancer."

requirements-completed: [WEIGHTS-01]

# Metrics
duration: 12min
completed: 2026-07-17
---

# Phase 112 Plan 01: Per-key weight input + engine-unit weight-sum basis Summary

**Per-key (strategy-level) constituent rows are now weight-editable end-to-end: input → handleWeightChange → engine-unit-basis applyWeightOverrides → projectionState → blend. A typed 30% renders as exactly 30% of the blend, sum-to-1 holds across the mixed per-key + added set (Pitfall 2 closed with a RED-proven regression), and a single-row edit stamps exactly one ref into userWeightOverrides (diffCount honesty). scenario.ts stays byte-frozen (SC-3).**

## Performance
- **Duration:** ~12 min
- **Started:** 2026-07-16T23:09:52Z
- **Completed:** 2026-07-16T23:21:31Z
- **Tasks:** 3
- **Files modified:** 5 (3 production, 2 test)

## Wave-0 Tests Flipped GREEN
- **state (a)** — `scenario-state-apply-weights.test.ts` — a single-row weight edit stamps ONLY the user-edited ref into `userWeightOverrides` (K2/A absent). Landed the `userExplicitRefs` 4th param; removed the `@ts-expect-error` marker.
- **composer (a-weight)** — `ScenarioComposer.test.tsx` — per-key row renders a weight input (min 0), disabled when excluded. (Split from the original combined (a).)
- **composer (b)** — typing 0.3 into K1 renormalizes the mixed {K1,K2,A} basis to K1 0.300 / K2 0.3111 / A 0.3889, sum 1.
- **composer (d)** — a typed per-key weight is preserved across exclude → re-include.

## Remaining Reds (Declared Plan-02 — expected, NOT this plan's scope)
- **composer (a-leverage)** — per-key leverage input bounded [0, MAX_LEVERAGE] (Plan 02 adds the leverage input).
- **composer (c)** — setting K1 leverage to 2× moves projection volatility (Plan 02).
- **save (a)** — per-key-ref leverage survives Save (`pruneLeverageToDraftRefs` extension, Plan 02).

These are exactly the leverage + save-prune reds the 112-00 scaffold declared for Plan 02. Zero unexpected reds.

## Task Commits
1. **Task 1: applyWeightOverrides userExplicitRefs param** — `4eb36932` (feat)
2. **Task 2: engine-unit-basis per-key weight writer + blendShareByRef** — `58c095db` (feat)
3. **Task 3: render per-key weight input (remove weight half of fence)** — `e3df73b6` (feat)

_No plan-metadata commit for `.planning/` — it is a gitignored local ledger and is never staged on this project._

## What Changed (per file)
- `scenario-state.ts` — `applyWeightOverrides` gains an optional 4th `userExplicitRefs?: ReadonlyArray<string>`. Provided → stamp only those refs into `userWeightOverrides`; omitted → stamp-all (optimizer-Apply byte-for-byte unchanged). JSDoc extended.
- `useScenarioState.ts` — interface member + `useCallback` wrapper forward the optional `userExplicitRefs` to the pure fn. All other callers unaffected (param optional).
- `ScenarioComposer.tsx` — (1) `blendShareByRef` useMemo (effective blend share per selected engine unit; empty map when Σ≤0). (2) `handleWeightChange` branches: per-key edits build a sum-1 vector over the WR-01 engine-unit basis and dispatch `applyWeightOverrides(vector, basisIds, [scopeRef])`; added edits keep legacy `setWeightOverride`. Fail-loud non-finite/clamp contract preserved verbatim. (3) Per-key row renders a weight input (value = effective share ?? preserved stored weight); fence comment rewritten (weight live, leverage still Plan 02, no remove button).
- `scenario-state-apply-weights.test.ts` — removed the now-unused `@ts-expect-error` on the (a) RED test (the 4th param now exists).
- `ScenarioComposer.test.tsx` — split the combined (a) into (a-weight) [now green] and (a-leverage) [stays red for Plan 02].

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Weight-writer branch condition narrowed to per-key edits**
- **Found during:** Task 2
- **Issue:** The plan's literal branch — "when usePerKeySources is TRUE, route through the engine basis" — would route ADDED-strategy weight edits through the engine basis too. The Wave-0 fixture `addAWithWeightHalf` sets added strategy A's weight to 0.5 via the added-row input (in book mode) and depends on that producing mixed engine mass 1.5 (K1/K2 stay raw equity share) — the legacy `setWeightOverride` behavior. Routing the A edit through the engine basis instead renormalizes K1/K2 down and yields sum-1 immediately, making composer (b) resolve to K1 0.300 / K2 0.200 / A 0.500 instead of the required K1 0.300 / K2 0.3111 / A 0.3889.
- **Fix:** Branch on `usePerKeySources && !addedIdSet.has(scopeRef)` — the engine-unit basis writer fires only for PER-KEY unit edits (the units Pitfall 2 is actually about); added edits keep the legacy `setWeightOverride` path byte-for-byte. This is also the semantically correct root-cause fix (Rule 6): per-key edits are the ones excluded from `enabledIdsOf`, so they are the ones that need the explicit engine basis.
- **Files modified:** `src/app/(dashboard)/allocations/components/ScenarioComposer.tsx`
- **Commit:** `58c095db`

**2. [Wave-0 contract] Split combined composer test (a)**
- **Found during:** Task 3
- **Issue:** Wave-0 test (a) combined weight-input AND leverage-input assertions in one test; leverage is Plan 02.
- **Fix:** Split into (a-weight) [green now] + (a-leverage) [red, Plan 02] so this plan exits with zero unexpected reds. Explicitly authorized by the Wave-0 contract.
- **Files modified:** `src/app/(dashboard)/allocations/components/ScenarioComposer.test.tsx`
- **Commit:** `e3df73b6`

## Verification
- **Wave-0 weight tests GREEN:** state (a); composer (a-weight), (b), (d).
- **Full allocations suite:** `npx vitest run "src/app/(dashboard)/allocations" --no-file-parallelism` → 1585 passed, 3 failed — all 3 are the declared Plan-02 leverage/save-prune reds (composer (a-leverage), composer (c), save (a)). No unexpected regressions.
- **Engine frozen:** `git diff --exit-code src/lib/scenario.ts` clean after every task; `scenario-backbone-gates.test.ts` + `scenario.test.ts` green.
- **tsc --noEmit:** exit 0 (whole repo).
- **eslint** on all 5 touched files: exit 0.

## Known Stubs
None — the per-key weight input is fully wired (input → handleWeightChange → engine-unit-basis applyWeightOverrides → projectionState → blend). The per-key leverage input is intentionally still fenced (documented in the row comment) and is Plan 112-02's scope, not a stub.

## Issues Encountered
None. Local runs used `--no-file-parallelism` per the project's vitest-flake guidance.

## Self-Check: PASSED
- **Files:** all 5 modified files present on disk.
- **Commits:** `4eb36932`, `58c095db`, `e3df73b6` all found in git log.
- **Verification:** Wave-0 weight tests green; only the declared Plan-02 leverage/save-prune reds remain; scenario.ts byte-frozen; tsc + lint 0 errors.

---
*Phase: 112-weights-leverage-rows-per-constituent-weights-leverage*
*Completed: 2026-07-17*
