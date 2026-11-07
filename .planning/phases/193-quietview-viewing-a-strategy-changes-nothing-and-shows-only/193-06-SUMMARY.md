---
phase: 193-quietview-viewing-a-strategy-changes-nothing-and-shows-only
plan: 06
subsystem: ui
tags: [factsheet, trust-03, d-05, deletion, census, display-sign]
status: complete

requires: ["193-04"]
provides:
  - "BatchDPanels.tsx holds only StyleDriftPanel, PeerPercentilePanel, OwnBookDeltaPanel and their helpers; no demo allocator code is left in the factsheet module to re-mount"
  - "display-sign census R6 pin for BatchDPanels.tsx is 2 (Kolmogorov-Smirnov D and p-value only)"
  - "TODOS.md entry [193-DEMO-PAYLOAD-PRODUCERS] books the payload producers and the no-op hideAllocatorSection prop for removal"
affects: [193-07, the next phase that edits build-payload.ts or the factsheet cache key]

actuals:
  tokens: 6750
  tasks: 2
  commits: 2
plan_head_before: 5cc06b18be143ad6829017679a08ad99c6833e1c
plan_head_after: 1fca34e58a89ab7b04d70ec2404183e81cd21ab6

tech-stack:
  added: []
  patterns: ["a census pin moves in the same commit as the removal that changes the count; proven by neutering the pin and watching the census go RED"]

key-files:
  created: []
  modified:
    - "src/app/factsheet/[id]/v2/BatchDPanels.tsx"
    - "src/app/factsheet/[id]/v2/BaseLeverageNote.wiring.test.tsx"
    - "src/app/factsheet/[id]/v2/panels.signed-zero.test.tsx"
    - "src/__tests__/display-sign-single-source.test.ts"
    - "TODOS.md"
  deleted:
    - "src/app/factsheet/[id]/v2/BatchDPanels.null-honest.test.tsx"

key-decisions:
  - "Payload producers, payload types and the cached payload key were NOT touched (RESEARCH Open Question 3); the removal is booked, not done"
  - "The BatchDPanels.tsx header comment was rewritten to describe the three remaining panels (it still described the deleted component and the demo badge)"

requirements-completed: [TRUST-03]

duration: 14min
completed: 2026-11-07
---

# Phase 193 Plan 06: Delete the demo allocator code Summary

The demo allocator component and everything only it used are gone from `BatchDPanels.tsx`, its tests went with it, the display-sign census moved from 3 to 2 and still bites, and the invented payload fields are booked for removal by name.

## What was built

- `BatchDPanels.tsx`: deleted `AllocatorSection`, `tailCaption`, `DemoBadge`, `KvRow`, `KvSep`, `pctRound` (with its comment block) and the imports that became unused (`useState`, `isoToMonthDay`, `drawdownTone`, the whole `./format` import). eslint reported exactly those and nothing else; `formatFixedSigned`, `signTone`, `usePayload`, `BaseLeverageNote` stay in use. `StyleDriftPanel`, `PeerPercentilePanel`, `OwnBookDeltaPanel` are untouched.
- `BatchDPanels.null-honest.test.tsx` removed with `git rm` (every case rendered only the deleted component).
- `BaseLeverageNote.wiring.test.tsx`: allocator `cases` entry and import removed; header now says the file pins Signatures and Cross-signatures and that the allocator section was removed in QUIETVIEW (D-05). A stale `allocatorPortfolios` mention in the fixture sentence also left.
- `panels.signed-zero.test.tsx`: the allocator banner, `allocatorValue` helper and its `describe` block removed, plus the import. `apiPayload`, `mount`, `rowCells`, `styleOf`, `hasTone`, `NEGATIVE` are still used by the other blocks.
- `display-sign-single-source.test.ts`: `BatchDPanels.tsx` R6 `count` 3 to 2, reason `The Kolmogorov-Smirnov D and p-value (both in [0, 1]).`
- `TODOS.md`: section `## Phase 193 (QUIETVIEW) — routed items (logged 2026-11-06)` with `[193-DEMO-PAYLOAD-PRODUCERS]` (Reading and Owner / Trigger). The `hideAllocatorSection` doc added by plan 193-04 already names this id.

## Task commits

1. Task 1 (tracer, deletion): `d21059c67` refactor(193-06): delete the demo allocator component and its tests (QUIETVIEW D-05)
2. Task 2 (ledger): `1fca34e58` docs(193-06): book the demo payload producers for removal as [193-DEMO-PAYLOAD-PRODUCERS]

## Verification (real counts)

- `npx tsc --noEmit`: exit 0.
- eslint on the three touched source/test files: clean. `npm run lint`: 0 errors, 2 warnings (both in files this plan did not touch, see Deferred Issues); the route, hygiene and domain scripts all OK.
- Tracer run, 6 files: 6 passed, 79 tests passed, 0 failed, 0 skipped. It includes the D-07 guard `FactsheetBody.no-demo-content.test.tsx`, which still passes after the deletion, so nothing deleted here was what kept a forbidden string out of the DOM.
- Whole `src/app/factsheet/[id]/v2` directory: 101 files passed, 1325 tests passed, 0 failed, 0 skipped.
- Census proven able to fail: with the pin set back to 3 the census went RED naming the file (`R6: 2 found, pinned 3 (an instance is gone: move the pin and re-read the sites)`, 1 failed, 25 passed); restored from a byte backup at `<session scratchpad>/193/census.good`, `cmp` clean, 26 of 26 green again.
- Census sweep for other pins a removal could move: a `grep -a` for the deleted symbols across `src`, `scripts`, `supabase/tests`, `docs`, `e2e`, `.github`, `vitest.config.ts` found no other test or census referencing them. Remaining mentions are in older code comments and `STREAMING.md` (see Deferred Issues) and the `hideAllocatorSection` prop, which is meant to stay.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking/tidy] Header comment of `BatchDPanels.tsx` described the deleted component**
- **Found during:** Task 1
- **Issue:** The file header listed the allocator section and the "Demo portfolios" badge as a "visual contract".
- **Fix:** Rewrote it to list the three remaining panels and note the QUIETVIEW removal. It is my own mess from the deletion, not adjacent cleanup.
- **Files modified:** `src/app/factsheet/[id]/v2/BatchDPanels.tsx`
- **Commit:** `d21059c67`

The plan listed `BatchDPanels.null-honest.test.tsx` under both `files_modified` and `files_deleted`; it was deleted, as the action says.

## Deferred Issues (out of scope, not fixed)

- `npm run lint` warnings: `nativeUnitReason` unused in `MetricsColumn.tsx` and `isRankableAnalyticsRow` unused in `src/lib/factsheet/composite-read-path.ts`. Neither file was touched by this plan.
- Stale prose naming the deleted component in older comments: `STREAMING.md`, `FactsheetBody.degenerate.test.tsx`, `page.tsx`, `AllocationDashboardV2.tsx`, `composite-read-path.ts`, `build-payload.ts`, `allocator-portfolio-payload.ts`. These are adjacent files, left for the phase that removes the producers (`[193-DEMO-PAYLOAD-PRODUCERS]`).

## Known Stubs

None.

## Threat Flags

None. The plan introduces no new surface; T-193-14 is mitigated (code deleted, D-07 guard still passing) and T-193-15 is transferred to the booked TODOS entry.

## Self-Check: PASSED

- `src/app/factsheet/[id]/v2/BatchDPanels.tsx` found; no `AllocatorSection` or `DemoBadge` in it; `BatchDPanels.null-honest.test.tsx` absent from disk.
- `TODOS.md` contains the section heading and `[193-DEMO-PAYLOAD-PRODUCERS]` with Reading and Owner / Trigger.
- Commits `d21059c67` and `1fca34e58` are ancestors of HEAD; `git rev-list --count` from `plan_head_before` is 2.
