---
phase: 116-addalloc-context-aware-allocation
reviewed: 2026-07-18T08:21:28Z
depth: standard
files_reviewed: 8
files_reviewed_list:
  - src/app/(dashboard)/allocations/AllocationsTabs.tsx
  - src/app/(dashboard)/allocations/components/ScenarioComposer.tsx
  - src/app/(dashboard)/allocations/components/OptimizerPanel.tsx
  - src/app/(dashboard)/allocations/AllocationsTabs.addalloc.test.tsx
  - src/app/(dashboard)/allocations/AllocationsTabs.scenario-composer.test.tsx
  - src/app/(dashboard)/allocations/components/ScenarioComposer.test.tsx
  - src/app/(dashboard)/allocations/components/OptimizerPanel.test.tsx
  - src/app/(dashboard)/allocations/lib/watchlist-read.ts
findings:
  critical: 0
  warning: 2
  info: 1
  total: 3
status: issues_found
---

# Phase 116: Code Review Report

**Reviewed:** 2026-07-18T08:21:28Z
**Depth:** standard
**Files Reviewed:** 8
**Status:** issues_found

## Summary

Phase 116 rewires the `/allocations` header button to be context-aware (`+ Strategy`
on Scenario → composer Browse drawer; `+ Allocation` elsewhere → inline
ContributionWizardOverlay) and swaps the OptimizerPanel zero-portfolio dead-end for
an honest connect-exchange remedy. Surgical discipline is respected: the
ScenarioComposer changes are strictly additive (two optional props + two `onClose`
sites that now also fire `onBrowseClosed`), `scenario.ts` is byte-untouched, and no
new design tokens were introduced. `handleHeaderAdd` has no silently-no-op branch in
the steady state, aria-labels are correct per tab, and the OptimizerPanel remedy
deep-links a route (`/profile?tab=exchanges`) that is canonical across the codebase.
The tests are non-tautological and encode intent (Rule 9).

Two real focus/dispatch defects survive, both rooted in the same design gap: the
host's focus/dispatch refs (`headerBrowseTriggeredRef`, `composerBrowseOpenRef`) are
only partially reset. Both are edge-timing/multi-step paths, both directly contradict
this phase's own stated invariants ("never a silent no-op" and "an in-composer Browse
close does not steal focus"), and both are currently unproven by the test suite — the
composer-side test even pins the precondition (`onAddOwn` does not fire
`onBrowseClosed`) without testing the host consequence.

## Warnings

### WR-01: Stale `headerBrowseTriggeredRef` after an `onAddOwn` handoff steals focus on a later in-composer Browse close

**File:** `src/app/(dashboard)/allocations/AllocationsTabs.tsx:511-516, 547-568`
(interacts with `ScenarioComposer.tsx:3664-3667, 4923-4926`)

**Issue:** `handleHeaderAdd` sets `headerBrowseTriggeredRef.current = true` on a header
"+ Strategy" click. That flag is only cleared in `handleBrowseClosed` (when the drawer
close fires `onBrowseClosed`) or when leaving the scenario tab. But the composer's
`onAddOwn` path (`setBrowseOpen(false); setContributeOpen(true)`) closes Browse
*without* firing `onBrowseClosed` — this is intentional (documented as a
"modal-to-modal transition") and is explicitly pinned by
`ScenarioComposer.test.tsx` T_C_ADDALLOC_BROWSE2. Consequence on the host: after a
header-initiated Browse → "Add your own" handoff, `headerBrowseTriggeredRef` stays
`true` indefinitely while the user remains on the scenario tab. A subsequent,
independently in-composer-initiated Browse open (via the composer's own "Browse
strategies" button) that is then closed will fire `onBrowseClosed`, see the stale
`true` flag, and yank focus to the header "+ Strategy" button — violating the stated
contract that "an in-composer Browse close does not steal focus." T_ADDALLOC_S4 does
not catch this: it clears the flag via a normal close before re-testing, never
exercising the `onAddOwn`-leaves-flag-set path.

**Fix:** Reset the flag whenever Browse is dispatched *not* from the header, or clear
it when the handoff occurs. Simplest: have the composer signal the host on the
`onAddOwn` transition too (a distinct callback), or — host-side and minimal — clear the
flag on any in-composer Browse open. Concretely, clear it defensively when a non-header
open path is taken. One low-risk option is to treat the flag as single-use by also
clearing it in `handleRegisterOpenBrowse`/on drawer-open signal it did not originate:

```tsx
// In handleHeaderAdd, the header path already sets it true. Ensure any composer-
// internal Browse open path resets it. Since the composer owns that open, add a
// deregister/notify on onAddOwn, OR clear on browse-open-from-composer. Minimal
// host-side guard: reset when focus-return fires OR when Browse is reopened by the
// composer's own onSuccess->setBrowseOpen(true) (which the host cannot see today).
```

Because the host cannot currently observe the composer's internal Browse re-opens, the
clean fix is composer-side: fire a lightweight "browse opened not-by-host" signal, or
have `onAddOwn` also notify the host to clear the header flag. Add a regression test
driving header-open → `onAddOwn` → in-composer open → close and asserting focus is NOT
stolen to the header.

### WR-02: Stale `composerBrowseOpenRef` after a scenario→other→scenario round-trip can swallow a "+ Strategy" click (silent no-op)

**File:** `src/app/(dashboard)/allocations/AllocationsTabs.tsx:499-509, 519-525, 560-567`
(interacts with `ScenarioComposer.tsx:1800-1805`)

**Issue:** The leave-scenario cleanup effect (lines 520-525) resets
`pendingBrowseOpenRef` and `headerBrowseTriggeredRef` but deliberately leaves
`composerBrowseOpenRef` holding the previous composer instance's `openBrowse` closure.
`ScenarioComposer` unmounts when `activeTab !== "scenario"` (line 951), and its
register effect (`ScenarioComposer.tsx:1802`, empty deps, no cleanup) only re-registers
on remount *after* the next commit's effect phase runs. When the user returns to the
scenario tab, there is a window between the remounted composer's first paint and its
register effect firing during which `composerBrowseOpenRef.current` still points at the
*unmounted* instance's `() => setBrowseOpen(true)`. A "+ Strategy" click in that window
takes the truthy-ref branch (line 561), calls the stale setter (a no-op state update on
an unmounted component), and does NOT set `pendingBrowseOpenRef` — so the click is lost
with no drawer opening. This is exactly the "silent no-op" ADDALLOC-03 is meant to
prevent. The window is narrow (the composer chunk is cached on the second visit, so
mount→effect is ~one frame), which is why it is low-likelihood, but it is reachable and
the fix is trivial and symmetric with the existing cleanup.

**Fix:** Null the open-ref on leave alongside the other two refs so a pre-registration
click falls through to the pending-drain path instead of the stale-setter path:

```tsx
useEffect(() => {
  if (activeTab !== "scenario") {
    pendingBrowseOpenRef.current = false;
    headerBrowseTriggeredRef.current = false;
    composerBrowseOpenRef.current = null; // add: drop the unmounted composer's setter
  }
}, [activeTab]);
```

(Alternatively/additionally, give the composer's register effect a cleanup that
deregisters — `return () => onRegisterOpenBrowseRef.current?.(noop)` — but the host-side
null is the smaller change.) Add a regression test: render scenario, unmount (switch
tab), remount, click "+ Strategy" before re-registration, and assert the click drains
via `pendingBrowseOpenRef` rather than being swallowed.

## Info

### IN-01: Composer Browse register effect has no deregister cleanup (mirrors a pre-existing `onRegisterOpen` gap)

**File:** `src/app/(dashboard)/allocations/components/ScenarioComposer.tsx:1800-1805`

**Issue:** The new `onRegisterOpenBrowse` effect registers an open handle on mount with
no cleanup, exactly like the pre-existing `onRegisterOpen` seam (lines 1789-1793). This
is the root cause enabling WR-02: nothing tells the host the handed-out function is
dead when the composer unmounts. It is consistent with the established codebase pattern
(Rule 11), so it is not itself a defect — but if WR-02 is fixed host-side, note that the
symmetric composer-side cleanup would harden the seam against any future host that does
not clear the ref. No change required if WR-02 is addressed on the host.

---

_Reviewed: 2026-07-18T08:21:28Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
