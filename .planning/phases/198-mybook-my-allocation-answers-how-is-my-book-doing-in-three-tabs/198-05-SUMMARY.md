---
phase: 198-mybook-my-allocation-answers-how-is-my-book-doing-in-three-tabs
plan: 05
subsystem: allocator-add-allocation-flow
tags: [slide-over, two-route-dispatch, idempotency, deep-link, d-03, d-05, route-06]
requires:
  - phase: 194.1
    provides: figure-gate census (precondition; src/__tests__/figure-gate-census.test.ts exists at HEAD)
provides:
  - AddAllocationFlow, the two-step allocator slide-over (picker, then amount and date)
  - add-allocation.ts, the pure dispatch, refusal, date-window, held-set, deep-link and copy module
  - exported parseAmount, envelopeForResponse, ALLOCATION_ROUTE, generateIdempotencyKey and the two date messages
affects: [198-08]
tech-stack:
  added: []
  patterns: [panel component mounted per open so state and the list read reset without a reset effect, ref fence beside busy state for a money write, one idempotency key per attempt]
key-files:
  created:
    - src/app/(dashboard)/allocations/lib/add-allocation.ts
    - src/app/(dashboard)/allocations/lib/add-allocation.test.ts
    - src/app/(dashboard)/allocations/components/AddAllocationFlow.tsx
    - src/app/(dashboard)/allocations/components/AddAllocationFlow.test.tsx
  modified:
    - src/app/(dashboard)/allocations/components/AllocateDialog.tsx
    - src/app/(dashboard)/allocations/components/ScenarioCommitDrawer.tsx
    - src/lib/bridge-outcome-schema.ts
    - src/__tests__/display-sign-single-source.test.ts
key-decisions:
  - "AddAllocationFlow is an outer shell (returns null when closed or without document, else a portal) around an inner panel that mounts per open. Fresh state and a fresh list read per open come from the mount, so no reset-on-close effect and no setState-in-effect disables."
  - "Only the enter animation is implemented. The panel unmounts at once on close, as StrategyBrowseDrawer and ScenarioCommitDrawer already do, so one-dialog-in-the-DOM, the open={false} renders-nothing contract and the host's focus return stay deterministic. The UI-SPEC's exit animation is not built."
  - "A list read that returns 429 maps to RATE_LIMITED and any other failure to UNKNOWN; both are recoverable, so Retry shows. Retry swaps the envelope for the loading rows, which is the plan's stand-in for a Retrying label."
  - "An empty or malformed date is refused with a new field message, `Enter the allocation date.`, because a cleared type=date input yields an empty string and the commit route would otherwise answer 400 for a value we can see is wrong. It is a field message, not an envelope string."
requirements-completed: [ROUTE-06]
status: complete
duration: about 75 min
completed: 2026-11-08
commits: 3
plan_head_before: 7aed1bcbe975064a61d658d1e9a9020dcb059288
plan_head_after: b21e4d03e16bf99e62aecdad54a5c715fad06c77
actuals:
  tokens: 60000
  tasks: 3
  commits: 3
---

# Phase 198 Plan 05: the allocator's add-allocation flow Summary

An allocator can pick a strategy by search, enter an amount (and a date for someone else's strategy), and record it through an existing route, with the success line saying where it landed and a refusal in place of a guess when the allocation cannot be sized.

## Tasks

| Task | Name | Commit |
| ---- | ---- | ------ |
| 1 | One dispatch, one validation, one copy source, as a pure module (D-05, C3, C4, P2) | 8e3f9ef93 |
| 2 | The slide-over shell and step 1, the strategy picker (D-03, C2) | 71d876d32 |
| 3 | Step 2, amount and date, and the two-route submit (D-05, C3, C4, P1, P2) | b21e4d03e |

## What was built

- `lib/add-allocation.ts` (pure): `buildAllocationRequest` routes by `isOwn === true` (own: allocation route, `{ strategy_id, allocated_amount }`, no key; otherwise one `voluntary_add` diff to the commit route, `idempotent: true`, no fingerprint key). `parseAmount` is the one amount rule on both branches. A non-finite or non-positive Book equity refuses at the amount; above Book equity refuses naming it. `validateAllocationDate` uses the schema's own two messages, now exported once from `bridge-outcome-schema.ts`. `successAnnouncement` says Strategies on Holdings for own and Outcomes on Holdings for a third-party add. `heldStrategyIdsFrom` holds Holdings strategies and `allocated` outcomes' replacement strategies. `resolveDeepLink` returns none / unavailable (malformed, unlisted) / not_loaded / held / prefill. `commitSucceeded` is the strict gate (`recorded === 1`, no errors).
- `AddAllocationFlow.tsx`: portal slide-over (620px, max 96vw, full width under 640px), focus trap, Esc/backdrop/close (all inert in flight), fresh browse read per open with the H-0117 loud-fail, step 1 picker with loading rows, error envelope with Retry, empty and no-match states, rows as buttons in a labelled list with arrow-key roving, held rows `aria-disabled` and unselectable, no trust tier or manager. Step 2: amount, date only for another's strategy (min 365 days back, max today, UTC), live share line (Book equity finite and above 0, amount parses, not `allKeysStale`), field refusals shown red only after a refused submit and cleared on the fixing keystroke, `Adding…` while in flight with a ref fence against a double click, one idempotency key per attempt reused on Retry and dropped on strategy, amount or date change.
- Exports without behaviour change: `AllocateDialog.tsx` (`parseAmount`, `ParsedAmount`, `ERROR_NON_POSITIVE`, `ERROR_ABOVE_CAP`, `ALLOCATION_ROUTE`, `envelopeForResponse`), `ScenarioCommitDrawer.tsx` (`generateIdempotencyKey`), `bridge-outcome-schema.ts` (`OUTCOME_DATE_FUTURE_MESSAGE`, `OUTCOME_DATE_TOO_OLD_MESSAGE`, read by the `ALLOCATED_FIELDS` refine).
- No route or migration change: `git diff --name-only $(git merge-base origin/main HEAD) HEAD -- src/app/api supabase` prints nothing.

## Gate evidence

- gc-198-05-neuter: gate=add-allocation.test.ts (add a fingerprint key to the commit body) result=red restored=identical (the no-fingerprint case RED, `cp -p` restore, `cmp` exit 0, 39/39 GREEN)
- gc-198-05-neuter: gate=add-allocation.test.ts (heldStrategyIdsFrom ignores outcomes) result=red restored=identical (the allocated-outcome held case RED, `cmp` exit 0, GREEN)
- gc-198-05-neuter: gate=AddAllocationFlow.test.tsx (remove the held-row guard in `choose`) result=red restored=identical (the held-row case RED, `cmp` exit 0, 27/27 GREEN)
- gc-198-05-neuter: gate=AddAllocationFlow.test.tsx (mint a new key on every submit) result=red restored=identical (the Retry-reuses-key case RED, `cmp` exit 0)
- gc-198-05-neuter: gate=AddAllocationFlow.test.tsx (announce the own line on the commit branch) result=red restored=identical (the Outcomes-copy case RED, `cmp` exit 0, 53/53 GREEN)
- gc-198-05-gates: vitest=green census=green tsc=clean lint=clean-except-known (see Notes)

Results: `add-allocation.test.ts` 39/39; `AddAllocationFlow.test.tsx` 53/53; `src/app/(dashboard)/allocations` plus contracts-registry, display-sign-single-source and figure-gate-census: 176 files, 3119 tests, all green; the Task 1 sibling suites (AllocateDialog, retry-prop, ScenarioCommitDrawer, OutcomeForm, zod-db-check-parity) 166/166; `node scripts/verify-plan-anchors.mjs` OK (26 claims); `npx tsc --noEmit` clean.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Pinned the new component in the display-sign R5 allowlist**
- **Found during:** Task 2
- **Issue:** `display-sign-single-source.test.ts` R5 counts every constant negative tone per file. The shared input class carries `aria-[invalid=true]:border-negative`, the same validity border `AllocateDialog.tsx` already has pinned, so R5 failed with "1 found, NO pin".
- **Fix:** Added one allowlist entry (count 1) with a reason, in the file's existing format. No tone is chosen from a value's sign.
- **Files modified:** `src/__tests__/display-sign-single-source.test.ts`
- **Commit:** 71d876d32

**2. [Rule 2 - Missing critical] A field message for an empty or malformed date**
- **Found during:** Task 1
- **Issue:** A cleared `type="date"` input yields an empty string. The plan names no message for it, and sending it would reach the route as a 400.
- **Fix:** `ALLOCATION_DATE_REQUIRED_MESSAGE` (`Enter the allocation date.`) in `add-allocation.ts`, shown at the date field. Tested.
- **Commit:** 8e3f9ef93

### Scope notes (not deviations from a locked decision)

- The UI-SPEC's exit animation is not built; see key-decisions. The enter animation and reduced-motion handling are.
- `Retry` on the list read is not labelled `Retrying…`; the loading rows replace the envelope while the read runs, as the plan's behavior block specifies.
- 198-CONTEXT.md decisions were not contradicted by the plan's examples.

## Known Stubs

None. `onRecorded`, `deepLink`, `heldStrategyIds` and `bookEquityUsd` are props the host (plan 198-08) supplies; the component reads no mock data.

## Notes

- `npm run lint`: eslint has 0 errors (2 warnings in files this plan did not touch: `MetricsColumn.tsx`, `composite-read-path.ts`). `check-planning-hygiene` fails rule 6e on ROADMAP.md (the known "Phase 196" bullet), not fixed here as instructed. All other lint steps pass.
- Flagged assumption carried from the plan: a third-party add records a percent of today's Book equity, which drifts as Book equity moves (RESEARCH A2); the Scenario drawer has the same property.
- An own-strategy write that answers 409 (the mark-flip race) does not call `router.refresh()` the way AllocateDialog does. The host owns `router.refresh()` on success only; a stale own-row after a 409 is re-read when the host next refreshes.

## Threat Flags

None. No new endpoint, auth path or schema; both writes use the existing same-origin routes with their existing checks.

## Self-Check: PASSED

- FOUND: `src/app/(dashboard)/allocations/lib/add-allocation.ts`, `add-allocation.test.ts`, `components/AddAllocationFlow.tsx`, `AddAllocationFlow.test.tsx`
- FOUND commits: 8e3f9ef93, 71d876d32, b21e4d03e (ancestors of HEAD)
- Acceptance greps: `export function parseAmount` 1, `export function generateIdempotencyKey` 1, `export const OUTCOME_DATE_FUTURE_MESSAGE` 1, `Date cannot be in the future` 1 in the schema file, `init_holdings_fingerprint` 0 in `add-allocation.ts`, `TrustTierLabel` 0, `browse-add-` 0 and the wizard names 0 in `AddAllocationFlow.tsx`, `buildAllocationRequest(` 2, `generateIdempotencyKey` 2.
