---
phase: 58-coverage-legibility-disclosure
reviewed: 2026-07-01T22:09:42Z
depth: standard
files_reviewed: 7
files_reviewed_list:
  - src/app/(dashboard)/allocations/components/BlendHeader.tsx
  - src/app/(dashboard)/allocations/components/CoverageStateChip.tsx
  - src/app/(dashboard)/allocations/components/CoverageTimeline.tsx
  - src/app/(dashboard)/allocations/components/DefaultChangeNote.tsx
  - src/app/(dashboard)/allocations/components/ScenarioComposer.tsx
  - src/lib/storage-namespaces.ts
  - e2e/composer-axe.spec.ts
findings:
  critical: 0
  warning: 2
  info: 3
  total: 5
status: issues_found
---

# Phase 58: Code Review Report

**Reviewed:** 2026-07-01T22:09:42Z
**Depth:** standard
**Files Reviewed:** 7
**Status:** issues_found

## Summary

Phase 58 "Coverage Legibility & Disclosure" adds four presentation-only surfaces to
the scenario composer (BlendHeader, CoverageStateChip, CoverageTimeline,
DefaultChangeNote) plus the COVERAGE-04 include-cost affordance on the existing
auto-excluded rows. I reviewed the full diff since `87ee2d50^`, traced the new
membership-projection path through `coverageEligible` / `scenarioMetrics`, and
verified the include-cost math against the `scenario-window.ts` / `dateday.ts`
helpers it delegates to.

**The load-bearing phase invariants all hold:**

1. **Single-source membership (Pitfall 1) — PASS.** None of the four new render
   components call `covers()` / `coverageSpanOf()` / `intersectionOf()` locally.
   BlendHeader reads `metrics.member_count` / `effective_*`; the row chips project
   `enabled` + the threaded `coverageEligible` axis; CoverageTimeline receives
   `inBlend` per row as a prop. The only `covers()` call in the composer is the
   single `coverageEligible` memo (line 1856), reconciled by the dev desync guard
   at line 1942. `intersectionOf` at line 493 is a cost calc, not membership.
2. **Presentation-only — PASS.** `git diff 87ee2d50^..HEAD` touches no engine file
   (`scenario.ts` / `scenario-window.ts` / `dateday.ts` are untouched; the new
   symbols `intersectionOf` / `diffDays` are pre-existing exports, only imported).
   No number can move.
3. **Timezone discipline — PASS.** Zero `new Date(` in any new component;
   CoverageTimeline builds its x-scale with `utcEpoch(parseIsoDay(...))`;
   `includeCostFor` folds days via `parseIsoDay` + `diffDays`. A static-guard test
   pins `not.toContain("new Date(")`.
4. **localStorage hygiene — PASS.** DefaultChangeNote persists via
   `useCrossTabStorage` (no raw `localStorage`), gated on `isHydrated` (no flash),
   key `composer.coverageDefaultChangeNoteDismissed` registered under the new
   `composer.` prefix in `storage-namespaces.ts` and inventoried in both
   `SignOutButton.test.tsx` KNOWN_APP_KEYS and the DefaultChangeNote static guard.
5. **DESIGN.md tokens — PASS.** Auto-excluded uses amber warning tokens (never
   red); no `duration-250` (Tailwind-v4 dropped tier), no raw font-px, no
   `role="alert"` in the new components. The auto-excluded group is a `<section>`
   with `aria-labelledby`, not an alert.
6. **XSS/injection — PASS.** No `dangerouslySetInnerHTML` / `innerHTML` / `eval`;
   strategy names flow through React-escaped text nodes, `title`, and aria-labels.

The remaining findings are two disclosure-accuracy WARNINGs on the COVERAGE-04
include button (the ragged-head bound-labeling and the both-bounds-move month/date
mismatch) plus three INFO items. No BLOCKER-class defect was found.

## Warnings

### WR-01: Include-button label mislabels the moved bound for a ragged-HEAD strategy

**File:** `src/app/(dashboard)/allocations/components/ScenarioComposer.tsx:507` (and the render label at `:3921`)
**Issue:**
`includeCostFor` picks the disclosed `date` as `endMoved ? target.end : target.start`.
For an ended (tail-ragged) strategy — the only case the tests exercise — `endMoved`
is true, `date = target.end`, and "Include → shortens window to {end-date}" reads
correctly.

But for a **ragged-HEAD** strategy (one whose data *starts later* than the current
window start: `span.first > window.start`, `span.last >= window.end`), only
`startMoved` is true, so `date = target.start` — the *later start* date. The label
still reads "Include → shortens window to {date}", which a reader parses as "the
window now *ends* at {date}". Disclosing a start-bound with end-bound phrasing is a
misleading cost disclosure — the user thinks they are trading away recent history
when they are actually trading away *early* history.

This case is unreached by the test fixtures: `mountUnequalSpanBook` gives both A and
B the same `2026-01-01` start (B only ends early), so `startMoved` is never true in
any COVERAGE-04 assertion (ScenarioComposer.test.tsx:5197-5198). The path is live in
production (any strategy that came online after the window start is ragged-head).

**Fix:** Make the verb agree with which bound moved, e.g. compute a direction and
branch the copy:
```tsx
// includeCostFor: expose which bound moved
return { target, date, months, movedBound: endMoved ? "end" : "start" };

// AutoExcludedRow label:
{includeCost.movedBound === "end"
  ? <>Include &rarr; shortens window end to <span className="font-mono tabular-nums">{includeCost.date}</span>{" "}</>
  : <>Include &rarr; moves window start to <span className="font-mono tabular-nums">{includeCost.date}</span>{" "}</>}
<span className="font-mono tabular-nums">(&minus;{includeCost.months} mo)</span>
```
Add a ragged-head fixture (strategy whose `first` is later than A's) to
ScenarioComposer.test.tsx so the start-bound branch is covered.

### WR-02: Both-bounds-move case discloses one date but a combined-span month cost

**File:** `src/app/(dashboard)/allocations/components/ScenarioComposer.tsx:504-528`
**Issue:**
When a strategy is ragged on **both** ends (`startMoved && endMoved` — data begins
after the window start *and* ends before the window end), `includeCostFor` shows the
single headline `date = target.end` (the tail) but computes `months` from
`shrinkDays = head-shift + tail-shift` (line 519-521 sums both). The rendered label
becomes "shortens window to {end-date} (−{combined} mo)": the month figure counts
history removed at *both* ends, but the disclosed date only names the end bound. The
allocator cannot reconcile the number against the single date shown — the head shift
is silent. The doc-comment (:479-481) acknowledges this ("if both move ... the end
bound is shown ... `{months}` is the net whole-month delta across the moved span"),
so it is a known design choice, but as shipped it is a self-inconsistent disclosure
(one date, two-ended cost).

**Fix:** Either (a) name both moved bounds in the label when both move
(`"shortens window to {start}–{end} (−{months} mo)"`), or (b) when both bounds move,
show the two costs separately, or (c) at minimum split `months` into the bound that
`date` names so the number and the date agree. Option (a) is the smallest honest
change:
```tsx
const label = startMoved && endMoved
  ? `${target.start}–${target.end}`
  : includeCost.date;
```
Add a both-bounds-ragged fixture to cover it.

## Info

### IN-01: Active-window band width can overshoot when the window start is clipped below the union axis

**File:** `src/app/(dashboard)/allocations/components/CoverageTimeline.tsx:88-91`
**Issue:**
`bandLeft = clampPct(l)` clamps the left edge, but `bandWidth = clampPct(r - l)`
uses the **raw** (unclamped) `l`. If `activeWindow.start` fell before
`unionWindow.start` (`l < 0`), the band would render from 0% with a width that still
includes the clipped-off negative region — overshooting the true visible extent
(e.g. `l=-20, r=50` → left 0%, width 70% instead of 50%). In practice this is
unreachable because the picker `min` bound equals `union.start` and every
`applyWindow` target (including the include-cost intersection) stays within the
current window ⊆ picker bounds, so `activeWindow.start >= union.start`. Filed as INFO
(defensive robustness, not a live bug). The same pattern on the per-row bars
(:107-112) is provably safe since every row's span is within the union by
construction.

**Fix:** Clamp both endpoints before subtracting, so the width is always the visible
span: `bandWidth = clampPct(r) - clampPct(l)` (and likewise for the row `width`).

### IN-02: `includeCostFor` floor-at-1 branch is technically live but its guard reads as dead

**File:** `src/app/(dashboard)/allocations/components/ScenarioComposer.tsx:525-527`
**Issue:**
`if (months === 0 && shrinkDays > 0) months = 1;` — because the button only renders
when a bound actually moved, `shrinkDays` is always `>= 1` here, so the `shrinkDays > 0`
half of the guard is always true and could confuse a future reader into thinking a
zero-shift path exists. The floor itself is correct and necessary (a 1-day shift
rounds to 0 months → floored to 1). Purely a readability note.

**Fix:** Drop the redundant `&& shrinkDays > 0` (the caller contract guarantees it),
or add a one-line comment that `shrinkDays >= 1` is an invariant of the call site so
the guard's intent (round-0 → 1, not zero-shift) is unambiguous.

### IN-03: CoverageTimeline collapse state does not persist (no `storageKey`), unlike sibling CollapsibleSections

**File:** `src/app/(dashboard)/allocations/components/CoverageTimeline.tsx:94-99`
**Issue:**
`CoverageTimeline` mounts `CollapsibleSection` with `id="scenario-coverage-timeline"`
and `defaultOpen={false}` but **no** `storageKey` prop. `CollapsibleSection` gates
persistence on `Boolean(storageKey)` (CollapsibleSection.tsx:88), so the gantt
re-collapses on every reload — it does not remember a user who expanded it, unlike
the factsheet/composer-collapse sections. This is consistent with the "tertiary
collapsed-by-default disclosure" intent and correctly avoids creating an
unregistered localStorage key, so it is not a defect — flagged only so the
divergence from sibling sections is a conscious, documented choice rather than an
oversight. (Note: `id` is *not* the persistence key; `storageKey` is the separate
prop — a common confusion worth a one-line comment here.)

**Fix (optional):** If persistence is intended, add
`storageKey="composer-collapse:coverage-timeline"` (the `composer-collapse:` prefix
is already registered). If non-persistence is intended, add a brief comment saying so
to preempt a "missing storageKey" follow-up.

---

_Reviewed: 2026-07-01T22:09:42Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
