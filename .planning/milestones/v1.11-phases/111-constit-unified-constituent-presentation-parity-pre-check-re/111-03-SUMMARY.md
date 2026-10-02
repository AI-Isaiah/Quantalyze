---
phase: 111-constit-unified-constituent-presentation-parity-pre-check-re
plan: 03
subsystem: ui
tags: [scenario-composer, constituent-list, provenance-badge, toggle-channel, react, presentation-reshape]

# Dependency graph
requires:
  - phase: 111-01
    provides: CONSTIT-05 parity gate (VERIFIED, interpretation A) — clears the CONSTIT UI to proceed
  - phase: 111-02
    provides: deriveProvenance helper + ProvenanceTier/composite token + addedStrategyMetadataLookup trust_tier/is_composite threading
provides:
  - "Unified CompositionList: per-key exchange sources + added strategies as ONE uniform badged constituent row list"
  - "Per-row provenance badge render (api_verified per-key by construction; csv/composite/self_reported/null for added)"
  - "togglePerKeySource — one include/exclude channel on draft.toggleByScopeRef (weightless refs, never rescales weightOverrides)"
affects: [CONSTIT-01, CONSTIT-02, CONSTIT-03, CONSTIT-04, scenario-composer, scenario-compare]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Per-key include/exclude persists in draft.toggleByScopeRef (supersedes Phase-66 CF-05 transient) — composer↔compare now agree"
    - "Weightless-ref toggle: exclude writes false, re-include DELETES the ref (keeps per-key refs out of enabledIdsOf so added-weight rescale is never perturbed)"
    - "Provenance rides a presentation-only addedProvenanceByRef map (deriveProvenance) — never a StrategyForBuilder/engine field (Pitfall 3)"

key-files:
  created: []
  modified:
    - "src/app/(dashboard)/allocations/lib/scenario-state.ts"
    - "src/app/(dashboard)/allocations/lib/scenario-state.test.ts"
    - "src/app/(dashboard)/allocations/hooks/useScenarioState.ts"
    - "src/app/(dashboard)/allocations/components/ScenarioComposer.tsx"
    - "src/app/(dashboard)/allocations/components/ScenarioComposer.test.tsx"

key-decisions:
  - "CONSTIT-03 supersedes CF-05: per-key exclusions PERSIST with the draft and count toward diffCount like every other toggle (the founder-locked 'one mechanism'). The commit path's existing F-01 fail-loud guard covers the exclusion-only commit case."
  - "togglePerKeySource is a NEW narrowly-scoped pure mutator (weightless refs) INSIDE scenario-state, NOT a second composer useState — one channel = the CONSTIT-03 requirement. It never touches weightOverrides."
  - "Per-key toggle unified onto the SAME projectionState.selected derivation the compare surface uses byte-for-byte — closes a latent composer↔compare per-key-exclusion divergence."
  - "Per-coin holdings rows REMOVED from the composer list (CONSTIT-03 — per-coin detail lives on the Holdings tab); the Bridge/Compare flow survives via the Bridge inline card + BridgeDrawer, so the per-row Compare→ deletion is not a feature loss."
  - "scenario.ts byte-frozen throughout (SC-3 keep-gate + scenario.test.ts pins green; git diff --exit-code clean)."

requirements-completed: [CONSTIT-01, CONSTIT-02, CONSTIT-03]

# Metrics
duration: 95min
completed: 2026-07-16
---

# Phase 111 Plan 03: CONSTIT-01/02/03 — the composer reshape (unified constituent list) Summary

**Deleted the separate "Data sources" section and reshaped ScenarioComposer so every source (per-key exchange api-key + added strategy) renders as ONE uniform badged constituent row in a single CompositionList, with per-key include/exclude unified onto the draft's `toggleByScopeRef` channel (superseding the CF-05 transient decision) and a per-row provenance badge from 111-02's `deriveProvenance` — the frozen engine byte-untouched, blend numbers unchanged for identical selections.**

## Performance
- **Duration:** ~95 min
- **Completed:** 2026-07-16
- **Tasks:** 3 (Task 1/2 TDD; Task 3 test-only)
- **Files modified:** 5

## Accomplishments
- **CONSTIT-03 (Task 1):** Added `togglePerKeySource` — a pure mutator that routes per-key include/exclude through the ONE `draft.toggleByScopeRef` channel without ever rescaling `weightOverrides` (per-key legs ride the raw equity-share path; the engine renormalizes). Exclude writes an explicit `false`; re-include DELETES the ref (absent === included) so per-key refs never enter `enabledIdsOf` and can't perturb the added-strategy weight math. Exposed via `useScenarioState`. Deleted `includeByApiKeyId` useState + `handleDataSourceToggle` + 3 resets (repo-wide grep = 0). Unified `projectionState.selected` onto `toggleByScopeRef` for ALL units — byte-identical to `scenario-compare.ts`, closing a latent composer↔compare per-key-exclusion divergence.
- **CONSTIT-01/02 (Task 2):** Deleted the "Data sources" Card/group render block; per-key sources now render as uniform constituent rows INSIDE CompositionList (same toggle switch, label, coverage chip as added rows), interleaved above the added strategies. Every row carries a `TrustTierLabel` provenance badge (per-key = `api_verified` by construction; added rows via `addedProvenanceByRef` = `deriveProvenance(trust_tier, is_composite)`; null → no badge). Removed the per-coin holdings rows (CONSTIT-03 — Holdings-tab concern) and the now-dead `formatUsd0`/`sharedSymbols`/`router`/`FlaggedHolding`-type. Re-homed the two honest states (per-key-history fallback + all-excluded empty card), renamed `scenario-data-sources-*` → `scenario-constituent-*`.
- **CONSTIT-04 (Task 3):** Three named intent groups — "unified constituent list" (single list, no Data-Sources section), "provenance badge" (api_verified per-key + csv/composite/null-absence added variants), "shared toggle" (one switch mechanism; per-key toggle leaves added weights byte-identical). Whole-repo grep sweep: zero `scenario-data-sources` / `data-data-source-id` tokens remain anywhere (src/ e2e/ tests/ scripts/).

## Task Commits
1. **Task 1: unify per-key toggle onto draft.toggleByScopeRef (CONSTIT-03)** — `311e9103` (feat, TDD)
2. **Task 2: delete Data-Sources section; unified badged constituent list (CONSTIT-01/02)** — `62d88524` (feat, TDD)
3. **Task 3: named CONSTIT-01/02/03 groups + whole-repo Data-Sources sweep** — `4cc6d3bf` (test)

## Whole-repo grep sweep disposition (CONSTIT-04)
- `scenario-data-sources` (testid): **0** hits in src/ e2e/ tests/ scripts/ — all renamed to `scenario-constituent-*`.
- `data-data-source-id` (per-key row selector): **0** hits — per-key rows now expose `data-scope-ref` + `data-testid="scenario-constituent-perkey"`.
- `includeByApiKeyId`: **0** hits repo-wide.
- Surviving `"Data sources"` string hits are all **deliberate**: (a) three `queryByRole("group", { name: "Data sources" })` **absence-assertions** that positively prove the deleted section is gone, and (b) CONSTIT documentation comments recording the deletion/supersession. Stale comments that described the old control as live were refreshed. No orphaned live token remains.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Removed dead symbols after deleting per-coin holdings rows**
- **Found during:** Task 2
- **Issue:** Removing the per-coin holdings rows from CompositionList left `formatUsd0`, the `sharedSymbols` memo, `const router = useRouter()` (+ the `useRouter` import), and the `FlaggedHolding` type import unused — eslint `no-unused-vars` errors that would fail the lint gate.
- **Fix:** Deleted each unused symbol/import (they were exclusively consumed by the removed per-coin rows; the Bridge/Compare flow it fed survives via the Bridge inline card + BridgeDrawer).
- **Verification:** `npx tsc --noEmit` + `npm run lint` clean (0 errors).
- **Committed in:** `62d88524`

### Intended behavior change (founder-locked supersession, not a deviation)

**CF-05 → CONSTIT-03: per-key exclusions now persist + count toward diffCount.** The plan's Rule-7 surface-and-supersede note directs this. Consequences, all intended and documented:
- A per-key exclusion writes `toggleByScopeRef[key]=false`, so it persists with the draft (autosave + saved scenarios) and is honored on the compare surface (which already read `toggleByScopeRef`) — this **fixes** a latent composer↔compare divergence the ephemeral map left open.
- Because it lands in `toggleByScopeRef`, an exclusion counts toward `diffCount` exactly like an added-strategy toggle. The composer's existing **F-01 commit guard** ("Nothing to commit — add a strategy…") already fail-loud handles the exclusion-only Commit case, so no commit-path change was needed.
- Two pre-existing tests encoded the OLD transient intent and were rewritten to the new intent (Rule 9): the Pitfall-5 diffCount test (now asserts a per-key exclusion IS a draft change and re-inclusion returns to the zero-diff baseline) and the WR-02 comment (the no-cross-scenario-leak invariant now holds via draft replacement in `hydrateFromSaved`, not an ephemeral-map reset).

### Test removals (deliberate behavior removal, documented)
- **T_C16** (per-coin-row inline "Compare →") and **T_C_M5_multi_venue_tooltip** (per-coin "Returns merged with" caveat) tested affordances on the removed per-coin holding rows. Both were removed with a comment recording why; the Bridge/Compare flow is covered by T_C8 / the Bridge suite, and the merged-returns behavior is engine-level (unaffected). The "read-only holding row renders '—'" test (`formatUsd0` branch) was removed with the function.

**Total deviations:** 1 auto-fixed (Rule 3 dead-code cleanup). The rest are founder-locked intended changes.
**Impact on plan:** None on scope — the frozen engine held throughout; blend numbers are unchanged for identical selections (the reshape is presentation + one toggle-channel unification only).

## Frozen-engine freeze (CONSTIT-04 / T-111-05)
- `git diff --exit-code src/lib/scenario.ts` clean after every task.
- SC-3 keep-gate (`scenario-backbone-gates.test.ts`) + behavior pins (`scenario.test.ts`) green (55 tests).
- No task required an engine or `StrategyForBuilder` edit; provenance + per-key toggle ride the composer/adapter layer only.

## Testing
- `ScenarioComposer.test.tsx`: 174 passed (rewrote ~15 `scenario-data-sources*` assertions to the unified-list model; added 4 named-group tests).
- `scenario-state.test.ts`: 82 passed (5 new `togglePerKeySource` tests — exclude/re-include semantics + weight-preservation + enabledIdsOf non-inflation).
- Broader regression: **1566 tests across 122 files** in the allocations directory + frozen-spine guards (phase-31/32/63, tap-targets, widget-state) all green — no other consumer of the composer DOM broke.
- `npx tsc --noEmit` + `npm run lint` clean (0 errors; 1 pre-existing unrelated EquityChart `exhaustive-deps` warning, out of scope — same one 111-02 noted).

## Known Stubs
None — the reshape wires real data end-to-end (per-key sources from the SSR payload, added-row provenance from the 111-02 metadata lookup). No placeholder/empty-value stubs introduced.

## User Setup Required
None — presentation + client-state reshape; no external service configuration.

## Next Phase Readiness
- The unified badged constituent list is the surface Phase 112/113 (WEIGHTS/leverage editing) extends: per-key rows deliberately render NO weight/leverage inputs yet (Phase 112 fence), and the shared `toggleByScopeRef` channel + `addedProvenanceByRef` seam are in place.
- CONSTIT-04 grep gate is green (0 orphaned Data-Sources tokens); the frozen engine is byte-untouched.

## Self-Check: PASSED
- Task commits verified in git log: `311e9103`, `62d88524`, `4cc6d3bf`.
- `scenario.ts` byte-frozen (`git diff --exit-code` clean).
- CONSTIT-04 grep gate: `scenario-data-sources` = 0 repo-wide.

---
*Phase: 111-constit-unified-constituent-presentation-parity-pre-check-re*
*Completed: 2026-07-16*
