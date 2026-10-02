---
phase: 57-window-control-auto-toggle-state-machine
reviewed: 2026-07-01T19:20:00Z
depth: deep
files_reviewed: 4
files_reviewed_list:
  - src/lib/scenario-window.ts
  - src/app/(dashboard)/allocations/components/ScenarioComposer.tsx
  - src/app/(dashboard)/allocations/components/ScenarioComposer.test.tsx
  - src/lib/scenario-window.test.ts
findings:
  blocker: 0
  high: 1
  medium: 2
  low: 2
  nit: 2
  total: 7
status: issues_found
---

# Phase 57: Window Control & Auto-Toggle State Machine — Code Review Report

**Reviewed:** 2026-07-01
**Depth:** deep (cross-file: `scenario-window.ts` ↔ `scenario.ts` engine ↔ `scenario-dealias.ts` ↔ `scenario-state.ts`/`useScenarioState.ts` ↔ composer)
**Files Reviewed:** 4
**Status:** issues_found

## Summary

Phase 57 wires the v1.5 coverage-window blend into the `/allocations` scenario
composer. I reviewed all eight priority areas adversarially and traced the state
machine end-to-end against the real engine (`scenario.ts`), the de-alias collapse
(`scenario-dealias.ts`), and the draft/projection layer (`scenario-state.ts`).

The core is **sound and, in most respects, exemplary**:

- **The window-drop hazard fix (Focus 1) is correct.** `collapseAliasedHoldingStrategies`
  provably drops `state.window` (it reconstructs `{selected,weights,startDates,leverage?}`
  at `scenario-dealias.ts:161-166` with no `window` in the `carry()` closure). The composer
  injects `{ ...deAliased.state, window: coverageWindow }` POST-collapse
  (`ScenarioComposer.tsx:1663-1673`), and the union path is preserved verbatim when
  `coverageWindow === null` (no `window` key). The test `window: MANDATORY member_count
  changes when the window moves` (2→1→2) is the exact proof-of-reach, and `window: …
  the engine receives a state WITHOUT a window key` locks the union path. Correct.
- **Subset-only (WINDOW-03, Focus 2) holds.** `coverageEligible` keys only SELECTED
  strategies (`if (!deAliased.state.selected[s.id]) continue`), never mutates `selected`,
  and the engine's own `activeStrategies = strategies.filter(s => state.selected[s.id])`
  is the second gate. Manual-off (`selected=false`) and coverage-off (`selected &&
  !coverageEligible`) are genuinely distinct — the `auto-excluded: manual-off rows are
  NOT in the group` test pins it.
- **Engine parity (Focus 3) is real.** The UI's `coverageEligible` uses the identical
  `span !== null && covers(coverageSpanOf(returns), window)` predicate as the engine
  (`scenario.ts:264-267`), on the SAME post-collapse strategy set, plus a dev-mode
  `member_ids` cross-check. No inline interval math; no off-by-one.
- **POLISH-01 separation (Focus 7) is enforced** by both a runtime prop-absence assertion
  and a source-grep guard on the `ScenarioFactsheetChart` mount.

The defects below are all in the **guided-fix / disclosure-copy edges**, not the blend
math. The one HIGH is a genuine correctness gap in `outlierIdsFor` that defeats the
WINDOW-06 "not a dead-end" guarantee for 3+ mutually-disjoint strategies.

## High

### HI-01: `outlierIdsFor` can return outliers whose removal does NOT restore overlap (WINDOW-06 dead-end for 3+ mutually-disjoint spans)

**File:** `src/lib/scenario-window.ts:182-188`
**Focus area:** 5 & 6 (`outlierIdsFor` correctness / WINDOW-06 guided fix)

`outlierIdsFor` considers only the two bounding strategies (max-`first`, min-`last`) as
removal candidates. When neither single removal restores overlap it falls through to
`return candidates;` (both) **without verifying that their JOINT removal restores a
non-null intersection.** For a set of 3+ MUTUALLY-disjoint spans this returns ids whose
removal still leaves a disjoint remainder.

Reproduced against the shipped logic:

```
spans = { A:[01-01,02-01], B:[05-01,06-01], C:[09-01,10-01], D:[2024-01-01,02-01] }  // 4 mutually disjoint
outlierIdsFor(spans)            → ["D","A"]
intersectionOf(remainder {B,C}) → null      // INVARIANT VIOLATED
```

The doc-comment (`:150-152`) asserts the REMOVAL-RESTORES-OVERLAP invariant "proven in
the tests" — but the tests only cover ≤3 spans with at most one disjoint outlier
(`scenario-window.test.ts:263-297`); the 3+-mutually-disjoint cell is untested, so the
violation slips through CI. End-to-end this means the WINDOW-06 banner names D and A,
the allocator clicks BOTH "Deselect" buttons, and the banner **persists** — precisely the
dead-end the guided fix exists to prevent (ADR §"UI state machine": "guided fix, not a
dead-end"). Reachable whenever an allocator selects three or more strategies whose live
periods don't mutually overlap (e.g. sequential strategies that each ended before the
next began).

**Fix:** Either (a) verify joint-removal before returning both candidates and, if still
empty, iterate (peel the current max-first / min-last until `intersectionOf(remainder)
!== null`); or (b) return the minimal set greedily:

```typescript
// after the single-removal loop fails, peel iteratively until overlap restores
const remaining = new Map(Object.entries(spansById));
const removed: string[] = [];
while (intersectionOf([...remaining.values()]) === null && remaining.size > 1) {
  // remove the current latest-start OR earliest-end (whichever the overlap needs)
  let mfId = "", mlId = "";
  for (const [id, sp] of remaining) {
    if (!mfId || sp.first > remaining.get(mfId)!.first) mfId = id;
    if (!mlId || sp.last < remaining.get(mlId)!.last) mlId = id;
  }
  const pick = /* the id that, removed, most reduces the max(first)-min(last) gap */ mfId;
  remaining.delete(pick);
  removed.push(pick);
}
return removed;
```

Add a `scenario-window.test.ts` cell for 3 and 4 mutually-disjoint spans asserting the
REMOVAL-RESTORES-OVERLAP invariant on the returned set (the existing invariant-checker
`intersectionAfterRemoving` already exists — extend it to the mutually-disjoint case).

## Medium

### ME-01: Auto-excluded group body copy overstates the drop ("no data across the whole coverage window")

**File:** `src/app/(dashboard)/allocations/components/ScenarioComposer.tsx:3489-3491`
**Focus area:** 8 (honest disclosure) + POLISH-02

The group description reads: *"These selected strategies have **no data across the whole
coverage window**, so they are not in the blend or its divisor."* This is inaccurate for
the common drop case. A strategy is auto-excluded when its span does not *fully cover* (⊇)
the window — e.g. it ended one day before `window.end`, or started one day after
`window.start`. Such a strategy has data across nearly the *entire* window; it simply is
not a full-coverage member. The per-row reason is honest ("ends Jan 2026 — outside
window"), but the group-level sentence contradicts it. Given this milestone's whole
purpose is honest coverage disclosure (ADR: "an honest equal-weight average of
strategies that are all actually live over the shown window"), the misleading summary
undercuts the feature's rationale.

**Fix:** Restate to reflect partial-coverage exclusion, e.g.:
```
These selected strategies do not span the entire coverage window (they start after it
begins or end before it ends), so they are excluded from the blend and its divisor.
Narrow the window (or use Common period) to include them.
```

### ME-02: WINDOW-06 "Deselect (holding)" reintroduces a capability the read-only-tokens model deliberately removed

**File:** `src/app/(dashboard)/allocations/components/ScenarioComposer.tsx:1831-1842` (`deselectOutlier`)
**Focus area:** 5 (deselect handler correctness)

Mechanically this path is **correct**: `defaultDraftFromHoldings` seeds every holding with
`toggleByScopeRef[ref] = true` (`scenario-state.ts:199`), so `scenario.toggleHolding(id)`
genuinely flips a holding to `false` in `projectionState` and drops it — I traced it and
the `WINDOW-06: clicking Deselect …` test with `REF_ETH`/`REF_BTC` holdings passes for the
right reason. The concern is a **design-consistency** one: the composer explicitly adopted
a "read-only-tokens model — live holdings are FIXED context — they cannot be toggled off"
(`ScenarioComposer.tsx:272-277`; `CompositionList` renders holdings with no toggle switch,
`:3732-3789`). The WINDOW-06 banner now hands the user a "Deselect {name} (holding)" button
that toggles a live holding off — a capability the read-only model removed on purpose, and
one that is *not reachable anywhere else in the UI*. A holding deselected via this banner
becomes a silently-off member with no row-level affordance to turn it back on. This is a
real contradiction between two intentional design decisions (Rule 7: surface conflicts,
don't blend them).

**Fix (product call):** Either (a) accept and document that WINDOW-06 is the one sanctioned
place a holding can be dropped, and add a way to restore it (so it isn't a one-way silent
exclusion); or (b) when the outlier is a holding, change the copy to explain that holdings
are fixed context and guide the user to drop the *added* strategy or widen instead — rather
than offering an off-switch the rest of the UI withholds. RESEARCH Open Question #2 flagged
exactly this seam and left it "confirm with the planner"; it shipped without resolution.

## Low

### LO-01: Stale applied window persists when a selection change empties the intersection

**File:** `src/app/(dashboard)/allocations/components/ScenarioComposer.tsx:1641-1652` (seed effect) + `:1811-1829` (`emptyIntersectionOutliers`)
**Focus area:** 2 & 4 (state machine / seeding)

After the window is seeded (`windowTouchedRef.current = true`), adding a strategy whose
span makes the selected intersection empty triggers the WINDOW-06 banner, but the previously
applied `coverageWindow` stays non-null and the engine keeps blending over that *stale*
window while the banner declares "no common period." The engine never fabricates (it honours
the stale window honestly, and the honest empty-state guards zero members), and deselecting
the outlier restores a valid window, so this is not a dead-end or a correctness break — but
the coverage-window readout shows a window the banner simultaneously says doesn't exist,
which is confusing. `Pitfall 3` intentionally seeds once, so this is a consequence of that
design rather than an oversight; flagging for awareness / a possible Phase-58 legibility fix.

**Fix (optional):** When `defaultWindowFor(selectedSpans) === null` and the outliers are the
newly-added members, consider muting the coverage-window value readout (or showing "resolve
the outlier above") so the two panels don't contradict.

### LO-02: `windowBounds.max` can be set to "today," letting the user window past all data into a zero-member state

**File:** `src/app/(dashboard)/allocations/components/ScenarioComposer.tsx:1655-1666`
**Focus area:** 4 / 6

`windowBounds.max = unionMax > today ? unionMax : today`, so when every selected strategy
ended before today the picker permits an end date beyond all data. Applying such a window
drops every member → the engine's honest zero-member empty-state, and the auto-excluded
group lists all selected strategies. This is defensible (the comment justifies it for a
still-running strategy), and the engine guards divide-by-zero, but it lets a user reach a
fully-empty blend with no inline hint of why. Not a bug; noting because it interacts with
LO-01's confusion surface. No fix required if the empty-state copy is clear.

## Nit

### NI-01: `role="alert"` + `aria-live="polite"` on the empty-intersection banner is a mixed signal

**File:** `src/app/(dashboard)/allocations/components/ScenarioComposer.tsx:2749-2752`

`role="alert"` carries an implicit `aria-live="assertive"`; the explicit `aria-live="polite"`
overrides it to polite (the intended non-blocking behavior), so it works — but the pairing is
semantically muddled. A non-blocking, recoverable warning is more precisely `role="status"`
(implicitly polite) — which also matches DESIGN.md's DESIGN-05 convention ("`role="status"` +
`aria-live="polite"` on non-blocking state changes; `role="alert"` on blocking errors"). This
banner is explicitly non-blocking ("guided fix, not a hard stop"). Consider `role="status"`.

### NI-02: Redundant local `localMidnight(isoDayFromDate(new Date()))` where `localMidnightToday()` exists

**File:** `src/app/(dashboard)/allocations/components/ScenarioComposer.tsx:1664`

`dateday.ts` already exports `localMidnightToday()` (`:109`) doing exactly this. Minor
duplication; using the existing helper is marginally clearer and keeps the "today" derivation
in one place. Purely cosmetic.

---

## Verdict

The blend-math substrate of Phase 57 is correct and well-guarded: the post-collapse window
injection (the highest-risk seam) provably reaches the engine, the union path is preserved
byte-for-byte when no window is set, the subset-only invariant holds on both the UI and
engine gates, and `coverageEligible` shares the engine's exact `covers(coverageSpanOf(...))`
predicate with a dev-mode `member_ids` cross-check — so the divisor and the auto-excluded
group cannot silently disagree. The single material defect is **HI-01**: `outlierIdsFor`
violates its own REMOVAL-RESTORES-OVERLAP invariant for three-or-more mutually-disjoint
strategies, turning the WINDOW-06 guided fix into the dead-end it was built to prevent — and
the test suite never exercises that cell, so it passes CI while broken. That, plus the
overstated auto-excluded copy (ME-01) and the unresolved read-only-holding-deselect conflict
(ME-02), should be addressed before this ships; the LOW/NIT items are polish. No BLOCKER
(nothing crashes, corrupts, or leaks; the engine's zero-member guard and null-safety hold
throughout).

**Status: issues_found**

_Reviewed: 2026-07-01T19:20:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: deep_
