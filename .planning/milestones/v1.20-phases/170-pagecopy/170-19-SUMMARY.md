---
phase: 170-pagecopy
plan: 19
subsystem: admin-match
status: complete
gap_closure: true
tags: [admin, match-queue, null-handling, regression-test]
requirements: ["SC2-MATCH"]
requires: []
provides:
  - "getAllocatorMatchPayload returns preferences: null for an allocator with no allocator_preferences row, on both return paths"
affects:
  - "/admin/match/<id> and /api/admin/match/[allocator_id]"
  - "/api/demo/match/[allocator_id] (same helper)"
tech-stack:
  added: []
  patterns: ["castRowOrNull for a legitimately nullable .maybeSingle() row; castRow stays for required rows"]
key-files:
  created:
    - src/lib/admin/match.test.ts
  modified:
    - src/lib/admin/match.ts
decisions:
  - "Neither preferences site passes a `preferences ?? null` any more: castRowOrNull already maps undefined to null"
metrics:
  duration: "~10 min"
  completed: 2026-09-30
actuals:
  tokens: 2400
  tasks: 2
  commits: 1
plan_head_before: fe0480217d9b1ee44fe270917bc736f7a24cb69b
plan_head_after: 95d463f42
---

# Phase 170 Plan 19: Nullable preferences cast in the admin match payload Summary

`getAllocatorMatchPayload` now casts the `.maybeSingle()` preferences row with `castRowOrNull` on both the no-batch and the batch return paths. Before this, every allocator without an `allocator_preferences` row made `/admin/match/<id>` answer 500. That closes VERIFICATION gap 6. Real failures still throw: a preferences query error rejects, and a missing profile still throws through `castRow`.

## Tasks

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 (tracer) | A missing preferences row returns null on both paths | 95d463f42 | src/lib/admin/match.ts, src/lib/admin/match.test.ts |
| 2 | Route and demo suites still hold | (no code change) | none |

## Evidence

**Class search (`grep -rnE 'castRow<.*\| ?null>\(' src`, the orchestrator-amended pattern):**
- At base `fe0480217`: **2** hits, `src/lib/admin/match.ts:168` and `:232`
- After the fix: **0** hits

**RED on the old code** (the test file was written and run before `match.ts` was changed), `2 failed | 2 passed (4)`:
- `getAllocatorMatchPayload: allocator with no preferences row > no-batch path returns preferences null instead of throwing`
- `getAllocatorMatchPayload: allocator with no preferences row > batch path returns preferences null instead of throwing`
- Both failed with the same thrown message: `Error: castRow: expected a row (preferences), got null`
- The two loud-failure cases (a preferences query error rejects, and a missing profile throws with `castRow` + `profile`) passed on the old code as well. They pin behaviour that has to survive the fix, so they were never expected to go RED.

**GREEN on the fix:** `4 passed (4)`.

**Neuter, one path only:** I took a scratchpad `cp` byte backup of `match.ts`, then put the throwing `castRow<Record<string, unknown>>(preferences, "preferences")` back on the batch-path return only. Result: `1 failed | 3 passed (4)`, and the failing case was exactly `batch path returns preferences null instead of throwing`. I restored with `cp`. `cmp` against the backup was identical, the suite was back to `4 passed (4)`, and `git diff` showed only the intended 4+/5- change.

**Acceptance:** `grep -c 'castRowOrNull' src/lib/admin/match.ts` prints 3 (the import plus two sites).

**Task 2 suites:** `npx vitest run "src/app/api/admin/match" "src/app/api/demo/match" src/__tests__/mandate-columns-schema-sync.test.ts src/__tests__/strategy-analytics-match-columns-schema-sync.test.ts src/lib/admin` gave `16 files passed, 285 passed | 2 skipped (287)`, exit 0. No suite pinned the old throwing behaviour.
- The 2 skips are the live-schema halves of the two schema-sync tests. `MANDATE-07 ... every column in ALLOCATOR_PREFERENCES_COLUMNS actually exists in the live allocator_preferences schema` and `... every column in STRATEGY_ANALYTICS_MATCH_COLUMNS actually exists in the live strategy_analytics schema` both need a database, and this environment has none. Neither column list was touched. These skips existed before this plan; this plan did not add them.

**Static checks:** `npx tsc --noEmit -p .` exit 0. `npx eslint src/lib/admin/match.ts src/lib/admin/match.test.ts` clean.

## Post-land CI rows this plan unblocks

**N-MATCH V390** and **N-MATCH V960** in `e2e-seeded`. CI run `36764778803` logged the preferences 500 six times for the seeded allocator, so neither row reached its h1. After this lands they should reach the h1 and run their read-only and write-control assertions. That can only be confirmed on the orchestrator's post-land CI run. It was not measured here, because no seeded e2e runs locally.

## Deviations from Plan

None. The plan executed as written, with the orchestrator-amended search pattern.

## Threat model

- T-170-46 (DoS): mitigated. The nullable cast removes the 500, and both paths are tested.
- T-170-47 (real error hidden as null): mitigated. The `preferencesRes.error` throw is untouched, and a test proves a query error still rejects.
- T-170-48, T-170-SC: accepted as planned. The route, the admin check and dependencies are unchanged.

## Known Stubs

None.

## Self-Check: PASSED

- FOUND: src/lib/admin/match.test.ts
- FOUND: src/lib/admin/match.ts contains castRowOrNull (3)
- FOUND: commit 95d463f42
