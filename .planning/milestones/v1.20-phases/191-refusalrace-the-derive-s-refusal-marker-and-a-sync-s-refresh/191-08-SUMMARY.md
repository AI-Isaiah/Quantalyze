---
phase: 191-refusalrace-the-derive-s-refusal-marker-and-a-sync-s-refresh
plan: 08
subsystem: api
tags: [typescript, audit-coverage, rpc, parity-pins, retraction]
requires:
  - phase: 191-05
    provides: "retract_ledger_refresh_marker live on PROD (gate-pr2: open)"
provides:
  - "RETRACT_REFRESH_MARKER_RPC and RETRACTION_OUTCOMES exported from src/lib/ledger-refresh-marker.ts"
  - "retractInheritedRefreshMarker reduced to one admin.rpc(\"retract_ledger_refresh_marker\", ...) call and an outcome map"
  - "retract_ledger_refresh_marker in MUTATING_RPC_NAMES plus a mutator pin in audit-coverage.test.ts"
  - "marker set, rpc name and outcome words parity-pinned to the generated SQL snapshot"
affects: [191-09, 191-10]
tech-stack:
  added: []
  patterns: ["rpc-only fake that refuses every table, so a read-modify-write body cannot pass", "mutating rpc written as a quoted literal for the audit scanner"]
key-files:
  created: []
  modified:
    - src/lib/ledger-refresh-marker.ts
    - src/lib/ledger-refresh-marker.test.ts
    - src/__tests__/audit-coverage.test.ts
    - src/app/api/keys/sync/route.test.ts
    - src/app/api/strategies/finalize-wizard/route.test.ts
key-decisions:
  - "The helper writes the rpc name as a quoted literal at .rpc(, never through the constant; a parity case pins constant == literal == snapshot name"
requirements-completed: []  # SC-2 retraction half (TypeScript) done; the phase SC waits for plans 06, 07, 09, 10
status: complete
completed: 2026-11-05
commits: 3
plan_head_before: 9fa001a570fc2b9696f775c13e61e800e5918f7b
plan_head_after: 709825cb4cdb5021a38eec27ecd2c10c6292716f
actuals:
  tokens: 15000
  tasks: 3
  commits: 3
---

# Phase 191 Plan 08: TypeScript retraction, route tests, MUTATING_RPC_NAMES, parity pins Summary

`retractInheritedRefreshMarker` now makes one `admin.rpc("retract_ledger_refresh_marker", { p_job_id, p_correlation_id })` call and maps the four outcomes, with the old exported name, signature, falsy-id return and `retractionFailureCode` unchanged, so neither Sync route source changed.

## Commits

- `225134065` feat(191-08): retraction helper makes one rpc call, audit allowlist keeps the Sync pragmas meaningful
- `a5a842f27` test(191-08): both Sync route tests serve the marker retraction through their rpc mock
- `709825cb4` test(191-08): pin the marker set, rpc name and outcome words to the retraction function's snapshot

## Verify results

All four touched vitest files green together: 4 files, 274 tests. `npm run typecheck` 0 errors; eslint 0 problems on the five touched files. `node scripts/verify-plan-anchors.mjs` on the plan: OK. Neither route source differs from the merge-base with `origin/main`.

## RED proofs (every neuter from a byte backup, restored with cp, `cmp -s` silent, re-run green)

1. Helper tests against today's body (`ledger-refresh-marker.ts.before` copied over the helper): 14 failed. The positive cases (both markers), the three nothing-retracted cases, `no_row`, the rpc error case and the seven unreadable-answer cases fail with `unexpected table access: from(compute_jobs)`; the falsy-id cases and the `retractionFailureCode` case stay green (they never reach the body). Restored, 24 passed (30 after Task 3).
2. Route tests against the same old helper: 10 failed across the two files (keys/sync: both marker positives, the no_marker case, the failed-retraction case, the budget case, the late-rejection case; finalize-wizard: both marker positives, the no_marker case, the failed-retraction case). Restored, 217 passed.
3. Parity pins on the real files: widening a snapshot marker list reddens the marker parity case; renaming the snapshot's `no_marker` outcome reddens the outcome parity case; changing the helper's quoted literal reddens the name case and both helper positive cases; changing the constant reddens the name case.

## The three audit neuter readings

- (a) `"retract_ledger_refresh_marker"` removed from `MUTATING_RPC_NAMES`: the new pin `retractInheritedRefreshMarker counts as a mutator, ...` goes red (`expected false to be true`). Restored.
- (b) helper changed to `admin.rpc(RETRACT_REFRESH_MARKER_RPC, ...)`: the same pin goes red (`expected false to be true`). Restored.
- (c) the `@audit-skip` line above the retraction call in `src/app/api/keys/sync/route.ts` deleted: **the corpus test stays GREEN** (27 passed). See Deviations. The reading that does bite: delete that pragma AND neuter the `logAuditEventAsUser` call below it, and the corpus test goes red naming `src/app/api/keys/sync/route.ts:405 > const retraction = retractInheritedRefreshMarker(admin, rpcData, correlation_id);` (and `:333`, collateral because that site shared the emission). Control: the same double neuter with the allowlist entry also removed leaves `:405` unnamed (only `:333`), which is the allowlist entry's measured value at the corpus level. Restored.

## Measured values

- Marker lists in the `retract_ledger_refresh_marker.sql` snapshot: 2 (the UPDATE's WHERE and the classifying SELECT's CASE); outcome literals parsed: 4.

## Deviations from Plan

**1. [Plan premise wrong] The plan's neuter reading (c) cannot go red as written.**
- **Found during:** Task 1, neuter check (c).
- **Issue:** both routes call `logAuditEventAsUser(... "sync.start" ...)` within the enclosing function after the retraction call, so `isCovered` returns covered by `audit-call` with or without the pragma. The pragma is redundant for the corpus test at these two sites; deleting it alone leaves the suite green.
- **Fix:** recorded the corrected reading above (pragma plus emission neutered, red naming the site; control without the allowlist entry does not name it). The mutator pin remains the thing that fails first on a lost allowlist entry or a constant at the call, which is the plan's intent. No route file was edited.
- **Commit:** none (measurement only).

**2. [Rule 3] SEQUENTIAL commit assertion.** The worktree branch is `feat/191-p08`, not in the `agent-*` namespace; the orchestrator dispatched this plan onto that named branch and it is not a protected branch, so the agent-namespace allow-list was treated as not applicable.

**3. Task 3 JSDoc work landed in the Task 1 commit.** The helper rewrite replaced the whole JSDoc (it names the SQL function, D-01, D-02's unchanged gap, the outcomes and the error contract) and the `LEDGER_REFRESH_JOB_SOURCES` header note was added in the same edit; Task 3's commit is the parity describe only.

## Known Stubs

None.

## Threat Flags

None. T-191-22, T-191-23 and T-191-24 mitigations are in place and tested (allowlist entry and mutator pin; unknown outcome, non-object answer and foreign marker each throw; the helper sends only the two ids and the fake refuses any table).

## Self-Check: PASSED

Created/modified files exist; commits `225134065`, `a5a842f27`, `709825cb4` are ancestors of HEAD.
