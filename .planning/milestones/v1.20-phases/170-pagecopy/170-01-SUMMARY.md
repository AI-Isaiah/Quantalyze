---
phase: 170-pagecopy
plan: 01
subsystem: testing
tags: [playwright, reflow, wcag, e2e]

requires: []
provides:
  - "assertNoReflow measures #main-content and documentElement, and skips content clipped inside a bounded overflow-x auto/scroll region"
  - "server-free helper self-test (red fixture, contained-scroll fixture, document fixture)"
  - "authed reflow sweep at V390/V640/V960, including a signed-in header assertion on /security and /legal/privacy"
affects: [170-02, 170-07, 170-11]

actuals:
  tokens: 6731
  tasks: 3
  commits: 3
  plan_head_before: 9a24653062fb75b031ed3742fff5ba43a47e8467

tech-stack:
  added: []
  patterns:
    - "assertNoReflow logs LAYOUT-NARROW-OFFENDER / LAYOUT-NARROW-CLEAN from the Node helper after evaluate returns, so a CI job log can grep it"

key-files:
  created: []
  modified:
    - e2e/helpers/reflow.ts
    - e2e/reflow.spec.ts
    - e2e/reflow-sweep-authed.spec.ts
    - e2e/reflow-sweep.spec.ts
    - e2e/mobile-drawer-keyboard.spec.ts

key-decisions:
  - "No opt-in flag on the main measure: an opt-in would recreate the document-only blindness."
  - "320px left every assertNoReflow caller, per the 2026-09-27 founder decision. The 2560 ultra-wide describes and the rotate-stability describe stayed."
  - "The signed-in header assertion is expected RED until plan 170-07 lands in the same PR."

patterns-established:
  - "Reflow failure message is reflow: main=<slop> doc=<slop> scroller=<main|doc> offender=<TAG#id.class1.class2>"

requirements-completed: []

coverage:
  - id: D1
    description: "assertNoReflow fails when #main-content overflows by more than 1px even if documentElement does not, and names the scroller plus the first offender."
    requirement: T0
    verification:
      - kind: e2e
        ref: "e2e/reflow.spec.ts#red fixture: wide flex child inside #main-content rejects with main= and an offender"
        status: pass
    human_judgment: false
  - id: D2
    description: "assertNoReflow resolves when 800px content sits inside a bounded overflow-x auto region and neither scroller overflows."
    requirement: T0
    verification:
      - kind: e2e
        ref: "e2e/reflow.spec.ts#green fixture: 800px content inside a bounded overflow-x auto region resolves"
        status: pass
    human_judgment: false
  - id: D3
    description: "A body-level wide element with no #main-content still rejects, and the message carries doc=."
    requirement: T0
    verification:
      - kind: e2e
        ref: "e2e/reflow.spec.ts#document fixture: body-level 800px element with no #main-content rejects with doc="
        status: pass
    human_judgment: false
  - id: D4
    description: "The seeded authed sweep enumerates every route at V390, V640 and V960 and asserts the signed-in header on /security and /legal/privacy."
    requirement: SC2-HEADER
    verification:
      - kind: other
        ref: "CI=1 npx playwright test --list e2e/reflow-sweep-authed.spec.ts"
        status: pass
    human_judgment: true
    rationale: "The listing proves the titles and the header assertion is in the spec. The assertion itself is expected RED until plan 170-07 lands, and the seeded spec is not run locally against shared TEST."

duration: 15min
completed: 2026-09-27
status: complete
---

# Phase 170 Plan 01: Reflow helper and viewport floor Summary

**assertNoReflow now fails when `#main-content` overflows by more than 1px even if the document does not, and every reflow caller measures the founder's supported widths instead of 320px.**

## Performance

- **Duration:** 15 min
- **Started:** 2026-09-27T20:17:34Z
- **Completed:** 2026-09-27T20:32:41Z
- **Tasks:** 3
- **Files modified:** 5

## Accomplishments

- `assertNoReflow` measures `#main-content` and `documentElement`, skips an element clipped inside a bounded `overflow-x: auto|scroll` ancestor, and throws `reflow: main=… doc=… scroller=… offender=…`. The signature stays `(page, anchorSelector)`.
- The evaluate callback returns `{ mainSlop, docSlop, offender }` and does not log. The Node helper logs `LAYOUT-NARROW-OFFENDER` or `LAYOUT-NARROW-CLEAN` after evaluate returns, before any throw.
- A server-free self-test in `e2e/reflow.spec.ts` proves the red fixture, the contained-scroll fixture, and the document fixture in Chromium.
- The seeded authed sweep runs at V390 (390x844), V640 (640x400) and V960 (960x540), adds `/legal/privacy`, and asserts `Go to app` visible and `Sign in` count 0 on `/security` and `/legal/privacy`.

## Task Commits

Each task was committed atomically:

1. **Task 1: assertNoReflow measures #main-content and skips contained scrollers** - `beb7e8d5a` (feat)
2. **Task 2: authed sweep at V390/V640/V960 plus the signed-in header assertion** - `e1dd9200f` (feat)
3. **Task 3: remaining 320px reflow callers raised to 390px** - `e963c4d15` (feat)

**Plan metadata:** this commit (docs)

## Files Created/Modified

- `e2e/helpers/reflow.ts` - main-aware, scroll-ancestor-aware `assertNoReflow`. `assertTargetSizes` is untouched.
- `e2e/reflow.spec.ts` - helper self-test, and the `/security` case moved from 320px to 390px.
- `e2e/reflow-sweep-authed.spec.ts` - `VIEWPORTS` table, `/legal/privacy` row, signed-in header assertion.
- `e2e/reflow-sweep.spec.ts` - public sweep moved from 320px to 390px.
- `e2e/mobile-drawer-keyboard.spec.ts` - nav-shell reflow viewport moved from 320px to 390px. `assertTargetSizes` selectors unchanged.

## RED recorded (the self-test can fail)

Written against the unchanged helper, before the implementation:

- `red fixture: wide flex child inside #main-content rejects with main= and an offender` — FAILED. `expect(received).rejects.toThrow()` received a resolved promise. The helper passed vacuously on a main overflow of a non-shrinking 800px flex row at 390px. That is the blindness this plan exists to remove.
- `document fixture: body-level 800px element with no #main-content rejects with doc=` — also FAILED against the unchanged helper, for a different reason. The helper did throw (`reflow: scrollWidth=800 clientWidth=390 offender=DIV`), so the document gate already worked. The message had no `doc=` token, which the new assertion requires. Recorded so the step-1 run is not over-claimed as a single failure.
- `green fixture: 800px content inside a bounded overflow-x auto region resolves` — PASSED against the unchanged helper, as expected (the document did not overflow).

Neuter, by hand, after the implementation. Each was re-applied by hand and confirmed with `git diff` (no `NEUTER` marker left; the green self-test run followed):

- **mainSlop ignored** (`const mainSlop = 0`). `red fixture: wide flex child inside #main-content rejects with main= and an offender` went RED: the promise resolved instead of rejecting. Re-applied. The red fixture passed again.
- **Ancestor skip removed.** The first neuter did not go RED. The plan's contained fixture (800px row inside `max-width:100%; overflow-x:auto`) leaves both scrollers at slop 0, because the box is sized by its parent, so the walker never runs and removing the skip changes nothing. A rebuilt fixture that overflowed main (an 800px block wrapping a 200px `overflow-x:auto` box) painted the clipped child past main's edge, so it was not clipped and the skip correctly did not save it. The neuter was re-applied. The shipped green fixture stays the plan's resolving case. This is the one direction the self-test does not prove can fail; see Deviations.

## Former 320px sites (Rule 12)

| Site | Was | Now |
|---|---|---|
| `e2e/reflow.spec.ts` `/security` `setViewportSize` | 320x800 | 390x800 |
| `e2e/reflow-sweep.spec.ts` public sweep `setViewportSize` | 320x800 | 390x800 |
| `e2e/reflow-sweep-authed.spec.ts` `AUTHED_ROUTES` loop | 320x800 | V390 390x844, V640 640x400, V960 960x540 |
| `e2e/reflow-sweep-authed.spec.ts` degenerate honest-empty | 320x800 | the same three viewports |
| `e2e/mobile-drawer-keyboard.spec.ts` nav-shell `setViewportSize` | 320x800 | 390x800 |

Each change carries a comment citing the 2026-09-27 founder decision. The 2560 ultra-wide describes and the rotate-stability describe were not edited. `grep` of non-comment lines for `width: 320` prints 0 in all four files.

## Decisions Made

- No opt-in flag. Measuring main only when a caller asks would leave the existing sweeps blind, which is the defect.
- The header assertion ships RED. Plan 170-07 owns the signed-in masthead (`Go to app`, no `Sign in`) and lands in the same PR. The comment in the spec says so.
- `/browse` and `/demo` do not mount `DashboardChrome` in this checkout (demo's own layout says it does not; browse has no `DashboardChrome` import). They were still raised to 390, because the decision covers every former 320px caller, not only dashboard routes. The plan's premise that those two routes render `DashboardChrome` does not hold here.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] The ancestor-skip neuter cannot go RED on the plan's contained fixture**
- **Found during:** Task 1 (neuter step)
- **Issue:** `max-width:100%; overflow-x:auto` around an 800px row does not grow `#main-content` or `documentElement` (`mainSlop` 0, `docSlop` 0, box right edge 390, child right edge 800). The walker only runs when a scroller overflows, so deleting the ancestor skip leaves the green fixture green. A fixture that does overflow main either paints the clipped child past main (so the skip must not save it) or has a real page-wide sibling (so the helper must reject, which the plan's green case forbids).
- **Fix:** Kept the plan's resolving fixture and the skip. Did not weaken the fail condition to "any child past the edge", which would fail a contained scroller that does not overflow the page. Recorded the neuter as not producing RED, with the measurement.
- **Files modified:** none beyond the plan's files
- **Verification:** green fixture passes with the skip present; the two other neuter and step-1 REDs are recorded above
- **Committed in:** `beb7e8d5a` (Task 1 commit)

---

**Total deviations:** 1 auto-fixed (1 bug, recorded rather than papered over)
**Impact on plan:** The red direction is proven. The contained-scroll direction resolves, and the skip is present and unit-shaped against the measured geometry, but this plan does not have a fixture where removing the skip turns a pass into a fail. Plan 170-02's seeded geometry spec is the place that re-measures real contained scrollers.

## Issues Encountered

None that blocked the plan. `npm ci` was required: `require.resolve('vitest')` printed `MODULE_NOT_FOUND` before it. Chromium was already installed.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Ready for 170-02. It imports `assertNoReflow`; the signature is unchanged and the helper now sees a dashboard overflow.
- Expected in CI at this plan alone: the seeded authed sweep goes RED on dashboard routes with `main=` breadcrumbs, and the `/security` and `/legal/privacy` rows go RED on the header assertion until 170-07. Both are intended. Do not run the seeded specs locally against shared TEST.
- `requirements-completed` is empty on purpose. `T0` and `SC2-NOSCROLL` are also declared by 170-02, which has no SUMMARY yet, and `SC2-HEADER` is also declared by 170-07. Marking them complete here would flip a shared id while a sibling is still running.

## Self-Check: PASSED

- `e2e/helpers/reflow.ts` and `e2e/reflow.spec.ts` exist; the self-test command exited 0 with 3 passed.
- `git log --oneline --grep=170-01` returns the three task commits.

---
*Phase: 170-pagecopy*
*Completed: 2026-09-27*
