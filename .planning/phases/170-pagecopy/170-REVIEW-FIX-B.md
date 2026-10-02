---
phase: 170-pagecopy
topic: B (e2e checks that can pass vacuously)
fixed_at: 2026-10-01
review_path: .planning/phases/170-pagecopy/170-REVIEW.md, .planning/phases/170-pagecopy/170-REVIEW-SFH.md
iteration: 1
findings_in_scope: 2
fixed: 2
skipped: 0
status: all_fixed
---

# Phase 170: Code Review Fix Report, topic B

**Fixed at:** 2026-10-01
**Source reviews:** `170-REVIEW.md` (WR-04), `170-REVIEW-SFH.md` (SFH-170-01, SFH-170-02)
**Iteration:** 1
**Where verification ran:** the isolated worktree `quantalyze-170-fb` (branch `feat/170-fix-b`, base `37dfad67d`). It has no seed env, so seeded rows are listed, not run.

**Summary:**
- Findings in scope: 2. WR-04 and SFH-170-01 are the same defect.
- Fixed: 2
- Skipped: 0

## Fixed Issues

### WR-04 / SFH-170-01: N-TABLE could pass without the sticky header reaching the filter bar

**Files modified:** `e2e/layout-narrow.spec.ts`
**Commit:** `4044d9bea`
**Status:** fixed: CI verification pending. The row is seeded, so it runs only in `e2e-seeded`.

**Applied fix:**
- Removed three things:
  - the `scrollTop = scrollHeight` line, which made the loop dead
  - the silent-return loop
  - the unused `header` and `filter` locators and their `void`s
- Each select is now checked on its own. `#main-content` is reset to 0 and stepped 8 px at a time. The test stops once `document.elementsFromPoint` at the select's centre includes a descendant of `[data-strategy-table]` with `position: sticky` and a non-`auto` z-index. That covers the z-20/z-30 header cells and the z-10 sticky name column, which are the boxes that paint over the z-10 filter bar if the table root loses `isolate`.
- The reviewer's `thead.top <= filterBottom` check was not used. It stays true after the header has scrolled fully past the bar, so it can report "reached" with nothing under the select.
- If an element is missing or the scroller runs out, the test now fails instead of continuing. The message is `N-TABLE precondition not reached for <label> — no z-indexed sticky table cell ever sat under its centre`, followed by the returned diagnostic: `missing table=… select=… filter=…` or `not-reached scrollTop=… max=… filterBottom=… selectCentreY=… theadTop=…`.
- Checked in source: `#main-content` has `overflow-y-auto` at every breakpoint (`DashboardChrome.tsx` lines 156 and 221), so stepping it works at V390, V640 and V960.

**Expected in CI:** three rows, `N-TABLE › V390/V640/V960: each Sort select is the hit target after the header passes the filter bar`.
- If the 12 seeded drafts are too short to slide a sticky cell under a select at some viewport, that row now goes RED with the `not-reached` diagnostic. That result is correct and means more rows need to be seeded. Before this fix, the same case passed.
- No local neuter was possible: the row needs seeded TEST rows, and no fixture was invented to imitate it.

### SFH-170-02: the geometry helpers could not see a control half-hidden by an `overflow-hidden` ancestor

**Files modified:** `e2e/helpers/geometry.ts`, `e2e/layout-narrow.spec.ts`, `e2e/reflow.spec.ts`
**Commit:** `c4f0f47b2`
**Status:** fixed. The helper is proven locally; the SC2-PROFILE use runs in CI.

**Applied fix:**
- Added `assertNotClippedByAncestors(locator, label)`:
  - It walks the containing-block chain the same way `reflow.ts` does. An absolute box jumps to its `offsetParent`, and a fixed box stops the walk.
  - Every ancestor whose `overflow-x` or `overflow-y` is not `visible` clips that axis at its padding box. The element rect is intersected with each of them.
  - It fails when the visible part is smaller than the element by more than 1 px on either axis, and names the first ancestor that clipped it.
  - A locator with zero elements throws (W-02).
- SC2-PROFILE now runs the checks in this order: `scrollIntoViewIfNeeded` → `assertInsideViewport` → `assertNotClippedByAncestors` → `assertNotCovered`. The old comment claimed the check "measures clipping", which was wrong. It was rewritten to say what each of the three checks measures.
- `e2e/helpers/reflow.ts` lines 140-141 were left unchanged on purpose. That walk answers a different question: whether `scrollWidth` grew. For that question an `overflow-hidden` ancestor really does contain the content. The clipping gap the finding describes is closed by the new helper, not by changing reflow.ts.

**Self-test (server-free, Chromium, `CI=1 npx playwright test e2e/reflow.spec.ts -g "self-test"`):** 12 passed, 3 of them new:
- half-clipped: a 100 px button at `margin-left:150px` inside a 200 px `overflow:hidden` row rejects with `clipped by ancestor DIV (overflow hidden/hidden)`
- visible: the same button fully inside the row resolves
- escapee: an absolute button whose `position:relative` containing block is outside the clipping row resolves

## Neuters (cp byte backup → RED → cp restore; `git checkout --` was not used)

| # | Neuter | Result | Restore check |
|---|---|---|---|
| 1 | `clipped: false` in `assertNotClippedByAncestors` | the half-clipped fixture went RED on all 3 attempts (`expect(received).rejects.toThrow()`); the other 2 stayed green | `grep -c "clipped: visibleW < r.width - slop"` = 1 |
| 2 | the absolute branch takes `parentElement` instead of `offsetParent` | the escapee fixture went RED on all 3 attempts: `escapee: clipped by ancestor DIV (overflow hidden/hidden); element rect {x:150.0,…,w:100.0}, visible part {…,w:50.0,…}` | `grep -c "(box as HTMLElement).offsetParent"` = 1; `cmp` against the pre-neuter backup is identical |
| — | WR-04 precondition | not neutered locally (seeded only, see above) | — |

## Gates

- `npx eslint e2e/helpers/geometry.ts e2e/layout-narrow.spec.ts e2e/reflow.spec.ts`: clean
- `npx tsc --noEmit -p tsconfig.json` (covers `e2e/**`): exit 0
- `CI=1 npx playwright test e2e/layout-narrow.spec.ts e2e/reflow.spec.ts --list` lists 41 tests in 2 files, including:
  - `layout-narrow.spec.ts:348` SC2-PROFILE V390 and V640
  - `layout-narrow.spec.ts:495` N-TABLE V390, V640 and V960
  - `reflow.spec.ts:280/294/306`, the three ancestor-clip self-tests

**Seeded rows expected in CI (`e2e-seeded`):**
- SC2-PROFILE V390 and V640 should stay green. A Disconnect button cut by the key-list wrapper now fails with `clipped by ancestor …`.
- N-TABLE V390, V640 and V960 should be green only if a sticky cell actually reaches each select. Otherwise they fail with the `not-reached` diagnostic.

---

_Fixed: 2026-10-01_
_Fixer: Claude (gsd-code-fixer)_
_Iteration: 1_
