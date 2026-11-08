---
phase: 198-mybook-my-allocation-answers-how-is-my-book-doing-in-three-tabs
plan: 04
subsystem: allocations-tab-shell
tags: [tabs, legacy-aliases, url-rewrite, anchor-scroll, d-02]
requires:
  - phase: 194.1
    provides: figure-gate census (precondition; commit 4b5ccacfb is an ancestor of HEAD)
provides:
  - three-tab AllocationsTabs shell (Overview, Holdings, Scenario)
  - LEGACY_TAB_ALIASES, with an alias URL rewrite and a one-time anchor scroll to #outcomes, #risk or #mandate
affects: [198-06, 198-08, 198-11]
tech-stack:
  added: []
  patterns: [closed alias map plus switch in parseTab, replaceState rewrite as changeTab builds it, bounded requestAnimationFrame retry for a lazily mounted anchor]
key-files:
  created: []
  modified:
    - src/app/(dashboard)/allocations/AllocationsTabs.tsx
    - src/app/(dashboard)/allocations/AllocationsTabs.test.tsx
    - src/app/(dashboard)/allocations/AllocationsTabs.scenario-composer.test.tsx
    - src/app/(dashboard)/allocations/AllocationsTabs.connect-key-predicate.test.tsx
key-decisions:
  - "pendingAlias is state, not a ref: the effect that arms it also removes the legacy param from the URL, so the alias cannot be re-derived in render. Both setState-in-effect calls carry a scoped eslint-disable with the reason, the same precedent the file already uses for its fetch-on-mount effect."
  - "A pending alias whose tab is no longer active is dropped (not parked), so returning to that tab later never scrolls unprompted."
  - "The reduced-motion check is one module function, prefersReducedMotion(), used by both the NAV-02 strip scroll and the alias scroll; the NAV-02 inline copy was replaced by it."
  - "The Outcomes tab's count badge left with the tab (fold table). The Holdings badge still counts strategies.length."
requirements-completed: [LEAN-06]
status: complete
duration: about 35 min
completed: 2026-11-08
commits: 2
plan_head_before: 1d5cca89816cb67028f623cfbe8f59b1ddf6b8dc
plan_head_after: 28624b6f868ee7c84dfe4ca787b2ded7a840edcd
actuals:
  tokens: 21000
  tasks: 2
  commits: 2
---

# Phase 198 Plan 04: three tabs and legacy aliases Summary

My allocation now has exactly three tabs, and a link to a retired tab (`?tab=outcomes|risk|mandate`) still lands on that content's new home with a clean URL and one scroll.

## Tasks

| Task | Name | Commit |
| ---- | ---- | ------ |
| 1 | Three tabs, legacy aliases with a URL rewrite and a one-time anchor scroll (D-02) | fa48c3fd5 |
| 2 | The sibling tab tests follow, and the nav and route guards stay green (D-02) | 28624b6f8 |

## What was built

- `AllocationsTabs.tsx`: `TabKey`, `VISIBLE_TAB_KEYS`, `TAB_LABELS` and `tabRefs` hold Overview, Holdings, Scenario. `LEGACY_TAB_ALIASES` (outcomes to holdings, risk and mandate to overview, each with its own anchor) is a closed map; `parseTab` returns the alias tab for a legacy key and keeps the `invalid_tab_fallback` breadcrumb for genuinely unknown values only. The URL cleanup effect now also rewrites a legacy key (`tab=holdings` for outcomes, `tab` deleted for risk and mandate, every other param kept) with `window.history.replaceState` and arms `pendingAlias`; it re-runs on every `searchParams` change, so the sidebar's Risk item clicked while already on /allocations works. A second effect runs a requestAnimationFrame loop of at most 120 frames, then calls `scrollIntoView` once (`auto` under reduced motion, else `smooth`) and clears the alias; it is cancelled on unmount and on any tab change. The Outcomes, Mandate and Risk `dynamic(` declarations, tabpanels and the Outcomes badge are gone; the three panel files are kept for 198-06 and 198-11.
- Nav untouched: `git diff --name-only $(git merge-base origin/main HEAD) HEAD -- src/components/layout` prints nothing.

## Fold table (as built here)

| Retired tab | Lands in | Anchor | Plan |
|-------------|----------|--------|------|
| Outcomes | Holdings, section "Outcomes" | `#outcomes` | 198-11 |
| Outcomes count badge | removed with the tab | none | 198-04 (done) |
| Mandate | Overview, section "Mandate" | `#mandate` | 198-06 |
| Risk | Overview, section "Risk" | `#risk` | 198-06 |

Until 198-06 and 198-11 render those ids, an alias lands on the right tab and the scroll gives up silently after 120 frames (by design).

## Gate evidence

- gc-198-04-red: test=tab-order old=six new=three (the ArrowRight order case, changed to `["Overview", "Holdings", "Scenario"]` first, failed at HEAD with `expected '/allocations?tab=outcomes' to contain 'tab=scenario'`)
- gc-198-04-neuter: gate=AllocationsTabs.test.tsx (drop `outcomes` from LEGACY_TAB_ALIASES) result=red restored=identical (7 outcomes cases RED, byte copy restored with `cp -p`, `cmp` exit 0, 73/73 GREEN)
- gc-198-04-neuter: gate=AllocationsTabs.test.tsx (force `behavior: "smooth"`, ignoring reduced motion) result=red restored=identical (the reduced-motion case RED, `cmp` exit 0)
- gc-198-04-gates: vitest=green nav-unchanged=yes tsc=clean lint=clean-except-known (see Notes)

Results: `AllocationsTabs.test.tsx` 73/73; the six sibling suites 52/52; Sidebar, MobileNav, frozen-spine, requireRolePage-wiring and check-route-contract 108/108 with no change; `src/app/(dashboard)/allocations` plus contracts-registry 172 files, 2991 tests, all green; `node scripts/verify-plan-anchors.mjs` OK (13 claims).

## Edited existing cases (reason for each: retired tab is an alias now)

`AllocationsTabs.test.tsx`
- ArrowRight order case: order array is the three tabs (the RED case above).
- `?tab=outcomes`, `?tab=mandate`, `?tab=risk` landing cases: now assert Holdings, Overview, Overview (what each guarded: the link reaches its content's surface).
- SC-5c "after history.replaceState, the URL-derived visible tab switches": the click goes to Holdings instead of Mandate (same intent: the visible body follows the URL).
- Count badge cases (two): the Outcomes tab and badge are asserted absent; the Holdings badge assertions are kept.
- Export chip cases (five: M-1041, M-1044 announce, ONCE, clicked twice, no-ZWS): start from the Overview instead of `?tab=risk`, because Risk now rewrites the URL on mount; they guard Export from a non-Holdings tab, unchanged.
- parseTab canonical loop: retitled "canonical or legacy alias"; behaviour unchanged (none of the keys logs the breadcrumb).
- Tweaks describe: "renders the Outcomes tab and stays on ?tab=outcomes" now asserts the link lands on Holdings and the only URL write is `/allocations?tab=holdings` (never a strip to Overview); "arrow-nav reaches Outcomes" now asserts ArrowRight from Holdings reaches Scenario.
- Header docblock, the three dead panel mocks (replaced by `#risk`, `#mandate`, `#outcomes` anchors in the Overview and Holdings stubs) and `ACTIVE_BODIES` follow.

`AllocationsTabs.scenario-composer.test.tsx`
- T_AT8 "other tabs unchanged": outcomes now awaits `holdings-body`, mandate and risk await `overview-v2`; each still asserts the composer is absent.
- "keyboard arrow-nav reaches the Scenario tab": walks ArrowRight from Holdings (the tab before Scenario now), not from Risk.
- Three dead panel mocks removed. The header aria-label case is untouched (198-08 owns it).

`AllocationsTabs.connect-key-predicate.test.tsx`
- The `tab: "risk"` row left `TABS`; its docblock says why. Risk's empty-book behaviour is pinned on the Overview by 198-06. No other case deleted.

New cases (describe "Phase 198 D-02 three tabs and legacy tab aliases"): three tabs in order and no retired tab; End and Home focus; outcomes lands on Holdings with exactly one `?tab=holdings` write; risk and mandate land on Overview with `/allocations`; `add=abc` kept for risk and outcomes; scroll once to `#risk`, `#mandate`, `#outcomes`; reduced motion uses `auto`; retry while the anchor is absent then one scroll; gives up silently at exactly 120 frames; cancelled on unmount; cancelled by a tab change and not re-fired on return; plain holdings never scrolls; soft navigation from `?tab=holdings` to `?tab=risk`; unknown value logs `invalid_tab_fallback` while the three legacy keys do not.

## Deviations from Plan

None - plan executed as written. One note: the plan asked for `grep -a -c "= dynamic("` to print `2`; it does (Holdings and the composer).

## Notes (not mine, not fixed)

- `npm run lint`: eslint has 0 errors (2 pre-existing unused-var warnings in `MetricsColumn.tsx` and `composite-read-path.ts`); the three guard scripts after it pass except the known `check-planning-hygiene` rule 6e on ROADMAP.md (the "Phase 196" bullet), which the phase brief says is not to be fixed here.
- `invalid_tab_fallback` still fires on every render for an unknown value, as at HEAD, because `parseTab` runs in render; the test asserts it fires and names the raw value, not that it fires once.
- Real-browser confirmation that `useSearchParams` follows `replaceState` for the alias rewrite (Next's documented shallow-routing behaviour, already relied on by `changeTab`) is not covered by jsdom; the existing SC-5c arm models it.

## Threat Flags

None. `tab` still selects among known keys only; the anchor is one of three fixed ids from `LEGACY_TAB_ALIASES`, never read from the URL (T-198-07).

## Known Stubs

None added. `#outcomes`, `#risk` and `#mandate` do not exist in the product yet (198-06 and 198-11 create them); the alias scroll degrades silently until then, which is the specified behaviour.

## Self-Check: PASSED
