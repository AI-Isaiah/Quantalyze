---
phase: 112-weights-leverage-rows-per-constituent-weights-leverage
reviewed: 2026-07-17T00:00:00Z
depth: deep
files_reviewed: 3
files_reviewed_list:
  - src/app/(dashboard)/allocations/components/ScenarioComposer.tsx
  - src/app/(dashboard)/allocations/lib/scenario-state.ts
  - src/app/(dashboard)/allocations/hooks/useScenarioState.ts
findings:
  blocker: 1
  high: 1
  medium: 0
  low: 0
  total: 2
status: issues_found
---

# Phase 112: Code Review Report

**Reviewed:** 2026-07-17
**Depth:** deep (cross-file: composer ↔ scenario-state ↔ useScenarioState, traced against the frozen engine's renorm)
**Files Reviewed:** 3 production (+ 3 test files as guard-context)
**Status:** issues_found

## Summary

The per-key weight/leverage inputs, the engine-unit-basis writer for **per-key** edits, `blendShareByRef`, the notional column (safe em-dash on `null`/non-finite), the `eligiblePerKeyIds` prune fix at **both** save sites, the sanitize-on-read pin, and the SC-3 freeze (`scenario.ts` byte-identical — verified) are all correct. The `useMemo`/`useCallback` dependency arrays are exhaustive and the handlers are recreated each render (no stale closures). Notional derivation and NaN handling are sound.

Two real defects remain, both on the phase's **central invariant** ("sum-to-1 across the mixed per-key + added set") and its **stated diffCount-honesty goal** — and both are *asymmetries*: the fix was applied to the per-key edit path but not carried through to the sibling path that shares the same basis.

## Blocker Issues

### CR-01: Added-strategy weight edits in a mixed per-key + added book use the wrong renormalization basis — typed weight silently not honored, sum-to-1 broken

**File:** `src/app/(dashboard)/allocations/components/ScenarioComposer.tsx:1098-1102`

**Issue:** `handleWeightChange` only routes through the engine-unit basis when `isPerKeyEdit` is true (`usePerKeySources && !addedIdSet.has(scopeRef)`). An **added-strategy** edit in a mixed book (`usePerKeySources === true`, `addedIdSet.has(scopeRef) === true`) falls to `scenario.setWeightOverride(scopeRef, clampedWeight)` — whose basis is `enabledIdsOf(draft)` (`scenario-state.ts:306-310`, only `toggleByScopeRef[k] === true` refs). Per-key units are **never** `=== true` (included-by-absence; `togglePerKeySource` deletes the ref on re-include), so `enabledIdsOf` **excludes every per-key unit**. This is the exact "wrong tool" the phase's own pin `scenario-state-apply-weights.test.ts` case **(c)** characterizes ("setWeightOverride on a per-key ref … the mixed-set sum ≠ 1"). The fix routed per-key edits around it but left added edits on it.

The comment at `:1088-1090` justifies this with "their `enabledIdsOf` renormalization is correct **while per-key rows ride the raw equity share**." That precondition is false in a mixed book:

**Failure scenario A (per-key rides raw equity — dollar magnitude dominates):**
1. Book = 1 per-key source PK (equity $50,000) + 1 added strategy A. Initial `weightOverrides = {A: 1.0}` (A alone in `enabledIdsOf` → normalized to 1); PK rides raw equity `weights[PK] = 50000`.
2. Allocator types **0.5** into A's weight input → `setWeightOverride(A, 0.5)`: `enabledIds = [A]`, `otherIds = []` → `weightOverrides = {A: 0.5}`, PK untouched.
3. Engine renormalizes `{PK: 50000, A: 0.5}` → A's actual blend share ≈ **0.001%**. The typed 50 % produced ~0 %. The added weight input is effectively **inert** in a mixed book — any value 0…1 is swamped by the raw-equity dollars in the denominator.

**Failure scenario B (per-key already weighted — sum ≠ 1):**
1. Same book; allocator first edits PK's weight (writes `weightOverrides = {PK: 0.5, A: 0.5}` via the correct per-key path).
2. Allocator then edits A to **0.6** → `setWeightOverride(A, 0.6)`: `enabledIds = [A]`, `otherIds = []` → `weightOverrides = {PK: 0.5, A: 0.6}`, **sum = 1.1**. The row displays 0.600 but the engine renormalizes to A = 0.545; PK, which the user never touched, silently drops from 0.5 to 0.455.

Either way the LP-facing weight input reports a number the blend does not honor, violating both the phase invariant and the Numbers-Contract "honest numbers" value. (A related symptom of the same root: the added row's weight input still displays raw `draft.weightOverrides[a.id]` (`:5141,5203`) while per-key rows display the normalized `blendShareByRef` (`:5089-5093`), so in a mixed book the two row types show inconsistent bases even before an edit.)

**Fix:** Widen the basis branch so **every** weight edit in a per-key book routes through the engine-unit basis, not just per-key-ref edits. e.g. gate on `usePerKeySources` alone (build the full sum-1 vector over `basisIds` for the edited `scopeRef` whether it is per-key or added, and `applyWeightOverrides(vector, basisIds, [scopeRef])`); keep the legacy `setWeightOverride` path only for the pure-added / no-per-key case (`!usePerKeySources`), where `enabledIdsOf` is the correct and tested basis. Also switch the added-row weight input `value` to `blendShareByRef[a.id] ?? draft.weightOverrides[a.id] ?? 0` so both row types display the same (normalized) basis. Add a component test: mixed book, edit an added weight → its `projectionState`/blend share equals the typed value and the mixed set sums to 1.

## High Issues

### WR-01: Per-key weight edits are invisible to `diffCount` — the `userExplicitRefs` honesty feature yields zero, not one; unsaved per-key edits are not protected on entry-mode switch

**File:** `src/app/(dashboard)/allocations/hooks/useScenarioState.ts:396-398` (consumer) ↔ `scenario-state.ts:688-697` (producer) ↔ `ScenarioComposer.tsx:1130` (writer)

**Issue:** The new writer stamps `userWeightOverrides[scopeRef]` for the edited per-key ref (`applyWeightOverrides(vector, basisIds, [scopeRef])`), and the comment at `useScenarioState.ts:113-117` states the intent: "the composer's per-key single-row writer passes the ONE edited ref so `diffCount` stamps a single gesture." But `diffCount` iterates `userWeightOverrides` and at line 396 does `if (draft.toggleByScopeRef[k] !== true) continue;`. A per-key ref is **never** `toggleByScopeRef[k] === true` (included-by-absence). Line 397-398 then also `continue`s when `defaultDraft.weightOverrides[k] == null`, which is the case for a per-key ref that rode raw equity. So a per-key weight edit contributes **0** to `diffCount`, not 1 — the feature's stated purpose is not achieved.

**Failure scenario:**
1. Pure per-key book; allocator edits one or more per-key weights (real, savable changes). `diffCount` stays **0**.
2. Allocator clicks the other entry-mode segment (book ↔ blank). `handleEntryModeSelect` (`ScenarioComposer.tsx:1350`) gates the unsaved-changes confirmation on `scenario.diffCount > 0`; because it is 0, it skips the modal and calls `setEntryMode(mode)` directly → the in-progress per-key weight edits are discarded with **no confirmation**. The `diffCount > 0` guard exists precisely to prevent this silent wipe (comment `:1338-1341`), but it cannot see per-key weight edits.
3. Secondary: the "N changes" footer chip under-reports every per-key weight edit.

(Save/Update is **not** diffCount-gated and Commit gates on `committableCount = addedStrategies.length`, so this is not a "cannot save" blocker — the impact is the unprotected mode-switch wipe plus the dishonest change count.)

The wiring is untested: pin `scenario-state-apply-weights.test.ts` case (a) asserts only that `userWeightOverrides` contains `[K1]` at the state layer — it never asserts `diffCount` increments for a per-key edit (the "test the wiring, not just the helper" gap).

**Fix:** In `diffCount`, treat per-key inclusion correctly — an included ref is `toggleByScopeRef[k] !== false` (absent-or-true), not `=== true`; and supply a default weight for per-key refs (their un-edited effective share, or treat "no prior override" as a change when a `userWeightOverrides` entry now exists). Then add a wiring test: a single per-key weight edit → `diffCount === prior + 1`, and a book→blank switch after a per-key-only edit opens the reset confirmation.

## Verified Clean

- **SC-3 freeze:** `git diff 629b89d3..HEAD -- src/lib/scenario.ts` is empty — engine byte-identical. No symbol-keyed path reintroduced (Pitfall 3).
- **Prune fix (Pitfall 1):** `eligiblePerKeyIds` is passed at **both** save sites (`:1795-1801` POST, `:1844-1850` PUT); the default `[]` preserves the original stale-pruning when per-key is inactive; `eligiblePerKeyIds` is derived from `dataSourceKeys` (eligible only). Guarded by `ScenarioComposer.save.test.tsx` (a).
- **Sanitize-on-read (Pitfall 4):** no new zod `.min/.max` refine; hostile 999 → `MAX_LEVERAGE`, -3 → 1, draft still loads. Guarded by save.test (b). No `schema_version` bump.
- **Notional (`notionalText`, `:4968-4986`):** `totalBookEquity == null` (added-only / blank / gate=false / Σ ≤ 0) or non-finite `share` → em-dash; `formatCurrency` itself returns `—` on null/non-finite. No division-by-zero, never a fabricated $0. `blendShareByRef` recomputes on `weightOverrides` change (via `projectionState`) so no stale-memo notional.
- **Per-key weight writer (per-key edit direction):** builds a full sum-1 vector over `basisIds`, `otherSum ≤ 0` equal-split fallback mirrors `setWeightOverride`, NaN/Inf short-circuits in `applyWeightOverrides` (`refs.every(Number.isFinite && ≥ 0)`), round-trips stably (typed w → `blendShareByRef[scopeRef] === w`). Correct.
- **Hooks:** `blendShareByRef` deps `[engineSet.strategies, projectionState]`, `totalBookEquity` deps `[usePerKeySources, dataSourceKeys, equityByApiKeyId]`, `eligiblePerKeyIds` deps `[usePerKeySources, dataSourceKeys]` — all exhaustive. Handlers are plain per-render functions (no stale closure over `leverageByRef`/`blendShareByRef`).
- **Leverage-invariance caveat gate (`anyLevered`):** renders only when a selected row carries non-1× leverage; honest Sharpe/Sortino/Calmar wording per DESIGN.md.

---

_Reviewed: 2026-07-17_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: deep_
