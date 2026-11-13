---
phase: 198-mybook-my-allocation-answers-how-is-my-book-doing-in-three-tabs
plan: 03
subsystem: allocations-ssr-payload
tags: [key-data-gaps, owner-only, server-day, ssr-payload]
requires:
  - phase: 194.1
    provides: figure-gate census (precondition)
provides:
  - keyDataGaps, accountGroups, tailRange, nextUtcDay, previousUtcDay, KeyDataGap, KeyDataGapCause (src/app/(dashboard)/allocations/lib/key-data-gaps.ts)
  - identityPendingKeyIds, deriveKeyDataGapsField, MyAllocationDashboardPayload.keyDataGaps (src/lib/queries.ts)
affects: [198-09]
tech-stack:
  added: []
  patterns: [pure producer called from the SSR query, account identity read server-side and never copied to the payload]
key-files:
  created:
    - src/app/(dashboard)/allocations/lib/key-data-gaps.ts
    - src/app/(dashboard)/allocations/lib/key-data-gaps.test.ts
  modified:
    - src/lib/queries.ts
    - src/lib/queries.test.ts
    - src/lib/queries.my-allocation.test.ts
key-decisions:
  - "Entries with no range by design (identity_pending, duplicate_account) ship firstMissingDay null and ranges null, the same shape as an unknown range, so the consumer keys off the cause."
  - "The reference day is the curve's last day for a failing exit on a ready book, else yesterday UTC from the server clock; the pure lib has no Date, and previousUtcDay is hand-rolled day arithmetic."
  - "A shared-account entry needs every key of the group failing (failingToSync); one working key means no entry."
  - "Interior holes in a key's series are not reported as missing days (an MT5 key has no weekend rows)."
requirements-completed: [ROUTE-07]
status: complete
duration: about 25 min
completed: 2026-11-08
commits: 2
plan_head_before: 8508b6ac8b9ebba7f6d202b18a3d6e6613e87268
plan_head_after: 10ce1fd4077db7b973f380a45c147643056ce3dc
actuals:
  tokens: 14000
  tasks: 2
  commits: 2
---

# Phase 198 Plan 03: keyDataGaps producer Summary

The SSR payload now names, for each key the server can attribute a fault to, the cause, the first missing day and the missing day range, owner-only and without any account identity, so the plan 198-09 message can say which key and which days.

## Tasks

| Task | Name | Commit |
| ---- | ---- | ------ |
| 1 | The pure producer, per-arm and owner-only (D-01) | dcafa1320 |
| 2 | Wire `keyDataGaps` into both payload literals of `getMyAllocationDashboard` (D-01) | 10ce1fd40 |

## What was built

- `key-data-gaps.ts`: one branch per rebuild reason (`key_not_syncing`, `account_identity_pending`, `duplicate_account`, `shared_account_no_working_key`) plus the failing-exit arm that runs on any reason. Owner filter on every id; a group left with under two owned ids is dropped; an empty tail emits nothing; output sorted by cause then first id.
- `queries.ts`: `identityPendingKeyIds` beside `notSyncingIdentityPendingKeyIds` (same predicates, so the two lists partition the pending set), `deriveKeyDataGapsField` (keeps `venue_account_id` local), and `keyDataGaps` computed once after `liveBaselineMetrics` and spread into the no-portfolio literal and the main literal. No migration, no new query.

## Gate evidence

- gc-198-03-red: key-data-gaps.test failed to load before the module existed; the queries and my-allocation cases (9) failed before the field and helpers existed
- gc-198-03-neuter: gate=key-data-gaps.test (owner filter removed) result=red restored=identical (the foreign-exit, one-owned-key group and foreign-id-in-group cases went RED; cmp exit 0; rerun 26/26 green)
- gc-198-03-neuter: gate=key-data-gaps.test (reference day taken from the exit's own day instead of curveLastDay) result=red restored=identical (six ready-arm and ordering cases went RED including the reference-day case; cmp exit 0; rerun 26/26 green)
- gc-198-03-neuter: gate=queries.my-allocation.test (`keyDataGaps,` removed from the no-portfolio literal) result=red restored=identical (TC 198-03b went RED, the main-branch case stayed green; cmp exit 0; rerun green)
- gc-198-03-gates: vitest=green tsc=clean lint=clean-except-known (eslint 0 errors, 2 pre-existing warnings in unrelated files; the one red is check-planning-hygiene rule 6e on ROADMAP.md, the known Phase 196 bullet, not touched here)
- Anchor verifier on this plan: exit 0, 15 claims checked. `queries.test.ts`, `queries.my-allocation.test.ts` and the new lib test: 438 passed. `src/app/(dashboard)/allocations` plus the contracts registry: 172 files, 2972 tests passed. `git diff --name-only <merge-base> HEAD -- supabase` prints nothing.

## Deviations from Plan

None - plan executed as written. Two small choices inside it, recorded for the consumer:

- The plan's entry shape for `duplicate_account` lists only `{ apiKeyIds, cause }`; the type keeps all four fields and ships `firstMissingDay: null, ranges: null` for causes with no range, so the 198-09 consumer reads one shape.
- `previousUtcDay` was added to the lib (not named in the plan) so `yesterdayUtc` comes from the same hand-rolled UTC arithmetic as `nextUtcDay`.

Residual (recorded, not fixed): a group on one account counts a key as failing only by `failingToSync`, so a group that contains a disconnected key whose last status was healthy produces no shared-account entry. That errs toward naming nobody, never toward naming a healthy key.

## Known Stubs

None.

## Threat Flags

None. T-198-04 (account identity stays inside `deriveKeyDataGapsField`; foreign exit and foreign group dropped; `va-` substring asserted absent; owner-filter neuter RED) and T-198-05 (server days only; reference-day neuter RED) are mitigated as planned.

## Self-Check: PASSED

Files found: key-data-gaps.ts, key-data-gaps.test.ts, queries.ts, queries.test.ts, queries.my-allocation.test.ts. Commits dcafa1320 and 10ce1fd40 are ancestors of HEAD.
