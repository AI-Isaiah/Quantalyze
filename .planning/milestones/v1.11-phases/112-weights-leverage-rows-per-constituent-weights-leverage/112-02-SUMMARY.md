---
phase: 112-weights-leverage-rows-per-constituent-weights-leverage
plan: 02
subsystem: allocations-scenario-composer
tags: [weights, leverage, per-key, notional, scenario-composer, react, save-prune, WEIGHTS-02]

# Dependency graph
requires:
  - phase: 112-00
    provides: Wave-0 RED scaffold (composer (a-leverage)/(c); save (a) per-key leverage prune-drop)
  - phase: 112-01
    provides: per-key weight input + blendShareByRef + engine-unit-basis writer
  - phase: 90.5-LEV-02
    provides: leverageByRef, handleLeverageChange, sanitizeLeverageMap, pruneLeverageToDraftRefs, MAX_LEVERAGE
provides:
  - "per-key (strategy-level) leverage input on the unified constituent rows (id leverage-<api_key_id>) — reuses leverageByRef + handleLeverageChange verbatim"
  - "pruneLeverageToDraftRefs 3rd param eligiblePerKeyIds — keeps an INCLUDED per-key leverage-only edit across Save (Pitfall 1 closed)"
  - "eligiblePerKeyIds + totalBookEquity memos threaded into CompositionList"
  - "derived read-only Notional column (equity × share × leverage) on both row types — em-dash on non-derivable, never $0"
  - "honest leverage-invariance caveat (Sharpe/Sortino/Calmar + correlation do not shift with leverage)"
affects: [112-03, 112-VALIDATION]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Per-key leverage input mirrors the added-row input byte-for-byte; one leverage overlay (leverageByRef), one save-fold — no new map/handler/zod refine"
    - "Save-prune keep-set extended with an eligibility signal (per-key sources carry leverage with no weight/toggle entry)"
    - "Notional is derived read-only TEXT keyed by blendShareByRef × totalBookEquity × leverage; any null factor → em-dash `—` (Numbers Contract), never a fabricated value"
    - "Honesty caveat gated on any-included-row-levered, mirroring the Diversification subtitle precedent"

key-files:
  created: []
  modified:
    - "src/app/(dashboard)/allocations/components/ScenarioComposer.tsx"
    - "src/app/(dashboard)/allocations/components/ScenarioComposer.test.tsx"

key-decisions:
  - "eligiblePerKeyIds folds `usePerKeySources ? dataSourceKeys ids : []` into the prune keep-set at BOTH Save call sites. Empty when the per-key path is inactive, so today's stale-pruning is byte-unchanged; a 3rd optional param keeps pruneLeverageToDraftRefs back-compatible."
  - "totalBookEquity = Σ equityByApiKeyId over dataSourceKeys ids in the book path (canonical D2 equity, never re-derived from value_usd), else null. A degenerate Σ≤0 is null too — honest non-derivable, not a real book. Null → every notional cell is an em-dash."
  - "Notional rendered as a <span> (text), NOT an <input> — locked decision 1 made structural (test asserts tagName !== INPUT and no nested input). Purely informative clears-minimum-invest readout."
  - "Caveat renders only when a selected row is levered (L≠1) so the surface never implies leverage improves Sharpe — the DESIGN.md honesty point."

patterns-established:
  - "A per-key source's eligibility (not a weight/toggle entry) is the keep signal for its leverage at Save."

requirements-completed: [WEIGHTS-02]

# Metrics
duration: 11min
completed: 2026-07-17
---

# Phase 112 Plan 02: Per-key leverage input + Pitfall-1 prune fix + derived notional Summary

**Per-key (strategy-level) constituent rows are now leverage-editable end-to-end (input → handleLeverageChange → leverageByRef → projectionState → frozen-engine wᵢ·Lᵢ·rᵢ re-derivation). A leverage-only per-key edit survives Save → reopen (Pitfall 1 closed by extending pruneLeverageToDraftRefs with the eligible per-key ids). Each row now shows a DERIVED read-only Notional (equity × share × leverage) as text — never a weight input, em-dash on non-derivable — plus the honest Sharpe/Sortino/Calmar leverage-invariance caveat. scenario.ts stays byte-frozen (SC-3).**

## Performance
- **Duration:** ~11 min
- **Tasks:** 3
- **Files modified:** 2 (1 production, 1 test)

## Wave-0 Tests Flipped GREEN
- **composer (a-leverage)** — `ScenarioComposer.test.tsx` — each per-key row renders a leverage input bounded [0, MAX_LEVERAGE], disabled when excluded.
- **composer (c)** — setting K1 leverage to 2× moves the projection volatility vs the 1× baseline (blend re-derives via the frozen engine's wᵢ·Lᵢ·rᵢ).
- **save (a)** — a leverage-only edit on an INCLUDED per-key ref survives Save (PUT body `leverageOverrides[api_key_id] === 2`).

## New Tests (Task 3, written RED-first)
- **(e)** — the per-key notional cell renders `formatCurrency(0.3 × 100000 × 2)` for a levered K1 and `formatCurrency(0.7 × 100000 × 1)` for the unlevered K2; structural lock: the cell is TEXT, not an `<input>` (tagName ≠ INPUT, no nested input).
- **(f)** — added-only mode (no book equity) renders every notional cell as `—`, never `$0`.
- **(g)** — the `scenario-leverage-invariance-note` caveat renders exactly when a selected row is levered; absent at all-1×.

## Task Commits
1. **Task 1: per-key leverage input** — `d38562e0` (feat)
2. **Task 2: pruneLeverageToDraftRefs eligiblePerKeyIds (Pitfall 1)** — `a99a6d75` (feat)
3. **Task 3: derived read-only notional column + invariance caveat** — `4da7f3a0` (feat)

_No plan-metadata commit for `.planning/` — it is a gitignored local ledger and is never staged on this project._

## What Changed (per file)
- `ScenarioComposer.tsx` —
  (1) Per-key row renders a leverage number input (id `leverage-<api_key_id>`, step 0.1, [0, MAX_LEVERAGE]) mirroring the added-row input; reuses `leverageByRef` + `handleLeverageChange` verbatim. Fence comment rewritten to the final WEIGHTS-00 column anatomy.
  (2) `pruneLeverageToDraftRefs` gains an optional 3rd `eligiblePerKeyIds: ReadonlyArray<string> = []`, folded into the keep-set; new `eligiblePerKeyIds` memo passed at both PUT and POST call sites.
  (3) New `totalBookEquity` memo; threaded into `CompositionList`; a `notionalText` helper (em-dash on any null/non-finite factor) renders a read-only `<span data-testid="scenario-constituent-notional">` on both row types; an `anyLevered`-gated `<p data-testid="scenario-leverage-invariance-note">` caveat after the `<ul>`. Added `formatCurrency` import from `@/lib/utils`.
- `ScenarioComposer.test.tsx` — added `formatCurrency` import; three new behavior tests (e)/(f)/(g) in the Phase-112 describe block.

## Deviations from Plan

None — plan executed exactly as written. No packages installed; no zod refine added on leverage/weight; no `SCENARIO_SCHEMA_VERSION` bump; no symbol-keyed path; scenario.ts byte-frozen throughout.

## Threat Model Compliance
- **T-112-01/02 (leverage tampering):** handled — leverage still flows through the existing `handleLeverageChange` clamp + `sanitizeLeverageMap` on read; no new handler and no zod refine were added. Save (b) sanitize pin stays green.
- **T-112-04 (notional info integrity):** honored — notional is derived, read-only, and em-dashes on any non-derivable factor (no fabricated dollar figure).

## Known Stubs
None — the per-key leverage input is fully wired (input → handleLeverageChange → leverageByRef → projectionState → frozen engine). The notional column is fully derived from live state; the em-dash is the honest non-derivable state, not a stub.

## Verification
- **Composer suite:** `npx vitest run ScenarioComposer.test.tsx --no-file-parallelism` → 183 passed (was 180 + 3 new).
- **Save suite:** `ScenarioComposer.save.test.tsx` → 29 passed (Wave-0 save (a) green; sanitize pin (b) green).
- **Wave-merge sample:** `npx vitest run "src/app/(dashboard)/allocations" src/lib/scenario.test.ts src/lib/scenario-backbone-gates.test.ts src/lib/leverage.test.ts --no-file-parallelism` → 120 files / 1610 tests passed. Zero remaining reds across Phase-112.
- **Engine frozen:** `git diff --exit-code src/lib/scenario.ts` clean after every task; `git diff --exit-code origin/main -- src/lib/scenario.ts` clean; backbone gates green (no symbol-keyed identifier).
- **tsc --noEmit:** exit 0 (whole repo).
- **eslint** on both touched files: exit 0.
- **Diff grep:** no `.min(`/`.max(` zod refine, no `SCENARIO_SCHEMA_VERSION`, no `symbol` in the production diff.

## Self-Check: PASSED
- **Files:** both modified files present on disk.
- **Commits:** `d38562e0`, `a99a6d75`, `4da7f3a0` all found in git log.
- **Verification:** all Phase-112 tests green (zero remaining reds); scenario.ts byte-frozen vs origin/main; tsc + lint 0 errors.

---
*Phase: 112-weights-leverage-rows-per-constituent-weights-leverage*
*Completed: 2026-07-17*
