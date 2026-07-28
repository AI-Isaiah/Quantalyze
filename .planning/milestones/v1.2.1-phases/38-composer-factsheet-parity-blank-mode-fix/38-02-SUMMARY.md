---
phase: 38-composer-factsheet-parity-blank-mode-fix
plan: 02
subsystem: ui
tags: [react, context, localStorage, factsheet, persistence, composer, tdd]

# Dependency graph
requires:
  - phase: 38-composer-factsheet-parity-blank-mode-fix (Plan 01)
    provides: buildScenarioFactsheetPayload adapter (scenario → FactsheetPayload)
provides:
  - "FactsheetProvider `persist?: boolean` opt-out (default true) gating BOTH view-state write effects (URL history.replaceState + localStorage setStoredView)"
  - "The seam Plan 03's composer mount uses to render the real TimeSeriesChart/MasterBrush without leaking a factsheet-v2: localStorage blob or rewriting the dashboard URL"
affects: [38-03, composer-factsheet-mount, scenario-tab]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Additive default-preserving opt-out prop (persist=true default ⇒ current behavior byte-identical), mirroring EquityChart's controlledPeriod ?? internalPeriod convention"
    - "In-effect gate (early no-op `|| !persist`) keeps hooks firing unconditionally (Rules of Hooks) while suppressing the side-effecting write"

key-files:
  created: []
  modified:
    - src/app/factsheet/[id]/v2/factsheet-context.tsx
    - src/app/factsheet/[id]/v2/factsheet-context.provider.test.tsx

key-decisions:
  - "Gate ONLY the debounced write effect (URL replaceState + setStoredView both live in its setTimeout body); leave the hydration READ effect untouched — reading an empty composer URL/storage is harmless."
  - "Implement the opt-out as an in-body early return (`|| !persist`) rather than conditionally calling useCrossTabStorage, so the hook always registers (Rules of Hooks) and the default path is byte-identical."
  - "Single atomic commit (test + impl) for the one TDD task — RED confirmed on the persist=false suppression case before implementing the gate."

patterns-established:
  - "Pattern 1: additive default-preserving prop for a 'don't change the factsheet's behavior' opt-out — the factsheet never passes it; only the composer exercises persist=false."
  - "Pattern 2: gate side-effects inside the effect body (not by conditionally calling the hook) to honor Rules of Hooks while suppressing the write."

requirements-completed: [PARITY-01]

# Metrics
duration: 14min
completed: 2026-06-25
---

# Phase 38 Plan 02: FactsheetProvider persist opt-out Summary

**Additive `persist?: boolean` (default true) on FactsheetProvider that gates BOTH view-state write halves — when `persist={false}` a mount writes neither the `?range=` URL nor the `factsheet-v2:` localStorage blob, while the omitted/true default path stays byte-identical.**

## Performance

- **Duration:** ~14 min
- **Started:** 2026-06-25T12:39:00Z
- **Completed:** 2026-06-25T12:43:00Z
- **Tasks:** 1 (TDD)
- **Files modified:** 2

## Accomplishments
- Added an additive, backward-compatible `persist?: boolean` prop (default `true`) to `FactsheetProvider`. With `persist` omitted or true, the factsheet's URL + localStorage round-trip is byte-identical to before.
- `persist={false}` gates BOTH write halves via a single `|| !persist` term in the debounced write effect's early-return guard: the `window.history.replaceState(...)` URL write AND the `setStoredView(state)` localStorage write are both skipped. This is the seam Plan 03's composer mount needs so a scenario pan on the dashboard tab never rewrites the allocator's URL nor introduces a `factsheet-v2:` localStorage write surface.
- Hydration (the READ effect) left untouched — gating only the write effect; the hook still fires unconditionally (Rules of Hooks); `persist` added to the write effect's dependency array.
- New provider tests pin BOTH directions plus the empty-mount case: default persists URL + localStorage after a pan; `persist={false}` writes neither (asserted via a `history.replaceState` spy + `location.search` + the localStorage blob); `persist={false}` hydrates over an empty URL/storage without throwing and renders the payload default.

## Task Commits

Each task was committed atomically:

1. **Task 1: Add additive persist opt-out to FactsheetProvider (TDD)** — `68bf5e0c` (feat)
   - RED confirmed first: the `persist={false}` suppression case failed (`?range=10-120&cmp=spx` written) because the un-gated write effect still fired; the default-persists and empty-hydration cases were already green.
   - GREEN: implemented the prop + `|| !persist` gate + deps entry; all 6 provider tests pass.

_Single commit (test + impl together) for the one TDD task in this plan._

## Files Created/Modified
- `src/app/factsheet/[id]/v2/factsheet-context.tsx` — Added `persist = true` to the `FactsheetProvider` destructure + prop type (with JSDoc); added `|| !persist` to the debounced write effect's early-return guard; added `persist` to that effect's dependency array. No other lines changed — the default path is byte-identical.
- `src/app/factsheet/[id]/v2/factsheet-context.provider.test.tsx` — Imported `useXRange`; added a `PersistHarness` (exposes `setXRange` to drive a pan); added a `describe("FactsheetProvider — persist opt-out (38-02)")` block with three cases (default persists both halves; `persist={false}` suppresses both; `persist={false}` hydrates empty without throw).

## Decisions Made
- **Gate only the write effect, not hydration.** The URL `replaceState` and `setStoredView` writes both live in one debounced effect; gating that single effect with `|| !persist` suppresses both halves. The hydration read effect reads an empty composer URL/storage harmlessly, so it stays intact (matches the plan's interface notes).
- **In-body early-return gate, not a conditional hook.** `useCrossTabStorage` is still called unconditionally (Rules of Hooks); the opt-out is a no-op inside the write effect. This keeps the default path byte-identical (verified by the diff being confined to the prop + the one guard term + the deps entry).
- **Single atomic commit for the TDD task.** RED was confirmed (the suppression direction failed) before the gate was implemented; test + implementation committed together as one `feat(38-02)` commit.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None. RED → GREEN proceeded cleanly: the failing direction was the `persist={false}` suppression case as expected; the default-persists direction was already green pre-implementation (proving the new test exercises the existing behavior correctly), and went green on both directions after the surgical gate.

## Verification

- `npx vitest run "src/app/factsheet/[id]/v2/factsheet-context.provider.test.tsx"` — 6/6 passed (both directions + empty-hydration).
- `npx vitest run "src/app/factsheet/"` — 43/43 passed (no factsheet regression; default path byte-identical).
- `npx tsc --noEmit` — exit 0 (clean).
- `git diff src/app/factsheet/[id]/v2/factsheet-context.tsx` functional lines = ONLY: `persist = true` destructure, `persist?: boolean` type, `|| !persist` gate, `persist` added to the write-effect deps. No default-path behavior change.
- `grep -n "persist" …/factsheet-context.tsx` confirms the prop default `true` (line 177) and the gate (line 311).

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Plan 03 can now mount the real `TimeSeriesChart` + `MasterBrush` inside a `<FactsheetProvider payload={synthPayload} persist={false}>` for the composer, guaranteed not to rewrite the dashboard URL or write a `factsheet-v2:` localStorage blob — the no-clean-analog persistence-suppression risk flagged by 38-PATTERNS.md is resolved with a minimal additive prop the factsheet never exercises.
- No blockers. The factsheet remains the source of truth, changed additively only; its tests stay green.

## Self-Check: PASSED

- FOUND: `.planning/phases/38-composer-factsheet-parity-blank-mode-fix/38-02-SUMMARY.md`
- FOUND: `src/app/factsheet/[id]/v2/factsheet-context.tsx`
- FOUND: `src/app/factsheet/[id]/v2/factsheet-context.provider.test.tsx`
- FOUND commit: `68bf5e0c`

---
*Phase: 38-composer-factsheet-parity-blank-mode-fix*
*Completed: 2026-06-25*
