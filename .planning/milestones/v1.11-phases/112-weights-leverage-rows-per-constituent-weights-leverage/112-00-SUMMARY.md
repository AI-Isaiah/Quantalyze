---
phase: 112-weights-leverage-rows-per-constituent-weights-leverage
plan: 00
subsystem: testing
tags: [vitest, react-testing-library, scenario-composer, weights, leverage, regression-first]

# Dependency graph
requires:
  - phase: 111-CONSTIT
    provides: unified constituent rows, togglePerKeySource, scenario-constituent-perkey testid
  - phase: 90.5-LEV-02
    provides: leverageOverrides map, sanitizeLeverageMap, pruneLeverageToDraftRefs, Save round-trip harness
provides:
  - "6 RED-proof regression tests (1 state-layer, 4 composer, 1 save) that FAIL on the current tree — the automated <verify> targets for Plans 112-01/02"
  - "3 GREEN state-layer pins characterizing the existing weight-basis + toggle-preserve behavior the composer writer must respect"
  - "1 GREEN sanitize-on-read pin for api_key_id leverage refs (T-112-01/02 mitigation)"
affects: [112-01, 112-02, 112-VALIDATION]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "RED scaffold: assert element existence FIRST so the failure is a query/assertion mismatch, never a downstream TypeError"
    - "@ts-expect-error marks a not-yet-existing API param (userExplicitRefs 4th arg); Plan 01 removes the directive when it lands the parameter"
    - "Seed per-key leverage via the hydrate channel (open a saved draft carrying leverageOverrides) when no input widget exists yet — assert the SAVE PAYLOAD, not the widget"

key-files:
  created: []
  modified:
    - "src/app/(dashboard)/allocations/lib/scenario-state-apply-weights.test.ts"
    - "src/app/(dashboard)/allocations/components/ScenarioComposer.test.tsx"
    - "src/app/(dashboard)/allocations/components/ScenarioComposer.save.test.tsx"

key-decisions:
  - "RED (a) userExplicitRefs uses a 4th positional arg guarded by @ts-expect-error (ignored at runtime → clean assertion failure, no tsc break)"
  - "Task-2 mixed fixture is materialized via the UI (addStrategy + set added-row weight to 0.5) since addStrategyBrowse defaults a lone add to weight 1.0"
  - "Task-3(a) is made non-vacuous by seeding an added control ref (survives prune) alongside the per-key ref (dropped) in the same leverageOverrides map"
  - "Task-3(b) gives per-key refs weightOverrides entries so they survive prune, letting the PUT body directly observe the sanitized (10 / 1) values"

patterns-established:
  - "Every Phase-112 guarded behavior has a RED-proof test before implementation (regression-first)"
  - "GREEN pins characterize the wrong-tool (setWeightOverride on per-key) and preserve-and-restore contracts so Plans 01/02 cannot silently regress them"

requirements-completed: []  # RED scaffold only — WEIGHTS-01/02 are turned GREEN by Plans 01/02, not this plan

# Metrics
duration: 22min
completed: 2026-07-17
---

# Phase 112 Plan 00: Wave-0 RED test scaffold Summary

**6 RED-proof regression tests (per-key userExplicitRefs, per-key weight/leverage inputs + share renormalization, per-key leverage prune-drop at Save) plus 4 GREEN behavior pins — every Phase-112 guarded behavior now has an automated verify target that fails on the current tree for the right reason.**

## Performance

- **Duration:** ~22 min
- **Started:** 2026-07-17T00:57Z (approx)
- **Completed:** 2026-07-17T01:06Z
- **Tasks:** 3
- **Files modified:** 3 (test-only)

## Accomplishments
- Closed the two ❌ Wave-0 gaps in 112-VALIDATION.md (per-key leverage pruned at Save; wrong weight-sum basis) with tests that FAIL today.
- Proved each RED failure is an assertion/query mismatch (never a crash/import error) and captured the exact failing assertion in each commit body.
- Left every pre-existing test in all three touched files green (9 / 175 / 28 pre-existing pass respectively) and scenario.ts byte-frozen vs origin/main.

## RED-Proof Evidence (the 6 intended failures)

**State layer — `scenario-state-apply-weights.test.ts` (1 RED / 3 GREEN new):**
1. **(a) RED — single-row edit stamps ONLY the user-edited ref.** `applyWeightOverrides(draft, {K1,K2,A}, [K1,K2,A], [K1])` — the 4th `userExplicitRefs` arg does not exist yet.
   `AssertionError: expected { …(3) } to not have property "apikey-2222…" — Expected: undefined, Received: 0.311111`

**Composer — `ScenarioComposer.test.tsx` (4 RED new):**
2. **(a) RED — per-key rows render weight + leverage inputs.** `AssertionError: expected null not to be null` (`getElementById('weight-pk-112-k1')`).
3. **(b) RED — typing 0.3 into K1 renormalizes to K1 0.300 / K2 0.3111 / A 0.3889, sum 1.** `expected null not to be null` (per-key weight input absent).
4. **(c) RED — K1 leverage 2× moves projection volatility.** `expected null not to be null` (per-key leverage input absent; `beforeVol` read first — render healthy).
5. **(d) RED — typed per-key weight preserved across exclude → re-include.** `expected null not to be null` (per-key weight input absent).

**Save path — `ScenarioComposer.save.test.tsx` (1 RED / 1 GREEN new):**
6. **(a) RED — per-key-ref leverage survives Save.** Control `strat-lev-112:3` survives; per-key `pk-lev-112-a` pruned.
   `AssertionError: expected { 'strat-lev-112': 3 } to have property "pk-lev-112-a" with value 2 — Expected: 2, Received: undefined`

**GREEN pins (pass today, characterize existing behavior):**
- State (b) sum-1 vector over {K1,K2,A} basis reproduces exactly within 1e-9.
- State (c) plain `setWeightOverride` on a per-key ref is the WRONG tool: skips K2, mixed sum = 1.4 ≠ 1 (Pitfall 2).
- State (d) `togglePerKeySource` preserves a typed per-key weight across exclude → re-include.
- Save (b) hostile persisted per-key leverage clamps on read (999 → 10, -3 → 1) and the draft LOADS (no zod-refine reset).

## Task Commits

1. **Task 1: State-layer weight-basis tests** — `326cd378` (test)
2. **Task 2: Composer per-key weight/leverage RED tests** — `6b965c32` (test)
3. **Task 3: Save-path per-key leverage prune-drop RED + sanitize pin** — `0170e40a` (test)

_No plan-metadata commit: `.planning/` is a gitignored local ledger and is never staged on this project._

## Files Created/Modified
- `src/app/(dashboard)/allocations/lib/scenario-state-apply-weights.test.ts` — +137 lines: mixed per-key + added fixture; 1 RED (userExplicitRefs) + 3 GREEN (engine-unit basis sum-1, wrong-tool characterization, toggle preserve).
- `src/app/(dashboard)/allocations/components/ScenarioComposer.test.tsx` — +193 lines: book-mode per-key describe block; 4 RED (weight+leverage inputs, share renormalization, leverage re-derivation, exclude→re-include preserve). Added `MAX_LEVERAGE` import.
- `src/app/(dashboard)/allocations/components/ScenarioComposer.save.test.tsx` — +203 lines: book+gate per-key Save harness; 1 RED (Pitfall-1 prune-drop) + 1 GREEN (api_key_id sanitize-on-read).

## Decisions Made
- **`@ts-expect-error` for the not-yet-existing 4th param** (Task 1a): keeps runtime RED (extra arg ignored → clean assertion failure) without breaking the tsc gate; Plan 01 removes it when it adds `userExplicitRefs`.
- **Materialize the mixed fixture via the UI** (Task 2): `addStrategyBrowse` gives a lone first add weight 1.0, so A's 0.5 is set through the existing added-row weight input to reach the mixed engine mass 1.5.
- **Non-vacuous prune RED** (Task 3a): an added control ref (survives prune, reads 3× in its input) proves the leverage map genuinely seeded, isolating the per-key drop as the sole failure.

## Deviations from Plan

None - plan executed exactly as written. (No production files modified; no packages installed; scenario.ts byte-frozen.)

## Issues Encountered
None. Local runs used `--no-file-parallelism` per the project's known vitest-flake guidance; all three files ran clean in isolation.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- **Plan 112-01** turns state (a) + composer (a/b/d) GREEN: add the per-key weight input + the engine-unit-basis writer + the `userExplicitRefs` param on `applyWeightOverrides`.
- **Plan 112-02** turns composer (c) + save (a) GREEN: add the per-key leverage input + extend `pruneLeverageToDraftRefs` to keep eligible per-key `api_key_id`s.
- The exact expected numbers (K1 0.300 / K2 0.3111 / A 0.3889) and the sanitized values (10 / 1) are baked into the assertions — Plans 01/02 must reproduce them.

## Self-Check: PASSED
- Files: all 3 modified test files FOUND on disk.
- Commits: 326cd378, 6b965c32, 0170e40a all FOUND in git log.
- Verification: 6 RED (assertion/query mismatches, no crashes) + 4 new GREEN; all pre-existing tests green; scenario.ts byte-frozen; git diff limited to the 3 test files.

---
*Phase: 112-weights-leverage-rows-per-constituent-weights-leverage*
*Completed: 2026-07-17*
