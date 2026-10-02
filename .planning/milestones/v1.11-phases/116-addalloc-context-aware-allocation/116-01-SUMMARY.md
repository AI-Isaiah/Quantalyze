---
phase: 116-addalloc-context-aware-allocation
plan: 01
subsystem: ui
tags: [react, nextjs, allocations, scenario-composer, overlays, a11y, addalloc]

# Dependency graph
requires:
  - phase: 110-contrib
    provides: ContributionWizardOverlay (trigger-agnostic inline onboarding overlay)
  - phase: 111-constit
    provides: StrategyBrowseDrawer + composer browseOpen state + onAddOwn wizard handoff
  - phase: 23-persist
    provides: onRegisterOpen registration-seam precedent mirrored by onRegisterOpenBrowse
provides:
  - Context-aware header button (label/aria/action derived from activeTab)
  - Tab-level ContributionWizardOverlay host reachable on Holdings/Overview
  - Additive ScenarioComposer seam onRegisterOpenBrowse / onBrowseClosed
  - Focus-return-to-trigger on overlay close, pending-drain during dynamic-import window
affects: [117-uifix, addalloc-04-simulate-impact-remedy]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Per-tab binary dispatch on URL-derived activeTab (no new local tab state)"
    - "Host-owned focus-return-to-trigger (overlay pulls focus in; host restores on close)"
    - "Pending-drain ref for a click that lands during a dynamic-import loading window"
    - "Additive imperative-open registration seam mirroring onRegisterOpen (ref-stabilized)"

key-files:
  created:
    - "src/app/(dashboard)/allocations/AllocationsTabs.addalloc.test.tsx"
  modified:
    - "src/app/(dashboard)/allocations/AllocationsTabs.tsx"
    - "src/app/(dashboard)/allocations/components/ScenarioComposer.tsx"
    - "src/app/(dashboard)/allocations/AllocationsTabs.scenario-composer.test.tsx"
    - "src/app/(dashboard)/allocations/components/ScenarioComposer.test.tsx"

key-decisions:
  - "Additive tab-level contributeOpen host (not lift-out): composer's internal contributeOpen/Browse→Add-your-own handoff stays byte-untouched; closed overlays render null so the single-modal contract holds"
  - "Binary dispatch on activeTab generalizes the UI-SPEC 3-row table (outcomes/mandate/risk take the Holdings/Overview branch) so ADDALLOC-03 never-a-silent-no-op holds on EVERY tab"
  - "isUiV2=false rollback surface: '+ Strategy' opens the wizard as a real remedy instead of the plan's literal changeTab no-op (plan-checker preferred clickable remedy)"
  - "T_AT9 rewritten to assert absence via the button's aria-label substring (not the literal retired phrase) so the whole-repo mislabel grep gate stays at 0 hits"

patterns-established:
  - "Focus-return-to-trigger: host keeps a ref to the trigger and .focus()es it in the overlay onClose handler"
  - "Pending-drain: click during the composer's dynamic-import window sets a ref that handleRegisterOpenBrowse drains on late registration"

requirements-completed: [ADDALLOC-01, ADDALLOC-02, ADDALLOC-03]

# Metrics
duration: 22min
completed: 2026-07-18
---

# Phase 116 Plan 01: Context-aware "+ Allocation" header button Summary

**The header button now dispatches per tab — "+ Strategy" opens the composer's StrategyBrowseDrawer on Scenario, "+ Allocation" opens the ContributionWizardOverlay inline on every other tab — with corrected aria-labels, focus-return-to-trigger, and a dynamic-import pending-drain so the click is never a silent no-op.**

## Performance

- **Duration:** ~22 min
- **Started:** 2026-07-18T09:50:00Z
- **Completed:** 2026-07-18T10:04:00Z
- **Tasks:** 2 (both TDD)
- **Files modified:** 4 modified + 1 created

## Accomplishments
- Fixed the exact live-dogfood bug: the button was hard-wired `onClick={() => changeTab("scenario")}` (a wrong action on Holdings/Overview, a silent no-op ON Scenario). It now reads label, action, and aria-label from `activeTab`.
- Holdings/Overview "+ Allocation" opens `ContributionWizardOverlay` inline (no navigation) via a new tab-level host reachable where `ScenarioComposer` is not mounted; focus returns to the header trigger on close, and `onSuccess` fires one `router.refresh()`.
- Scenario "+ Strategy" opens the composer's `StrategyBrowseDrawer` through an additive `onRegisterOpenBrowse` seam; a click during the composer's dynamic-import window is drained on late registration (no lost click); a header-initiated Browse close returns focus to the trigger, an in-composer close does not steal it.
- Retired the stale "open Scenario tab" mislabel repo-wide (grep gate 0), scenario.ts byte-frozen (SC-3), `ContributionWizardOverlay.tsx` byte-unmodified, both `onAddOwn` handoff handlers byte-unchanged.

## Task Commits

Each task was committed atomically:

1. **Task 1: Context-aware header button + tab-level ContributionWizardOverlay host** - `6c8b5e08` (feat)
2. **Task 2: Scenario "+ Strategy" → composer Browse signal (onRegisterOpenBrowse) + browse-close focus return** - `fa507f2b` (feat)

_TDD note: RED tests were written and observed failing (assertion failures, not crashes) before each implementation; both were committed together with their implementation per the plan's task grouping._

## Files Created/Modified
- `src/app/(dashboard)/allocations/AllocationsTabs.tsx` - Static import + tab-level host for `ContributionWizardOverlay`; `addButtonRef`, `contributeOpen`, per-tab `handleHeaderAdd` dispatch, focus-return handlers, Browse-open refs (`composerBrowseOpenRef`/`pendingBrowseOpenRef`/`headerBrowseTriggeredRef`), `handleRegisterOpenBrowse` drain, `handleBrowseClosed` focus-return, leave-scenario cleanup effect; rewritten header button + D-20 comment; Browse seam threaded through `ScenarioTabContent`.
- `src/app/(dashboard)/allocations/components/ScenarioComposer.tsx` - Additive `onRegisterOpenBrowse`/`onBrowseClosed` props (TSDoc), ref-stabilized registration effect mirroring `onRegisterOpen`, both `StrategyBrowseDrawer` `onClose` sites now also fire `onBrowseClosed` (onAddOwn untouched).
- `src/app/(dashboard)/allocations/AllocationsTabs.addalloc.test.tsx` - NEW. Wiring tests: per-tab label/aria, inline overlay open, no-navigation, focus return, onSuccess refresh; scenario "+ Strategy" invoke-once, seam props, pending drain, focus return.
- `src/app/(dashboard)/allocations/AllocationsTabs.scenario-composer.test.tsx` - T_AT9 sentinel rewritten (intent-preserving): asserts the corrected accessible name is present and the button's aria-label no longer mentions "Scenario tab".
- `src/app/(dashboard)/allocations/components/ScenarioComposer.test.tsx` - Composer-side tests for the Browse-open handout and `onBrowseClosed` (fires on drawer close, NOT on the onAddOwn wizard handoff).

## Decisions Made
- **Additive host, not lift-out.** The plan's literal wording said to "lift OUT of" the composer; instead the tab-level `contributeOpen` host is purely additive and the composer's own internal `contributeOpen` + Browse→"Add your own" handoff is byte-untouched. Closed overlays render null, so the UI-SPEC single-modal contract still holds. Smaller, surgical (Rule 3), no regression risk to the composer's proven wizard chain.
- **Binary dispatch generalizes the 3-row UI-SPEC table.** outcomes/mandate/risk take the Holdings/Overview branch, so ADDALLOC-03 (never a silent no-op) holds on every tab, not just the three named ones.
- **T_AT9 asserts absence via aria-label substring, not the literal retired phrase**, so the whole-repo `grep "open Scenario tab"` mislabel gate stays at literal 0 hits while still failing loudly if any "Scenario tab" mislabel returns.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing Critical / plan-checker advisory] isUiV2=false rollback surface: clickable remedy instead of a silent no-op**
- **Found during:** Task 2 (handleHeaderAdd scenario branch)
- **Issue:** The plan's literal instruction was, on the `isUiV2 === false` ScenarioStub rollback surface, to keep `changeTab("scenario")`. But on `?tab=scenario` the user is already on that tab, so `changeTab("scenario")` is a silent no-op — the plan-checker flagged this as a technical ADDALLOC-03 violation and PREFERRED a clickable remedy.
- **Fix:** On that degraded branch, "+ Strategy" now opens the tab-level `ContributionWizardOverlay` (a real "add a strategy" action) instead of the no-op. The overlay is already hosted at the tab level, so this is one line (`setContributeOpen(true)`), cheap and surgical. A comment documents why (the ScenarioStub predates ADDALLOC and is otherwise out of scope).
- **Files modified:** src/app/(dashboard)/allocations/AllocationsTabs.tsx
- **Verification:** Deterministic non-no-op action on the rollback path; consistent with the founder's "no disabled dead-ends / never a silent no-op" ethos. Not separately unit-tested (rare rollback surface); the primary isUiV2=true path is fully covered.
- **Committed in:** fa507f2b (Task 2 commit)

---

**Total deviations:** 1 auto-fixed (1 plan-checker-preferred remedy for the degenerate rollback path).
**Impact on plan:** Fully resolves the plan-checker's advisory edge (no documented-exception needed). No scope creep — one line, uses the already-hosted overlay.

## Issues Encountered
- The whole-repo mislabel grep gate (`grep -rn "open Scenario tab" src/ e2e/` → 0) initially failed because the first T_AT9 rewrite embedded the literal retired phrase in a negative assertion. Resolved by asserting the absence via the button's live aria-label substring (`.not.toContain("Scenario tab")`) — a stronger Rule-9 intent test that keeps the gate at literal 0.

## User Setup Required
None - no external service configuration required. (This plan is a client-side rewire of existing in-repo overlays; no new packages, no env vars, no schema changes.)

## Next Phase Readiness
- ADDALLOC-01/02/03 complete. ADDALLOC-04 (the zero-portfolio Simulate-Impact `/portfolios` dead-end remedy in `OptimizerPanel.tsx`) remains for a follow-up plan/phase — the CONTEXT and UI-SPEC already specify the `/profile?tab=exchanges` swap + honest copy.
- Phase 117 (UIFIX) owns the tooltip/overflow/focus-ring polish; the header button's `focus-visible` ring was preserved byte-identical here (not regressed).
- **Not browser-verified.** Recommend `/qa` on a dev server to confirm the per-tab label/overlay/focus behavior lands in the browser (the wiring is fully unit-covered; the visual/interaction contract is DESIGN.md-conformant by reuse).

## Self-Check: PASSED
- FOUND: src/app/(dashboard)/allocations/AllocationsTabs.addalloc.test.tsx
- FOUND commit: 6c8b5e08 (Task 1)
- FOUND commit: fa507f2b (Task 2)
- Whole-repo mislabel gate: 0 hits
- Gates: 308 tests green across 7 allocations suites; tsc 0 errors; lint 0 errors; scenario.ts byte-frozen (SC-3); ContributionWizardOverlay.tsx byte-unmodified; both onAddOwn handlers byte-unchanged.

---
*Phase: 116-addalloc-context-aware-allocation*
*Completed: 2026-07-18*
