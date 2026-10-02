---
phase: 31-graphs-lead-layout-collapsible-controls
verified: 2026-06-23T19:45:00Z
status: passed
score: 5/5
overrides_applied: 0
human_verification_resolved: "2026-06-24 — all 3 items confirmed live via headed-browser /qa (Playwright MCP, user-provided allocator login on prod). (31a LAYOUT) collapsing 'Strategies & weights' hides the controls list and the factsheet graphs lead the surface (screenshot qa-p31-collapsed-state.png; details.open=false, affordance flips Hide→Show; HIDE-not-UNMOUNT confirmed — list stays in DOM but is visually clipped). (31b PERSIST) collapse choice survives reload (composer-collapse:controls='closed', details stays closed). (31c FACTSHEET RESET) on a strategy factsheet, collapsing Performance+Distribution then 'Reset view' re-opens ALL sections (allOpen=true); 0 console errors on composer + factsheet."
human_verification:
  - test: "Collapse the composition controls in the live allocator composer"
    expected: "The 'Strategies & weights' section collapses (hides) and the factsheet-grade graphs (Correlation, Returns distribution, Rolling) occupy the full surface; a 'Show' affordance appears. The panel is toggled open/closed by clicking the summary row."
    why_human: "DOM order and visual surface priority can only be confirmed by seeing the rendered UI. Vitest confirms the wrap is present and the elements are in the correct structural order, but cannot verify that collapsing actually makes the graphs visually lead (CSS / scroll position)."
  - test: "Collapse choice persists across a page reload"
    expected: "If you collapse the controls and reload, the controls stay collapsed. If you expand and reload, they stay expanded. The composer-collapse:controls key in localStorage reflects the choice."
    why_human: "useCrossTabStorage + localStorage persistence requires a real browser environment; jsdom does not fully exercise the StorageEvent / cross-tab wiring or the actual localStorage read at page load."
  - test: "Factsheet 'Reset view' still opens all sections"
    expected: "On any factsheet page, clicking 'Reset view' in the control bar still pops every section open; the 'Hide'/'Show' affordance on each section still fires the factsheet_v2_section_toggle analytics event."
    why_human: "The event-name rename (FACTSHEET_OPEN_ALL_EVENT → COLLAPSIBLE_OPEN_ALL_EVENT) and analytics callback migration require a live render to confirm end-to-end; the factsheet vitest suite passes but does not run in a real browser."
---

# Phase 31: Graphs-Lead Layout & Collapsible Controls — Verification Report

**Phase Goal:** The strategy composition controls (toggle/weight/leverage = CompositionList) are collapsible so the factsheet-grade graphs lead the surface — and collapsing preserves every in-progress weight and leverage edit (HIDE, never UNMOUNT).
**Verified:** 2026-06-23T19:45:00Z
**Status:** passed (3/3 human gates resolved via headed-browser /qa 2026-06-24 — see human_verification_resolved)
**Re-verification:** 2026-06-24 — human gates only

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | An allocator can collapse/hide the composition controls so the graphs lead, and re-expand them | ✓ VERIFIED | `ScenarioComposer.tsx:2263-2285` wraps `<CompositionList>` in `<CollapsibleSection id="composer-composition-controls" title="Strategies & weights" defaultOpen storageKey="composer-collapse:controls">`. Phase-30 graph panels (Correlation ~L2065, Returns distribution ~L2085, Rolling ~L2135) render above the wrap in DOM order — verified by line numbers. Native `<details>` provides the show/hide toggle with keyboard accessibility. |
| 2 | Collapsing preserves in-progress weight + leverage edits (type weight + set leverage, collapse, expand → both intact, no reset) AND the projection behind the collapsed panel still reflects them | ✓ VERIFIED | `ScenarioComposer.test.tsx:3545-3647` ("LAYOUT-02 collapsing the composition controls…") is a non-vacuous regression test: edits to weight=0.25 (≠ seeded 0.5 default) and leverage=2 (≠ 1× default), asserts projection TWR+volatility moved off baseline, collapses, asserts inputs still queryable (not null — not unmounted), asserts projection unchanged while collapsed, re-expands, asserts both input values AND projection unchanged. `leverageByRef` is declared at `ScenarioComposer.tsx:502`, which is `function CompositionList` at line 2419 — edit state is above the collapsible boundary. No conditional `{open && <CompositionList` pattern found in grep of the file. |

**Score:** 5/5 truths verified

### Exit Gate Verification

| Gate | Required | Status | Evidence |
|------|----------|--------|----------|
| CollapsibleSection lifted to src/components/ui/ | Yes | ✓ VERIFIED | File exists at `src/components/ui/CollapsibleSection.tsx`; old path `src/app/factsheet/[id]/v2/CollapsibleSection.tsx` confirmed GONE. |
| FactsheetView repointed, factsheet behavior unchanged | Yes | ✓ VERIFIED | `FactsheetView.tsx:18` imports from `@/components/ui/CollapsibleSection`. 6 `factsheet-collapse:` storageKey strings confirmed unchanged (count=6). `COLLAPSIBLE_OPEN_ALL_EVENT` dispatched at `FactsheetView.tsx:844`. All 6 sections wire `onToggle` firing `factsheet_v2_section_toggle` with correct section literal. Zero `FACTSHEET_OPEN_ALL_EVENT` references anywhere in `src/`. |
| Hide-don't-unmount: CompositionList unconditional child | Yes | ✓ VERIFIED | `ScenarioComposer.tsx:2269`: `<CompositionList` is a direct child of `<CollapsibleSection>` with no JS expression boundary. Grep for `&&.*CompositionList` and `{open.*CompositionList` returns nothing. Phase-31 guard's no-conditional-mount assertion (including parenthesized/ternary/fragment forms — WR-01 fix applied) passes. |
| Edit state in parent above collapsible boundary | Yes | ✓ VERIFIED | `leverageByRef` useState at line 502; `CompositionList` function starts at line 2419. Edit state (`leverageByRef`, `scenario.draft.weightOverrides`) lives in the parent ScenarioComposer, above the collapsible boundary. |
| Non-vacuous state-survival regression test present + passing | Yes | ✓ VERIFIED | `ScenarioComposer.test.tsx:3545`. Edits non-default weight (0.250 ≠ seeded 0.500) and leverage (2 ≠ 1). Asserts projection moved off baseline (non-vacuity). Asserts survival after collapse+expand. Reported 77 tests passing in ScenarioComposer.test.tsx. |
| phase-31-frozen-spine-guards.test.ts present + both assertions | Yes | ✓ VERIFIED | `src/__tests__/phase-31-frozen-spine-guards.test.ts` present (5 tests). Asserts `scenario.ts` and `scenario.test.ts` zero-diff. No-conditional-mount guard catches inline, parenthesized, and fragment forms (WR-01 fix applied — self-pins at lines 265-269). WR-02 (first vs last CollapsibleSection) fixed: uses `lastIndexOf("<CollapsibleSection", compIdx)`. Fail-loud baseline resolution with FALLBACK_BASE_SHA. |
| CR-01 closed: composer-collapse: registered + KNOWN_APP_KEYS updated | Yes | ✓ VERIFIED | `storage-namespaces.ts:30`: `"composer-collapse:"` present in `APP_NAMESPACED_PREFIXES`. `SignOutButton.test.tsx:135`: `"composer-collapse:controls"` present in KNOWN_APP_KEYS inventory. Cross-account leak fixed. |

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/components/ui/CollapsibleSection.tsx` | Lifted, factsheet-agnostic CollapsibleSection + neutral open-all event constant + optional onToggle | ✓ VERIFIED | Exists. `COLLAPSIBLE_OPEN_ALL_EVENT = "collapsible-section:open-all"` at line 16. `onToggle?(open: boolean): void` prop at line 53. No `factsheet-analytics` import. useCrossTabStorage + rawStringCodec wiring preserved verbatim. |
| `src/components/ui/CollapsibleSection.test.tsx` | Migrated tests with neutral event name + onToggle spec | ✓ VERIFIED | File exists. SUMMARY confirms 11 tests passing. Imports `COLLAPSIBLE_OPEN_ALL_EVENT`; vi.mock of factsheet-analytics removed. |
| `src/app/factsheet/[id]/v2/FactsheetView.tsx` | Repointed to lifted primitive, analytics preserved via onToggle | ✓ VERIFIED | Imports from `@/components/ui/CollapsibleSection`. Dispatches `COLLAPSIBLE_OPEN_ALL_EVENT`. All 6 sections have `onToggle` firing `factsheet_v2_section_toggle`. |
| `src/app/(dashboard)/allocations/components/ScenarioComposer.tsx` | CompositionList wrapped in CollapsibleSection (unconditional child); composer-scoped storageKey | ✓ VERIFIED | `CollapsibleSection` imported at line 81. Wrap at lines 2263-2285. `storageKey="composer-collapse:controls"`. CompositionList is unconditional. |
| `src/app/(dashboard)/allocations/components/ScenarioComposer.test.tsx` | Non-vacuous LAYOUT-02 regression test | ✓ VERIFIED | Test at lines 3545-3647. Reads non-default weight + leverage, proves projection moved, collapses, proves inputs survive, re-expands, proves both inputs and projection unchanged. |
| `src/__tests__/phase-31-frozen-spine-guards.test.ts` | Phase-31 exit-gate guard: scenario.ts zero-diff + no-conditional-mount | ✓ VERIFIED | 5 tests: baseline resolution, scenario.ts zero-diff, scenario.test.ts zero-diff, wrap-present, no-conditional-mount (with WR-01 + WR-02 fixes incorporated). |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `FactsheetView.tsx` | `src/components/ui/CollapsibleSection.tsx` | `import { CollapsibleSection, COLLAPSIBLE_OPEN_ALL_EVENT }` | ✓ WIRED | Confirmed at FactsheetView.tsx:18 |
| FactsheetView ControlBar Reset view | every CollapsibleSection in factsheet tree | `window.dispatchEvent(new Event(COLLAPSIBLE_OPEN_ALL_EVENT))` | ✓ WIRED | Confirmed at FactsheetView.tsx:844 |
| `ScenarioComposer.tsx` | `src/components/ui/CollapsibleSection.tsx` | `import { CollapsibleSection }` | ✓ WIRED | Confirmed at ScenarioComposer.tsx:81 |
| CollapsibleSection (collapsed) | CompositionList | unconditional child — always mounted | ✓ WIRED | Confirmed at ScenarioComposer.tsx:2268-2285; no `{open &&` or ternary gate found |
| leverageByRef + scenario.draft.weightOverrides (parent state) | projection panels | parent useState at line 502 read by graph panels regardless of collapse | ✓ WIRED | leverageByRef at line 502 (parent); CompositionList definition at line 2419; edit state correctly above the boundary |
| `composer-collapse:` prefix | purgeAppNamespacedStorage | `APP_NAMESPACED_PREFIXES` + KNOWN_APP_KEYS inventory | ✓ WIRED | storage-namespaces.ts:30 + SignOutButton.test.tsx:135 |

### Behavioral Spot-Checks

Step 7b: SKIPPED — the phase produces client-side React UI only; there are no runnable API endpoints or CLI entry points to probe without a running Next.js server. Behavioral correctness is carried by the non-vacuous vitest regression test.

### Probe Execution

Step 7c: No probe scripts declared or applicable. This is a UI-only phase with no migrations, CLI tools, or data pipelines.

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|------------|-------------|--------|----------|
| LAYOUT-01 | 31-01, 31-02 | Strategy composition controls collapsible so graphs lead | ✓ SATISFIED | CollapsibleSection lifted (31-01) and applied to ScenarioComposer wrapping CompositionList (31-02); Phase-30 graph panels render above in DOM order |
| LAYOUT-02 | 31-02 | Collapsing preserves in-progress weight + leverage edits (hide, never unmount) | ✓ SATISFIED | Native `<details>` keeps CompositionList mounted; edit state in parent; non-vacuous regression test at ScenarioComposer.test.tsx:3545 proves survival end-to-end |

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| (none) | — | — | — | No TBD/FIXME/XXX markers found in any phase-modified file. No stub returns or empty implementations found in the collapsible wiring. |

### Human Verification Required

#### 1. Live collapse/expand of composition controls

**Test:** Open the allocator composer in a browser. Click the "Strategies & weights" summary bar.
**Expected:** The composition controls collapse/hide, and the factsheet-grade graphs (correlation, returns distribution, rolling) visually occupy the full width. A "Show" affordance appears on the summary. Clicking again re-expands the controls.
**Why human:** CSS layout and visual surface leadership cannot be verified by static code inspection or jsdom; only a real browser render confirms the graphs lead the surface when the controls are collapsed.

#### 2. Collapse state persists across reload

**Test:** Collapse the controls, reload the page. Then expand and reload again.
**Expected:** The collapsed/expanded state is restored from `composer-collapse:controls` in localStorage. State survives reload.
**Why human:** localStorage persistence through useCrossTabStorage requires a real browser; jsdom does not exercise StorageEvent wiring or actual page reload.

#### 3. Factsheet "Reset view" still works

**Test:** On any factsheet page with sections collapsed, click "Reset view" in the control bar.
**Expected:** All sections pop open. User toggles on sections still fire the `factsheet_v2_section_toggle` analytics event (verifiable via network/analytics inspector).
**Why human:** The event-name rename and onToggle callback migration are unit-tested, but end-to-end confirmation (real DOM + real analytics) requires a browser render.

### Gaps Summary

No gaps. All 5 must-haves verified in code. The REVIEW's CR-01 (cross-account localStorage leak) was applied in commit `1cfdc24a` before this verification: `composer-collapse:` is registered in `APP_NAMESPACED_PREFIXES` and `KNOWN_APP_KEYS`. The REVIEW's WR-01 (parenthesized conditional-mount false-negative) was also applied: the frozen-spine guard now catches parenthesized and fragment forms and has self-pinning assertions. WR-02 (FIRST vs LAST CollapsibleSection anchor) was applied: guard uses `lastIndexOf`. Three INFO findings (sentryArea attribution, docstring example, redundant defaultOpen={true}) are cosmetic and do not affect correctness.

---

_Verified: 2026-06-23T19:45:00Z_
_Verifier: Claude (gsd-verifier)_
