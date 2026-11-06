---
phase: 170-pagecopy
plan: 05
subsystem: ui
tags: [layout, strategies, share-link, nowrap, responsive]

requires:
  - phase: 170-01
    provides: the narrow-width viewport contract this row is checked against
  - phase: 170-02
    provides: the seeded layout-narrow N-STRAT row that asserts no overlap
provides:
  - NowrapWords, per-word whitespace-nowrap spans joined by literal spaces
  - /strategies row stacks below sm; tags and the control group wrap whole
  - ShareableLink size sm on /strategies, default md everywhere else
affects: [170-10, layout-narrow N-STRAT, ShareableLink]

actuals:
  tokens: 5089
  tasks: 2
  commits: 4

plan_head_before: 77c44a6e5481b8b4a05c7885f09e8313ca9f189d
plan_head_after: 0c6555a5294ef4e12ed215d537bfd33f342f8af4

tech-stack:
  added: []
  patterns:
    - "Hyphen-safe names are per-word whitespace-nowrap spans joined by literal space text nodes (AD-13, PC-5)"
    - "ShareableLink size defaults to md; a call site opts into sm"

key-files:
  created:
    - src/components/ui/NowrapWords.tsx
    - src/components/ui/NowrapWords.test.tsx
  modified:
    - src/app/(dashboard)/strategies/page.tsx
    - src/app/(dashboard)/strategies/page.share-affordance.test.tsx
    - src/components/strategy/ShareableLink.tsx
    - src/components/strategy/ShareableLink.test.tsx

key-decisions:
  - "NowrapWords root is a display:contents div, not a span, so the word spans are the only spans and the name stays in the link's inline flow"
  - "Literal space text nodes stay between those spans; dropping them makes noteOf() miss every multi-word name"
  - "ShareableLink size defaults to md. Only /strategies passes sm. The discovery detail page is not edited"

patterns-established:
  - "N-STRAT row: flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"
  - "N-STRAT tags: flex flex-wrap gap-1 mt-1, Badge className whitespace-nowrap at the call site"
  - "N-STRAT control group: flex flex-wrap items-center gap-3 sm:ml-4 sm:shrink-0, ShareableLink size sm"

requirements-completed: []

coverage:
  - id: D1
    description: "NowrapWords renders each space-separated word in a whitespace-nowrap span, joined by literal space text nodes, so textContent equals the input"
    requirement: "(l)"
    verification:
      - kind: unit
        ref: "src/components/ui/NowrapWords.test.tsx#wraps each space-separated word"
        status: pass
      - kind: unit
        ref: "src/components/ui/NowrapWords.test.tsx#renders a single-word input as one nowrap span"
        status: pass
    human_judgment: false
  - id: D2
    description: "The /strategies row stacks below sm, tags wrap whole, and the name link textContent equals the strategy name"
    requirement: "(l)"
    verification:
      - kind: unit
        ref: "src/app/(dashboard)/strategies/page.share-affordance.test.tsx#stacks below sm, wraps tags whole"
        status: pass
      - kind: unit
        ref: "src/app/(dashboard)/strategies/page.key-pill.test.tsx#noteOf"
        status: pass
    human_judgment: false
  - id: D3
    description: "At 390 px the strategy name and the private-link control group do not intersect, and names and tags break only between words"
    requirement: "SC1-PRIVLINK"
    verification:
      - kind: unit
        ref: "src/app/(dashboard)/strategies/page.share-affordance.test.tsx#stacks below sm, wraps tags whole"
        status: pass
    human_judgment: true
    rationale: "Rect non-intersection at V390/V640/V960 is the seeded layout-narrow N-STRAT row. This plan did not run that spec."
  - id: D4
    description: "ShareableLink size sm is a bordered secondary button with a coarse 44px floor and h-3.5 icons on every label arm; omitting size stays on the md arm, and /strategies passes size sm"
    requirement: "SC1-PRIVLINK"
    verification:
      - kind: unit
        ref: "src/components/strategy/ShareableLink.test.tsx#size sm is a bordered secondary button"
        status: pass
      - kind: unit
        ref: "src/components/strategy/ShareableLink.test.tsx#with no size prop the button and icon stay on the md arm"
        status: pass
      - kind: unit
        ref: "src/app/(dashboard)/strategies/page.share-affordance.test.tsx#passes size=sm through to ShareableLink"
        status: pass
    human_judgment: false

duration: 12min
completed: 2026-09-27
status: complete
---

# Phase 170 Plan 05: Strategies Row and Private Link Summary

**The My Strategies row stacks below sm, names and tags break only between words, and the private-link control is a small bordered secondary peer.**

## Performance

- **Duration:** 12 min
- **Started:** 2026-09-27T21:47:20Z
- **Completed:** 2026-09-27T21:59:30Z
- **Tasks:** 2
- **Files modified:** 6

## Accomplishments

- `NowrapWords` splits a name on single spaces into `whitespace-nowrap` spans joined by literal space text nodes. A hyphenated word cannot break at the hyphen, and the parent's `textContent` stays equal to the name.
- The `/strategies` row is `flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between`. The name block keeps `flex-1 min-w-0`. Tags are `flex flex-wrap gap-1 mt-1` with `whitespace-nowrap` on each Badge. The control group is `flex flex-wrap items-center gap-3 sm:ml-4 sm:shrink-0`.
- `ShareableLink` gained `size?: "sm" | "md"` (default `"md"`). `/strategies` passes `size="sm"`: secondary button, `pointer-coarse:min-h-[44px]`, icons `h-3.5 w-3.5`. Mint, copy, and revoke logic are unchanged. The discovery detail page was not edited.

## Task Commits

Each task was committed atomically:

1. **Task 1 RED: failing nowrap and row tests** - `08fdd33f9` (test)
2. **Task 1 GREEN: stacked row, whole words and tags** - `5e242b663` (feat)
3. **Task 2 RED: failing size=sm tests** - `6fe3aeebe` (test)
4. **Task 2 GREEN: ShareableLink size sm on /strategies** - `0c6555a52` (feat)

## Files Created/Modified

- `src/components/ui/NowrapWords.tsx` - server-safe per-word nowrap spans joined by literal spaces.
- `src/components/ui/NowrapWords.test.tsx` - two- and one-word textContent contract.
- `src/app/(dashboard)/strategies/page.tsx` - stacked row, `NowrapWords` name, nowrap tags, `size="sm"`.
- `src/app/(dashboard)/strategies/page.share-affordance.test.tsx` - N-STRAT row case and the size prop probe.
- `src/components/strategy/ShareableLink.tsx` - optional `size`, sm icon and coarse min-height.
- `src/components/strategy/ShareableLink.test.tsx` - md byte-identity and every sm label arm.

`page.key-pill.test.tsx` was not edited. `noteOf()` still matches `a.textContent === strategyName`. No `getByText(<strategy name>)` existed in the two page tests, so none was migrated.

## Decisions Made

- The component root is `<div className="contents">`. A `span` root would be counted with the word spans and its `textContent` would be the whole name. `display: contents` keeps the words in the link's inline flow.
- Spaces are real text nodes between the spans. The PC-5 neuter (no space children) made `noteOf("Strategy s-1")` return null and the name link read `AlphaLong-ShortBeta`.
- `size` defaults to `"md"` and passes through on the one Button. `className` is omitted on md so that arm stays the previous class string. Icons share one class: `h-4 w-4 mr-1.5` or `h-3.5 w-3.5 mr-1.5`.

Plan frontmatter names `SC1-PRIVLINK`, `R0926-PRIVLINK`, `(l)`, and `SC2-NOSCROLL`. None of those ids exist in `REQUIREMENTS.md`. `SC1-PRIVLINK`, `(l)`, and `SC2-NOSCROLL` are also declared by later plans in this phase, so none were marked complete.

## Deviations from Plan

None - plan executed exactly as written.

## TDD Gate Compliance

| Gate | Commit | Status |
|------|--------|--------|
| RED (task 1) | `08fdd33f9` test(170-05) | present; vitest RED recorded below |
| GREEN (task 1) | `5e242b663` feat(170-05) | present; 60/60 pass |
| RED (task 2) | `6fe3aeebe` test(170-05) | present; vitest RED recorded below |
| GREEN (task 2) | `0c6555a52` feat(170-05) | present; 24/24 pass, tsc 0 |
| REFACTOR | — | not needed |

The plan type is `execute`. Task 1 is `type="tracer"` and both tasks are `tdd="true"`. RED commits precede each GREEN commit. `workflow.auto_advance` is true and the tracer verify is automated only, so the tracer gate re-ran the task 1 vitest (60 passed) and continued. No checkpoint.

`check tdd-red-evidence` was not used as the verdict. It reads `node --test` summary lines. This repo's runner is vitest. The RED evidence is the vitest output below.

**Task 1 RED at HEAD** (before the row and `NowrapWords` implementation): 3 failed, 57 passed, exit 1.

- `NowrapWords` export — expected a function, received `undefined` (placeholder `export {}`).
- Single-word case — same missing export.
- N-STRAT row — expected class `flex-col`, received `flex items-center justify-between`.

**Task 1 neuter RED** (space children removed): 28 failed, 32 passed. The name link was `AlphaLong-ShortBeta`. `noteOf(container, "Strategy s-1")` returned null instead of the share note. Spaces restored; the three files then 60/60.

**Task 2 RED at HEAD** (before `size`): 6 failed, 18 passed, exit 1.

- Five sm label arms — button class was still the md string, not `px-3 py-1.5 text-caption pointer-coarse:min-h-[44px]`.
- Page probe — `shareProps[0].size` was `undefined`, expected `"sm"`.
- The no-size md case passed at HEAD (that arm was already the current button).

**Task 2 neuter RED** (`size={size}` removed from the Button): 5 failed, 10 passed. The five sm arms went red; the md arm stayed green. Passthrough restored.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Ready for 170-06. Plan 170-10 reuses `NowrapWords` for the StrategyTable name cell and must import it, not re-implement it.
- CI `e2e-seeded` still owns the geometry proof: layout-narrow row "/strategies — N-STRAT" at V390, V640, and V960. This plan did not edit `e2e/layout-narrow.spec.ts` and did not run that spec. `git diff --quiet origin/main` on the discovery detail page exited 0.
- `npx tsc --noEmit -p .` exited 0. Eslint on the six touched files exited 0. The four test files together were 76/76 after both tasks.

## Self-Check: PASSED

- FOUND: src/components/ui/NowrapWords.tsx
- FOUND: src/components/ui/NowrapWords.test.tsx
- FOUND: src/app/(dashboard)/strategies/page.tsx
- FOUND: src/app/(dashboard)/strategies/page.share-affordance.test.tsx
- FOUND: src/components/strategy/ShareableLink.tsx
- FOUND: src/components/strategy/ShareableLink.test.tsx
- FOUND: 08fdd33f9
- FOUND: 5e242b663
- FOUND: 6fe3aeebe
- FOUND: 0c6555a52

---
*Phase: 170-pagecopy*
*Completed: 2026-09-27*
