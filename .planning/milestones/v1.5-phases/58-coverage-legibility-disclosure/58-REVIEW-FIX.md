---
phase: 58-coverage-legibility-disclosure
fixed_at: 2026-07-02T00:20:00Z
review_path: .planning/phases/58-coverage-legibility-disclosure/58-REVIEW.md
iteration: 1
findings_in_scope: 2
fixed: 2
skipped: 0
status: all_fixed
---

# Phase 58: Code Review Fix Report

**Fixed at:** 2026-07-02T00:20:00Z
**Source review:** .planning/phases/58-coverage-legibility-disclosure/58-REVIEW.md
**Iteration:** 1

**Summary:**
- Findings in scope: 2 (WR-01, WR-02; fix_scope=critical_warning, so the 3 INFO findings are out of scope)
- Fixed: 2
- Skipped: 0

Both WARNINGs are the same root cause — the COVERAGE-04 include-cost label
`Include → shortens window to {date} (−{N} mo)` disclosed a date that did not
agree with the window bound(s) that actually move for head-ragged and
both-ends-ragged coverage gaps. They were fixed together in one atomic commit
because they share the `includeCostFor` helper, the `IncludeCost` type, and the
`AutoExcludedRow` render label.

## Fixed Issues

### WR-01: Include-button label mislabels the moved bound for a ragged-HEAD strategy

**Files modified:** `src/app/(dashboard)/allocations/components/ScenarioComposer.tsx`, `src/app/(dashboard)/allocations/components/ScenarioComposer.test.tsx`
**Commit:** 232c80f8
**Applied fix:** `includeCostFor` now returns `movedBound: "start" | "end" | "both"` plus both bound dates (`start`, `end`) instead of a single ambiguous `date`. The `AutoExcludedRow` label branches on `movedBound`: a head-only move renders `Include → moves window start to {start} (−{N} mo)` (start-bound phrasing), so a strategy whose data begins after the window start is no longer disclosed with end-bound ("shortens to") phrasing. Added a ragged-HEAD integration test (fixture: `strat-window-late` starting 2026-01-04 while A runs 2026-01-01…2026-01-12) that asserts the label reads "moves window start to", does NOT contain "shortens window", discloses the moved start bound `2026-01-04`, carries a reconcilable `−1 mo` cost (3-day head shift floors to 1 month), and — via the REAL `computeScenario` member_count-rise oracle — that clicking Include re-admits the strategy and applies the intersection window `2026-01-04 → 2026-01-12`. This branch was previously untested because `mountUnequalSpanBook` gave both fixtures the same 2026-01-01 start.

### WR-02: Both-bounds-move case discloses one date but a combined-span month cost

**Files modified:** `src/app/(dashboard)/allocations/components/ScenarioComposer.tsx`, `src/app/(dashboard)/allocations/components/ScenarioComposer.test.tsx`
**Commit:** 232c80f8
**Applied fix:** When both bounds move (`movedBound === "both"`), the label now names BOTH moved dates as a range — `Include → shortens window to {start}–{end} (−{N} mo)` — using the U+2013 en-dash that matches the existing BlendHeader `{effStart}–{effEnd}` convention. The single `−{N} mo` figure (head-forward days + tail-back days, summed then folded) now reconciles against the two-ended span shown, instead of naming only the end bound while silently charging for the head shift. Added a both-ends-ragged integration test (fixture: `strat-window-mid` covering 2026-01-04…2026-01-09 inside A's 2026-01-01…2026-01-12) that asserts the label contains the `2026-01-04–2026-01-09` range and a reconcilable `−1 mo` cost (3-day head + 3-day tail = 6 days → 1 month), then verifies the member_count rises to 2 on include and the applied window is `2026-01-04 → 2026-01-09`.

## Verification

- **Presentation-only preserved:** no engine file touched (`scenario.ts` / `scenario-window.ts` / `dateday.ts` untouched); the fix only changes the disclosure label + its helper's return shape. The apply behaviour (`applyWindow(intersectionOf(...))`, no `selected` mutation, no modal) is unchanged.
- **Timezone discipline preserved:** no new `new Date(` introduced; month math still folds days via `parseIsoDay` + `diffDays`.
- **DESIGN.md tokens preserved:** disclosed date(s) + `−{N} mo` still render in `font-mono tabular-nums`; the accent text-button styling and `duration-300`/`ease-out`/`motion-reduce` classes are unchanged.
- **Locked-copy acceptance grep preserved:** `Include → shortens window to` is still present in the source (tail + both-ends branches).
- **Type/lint:** `tsc --noEmit` clean (0 errors project-wide); `eslint` clean on both modified files.
- **Tests:** `npx vitest run "src/app/(dashboard)/allocations/components/ScenarioComposer.test.tsx"` → **136 passed** (134 baseline + 2 new branch-covering tests). The coverage ratchet is not reduced (2 new passing tests added, no assertions removed).

## Skipped Issues

None — both in-scope findings were fixed.

_The 3 INFO findings (IN-01 band-width clamp, IN-02 floor-at-1 guard readability, IN-03 CoverageTimeline non-persistence) are out of scope for `fix_scope=critical_warning` and were not attempted. IN-01/IN-02/IN-03 were all filed by the reviewer as non-defects / readability notes (unreachable-in-practice or intended design)._

---

_Fixed: 2026-07-02T00:20:00Z_
_Fixer: Claude (gsd-code-fixer)_
_Iteration: 1_
