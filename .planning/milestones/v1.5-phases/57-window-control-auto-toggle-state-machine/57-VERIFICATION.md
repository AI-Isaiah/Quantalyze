---
phase: 57-window-control-auto-toggle-state-machine
verified: 2026-07-01T19:40:00Z
status: passed
score: 8/8 must-haves verified
overrides_applied: 0
deferred:
  - truth: "WINDOW-06 'Deselect (holding)' contradicts the read-only-tokens model (ME-02)"
    addressed_in: "Phase 58 or product call"
    evidence: "ME-02 is a design-consistency surface flag, not a correctness break. The mechanism is provably correct (toggleHolding flips a genuine draft toggle). A product decision is needed on whether holdings can be deselected via this path or the copy should redirect. Acknowledged by reviewer as 'product call'; deferred per verification mandate."
  - truth: "Stale applied window persists when a selection change empties the intersection (LO-01)"
    addressed_in: "Phase 58"
    evidence: "LO-01 is a confusing-but-not-broken state (the engine is honest, the empty-state guard holds). Phase 58 delivers coverage legibility including the window readout panel — the 'resolve the outlier above' hint is the natural Phase-58 seam."
  - truth: "windowBounds.max can be today, allowing a fully-empty blend (LO-02)"
    addressed_in: "Phase 58 or Phase 61"
    evidence: "LO-02 is explicitly defensible (the comment justifies it for still-running strategies; the engine's zero-member guard holds). Phase 58 can clarify the empty-state copy if needed."
---

# Phase 57: Window Control & Auto-Toggle State Machine — Verification Report

**Phase Goal:** The allocator can steer the coverage window and watch membership auto-adjust honestly — intersection is the default + snap target, widening drops non-covering members, narrowing restores them (within the selected subset only), and an empty intersection is a guided fix, not a dead end.
**Verified:** 2026-07-01T19:40:00Z
**Status:** PASSED
**Re-verification:** No — initial verification

---

## Step 0: Prior Verification

No prior VERIFICATION.md found. Proceeding in initial mode.

---

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Default window = intersection (`defaultWindowFor`); seeded once via `windowTouchedRef` (never re-snaps a user narrow) | VERIFIED | `ScenarioComposer.tsx:782-788,1647-1651`: `windowTouchedRef.current` guards the seed effect; `defaultWindowFor(selectedSpans)` is the seeder. |
| 2 | Window reaches the engine POST-collapse (the `collapseAliasedHoldingStrategies` drop hazard is mitigated) | VERIFIED | `ScenarioComposer.tsx:1706-1708`: `engineState = coverageWindow ? { ...deAliased.state, window: coverageWindow } : deAliased.state` — post-collapse injection. Test "MANDATORY member_count changes when the window moves" (2→1→2) is the proof of reach. |
| 3 | Widen → strategy auto-excluded; narrow → restored; ONLY within selected subset; NEVER auto-adds an unselected strategy | VERIFIED | `ScenarioComposer.tsx:1728-1742`: `coverageEligible` loops SELECTED strategies only (`if (!deAliased.state.selected[s.id]) continue`), never mutates `selected`. WINDOW-02 (2→1), WINDOW-03 (1→2), subset-only, and no-mutate tests all pass (130/130). |
| 4 | "Common period (all in)" = intersection; "Full range (some drop out)" = union | VERIFIED | `ScenarioComposer.tsx:1694,1697`: `commonPeriodWindow = defaultWindowFor(selectedSpans)`; `fullRangeWindow = unionOf(selectedSpans)`. WINDOW-04 and WINDOW-05 tests pass. |
| 5 | Empty intersection → warning banner naming outlier(s) + one-click deselect that restores a valid intersection | VERIFIED | `ScenarioComposer.tsx:2749-2790`: banner with `role="status"` / `aria-live="polite"` renders `emptyIntersectionOutliers` (via `outlierIdsFor`). Deselect-restores-intersection test passes. |
| 6 | `outlierIdsFor` GUARANTEES removal-restores-overlap for 3+ mutually-disjoint spans (HI-01 fixed) | VERIFIED | `scenario-window.ts:165-234`: greedy peel replaces the broken two-candidate shortcut. 30/30 scenario-window tests pass, including cells "3 MUTUALLY-disjoint spans (HI-01 regression)" and "4 MUTUALLY-disjoint spans (reviewer repro)". |
| 7 | Coverage window is a distinct axis from brush-zoom / `rollingWindow` / `startDates` (POLISH-01) | VERIFIED | `ScenarioComposer.tsx:765-771`: POLISH-01 comment documents the four-axis separation. POLISH-01 guard tests (4) pass: rolling-window change leaves `state.window` unchanged, factsheet brush receives no coverage-window prop and stays `persist={false}`, coverage-window change leaves `rollingWindow` and `startDates` untouched. |
| 8 | Auto-toggle animates with `motion-reduce:transition-none` (POLISH-02) | VERIFIED | `ScenarioComposer.tsx:3659`: `AutoExcludedRow` carries `transition-all duration-300 ease-out motion-reduce:transition-none` on the single transition element. Animation test asserts `duration-300` + `motion-reduce:transition-none` present (POLISH-02 test passes). |

**Score:** 8/8 truths verified

---

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/lib/scenario-window.ts` | `unionOf(spans)` + `outlierIdsFor(spansById)` pure helpers; greedy-peel invariant fix | VERIFIED | All 6 exports confirmed via grep. `outlierIdsFor` uses greedy peel (lines 194-231). `unionOf` mirrors `intersectionOf` (opposite direction, lines 97-106). |
| `src/lib/scenario-window.test.ts` | 30 tests including disjoint-invariant regression cells | VERIFIED | 30 passed: 5 `unionOf` + 9 `outlierIdsFor` (incl. 3-disjoint and 4-disjoint HI-01 cells) + existing suite. |
| `src/app/(dashboard)/allocations/components/ScenarioComposer.tsx` | `winStart/winEnd` state, post-collapse injection, `coverageEligible` memo, `autoExcluded` group, WINDOW-06 banner, presets | VERIFIED | All identifiers found: `winStart`/`winEnd` at :782, `windowTouchedRef` at :788, post-collapse injection at :1706-1708, `coverageEligible` at :1728, `autoExcluded` at :1752, `emptyIntersectionOutliers` at :1810, `CustomRangePicker` at :138. |
| `src/app/(dashboard)/allocations/components/ScenarioComposer.test.tsx` | 130 tests incl. all requirement-mapped describes | VERIFIED | 130 passed. Describe blocks confirmed: `coverage window (WINDOW-01, hazard fix)`, `coverage-window presets (WINDOW-04/05)`, `POLISH-01 separation guard`, `auto-toggle (WINDOW-02/03)`, `auto-excluded group (POLISH-02)`, `empty-intersection banner (WINDOW-06)`. |

---

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `ScenarioComposer.tsx` window injection | `computeScenario(deAliased.strategies, engineState, dateMapCache)` | `engineState = win ? { ...deAliased.state, window: coverageWindow } : deAliased.state` at :1706-1708 | VERIFIED | Post-collapse, not on `projectionState`. Member_count-changes test proves the window reaches the engine. |
| `ScenarioComposer.tsx` preset buttons | `scenario-window.ts` `defaultWindowFor` / `unionOf` | `commonPeriodWindow` and `fullRangeWindow` memos at :1694/1697 | VERIFIED | No inline interval math; helpers consumed directly. |
| `ScenarioComposer.tsx` `coverageEligible` memo | `scenario-window.ts` `covers` / `coverageSpanOf` | `covers(span, coverageWindow)` at :1740; span computed via `coverageSpanOf(s.daily_returns)` at :1738 | VERIFIED | `grep "covers(coverageSpanOf"` returns 0 (span is computed then passed to covers — functionally identical, documented in memo comment). The shared predicate is used; no inline `span.first <= ...` math. |
| `ScenarioComposer.tsx` WINDOW-06 banner deselect | `scenario-window.ts` `outlierIdsFor` + `handleRemoveAdded` / `scenario.toggleHolding` | `outlierIdsFor(spansById)` at :1815-1824; `deselectOutlier` routes by kind at :1831-1842 | VERIFIED | `grep "outlierIdsFor"` in ScenarioComposer confirms shared helper used (no inline outlier math). |
| `ScenarioComposer.tsx` presets + picker | `CustomRangePicker` (reused, not forked) | `import { CustomRangePicker } from "./CustomRangePicker"` at :138; `pickerOpen` state pattern mirrors EquityChart canonical mount | VERIFIED | `grep "CustomRangePicker"` in ScenarioComposer shows reuse; no new picker component file created. |

---

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| All scenario-window tests green including HI-01 regression cells | `npx vitest run src/lib/scenario-window.test.ts` | 30/30 passed (incl. 3-disjoint + 4-disjoint cells) | PASS |
| All ScenarioComposer tests green | `npx vitest run "src/app/(dashboard)/allocations/components/ScenarioComposer.test.tsx"` | 130/130 passed | PASS |
| Downstream engine + dealias suites unaffected | `npx vitest run src/lib/scenario-window.test.ts src/lib/scenario.test.ts src/lib/scenario-dealias.test.ts` | 99/99 passed | PASS |
| TypeScript clean | `npx tsc --noEmit` | Exit 0 (no output) | PASS |
| Coverage gates hold | `npm run test:coverage` | 7300/7588 passed; lines 85.43% ≥ 82, stmts 83.34% ≥ 80, fns 79.76% ≥ 74, branches 76.07% ≥ 72 | PASS |

---

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|-------------|-------------|--------|----------|
| WINDOW-01 | 57-02 | Default window = intersection; seeded once; not re-snapped | SATISFIED | `windowTouchedRef` guard; `defaultWindowFor` seed at :1647-1651; "seeds once" test passes. |
| WINDOW-02 | 57-03 | Widen → strategy auto-excluded from blend + divisor | SATISFIED | `coverageEligible` + `autoExcluded` memos; member_count 2→1 test passes. |
| WINDOW-03 | 57-03 | Narrow → restored; subset-only (no unselected strategy added) | SATISFIED | Narrow 1→2 test + subset-only guard test both pass; `selected` no-mutate test passes. |
| WINDOW-04 | 57-02 | "Common period (all in)" preset = intersection | SATISFIED | `commonPeriodWindow = defaultWindowFor(selectedSpans)`; preset test asserts all-in. |
| WINDOW-05 | 57-01, 57-02 | "Full range (some drop out)" preset = `unionOf`; non-covering members drop | SATISFIED | `unionOf` helper in `scenario-window.ts`; `fullRangeWindow = unionOf(selectedSpans)`; preset test asserts non-covering dropped. |
| WINDOW-06 | 57-01, 57-03 | Empty intersection → banner names outlier(s) + one-click deselect restores valid intersection | SATISFIED | `outlierIdsFor` (greedy-peel, HI-01 fixed); banner with `role="status"`/`aria-live="polite"`; deselect-restores-intersection test passes. |
| POLISH-01 | 57-02 | Coverage window distinct from brush-zoom / rollingWindow / startDates | SATISFIED | POLISH-01 guard test (4 cases) passes; documented at :765-771. |
| POLISH-02 | 57-03 | Auto-toggle animates with `motion-reduce:transition-none` | SATISFIED | `AutoExcludedRow` at :3659 carries `duration-300 ease-out motion-reduce:transition-none`; motion test passes. |

---

### Anti-Patterns Found

| File | Pattern | Severity | Disposition |
|------|---------|----------|-------------|
| `ScenarioComposer.tsx` | ME-02: WINDOW-06 "Deselect (holding)" affordance contradicts read-only-tokens model | DEFERRED | Mechanically correct; design-consistency product call deferred to Phase 58 per user acceptance (noted in 57-REVIEW.md). Not a gap for this phase. |
| `ScenarioComposer.tsx` | LO-01: Stale window persists when adding a strategy empties the intersection | INFO | Not a dead-end; engine is honest. Phase 58 legibility note. |
| `ScenarioComposer.tsx` | LO-02: `windowBounds.max` permits windowing past all data | INFO | Defensible (running strategies); engine zero-member guard holds. |

No TBD / FIXME / XXX markers found in phase-modified files. No raw hex / raw px lint violations (ESLint clean on both modified files). No schema version bump. Zero new dependencies.

---

### Code Review Findings Disposition

| Finding | Severity | Status |
|---------|----------|--------|
| HI-01: `outlierIdsFor` violates removal-restores-overlap invariant for 3+ mutually-disjoint spans | HIGH | FIXED in `be37082f`. Greedy-peel algorithm + 2 regression test cells confirmed. |
| ME-01: Auto-excluded group body copy inaccurate ("no data across whole window") | MEDIUM | FIXED in `e6c38816`. Copy now reads "do not span the entire coverage window (they start after it begins or end before it ends)." |
| ME-02: WINDOW-06 "Deselect (holding)" contradicts read-only-tokens model | MEDIUM | DEFERRED. Product call per REVIEW.md; mechanism is correct; recorded in deferred section. |
| NI-01: `role="alert"` + `aria-live="polite"` mixed signal | NIT | FIXED in `e6c38816`. Banner now uses `role="status"` per DESIGN-05. |
| NI-02: Redundant `localMidnight(isoDayFromDate(new Date()))` | NIT | FIXED in `e6c38816`. `localMidnightToday()` now used in `windowBounds` memo. |
| LO-01: Stale window persists on empty-intersection selection change | LOW | DEFERRED to Phase 58 legibility. |
| LO-02: `windowBounds.max` can reach today past all data | LOW | DEFERRED. Defensible per comment; engine guards. |

---

### Surgical Scope Confirmation

Phase 57 touched exactly 4 files (2 production, 2 test):

- `src/lib/scenario-window.ts` — additions only (`unionOf`, `outlierIdsFor` with greedy-peel fix); no existing export signature changed.
- `src/lib/scenario-window.test.ts` — additions only (unionOf + outlierIdsFor describe blocks, HI-01 regression cells).
- `src/app/(dashboard)/allocations/components/ScenarioComposer.tsx` — additive window state + memos + JSX blocks; `SCENARIO_SCHEMA_VERSION` unchanged (15 hits, still v2); no own-book caller behavior changed.
- `src/app/(dashboard)/allocations/components/ScenarioComposer.test.tsx` — additions only (three new describe blocks).

No new files created. No new dependencies added.

---

### Human Verification Required

None — all required truths were verified programmatically via test suite and source inspection. Visual appearance and UX quality (auto-excluded group animation feel, banner placement) are Phase 58 / Phase 61 authed-canary scope. POLISH-02 motion was verified via className assertions per the codebase convention (no JS `matchMedia` needed).

---

## Verdict

**Phase 57 goal is ACHIEVED.** All eight requirements (WINDOW-01 through WINDOW-06, POLISH-01, POLISH-02) are satisfied in the actual codebase:

The coverage-window state machine is correct and sound end-to-end. The window defaults to the intersection, is injected POST-collapse onto `deAliased.state` (the critical hazard fix, proven by the mandatory member_count-changes test), reaches the engine and changes membership visibly, and the two presets work via the shared `scenario-window.ts` helpers. The `coverageEligible` memo reuses the engine's exact `covers(coverageSpanOf(...), window)` predicate so the UI auto-excluded group and the engine divisor are structurally incapable of disagreeing. Subset-only is enforced at both the UI derivation and the engine `activeStrategies` gate. The empty-intersection banner uses the `outlierIdsFor` helper — now upgraded to a greedy-peel algorithm (HI-01 fixed) that guarantees removal-restores-overlap even for 3+ mutually-disjoint spans. All four code-review blockers and nits (HI-01, ME-01, NI-01, NI-02) were fixed before this verification; ME-02/LO-01/LO-02 are explicitly deferred product/legibility items. The full test suite is green (7300 passed, coverage above all gates), `tsc --noEmit` is clean, and the change is surgical (4 files, zero new dependencies, no schema bump).

---

_Verified: 2026-07-01T19:40:00Z_
_Verifier: Claude (gsd-verifier)_
