---
phase: 58-coverage-legibility-disclosure
verified: 2026-07-02T00:30:00Z
status: passed
score: 12/12 must-haves verified
overrides_applied: 0
re_verification: false
human_verification:
  - test: "Open /allocations composer, expand 'Coverage timeline', confirm bar proportions and window-band overlay visually align with the axis endpoints"
    expected: "Bars are proportionally positioned relative to the union start/end axis; the shaded band correctly frames [winStart,winEnd]; amber bars for auto-excluded strategies agree in colour with their row chips; accent bars for in-blend strategies are clearly green"
    why_human: "Pixel-level layout proportionality (leftPct/widthPct correctness against real Recharts-free div bars) requires visual inspection; cannot be asserted programmatically without a full browser rendering pipeline"
  - test: "Open /allocations composer with a mixed book, confirm the BlendHeader is visually the PRIMARY anchor — reads first, above the window control, with typography heavier than the chips"
    expected: "The blend header ('Mean of N strategies · start–end') sits above the coverage-window control and is visually prominent; the timeline toggle and row chips are clearly subordinate"
    why_human: "Visual hierarchy and reading order weight are design judgements not verifiable by DOM traversal alone"
---

# Phase 58: Coverage Legibility & Disclosure Verification Report

**Phase Goal:** The allocator can see, at a glance, which strategies are in the blend and why — coverage spans (mini-gantt), per-row state with reasons (three-state chips), the honest blend header, the cost of including a dropped strategy, and a one-time note that the default changed from full range to the common period.

**Verified:** 2026-07-02T00:30:00Z
**Status:** human_needed — all automated checks pass (12/12 must-haves verified); 2 purely visual/layout items require human inspection before final sign-off.
**Re-verification:** No — initial verification.

---

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|---------|
| 1 | An always-visible blend header states "Mean of {N} strategies · {effStart}–{effEnd}" above the coverage-window control, reading the engine's member_count / effective_start / effective_end | VERIFIED | `BlendHeader.tsx:37–47` reads `metrics.member_count ?? 0`, `metrics.effective_start`, `metrics.effective_end` only. Rendered at `ScenarioComposer.tsx:2987–2991` above the `data-testid="scenario-coverage-window"` div at line 3003. |
| 2 | The header degrades honestly: N=1 → "1 strategy — not a blend", N=0 → "No strategies span the selected window", appends "· window truncated from full range" when effective window narrower than union | VERIFIED | `BlendHeader.tsx:56–77` implements all four branches with lexicographic compare. 6-test suite in `BlendHeader.test.tsx` — all 6 green (observed). |
| 3 | Each strategy row can render a three-state chip (In blend / Excluded / Outside window) whose state is derived from selected + coverageEligible — never a locally recomputed covers() | VERIFIED | `CoverageStateChip.tsx:24–47` has zero imports from `@/lib/scenario-window`; zero `covers(` calls (grep confirmed 0). State is received as prop. Wired in `ScenarioComposer.tsx` inline from `enabled` + threaded `coverageEligible` prop. 5-test suite in `CoverageStateChip.test.tsx` — all 5 green. |
| 4 | As the window moves so a member drops, the header's N and the engine's member_count fall together (single-source membership) | VERIFIED | `ScenarioComposer.test.tsx:5314` COVERAGE-03 integration test asserts `header.textContent` contains `Mean of ${baseN} strategies ·` and degrades to "1 strategy — not a blend" in lockstep with the REAL `computeScenario` member_count changing 2→1. Test passes. |
| 5 | The composer.coverageDefaultChangeNoteDismissed localStorage prefix is registered so the sign-out purge reaches it | VERIFIED | `storage-namespaces.ts:31` has `"composer."` (grep: 1 match). `SignOutButton.test.tsx` has `"composer.coverageDefaultChangeNoteDismissed"` in `KNOWN_APP_KEYS` (grep: 1 match). |
| 6 | Each auto-excluded row carries the amber "Outside window" CoverageStateChip alongside its existing coverageDropReason text | VERIFIED | `ScenarioComposer.tsx:3924` renders `<CoverageStateChip state="auto-excluded" />`; `ScenarioComposer.tsx:3926` retains `data-testid="auto-excluded-reason"` span (additive, not rebuilt). |
| 7 | Each auto-excluded row offers a one-click Include button whose cost is visible in the label before applying | VERIFIED | `ScenarioComposer.tsx:3932–3977` renders the include `<button>` with verbatim labels for all three `movedBound` cases: tail→"shortens window to {end}", head→"moves window start to {start}", both→"shortens window to {start}–{end}". WR-01 and WR-02 fixed at commit `232c80f8`. |
| 8 | Clicking Include narrows the window via the existing applyWindow path so the strategy becomes a member and member_count rises | VERIFIED | `ScenarioComposer.tsx:3740–3743` — `onInclude` calls only `applyWindow(row.includeCost!.target)`. COVERAGE-04 integration test (line 5355) asserts REAL `computeScenario` member_count rises after click. Test passes. |
| 9 | Include never reselects a manually-excluded (selected===false) strategy — manual-off stays sticky | VERIFIED | `onInclude` never touches `deAliased.state.selected` (grep of diff: 0 `setSelected`/`state.selected`/`onToggle` on added lines). T-58-05 invariant test at `ScenarioComposer.test.tsx:5563` asserts `member_ids` never gains the manual-off strategy. Test passes. |
| 10 | A collapsed-by-default Coverage timeline panel shows one bar per selected strategy against the union date axis with active-window band overlay | VERIFIED | `CoverageTimeline.tsx:95–173` wraps in `<CollapsibleSection ... defaultOpen={false}>`. One `<li>` per row computed from `rows` prop. Band overlay rendered at lines 136–141. 8-test suite in `CoverageTimeline.test.tsx` — all 8 green (observed). `utcEpoch` used 5 times; `new Date(` count = 0 (static guard test). |
| 11 | A one-time union→intersection note shows ONLY when intersection truncates union AND not dismissed; dismiss persists; "Show full range" triggers applyWindow(fullRangeWindow) | VERIFIED | `DefaultChangeNote.tsx:70` gates on `isHydrated && !dismissed && intersectionTruncatesUnion`. Uses `useCrossTabStorage` (4 occurrences); zero raw `localStorage`. Key `"composer.coverageDefaultChangeNoteDismissed"` (1 match). `onShowFullRange` prop wired at `ScenarioComposer.tsx:2976` to `applyWindow(fullRangeWindow)`. 6-test suite in `DefaultChangeNote.test.tsx` — all 6 green (observed). |
| 12 | NO engine/number changed — scenario.ts and scenario-window.ts untouched; if a number moves, that is a bug | VERIFIED | `git diff 87ee2d50^1 HEAD -- src/lib/scenario.ts` = 0 lines. `git diff 87ee2d50^1 HEAD -- src/lib/scenario-window.ts` = 0 lines. `git diff 87ee2d50^1 HEAD -- .github/workflows/ci.yml` = 0 lines. No `covers(` call added to ScenarioComposer.tsx render paths (diff grep: 0). |

**Score:** 12/12 truths verified.

---

### Required Artifacts

| Artifact | Min Lines | Actual | Status | Details |
|----------|-----------|--------|--------|---------|
| `src/app/(dashboard)/allocations/components/BlendHeader.tsx` | 30 | 80 | VERIFIED | Four degrade branches; reads ComputedMetrics only; role=status; zero coverageEligible/covers() references |
| `src/app/(dashboard)/allocations/components/CoverageStateChip.tsx` | 20 | 48 | VERIFIED | Record<CoverageState,{label,cls}> lookup; amber auto-excluded; zero scenario-window imports |
| `src/app/(dashboard)/allocations/components/BlendHeader.test.tsx` | (test) | 108 | VERIFIED | 6 tests: N=0, N=1, N>=2 normal, N>=2 truncated, role=status, undefined-as-zero — all green |
| `src/app/(dashboard)/allocations/components/CoverageStateChip.test.tsx` | (test) | 76 | VERIFIED | 5 tests: 3 states × label/cls + base shape + className merge — all green |
| `src/app/(dashboard)/allocations/components/CoverageTimeline.tsx` | 40 | 174 | VERIFIED | utcEpoch x5; new Date(=0; aria-label x3; defaultOpen=false; CollapsibleSection host |
| `src/app/(dashboard)/allocations/components/DefaultChangeNote.tsx` | 30 | 100 | VERIFIED | useCrossTabStorage x4; zero raw localStorage; exact key x1; role=status; verbatim copy x1 |
| `src/app/(dashboard)/allocations/components/CoverageTimeline.test.tsx` | (test) | 189 | VERIFIED | 8 tests: collapsed-default, bar-per-row, accent/amber encoding, aria-label, endpoint labels, empty-rows null, div-by-zero guard, static timezone guard — all green |
| `src/app/(dashboard)/allocations/components/DefaultChangeNote.test.tsx` | (test) | 160 | VERIFIED | 6 tests: hidden/shown/role=status/escape-hatch/dismiss-persists/static-guard — all green |

---

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `BlendHeader.tsx` | `scenarioMetrics.member_count / effective_start / effective_end` | Props from ScenarioComposer | WIRED | `ScenarioComposer.tsx:2989` passes `metrics={scenarioMetrics} unionSpan={fullRangeWindow}` |
| `CoverageStateChip.tsx` | `coverageEligible + selected` | Props from ScenarioComposer (inline in-file CompositionList) | WIRED | In-blend/manual states derived inline from `enabled` + threaded `coverageEligible`; never local `covers()` |
| `AutoExcludedRow include button` | `applyWindow(intersectionOf([currentWindow, strategySpan]))` | `onInclude` callback; `includeCostFor()` delegates to `intersectionOf` | WIRED | `ScenarioComposer.tsx:3740–3743`; `includeCostFor` at line 501–543 uses `intersectionOf` from `scenario-window.ts` |
| `AutoExcludedRow` | `CoverageStateChip state="auto-excluded"` | Amber chip render | WIRED | `ScenarioComposer.tsx:3924` |
| `CoverageTimeline.tsx` | `utcEpoch(parseIsoDay(...))` date→x scale | `dateday.ts` import | WIRED | `CoverageTimeline.tsx:1` imports both; used 5 times; `new Date(` = 0 |
| `DefaultChangeNote.tsx` | `composer.coverageDefaultChangeNoteDismissed` localStorage key | `useCrossTabStorage + rawStringCodec<boolean>` | WIRED | `DefaultChangeNote.tsx:60–66` |
| `DefaultChangeNote "Show full range"` | `applyWindow(fullRangeWindow)` | `onShowFullRange` prop | WIRED | `ScenarioComposer.tsx:2976` wires `onShowFullRange={() => fullRangeWindow && applyWindow(fullRangeWindow)}` |

---

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|---------------|--------|-------------------|--------|
| `BlendHeader.tsx` | `metrics.member_count`, `effective_start/end` | `scenarioMetrics` ComputedMetrics from real `computeScenario` engine | Yes — REAL computeScenario oracle proven by integration test asserting member_count 2→1 in lockstep | FLOWING |
| `CoverageTimeline.tsx` | `rows[*].inBlend` | `coverageEligible[id] === true` from ScenarioComposer memo (same axis :1813 desync guard reconciles) | Yes — derived from same engine axis as member_ids | FLOWING |
| `DefaultChangeNote.tsx` | `intersectionTruncatesUnion` | `ScenarioComposer.tsx:1944–1950` memo using lexicographic compare of `coverageWindow` vs `fullRangeWindow` | Yes — derived from real engine window state | FLOWING |
| `DefaultChangeNote.tsx` | `dismissed` (localStorage) | `useCrossTabStorage` with deferred hydration | Yes — persists and cross-tab syncs via the hardened primitive | FLOWING |

---

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| BlendHeader 4-branch test + role=status | `npx vitest run BlendHeader.test.tsx` | 6/6 passed | PASS |
| CoverageStateChip 3-state label+class | `npx vitest run CoverageStateChip.test.tsx` | 5/5 passed | PASS |
| CoverageTimeline bar encoding + aria + collapsed + static guard | `npx vitest run CoverageTimeline.test.tsx` | 8/8 passed | PASS |
| DefaultChangeNote show/hide/dismiss/escape-hatch/static-guard | `npx vitest run DefaultChangeNote.test.tsx` | 6/6 passed | PASS |

---

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|------------|-------------|--------|---------|
| COVERAGE-01 | 58-03 | Mini-gantt showing each selected strategy's span vs active window | SATISFIED | `CoverageTimeline.tsx` exists (174 lines), substantive, wired in ScenarioComposer. 8 tests green. `utcEpoch` x5, `new Date(`=0. |
| COVERAGE-02 | 58-01, 58-02 | Three-state per-row legibility chips (in-blend / manually-excluded / auto-excluded) | SATISFIED | `CoverageStateChip.tsx` complete. All three states wired: in-blend+manual on composition rows; auto-excluded amber chip on AutoExcludedRow. 5+partial integration tests green. |
| COVERAGE-03 | 58-01 | Always-visible blend header with member count · effective window · honest degradation | SATISFIED | `BlendHeader.tsx` complete. Wired above coverage-window control. Integration test asserts header N === REAL engine member_count. 6 tests green. |
| COVERAGE-04 | 58-02 | One-click include-cost affordance disclosing window cost before applying | SATISFIED | Include button with `includeCostFor` delegating to `intersectionOf`. WR-01/WR-02 fixed (commit 232c80f8). 4 integration tests: tail/head/both-ends/manual-off-sticky. All pass. |
| POLISH-03 | 58-01, 58-03 | One-time union→intersection default-change note with escape hatch; SSR-safe dismiss | SATISFIED | `DefaultChangeNote.tsx` complete. `composer.` prefix registered in storage-namespaces + SignOutButton inventory. 6 tests green. |

---

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| — | — | None found | — | All 8 phase-58 files are clean: zero TBD/FIXME/XXX markers; zero role="alert"; zero `new Date(` in CoverageTimeline; zero raw `localStorage.*` in DefaultChangeNote; zero `text-[Npx]` raw font-px; zero `covers(` in component render paths; zero `text-negative`/red in CoverageStateChip |

---

### Presentation-Only Invariant Verification

The phase declared "if a number moves, that is a bug." Verified:

- `git diff 87ee2d50^1 HEAD -- src/lib/scenario.ts` → **0 lines** (untouched)
- `git diff 87ee2d50^1 HEAD -- src/lib/scenario-window.ts` → **0 lines** (untouched)
- `git diff 87ee2d50^1 HEAD -- .github/workflows/ci.yml` → **0 lines** (untouched)
- `git diff 87ee2d50^1 HEAD -- src/app/(dashboard)/allocations/components/ScenarioComposer.tsx | grep '^+' | grep 'covers('` → **0 matches** (no membership re-derivation added to render paths)
- `intersectionTruncatesUnion` in ScenarioComposer is a pure lexicographic compare of window bounds — it computes no metric, it only detects when to show a note

---

### Human Verification Required

Two items require a human to open the actual browser. These are visual/layout checks that cannot be asserted programmatically without a full browser rendering pipeline.

#### 1. Coverage Timeline Bar Proportions

**Test:** Open `/allocations` composer, add at least two strategies with different data spans, expand the "Coverage timeline" collapsible panel.
**Expected:** Each strategy's bar is positioned proportionally on the shared union axis (a strategy spanning 50% of the union period occupies 50% of the track width). The shaded window-band overlay frames the active [winStart, winEnd] correctly. Auto-excluded strategy bars are amber; in-blend bars are accent green. Both agree with the corresponding row chips.
**Why human:** `leftPct`/`widthPct` pixel-level layout proportionality requires a real browser rendering pipeline. The math is covered by the unit test's `inlineStyle` assertion, but visual confirmation that the bars are not collapsed/overlapping and the band aligns correctly needs a human eye.

#### 2. BlendHeader as Primary Visual Anchor

**Test:** Open `/allocations` composer with a loaded book, read the scenario tab.
**Expected:** The blend header ("Mean of N strategies · start–end") is clearly the first element the eye finds above the coverage-window control; its typography is heavier/larger than the row chips; the timeline toggle is clearly tertiary. The note (if truncation applies and not dismissed) appears above the header.
**Why human:** Visual hierarchy and reading-order weight are design judgements. The DOM order is verified (DefaultChangeNote → BlendHeader → window control → CoverageTimeline), but whether the typographic weight is "primary" per the 58-UI-SPEC is a human call.

---

### Gaps Summary

No gaps. All 5 requirement IDs (COVERAGE-01 through COVERAGE-04 + POLISH-03) have verified artifact delivery, wiring, and behavioral coverage. The two review warnings (WR-01/WR-02) found post-execution were root-cause fixed at commit `232c80f8` with additional branch tests (ScenarioComposer.test.tsx: 134 → 136 passing tests). The coverage ratchet (lines 85.43/stmts 83.28/fns 79.72/branches 76.11) cleared the gate at all four thresholds.

---

_Verified: 2026-07-02T00:30:00Z_
_Verifier: Claude (gsd-verifier)_

## Addendum 2026-07-03 — human_needed items CLOSED by Phase 61

The two human-inspection items (gantt layout proportionality; header visual
hierarchy) were executed live on authed prod during the Phase-61 canary and
PASS: B1 (bars proportional to real spans, screenshot p61-gantt-common.png)
and B2 (primary/secondary hierarchy + honest degrade, p61-blend-header.png).
See .planning/phases/61-authed-prod-canary/61-VERIFICATION.md §B. Phase 58 is
fully verified; effective status: passed.
