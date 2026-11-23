---
phase: 209-scrubleaks-error-reports-carry-no-raw-database-details-and-n
plan: 05
subsystem: api
tags: [audit-coverage, scenario-share, mutating-rpc, typed-rpc, positive-control-pin]

requires: []
provides:
  - "create_scenario_share is in MUTATING_RPC_NAMES and the scenario share route calls it as a plain typed supabase.rpc call with the name on the same line, so the audit law reaches the route (SHARE-D-164-C closed)"
  - "removing the route's logAuditEvent with no pragma turns audit-coverage RED naming the route"
  - "a positive-control pin fails when the call stops being a detected, audit-covered site (method cast back, list entry removed, audit call removed)"
affects: []

status: complete
commits: 2
plan_head_before: bb17c9b3f39f8426bdbbac32d2900aab04eac2dd
plan_head_after: 4d5d222b44817781b02dd65efbf07bdb1a437859

actuals:
  tokens: 2600
  tasks: 2
  commits: 2

tech-stack:
  added: []
  patterns:
    - "positive-control pin beside the Phase 191 retraction pin: file-local findRpcMutations + isCovered asserted on one route"

key-files:
  created: []
  modified:
    - src/app/api/allocator/scenario/share/route.ts
    - src/app/api/strategies/[id]/share/route.ts
    - src/__tests__/audit-coverage.test.ts

key-decisions:
  - "D-15: the method cast-through-unknown is replaced by a plain typed call, because database.types.ts carries create_scenario_share (Args p_scenario_id, p_token_hash; Returns string)"
  - "D-16: listing the name alone is decorative, so a pin asserts exactly one detected site covered by audit-call or audit-call-above, never pragma"
  - "The strategy share JSDoc keeps the client-cast explanation but no longer names the scenario route or carries its call literal"

requirements-completed: [SC5]
---

# Phase 209 Plan 05: scenario share audit law Summary

`create_scenario_share` now falls under the audit law in a form the law actually reaches. The scenario share route calls `supabase.rpc("create_scenario_share", {` as a plain typed call on one line, the name is listed in `MUTATING_RPC_NAMES`, and a pin keeps both halves bound.

## What was built

- `src/app/api/allocator/scenario/share/route.ts`: the cast-through-unknown invocation and its stale justification comment (the types-not-regenerated claim, the precedent reference, the delete-me instruction) are gone. The call is `await supabase.rpc("create_scenario_share", {` with `p_scenario_id` and `p_token_hash`. `shareId` is typed from `Returns: string`; `shareId as string` in the audit metadata still type-checks. The atomicity and SECURITY INVOKER explanation and the "returns the new share row id (UUID)" sentence stay.
- `src/__tests__/audit-coverage.test.ts`: `"create_scenario_share"` appended to `MUTATING_RPC_NAMES` with a dated reason comment, and a new describe "audit-coverage — the scenario share mint stays visible to the law (Phase 209, SHARE-D-164-C)" with one `it`. It reads the route, asserts `findRpcMutations` returns exactly one hit, and asserts `isCovered(...).covered` is true with `reason` in `["audit-call", "audit-call-above"]`. The `H_0001_UNCOVERED_ALLOWLIST` length floor and the `detectedMutationSites` floor are unchanged.
- `src/app/api/strategies/[id]/share/route.ts`: comment-only. The `CreateShareRpcClient` JSDoc drops `scenario-share` from the precedent, and the paragraph describing the scenario route's method cast (with its quoted call literal) is replaced by a sentence about a method cast in general (csv-finalize's `finalize_csv_strategy_with_returns`). No line of the file contains a dot-rpc call literal for the scenario RPC.

Measured reason string for the pin on the current route: `audit-call` (the route's `logAuditEvent` sits after the call).

## Neuter-to-RED proofs

Each: byte backup to the scratchpad, neuter, run `npx vitest run src/__tests__/audit-coverage.test.ts`, restore with `cp`, `cmp` clean, rerun green (28 passed after the pin was added; 27 before).

| Proof | Neuter | Result |
|---|---|---|
| N1 (D-16 RED) | delete the route's `logAuditEvent(supabase, { action: "scenario.share", ... })` call, no pragma added (before the pin existed) | RED: corpus test `every .insert/.update/.delete/.upsert has a logAuditEvent or @audit-skip` fails with `Found 1 uninstrumented mutation(s) NOT in the H-0001 allowlist: src/app/api/allocator/scenario/share/route.ts:232`. 26 passed, 1 failed. Restored, cmp clean, 27 passed. |
| N2 (cast restored) | re-introduce `(supabase.rpc as unknown as (...) => Promise<...>)("create_scenario_share", {` around the call | RED: the new pin fails with `AssertionError: expected [] to have a length of 1 but got +0`. The corpus test STAYED GREEN (only 1 failure, 27 passed otherwise), which is exactly why the pin exists. Restored, cmp clean. |
| N3 (list entry removed) | delete `"create_scenario_share",` from `MUTATING_RPC_NAMES` | RED: the pin fails with `expected [] to have a length of 1 but got +0`. Restored, cmp clean. |
| N4 (audit call removed, pin present) | delete the route's `logAuditEvent` call | RED: two failures, the pin (`expected false to be true` on `covered`) and the corpus test (`Found 1 uninstrumented mutation(s) NOT in the H-0001 allowlist`). Restored, cmp clean, 28 passed. |
| reason probe | temporarily changed the reason assertion to `toBe("zzz")` | `expected 'audit-call' to be 'zzz'`, which records the measured reason. Restored, cmp clean. |

## Verification

- `node scripts/verify-plan-anchors.mjs` on the plan: exit 0 before any edit.
- Plan verify command (`audit-coverage`, scenario share route tests, `phase-29-frozen-spine-guards`): 4 files, 68 passed. phase-29 stays green (it lists the name and scans `supabase/migrations` only).
- Phase quick-run command (21 files): 949 passed.
- `npm run typecheck`: exit 0. `npm run lint`: 0 errors, 4 warnings (none in files touched here; not introduced by this plan).
- Acceptance greps: list entry 1, typed call 1, `rpc as unknown as` in scenario route 0, pin describe 1, route path literal in the test file 2.

## Deviations from Plan

None - plan executed as written. One note on order: N1 was run after Task 1 and before Task 2's pin existed, as the plan places it, so the only failing test there was the corpus test.

## Issues Encountered

None. The first attempt to edit `audit-coverage.test.ts` failed because the file had not been read in the session; it was re-read and the edit applied.

## Known Stubs

None.

## Threat Flags

None. No new endpoint, auth path, file access or schema surface; no migration touched.

## Threat model status

- T-209-12 (scenario share mint without an enforced audit trail): mitigated, N1 and N4.
- T-209-13 (listing becoming decorative again): mitigated, N2, N3 and N4 each turn the pin RED.
- T-209-SC: accepted, no package installed.

## Self-Check: PASSED

- FOUND: src/app/api/allocator/scenario/share/route.ts, src/app/api/strategies/[id]/share/route.ts, src/__tests__/audit-coverage.test.ts
- FOUND commits: fde8a1aaf (Task 1), 4d5d222b4 (Task 2); `git rev-list --count bb17c9b3f..HEAD` = 2 at SUMMARY time
