---
phase: 200-managerkeys-keys-names-and-adding-a-strategy-each-have-one-p
plan: 10
subsystem: ui
tags: [profile, api-keys, role, delete-key, parity]
requires:
  - phase: 200-07
    provides: AEM `role` prop, feeds line, delete-confirm feeds naming
provides:
  - "role switch over every holdings-sync call site in AllocatorExchangeManager"
  - "Delete key for manager and both (delete_allocator_api_key, p_cascade_holdings false)"
  - "three named parity tests plan 08 greps for"
affects: [200-08]
key-files:
  modified:
    - src/components/exchanges/AllocatorExchangeManager.tsx
    - src/components/exchanges/AllocatorExchangeManager.test.tsx
key-decisions:
  - "Manager is never offered Disconnect; its card button reads Delete key and the modal is titled Delete."
  - "DELETE_REMOVES_HISTORY keeps its value; its first sentence is now DELETE_REMOVES_HISTORY_HEAD so a manager is not told to Disconnect instead."
  - "A manager's key with holdings (not expected) keeps the cascade box and Delete key waits for it."
status: complete
requirements-completed: [LEAN-04, ROUTE-09]
commits: 1
plan_head_before: f28c8c119
plan_head_after: f78aa73b1
actuals:
  tokens: 16000
  tasks: 2
  commits: 1
---

# Phase 200 Plan 10: Profile key manager parity for a manager-only user Summary

`AllocatorExchangeManager` now does nothing allocator-side for role `manager` and offers a real `Delete key`; add, delete and update password each have a named passing test.

## What was built

- `isAllocatorRole` (allocator, both) guards all three `/api/allocator/holdings/sync` call sites: post-add, Reconnect, and `handleSync` (which also returns early for a manager, defence in depth). A manager's added row is not stamped `syncing`; after Reconnect it is set `idle` locally (the RPC leaves it idle on the server).
- For a manager: no `Sync now` button, no `Active Allocation` claim in the subtitle (`N connected`), no departed-history control and no departed-history reads (`departedIds` empty), the "How exchange sync works" steps 3 and 4 (positions into Active Allocation, `allocation_events`) are hidden, the empty-state copy no longer promises position tracking, and the pill uses subject `strategy-key` ("Key checked", as `ApiKeyManager` does).
- `Delete key`: manager gets a delete-only modal (title `Delete <venue>?`, loss wording for every fed strategy via plan 07's `deleteFeedsNote(..., true)`, the history warning, no Disconnect). `both` with zero holdings gets `Disconnect` (secondary) beside `Delete key` (danger), the plain feeds line for Disconnect and a second loss line for Delete. Both call `delete_allocator_api_key` with `p_cascade_holdings: false`; an RPC error shows `Could not delete this key. Please try again.` and keeps the card. `allocator` is unchanged (its 100 existing cases pass unedited).
- Capability parity, from code: add (`+ Connect exchange` -> same `/api/keys/validate-and-encrypt`), delete (`Delete key`), update password (`Update password` -> `UpdateMt5SecretDialog`). Rotating a non-MT5 secret is offered by neither component; recorded, not invented.

## Tests

`AllocatorExchangeManager.test.tsx`: 100 -> 111 cases (11 new, in one describe). Named: `manager-only parity: add`, `manager-only parity: delete`, `manager-only parity: update password`. Others: both still syncs after add; manager renders no Sync now / Active Allocation / history control (and `both` keeps all three); manager Reconnect with no holdings sync; delete RPC error keeps the card; failed feeds read warns and still allows delete; manager with holdings needs the box; `both` zero holdings offers both RPCs; allocator modal unchanged.

## RED evidence

First run, tests written before any code: 8 of the 11 new cases failed (the other 3 passed because they exercise behaviour that already existed). Then each guard neutered on the production file, byte copy in the scratchpad `p200-bak/10`, restored with `cp -p`, `cmp` exit 0, re-run green.

```
gc-200-10-neuter: gate=AllocatorExchangeManager.test.tsx#manager-only parity: add change=post-add sync guard `if (isAllocatorRole)` -> `if (true)` result=red (AssertionError: expected [ [ …(2) ] ] to have a length of +0 but got 1) restored=cmp0
gc-200-10-neuter: gate=AllocatorExchangeManager.test.tsx#manager-only parity: delete change=Delete key button hidden (`{false ? (`) result=red (Unable to find an accessible element with the role "button" and name "Delete key"; 5 cases fail) restored=cmp0
gc-200-10-neuter: gate=AllocatorExchangeManager.test.tsx#manager Reconnect without holdings sync change=reconnect guard `if (false)` result=red (expected holdings sync calls length 0 but got 1) restored=cmp0
gc-200-10-neuter: gate=AllocatorExchangeManager.test.tsx#no Sync now / Active Allocation / history control change=Sync now rendered for manager result=red restored=cmp0
gc-200-10-neuter: gate=AllocatorExchangeManager.test.tsx#no Sync now / Active Allocation / history control change=renderDepartedHistory role guard removed result=red restored=cmp0
gc-200-10-neuter: gate=AllocatorExchangeManager.test.tsx#no Sync now / Active Allocation / history control change=manager subtitle branch disabled result=red restored=cmp0
gc-200-10-neuter: gate=AllocatorExchangeManager.test.tsx#manager-only parity: delete change=Disconnect shown to manager result=red restored=cmp0
```

Not neutered: the `handleSync` early return, which no test can reach because a manager has no Sync now button (the button neuter above covers the path a user can reach).

## Gates

- `npx tsc --noEmit -p .`: no output.
- `npx vitest run src/components/exchanges src/components/auth/ProfileTabs.test.tsx src/__tests__/key-storage-census.test.ts src/lib/dialog-envelope.invariant.test.ts`: 10 files, 285/285.
- `npx vitest run ... -t "manager-only parity"`: 11 passed.
- `npx eslint src/components/exchanges`: 0 problems.
- `node scripts/verify-plan-anchors.mjs` on the plan: OK, 9 claims.
- `grep -a -c 'p_cascade_holdings: false'` in the component: 2; parity names: present, all pass.

## Deviations from Plan

**1. [Rule 2 - Honesty] `DELETE_REMOVES_HISTORY` split.** Its text ends "Disconnect instead to keep it", which for a manager points at a control they are not offered. The constant keeps its exact value (composed from `DELETE_REMOVES_HISTORY_HEAD` + the tail); a manager is shown only the head. `both` and the allocator cascade box show the full sentence.

**2. [Rule 2] Allocator-book copy hidden for a manager beyond the three controls the plan names:** the `Active Allocation` subtitle, "How exchange sync works" steps 3 and 4, the empty-state sentence, and the pill subject. Each was a claim a manager-only account cannot make true.

**3. One commit for both tasks.** Both tasks edit the same two files and were developed together (tests first, RED run recorded above, but not committed separately); one `feat(200-10)` commit carries them.

**4. Plan said "no active-allocation card":** AEM has no such card; it lives in `ExchangesTabContent` (null for a manager since plan 07). AEM's own Active Allocation claim is the subtitle, handled above.

## Known Stubs

None.

## Open

- `ExchangesTabContent` (outside this plan's files) still renders its intro paragraph "build your Active Allocation portfolio" for every role.
- A Disconnected card has no `Delete key`; a manager can only reach a disconnected key by a role change, and Reconnect then Delete works.
- `ApiKeyManager.*` untouched (plan 11 owns it).

## Threat Flags

None. T-200-20: all three sync call sites guarded, neuter tests above. T-200-21: the confirm names fed strategies and the history loss; the RPC refuses non-owners (measured by the planner).

## Self-Check: PASSED

- `AllocatorExchangeManager.tsx` and its test exist and are modified; commit `f78aa73b1` is an ancestor of HEAD.
- STATE.md, ROADMAP.md untouched.
