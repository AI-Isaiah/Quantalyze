---
phase: 170-pagecopy
plan: 08
subsystem: ui
tags: [tabs, profile, layout, scroll, radix]

requires:
  - phase: 170-03
    provides: computeTabStripScroll, horizontal-only active-tab math
provides:
  - a scrollable underline TabsList with an inset hairline
  - wrapping profile key rows whose actions sit on their own line below sm
affects: [170-09, profile, admin, layout-narrow SC2-PROFILE]

actuals:
  tokens: 5318
  tasks: 2
  commits: 4

plan_head_before: f63e668388f2a756c6d8ebef17b5b14e98b32172
plan_head_after: df831285bc3d3f0dce236df1cd2cf2451e4d2f4f

tech-stack:
  added: []
  patterns:
    - "Underline TabsList scrolls on its own axis and draws the hairline as an inset shadow"
    - "The active underline tab is scrolled through computeTabStripScroll, never the element scroll-into-view API"
    - "Key-row actions share flex flex-wrap gap-2 basis-full sm:basis-auto sm:ml-auto"

key-files:
  created: []
  modified:
    - src/components/ui/Tabs.tsx
    - src/components/ui/Tabs.test.tsx
    - src/components/exchanges/AllocatorExchangeManager.tsx
    - src/components/exchanges/AllocatorExchangeManager.test.tsx

key-decisions:
  - "The inset focus ring is on the underline trigger only. The segmented arm keeps the HEAD class strings."
  - "Active-tab scroll reads offsetLeft, offsetWidth, scrollLeft and clientWidth, then calls scrollTo with left and behavior only."
  - "A disconnected key row has Reconnect, not Disconnect. That row's action group wraps the buttons it actually renders."

patterns-established:
  - "Underline TabsList: flex gap-1 overflow-x-auto [scrollbar-width:none] shadow-[inset_0_-1px_0_var(--color-border)]"
  - "Underline TabsTrigger: shrink-0 whitespace-nowrap, no -mb-px, focus-visible:ring-inset"
  - "Profile key rows: flex flex-wrap items-center gap-4, actions in one wrapping group"

requirements-completed: ["SC2-PROFILE", "SC2-NOSCROLL"]

coverage:
  - id: D1
    description: "The underline TabsList scrolls inside itself with an inset hairline. Underline triggers are shrink-0, nowrap, and use an inset focus ring. Selecting the last of six stubbed tabs calls scrollTo with a horizontal left only, skips the call when the tab is already in view, and uses behavior auto under prefers-reduced-motion. The segmented list and trigger class strings stay the HEAD strings, and a segmented list does not scroll."
    requirement: SC2-PROFILE
    verification:
      - kind: unit
        ref: "src/components/ui/Tabs.test.tsx#scrolls inside itself with an inset hairline and no border-b"
        status: pass
      - kind: unit
        ref: "src/components/ui/Tabs.test.tsx#gives underline triggers shrink-0, nowrap and an inset ring, and drops -mb-px"
        status: pass
      - kind: unit
        ref: "src/components/ui/Tabs.test.tsx#keeps the segmented list and trigger class strings byte-identical"
        status: pass
      - kind: unit
        ref: "src/components/ui/Tabs.test.tsx#scrolls the last of six underline tabs horizontally only, and not when it is already in view"
        status: pass
      - kind: unit
        ref: "src/components/ui/Tabs.test.tsx#uses an instant horizontal scroll when prefers-reduced-motion is set"
        status: pass
      - kind: unit
        ref: "src/components/ui/Tabs.test.tsx#does not scroll a segmented list"
        status: pass
    human_judgment: false
  - id: D2
    description: "Active and disconnected profile key rows use flex-wrap. Disconnect, Sync now and Update password share one action group, and a disconnected row's Reconnect uses the same group classes. Buttons stay size md. Whether Disconnect is inside the viewport and not covered at V390/V640 is the seeded layout row, not this unit test."
    requirement: SC2-PROFILE
    verification:
      - kind: unit
        ref: "src/components/exchanges/AllocatorExchangeManager.test.tsx#wraps active and disconnected rows, and groups Disconnect with Sync now"
        status: pass
    human_judgment: true
    rationale: "Vitest pins the wrap classes and the shared action parent. It does not measure the viewport. The seeded layout-narrow row /profile — SC2-PROFILE was not run in this session."

duration: 9min
completed: 2026-09-27
status: complete
---

# Phase 170 Plan 08: Profile tab strip and key rows Summary

**Underline tab strips scroll inside themselves, and profile key-card actions wrap so Disconnect sits on its own line below sm.**

## Performance

- **Duration:** 9 min
- **Started:** 2026-09-27T22:42:40Z
- **Completed:** 2026-09-27T22:52:00Z
- **Tasks:** 2
- **Files modified:** 4

## Accomplishments

- The shared underline `TabsList` scrolls on its own horizontal axis, draws the hairline as an inset shadow, and brings the active tab into view through `computeTabStripScroll`. Profile and admin both inherit it. The segmented arm (`WatchlistTabs`) is unchanged.
- Each profile key row wraps. Sync now, the optional Update password and Disconnect share one action group that takes a full line below `sm`. A disconnected row wraps Reconnect the same way.
- `HoldingDetail.tsx` was not edited. It is not a `TabsList` consumer.

## Task Commits

Each task was committed atomically:

1. **Task 1: underline TabsList scrolls inside itself** - `f49451545` (test), `dcc5353e3` (feat)
2. **Task 2: profile key rows wrap their actions** - `48b61443e` (test), `df831285b` (feat)

## Files Created/Modified

- `src/components/ui/Tabs.tsx` - underline list scrolls; underline trigger drops `-mb-px` and uses an inset ring; segmented strings unchanged
- `src/components/ui/Tabs.test.tsx` - class pins, horizontal `scrollTo` contract, reduced-motion, segmented byte pin
- `src/components/exchanges/AllocatorExchangeManager.tsx` - both key rows wrap; action buttons share one group
- `src/components/exchanges/AllocatorExchangeManager.test.tsx` - wrap and action-group pin, size md, existing aria-labels

## Decisions Made

- The inset ring lives on the underline trigger only, so the segmented class strings stay the strings read at HEAD.
- Scroll math uses `offsetLeft`, `offsetWidth`, `scrollLeft` and `clientWidth`. `scrollTo` receives `{ left, behavior }` and nothing else. A `MutationObserver` on `data-state` reruns it when Radix changes the active tab, and disconnects on unmount. Segmented lists skip the effect.
- The disconnected card has no Disconnect button. Its group wraps Reconnect and the optional Update password. That is the second copy of the action-group class the acceptance grep counts.

## Calibration Log

**Task 1 RED at HEAD** (`npx vitest run src/components/ui/Tabs.test.tsx`): 4 failed, 8 passed. The list class was `flex gap-1 border-b border-border` (missing `overflow-x-auto`). The trigger class still contained `-mb-px` and not `shrink-0`. Both scroll tests saw `scrollTo` called 0 times. The segmented byte-identical pin passed, which is the HEAD string.

**Task 1 neuter:** `overflow-x-auto` removed from the underline list. The hairline test failed: expected `overflow-x-auto`, received `flex gap-1 [scrollbar-width:none] shadow-[inset_0_-1px_0_var(--color-border)]`. Restored. Tabs 12/12, WatchlistTabs 19/19, then the tracer verify (Tabs + `src/components/auth/` + AdminTabs) 62/62.

**Task 2 RED at HEAD** (`-t "key rows wrap"`): 1 failed. Disconnect's parent was `flex items-center gap-4 bg-surface px-4 py-3`, which does not contain `basis-full`.

**Task 2 neuter:** `basis-full` dropped from the active-row group only. The same assertion failed on `flex flex-wrap gap-2 sm:basis-auto sm:ml-auto`. Restored.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Verification

- `npx vitest run src/components/ui/Tabs.test.tsx src/components/auth/ src/components/admin/AdminTabs.test.tsx src/components/exchanges/` — 13 files, 189 tests, exit 0.
- `npx tsc --noEmit -p .` — exit 0.
- `npx eslint` on the four edited files — exit 0.
- Acceptance greps: `overflow-x-auto` 1, `tab-strip-scroll` 1, non-comment `scrollIntoView` 0, `ring-inset` 1, action-group class 2, wrapped row class 2. `aria-label=.*Disconnect` is 1 here, 1 at the pre-change commit, and 1 on `origin/main`.

## Not verified in a browser

No dev server and no seeded browser pass. Not confirmed: the profile and admin tab rows at V390, V640 and V960, or `elementFromPoint` on Disconnect. CI `e2e-seeded` row `/profile — SC2-PROFILE` was not run locally.

`SC2-NOSCROLL` is also declared by later plans, and neither id is a checkbox in `REQUIREMENTS.md`, so that file was not edited.

## Next Phase Readiness

Ready for 170-09. The underline strip and the key-row wrap are in. The viewport proof remains the seeded layout row.

## Self-Check: PASSED

- FOUND: `src/components/ui/Tabs.tsx`
- FOUND: `src/components/ui/Tabs.test.tsx`
- FOUND: `src/components/exchanges/AllocatorExchangeManager.tsx`
- FOUND: `src/components/exchanges/AllocatorExchangeManager.test.tsx`
- FOUND: `f49451545`
- FOUND: `dcc5353e3`
- FOUND: `48b61443e`
- FOUND: `df831285b`

---
*Phase: 170-pagecopy*
*Completed: 2026-09-27*
