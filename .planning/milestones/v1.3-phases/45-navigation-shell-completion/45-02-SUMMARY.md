---
phase: 45-navigation-shell-completion
plan: 02
subsystem: ui
tags: [react, nextjs, tailwind, a11y, mobile, tabs, overflow-scroll, scroll-snap, scrollIntoView, prefers-reduced-motion, JOURNEY-03]

# Dependency graph
requires:
  - phase: 45-navigation-shell-completion (Plan 01)
    provides: role-aware MobileNav + inert <main> + app-shell skip-link (mobile chrome the tab strip is tested inside)
  - phase: 19/21 (JOURNEY-03 a11y fix on AllocationsTabs)
    provides: role=tablist contains ONLY role=tab children; Export/+Allocation are siblings (the invariant this plan preserves)
provides:
  - CSS-first horizontally-scrollable allocator tab strip at <sm (all 6 surfaces reachable by scroll, no tab dropped)
  - active-tab scrollIntoView on activeTab change with prefers-reduced-motion handling (behavior:auto when reduce)
  - scroll-snap affordance (snap-x on strip + snap-start shrink-0 on each tab); no edge-fade overlay (DESIGN.md hairline-clean)
  - data-allocator-tabstrip anchor retained for the Plan 03 (Wave 2) 320px nav-shell reflow gate
affects: [45-03 (reflow/target-size e2e anchored on [data-allocator-tabstrip]), 46 (per-surface reflow), composer-axe JOURNEY-03 gate]

# Tech tracking
tech-stack:
  added: []  # zero-new-dependency presentation change
  patterns:
    - "CSS-first responsive scroll strip: flex-nowrap + overflow-x-auto at <sm, sm:flex-wrap sm:overflow-x-visible at >=sm, applied to the SAME role-bearing element (no new role-bearing wrapper) to preserve aria-required-children"
    - "Append-only className composition for parity-pinned consts: scroll-snap classes appended (`${CONST} snap-start shrink-0`) so dashboard-parity Tailwind class order in TAB_BUTTON_* stays byte-identical"
    - "Environment-guarded scrollIntoView: `typeof el.scrollIntoView === 'function'` + `typeof window.matchMedia === 'function'` so the effect no-ops under jsdom/old browsers instead of throwing"

key-files:
  created:
    - .planning/phases/45-navigation-shell-completion/45-02-SUMMARY.md
  modified:
    - src/app/(dashboard)/allocations/AllocationsTabs.tsx

key-decisions:
  - "Applied the scroll classes to the EXISTING role=tablist element itself (not a new wrapper div) — keeps the tabs as unbroken direct children of role=tablist, the minimum-risk way to preserve JOURNEY-03 (a role-less wrapper was the alternative; in-place avoids any new aria-parent entirely)."
  - "scrollIntoView wired in a useEffect keyed on activeTab (fires for click, keyboard arrow-nav, and programmatic ?tab= changes alike) rather than only inside changeTab — covers every activation path, including URL/back-forward driven tab changes that don't go through changeTab."
  - "Reduced-motion: behavior:'auto' (instant) when matchMedia('(prefers-reduced-motion: reduce)').matches, else 'smooth' — never animate a forced scroll for reduced-motion users (UI-SPEC States row)."
  - "No edge-fade gradient/overlay (DESIGN.md no-gradient / hairline-clean); the cut-off peeking tab is itself the scroll affordance."

patterns-established:
  - "Pattern: scroll-snap mobile tab strip preserving an existing ARIA tablist — wrap nothing, restyle the tablist element, append snap utilities to children."
  - "Pattern: jsdom-safe scrollIntoView call site (function-existence guard) avoids polluting shared test-setup for a single component."

requirements-completed: [NAV-02]

# Metrics
duration: ~12min
completed: 2026-06-27
---

# Phase 45 Plan 02: Scrollable Allocator Tab Strip Summary

**CSS-first horizontally-scrollable allocator tab strip at `<sm` (flex-nowrap + overflow-x-auto, scroll-snap, hidden scrollbar) with active-tab `scrollIntoView` honoring prefers-reduced-motion — JOURNEY-03 role=tablist/role=tab siblings and the `data-allocator-tabstrip` anchor preserved.**

## Performance

- **Duration:** ~12 min
- **Started:** 2026-06-27T13:19:00Z (approx)
- **Completed:** 2026-06-27T13:31:14Z
- **Tasks:** 1
- **Files modified:** 1

## Accomplishments
- The six allocator surfaces (Overview / Holdings / Outcomes / Mandate / Risk / Scenario) stay reachable on a phone via a horizontally-scrollable strip at `<sm` — no tab dropped, every tab reachable by scroll, no horizontal PAGE overflow.
- Active tab is scrolled into view on every `activeTab` change (click / keyboard arrow-nav / programmatic `?tab=` / back-forward), honoring `prefers-reduced-motion` (`behavior:"auto"` when reduce, `"smooth"` otherwise).
- Scroll-snap affordance added (`snap-x` on the strip, `snap-start shrink-0` on each tab) with NO edge-fade overlay (DESIGN.md hairline-clean rule).
- JOURNEY-03 a11y fix preserved: the `role="tablist"` element is unchanged structurally (tabs are still its direct children, no role on any wrapper, Export/+Allocation stay siblings).

## Scroll-strip anchor / selectors shipped (for Plan 03's e2e)

- **Reflow-gate anchor (UNCHANGED, retained):** `[data-allocator-tabstrip]` — on the header row container (`AllocationsTabs.tsx:543-546`). Plan 03's 320px `assertNoReflow` should anchor on this.
- **The scrollable strip element:** the `role="tablist"` `<div aria-label="Allocation surfaces">` — now classed `flex flex-nowrap items-center gap-1 overflow-x-auto sm:flex-wrap sm:overflow-x-visible snap-x [scrollbar-width:none] [-webkit-overflow-scrolling:touch]`. Selectable in e2e via `[role="tablist"][aria-label="Allocation surfaces"]` (no new `data-*` attribute was added to the strip — the existing role+aria-label is a stable, semantic selector; each tab also keeps `data-tab-key={key}`).
- **Each tab:** `button[role="tab"][data-tab-key="<key>"]` with appended `snap-start shrink-0`.

## Task Commits

Each task was committed atomically:

1. **Task 1: CSS-first scrollable tab strip preserving JOURNEY-03 + active-tab scrollIntoView** - `f1678271` (feat)

**Plan metadata:** (this SUMMARY + STATE/ROADMAP are local-only — `.planning/` is gitignored; not committed per the sequential-execution contract)

## Files Created/Modified
- `src/app/(dashboard)/allocations/AllocationsTabs.tsx` - Restyled the existing `role="tablist"` to scroll horizontally at `<sm`; appended `snap-start shrink-0` to each tab via className composition (parity-pinned `TAB_BUTTON_*` consts left byte-identical); added an `activeTab`-keyed `useEffect` calling `scrollIntoView` with reduced-motion handling and a function-existence guard.

## Decisions Made
- **In-place restyle of the tablist element (no wrapper):** The UI-SPEC offered either restyling the tablist directly or wrapping it in a role-less `<div>`. Restyling the element itself is the lowest-risk path for JOURNEY-03 — it introduces zero new elements between `role="tablist"` and its `role="tab"` children, so there is no opportunity to accidentally create a new aria-parent. Confirmed exactly one `role="tablist"` JSX element remains.
- **scrollIntoView in a `useEffect([activeTab])` (not only in `changeTab`):** `activeTab` is derived from `searchParams` on every render, so tab changes also arrive via URL edits and browser back/forward that never call `changeTab`. Keying the effect on `activeTab` covers all activation paths.
- **No edge-fade:** DESIGN.md no-gradient/hairline-clean rule; the peeking cut-off tab is the affordance.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Guarded the `scrollIntoView` call site against environments lacking `scrollIntoView` / `matchMedia` (jsdom)**
- **Found during:** Task 1 (verification)
- **Issue:** jsdom does not implement `Element.prototype.scrollIntoView` or `window.matchMedia`, and `src/test-setup.ts` does not polyfill them. The existing keyboard-nav unit test (`AllocationsTabs.test.tsx`) clicks through every tab, which would invoke the new effect and throw `TypeError: ...scrollIntoView is not a function`, turning green unit tests red. The plan's `<action>` specified the bare `scrollIntoView` + `matchMedia` calls.
- **Fix:** Added `typeof el.scrollIntoView !== "function"` and `typeof window.matchMedia === "function"` guards at the call site so the effect no-ops where those APIs are absent (jsdom, older browsers), instead of throwing. This is the root-cause-correct, surgical fix (resilient component) vs. mutating shared `test-setup.ts` for a single component's needs.
- **Files modified:** `src/app/(dashboard)/allocations/AllocationsTabs.tsx`
- **Verification:** All 69 AllocationsTabs unit tests pass (including the keyboard arrow-nav test that exercises tab activation); `tsc --noEmit` exit 0.
- **Committed in:** `f1678271` (Task 1 commit)

**2. [Rule 1 - Bug / verifier-honesty] Reworded a code comment to remove the literal word "gradient"**
- **Found during:** Task 1 (acceptance-criteria grep)
- **Issue:** The acceptance criterion `grep -ci "gradient\|bg-gradient" == 0` was tripped by my own explanatory comment ("NO edge-fade gradient", "DESIGN.md no-gradient rule") — a false positive that would mislead the verifier into flagging a gradient where none exists.
- **Fix:** Reworded the comment to "no edge-fade overlay is added (DESIGN.md hairline-clean rule)". Pure prose change; no styling change. `grep -ci "gradient" == 0` now holds, keeping the grep-based AC honest.
- **Files modified:** `src/app/(dashboard)/allocations/AllocationsTabs.tsx`
- **Verification:** `grep -ci "gradient\|bg-gradient"` returns 0.
- **Committed in:** `f1678271` (Task 1 commit)

---

**Total deviations:** 2 auto-fixed (1 blocking, 1 verifier-honesty/comment).
**Impact on plan:** Both are presentation-only / robustness adjustments. No scope creep, no logic change beyond the planned scroll behavior. The `scrollIntoView` guard is a correctness requirement (without it the unit suite goes red).

## Issues Encountered
- **Vitest cross-file contention flake (NOT a regression):** Running the 4 AllocationsTabs test files together under default parallelism produced one non-deterministic `findByTestId("kpi-strip-mock")` timeout in `AllocationsTabs.scenario-state-preservation.test.tsx:285` — an assertion unrelated to this change. Running that file in isolation passes (2/2), and the full 4-file batch with `--no-file-parallelism` passes 69/69. This matches the documented local CPU-contention flake (full parallel suite on a loaded box → non-deterministic timeout in unrelated files; `--no-file-parallelism` restores green). It is pure local contention, not a defect introduced here; CI runs sharded and is unaffected.

## Verification
- `npx tsc --noEmit -p tsconfig.json` → exit 0 (corrected gate per harness note; NOT the plan's silent-OR form).
- `npx eslint "src/app/(dashboard)/allocations/AllocationsTabs.tsx"` → 0 errors. 1 warning (`trackUsageEventClient` unused) is PRE-EXISTING on import line 33 (verified against `git show HEAD~1`), unrelated to this change — left untouched per the scope boundary.
- AllocationsTabs unit tests: 69/69 pass (de-flaked with `--no-file-parallelism`).
- JOURNEY-03 / composer-axe (`/allocations?tab=scenario` aria-required-children): structurally unchanged — exactly 1 `role="tablist"` element, tabs are direct children, no role on any wrapper, Export/+Allocation are siblings. The seeded `composer-axe.spec.ts` gate is CI-verified (not run locally — it requires the seeded authed env `TEST_SUPABASE_URL` / `TEST_SUPABASE_SERVICE_ROLE_KEY`); this change does not alter its result.

### Acceptance-criteria grep results
- `overflow-x-auto` present on the tablist line (also has `flex-nowrap` + `sm:flex-wrap`). ✅
- Exactly 1 `role="tablist"` JSX element; 6 `role="tab"` buttons remain direct children. ✅
- `data-allocator-tabstrip` retained (count 1). ✅
- `scrollIntoView` present (count 3 incl. comment) and the call site references `prefers-reduced-motion`. ✅
- `grep -ci "gradient\|bg-gradient"` == 0. ✅
- `aria-label="Export"` + `aria-label="Add allocation..."` remain OUTSIDE the tablist (siblings). ✅

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Plan 03 (Wave 2) can anchor its 320px `assertNoReflow` / `assertTargetSizes` nav-shell gate on `[data-allocator-tabstrip]` (retained) and assert the tab strip scrolls (the strip's own `overflow-x-auto` absorbs the row at 320px → no horizontal PAGE overflow).
- The tab strip + Plan 01's role-aware MobileNav + inert `<main>` + skip-link together complete the mobile chrome NAV-01/02/03 surfaces for the phase.
- No blockers.

## Self-Check: PASSED
- FOUND: `src/app/(dashboard)/allocations/AllocationsTabs.tsx`
- FOUND: `.planning/phases/45-navigation-shell-completion/45-02-SUMMARY.md`
- FOUND: commit `f1678271`

---
*Phase: 45-navigation-shell-completion*
*Completed: 2026-06-27*
