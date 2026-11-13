---
phase: 198-mybook-my-allocation-answers-how-is-my-book-doing-in-three-tabs
plan: 08
subsystem: allocator-header-flow-and-deep-link
tags: [header-button, deep-link, history-replacestate, live-region, d-03, d-07, route-06, c8, p4]
requires:
  - phase: 198-05
    provides: AddAllocationFlow (props contract) and heldStrategyIdsFrom
  - phase: 198-04
    provides: three-tab shell and the legacy-alias URL cleanup in the same file
  - phase: 198-01
    provides: bookEquityUsd
provides:
  - one header "+ Allocation" that opens the allocator flow on every tab, the rollback Scenario surface included
  - "/allocations?add=<strategyId>" entry point for Phase 196, consumed into state and stripped from the live URL
  - a seeded e2e for the deep link and the re-pointed wizard-resume e2e
affects: [198-09, 196]
tech-stack:
  added: []
  patterns: [every URL write builds from window.location.search, never the render snapshot, so two cleanup effects cannot resurrect each other's params; resurrection asserted on the write sequence, not only the final URL]
key-files:
  created:
    - src/app/(dashboard)/allocations/AllocationsTabs.add-param.test.tsx
    - e2e/allocations-add.spec.ts
  modified:
    - src/app/(dashboard)/allocations/AllocationsTabs.tsx
    - src/app/(dashboard)/allocations/AllocationsTabs.addalloc.test.tsx
    - src/app/(dashboard)/allocations/AllocationsTabs.test.tsx
    - src/app/(dashboard)/allocations/AllocationsTabs.scenario-composer.test.tsx
    - src/app/(dashboard)/allocations/AllocationsTabs.onboarding.test.tsx
    - src/app/(dashboard)/allocations/AllocationsTabs.scenario-state-preservation.test.tsx
    - src/app/(dashboard)/allocations/AllocationsTabs.connect-key-predicate.test.tsx
    - e2e/wizard-resume.spec.ts
    - e2e/reflow-sweep-authed.spec.ts
    - e2e/no-clip-sweep.spec.ts
    - .github/workflows/ci.yml
key-decisions:
  - "The flow is mounted with key={deepLink?.raw ?? ''}. AddAllocationFlow resolves its deep link once per mount, so a soft navigation to another id while the flow is open needs a fresh mount to re-point it. Header opens (null deep link) keep the empty key."
  - "The legacy-alias cleanup and the add strip both read window.location.search at the moment they run. The alias effect used the searchParams snapshot (198-04), so `?tab=risk&add=<id>` would have regained `tab` from the later write."
  - "The AllocationsTabs.test.tsx setSearchParams helper now also syncs the real jsdom location, because the component reads the live URL. Its replaceState spy stays a no-op, so the two alias-plus-add cases there assert the FIRST write only; the final URL is pinned against a real URL in the add-param test."
requirements-completed: [ROUTE-06]
status: complete
duration: about 55 min
completed: 2026-11-08
commits: 3
plan_head_before: a35f5909e5af98e2e2ca0fbe77b9a4452ae21bd8
plan_head_after: e1e0228ca5e3e9d21f04ecac2a223c80b7601b22
actuals:
  tokens: 45000
  tasks: 3
  commits: 3
---

# Phase 198 Plan 08: the header flow and the ?add= deep link Summary

The header `+ Allocation` opens the allocator's own add-allocation flow on every tab and never the manager wizard, and `/allocations?add=<strategyId>` opens it pre-filled for Phase 196, leaves the URL as it opens, and never reopens on reload.

## Tasks

| Task | Name | Commit |
| ---- | ---- | ------ |
| 1 | The header "+ Allocation" opens the allocator flow on every tab (D-03) | af22bb514 |
| 2 | /allocations?add=<strategyId> opens the flow and leaves the URL (D-07, C8, P4) | de22efe9b |
| 3 | The deep-link e2e, the re-pointed wizard e2e, and the sweep rows (FD-3, FLOW-01) | e1e0228ca |

## What was built

- `AllocationsTabs.tsx`: the manager wizard overlay (import, mount, `contributeOpen`, its two handlers) and the header-only Browse seam (`composerBrowseOpenRef`, `pendingBrowseOpenRef`, `headerBrowseTriggeredRef`, the register, closed and handoff callbacks, the clear-on-leave effect, and `ScenarioTabContent`'s copies of the three props) are gone. `handleHeaderAdd` is one line. The button reads `+ Allocation` with `aria-label` `Add allocation — pick a strategy and enter an amount` on every tab. `exportAnnouncement` is now `liveAnnouncement`, fed by one `announce` helper with the microtask-clear idiom, shared by the Export chip and the flow's success line. `handleFlowClose` and `handleFlowRecorded` are `useCallback`s (recorded: announce, then `router.refresh()` in the poll's try/catch with a `router_refresh_failed` breadcrumb; close: focus to the header button). The flow gets `heldStrategyIdsFrom(strategies, outcomes)`, `bookEquityUsd(holdingsSummary)` and `allKeysStale`, all from the payload.
- `?add=`: an effect on `searchParams` reads it, opens the flow with `{ raw }` (null deep link for an empty value), and strips `add` from the live URL with `history.replaceState`. Nothing reads it in an initializer. `onInvalidDeepLink` is a stable callback that logs `warnAudit("invalid_add_param", { reason })`.
- The alias cleanup (198-04) and the add strip both build from `window.location.search`.
- Tests: `AllocationsTabs.addalloc.test.tsx` rewritten (12 cases: four surfaces, held set and Book equity, focus return, recorded announce and single refresh, a throwing refresh, callback identity stability, no composer seam, Export still announces). New `AllocationsTabs.add-param.test.tsx` (15 cases) against a real URL. T_AT9 updated. Dead `./OutcomesTabPanel`, `./MandateTabPanel`, `./RiskTabPanel` mocks removed from the onboarding and state-preservation tests, and the dead `ContributionWizardOverlay` mock from the connect-key-predicate test.
- e2e: `allocations-add.spec.ts` (HAS_SEED_ENV skip, own seeded strategy under `0 198-add `, axe on both steps, focus checks, reload, malformed id, never presses `Add allocation`); `wizard-resume.spec.ts` now clicks the sidebar's `Add a Strategy` inside the `Primary` navigation landmark (FD-3); three sweep lists relabel the retired-tab rows as legacy aliases and gain a `/allocations?add=` row; one `ci.yml` line lists the new spec after `wizard-resume.spec.ts`.
- No migration, no API route change, no new endpoint. `npm run check:route-contract` passes (52 page routes).

## Gate evidence

- gc-198-08-neuter: gate=AllocationsTabs.addalloc.test.tsx (rollback Scenario path mounts the manager wizard instead of the flow) result=red restored=identical (the T_ADDALLOC_1 rollback case RED, `cp -p` restore, `cmp` exit 0, 12/12 GREEN)
- gc-198-08-neuter: gate=AllocationsTabs.add-param.test.tsx (skip the add strip) result=red restored=identical (7 reload-safety and URL cases RED, `cmp` exit 0, 15/15 GREEN)
- gc-198-08-neuter: gate=AllocationsTabs.add-param.test.tsx (build the add strip from the searchParams snapshot) result=red restored=identical (the `?tab=risk&add=`, `?tab=mandate&add=` and `?tab=outcomes&add=` cases RED, `cmp` exit 0, 15/15 GREEN)
- gc-198-08-gates: vitest=green list=ok tsc=clean lint=clean-except-known (see Notes)

Results: `src/app/(dashboard)/allocations` plus Sidebar, MobileNav, the frozen-spine guards, role-page wiring, route-contract and contracts-registry tests: 180 files, 3211 tests, all green. `node scripts/verify-plan-anchors.mjs` OK (21 claims). `npx playwright test e2e/allocations-add.spec.ts e2e/wizard-resume.spec.ts e2e/reflow-sweep-authed.spec.ts e2e/no-clip-sweep.spec.ts --list` lists 109 tests. `npx tsc --noEmit` clean. Acceptance greps: `import { ContributionWizardOverlay }` 0, `<ContributionWizardOverlay` 0, `composerBrowseOpenRef` 0, the old Scenario aria-label 0, `<AddAllocationFlow` 1, `get("add")` 1, `invalid_add_param` 1, `window.location.search` 4, `e2e/allocations-add.spec.ts` in ci.yml 1 (diff: 1 insertion, 0 deletions), `HAS_SEED_ENV` 6, the old wizard-resume header click 0, `/allocations?add=` in the two sweep files 2 and 1.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] The legacy-alias cleanup also reads the live URL**
- **Found during:** Task 2
- **Issue:** The plan says to change 198-04's cleanup to read `window.location.search` "if it builds from the snapshot". It did (all three branches, including the `overview` and `performance` strips). Left as is, `?tab=risk&add=<id>` regains `tab` from the later write.
- **Fix:** All three branches build from `window.location.search`.
- **Files modified:** `AllocationsTabs.tsx`
- **Commit:** de22efe9b

**2. [Rule 1 - Bug] Existing URL-rewrite tests depended on the snapshot**
- **Found during:** Task 2
- **Issue:** Three `AllocationsTabs.test.tsx` cases (`?tab=performance&otherParam=value`, `?tab=risk&add=abc`, `?tab=outcomes&add=abc`) failed once the cleanup read the live URL, because the mocked searchParams and the jsdom location disagreed, and the real flow would open on the `add` cases.
- **Fix:** The file's `setSearchParams` also syncs the real location; `AddAllocationFlow` is mocked to null there; the two `add` cases assert the alias write (the first write) and point to the add-param test for the final URL.
- **Files modified:** `AllocationsTabs.test.tsx`
- **Commit:** de22efe9b

**3. [Rule 2 - Missing critical] Resurrection is asserted on the write sequence**
- **Found during:** Task 2, neuter (b)
- **Issue:** With the snapshot-built strip the final URL still came out clean: the write re-rendered the page, and the alias effect then fixed the URL up again, so a final-URL assertion could not fail. The plan requires that neuter to go RED.
- **Fix:** A `resurrected(writes, params)` helper in the add-param test fails when a write puts back a param an earlier write dropped, whichever cleanup runs first. Neuter (b) now goes RED on three cases.
- **Commit:** de22efe9b

**4. [Plan addition] The flow is keyed by the deep-link id**
- **Issue:** The flow resolves its deep link once per mount, so a soft navigation to another id while it is open would show the old one.
- **Fix:** `key={addFlow.deepLink?.raw ?? ""}` on the mount, with a test.
- **Commit:** de22efe9b

**5. [Plan addition] Dead mocks in sibling tests removed** (the 198-06 hand-off): three panel mocks in two files and the overlay mock in the connect-key-predicate test. **Commit:** af22bb514.

**Total deviations:** 3 auto-fixed (1 blocking, 1 bug, 1 missing critical) and 2 small plan additions. **Impact:** none on scope; no locked decision in 198-CONTEXT.md was contradicted by the plan's examples.

## Known Stubs

None. The flow's `fetchStrategies` test seam is unused here; the host reads no mock data.

## Notes and open items

- `npm run lint`: eslint 0 errors (2 existing warnings in files this plan did not touch). `check-planning-hygiene` fails rule 6e on ROADMAP.md (the known "Phase 196" bullet), not fixed as instructed. The canonical-domain check after it does not run when hygiene fails.
- No seeded e2e was run here, by plan. CI's seeded job runs `allocations-add.spec.ts` and the re-pointed `wizard-resume.spec.ts` on its local stack. The `?add=<id>` factsheet-link e2e stays a backstop until Phase 196 lands.
- Own-strategy 409 (carried from 198-05): `AddAllocationFlow` does not ask the host to refresh on a 409 the way `AllocateDialog` does, and the host refreshes only on `onRecorded`. Changing that is a change to 198-05's component and outside this plan's files, so it is left open. A stale own-row after a 409 is re-read at the next refresh or the 30s poll.
- A valid strategy beyond the 200-row browse cap gets the `not in the list we loaded` notice, not step 2 (plan's flagged assumption, no endpoint resolves one id).
- FD-3 stays: sidebar and mobile `Add a Strategy` still open the manager wizard. A follow-up still needs booking.
- Edge probe ROUTE-06 remains the plan's flagged `unclassified` assumption.

## Threat Flags

None. No new endpoint, auth path or schema. T-198-14 (URL value only opens and pre-fills; the flow resolves it against the allocator-gated list and both write routes re-validate), T-198-15 (strip from the live URL; neuter RED) and T-198-16 (WizardClient sentinel; neuter RED) are mitigated as planned.

## Self-Check: PASSED

- FOUND: `AllocationsTabs.add-param.test.tsx`, `e2e/allocations-add.spec.ts`, and the modified files listed above
- FOUND commits: af22bb514, de22efe9b, e1e0228ca (ancestors of HEAD)
- Three `gc-198-08-neuter:` lines and one `gc-198-08-gates:` line present
